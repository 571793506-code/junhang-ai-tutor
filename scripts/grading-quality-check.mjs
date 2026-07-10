import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function roundMetric(value) {
  return Number(Number(value).toFixed(4));
}

function ratio(numerator, denominator) {
  return denominator ? roundMetric(numerator / denominator) : null;
}

function questionsByNo(result = {}) {
  return new Map((result.questionResults || []).map((item, index) => [String(item.questionNo || index + 1), item]));
}

export function evaluateGradingCases(cases = []) {
  let questionCount = 0;
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

  for (const sample of Array.isArray(cases) ? cases : []) {
    const expected = sample.expected || {};
    const actual = sample.actual || {};
    const actualByNo = questionsByNo(actual);
    const modified = new Set((sample.teacherReview?.modifiedQuestionNos || []).map(String));
    const expectedQuestions = Array.isArray(expected.questionResults) ? expected.questionResults : [];

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
      if (sample.teacherReview) {
        teacherReviewedQuestions += 1;
        if (modified.has(questionNo)) teacherModifiedQuestions += 1;
      }
    }

    if (Number.isFinite(Number(expected.score)) && Number.isFinite(Number(actual.score))) {
      scoreAbsoluteError += Math.abs(Number(expected.score) - Number(actual.score));
      scoreCaseCount += 1;
    }
    if (expected.needsTeacherReview === true) {
      lowConfidenceExpected += 1;
      if (actual.quality?.lowConfidence === true || actual.needsTeacherReview === true) lowConfidenceDetected += 1;
    }
  }

  return {
    schemaVersion: "grading-quality-v1",
    counts: {
      cases: Array.isArray(cases) ? cases.length : 0,
      questions: questionCount,
      scoreCases: scoreCaseCount,
      lowConfidenceGoldCases: lowConfidenceExpected,
      goldErrorQuestions: eligibleGoldErrors,
      teacherReviewedQuestions
    },
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
  process.stdout.write(`${JSON.stringify(evaluateGradingCases(cases), null, 2)}\n`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runCli();
}
