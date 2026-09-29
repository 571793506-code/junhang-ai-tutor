import { isDeepStrictEqual } from "node:util";
import { buildGradingSourcePackage, normalizeGradeLevel, normalizeTeachingPurpose, teachingExplanationContent } from "@junhang/core";
import { runTeachingTask } from "@junhang/ai";
import { buildGenerationContext, createTeachingWorkflowValidator, draftAssessmentService, gradeSubmissionService } from "@junhang/services";
import { publicUploadUrl } from "./uploads.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, structuredClone(value[key])]));
const REQUEST_KEYS = ["title", "subject", "grade", "targetGrade", "kind", "purpose", "requirement", "difficulty", "contentScope", "studentId", "targetScope", "assignmentId", "submissionId", "textbookAssetId", "textbookChapterId", "knowledgePoints", "requestedItemCount", "requestedItemTypes", "dayPlan"];
const QUESTION_KEYS = ["id", "questionNo", "itemType", "prompt", "printedPrompt", "answer", "studentAnswer", "correctAnswer", "score", "maxScore", "status", "rubric", "analysisSteps", "knowledgePoint", "commonMistake", "explanation", "errorStep", "suggestedPractice", "teacherNote", "options", "figure", "answerFormat", "dayId", "sharedMaterialId", "bbox", "confidence"];
function fail(code) { throw Object.assign(new Error(code), { code }); }
function checkSignal(signal) { if (signal?.aborted) fail("WORKFLOW_CANCELLED"); }
function gradingBinding(context, snapshot) {
  return context?.ok === true && isDeepStrictEqual(context.archiveEvidence, snapshot?.archiveEvidence) &&
    context.sourcePackage?.fingerprint === snapshot?.gradingSourcePackage?.fingerprint;
}

function generationEvidenceMatches(saved, current) {
  return isDeepStrictEqual(saved?.teaching, current.teaching) &&
    isDeepStrictEqual(saved?.target, current.target) &&
    isDeepStrictEqual(saved?.studentSignals, current.studentSignals);
}

function gradingPages(context) {
  const content = context.submission.content || {};
  const packet = context.archiveEvidence.externalGradingRecognition;
  const pages = packet?.pages || (content.imageFiles || []).map((file, i) => ({ ...file, pageNumber: i + 1,
    imageUrl: file.url || (file.relativePath || file.fileName ? publicUploadUrl(file.relativePath || file.fileName, null) : null),
    quality: content.ocr?.imageQuality?.pages?.[i] || content.imageQuality?.pages?.[i] }));
  return pages.map((page, i) => ({ pageNumber: page.pageNumber || i + 1, imageUrl: page.imageUrl || null, fileName: page.fileName || "",
    imageRefs: [page.sourceImageRef, page.id, page.fileName, page.imageUrl].filter(text), cropRef: page.cropRef || null,
    qualityStatus: page.quality?.status || page.quality?.qualityStatus || "unknown" }));
}

function recognitionCorrected(q, actor) {
  return q.studentAnswerReview?.actorTeacherId === actor.teacherId && isDeepStrictEqual(q.studentAnswerReview?.studentAnswer, q.studentAnswer);
}

