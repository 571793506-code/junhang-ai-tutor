import assert from "node:assert/strict";
import test from "node:test";
import { answerStudentQuestionService } from "./index.js";
import { buildQaLearningRecord } from "./qa-learning-record.js";

const validLearningSignal = {
  knowledgePoints: ["小数意义"],
  questionIntent: "concept",
  difficultySignal: "possible",
  misconceptionHypotheses: ["可能混淆十分位和十位"],
  followUpNeeded: true,
  confidence: "medium",
  safetyStatus: "pass",
  profileEligibility: true,
  blockedReason: null
};

function buildInput(overrides = {}) {
  return {
    actorRole: "student",
    identityConfirmed: true,
    ...overrides
  };
}

function buildResult(overrides = {}) {
  return {
    available: true,
    mode: "KNOWLEDGE_EXPLANATION",
    structureValid: true,
    learningSignal: validLearningSignal,
    ...overrides
  };
}

test("buildQaLearningRecord applies the learner eligibility matrix", () => {
  const cases = [
    ["student", true, true, true, "pass", true],
    ["classroom", true, true, true, "pass", true],
    ["teacher", true, true, true, "pass", false],
    ["student", false, true, true, "pass", false],
    ["classroom", false, true, true, "pass", false],
    ["student", true, false, true, "pass", false],
    ["student", true, true, false, "pass", false],
    ["student", true, true, true, "blocked", false]
  ];

  for (const [actorRole, identityConfirmed, available, structureValid, safetyStatus, eligible] of cases) {
    const record = buildQaLearningRecord(
      buildInput({ actorRole, identityConfirmed }),
      buildResult({
        available,
        structureValid,
        learningSignal: { ...validLearningSignal, safetyStatus }
      })
    );
    assert.equal(record.profileEligibility, eligible, `${actorRole}/${identityConfirmed}/${available}/${structureValid}/${safetyStatus}`);
  }
});

test("buildQaLearningRecord uses deterministic blocked reason precedence", () => {
  const cases = [
    [buildInput({ actorRole: "teacher", identityConfirmed: false }), buildResult({ available: false, structureValid: false, learningSignal: { ...validLearningSignal, safetyStatus: "blocked" } }), "teacher-test"],
    [buildInput({ identityConfirmed: false }), buildResult({ available: false, structureValid: false, learningSignal: { ...validLearningSignal, safetyStatus: "blocked" } }), "identity-unconfirmed"],
    [buildInput(), buildResult({ available: false, structureValid: false, learningSignal: { ...validLearningSignal, safetyStatus: "blocked" } }), "model-unavailable"],
    [buildInput(), buildResult({ structureValid: false, learningSignal: { ...validLearningSignal, safetyStatus: "blocked" } }), "unsafe-content"],
    [buildInput(), buildResult({ structureValid: false, learningSignal: null }), "malformed-output"]
  ];

  for (const [input, result, blockedReason] of cases) {
    assert.equal(buildQaLearningRecord(input, result).blockedReason, blockedReason);
  }
});

test("buildQaLearningRecord returns exact metadata and ignores external eligibility", () => {
  const record = buildQaLearningRecord(
    buildInput({ profileEligibility: false }),
    buildResult({
      profileEligibility: false,
      providerId: "secret-provider",
      model: "secret-model",
      raw: "secret-raw",
      learningSignal: {
        ...validLearningSignal,
        profileEligibility: false,
        provider: "secret-provider",
        model: "secret-model",
        raw: "secret-raw",
        prompt: "secret-prompt",
        debug: { trace: true },
        unknown: "secret-unknown"
      }
    })
  );

  assert.deepEqual(Object.keys(record), [
    "actorRole",
    "identityConfirmed",
    "available",
    "mode",
    "learningSignal",
    "profileEligibility",
    "blockedReason",
    "schemaVersion"
  ]);
  assert.deepEqual(Object.keys(record.learningSignal), [
    "knowledgePoints",
    "questionIntent",
    "difficultySignal",
    "misconceptionHypotheses",
    "followUpNeeded",
    "confidence",
    "safetyStatus"
  ]);
  assert.equal(record.profileEligibility, true);
  assert.equal(record.schemaVersion, "qa-learning-signal-v1");
  assert.equal(JSON.stringify(record).includes("secret"), false);
});

