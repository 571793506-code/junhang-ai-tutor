import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowRepository } from "../../db/src/teaching-workflow-repository.js";
import { fakeWorkflowPrisma } from "../../../scripts/test-support/teaching-workflow-prisma.mjs";

import {
  createTeachingWorkflowService,
  inheritQuestionConfirmations
} from "./teaching-workflow-service.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const revisions = new Map([[1, {
    revision: 1,
    snapshot: {
      sharedMaterials: [{ id: "m1", text: "阅读材料" }],
      days: [{ dayId: "d1", goal: "加法" }],
      questions: [
        { id: "q1", dayId: "d1", prompt: "1+1", answer: "2", rubric: "结果正确" },
        { id: "q2", dayId: "d1", prompt: "2+2", answer: "4", rubric: "结果正确" }
      ]
    }
  }]]);
  const workflow = {
    id: "workflow-1",
    ownerTeacherId: "teacher-1",
    module: "generation",
    currentRevision: 1,
    status: "ready_for_review",
    checkpoint: null,
    activeOperationKey: null
  };
  const rows = [...revisions.values()].map((row) => ({ ...row, workflowId: workflow.id }));
  Object.defineProperty(workflow, "snapshot", { get: () => rows.find((row) => row.revision === workflow.currentRevision).snapshot });
  const commits = [];
  const repository = createTeachingWorkflowRepository(fakeWorkflowPrisma({ workflows: [workflow], revisions: rows }));
  const commit = repository.commitRevision;
  repository.commitRevision = async (input) => {
    const result = await commit(input);
    commits.push(clone(input));
    revisions.set(result.revision, result);
    return result;
  };
  return { workflow, revisions, commits, repository };
}

function command(expectedRevision, action, extra = {}) {
  return { expectedRevision, action, operationKey: `${action}-${expectedRevision}-${Math.random()}`, ...extra };
}

function serviceFor(fixtureValue, runner = null) {
  return createTeachingWorkflowService({ repository: fixtureValue.repository, runner, validateSnapshot: (snapshot) => ({ ok: Array.isArray(snapshot.questions) }) });
}

test("revise only changes the requested question and sends only targeted context to runner", async () => {
  const state = fixture();
  let runnerInput;
  const service = serviceFor(state, async (input) => {
    runnerInput = input;
    return { questions: [{ ...input.questions[0], answer: "3", explanation: "重新计算" }] };
  });

  const result = await service.execute({
    actor: { teacherId: "teacher-1" },
    workflowId: "workflow-1",
    command: command(1, "revise", {
      patch: { type: "replace_question", questionId: "q1", value: { id: "q1", dayId: "d1", prompt: "1+2", answer: "3", rubric: "结果正确" } },
      targetQuestionIds: ["q1"],
      instruction: "修正第一题"
    })
  });

  assert.deepEqual(runnerInput.targetQuestionIds, ["q1"]);
  assert.deepEqual(runnerInput.questions.map((question) => question.id), ["q1"]);
  assert.deepEqual(runnerInput.context.days, [{ dayId: "d1", goal: "加法" }]);
  assert.equal("snapshot" in runnerInput, false);
  assert.equal(result.snapshot.questions.find((question) => question.id === "q1").answer, "3");
  assert.equal(result.snapshot.questions.find((question) => question.id === "q2").answer, "4");
});

test("runner cannot change a non-target question", async () => {
  const state = fixture();
  const service = serviceFor(state, async () => ({
    questions: [
      { id: "q1", prompt: "changed", answer: "3" },
      { id: "q2", prompt: "unauthorized", answer: "99" }
    ]
  }));

  await assert.rejects(
    service.execute({
      actor: { teacherId: "teacher-1" },
      workflowId: "workflow-1",
      command: command(1, "revise", {
        instruction: "Revise q1 only",
        patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "changed", answer: "3" } },
        targetQuestionIds: ["q1"]
      })
    }),
    /WORKFLOW_RUNNER_SCOPE_INVALID/
  );
  assert.equal(state.commits.length, 0);
});

