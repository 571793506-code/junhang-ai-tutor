import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { gradeSubmissionService } from "@junhang/services";
import { buildGradingSourcePackage } from "@junhang/core";
import { validateGradingGoldCases, hashQualityEvidence } from "./quality-gold-contract.mjs";

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "deep-audit") {
      values.set(key, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    values.set(key, value);
    index += 1;
  }
  const goldPath = values.get("gold");
  const outputPath = values.get("output");
  if (!goldPath || !outputPath) {
    throw new Error("Usage: node scripts/replay-grading-gold.mjs --gold <gold.json> --output <evaluation.json> [--model <model>] [--deep-audit]");
  }
  const limit = values.get("limit") == null ? null : Number(values.get("limit"));
  const timeoutMs = values.get("timeout-ms") == null ? null : Number(values.get("timeout-ms"));
  const maxQuestions = values.get("max-questions") == null ? null : Number(values.get("max-questions"));
  const maxConsecutiveFailures = values.get("max-consecutive-failures") == null ? 3 : Number(values.get("max-consecutive-failures"));
  if (!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1) throw new Error("--max-consecutive-failures must be a positive integer");
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  if (timeoutMs != null && (!Number.isInteger(timeoutMs) || timeoutMs < 1000)) throw new Error("--timeout-ms must be at least 1000");
  if (maxQuestions != null && (!Number.isInteger(maxQuestions) || maxQuestions < 1)) throw new Error("--max-questions must be a positive integer");
  return {
    goldPath,
    outputPath,
    model: values.get("model") || null,
    limit,
    timeoutMs,
    maxQuestions,
    maxConsecutiveFailures,
    deepAudit: values.get("deep-audit") === true
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

export function buildReplayInput(raw = {}) {
  const clean = (v) => Array.isArray(v) ? v.map(clean) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !/^(expected|actual|teacherReview|evaluationRun|confirmedBy|confirmedAt|reviewedByTeacher|teacherConfirmation)$/i.test(k)).map(([k, x]) => [k, clean(x)])) : v;
  const fields = ["subject", "grade", "kind", "totalScore", "gradingSourcePackage", "questionLayoutManifest", "ocrQuestions", "referenceAnswers", "answerKey", "assignmentItems", "teacherContext"];
  const input = Object.fromEntries(fields.filter((k) => raw[k] !== undefined).map((k) => [k, clean(raw[k])]));
  if (Array.isArray(input.ocrQuestions)) input.ocrQuestions = input.ocrQuestions.map((q) => Object.fromEntries(
    ["questionNo", "printedPrompt", "printedText", "studentAnswer", "confidence", "bbox", "observedWork", "page", "sourceImageRef", "cropRef", "itemType", "type", "context"].filter((k) => q[k] !== undefined).map((k) => [k, q[k]])));
  const sourcePackage = input.gradingSourcePackage;
  const packageQuestions = Array.isArray(sourcePackage?.questions) ? sourcePackage.questions : [];
  if (!packageQuestions.length) return input;
  // Collection redacts identity/text. Rebuild an evaluation-only package; never reuse the original fingerprint or publish it.
  const rebuilt = buildGradingSourcePackage({ id: `quality-${hashQualityEvidence(sourcePackage).slice(7, 23)}`,
    grade: input.grade, subject: { name: input.subject }, kind: input.kind,
    items: packageQuestions.map((q) => {
      const rawContext = q.context ?? q.sourceContext ?? (q.itemType || q.type || q.figure || q.sharedMaterialId ? {} : undefined);
      const context = rawContext && typeof rawContext === "object" && !Array.isArray(rawContext) ? { ...rawContext } : rawContext;
      if (context && typeof context === "object" && !Array.isArray(context)) {
        if (q.itemType || q.type) context.itemType ||= q.itemType || q.type;
        if (q.figure) context.figure ||= q.figure;
        if (q.sharedMaterialId) context.sharedMaterialId ||= q.sharedMaterialId;
      }
      return { orderIndex: q.questionNo, prompt: q.prompt, answer: q.correctAnswer,
        score: q.maxScore, analysisSteps: q.analysisSteps, knowledgePoint: q.knowledgePoint, rubric: q.rubric,
        ...(context !== undefined ? { sourceContext: context } : {}) };
    }) });
  if (!rebuilt.package) throw new Error("QUALITY_SOURCE_PACKAGE_INVALID");
  return {
    ...input,
    gradingSourcePackage: rebuilt.package,
    totalScore: rebuilt.package.totalScore,
    assignmentItems: Array.isArray(input.assignmentItems) && input.assignmentItems.length
      ? input.assignmentItems
      : rebuilt.package.questions.map((question) => ({
          questionNo: question.questionNo,
          prompt: question.prompt,
          answer: question.correctAnswer,
          rubric: question.rubric,
          score: question.maxScore,
          ...(question.context?.itemType ? { itemType: question.context.itemType } : {}),
          metadata: {
            analysisSteps: question.analysisSteps,
            knowledgePoint: question.knowledgePoint,
            ...(question.context ? { sourceContext: question.context } : {})
          }
        })),
    answerKey: input.answerKey || Object.fromEntries(
      packageQuestions.map((question) => [question.questionNo, question.correctAnswer])
    )
  };
}

