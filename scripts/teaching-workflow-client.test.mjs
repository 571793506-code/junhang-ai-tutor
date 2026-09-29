import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { workflowHttpFixture } from "./test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "./teaching-workflow-client.mjs";
import { createTeachingWorkflowValidator } from "../packages/services/src/teaching-workflow-validation.js";

test("CLI client and HTTP callers see the same content and immutable history", async (t) => {
  const f = await workflowHttpFixture(t);
  const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const first = await client.create({ requestKey: "cli-1", module: "generation", request: { requirement: "addition" } });
  assert.deepEqual(await client.get(first.id), (await (await f.request(`/workflows/${first.id}`)).json()).workflow);
  const next = await client.execute(first.id, { action: "confirm", operationKey: "cli-confirm", expectedRevision: first.revision, targetQuestionIds: ["q1"] });
  assert.equal(first.revision, 2);
  assert.equal(next.revision, 3);
  assert.equal(next.content.questions[0].reviewedByTeacher, true);
  assert.equal((await client.getRevision(first.id, first.revision)).content.questions[0].reviewedByTeacher, undefined);
  await assert.rejects(client.execute(first.id, { action: "confirm", operationKey: "stale", expectedRevision: 1, targetQuestionIds: ["q1"] }), { code: "WORKFLOW_VERSION_CONFLICT", status: 409 });
});

test("client requires a session and never includes secrets in failures", async () => {
  assert.throws(() => createTeachingWorkflowClient({ baseUrl: "http://localhost:8787", session: {} }), /SESSION_REQUIRED/);
  const token = "PRIVATE-TOKEN";
  const client = createTeachingWorkflowClient({ baseUrl: "http://localhost:8787", session: { sessionToken: token }, fetchImpl: async () => { throw new Error(token); } });
  await assert.rejects(client.get("id"), (error) => error.code === "WORKFLOW_CONNECTION_FAILED" && !String(error).includes(token));
  const failed = createTeachingWorkflowClient({ baseUrl: "http://localhost:8787", session: { sessionToken: token }, fetchImpl: async () => new Response(JSON.stringify({ error: token, message: token }), { status: 500 }) });
  await assert.rejects(failed.get("id"), (error) => !JSON.stringify(error).includes(token) && !String(error).includes(token));
});

test("client does not follow redirects carrying a teacher session", async (t) => {
  const f = await workflowHttpFixture(t);
  let redirect;
  const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher }, fetchImpl: async (_url, options) => {
    redirect = options.redirect;
    return new Response(null, { status: 302, headers: { Location: "https://example.invalid" } });
  } });
  await assert.rejects(client.get("id"));
  assert.equal(redirect, "error");
});

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/teaching-workflow.mjs", ...args], { env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI process edits and confirms explanation through the same versioned HTTP commands", async (t) => {
  const explanation = { concept: "Addition", steps: ["Combine quantities"], workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: ["Combine one and one"] }], commonMistakes: ["Do not multiply"] };
  const f = await workflowHttpFixture(t, {
    validateSnapshot: createTeachingWorkflowValidator(),
    createDraft: async ({ input }) => ({ request: input.request, snapshot: { title: "Addition", subject: "math", grade: "4", purpose: "explanation", explanation } })
  });
  const folder = await mkdtemp(path.join(os.tmpdir(), "jh-workflow-cli-explanation-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const sessionPath = path.join(folder, "session.json"); const inputPath = path.join(folder, "input.json");
  await writeFile(sessionPath, JSON.stringify({ sessionToken: f.tokens.teacher }));
  const env = { TEACHING_API_BASE_URL: f.baseUrl, TEACHING_SESSION_FILE: sessionPath };
  await writeFile(inputPath, JSON.stringify({ requestKey: "cli-explanation", module: "generation", request: { purpose: "explanation" } }));
  const created = await runCli(["create", "--input", inputPath], env);
  assert.equal(created.code, 0, created.stderr);
  const first = JSON.parse(created.stdout); assert.deepEqual(first.content.explanation, explanation);
  await writeFile(inputPath, JSON.stringify({ action: "revise", operationKey: "edit", expectedRevision: 2, targetExplanation: true,
    patch: { type: "replace_explanation", value: { ...explanation, concept: "Addition with blocks", confirmedBy: "forged", reviewedByTeacher: true } } }));
  const edited = await runCli(["command", "--id", first.id, "--input", inputPath], env);
  assert.equal(edited.code, 0, edited.stderr); assert.equal(JSON.parse(edited.stdout).content.explanation.reviewedByTeacher, undefined);
  await writeFile(inputPath, JSON.stringify({ action: "confirm", operationKey: "confirm", expectedRevision: 3, targetExplanation: true }));
  const confirmed = await runCli(["command", "--id", first.id, "--input", inputPath], env);
  assert.equal(confirmed.code, 0, confirmed.stderr); assert.equal(JSON.parse(confirmed.stdout).content.explanation.reviewedByTeacher, true);
  const read = await runCli(["get", "--id", first.id], env);
  assert.equal(read.code, 0); assert.deepEqual(JSON.parse(read.stdout), JSON.parse(confirmed.stdout));
  assert.equal(read.stdout.includes(f.tokens.teacher), false); assert.doesNotMatch(read.stdout, /confirmedBy|teacherConfirmation|forged/);
});

