import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { draftAssessment } from "./runtime.js";

const input = { subject: "数学", kind: "练习", grade: "四年级", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 1, requirement: "只练习加法" };
const valid = () => ({ title: "加法", sections: [{ title: "计算", items: [{ itemType: "calculation", prompt: "2+3", answer: "5", score: 5, analysisSteps: ["相加得5"], knowledgePoint: "加法", commonMistake: "注意数位" }] }] });
async function withGateway(respond, run) {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const payload = JSON.parse(text);
    payloads.push(payload);
    const reply = await respond(payload, payloads.length);
    res.writeHead(reply.status || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.status ? { error: { message: reply.message || "upstream error" } } : { choices: [{ message: { content: reply.text ?? JSON.stringify(valid()) } }], usage: { completion_tokens: 20 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await run({ GPT56_API_KEY: "synthetic", GPT56_BASE_URL: `http://127.0.0.1:${server.address().port}`, TEACHING_PRIMARY_MODEL: "gpt-6-astra" }, payloads); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("actual HTTP uses configured Astra with generation medium and shared rules without accepting client routing or budgets", async () => {
  await withGateway(() => ({}), async (config, calls) => {
    const result = await draftAssessment(config, { ...input, model: "forged", rulePack: { text: "forged" }, assessmentMaxTokens: 999999 });
    assert.equal(result.available, true); assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "gpt-6-astra"); assert.equal(calls[0].reasoning_effort, "medium");
    assert.equal(calls[0].temperature, undefined); assert.ok(calls[0].max_completion_tokens < 999999);
    assert.match(calls[0].messages[0].content, /generation-v1/);
    assert.match(calls[0].messages[1].content, /只练习加法/);
    assert.doesNotMatch(JSON.stringify(calls), /forged/);
  });
});
for (const status of [503, 524, 429]) {
  test(`availability ${status} permits exactly one Sol replacement`, async () => {
    await withGateway((_p, n) => n === 1 ? { status, message: status === 429 ? "rate_limit" : "upstream error" } : {}, async (config, calls) => {
      const result = await draftAssessment(config, input);
      assert.equal(result.available, true);
      assert.deepEqual(calls.map((p) => p.model), ["gpt-6-astra", "gpt-6.1-sol"]);
      assert.equal(result.modelRun.metadata.usedModelEscalation, true);
    });
  });
}
for (const bad of ["not-json", "{}", JSON.stringify({ ...valid(), sections: [{ title: "计算", items: [{ ...valid().sections[0].items[0], score: null }] }] })]) {
  test(`invalid output ${bad.slice(0, 25)} permits one same-model repair`, async () => {
    await withGateway((_p, n) => ({ text: n === 1 ? bad : JSON.stringify(valid()) }), async (config, calls) => {
      const result = await draftAssessment(config, input);
      assert.equal(result.available, true);
      assert.deepEqual(calls.map((p) => p.model), ["gpt-6-astra", "gpt-6-astra"]);
      assert.equal(result.modelRun.metadata.usedModelEscalation, false);
      assert.match(calls[1].messages[0].content, /Repair these validation issues/);
    });
  });
}
for (const first of [{ status: 503 }, { text: "{}" }]) {
  test(`second failure never starts a third model (${JSON.stringify(first)})`, async () => {
    await withGateway((_p, n) => n === 1 ? first : { status: 503 }, async (config, calls) => {
      const result = await draftAssessment({ ...config, DEEPSEEK_EMERGENCY_FALLBACK_ENABLED: "true", ASSESSMENT_READING_SOL_ENABLED: "true" }, input);
      assert.equal(calls.length, 2); assert.equal(result.available, false); assert.equal(result.draftText, "");
    });
  });
}
for (const status of [401, 403]) {
  test(`configuration ${status} stops after one HTTP call`, async () => {
    await withGateway(() => ({ status }), async (config, calls) => {
      const result = await draftAssessment(config, input);
      assert.equal(calls.length, 1); assert.equal(result.available, false);
    });
  });
}
test("missing textbook approval and cancellation stop before HTTP", async () => {
  let count = 0;
  const execution = { call: async () => { count++; throw new Error("unexpected call"); } };
  const missing = await draftAssessment({}, { ...input, textbookAssetId: "unapproved" }, execution);
  assert.equal(missing.available, false);
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(draftAssessment({}, input, { ...execution, signal: controller.signal }), /cancelled/);
  assert.equal(count, 0);
});
const days = { ...input, purpose: "multi_day", dayPlan: [1, 2, 3].map((n) => ({ dayId: `d${n}`, goal: "加法", requestedItemCount: 1 })) };
test("shared deadline prevents queued units and repairs after expiry", async () => {
  let now = 0; let count = 0;
  const result = await draftAssessment({}, days, { now: () => now, timeoutMs: 100, maxTokens: 1000,
    call: async () => { count++; now = 101; return { text: JSON.stringify(valid()), usage: { completion_tokens: 20 } }; }
  });
  assert.ok(count <= 2); assert.equal(result.available, false); assert.equal(result.modelRun.metadata.totalBudgetExhausted, true);
});
test("shared token reservations and concurrency remain bounded across days", async () => {
  let active = 0; let peak = 0; let reserved = 0;
  const result = await draftAssessment({}, days, { maxTokens: 1200,
    call: async (_route, _messages, options) => {
      active++; peak = Math.max(peak, active); reserved += options.maxTokens;
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      return { text: "{}" }; // Unknown usage spends its full reservation.
    }
  });
  assert.ok(peak <= 2); assert.ok(reserved <= 1200);
  assert.equal(result.modelRun.metadata.attempts.length, 6); assert.equal(result.available, false);
});

test("four-part comprehensive generation gives each partition a complete first response budget", async () => {
  const firstBudgets = [];
  let active = 0;
  let peak = 0;
  const result = await draftAssessment({}, { ...input, purpose: "comprehensive", kind: "小测", assessmentMaxTokens: 16000 }, {
    maxTokens: 16000,
    call: async (_route, _messages, options) => {
      firstBudgets.push(options.maxTokens);
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { text: JSON.stringify(valid()), usage: { completion_tokens: 20 } };
    }
  });
  assert.equal(firstBudgets.length >= 4, true);
  assert.equal(firstBudgets.every((value) => value >= 4000), true);
  assert.equal(peak, 4);
  assert.equal(result.modelRun.metadata.attempts.some((attempt) => attempt.maxTokens < 4000), false);
});

test("reading calls receive the same numerical requirements used by validation", async () => {
  let requirements;
  await draftAssessment({}, { subject: "英语", grade: "六年级", kind: "小测", purpose: "comprehensive", readingRequirements: { minimumGroupLength: 1 } }, {
    maxTokens: 16000,
    call: async (_route, messages) => {
      const request = JSON.parse(messages[1].content);
      if (request.partition.id === "reading") {
        requirements = request.partition.readingRequirements;
        assert.match(messages[0].content, /readingRequirements/);
      }
      return { text: "{}" };
    }
  });
  assert.deepEqual(requirements, {
    lengthUnit: "words", minimumGroups: 1, minimumGroupLength: 120,
    minimumTotalLength: 120, minimumContextualQuestions: 6
  });
});
test("focused English omits reading and explanation uses a separate schema", async () => {
  const focused = await draftAssessment({}, { ...input, subject: "英语", requestedItemTypes: ["fill"] }, { call: async (_route, messages) => {
    assert.deepEqual(JSON.parse(messages[1].content).partition.itemTypes, ["fill"]);
    const candidate = valid(); candidate.sections[0].items[0].itemType = "fill";
    return { text: JSON.stringify(candidate) };
  } });
  assert.equal(focused.available, true);
  const explanation = await draftAssessment({}, { ...input, purpose: "explanation" }, { call: async () => ({ text: JSON.stringify({ title: "讲解", explanation: { concept: "加法", steps: ["合并数量"], workedExamples: [{ prompt: "2+3", answer: "5", analysisSteps: ["相加"] }], commonMistakes: ["数位对齐"] } }) }) });
  assert.equal(explanation.available, true); assert.ok(JSON.parse(explanation.draftText).explanation);
  assert.equal(JSON.parse(explanation.draftText).sections, undefined);
});
