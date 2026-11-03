import { isTeachingWorkflowArchiveSubmission } from "@junhang/services";
import { isImmutableTeachingArchive } from "./teaching-archive-guard.js";

function resultObject(value) {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

// Adapt frozen workflow evidence to the legacy read-only display contract.
export function projectArchivedGradingQuestion(question) {
  const text = value => value == null ? "" : typeof value === "string" ? value
    : Array.isArray(value) ? value.map(text).join("；") : JSON.stringify(value);
  const process = Array.isArray(question.studentProcess) && question.studentProcess.length
    ? question.studentProcess : question.observedWork == null ? [] : [question.observedWork];
  return { ...question, studentAnswer: text(question.studentAnswer), correctAnswer: text(question.correctAnswer), studentProcess: process.map(text) };
}

// A reviewed flag alone does not prove the separate archive action occurred.
export function gradingArchivePublishedAt(submission) {
  if (isImmutableTeachingArchive(submission) && !gradingWorkbenchArchivedSnapshot(submission)) return null;
  const result = resultObject(submission?.grading?.result);
  const at = result.archivePublishedAt;
  return submission?.status === "GRADED" && submission.grading?.needsReview === false
    && result.reviewStatus === "reviewed" && result.needsTeacherReview !== true
    && typeof result.reviewedByTeacherId === "string" && result.reviewedByTeacherId.trim()
    && typeof at === "string" && at.trim() && Number.isFinite(Date.parse(at)) ? at : null;
}

export function gradingWorkbenchArchivedSnapshot(submission) {
  return isImmutableTeachingArchive(submission) && isTeachingWorkflowArchiveSubmission(submission, submission.studentId)
    ? submission.content.workflowArchive.snapshot : null;
}

export async function loadGradingWorkbenchRows(prisma, { teacherId, studentId, reviewState = "pending" }) {
  const archived = reviewState === "archived";
  const submissions = await prisma.submission.findMany({
    where: {
      grading: { needsReview: !archived },
      ...(archived ? { status: "GRADED" } : {}),
      ...(studentId ? { studentId } : {}),
      student: { OR: [
        { responsibleTeacherId: teacherId },
        { teacherAssignments: { some: { teacherId, activeTo: null } } }
      ] }
    },
    orderBy: { submittedAt: "desc" },
    take: 500,
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });
  return {
    rows: archived ? submissions.filter(row => gradingArchivePublishedAt(row) !== null) : submissions,
    capped: submissions.length === 500
  };
}
