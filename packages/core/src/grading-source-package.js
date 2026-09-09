import { createHash } from "node:crypto";

export const GRADING_SOURCE_PACKAGE_SCHEMA_VERSION = "junhang-grading-source-v1";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeJsonValue(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(normalizeJsonValue).filter(hasMeaningfulValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, normalizeJsonValue(entry)])
        .filter(([, entry]) => hasMeaningfulValue(entry))
    );
  }
  return value;
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numberFromMetadata(metadata = {}, ...keys) {
  for (const key of keys) {
    const number = positiveNumber(metadata[key]);
    if (number != null) return number;
  }
  return null;
}

function answerForQuestion(item = {}, metadata = {}, answerKey = null, index = 0, questionNo = "") {
  const directAnswer = item.answer ?? metadata.answer ?? metadata.correctAnswer ?? metadata.standardAnswer;
  if (hasMeaningfulValue(directAnswer)) return normalizeJsonValue(directAnswer);
  if (Array.isArray(answerKey) && hasMeaningfulValue(answerKey[index])) return normalizeJsonValue(answerKey[index]);
  if (answerKey && typeof answerKey === "object") {
    const value = answerKey[questionNo] ?? answerKey[String(index + 1)];
    if (hasMeaningfulValue(value)) return normalizeJsonValue(value);
  }
  return "";
}

