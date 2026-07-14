import assert from "node:assert/strict";
import test from "node:test";
import { createAssessmentGenerationJobs } from "./assessment-generation-jobs.js";

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("assessment generation jobs run at most two jobs concurrently and preserve separate results", async () => {
  const gates = [deferred(), deferred(), deferred()];
  let running = 0;
  let peak = 0;
  const jobs = createAssessmentGenerationJobs({ concurrency: 2, idFactory: (() => {
    let index = 0;
    return () => `job-${++index}`;
  })() });
  const run = (index) => async ({ setStage }) => {
    running += 1;
    peak = Math.max(peak, running);
    setStage("generating", `任务 ${index} 正在生成`);
    await gates[index].promise;
    running -= 1;
    return { assignmentId: `assignment-${index}`, title: `任务 ${index}` };
  };

  const first = jobs.enqueue({ teacherId: "teacher-1", kind: "小测", subject: "数学", title: "任务 0", run: run(0) });
  const second = jobs.enqueue({ teacherId: "teacher-1", kind: "练习", subject: "英语", title: "任务 1", run: run(1) });
  const third = jobs.enqueue({ teacherId: "teacher-1", kind: "试卷", subject: "语文", title: "任务 2", run: run(2) });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(peak, 2);
  assert.equal(jobs.get(third.id).status, "queued");

  gates[0].resolve();
  gates[1].resolve();
  gates[2].resolve();
  await jobs.waitForIdle();
  assert.equal(peak, 2);
  assert.equal(jobs.get(first.id).status, "ready_for_review");
  assert.equal(jobs.get(first.id).assignmentId, "assignment-0");
  assert.equal(jobs.get(second.id).status, "ready_for_review");
  assert.equal(jobs.get(third.id).status, "ready_for_review");
});

test("assessment generation jobs cancel queued work and abort active work without publishing a result", async () => {
  const activeGate = deferred();
  const jobs = createAssessmentGenerationJobs({ concurrency: 1, idFactory: (() => {
    let index = 0;
    return () => `cancel-job-${++index}`;
  })() });
  const active = jobs.enqueue({
    teacherId: "teacher-1",
    kind: "小测",
    subject: "数学",
    title: "运行中任务",
    run: async ({ signal, setStage }) => {
      setStage("generating", "正在生成");
      await Promise.race([
        activeGate.promise,
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
      ]);
      return { assignmentId: "must-not-publish" };
    }
  });
  const queued = jobs.enqueue({
    teacherId: "teacher-1",
    kind: "练习",
    subject: "英语",
    title: "排队任务",
    run: async () => ({ assignmentId: "must-not-run" })
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(jobs.cancel("teacher-1", queued.id).status, "cancelled");
  assert.equal(jobs.cancel("teacher-1", active.id).status, "cancelling");
  await jobs.waitForIdle();

  assert.equal(jobs.get(queued.id).status, "cancelled");
  assert.equal(jobs.get(active.id).status, "cancelled");
  assert.equal(jobs.get(active.id).assignmentId, null);
});

test("assessment generation jobs only expose records owned by the requesting teacher", async () => {
  const jobs = createAssessmentGenerationJobs({ concurrency: 1, idFactory: (() => {
    let index = 0;
    return () => `scope-job-${++index}`;
  })() });
  jobs.enqueue({ teacherId: "teacher-a", kind: "小测", subject: "数学", title: "A", run: async () => ({}) });
  jobs.enqueue({ teacherId: "teacher-b", kind: "练习", subject: "英语", title: "B", run: async () => ({}) });

  assert.deepEqual(jobs.list("teacher-a").map((job) => job.id), ["scope-job-1"]);
  assert.deepEqual(jobs.list("teacher-b").map((job) => job.id), ["scope-job-2"]);
});