function generationSnapshot(result, input) {
  const auditPassed = result.audit?.status === "passed" || result.audit?.passed === true;
  if (result.modelAvailable !== true || result.usedDynamicFallback === true || !auditPassed) fail("WORKFLOW_SNAPSHOT_INVALID");
  const sharedMaterials = [];
  const groups = new Map();
  const questions = (result.draftItems || []).map((item, index) => {
    const q = pick({ ...item.metadata, ...item }, QUESTION_KEYS);
    q.id = `q${index + 1}`; q.questionNo = String(index + 1);
    const metadata = item.metadata || {};
    if (text(metadata.passageText)) {
      const key = JSON.stringify([q.dayId || null, metadata.passageGroupId || metadata.passageText]);
      if (!groups.has(key)) {
        const material = { id: `m${groups.size + 1}`, title: metadata.passageTitle || "", text: metadata.passageText };
        groups.set(key, material); sharedMaterials.push(material);
      }
      if (groups.get(key).text !== metadata.passageText) fail("WORKFLOW_SNAPSHOT_INVALID");
      q.sharedMaterialId = groups.get(key).id;
    }
    return q;
  });
  return { title: result.parsedDraft?.title || input.title || input.requirement, subject: input.subject, grade: input.grade || input.targetGrade,
    kind: input.kind, purpose: input.purpose, questions, sharedMaterials,
    days: (input.dayPlan || []).map((day) => ({ dayId: day.dayId, goal: day.goal, questionCount: day.requestedItemCount })),
    ...(input.purpose === "explanation" ? { explanation: structuredClone(result.parsedDraft.explanation) } : { totalScore: result.totalScore }),
    ...(result.printProfile ? { printProfile: structuredClone(result.printProfile) } : {}),
    generationContext: result.generationContext, ruleVersions: result.modelRun?.metadata?.rules || [] };
}

function gradeInput(context, request) {
  const content = context.submission.content || {};
  const packet = context.archiveEvidence.externalGradingRecognition;
  const observed = packet ? packet.pages?.flatMap((page) => page?.questions || []) : content.ocr?.questions || content.ocrQuestions;
  if (!Array.isArray(observed) || !observed.length || observed.some((q) => !text(q?.questionNo))) fail("WORKFLOW_REQUEST_INCOMPLETE");
  if (new Set(observed.map((q) => q.questionNo)).size !== observed.length) fail("WORKFLOW_REQUEST_INCOMPLETE");
  const byNo = new Map(observed.map((q) => [q.questionNo, q]));
  const ocrQuestions = context.sourcePackage.questions.map((ref) => {
    const q = byNo.get(ref.questionNo);
    return { questionNo: ref.questionNo, printedPrompt: q?.printedPrompt || q?.printedText || ref.prompt,
      studentAnswer: q?.studentAnswer ?? q?.studentAnswerText ?? null,
      confidence: q && Object.hasOwn(q, "confidence") ? q.confidence ?? null : q?.recognitionConfidence ?? null,
      itemType: ref.context?.itemType,
      ...pick(q, ["bbox", "page", "sourceImageRef", "cropRef", "observedWork"]) };
  });
  return { title: request.title || "批改草稿", subject: context.subject, grade: context.sourcePackage.grade || request.grade,
    gradingSourcePackage: context.sourcePackage, totalScore: context.sourcePackage.totalScore, ocrQuestions,
    imageQuality: content.imageQuality || content.ocr?.imageQuality,
    referenceAnswers: context.sourcePackage.questions.map((q) => ({ questionNo: q.questionNo, prompt: q.prompt, correctAnswer: q.correctAnswer,
      score: q.maxScore, knowledgePoint: q.knowledgePoint, analysisSteps: q.analysisSteps, itemType: q.context?.itemType, confidence: 1 })),
    teacherContext: request.requirement || "" };
}

