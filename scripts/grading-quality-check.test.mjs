import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGradingCases } from "./grading-quality-check.mjs";

function goldCase(overrides = {}) {
  return {
    caseId: "case-1",
    sourceType: "generated_assessment",
    input: { subject: "数学", kind: "练习" },
    expected: {
      score: 8,
      needsTeacherReview: false,
      questionResults: [
        { questionNo: "1", status: "correct", correctAnswer: "2" },
        { questionNo: "2", status: "partial", correctAnswer: "过程合理" }
      ]
    },
    actual: {
      score: 9,
      quality: { lowConfidence: false },
      questionResults: [
        { questionNo: "1", status: "correct", confidence: 0.95 },
        { questionNo: "2", status: "wrong", confidence: 0.9 }
      ]
    },
    teacherReview: {
      confirmedBy: "teacher-1",
      confirmedAt: "2026-09-07T00:00:00.000Z",
      modifiedQuestionNos: ["2"]
    },
    ...overrides
  };
}

test("grading evaluator reports question, score, confidence, and teacher-edit metrics", () => {
  const report = evaluateGradingCases([
    goldCase(),
    goldCase({
      caseId: "case-2",
      expected: {
        score: 4,
        needsTeacherReview: true,
        questionResults: [
          { questionNo: "1", status: "wrong", correctAnswer: "4" },
          { questionNo: "2", status: "uncertain", reason: "图片中的作答区域不清晰" }
        ]
      },
      actual: {
        score: 2,
        quality: { lowConfidence: true },
        questionResults: [
          { questionNo: "1", status: "correct", confidence: 0.92 },
          { questionNo: "2", status: "uncertain", confidence: 0.4 }
        ]
      },
      teacherReview: {
        confirmedBy: "teacher-1",
        confirmedAt: "2026-09-07T00:00:00.000Z",
        modifiedQuestionNos: ["1"]
      }
    })
  ]);

  assert.equal(report.schemaVersion, "grading-quality-v1");
  assert.equal(report.counts.cases, 2);
  assert.equal(report.counts.questions, 4);
  assert.equal(report.metrics.questionAccuracy, 0.75);
  assert.equal(report.metrics.statusAgreement, 0.5);
  assert.equal(report.metrics.scoreMeanAbsoluteError, 1.5);
  assert.equal(report.metrics.lowConfidenceRecall, 1);
  assert.equal(report.metrics.unsafeHighConfidenceErrorRate, 0.5);
  assert.equal(report.metrics.teacherModificationRate, 0.5);
});

test("grading evaluator keeps null risk metrics when no low-confidence errors exist", () => {
  const report = evaluateGradingCases([
    {
      caseId: "clean",
      sourceType: "generated_assessment",
      input: { subject: "数学", kind: "练习" },
      expected: {
        score: 5,
        needsTeacherReview: false,
        questionResults: [{ questionNo: "1", status: "correct", correctAnswer: "5" }]
      },
      actual: {
        score: 5,
        quality: { lowConfidence: false },
        questionResults: [{ questionNo: "1", status: "correct", confidence: 0.95 }]
      },
      teacherReview: {
        confirmedBy: "teacher-1",
        confirmedAt: "2026-09-07T00:00:00.000Z",
        modifiedQuestionNos: []
      }
    }
  ]);

  assert.equal(report.metrics.lowConfidenceRecall, null);
  assert.equal(report.metrics.unsafeHighConfidenceErrorRate, null);
  assert.equal(report.metrics.teacherModificationRate, 0);
});

test("grading evaluator exposes the teacher-confirmed evidence boundary", () => {
  const report = evaluateGradingCases([goldCase()]);

  assert.equal(report.teacherConfirmedCaseCount, 1);
  assert.equal(report.counts.teacherConfirmedCaseCount, 1);
  assert.equal(report.evidenceBoundary.teacherConfirmed, true);
  assert.equal(report.evidenceBoundary.productionEligible, false);
  assert.equal(report.productionAccuracyClaim, false);
});

test("missing and unavailable actuals cannot earn accuracy or production claims", () => {
  for (const actual of [undefined, { available: false }, { available: true, questionResults: [] },
    { available: true, usedDynamicFallback: true, questionResults: goldCase().actual.questionResults }]) {
    const report = evaluateGradingCases([goldCase({ actual })], { teacherReviewedReport: true, productionAccuracyClaim: true });
    assert.equal(report.ok, false);
    assert.equal(report.productionAccuracyClaim, false);
    assert.equal(report.metrics.questionAccuracy, null);
  }
});

test("null scores and unrecorded teacher edits stay unknown; absent predictions earn no credit", () => {
  const sample = goldCase();
  sample.actual.score = null;
  sample.actual.questionResults = [];
  sample.teacherReview.modificationEvidence = "not_recorded";
  const report = evaluateGradingCases([sample]);
  assert.equal(report.metrics.scoreMeanAbsoluteError, null);
  assert.equal(report.metrics.teacherModificationRate, null);
  assert.equal(report.metrics.questionAccuracy, null);
  assert.equal(report.ok, false);
});

test("teacher labels alone cannot establish an independently executed report", () => {
  const report = evaluateGradingCases([goldCase()], { teacherReviewedReport: true, productionAccuracyClaim: true });
  assert.equal(report.productionAccuracyClaim, false);
  assert.equal(report.ok, false);
  assert.ok(report.executionIssues.some((i) => i.code === "EXECUTION_EVIDENCE_MISSING"));
});

test("malformed actual question collections are rejected without granting metrics", () => {
  for (const questions of [{ length: 1 }, "answer", [null]]) {
    const source = goldCase();
    source.actual.questionResults = questions;
    const report = evaluateGradingCases([source]);
    assert.equal(report.ok, false);
    assert.equal(report.metrics.questionAccuracy, null);
    assert.ok(report.executionIssues.some((i) => i.code === "ACTUAL_RESULTS_INCOMPLETE"));
  }
});
