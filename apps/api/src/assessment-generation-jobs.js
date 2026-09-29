import { randomUUID } from "node:crypto";

const ACTIVE_STATUSES = new Set(["generating", "exporting_draft", "cancelling"]);

function cancellationError() {
  const error = new Error("ASSESSMENT_GENERATION_CANCELLED");
  error.code = "ASSESSMENT_GENERATION_CANCELLED";
  return error;
}

function isCancellation(error, signal) {
  return signal?.aborted || error?.code === "ASSESSMENT_GENERATION_CANCELLED" || error?.message === "ASSESSMENT_GENERATION_CANCELLED";
}

function timestamp() {
  return new Date().toISOString();
}

function visibleJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    subject: job.subject,
    title: job.title,
    targetLabel: job.targetLabel || "",
    request: job.request || {},
    status: job.status,
    message: job.message,
    assignmentId: job.assignmentId || null,
    draftAsset: job.draftAsset || null,
    layoutValidation: job.layoutValidation || null,
    error: job.error || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    updatedAt: job.updatedAt
  };
}

export function createAssessmentGenerationJobs({ concurrency = 2, idFactory = randomUUID, workflowRepository = null } = {}) {
  const jobs = new Map();
  const queue = [];
  const idleWaiters = [];
  let running = 0;

  const publishIdle = () => {
    if (running || queue.length) return;
    while (idleWaiters.length) idleWaiters.shift()();
  };

  const update = (job, patch) => {
    Object.assign(job, patch, { updatedAt: timestamp() });
    return job;
  };

  const cancelWorkflow = (job) => {
    if (!workflowRepository || !job.workflow) return Promise.resolve();
    job.cancellationWrite ||= workflowRepository.cancel({ workflowId: job.workflow.id, ownerTeacherId: job.teacherId })
      .catch(() => { job.persistenceFailed = true; });
    return job.cancellationWrite;
  };

  const runNext = () => {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      if (!job || job.status !== "queued") continue;
      running += 1;
      job.startedAt = timestamp();
      update(job, { status: "generating", message: "正在生成内容草稿。" });
      void Promise.resolve()
        .then(async () => {
          if (workflowRepository) {
            job.workflow = await workflowRepository.create({
              requestKey: `${job.id}:request`,
              request: job.request || {},
              snapshot: {},
              ...job.workflowInput,
              ownerTeacherId: job.teacherId,
              module: "generation",
              id: job.id
            });
            if (job.controller.signal.aborted) throw cancellationError();
            job.workflowOperation = { workflowId: job.workflow.id, ownerTeacherId: job.teacherId, expectedRevision: job.workflow.currentRevision, operationKey: `job:${job.id}` };
            await workflowRepository.beginOperation(job.workflowOperation);
            job.operationStarted = true;
          }
          if (job.controller.signal.aborted) throw cancellationError();
          return job.run({
            signal: job.controller.signal,
            job: visibleJob(job),
            setStage: (status, message) => {
              if (!ACTIVE_STATUSES.has(job.status) || job.controller.signal.aborted) return;
              update(job, { status, message });
            },
            saveCheckpoint: async (unitId, candidate) => {
              if (job.controller.signal.aborted) throw cancellationError();
              return workflowRepository?.saveCheckpoint({ ...job.workflowOperation, unitId, candidate });
            }
          });
        })
        .then(async (result) => {
          job.result = result;
          if (job.controller.signal.aborted || job.status === "cancelling") {
            throw cancellationError();
          }
          if (workflowRepository) {
            if (!result?.workflowSnapshot || typeof result.workflowSnapshot !== "object" || Array.isArray(result.workflowSnapshot)) {
              throw new Error("WORKFLOW_SNAPSHOT_REQUIRED");
            }
            // Cancellation is accepted until this final atomic save starts.
            job.committing = true;
            await workflowRepository.commitRevision({ ...job.workflowOperation, operation: "complete", snapshot: result.workflowSnapshot, affectedQuestionIds: result.affectedQuestionIds || [] });
          }
          update(job, {
            status: "ready_for_review",
            message: result?.message || "草稿已生成，等待教师审查。",
            assignmentId: result?.assignmentId || null,
            draftAsset: result?.draftAsset || null,
            layoutValidation: result?.layoutValidation || null,
            completedAt: timestamp()
          });
        })
        .catch(async (error) => {
          try { await job.result?.discard?.(); } catch { job.persistenceFailed = true; }
          if (isCancellation(error, job.controller.signal)) {
            await cancelWorkflow(job);
            if (!job.persistenceFailed) {
              update(job, { status: "cancelled", message: "本次生成已取消。", completedAt: timestamp(), assignmentId: null, draftAsset: null, layoutValidation: null });
              return;
            }
          } else if (job.operationStarted) {
            try { await workflowRepository.endOperation({ ...job.workflowOperation, status: "failed" }); }
            catch { job.persistenceFailed = true; }
          }
          update(job, {
            status: "failed",
            message: "生成未完成，可修改要求后重新发起。",
            error: job.persistenceFailed ? "WORKFLOW_PERSISTENCE_FAILED" : "GENERATION_FAILED",
            completedAt: timestamp()
          });
        })
        .finally(() => {
          delete job.result;
          job.committing = false;
          running -= 1;
          runNext();
          publishIdle();
        });
    }
    publishIdle();
  };

  return {
    enqueue({ teacherId, kind, subject, title, targetLabel, request, run, workflowInput }) {
      const now = timestamp();
      const job = {
        id: idFactory(),
        teacherId,
        kind,
        subject,
        title,
        targetLabel,
        request,
        workflowInput: workflowInput || null,
        run,
        status: "queued",
        message: "已加入生成队列。",
        assignmentId: null,
        draftAsset: null,
        layoutValidation: null,
        error: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        controller: new AbortController()
      };
      jobs.set(job.id, job);
      queue.push(job);
      queueMicrotask(runNext);
      return visibleJob(job);
    },

    get(id) {
      const job = jobs.get(id);
      return job ? visibleJob(job) : null;
    },

    list(teacherId) {
      return Array.from(jobs.values())
        .filter((job) => job.teacherId === teacherId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(visibleJob);
    },

    cancel(teacherId, id) {
      const job = jobs.get(id);
      if (!job || job.teacherId !== teacherId) return null;
      if (job.committing) return visibleJob(job);
      if (["ready_for_review", "failed", "cancelled"].includes(job.status)) return visibleJob(job);
      if (job.status === "queued") {
        const queueIndex = queue.indexOf(job);
        if (queueIndex >= 0) queue.splice(queueIndex, 1);
        update(job, { status: "cancelled", message: "本次生成已取消。", completedAt: timestamp() });
        publishIdle();
        return visibleJob(job);
      }
      update(job, { status: "cancelling", message: "正在停止本次生成。" });
      job.controller.abort(cancellationError());
      void cancelWorkflow(job);
      return visibleJob(job);
    },

    waitForIdle() {
      if (!running && !queue.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }
  };
}
