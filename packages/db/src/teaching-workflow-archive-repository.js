import { createHash } from "node:crypto";
import { prisma as defaultPrisma } from "./client.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
export function teachingWorkflowArchiveId(workflowId, revision) {
  return `teaching-archive-${createHash("sha256").update(JSON.stringify([workflowId, revision])).digest("hex")}`;
}

// Internal-only callbacks run inside the transaction and must perform bounded
// authorization/evidence reads, never model calls or external side effects.
export function createTeachingWorkflowArchiveRepository(prisma = defaultPrisma) {
  return {
    async publish({ workflowId, ownerTeacherId, expectedRevision, authorize, prepare, validateExisting }) {
      if (!text(workflowId) || !text(ownerTeacherId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID", 422);
      if ([authorize, prepare, validateExisting].some((fn) => typeof fn !== "function")) fail("WORKFLOW_ARCHIVE_UNAVAILABLE", 503);
      return prisma.$transaction(async (tx) => {
        // A same-value UPDATE locks the head row. Edits/cancellation use this same
        // row, so version validation and publication share one serialization point.
        const locked = await tx.teachingWorkflow.updateMany({ where: { id: workflowId, ownerTeacherId }, data: { ownerTeacherId } });
        if (locked.count !== 1) fail("WORKFLOW_NOT_FOUND", 404);
        const workflow = await tx.teachingWorkflow.findFirst({ where: { id: workflowId, ownerTeacherId } });
        if (!workflow || workflow.module !== "grading" || !text(workflow.request?.studentId)) fail("WORKFLOW_ARCHIVE_INVALID", 422);
        if (await authorize({ workflow, tx }) !== true) fail("WORKFLOW_FORBIDDEN", 403);
        const id = teachingWorkflowArchiveId(workflowId, expectedRevision);
        const existing = await tx.submission.findUnique({ where: { id }, include: { grading: true } });
        if (existing) {
          const record = existing.content?.workflowArchive;
          if (record?.id !== id || record.workflowId !== workflowId || record.teacherId !== ownerTeacherId || record.revision !== expectedRevision ||
            record.studentId !== workflow.request.studentId || existing.studentId !== workflow.request.studentId ||
            await validateExisting({ submission: existing, workflow, tx }) !== true) fail("WORKFLOW_ARCHIVE_INVALID", 422);
          return { archive: record, replayed: true, currentRevision: workflow.currentRevision };
        }
        if (workflow.currentRevision !== expectedRevision || workflow.activeOperationKey || !["ready_for_review", "confirmed"].includes(workflow.status)) fail("WORKFLOW_VERSION_CONFLICT");
        const revision = await tx.teachingWorkflowRevision.findUnique({ where: { workflowId_revision: { workflowId, revision: expectedRevision } } });
        if (!revision?.snapshot || revision.snapshot.creationPending) fail("WORKFLOW_ARCHIVE_INVALID", 422);
        const previousSubmissions = await tx.submission.findMany({
          where: { studentId: workflow.request.studentId, content: { path: ["workflowArchive", "workflowId"], equals: workflowId } },
          include: { grading: true }
        });
        const prepared = await prepare({ workflow, snapshot: revision.snapshot, archiveId: id, previousSubmissions, tx });
        const record = prepared?.archive;
        if (!record || record.id !== id || record.workflowId !== workflowId || record.teacherId !== ownerTeacherId || record.revision !== expectedRevision ||
          record.studentId !== workflow.request.studentId || !text(prepared.assignmentId) || !Array.isArray(prepared.mistakes) ||
          prepared.mistakes.some((m) => m.studentId !== record.studentId || m.metadata?.workflowArchiveId !== id || m.metadata?.sourceSubmissionId !== id)) fail("WORKFLOW_ARCHIVE_INVALID", 422);
        await tx.submission.create({ data: {
          id, studentId: record.studentId, assignmentId: prepared.assignmentId, status: "GRADED", submittedAt: new Date(record.confirmedAt),
          content: { workflowArchive: record },
          grading: { create: { score: record.snapshot.finalScore, needsReview: false, result: {
            ...record.snapshot, archiveEligible: true, needsTeacherReview: false, provisionalScore: null,
            reviewStatus: "reviewed", reviewedByTeacherId: ownerTeacherId, reviewedAt: record.confirmedAt, archivePublishedAt: record.confirmedAt
          } } }
        } });
        if (prepared.mistakes.length) await tx.mistakeRecord.createMany({ data: prepared.mistakes });
        return { archive: record, replayed: false, currentRevision: workflow.currentRevision };
      });
    }
  };
}
