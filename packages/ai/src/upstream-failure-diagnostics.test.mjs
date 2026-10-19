import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { callTeachingModel, runTeachingTask } from "./runtime.js";
import { projectTeachingResult } from "./teaching-model-runner.js";
import { collectUpstreamFailureDiagnostics, sanitizeUpstreamFailureDiagnostics } from "./upstream-failure-diagnostics.js";

test("diagnostic boundary rejects malformed hints, ids, retry values and extra fields", () => {
  const empty = { requestId: null, requestIdSource: null, reasonHint: "unknown", retryAfterSeconds: null };
  assert.deepEqual(sanitizeUpstreamFailureDiagnostics({ requestId: "SECRET https://private.test", requestIdSource: "authorization",
    reasonHint: "PRIVATE", retryAfterSeconds: -1, raw: "PRIVATE", headers: { authorization: "PRIVATE" } }), empty);
  for (const retry of ["-1", "1.5", "999999", "2026", "Wed, 01 Jan 2020 00:00:00 GMT", "PRIVATE"]) {
    const actual = collectUpstreamFailureDiagnostics(new Headers({ "x-request-id": "sk-PRIVATESECRET", "retry-after": retry }), "", { now: Date.parse("2026-09-23T00:00:00Z") });
    assert.deepEqual(actual, { ...empty, retryAfterSeconds: retry === "2026" ? 2026 : null });
  }
  assert.deepEqual(collectUpstreamFailureDiagnostics(new Headers(), { raw: "PRIVATE" }), empty);
});

async function gateway(reply, run) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* No prompt retention. */ }
    calls++;
    res.writeHead(reply.status || 503, reply.headers || {});
    res.end(reply.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run({ GPT56_BASE_URL: `http://127.0.0.1:${server.address().port}`, GPT56_API_KEY: "test-private-key-12345" }, () => calls); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("gateway 503 hints, correlation and retry guidance reach internal attempts only", async () => {
  await gateway({ headers: { "x-request-id": "req-test-503-12345", "retry-after": "12" },
    body: JSON.stringify({ error: { message: "No available channel PRIVATE https://private.test" } }) }, async (config, calls) => {
    const result = await runTeachingTask(config, "generation", {}, { repairIssues: () => [] });
    assert.equal(calls(), 2);
    assert.deepEqual(result.internal.attempts.map((a) => a.model), ["gpt-6-astra", "gpt-6.1-sol"]);
    for (const a of result.internal.attempts) {
      assert.equal(a.upstreamStatus, 503);
      assert.deepEqual(a.upstreamDiagnostics, { requestId: "req-test-503-12345", requestIdSource: "x-request-id",
        reasonHint: "channel_unavailable", retryAfterSeconds: 12 });
      assert.ok(Number.isFinite(Date.parse(a.startedAt)));
      assert.ok(Number.isFinite(a.elapsedMs) && a.elapsedMs >= 0);
    }
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private\.test|test-private-key/);
    for (const role of ["teacher", "student", "parent"]) assert.doesNotMatch(JSON.stringify(projectTeachingResult(result, role)), /requestId|retryAfter|reasonHint|startedAt|elapsedMs/);
  });
});

test("untrusted upstream strings are reduced to fixed hints and unsafe correlation is discarded", async () => {
  for (const [message, hint] of [["server overloaded", "overloaded"], ["rate limit exceeded", "rate_limited"],
    ["scheduled maintenance", "maintenance"], ["upstream connect error", "upstream_connection_failure"],
    ["PRIVATE unknown 503", "unknown"], ["insufficient quota", "account_limit"]]) {
    await gateway({ headers: { "x-request-id": "test-private-key-12345", "retry-after": "9999999" },
      body: JSON.stringify({ error: { message } }) }, async (config) => {
      await assert.rejects(() => callTeachingModel(config, { providerId: "gpt56", model: "gpt-6-astra" }, [], { timeoutMs: 5000 }), (error) => {
        assert.deepEqual(error.upstreamDiagnostics, { requestId: null, requestIdSource: null, reasonHint: hint, retryAfterSeconds: null });
        return true;
      });
    });
  }
});

test("HTTP-date retry hints and invalid successful envelopes retain bounded diagnostics", async () => {
  await gateway({ status: 200, headers: { "x-request-id": "https://private.test", "cf-ray": "abcdef1234567890-HKG",
    "retry-after": new Date(Date.now() + 60000).toUTCString() }, body: "<html>PRIVATE</html>" }, async (config) => {
    await assert.rejects(() => callTeachingModel(config, { providerId: "gpt56", model: "gpt-6-astra" }, [], { timeoutMs: 5000 }), (error) => {
      assert.equal(error.code, "invalid_upstream_response");
      assert.equal(error.upstreamDiagnostics.requestId, "abcdef1234567890-HKG");
      assert.equal(error.upstreamDiagnostics.requestIdSource, "cf-ray");
      assert.ok(error.upstreamDiagnostics.retryAfterSeconds > 0 && error.upstreamDiagnostics.retryAfterSeconds <= 60);
      assert.equal(error.upstreamDiagnostics.reasonHint, "unknown");
      return true;
    });
  });
});
