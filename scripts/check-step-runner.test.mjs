import assert from "node:assert/strict";
import test from "node:test";
import { runSteps, timeoutMsFromEnv } from "./check-step-runner.mjs";

test("runSteps streams progress and parses JSON stdout", async () => {
  const progress = [];
  const summary = await runSteps(
    [
      {
        name: "json step",
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ ok: true, value: 7 }))"],
        timeoutMs: 2000
      }
    ],
    {
      cwd: process.cwd(),
      stderr: { write: (line) => progress.push(line) }
    }
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.results.length, 1);
  assert.deepEqual(summary.results[0].stdout, { ok: true, value: 7 });
  assert.match(progress.join(""), /\[check-step\] start json step/);
  assert.match(progress.join(""), /\[check-step\] done json step: \d+ms/);
});

test("runSteps stops at first failure and preserves stderr", async () => {
  const summary = await runSteps(
    [
      {
        name: "bad step",
        command: process.execPath,
        args: ["-e", "console.error('broken'); process.exit(3)"],
        timeoutMs: 2000
      },
      {
        name: "skipped step",
        command: process.execPath,
        args: ["-e", "console.log('should not run')"],
        timeoutMs: 2000
      }
    ],
    {
      cwd: process.cwd(),
      stderr: { write: () => {} }
    }
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].ok, false);
  assert.match(summary.results[0].stderr, /broken/);
});

test("runSteps fails a step when timeout is reached", async () => {
  const summary = await runSteps(
    [
      {
        name: "slow step",
        command: process.execPath,
        args: ["-e", "setTimeout(() => console.log('late'), 200)"],
        timeoutMs: 50
      }
    ],
    {
      cwd: process.cwd(),
      stderr: { write: () => {} }
    }
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.results[0].timedOut, true);
  assert.match(summary.results[0].stderr, /timed out after 50ms/);
});

test("timeoutMsFromEnv prefers step-specific timeout over default", () => {
  assert.equal(timeoutMsFromEnv("content context e2e", {
    CHECK_STEP_TIMEOUT_MS: "1000",
    CHECK_STEP_CONTENT_CONTEXT_E2E_TIMEOUT_MS: "2500"
  }), 2500);
  assert.equal(timeoutMsFromEnv("other", { CHECK_STEP_TIMEOUT_MS: "1000" }), 1000);
  assert.equal(timeoutMsFromEnv("other", {}), 180000);
});
