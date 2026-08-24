import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION,
  buildExternalGradingRecognitionPacket,
  mergeExternalQuestionTeacherReview,
  externalRecognitionArchiveBlockers
} from "./external-grading-recognition.js";

test("builds versioned external recognition packet with separate recognition and grading states", () => {
  const packet = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, fileName: "page-01.jpg", questions: [{ questionNo: "1", printedPrompt: "2+2=?", studentAnswer: "4", recognitionConfidence: 0.98 }] }],
    answerSourceMode: "model_draft"
  });
  assert.equal(packet.schemaVersion, EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION);
  assert.equal(packet.materialType, "external_workbook");
  assert.equal(packet.pages[0].questions[0].recognitionStatus, "confirmed");
  assert.equal(packet.answerSource.status, "needs_teacher_review");
  assert.equal(packet.gradingStatus, "needs_teacher_review");
  assert.equal(packet.archiveEligible, false);
});

test("teacher review keeps original recognition values", () => {
  const current = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, questions: [{ questionNo: "1", printedPrompt: "原题干", studentAnswer: "原作答", recognitionConfidence: 0.61 }] }],
    answerSourceMode: "teacher_confirmed"
  });
  const next = mergeExternalQuestionTeacherReview(current, "1", { printedPrompt: "修正题干", studentAnswer: "修正作答", correctAnswer: "4", score: 1, maxScore: 1, status: "correct" });
  assert.equal(next.pages[0].questions[0].printedPrompt, "修正题干");
  assert.equal(next.pages[0].questions[0].recognition.originalPrintedPrompt, "原题干");
  assert.equal(next.pages[0].questions[0].recognition.originalStudentAnswer, "原作答");
  assert.equal(next.pages[0].questions[0].review.reviewedByTeacher, true);
});

test("missing answer and low-confidence questions block archive", () => {
  const packet = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, questions: [{ questionNo: "1", recognitionConfidence: 0.4, recognitionStatus: "needs_teacher_review" }] }],
    answerSourceMode: "missing"
  });
  assert.deepEqual(externalRecognitionArchiveBlockers(packet).sort(), ["ANSWER_SOURCE_NOT_CONFIRMED", "QUESTION_RECOGNITION_REVIEW_REQUIRED"]);
});

test("poor page quality blocks archive even after question review", () => {
  const packet = buildExternalGradingRecognitionPacket({
    pages: [{
      pageNumber: 1,
      quality: { status: "poor" },
      questions: [{
        questionNo: "1",
        printedPrompt: "1+1=?",
        studentAnswer: "2",
        recognitionConfidence: 0.98,
        recognitionStatus: "confirmed",
        correctAnswer: "2",
        status: "correct",
        score: 1,
        maxScore: 1,
        review: { reviewedByTeacher: true }
      }]
    }],
    answerSourceMode: "teacher_confirmed"
  });
  assert.deepEqual(externalRecognitionArchiveBlockers(packet), ["PAGE_QUALITY_REVIEW_REQUIRED"]);
});
