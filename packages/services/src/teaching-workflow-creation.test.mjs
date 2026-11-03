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
  assert.equal(completed.recoveryAllowed, false);
  assert.equal((await f.service.get({ actor, workflowId: completed.workflowId, revision: 1 })).recoveryAllowed, false);
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

test("explicit recovery creates one independent task from the server-stored request and leaves failure history intact", async () => {
  let calls = 0;
  const grading = { ...input, module: "grading", request: { studentId: "s1", submissionId: "submission1", requirement: "首次作答评分，订正另记" } };
  const f = fixture({ createDraft: ({ input: received }) => {
    calls++; assert.deepEqual(received.request, grading.request);
    if (calls === 1) throw new Error("PRIVATE upstream credentials");
    return draft();
  } });
  const failed = await f.create(grading);
  const original = structuredClone(await f.repository.get(failed.workflowId, actor.teacherId));
  const args = { actor, workflowId: failed.workflowId, expectedRevision: 1, operationKey: "recover-1", request: { requirement: "FORGED" } };
  const recovered = await f.service.recover(args);
  assert.notEqual(recovered.workflowId, failed.workflowId);
  assert.equal(recovered.status, "ready_for_review"); assert.equal(recovered.revision, 2);
  assert.deepEqual(recovered.request, grading.request);
  assert.equal(recovered.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.deepEqual(await f.repository.get(failed.workflowId, actor.teacherId), original);
  const restarted = createTeachingWorkflowService({ repository: f.repository });
  assert.equal((await restarted.recover(args)).workflowId, recovered.workflowId);
  assert.equal(calls, 2);
});

test("concurrent recovery replays the running reservation rather than calling an executor twice", async () => {
  const entered = deferred(); const release = deferred(); let calls = 0;
  const f = fixture({ createDraft: async () => { if (++calls === 1) throw new Error("failed"); entered.resolve(); await release.promise; return draft(); } });
  const failed = await f.create();
  const args = { actor, workflowId: failed.workflowId, expectedRevision: 1, operationKey: "recover-once" };
  const pending = f.service.recover(args);
  try {
    await entered.promise;
    const other = createTeachingWorkflowService(f.config);
    const replay = await other.recover(args);
    assert.equal(replay.status, "running"); assert.equal(replay.snapshot.creationPending, true);
    assert.equal(calls, 2);
  } finally { release.resolve(); }
  assert.equal((await pending).status, "ready_for_review");
});

test("recovery rejects other teachers, stale versions, malformed keys, complete and cancelled tasks before execution", async () => {
  let calls = 0; const f = fixture({ createDraft: () => { calls++; return draft(); } });
  const completed = await f.create();
  const args = { actor, workflowId: completed.workflowId, expectedRevision: 2, operationKey: "recover" };
  await assert.rejects(f.service.recover(args), { code: "WORKFLOW_RECOVERY_NOT_ALLOWED" });
  await assert.rejects(f.service.recover({ ...args, actor: { teacherId: "t2" } }), { code: "WORKFLOW_NOT_FOUND" });
  await assert.rejects(f.service.recover({ ...args, expectedRevision: 1 }), { code: "WORKFLOW_VERSION_CONFLICT" });
  await assert.rejects(f.service.recover({ ...args, operationKey: " " }), { code: "WORKFLOW_COMMAND_INVALID" });
  const reserved = await f.repository.reserveCreation({ ...input, requestKey: "cancelled", ownerTeacherId: actor.teacherId });
  const other = { ...args, workflowId: reserved.workflow.id, expectedRevision: 1 };
  await assert.rejects(f.service.recover(other), { code: "WORKFLOW_RECOVERY_NOT_ALLOWED" });
  await f.repository.cancel({ workflowId: reserved.workflow.id, ownerTeacherId: actor.teacherId, expectedRevision: 1 });
  await assert.rejects(f.service.recover(other), { code: "WORKFLOW_RECOVERY_NOT_ALLOWED" });
  assert.equal(calls, 1);
});

test("failure diagnostics retain safe stage, code and timing without exception text or secrets", async () => {
  const f = fixture({ createDraft: () => { throw Object.assign(new Error("PRIVATE url and student content"), { code: "PRIVATE_SECRET", raw: "PRIVATE" }); } });
  const failed = await f.create();
  const stored = await f.repository.get(failed.workflowId, actor.teacherId);
  assert.equal(stored.checkpoint.failure.phase, "execute");
  assert.equal(stored.checkpoint.failure.code, "WORKFLOW_EXECUTION_FAILED");
  assert.ok(Number.isSafeInteger(stored.checkpoint.failure.elapsedMs));
  assert.ok(stored.checkpoint.failure.elapsedMs >= 0);
  assert.deepEqual(stored.checkpoint.units, {});
  assert.doesNotMatch(JSON.stringify(stored.checkpoint), /PRIVATE|url|raw/);
  assert.equal(failed.failure.phase, "execute");
  const invalid = fixture({ validateSnapshot: () => ({ ok: false }) });
  const invalidResult = await invalid.create();
  assert.equal(invalidResult.failure.phase, "validate");
  assert.equal(invalidResult.failure.code, "WORKFLOW_SNAPSHOT_INVALID");
  const persistence = fixture(); persistence.repository.commitRevision = () => { throw new Error("PRIVATE database connection"); };
  const persisted = await persistence.create();
  assert.equal(persisted.failure.phase, "persist");
  assert.equal(persisted.failure.code, "WORKFLOW_EXECUTION_FAILED");
});

test("server-owned successful units persist on failure and survive recovery across service instances", async () => {
  let calls = 0;
  const unit = { version: "grading-checkpoint-v1", binding: "hash", candidate: { questionResults: [{ questionNo: "1", score: 2 }] } };
  const f = fixture({ createDraft: async ({ checkpoint }) => {
    if (++calls === 1) {
      await checkpoint.save("grading-1", unit);
      throw Object.assign(new Error("PRIVATE"), { teachingDiagnostics: { attempts: [{ partitionId: "grading-2", status: "ERROR", failureCode: "http_error", upstreamStatus: 503,
        elapsedMs: 50, raw: "PRIVATE", transportDiagnostics: { phase: "response_headers", status: 503, elapsedMs: 25, url: "PRIVATE" } }] } });
    }
    assert.deepEqual(checkpoint.units, { "grading-1": unit });
    await checkpoint.save("grading-1", unit);
    return draft();
  } });
  const failed = await f.create();
  const stored = await f.repository.get(failed.workflowId, actor.teacherId);
  assert.deepEqual(stored.checkpoint.units, { "grading-1": unit });
  assert.equal(stored.checkpoint.failure.diagnostics.attempts[0].upstreamStatus, 503);
  assert.equal(stored.checkpoint.failure.diagnostics.attempts[0].transportDiagnostics.phase, "response_headers");
  assert.doesNotMatch(JSON.stringify(stored.checkpoint.failure), /PRIVATE|raw|url/);
  assert.deepEqual(Object.keys(failed.failure).sort(), ["code", "elapsedMs", "phase"]);
  const restarted = createTeachingWorkflowService(f.config);
  const args = { actor, workflowId: failed.workflowId, expectedRevision: 1, operationKey: "explicit" };
  const recovered = await restarted.recover(args);
  assert.equal(recovered.status, "ready_for_review");
  assert.deepEqual((await f.repository.get(recovered.workflowId, actor.teacherId)).checkpoint.units, { "grading-1": unit });
  assert.deepEqual(await f.repository.get(failed.workflowId, actor.teacherId), stored);
  assert.equal((await restarted.recover({ ...args, operationKey: "different-key" })).workflowId, recovered.workflowId);
  assert.equal(calls, 2);
});

test("a failed recovery cannot create an unbounded recovery chain", async () => {
  let calls = 0;
  const f = fixture({ createDraft: () => { calls++; throw new Error("failed"); } });
  const first = await f.create();
  assert.equal(first.recoveryAllowed, true);
  assert.equal((await f.service.get({ actor, workflowId: first.workflowId, revision: 1 })).recoveryAllowed, true);
  const args = { actor, workflowId: first.workflowId, expectedRevision: 1, operationKey: "explicit" };
  const next = await f.service.recover(args);
  assert.equal(next.recoveryAllowed, false);
  assert.equal((await f.service.recover({ ...args, operationKey: "new-key" })).workflowId, next.workflowId);
  await assert.rejects(f.service.recover({ ...args, workflowId: next.workflowId }), { code: "WORKFLOW_RECOVERY_NOT_ALLOWED" });
  assert.equal(calls, 2);
});

test("legacy recovery keys replay the saved successor after upgrade without another execution", async () => {
  let calls = 0;
  const f = fixture({ createDraft: () => { calls++; throw new Error("failed"); } });
  const first = await f.create();
  const legacy = await f.create({ ...input, requestKey: `recover:${first.workflowId}:legacy-operation-hash` });
  const original = structuredClone(await f.repository.get(first.workflowId, actor.teacherId));
  const restarted = createTeachingWorkflowService({ repository: f.repository });
  const replay = await restarted.recover({ actor, workflowId: first.workflowId, expectedRevision: 1, operationKey: "new-after-upgrade" });
  assert.equal(replay.workflowId, legacy.workflowId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.recoveryAllowed, false);
  assert.equal(calls, 2);
  assert.deepEqual(await f.repository.get(first.workflowId, actor.teacherId), original);
  assert.equal(await f.repository.getRecoveryCreation({ workflowId: first.workflowId, ownerTeacherId: "other-teacher" }), null);
});
