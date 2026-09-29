import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeTeachingCapabilities, runGenerationAcceptance, collectScoringEvidence, buildWorkflowAcceptanceCases } from "./teaching-workflow-acceptance.mjs";
import { workflowHttpFixture } from "./test-support/teaching-workflow-http.mjs";
import { gradingWorkflowFixture, gradingRequest } from "./test-support/grading-workflow.mjs";
import { createTeachingWorkflowExecution } from "../apps/api/src/teaching-workflow-execution.js";
import { loadTeachingRulePack } from "@junhang/ai";
import { draftAssessmentService } from "@junhang/services";

test("language acceptance selects bounded explicit requests without altering the default mathematics suite", async () => {
  const math = buildWorkflowAcceptanceCases();
  assert.deepEqual(math.map((s) => s.purpose), ["focused", "multi_day", "comprehensive", "explanation"]);
  assert.ok(math.every((s) => s.subject === "数学"));
  for (const [subject, type] of [["语文", "solution"], ["英语", "fill"]]) {
    const [sample, ...rest] = buildWorkflowAcceptanceCases(subject);
    assert.equal(rest.length, 0);
    assert.equal(sample.subject, subject);
    assert.equal(sample.purpose, "focused");
    assert.deepEqual(sample.requestedItemTypes, [type]);
    assert.equal(sample.requestedItemCount, 4);
    assert.equal(sample.assessmentTotalTimeoutMs, 120000);
    assert.equal(sample.assessmentMaxTokens, 16000);
    let called = 0;
    const report = await runGenerationAcceptance({}, { subject, purpose: "focused", generate: async (_config, request, options) => {
      called++;
      assert.equal(request.subject, subject);
      assert.equal(options.persist, false);
      return { modelAvailable: false };
    } });
    assert.equal(called, 1);
    assert.equal(report.cases[0].request.subject, subject);
    assert.equal(report.cases[0].teacherReview, null);
    assert.equal(report.productionReady, false);
  }
  assert.throws(() => buildWorkflowAcceptanceCases("unknown"), /subject/);
  await assert.rejects(() => runGenerationAcceptance({}, { subject: "英语", purpose: "comprehensive" }), /purpose/);
});

test("local scoring evidence contains only bounded scoring fields and marks withheld text", () => {
  const candidate = { secret: "PRIVATE", sections: [{ items: [
    { score: 6, rubric: "列式得2分，计算得1分；列式得1分，计算得1分；答句得1分。", prompt: "PRIVATE", apiKey: "PRIVATE" },
    { score: 4, rubric: "满分5分。" }, { score: 4, rubric: "apiKey=PRIVATE" },
    { score: 4, rubric: "x".repeat(3001) }
  ] }] };
  const evidence = collectScoringEvidence(candidate, { itemScores: [6, 4, 4, 4] });
  assert.deepEqual(evidence[0], { index: 1, expectedScore: 6, score: 6, rubric: candidate.sections[0].items[0].rubric,
    evidenceWithheld: false, issues: [] });
  assert.deepEqual(evidence[1].issues, ["rubric_score_conflict"]);
  assert.equal(evidence[2].rubric, null); assert.equal(evidence[2].evidenceWithheld, true);
  assert.equal(evidence[3].rubric, null);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE/);
  assert.deepEqual(collectScoringEvidence({ sections: "bad" }, {}), []);
  assert.deepEqual(collectScoringEvidence({ sections: [null, { items: "bad" }] }, {}), []);
});

test("default acceptance transport retains rejected scoring evidence without extra model attempts", async () => {
  let calls = 0;
  const gateway = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { partition } = JSON.parse(JSON.parse(body).messages[1].content);
    calls++;
    const candidate = { title: "分区草稿", sections: [{ title: partition.title,
      items: partition.itemScores.map((score, i) => ({ itemType: partition.itemTypes[0],
        prompt: `${partition.title}${["甲", "乙", "丙", "丁", "戊", "己"][i]}：计算24+18。`, answer: "42", score,
        rubric: `满分${partition.id === "solution" ? score + 1 : score}分。`,
        analysisSteps: ["24加10得34，再加8得42。"], knowledgePoint: "加法", commonMistake: "注意进位。",
        ...(partition.id === "choice" ? { options: ["A.42", "B.32"] } : {}) })) }] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }], usage: { completion_tokens: 100 } }));
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  try {
    const report = await runGenerationAcceptance({ GPT56_API_KEY: "synthetic", GPT56_BASE_URL: `http://127.0.0.1:${gateway.address().port}` }, { purpose: "comprehensive" });
    const entry = report.cases[0];
    assert.equal(calls, 4);
    assert.equal(entry.scoringEvidence.length, 4);
    const failed = entry.scoringEvidence.find((e) => e.partitionId === "solution");
    assert.ok(failed.items.every((q) => q.score === 6 && q.rubric === "满分7分。" && q.issues.includes("rubric_score_conflict")));
    assert.equal(entry.engineeringPassed, false);
    assert.equal(entry.snapshot, null);
  } finally { gateway.closeAllConnections(); await new Promise((resolve) => gateway.close(resolve)); }
});

