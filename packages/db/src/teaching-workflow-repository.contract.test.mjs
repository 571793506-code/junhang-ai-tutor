import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowRepository } from "./teaching-workflow-repository.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const key = (where, row) => Object.entries(where).every(([field, expected]) => {
  if (field === "OR") return expected.some((item) => matches(item, row));
  if (field === "AND") return expected.every((item) => matches(item, row));
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("in" in expected) return expected.in.includes(row[field]);
    if ("increment" in expected) return true;
  }
  return row[field] === expected;
});
const matches = (where, row) => Object.entries(where).every(([field, expected]) => {
  if (field === "OR") return expected.some((item) => matches(item, row));
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("in" in expected) return expected.in.includes(row[field]);
    if ("not" in expected) return row[field] !== expected.not;
  }
  return row[field] === expected;
});

function fakePrisma() {
  const workflows = [];
  const revisions = [];
  const model = (rows, name) => ({
    findUnique: async ({ where }) => {
      const found = rows.find((row) => {
      if (where.id) return row.id === where.id;
      if (where.ownerTeacherId_requestKey) return row.ownerTeacherId === where.ownerTeacherId_requestKey.ownerTeacherId && row.requestKey === where.ownerTeacherId_requestKey.requestKey;
      const compound = where.workflowId_revision || where.workflowId_operationKey;
      return compound && row.workflowId === compound.workflowId &&
        (compound.revision === undefined || row.revision === compound.revision) &&
        (compound.operationKey === undefined || row.operationKey === compound.operationKey);
      });
      return found ? copy(found) : null;
    },
    findFirst: async ({ where }) => copy(rows.find((row) => matches(where, row)) || null),
    findMany: async ({ where }) => copy(rows.filter((row) => matches(where, row))),
    count: async ({ where }) => rows.filter((row) => matches(where, row)).length,
    create: async ({ data }) => {
      const row = { ...copy(data), checkpoint: data.checkpoint ?? null, activeOperationKey: data.activeOperationKey ?? null, createdAt: new Date(), updatedAt: new Date() };
      if (name === "workflow" && data.revisions?.create) {
        const revision = { ...copy(data.revisions.create), id: `revision-${revisions.length + 1}`, workflowId: row.id, createdAt: new Date() };
        revisions.push(revision);
        delete row.revisions;
      }
      rows.push(row);
      return copy(row);
    },
    update: async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("NOT_FOUND");
      Object.assign(row, copy(data), { updatedAt: new Date() });
      return copy(row);
    },
    updateMany: async ({ where, data }) => {
      const row = rows.find((candidate) => matches(where, candidate));
      if (!row) return { count: 0 };
      for (const [field, value] of Object.entries(data)) row[field] = value?.increment ? row[field] + value.increment : copy(value);
      row.updatedAt = new Date();
      return { count: 1 };
    }
  });
  const db = { teachingWorkflow: model(workflows, "workflow"), teachingWorkflowRevision: model(revisions, "revision") };
  db.$transaction = async (run) => run(db);
  return db;
}

const initial = (repo, extra = {}) => repo.create({
  ownerTeacherId: "teacher-a", module: "generation", requestKey: `request-${Math.random()}`,
  request: { prompt: "出题" }, snapshot: { questions: [{ id: "q1", answer: "5" }] }, ...extra
});

test("workflow repository contract preserves idempotency and owner scope", async () => {
  const repo = createTeachingWorkflowRepository(fakePrisma());
  const requestKey = "same-request";
  const first = await initial(repo, { requestKey });
  const replay = await initial(repo, { requestKey });
  assert.equal(replay.id, first.id);
  assert.equal(await repo.get(first.id, "teacher-b"), null);
  await assert.rejects(initial(repo, { requestKey, request: { changed: true } }), /WORKFLOW_REQUEST_KEY_REUSED/);
});

test("workflow repository contract fences stale revisions and merges checkpoints", async () => {
  const repo = createTeachingWorkflowRepository(fakePrisma());
  const head = await initial(repo);
  const operation = { workflowId: head.id, ownerTeacherId: "teacher-a", expectedRevision: 1, operationKey: "op-1" };
  await repo.beginOperation(operation);
  await repo.saveCheckpoint({ ...operation, unitId: "q1", candidate: { answer: "5" } });
  const committed = await repo.commitRevision({ ...operation, operation: "revise", snapshot: { questions: [] } });
  assert.equal(committed.revision, 2);
  const current = await repo.get(head.id, "teacher-a");
  assert.deepEqual(current.checkpoint.units.q1, { answer: "5" });
  await assert.rejects(repo.saveCheckpoint({ ...operation, unitId: "late", candidate: {} }), /WORKFLOW_CHECKPOINT_STALE/);
});

test("a stale cancellation cannot cancel a newer running revision", async () => {
  const repo = createTeachingWorkflowRepository(fakePrisma());
  const head = await initial(repo);
  const operation = { workflowId: head.id, ownerTeacherId: "teacher-a", expectedRevision: 1, operationKey: "running" };
  await repo.beginOperation(operation);
  assert.equal((await repo.cancel({ ...operation, expectedRevision: 2 })).count, 0);
  assert.equal((await repo.get(head.id, "teacher-a")).status, "running");
  assert.equal((await repo.cancel(operation)).count, 1);
  await assert.rejects(repo.commitRevision({ ...operation, operation: "revise", snapshot: {} }), /WORKFLOW_VERSION_CONFLICT/);
});
