export const EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION = "external-grading-recognition-v1";

const ANSWER_SOURCE_MODES = new Set(["teacher_confirmed", "teacher_selected_reference", "model_draft", "missing"]);
const RECOGNITION_STATUSES = new Set(["confirmed", "needs_teacher_review", "unreadable"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAnswerSourceMode(value) {
  return ANSWER_SOURCE_MODES.has(value) ? value : "missing";
}

function answerSourceStatus(mode) {
  if (mode === "teacher_confirmed" || mode === "teacher_selected_reference") return "confirmed";
  if (mode === "model_draft") return "needs_teacher_review";
  return "missing";
}

function normalizeRecognitionStatus(question = {}) {
  if (RECOGNITION_STATUSES.has(question.recognitionStatus)) return question.recognitionStatus;
  const confidence = numberOrNull(question.recognitionConfidence);
  if (confidence == null) return "needs_teacher_review";
  if (confidence < 0.5) return "unreadable";
  return confidence >= 0.8 ? "confirmed" : "needs_teacher_review";
}

function normalizeQuestion(question = {}, index = 0, pageNumber = 1) {
  const printedPrompt = text(question.printedPrompt || question.prompt);
  const studentAnswer = text(question.studentAnswer);
  const recognitionConfidence = numberOrNull(question.recognitionConfidence ?? question.confidence);
  return {
    id: text(question.id) || `question-${pageNumber}-${index + 1}`,
    questionNo: text(question.questionNo || question.no) || String(index + 1),
    questionType: text(question.questionType || question.itemType) || "unknown",
    bbox: {
      page: Number(question.bbox?.page || pageNumber),
      x: Number(question.bbox?.x || 0),
      y: Number(question.bbox?.y || 0),
      w: Number(question.bbox?.w || 0),
      h: Number(question.bbox?.h || 0)
    },
    printedPrompt,
    studentAnswer,
    correctAnswer: text(question.correctAnswer || question.answer),
    status: text(question.status) || "uncertain",
    score: numberOrNull(question.score),
    maxScore: numberOrNull(question.maxScore),
    recognitionConfidence,
    recognitionStatus: normalizeRecognitionStatus({ ...question, recognitionConfidence }),
    recognition: {
      originalPrintedPrompt: text(question.recognition?.originalPrintedPrompt) || printedPrompt,
      originalStudentAnswer: text(question.recognition?.originalStudentAnswer) || studentAnswer
    },
    review: {
      reviewedByTeacher: question.review?.reviewedByTeacher === true,
      reviewedAt: question.review?.reviewedAt || null,
      teacherNote: text(question.review?.teacherNote || question.teacherNote)
    }
  };
}

function normalizePage(page = {}, index = 0) {
  const pageNumber = Number(page.pageNumber || index + 1);
  const qualityStatus = text(page.quality?.status || page.qualityStatus) || "usable";
  return {
    pageNumber,
    fileName: text(page.fileName),
    imageUrl: text(page.imageUrl) || null,
    quality: {
      status: qualityStatus,
      score: numberOrNull(page.quality?.score ?? page.qualityScore),
      issues: Array.isArray(page.quality?.issues || page.qualityIssues) ? [...(page.quality?.issues || page.qualityIssues)] : [],
      warnings: Array.isArray(page.quality?.warnings || page.qualityWarnings) ? [...(page.quality?.warnings || page.qualityWarnings)] : []
    },
    questions: Array.isArray(page.questions)
      ? page.questions.map((question, questionIndex) => normalizeQuestion(question, questionIndex, pageNumber))
      : []
  };
}

export function externalRecognitionArchiveBlockers(packet = {}) {
  const blockers = new Set();
  if (packet.answerSource?.status !== "confirmed") blockers.add("ANSWER_SOURCE_NOT_CONFIRMED");
  for (const page of packet.pages || []) {
    if (["needs_review", "poor", "unusable", "unavailable"].includes(page.quality?.status)) blockers.add("PAGE_QUALITY_REVIEW_REQUIRED");
    for (const question of page.questions || []) {
      if (question.recognitionStatus !== "confirmed") {
        blockers.add("QUESTION_RECOGNITION_REVIEW_REQUIRED");
        continue;
      }
      if (question.review?.reviewedByTeacher !== true) blockers.add("QUESTION_TEACHER_REVIEW_REQUIRED");
      const score = numberOrNull(question.score);
      const maxScore = numberOrNull(question.maxScore);
      if (question.review?.reviewedByTeacher === true && (score == null || maxScore == null || maxScore <= 0 || score < 0 || score > maxScore)) {
        blockers.add("QUESTION_SCORE_INVALID");
      }
    }
  }
  return [...blockers];
}

function finalizePacket(packet) {
  const archiveBlockers = externalRecognitionArchiveBlockers(packet);
  return {
    ...packet,
    gradingStatus: archiveBlockers.length ? "needs_teacher_review" : "teacher_confirmed",
    archiveEligible: archiveBlockers.length === 0,
    archiveBlockers
  };
}

export function buildExternalGradingRecognitionPacket(input = {}) {
  const mode = normalizeAnswerSourceMode(input.answerSourceMode || input.answerSource?.mode);
  return finalizePacket({
    schemaVersion: EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION,
    materialType: "external_workbook",
    pages: Array.isArray(input.pages) ? input.pages.map(normalizePage) : [],
    answerSource: {
      mode,
      status: answerSourceStatus(mode),
      answers: input.answerSource?.answers && typeof input.answerSource.answers === "object" ? { ...input.answerSource.answers } : {}
    }
  });
}

export function mergeExternalQuestionTeacherReview(packet = {}, questionNo, patch = {}) {
  const nextPages = (packet.pages || []).map((page) => ({
    ...page,
    questions: (page.questions || []).map((question) => {
      if (String(question.questionNo) !== String(questionNo) && String(question.id) !== String(questionNo)) return question;
      return {
        ...question,
        printedPrompt: text(patch.printedPrompt ?? question.printedPrompt),
        studentAnswer: text(patch.studentAnswer ?? question.studentAnswer),
        correctAnswer: text(patch.correctAnswer ?? question.correctAnswer),
        status: text(patch.status) || question.status,
        score: numberOrNull(patch.score ?? question.score),
        maxScore: numberOrNull(patch.maxScore ?? question.maxScore),
        recognitionStatus: "confirmed",
        recognition: {
          originalPrintedPrompt: text(question.recognition?.originalPrintedPrompt) || text(question.printedPrompt),
          originalStudentAnswer: text(question.recognition?.originalStudentAnswer) || text(question.studentAnswer)
        },
        review: {
          reviewedByTeacher: true,
          reviewedAt: new Date().toISOString(),
          teacherNote: text(patch.teacherNote ?? question.review?.teacherNote)
        }
      };
    })
  }));
  return finalizePacket({ ...packet, pages: nextPages });
}
