import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive, reuseArchivedQuestionConfirmations, selectCurrentTeachingEvidence } from "./teaching-workflow-archive.js";
import { createTeachingWorkflowService } from "./teaching-workflow-service.js";
import { createTeachingWorkflowValidator } from "./teaching-workflow-validation.js";
import { createTeachingWorkflowRepository } from "../../db/src/teaching-workflow-repository.js";
import { fakeWorkflowPrisma } from "../../../scripts/test-support/teaching-workflow-prisma.mjs";

const actor = { teacherId: "t1" };
const source = buildGradingSourcePackage({ id: "paper1", items: [1, 2].map((n) => ({ orderIndex: n, prompt: "1+1", answer: "2", score: 5 })) }).package;
const snapshot = () => ({ gradingSourcePackage: source, questions: [1, 2].map((n) => ({ id: `q${n}`, questionNo: String(n), printedPrompt: "1+1", studentAnswer: "3", correctAnswer: "2", maxScore: 5, score: 0, status: "wrong", explanation: "Add one and one.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" })) });
const workflow = (revision = 3) => ({ id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: revision, request: { studentId: "s1" } });
const archive = (options = {}) => buildTeachingWorkflowArchive({ actor, workflow: workflow(), snapshot: snapshot(), submissionId: "a1", confirmedAt: "2026-07-04T10:00:00.000Z", resolveGradingSource: async () => source, ...options });
const submission = (record) => ({ id: record.id, studentId: record.studentId, status: "GRADED", submittedAt: record.confirmedAt, content: { workflowArchive: record }, grading: { score: record.snapshot.score, result: { ...record.snapshot, archiveEligible: true, needsTeacherReview: false } } });
const mistake = (id, record) => ({ id, studentId: "s1", createdAt: "2026-07-04T10:00:00.000Z", metadata: { sourceSubmissionId: record.id, workflowArchiveId: record.id } });

test("archive snapshots are immutable, require teacher confirmation and retain explicit ancestry", async () => {
  const old = await archive(); const before = structuredClone(old);
  const next = await archive({ workflow: workflow(5), submissionId: "a2", previousArchive: old });
  assert.deepEqual(next.supersedesArchiveIds, ["a1"]); assert.deepEqual(old, before);
  assert.equal(next.snapshot.score, 0); assert.equal(next.snapshot.finalScore, 0);
  await assert.rejects(archive({ actor: { teacherId: "other" } }), { code: "WORKFLOW_ARCHIVE_INVALID" });
  const unreviewed = snapshot(); delete unreviewed.questions[0].confirmedBy;
  await assert.rejects(archive({ snapshot: unreviewed }), { code: "WORKFLOW_ARCHIVE_INVALID" });
  await assert.rejects(archive({ previousArchive: old }), { code: "WORKFLOW_ARCHIVE_INVALID" });
  assert.deepEqual(await archive(), old);
  await assert.rejects(archive({ resolveGradingSource: null }), { code: "WORKFLOW_ARCHIVE_INVALID" });
  await assert.rejects(archive({ workflow: { ...workflow(5), request: { studentId: "s2" } }, previousArchive: old, submissionId: "a2" }), { code: "WORKFLOW_ARCHIVE_INVALID" });
});