async function cliFixture(t, f) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "teaching-acceptance-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const session = path.join(folder, "session.json");
  await writeFile(session, JSON.stringify({ sessionToken: f.tokens.teacher }));
  let index = 0;
  return async (args, body) => {
    const input = path.join(folder, `input-${++index}.json`); await writeFile(input, JSON.stringify(body));
    const { stdout } = await promisify(execFile)(process.execPath, ["scripts/teaching-workflow.mjs", ...args, "--input", input],
      { env: { ...process.env, TEACHING_SESSION_FILE: session, TEACHING_API_BASE_URL: f.baseUrl } });
    return JSON.parse(stdout);
  };
}

test("HTTP upstream failures reach local acceptance as safe diagnostics without retry or publication", async () => {
  let calls = 0;
  const gateway = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* Drain the request without storing prompts. */ }
    calls++;
    res.writeHead(400, { "Content-Type": "application/json", "x-request-id": "req-acceptance-12345", "retry-after": "7" });
    res.end(JSON.stringify({ error: { code: "unsupported_parameter", message: "SECRET https://private.test/key" } }));
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  try {
    const report = await runGenerationAcceptance({ GPT56_API_KEY: "synthetic", GPT56_BASE_URL: `http://127.0.0.1:${gateway.address().port}` }, { purpose: "comprehensive" });
    const entry = report.cases[0];
    assert.equal(calls, 4);
    assert.equal(entry.attempts.length, 4);
    assert.ok(entry.attempts.every((a) => a.upstreamStatus === 400 && a.upstreamCode === "unsupported_parameter" && a.failureCode === "http_error"));
    assert.ok(entry.attempts.every((a) => a.upstreamDiagnostics.requestId === "req-acceptance-12345" &&
      a.upstreamDiagnostics.reasonHint === "unknown" && a.upstreamDiagnostics.retryAfterSeconds === 7 && a.elapsedMs >= 0 && Number.isFinite(Date.parse(a.startedAt))));
    assert.equal(entry.engineeringPassed, false);
    assert.equal(entry.snapshot, null);
    assert.equal(report.persist, false);
    assert.equal(report.productionReady, false);
    assert.doesNotMatch(JSON.stringify(report), /SECRET|private\.test/);
  } finally { gateway.closeAllConnections(); await new Promise((resolve) => gateway.close(resolve)); }
});

test("CLI and Web HTTP independently create, edit and confirm the same generation contract", async (t) => {
  const calls = [];
  const execution = createTeachingWorkflowExecution({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request, contentContext: { approvedOnly: true, matches: [] }, studentSignals: [] } }),
    teachingExecution: { call: async (_route, messages) => { calls.push(messages); return { text: JSON.stringify({ title: "加法专项", sections: [{ title: "计算", items: [
      { itemType: "calculation", prompt: "24+18", answer: "42", score: 5, rubric: "结果正确得5分", analysisSteps: ["24+10=34，再加8得42"], knowledgePoint: "进位加法", commonMistake: "不要漏进位" }
    ] }] }), usage: { completion_tokens: 30 } }; } } });
  const f = await workflowHttpFixture(t, execution); const cli = await cliFixture(t, f);
  const request = { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requirement: "只生成一道进位加法计算题", requestedItemTypes: ["calculation"], requestedItemCount: 1 };
  const fromCli = await cli(["create"], { module: "generation", requestKey: "cli", request });
  const response = await f.request("/workflows", { body: { module: "generation", requestKey: "web", request } });
  assert.equal(response.status, 201); const fromWeb = (await response.json()).workflow;
  assert.deepEqual(fromCli.content, fromWeb.content); assert.equal(calls.length, 2);
  const left = await f.repo.get(fromCli.id, "t1"); const right = await f.repo.get(fromWeb.id, "t1");
  assert.deepEqual(left.snapshot.generationContext.teaching, right.snapshot.generationContext.teaching);
  assert.deepEqual(left.snapshot.generationContext.target, right.snapshot.generationContext.target);
  assert.deepEqual(left.snapshot.ruleVersions, right.snapshot.ruleVersions);
  assert.equal(left.snapshot.ruleVersions[0].hash, (await loadTeachingRulePack("generation")).hash);
  const patch = { type: "replace_question", questionId: "q1", value: { ...fromWeb.content.questions[0], prompt: "25+17" } };
  const edited = await cli(["command", "--id", fromCli.id], { action: "revise", expectedRevision: fromCli.revision, operationKey: "cli-edit", targetQuestionIds: ["q1"], patch });
  const webEdit = (await (await f.request(`/workflows/${fromWeb.id}/commands`, { body: { action: "revise", expectedRevision: fromWeb.revision, operationKey: "web-edit", targetQuestionIds: ["q1"], patch } })).json()).workflow;
  assert.deepEqual(edited.content, webEdit.content);
  const command = { action: "confirm", expectedRevision: edited.revision, operationKey: "confirm", targetQuestionIds: ["q1"] };
  const confirmed = await cli(["command", "--id", fromCli.id], command);
  const webConfirmed = (await (await f.request(`/workflows/${fromWeb.id}/commands`, { body: command })).json()).workflow;
  assert.deepEqual(confirmed.content, webConfirmed.content); assert.equal(confirmed.revision, webConfirmed.revision); assert.equal(calls.length, 2);
});

