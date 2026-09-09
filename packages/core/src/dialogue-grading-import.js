function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const statuses = new Set(["correct", "wrong", "partial", "uncertain"]);

export function normalizeImportedDialogueGradingResult(input = {}) {
  const source = asRecord(input);
  const issues = [];
  const rawQuestions = Array.isArray(source.questionResults) ? source.questionResults : [];
  if (!rawQuestions.length) issues.push("对话批改结果至少需要一道题。");
  const questionResults = rawQuestions.map((item, index) => {
    const raw = asRecord(item);
    const questionNo = text(raw.questionNo ?? raw.no ?? raw.index ?? index + 1) || String(index + 1);
    const status = text(raw.status).toLowerCase();
    const score = number(raw.score);
    const maxScore = number(raw.maxScore ?? raw.fullScore);
    if (!statuses.has(status)) issues.push(`第 ${questionNo} 题状态无效。`);
    if (score == null || score < 0) issues.push(`第 ${questionNo} 题得分无效。`);
    if (maxScore == null || maxScore <= 0) issues.push(`第 ${questionNo} 题满分无效。`);
    if (score != null && maxScore != null && score > maxScore) issues.push(`第 ${questionNo} 题得分不能超过满分。`);
    return {
      id: text(raw.id) || `dialogue-question-${questionNo}`,
      questionNo,
      status: statuses.has(status) ? status : "uncertain",
      score,
      maxScore,
      prompt: text(raw.prompt ?? raw.printedPrompt ?? raw.printedText),
      studentAnswer: text(raw.studentAnswer),
      correctAnswer: text(raw.correctAnswer),
      studentProcess: Array.isArray(raw.studentProcess) ? raw.studentProcess.map(text).filter(Boolean) : [],
      errorStep: text(raw.errorStep),
      explanation: text(raw.explanation),
      knowledgePoint: text(raw.knowledgePoint),
      suggestedPractice: text(raw.suggestedPractice),
      teacherNote: text(raw.teacherNote)
    };
  });
  const questionNos = questionResults.map((item) => item.questionNo);
  if (new Set(questionNos).size !== questionNos.length) issues.push("题号不能重复。");
  const allScored = questionResults.length > 0 && questionResults.every((item) => item.score != null);
  const provisionalScore = allScored
    ? Number(questionResults.reduce((sum, item) => sum + item.score, 0).toFixed(2))
    : number(source.score);
  return {
    ok: issues.length === 0,
    issues,
    result: {
      score: null,
      provisionalScore,
      summary: text(source.summary) || "已导入对话批改结果，请教师逐题确认。",
      strengths: Array.isArray(source.strengths) ? source.strengths.map(text).filter(Boolean) : [],
      mistakes: Array.isArray(source.mistakes) ? source.mistakes : [],
      questionResults,
      annotationMarkers: Array.isArray(source.annotationMarkers) ? source.annotationMarkers : [],
      nextPractice: text(source.nextPractice),
      needsTeacherReview: true,
      reviewStatus: "dialogue_result_imported",
      archiveEligible: false,
      aiGenerated: true,
      available: true
    }
  };
}