// Only server resolvers may supply context. Both domain services run persist:false;
// the workflow service alone appends validated, immutable revisions.
export function createTeachingWorkflowExecution({ config = {}, resolveGenerationInput, resolveGradingContext,
  generate = draftAssessmentService, grade = gradeSubmissionService, revise = runTeachingTask, teachingExecution = {} }) {
  const resolveGeneration = async (actor, raw) => {
    const request = pick(raw, REQUEST_KEYS);
    if (!text(actor?.teacherId) || !text(request.requirement) || !text(request.subject) ||
      (!request.studentId && !text(request.grade || request.targetGrade)) ||
      (request.purpose !== "explanation" && !["小测", "练习", "试卷"].includes(request.kind))) fail("WORKFLOW_REQUEST_INCOMPLETE");
    if (request.targetScope && !["student", "grade"].includes(request.targetScope) || request.targetScope === "student" && !text(request.studentId) ||
      request.targetScope === "grade" && request.studentId) fail("WORKFLOW_INPUT_INVALID");
    if (request.requestedItemCount !== undefined && (!Number.isSafeInteger(request.requestedItemCount) || request.requestedItemCount < 1 || request.requestedItemCount > 100)) fail("WORKFLOW_INPUT_INVALID");
    try { Object.assign(request, normalizeTeachingPurpose(request)); } catch { fail("WORKFLOW_INPUT_INVALID"); }
    if (typeof resolveGenerationInput !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE");
    const resolved = await resolveGenerationInput({ actor, request });
    if (!resolved?.ok || !resolved.input) fail("WORKFLOW_CONTEXT_REQUIRED");
    const level = normalizeGradeLevel(resolved.input.grade || resolved.input.targetGrade);
    if (!level || level.level < 3 || level.level > 7 || level.level === 7 && resolved.input.subject !== "数学") fail("WORKFLOW_REQUEST_INCOMPLETE");
    return { ...resolved.input, teacherId: actor.teacherId, grade: level.label };
  };
  const resolveGrading = async (actor, request) => {
    if (!text(actor?.teacherId) || !text(request?.studentId) || !text(request?.submissionId)) fail("WORKFLOW_REQUEST_INCOMPLETE");
    if (typeof resolveGradingContext !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE");
    const result = await resolveGradingContext({ actor, request: pick(request, REQUEST_KEYS) });
    if (!result?.ok) fail("WORKFLOW_CONTEXT_REQUIRED");
    return result;
  };
  const validateSnapshot = async (snapshot, context) => {
    let source = null;
    if (context.module === "grading") {
      const resolved = await resolveGrading(context.actor, context.request);
      if (!gradingBinding(resolved, snapshot)) return { ok: false, issues: [{ code: "WORKFLOW_EVIDENCE_CHANGED" }] };
      source = resolved.sourcePackage;
    } else {
      const input = await resolveGeneration(context.actor, context.request);
      const { generationContext } = buildGenerationContext(input, { contentContext: input.contentContext, studentSignals: input.studentSignals });
      if (!generationEvidenceMatches(snapshot.generationContext, generationContext)) {
        return { ok: false, issues: [{ code: "WORKFLOW_EVIDENCE_CHANGED" }] };
      }
      const questions = snapshot.questions || [];
      if (input.purpose === "focused" && (questions.some((q) => !input.requestedItemTypes.includes(q.itemType)) ||
        input.requestedItemCount != null && questions.length !== input.requestedItemCount)) return { ok: false, issues: [{ code: "GENERATION_PURPOSE_INVALID" }] };
      if (input.purpose === "multi_day" && (questions.some((q) => !input.dayPlan.some((d) => d.dayId === q.dayId && d.requestedItemTypes.includes(q.itemType))) ||
        input.dayPlan.some((d) => questions.filter((q) => q.dayId === d.dayId).length !== d.requestedItemCount))) return { ok: false, issues: [{ code: "GENERATION_PURPOSE_INVALID" }] };
    }
    return createTeachingWorkflowValidator({ resolveGradingSource: async () => source })(snapshot, context);
  };
  return {
    validateSnapshot,
    async createDraft({ actor, input, workflow, signal }) {
      checkSignal(signal);
      if (input.module === "generation") {
        const request = await resolveGeneration(actor, input.request);
        checkSignal(signal);
        const result = await generate(config, { ...request, requestId: workflow.id, createAssignment: false },
          { persist: false, signal, teachingExecution: { ...teachingExecution, requireRubric: true } });
        checkSignal(signal);
        return { request: pick(request, REQUEST_KEYS), snapshot: generationSnapshot(result, request) };
      }
      const context = await resolveGrading(actor, input.request);
      checkSignal(signal);
      const archive = context.submission.content?.workflowArchive;
      if (archive) return { request: pick({ ...input.request, subject: archive.snapshot.subject, grade: archive.snapshot.grade }, REQUEST_KEYS), snapshot: structuredClone(archive.snapshot) };
      const prepared = gradeInput(context, input.request);
      const result = await grade(config, prepared, { persist: false, signal, teachingExecution });
      checkSignal(signal);
      if (result.available !== true || !Array.isArray(result.structured?.questionResults)) fail("WORKFLOW_EXECUTION_FAILED");
      const byNo = new Map(result.structured.questionResults.map((q) => [String(q.questionNo), q]));
      const snapshot = { title: prepared.title, subject: prepared.subject, grade: prepared.grade,
        gradingSourcePackage: structuredClone(context.sourcePackage), archiveEvidence: structuredClone(context.archiveEvidence),
        pages: gradingPages(context), questions: prepared.ocrQuestions.map((observed, index) => {
          const ref = context.sourcePackage.questions[index];
          const q = pick(byNo.get(ref.questionNo), QUESTION_KEYS);
          return { ...q, id: `q${index + 1}`, questionNo: ref.questionNo, printedPrompt: observed.printedPrompt,
            studentAnswer: observed.studentAnswer, correctAnswer: ref.correctAnswer, maxScore: ref.maxScore,
            itemType: ref.context?.itemType,
            knowledgePoint: q.knowledgePoint || ref.knowledgePoint, rubric: ref.rubric, analysisSteps: ref.analysisSteps,
            ...pick(observed, ["bbox", "confidence", "page", "sourceImageRef", "cropRef", "observedWork"]) };
        }), ruleVersions: result.modelRun?.metadata?.rules || [] };
      return { request: pick({ ...input.request, subject: prepared.subject, grade: prepared.grade }, REQUEST_KEYS), snapshot, subjectRef: context.assignmentId };
    },
    async runner({ actor, workflow, request, evidence, questions, explanation, context, instruction, signal }) {
      checkSignal(signal);
      let source = null; let generationContext;
      if (workflow.module === "grading") {
        const resolved = await resolveGrading(actor, request);
        if (!gradingBinding(resolved, { archiveEvidence: evidence.archiveEvidence, gradingSourcePackage: { fingerprint: evidence.archiveEvidence?.sourceFingerprint } })) fail("WORKFLOW_EVIDENCE_CHANGED");
        const nos = new Set(questions.map((q) => q.questionNo));
        const refs = resolved.sourcePackage.questions.filter((q) => nos.has(q.questionNo));
        if (refs.length !== questions.length || questions.some((q) => q.studentAnswer == null || !recognitionCorrected(q, actor) && q.confidence != null && (!Number.isFinite(q.confidence) || q.confidence < 0.62))) fail("WORKFLOW_REQUEST_INCOMPLETE");
        source = buildGradingSourcePackage({ id: resolved.sourcePackage.sourceId, grade: resolved.sourcePackage.grade,
          subject: { name: resolved.subject }, items: refs.map((q) => ({ ...q, orderIndex: q.questionNo, answer: q.correctAnswer, score: q.maxScore, sourceContext: q.context })) }).package;
        if (!source) fail("WORKFLOW_CONTEXT_REQUIRED");
        const result = await grade(config, { subject: resolved.subject, grade: source.grade || request.grade, totalScore: source.totalScore,
          gradingSourcePackage: source, teacherContext: instruction,
          // Effective confidence applies only to teacher-corrected input; keep the measured OCR confidence in the saved question.
          ocrQuestions: questions.map((q) => ({ ...pick(q, ["questionNo", "printedPrompt", "studentAnswer", "bbox", "observedWork", "page", "sourceImageRef", "cropRef"]),
            itemType: refs.find((ref) => ref.questionNo === q.questionNo)?.context?.itemType,
            confidence: recognitionCorrected(q, actor) ? 1 : q.confidence ?? null })),
          referenceAnswers: refs.map((q) => ({ questionNo: q.questionNo, prompt: q.prompt, correctAnswer: q.correctAnswer, score: q.maxScore,
            knowledgePoint: q.knowledgePoint, analysisSteps: q.analysisSteps, itemType: q.context?.itemType, confidence: 1 }))
        }, { persist: false, signal, teachingExecution });
        checkSignal(signal);
        if (result.available !== true || !Array.isArray(result.structured?.questionResults)) fail("WORKFLOW_EXECUTION_FAILED");
        const byNo = new Map(result.structured.questionResults.map((q) => [String(q.questionNo), q]));
        if (byNo.size !== questions.length || result.structured.questionResults.length !== questions.length || questions.some((q) => !byNo.has(q.questionNo)) ||
          result.structured.questionResults.some((q) => !text(q.status) || !text(q.explanation) || !Object.hasOwn(q, "score") || !Object.hasOwn(q, "maxScore"))) fail("WORKFLOW_EXECUTION_FAILED");
        return { questions: questions.map((q) => {
          const next = pick(byNo.get(q.questionNo), QUESTION_KEYS);
          return { ...pick(q, QUESTION_KEYS), ...next, ...pick(q, ["id", "questionNo", "dayId", "sharedMaterialId", "studentAnswer", "printedPrompt", "bbox", "confidence", "page", "sourceImageRef", "cropRef", "observedWork", "studentAnswerReview"]),
            knowledgePoint: next.knowledgePoint || q.knowledgePoint };
        }) };
      } else {
        const resolved = await resolveGeneration(actor, request);
        generationContext = buildGenerationContext(resolved, { contentContext: resolved.contentContext, studentSignals: resolved.studentSignals }).generationContext;
        if (!generationEvidenceMatches(evidence.generationContext, generationContext)) fail("WORKFLOW_EVIDENCE_CHANGED");
      }
      const base = { title: request.title || request.requirement || "局部修订", subject: generationContext.target.subject,
        grade: generationContext.target.grade, purpose: request.purpose || "comprehensive", ...context };
      const validate = createTeachingWorkflowValidator();
      if (base.purpose === "explanation") {
        const result = await revise(config, "generation", { subject: base.subject, grade: base.grade, purpose: "explanation", instruction,
          explanation: teachingExplanationContent(explanation), generationContext }, {
          ...teachingExecution, signal,
          outputContract: "只返回 JSON {explanation:{concept,steps:string[],workedExamples:[{prompt,answer,analysisSteps:string[]}],commonMistakes:string[]}}。按教师要求修改讲解，保留未要求改变的内容。不要输出试卷题目、分数、答案包、教师确认或发布字段。",
          repairIssues: async (candidate) => {
            const checked = await validate({ ...base, explanation: candidate?.explanation }, { actor, module: "generation", workflow, request, nextRevision: workflow.revision + 1 });
            return checked.ok ? [] : checked.issues.map((issue) => issue.code);
          }
        });
        checkSignal(signal);
        if (result.status !== "success") fail("WORKFLOW_EXECUTION_FAILED");
        return { explanation: teachingExplanationContent(result.candidate.explanation) };
      }
      const result = await revise(config, workflow.module, { subject: base.subject, grade: base.grade, instruction, questions: questions.map((q) => pick(q, QUESTION_KEYS)), context,
        generationContext }, {
        ...teachingExecution, signal,
        outputContract: "只返回 JSON {questions:[完整修订题目]}。保持每题 id、questionNo、dayId、sharedMaterialId，不能增删题目。保留题型、题干、答案、score、rubric、analysisSteps、knowledgePoint、commonMistake、选项和图形。不得写教师确认或归档字段。",
        repairIssues: async (candidate) => {
          if (!Array.isArray(candidate?.questions) || candidate.questions.length !== questions.length || candidate.questions.some((q) => !q ||
            !questions.some((old) => ["id", "questionNo", "dayId", "sharedMaterialId"].every((key) => (old[key] ?? null) === (q[key] ?? null))))) return ["WORKFLOW_RUNNER_SCOPE_INVALID"];
          const checked = await validate({ ...base, questions: candidate.questions }, { actor, module: workflow.module, workflow, request, nextRevision: workflow.revision + 1 });
          return checked.ok ? [] : checked.issues.map((issue) => issue.code);
        }
      });
      checkSignal(signal);
      if (result.status !== "success") fail("WORKFLOW_EXECUTION_FAILED");
      return { questions: result.candidate.questions.map((q) => pick(q, QUESTION_KEYS)) };
    }
  };
}