test("CLI process reads only the named private session and calls the shared HTTP API", async (t) => {
  const f = await workflowHttpFixture(t);
  const folder = await mkdtemp(path.join(os.tmpdir(), "jh-workflow-cli-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const sessionPath = path.join(folder, "session.json");
  const inputPath = path.join(folder, "input.json");
  await writeFile(sessionPath, JSON.stringify({ sessionToken: f.tokens.teacher }));
  await writeFile(inputPath, JSON.stringify({ module: "generation", requestKey: "process-1", request: { requirement: "addition" } }));
  const env = { TEACHING_API_BASE_URL: f.baseUrl, TEACHING_SESSION_FILE: sessionPath };
  const created = await runCli(["create", "--input", inputPath], env);
  assert.equal(created.code, 0, created.stderr);
  const view = JSON.parse(created.stdout);
  assert.equal(view.id, "workflow-1");
  assert.equal(created.stdout.includes(f.tokens.teacher), false);
  const read = await runCli(["get", "--id", view.id, "--revision", "1"], env);
  assert.equal(read.code, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).revision, 1);
  const missing = await runCli(["get", "--id", view.id], { ...env, TEACHING_SESSION_FILE: "" });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /SESSION_REQUIRED/);
});

test("CLI archive uses the authenticated HTTP route and preserves the teacher-selected version", async (t) => {
  const calls = [];
  const f = await workflowHttpFixture(t, { archiveService: { publish: async (input) => {
    calls.push(input);
    if (input.expectedRevision !== 3) throw Object.assign(new Error("PRIVATE"), { code: "WORKFLOW_VERSION_CONFLICT" });
    return { archiveId: "a1", workflowId: input.workflowId, revision: 3, currentRevision: 3, status: "archived", replayed: false, raw: "PRIVATE" };
  } } });
  const folder = await mkdtemp(path.join(os.tmpdir(), "jh-workflow-cli-archive-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const sessionPath = path.join(folder, "session.json");
  const inputPath = path.join(folder, "input.json");
  await writeFile(sessionPath, JSON.stringify({ sessionToken: f.tokens.teacher }));
  await writeFile(inputPath, JSON.stringify({ expectedRevision: 3, confirmedBy: "forged", snapshot: { finalScore: 100 } }));
  const env = { TEACHING_API_BASE_URL: f.baseUrl, TEACHING_SESSION_FILE: sessionPath };
  const result = await runCli(["archive", "--id", "w1", "--input", inputPath], env);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { id: "a1", workflowId: "w1", revision: 3, currentRevision: 3, status: "archived", replayed: false });
  assert.deepEqual(calls, [{ actor: { teacherId: "t1" }, workflowId: "w1", expectedRevision: 3 }]);
  assert.equal(result.stdout.includes(f.tokens.teacher), false);
  await writeFile(inputPath, JSON.stringify({ expectedRevision: 2 }));
  const conflict = await runCli(["archive", "--id", "w1", "--input", inputPath], env);
  assert.equal(conflict.code, 1); assert.match(conflict.stderr, /WORKFLOW_VERSION_CONFLICT/);
  assert.equal(conflict.stderr.includes("PRIVATE"), false); assert.equal(calls.length, 2);
});

test("archive client filters results and rejects malformed success without retry", async () => {
  let calls = 0; let view;
  const valid = { id: "a1", workflowId: "w1", revision: 3, currentRevision: 3, status: "archived", replayed: false };
  const client = createTeachingWorkflowClient({ baseUrl: "http://localhost:8787", session: { sessionToken: "PRIVATE" }, fetchImpl: async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(options.body), { expectedRevision: 3 });
    return new Response(JSON.stringify({ ok: true, archive: view }));
  } });
  view = { ...valid, snapshot: { raw: "PRIVATE" }, teacherId: "PRIVATE" };
  assert.deepEqual(await client.archive("w1", { expectedRevision: 3, snapshot: {} }), valid);
  for (const override of [{ status: "failed" }, { revision: 0 }, { revision: 2 }, { workflowId: "other" }, { currentRevision: 2 }, { replayed: "false" }, { id: "" }]) {
    view = { ...valid, ...override };
    const before = calls;
    await assert.rejects(client.archive("w1", { expectedRevision: 3 }), { code: "WORKFLOW_RESPONSE_INVALID" });
    assert.equal(calls, before + 1);
  }
  const before = calls;
  for (const body of [null, {}, { expectedRevision: 0 }, { expectedRevision: "3" }]) {
    assert.throws(() => client.archive("w1", body), { code: "WORKFLOW_INPUT_INVALID" });
  }
  assert.equal(calls, before);
});

