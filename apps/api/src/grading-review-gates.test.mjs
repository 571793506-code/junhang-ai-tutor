import assert from "node:assert/strict";
import test from "node:test";

import {
  gradingSourceScoreGroups,
  gradingQuestionReviewState,
  requireAllQuestionsReviewedForArchive
} from "./grading-review-gates.js";
import { buildExternalGradingRecognitionPacket } from "./external-grading-recognition.js";

const groupedSource = {
  baseScore: 5, bonusScore: 10,
  questions: [
    { questionNo: "31", maxScore: 10, context: { scoreGroup: "bonus" } },
    { questionNo: "1", maxScore: 5, context: { scoreGroup: "base" } }
  ]
};
const groupedReviews = () => [
  { questionNo: "1", maxScore: 5, score: 4, status: "partial", knowledgePoint: "计算", errorStep: "首步错误", reviewedByTeacher: true },
  { questionNo: "31", maxScore: 10, score: 0, status: "wrong", knowledgePoint: "括号", errorStep: "未添括号", reviewedByTeacher: true }
];

test("source score groups align by explicit number and keep bonus separate", () => {
  assert.deepEqual(gradingSourceScoreGroups(groupedReviews(), groupedSource), [
    { id: "base", label: "基础", score: 4, maxScore: 5, total: 1, reviewed: 1, pending: 0 },
    { id: "bonus", label: "附加", score: 0, maxScore: 10, total: 1, reviewed: 1, pending: 0 }
  ]);
});

test("unreviewed, uncertain and out-of-range scores never become confirmed group totals", () => {
  for (const patch of [{ reviewedByTeacher: false }, { status: "uncertain" }, { score: 11 }, { score: -1 }, { score: null }]) {
    const questions = groupedReviews();
    Object.assign(questions[1], patch);
    const groups = gradingSourceScoreGroups(questions, groupedSource);
    assert.equal(groups[0].score, 4);
    assert.equal(groups[1].score, null);
    assert.equal(groups[1].pending, 1);
  }
});

test("untrusted group alignment falls back without inventing score groups", () => {
  const reviews = groupedReviews();
  const clone = () => structuredClone(groupedSource);
  assert.equal(gradingSourceScoreGroups(reviews, null), null);
  assert.equal(gradingSourceScoreGroups(reviews.slice(0, 1), groupedSource), null);
  assert.equal(gradingSourceScoreGroups([reviews[0], reviews[0]], groupedSource), null);
  for (const mutate of [
    s => { s.questions[0].questionNo = "1"; },
    s => { delete s.questions[0].context.scoreGroup; },
    s => { s.questions[0].context.scoreGroup = "unknown"; },
    s => { s.questions[0].maxScore = 9; },
    s => { s.baseScore = 100; }
  ]) {
    const source = clone(); mutate(source);
    assert.equal(gradingSourceScoreGroups(reviews, source), null);
  }
});

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

test("grading archive gate blocks an unconfirmed external answer source", () => {
  const externalGradingRecognition = buildExternalGradingRecognitionPacket({
    pages: [{
      pageNumber: 1,
      questions: [{
        questionNo: "1",
        recognitionConfidence: 0.98,
        recognitionStatus: "confirmed",
        correctAnswer: "4",
        score: 1,
        maxScore: 1,
        status: "correct",
        review: { reviewedByTeacher: true }
      }]
    }],
    answerSourceMode: "model_draft"
  });
  const gate = requireAllQuestionsReviewedForArchive({
    questionResults: [{ questionNo: "1", status: "correct", score: 1, maxScore: 1, reviewedByTeacher: true }]
  }, externalGradingRecognition);

  assert.equal(gate.ok, false);
  assert.equal(gate.error, "EXTERNAL_RECOGNITION_REVIEW_REQUIRED");
  assert.deepEqual(gate.archiveBlockers, ["ANSWER_SOURCE_NOT_CONFIRMED"]);
});

test("grading archive gate preserves generated-assessment behavior without an external packet", () => {
  const gate = requireAllQuestionsReviewedForArchive({
    questionResults: [{ questionNo: "1", status: "correct", score: 2, maxScore: 2, reviewedByTeacher: true }]
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.state.score, 2);
});
