import { randomUUID } from "node:crypto";
import { prisma as defaultPrisma } from "./client.js";
import { teachingWorkflowArchiveId } from "./teaching-workflow-archive-repository.js";

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function text(value) { return typeof value === "string" && value.trim().length > 0; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const snapshotCopy = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("WORKFLOW_SNAPSHOT_INVALID", 422);
  return JSON.parse(JSON.stringify(value));
};
function identity(input) {
  if (!text(input.workflowId) || !text(input.ownerTeacherId)) fail("WORKFLOW_INPUT_INVALID", 422);
}
function command(input) {
  identity(input);
  if (!text(input.operationKey) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) fail("WORKFLOW_COMMAND_INVALID", 422);
}

// Internal repository: actor IDs must come from authenticated services, never request JSON.
export function createTeachingWorkflowRepository(prisma = defaultPrisma) {
  const archiveSubmission = (head, value) => head.module === "grading" && prisma.submission
    ? prisma.submission.findUnique({ where: { id: teachingWorkflowArchiveId(head.id, value) }, include: { grading: true } }) : null;
  const owned = async (db, workflowId, ownerTeacherId) => {
    if (!text(workflowId) || !text(ownerTeacherId)) fail("WORKFLOW_INPUT_INVALID", 422);
    return db.teachingWorkflow.findFirst({ where: { id: workflowId, ownerTeacherId } });
  };
  const revision = (db, workflowId, value) => db.teachingWorkflowRevision.findUnique({ where: { workflowId_revision: { workflowId, revision: value } } });
  const creationInput = (input) => {
    if (!text(input.ownerTeacherId) || !text(input.requestKey) || !["generation", "grading"].includes(input.module)) fail("WORKFLOW_INPUT_INVALID", 422);
    return { ownerTeacherId: input.ownerTeacherId, requestKey: input.requestKey, module: input.module, request: snapshotCopy(input.request || {}) };
  };
  const findCreation = async (db, input) => {
    const head = await db.teachingWorkflow.findUnique({ where: { ownerTeacherId_requestKey: { ownerTeacherId: input.ownerTeacherId, requestKey: input.requestKey } } });
    if (!head) return null;
    const first = await revision(db, head.id, 1);
    if (head.module !== input.module || !same(head.request, input.request) || first?.operation !== "reserve" || first.snapshot?.creationPending !== true) fail("WORKFLOW_REQUEST_KEY_REUSED");
    return head;
  };
  const duplicate = (existing, input, snapshot) => {
    if ((existing.commandFingerprint || null) !== (input.commandFingerprint || null)) fail("WORKFLOW_OPERATION_KEY_REUSED");
    if (existing.baseRevision !== input.expectedRevision || existing.operation !== input.operation ||
      !same(existing.snapshot, snapshot) || !same(existing.affectedQuestionIds, input.affectedQuestionIds || [])) fail("WORKFLOW_OPERATION_KEY_REUSED");
    return existing;
  };
  return {
    async getCreation(input) {
      return findCreation(prisma, creationInput(input));
    },
    async reserveCreation(input) {
      const request = creationInput(input);
      const reuse = async (db) => {
        const existing = await findCreation(db, request);
        return existing ? { workflow: existing, created: false } : null;
      };
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await reuse(tx);
          if (existing) return existing;
          const workflow = await tx.teachingWorkflow.create({ data: {
            ...request, id: randomUUID(), currentRevision: 1, status: "queued", subjectRef: null,
            revisions: { create: { revision: 1, baseRevision: 0, operationKey: `reserve:${request.requestKey}`, operation: "reserve",
              actorTeacherId: request.ownerTeacherId, snapshot: { creationPending: true, questions: [] }, affectedQuestionIds: [] } }
          } });
          return { workflow, created: true };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        // Read after the unique-key winner commits. Only that winner may start execution.
        const existing = await reuse(prisma);
        if (!existing) throw error;
        return existing;
      }
    },
    async create(input) {
      if (!text(input.ownerTeacherId) || !text(input.requestKey) || !["generation", "grading"].includes(input.module)) fail("WORKFLOW_INPUT_INVALID", 422);
      const request = snapshotCopy(input.request || {});
      const snapshot = snapshotCopy(input.snapshot || {});
      const where = { ownerTeacherId_requestKey: { ownerTeacherId: input.ownerTeacherId, requestKey: input.requestKey } };
      const reuse = async (db, existing) => {
        const original = await revision(db, existing.id, 1);
        if (existing.module !== input.module || (existing.subjectRef || null) !== (input.subjectRef || null) || !same(existing.request, request) || !same(original.snapshot, snapshot)) fail("WORKFLOW_REQUEST_KEY_REUSED");
        return existing;
      };
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.teachingWorkflow.findUnique({ where });
          if (existing) return reuse(tx, existing);
          return tx.teachingWorkflow.create({ data: {
            id: input.id || randomUUID(), ownerTeacherId: input.ownerTeacherId, module: input.module,
            subjectRef: input.subjectRef || null, requestKey: input.requestKey, currentRevision: 1,
            status: "queued", request,
            revisions: { create: { revision: 1, baseRevision: 0, operationKey: `create:${input.requestKey}`, operation: "create", actorTeacherId: input.ownerTeacherId, snapshot, affectedQuestionIds: [] } }
          } });
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await prisma.teachingWorkflow.findUnique({ where });
        if (!existing) throw error;
        return reuse(prisma, existing);
      }
    },
    async get(workflowId, ownerTeacherId) {
      const head = await owned(prisma, workflowId, ownerTeacherId);
      return head ? { ...head, snapshot: (await revision(prisma, head.id, head.currentRevision)).snapshot,
        archiveSubmission: await archiveSubmission(head, head.currentRevision) } : null;
    },
    async list(ownerTeacherId, module) {
      if (!text(ownerTeacherId)) fail("WORKFLOW_INPUT_INVALID", 422);
      const heads = await prisma.teachingWorkflow.findMany({ where: { ownerTeacherId, ...(module ? { module } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
      return Promise.all(heads.map(async (head) => ({ ...head, snapshot: (await revision(prisma, head.id, head.currentRevision)).snapshot,
        archiveSubmission: await archiveSubmission(head, head.currentRevision) })));
    },
    async getRevision(workflowId, value, ownerTeacherId) {
      const head = await owned(prisma, workflowId, ownerTeacherId);
      if (!head) return null;
      const saved = await revision(prisma, workflowId, value);
      return saved ? { ...saved, archiveSubmission: await archiveSubmission(head, value) } : null;
    },
    async getOperation(workflowId, operationKey, ownerTeacherId) {
      if (!text(operationKey) || !text(ownerTeacherId)) fail("WORKFLOW_INPUT_INVALID", 422);
      if (!await owned(prisma, workflowId, ownerTeacherId)) return null;
      return prisma.teachingWorkflowRevision.findUnique({ where: { workflowId_operationKey: { workflowId, operationKey } } });
    },
    async beginOperation(input) {
      command(input);
      return prisma.$transaction(async (tx) => {
        const head = await owned(tx, input.workflowId, input.ownerTeacherId);
        if (!head) fail("WORKFLOW_NOT_FOUND", 404);
        if (head.checkpoint?.operationKey === input.operationKey || head.activeOperationKey) fail("WORKFLOW_OPERATION_ACTIVE_OR_REUSED");
        if (await tx.teachingWorkflowRevision.findUnique({ where: { workflowId_operationKey: { workflowId: head.id, operationKey: input.operationKey } } })) fail("WORKFLOW_OPERATION_KEY_REUSED");
        const checkpoint = input.resetCheckpoint
          ? { operationKey: input.operationKey, units: {} }
          : { ...(head.checkpoint || {}), operationKey: input.operationKey, units: head.checkpoint?.units || {} };
        const result = await tx.teachingWorkflow.updateMany({ where: {
          id: head.id,
          ownerTeacherId: input.ownerTeacherId,
          currentRevision: input.expectedRevision,
          status: { in: input.initialCreation ? ["queued"] : ["queued", "interrupted", "needs_input", "failed", "ready_for_review", "confirmed"] },
          activeOperationKey: null
        }, data: { status: "running", activeOperationKey: input.operationKey, checkpoint } });
        if (result.count !== 1) fail("WORKFLOW_VERSION_CONFLICT");
        return checkpoint;
      });
    },
    async commitRevision(input) {
      command(input);
      if (!text(input.operation)) fail("WORKFLOW_COMMAND_INVALID", 422);
      const snapshot = snapshotCopy(input.snapshot);
      return prisma.$transaction(async (tx) => {
        if (!await owned(tx, input.workflowId, input.ownerTeacherId)) fail("WORKFLOW_NOT_FOUND", 404);
        const findDuplicate = () => tx.teachingWorkflowRevision.findUnique({ where: { workflowId_operationKey: { workflowId: input.workflowId, operationKey: input.operationKey } } });
        const existing = await findDuplicate();
        if (existing) return duplicate(existing, input, snapshot);
        const result = await tx.teachingWorkflow.updateMany({ where: {
          id: input.workflowId, ownerTeacherId: input.ownerTeacherId, currentRevision: input.expectedRevision,
          ...(input.commandFingerprint
            ? { status: "running", activeOperationKey: input.operationKey }
            : { OR: [{ status: "running", activeOperationKey: input.operationKey }, { status: { in: ["queued", "ready_for_review", "confirmed"] }, activeOperationKey: null }] })
        }, data: { currentRevision: { increment: 1 }, status: "ready_for_review", activeOperationKey: null,
          ...(input.operation === "create" ? { subjectRef: input.subjectRef || null } : {}) } });
        if (result.count !== 1) {
          const replay = await findDuplicate();
          if (replay) return duplicate(replay, input, snapshot);
          fail("WORKFLOW_VERSION_CONFLICT");
        }
        return tx.teachingWorkflowRevision.create({ data: {
          workflowId: input.workflowId, revision: input.expectedRevision + 1, baseRevision: input.expectedRevision,
          operationKey: input.operationKey, operation: input.operation, actorTeacherId: input.ownerTeacherId,
          snapshot, affectedQuestionIds: input.affectedQuestionIds || [],
          commandFingerprint: input.commandFingerprint || null
        } });
      });
    },
    async saveCheckpoint(input) {
      command(input);
      if (!text(input.unitId) || ["__proto__", "constructor", "prototype"].includes(input.unitId)) fail("WORKFLOW_UNIT_INVALID", 422);
      const candidate = snapshotCopy(input.candidate);
      return prisma.$transaction(async (tx) => {
        // This write locks the head row before merging concurrently finished units.
        const locked = await tx.teachingWorkflow.updateMany({ where: { id: input.workflowId, ownerTeacherId: input.ownerTeacherId, currentRevision: input.expectedRevision, status: "running", activeOperationKey: input.operationKey }, data: { activeOperationKey: input.operationKey } });
        if (locked.count !== 1) fail("WORKFLOW_CHECKPOINT_STALE");
        const head = await owned(tx, input.workflowId, input.ownerTeacherId);
        const units = { ...(head.checkpoint?.units || {}) };
        if (Object.hasOwn(units, input.unitId) && !same(units[input.unitId], candidate)) fail("WORKFLOW_CHECKPOINT_UNIT_CONFLICT");
        units[input.unitId] = candidate;
        return tx.teachingWorkflow.update({ where: { id: head.id }, data: { checkpoint: { ...head.checkpoint, units } } });
      });
    },
    async endOperation(input) {
      command(input);
      if (!["failed", "needs_input", "interrupted"].includes(input.status)) fail("WORKFLOW_STATUS_INVALID", 422);
      return prisma.$transaction(async (tx) => {
        // Fence and lock before merging diagnostics with any completed checkpoints.
        const result = await tx.teachingWorkflow.updateMany({ where: { id: input.workflowId, ownerTeacherId: input.ownerTeacherId, currentRevision: input.expectedRevision, status: "running", activeOperationKey: input.operationKey }, data: { status: input.status, activeOperationKey: null } });
        if (result.count !== 1) fail("WORKFLOW_CHECKPOINT_STALE");
        if (input.failure) {
          const head = await owned(tx, input.workflowId, input.ownerTeacherId);
          await tx.teachingWorkflow.update({ where: { id: head.id }, data: { checkpoint: { ...head.checkpoint, failure: snapshotCopy(input.failure) } } });
        }
        return result;
      });
    },
    async cancel({ workflowId, ownerTeacherId, expectedRevision }) {
      identity({ workflowId, ownerTeacherId });
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) fail("WORKFLOW_COMMAND_INVALID", 422);
      return prisma.teachingWorkflow.updateMany({ where: { id: workflowId, ownerTeacherId, ...(expectedRevision === undefined ? {} : { currentRevision: expectedRevision }), status: { in: ["queued", "running"] } }, data: { status: "cancelled", activeOperationKey: null } });
    },
    async markInterrupted() {
      // Single API worker startup only. Never restart model work here.
      return prisma.teachingWorkflow.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "interrupted", activeOperationKey: null } });
    }
  };
}