test("CLI and Web HTTP use the same confirmed mistake evidence and reject changed sources", async (t) => {
  let signals = [{ type: "unresolved_mistake", ref: "mistake:m1", prompt: "24+18", studentAnswer: "32", correctAnswer: "42", cause: "漏进位" }];
  const calls = [];
  const execution = createTeachingWorkflowExecution({
    resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request, contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(signals) } }),
    teachingExecution: { call: async (_route, messages) => { calls.push(messages); return { text: JSON.stringify({ title: "补弱练习", sections: [{ title: "计算", items: [
      { itemType: "calculation", prompt: "35+27", answer: "62", score: 5, rubric: "结果正确得5分", analysisSteps: ["先算35+20", "再加7"], knowledgePoint: "进位加法", commonMistake: "注意进位" }
    ] }] }), usage: { completion_tokens: 30 } }; } }
  });
  const f = await workflowHttpFixture(t, execution); const cli = await cliFixture(t, f);
  const request = { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requirement: "根据近期错题生成一道进位加法补弱题", requestedItemTypes: ["calculation"], requestedItemCount: 1,
    studentSignals: [{ type: "unresolved_mistake", ref: "forged", studentAnswer: "99" }] };
  const fromCli = await cli(["create"], { module: "generation", requestKey: "remediation-cli", request });
  const response = await f.request("/workflows", { body: { module: "generation", requestKey: "remediation-web", request } });
  assert.equal(response.status, 201);
  const fromWeb = (await response.json()).workflow;
  assert.deepEqual(fromCli.content, fromWeb.content);
  const left = await f.repo.get(fromCli.id, "t1"), right = await f.repo.get(fromWeb.id, "t1");
  assert.deepEqual(left.snapshot.generationContext.studentSignals, signals);
  assert.deepEqual(left.snapshot.generationContext.studentSignals, right.snapshot.generationContext.studentSignals);
  assert.deepEqual(left.snapshot.ruleVersions, right.snapshot.ruleVersions);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((messages) => JSON.stringify(messages).includes("mistake:m1") && !JSON.stringify(messages).includes("forged")));

  signals = [{ ...signals[0], correctAnswer: "43" }];
  const command = { action: "confirm", expectedRevision: 2, operationKey: "changed-cli", targetQuestionIds: ["q1"] };
  await assert.rejects(cli(["command", "--id", fromCli.id], command), (error) => {
    assert.equal(JSON.parse(error.stderr).error, "WORKFLOW_EVIDENCE_CHANGED");
    return true;
  });
  const webCommand = await f.request(`/workflows/${fromWeb.id}/commands`, { body: { ...command, operationKey: "changed-web" } });
  assert.equal(webCommand.status, 409);
  assert.equal((await webCommand.json()).error, "WORKFLOW_EVIDENCE_CHANGED");
  assert.equal((await cli(["get", "--id", fromCli.id], {})).revision, 2);
  assert.equal((await (await f.request(`/workflows/${fromWeb.id}`)).json()).workflow.revision, 2);
  assert.equal(calls.length, 2);
});

