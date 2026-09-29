import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import test, { before, after } from "node:test";
import { createTeachingWorkflowRepository } from "./teaching-workflow-repository.js";
import { createTeachingWorkflowExecution } from "../../../apps/api/src/teaching-workflow-execution.js";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";
import { buildGradingSourcePackage } from "@junhang/core";

const schemaName = `jh_workflow_test_${randomUUID().replaceAll("-", "")}`;
const testDir = path.resolve("tmp", schemaName);
const integrationEnabled = process.env.RUN_WORKFLOW_POSTGRES_TESTS === "1";
let admin; let prisma; let repo;
before(async () => {
  if (!integrationEnabled) return;
  if (!process.env.DATABASE_URL) throw new Error("Run with: node scripts/run-with-env.mjs node --test packages/db/src/teaching-workflow-repository.test.mjs");
  fs.mkdirSync(testDir, { recursive: true });
  const clientDir = path.join(testDir, "client").replaceAll("\\", "/");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8").replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientDir)}`);
  fs.writeFileSync(path.join(testDir, "schema.prisma"), schema, "utf8");
  const generated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", path.join(testDir, "schema.prisma")], { encoding: "utf8", timeout: 60000, windowsHide: true });
  assert.equal(generated.status, 0, `isolated Prisma client generation failed: ${generated.error?.message || generated.stderr}`);
  const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, "index.js")));
  admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("connection_limit", "4");
  prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const sql = fs.readFileSync(new URL("../prisma/migrations/202609110001_teaching_workflows/migration.sql", import.meta.url), "utf8");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}"`);
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  });
  repo = createTeachingWorkflowRepository(prisma);
  console.log(`Applied additive migration to isolated PostgreSQL schema ${schemaName}`);
}, { timeout: 90000 });
after(async () => {
  await prisma?.$disconnect();
  if (admin && /^jh_workflow_test_[a-f0-9]{32}$/.test(schemaName)) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const remaining = await admin.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', schemaName);
    assert.equal(remaining.length, 0, "the integration test schema must be removed");
    await admin.$disconnect();
  }
});
const create = (extra = {}) => repo.create({ ownerTeacherId: "teacher-a", module: "generation", requestKey: randomUUID(), request: { requirement: "合成请求" }, snapshot: { questions: [{ id: "q1", prompt: "2+3", answer: "5" }] }, ...extra });
const cmd = (head, extra = {}) => ({ workflowId: head.id, ownerTeacherId: "teacher-a", expectedRevision: head.currentRevision, operationKey: randomUUID(), operation: "revise", snapshot: { questions: [{ id: "q1", prompt: "3+3", answer: "6" }] }, ...extra });

test("create deduplicates concurrent requests and stores the initial immutable revision", { skip: !integrationEnabled }, async () => {
  const requestKey = randomUUID();
  const [a, b] = await Promise.all([create({ requestKey }), create({ requestKey })]);
  assert.equal(a.id, b.id);
  assert.equal((await repo.getRevision(a.id, 1, "teacher-a")).snapshot.questions[0].answer, "5");
  await assert.rejects(create({ requestKey, request: { changed: true } }), /WORKFLOW_REQUEST_KEY_REUSED/);
});