const isConfirmationSummary = (value) => typeof value === "string" && /^\s*(?:教师|老师)(?:已)?(?:复核)?确认(?:学生)?(?:作答|答案|解答|选择|此题|本题)(?:正确|无误|错误|有误)[。.!！\s]*$/.test(value);

export function summarizeGradingEvidence(input = {}) {
  const sourceQuestions = Array.isArray(input.gradingSourcePackage?.questions) ? input.gradingSourcePackage.questions : [];
  const ocrQuestions = Array.isArray(input.ocrQuestions) ? input.ocrQuestions : [];
  const layoutQuestions = Array.isArray(input.questionLayoutManifest?.questions) ? input.questionLayoutManifest.questions : [];
  const sourceContextCount = sourceQuestions.filter((question) => question?.context || question?.sourceContext).length;
  const questionTypeCount = sourceQuestions.filter((question) => question?.itemType || question?.type || question?.context?.itemType).length;
  const observedWorkCount = ocrQuestions.filter((question) => question?.observedWork != null && String(question.observedWork).trim()).length;
  const confidenceCount = ocrQuestions.filter((question) => typeof question?.confidence === "number" && Number.isFinite(question.confidence)).length;
  const summaryAnswerCount = ocrQuestions.filter((question) => isConfirmationSummary(question?.studentAnswer)).length;
  const geometryCount = ocrQuestions.filter((question) => question?.bbox || question?.pageRegion).length;
  const layoutTypeCount = layoutQuestions.filter((question) => question?.itemType || question?.type || question?.context?.itemType).length;
  const missing = [];
  if (sourceQuestions.length && sourceContextCount === 0) missing.push("source_context");
  if (sourceQuestions.length && questionTypeCount === 0) missing.push("question_type");
  if (ocrQuestions.length && observedWorkCount === 0) missing.push("observed_work");
  if (ocrQuestions.length && geometryCount === 0) missing.push("recognition_geometry");
  if (layoutQuestions.length && layoutTypeCount === 0) missing.push("layout_question_type");
  return {
    sourceQuestionCount: sourceQuestions.length,
    sourceContextCount,
    questionTypeCount,
    ocrQuestionCount: ocrQuestions.length,
    observedWorkCount,
    confidenceCount,
    summaryAnswerCount,
    geometryCount,
    layoutQuestionCount: layoutQuestions.length,
    layoutTypeCount,
    missing
  };
}

function classifyReplayFailure(result = null, error = null) {
  if (!error && result?.available === true && result.usedDynamicFallback !== true && result.structured?.questionResults?.length) return null;
  const attempts = Array.isArray(result?.modelRun?.metadata?.attempts) ? result.modelRun.metadata.attempts : [];
  const lastAttempt = attempts.at(-1);
  const text = `${error?.code || ""} ${error?.status || ""} ${error?.message || error || ""} ${result?.error || ""}`;
  if (["TEACHING_DEADLINE", "MODEL_TIMEOUT"].includes(lastAttempt?.failureCode) || /TEACHING_DEADLINE|MODEL_TIMEOUT|\btimeout\b/i.test(text)) return "timeout";
  const triggerClass = attempts.findLast((attempt) => attempt?.triggerClass)?.triggerClass;
  if (triggerClass === "evidence") return "evidence_insufficient";
  if (triggerClass === "configuration") return "configuration";
  if (triggerClass === "availability") return "availability";
  if (triggerClass === "quality") return "quality_invalid_output";
  if (/TEACHING_BUDGET_EXHAUSTED/.test(text)) return "budget_exhausted";
  if (/evidence|reference|ocr|student[_ -]?answer|source[_ -]?package|content[_ -]?context/i.test(text)) return "evidence_insufficient";
  if (/401|403|invalid[_ -]?(api[_ -]?)?key|model[_ -]?not[_ -]?found|quota|configuration|not configured/i.test(text)) return "configuration";
  if (/availability|timeout|network|rate[_ -]?limit|capacity|concurr|429|5\d\d|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(text)) return "availability";
  if (/json|schema|structure|malformed|quality|parse|invalid[_ -]?output/i.test(text)) return "quality_invalid_output";
  if (error) return "runner_error";
  if (!result || result.available !== true) return "model_unavailable";
  if (result.usedDynamicFallback === true) return "dynamic_fallback";
  if (!Array.isArray(result.structured?.questionResults) || !result.structured.questionResults.length) return "empty_results";
  return null;
}

