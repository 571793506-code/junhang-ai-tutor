import { normalizeTeachingPurpose, assessmentScoreIssues, normalizeAssessmentOptions, assessmentChoiceOptionsValid, validateGradingSourcePackage } from "@junhang/core";
import { buildAssessmentPartitions, mapWithConcurrency } from "./assessment-partitions.js";
import { resolveTeachingTaskPolicy } from "./model-policy.js";
import { validateAssessmentPartition, assessmentReadingRequirements } from "./model-escalation.js";

const present = (value) => value != null && String(value).trim() !== "";
const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
const generationKeys = ["title", "subject", "grade", "targetGrade", "kind", "requirement", "specialRequirements", "requestId", "knowledgePoints", "contentScope", "generationContext", "contentContext", "studentSignals", "difficulty", "generationBasis"];
const gradingKeys = ["title", "subject", "grade", "kind", "printedText", "ocrText", "studentAnswerText", "manualText", "ocrQuestions", "referenceAnswers", "answerKey", "assignmentItems", "questionLayoutManifest", "gradingSourcePackage", "teacherContext", "questionRange"];

export function createTeachingOperationBudget(task, config = {}, execution = {}) {
  if (execution.operationBudget) return execution.operationBudget;
  const policy = resolveTeachingTaskPolicy(task, config);
  return { deadlineAt: (execution.now || Date.now)() + (execution.timeoutMs || policy.budget.timeoutMs), remainingTokens: execution.maxTokens || policy.budget.maxTokens };
}

// Reserve each unit's allowance before awaiting. Every unit retains its own repair slot.
export async function runTeachingPipelineUnit(runTask, config, task, input, execution, pool, allowance, validate, outputContract) {
  const quota = Math.max(0, Math.min(allowance, pool.remainingTokens));
  pool.remainingTokens -= quota;
  const budget = { deadlineAt: pool.deadlineAt, remainingTokens: quota, additionalAttemptsUsed: execution.disableSolEscalation ? 1 : 0 };
  try {
    return await runTask(config, task, input, { ...execution, budget, repairIssues: validate, outputContract });
  } finally {
    pool.remainingTokens += budget.remainingTokens;
  }
}

function runtimeResult(task, input, units, text, extra = {}) {
  const policy = resolveTeachingTaskPolicy(task);
  const attempts = units.flatMap((unit) => unit.result.internal.attempts.map((attempt) => ({ ...attempt, partitionId: unit.id })));
  const success = units.some((unit) => unit.result.status === "success");
  const replacementAttempts = attempts.filter((attempt) => attempt.role === "availability-replacement");
  const model = attempts.findLast((attempt) => attempt.status === "SUCCESS")?.model || attempts[0]?.model || policy.primary.model;
  return {
    available: success, providerId: "gpt56", model, [task === "generation" ? "draftText" : task === "grading" ? "gradingText" : "referenceText"]: text,
    error: success ? undefined : units.flatMap((unit) => unit.result.issueCodes)[0] || "TEACHING_EVIDENCE_MISSING",
    modelRun: {
      provider: "gpt56", model, skill: task === "generation" ? "assessment-draft" : task === "grading" ? "submission-grading" : "submission-reference-answer",
      inputSummary: input.requirement || input.title || "", outputSummary: text.slice(0, 240), status: success ? "SUCCESS" : "ERROR",
      metadata: {
        teachingPipelineVersion: "teaching-pipeline-v1", attempts,
        rules: units.map((unit) => ({ unitId: unit.id, ...unit.result.internal.rules })),
        partialGeneration: units.some((unit) => unit.result.status !== "success"),
        primaryModel: attempts[0]?.model || policy.primary.model,
        solAttempted: replacementAttempts.length > 0, escalationTriggered: replacementAttempts.length > 0,
        usedModelEscalation: replacementAttempts.some((attempt) => attempt.status === "SUCCESS"),
        escalationScopes: replacementAttempts.map((attempt) => attempt.partitionId),
        usedDynamicFallback: false,
        ...extra
      }
    }
  };
}

