import assert from "node:assert/strict";
import test from "node:test";

import { hydrateQuestionDraftsFromOcr } from "./grading-workbench-question-drafts.js";

test("hydrates unresolved grading questions from matching OCR evidence", () => {
  const questions = hydrateQuestionDraftsFromOcr(
    [{
      id: "question-2",
      questionNo: "2",
      status: "uncertain",
      studentAnswer: "",
      correctAnswer: "",
      confidence: 0,
      bbox: { page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.1 }
    }],
    [{
      questionNo: "2",
      printedPrompt: "1200 - [(96 + 144) / 8 + 35] * 12",
      studentAnswer: "1200 - 65 * 12 = 320",
      confidence: 0.88,
      bbox: { page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.1 }
    }]
  );

  assert.deepEqual(questions, [{
    id: "question-2",
    questionNo: "2",
    status: "uncertain",
    prompt: "1200 - [(96 + 144) / 8 + 35] * 12",
    studentAnswer: "1200 - 65 * 12 = 320",
    correctAnswer: "",
    confidence: 0.88,
    bbox: { page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.1 }
  }]);
});

test("does not overwrite a teacher-reviewed question with OCR draft data", () => {
  const questions = hydrateQuestionDraftsFromOcr(
    [{
      questionNo: "3",
      status: "wrong",
      prompt: "Teacher prompt",
      studentAnswer: "Teacher answer",
      confidence: 0.7,
      reviewedByTeacher: true
    }],
    [{
      questionNo: "3",
      printedPrompt: "OCR prompt",
      studentAnswer: "OCR answer",
      confidence: 0.95
    }]
  );

  assert.deepEqual(questions, [{
    questionNo: "3",
    status: "wrong",
    prompt: "Teacher prompt",
    studentAnswer: "Teacher answer",
    confidence: 0.7,
    reviewedByTeacher: true
  }]);
});
