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

test("normalizeQaModelOutput allows an explicit natural-language fallback", () => {
  const result = normalizeQaModelOutput("先理解十分之一，再看 0.5。");

  assert.equal(result.structureValid, false);
  assert.equal(result.studentAnswer, "先理解十分之一，再看 0.5。");
  assert.equal(result.learningSignal, null);
});

test("normalizeQaModelOutput never echoes parseable JSON with a non-string studentAnswer", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: { text: "unsafe-object-answer" },
    learningSignal: validPayload.learningSignal,
    provider: "Terra-Secret",
    model: "gpt-5.6-secret",
    raw: "raw-secret",
    prompt: "prompt-secret",
    debug: "debug-secret"
  }));

  assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
  assert.equal(result.structureValid, false);
  assert.equal(result.learningSignal, null);
  for (const forbidden of [
    "{",
    "learningSignal",
    "studentAnswer",
    "provider",
    "model",
    "raw",
    "prompt",
    "debug",
    "unsafe-object-answer",
    "Terra-Secret",
    "gpt-5.6-secret"
  ]) {
    assert.equal(result.studentAnswer.includes(forbidden), false);
  }
});

test("normalizeQaModelOutput never treats structured fragments as plain-text answers", () => {
  const fragments = [
    "{\"studentAnswer\":[\"object-fragment-secret\"],\"learningSignal\":{\"knowledgePoints\":[\"secret\"]}",
    "[{\"studentAnswer\":\"array-fragment-secret\",\"learningSignal\":"
  ];

  for (const fragment of fragments) {
    const result = normalizeQaModelOutput(fragment);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
    assert.equal(result.studentAnswer.includes("fragment-secret"), false);
    assert.equal(result.studentAnswer.includes("learningSignal"), false);
  }
});

test("normalizeQaModelOutput blocks embedded and fenced structured output", () => {
  const fragments = [
    "Here is JSON: {\"studentAnswer\":42,\"learningSignal\":{\"knowledgePoints\":[\"prefix-secret\"]},\"provider\":\"Terra-prefix\"}",
    "模型响应如下：\n```json\n{\"studentAnswer\":\"fenced-secret\",\"learningSignal\":{}}\n```\n请查收",
    "说明在前。\nstudentAnswer: \"multiline-secret\"\nlearningSignal: {\n  knowledgePoints: [\"hidden-point\"]\n}\nprovider: Terra-multiline",
    "结果是 {\"studentAnswer\":\"suffix-secret\"}，以上为内部输出。",
    "模型返回： ``` JSON {'answer':'fence-secret'} ```"
  ];

  for (const fragment of fragments) {
    const result = normalizeQaModelOutput(fragment);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
    for (const forbidden of ["studentAnswer", "learningSignal", "provider", "secret", "Terra", "hidden-point"]) {
      assert.equal(result.studentAnswer.includes(forbidden), false);
    }
  }
});

test("normalizeQaModelOutput rejects complete JSON values outside the exact contract", () => {
  const values = [
    "{\"answer\":\"object-secret\"}",
    "[{\"answer\":\"array-secret\"}]",
    "{\"student\\u0041nswer\":\"escaped-secret\"}"
  ];

  for (const value of values) {
    const result = normalizeQaModelOutput(value);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
    assert.equal(result.studentAnswer.includes("secret"), false);
  }
});

test("normalizeQaModelOutput rejects encoded structured JSON strings", () => {
  const values = [
    "prefix \"{\\\"studentAnswer\\\":\\\"double-secret\\\",\\\"learningSignal\\\":null}\" suffix",
    "prefix \"{\\\"studentAnswer\\\":\\\"scalar-secret\\\",\\\"learningSignal\\\":42}\" suffix",
    "prefix \"{\\\"answer\\\":\\\"alias-secret\\\"}\" suffix"
  ];

  for (const value of values) {
    const result = normalizeQaModelOutput(value);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
    assert.equal(result.studentAnswer.includes("secret"), false);
  }
});

test("normalizeQaModelOutput fails closed when embedded scanning exceeds its work budget", () => {
  for (const size of [100 * 1024, 500 * 1024]) {
    const value = `${"{".repeat(256)}${"x".repeat(size - 256)}`;
    const result = normalizeQaModelOutput(value);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
  }
});

test("normalizeQaModelOutput rejects embedded parseable JSON containers with unknown keys", () => {
  const values = [
    "前缀说明 {\"answer\":\"embedded-object-secret\"} 后缀说明",
    "前缀说明 [{\"answer\":\"embedded-array-secret\"}] 后缀说明",
    "Set {1, 2} is invalid JSON. Internal {\"answer\":\"container-secret\"}",
    "First {\"answer\":\"one-secret\"}, second {\"answer\":\"two-secret\"}.",
    "The symbol \"{\" is a brace. Internal {\"answer\":\"quoted-brace-secret\"}",
    "Notation {x, {\"answer\":\"nested-secret\"}} is shown."
  ];

  for (const value of values) {
    const result = normalizeQaModelOutput(value);
    assert.equal(result.studentAnswer, QA_UNAVAILABLE_ANSWER);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
    assert.equal(result.studentAnswer.includes("secret"), false);
  }
});

