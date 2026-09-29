import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowAssignmentService, createTeachingWorkflowValidator } from "@junhang/services";
import { createTeachingWorkflowAssignmentRepository } from "@junhang/db";
import { fakeTeachingArchivePrisma } from "../../../scripts/test-support/teaching-archive-prisma.mjs";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

test("HTTP and CLI share a version-bound Assignment with no caller-supplied publication authority", async (t) => {
  const validateSnapshot = createTeachingWorkflowValidator();
  const workflow = { id: "w1", ownerTeacherId: "t1", module: "generation", currentRevision: 3, status: "ready_for_review",
    request: { subject: "数学", grade: "四年级", purpose: "focused", kind: "练习", studentId: "s1" } };
  const checked = await validateSnapshot({ title: "专项", ...workflow.request, questions: [{ id: "q1", questionNo: "1", prompt: "1+1", answer: "2", score: 5,
    rubric: "结果正确", knowledgePoint: "加法", analysisSteps: ["合并数量"], commonMistake: "漏数", reviewedByTeacher: true, confirmedBy: "t1", teacherConfirmation: { actorTeacherId: "t1" } }] },
  { module: "generation", workflow, nextRevision: 3 });
  const db = fakeTeachingArchivePrisma({ workflows: [workflow], revisions: [{ workflowId: "w1", revision: 3, snapshot: checked.snapshot }] });
  let allowed = true;
  const assignmentService = createTeachingWorkflowAssignmentService({ repository: createTeachingWorkflowAssignmentRepository(db),
    authorizeTarget: async () => allowed, validateSnapshot });
  const f = await workflowHttpFixture(t, { assignmentService });
  const body = { expectedRevision: 3, snapshot: { answer: "forged" }, teacherId: "t2", confirmedBy: "t2" };
  for (const [token, expected] of [[null, 401], [f.tokens.student, 403], [f.tokens.other, 404]]) {
    assert.equal((await f.request("/workflows/w1/assignment", { body, token })).status, expected);
  }
  const response = await f.request("/workflows/w1/assignment", { body }); assert.equal(response.status, 201);
  const first = (await response.json()).assignment;
  assert.equal(first.status, "assignment_ready");
  assert.deepEqual(Object.keys(first).sort(), ["currentRevision", "id", "replayed", "revision", "status", "workflowId"]);
  const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  assert.deepEqual(await client.assignment("w1", body), { ...first, replayed: true });
  assert.equal(db.snapshot().assignments.length, 1); assert.equal(db.snapshot().assignments[0].items[0].answer, "2");
  allowed = false;
  await assert.rejects(client.assignment("w1", body), { code: "WORKFLOW_FORBIDDEN" });
});

test("assignment route rejects incomplete requests, unavailable services and malformed success", async (t) => {
  const calls = [];
  let result = { assignmentId: "a1", status: "assignment_ready", workflowId: "w1", revision: 3, currentRevision: 3, replayed: false, raw: "PRIVATE" };
  const f = await workflowHttpFixture(t, { assignmentService: { publish: async (input) => { calls.push(input); return result; } } });
  for (const body of [{}, [], { expectedRevision: "3" }, { expectedRevision: 0 }, { expectedRevision: 1.2 }]) {
    assert.equal((await f.request("/workflows/w1/assignment", { body })).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await f.request("/workflows/w1/assignment", { body: { expectedRevision: 3, snapshot: "PRIVATE" } });
  assert.equal(response.status, 201); assert.doesNotMatch(await response.text(), /PRIVATE/);
  assert.deepEqual(calls[0], { actor: { teacherId: "t1" }, workflowId: "w1", expectedRevision: 3 });
  for (const change of [{ revision: 2 }, { currentRevision: 2 }, { status: "failed" }, { assignmentId: "" }, { replayed: 1 }]) {
    result = { assignmentId: "a1", status: "assignment_ready", workflowId: "w1", revision: 3, currentRevision: 3, replayed: false, ...change };
    assert.equal((await f.request("/workflows/w1/assignment", { body: { expectedRevision: 3 } })).status, 500);
  }
  const disabled = await workflowHttpFixture(t);
  assert.equal((await disabled.request("/workflows/w1/assignment", { body: { expectedRevision: 3 } })).status, 503);
});
