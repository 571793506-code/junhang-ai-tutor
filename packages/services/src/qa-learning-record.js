const ACTOR_ROLES = new Set(["student", "classroom", "teacher"]);
const QA_MODES = new Set(["GUIDED_THINKING", "KNOWLEDGE_EXPLANATION"]);
const QUESTION_INTENTS = new Set(["concept", "method", "error_reasoning", "expression", "other"]);
const DIFFICULTY_SIGNALS = new Set(["none", "possible", "clear"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function approvedLearningSignal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const signal = value;
  return {
    knowledgePoints: stringList(signal.knowledgePoints),
    questionIntent: QUESTION_INTENTS.has(signal.questionIntent) ? signal.questionIntent : "other",
    difficultySignal: DIFFICULTY_SIGNALS.has(signal.difficultySignal) ? signal.difficultySignal : "none",
    misconceptionHypotheses: stringList(signal.misconceptionHypotheses),
    followUpNeeded: signal.followUpNeeded === true,
    confidence: CONFIDENCE_LEVELS.has(signal.confidence) ? signal.confidence : "low",
    safetyStatus: signal.safetyStatus === "pass" ? "pass" : "blocked"
  };
}

export function buildQaLearningRecord(input = {}, result = {}) {
  const actorRole = ACTOR_ROLES.has(input.actorRole) ? input.actorRole : "unknown";
  const identityConfirmed = input.identityConfirmed === true;
  const available = result.available === true;
  const mode = QA_MODES.has(result.mode) ? result.mode : "KNOWLEDGE_EXPLANATION";
  const signalPresent = result.learningSignal && typeof result.learningSignal === "object" && !Array.isArray(result.learningSignal);
  const learningSignal = approvedLearningSignal(result.learningSignal);
  const structureValid = result.structureValid === true;

  let blockedReason = null;
  if (actorRole !== "student" && actorRole !== "classroom") blockedReason = "teacher-test";
  else if (!identityConfirmed) blockedReason = "identity-unconfirmed";
  else if (!available) blockedReason = "model-unavailable";
  else if (signalPresent && learningSignal?.safetyStatus !== "pass") blockedReason = "unsafe-content";
  else if (!structureValid || !signalPresent) blockedReason = "malformed-output";

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
