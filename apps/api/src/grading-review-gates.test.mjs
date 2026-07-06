import assert from "node:assert/strict";
import test from "node:test";

import {
  gradingQuestionReviewState,
  requireAllQuestionsReviewedForArchive
} from "./grading-review-gates.js";

test("grading archive gate blocks unreviewed question results", () => {
  const gate = requireAllQuestionsReviewedForArchive({
    questionResults: [
      { questionNo: "1", status: "correct", score: 5, maxScore: 5, reviewedByTeacher: true },
      { questionNo: "2", status: "wrong", score: 0, maxScore: 5 }
    ]
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.error, "QUESTIONS_REVIEW_REQUIRED");
  assert.equal(gate.state.total, 2);
  assert.equal(gate.state.reviewed, 1);
  assert.deepEqual(gate.state.unresolvedQuestionNos, ["2"]);
});

test("grading archive gate blocks teacher-reviewed uncertain questions", () => {
  const gate = requireAllQuestionsReviewedForArchive({
    questionResults: [
      { questionNo: "1", status: "uncertain", score: 0, maxScore: 5, reviewedByTeacher: true }
    ]
  });

  assert.equal(gate.ok, false);
  assert.deepEqual(gate.state.unresolvedQuestionNos, ["1"]);
});

test("grading archive gate accepts all teacher-reviewed scored questions and returns summed score", () => {
  const state = gradingQuestionReviewState([
    { questionNo: "1", status: "correct", score: 5, maxScore: 5, reviewedByTeacher: true },
    { questionNo: "2", status: "partial", score: 2.5, maxScore: 5, reviewedByTeacher: true },
    { questionNo: "3", status: "wrong", score: 0, maxScore: 5, reviewedByTeacher: true }
  ]);

  assert.equal(state.total, 3);
  assert.equal(state.reviewed, 3);
  assert.equal(state.readyForArchive, true);
  assert.equal(state.score, 7.5);

  const gate = requireAllQuestionsReviewedForArchive({ questionResults: state.questions });
  assert.equal(gate.ok, true);
  assert.equal(gate.state.score, 7.5);
});