test("trusted confirmation reuse is bound to teacher, student, source, question content and dependencies", async () => {
  const saved = await archive();
  const input = snapshot(); input.questions.forEach((q) => { delete q.reviewedByTeacher; delete q.confirmedBy; });
  const args = { actor, request: { studentId: "s1", submissionId: "a1" }, snapshot: input, archive: saved };
  assert.ok(reuseArchivedQuestionConfirmations(args).questions.every((q) => q.reviewedByTeacher));
  for (const change of [
    { actor: { teacherId: "other" } }, { request: { studentId: "s2", submissionId: "a1" } },
    { request: { studentId: "s1", submissionId: "another" } },
    { snapshot: { ...input, gradingSourcePackage: { ...source, fingerprint: "changed" } } },
    { archive: { ...saved, revision: 999 } }
  ]) assert.ok(reuseArchivedQuestionConfirmations({ ...args, ...change }).questions.every((q) => !q.reviewedByTeacher));
  const changed = structuredClone(input); changed.questions[1].studentAnswer = "4";
  const reused = reuseArchivedQuestionConfirmations({ ...args, snapshot: changed });
  assert.equal(reused.questions[0].reviewedByTeacher, true); assert.equal(reused.questions[1].reviewedByTeacher, undefined);
  changed.sharedMaterials = [{ id: "new", text: "Changed evidence" }];
  assert.ok(reuseArchivedQuestionConfirmations({ ...args, snapshot: changed }).questions.every((q) => !q.reviewedByTeacher));
  const imageChanged = { ...input, sourceImageRefs: ["changed-image"] };
  assert.ok(reuseArchivedQuestionConfirmations({ ...args, snapshot: imageChanged }).questions.every((q) => !q.reviewedByTeacher));
});

test("latest archive replaces grading and mistakes even when the correction has zero mistakes", async () => {
  const old = await archive(); const correct = snapshot();
  correct.questions.forEach((q) => { q.status = "correct"; q.score = 5; q.studentAnswer = "2"; });
  const next = await archive({ workflow: workflow(5), snapshot: correct, submissionId: "a2", previousArchive: old });
  const student = { id: "s1", submissions: [submission(old), submission(next)], mistakes: [mistake("m1", old), { id: "legacy", metadata: {} }] };
  const selected = selectCurrentTeachingEvidence(student);
  assert.deepEqual(selected.submissions.map((s) => s.id), ["a2"]);
  assert.deepEqual(selected.mistakes.map((m) => m.id), ["legacy"]);
  assert.equal(student.submissions.length, 2);
  const unconfirmed = submission(next); unconfirmed.grading.result.needsTeacherReview = true;
  const blocked = selectCurrentTeachingEvidence({ ...student, submissions: [submission(old), unconfirmed] });
  assert.ok(blocked.submissions.some((s) => s.id === "a1"));
  assert.ok(blocked.mistakes.some((m) => m.id === "m1"));
});

test("invalid, foreign and conflicting archives cannot become current evidence", async () => {
  const old = await archive();
  const forged = submission({ ...old, studentId: "s2" });
  const fork = await archive({ submissionId: "fork" });
  const selected = selectCurrentTeachingEvidence({ id: "s1", submissions: [submission(old), submission(fork), forged], mistakes: [mistake("m1", old), { id: "orphan", metadata: { workflowArchiveId: "missing" } }] });
  assert.equal(selected.submissions.length, 0); assert.equal(selected.mistakes.length, 0);
});

test("modified archived result cannot retain an old archive marker", async () => {
  const old = await archive(); const changed = submission(old);
  changed.grading.result = structuredClone(changed.grading.result);
  changed.grading.result.questions[0].studentAnswer = "changed";
  const selected = selectCurrentTeachingEvidence({ id: "s1", submissions: [changed], mistakes: [mistake("m1", old)] });
  assert.equal(selected.submissions.length, 0); assert.equal(selected.mistakes.length, 0);
});

test("creation reuses only the separately resolved archive and recomputes reviewed totals", async () => {
  const saved = await archive();
  const validateSnapshot = createTeachingWorkflowValidator({ resolveGradingSource: async () => source });
  for (const resolver of [null, async () => saved]) {
    const service = createTeachingWorkflowService({ repository: createTeachingWorkflowRepository(fakeWorkflowPrisma()), validateSnapshot,
      resolveConfirmedArchive: resolver, createDraft: async () => ({ snapshot: { ...snapshot(), workflowArchive: saved } }) });
    const created = await service.create({ actor, input: { module: "grading", requestKey: "import", request: { studentId: "s1", submissionId: "a1" } } });
    assert.equal(created.status, "ready_for_review");
    assert.equal(created.snapshot.finalScore, resolver ? 0 : null);
    assert.equal(created.snapshot.workflowArchive, undefined);
    assert.equal(created.snapshot.archiveEligible, false);
  }
});
