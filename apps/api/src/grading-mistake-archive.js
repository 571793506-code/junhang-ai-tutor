function questionNos(metadata = {}) {
  return new Set(
    (Array.isArray(metadata.questionNos) ? metadata.questionNos : [])
      .map((questionNo) => String(questionNo || "").trim())
      .filter(Boolean)
  );
}

export function filterNewReviewedMistakes(existingMistakes = [], reviewedMistakes = [], submissionId = "") {
  const archivedQuestionNos = new Set();
  for (const mistake of Array.isArray(existingMistakes) ? existingMistakes : []) {
    const metadata = mistake?.metadata && typeof mistake.metadata === "object" ? mistake.metadata : {};
    if (String(metadata.sourceSubmissionId || metadata.submissionId || "") !== String(submissionId || "")) continue;
    for (const questionNo of questionNos(metadata)) archivedQuestionNos.add(questionNo);
  }
  return (Array.isArray(reviewedMistakes) ? reviewedMistakes : []).filter((mistake) => {
    const mistakeQuestionNos = questionNos(mistake?.metadata);
    return !mistakeQuestionNos.size || [...mistakeQuestionNos].some((questionNo) => !archivedQuestionNos.has(questionNo));
  });
}
