import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowExecution } from "./teaching-workflow-execution.js";
import { createTeachingWorkflowValidator } from "../../../packages/services/src/teaching-workflow-validation.js";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

const explanation = () => ({ concept: "进位加法", steps: ["先对齐数位", "满十向前一位进一"],
  workedExamples: [{ prompt: "24+18", answer: "42", analysisSteps: ["个位4+8=12", "十位2+1+1=4"] }], commonMistakes: ["不要漏掉进位"] });
const request = { subject: "数学", grade: "四年级", purpose: "explanation", requirement: "讲解进位加法，包含例题和易错点" };
async function fixture(t) {
  const calls = [];
  let reply = null; let changed = false;
  const execution = createTeachingWorkflowExecution({
    resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request, contentContext: { approvedOnly: true, matches: [{ sourceId: "approved-source", score: 1, excerpt: changed ? "changed evidence" : "original evidence" }] }, studentSignals: [] } }),
    teachingExecution: { call: async (route, messages) => {
      const sent = JSON.parse(messages[1].content);
      calls.push({ route, messages, sent });
      const e = reply ? await reply(sent) : { ...explanation(), ...(sent.instruction ? { concept: "用小棒理解进位加法" } : {}), reviewedByTeacher: true, confirmedBy: "t1", teacherConfirmation: { actorTeacherId: "t1" }, debug: "PRIVATE",
        workedExamples: explanation().workedExamples.map((q) => ({ ...q, raw: "PRIVATE", model: "PRIVATE", reviewedByTeacher: true })) };
      return { text: JSON.stringify({ title: "加法讲解", explanation: e }), usage: { completion_tokens: 30 } };
    } }
  });
  const http = await workflowHttpFixture(t, execution);
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  const create = () => client.create({ module: "generation", requestKey: "explanation", request });
  return { ...http, client, calls, create, reply: (fn) => { reply = fn; }, changeEvidence: () => { changed = true; } };
}

test("explanation HTTP view exposes teaching content without model confirmation or exam artifacts", async (t) => {
  const f = await fixture(t); const view = await f.create();
  assert.equal(view.status, "ready_for_review"); assert.equal(view.revision, 2);
  assert.deepEqual(view.content.explanation, explanation());
  assert.deepEqual(view.content.questions, []); assert.equal(view.content.totalScore, undefined);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE|teacherConfirmation|gradingSourcePackage/);
  const saved = await f.repo.get(view.id, "t1");
  assert.equal(saved.snapshot.explanation.reviewedByTeacher, undefined);
  assert.equal(saved.snapshot.gradingSourcePackage, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.request(`/workflows/${view.id}`, { token: f.tokens.other })).status, 404);
  assert.equal((await f.request(`/workflows/${view.id}`, { token: f.tokens.student })).status, 403);
});

test("HTTP and CLI confirm, edit, replay and restore explanation versions without another model call", async (t) => {
  const f = await fixture(t); const initial = await f.create();
  const confirm = { action: "confirm", operationKey: "confirm", expectedRevision: 2, targetExplanation: true };
  const confirmed = await f.client.execute(initial.id, confirm);
  assert.equal(confirmed.content.explanation.reviewedByTeacher, true);
  assert.equal((await f.repo.get(initial.id, "t1")).snapshot.explanation.confirmedBy, "t1");
  assert.doesNotMatch(JSON.stringify(confirmed), /confirmedBy|teacherConfirmation/);
  const changed = { ...explanation(), concept: "数位对齐", reviewedByTeacher: true, confirmedBy: "forged" };
  const edit = { action: "revise", operationKey: "edit", expectedRevision: 3, targetExplanation: true, patch: { type: "replace_explanation", value: changed } };
  const next = await f.client.execute(initial.id, edit);
  assert.equal(next.revision, 4); assert.equal(next.content.explanation.concept, "数位对齐");
  assert.equal(next.content.explanation.reviewedByTeacher, undefined);
  assert.deepEqual(await f.client.execute(initial.id, edit), next);
  assert.equal((await f.client.execute(initial.id, confirm)).status, "historical");
  await assert.rejects(f.client.execute(initial.id, { ...edit, operationKey: "stale" }), { code: "WORKFLOW_VERSION_CONFLICT" });
  const restored = await f.client.execute(initial.id, { action: "restore", operationKey: "restore", expectedRevision: 4, restoreRevision: 3 });
  assert.equal(restored.revision, 5); assert.equal(restored.content.explanation.reviewedByTeacher, true);
  assert.equal(restored.content.explanation.concept, explanation().concept);
  const invalid = await f.request(`/workflows/${initial.id}/commands`, { body: { ...edit, operationKey: "incomplete", expectedRevision: 5, patch: { type: "replace_explanation", value: { ...explanation(), steps: [] } } } });
  assert.equal(invalid.status, 422); assert.equal((await f.client.get(initial.id)).revision, 5);
  assert.equal(f.calls.length, 1);
});

