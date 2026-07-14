function questionNo(question = {}, index = 0) {
  return String(question.questionNo || question.no || index + 1);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hydrateQuestionDraftsFromOcr(questions = [], ocrQuestions = []) {
  const ocrByQuestionNo = new Map(
    (Array.isArray(ocrQuestions) ? ocrQuestions : []).map((question, index) => [questionNo(question, index), question])
  );
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    if (question?.reviewedByTeacher === true) return question;
    const ocr = ocrByQuestionNo.get(questionNo(question, index));
    if (!ocr) return question;
    const currentConfidence = confidence(question.confidence);
    const ocrConfidence = confidence(ocr.confidence);
    return {
      ...question,
      prompt: text(question.prompt) || text(ocr.printedPrompt || ocr.printedText || ocr.prompt),
      studentAnswer: text(question.studentAnswer) || text(ocr.studentAnswer || ocr.studentAnswerText || ocr.answer),
      confidence: currentConfidence != null && currentConfidence > 0 ? currentConfidence : ocrConfidence ?? currentConfidence,
      bbox: question.bbox || ocr.bbox || question.bbox
    };
  });
}
