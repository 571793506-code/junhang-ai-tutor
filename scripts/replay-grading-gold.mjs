import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gradeSubmissionService } from "@junhang/services";

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
    deepAudit: values.get("deep-audit") === true
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function buildReplayInput(input = {}) {
  const sourcePackage = input.gradingSourcePackage;
  const packageQuestions = Array.isArray(sourcePackage?.questions) ? sourcePackage.questions : [];
  if (!packageQuestions.length) return input;
  return {
    ...input,
    assignmentItems: Array.isArray(input.assignmentItems) && input.assignmentItems.length
      ? input.assignmentItems
      : packageQuestions.map((question) => ({
          questionNo: question.questionNo,
          prompt: question.prompt,
          answer: question.correctAnswer,
          rubric: question.rubric,
          score: question.maxScore,
          metadata: {
            analysisSteps: question.analysisSteps,
            knowledgePoint: question.knowledgePoint
          }
        })),
    answerKey: input.answerKey || Object.fromEntries(
      packageQuestions.map((question) => [question.questionNo, question.correctAnswer])
    )
  };
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
    error: error ? String(error.message || error).slice(0, 500) : null
  };
}

export async function replayGradingGoldCases(cases = [], config = process.env, options = {}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("Gold cases must be a non-empty array.");
  const selectedCases = cases.map((sample) => trimSample(sample, options.maxQuestions));
  const actualCases = [];
  const runs = [];
  for (const [index, sample] of selectedCases.entries()) {
    options.progress?.({ phase: "start", index: index + 1, total: selectedCases.length, caseId: sample.caseId });
    const startedAt = Date.now();
    try {
      const result = await gradeSubmissionService(config, buildReplayInput(sample.input), {
        persist: false,
        runDeepGradingAudit: options.deepAudit === true,
        teachingExecution: { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.model ? { disableSolEscalation: true } : {}) }
      });
      actualCases.push({
        ...sample,
        actual: projectActual(result)
      });
      runs.push({ caseId: sample.caseId, ...projectRun(result, startedAt) });
      options.progress?.({ phase: "done", index: index + 1, total: selectedCases.length, caseId: sample.caseId, run: runs.at(-1) });
    } catch (error) {
      actualCases.push({
        ...sample,
        actual: {
          score: null,
          needsTeacherReview: true,
          reviewStatus: "replay_failed",
          quality: { lowConfidence: true },
          questionResults: []
        }
      });
      runs.push({ caseId: sample.caseId, ...projectRun(null, startedAt, error) });
      options.progress?.({ phase: "failed", index: index + 1, total: selectedCases.length, caseId: sample.caseId, run: runs.at(-1) });
    }
  }
  return {
    schemaVersion: "grading-gold-replay-v1",
    generatedAt: new Date().toISOString(),
    sourceCaseCount: selectedCases.length,
    deepAudit: options.deepAudit === true,
    modelOverride: options.model || null,
    cases: actualCases,
    runs
  };
}

async function runCli() {
  const { goldPath, outputPath, model, limit, timeoutMs, maxQuestions, deepAudit } = parseArgs(process.argv.slice(2));
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
  const evaluation = await replayGradingGoldCases(cases, config, {
    deepAudit,
    model,
    timeoutMs,
    maxQuestions,
    progress: (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
  });
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
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
