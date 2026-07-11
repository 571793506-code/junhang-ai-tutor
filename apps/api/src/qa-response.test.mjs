import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildQaActorContext,
  cleanClassroomQaResultForClient,
  cleanQaResultForClient
} from "./qa-response.js";

test("buildQaActorContext confirms only a matching student session", () => {
  assert.deepEqual(
    buildQaActorContext({ role: "student", studentId: "s1" }, { studentId: "s1", actorRole: "teacher", identityConfirmed: false }),
    { actorRole: "student", identityConfirmed: true }
  );
  assert.deepEqual(
    buildQaActorContext({ role: "student", studentId: "s1" }, { studentId: "s2" }),
    { actorRole: "student", identityConfirmed: false }
  );
  assert.deepEqual(
    buildQaActorContext({ role: "student", studentId: "s1" }, {}),
    { actorRole: "student", identityConfirmed: false }
  );
});

test("buildQaActorContext never confirms teacher testing as a learner", () => {
  assert.deepEqual(
    buildQaActorContext({ role: "teacher", teacherId: "t1" }, { studentId: "s1", actorRole: "student", identityConfirmed: true }),
    { actorRole: "teacher", identityConfirmed: false }
  );
});

test("buildQaActorContext confirms classroom identity only after scoped student confirmation", () => {
  assert.deepEqual(
    buildQaActorContext(
      { role: "classroom", deviceId: "d1" },
      { deviceId: "d1", studentId: "s1" },
      { classroomStudentConfirmed: true }
    ),
    { actorRole: "classroom", identityConfirmed: true }
  );

  for (const [session, input, options] of [
    [{ role: "classroom", deviceId: "d1" }, { deviceId: "d1" }, { classroomStudentConfirmed: true }],
    [{ role: "classroom", deviceId: "d1" }, { deviceId: "d2", studentId: "s1" }, { classroomStudentConfirmed: true }],
    [{ role: "classroom", deviceId: "d1" }, { deviceId: "d1", studentId: "s1" }, { classroomStudentConfirmed: false }],
    [{ role: "classroom" }, { deviceId: "d1", studentId: "s1" }, { classroomStudentConfirmed: true }]
  ]) {
    assert.deepEqual(buildQaActorContext(session, input, options), {
      actorRole: "classroom",
      identityConfirmed: false
    });
  }
});

test("buildQaActorContext derives unknown roles only from the session", () => {
  assert.deepEqual(
    buildQaActorContext({ role: "admin" }, { actorRole: "student", identityConfirmed: true, studentId: "s1" }),
    { actorRole: "unknown", identityConfirmed: false }
  );
});

test("cleanQaResultForClient returns the exact learner response whitelist", () => {
  const result = cleanQaResultForClient({
    available: true,
    mode: "KNOWLEDGE_EXPLANATION",
    studentAnswer: "  安全回答  ",
    answer: "不应优先",
    providerId: "secret-provider",
    model: "secret-model",
    raw: "secret-raw",
    error: "secret-error",
    learningSignal: { provider: "secret-provider" },
    profileEligibility: true,
    blockedReason: null,
    persisted: { qaSessionId: "secret-id" },
    unknown: "secret-unknown"
  });

  assert.deepEqual(result, {
    available: true,
    mode: "KNOWLEDGE_EXPLANATION",
    answer: "安全回答"
  });
  assert.deepEqual(Object.keys(result), ["available", "mode", "answer"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("cleanQaResultForClient safely supports the legacy answer field", () => {
  assert.deepEqual(cleanQaResultForClient({
    available: 1,
    mode: "UNTRUSTED_MODE",
    studentAnswer: "",
    answer: JSON.stringify({ answer: "兼容安全回答", provider: "secret-provider" })
  }), {
    available: false,
    mode: "KNOWLEDGE_EXPLANATION",
    answer: "兼容安全回答"
  });
});

test("cleanClassroomQaResultForClient adds only transcript and approved voice fields", () => {
  const result = cleanClassroomQaResultForClient({
    qa: {
      available: true,
      mode: "GUIDED_THINKING",
      studentAnswer: "先说说你的想法。",
      providerId: "secret-provider",
      persisted: { voiceInteractionId: "secret-id" },
      learningSignal: { raw: "secret-raw" }
    },
    transcript: "  这道题怎么做？  ",
    voice: {
      available: true,
      status: "ready",
      audioUrl: "/generated/answer.mp3",
      reason: null,
      providerId: "secret-voice-provider",
      raw: "secret-voice-raw",
      unknown: "secret-voice-unknown"
    }
  });

  assert.deepEqual(result, {
    available: true,
    mode: "GUIDED_THINKING",
    answer: "先说说你的想法。",
    transcript: "这道题怎么做？",
    voice: {
      available: true,
      status: "ready",
      audioUrl: "/generated/answer.mp3",
      reason: null
    }
  });
  assert.deepEqual(Object.keys(result.voice), ["available", "status", "audioUrl", "reason"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("QA routes use server-confirmed actor context and response cleaners", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const qaRoute = source.slice(
    source.indexOf('app.post("/api/ai/qa"'),
    source.indexOf('app.post("/api/ai/vocabulary"')
  );
  const classroomRoute = source.slice(
    source.indexOf('app.post("/api/classroom/voice-qa"'),
    source.indexOf('app.post("/api/classroom/reading"')
  );

  assert.match(qaRoute, /buildQaActorContext\(session, input,/);
  assert.match(qaRoute, /answerStudentQuestionService\(config, \{ \.\.\.input, \.\.\.actorContext \}, options\)/);
  assert.match(qaRoute, /cleanQaResultForClient\(result\)/);
  assert.match(classroomRoute, /assertClassroomStudentScope\(\{ session: req\.session \}, res, input\.studentId\)/);
  assert.doesNotMatch(classroomRoute, /prisma\.student\.findFirst/);
  assert.match(classroomRoute, /text: qa\.studentAnswer \|\| qa\.answer/);
  assert.match(classroomRoute, /cleanClassroomQaResultForClient/);
});