function trimSample(sample, maxQuestions) {
  if (!maxQuestions) return sample;
  const input = sample.input || {};
  const sourcePackage = input.gradingSourcePackage || {};
  const packageQuestions = Array.isArray(sourcePackage.questions) ? sourcePackage.questions.slice(0, maxQuestions) : [];
  const questionNos = new Set(packageQuestions.map((question) => String(question.questionNo || "")));
  const trimByQuestionNo = (questions) => (Array.isArray(questions) ? questions : [])
    .filter((question, index) => !packageQuestions.length || questionNos.has(String(question.questionNo || index + 1)))
    .slice(0, maxQuestions);
  const answerKey = input.answerKey && typeof input.answerKey === "object"
    ? Object.fromEntries(Object.entries(input.answerKey).filter(([questionNo]) => questionNos.has(String(questionNo))))
    : input.answerKey;
  return {
    ...sample,
    expected: {
      ...sample.expected,
      score: trimByQuestionNo(sample.expected?.questionResults).every((q) => typeof q.score === "number")
        ? trimByQuestionNo(sample.expected?.questionResults).reduce((sum, q) => sum + q.score, 0) : null,
      questionResults: trimByQuestionNo(sample.expected?.questionResults)
    },
    input: {
      ...input,
      gradingSourcePackage: packageQuestions.length ? { ...sourcePackage, questions: packageQuestions } : sourcePackage,
      questionLayoutManifest: input.questionLayoutManifest
        ? { ...input.questionLayoutManifest, questions: trimByQuestionNo(input.questionLayoutManifest.questions) }
        : input.questionLayoutManifest,
      ocrQuestions: trimByQuestionNo(input.ocrQuestions),
      assignmentItems: trimByQuestionNo(input.assignmentItems),
      answerKey
    }
  };
}

function projectActual(result) {
  const structured = result?.structured || {};
  const quality = structured.quality || {};
  return {
    available: result?.available === true,
    usedDynamicFallback: result?.usedDynamicFallback === true,
    score: structured.score ?? null,
    provisionalScore: structured.provisionalScore ?? null,
    needsTeacherReview: structured.needsTeacherReview === true,
    reviewStatus: structured.reviewStatus || null,
    quality: {
      lowConfidence: quality.lowConfidence === true,
      archiveEligible: quality.archiveEligible === true,
      referenceAnswerMode: quality.referenceAnswerMode || null,
      hasAnswerKey: quality.hasAnswerKey === true,
      hasLayoutAnswerKey: quality.hasLayoutAnswerKey === true,
      hasGeneratedReference: quality.hasGeneratedReference === true,
      hasReferenceEvidence: quality.hasReferenceEvidence === true,
      hasRecognitionEvidence: quality.hasRecognitionEvidence === true,
      provisionalScore: quality.provisionalScore ?? null,
      finalScore: quality.finalScore ?? null,
      uncertainCount: quality.uncertainCount ?? null,
      totalQuestions: quality.totalQuestions ?? null,
      uncertainRatio: quality.uncertainRatio ?? null,
      averageConfidence: quality.averageConfidence ?? null,
      scoreMismatch: quality.scoreMismatch === true,
      auditBlocked: quality.auditBlocked === true,
      secondModelAudit: quality.secondModelAudit
        ? {
            required: quality.secondModelAudit.required === true,
            available: quality.secondModelAudit.available === true,
            status: quality.secondModelAudit.status || null,
            riskLevel: quality.secondModelAudit.riskLevel || null,
            scoreReliable: quality.secondModelAudit.scoreReliable === true,
            archiveAllowed: quality.secondModelAudit.archiveAllowed === true,
            issues: Array.isArray(quality.secondModelAudit.issues) ? quality.secondModelAudit.issues : [],
            suggestions: Array.isArray(quality.secondModelAudit.suggestions) ? quality.secondModelAudit.suggestions : []
          }
        : null
    },
    questionResults: Array.isArray(structured.questionResults)
      ? structured.questionResults.map((question) => ({
          questionNo: question.questionNo || null,
          status: question.status || "uncertain",
          studentAnswer: question.studentAnswer ?? null,
          correctAnswer: question.correctAnswer ?? null,
          score: question.score ?? null,
          maxScore: question.maxScore ?? null,
          confidence: question.confidence ?? null,
          knowledgePoint: question.knowledgePoint || null,
          errorStep: question.errorStep || null,
          explanation: question.explanation || null,
          bbox: question.bbox || null
        }))
      : []
  };
}

