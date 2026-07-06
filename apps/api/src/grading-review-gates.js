function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function questionNo(question, index) {
  return String(question?.questionNo || question?.no || index + 1);
}

function isReviewedQuestion(question) {
  const score = optionalNumber(question?.score);
  const maxScore = optionalNumber(question?.maxScore);
  return Boolean(
    question?.reviewedByTeacher === true &&
    question?.status &&
    question.status !== "uncertain" &&
    score != null &&
    maxScore != null &&
    score >= 0 &&
    maxScore > 0
  );
}

export function gradingQuestionReviewState(questions = []) {
  const normalized = Array.isArray(questions) ? questions : [];
  const unresolvedQuestionNos = [];
  let score = 0;
  let reviewed = 0;

  normalized.forEach((question, index) => {
    if (!isReviewedQuestion(question)) {
      unresolvedQuestionNos.push(questionNo(question, index));
      return;
    }
    reviewed += 1;
    score += Number(question.score);
  });

  const readyForArchive = normalized.length > 0 && unresolvedQuestionNos.length === 0;
  return {
    questions: normalized,
    total: normalized.length,
    reviewed,
    unresolved: unresolvedQuestionNos.length,
    unresolvedQuestionNos,
    readyForArchive,
    score: readyForArchive ? Number(score.toFixed(2)) : null
  };
}

export function requireAllQuestionsReviewedForArchive(result = {}) {
  const state = gradingQuestionReviewState(result.questionResults);
  if (!state.readyForArchive) {
    return {
      ok: false,
      error: "QUESTIONS_REVIEW_REQUIRED",
      message: state.total
        ? "请逐题确认所有题目的状态、得分和满分后再归档。"
        : "当前批改结果缺少逐题结果，请重新识别或补录题目后再归档。",
      state
    };
  }
  return { ok: true, state };
}
