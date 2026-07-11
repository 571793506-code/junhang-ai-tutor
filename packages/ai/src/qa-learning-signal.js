export const QA_LEARNING_SIGNAL_SCHEMA_VERSION = "qa-learning-signal-v1";
export const QA_UNAVAILABLE_ANSWER = "AI 问答暂时不可用，请稍后再试。";
export const QA_BLOCKED_ANSWER = "这个问题暂时不能直接回答，请换一种安全、清楚的方式提问。";

const QUESTION_INTENTS = new Set(["concept", "method", "error_reasoning", "expression", "other"]);
const DIFFICULTY_SIGNALS = new Set(["none", "possible", "clear"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const SAFETY_STATUSES = new Set(["pass", "blocked"]);
const INTERNAL_FIELD_LINE = /^\s*(?:provider|model|raw|prompt|debug)\s*[=:：＝]/i;
const INTERNAL_FIELD_FRAGMENT = /\s*(?:[,;，；]\s*)?(?:provider|model|raw|prompt|debug)\s*[=:：＝][\s\S]*$/i;
const QUOTED_ALWAYS_INTERNAL_LINE = /^\s*["'](?:debug|prompt|raw)["']\s*[=:：＝]/i;
const QUOTED_ALWAYS_INTERNAL_FRAGMENT = /\s*(?:[,;，；]\s*)?["'](?:debug|prompt|raw)["']\s*[=:：＝][\s\S]*$/i;
const QUOTED_ROUTE_INTERNAL_LINE = /^\s*["'](?:provider|model)["']\s*[=:：＝]\s*["']?\s*(?:gpt(?:-\d)?|terra|sol|deepseek|minimax|openai|https?:\/\/|wss?:\/\/|[\[{])/i;
const QUOTED_ROUTE_INTERNAL_FRAGMENT = /\s*(?:[,;，；]\s*)?["'](?:provider|model)["']\s*[=:：＝]\s*["']?\s*(?:gpt(?:-\d)?|terra|sol|deepseek|minimax|openai|https?:\/\/|wss?:\/\/|[\[{])[\s\S]*$/i;
const STRUCTURE_FIELD_LINE = /^\s*"?(?:studentAnswer|learningSignal|knowledgePoints|questionIntent|difficultySignal|misconceptionHypotheses|followUpNeeded|confidence|safetyStatus|profileEligibility|blockedReason)"?\s*[:=]/i;
const BLOCKED_STATUS = /(?:^|[\s"'<{,])safetyStatus["']?\s*[:=]\s*["']?blocked\b/i;
const JSON_CODE_FENCE = /```\s*json\b/i;
const KNOWN_SCHEMA_LABEL = /\b(?:studentAnswer|learningSignal|knowledgePoints|questionIntent|difficultySignal|misconceptionHypotheses|followUpNeeded|confidence|safetyStatus|profileEligibility|blockedReason)\b["']?\s*[=:：＝]/i;
const UNQUOTED_INTERNAL_LABEL = /(?:^|[\s,;，；])(?:provider|model|raw|prompt|debug)\s*[=:：＝]/i;
const OLD_ANSWER_ALIAS_LABEL = /(?:^|[\s{,])["']answer["']\s*[=:：＝]/i;
const MAX_EMBEDDED_JSON_CANDIDATES = 256;
const MAX_EMBEDDED_JSON_SCAN_WORK = 65536;
const SCAN_WORK_EXHAUSTED = -2;

function toWellFormedText(value) {
  return String(value || "").toWellFormed();
}

function trimAndCap(value, maxLength) {
  if (typeof value !== "string") return "";
  return Array.from(value.toWellFormed().trim()).slice(0, maxLength).join("");
}

function stripCodeFences(value) {
  return toWellFormedText(value)
    .replace(/^\s*```[^\r\n]*\r?\n?/i, "")
    .replace(/\r?\n?\s*```\s*$/i, "");
}

function isJsonValue(value) {
  if (!value) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function isJsonContainerValue(value) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

function findBalancedContainerEnd(value, start, work) {
  const stack = [value[start]];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < value.length; index += 1) {
    work.used += 1;
    if (work.used > MAX_EMBEDDED_JSON_SCAN_WORK) return SCAN_WORK_EXHAUSTED;
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expectedOpen = character === "}" ? "{" : "[";
    if (stack.at(-1) !== expectedOpen) return -1;
    stack.pop();
    if (stack.length === 0) return index;
  }
  return -1;
}

function hasEmbeddedJsonContainer(value, work) {
  let candidateCount = 0;
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== "{" && value[start] !== "[") continue;
    candidateCount += 1;
    if (candidateCount > MAX_EMBEDDED_JSON_CANDIDATES) return true;
    const end = findBalancedContainerEnd(value, start, work);
    if (end === SCAN_WORK_EXHAUSTED) return true;
    if (end < 0) continue;
    try {
      const parsed = JSON.parse(value.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return true;
    } catch {
      // Each later opening index is still evaluated independently.
    }
  }
  return false;
}

function hasEncodedStructuredString(value, work) {
  let start = -1;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === '"') start = index;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    try {
      const decoded = JSON.parse(value.slice(start, index + 1));
      if (typeof decoded === "string" && containsRestrictedStructure(
        decoded,
        { level: "nested", includeEncoded: false },
        work
      )) return true;
    } catch {
      // Invalid JSON string literals are not decoded or inspected as structured output.
    }
    start = -1;
    escaped = false;
  }
  return false;
}

function containsRestrictedStructure(value, options = {}, work = { used: 0 }) {
  const { level = "top", includeEncoded = true } = options;
  const source = stripCodeFences(value).trim();
  return (level === "top" ? isJsonValue(source) : isJsonContainerValue(source))
    || hasEmbeddedJsonContainer(source, work)
    || (includeEncoded && hasEncodedStructuredString(source, work))
    || JSON_CODE_FENCE.test(source)
    || KNOWN_SCHEMA_LABEL.test(source)
    || (level === "top" && OLD_ANSWER_ALIAS_LABEL.test(source))
    || UNQUOTED_INTERNAL_LABEL.test(source)
    || QUOTED_ALWAYS_INTERNAL_FRAGMENT.test(source)
    || QUOTED_ROUTE_INTERNAL_FRAGMENT.test(source);
}

function sanitizeRestrictedText(value, maxLength) {
  if (typeof value !== "string") return "";
  const source = stripCodeFences(value);
  const restricted = containsRestrictedStructure(source, { level: "nested" });
  const text = source
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<\/?(?:studentAnswer|learningSignal)>/gi, "")
    .replace(QUOTED_ALWAYS_INTERNAL_FRAGMENT, "")
    .replace(QUOTED_ROUTE_INTERNAL_FRAGMENT, "")
    .replace(INTERNAL_FIELD_FRAGMENT, "")
    .trim();
  if (restricted && containsRestrictedStructure(text, { level: "nested" })) return "";
  return trimAndCap(text, maxLength);
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
  const restricted = containsRestrictedStructure(source, { level: "nested" });
  const extracted = extractMalformedStudentAnswer(source);
  const candidate = extracted || source;
  const lines = candidate
    .replace(/<\/?(?:studentAnswer|learningSignal)>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_FIELD_LINE.test(line))
    .filter((line) => !QUOTED_ALWAYS_INTERNAL_LINE.test(line))
    .filter((line) => !QUOTED_ROUTE_INTERNAL_LINE.test(line))
    .filter((line) => extracted || !STRUCTURE_FIELD_LINE.test(line))
    .filter((line) => !/^\s*[{}\[\],]+\s*$/.test(line))
    .map((line) => line
      .replace(QUOTED_ALWAYS_INTERNAL_FRAGMENT, "")
      .replace(QUOTED_ROUTE_INTERNAL_FRAGMENT, "")
      .replace(INTERNAL_FIELD_FRAGMENT, "")
      .trim())
    .filter(Boolean);
  const answer = trimAndCap(lines.join("\n"), 2000);
  if (restricted && containsRestrictedStructure(answer, { level: "nested" })) return "";
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
  const source = toWellFormedText(text);
  const parsed = parseJsonObject(source);
  const structuredSource = containsRestrictedStructure(source);
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
