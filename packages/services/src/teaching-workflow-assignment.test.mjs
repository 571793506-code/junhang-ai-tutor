import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowAssignmentService } from "./teaching-workflow-assignment.js";
import { createTeachingWorkflowValidator } from "./teaching-workflow-validation.js";
import { createTeachingWorkflowAssignmentRepository } from "../../db/src/teaching-workflow-assignment-repository.js";
import { fakeTeachingArchivePrisma } from "../../../scripts/test-support/teaching-archive-prisma.mjs";
import { validateGradingSourcePackage } from "@junhang/core";

export async function fixture() {
  const actor = { teacherId: "t1" };
  const workflow = { id: "w1", module: "generation", ownerTeacherId: "t1", currentRevision: 3, status: "ready_for_review",
    request: { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", studentId: "s1", requirement: "计算专项" } };
  const validateSnapshot = createTeachingWorkflowValidator();
  const validated = await validateSnapshot({ title: "计算专项", subject: "数学", grade: "四年级", kind: "练习", purpose: "focused",
    questions: [{ id: "q1", questionNo: "2-1", itemType: "calculation", prompt: "3-3", answer: 0, score: 5,
      analysisSteps: ["相同两数相减等于零。"], knowledgePoint: "减法", commonMistake: "零也是答案。", rubric: "正确得5分。",
      reviewedByTeacher: true, confirmedBy: "t1", teacherConfirmation: { actorTeacherId: "t1" } }] },
  { actor, workflow, module: "generation", request: workflow.request, nextRevision: 3 });
  assert.equal(validated.ok, true);
  const snapshot = validated.snapshot;
  const db = fakeTeachingArchivePrisma({ workflows: [workflow], revisions: [{ workflowId: "w1", revision: 3, snapshot }] });
  const dependencies = { repository: createTeachingWorkflowAssignmentRepository(db), authorizeTarget: async () => true, validateSnapshot };
  const service = createTeachingWorkflowAssignmentService(dependencies);
  return { actor, workflow, snapshot, db, service, dependencies, input: { actor, workflowId: "w1", expectedRevision: 3 } };
}

test("a confirmed generation version publishes one immutable Assignment without model or PDF calls", async () => {
  const f = await fixture();
  const result = await f.service.publish({ ...f.input, snapshot: { answer: "FORGED" }, teacherId: "t2" });
  assert.equal(result.status, "assignment_ready");
  const [assignment] = f.db.snapshot().assignments;
  assert.equal(assignment.id, result.assignmentId);
  assert.equal(assignment.items[0].answer, 0);
  assert.equal(assignment.items[0].metadata.sourceQuestionNo, "2-1");
  assert.equal(assignment.metadata.draftReviewStatus, "accepted");
  assert.equal(assignment.metadata.layoutValidation, undefined);
  assert.equal(assignment.metadata.generationPipeline.gates.finalExportAllowed, false);
  assert.equal(assignment.metadata.workflowPublication.revision, 3);
  assert.equal(assignment.metadata.gradingSourcePackage.version, 3);
  assert.equal(assignment.metadata.gradingSourcePackage.sourceId, assignment.id);
  assert.equal(validateGradingSourcePackage(assignment.metadata.gradingSourcePackage).ok, true);
  assert.deepEqual(f.db.snapshot().revisions[0].snapshot, f.snapshot);
  assert.equal(await f.service.verify({ actor: f.actor, assignment }), true);
});

test("concurrent publication and restarted retries return the same assignment", async () => {
  const f = await fixture();
  const results = await Promise.all([f.service.publish(f.input), f.service.publish(f.input)]);
  assert.equal(results[0].assignmentId, results[1].assignmentId);
  assert.deepEqual(results.map((r) => r.replayed), [false, true]);
  const restarted = createTeachingWorkflowAssignmentService(f.dependencies);
  assert.equal((await restarted.publish(f.input)).replayed, true);
  assert.equal(f.db.snapshot().assignments.length, 1);
});

test("unconfirmed, foreign, unavailable and stale generation cannot publish", async () => {
  for (const mutate of [
    (s) => { s.revisions[0].snapshot.questions[0].reviewedByTeacher = false; },
    (s) => { s.revisions[0].snapshot.questions[0].confirmedBy = "t2"; },
    (s) => { s.workflows[0].currentRevision = 4; },
    (s) => { s.workflows[0].activeOperationKey = "busy"; },
    (s) => { s.workflows[0].status = "cancelled"; },
    (s) => { s.workflows[0].module = "grading"; },
    (s) => { s.revisions[0].snapshot.purpose = "explanation"; },
    (s) => { s.revisions[0].snapshot.questions[0].answer = 9; }
  ]) {
    const f = await fixture(); const state = f.db.snapshot(); mutate(state); f.db.seed(state);
    await assert.rejects(f.service.publish(f.input));
    assert.equal(f.db.snapshot().assignments.length, 0);
  }
  const f = await fixture();
  await assert.rejects(f.service.publish({ ...f.input, actor: { teacherId: "t2" } }), { code: "WORKFLOW_NOT_FOUND" });
  await assert.rejects(createTeachingWorkflowAssignmentService({}).publish(f.input), { code: "WORKFLOW_ASSIGNMENT_UNAVAILABLE" });
  await assert.rejects(createTeachingWorkflowAssignmentService({ ...f.dependencies, authorizeTarget: async () => false }).publish(f.input), { code: "WORKFLOW_FORBIDDEN" });
  await assert.rejects(createTeachingWorkflowAssignmentService({ ...f.dependencies, validateSnapshot: async () => ({ ok: false }) }).publish(f.input), { code: "WORKFLOW_SNAPSHOT_INVALID" });
});

test("new versions make new assignments while historical publication and its export metadata stay intact", async () => {
  const f = await fixture(); const first = await f.service.publish(f.input);
  const state = f.db.snapshot();
  state.assignments[0].metadata.layoutValidation = { ok: true };
  state.assignments[0].metadata.latestPrintAssetId = "original-pdf";
  state.workflows[0].currentRevision = 4;
  const next = structuredClone(f.snapshot); next.questions[0].prompt = "4-4";
  const validated = await f.dependencies.validateSnapshot(next, { actor: f.actor, workflow: state.workflows[0], request: f.workflow.request, module: "generation", nextRevision: 4 });
  state.revisions.push({ workflowId: "w1", revision: 4, snapshot: validated.snapshot });
  f.db.seed(state);
  const second = await f.service.publish({ ...f.input, expectedRevision: 4 });
  assert.notEqual(second.assignmentId, first.assignmentId);
  assert.equal((await f.service.publish(f.input)).assignmentId, first.assignmentId);
  assert.equal(f.db.snapshot().assignments[0].metadata.latestPrintAssetId, "original-pdf");
  assert.equal(f.db.snapshot().assignments[1].metadata.layoutValidation, undefined);
});

test("failed transactions publish nothing and modified saved content cannot be replayed or exported", async () => {
  const f = await fixture(); f.db.failAt = "commit";
  await assert.rejects(f.service.publish(f.input)); assert.equal(f.db.snapshot().assignments.length, 0);
  f.db.failAt = null; await f.service.publish(f.input);
  const state = f.db.snapshot(); state.assignments[0].items[0].prompt = "改写旧卷"; f.db.seed(state);
  await assert.rejects(f.service.publish(f.input), { code: "WORKFLOW_ASSIGNMENT_INVALID" });
  await assert.rejects(f.service.verify({ actor: f.actor, assignment: state.assignments[0] }), { code: "WORKFLOW_ASSIGNMENT_INVALID" });
});
