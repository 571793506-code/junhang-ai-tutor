import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core/grading-source-package";
import {
  canUseGradingAssignment,
  collectionSubmissionId,
  collectionSubmissionReplayResult,
  confirmDialogueContentReview,
  isDialogueSourceConfirmed,
  isGradingSourceEligible,
  persistCollectionSubmission,
  resolveCollectionSubmissionReplay
} from "./grading-collection.js";

const source = (overrides = {}) => {
  const gradingSourcePackage = buildGradingSourcePackage({ id: "paper", title: "计算练习", grade: "三年级上册",
    metadata: { subject: "数学", kind: "练习" },
    items: [{ orderIndex: 1, prompt: "1+1", answer: "2", score: 1 }] }).package;
  return {
    id: "paper",
    grade: "三年级上册",
    metadata: { source: "dialogue-import", teacherId: "teacher-1", targetScope: "grade", targetGrade: "三年级",
      gradingSourcePackage, ...overrides }
  };
};

test("dialogue source requires server-side teacher confirmation bound to its fingerprint", () => {
  const assignment = source();
  assert.equal(isDialogueSourceConfirmed(assignment), false);
  assignment.metadata.dialogueContentReview = { status: "accepted", teacherId: "teacher-1", fingerprint: "other" };
  assert.equal(isDialogueSourceConfirmed(assignment), false);
  assignment.metadata.dialogueContentReview.fingerprint = assignment.metadata.gradingSourcePackage.fingerprint;
  assert.equal(isDialogueSourceConfirmed(assignment), true);
  assignment.metadata.dialogueContentReview.status = "rejected";
  assert.equal(isDialogueSourceConfirmed(assignment), false);
});

test("only accepted material for the exact grade or student can be used for grading", () => {
  const accepted = source();
  accepted.metadata.dialogueContentReview = { status: "accepted", teacherId: "teacher-1", fingerprint: accepted.metadata.gradingSourcePackage.fingerprint };
  const assignment = accepted;
  assert.equal(canUseGradingAssignment({ assignment, teacherId: "teacher-1", student: { id: "s1", grade: "三年级" } }).ok, true);
  assert.equal(canUseGradingAssignment({ assignment, teacherId: "teacher-1", student: { id: "s2", grade: "四年级" } }).reason, "ASSIGNMENT_GRADE_MISMATCH");
  assert.equal(canUseGradingAssignment({ assignment, teacherId: "teacher-2", student: { id: "s1", grade: "三年级" } }).reason, "ASSIGNMENT_TEACHER_SCOPE_MISMATCH");
  assignment.metadata.targetStudentId = "s1";
  assert.equal(canUseGradingAssignment({ assignment, teacherId: "teacher-1", student: { id: "s2", grade: "三年级" } }).reason, "ASSIGNMENT_STUDENT_MISMATCH");
});

test("web generated sources require teacher review, a valid package and a recognized grade", () => {
  const generated = source({ source: "web-generation", draftReviewStatus: "accepted" });
  assert.equal(isGradingSourceEligible(generated), true);
  generated.metadata.draftReviewStatus = "pending_teacher_review";
  assert.equal(isGradingSourceEligible(generated), false);
  generated.metadata.draftReviewStatus = "accepted";
  generated.metadata.targetGrade = "未知年级";
  assert.equal(isGradingSourceEligible(generated), false);
  generated.metadata.targetGrade = "三年级";
  generated.metadata.gradingSourcePackage.fingerprint = "tampered";
  assert.equal(isGradingSourceEligible(generated), false);
});