test("assignment CLI uses the authenticated route and retains expectedRevision without publishing on retry conflicts", async (t) => {
  let calls = 0;
  const f = await workflowHttpFixture(t, { assignmentService: { publish: async (input) => {
    calls++;
    assert.deepEqual(Object.keys(input).sort(), ["actor", "expectedRevision", "workflowId"]);
    if (input.expectedRevision !== 3) throw Object.assign(new Error("PRIVATE"), { code: "WORKFLOW_VERSION_CONFLICT" });
    return { assignmentId: "a1", workflowId: input.workflowId, revision: 3, currentRevision: 3, status: "assignment_ready", replayed: false, raw: "PRIVATE" };
  } } });
  const folder = await mkdtemp(path.join(os.tmpdir(), "jh-workflow-cli-assignment-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const sessionPath = path.join(folder, "session.json"); const inputPath = path.join(folder, "input.json");
  await writeFile(sessionPath, JSON.stringify({ sessionToken: f.tokens.teacher }));
  await writeFile(inputPath, JSON.stringify({ expectedRevision: 3, snapshot: "PRIVATE" }));
  const env = { TEACHING_API_BASE_URL: f.baseUrl, TEACHING_SESSION_FILE: sessionPath };
  const result = await runCli(["assignment", "--id", "w1", "--input", inputPath], env);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { id: "a1", workflowId: "w1", revision: 3, currentRevision: 3, status: "assignment_ready", replayed: false });
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
  await writeFile(inputPath, JSON.stringify({ expectedRevision: 2 }));
  const conflict = await runCli(["assignment", "--id", "w1", "--input", inputPath], env);
  assert.notEqual(conflict.code, 0); assert.match(conflict.stderr, /WORKFLOW_VERSION_CONFLICT/);
  assert.equal(calls, 2);
});
