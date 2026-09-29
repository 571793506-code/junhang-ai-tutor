import { createHash } from "node:crypto";
import { prisma as defaultPrisma } from "./client.js";
import { createAssignmentDraft } from "./repositories.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }

// No model calls or file exports inside this transaction. The workflow head is
// the same serialization point used by edits and cancellation.
export function createTeachingWorkflowAssignmentRepository(prisma = defaultPrisma) {
  return {
    async publish({ workflowId, ownerTeacherId, expectedRevision, existingOnly = false, authorize, prepare, validateExisting }) {
      if (!text(workflowId) || !text(ownerTeacherId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID", 422);
      if ([authorize, prepare, validateExisting].some((fn) => typeof fn !== "function")) fail("WORKFLOW_ASSIGNMENT_UNAVAILABLE", 503);
      return prisma.$transaction(async (tx) => {
        const locked = await tx.teachingWorkflow.updateMany({ where: { id: workflowId, ownerTeacherId }, data: { ownerTeacherId } });
        if (locked.count !== 1) fail("WORKFLOW_NOT_FOUND", 404);
        const workflow = await tx.teachingWorkflow.findFirst({ where: { id: workflowId, ownerTeacherId } });
        if (!workflow || workflow.module !== "generation") fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
        const id = `teaching-assignment-${createHash("sha256").update(JSON.stringify([workflowId, expectedRevision])).digest("hex")}`;
        const existing = await tx.assignment.findUnique({ where: { id }, include: { subject: true, items: { orderBy: { orderIndex: "asc" } } } });
        if (await authorize({ workflow, tx, existing: Boolean(existing) }) !== true) fail("WORKFLOW_FORBIDDEN", 403);
        if (!existing && existingOnly) fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
        if (!existing && (workflow.currentRevision !== expectedRevision || workflow.activeOperationKey || !["ready_for_review", "confirmed"].includes(workflow.status))) fail("WORKFLOW_VERSION_CONFLICT");
        const revision = await tx.teachingWorkflowRevision.findUnique({ where: { workflowId_revision: { workflowId, revision: expectedRevision } } });
        if (!revision?.snapshot || revision.snapshot.creationPending) fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
        const prepared = await prepare({ workflow, snapshot: revision.snapshot, assignmentId: id, revision: expectedRevision, existing, tx });
        if (prepared?.id !== id) fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
        if (existing) {
          if (await validateExisting(existing, prepared) !== true) fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
          return { assignment: existing, replayed: true, currentRevision: workflow.currentRevision };
        }
        const assignment = await createAssignmentDraft(prepared, { prisma: tx });
        if (await validateExisting(assignment, prepared) !== true) fail("WORKFLOW_ASSIGNMENT_INVALID", 422);
        return { assignment, replayed: false, currentRevision: workflow.currentRevision };
      });
    }
  };
}
