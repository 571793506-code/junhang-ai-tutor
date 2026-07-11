export const QA_LEARNING_SIGNAL_SCHEMA_VERSION = "qa-learning-signal-v1";
export const QA_UNAVAILABLE_ANSWER = "AI 问答暂时不可用，请稍后再试。";
export const QA_BLOCKED_ANSWER = "这个问题暂时不能直接回答，请换一种安全、清楚的方式提问。";

const QUESTION_INTENTS = new Set(["concept", "method", "error_reasoning", "expression", "other"]);
const DIFFICULTY_SIGNALS = new Set(["none", "possible", "clear"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const SAFETY_STATUSES = new Set(["pass", "blocked"]);
const INTERNAL_FIELD_LINE = /^\s*"?(?:provider|model|raw|prompt|debug)"?\s*[:=]/i;
const INTERNAL_FIELD_FRAGMENT = /\s*(?:[,;，；]\s*)?"?(?:provider|model|raw|prompt|debug)"?\s*[:=][\s\S]*$/i;
const STRUCTURE_FIELD_LINE = /^\s*"?(?:studentAnswer|learningSignal|knowledgePoints|questionIntent|difficultySignal|misconceptionHypotheses|followUpNeeded|confidence|safetyStatus|profileEligibility|blockedReason)"?\s*[:=]/i;
const BLOCKED_STATUS = /(?:^|[\s"'<{,])safetyStatus["']?\s*[:=]\s*["']?blocked\b/i;

function trimAndCap(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stripCodeFences(value) {
  return String(value || "")
    .replace(/^\s*```[^\r\n]*\r?\n?/i, "")
    .replace(/\r?\n?\s*```\s*$/i, "");
}

function sanitizeRestrictedText(value, maxLength) {
  if (typeof value !== "string") return "";
  const text = stripCodeFences(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<\/?(?:studentAnswer|learningSignal)>/gi, "")
    .replace(INTERNAL_FIELD_FRAGMENT, "")
    .trim();
  return text.slice(0, maxLength);
}

function extractMalformedStudentAnswer(source) {
  const match = source.match(/"studentAnswer"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return "";
  }
}

function sanitizeStudentAnswer(value) {
  const source = stripCodeFences(value).trim();
  const extracted = extractMalformedStudentAnswer(source);
  const candidate = extracted || source;
  const lines = candidate
    .replace(/<\/?(?:studentAnswer|learningSignal)>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_FIELD_LINE.test(line))
    .filter((line) => extracted || !STRUCTURE_FIELD_LINE.test(line))
    .filter((line) => !/^\s*[{}\[\],]+\s*$/.test(line))
    .map((line) => line.replace(INTERNAL_FIELD_FRAGMENT, "").trim())
    .filter(Boolean);
  const answer = trimAndCap(lines.join("\n"), 2000);
  return /[\p{L}\p{N}]/u.test(answer) ? answer : "";
}

function parseJsonObject(text) {
  const source = stripCodeFences(text).trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => sanitizeRestrictedText(item, maxLength))
    .filter(Boolean);
}

export function unavailableQaOutput(_reason) {
  return {
    studentAnswer: QA_UNAVAILABLE_ANSWER,
    learningSignal: null,
    structureValid: false
  };
}

export function normalizeQaModelOutput(text) {
  const source = String(text || "");
  const parsed = parseJsonObject(source);
  const strippedSource = stripCodeFences(source).trimStart();
  const structuredSource = strippedSource.startsWith("{") || strippedSource.startsWith("[");
  const signal = parsed?.learningSignal;
  const structureValid = typeof parsed?.studentAnswer === "string"
    && signal
    && typeof signal === "object"
    && !Array.isArray(signal);

  if (!structureValid) {
    if (BLOCKED_STATUS.test(source)) {
      return {
        studentAnswer: QA_BLOCKED_ANSWER,
        learningSignal: null,
        structureValid: false
      };
    }
    if (structuredSource) return unavailableQaOutput("malformed-structured-output");
    const fallbackAnswer = sanitizeStudentAnswer(source);
    return fallbackAnswer
      ? { studentAnswer: fallbackAnswer, learningSignal: null, structureValid: false }
      : unavailableQaOutput("malformed-output");
  }

  const questionIntent = QUESTION_INTENTS.has(signal.questionIntent) ? signal.questionIntent : "other";
  const difficultySignal = DIFFICULTY_SIGNALS.has(signal.difficultySignal) ? signal.difficultySignal : "none";
  const confidence = CONFIDENCE_LEVELS.has(signal.confidence) ? signal.confidence : "low";
  const safetyStatus = SAFETY_STATUSES.has(signal.safetyStatus) ? signal.safetyStatus : "blocked";
  const sanitizedAnswer = sanitizeStudentAnswer(parsed.studentAnswer);
  const blocked = safetyStatus === "blocked";
  const studentAnswer = blocked
    ? QA_BLOCKED_ANSWER
    : sanitizedAnswer || QA_UNAVAILABLE_ANSWER;

  return {
    studentAnswer,
    learningSignal: {
      knowledgePoints: normalizeStringArray(signal.knowledgePoints, 8, 80),
      questionIntent,
      difficultySignal,
      misconceptionHypotheses: normalizeStringArray(signal.misconceptionHypotheses, 5, 160),
      followUpNeeded: signal.followUpNeeded === true,
      confidence,
      safetyStatus,
      profileEligibility: !blocked && sanitizedAnswer !== "" && signal.profileEligibility === true,
      blockedReason: blocked ? sanitizeRestrictedText(signal.blockedReason, 160) || null : null
    },
    structureValid: true
  };
}
