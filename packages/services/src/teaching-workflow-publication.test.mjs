import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { createTeachingWorkflowArchiveRepository } from "../../db/src/teaching-workflow-archive-repository.js";
import { createTeachingWorkflowArchiveService } from "./teaching-workflow-publication.js";
import { selectCurrentTeachingEvidence } from "./teaching-workflow-archive.js";
import { fakeTeachingArchivePrisma } from "../../../scripts/test-support/teaching-archive-prisma.mjs";

const actor = { teacherId: "t1" };
function fixture() {
  const source = buildGradingSourcePackage({ id: "paper1", items: [1, 2].map((n) => ({ orderIndex: n, prompt: "1+1", answer: "2", score: 5 })) }).package;
  const snapshot = { gradingSourcePackage: source, questions: [1, 2].map((n) => ({ id: `q${n}`, questionNo: String(n), printedPrompt: "1+1", studentAnswer: "3", correctAnswer: "2", maxScore: 5, score: 0, status: "wrong", explanation: "Add one and one.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" })) };
  const workflow = { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 3, status: "ready_for_review", activeOperationKey: null, request: { studentId: "s1", assignmentId: "paper1" } };
  const db = fakeTeachingArchivePrisma({ workflows: [workflow], revisions: [{ workflowId: "w1", revision: 3, snapshot }] });
  const calls = [];
  let allow = true; let evidenceOk = true;
  const options = { repository: createTeachingWorkflowArchiveRepository(db),
    authorizeStudent: async ({ actor: who, studentId, tx }) => { calls.push("authorize"); assert.ok(tx); return allow && who.teacherId === "t1" && studentId === "s1"; },
    resolveArchiveEvidence: async ({ tx }) => { calls.push("evidence"); assert.ok(tx); return { ok: evidenceOk, studentId: "s1", assignmentId: "paper1", subject: "数学", sourcePackage: source }; },
    now: () => new Date("2026-09-14T12:00:00.000Z") };
  const service = createTeachingWorkflowArchiveService(options);
  const publish = (overrides = {}) => service.publish({ actor, workflowId: "w1", expectedRevision: 3, ...overrides });
  return { db, source, snapshot, workflow, service, options, publish, calls, deny: () => { allow = false; }, blockEvidence: () => { evidenceOk = false; } };
}

test("publication atomically stores an independent archive and derived mistakes without modifying the workflow revision", async () => {
  const f = fixture(); const before = f.db.snapshot().revisions;
  const result = await f.publish();
  assert.equal(result.status, "archived"); assert.equal(result.revision, 3); assert.equal(result.replayed, false);
  assert.equal(result.snapshot, undefined);
  const state = f.db.snapshot();
  assert.equal(state.submissions.length, 1); assert.equal(state.mistakes.length, 2);
  const saved = state.submissions[0];
  assert.equal(saved.grading.result.archiveEligible, true); assert.equal(saved.grading.score, 0);
  assert.equal(saved.content.workflowArchive.id, result.archiveId);
  assert.ok(state.mistakes.every((m) => m.metadata.workflowArchiveId === result.archiveId && m.studentId === "s1"));
  assert.deepEqual(state.revisions, before); assert.equal(state.workflows[0].currentRevision, 3);
  assert.deepEqual(f.db.events, ["lock", "submission", "mistakes", "commit"]);
});

test("concurrent publication and restart retries return one archive without duplicate mistakes", async () => {
  const f = fixture();
  const results = await Promise.all([f.publish(), f.publish()]);
  assert.equal(results[0].archiveId, results[1].archiveId);
  assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  const restarted = createTeachingWorkflowArchiveService(f.options);
  const replay = await restarted.publish({ actor, workflowId: "w1", expectedRevision: 3 });
  assert.equal(replay.replayed, true); assert.equal(f.db.snapshot().mistakes.length, 2);
  assert.equal(f.calls.filter((c) => c === "evidence").length, 1);
});

test("new zero-mistake archive supersedes the old one and old publication remains a historical replay", async () => {
  const f = fixture(); const first = await f.publish(); const old = structuredClone(f.db.snapshot().submissions[0]);
  const next = structuredClone(f.snapshot);
  next.questions.forEach((q) => { q.studentAnswer = "2"; q.score = 5; q.status = "correct"; });
  const state = f.db.snapshot();
  f.db.seed({ workflows: [{ ...f.workflow, currentRevision: 5 }], revisions: [...state.revisions, { workflowId: "w1", revision: 5, snapshot: next }] });
  const second = await f.publish({ expectedRevision: 5 });
  assert.notEqual(first.archiveId, second.archiveId);
  assert.deepEqual(f.db.snapshot().submissions[0], old);
  assert.deepEqual(f.db.snapshot().submissions[1].content.workflowArchive.supersedesArchiveIds, [first.archiveId]);
  const current = selectCurrentTeachingEvidence({ id: "s1", submissions: f.db.snapshot().submissions, mistakes: f.db.snapshot().mistakes });
  assert.equal(current.submissions.length, 1); assert.equal(current.mistakes.length, 0);
  const replay = await f.publish();
  assert.equal(replay.replayed, true); assert.equal(replay.revision, 3); assert.equal(replay.currentRevision, 5);
});

