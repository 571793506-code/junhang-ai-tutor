import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowGenerationResolver, createTeachingAssignmentTargetAuthorizer } from "./teaching-workflow-generation-resolver.js";

test("generation target authorization precedes context reads and active student grade is authoritative", async () => {
  let allowed = false; let reads = 0; let prepared = 0;
  const row = { id: "s1", grade: "四年级", loginEnabled: true, deletedAt: null, enrollmentStatus: "ENROLLED" };
  const resolver = createTeachingWorkflowGenerationResolver({
    prisma: { student: { findUnique: async () => { reads++; return row; } } },
    authorizeStudent: async ({ actor, studentId }) => allowed && actor.teacherId === "t1" && studentId === "s1",
    prepareInput: async ({ request }) => { prepared++; return { ok: true, input: request }; }
  });
  const actor = { teacherId: "t1" }; const request = { studentId: "s1", subject: "数学" };
  assert.equal((await resolver({ actor, request })).ok, false); assert.equal(reads, 0); assert.equal(prepared, 0);
  allowed = true;
  assert.deepEqual((await resolver({ actor, request })).input, { ...request, grade: "四年级", targetScope: "student" });
  assert.equal((await resolver({ actor, request: { ...request, grade: "五年级" } })).ok, false);
  for (const field of ["loginEnabled", "enrollmentStatus", "deletedAt"]) {
    const original = row[field]; row[field] = field === "loginEnabled" ? false : field === "enrollmentStatus" ? "WITHDRAWN" : new Date();
    assert.equal((await resolver({ actor, request })).ok, false); row[field] = original;
  }
  assert.equal(prepared, 1);
});

test("grade-scope requests still require approved content from the common preparer", async () => {
  const resolver = createTeachingWorkflowGenerationResolver({ prisma: {}, authorizeStudent: () => { throw new Error("no student lookup"); },
    prepareInput: async ({ actor, request }) => { assert.equal(actor.teacherId, "t1"); assert.equal(request.textbookAssetId, "unapproved"); return { ok: false }; } });
  assert.equal((await resolver({ actor: { teacherId: "t1" }, request: { grade: "四年级", targetScope: "grade", textbookAssetId: "unapproved" } })).ok, false);
});

test("publishing requires current teacher scope and active student while replay keeps historical access", async () => {
  let allowed = true; let locked = 0; let reads = 0;
  const row = { id: "s1", grade: "四年级", loginEnabled: true, enrollmentStatus: "ENROLLED", deletedAt: null };
  const tx = { $queryRaw: async (_sql, id) => { assert.equal(id, "s1"); locked++; return [{ id }]; },
    student: { findUnique: async () => { reads++; return row; } } };
  const authorize = createTeachingAssignmentTargetAuthorizer({ authorizeStudent: async (input) => { assert.equal(input.tx, tx); return allowed; } });
  const input = { actor: { teacherId: "t1" }, workflow: { ownerTeacherId: "t1", request: { studentId: "s1", grade: "四年级" } }, tx, existing: false };
  assert.equal(await authorize(input), true); assert.equal(locked, 1);
  row.enrollmentStatus = "WITHDRAWN";
  assert.equal(await authorize(input), false);
  const oldReads = reads;
  assert.equal(await authorize({ ...input, existing: true }), true); assert.equal(reads, oldReads);
  allowed = false;
  assert.equal(await authorize({ ...input, existing: true }), false);
  assert.equal(await authorize(input), false); assert.equal(reads, oldReads);
  allowed = true; row.enrollmentStatus = "ENROLLED"; row.grade = "五年级";
  assert.equal(await authorize(input), false);
  assert.equal(await authorize({ ...input, actor: { teacherId: "t2" } }), false);
});
