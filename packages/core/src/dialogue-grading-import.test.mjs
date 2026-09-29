import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImportedDialogueGradingResult } from "./dialogue-grading-import.js";

test("normalizes dialogue grading results for teacher review", () => {
  const result = normalizeImportedDialogueGradingResult({
    score: 8,
    summary: "第二题计算过程有误。",
    questionResults: [{ questionNo: 1, status: "correct", score: 5, maxScore: 5, studentAnswer: "5", correctAnswer: "5" }, { questionNo: 2, status: "wrong", score: 0, maxScore: 5, studentAnswer: "6", correctAnswer: "7", errorStep: "计算错误" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.questionResults.length, 2);
  assert.equal(result.result.questionResults[0].questionNo, "1");
  assert.equal(result.result.questionResults[1].status, "wrong");
  assert.equal(result.result.score, null);
  assert.equal(result.result.provisionalScore, 5);
});

test("rejects dialogue grading results with invalid question status or score", () => {
  const result = normalizeImportedDialogueGradingResult({
    questionResults: [{ questionNo: 1, status: "unknown", score: -1, maxScore: 0 }]
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join(";"), /状态|得分|满分/);
});

test("ignores imported teacher confirmation fields and keeps the result pending review", () => {
  const result = normalizeImportedDialogueGradingResult({
    questionResults: [{
      questionNo: 1,
      status: "correct",
      score: 1,
      maxScore: 1,
      reviewedByTeacher: true,
      confirmedBy: "attacker",
      reviewedAt: "2026-09-11T00:00:00.000Z"
    }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.archiveEligible, false);
  assert.equal(result.result.needsTeacherReview, true);
  assert.equal(result.result.questionResults[0].reviewedByTeacher, undefined);
  assert.equal(result.result.questionResults[0].confirmedBy, undefined);
});