export function assessmentContentIssues(parsed, partition) {
  if (partition.purpose === "explanation") {
    const explanation = parsed.explanation;
    return present(parsed.title) && present(explanation?.concept) && Array.isArray(explanation?.steps) && explanation.steps.length &&
      Array.isArray(explanation?.workedExamples) && explanation.workedExamples.length && explanation.workedExamples.every((example) => present(example.prompt) && present(example.answer) && example.analysisSteps?.length) &&
      Array.isArray(explanation?.commonMistakes) && explanation.commonMistakes.length ? [] : ["explanation_incomplete"];
  }
  const validation = validateAssessmentPartition(parsed, partition);
  const items = (Array.isArray(parsed.sections) ? parsed.sections : []).flatMap((section) => Array.isArray(section?.items) ? section.items : []);
  const issues = [...validation.issues];
  for (const item of items) issues.push(...assessmentScoreIssues(item));
  if (partition.itemScores && (items.length !== partition.itemScores.length || items.some((item, i) => item.score !== partition.itemScores[i]))) issues.push("partition_score_mismatch");
  if (partition.targetItemCount && items.length !== partition.targetItemCount) issues.push("item_count_mismatch");
  if (items.some((item) => !Number.isFinite(item.score) || item.score <= 0)) issues.push("item_score_missing");
  if (items.some((item) => !present(item.knowledgePoint) || !present(item.commonMistake))) issues.push("teaching_feedback_missing");
  if (items.some((item) => /如图|图中|画图/.test(item.prompt) && !item.figure)) issues.push("figure_missing");
  for (const item of items.filter((item) => item.itemType === "choice")) {
    item.options = normalizeAssessmentOptions(item.options);
    if (!assessmentChoiceOptionsValid(item.options)) issues.push("choice_options_missing");
  }
  return issues;
}

function normalizeDailyPrompt(prompt, dayId) {
  if (typeof prompt !== "string" || !dayId) return prompt;
  // Only strip a leading generated label bound to this exact partition. Never
  // remove matching text from the actual problem or another day's identifier.
  const escaped = dayId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const label = new RegExp(`^\\s*(?:第\\s*\\d+\\s*题\\s*)?[（(【\\[]${escaped}[-_]\\d+(?:\\s*[，,]\\s*\\d+(?:\\.\\d+)?\\s*分)?[）)】\\]]\\s*[：:]?\\s*`);
  const normalized = prompt.replace(label, "");
  return normalized.trim() ? normalized : prompt;
}

