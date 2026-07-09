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

test("grading archive gate blocks reviewed wrong and partial questions without mistake evidence", () => {
  const gate = requireAllQuestionsReviewedForArchive({
    questionResults: [
      { questionNo: "1", status: "wrong", score: 0, maxScore: 5, reviewedByTeacher: true },
      { questionNo: "2", status: "partial", score: 2, maxScore: 5, knowledgePoint: "分数加减", reviewedByTeacher: true },
      { questionNo: "3", status: "correct", score: 5, maxScore: 5, reviewedByTeacher: true }
    ]
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.state.total, 3);
  assert.equal(gate.state.reviewed, 1);
  assert.deepEqual(gate.state.unresolvedQuestionNos, ["1", "2"]);
  assert.match(gate.message, /知识点和错因定位/);
});

test("grading archive gate accepts all teacher-reviewed scored questions and returns summed score", () => {
  const state = gradingQuestionReviewState([
    { questionNo: "1", status: "correct", score: 5, maxScore: 5, reviewedByTeacher: true },
    { questionNo: "2", status: "partial", score: 2.5, maxScore: 5, knowledgePoint: "单位换算", errorStep: "把厘米和米直接相加", reviewedByTeacher: true },
    { questionNo: "3", status: "wrong", score: 0, maxScore: 5, knowledgePoint: "方程求解", errorStep: "移项后符号写反", reviewedByTeacher: true }
  ]);

  assert.equal(state.total, 3);
  assert.equal(state.reviewed, 3);
  assert.equal(state.readyForArchive, true);
  assert.equal(state.score, 7.5);

  const gate = requireAllQuestionsReviewedForArchive({ questionResults: state.questions });
  assert.equal(gate.ok, true);
  assert.equal(gate.state.score, 7.5);
});
