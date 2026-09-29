import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowRepository } from "../../db/src/teaching-workflow-repository.js";
import { createTeachingWorkflowService } from "./teaching-workflow-service.js";
import { fakeWorkflowPrisma } from "../../../scripts/test-support/teaching-workflow-prisma.mjs";

const actor = { teacherId: "t1" };
const confirm = { action: "confirm", operationKey: "confirm-1", expectedRevision: 1, targetQuestionIds: ["q1"] };
const edit = { action: "revise", operationKey: "edit-2", expectedRevision: 2, instruction: "Revise this question", targetQuestionIds: ["q1"],
  patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "2+2", answer: "4" } } };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function fixture(options = {}) {
  const db = fakeWorkflowPrisma();
  const repository = createTeachingWorkflowRepository(db);
  const head = await repository.create({ ownerTeacherId: actor.teacherId, module: "generation", requestKey: "r1", request: {}, snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2" }] } });
  const config = { repository, validateSnapshot: () => ({ ok: true }), ...options };
  const service = createTeachingWorkflowService(config);
  const execute = (command) => service.execute({ actor, workflowId: head.id, command });
  return { db, repository, head, service, config, execute };
}

test("completed commands replay across service instances; changed base, action and missing fingerprint conflict", async () => {
  const f = await fixture();
  const first = await f.execute(confirm);
  const secondService = createTeachingWorkflowService(f.config);
  assert.deepEqual((await secondService.execute({ actor, workflowId: f.head.id, command: confirm })).snapshot, first.snapshot);
  for (const changed of [{ expectedRevision: 2 }, { action: "restore", revision: 1 }, { targetQuestionIds: ["q2"] }]) {
    await assert.rejects(f.execute({ ...confirm, ...changed }), { code: "WORKFLOW_OPERATION_KEY_REUSED" });
  }
  const stored = await f.repository.getOperation(f.head.id, confirm.operationKey, actor.teacherId);
  await f.db.teachingWorkflowRevision.update({ where: { id: stored.id }, data: { commandFingerprint: null } });
  await assert.rejects(f.execute(confirm), { code: "WORKFLOW_OPERATION_KEY_REUSED" });
  assert.equal(await f.repository.getOperation(f.head.id, confirm.operationKey, "other"), null);
});

test("historical command replay preserves the recorded version without pretending it is current", async () => {
  const f = await fixture();
  await f.execute(confirm);
  await f.execute({ ...edit, instruction: undefined });
  const replay = await f.execute(confirm);
  assert.equal(replay.revision, 2);
  assert.equal(replay.status, "historical");
  assert.equal(replay.snapshot.questions[0].answer, "2");
});

test("simultaneous duplicate edits call the runner once, cancel aborts it and fences an ignored signal", async () => {
  const entered = deferred(); const release = deferred(); let calls = 0; let signal;
  const f = await fixture({ runner: async (input) => { calls++; signal = input.signal; entered.resolve(); await release.promise; return { questions: input.questions }; } });
  await f.execute(confirm);
  const pending = f.execute(edit);
  const rejected = assert.rejects(pending, (error) => ["WORKFLOW_CANCELLED", "WORKFLOW_VERSION_CONFLICT"].includes(error.code));
  try {
    await entered.promise;
    assert.equal((await f.repository.get(f.head.id, actor.teacherId)).status, "running");
    await assert.rejects(f.execute(edit), { code: "WORKFLOW_OPERATION_ACTIVE_OR_REUSED" });
    await f.execute({ action: "cancel", operationKey: "cancel-2", expectedRevision: 2 });
    assert.equal(signal?.aborted, true);
  } finally { release.resolve(); }
  await rejected;
  const current = await f.repository.get(f.head.id, actor.teacherId);
  assert.equal(current.status, "cancelled");
  assert.equal(current.currentRevision, 2);
  assert.equal(current.snapshot.questions[0].reviewedByTeacher, true);
  assert.equal(calls, 1);
});

test("invalid and unavailable commands leave the completed head and operation key untouched", async () => {
  const f = await fixture();
  await f.execute(confirm);
  for (const cmd of [{ ...edit, patch: null }, edit, { ...edit, instruction: undefined, targetQuestionIds: "q1" }]) {
    await assert.rejects(f.execute(cmd));
    const head = await f.repository.get(f.head.id, actor.teacherId);
    assert.equal(head.status, "ready_for_review");
    assert.equal(head.activeOperationKey, null);
  }
  const fixed = await f.execute({ ...edit, instruction: undefined });
  assert.equal(fixed.revision, 3);
});

test("direct teacher patches never call a configured model", async () => {
  let calls = 0;
  const f = await fixture({ runner: async (input) => { calls++; return { questions: input.questions }; } });
  await f.execute(confirm);
  await f.execute({ ...edit, instruction: undefined });
  assert.equal(calls, 0);
});

test("new semantic operations start with empty units; queue recovery preserves its checkpoints", async () => {
  const f = await fixture();
  const op = { workflowId: f.head.id, ownerTeacherId: actor.teacherId, expectedRevision: 1, operationKey: "queue" };
  await f.repository.beginOperation(op);
  await f.repository.saveCheckpoint({ ...op, unitId: "q1", candidate: { answer: "old" } });
  await f.repository.endOperation({ ...op, status: "interrupted" });
  const resumed = { ...op, operationKey: "queue-resume" };
  assert.deepEqual((await f.repository.beginOperation(resumed)).units.q1, { answer: "old" });
  await f.repository.commitRevision({ ...resumed, operation: "generate", snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2" }] } });
  const semantic = await f.repository.beginOperation({ ...op, operationKey: "new-edit", expectedRevision: 2, resetCheckpoint: true });
  assert.deepEqual(semantic.units, {});
});

test("failed runners release the operation without overwriting the previous version", async () => {
  const f = await fixture({ runner: async () => { throw new Error("injected model failure"); } });
  await f.execute(confirm);
  await assert.rejects(f.execute(edit), /injected model failure/);
  const head = await f.repository.get(f.head.id, actor.teacherId);
  assert.equal(head.status, "failed"); assert.equal(head.activeOperationKey, null);
  assert.equal(head.currentRevision, 2); assert.equal(head.snapshot.questions[0].answer, "2");
  await assert.rejects(f.execute(edit), { code: "WORKFLOW_OPERATION_ACTIVE_OR_REUSED" });
  assert.equal((await f.execute({ ...edit, instruction: undefined, operationKey: "teacher-fix" })).revision, 3);
});

test("an executor honoring the abort signal reports cancellation and preserves the confirmed head", async () => {
  const entered = deferred();
  const f = await fixture({ runner: ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    entered.resolve();
  }) });
  await f.execute(confirm);
  const pending = f.execute(edit);
  const rejected = assert.rejects(pending, { code: "WORKFLOW_CANCELLED" });
  await entered.promise;
  await f.execute({ action: "cancel", operationKey: "cancel-2", expectedRevision: 2 });
  await rejected;
  assert.equal((await f.repository.get(f.head.id, actor.teacherId)).currentRevision, 2);
});

test("runner output cannot remove the target's shared reading or day dependency", async () => {
  const f = await fixture({ runner: ({ questions }) => ({ questions: [{ ...questions[0], sharedMaterialId: undefined, dayId: undefined }] }) });
  await f.execute(confirm);
  await assert.rejects(f.execute({ ...edit, patch: { ...edit.patch, value: { ...edit.patch.value, sharedMaterialId: "m1", dayId: "d1" } } }), { code: "WORKFLOW_RUNNER_SCOPE_INVALID" });
  assert.equal((await f.repository.get(f.head.id, actor.teacherId)).currentRevision, 2);
});

test("a different service can cancel persistent work even without the local controller", async () => {
  const entered = deferred(); const release = deferred();
  const f = await fixture({ runner: async ({ questions }) => { entered.resolve(); await release.promise; return { questions }; } });
  await f.execute(confirm);
  const pending = f.execute(edit);
  const rejected = assert.rejects(pending, { code: "WORKFLOW_VERSION_CONFLICT" });
  try {
    await entered.promise;
    const otherService = createTeachingWorkflowService(f.config);
    await otherService.execute({ actor, workflowId: f.head.id, command: { action: "cancel", operationKey: "cancel-remote", expectedRevision: 2 } });
  } finally { release.resolve(); }
  await rejected;
  assert.equal((await f.repository.get(f.head.id, actor.teacherId)).currentRevision, 2);
});

test("a partial repository cannot silently bypass execution fencing", async () => {
  const f = await fixture();
  delete f.repository.beginOperation;
  await assert.rejects(f.execute(confirm), { code: "WORKFLOW_EXECUTION_UNAVAILABLE" });
  assert.equal((await f.repository.get(f.head.id, actor.teacherId)).currentRevision, 1);
});
