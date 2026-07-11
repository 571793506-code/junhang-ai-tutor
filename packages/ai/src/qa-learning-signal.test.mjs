import assert from "node:assert/strict";
import test from "node:test";
import {
  QA_BLOCKED_ANSWER,
  QA_LEARNING_SIGNAL_SCHEMA_VERSION,
  QA_UNAVAILABLE_ANSWER,
  normalizeQaModelOutput,
  unavailableQaOutput
} from "./qa-learning-signal.js";

const validPayload = {
  studentAnswer: "先把 0.5 看成 5 个十分之一。",
  learningSignal: {
    knowledgePoints: ["小数意义"],
    questionIntent: "concept",
    difficultySignal: "possible",
    misconceptionHypotheses: ["可能把十分位理解成十位"],
    followUpNeeded: true,
    confidence: "medium",
    safetyStatus: "pass",
    profileEligibility: true,
    blockedReason: null
  }
};

test("normalizeQaModelOutput normalizes the exact strict JSON contract", () => {
  const result = normalizeQaModelOutput(JSON.stringify(validPayload));

  assert.equal(QA_LEARNING_SIGNAL_SCHEMA_VERSION, "qa-learning-signal-v1");
  assert.equal(result.structureValid, true);
  assert.equal(result.studentAnswer, validPayload.studentAnswer);
  assert.deepEqual(result.learningSignal, validPayload.learningSignal);
  assert.deepEqual(Object.keys(result).sort(), ["learningSignal", "structureValid", "studentAnswer"]);
});

test("normalizeQaModelOutput keeps only whitelisted fields and applies all caps", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: `  ${"答".repeat(2100)}  `,
    provider: "Terra",
    model: "gpt-5.6",
    raw: "secret raw response",
    prompt: "secret prompt",
    debug: { trace: true },
    unknown: "drop me",
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: Array.from({ length: 10 }, (_, index) => ` 知识点${index}${"甲".repeat(90)} `),
      misconceptionHypotheses: Array.from({ length: 7 }, (_, index) => ` 假设${index}${"乙".repeat(180)} `),
      provider: "Terra",
      model: "gpt-5.6",
      raw: "secret raw response",
      prompt: "secret prompt",
      debug: { trace: true },
      unknown: "drop me"
    }
  }));

  assert.equal(result.studentAnswer.length, 2000);
  assert.equal(result.learningSignal.knowledgePoints.length, 8);
  assert.equal(result.learningSignal.knowledgePoints.every((item) => item.length <= 80), true);
  assert.equal(result.learningSignal.misconceptionHypotheses.length, 5);
  assert.equal(result.learningSignal.misconceptionHypotheses.every((item) => item.length <= 160), true);
  assert.deepEqual(Object.keys(result.learningSignal).sort(), [
    "blockedReason",
    "confidence",
    "difficultySignal",
    "followUpNeeded",
    "knowledgePoints",
    "misconceptionHypotheses",
    "profileEligibility",
    "questionIntent",
    "safetyStatus"
  ]);
  assert.equal(JSON.stringify(result).includes("Terra"), false);
  assert.equal(JSON.stringify(result).includes("gpt-5.6"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("normalizeQaModelOutput uses conservative enum fallbacks", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    ...validPayload,
    learningSignal: {
      ...validPayload.learningSignal,
      questionIntent: "invalid",
      difficultySignal: "invalid",
      confidence: "invalid",
      safetyStatus: "invalid"
    }
  }));

  assert.equal(result.structureValid, true);
  assert.equal(result.studentAnswer, QA_BLOCKED_ANSWER);
  assert.equal(result.learningSignal.questionIntent, "other");
  assert.equal(result.learningSignal.difficultySignal, "none");
  assert.equal(result.learningSignal.confidence, "low");
  assert.equal(result.learningSignal.safetyStatus, "blocked");
  assert.equal(result.learningSignal.profileEligibility, false);
});

test("normalizeQaModelOutput rejects non-string signal text values", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    ...validPayload,
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: ["小数意义", 42, { provider: "Terra" }],
      misconceptionHypotheses: ["需要继续观察", false, { debug: true }],
      safetyStatus: "blocked",
      blockedReason: { raw: "unsafe" }
    }
  }));

  assert.deepEqual(result.learningSignal.knowledgePoints, ["小数意义"]);
  assert.deepEqual(result.learningSignal.misconceptionHypotheses, ["需要继续观察"]);
  assert.equal(result.learningSignal.blockedReason, null);
});

test("normalizeQaModelOutput forces the approved refusal for blocked content", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    ...validPayload,
    studentAnswer: "不应返回给学生的原始回答",
    learningSignal: {
      ...validPayload.learningSignal,
      safetyStatus: "blocked",
      profileEligibility: true,
      blockedReason: "  unsafe-topic\u0000; provider: Terra  "
    }
  }));

  assert.equal(result.studentAnswer, QA_BLOCKED_ANSWER);
  assert.equal(result.learningSignal.profileEligibility, false);
  assert.equal(result.learningSignal.blockedReason, "unsafe-topic");
  assert.equal(JSON.stringify(result).includes("原始回答"), false);
});

test("normalizeQaModelOutput sanitizes malformed plain text without creating an eligible signal", () => {
  const result = normalizeQaModelOutput([
    "```text",
    "<studentAnswer>先理解十分之一，再看 0.5。</studentAnswer>",
    "provider: Terra",
    "model: gpt-5.6",
    "prompt: hidden",
    "debug: hidden",
    "```"
  ].join("\n"));

  assert.equal(result.structureValid, false);
  assert.equal(result.studentAnswer, "先理解十分之一，再看 0.5。");
  assert.equal(result.learningSignal, null);
  assert.equal(JSON.stringify(result).includes("Terra"), false);
  assert.equal(JSON.stringify(result).includes("gpt-5.6"), false);
});

test("normalizeQaModelOutput uses approved fallback copy when malformed text is unsafe or unreadable", () => {
  const blocked = normalizeQaModelOutput("safetyStatus: blocked\nraw: unsafe details");
  const unreadable = normalizeQaModelOutput("provider: Terra\nmodel: gpt-5.6\ndebug: trace");

  assert.equal(blocked.structureValid, false);
  assert.equal(blocked.studentAnswer, QA_BLOCKED_ANSWER);
  assert.equal(blocked.learningSignal, null);
  assert.equal(unreadable.studentAnswer, QA_UNAVAILABLE_ANSWER);
  assert.equal(unreadable.learningSignal, null);
});

test("unavailableQaOutput returns a non-eligible approved result without leaking its reason", () => {
  assert.deepEqual(unavailableQaOutput("provider gpt-5.6 raw failure"), {
    studentAnswer: QA_UNAVAILABLE_ANSWER,
    learningSignal: null,
    structureValid: false
  });
});
