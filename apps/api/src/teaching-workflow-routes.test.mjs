import assert from "node:assert/strict";
import test from "node:test";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";

const input = { requestKey: "request-1", module: "generation", request: { subject: "math", grade: "4", requirement: "addition" } };

test("HTTP explicit recovery is teacher scoped, uses original requirements and replays without extra calls", async (t) => {
  let calls = 0;
  const f = await workflowHttpFixture(t, { createDraft: async ({ input: received }) => {
    calls++; assert.deepEqual(received.request, input.request);
    if (calls === 1) throw new Error("PRIVATE credentials and response");
    return { snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2" }] } };
  } });
  const failed = (await (await f.request("/workflows", { body: input })).json()).workflow;
  assert.deepEqual(failed.failure.code, "WORKFLOW_EXECUTION_FAILED");
  const url = `/workflows/${failed.id}/recover`;
  const body = { expectedRevision: 1, operationKey: "recover", request: { requirement: "FORGED" }, snapshot: { reviewedByTeacher: true } };
  assert.equal((await f.request(url, { token: f.tokens.student, body })).status, 403);
  assert.equal((await f.request(url, { token: f.tokens.other, body })).status, 404);
  assert.equal((await f.request(url, { body: { ...body, expectedRevision: 2 } })).status, 409);
  assert.equal((await f.request(url, { body: { expectedRevision: 1 } })).status, 400);
  const response = await f.request(url, { body }); assert.equal(response.status, 201);
  const recovered = (await response.json()).workflow;
  assert.notEqual(recovered.id, failed.id); assert.deepEqual(recovered.request, input.request);
  assert.equal(recovered.content.questions[0].reviewedByTeacher, undefined);
  assert.doesNotMatch(JSON.stringify([failed, recovered]), /PRIVATE|FORGED/);
  const replay = await f.request(url, { body }); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).workflow.id, recovered.id); assert.equal(calls, 2);
  assert.equal((await f.request(`/workflows/${recovered.id}/recover`, { body: { ...body, expectedRevision: 2 } })).status, 409);
  const client = (await import("../../../scripts/teaching-workflow-client.mjs")).createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  assert.equal((await client.recover(failed.id, body)).id, recovered.id); assert.equal(calls, 2);
  assert.equal((await client.get(failed.id)).status, "failed");
});

test("workflow list is teacher scoped, module filtered and returns safe summaries for Web recovery", async (t) => {
  const f = await workflowHttpFixture(t);
  assert.equal((await f.request("/workflows?module=generation", { token: null })).status, 401);
  await f.request("/workflows", { body: input });
  await f.request("/workflows", { body: { ...input, requestKey: "grading", module: "grading" } });
  await f.request("/workflows", { token: f.tokens.other, body: input });
  const response = await f.request("/workflows?module=generation");
  assert.equal(response.status, 200);
  const { workflows } = await response.json();
  assert.equal(workflows.length, 1); assert.equal(workflows[0].id, "workflow-1");
  assert.equal(workflows[0].revision, 2); assert.deepEqual(workflows[0].request, input.request);
  assert.equal(workflows[0].content, undefined); assert.doesNotMatch(JSON.stringify(workflows), /PRIVATE|ownerTeacherId|snapshot/);
  assert.equal((await f.request("/workflows?module=invalid")).status, 400);
  const disabled = await workflowHttpFixture(t, { service: null });
  assert.equal((await disabled.request("/workflows?module=generation")).status, 503);
});

test("HTTP teacher scope and nested allowlists protect workflow creation and views", async (t) => {
  const f = await workflowHttpFixture(t);
  assert.equal((await f.request("/workflows", { token: null, body: input })).status, 401);
  assert.equal((await f.request("/workflows", { token: f.tokens.student, body: input })).status, 403);
  const response = await f.request("/workflows", { body: { ...input, ownerTeacherId: "t2", model: "PRIVATE", snapshot: { reviewedByTeacher: true }, request: { ...input.request, model: "PRIVATE", prompt: "PRIVATE", generationContext: { teacherId: "t2" } } } });
  assert.equal(response.status, 201);
  const { workflow } = await response.json();
  assert.equal(workflow.id, "workflow-1");
  assert.deepEqual(workflow.request, input.request);
  assert.equal(JSON.stringify(workflow).includes("PRIVATE"), false);
  assert.deepEqual(f.preparedInputs[0], input);
  assert.equal(f.heads.get(workflow.id).ownerTeacherId, "t1");
  assert.equal((await f.request(`/workflows/${workflow.id}`, { token: f.tokens.other })).status, 404);
  assert.equal((await f.request(`/workflows/${workflow.id}/revisions/1`, { token: f.tokens.other })).status, 404);
  assert.equal((await f.request(`/workflows/${workflow.id}/commands`, { token: f.tokens.other, body: { action: "confirm", expectedRevision: 1, operationKey: "op", targetQuestionIds: ["q1"] } })).status, 404);
});

