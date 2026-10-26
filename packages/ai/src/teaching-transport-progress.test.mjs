import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { callTeachingModel, runTeachingTask } from "./runtime.js";
import { projectTeachingResult, runTeachingUnit } from "./teaching-model-runner.js";
import { loadTeachingRulePack } from "./teaching-rules.js";

async function gateway(handler, run) {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run({ GPT56_API_KEY: "private-test-key", GPT56_BASE_URL: `http://127.0.0.1:${server.address().port}` }, () => requests);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("teaching transport observes request, headers and body without retaining content", async () => {
  await gateway((_req, res) => { res.writeHead(200); res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })); }, async (config, count) => {
    const events = [];
    const result = await callTeachingModel(config, { providerId: "gpt56", model: "gpt-6-astra" },
      [{ role: "user", content: "PRIVATE_STUDENT_TEXT" }], { timeoutMs: 2000, onTransportProgress: event => events.push(event) });
    assert.equal(result.text, '{"ok":true}');
    assert.equal(count(), 1);
    assert.deepEqual(events.map(e => e.phase), ["request_started", "response_headers", "response_body_complete"]);
    assert.ok(events.every(e => Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0));
    assert.equal(events[1].status, 200);
    assert.ok(events[0].requestBytes > 0);
    assert.ok(events[2].responseBytes > 0);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|private-test-key|127\.0\.0\.1|choices|content/);
  });
});

for (const sendHeaders of [false, true]) {
  test(`deadline keeps last transport stage (${sendHeaders ? "body" : "headers"} stalled) with one request`, async () => {
    await gateway((_req, res) => { if (sendHeaders) { res.writeHead(200); res.flushHeaders(); res.write(" "); } }, async (config, count) => {
      // Start the real deadline after rules load; do not consume it with test setup.
      const rules = await loadTeachingRulePack("grading");
      const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: rules,
        budget: { deadlineAt: Date.now() + 200, remainingTokens: 100, additionalAttemptsUsed: 1 } }, {
        config, repairIssues: () => [],
        call: (route, messages, options) => callTeachingModel(config, route, messages, options)
      });
      assert.equal(count(), 1);
      assert.equal(result.status, "review_required");
      const attempt = result.internal.attempts[0];
      assert.equal(attempt.failureCode, "TEACHING_DEADLINE");
      assert.equal(attempt.transportDiagnostics.phase, sendHeaders ? "response_headers" : "request_started");
      assert.equal(attempt.transportDiagnostics.status, sendHeaders ? 200 : null);
      assert.doesNotMatch(JSON.stringify(attempt), /private-test-key|127\.0\.0\.1/);
      for (const role of ["teacher", "student", "parent"]) assert.doesNotMatch(JSON.stringify(projectTeachingResult(result, role)), /transportDiagnostics|requestBytes|elapsedMs/);
    });
  });
}

test("injected progress is whitelisted and cannot forge business content", async () => {
  const result = await runTeachingTask({}, "generation", {}, { repairIssues: () => [], call: async (_route, _messages, options) => {
    options.onTransportProgress({ phase: "response_headers", status: 200, elapsedMs: 4, requestBytes: 24,
      raw: "PRIVATE_RAW", apiKey: "PRIVATE_KEY", responseBytes: -1 });
    options.onTransportProgress({ phase: "PRIVATE_PHASE", elapsedMs: Infinity });
    return { text: JSON.stringify({ title: "draft", transportDiagnostics: { raw: "PRIVATE_CANDIDATE" } }) };
  } });
  assert.equal(result.status, "success");
  assert.deepEqual(result.candidate, { title: "draft" });
  assert.deepEqual(result.internal.attempts[0].transportDiagnostics,
    { phase: "response_headers", status: 200, elapsedMs: 4, requestBytes: 24 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test("diagnostic observer failure cannot change a successful model call", async () => {
  await gateway((_req, res) => res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })), async (config, count) => {
    const result = await callTeachingModel(config, { providerId: "gpt56", model: "gpt-6-astra" }, [],
      { timeoutMs: 2000, onTransportProgress: () => { throw new Error("observer failed"); } });
    assert.equal(result.text, '{"ok":true}');
    assert.equal(count(), 1);
  });
});

test("runner retains all three transport stages and safe channel accounting from the actual wire", async () => {
  let payload;
  await gateway(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.writeHead(200);
    res.flushHeaders();
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"title":"draft"}' } }],
      usage: { prompt_tokens: 300, completion_tokens: 90, total_tokens: 390,
        prompt_tokens_details: { cached_tokens: 100, raw: "PRIVATE_USAGE" },
        completion_tokens_details: { reasoning_tokens: 40, audio_tokens: 0, secret: "PRIVATE_USAGE" },
        secret: "PRIVATE_USAGE" } }));
  }, async (config, count) => {
    const budget = { deadlineAt: Date.now() + 3000, remainingTokens: 100, additionalAttemptsUsed: 0 };
    const result = await runTeachingTask(config, "grading", {}, { budget, repairIssues: () => [] });
    assert.equal(count(), 1);
    assert.equal(result.status, "success");
    assert.equal(payload.max_completion_tokens, 75);
    assert.equal(Object.hasOwn(payload, "max_tokens"), false);
    const attempt = result.internal.attempts[0];
    assert.deepEqual(Object.keys(attempt.transportStages), ["request_started", "response_headers", "response_body_complete"]);
    const stages = Object.values(attempt.transportStages);
    assert.ok(stages.every(s => Number.isFinite(s.elapsedMs)));
    assert.ok(stages[0].elapsedMs <= stages[1].elapsedMs && stages[1].elapsedMs <= stages[2].elapsedMs);
    assert.deepEqual(attempt.transportDiagnostics, stages[2]);
    assert.deepEqual(attempt.usage, { prompt_tokens: 300, completion_tokens: 90, total_tokens: 390,
      prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 40, audio_tokens: 0 } });
    assert.deepEqual(attempt.completionDiagnostics, { limitField: "max_completion_tokens", finishReason: "stop",
      reportedOutputTokens: 90, exceedsRequestedLimit: true });
    assert.equal(budget.remainingTokens, 10);
    assert.equal(attempt.cost, "unknown");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_USAGE|private-test-key|127\.0\.0\.1/);
    for (const role of ["teacher", "student", "parent"]) {
      assert.doesNotMatch(JSON.stringify(projectTeachingResult(result, role)), /transportStages|completionDiagnostics|reasoning_tokens/);
    }
  });
});