function analysisStepsForQuestion(item = {}, metadata = {}) {
  const configured = metadata.analysisSteps ?? item.analysisSteps ?? item.solutionSteps ?? item.steps;
  if (Array.isArray(configured)) return configured.map(normalizedText).filter(Boolean);
  if (configured != null) return String(configured).split(/\r?\n/).map(normalizedText).filter(Boolean);
  const rubric = item.rubric ?? metadata.rubric ?? metadata.analysis ?? "";
  const text = normalizedText(typeof rubric === "string" ? rubric : "");
  return text ? [text] : [];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprintFor(payload) {
  return `sha256:${createHash("sha256").update(stableJson(payload)).digest("hex")}`;
}

function sourcePayloadFromPackage(sourcePackage = {}) {
  const source = asRecord(sourcePackage);
  return {
    schemaVersion: normalizedText(source.schemaVersion),
    sourceId: normalizedText(source.sourceId),
    version: positiveNumber(source.version) || 1,
    title: normalizedText(source.title),
    subject: normalizedText(source.subject),
    kind: normalizedText(source.kind),
    grade: normalizedText(source.grade),
    totalScore: positiveNumber(source.totalScore),
    questions: Array.isArray(source.questions) ? source.questions : []
  };
}

export function validateGradingSourcePackage(sourcePackage = {}) {
  const source = asRecord(sourcePackage);
  const payload = sourcePayloadFromPackage(source);
  const issues = [];
  if (payload.schemaVersion !== GRADING_SOURCE_PACKAGE_SCHEMA_VERSION) issues.push("答案包版本不受支持。");
  if (!payload.sourceId) issues.push("答案包缺少来源 ID。");
  if (!payload.questions.length) issues.push("答案包至少需要一题。");
  if (source.fingerprint !== fingerprintFor(payload)) issues.push("答案包完整性指纹不匹配。");
  return { ok: issues.length === 0, issues };
}

export function buildGradingSourcePackage(assignment = {}, options = {}) {
  const metadata = asRecord(assignment.metadata);
  const answerKey = metadata.answerKey;
  const items = Array.isArray(assignment.items) ? assignment.items : [];
  const issues = [];
  const sourceId = normalizedText(assignment.id);
  if (!sourceId) issues.push("缺少生成内容来源 ID。");

  const questions = items.map((item, index) => {
    const itemMetadata = asRecord(item?.metadata);
    const questionNo = normalizedText(item?.orderIndex ?? index + 1) || String(index + 1);
    const prompt = normalizedText(item?.prompt);
    const correctAnswer = answerForQuestion(item, itemMetadata, answerKey, index, questionNo);
    const maxScore = numberFromMetadata(itemMetadata, "score", "points") ?? positiveNumber(item?.score) ?? positiveNumber(item?.points);
    const rubric = normalizeJsonValue(item?.rubric ?? itemMetadata.rubric ?? itemMetadata.analysis ?? "");
    const question = {
      questionNo,
      prompt,
      correctAnswer,
      maxScore,
      analysisSteps: analysisStepsForQuestion(item, itemMetadata),
      knowledgePoint: normalizedText(itemMetadata.knowledgePoint ?? itemMetadata.point ?? item?.knowledgePoint ?? item?.point),
      rubric: hasMeaningfulValue(rubric) ? rubric : ""
    };
    if (!prompt) issues.push(`第 ${questionNo} 题缺少题干。`);
    if (!hasMeaningfulValue(correctAnswer)) issues.push(`第 ${questionNo} 题缺少标准答案。`);
    if (maxScore == null) issues.push(`第 ${questionNo} 题分值必须大于 0。`);
    return question;
  });

  if (!questions.length) issues.push("至少需要一题才能建立批改答案包。");
  const questionNos = questions.map((question) => question.questionNo);
  if (new Set(questionNos).size !== questionNos.length) issues.push("题号不能重复。");

  const summedScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
  const declaredTotalScore = numberFromMetadata(metadata, "totalScore", "fullScore", "maxScore");
  const totalScore = declaredTotalScore ?? summedScore;
  if (declaredTotalScore != null && Math.abs(summedScore - declaredTotalScore) > 0.001) {
    issues.push(`题目分值合计 ${summedScore} 与总分 ${declaredTotalScore} 不一致。`);
  }

  const payload = {
    schemaVersion: GRADING_SOURCE_PACKAGE_SCHEMA_VERSION,
    sourceId,
    version: positiveNumber(options.version) || 1,
    title: normalizedText(assignment.title),
    subject: normalizedText(assignment.subject?.name ?? metadata.subject),
    kind: normalizedText(metadata.kind),
    grade: normalizedText(assignment.grade ?? metadata.grade ?? metadata.targetGrade),
    totalScore,
    questions
  };
  const packageWithFingerprint = {
    ...payload,
    fingerprint: fingerprintFor(payload)
  };

  return {
    ok: issues.length === 0,
    package: packageWithFingerprint,
    issues
  };
}

// Dialogue-generated answer files may contain useful review fields and a fingerprint
// produced by a different writer. Normalize only the grading contract, while returning
// the original identity and extensions for auditability.
export function normalizeImportedGradingSourcePackage(sourcePackage = {}, options = {}) {
  const source = asRecord(sourcePackage);
  const issues = [];
  const originalSourceId = normalizedText(source.sourceId);
  const originalFingerprint = normalizedText(source.fingerprint);
  const sourceId = normalizedText(options.sourceId || originalSourceId);
  if (source.schemaVersion !== GRADING_SOURCE_PACKAGE_SCHEMA_VERSION) issues.push("答案包版本不受支持。");
  if (!sourceId) issues.push("答案包缺少来源 ID。");
  const rawQuestions = Array.isArray(source.questions) ? source.questions : [];
  if (!rawQuestions.length) issues.push("答案包至少需要一题。");
  const extensions = {
    baseScore: source.baseScore,
    bonusScore: source.bonusScore,
    pages: source.pages,
    difficulty: source.difficulty,
    teacherReviewRequired: source.teacherReviewRequired,
    coverage: Array.isArray(source.coverage) ? source.coverage : [],
    questions: []
  };
  const questions = rawQuestions.map((item, index) => {
    const raw = asRecord(item);
    const questionNo = normalizedText(raw.questionNo ?? raw.no ?? raw.orderIndex ?? index + 1) || String(index + 1);
    const prompt = normalizedText(raw.prompt ?? raw.question ?? raw.printedPrompt);
    const correctAnswer = normalizeJsonValue(raw.correctAnswer ?? raw.answer ?? raw.standardAnswer ?? raw.expectedAnswer ?? "");
    const maxScore = numberFromMetadata(raw, "maxScore", "score", "points");
    const analysisSteps = analysisStepsForQuestion(raw, {});
    const knowledgePoint = normalizedText(raw.knowledgePoint ?? raw.point ?? raw.skill);
    const rubric = normalizeJsonValue(raw.rubric ?? "");
    const extension = {
      questionNo,
      commonMistake: normalizedText(raw.commonMistake),
      metadata: normalizeJsonValue(raw.metadata ?? {})
    };
    extensions.questions.push(extension);
    if (!prompt) issues.push(`第 ${questionNo} 题缺少题干。`);
    if (!hasMeaningfulValue(correctAnswer)) issues.push(`第 ${questionNo} 题缺少标准答案。`);
    if (maxScore == null || maxScore <= 0) issues.push(`第 ${questionNo} 题分值必须大于 0。`);
    return {
      questionNo,
      prompt,
      correctAnswer,
      maxScore,
      analysisSteps,
      knowledgePoint,
      rubric: hasMeaningfulValue(rubric) ? rubric : ""
    };
  });
  const questionNos = questions.map((question) => question.questionNo);
  if (new Set(questionNos).size !== questionNos.length) issues.push("题号不能重复。");
  const summedScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
  const declaredTotalScore = numberFromMetadata(source, "totalScore", "fullScore", "maxScore");
  if (declaredTotalScore != null && Math.abs(summedScore - declaredTotalScore) > 0.001) {
    issues.push(`题目分值合计 ${summedScore} 与总分 ${declaredTotalScore} 不一致。`);
  }
  const payload = {
    schemaVersion: GRADING_SOURCE_PACKAGE_SCHEMA_VERSION,
    sourceId,
    version: positiveNumber(source.version) || 1,
    title: normalizedText(source.title),
    subject: normalizedText(source.subject),
    kind: normalizedText(source.kind),
    grade: normalizedText(source.grade),
    totalScore: declaredTotalScore ?? summedScore,
    questions
  };
  const packageWithFingerprint = { ...payload, fingerprint: fingerprintFor(payload) };
  return {
    ok: issues.length === 0,
    package: packageWithFingerprint,
    issues,
    originalSourceId: originalSourceId || null,
    originalFingerprint: originalFingerprint || null,
    extensions
  };
}

export function gradingSourceQuestionMap(sourcePackage = {}) {
  const questions = Array.isArray(sourcePackage.questions) ? sourcePackage.questions : [];
  return new Map(questions.map((question) => [String(question.questionNo || ""), question]));
}