test("real concurrent creation reservations have one owner of execution and an immutable placeholder", { skip: !integrationEnabled }, async () => {
  const request = { ownerTeacherId: "teacher-a", module: "generation", requestKey: randomUUID(), request: { requirement: "addition" } };
  const results = await Promise.all([repo.reserveCreation(request), repo.reserveCreation(request)]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results[0].workflow.id, results[1].workflow.id);
  const head = results[0].workflow;
  assert.equal((await repo.getRevision(head.id, 1, "teacher-a")).snapshot.creationPending, true);
  assert.equal(await prisma.teachingWorkflowRevision.count({ where: { workflowId: head.id } }), 1);
  const op = { workflowId: head.id, ownerTeacherId: "teacher-a", expectedRevision: 1, operationKey: `create:${request.requestKey}` };
  await repo.beginOperation({ ...op, initialCreation: true });
  await repo.commitRevision({ ...op, operation: "create", commandFingerprint: "synthetic-test-fingerprint", subjectRef: "class-1", snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2" }] } });
  const retry = await repo.reserveCreation(request);
  assert.equal(retry.created, false); assert.equal(retry.workflow.currentRevision, 2);
  assert.equal(retry.workflow.subjectRef, "class-1");
  await assert.rejects(repo.reserveCreation({ ...request, request: { requirement: "changed" } }), /WORKFLOW_REQUEST_KEY_REUSED/);
});
test("two real concurrent CAS transactions produce one winner with no orphan revision", { skip: !integrationEnabled }, async () => {
  const head = await create();
  const outcomes = await Promise.allSettled([repo.commitRevision(cmd(head)), repo.commitRevision(cmd(head))]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((r) => r.status === "rejected").reason.code, "WORKFLOW_VERSION_CONFLICT");
  assert.equal((await repo.get(head.id, "teacher-a")).currentRevision, 2);
  assert.equal(await prisma.teachingWorkflowRevision.count({ where: { workflowId: head.id } }), 2);
});
test("concurrent replay returns the same revision; same key with different command conflicts", { skip: !integrationEnabled }, async () => {
  const head = await create(); const input = cmd(head);
  const [a, b] = await Promise.all([repo.commitRevision(input), repo.commitRevision(input)]);
  assert.equal(a.id, b.id);
  assert.equal((await repo.commitRevision({ ...input, snapshot: { questions: [{ answer: "6", prompt: "3+3", id: "q1" }] } })).id, a.id);
  for (const patch of [{ snapshot: {} }, { operation: "restore" }, { expectedRevision: 2 }]) await assert.rejects(repo.commitRevision({ ...input, ...patch }), /WORKFLOW_OPERATION_KEY_REUSED/);
});
test("owner scope applies to current, historical, duplicate, checkpoint and mutation access", { skip: !integrationEnabled }, async () => {
  const head = await create(); const input = cmd(head); await repo.commitRevision(input);
  assert.equal(await repo.get(head.id, "teacher-b"), null);
  assert.equal(await repo.getRevision(head.id, 1, "teacher-b"), null);
  await assert.rejects(repo.commitRevision({ ...input, ownerTeacherId: "teacher-b" }), /WORKFLOW_NOT_FOUND/);
  await assert.rejects(repo.beginOperation(cmd({ ...head, currentRevision: 2 }, { ownerTeacherId: "teacher-b" })), /WORKFLOW_NOT_FOUND/);
  assert.equal((await repo.cancel({ workflowId: head.id, ownerTeacherId: "teacher-b" })).count, 0);
});
test("restoring an old snapshot appends history without changing the old revision", { skip: !integrationEnabled }, async () => {
  const head = await create(); const old = await repo.getRevision(head.id, 1, "teacher-a");
  await repo.commitRevision(cmd(head));
  const restored = await repo.commitRevision(cmd({ ...head, currentRevision: 2 }, { operation: "restore", snapshot: old.snapshot }));
  assert.equal(restored.revision, 3); assert.deepEqual(restored.snapshot, old.snapshot);
  assert.equal((await repo.getRevision(head.id, 2, "teacher-a")).snapshot.questions[0].answer, "6");
});
test("revision insert failure rolls the head CAS back", { skip: !integrationEnabled }, async () => {
  const head = await create();
  const db = { $transaction: (run) => prisma.$transaction((tx) => run({ ...tx, teachingWorkflowRevision: { findUnique: tx.teachingWorkflowRevision.findUnique.bind(tx.teachingWorkflowRevision), create: async () => { throw new Error("injected insert failure"); } } })) };
  await assert.rejects(createTeachingWorkflowRepository(db).commitRevision(cmd(head)), /injected insert failure/);
  assert.equal((await repo.get(head.id, "teacher-a")).currentRevision, 1);
  assert.equal(await prisma.teachingWorkflowRevision.count({ where: { workflowId: head.id } }), 1);
});
test("parallel checkpoint merges preserve both units and cancellation fences late writes", { skip: !integrationEnabled }, async () => {
  const head = await create(); const input = cmd(head);
  await repo.beginOperation(input);
  await Promise.all(["unit-a", "unit-b"].map((unitId) => repo.saveCheckpoint({ ...input, unitId, candidate: { title: unitId } })));
  assert.deepEqual(Object.keys((await repo.get(head.id, "teacher-a")).checkpoint.units).sort(), ["unit-a", "unit-b"]);
  await assert.rejects(repo.saveCheckpoint({ ...input, unitId: "unit-a", candidate: { title: "changed" } }), /WORKFLOW_CHECKPOINT_UNIT_CONFLICT/);
  await repo.cancel(input);
  await assert.rejects(repo.saveCheckpoint({ ...input, unitId: "late", candidate: {} }), /WORKFLOW_CHECKPOINT_STALE/);
  await assert.rejects(repo.commitRevision(input), /WORKFLOW_VERSION_CONFLICT/);
  assert.equal((await repo.get(head.id, "teacher-a")).checkpoint.units["unit-a"].title, "unit-a");
});
test("restart preserves checkpoints and a new operation fences the previous execution", { skip: !integrationEnabled }, async () => {
  const head = await create(); const input = cmd(head); await repo.beginOperation(input);
  await repo.saveCheckpoint({ ...input, unitId: "done", candidate: { value: "kept" } });
  await repo.markInterrupted();
  const recovered = await repo.get(head.id, "teacher-a");
  assert.equal(recovered.status, "interrupted"); assert.equal(recovered.checkpoint.units.done.value, "kept");
  const next = cmd(recovered); await repo.beginOperation(next);
  await assert.rejects(repo.saveCheckpoint({ ...input, unitId: "late", candidate: {} }), /WORKFLOW_CHECKPOINT_STALE/);
  await assert.rejects(repo.commitRevision(input), /WORKFLOW_VERSION_CONFLICT/);
  await repo.commitRevision(next);
});

test("HTTP and dialogue client share real persisted generation revisions across reload, replay and confirmation", { skip: !integrationEnabled }, async (t) => {
  let calls = 0;
  const execution = createTeachingWorkflowExecution({ resolveGenerationInput: async ({ request }) => ({ ok: true,
    input: { ...request, contentContext: { approvedOnly: true, matches: [] }, studentSignals: [] } }),
    teachingExecution: { call: async () => { calls++; return { text: JSON.stringify({ title: "隔离加法样本", sections: [{ title: "计算", items: [
      { itemType: "calculation", prompt: "24+18", answer: "42", score: 5, rubric: "计算得4分；结果得1分。",
        analysisSteps: ["先加10得34", "再加8得42"], knowledgePoint: "加法", commonMistake: "注意进位" }
    ] }] }) }; } } });
  const http = await workflowHttpFixture(t, { ...execution, repository: repo });
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  const first = await client.create({ module: "generation", requestKey: randomUUID(), request: { subject: "数学", grade: "四年级", kind: "练习",
    purpose: "focused", requirement: "一题进位加法", requestedItemTypes: ["calculation"], requestedItemCount: 1 } });
  assert.equal(first.status, "ready_for_review"); assert.equal(first.revision, 2);
  const command = { action: "revise", operationKey: randomUUID(), expectedRevision: first.revision, targetQuestionIds: ["q1"],
    patch: { type: "replace_question", questionId: "q1", value: { ...first.content.questions[0], commonMistake: "个位相加满十要进位" } } };
  const response = await http.request(`/workflows/${first.id}/commands`, { body: command });
  assert.equal(response.status, 200);
  const edited = (await response.json()).workflow;
  assert.deepEqual(await client.execute(first.id, command), edited);
  const second = await workflowHttpFixture(t, { ...execution, repository: createTeachingWorkflowRepository(prisma) });
  const reloaded = await second.request(`/workflows/${first.id}`);
  assert.deepEqual((await reloaded.json()).workflow, edited);
  assert.equal((await second.request(`/workflows/${first.id}`, { token: second.tokens.other })).status, 404);
  const confirmed = await client.execute(first.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: edited.revision, targetQuestionIds: ["q1"] });
  assert.equal(confirmed.content.questions[0].reviewedByTeacher, true);
  assert.equal((await client.getRevision(first.id, 2)).content.questions[0].commonMistake, "注意进位");
  assert.equal(await prisma.teachingWorkflowRevision.count({ where: { workflowId: first.id } }), 4);
  assert.equal(calls, 1, "no model calls for manual edit, replay, reload or confirmation");
});

test("real persisted grading retains unknown OCR evidence through teacher correction without auto-confirming", { skip: !integrationEnabled }, async (t) => {
  const sourcePackage = buildGradingSourcePackage({ id: "isolated-choice", grade: "四年级", subject: { name: "数学" }, items: [
    { orderIndex: 6, prompt: "选出正确结果。", answer: "C", score: 2, rubric: "按结构、过程与结果综合判分。", knowledgePoint: "乘法分配律",
      sourceContext: { itemType: "choice", options: ["A.6400", "B.9000", "C.10000", "D.10100"] } }
  ] }).package;
  let calls = 0;
  const execution = createTeachingWorkflowExecution({ resolveGradingContext: async () => ({ ok: true, subject: "数学", sourcePackage,
    archiveEvidence: { fingerprint: "isolated-evidence", sourceFingerprint: sourcePackage.fingerprint },
    submission: { content: { ocr: { questions: [{ questionNo: "6", studentAnswer: "D", confidence: null, bbox: null, observedWork: null }] } } } }),
    teachingExecution: { call: async () => { calls++; return { text: JSON.stringify({ questionResults: [
      { questionNo: "6", status: "uncertain", score: null, maxScore: 2, studentAnswer: "D", correctAnswer: "C", confidence: 0.4, explanation: "识别待教师核对。" }
    ] }) }; } } });
  const http = await workflowHttpFixture(t, { ...execution, repository: repo });
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  const first = await client.create({ module: "grading", requestKey: randomUUID(), request: { studentId: "isolated-student", submissionId: "isolated-submission" } });
  const next = await client.execute(first.id, { action: "revise", operationKey: randomUUID(), expectedRevision: first.revision,
    targetQuestionIds: ["q1"], patch: { type: "correct_recognition", questionId: "q1", value: { studentAnswer: "D" } } });
  assert.equal(next.content.questions[0].score, 0);
  assert.equal(next.content.questions[0].confidence, null);
  assert.equal(next.content.gradingSummary.confirmedScore, null);
  const persisted = await createTeachingWorkflowRepository(prisma).get(first.id, "t1");
  assert.equal(persisted.snapshot.questions[0].observedWork, null);
  assert.equal(persisted.snapshot.questions[0].bbox, null);
  assert.equal(persisted.snapshot.questions[0].studentAnswerReview.actorTeacherId, "t1");
  assert.equal((await client.getRevision(first.id, 2)).content.questions[0].score, null);
  assert.equal(calls, 1);
});
