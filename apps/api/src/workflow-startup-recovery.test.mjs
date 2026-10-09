import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import test from "node:test";
import { createApiServerStartup } from "./api-server-startup.js";

const quiet = { log() {} };
const close = (server) => new Promise((resolve) => server.close(resolve));
const url = (server) => `http://127.0.0.1:${server.address().port}`;

test("duplicate listener cannot interrupt the active worker or report success", async () => {
  const occupied = http.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  let calls = 0;
  const messages = [];
  const startup = createApiServerStartup({ app: express(), recover: async () => { calls += 1; },
    logger: { log: (...args) => messages.push(args) } });
  try {
    await assert.rejects(startup({ port: occupied.address().port, host: "127.0.0.1" }), { code: "EADDRINUSE" });
    assert.equal(calls, 0);
    assert.equal(messages.length, 0);
  } finally {
    await close(occupied);
  }
});

test("bound listener blocks business requests until recovery completes", async () => {
  let release;
  let started;
  let server;
  const recoveryStarted = new Promise((resolve) => { started = resolve; });
  const recovery = new Promise((resolve) => { release = resolve; });
  const oldWorkflow = { status: "running", activeOperationKey: "create:old" };
  const app = express();
  const originalListen = app.listen.bind(app);
  app.listen = (...args) => { server = originalListen(...args); return server; };
  const startup = createApiServerStartup({ app, logger: quiet, recover: async () => {
    started();
    await recovery;
    oldWorkflow.status = "interrupted";
    oldWorkflow.activeOperationKey = null;
    return { count: 1 };
  } });
  app.get("/business", (_req, res) => res.json({ accepted: true }));
  const boot = startup({ port: 0, host: "127.0.0.1" });
  await recoveryStarted;
  try {
    const blocked = await fetch(url(server) + "/business");
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).error, "API_STARTING");
    assert.equal(oldWorkflow.status, "running");
    release();
    await boot;
    assert.equal(oldWorkflow.status, "interrupted");
    assert.equal(oldWorkflow.activeOperationKey, null);
    const accepted = await fetch(url(server) + "/business");
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { accepted: true });
  } finally {
    release();
    await boot.catch(() => {});
    if (server?.listening) await close(server);
  }
});

test("recovery failure closes the listener instead of accepting unrecovered work", async () => {
  const app = express();
  let server;
  const originalListen = app.listen.bind(app);
  app.listen = (...args) => { server = originalListen(...args); return server; };
  const startup = createApiServerStartup({ app, logger: quiet, recover: async () => {
    throw Object.assign(new Error("private database details"), { code: "P1001" });
  } });
  await assert.rejects(startup({ port: 0, host: "127.0.0.1" }), { code: "P1001" });
  assert.equal(server.listening, false);
});

test("disabled persistence still starts a usable API", async () => {
  const app = express();
  const startup = createApiServerStartup({ app, logger: quiet });
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const server = await startup({ port: 0, host: "127.0.0.1" });
  try {
    assert.equal((await fetch(url(server) + "/health")).status, 200);
  } finally {
    await close(server);
  }
});

test("API check branch cannot run worker startup or restart recovery", () => {
  const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const checkStart = source.lastIndexOf('if (process.argv.includes("--check"))');
  const checkEnd = source.indexOf("} else {", checkStart);
  assert.ok(checkStart >= 0 && checkEnd > checkStart);
  assert.doesNotMatch(source.slice(checkStart, checkEnd), /startApiServer\(|markInterrupted\(/);
  assert.equal((source.match(/markInterrupted\(/g) || []).length, 1);
  assert.match(source, /recover: teachingWorkflowRepository \? \(\) => teachingWorkflowRepository.markInterrupted\(\)/);
});
