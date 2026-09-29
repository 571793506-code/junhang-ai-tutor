import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowRepository } from "../../db/src/teaching-workflow-repository.js";
import { createTeachingWorkflowService } from "./teaching-workflow-service.js";
import { fakeWorkflowPrisma } from "../../../scripts/test-support/teaching-workflow-prisma.mjs";

const actor = { teacherId: "t1" };
const input = { module: "generation", requestKey: "request-1", request: { subject: "math", grade: "4", requirement: "addition" } };
const draft = () => ({ request: { subject: "math", resolvedScope: "class-1" }, subjectRef: "class-1", snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2", reviewedByTeacher: true, confirmedBy: "forged" }] } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  const db = fakeWorkflowPrisma();
  const repository = createTeachingWorkflowRepository(db);
  const config = { repository, createDraft: draft, validateSnapshot: () => ({ ok: true }), ...options };
  const service = createTeachingWorkflowService(config);
  return { db, repository, config, service, create: (value = input) => service.create({ actor, input: value }) };
}

test("creation persists a request before the executor and validates content into a separate revision", async () => {
  let pending;
  const f = fixture({ createDraft: async ({ workflow, signal }) => {
    assert.ok(signal instanceof AbortSignal);
    pending = await f.repository.get(workflow.id, actor.teacherId);
    assert.equal(pending.status, "running"); assert.equal(pending.currentRevision, 1);
    assert.equal(pending.snapshot.creationPending, true);
    return draft();
  } });
  const completed = await f.create();
  assert.equal(completed.revision, 2); assert.equal(completed.status, "ready_for_review");
  assert.equal(completed.snapshot.creationPending, undefined);
  assert.equal(completed.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.deepEqual(completed.request, input.request);
  assert.deepEqual(completed.snapshot.resolvedRequest, draft().request);
  assert.equal((await f.repository.get(completed.workflowId, actor.teacherId)).subjectRef, "class-1");
  assert.equal((await f.repository.getRevision(completed.workflowId, 1, actor.teacherId)).snapshot.creationPending, true);
});

test("simultaneous creation across services invokes one executor and retries only read its state", async () => {
  const entered = deferred(); const release = deferred(); let calls = 0;
  const f = fixture({ createDraft: async () => { calls++; entered.resolve(); await release.promise; return draft(); } });
  const other = createTeachingWorkflowService(f.config);
  const first = f.create();
  const second = other.create({ actor, input });
  try {
    await entered.promise;
    assert.equal(calls, 1);
    const retry = await other.create({ actor, input });
    assert.equal(retry.status, "running"); assert.equal(retry.revision, 1);
    assert.equal(retry.snapshot.creationPending, true);
  } finally { release.resolve(); }
  const results = await Promise.all([first, second]);
  assert.equal(results[0].workflowId, results[1].workflowId);
  assert.equal(calls, 1);
  // A fresh service without execution dependencies may still read a completed request.
  const restarted = createTeachingWorkflowService({ repository: f.repository });
  const replay = await restarted.create({ actor, input: { ...input, request: { requirement: "addition", grade: "4", subject: "math" } } });
  assert.equal(replay.revision, 2);
  assert.equal(calls, 1);
});

test("request key conflicts and teacher scoping are decided before model invocation", async () => {
  let calls = 0;
  const f = fixture({ createDraft: () => { calls++; return draft(); } });
  const first = await f.create();
  await assert.rejects(f.create({ ...input, request: { ...input.request, requirement: "changed" } }), { code: "WORKFLOW_REQUEST_KEY_REUSED" });
  await assert.rejects(f.create({ ...input, module: "grading" }), { code: "WORKFLOW_REQUEST_KEY_REUSED" });
  assert.equal(calls, 1);
  const other = await f.service.create({ actor: { teacherId: "t2" }, input });
  assert.notEqual(other.workflowId, first.workflowId); assert.equal(calls, 2);
  assert.equal(await f.repository.get(first.workflowId, "t2"), null);
});

test("failed and invalid drafts retain an incomplete task and do not regenerate on retry", async () => {
  for (const invalid of [false, true]) {
    let calls = 0;
    const f = fixture({ createDraft: () => { calls++; if (!invalid) throw new Error("PRIVATE model failure"); return draft(); }, validateSnapshot: () => ({ ok: false }) });
    const result = await f.create();
    assert.equal(result.status, invalid ? "needs_input" : "failed");
    assert.equal(result.revision, 1); assert.deepEqual(result.snapshot.questions, []);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    const retry = await f.create(); assert.equal(retry.status, result.status); assert.equal(calls, 1);
    await assert.rejects(f.service.execute({ actor, workflowId: result.workflowId, command: { action: "confirm", expectedRevision: 1, operationKey: "confirm", targetQuestionIds: ["q1"] } }), { code: "WORKFLOW_CREATION_INCOMPLETE" });
  }
});

test("cancellation during creation aborts execution and ignores late valid content", async () => {
  const entered = deferred(); const release = deferred(); let signal;
  const f = fixture({ createDraft: async (options) => { signal = options.signal; entered.resolve(options.workflow); await release.promise; return draft(); } });
  const pending = f.create();
  try {
    const workflow = await entered.promise;
    await f.service.execute({ actor, workflowId: workflow.id, command: { action: "cancel", expectedRevision: 1, operationKey: "cancel-create" } });
    assert.equal(signal.aborted, true);
  } finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.status, "cancelled"); assert.equal(result.revision, 1);
  assert.deepEqual(result.snapshot.questions, []);
  assert.equal((await f.create()).status, "cancelled");
});

test("a restarted service reads interrupted reservations without starting models", async () => {
  const f = fixture({ createDraft: () => { throw new Error("must not run"); } });
  const reserved = await f.repository.reserveCreation({ ...input, ownerTeacherId: actor.teacherId });
  await f.repository.markInterrupted();
  const result = await f.create();
  assert.equal(result.workflowId, reserved.workflow.id);
  assert.equal(result.status, "interrupted"); assert.equal(result.revision, 1);
});

test("the reservation revision cannot be restored over completed content", async () => {
  const f = fixture(); const completed = await f.create();
  await assert.rejects(f.service.execute({ actor, workflowId: completed.workflowId, command: { action: "restore", expectedRevision: completed.revision, operationKey: "restore-placeholder", revision: 1 } }), { code: "WORKFLOW_CREATION_INCOMPLETE" });
  assert.equal((await f.repository.get(completed.workflowId, actor.teacherId)).currentRevision, 2);
});

test("missing executor or validator never reserves a new task", async () => {
  for (const missing of [{ createDraft: null }, { validateSnapshot: null }]) {
    const f = fixture(missing);
    await assert.rejects(f.create(), { code: "WORKFLOW_EXECUTION_UNAVAILABLE" });
    assert.deepEqual(await f.repository.list(actor.teacherId), []);
  }
});

test("cancelling between reservation and execution never starts a model", async () => {
  let calls = 0;
  const f = fixture({ createDraft: () => { calls++; return draft(); } });
  const reserve = f.repository.reserveCreation;
  f.repository.reserveCreation = async (value) => {
    const reserved = await reserve(value);
    await f.repository.cancel({ workflowId: reserved.workflow.id, ownerTeacherId: actor.teacherId, expectedRevision: 1 });
    return reserved;
  };
  const result = await f.create();
  assert.equal(result.status, "cancelled"); assert.equal(result.revision, 1); assert.equal(calls, 0);
});

test("a restart interrupts an active creation and fences its late commit", async () => {
  const entered = deferred(); const release = deferred(); let calls = 0;
  const f = fixture({ createDraft: async () => { calls++; entered.resolve(); await release.promise; return draft(); } });
  const pending = f.create();
  try { await entered.promise; await f.repository.markInterrupted(); } finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.status, "interrupted"); assert.equal(result.revision, 1);
  assert.deepEqual(result.snapshot.questions, []);
  assert.equal((await f.create()).status, "interrupted"); assert.equal(calls, 1);
});

test("failed persistence cannot report a ready draft or trigger automatic recreation", async () => {
  let calls = 0;
  const f = fixture({ createDraft: () => { calls++; return draft(); } });
  f.repository.commitRevision = () => { throw new Error("injected transaction rollback"); };
  const result = await f.create();
  assert.equal(result.status, "failed"); assert.equal(result.revision, 1);
  assert.deepEqual(result.snapshot.questions, []);
  assert.equal((await f.create()).status, "failed"); assert.equal(calls, 1);
});