test("a client supplied confirmation is removed from a revised question", async () => {
  const state = fixture();
  const service = serviceFor(state);
  const result = await service.execute({
    actor: { teacherId: "teacher-1" },
    workflowId: "workflow-1",
    command: command(1, "revise", {
      patch: {
        type: "replace_question",
        questionId: "q1",
        value: { id: "q1", prompt: "1+3", answer: "4", reviewedByTeacher: true, confirmedBy: "attacker" }
      },
      targetQuestionIds: ["q1"]
    })
  });
  assert.equal(result.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.equal(result.snapshot.questions[0].confirmedBy, undefined);
});

test("unchanged confirmation on q1 survives a q2 revision, but changed q1 content loses it", async () => {
  const state = fixture();
  state.workflow.snapshot.questions[0] = {
    ...state.workflow.snapshot.questions[0],
    reviewedByTeacher: true,
    confirmedBy: "teacher-1",
    teacherConfirmation: { actorTeacherId: "teacher-1" }
  };
  const service = serviceFor(state);
  const q2 = await service.execute({
    actor: { teacherId: "teacher-1" },
    workflowId: "workflow-1",
    command: command(1, "revise", {
      patch: { type: "replace_question", questionId: "q2", value: { id: "q2", prompt: "2+5", answer: "7", rubric: "结果正确" } },
      targetQuestionIds: ["q2"]
    })
  });
  assert.equal(q2.snapshot.questions[0].confirmedBy, "teacher-1");

  const state2 = fixture();
  state2.workflow.snapshot.questions[0] = { ...state2.workflow.snapshot.questions[0], reviewedByTeacher: true, confirmedBy: "teacher-1" };
  const service2 = serviceFor(state2);
  const q1 = await service2.execute({
    actor: { teacherId: "teacher-1" },
    workflowId: "workflow-1",
    command: command(1, "revise", {
      patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "1+4", answer: "5", rubric: "结果正确" } },
      targetQuestionIds: ["q1"]
    })
  });
  assert.equal(q1.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.equal(q1.snapshot.questions[0].confirmedBy, undefined);
});

test("confirm writes server actor identity and never calls the runner", async () => {
  const state = fixture();
  let calls = 0;
  const service = serviceFor(state, async () => { calls += 1; return { questions: [] }; });
  const result = await service.execute({
    actor: { teacherId: "teacher-1" },
    workflowId: "workflow-1",
    command: command(1, "confirm", { targetQuestionIds: ["q1"], confirmedBy: "attacker" })
  });
  assert.equal(calls, 0);
  assert.equal(result.snapshot.questions[0].confirmedBy, "teacher-1");
  assert.equal(result.snapshot.questions[0].reviewedByTeacher, true);
});

test("restore appends a new revision and leaves the old revision available", async () => {
  const state = fixture();
  const service = serviceFor(state);
  await service.execute({
    actor: { teacherId: "teacher-1" }, workflowId: "workflow-1",
    command: command(1, "revise", { patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "new", answer: "9" } }, targetQuestionIds: ["q1"] })
  });
  const restored = await service.execute({
    actor: { teacherId: "teacher-1" }, workflowId: "workflow-1",
    command: command(2, "restore", { revision: 1 })
  });
  assert.equal(restored.revision, 3);
  assert.equal(restored.snapshot.questions[0].prompt, "1+1");
  assert.equal(state.revisions.get(1).snapshot.questions[0].prompt, "1+1");
});

test("cancel stops later operations from committing", async () => {
  const state = fixture();
  state.workflow.status = "queued";
  const service = serviceFor(state);
  await service.execute({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", command: command(1, "cancel") });
  await assert.rejects(
    service.execute({
      actor: { teacherId: "teacher-1" }, workflowId: "workflow-1",
      command: command(1, "revise", { patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "late", answer: "0" } }, targetQuestionIds: ["q1"] })
    }),
    /WORKFLOW_CANCELLED/
  );
  assert.equal(state.commits.length, 0);
});

test("confirmation inheritance requires identical content fingerprint", () => {
  const inherited = inheritQuestionConfirmations(
    { questions: [{ id: "q1", prompt: "same", answer: "2", reviewedByTeacher: true, confirmedBy: "teacher-1" }] },
    { questions: [{ id: "q1", prompt: "same", answer: "2" }] },
    []
  );
  assert.equal(inherited.questions[0].confirmedBy, "teacher-1");
});

