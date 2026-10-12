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
