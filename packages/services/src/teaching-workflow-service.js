import { applyWorkflowPatch, teachingExplanationContent } from "@junhang/core";
import { createHash } from "node:crypto";
import { sanitizeTeachingDiagnostics } from "../../ai/src/teaching-model-runner.js";
import { reuseArchivedQuestionConfirmations, isTeachingWorkflowArchiveSubmission } from "./teaching-workflow-archive.js";

function gradingReviewSummary(head, saved = head, revision = head.currentRevision) {
  if (head.module !== "grading") return {};
  const snapshot = saved.snapshot || {};
  const questions = snapshot.questions || [];
  const confirmed = questions.length > 0 && questions.every((q) => q.reviewedByTeacher === true && q.status !== "uncertain") && Number.isFinite(snapshot.finalScore);
  const submission = saved.archiveSubmission;
  const record = submission?.content?.workflowArchive;
  const archived = record?.workflowId === head.id && record.revision === revision && record.teacherId === head.ownerTeacherId &&
    isTeachingWorkflowArchiveSubmission(submission, head.request?.studentId);
  return { reviewStatus: confirmed ? "teacher_confirmed" : "review_required",
    archive: archived ? { id: record.id, workflowId: head.id, revision, status: "archived" } : null };
}

const ACTIONS = new Set(["revise", "confirm", "restore", "cancel"]);
const CONFIRMATION_FIELDS = ["reviewedByTeacher", "confirmedBy", "confirmedAt", "teacherConfirmation", "reviewedAt"];
const FAILURE_CODES = new Set(["WORKFLOW_EXECUTION_FAILED", "WORKFLOW_SNAPSHOT_INVALID", "WORKFLOW_REQUEST_INCOMPLETE", "WORKFLOW_CONTEXT_REQUIRED", "WORKFLOW_EVIDENCE_CHANGED", "WORKFLOW_INPUT_INVALID", "WORKFLOW_CANCELLED", "WORKFLOW_VERSION_CONFLICT"]);
function failureView(value) {
  if (!value || !FAILURE_CODES.has(value.code) || !["execute", "validate", "persist"].includes(value.phase) || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) return null;
  return { code: value.code, phase: value.phase, elapsedMs: value.elapsedMs };
}

