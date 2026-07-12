const ACTOR_ROLES = new Set(["student", "classroom", "teacher"]);
const QA_MODES = new Set(["GUIDED_THINKING", "KNOWLEDGE_EXPLANATION"]);
const QUESTION_INTENTS = new Set(["concept", "method", "error_reasoning", "expression", "other"]);
const DIFFICULTY_SIGNALS = new Set(["none", "possible", "clear"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const INTERNAL_LABEL = /(?:^|[\s,;，；([{])["']?(?:provider(?:Id)?|model|raw|prompt|debug)["']?\s*[:=：＝]/i;
const DISTINCT_PROJECT_IDENTIFIER = /\b(?:gpt(?:[-\s]?5[.-]6|56)|openai|deepseek)\b/i;
const MINIMAX_BRAND = /\bMiniMax\b/;
const CONTEXTUAL_PROJECT_IDENTIFIER = /(?:\b(?:provider|model|route|runtime)\s*(?::|=)?\s*(?:terra|sol|minimax)\b|\b(?:terra|sol|minimax)\s+(?:provider|model|route|runtime)\b|\b(?:generated|powered)\s+by\s+(?:terra|sol|minimax)\b|\bresponse\s+from\s+(?:terra|sol|minimax)\b|\brouted\s+through\s+(?:the\s+)?(?:terra|sol|minimax)\b|\b(?:terra|sol|minimax)\s+(?:timeout|unavailable)\b|\b(?:timeout|unavailable)\s+(?:from|for|on)\s+(?:terra|sol|minimax)\b)/i;
const KNOWN_INTERNAL_OBJECT_KEY = /["'](?:content|answer|studentAnswer|provider|providerId|model|raw|prompt|debug|learningSignal|profileEligibility|blockedReason|structureValid|modelRun|metadata)["']\s*:/i;
const GENERIC_JSON_OBJECT_OPENING = /\{\s*"(?:\\.|[^"\\\r\n])*"\s*:/;
const HALF_OPEN_INTERVAL = /^\[\s*(?:[A-Za-z]|-?(?:0|[1-9]\d*)(?:\.\d+)?)\s*,\s*(?:[A-Za-z]|-?(?:0|[1-9]\d*)(?:\.\d+)?)\s*\)/;
const STRUCTURED_ARRAY_TOKEN = /\b(?:true|false|null|NaN|Infinity)\b/;
const JSON_NUMBER_FIRST = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=\s*(?:,|\]|$))/;
const PRIME_CARRIER = /[\p{L}\p{N}\p{M}_)\]']/u;
const QA_UNAVAILABLE_ANSWER = "AI 问答暂时不可用，请稍后再试。";
const REQUIRED_SIGNAL_FIELDS = [
  "knowledgePoints",
  "questionIntent",
  "difficultySignal",
  "misconceptionHypotheses",
  "followUpNeeded",
  "confidence",
  "safetyStatus"
];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumericVector(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isFiniteNumericMatrix(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((row) => isFiniteNumericVector(row));
}

function malformedArrayIsUnsafe(source, complete) {
  const inner = source.slice(1, complete ? -1 : undefined).trim();
  if (complete && !inner) return true;
  if (STRUCTURED_ARRAY_TOKEN.test(inner)) return true;
  if (/["{\[]/.test(inner)) return true;
  return JSON_NUMBER_FIRST.test(inner);
}

function inspectArrayAt(value, start) {
  let depth = 0;
  let inString = false;
  let stringQuote = null;
  let escaped = false;
  let containsString = false;
  let containsObject = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }
    const startsString = character === '"'
      || (character === "'" && !PRIME_CARRIER.test(value[index - 1] || ""));
    if (startsString) {
      containsString = true;
      inString = true;
      stringQuote = character;
      continue;
    }
    if (character === "{") containsObject = true;
    if (character === "[") {
      depth += 1;
      if (depth > 2) return { unsafe: true, end: index };
      continue;
    }
    if (character !== "]") continue;
    depth -= 1;
    if (depth !== 0) continue;

    const source = value.slice(start, index + 1);
    if (containsString || containsObject) return { unsafe: true, end: index };
    try {
      const parsed = JSON.parse(source);
      return {
        unsafe: !isFiniteNumericVector(parsed) && !isFiniteNumericMatrix(parsed),
        end: index
      };
    } catch {
      return { unsafe: malformedArrayIsUnsafe(source, true), end: index };
    }
  }

  const source = value.slice(start);
  return {
    unsafe: containsString
      || containsObject
      || depth > 1
      || malformedArrayIsUnsafe(source, false),
    end: value.length - 1
  };
}

function hasUnsafeArrayContent(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "[") continue;
    const interval = value.slice(index).match(HALF_OPEN_INTERVAL);
    if (interval) {
      index += interval[0].length - 1;
      continue;
    }
    const inspected = inspectArrayAt(value, index);
    if (inspected.unsafe) return true;
    index = inspected.end;
  }
  return false;
}

function hasProjectIdentifier(value) {
  return DISTINCT_PROJECT_IDENTIFIER.test(value)
    || MINIMAX_BRAND.test(value)
    || CONTEXTUAL_PROJECT_IDENTIFIER.test(value);
}

function sanitizeQaTextDetailed(value, { maxLength = 2000, rejectInternal = true } = {}) {
  if (typeof value !== "string") return { text: "", unchanged: false };
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) return { text: "", unchanged: false };
  const inspectionCodeUnits = Math.min(value.length, maxLength * 2 + 128);
  const boundedSource = value.slice(0, inspectionCodeUnits);
  const wellFormed = boundedSource.toWellFormed();
  const normalized = wellFormed.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!normalized) return { text: "", unchanged: false };
  if (rejectInternal && (
    INTERNAL_LABEL.test(normalized)
    || KNOWN_INTERNAL_OBJECT_KEY.test(normalized)
    || GENERIC_JSON_OBJECT_OPENING.test(normalized)
    || hasUnsafeArrayContent(normalized)
    || hasProjectIdentifier(normalized)
  )) {
    return { text: "", unchanged: false };
  }
  const codePoints = Array.from(normalized);
  return {
    text: codePoints.slice(0, maxLength).join(""),
    unchanged: value.length === inspectionCodeUnits
      && boundedSource === wellFormed
      && wellFormed === normalized
      && codePoints.length <= maxLength
  };
}

