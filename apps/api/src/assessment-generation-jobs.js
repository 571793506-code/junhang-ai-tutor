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

export function createAssessmentGenerationJobs({ concurrency = 2, idFactory = randomUUID } = {}) {
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

  const runNext = () => {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      if (!job || job.status !== "queued") continue;
      running += 1;
      job.startedAt = timestamp();
      update(job, { status: "generating", message: "正在生成内容草稿。" });
      void Promise.resolve()
        .then(() => job.run({
          signal: job.controller.signal,
          job: visibleJob(job),
          setStage: (status, message) => {
            if (!ACTIVE_STATUSES.has(job.status) || job.controller.signal.aborted) return;
            update(job, { status, message });
          }
        }))
        .then(async (result) => {
          if (job.controller.signal.aborted || job.status === "cancelling") {
            await result?.discard?.().catch(() => {});
            update(job, { status: "cancelled", message: "本次生成已取消。", completedAt: timestamp(), assignmentId: null, draftAsset: null, layoutValidation: null });
            return;
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
        .catch((error) => {
          if (isCancellation(error, job.controller.signal)) {
            update(job, { status: "cancelled", message: "本次生成已取消。", completedAt: timestamp(), assignmentId: null, draftAsset: null, layoutValidation: null });
            return;
          }
          update(job, {
            status: "failed",
            message: "生成未完成，可修改要求后重新发起。",
            error: "GENERATION_FAILED",
            completedAt: timestamp()
          });
        })
        .finally(() => {
          running -= 1;
          runNext();
          publishIdle();
        });
    }
    publishIdle();
  };

  return {
    enqueue({ teacherId, kind, subject, title, targetLabel, request, run }) {
      const now = timestamp();
      const job = {
        id: idFactory(),
        teacherId,
        kind,
        subject,
        title,
        targetLabel,
        request,
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
      return visibleJob(job);
    },

    waitForIdle() {
      if (!running && !queue.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }
  };
}