test("stalled body preserves the header timing and unknown usage without inventing completion", async () => {
  await gateway((_req, res) => { res.writeHead(200); res.flushHeaders(); res.write(" "); }, async (config, count) => {
    const rules = await loadTeachingRulePack("grading");
    const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: rules,
      budget: { deadlineAt: Date.now() + 200, remainingTokens: 100, additionalAttemptsUsed: 1 } }, {
      config, repairIssues: () => [], call: (route, messages, options) => callTeachingModel(config, route, messages, options)
    });
    assert.equal(count(), 1);
    const attempt = result.internal.attempts[0];
    assert.deepEqual(Object.keys(attempt.transportStages), ["request_started", "response_headers"]);
    assert.equal(attempt.usage, null);
    assert.equal(attempt.completionDiagnostics, undefined);
    assert.equal(attempt.failureCode, "TEACHING_DEADLINE");
  });
});

test("injected stage floods and accounting metadata are bounded and cannot enter candidates or prompts", async () => {
  let observe;
  const result = await runTeachingTask({}, "generation", { transportStages: { raw: "PRIVATE_INPUT" },
    completionDiagnostics: { raw: "PRIVATE_INPUT" } }, { repairIssues: () => [], call: async (_route, messages, options) => {
    assert.doesNotMatch(messages[1].content, /PRIVATE_INPUT/);
    observe = options.onTransportProgress;
    for (let i = 0; i < 100; i++) observe({ phase: "response_headers", elapsedMs: i, raw: "PRIVATE_EVENT" });
    observe({ phase: "PRIVATE_PHASE", elapsedMs: 200 });
    return { text: JSON.stringify({ title: "draft", transportStages: { raw: "PRIVATE_CANDIDATE" },
      completionDiagnostics: { raw: "PRIVATE_CANDIDATE" } }),
      usage: { output_tokens: 12, input_tokens_details: { cached_tokens: 4, secret: "PRIVATE_USAGE" },
        output_tokens_details: { reasoning_tokens: -1, raw: "PRIVATE_USAGE" }, completion_tokens: Infinity },
      completionDiagnostics: { limitField: "PRIVATE_LIMIT", finishReason: "PRIVATE_REASON", raw: "PRIVATE_RAW" } };
  } });
  const attempt = result.internal.attempts[0];
  assert.deepEqual(result.candidate, { title: "draft" });
  assert.deepEqual(Object.keys(attempt.transportStages), ["response_headers"]);
  assert.equal(attempt.transportStages.response_headers.elapsedMs, 0);
  const before = JSON.stringify(attempt);
  observe({ phase: "response_body_complete", elapsedMs: 201 });
  assert.equal(JSON.stringify(attempt), before);
  assert.deepEqual(attempt.usage, { output_tokens: 12, input_tokens_details: { cached_tokens: 4 } });
  assert.deepEqual(attempt.completionDiagnostics, { limitField: null, finishReason: null,
    reportedOutputTokens: 12, exceedsRequestedLimit: false });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