test("natural language explanation revision uses the shared bounded pipeline and clears confirmation", async (t) => {
  const f = await fixture(t); const initial = await f.create();
  await f.client.execute(initial.id, { action: "confirm", operationKey: "confirm", expectedRevision: 2, targetExplanation: true });
  const revised = await f.client.execute(initial.id, { action: "revise", operationKey: "revise", expectedRevision: 3, targetExplanation: true, instruction: "用小棒说明进位" });
  assert.equal(revised.content.explanation.concept, "用小棒理解进位加法");
  assert.equal(revised.content.explanation.reviewedByTeacher, undefined);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].route.model, "gpt-6.1-sol");
  assert.deepEqual(f.calls[1].sent.explanation, explanation());
  assert.match(f.calls[1].messages[0].content, /generation-v1/);
  assert.doesNotMatch(JSON.stringify(f.calls[1].sent), /PRIVATE|teacherConfirmation|reviewedByTeacher/);
  let attempts = 0;
  f.reply(() => ++attempts === 1 ? { ...explanation(), steps: [] } : explanation());
  const repaired = await f.client.execute(initial.id, { action: "revise", operationKey: "repair", expectedRevision: 4, targetExplanation: true, instruction: "补齐步骤" });
  assert.equal(repaired.revision, 5); assert.equal(attempts, 2);
  f.changeEvidence();
  await assert.rejects(f.client.execute(initial.id, { action: "revise", operationKey: "changed-evidence", expectedRevision: 5, targetExplanation: true, instruction: "改写" }), { code: "WORKFLOW_EVIDENCE_CHANGED" });
  assert.equal(attempts, 2); assert.equal((await f.client.get(initial.id)).revision, 5);
});

test("explanation targets are explicit and cannot be mixed with question commands or grant confirmation", async (t) => {
  const f = await fixture(t); const initial = await f.create();
  const common = { action: "confirm", operationKey: "invalid", expectedRevision: 2 };
  for (const extra of [{}, { targetExplanation: false }, { targetExplanation: "true" }, { targetQuestionIds: ["q1"] }, { targetExplanation: true, targetQuestionIds: ["q1"] },
    { action: "revise", patch: { type: "replace_explanation", value: explanation() } },
    { action: "revise", targetExplanation: true, patch: { type: "replace_question", questionId: "q1", value: { id: "q1" } } }]) {
    const response = await f.request(`/workflows/${initial.id}/commands`, { body: { ...common, ...extra } });
    assert.ok([400, 422].includes(response.status), JSON.stringify(extra));
  }
  await assert.rejects(f.service.execute({ actor: { teacherId: "t1" }, workflowId: initial.id,
    command: { ...common, targetExplanation: true, targetQuestionIds: ["q1"] } }));
  assert.equal((await f.client.get(initial.id)).revision, 2); assert.equal(f.calls.length, 1);
  const other = await workflowHttpFixture(t);
  const q = await (await other.request("/workflows", { body: { module: "generation", requestKey: "questions", request: { subject: "math" } } })).json();
  const mixed = await other.request(`/workflows/${q.workflow.id}/commands`, { body: { ...common, targetExplanation: true } });
  assert.equal(mixed.status, 422);
});

test("explanation validation removes exam fields and rejects incomplete examples", async () => {
  const validate = createTeachingWorkflowValidator();
  const context = { module: "generation", workflow: { id: "w1" }, request, nextRevision: 2 };
  const input = { title: "加法", ...request, explanation: explanation(), questions: [{ id: "q1", answer: "2" }], totalScore: 100, gradingSourcePackage: { fake: true }, parsed: { explanation: { raw: "PRIVATE" } } };
  const result = await validate(input, context);
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.questions, []);
  assert.equal(result.snapshot.gradingSourcePackage, undefined); assert.equal(result.snapshot.totalScore, undefined);
  assert.equal(result.snapshot.parsed, undefined);
  assert.equal((await validate({ ...input, explanation: { ...explanation(), workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: [] }] } }, context)).ok, false);
});

test("failed explanation repair preserves the confirmed version and cannot spend unbounded calls", async (t) => {
  const f = await fixture(t); const initial = await f.create();
  const confirmed = await f.client.execute(initial.id, { action: "confirm", operationKey: "confirm", expectedRevision: 2, targetExplanation: true });
  f.reply(() => ({ concept: "incomplete" }));
  await assert.rejects(f.client.execute(initial.id, { action: "revise", operationKey: "fail", expectedRevision: 3, targetExplanation: true, instruction: "修改讲解" }), { code: "WORKFLOW_EXECUTION_FAILED" });
  const saved = await f.client.get(initial.id);
  assert.equal(saved.revision, 3); assert.equal(saved.status, "failed");
  assert.deepEqual(saved.content, confirmed.content); assert.equal(f.calls.length, 3);
});

test("cancelling explanation revision fences late model output without overwriting history", { timeout: 5000 }, async (t) => {
  const f = await fixture(t); const initial = await f.create();
  let enter; let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  f.reply(async () => { enter(); await wait; return explanation(); });
  const pending = f.client.execute(initial.id, { action: "revise", operationKey: "slow", expectedRevision: 2, targetExplanation: true, instruction: "慢速修订" });
  const rejected = assert.rejects(pending, { code: "WORKFLOW_CANCELLED" });
  try {
    await entered;
    const cancelled = await f.client.execute(initial.id, { action: "cancel", operationKey: "cancel", expectedRevision: 2 });
    assert.equal(cancelled.status, "cancelled");
  } finally { release(); }
  await rejected;
  const saved = await f.client.get(initial.id);
  assert.equal(saved.revision, 2); assert.deepEqual(saved.content, initial.content);
  assert.equal(f.calls.length, 2);
});