test("normalizeQaModelOutput preserves ordinary teaching text with a quoted pair", () => {
  const examples = [
    "英语词典中常写成 \"apple\": \"苹果\"。",
    "英语课上可把 \"model\": \"模型\" 作为词义示例。"
  ];

  for (const text of examples) {
    const result = normalizeQaModelOutput(text);
    assert.equal(result.studentAnswer, text);
    assert.equal(result.structureValid, false);
    assert.equal(result.learningSignal, null);
  }
});

test("normalizeQaModelOutput removes internal fields with case and fullwidth separators", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: "先理解小数意义。\nMODEL：gpt-5.6\nprovider＝Terra",
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: ["小数意义 MODEL：gpt-5.6"],
      misconceptionHypotheses: ["需要观察 provider＝Terra"]
    }
  }));
  const internalOnly = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: "MODEL：gpt-5.6\nprovider＝Terra",
    learningSignal: validPayload.learningSignal
  }));
  const blocked = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: "unsafe answer",
    learningSignal: {
      ...validPayload.learningSignal,
      safetyStatus: "blocked",
      blockedReason: "unsafe-topic； DEBUG＝trace"
    }
  }));

  assert.equal(result.studentAnswer, "先理解小数意义。");
  assert.deepEqual(result.learningSignal.knowledgePoints, ["小数意义"]);
  assert.deepEqual(result.learningSignal.misconceptionHypotheses, ["需要观察"]);
  assert.equal(internalOnly.studentAnswer, QA_UNAVAILABLE_ANSWER);
  assert.equal(internalOnly.learningSignal.profileEligibility, false);
  assert.equal(blocked.learningSignal.blockedReason, "unsafe-topic");
  for (const output of [result, internalOnly, blocked]) {
    assert.equal(JSON.stringify(output).includes("gpt-5.6"), false);
    assert.equal(JSON.stringify(output).includes("Terra"), false);
    assert.equal(JSON.stringify(output).includes("trace"), false);
  }
});

test("normalizeQaModelOutput always removes quoted debug prompt and raw fields", () => {
  const result = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: [
      "安全回答。",
      "\"debug\": \"trace-secret\"",
      "补充说明； \"prompt\"＝\"hidden-secret\"",
      "\"raw\"： \"raw-secret\""
    ].join("\n"),
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: [
        "知识点 \"debug\": \"knowledge-secret\"",
        "原始信息 \"raw\"＝\"raw-knowledge-secret\""
      ],
      misconceptionHypotheses: [
        "需要观察 \"prompt\"：\"hypothesis-secret\"",
        "另一个假设 \"debug\"=\"debug-hypothesis-secret\""
      ]
    }
  }));

  assert.equal(result.studentAnswer, "安全回答。\n补充说明");
  assert.deepEqual(result.learningSignal.knowledgePoints, ["知识点", "原始信息"]);
  assert.deepEqual(result.learningSignal.misconceptionHypotheses, ["需要观察", "另一个假设"]);
  for (const forbidden of ["trace-secret", "hidden-secret", "raw-secret", "knowledge-secret", "hypothesis-secret"]) {
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  }
});

test("normalizeQaModelOutput caps by code points and repairs lone surrogates", () => {
  const emoji = "😀";
  const result = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: `${"a".repeat(1999)}${emoji}tail`,
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: [`${"k".repeat(79)}${emoji}tail`],
      misconceptionHypotheses: [`${"h".repeat(159)}${emoji}tail`]
    }
  }));
  const lone = normalizeQaModelOutput(JSON.stringify({
    studentAnswer: "safe\ud800answer",
    learningSignal: {
      ...validPayload.learningSignal,
      knowledgePoints: ["point\ud800value"],
      misconceptionHypotheses: ["hypothesis\udfffvalue"]
    }
  }));

  assert.equal(Array.from(result.studentAnswer).length, 2000);
  assert.equal(result.studentAnswer.endsWith(emoji), true);
  assert.equal(result.studentAnswer.isWellFormed(), true);
  assert.equal(Array.from(result.learningSignal.knowledgePoints[0]).length, 80);
  assert.equal(result.learningSignal.knowledgePoints[0].endsWith(emoji), true);
  assert.equal(Array.from(result.learningSignal.misconceptionHypotheses[0]).length, 160);
  assert.equal(result.learningSignal.misconceptionHypotheses[0].endsWith(emoji), true);
  assert.equal(lone.studentAnswer, "safe�answer");
  assert.equal(lone.studentAnswer.isWellFormed(), true);
  assert.equal(lone.learningSignal.knowledgePoints[0].isWellFormed(), true);
  assert.equal(lone.learningSignal.misconceptionHypotheses[0].isWellFormed(), true);
});

test("normalizeQaModelOutput does not over-block ordinary mathematical braces", () => {
  const result = normalizeQaModelOutput("集合 {1, 2} 有两个元素。");

  assert.equal(result.studentAnswer, "集合 {1, 2} 有两个元素。");
  assert.equal(result.structureValid, false);
  assert.equal(result.learningSignal, null);
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