function projectRun(result, startedAt, error = null) {
  const structured = result?.structured || {};
  return {
    available: result?.available === true,
    elapsedMs: Date.now() - startedAt,
    questionCount: Array.isArray(structured.questionResults) ? structured.questionResults.length : 0,
    needsTeacherReview: structured.needsTeacherReview === true,
    reviewStatus: structured.reviewStatus || null,
    lowConfidence: structured.quality?.lowConfidence === true,
    auditStatus: structured.gradingAudit?.status || null,
    usedModelEscalation: result?.usedModelEscalation === true,
    solAttempted: result?.solAttempted === true,
    failureReason: classifyReplayFailure(result, error)
  };
}

export async function replayGradingGoldCases(cases = [], config = process.env, options = {}) {
  if (!Array.isArray(cases) || !cases.length) throw new Error("GOLD_CASES_INVALID: cases must not be empty");
  const checked = validateGradingGoldCases(cases);
  if (!checked.ok) throw new Error(`GOLD_CASES_INVALID: ${checked.issues.join("; ")}`);
  const selectedCases = checked.normalizedCases.map((sample) => trimSample(sample, options.maxQuestions));
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
  if (!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1) throw new Error("maxConsecutiveFailures must be a positive integer");
  const runnerConfig = { ...config, ...(options.model ? { GPT56_MODEL: options.model, TEACHING_PRIMARY_MODEL: options.model, GPT56_SOL_FALLBACK_ENABLED: "false" } : {}) };
  const grade = options.grade || gradeSubmissionService;
  const runId = randomUUID();
  const actualCases = [];
  const runs = [];
  let consecutiveFailures = 0;
  let stopReason = null;
  for (const [index, sample] of selectedCases.entries()) {
    options.progress?.({ phase: "start", index: index + 1, total: selectedCases.length, caseId: sample.caseId });
    const startedAt = Date.now();
    let input = sample.input;
    const evidence = (actual, result, error = null) => ({ schemaVersion: "grading-evaluation-run-v1", runId, caseId: sample.caseId, sourceCaseCount: selectedCases.length,
      runner: "gradeSubmissionService", executionMode: options.grade ? "synthetic" : "live", scope: "grading-text", persist: false,
      startedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt,
      inputHash: hashQualityEvidence(input), actualHash: hashQualityEvidence(actual),
      status: actual.available && !actual.usedDynamicFallback && actual.questionResults.length ? "completed" : "failed",
      failureReason: classifyReplayFailure(result, error),
      evidenceCoverage: summarizeGradingEvidence(input),
      ruleVersions: result?.modelRun?.metadata?.rules || [], attempts: result?.modelRun?.metadata?.attempts || [],
      usage: result?.modelRun?.usage || null, cost: null });
    try {
      input = buildReplayInput(sample.input);
      if (summarizeGradingEvidence(input).summaryAnswerCount > 0) {
        throw Object.assign(new Error("Original student answer required for independent replay"), { code: "REPLAY_STUDENT_ANSWER_EVIDENCE_MISSING" });
      }
      const result = await grade(runnerConfig, input, {
        persist: false,
        runDeepGradingAudit: options.deepAudit === true,
        teachingExecution: { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.model ? { disableSolEscalation: true } : {}) }
      });
      actualCases.push({
        ...sample,
        input,
        actual: projectActual(result),
        evaluationRun: evidence(projectActual(result), result)
      });
      runs.push({ caseId: sample.caseId, ...projectRun(result, startedAt) });
      options.progress?.({ phase: "done", index: index + 1, total: selectedCases.length, caseId: sample.caseId, run: runs.at(-1) });
    } catch (error) {
      actualCases.push({
        ...sample,
        input,
        actual: {
          available: false,
          usedDynamicFallback: false,
          score: null,
          needsTeacherReview: true,
          reviewStatus: "replay_failed",
          quality: { lowConfidence: true },
          questionResults: []
        }
      });
      actualCases.at(-1).evaluationRun = evidence(actualCases.at(-1).actual, null, error);
      runs.push({ caseId: sample.caseId, ...projectRun(null, startedAt, error) });
      options.progress?.({ phase: "failed", index: index + 1, total: selectedCases.length, caseId: sample.caseId, run: runs.at(-1) });
    }
    // Save each completed case before continuing. Storage errors must abort outside the model error handler.
    await options.checkpoint?.({ sample: actualCases.at(-1), run: runs.at(-1) });
    consecutiveFailures = actualCases.at(-1).evaluationRun.status === "completed" ? 0 : consecutiveFailures + 1;
    if (consecutiveFailures >= maxConsecutiveFailures && actualCases.length < selectedCases.length) {
      stopReason = "CONSECUTIVE_FAILURE_LIMIT";
      break;
    }
  }
  return {
    schemaVersion: "grading-gold-replay-v1",
    generatedAt: new Date().toISOString(),
    sourceCaseCount: selectedCases.length,
    deepAudit: options.deepAudit === true,
    modelOverride: options.model || null,
    completed: actualCases.length === selectedCases.length,
    stopReason,
    remainingCaseIds: selectedCases.slice(actualCases.length).map((sample) => sample.caseId),
    cases: actualCases,
    runs
  };
}

