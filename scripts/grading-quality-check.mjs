import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGradingGoldCases, hashQualityEvidence } from "./quality-gold-contract.mjs";

function roundMetric(value) {
  return Number(Number(value).toFixed(4));
}

function ratio(numerator, denominator) {
  return denominator ? roundMetric(numerator / denominator) : null;
}

function questionsByNo(result = {}) {
  const questions = Array.isArray(result.questionResults) ? result.questionResults : [];
  return new Map(questions.filter((item) => item && typeof item === "object").map((item, index) => [String(item.questionNo || index + 1), item]));
}

function assertValidGoldCases(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error("GOLD_CASES_INVALID: cases must not be empty");
  const validation = validateGradingGoldCases(cases);
  if (!validation.ok) {
    throw new Error(["GOLD_CASES_INVALID", ...validation.issues.map((issue) => `- ${issue}`)].join("\n"));
  }
  return validation.normalizedCases;
}

export function evaluateGradingCases(cases = [], options = {}) {
  const normalizedCases = assertValidGoldCases(cases);
  const executionIssues = [];
  const addIssue = (sample, code) => executionIssues.push({ caseId: sample.caseId, code });
  let questionCount = 0;
  let evaluatedCases = 0;
  let binaryCorrect = 0;
  let statusAgreements = 0;
  let scoreAbsoluteError = 0;
  let scoreCaseCount = 0;
  let lowConfidenceExpected = 0;
  let lowConfidenceDetected = 0;
  let unsafeHighConfidenceErrors = 0;
  let highConfidencePredictionErrors = 0;
  let eligibleGoldErrors = 0;
  let teacherModifiedQuestions = 0;
  let teacherReviewedQuestions = 0;
  const failureReasons = {};

  for (const sample of normalizedCases) {
    const issueCountBeforeCase = executionIssues.length;
    const expected = sample.expected || {};
    const actual = sample.actual || {};
    const actualByNo = questionsByNo(actual);
    const modified = new Set((sample.teacherReview?.modifiedQuestionNos || []).map(String));
    const expectedQuestions = Array.isArray(expected.questionResults) ? expected.questionResults : [];
    const run = sample.evaluationRun;
    if (run?.failureReason) failureReasons[run.failureReason] = (failureReasons[run.failureReason] || 0) + 1;
    if (!run || run.schemaVersion !== "grading-evaluation-run-v1") addIssue(sample, "EXECUTION_EVIDENCE_MISSING");
    else {
      if (run.caseId !== sample.caseId || !run.runId || run.runner !== "gradeSubmissionService" || run.persist !== false ||
        run.inputHash !== hashQualityEvidence(sample.input) || run.actualHash !== hashQualityEvidence(actual) ||
        !Number.isFinite(Date.parse(run.startedAt)) || !Number.isFinite(Date.parse(run.completedAt)) || Date.parse(run.completedAt) < Date.parse(run.startedAt)) addIssue(sample, "EXECUTION_EVIDENCE_INVALID");
      if (run.scope !== (options.requiredScope || "grading-text")) addIssue(sample, "EXECUTION_SCOPE_MISMATCH");
      if (run.sourceCaseCount != null && run.sourceCaseCount !== normalizedCases.length) addIssue(sample, "EXECUTION_BATCH_INCOMPLETE");
      if (run.status !== "completed" || actual.available !== true || actual.usedDynamicFallback !== false) addIssue(sample, "EXECUTION_NOT_SUCCESSFUL");
    }
    if (actual.available === false || actual.usedDynamicFallback === true || !Array.isArray(actual.questionResults) || !actual.questionResults.length ||
      actual.questionResults.length !== expectedQuestions.length || actualByNo.size !== actual.questionResults.length ||
      expectedQuestions.some((q) => !actualByNo.has(String(q.questionNo))) ||
      actual.questionResults.some((q) => !["correct", "wrong", "partial", "uncertain"].includes(q.status))) {
      addIssue(sample, "ACTUAL_RESULTS_INCOMPLETE");
      continue;
    }

    // Metrics describe independently bound successful executions, not imported
    // predictions with missing/invalid provenance. Valid cases in a failed batch
    // may still contribute, with explicit coverage in counts.evaluatedCases.
    if (executionIssues.length !== issueCountBeforeCase) continue;
    evaluatedCases += 1;

    for (const [index, gold] of expectedQuestions.entries()) {
      const questionNo = String(gold.questionNo || index + 1);
      const prediction = actualByNo.get(questionNo) || {};
      const expectedStatus = String(gold.status || "uncertain");
      const actualStatus = String(prediction.status || "uncertain");
      questionCount += 1;
      if ((expectedStatus === "correct") === (actualStatus === "correct")) binaryCorrect += 1;
      if (expectedStatus === actualStatus) statusAgreements += 1;
      if (expectedStatus !== actualStatus && Number(prediction.confidence || 0) >= 0.85) {
        highConfidencePredictionErrors += 1;
      }
      if (expectedStatus !== "correct") {
        eligibleGoldErrors += 1;
        if (actualStatus === "correct" && Number(prediction.confidence || 0) >= 0.85) unsafeHighConfidenceErrors += 1;
      }
      if (sample.teacherReview && sample.teacherReview.modificationEvidence !== "not_recorded") {
        teacherReviewedQuestions += 1;
        if (modified.has(questionNo)) teacherModifiedQuestions += 1;
      }
    }

    if (typeof expected.score === "number" && Number.isFinite(expected.score) && typeof actual.score === "number" && Number.isFinite(actual.score)) {
      scoreAbsoluteError += Math.abs(Number(expected.score) - Number(actual.score));
      scoreCaseCount += 1;
    }
    if (expected.needsTeacherReview === true) {
      lowConfidenceExpected += 1;
      if (actual.quality?.lowConfidence === true || actual.needsTeacherReview === true) lowConfidenceDetected += 1;
    }
  }

  const teacherConfirmedCaseCount = normalizedCases.filter((sample) => Boolean(sample.teacherReview?.confirmedBy)).length;
  const syntheticCaseCount = normalizedCases.filter((sample) => (
    String(sample.caseId || "").toLowerCase().startsWith("synthetic-")
    || String(sample.sourceType || "").toLowerCase().includes("synthetic")
    || sample.input?.synthetic === true
  )).length;
  const productionEligible = teacherConfirmedCaseCount === normalizedCases.length
    && normalizedCases.length > 0
    && syntheticCaseCount === 0
    && options.teacherReviewedReport === true && executionIssues.length === 0
    && normalizedCases.every((sample) => sample.evaluationRun?.executionMode === "live");

  return {
    schemaVersion: "grading-quality-v1",
    ok: executionIssues.length === 0,
    executionIssues,
    failureReasons,
    teacherConfirmedCaseCount,
    counts: {
      cases: normalizedCases.length,
      evaluatedCases,
      questions: questionCount,
      scoreCases: scoreCaseCount,
      lowConfidenceGoldCases: lowConfidenceExpected,
      goldErrorQuestions: eligibleGoldErrors,
      teacherReviewedQuestions,
      teacherConfirmedCaseCount,
      syntheticCaseCount
    },
    evidenceBoundary: {
      teacherConfirmed: teacherConfirmedCaseCount === normalizedCases.length && normalizedCases.length > 0,
      synthetic: syntheticCaseCount > 0,
      productionEligible,
      note: productionEligible
        ? "This report is explicitly marked as teacher-reviewed production evidence."
        : "This report is a teacher-confirmed contract sample or synthetic probe; production accuracy is unverified."
    },
    productionAccuracyClaim: productionEligible && options.productionAccuracyClaim === true,
    metrics: {
      questionAccuracy: ratio(binaryCorrect, questionCount),
      statusAgreement: ratio(statusAgreements, questionCount),
      scoreMeanAbsoluteError: scoreCaseCount ? roundMetric(scoreAbsoluteError / scoreCaseCount) : null,
      lowConfidenceRecall: ratio(lowConfidenceDetected, lowConfidenceExpected),
      unsafeHighConfidenceErrorRate: ratio(unsafeHighConfidenceErrors, highConfidencePredictionErrors),
      teacherModificationRate: ratio(teacherModifiedQuestions, teacherReviewedQuestions)
    }
  };
}

function runCli() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: npm.cmd run check:grading:quality -- <gold-cases.json>");
  }
  const cases = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  const report = evaluateGradingCases(Array.isArray(cases) ? cases : cases.cases);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runCli();
}
