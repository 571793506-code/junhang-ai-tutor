import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGradingCases } from "./grading-quality-check.mjs";

test("grading evaluator reports question, score, confidence, and teacher-edit metrics", () => {
  const report = evaluateGradingCases([
    {
      id: "case-1",
      expected: {
        score: 8,
        needsTeacherReview: false,
        questionResults: [
          { questionNo: "1", status: "correct" },
          { questionNo: "2", status: "partial" }
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
      teacherReview: { modifiedQuestionNos: ["2"] }
    },
    {
      id: "case-2",
      expected: {
        score: 4,
        needsTeacherReview: true,
        questionResults: [
          { questionNo: "1", status: "wrong" },
          { questionNo: "2", status: "uncertain" }
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
      teacherReview: { modifiedQuestionNos: ["1"] }
    }
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

test("grading evaluator returns null for metrics without eligible gold evidence", () => {
  const report = evaluateGradingCases([
    {
      id: "clean",
      expected: {
        score: 5,
        needsTeacherReview: false,
        questionResults: [{ questionNo: "1", status: "correct" }]
      },
      actual: {
        score: 5,
        quality: { lowConfidence: false },
        questionResults: [{ questionNo: "1", status: "correct", confidence: 0.95 }]
      }
    }
  ]);

  assert.equal(report.metrics.lowConfidenceRecall, null);
  assert.equal(report.metrics.unsafeHighConfidenceErrorRate, null);
  assert.equal(report.metrics.teacherModificationRate, null);
});