export async function runAssessmentPipeline(config, input, execution, runTask) {
  const purpose = normalizeTeachingPurpose(input);
  const partitions = buildAssessmentPartitions({ ...input, ...purpose });
  const pool = createTeachingOperationBudget("generation", config, execution);
  const allowance = Math.floor(pool.remainingTokens / partitions.length);
  const safeInput = { ...pick(input, generationKeys), ...purpose };
  const context = safeInput.generationContext?.teaching?.contentContext || safeInput.contentContext;
  const textbookRequested = Boolean(input.textbookAssetId || safeInput.generationContext?.teaching?.textbook?.assetId);
  const evidenceSufficient = execution.evidenceSufficient !== false && (!textbookRequested || context?.approvedOnly === true && context?.textbookContext?.resolved === true && context?.matches?.length > 0);
  const partitionConcurrency = purpose.purpose === "comprehensive" && partitions.length >= 4
    ? partitions.length
    : resolveTeachingTaskPolicy("generation", config).maxConcurrency;
  const units = await mapWithConcurrency(partitions, partitionConcurrency, async (partition) => {
    const readingRequirements = partition.itemTypes.includes("reading") ? assessmentReadingRequirements(partition) : null;
    const contract = partition.purpose === "explanation"
      ? "输出 {title, explanation:{concept,steps:string[],workedExamples:[{prompt,answer,analysisSteps:string[]}],commonMistakes:string[]}}。不要输出试卷分区。"
      : "输出 {title,layout,sections:[{title,type,items:[{itemType,prompt,answer,score,rubric,analysisSteps:string[],knowledgePoint,commonMistake,options?,figure?,answerFormat?,passageGroupId?,passageText?,passageTitle?,passageQuestionIndex?}]}],printNotes:string[]}。只生成 partition 指定题型和题量，同一阅读题组带完整材料。rubric 写明给分依据。prompt 只写题目正文，不加题号、分值或 partition/dayId 等内部编号；编号与分值由结构化字段及展示层提供。";
    const firstResponseBudget = purpose.purpose === "comprehensive" && partitions.length >= 4;
    const result = await runTeachingPipelineUnit(runTask, config, "generation", { ...safeInput, partition: { ...partition, ...(readingRequirements ? { readingRequirements } : {}) } }, {
      ...execution,
      evidenceSufficient,
      // Four formal quiz partitions otherwise reserve half of each partition's
      // allowance for repair and truncate the first structured response.
      ...(firstResponseBudget ? { disableSolEscalation: true } : {})
    }, pool, allowance, (candidate) => {
      const issues = assessmentContentIssues(candidate, partition);
      if (execution.requireRubric === true && partition.purpose !== "explanation" && (candidate.sections || []).some((section) =>
        (section.items || []).some((item) => typeof item.rubric !== "string" || !item.rubric.trim()))) issues.push("rubric_missing");
      return issues;
    }, contract + (partition.itemScores ? " partition.itemScores按题目顺序规定score，评分细则给分点总和必须与对应score一致，分区总分必须等于partition.targetScore。" : "")
      + (readingRequirements ? " 阅读材料和问题必须满足partition.readingRequirements：minimumGroups篇不同材料，每篇不少于minimumGroupLength个lengthUnit，总篇幅不少于minimumTotalLength；至少minimumContextualQuestions题明确依托材料（例如According to the passage、Why或根据短文）。同组每题保存完全一致的完整passageText与passageGroupId，不把篇幅要求当作学生题面。" : ""));
    return { id: partition.id, partition, result };
  });
  if (execution.signal?.aborted) throw execution.signal.reason || new Error("ASSESSMENT_GENERATION_CANCELLED");
  const successful = units.filter((unit) => unit.result.status === "success");
  const merged = successful.length ? {
    title: purpose.purpose === "multi_day" ? input.title || `${input.grade || input.targetGrade || ""}${input.subject || ""}${purpose.dayPlan.length}天${input.kind || "练习"}`
      : purpose.purpose === "comprehensive" ? input.title || `${input.grade || input.targetGrade || ""}${input.subject || ""}${input.kind || "练习"}`
        : successful[0].result.candidate.title,
    ...(purpose.purpose === "explanation" ? { explanation: successful[0].result.candidate.explanation } : {
      layout: successful[0].result.candidate.layout || { paper: "A4", pages: input.kind === "试卷" ? 4 : 2 },
      sections: successful.flatMap((unit) => unit.result.candidate.sections.map((section) => ({
        ...section, ...(unit.partition.dayId ? { dayId: unit.partition.dayId } : {}),
        items: section.items.map((item) => ({ ...item, ...(unit.partition.dayId ? { dayId: unit.partition.dayId, prompt: normalizeDailyPrompt(item.prompt, unit.partition.dayId) } : {}) }))
      })))
    }),
    purpose: purpose.purpose, printNotes: successful.flatMap((unit) => unit.result.candidate.printNotes || [])
  } : null;
  return runtimeResult("generation", input, units, merged ? JSON.stringify(merged) : "", { partitions, purpose: purpose.purpose, generationProfile: input.generationProfile || null, totalBudgetExhausted: pool.remainingTokens <= 0 || (execution.now || Date.now)() >= pool.deadlineAt });
}

