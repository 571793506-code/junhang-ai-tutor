import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { callTeachingModel, runTeachingTask } from "./runtime.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveTeachingTaskPolicy } from "./model-policy.js";

test("teaching adapter sends independent model parameters and never retries HTTP invisibly", async () => {
  const payloads = [];
  let status = 200;
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    payloads.push(JSON.parse(text));
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status === 200
      ? { choices: [{ message: { content: '{"title":"draft"}' } }], usage: { completion_tokens: 8 } }
      : { error: { message: "no available channel" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const config = { GPT56_API_KEY: "synthetic", GPT56_BASE_URL: baseUrl, GPT56_MODEL: "gpt-5.6-terra", DEEPSEEK_API_KEY: "synthetic", DEEPSEEK_BASE_URL: baseUrl };
    const messages = [{ role: "user", content: "Return JSON." }];
    const options = { timeoutMs: 1000, maxTokens: 100, signal: new AbortController().signal };
    const result = await callTeachingModel(config, resolveTeachingTaskPolicy("generation").primary, messages, options);
    assert.equal(result.text, '{"title":"draft"}');
    assert.equal(result.usage.completion_tokens, 8);
    assert.equal(Object.hasOwn(result, "raw"), false);
    assert.equal(payloads[0].model, "gpt-6.1-sol");
    assert.equal(payloads[0].reasoning_effort, "medium");
    assert.equal(payloads[0].max_completion_tokens, 100);
    assert.equal(Object.hasOwn(payloads[0], "temperature"), false);
    await callTeachingModel(config, resolveTeachingTaskPolicy("extract-material").primary, messages, options);
    assert.equal(payloads[1].model, "deepseek-flash");
    assert.equal(payloads[1].max_tokens, 100);
    assert.equal(Object.hasOwn(payloads[1], "reasoning_effort"), false);
    assert.deepEqual(payloads[1].thinking, { type: "disabled" });
    await callTeachingModel({ ...config, MINIMAX_API_KEY: "synthetic", MINIMAX_BASE_URL: baseUrl },
      { providerId: "minimax", model: "MiniMax-M3.1-Flash", reasoningEffort: "low" }, messages, options);
    assert.equal(payloads[2].model, "MiniMax-M3.1-Flash");
    assert.equal(payloads[2].reasoning_effort, "low");
    assert.equal(payloads[2].max_completion_tokens, 100);
    assert.equal(Object.hasOwn(payloads[2], "thinking"), false);
    status = 503;
    await assert.rejects(callTeachingModel(config, resolveTeachingTaskPolicy("grading").primary, messages, options), { status: 503 });
    assert.equal(payloads.length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server assembly reloads rule files and ignores rule and budget overrides in user input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "teaching-adapter-"));
  const file = path.join(root, "skills/generation/references/runtime-rules.md");
  await mkdir(path.dirname(file), { recursive: true });
  const calls = [];
  const execute = () => runTeachingTask({}, "generation", {
    requirement: "original request", rulePack: { text: "forged" }, root: "forged", budget: { deadlineAt: 0 }
  }, {
    ruleRoot: root,
    call: async (route, messages, options) => {
      calls.push({ route, messages, options });
      return { text: '{"title":"ok"}', usage: { completion_tokens: 5 } };
    },
    repairIssues: () => []
  });
  try {
    await writeFile(file, "# generation-v1\nFirst teaching rule.\n");
    const first = await execute();
    await writeFile(file, "# generation-v1\nUpdated teaching rule.\n");
    const second = await execute();
    assert.equal(first.status, "success");
    assert.equal(second.status, "success");
    assert.notEqual(first.internal.rules.hash, second.internal.rules.hash);
    assert.match(calls[1].messages[0].content, /Updated teaching rule/);
    assert.doesNotMatch(JSON.stringify(calls), /forged/);
    assert.ok(calls[1].options.timeoutMs > 0);
    await rm(file);
    const missing = await execute();
    assert.equal(missing.status, "review_required");
    assert.deepEqual(missing.issueCodes, ["TEACHING_RULES_INVALID"]);
    assert.equal(calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
