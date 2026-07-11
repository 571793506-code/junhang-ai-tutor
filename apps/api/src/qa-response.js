import { sanitizeQaAnswer, sanitizeQaText } from "@junhang/services";

const ACTOR_ROLES = new Set(["student", "teacher", "classroom"]);
const QA_MODES = new Set(["GUIDED_THINKING", "KNOWLEDGE_EXPLANATION"]);
const VOICE_STATUSES = new Set([
  "ready",
  "queued",
  "pending",
  "processing",
  "completed",
  "failed",
  "unavailable",
  "error",
  "success"
]);

function qaAnswerSource(result) {
  const studentAnswer = Object.hasOwn(result, "studentAnswer") ? result.studentAnswer : undefined;
  if (typeof studentAnswer === "string" && !studentAnswer.trim()) return result.answer;
  return studentAnswer === undefined ? result.answer : studentAnswer;
}

function safeAudioUrl(value) {
  const text = sanitizeQaText(value, { maxLength: 2048 });
  if (!text || /[\s\\]/.test(text)) return null;
  if (/^\/(?!\/)/.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : null;
  } catch {
    return null;
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
      && Boolean(input.studentId);
  }

  return { actorRole, identityConfirmed };
}

export function cleanQaResultForClient(result = {}) {
  const answer = sanitizeQaAnswer(qaAnswerSource(result));
  return {
    available: result.available === true && answer.contentAvailable,
    mode: QA_MODES.has(result.mode) ? result.mode : "KNOWLEDGE_EXPLANATION",
    answer: answer.text
  };
}

export function cleanClassroomQaResultForClient({ qa = {}, transcript, voice = {} } = {}) {
  const status = sanitizeQaText(voice.status, { maxLength: 32 });
  const reason = sanitizeQaText(voice.reason, { maxLength: 240 });
  return {
    ...cleanQaResultForClient(qa),
    transcript: sanitizeQaText(transcript, { maxLength: 2000 }),
    voice: {
      available: voice.available === true,
      status: VOICE_STATUSES.has(status) ? status : null,
      audioUrl: safeAudioUrl(voice.audioUrl),
      reason: reason || null
    }
  };
}
