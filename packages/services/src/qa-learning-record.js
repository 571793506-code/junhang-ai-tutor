const ACTOR_ROLES = new Set(["student", "classroom", "teacher"]);
const QA_MODES = new Set(["GUIDED_THINKING", "KNOWLEDGE_EXPLANATION"]);
const QUESTION_INTENTS = new Set(["concept", "method", "error_reasoning", "expression", "other"]);
const DIFFICULTY_SIGNALS = new Set(["none", "possible", "clear"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const INTERNAL_LABEL = /(?:^|[\s,;，；([{])["']?(?:provider|model|raw|prompt|debug)["']?\s*[:=：＝]/i;
const DISTINCT_PROJECT_IDENTIFIER = /\b(?:gpt[-\s]?5[.-]6|openai|deepseek)\b/i;
const MINIMAX_BRAND = /\bMiniMax\b/;
const PROVIDER_CONTEXT = "provider|model|api|route|routed|routing|response|runtime|generated|powered|unavailable|timeout|failed";
const CONTEXTUAL_PROJECT_IDENTIFIER = new RegExp(
  `(?:\\b(?:${PROVIDER_CONTEXT})\\b[\\s\\S]{0,32}\\b(?:terra|sol|minimax)\\b|` +
  `\\b(?:terra|sol|minimax)\\b[\\s\\S]{0,32}\\b(?:${PROVIDER_CONTEXT})\\b)`,
  "i"
);
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

function hasEmbeddedJson(value) {
  let candidates = 0;
  let work = 0;
  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start];
    if (opening !== "{" && opening !== "[") continue;
    candidates += 1;
    if (candidates > 64) return true;
    const stack = [opening];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < value.length; index += 1) {
      work += 1;
      if (work > 65536) return true;
      const character = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
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
      const expected = character === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) break;
      stack.pop();
      if (stack.length !== 0) continue;
      try {
        JSON.parse(value.slice(start, index + 1));
        return true;
      } catch {
        break;
      }
    }
  }
  return false;
}

function hasProjectIdentifier(value) {
  return DISTINCT_PROJECT_IDENTIFIER.test(value)
    || MINIMAX_BRAND.test(value)
    || CONTEXTUAL_PROJECT_IDENTIFIER.test(value);
}

export function sanitizeQaText(value, { maxLength = 2000, rejectInternal = true } = {}) {
  if (typeof value !== "string") return "";
  const text = value
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  if (!text) return "";
  if (rejectInternal && (INTERNAL_LABEL.test(text) || hasProjectIdentifier(text) || hasEmbeddedJson(text))) return "";
  return Array.from(text).slice(0, maxLength).join("");
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
    const source = value[index].toWellFormed().replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    const sanitized = sanitizeQaText(value[index], { maxLength });
    if (!sanitized) {
      valid = false;
      continue;
    }
    if (sanitized !== source || value[index] !== value[index].toWellFormed()) valid = false;
    if (items.length < maxItems) items.push(sanitized);
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
