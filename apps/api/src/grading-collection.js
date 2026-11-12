import { createHash } from "node:crypto";
import { normalizeGradeLevel } from "@junhang/core";
import { validateGradingSourcePackage } from "@junhang/core/grading-source-package";

const safeJson = (value) => value && typeof value === "object" ? value : {};

export function isDialogueSourceConfirmed(assignment = {}) {
  const metadata = safeJson(assignment.metadata);
  if (metadata.source !== "dialogue-import") return true;
  const sourcePackage = safeJson(metadata.gradingSourcePackage);
  const review = safeJson(metadata.dialogueContentReview);
  return review.status === "accepted" &&
    review.teacherId === metadata.teacherId &&
    review.fingerprint === sourcePackage.fingerprint &&
    Boolean(sourcePackage.fingerprint) &&
    validateGradingSourcePackage(sourcePackage).ok;
}

export function isGradingSourceEligible(assignment = {}) {
  const metadata = safeJson(assignment.metadata);
  if (!normalizeGradeLevel(metadata.targetGrade || assignment.grade)?.level) return false;
  if (!validateGradingSourcePackage(safeJson(metadata.gradingSourcePackage)).ok) return false;
  return metadata.source === "dialogue-import"
    ? isDialogueSourceConfirmed(assignment)
    : metadata.draftReviewStatus === "accepted";
}

export function confirmDialogueContentReview(assignment = {}, { teacherId, decision, fingerprint, note = "", now = new Date().toISOString() } = {}) {
  const metadata = safeJson(assignment.metadata);
  if (metadata.source !== "dialogue-import") return { ok: false, reason: "DIALOGUE_SOURCE_REQUIRED" };
  if (!teacherId || teacherId !== metadata.teacherId) return { ok: false, reason: "DIALOGUE_SOURCE_TEACHER_MISMATCH" };
  if (!["accept", "reject"].includes(decision)) return { ok: false, reason: "DIALOGUE_SOURCE_DECISION_REQUIRED" };
  const source = safeJson(metadata.gradingSourcePackage);
  if (!fingerprint || fingerprint !== source.fingerprint) return { ok: false, reason: "DIALOGUE_SOURCE_FINGERPRINT_MISMATCH" };
  if (!validateGradingSourcePackage(source).ok) return { ok: false, reason: "GRADING_SOURCE_PACKAGE_INVALID" };
  if (!normalizeGradeLevel(metadata.targetGrade || assignment.grade)?.level) return { ok: false, reason: "ASSIGNMENT_GRADE_REQUIRED" };
  const previous = safeJson(metadata.dialogueContentReview);
  if (previous.status === "rejected" && decision === "accept") return { ok: false, reason: "DIALOGUE_SOURCE_REJECTED" };
  if (previous.status === "accepted" && decision === "reject") return { ok: false, reason: "DIALOGUE_SOURCE_REVIEW_FINAL" };
  const status = decision === "accept" ? "accepted" : "rejected";
  if (previous.status === status && previous.fingerprint === fingerprint && previous.teacherId === teacherId) {
    return { ok: true, replayed: true, metadata };
  }
  return { ok: true, metadata: { ...metadata, draftReviewStatus: status,
    dialogueContentReview: { status, teacherId, fingerprint, reviewedAt: now, note: String(note).slice(0, 2000) } } };
}

export function canUseGradingAssignment({ assignment, teacherId, student } = {}) {
  if (!assignment || !student?.id) return { ok: false, reason: "STUDENT_REQUIRED" };
  const metadata = safeJson(assignment.metadata);
  if (metadata.teacherId && metadata.teacherId !== teacherId) {
    return { ok: false, reason: "ASSIGNMENT_TEACHER_SCOPE_MISMATCH" };
  }
  if (!isDialogueSourceConfirmed(assignment)) {
    return { ok: false, reason: "DIALOGUE_SOURCE_NOT_CONFIRMED" };
  }
  if (!isGradingSourceEligible(assignment)) return { ok: false, reason: "GRADING_SOURCE_NOT_READY" };
  const targetStudentId = metadata.targetStudentId || null;
  if (targetStudentId && targetStudentId !== student.id) {
    return { ok: false, reason: "ASSIGNMENT_STUDENT_MISMATCH" };
  }
  const targetGrade = metadata.targetGrade || assignment.grade || null;
  const expected = normalizeGradeLevel(targetGrade)?.level;
  const actual = normalizeGradeLevel(student.grade)?.level;
  if (targetStudentId && !student.grade) return { ok: false, reason: "STUDENT_GRADE_REQUIRED" };
  if (targetGrade && (!expected || !actual || expected !== actual)) {
    return { ok: false, reason: "ASSIGNMENT_GRADE_MISMATCH" };
  }
  return { ok: true };
}

