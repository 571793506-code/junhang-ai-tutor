import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildGradingSourcePackage } from "@junhang/core";
import { createTeachingWorkflowExecution } from "../../apps/api/src/teaching-workflow-execution.js";
import { workflowHttpFixture } from "./teaching-workflow-http.mjs";

// Same full HTTP/service/model-pipeline proof runs against memory and isolated PG.
// Model responses are synthetic; this is persistence/recovery evidence only.
export async function exerciseGradingCheckpointRecovery(t, repository, restartedRepository = repository) {
  const sourcePackage = buildGradingSourcePackage({ id: "checkpoint-paper", grade: "四年级", subject: { name: "数学" },
    items: Array.from({ length: 20 }, (_, i) => ({ orderIndex: i + 1, prompt: `计算${i + 1}+1。`, answer: String(i + 2), score: 5,
      rubric: "方法2分；计算2分；结果1分。", analysisSteps: ["按题目计算。"], knowledgePoint: "加法",
      sourceContext: { itemType: "calculation" } })) }).package;
  const context = { ok: true, subject: "数学", assignmentId: "checkpoint-paper", sourcePackage,
    archiveEvidence: { fingerprint: "original-evidence", sourceFingerprint: sourcePackage.fingerprint },
    submission: { content: { ocr: { questions: sourcePackage.questions.map(q => ({ questionNo: q.questionNo,
      printedPrompt: q.prompt, studentAnswer: q.correctAnswer, observedWork: `${q.prompt}=${q.correctAnswer}`, confidence: 0.98 })) } } } };
  let failSecond = true; const calls = [];
  const execution = createTeachingWorkflowExecution({ resolveGradingContext: async () => structuredClone(context),
    teachingExecution: { call: async (_route, messages, options) => {
      const sent = JSON.parse(messages[1].content); calls.push(sent.gradingQuestionNos);
      options.onTransportProgress({ phase: "request_started", elapsedMs: 0, requestBytes: 100 });
      if (failSecond && !sent.gradingQuestionNos.includes("1")) {
        options.onTransportProgress({ phase: "response_headers", status: 503, elapsedMs: 10, url: "PRIVATE" });
        throw Object.assign(new Error("PRIVATE credentials and student text"), { status: 503, code: "service_unavailable" });
      }
      return { text: JSON.stringify({ summary: "待教师复核。", questionResults: sent.gradingQuestionNos.map(questionNo => ({
        questionNo, status: "correct", score: 5, maxScore: 5, explanation: "方法、计算和结果符合评分点。", confidence: 0.98
      })) }), usage: { completion_tokens: 100 } };
    } } });
  const http = await workflowHttpFixture(t, { ...execution, ...(repository ? { repository } : {}) });
  const created = await http.request("/workflows", { body: { module: "grading", requestKey: randomUUID(),
    request: { studentId: "s1", submissionId: "checkpoint-submission", requirement: "按首次作答评分。" },
    checkpoint: { units: { "grading-2": { candidate: "FORGED" } } } } });
  assert.equal(created.status, 200); // A durable failed reservation is not a created draft.
  const createdBody = await created.json();
  const failed = createdBody.workflow;
  assert.equal(failed.status, "failed"); assert.equal(failed.content.questions.length, 0);
  assert.equal(failed.content.gradingSummary.confirmedCount, 0); assert.equal(failed.archive, null);
  assert.equal(calls.length, 2);
  const repo = repository || http.repo;
  const before = structuredClone(await repo.get(failed.id, "t1"));
  assert.equal(failed.recoveryAllowed, true);
  assert.deepEqual(Object.keys(before.checkpoint.units), ["grading-1"]);
  const attempt = before.checkpoint.failure.diagnostics.attempts.find(a => a.partitionId === "grading-2");
  assert.equal(attempt.upstreamStatus, 503); assert.equal(attempt.transportDiagnostics.phase, "response_headers");
  assert.equal(attempt.failureCode, "http_error");
  assert.doesNotMatch(JSON.stringify(before.checkpoint.failure), /PRIVATE|credentials|url|student text/);
  assert.doesNotMatch(JSON.stringify(createdBody), /"(?:diagnostics|attempts|checkpoint)"|gpt-|FORGED|PRIVATE/i);
  const rejected = await http.request(`/workflows/${failed.id}/commands`, { body: { action: "confirm", operationKey: "confirm-partial", expectedRevision: 1, targetQuestionIds: ["q1"] } });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, "WORKFLOW_CREATION_INCOMPLETE");
  failSecond = false;
  const restarted = await workflowHttpFixture(t, { ...execution, repository: restartedRepository || repo });
  const args = { expectedRevision: 1, operationKey: "explicit-recovery" };
  const recoveredResponse = await restarted.request(`/workflows/${failed.id}/recover`, { body: args });
  const recovered = (await recoveredResponse.json()).workflow;
  assert.equal(recoveredResponse.status, 201); assert.equal(recovered.status, "ready_for_review");
  assert.equal(recovered.recoveryAllowed, false);
  assert.equal(calls.length, 3); assert.deepEqual(calls[2], sourcePackage.questions.slice(10).map(q => q.questionNo));
  assert.equal(recovered.content.questions.length, 20); assert.equal(recovered.content.gradingSummary.confirmedCount, 0);
  assert.equal(recovered.archive, null); assert.equal(recovered.reviewStatus, "review_required");
  assert.deepEqual(await repo.get(failed.id, "t1"), before);
  const next = await repo.get(recovered.id, "t1");
  assert.deepEqual(Object.keys(next.checkpoint.units).sort(), ["grading-1", "grading-2"]);
  const replay = await restarted.request(`/workflows/${failed.id}/recover`, { body: { ...args, operationKey: "another-key" } });
  assert.equal((await replay.json()).workflow.id, recovered.id); assert.equal(calls.length, 3);
  assert.equal((await restarted.request(`/workflows/${failed.id}/recover`, { token: restarted.tokens.other, body: args })).status, 404);
}
