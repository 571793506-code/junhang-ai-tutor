import assert from "node:assert/strict";
import test from "node:test";
import * as review from "./index.js";

test("only actor-bound current answers with unique question numbers become correction evidence", () => {
  assert.equal(typeof review.verifiedRecognitionCorrections, "function");
  const q = { questionNo: "16", studentAnswer: "775;2900;2490;700",
    studentAnswerReview: { actorTeacherId: "t1", studentAnswer: "775;2900;2490;700" } };
  assert.deepEqual(review.verifiedRecognitionCorrections([q], "t1"), [{ questionNo: "16", studentAnswer: q.studentAnswer }]);
  for (const questions of [[q, q], [{ ...q, studentAnswer: "changed" }], [{ ...q, studentAnswer: null }]]) {
    assert.deepEqual(review.verifiedRecognitionCorrections(questions, "t1"), []);
  }
  assert.deepEqual(review.verifiedRecognitionCorrections([q], "other"), []);
  assert.deepEqual(review.verifiedRecognitionCorrections([{ ...q, studentAnswerReview: {} }], undefined), []);
});
