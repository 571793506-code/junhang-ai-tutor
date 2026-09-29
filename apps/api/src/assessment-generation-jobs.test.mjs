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

test("assessment generation jobs persist workflow lifecycle and checkpoints when enabled", async () => {
  const events = [];
  const workflowRepository = {
    create: async (input) => { events.push(["create", input.module]); return { id: input.id, currentRevision: 1 }; },
    beginOperation: async (input) => events.push(["begin", input.operationKey]),
    saveCheckpoint: async (input) => events.push(["checkpoint", input.unitId, input.candidate]),
    commitRevision: async (input) => events.push(["commit", input.operation]),
    endOperation: async (input) => events.push(["end", input.status]),
    cancel: async () => events.push(["cancel"])
  };
  const jobs = createAssessmentGenerationJobs({ concurrency: 1, workflowRepository, idFactory: () => "persistent-job" });
  const job = jobs.enqueue({
    teacherId: "teacher-a", kind: "练习", subject: "数学", title: "持久化任务",
    workflowInput: { module: "generation", requestKey: "persistent-request", request: { prompt: "出题" }, snapshot: { questions: [] } },
    run: async ({ saveCheckpoint }) => {
      await saveCheckpoint("unit-1", { answer: "5" });
      return { workflowSnapshot: { questions: [{ id: "q1", answer: "5" }] } };
    }
  });
  await jobs.waitForIdle();
  assert.equal(jobs.get(job.id).status, "ready_for_review");
  assert.deepEqual(events.map((event) => event[0]), ["create", "begin", "checkpoint", "commit"]);
});

function persistentFixture(overrides = {}) {
  const calls = [];
  const repo = {
    create: async (input) => { calls.push(["create", input]); return { id: input.id, currentRevision: 1 }; },
    beginOperation: async () => { calls.push(["begin"]); },
    saveCheckpoint: async () => { calls.push(["checkpoint"]); },
    commitRevision: async () => { calls.push(["commit"]); },
    endOperation: async () => { calls.push(["end"]); },
    cancel: async () => { calls.push(["cancel"]); },
    ...overrides
  };
  return { calls, jobs: createAssessmentGenerationJobs({ workflowRepository: repo }) };
}

test("persistent queue does not invoke runner after cancellation during workflow creation", async () => {
  const gate = deferred(); const started = deferred(); let ran = false;
  const { jobs } = persistentFixture({ create: async (input) => { started.resolve(); await gate.promise; return { id: input.id, currentRevision: 1 }; } });
  const job = jobs.enqueue({ teacherId: "t", run: async () => { ran = true; return {}; } });
  await started.promise;
  jobs.cancel("t", job.id);
  gate.resolve(); await jobs.waitForIdle();
  assert.equal(ran, false);
  assert.equal(jobs.get(job.id).status, "cancelled");
});

test("persistent queue pins ownership and requires an explicit validated snapshot", async () => {
  const { jobs, calls } = persistentFixture();
  const job = jobs.enqueue({ teacherId: "t", workflowInput: { ownerTeacherId: "forged", module: "grading" }, run: async () => ({ rawOutput: "must not persist" }) });
  await jobs.waitForIdle();
  assert.equal(calls[0][1].ownerTeacherId, "t");
  assert.equal(calls[0][1].module, "generation");
  assert.equal(jobs.get(job.id).status, "failed");
  assert.equal(calls.some(([event]) => event === "commit"), false);
});

test("persistent queue discards draft when revision commit fails", async () => {
  let discarded = 0;
  const { jobs } = persistentFixture({ commitRevision: async () => { throw new Error("db unavailable"); } });
  const job = jobs.enqueue({ teacherId: "t", run: async () => ({ assignmentId: "draft", workflowSnapshot: { questions: [] }, discard: async () => { discarded++; } }) });
  await jobs.waitForIdle();
  assert.equal(jobs.get(job.id).status, "failed");
  assert.equal(jobs.get(job.id).assignmentId, null);
  assert.equal(discarded, 1);
});

test("persistent queue sends cancellation immediately and fences late checkpoints", async () => {
  const started = deferred(); const gate = deferred(); let checkpoint;
  const { jobs, calls } = persistentFixture();
  const job = jobs.enqueue({ teacherId: "t", run: async ({ saveCheckpoint }) => { checkpoint = saveCheckpoint; started.resolve(); await gate.promise; return { workflowSnapshot: {} }; } });
  await started.promise;
  jobs.cancel("t", job.id);
  await assert.rejects(checkpoint("late", {}), /ASSESSMENT_GENERATION_CANCELLED/);
  assert.equal(calls.some(([event]) => event === "cancel"), true);
  gate.resolve(); await jobs.waitForIdle();
  assert.equal(calls.some(([event]) => event === "commit"), false);
});

test("persistent queue completes an already started atomic commit before accepting cancellation", async () => {
  const started = deferred(); const gate = deferred();
  const { jobs } = persistentFixture({ commitRevision: async () => { started.resolve(); await gate.promise; } });
  const job = jobs.enqueue({ teacherId: "t", run: async () => ({ workflowSnapshot: {} }) });
  await started.promise;
  assert.notEqual(jobs.cancel("t", job.id).status, "cancelling");
  gate.resolve(); await jobs.waitForIdle();
  assert.equal(jobs.get(job.id).status, "ready_for_review");
});