export function gradingContentIssues(candidate, input) {
  const questions = candidate.questionResults;
  if (!Array.isArray(questions) || !questions.length) return ["question_results_missing"];
  if (questions.some((q) => !q || typeof q !== "object" || !present(q.questionNo))) return ["question_alignment_invalid"];
  const expected = input.ocrQuestions || [];
  const refs = input.referenceAnswers || [];
  const expectedNos = new Set(expected.map((q) => String(q.questionNo)));
  const actualNos = new Set(questions.map((q) => String(q.questionNo)));
  const issues = [];
  if (expectedNos.size && (questions.length !== expectedNos.size || actualNos.size !== questions.length || [...actualNos].some((no) => !expectedNos.has(no)))) issues.push("question_alignment_invalid");
  for (const q of questions) {
    const ref = refs.find((r) => String(r.questionNo) === String(q.questionNo));
    const evidence = expected.find((r) => String(r.questionNo) === String(q.questionNo));
    if (evidence && ((!present(evidence.studentAnswer) && !present(evidence.observedWork)) || Number(evidence.confidence ?? 1) < 0.62) && q.status !== "uncertain") issues.push("student_evidence_insufficient");
    if (evidence) q.studentAnswer = String(evidence.studentAnswer ?? "");
    if (!["correct", "wrong", "partial", "uncertain"].includes(q.status) || !present(q.explanation)) issues.push("judgment_evidence_missing");
    if (!Number.isFinite(q.maxScore) || q.maxScore <= 0 || ref?.score != null && Number(ref.score) !== q.maxScore) issues.push("max_score_invalid");
    if (q.status === "uncertain" ? q.score !== null : !Number.isFinite(q.score) || q.score < 0 || q.score > q.maxScore) issues.push("question_score_invalid");
  }
  if (!issues.length) {
    candidate.score = questions.some((q) => q.status === "uncertain") ? null : questions.reduce((sum, q) => sum + q.score, 0);
    candidate.needsTeacherReview = true;
  }
  return [...new Set(issues)];
}

function compactVerifiedGradingContext(input) {
  const source = input.gradingSourcePackage;
  const refs = input.referenceAnswers || [];
  const questions = input.ocrQuestions || [];
  if (!source || !validateGradingSourcePackage(source).ok || !refs.length || !questions.length) return input;
  const byNo = new Map(source.questions.map(question => [String(question.questionNo), question]));
  const refNos = new Set(refs.map(ref => String(ref.questionNo)));
  const questionNos = new Set(questions.map(question => String(question.questionNo)));
  const sameText = (left, right) => String(left ?? "").replace(/\s+/g, " ").trim() === String(right ?? "").replace(/\s+/g, " ").trim();
  const sameAnswer = (reference, authoritative) => JSON.stringify(reference) === JSON.stringify(authoritative)
    || Array.isArray(authoritative) && authoritative.every(value => typeof value === "string") && reference === authoritative.join(",");
  if (refNos.size !== refs.length || refs.length !== questionNos.size || questions.some(q => !refNos.has(String(q.questionNo)))
    || refs.some(ref => {
      const authoritative = byNo.get(String(ref.questionNo));
      return !authoritative || !sameText(ref.prompt, authoritative.prompt)
        || !sameAnswer(ref.correctAnswer, authoritative.correctAnswer) || ref.score !== authoritative.maxScore
        || ref.rubric && ref.rubric !== authoritative.rubric
        || ref.context && JSON.stringify(ref.context) !== JSON.stringify(authoritative.context);
    })) return input;
  const projected = { ...input, referenceAnswers: refs.map(ref => {
    const authoritative = byNo.get(String(ref.questionNo));
    return { ...authoritative, ...ref, correctAnswer: authoritative.correctAnswer, rubric: authoritative.rubric,
      ...(ref.analysisSteps && JSON.stringify(ref.analysisSteps) !== JSON.stringify(authoritative.analysisSteps) ? { sourceAnalysisSteps: authoritative.analysisSteps } : {}),
      ...(authoritative.context ? { context: authoritative.context, itemType: authoritative.context.itemType || ref.itemType } : {}) };
  }) };
  // The complete, verified package remains at the service/archive boundary. Only
  // the model request uses this per-question projection; never rehash a subset.
  delete projected.gradingSourcePackage;
  if (Array.isArray(projected.assignmentItems)) projected.assignmentItems = projected.assignmentItems.filter(item => questionNos.has(String(item.questionNo || item.orderIndex)));
  for (const [field, questionField] of [["printedText", "printedText"], ["ocrText", "printedText"], ["studentAnswerText", "studentAnswer"]]) {
    const numbered = questions.map(q => `${q.questionNo}. ${String(q[questionField] || "").trim()}`.trim()).filter(line => !/\.\s*$/.test(line)).join(" ");
    if (projected[field] === numbered) delete projected[field];
  }
  return projected;
}