export function sanitizeQaText(value, options = {}) {
  return sanitizeQaTextDetailed(value, options).text;
}

export function sanitizeQaAnswer(value) {
  const text = sanitizeQaText(value, { maxLength: 2000 });
  return text
    ? { text, contentAvailable: true }
    : { text: QA_UNAVAILABLE_ANSWER, contentAvailable: false };
}

function sanitizeSignalList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return { items: [], valid: false };
  const items = [];
  const declaredLength = value.length;
  const inspectedLength = Number.isSafeInteger(declaredLength) && declaredLength >= 0
    ? Math.min(declaredLength, maxItems)
    : 0;
  let valid = declaredLength <= maxItems;
  for (let index = 0; index < inspectedLength; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== "string") {
      valid = false;
      continue;
    }
    const sanitized = sanitizeQaTextDetailed(value[index], { maxLength });
    if (!sanitized.text) {
      valid = false;
      continue;
    }
    if (!sanitized.unchanged) valid = false;
    if (items.length < maxItems) items.push(sanitized.text);
    else valid = false;
  }
  return { items, valid };
}

function approvedLearningSignal(value) {
  if (!isPlainObject(value)) return { signal: null, valid: false, explicitlyBlocked: false };
  let valid = REQUIRED_SIGNAL_FIELDS.every((field) => Object.hasOwn(value, field));
  const knowledgePoints = sanitizeSignalList(value.knowledgePoints, 8, 80);
  const misconceptionHypotheses = sanitizeSignalList(value.misconceptionHypotheses, 5, 160);
  valid = valid && knowledgePoints.valid && misconceptionHypotheses.valid;
  if (!QUESTION_INTENTS.has(value.questionIntent)) valid = false;
  if (!DIFFICULTY_SIGNALS.has(value.difficultySignal)) valid = false;
  if (typeof value.followUpNeeded !== "boolean") valid = false;
  if (!CONFIDENCE_LEVELS.has(value.confidence)) valid = false;
  if (value.safetyStatus !== "pass" && value.safetyStatus !== "blocked") valid = false;
  return {
    signal: {
      knowledgePoints: knowledgePoints.items,
      questionIntent: QUESTION_INTENTS.has(value.questionIntent) ? value.questionIntent : "other",
      difficultySignal: DIFFICULTY_SIGNALS.has(value.difficultySignal) ? value.difficultySignal : "none",
      misconceptionHypotheses: misconceptionHypotheses.items,
      followUpNeeded: value.followUpNeeded === true,
      confidence: CONFIDENCE_LEVELS.has(value.confidence) ? value.confidence : "low",
      safetyStatus: value.safetyStatus === "pass" ? "pass" : "blocked"
    },
    valid,
    explicitlyBlocked: Object.hasOwn(value, "safetyStatus") && value.safetyStatus === "blocked"
  };
}

export function buildQaLearningRecord(input = {}, result = {}) {
  const actorRole = ACTOR_ROLES.has(input.actorRole) ? input.actorRole : "unknown";
  const identityConfirmed = input.identityConfirmed === true;
  const available = result.available === true;
  const mode = QA_MODES.has(result.mode) ? result.mode : "KNOWLEDGE_EXPLANATION";
  const approvedSignal = approvedLearningSignal(result.learningSignal);
  const learningSignal = approvedSignal.signal;
  const structureValid = result.structureValid === true;

  let blockedReason = null;
  if (actorRole !== "student" && actorRole !== "classroom") blockedReason = "teacher-test";
  else if (!identityConfirmed) blockedReason = "identity-unconfirmed";
  else if (!available) blockedReason = "model-unavailable";
  else if (approvedSignal.explicitlyBlocked) blockedReason = "unsafe-content";
  else if (!structureValid || !approvedSignal.valid) blockedReason = "malformed-output";

  return {
    actorRole,
    identityConfirmed,
    available,
    mode,
    learningSignal,
    profileEligibility: blockedReason === null,
    blockedReason,
    schemaVersion: "qa-learning-signal-v1"
  };
}