test("student scope, missing gates, stale revision and pending execution block publication", async () => {
  const denied = fixture(); denied.deny();
  await assert.rejects(denied.publish(), { code: "WORKFLOW_FORBIDDEN" });
  assert.equal(denied.db.snapshot().submissions.length, 0);
  const f = fixture();
  await assert.rejects(f.publish({ actor: { teacherId: "other" } }), { code: "WORKFLOW_NOT_FOUND" });
  await assert.rejects(f.publish({ expectedRevision: 2 }), { code: "WORKFLOW_VERSION_CONFLICT" });
  await assert.rejects(createTeachingWorkflowArchiveService({ repository: f.options.repository }).publish({ actor, workflowId: "w1", expectedRevision: 3 }), { code: "WORKFLOW_ARCHIVE_UNAVAILABLE" });
  f.db.seed({ workflows: [{ ...f.workflow, status: "running", activeOperationKey: "editing" }] });
  await assert.rejects(f.publish(), { code: "WORKFLOW_VERSION_CONFLICT" });
  assert.equal(f.db.snapshot().submissions.length, 0);
});

test("unconfirmed questions, changed source, and unresolved external evidence never publish", async () => {
  const f = fixture(); f.blockEvidence();
  await assert.rejects(f.publish(), { code: "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED" });
  const unconfirmed = fixture(); delete unconfirmed.snapshot.questions[0].confirmedBy;
  unconfirmed.db.seed({ revisions: [{ workflowId: "w1", revision: 3, snapshot: unconfirmed.snapshot }] });
  await assert.rejects(unconfirmed.publish(), { code: "WORKFLOW_ARCHIVE_INVALID" });
  const changed = fixture(); changed.source.fingerprint = "changed";
  await assert.rejects(changed.publish(), { code: "WORKFLOW_ARCHIVE_INVALID" });
  assert.equal(f.db.snapshot().mistakes.length + unconfirmed.db.snapshot().mistakes.length + changed.db.snapshot().mistakes.length, 0);
});

test("failure after submission insertion rolls the transaction back and a deliberate retry can publish", async () => {
  for (const failAt of ["submission", "mistakes", "commit"]) {
    const f = fixture(); const before = f.db.snapshot(); f.db.failAt = failAt;
    await assert.rejects(f.publish(), new RegExp(`TEST_${failAt.toUpperCase()}_FAILURE`));
    assert.deepEqual(f.db.snapshot(), before);
    f.db.failAt = null;
    assert.equal((await f.publish()).replayed, false);
    assert.equal(f.db.snapshot().submissions.length, 1); assert.equal(f.db.snapshot().mistakes.length, 2);
  }
});

test("replay still requires current teacher scope and rejects a modified persisted archive", async () => {
  const denied = fixture(); await denied.publish(); denied.deny();
  await assert.rejects(denied.publish(), { code: "WORKFLOW_FORBIDDEN" });
  const f = fixture(); await f.publish(); const state = f.db.snapshot();
  state.submissions[0].grading.result.questions[0].studentAnswer = "modified";
  f.db.seed(state);
  await assert.rejects(f.publish(), { code: "WORKFLOW_ARCHIVE_INVALID" });
  const evidence = fixture(); await evidence.publish(); const changed = evidence.db.snapshot();
  changed.submissions[0].grading.result.sourceImageRefs = ["changed-image"];
  evidence.db.seed(changed);
  await assert.rejects(evidence.publish(), { code: "WORKFLOW_ARCHIVE_INVALID" });
});

test("publication ignores caller-supplied scores, snapshots and ownership fields", async () => {
  const f = fixture();
  await f.publish({ score: 100, snapshot: { questions: [], finalScore: 100 }, ownerTeacherId: "other", studentId: "other", assignmentId: "other" });
  const saved = f.db.snapshot().submissions[0];
  assert.equal(saved.grading.score, 0); assert.equal(saved.studentId, "s1"); assert.equal(saved.assignmentId, "paper1");
  assert.equal(saved.content.workflowArchive.teacherId, "t1");
});