function fail(code, status = 422) {
  throw Object.assign(new Error(code), { code, status });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function commandFingerprint(command) {
  return createHash("sha256").update(stable({ action: command.action, expectedRevision: command.expectedRevision,
    patch: command.patch || null, instruction: command.instruction?.trim() || null,
    ...(command.targetExplanation === true ? { targetExplanation: true } : {}),
    targetQuestionIds: [...(command.targetQuestionIds || [])].sort(), revision: command.revision || null })).digest("hex");
}

function clearExplanationConfirmation(snapshot) {
  if (snapshot.explanation || snapshot.parsed?.explanation) snapshot.explanation = teachingExplanationContent(snapshot.explanation || snapshot.parsed.explanation);
  return snapshot;
}

function questionFingerprint(question = {}) {
  const source = record(question);
  return stable(Object.fromEntries(Object.entries(source).filter(([key]) => !CONFIRMATION_FIELDS.includes(key))));
}

export function inheritQuestionConfirmations(previousSnapshot = {}, nextSnapshot = {}, affectedQuestionIds = []) {
  const previous = Array.isArray(previousSnapshot.questions) ? previousSnapshot.questions : [];
  const next = clone(nextSnapshot);
  const affected = new Set((Array.isArray(affectedQuestionIds) ? affectedQuestionIds : []).map(String));
  const previousById = new Map(previous.map((question) => [String(question?.id ?? question?.questionNo ?? ""), question]));
  next.questions = (Array.isArray(next.questions) ? next.questions : []).map((question) => {
    const id = String(question?.id ?? question?.questionNo ?? "");
    const old = previousById.get(id);
    const inherited = withoutConfirmation(question);
    if (!old || affected.has(id) || old.reviewedByTeacher !== true || questionFingerprint(old) !== questionFingerprint(question)) return inherited;
    for (const field of CONFIRMATION_FIELDS) if (Object.hasOwn(old, field)) inherited[field] = clone(old[field]);
    return inherited;
  });
  return next;
}

function questionIds(snapshot) {
  return (Array.isArray(snapshot?.questions) ? snapshot.questions : []).map((question) => String(question?.id ?? question?.questionNo ?? ""));
}

function withoutConfirmation(question = {}) {
  const next = { ...question };
  for (const field of CONFIRMATION_FIELDS) delete next[field];
  return next;
}

function targetedRunnerContext(snapshot = {}, affectedQuestionIds = []) {
  const ids = new Set(affectedQuestionIds.map(String));
  const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
  const targetQuestions = questions.filter((question) => ids.has(String(question?.id ?? question?.questionNo ?? "")));
  const materialIds = new Set(targetQuestions.map((question) => question?.sharedMaterialId).filter(Boolean).map(String));
  const dayIds = new Set(targetQuestions.map((question) => question?.dayId).filter(Boolean).map(String));
  return {
    questions: targetQuestions.map((question) => clone(withoutConfirmation(question))),
    context: {
      sharedMaterials: (Array.isArray(snapshot.sharedMaterials) ? snapshot.sharedMaterials : [])
        .filter((material) => materialIds.has(String(material?.id))),
      days: (Array.isArray(snapshot.days) ? snapshot.days : [])
        .filter((day) => dayIds.has(String(day?.dayId)))
    }
  };
}

function mergeRunnerQuestions(snapshot, affectedQuestionIds, candidateQuestions) {
  if (!Array.isArray(candidateQuestions)) fail("WORKFLOW_RUNNER_OUTPUT_INVALID");
  const ids = affectedQuestionIds.map(String);
  const candidateById = new Map(candidateQuestions.map((question) => [String(question?.id ?? question?.questionNo ?? ""), question]));
  if (candidateQuestions.length !== ids.length || candidateById.size !== ids.length || ids.some((id) => !candidateById.has(id))) fail("WORKFLOW_RUNNER_SCOPE_INVALID");
  const next = clone(snapshot);
  next.questions = (Array.isArray(next.questions) ? next.questions : []).map((question) => {
    const id = String(question?.id ?? question?.questionNo ?? "");
    if (!candidateById.has(id)) return question;
    const candidate = candidateById.get(id);
    if (["id", "questionNo", "dayId", "sharedMaterialId"].some((field) => (candidate[field] ?? null) !== (question[field] ?? null))) fail("WORKFLOW_RUNNER_SCOPE_INVALID");
    return withoutConfirmation(candidate);
  });
  return next;
}

function assertActor(actor, workflow) {
  if (!record(actor).teacherId || actor.teacherId !== workflow.ownerTeacherId) fail("WORKFLOW_FORBIDDEN", 403);
}

function assertCommand(command) {
  if (!ACTIONS.has(command?.action) || typeof command.operationKey !== "string" || !command.operationKey.trim() || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) fail("WORKFLOW_COMMAND_INVALID");
  if (command.instruction !== undefined && typeof command.instruction !== "string") fail("WORKFLOW_COMMAND_INVALID");
  if (command.targetExplanation !== undefined && (command.targetExplanation !== true || command.targetQuestionIds !== undefined || !["revise", "confirm"].includes(command.action))) fail("WORKFLOW_COMMAND_INVALID");
  if (command.targetQuestionIds !== undefined && (!Array.isArray(command.targetQuestionIds) || command.targetQuestionIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(command.targetQuestionIds).size !== command.targetQuestionIds.length)) fail("WORKFLOW_COMMAND_INVALID");
  if (command.action === "restore" && (!Number.isSafeInteger(command.revision) || command.revision < 1)) fail("WORKFLOW_REVISION_INVALID");
}

export function createTeachingWorkflowService({ repository, runner = null, validateSnapshot = null, createDraft = null, resolveConfirmedArchive = null } = {}) {
  if (!repository) throw new Error("WORKFLOW_REPOSITORY_REQUIRED");
  // One service per worker. The repository remains the fence across processes/restarts.
  const activeControllers = new Map();
  return {
    async list({ actor, module }) {
      assertActor(actor, { ownerTeacherId: actor?.teacherId });
      if (!["generation", "grading"].includes(module)) fail("WORKFLOW_INPUT_INVALID");
      if (typeof repository.list !== "function") fail("WORKFLOW_UNAVAILABLE", 503);
      const workflows = await repository.list(actor.teacherId, module);
      return workflows.map((workflow) => {
        assertActor(actor, workflow);
        return { workflowId: workflow.id, module: workflow.module, revision: workflow.currentRevision, status: workflow.status, request: clone(workflow.request), ...gradingReviewSummary(workflow) };
      });
    },
    async create({ actor, input }, recoverySource = null) {
      assertActor(actor, { ownerTeacherId: actor?.teacherId });
      if (typeof input?.requestKey !== "string" || !input.requestKey.trim() || !["generation", "grading"].includes(input.module) ||
        (input.request !== undefined && (!input.request || typeof input.request !== "object" || Array.isArray(input.request)))) fail("WORKFLOW_INPUT_INVALID");
      input = { requestKey: input.requestKey, module: input.module, request: clone(input.request) };
      if (typeof repository.getCreation !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
      const reservationInput = { ...input, ownerTeacherId: actor.teacherId };
      const existing = await repository.getCreation(reservationInput);
      if (existing) return { ...await this.get({ actor, workflowId: existing.id }), replayed: true };
      // An unavailable executor cannot leave an empty task behind.
      if (!createDraft || !validateSnapshot || ["reserveCreation", "beginOperation", "endOperation", "commitRevision"].some((name) => typeof repository[name] !== "function")) fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
      const reservation = await repository.reserveCreation(reservationInput);
      const workflow = reservation.workflow;
      if (!reservation.created) return { ...await this.get({ actor, workflowId: workflow.id }), replayed: true };
      const operationInput = { workflowId: workflow.id, ownerTeacherId: actor.teacherId, expectedRevision: 1, operationKey: `create:${input.requestKey}` };
      try {
        await repository.beginOperation({ ...operationInput, initialCreation: true, resetCheckpoint: true });
      } catch (error) {
        const current = await repository.get(workflow.id, actor.teacherId);
        if (["cancelled", "interrupted"].includes(current?.status)) return this.get({ actor, workflowId: workflow.id });
        throw error;
      }
      const controller = new AbortController();
      activeControllers.set(workflow.id, { operationKey: operationInput.operationKey, controller });
      const startedAt = Date.now(); let phase = "execute";
      try {
        const current = await repository.get(workflow.id, actor.teacherId);
        if (controller.signal.aborted || current?.status !== "running" || current?.activeOperationKey !== operationInput.operationKey) fail("WORKFLOW_VERSION_CONFLICT", 409);
        const checkpoint = { units: clone(recoverySource?.checkpoint?.units),
          save: async (unitId, candidate) => {
            if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
            await repository.saveCheckpoint({ ...operationInput, unitId, candidate: clone(candidate) });
          } };
        const prepared = await createDraft({ actor: { ...actor }, input: clone(input), workflow: { id: workflow.id, module: workflow.module, revision: 1 }, signal: controller.signal, checkpoint });
        if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
        if (!prepared?.snapshot || typeof prepared.snapshot !== "object" || Array.isArray(prepared.snapshot)) fail("WORKFLOW_SNAPSHOT_INVALID");
        const preparedSnapshot = clone(prepared.snapshot);
        if (!Object.hasOwn(preparedSnapshot, "questions")) {
          preparedSnapshot.questions = input.module === "generation" ? preparedSnapshot.items : preparedSnapshot.questionResults;
        }
        let snapshot = clearExplanationConfirmation(inheritQuestionConfirmations({}, preparedSnapshot));
        delete snapshot.workflowArchive;
        delete snapshot.creationPending;
        snapshot.resolvedRequest = clone(prepared.request);
        phase = "validate";
        const validation = await validateSnapshot(snapshot, { actor, module: input.module, workflow, nextRevision: 2, request: clone(input.request) });
        if (validation?.ok !== true) fail("WORKFLOW_SNAPSHOT_INVALID");
        if (validation.snapshot) snapshot = clearExplanationConfirmation(inheritQuestionConfirmations({}, validation.snapshot));
        delete snapshot.workflowArchive;
        if (input.module === "grading" && resolveConfirmedArchive && input.request.submissionId && input.request.studentId) {
          const archive = await resolveConfirmedArchive({ actor: { ...actor }, request: clone(input.request), workflow: { id: workflow.id, module: workflow.module } });
          snapshot = reuseArchivedQuestionConfirmations({ actor, request: input.request, snapshot, archive });
          const reviewed = await validateSnapshot(snapshot, { actor, module: input.module, workflow, nextRevision: 2, request: clone(input.request) });
          if (reviewed?.ok !== true) fail("WORKFLOW_SNAPSHOT_INVALID");
          if (reviewed.snapshot) snapshot = clone(reviewed.snapshot);
        }
        if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
        phase = "persist";
        await repository.commitRevision({ ...operationInput, operation: "create", snapshot, affectedQuestionIds: questionIds(snapshot),
          commandFingerprint: createHash("sha256").update(stable(input)).digest("hex"), subjectRef: prepared.subjectRef || null });
      } catch (error) {
        controller.abort();
        const failure = { code: FAILURE_CODES.has(error.code) ? error.code : "WORKFLOW_EXECUTION_FAILED", phase, elapsedMs: Math.max(0, Date.now() - startedAt) };
        const diagnostics = sanitizeTeachingDiagnostics(error.teachingDiagnostics);
        if (diagnostics) failure.diagnostics = diagnostics;
        try { await repository.endOperation({ ...operationInput, failure, status: ["WORKFLOW_SNAPSHOT_INVALID", "WORKFLOW_REQUEST_INCOMPLETE", "WORKFLOW_CONTEXT_REQUIRED", "WORKFLOW_EVIDENCE_CHANGED", "WORKFLOW_INPUT_INVALID"].includes(error.code) ? "needs_input" : "failed" }); } catch (endError) {
          if (endError.code !== "WORKFLOW_CHECKPOINT_STALE") throw endError;
        }
        // Return the durable task state; failed/cancelled reservations are not drafts.
      } finally {
        if (activeControllers.get(workflow.id)?.controller === controller) activeControllers.delete(workflow.id);
      }
      return this.get({ actor, workflowId: workflow.id });
    },
    async recover({ actor, workflowId, expectedRevision, operationKey }) {
      assertActor(actor, { ownerTeacherId: actor?.teacherId });
      assertCommand({ action: "revise", operationKey, expectedRevision });
      const workflow = await repository.get(workflowId, actor.teacherId);
      if (!workflow) fail("WORKFLOW_NOT_FOUND", 404);
      assertActor(actor, workflow);
      if (workflow.currentRevision !== expectedRevision) fail("WORKFLOW_VERSION_CONFLICT", 409);
      if (workflow.snapshot?.creationPending !== true || !["failed", "interrupted", "needs_input"].includes(workflow.status)) fail("WORKFLOW_RECOVERY_NOT_ALLOWED", 409);
      // One explicit successor per creation. A new click/key cannot reset the
      // budget again, and a failed successor is terminal for this lineage.
      if (workflow.requestKey?.startsWith("recover:")) fail("WORKFLOW_RECOVERY_NOT_ALLOWED", 409);
      // A retry is a new draft, never a rewrite of a failed task or an archived score.
      // The original request and lineage come from the server, not a browser resubmission.
      if (typeof repository.getRecoveryCreation !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
      const existing = await repository.getRecoveryCreation({ workflowId, ownerTeacherId: actor.teacherId });
      const key = createHash("sha256").update(stable({ workflowId, expectedRevision, recoveryVersion: 1 })).digest("hex");
      return this.create({ actor, input: { module: workflow.module, requestKey: existing?.requestKey ?? `recover:${workflowId}:${key}`, request: clone(workflow.request) } }, workflow);
    },
    async get({ actor, workflowId, revision = null }) {
      assertActor(actor, { ownerTeacherId: actor?.teacherId });
      if (revision != null && (!Number.isInteger(revision) || revision < 1)) fail("WORKFLOW_REVISION_INVALID");
      const head = await repository.get(workflowId, actor.teacherId);
      if (!head) fail("WORKFLOW_NOT_FOUND", 404);
      assertActor(actor, head);
      const historical = revision == null ? null : await repository.getRevision(workflowId, revision, actor.teacherId);
      if (revision != null && !historical) fail("WORKFLOW_REVISION_NOT_FOUND", 404);
      return {
        status: revision != null && revision !== head.currentRevision ? "historical" : head.status,
        workflowId: head.id, module: head.module, request: clone(head.request),
        revision: historical?.revision ?? head.currentRevision,
        snapshot: clone(historical?.snapshot ?? head.snapshot),
        recoveryAllowed: (revision == null || revision === head.currentRevision) && head.snapshot?.creationPending === true &&
          ["failed", "interrupted", "needs_input"].includes(head.status) && !head.requestKey?.startsWith("recover:"),
        failure: revision != null && revision !== head.currentRevision ? null : failureView(head.checkpoint?.failure),
        ...gradingReviewSummary(head, historical ?? head, historical?.revision ?? head.currentRevision)
      };
    },
    async execute({ actor, workflowId, command }) {
      assertActor(actor, { ownerTeacherId: actor?.teacherId });
      assertCommand(command);
      command = clone(command);
      const workflow = await repository.get(workflowId, actor?.teacherId);
      if (!workflow) fail("WORKFLOW_NOT_FOUND", 404);
      assertActor(actor, workflow);
      const fingerprint = commandFingerprint(command);
      if (typeof repository.getOperation !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
      const replay = await repository.getOperation(workflow.id, command.operationKey, actor.teacherId);
      if (replay) {
        if (replay.commandFingerprint !== fingerprint || replay.baseRevision !== command.expectedRevision || replay.operation !== command.action) fail("WORKFLOW_OPERATION_KEY_REUSED", 409);
        return { ...await this.get({ actor, workflowId, revision: replay.revision }), replayed: true };
      }
      if (command.expectedRevision !== workflow.currentRevision) fail("WORKFLOW_VERSION_CONFLICT", 409);
      if (workflow.status === "cancelled") fail("WORKFLOW_CANCELLED", 409);
      if (command.action === "cancel") {
        const cancelled = await repository.cancel({ workflowId: workflow.id, ownerTeacherId: actor.teacherId, expectedRevision: command.expectedRevision });
        if (cancelled.count !== 1) fail("WORKFLOW_VERSION_CONFLICT", 409);
        const active = activeControllers.get(workflow.id);
        if (active?.operationKey === workflow.activeOperationKey) active.controller.abort();
        return { status: "cancelled", workflowId: workflow.id, module: workflow.module, request: clone(workflow.request), revision: workflow.currentRevision, snapshot: clone(workflow.snapshot) };
      }
      if (!validateSnapshot) fail("WORKFLOW_VALIDATION_UNAVAILABLE", 503);
      if (workflow.snapshot?.creationPending === true) fail("WORKFLOW_CREATION_INCOMPLETE", 409);

      if (typeof repository.beginOperation !== "function" || typeof repository.endOperation !== "function") fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
      // Resolve the requested change before reserving an operation or spending model budget.
      let snapshot = clone(workflow.snapshot);
      let affectedQuestionIds = [];
      const explanation = workflow.module === "generation" && snapshot.purpose === "explanation";
      if (command.targetExplanation === true && !explanation || command.patch?.type === "replace_explanation" && !explanation) fail("WORKFLOW_TARGET_SCOPE_INVALID");
      if (explanation && ["revise", "confirm"].includes(command.action) &&
        (command.targetExplanation !== true || command.targetQuestionIds !== undefined || command.patch && (command.action !== "revise" || command.patch.type !== "replace_explanation"))) fail("WORKFLOW_TARGET_SCOPE_INVALID");
      const recognitionPatch = command.patch?.type === "correct_recognition";
      if (recognitionPatch && (workflow.module !== "grading" || command.action !== "revise" || typeof command.patch.value?.studentAnswer !== "string")) fail("WORKFLOW_PATCH_INVALID");
      let patch = command.patch;
      let correctedAnswer = recognitionPatch;
      if (workflow.module === "grading" && ["replace_question", "correct_recognition"].includes(patch?.type)) {
        const old = snapshot.questions?.find((q) => q.id === patch.questionId);
        if (!old) fail("WORKFLOW_QUESTION_NOT_FOUND", 404);
        correctedAnswer ||= stable(patch.value?.studentAnswer) !== stable(old.studentAnswer);
        const value = recognitionPatch ? { ...old, studentAnswer: patch.value.studentAnswer } : { ...patch.value };
        // Evidence location and teacher correction provenance are server-owned.
        for (const field of ["printedPrompt", "bbox", "page", "confidence", "sourceImageRef", "cropRef", "observedWork", "studentAnswerReview"]) {
          delete value[field]; if (Object.hasOwn(old, field)) value[field] = structuredClone(old[field]);
        }
        if (correctedAnswer) {
          if (typeof value.studentAnswer !== "string") fail("WORKFLOW_PATCH_INVALID");
          value.studentAnswerReview = { actorTeacherId: actor.teacherId, studentAnswer: value.studentAnswer };
          value.score = null; value.status = "uncertain";
        }
        patch = { type: "replace_question", questionId: old.id, value };
      }
      const useRunner = command.action === "revise" && (correctedAnswer || Boolean(command.instruction?.trim()));
      if (command.action === "revise") {
        if (useRunner && !runner) fail("WORKFLOW_EXECUTION_UNAVAILABLE", 503);
        if (!command.patch && !useRunner) fail("WORKFLOW_PATCH_REQUIRED");
        const targets = command.targetQuestionIds || [];
        if (!explanation && !command.patch && (!targets.length || targets.some((id) => !questionIds(snapshot).includes(id)))) fail("WORKFLOW_TARGET_SCOPE_INVALID");
        const patched = patch ? applyWorkflowPatch(snapshot, patch) : { snapshot, affectedQuestionIds: targets };
        affectedQuestionIds = patched.affectedQuestionIds;
        if (Array.isArray(command.targetQuestionIds) && command.targetQuestionIds.map(String).sort().join(",") !== affectedQuestionIds.map(String).sort().join(",")) fail("WORKFLOW_TARGET_SCOPE_INVALID");
        snapshot = patched.snapshot;
        snapshot.questions = (Array.isArray(snapshot.questions) ? snapshot.questions : []).map((question) => {
          const id = String(question?.id ?? question?.questionNo ?? "");
          return affectedQuestionIds.includes(id) ? withoutConfirmation(question) : question;
        });
        snapshot = inheritQuestionConfirmations(workflow.snapshot, snapshot, affectedQuestionIds);
        if (explanation) snapshot = clearExplanationConfirmation(snapshot);
      } else if (command.action === "confirm") {
        if (explanation) {
          if (!teachingExplanationContent(snapshot.explanation)) fail("WORKFLOW_CONFIRM_TARGET_INVALID");
          snapshot.explanation = { ...teachingExplanationContent(snapshot.explanation), reviewedByTeacher: true, confirmedBy: actor.teacherId, teacherConfirmation: { actorTeacherId: actor.teacherId } };
        } else {
          const targets = Array.isArray(command.targetQuestionIds) ? command.targetQuestionIds.map(String) : [];
          if (!targets.length) fail("WORKFLOW_CONFIRM_TARGET_REQUIRED");
          const targetSet = new Set(targets);
          let found = 0;
          snapshot.questions = (Array.isArray(snapshot.questions) ? snapshot.questions : []).map((question) => {
            const id = String(question?.id ?? question?.questionNo ?? "");
            if (!targetSet.has(id)) return question;
            found += 1;
            return { ...question, reviewedByTeacher: true, confirmedBy: actor.teacherId, teacherConfirmation: { actorTeacherId: actor.teacherId } };
          });
          if (found !== targetSet.size) fail("WORKFLOW_CONFIRM_TARGET_INVALID");
          affectedQuestionIds = targets;
        }
      } else if (command.action === "restore") {
        const revision = await repository.getRevision(workflow.id, command.revision, actor.teacherId);
        if (!revision) fail("WORKFLOW_REVISION_NOT_FOUND", 404);
        if (revision.snapshot?.creationPending === true) fail("WORKFLOW_CREATION_INCOMPLETE", 409);
        snapshot = clone(revision.snapshot);
        affectedQuestionIds = questionIds(snapshot);
      }

      const validate = async () => {
        const validation = await validateSnapshot(snapshot, { actor, module: workflow.module, request: clone(workflow.request), workflow, command, affectedQuestionIds, nextRevision: workflow.currentRevision + 1 });
        if (validation?.ok !== true) {
          if (validation?.issues?.some((issue) => issue.code === "WORKFLOW_EVIDENCE_CHANGED")) fail("WORKFLOW_EVIDENCE_CHANGED", 409);
          fail("WORKFLOW_SNAPSHOT_INVALID");
        }
        if (validation.snapshot) snapshot = clone(validation.snapshot);
      };
      if (!useRunner) await validate();
      const operationInput = { workflowId: workflow.id, ownerTeacherId: actor.teacherId, expectedRevision: workflow.currentRevision, operationKey: command.operationKey };
      await repository.beginOperation({ ...operationInput, resetCheckpoint: true });
      const controller = new AbortController();
      activeControllers.set(workflow.id, { operationKey: command.operationKey, controller });
      try {
        const current = await repository.get(workflow.id, actor.teacherId);
        if (current?.status === "cancelled" || controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
        if (current?.currentRevision !== workflow.currentRevision || current?.status !== "running" || current?.activeOperationKey !== command.operationKey) fail("WORKFLOW_VERSION_CONFLICT", 409);
        if (useRunner) {
          const runnerInput = targetedRunnerContext(snapshot, affectedQuestionIds);
          const candidate = await runner({
            actor: { ...actor },
            request: clone(snapshot.resolvedRequest || workflow.request),
            evidence: clone({ archiveEvidence: snapshot.archiveEvidence, generationContext: snapshot.generationContext }),
            action: command.action,
            workflow: { id: workflow.id, module: workflow.module, revision: workflow.currentRevision },
            targetQuestionIds: [...affectedQuestionIds],
            questions: runnerInput.questions,
            ...(explanation ? { explanation: teachingExplanationContent(snapshot.explanation) } : {}),
            context: clone(runnerInput.context),
            instruction: command.instruction || (correctedAnswer ? "教师已核对原图并修正本题作答，请依据可信答案和评分点重新判定本题。" : undefined),
            signal: controller.signal
          });
          if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
          snapshot = explanation
            ? applyWorkflowPatch(snapshot, { type: "replace_explanation", value: record(candidate).explanation }).snapshot
            : mergeRunnerQuestions(snapshot, affectedQuestionIds, record(candidate).questions);
          snapshot = inheritQuestionConfirmations(workflow.snapshot, snapshot, affectedQuestionIds);
          await validate();
        }
        if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
        const result = await repository.commitRevision({ ...operationInput, operation: command.action,
          snapshot, affectedQuestionIds, commandFingerprint: fingerprint });
        return this.get({ actor, workflowId: workflow.id, revision: result.revision });
      } catch (error) {
        try { await repository.endOperation({ ...operationInput, status: "failed" }); } catch (endError) {
          if (endError.code !== "WORKFLOW_CHECKPOINT_STALE") throw endError;
        }
        if (controller.signal.aborted) fail("WORKFLOW_CANCELLED", 409);
        throw error;
      } finally {
        if (activeControllers.get(workflow.id)?.controller === controller) activeControllers.delete(workflow.id);
      }
    }
  };
}
