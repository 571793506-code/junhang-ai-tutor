import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { createTeachingWorkflowArchiveService } from "@junhang/services";
import { createTeachingWorkflowArchiveRepository } from "@junhang/db";
import { fakeTeachingArchivePrisma } from "../../../scripts/test-support/teaching-archive-prisma.mjs";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";

test("HTTP archive uses persisted confirmation, session ownership and idempotent publication", async (t) => {
  const sourcePackage = buildGradingSourcePackage({ id: "paper1", items: [{ prompt: "1+1", answer: "2", score: 5 }] }).package;
  const snapshot = { gradingSourcePackage: sourcePackage, questions: [{ id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "3", correctAnswer: "2", score: 0, maxScore: 5, status: "wrong", explanation: "Add one and one.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" }] };
  const workflow = { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 3, status: "ready_for_review", request: { studentId: "s1" } };
  const db = fakeTeachingArchivePrisma({ workflows: [workflow], revisions: [{ workflowId: "w1", revision: 3, snapshot }] });
  let allowed = true;
  const archiveService = createTeachingWorkflowArchiveService({ repository: createTeachingWorkflowArchiveRepository(db),
    authorizeStudent: async ({ actor, studentId, tx }) => { assert.ok(tx); return allowed && actor.teacherId === "t1" && studentId === "s1"; },
    resolveArchiveEvidence: async () => ({ ok: true, studentId: "s1", assignmentId: "paper1", subject: "math", sourcePackage }) });
  const f = await workflowHttpFixture(t, { archiveService });
  const publish = (options = {}) => f.request("/workflows/w1/archive", { body: { expectedRevision: 3, studentId: "forged", actor: { teacherId: "t2" }, snapshot: { finalScore: 100 } }, ...options });
  assert.equal((await publish({ token: null })).status, 401);
  assert.equal((await publish({ token: f.tokens.student })).status, 403);
  assert.equal((await publish({ token: f.tokens.other })).status, 404);
  assert.equal(db.snapshot().submissions.length, 0);
  const first = await publish(); assert.equal(first.status, 201);
  const { archive } = await first.json();
  assert.deepEqual(Object.keys(archive).sort(), ["currentRevision", "id", "replayed", "revision", "status", "workflowId"]);
  assert.equal(archive.status, "archived"); assert.equal(archive.replayed, false);
  assert.equal(db.snapshot().submissions[0].grading.score, 0);
  const replay = await publish(); assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).archive, { ...archive, replayed: true });
  assert.equal(db.snapshot().submissions.length, 1); assert.equal(db.snapshot().mistakes.length, 1);
  allowed = false;
  assert.equal((await publish()).status, 403);
});

test("archive validates revision, whitelists input/output and rejects unavailable service", async (t) => {
  const calls = [];
  const f = await workflowHttpFixture(t, { archiveService: { publish: async (input) => {
    calls.push(input);
    return { archiveId: "a1", workflowId: "w1", revision: 3, currentRevision: 3, status: "archived", replayed: false, snapshot: { raw: "PRIVATE" }, teacherId: "PRIVATE" };
  } } });
  for (const body of [{}, [], { expectedRevision: "3" }, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal((await f.request("/workflows/w1/archive", { body })).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await f.request("/workflows/w1/archive", { body: { expectedRevision: 3, actor: "PRIVATE", archiveEligible: true } });
  assert.equal(response.status, 201); assert.equal((await response.text()).includes("PRIVATE"), false);
  assert.deepEqual(calls, [{ actor: { teacherId: "t1" }, workflowId: "w1", expectedRevision: 3 }]);
  const disabled = await workflowHttpFixture(t, { service: null });
  const unavailable = await disabled.request("/workflows/w1/archive", { body: { expectedRevision: 3 } });
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).error, "WORKFLOW_ARCHIVE_UNAVAILABLE");
});

test("archive errors are safe, conflicts do not retry and malformed success cannot publish", async (t) => {
  let result; let error; let calls = 0;
  const f = await workflowHttpFixture(t, { archiveService: { publish: async () => { calls++; if (error) throw error; return result; } } });
  for (const [code, status, expected] of [
    ["WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED", 422, "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED"],
    ["WORKFLOW_ARCHIVE_INVALID", 422, "WORKFLOW_ARCHIVE_INVALID"],
    ["WORKFLOW_VERSION_CONFLICT", 409, "WORKFLOW_VERSION_CONFLICT"],
    ["P2034", 409, "WORKFLOW_VERSION_CONFLICT"],
    ["PRIVATE", 500, "WORKFLOW_INTERNAL_ERROR"]
  ]) {
    error = Object.assign(new Error("PRIVATE database credentials"), { code });
    const before = calls;
    const response = await f.request("/workflows/w1/archive", { body: { expectedRevision: 3 } });
    assert.equal(response.status, status); assert.equal(calls, before + 1);
    const body = await response.json(); assert.equal(body.error, expected); assert.equal(JSON.stringify(body).includes("PRIVATE"), false);
  }
  error = null;
  for (const override of [{ status: "failed" }, { revision: 0 }, { currentRevision: 2 }, { replayed: "false" }, { archiveId: "" }, { workflowId: "other" }, { revision: 2 }]) {
    result = { archiveId: "a1", workflowId: "w1", revision: 3, currentRevision: 3, status: "archived", replayed: false, ...override };
    assert.equal((await f.request("/workflows/w1/archive", { body: { expectedRevision: 3 } })).status, 500);
  }
});