test("HTTP edits preserve history, reject stale revisions and ignore forged confirmation", async (t) => {
  const f = await workflowHttpFixture(t);
  const { workflow } = await (await f.request("/workflows", { body: input })).json();
  assert.equal(workflow.revision, 2);
  const edit = { action: "revise", expectedRevision: workflow.revision, operationKey: "edit", patch: { type: "replace_question", questionId: "q1", value: { id: "q1", prompt: "2+2", answer: "4", reviewedByTeacher: true, confirmedBy: "forged", metadata: { raw: "PRIVATE" } } } };
  const updated = await (await f.request(`/workflows/${workflow.id}/commands`, { body: edit })).json();
  assert.equal(updated.workflow.revision, 3);
  assert.equal(updated.workflow.content.questions[0].reviewedByTeacher, undefined);
  const replay = await (await f.request(`/workflows/${workflow.id}/commands`, { body: edit })).json();
  assert.equal(replay.workflow.revision, 3);
  assert.deepEqual(replay.workflow.content, updated.workflow.content);
  assert.equal((await f.request(`/workflows/${workflow.id}/commands`, { body: { ...edit, expectedRevision: 3 } })).status, 409);
  assert.equal((await f.request(`/workflows/${workflow.id}/commands`, { body: { ...edit, operationKey: "stale" } })).status, 409);
  const historic = await (await f.request(`/workflows/${workflow.id}/revisions/2`)).json();
  assert.equal(historic.workflow.id, workflow.id);
  assert.equal(historic.workflow.status, "historical");
  assert.equal(historic.workflow.content.questions[0].answer, "2");
  const restored = await (await f.request(`/workflows/${workflow.id}/commands`, { body: { action: "restore", expectedRevision: 3, operationKey: "restore", restoreRevision: 2 } })).json();
  assert.equal(restored.workflow.revision, 4);
  assert.equal(restored.workflow.content.questions[0].answer, "2");
  const oldReplay = await (await f.request(`/workflows/${workflow.id}/commands`, { body: edit })).json();
  assert.equal(oldReplay.workflow.revision, 3);
  assert.equal(oldReplay.workflow.status, "historical");
  assert.equal((await f.request(`/workflows/${workflow.id}/revisions/1.5`)).status, 400);
  assert.equal((await f.request(`/workflows/${workflow.id}/commands`, { body: [] })).status, 400);
});

test("creation replay reads current head and changed requestKey reuse conflicts", async (t) => {
  const f = await workflowHttpFixture(t);
  await f.request("/workflows", { body: input });
  await f.request("/workflows/workflow-1/commands", { body: { action: "confirm", operationKey: "confirm", expectedRevision: 2, targetQuestionIds: ["q1"] } });
  const response = await (await f.request("/workflows", { body: input })).json();
  assert.equal(response.workflow.revision, 3);
  assert.equal(response.workflow.content.questions[0].reviewedByTeacher, true);
  assert.equal((await f.request("/workflows", { body: { ...input, request: { ...input.request, requirement: "changed" } } })).status, 409);
  assert.equal(f.preparedInputs.length, 1);
});

test("disabled workflow returns an authenticated 503 without touching persistence", async (t) => {
  const f = await workflowHttpFixture(t, { service: null });
  assert.equal((await f.request("/workflows/anything", { token: null })).status, 401);
  const response = await f.request("/workflows/anything");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "WORKFLOW_UNAVAILABLE");
});

test("unknown internal errors never expose vendor, database, or credential strings", async (t) => {
  const f = await workflowHttpFixture(t, { service: { get: () => { throw Object.assign(new Error("PRIVATE connection string"), { code: "PRIVATE", status: 401 }); } } });
  const response = await f.request("/workflows/anything");
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes("PRIVATE"), false);
});

test("HTTP and CLI distinguish running reservations from generated content", { timeout: 5000 }, async (t) => {
  let enter; let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const f = await workflowHttpFixture(t, { createDraft: async ({ input }) => {
    calls++; enter(); await wait;
    return { request: input.request, snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2" }] } };
  } });
  const first = f.request("/workflows", { body: input });
  try {
    await entered;
    const retry = await f.request("/workflows", { body: input });
    assert.equal(retry.status, 202);
    const { workflow } = await retry.json();
    assert.equal(workflow.status, "running"); assert.equal(workflow.revision, 1);
    assert.deepEqual(workflow.content.questions, []);
    assert.equal(workflow.issues[0].code, "WORKFLOW_CREATION_INCOMPLETE");
    const { createTeachingWorkflowClient } = await import("../../../scripts/teaching-workflow-client.mjs");
    const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
    assert.deepEqual(await client.create(input), workflow);
    const blocked = await f.request(`/workflows/${workflow.id}/commands`, { body: { action: "confirm", expectedRevision: 1, operationKey: "premature", targetQuestionIds: ["q1"] } });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, "WORKFLOW_CREATION_INCOMPLETE");
  } finally { release(); }
  const completed = await first;
  assert.equal(completed.status, 201);
  assert.equal((await completed.json()).workflow.revision, 2);
  assert.equal((await f.request("/workflows", { body: input })).status, 200);
  assert.equal(calls, 1);
});

test("a failed creation remains a visible failed task without leaking executor errors", async (t) => {
  let calls = 0;
  const f = await workflowHttpFixture(t, { createDraft: () => { calls++; throw new Error("PRIVATE provider credential"); } });
  const response = await f.request("/workflows", { body: input });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.workflow.status, "failed"); assert.equal(result.workflow.revision, 1);
  assert.equal(result.workflow.issues[0].code, "WORKFLOW_CREATION_INCOMPLETE");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  await f.request("/workflows", { body: input });
  assert.equal(calls, 1);
});
