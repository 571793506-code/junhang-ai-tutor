import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { draftAssessment } from "./runtime.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("draftAssessment honors request-level total timeout", { timeout: 2000 }, async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"late\",\"sections\":[]}" } }] }));
    }, 200);
  });
  const address = await listen(server);
  try {
    const startedAt = Date.now();
    const result = await draftAssessment(
      {
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "slow-model",
        DEEPSEEK_ASSESSMENT_FALLBACK_MODEL: "slow-model"
      },
      {
        subject: "数学",
        kind: "小测",
        grade: "五年级",
        requirement: "短预算测试",
        assessmentTotalTimeoutMs: 40
      }
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.available, false);
    assert.equal(result.modelRun.status, "ERROR");
    assert.match(result.error || "", /MODEL_TIMEOUT|ASSESSMENT_TOTAL_TIMEOUT/);
    assert.equal(result.modelRun.metadata.assessmentTotalTimeoutMs, 40);
    assert.equal(result.modelRun.metadata.totalBudgetExhausted, true);
    assert.equal(result.modelRun.metadata.attempts.length, 1);
    assert.ok(elapsedMs < 180, `expected request to stop before delayed response, took ${elapsedMs}ms`);
  } finally {
    await close(server);
  }
});
