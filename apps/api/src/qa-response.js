import { normalizeDisplayText } from "@junhang/core";

const ACTOR_ROLES = new Set(["student", "teacher", "classroom"]);
const QA_MODES = new Set(["GUIDED_THINKING", "KNOWLEDGE_EXPLANATION"]);
const DEFAULT_ANSWER = "AI 问答已收到，老师稍后会协助复核。";

function displayText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = normalizeDisplayText(value).trim();
  return text && !/\?{2,}/.test(text) ? text : fallback;
}

function displayAnswer(value) {
  const text = displayText(value, "");
  if (!text) return DEFAULT_ANSWER;
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!jsonText.startsWith("{") && !jsonText.startsWith("[")) return text;
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_ANSWER;
    return displayText(parsed.content || parsed.answer || parsed.text, DEFAULT_ANSWER);
  } catch {
    return DEFAULT_ANSWER;
  }
}

export function buildQaActorContext(session = {}, input = {}, options = {}) {
  const actorRole = ACTOR_ROLES.has(session?.role) ? session.role : "unknown";
  let identityConfirmed = false;

  if (actorRole === "student") {
    identityConfirmed = Boolean(session.studentId)
      && Boolean(input.studentId)
      && session.studentId === input.studentId;
  } else if (actorRole === "classroom") {
    identityConfirmed = options.classroomStudentConfirmed === true
      && Boolean(session.deviceId)
      && Boolean(input.deviceId)
      && session.deviceId === input.deviceId
      && Boolean(input.studentId);
  }

  return { actorRole, identityConfirmed };
}

export function cleanQaResultForClient(result = {}) {
  const answerSource = displayText(result.studentAnswer, "") ? result.studentAnswer : result.answer;
  return {
    available: result.available === true,
    mode: QA_MODES.has(result.mode) ? result.mode : "KNOWLEDGE_EXPLANATION",
    answer: displayAnswer(answerSource)
  };
}

export function cleanClassroomQaResultForClient({ qa = {}, transcript, voice = {} } = {}) {
  return {
    ...cleanQaResultForClient(qa),
    transcript: displayText(transcript, ""),
    voice: {
      available: voice.available === true,
      status: displayText(voice.status, "") || null,
      audioUrl: displayText(voice.audioUrl, "") || null,
      reason: displayText(voice.reason, "") || null
    }
  };
}