test("historical reads keep workflow identity and reject invalid revisions before repository access", async () => {
  const state = fixture();
  state.revisions.get(1).id = "revision-row-1";
  const service = serviceFor(state);
  const result = await service.get({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", revision: 1 });
  assert.equal(result.workflowId, "workflow-1");
  assert.equal(result.module, "generation");
  await assert.rejects(service.get({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", revision: 1.5 }), /WORKFLOW_REVISION_INVALID/);
});

test("natural language edits do not silently succeed without an executor", async () => {
  const state = fixture();
  await assert.rejects(serviceFor(state).execute({
    actor: { teacherId: "teacher-1" }, workflowId: "workflow-1",
    command: command(1, "revise", { instruction: "Make this harder", patch: { type: "replace_question", questionId: "q1", value: state.workflow.snapshot.questions[0] } })
  }), /WORKFLOW_EXECUTION_UNAVAILABLE/);
  assert.equal(state.commits.length, 0);
});

test("a failed validator blocks writes, including an empty validation response", async () => {
  for (const validation of [undefined, {}, { ok: false }]) {
    const state = fixture();
    const service = createTeachingWorkflowService({ repository: state.repository, validateSnapshot: () => validation });
    await assert.rejects(service.execute({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", command: command(1, "confirm", { targetQuestionIds: ["q1"] }) }), /WORKFLOW_SNAPSHOT_INVALID/);
    assert.equal(state.commits.length, 0);
  }
});

test("confirmation inheritance strips new credentials when content changes", () => {
  const before = { questions: [{ id: "q1", answer: "2", reviewedByTeacher: true, confirmedBy: "teacher-1" }] };
  const after = { questions: [{ id: "q1", answer: "3", reviewedByTeacher: true, confirmedBy: "forged", confirmedAt: "fake" }] };
  const result = inheritQuestionConfirmations(before, after);
  assert.equal(result.questions[0].reviewedByTeacher, undefined);
  assert.equal(result.questions[0].confirmedBy, undefined);
  assert.equal(result.questions[0].confirmedAt, undefined);
});

test("a service without a module validator cannot persist confirmations", async () => {
  const state = fixture();
  const service = createTeachingWorkflowService({ repository: state.repository });
  await assert.rejects(service.execute({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", command: command(1, "confirm", { targetQuestionIds: ["q1"] }) }), /WORKFLOW_VALIDATION_UNAVAILABLE/);
  assert.equal(state.commits.length, 0);
});

test("cancellation reports a conflict when persistence did not cancel the expected version", async () => {
  const state = fixture();
  state.repository.cancel = async () => ({ count: 0 });
  await assert.rejects(serviceFor(state).execute({ actor: { teacherId: "teacher-1" }, workflowId: "workflow-1", command: command(1, "cancel") }), /WORKFLOW_VERSION_CONFLICT/);
});

test("an operation cancelled while the runner is active cannot commit its late result", async () => {
  const state = fixture();
  let calls = 0;
  const service = serviceFor(state, async (input) => {
    calls += 1;
    await state.repository.cancel({ workflowId: state.workflow.id, ownerTeacherId: "teacher-1", expectedRevision: 1 });
    return { questions: [{ ...input.questions[0], answer: "late" }] };
  });
  await assert.rejects(service.execute({
    actor: { teacherId: "teacher-1" }, workflowId: state.workflow.id,
    command: command(1, "revise", { instruction: "Revise q1", patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "new", answer: "3" } }, targetQuestionIds: ["q1"] })
  }), /WORKFLOW_VERSION_CONFLICT/);
  assert.equal(calls, 1);
  assert.equal(state.commits.length, 0);
});

test("a completed operation is replayed without invoking the runner", async () => {
  const state = fixture();
  const operationKey = "replay-key";
  let calls = 0;
  const service = serviceFor(state, async () => { calls += 1; return { questions: [] }; });
  await service.execute({ actor: { teacherId: "teacher-1" }, workflowId: state.workflow.id,
    command: command(1, "confirm", { operationKey, targetQuestionIds: ["q1"] }) });
  const result = await service.execute({ actor: { teacherId: "teacher-1" }, workflowId: state.workflow.id,
    command: command(1, "confirm", { operationKey, targetQuestionIds: ["q1"] }) });
  assert.equal(result.replayed, true);
  assert.equal(result.revision, 2);
  assert.equal(calls, 0);
  assert.equal(state.commits.length, 1);
});

test("creation without a draft executor does not persist an empty task", async () => {
  const state = fixture();
  await assert.rejects(serviceFor(state).create({ actor: { teacherId: "teacher-1" }, input: { module: "generation", requestKey: "new", snapshot: { reviewedByTeacher: true } } }), /WORKFLOW_EXECUTION_UNAVAILABLE/);
  assert.equal(state.commits.length, 0);
});