test("dialogue confirmation is teacher-owned, fingerprint-bound and immutable after rejection", () => {
  const assignment = source();
  const accepted = confirmDialogueContentReview(assignment, {
    teacherId: "teacher-1", decision: "accept", fingerprint: assignment.metadata.gradingSourcePackage.fingerprint
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.metadata.dialogueContentReview.teacherId, "teacher-1");
  assert.equal(isDialogueSourceConfirmed({ ...assignment, metadata: accepted.metadata }), true);
  assert.equal(confirmDialogueContentReview(assignment, {
    teacherId: "teacher-2", decision: "accept", fingerprint: assignment.metadata.gradingSourcePackage.fingerprint
  }).reason, "DIALOGUE_SOURCE_TEACHER_MISMATCH");
  assert.equal(confirmDialogueContentReview(assignment, {
    teacherId: "teacher-1", decision: "accept", fingerprint: "other"
  }).reason, "DIALOGUE_SOURCE_FINGERPRINT_MISMATCH");
  const rejected = confirmDialogueContentReview(assignment, {
    teacherId: "teacher-1", decision: "reject", fingerprint: assignment.metadata.gradingSourcePackage.fingerprint
  });
  assert.equal(confirmDialogueContentReview({ ...assignment, metadata: rejected.metadata }, {
    teacherId: "teacher-1", decision: "accept", fingerprint: assignment.metadata.gradingSourcePackage.fingerprint
  }).reason, "DIALOGUE_SOURCE_REJECTED");
});

test("collection submission id is stable per teacher, batch and student", () => {
  assert.equal(collectionSubmissionId("batch-1", "s1", "teacher-1"), collectionSubmissionId("batch-1", "s1", "teacher-1"));
  assert.notEqual(collectionSubmissionId("batch-1", "s1", "teacher-1"), collectionSubmissionId("batch-1", "s2", "teacher-1"));
  assert.notEqual(collectionSubmissionId("batch-1", "s1", "teacher-1"), collectionSubmissionId("batch-2", "s1", "teacher-1"));
  assert.notEqual(collectionSubmissionId("batch-1", "s1", "teacher-1"), collectionSubmissionId("batch-1", "s1", "teacher-2"));
});

test("an accepted material cannot be reversed by a later rejection of the same version", () => {
  const assignment = source();
  const input = { teacherId: "teacher-1", decision: "accept", fingerprint: assignment.metadata.gradingSourcePackage.fingerprint };
  const first = confirmDialogueContentReview(assignment, input);
  const accepted = { ...assignment, metadata: first.metadata };
  assert.equal(confirmDialogueContentReview(accepted, input).replayed, true);
  assert.equal(confirmDialogueContentReview(accepted, { ...input, decision: "reject" }).reason, "DIALOGUE_SOURCE_REVIEW_FINAL");
  assert.equal(isGradingSourceEligible(accepted), true);
});

test("collection retries reuse only an identical student submission", () => {
  const existing = { id: "collection-1", assignmentId: "paper", studentId: "s1", content: {
    collectionBatchId: "batch-1", collectionTeacherId: "teacher-1", collectionContentFingerprint: "sha256:one"
  } };
  const input = { assignmentId: "paper", batchId: "batch-1", studentId: "s1", teacherId: "teacher-1", fingerprint: "sha256:one" };
  assert.equal(resolveCollectionSubmissionReplay(existing, input), "replay");
  assert.equal(resolveCollectionSubmissionReplay(existing, { ...input, fingerprint: "sha256:two" }), "conflict");
  assert.equal(resolveCollectionSubmissionReplay(existing, { ...input, assignmentId: "other-paper" }), "conflict");
  assert.equal(resolveCollectionSubmissionReplay(null, input), "create");
});

test("collection replay reports current persisted status without returning model internals", () => {
  const result = collectionSubmissionReplayResult({ id: "saved", assignmentId: "paper", status: "GRADED",
    content: { ocrStatus: "READY" }, grading: { id: "grade-1", score: 8, result: {
      summary: "已完成教师复核", reviewStatus: "reviewed", available: true, providerId: "private-provider",
      rawText: "private output", model: "private-model", questionResults: [{ questionNo: "1", score: 8 }]
    } } }, { imageCount: 2 });
  assert.equal(result.queued, false);
  assert.equal(result.available, true);
  assert.equal(result.structured.persistedStatus, "GRADED");
  assert.equal(result.structured.evidence.ocrStatus, "READY");
  assert.equal(result.persisted.submissionId, "saved");
  assert.equal("providerId" in result.structured, false);
  assert.equal("rawText" in result.structured, false);
  assert.equal("model" in result.structured, false);

  const pending = collectionSubmissionReplayResult({ id: "pending", status: "SUBMITTED", content: { ocrStatus: "RUNNING" }, grading: { result: {} } });
  assert.equal(pending.queued, true);
  assert.equal(pending.structured.evidence.ocrStatus, "RUNNING");
});

test("batch persistence locks before reading, replays identical content and refuses a second source", async () => {
  const calls = [], rows = [];
  const tx = {
    $queryRaw: async () => calls.push("lock"),
    submission: {
      findFirst: async () => { calls.push("batch"); return rows[0] || null; },
      findUnique: async ({ where }) => { calls.push("student"); return rows.find(row => row.id === where.id) || null; }
    }
  };
  const prisma = { $transaction: async work => work(tx) };
  const input = { assignmentId: "paper", studentId: "s1", collectionBatchId: "b", collectionTeacherId: "t",
    collectionSubmissionId: "stable-id", collectionContentFingerprint: "pages-1", collectionTitle: "周测" };
  let creates = 0;
  const create = async (value, db) => {
    assert.equal(db, tx); creates++;
    const row = { id: value.collectionSubmissionId, assignmentId: value.assignmentId, studentId: value.studentId, content: {
      collectionBatchId: value.collectionBatchId, collectionTeacherId: value.collectionTeacherId,
      collectionContentFingerprint: value.collectionContentFingerprint, collectionTitle: value.collectionTitle
    } };
    rows.push(row); return row;
  };
  const first = await persistCollectionSubmission(prisma, input, create);
  assert.equal(first.replayed, false);
  assert.deepEqual(calls.slice(0, 3), ["lock", "batch", "student"]);
  assert.equal((await persistCollectionSubmission(prisma, { ...input }, create)).replayed, true);
  assert.equal(creates, 1);
  assert.equal((await persistCollectionSubmission(prisma, { ...input, collectionContentFingerprint: "changed" }, create)).error, "COLLECTION_SUBMISSION_CONFLICT");
  assert.equal((await persistCollectionSubmission(prisma, { ...input, studentId: "s2", assignmentId: "other" }, create)).error, "COLLECTION_BATCH_SOURCE_CONFLICT");
  const second = await persistCollectionSubmission(prisma, { ...input, studentId: "s2", collectionSubmissionId: "student-2", collectionTitle: "renamed" }, create);
  assert.equal(second.submission.content.collectionTitle, "周测");
  assert.equal(creates, 2);
});