export async function runSubmissionPipeline(config, task, input, execution, runTask) {
  const selected = pick(input, gradingKeys);
  const safeInput = task === "grading" ? compactVerifiedGradingContext(selected) : selected;
  const questions = safeInput.ocrQuestions || [];
  const printed = present(input.printedText) || questions.some((q) => present(q.printedPrompt || q.printedText));
  const answers = present(input.studentAnswerText) || present(input.manualText) || questions.some((q) => present(q.studentAnswer) || present(q.observedWork));
  const evidenceSufficient = execution.evidenceSufficient !== false && printed && (task === "reference" || answers);
  if (task === "reference") {
    delete safeInput.studentAnswerText;
    delete safeInput.manualText;
    delete safeInput.ocrText;
    safeInput.ocrQuestions = questions.map((q) => pick(q, ["questionNo", "printedPrompt", "printedText", "bbox", "confidence"]));
  }
  const pool = createTeachingOperationBudget(task, config, execution);
  const contract = task === "grading"
    ? "输出 {summary,strengths:string[],mistakes:[],nextPractice,needsTeacherReview:true,questionResults:[{questionNo,status:correct|wrong|partial|uncertain,studentAnswer,correctAnswer,score:number|null,maxScore:number,studentProcess:string[],explanation,errorStep,knowledgePoint,suggestedPractice,confidence,bbox}]}。逐题 score/maxScore 必填；证据不足 score=null。"
    : "只依据印刷题干和可信来源生成参考答案，不使用学生答案推导标准答案。输出 {referenceAnswers:[{questionNo,prompt,correctAnswer,score,analysisSteps:string[],knowledgePoint,confidence}],summary,confidence,needsTeacherReview:true}。证据不足时 correctAnswer=null、confidence=0，并说明缺项。";
  const validate = task === "grading" ? (candidate) => gradingContentIssues(candidate, safeInput) : (candidate) => {
    const refs = candidate.referenceAnswers;
    if (!Array.isArray(refs) || !refs.length || !refs.every((q) => q && present(q.questionNo) && present(q.prompt) && Number.isFinite(q.score) && q.score > 0 && Array.isArray(q.analysisSteps) && q.analysisSteps.length && (present(q.correctAnswer) || q.confidence === 0))) return ["reference_structure_invalid"];
    const expected = new Set(questions.map((q) => String(q.questionNo)));
    const actual = new Set(refs.map((q) => String(q.questionNo)));
    if (actual.size !== refs.length || expected.size && (expected.size !== actual.size || [...actual].some((no) => !expected.has(no)))) return ["reference_alignment_invalid"];
    candidate.needsTeacherReview = true;
    return [];
  };
  const result = await runTeachingPipelineUnit(runTask, config, task, safeInput, { ...execution, evidenceSufficient }, pool, resolveTeachingTaskPolicy(task, config).budget.maxTokens, validate, contract);
  if (execution.signal?.aborted) throw execution.signal.reason || new Error("TEACHING_CANCELLED");
  return runtimeResult(task, input, [{ id: task, result }], result.candidate ? JSON.stringify(result.candidate) : "");
}