test("buildQaLearningRecord is conservative for untrusted roles and booleans", () => {
  const record = buildQaLearningRecord(
    buildInput({ actorRole: "student-admin", identityConfirmed: 1 }),
    buildResult({ available: 1, structureValid: 1, mode: "UNTRUSTED_MODE" })
  );

  assert.equal(record.actorRole, "unknown");
  assert.equal(record.identityConfirmed, false);
  assert.equal(record.available, false);
  assert.equal(record.mode, "KNOWLEDGE_EXPLANATION");
  assert.equal(record.profileEligibility, false);
});

test("buildQaLearningRecord rejects a missing learning signal even when structureValid is claimed", () => {
  const record = buildQaLearningRecord(buildInput(), buildResult({
    structureValid: true,
    learningSignal: null
  }));

  assert.equal(record.profileEligibility, false);
  assert.equal(record.blockedReason, "malformed-output");
  assert.equal(record.learningSignal, null);
});

test("answerStudentQuestionService persists only approved QA metadata", async () => {
  const writes = { modelRuns: [], qaSessions: [], voiceInteractions: [] };
  const qaRunner = async () => ({
    ...buildResult(),
    studentAnswer: "安全回答",
    answer: "兼容回答",
    providerId: "secret-provider",
    modelRun: { provider: "secret-provider", model: "secret-model", status: "SUCCESS" }
  });
  const prisma = {
    modelRun: { create: async ({ data }) => (writes.modelRuns.push(data), { id: "mr1" }) },
    qaSession: { create: async ({ data }) => (writes.qaSessions.push(data), { id: "qa1" }) },
    voiceInteraction: { create: async ({ data }) => (writes.voiceInteractions.push(data), { id: "voice1" }) }
  };

  const result = await answerStudentQuestionService({}, {
    actorRole: "classroom",
    identityConfirmed: true,
    studentId: "s1",
    deviceId: "d1",
    subject: "数学",
    question: "0.5 是什么？"
  }, { qaRunner, prisma });

  assert.equal(writes.qaSessions[0].answer, "安全回答");
  assert.deepEqual(writes.qaSessions[0].metadata, buildQaLearningRecord(
    buildInput({ actorRole: "classroom" }),
    await qaRunner()
  ));
  assert.equal(writes.voiceInteractions[0].answerSummary, "安全回答");
  assert.deepEqual(writes.voiceInteractions[0].metadata, {
    qaSessionId: "qa1",
    available: true,
    mode: "KNOWLEDGE_EXPLANATION"
  });
  assert.deepEqual(result.persisted, {
    modelRunId: "mr1",
    qaSessionId: "qa1",
    voiceInteractionId: "voice1"
  });
});

test("answerStudentQuestionService uses the safe legacy answer and honors persist false", async () => {
  const qaRunner = async () => ({
    ...buildResult(),
    studentAnswer: "",
    answer: "兼容安全回答",
    modelRun: { provider: "test", model: "test", status: "SUCCESS" }
  });
  const prisma = new Proxy({}, {
    get() {
      throw new Error("persistence must not be touched");
    }
  });

  const result = await answerStudentQuestionService({}, buildInput({ question: "问题" }), {
    qaRunner,
    persist: false,
    prisma
  });

  assert.equal(result.answer, "兼容安全回答");
  assert.deepEqual(result.persisted, {
    modelRunId: null,
    qaSessionId: null,
    voiceInteractionId: null
  });
});

test("answerStudentQuestionService never persists a non-string injected answer", async () => {
  let qaSessionData = null;
  const qaRunner = async () => ({
    ...buildResult(),
    studentAnswer: { raw: "unsafe-object" },
    answer: "兼容安全回答",
    modelRun: null
  });
  const prisma = {
    qaSession: {
      create: async ({ data }) => {
        qaSessionData = data;
        return { id: "qa1" };
      }
    }
  };

  await answerStudentQuestionService({}, buildInput({ question: "问题" }), { qaRunner, prisma });

  assert.equal(qaSessionData.answer, "兼容安全回答");
  assert.equal(JSON.stringify(qaSessionData).includes("unsafe-object"), false);
});
