const VALID_STATUSES = new Set(["correct", "wrong", "partial", "uncertain"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function hasValue(value) {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > 0);
}

function clone(value) {
  return structuredClone(value);
}

function validateConfirmation(caseValue, location, issues, normalized) {
  const teacherReview = record(caseValue.teacherReview);
  const confirmedBy = text(teacherReview.confirmedBy);
  if (!confirmedBy) issues.push(`${location}.teacherReview.confirmedBy is required`);

  const confirmedAt = text(teacherReview.confirmedAt);
  const parsedAt = new Date(confirmedAt);
  if (!ISO_TIMESTAMP.test(confirmedAt) || Number.isNaN(parsedAt.getTime())) {
    issues.push(`${location}.teacherReview.confirmedAt must be a valid ISO timestamp`);
  }

  if (!Array.isArray(teacherReview.modifiedQuestionNos)) {
    issues.push(`${location}.teacherReview.modifiedQuestionNos must be an array`);
  }

  normalized.teacherReview = {
    ...teacherReview,
    confirmedBy: confirmedBy || null,
    confirmedAt: !Number.isNaN(parsedAt.getTime()) ? parsedAt.toISOString() : confirmedAt || null,
    modifiedQuestionNos: Array.isArray(teacherReview.modifiedQuestionNos)
      ? [...new Set(teacherReview.modifiedQuestionNos.map(text).filter(Boolean))]
      : []
  };
}

function validateExpectedQuestions(caseValue, location, issues, normalized) {
  const expected = record(caseValue.expected);
  const questionResults = expected.questionResults;
  if (!Array.isArray(questionResults) || questionResults.length === 0) {
    issues.push(`${location}.expected.questionResults must contain at least one question`);
    normalized.expected = { ...expected, questionResults: [] };
    return;
  }

  const questionNos = new Set();
  normalized.expected = { ...expected, questionResults: [] };
  for (const [index, questionValue] of questionResults.entries()) {
    const question = record(questionValue);
    const questionLocation = `${location}.expected.questionResults[${index}]`;
    const questionNo = text(question.questionNo);
    const status = text(question.status).toLowerCase();
    if (!questionNo) issues.push(`${questionLocation}.questionNo is required`);
    if (questionNo && questionNos.has(questionNo)) issues.push(`${questionLocation}.questionNo is duplicated`);
    if (questionNo) questionNos.add(questionNo);
    if (!VALID_STATUSES.has(status)) issues.push(`${questionLocation}.status has invalid status`);

    const answer = question.correctAnswer ?? question.answer;
    const reason = question.reason ?? question.uncertainReason ?? question.explanation;
    if (status === "uncertain") {
      if (!hasValue(reason)) issues.push(`${questionLocation} uncertain status requires an uncertain reason`);
    } else if (!hasValue(answer)) {
      issues.push(`${questionLocation} requires a teacher-confirmed answer`);
    }

    normalized.expected.questionResults.push({
      ...question,
      questionNo: questionNo || null,
      status: status || null
    });
  }
}

export function validateGradingGoldCases(cases = []) {
  const issues = [];
  const normalizedCases = [];
  const caseIds = new Set();

  if (!Array.isArray(cases)) {
    return { ok: false, issues: ["gold cases must be an array"], normalizedCases: [] };
  }

  for (const [index, value] of cases.entries()) {
    const location = `cases[${index}]`;
    const source = record(value);
    const normalized = clone(source);
    const caseId = text(source.caseId);
    const sourceType = text(source.sourceType);
    if (!caseId) issues.push(`${location}.caseId is required`);
    if (caseId && caseIds.has(caseId)) issues.push(`${location} duplicate caseId ${caseId}`);
    if (caseId) caseIds.add(caseId);
    if (!sourceType) issues.push(`${location}.sourceType is required`);
    if (!source.input || typeof source.input !== "object" || Array.isArray(source.input)) {
      issues.push(`${location}.input must be an object`);
    }
    if (!source.expected || typeof source.expected !== "object" || Array.isArray(source.expected)) {
      issues.push(`${location}.expected must be an object`);
    }
    if (!source.teacherReview || typeof source.teacherReview !== "object" || Array.isArray(source.teacherReview)) {
      issues.push(`${location}.teacherReview must be an object`);
    }

    normalized.caseId = caseId || null;
    normalized.sourceType = sourceType || null;
    validateExpectedQuestions(source, location, issues, normalized);
    validateConfirmation(source, location, issues, normalized);
    normalizedCases.push(normalized);
  }

  return { ok: issues.length === 0, issues, normalizedCases };
}