test("CLI and Web HTTP share grading sums, evidence and confirmation revision", async (t) => {
  const f = await gradingWorkflowFixture(t); const cli = await cliFixture(t, f);
  const left = await cli(["create"], { ...gradingRequest, requestKey: "cli-grade" });
  const right = (await (await f.request("/workflows", { body: { ...gradingRequest, requestKey: "web-grade" } })).json()).workflow;
  assert.deepEqual(left.content, right.content);
  const a = await f.repo.get(left.id, "t1"), b = await f.repo.get(right.id, "t1");
  assert.deepEqual(a.snapshot.archiveEvidence, b.snapshot.archiveEvidence);
  assert.deepEqual(a.snapshot.gradingSourcePackage, b.snapshot.gradingSourcePackage);
  const cmd = { action: "confirm", expectedRevision: left.revision, operationKey: "confirm-clear", targetQuestionIds: ["q2"] };
  const l = await cli(["command", "--id", left.id], cmd);
  const r = (await (await f.request(`/workflows/${right.id}/commands`, { body: cmd })).json()).workflow;
  assert.deepEqual(l.content.gradingSummary, r.content.gradingSummary); assert.equal(l.revision, r.revision);
  assert.equal(l.content.gradingSummary.confirmedScore, null);
});

test("generation acceptance rejects unavailable/fallback output without inventing teacher or PDF approval", async () => {
  for (const failed of [{ modelAvailable: false }, { modelAvailable: true, usedDynamicFallback: true }]) {
    const report = await runGenerationAcceptance({}, { purpose: "focused", generate: async (_env, _input, options) => { assert.equal(options.persist, false); return failed; } });
    assert.equal(report.cases[0].engineeringPassed, false); assert.equal(report.cases[0].teacherReview, null);
    assert.equal(report.cases[0].pdfVerified, false); assert.equal(report.productionReady, false);
  }
});

test("capability probe checks actual response content and records unknown cost without leaking errors", async () => {
  const report = await probeTeachingCapabilities({}, { call: async (args) => {
    assert.equal(args.allowStructuredRetry, false); assert.equal(args.timeoutMs, 30000);
    if (Array.isArray(args.messages[0].content)) return { choices: [{ message: { content: '{"color":"blue"}' } }] };
    if (!args.responseFormat) return { choices: [{ message: { content: "OK" } }] };
    throw new Error("PRIVATE_TOKEN invalid request");
  } });
  assert.equal(report.checks.filter((c) => c.passed).length, 3);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN/); assert.ok(report.checks.every((c) => c.cost === null));
});

test("acceptance records pre-snapshot failure gates when a partial model result falls back", async () => {
  const report = await runGenerationAcceptance({}, { purpose: "comprehensive", generate: async () => ({
    modelAvailable: true, usedDynamicFallback: true, audit: { status: "needs_teacher_review", passed: false },
    modelRun: { metadata: { partialGeneration: true } }
  }) });
  const entry = report.cases[0];
  assert.equal(entry.failure, "WORKFLOW_SNAPSHOT_INVALID");
  assert.deepEqual(entry.failureGates, ["partial_generation", "dynamic_fallback", "audit_not_passed"]);
  assert.equal(entry.rawContract.partialGeneration, true);
  assert.equal(entry.snapshot, null);
  assert.equal(entry.engineeringPassed, false);
});

test("comprehensive acceptance traces a rejected scoring partition through the real service without passing fallback", async () => {
  const report = await runGenerationAcceptance({}, { purpose: "comprehensive", generate: async (config, input, options) =>
    draftAssessmentService(config, input, { ...options, teachingExecution: { call: async (_route, messages) => {
      const { partition } = JSON.parse(messages[1].content);
      return { text: JSON.stringify({ title: "综合分值回归", sections: [{ title: partition.title, items: partition.itemScores.map((score, i) => ({
        itemType: partition.itemTypes[0], prompt: `${partition.title}${["甲", "乙", "丙", "丁", "戊", "己"][i]}：计算24+18。`, answer: "42",
        score, rubric: `本题满分${partition.id === "solution" ? score + 1 : score}分。`,
        analysisSteps: ["24加10得34，再加8得42。"], knowledgePoint: "进位加法", commonMistake: "注意进位。",
        ...(partition.id === "choice" ? { options: ["A.42", "B.32"] } : {})
      })) }] }), usage: { completion_tokens: 100 } };
    } } }) });
  const entry = report.cases[0];
  assert.equal(entry.attempts.length, 4);
  assert.equal(entry.attempts.filter((attempt) => attempt.status === "SUCCESS").length, 3);
  assert.deepEqual(entry.attempts.find((attempt) => attempt.partitionId === "solution").validationIssueCodes, ["rubric_score_conflict"]);
  assert.equal(entry.failure, "WORKFLOW_SNAPSHOT_INVALID");
  assert.deepEqual(entry.failureGates, ["partial_generation", "dynamic_fallback", "audit_not_passed"]);
  assert.equal(entry.engineeringPassed, false);
  assert.equal(entry.snapshot, null);
  assert.equal(report.persist, false);
  assert.equal(report.executionMode, "synthetic");
});