export function collectionSubmissionId(batchId, studentId, teacherId) {
  if (!batchId || !studentId) throw new Error("COLLECTION_BATCH_AND_STUDENT_REQUIRED");
  const digest = createHash("sha256").update(`${teacherId || ""}\0${batchId}\0${studentId}`).digest("hex").slice(0, 40);
  return `collection-${digest}`;
}

export function resolveCollectionSubmissionReplay(existing, { assignmentId, batchId, studentId, teacherId, fingerprint } = {}) {
  if (!existing) return "create";
  const content = safeJson(existing.content);
  return existing.assignmentId === assignmentId && existing.studentId === studentId &&
    content.collectionBatchId === batchId && content.collectionTeacherId === teacherId &&
    content.collectionContentFingerprint === fingerprint ? "replay" : "conflict";
}

// A retry acknowledges the saved work; detailed results stay behind the review API.
export function collectionSubmissionReplayResult(submission, { imageCount = 0 } = {}) {
  const current = safeJson(submission?.grading?.result);
  const content = safeJson(submission?.content);
  const status = String(submission?.status || "").toUpperCase();
  const queued = status === "SUBMITTED" || status === "PROCESSING";
  const reviewed = status === "GRADED";
  const ocrStatus = queued ? "RUNNING" : ["READY", "FAILED", "PARTIAL", "UNAVAILABLE"].includes(content.ocrStatus) ? content.ocrStatus : null;
  const available = !queued && current.available === true;
  return {
    available, queued, gradingText: "",
    structured: {
      available, queued, persistedStatus: status || null, needsTeacherReview: !reviewed,
      reviewStatus: queued ? "processing" : reviewed ? "reviewed" : "pending_teacher_review",
      summary: queued ? "作答已保存，正在后台识别批改。" : reviewed ? "作答已保存，请在批改记录中查看教师复核结果。" : "作答已保存，请在复核队列查看处理状态。",
      evidence: { ocrStatus, imageCount: content.imageFiles?.length || imageCount, uploadedBy: "teacher" }
    },
    persisted: { submissionId: submission?.id || null, gradingResultId: submission?.grading?.id || null,
      assignmentId: submission?.assignmentId || null }
  };
}

export async function persistCollectionSubmission(prisma, input, createSubmission) {
  return prisma.$transaction(async tx => {
    const lockKey = JSON.stringify([input.collectionTeacherId, input.collectionBatchId]);
    // Cast PostgreSQL's void result so Prisma can deserialize the lock query.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked`;
    const existingBatchRecord = await tx.submission.findFirst({ where: { AND: [
      { content: { path: ["collectionTeacherId"], equals: input.collectionTeacherId } },
      { content: { path: ["collectionBatchId"], equals: input.collectionBatchId } }
    ] }, select: { id: true, assignmentId: true, content: true } });
    if (existingBatchRecord && existingBatchRecord.assignmentId !== input.assignmentId) {
      return { error: "COLLECTION_BATCH_SOURCE_CONFLICT" };
    }
    if (existingBatchRecord?.content?.collectionTitle) input = { ...input, collectionTitle: existingBatchRecord.content.collectionTitle };

    const existing = await tx.submission.findUnique({ where: { id: input.collectionSubmissionId }, include: { grading: true } });
    if (existing) return resolveCollectionSubmissionReplay(existing, {
      assignmentId: input.assignmentId, studentId: input.studentId, batchId: input.collectionBatchId,
      teacherId: input.collectionTeacherId, fingerprint: input.collectionContentFingerprint
    }) === "replay" ? { submission: existing, replayed: true } : { error: "COLLECTION_SUBMISSION_CONFLICT" };

    return { submission: await createSubmission(input, tx), replayed: false };
  });
}