async function runCli() {
  const { goldPath, outputPath, model, limit, timeoutMs, maxQuestions, maxConsecutiveFailures, deepAudit } = parseArgs(process.argv.slice(2));
  const checkpointPath = path.resolve(`${outputPath}.progress.jsonl`);
  if (path.resolve(goldPath) === path.resolve(outputPath) || fs.existsSync(path.resolve(outputPath)) || fs.existsSync(path.resolve(`${outputPath}.run.json`)) || fs.existsSync(checkpointPath)) throw new Error("Choose a new output path; gold and previous evaluations are immutable.");
  const gold = readJson(goldPath);
  const allCases = Array.isArray(gold) ? gold : gold.cases;
  const cases = limit ? allCases.slice(0, limit) : allCases;
  const config = {
    ...process.env,
    ...(model ? { GPT56_MODEL: model, TEACHING_PRIMARY_MODEL: model } : {}),
    ...(model ? { GPT56_SOL_FALLBACK_ENABLED: "false" } : {}),
    ...(timeoutMs ? {
      GPT56_GRADING_TIMEOUT_MS: String(timeoutMs),
      GPT56_REVIEW_TIMEOUT_MS: String(timeoutMs),
      GPT56_ASSESSMENT_TIMEOUT_MS: String(timeoutMs),
      GPT56_SOL_FALLBACK_TIMEOUT_MS: String(timeoutMs)
    } : {})
  };
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const checkpointFd = fs.openSync(checkpointPath, "wx");
  let evaluation;
  try { evaluation = await replayGradingGoldCases(cases, config, {
    deepAudit,
    model,
    timeoutMs,
    maxQuestions,
    maxConsecutiveFailures,
    checkpoint: (entry) => { fs.writeSync(checkpointFd, `${JSON.stringify(entry)}\n`); fs.fsyncSync(checkpointFd); },
    progress: (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
  }); } finally { fs.closeSync(checkpointFd); }
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(evaluation.cases, null, 2)}\n`, "utf8");
  const runReportPath = `${resolvedOutputPath}.run.json`;
  fs.writeFileSync(runReportPath, `${JSON.stringify({
    schemaVersion: evaluation.schemaVersion,
    generatedAt: evaluation.generatedAt,
    sourceCaseCount: evaluation.sourceCaseCount,
    modelOverride: evaluation.modelOverride,
    deepAudit: evaluation.deepAudit,
    completed: evaluation.completed,
    stopReason: evaluation.stopReason,
    remainingCaseIds: evaluation.remainingCaseIds,
    runs: evaluation.runs
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    schemaVersion: evaluation.schemaVersion,
    generatedAt: evaluation.generatedAt,
    sourceCaseCount: evaluation.sourceCaseCount,
    modelOverride: evaluation.modelOverride,
    outputPath: resolvedOutputPath,
    runReportPath,
    runs: evaluation.runs
  }, null, 2)}\n`);
  if (!evaluation.completed || evaluation.cases.some((sample) => sample.evaluationRun.status !== "completed")) process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
