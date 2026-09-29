import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import test, { before, after } from "node:test";
import { createTeachingWorkflowRepository } from "./teaching-workflow-repository.js";
import { createTeachingWorkflowAssignmentRepository } from "./teaching-workflow-assignment-repository.js";
import { createTeachingWorkflowArchiveRepository } from "./teaching-workflow-archive-repository.js";
import { createTeachingWorkflowAssignmentService } from "../../services/src/teaching-workflow-assignment.js";
import { createTeachingWorkflowArchiveService } from "../../services/src/teaching-workflow-publication.js";
import { createTeachingWorkflowValidator } from "../../services/src/teaching-workflow-validation.js";
import { selectCurrentTeachingEvidence } from "../../services/src/teaching-workflow-archive.js";
import { createTeachingWorkflowArchiveResolvers } from "../../../apps/api/src/teaching-workflow-archive-resolvers.js";
import { createTeachingAssignmentTargetAuthorizer } from "../../../apps/api/src/teaching-workflow-generation-resolver.js";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

const enabled = process.env.RUN_WORKFLOW_POSTGRES_TESTS === "1";
const schemaName = `jh_publication_test_${randomUUID().replaceAll("-", "")}`;
const testDir = path.resolve("tmp", schemaName);
let admin, db, repo, resolvers, assignmentService, archiveService;
const actor = { teacherId: "t1" };
const validateGeneration = createTeachingWorkflowValidator();
const caseTest = (name, fn) => test(name, { skip: !enabled, timeout: 30000 }, fn);

before(async () => {
  if (!enabled) return;
  assert.ok(process.env.DATABASE_URL, "run via scripts/run-with-env.mjs");
  assert.match(schemaName, /^jh_publication_test_[a-f0-9]{32}$/);
  fs.mkdirSync(testDir, { recursive: true });
  const url = new URL(process.env.DATABASE_URL);
  assert.notEqual(url.searchParams.get("schema"), schemaName);
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("connection_limit", "6");
  const clientDir = path.join(testDir, "client");
  const schemaFile = path.join(testDir, "schema.prisma");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
    .replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientDir.replaceAll("\\", "/"))}`);
  fs.writeFileSync(schemaFile, schema, "utf8");
  const runPrisma = (args) => {
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args, "--schema", schemaFile], {
      env: { ...process.env, DATABASE_URL: url.href }, encoding: "utf8", timeout: 60000, windowsHide: true
    });
    assert.equal(result.status, 0, `isolated Prisma ${args[0]} failed: ${(result.stderr || "").replaceAll(url.href, "[isolated database]").replaceAll(process.env.DATABASE_URL, "[database]")}`);
  };
  runPrisma(["generate"]);
  const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, "index.js")));
  admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  // Push only to the just-created, random empty schema. No reset or production migration.
  runPrisma(["db", "push", "--skip-generate"]);
  db = new PrismaClient({ datasources: { db: { url: url.href } } });
  assert.equal((await db.$queryRaw`SELECT current_schema() AS schema`)[0].schema, schemaName);
  await db.teacher.createMany({ data: [{ id: "t1", name: "Synthetic teacher" }, { id: "t2", name: "Other synthetic teacher" }] });
  await db.subject.create({ data: { code: "math", name: "数学" } });
  repo = createTeachingWorkflowRepository(db);
  resolvers = createTeachingWorkflowArchiveResolvers({ prisma: db });
  assignmentService = createTeachingWorkflowAssignmentService({ repository: createTeachingWorkflowAssignmentRepository(db),
    authorizeTarget: createTeachingAssignmentTargetAuthorizer({ authorizeStudent: resolvers.authorizeStudent }), validateSnapshot: validateGeneration });
  archiveService = createTeachingWorkflowArchiveService({ repository: createTeachingWorkflowArchiveRepository(db),
    authorizeStudent: resolvers.authorizeStudent, resolveArchiveEvidence: resolvers.resolveArchiveEvidence });
  console.log(`Full current schema initialized only in ${schemaName}; all identities and work are synthetic.`);
}, { timeout: 150000 });

after(async () => {
  await db?.$disconnect();
  if (admin) {
    try {
      assert.match(schemaName, /^jh_publication_test_[a-f0-9]{32}$/);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      assert.equal((await admin.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1", schemaName)).length, 0);
      fs.writeFileSync(path.join(testDir, "boundary.json"), JSON.stringify({ schemaName, testSchemaRemoved: true,
        isolation: "random schema on existing server", productionMigrationApplied: false, syntheticDataOnly: true, modelCalls: 0 }, null, 2), "utf8");
      console.log(`Verified removal of ${schemaName}; production persistence setting unchanged.`);
    } finally { await admin.$disconnect(); }
  }
});

async function generationFixture(t, { confirm = true } = {}) {
  const student = await db.student.create({ data: { displayName: "Synthetic student", grade: "四年级", responsibleTeacherId: "t1" } });
  const request = { subject: "数学", grade: "四年级", studentId: student.id, kind: "练习", purpose: "focused", requestedItemCount: 1, requirement: "一题减法" };
  const http = await workflowHttpFixture(t, { repository: repo, assignmentService, validateSnapshot: validateGeneration,
    createDraft: async () => ({ snapshot: { title: "隔离减法样本", ...request, questions: [{ id: "q1", questionNo: "1", itemType: "calculation",
      prompt: "3-3", answer: "0", score: 5, rubric: "计算过程4分；结果1分。", analysisSteps: ["相同两数相减得0。"], knowledgePoint: "减法", commonMistake: "零也是答案。" }] } }) });
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  let workflow = await client.create({ module: "generation", requestKey: randomUUID(), request });
  if (confirm) workflow = await client.execute(workflow.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: workflow.revision, targetQuestionIds: ["q1"] });
  return { student, http, client, workflow, publish: () => client.assignment(workflow.id, { expectedRevision: workflow.revision }) };
}

async function gradingFixture(t, { confirm = true } = {}) {
  const generation = await generationFixture(t);
  const published = await generation.publish();
  const assignment = await db.assignment.findUnique({ where: { id: published.id }, include: { items: true, subject: true } });
  const submission = await db.submission.create({ data: { studentId: generation.student.id, assignmentId: assignment.id,
    content: { ocr: { questions: [{ questionNo: "1", studentAnswer: "1", confidence: null, observedWork: null }] } } } });
  const request = { studentId: generation.student.id, submissionId: submission.id, assignmentId: assignment.id };
  const context = await resolvers.resolveGradingContext({ actor, request });
  assert.equal(context.ok, true);
  const validateSnapshot = createTeachingWorkflowValidator({ resolveGradingSource: async () => context.sourcePackage });
  const http = await workflowHttpFixture(t, { repository: repo, archiveService, validateSnapshot,
    createDraft: async () => ({ snapshot: { archiveEvidence: context.archiveEvidence, gradingSourcePackage: context.sourcePackage,
      questions: [{ id: "q1", questionNo: "1", itemType: "calculation", printedPrompt: "3-3", studentAnswer: "1", correctAnswer: "0",
        maxScore: 5, score: 0, status: "wrong", explanation: "相同两数相减得0。", knowledgePoint: "减法", confidence: null, observedWork: null }] } }) });
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  let workflow = await client.create({ module: "grading", requestKey: randomUUID(), request });
  if (confirm) workflow = await client.execute(workflow.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: workflow.revision, targetQuestionIds: ["q1"] });
  return { ...generation, assignment, submission, request, context, http, client, workflow,
    publish: () => client.archive(workflow.id, { expectedRevision: workflow.revision }) };
}

const readAssignment = (id) => db.assignment.findUnique({ where: { id }, include: { items: { orderBy: { orderIndex: "asc" } }, subject: true } });
const archiveCount = (studentId) => db.submission.count({ where: { studentId, status: "GRADED" } });

caseTest("real HTTP publication serializes concurrent requests and replays immutable Assignment and source", async (t) => {
  const f = await generationFixture(t);
  const revision = await repo.getRevision(f.workflow.id, f.workflow.revision, "t1");
  const pair = await Promise.all([f.publish(), f.publish()]);
  assert.equal(pair[0].id, pair[1].id);
  assert.deepEqual(pair.map((r) => r.replayed).sort(), [false, true]);
  const saved = await readAssignment(pair[0].id);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.metadata.gradingSourcePackage.sourceId, saved.id);
  assert.equal(saved.metadata.workflowPublication.teacherId, "t1");
  assert.equal(saved.metadata.generationPipeline.gates.finalExportAllowed, false);
  assert.equal(await assignmentService.verify({ actor, assignment: saved }), true);
  assert.equal((await f.publish()).replayed, true);
  assert.deepEqual(await repo.getRevision(f.workflow.id, f.workflow.revision, "t1"), revision);
  assert.equal(await db.assignment.count({ where: { metadata: { path: ["workflowPublication", "workflowId"], equals: f.workflow.id } } }), 1);
});

caseTest("real publication rejects unconfirmed, foreign, inactive, stale and cancelled work", async (t) => {
  const f = await generationFixture(t, { confirm: false });
  await assert.rejects(f.publish(), { code: "WORKFLOW_CONFIRMATION_REQUIRED" });
  assert.equal((await f.http.request(`/workflows/${f.workflow.id}/assignment`, { token: f.http.tokens.other, body: { expectedRevision: f.workflow.revision } })).status, 404);
  const confirmed = await f.client.execute(f.workflow.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: f.workflow.revision, targetQuestionIds: ["q1"] });
  await assert.rejects(f.publish(), { code: "WORKFLOW_VERSION_CONFLICT" });
  await db.student.update({ where: { id: f.student.id }, data: { enrollmentStatus: "WITHDRAWN" } });
  await assert.rejects(f.client.assignment(f.workflow.id, { expectedRevision: confirmed.revision }), { code: "WORKFLOW_FORBIDDEN" });
  await db.student.update({ where: { id: f.student.id }, data: { enrollmentStatus: "ACTIVE" } });
  await db.teachingWorkflow.update({ where: { id: f.workflow.id }, data: { status: "cancelled" } });
  await assert.rejects(f.client.assignment(f.workflow.id, { expectedRevision: confirmed.revision }), { code: "WORKFLOW_VERSION_CONFLICT" });
  assert.equal(await db.assignment.count({ where: { metadata: { path: ["workflowPublication", "workflowId"], equals: f.workflow.id } } }), 0);
});

caseTest("database error during nested AssignmentItem write rolls back Assignment and keeps the revision", async (t) => {
  const f = await generationFixture(t);
  const before = await repo.get(f.workflow.id, "t1");
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_item_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ITEM_INSERT_FAILURE'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_item_insert BEFORE INSERT ON "AssignmentItem" FOR EACH ROW EXECUTE FUNCTION fail_item_insert()`);
  try {
    await assert.rejects(assignmentService.publish({ actor, workflowId: f.workflow.id, expectedRevision: f.workflow.revision }), /TEST_ITEM_INSERT_FAILURE/);
    assert.equal(await db.assignment.count({ where: { metadata: { path: ["workflowPublication", "workflowId"], equals: f.workflow.id } } }), 0);
    assert.deepEqual(await repo.get(f.workflow.id, "t1"), before);
  } finally { await db.$executeRawUnsafe(`DROP TRIGGER fail_item_insert ON "AssignmentItem"`); }
  assert.equal((await f.publish()).replayed, false);
});

caseTest("real HTTP archive atomically stores Submission, GradingResult and mistakes once", async (t) => {
  const f = await gradingFixture(t);
  const sourceBefore = await db.submission.findUnique({ where: { id: f.submission.id } });
  const results = await Promise.all([f.publish(), f.publish()]);
  assert.equal(results[0].id, results[1].id);
  assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  const saved = await db.submission.findUnique({ where: { id: results[0].id }, include: { grading: true } });
  assert.equal(saved.grading.score, 0);
  assert.equal(saved.grading.needsReview, false);
  assert.equal(saved.content.workflowArchive.revision, f.workflow.revision);
  assert.equal(saved.grading.result.questions[0].confidence, null);
  assert.equal(await archiveCount(f.student.id), 1);
  assert.equal(await db.mistakeRecord.count({ where: { studentId: f.student.id } }), 1);
  assert.equal((await f.publish()).replayed, true);
  assert.deepEqual(await db.submission.findUnique({ where: { id: f.submission.id } }), sourceBefore);
});

caseTest("real archive rejects unconfirmed work, foreign teachers and changed submission evidence", async (t) => {
  const f = await gradingFixture(t, { confirm: false });
  await assert.rejects(f.publish(), { code: "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED" });
  assert.equal((await f.http.request(`/workflows/${f.workflow.id}/archive`, { token: f.http.tokens.other, body: { expectedRevision: f.workflow.revision } })).status, 404);
  const confirmed = await f.client.execute(f.workflow.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: f.workflow.revision, targetQuestionIds: ["q1"] });
  await db.submission.update({ where: { id: f.submission.id }, data: { content: { changedEvidence: true } } });
  await assert.rejects(f.client.archive(f.workflow.id, { expectedRevision: confirmed.revision }), { code: "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED" });
  assert.equal(await archiveCount(f.student.id), 0);
  assert.equal(await db.mistakeRecord.count({ where: { studentId: f.student.id } }), 0);
});

caseTest("real mistake insert failure rolls back the previously inserted Submission and GradingResult", async (t) => {
  const f = await gradingFixture(t);
  const before = await repo.get(f.workflow.id, "t1");
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_mistake_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "GradingResult" g ON g."submissionId" = s.id WHERE s.id = NEW.metadata->>'sourceSubmissionId') THEN
      RAISE EXCEPTION 'TEST_EXPECTED_PRIOR_ROWS_MISSING';
    END IF;
    RAISE EXCEPTION 'TEST_MISTAKE_INSERT_AFTER_GRADING_FAILURE'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_mistake_insert BEFORE INSERT ON "MistakeRecord" FOR EACH ROW EXECUTE FUNCTION fail_mistake_insert()`);
  try {
    await assert.rejects(archiveService.publish({ actor, workflowId: f.workflow.id, expectedRevision: f.workflow.revision }), /TEST_MISTAKE_INSERT_AFTER_GRADING_FAILURE/);
    assert.equal(await archiveCount(f.student.id), 0);
    assert.equal(await db.gradingResult.count({ where: { submission: { studentId: f.student.id } } }), 0);
    assert.equal(await db.mistakeRecord.count({ where: { studentId: f.student.id } }), 0);
    assert.deepEqual(await repo.get(f.workflow.id, "t1"), before);
  } finally { await db.$executeRawUnsafe(`DROP TRIGGER fail_mistake_insert ON "MistakeRecord"`); }
  assert.equal((await f.publish()).replayed, false);
});

caseTest("new confirmed zero-mistake archive supersedes old evidence without rewriting history", async (t) => {
  const f = await gradingFixture(t);
  const first = await f.publish();
  const old = await db.submission.findUnique({ where: { id: first.id }, include: { grading: true } });
  const next = structuredClone(f.workflow.content.questions[0]);
  next.score = 5; next.status = "correct"; next.explanation = "Synthetic teacher score correction.";
  const edited = await f.client.execute(f.workflow.id, { action: "revise", operationKey: randomUUID(), expectedRevision: f.workflow.revision,
    targetQuestionIds: ["q1"], patch: { type: "replace_question", questionId: "q1", value: next } });
  await assert.rejects(f.client.archive(f.workflow.id, { expectedRevision: edited.revision }), { code: "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED" });
  const confirmed = await f.client.execute(f.workflow.id, { action: "confirm", operationKey: randomUUID(), expectedRevision: edited.revision, targetQuestionIds: ["q1"] });
  const second = await f.client.archive(f.workflow.id, { expectedRevision: confirmed.revision });
  assert.notEqual(first.id, second.id);
  const newer = await db.submission.findUnique({ where: { id: second.id }, include: { grading: true } });
  assert.deepEqual(newer.content.workflowArchive.supersedesArchiveIds, [first.id]);
  assert.deepEqual(await db.submission.findUnique({ where: { id: first.id }, include: { grading: true } }), old);
  const selected = selectCurrentTeachingEvidence({ id: f.student.id,
    submissions: [old, newer], mistakes: await db.mistakeRecord.findMany({ where: { studentId: f.student.id } }) });
  assert.deepEqual(selected.submissions.map((s) => s.id), [second.id]);
  assert.equal(selected.mistakes.length, 0);
  assert.equal((await f.publish()).replayed, true);
  assert.equal(await archiveCount(f.student.id), 2);
});

caseTest("saved publication remains readable after withdrawal but replay still enforces current teacher scope", async (t) => {
  const f = await generationFixture(t);
  const first = await f.publish();
  await db.student.update({ where: { id: f.student.id }, data: { enrollmentStatus: "WITHDRAWN" } });
  assert.equal((await f.publish()).id, first.id);
  await db.student.update({ where: { id: f.student.id }, data: { responsibleTeacherId: "t2" } });
  await assert.rejects(f.publish(), { code: "WORKFLOW_FORBIDDEN" });
  assert.equal((await readAssignment(first.id)).metadata.workflowPublication.teacherId, "t1");
});

caseTest("real publication replay and export verification reject tampered stored question content", async (t) => {
  const f = await generationFixture(t);
  const published = await f.publish();
  const original = await readAssignment(published.id);
  await db.assignmentItem.update({ where: { id: original.items[0].id }, data: { prompt: "Tampered synthetic prompt" } });
  await assert.rejects(f.publish(), { code: "WORKFLOW_ASSIGNMENT_INVALID" });
  await assert.rejects(assignmentService.verify({ actor, assignment: original }), { code: "WORKFLOW_ASSIGNMENT_INVALID" });
});

caseTest("real archive replay rejects revoked ownership and tampered saved grading", async (t) => {
  const f = await gradingFixture(t);
  const published = await f.publish();
  await db.student.update({ where: { id: f.student.id }, data: { responsibleTeacherId: "t2" } });
  await assert.rejects(f.publish(), { code: "WORKFLOW_FORBIDDEN" });
  await db.student.update({ where: { id: f.student.id }, data: { responsibleTeacherId: "t1" } });
  await db.gradingResult.update({ where: { submissionId: published.id }, data: { score: 5 } });
  await assert.rejects(f.publish(), { code: "WORKFLOW_ARCHIVE_INVALID" });
  assert.equal(await archiveCount(f.student.id), 1);
  assert.equal(await db.mistakeRecord.count({ where: { studentId: f.student.id } }), 1);
});

caseTest("publication and a concurrent revision serialize on the same real workflow row", async (t) => {
  const f = await generationFixture(t);
  const original = await repo.get(f.workflow.id, "t1");
  let release, locked;
  const gate = new Promise((resolve) => { release = resolve; });
  const acquired = new Promise((resolve) => { locked = resolve; });
  const authorize = createTeachingAssignmentTargetAuthorizer({ authorizeStudent: resolvers.authorizeStudent });
  const publishing = createTeachingWorkflowAssignmentService({ repository: createTeachingWorkflowAssignmentRepository(db), validateSnapshot: validateGeneration,
    authorizeTarget: async (context) => { locked(); await gate; return authorize(context); } }).publish({ actor, workflowId: f.workflow.id, expectedRevision: f.workflow.revision });
  // Observe lock acquisition before sending a competing real repository transaction.
  await acquired;
  const snapshot = structuredClone(original.snapshot);
  snapshot.questions[0].commonMistake = "New revision only";
  const edit = repo.commitRevision({ workflowId: f.workflow.id, ownerTeacherId: "t1", expectedRevision: f.workflow.revision,
    operationKey: randomUUID(), operation: "revise", snapshot });
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const rows = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%TeachingWorkflow%' AND query LIKE '%UPDATE%'
          AND query LIKE ${`%${schemaName}%`}`;
      waiting = rows[0].count > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, "the competing workflow update must actually wait on the publication lock");
  } finally { release(); }
  const [published, revision] = await Promise.all([publishing, edit]);
  assert.equal(revision.revision, f.workflow.revision + 1);
  assert.equal((await readAssignment(published.assignmentId)).items[0].metadata.commonMistake, "零也是答案。");
  assert.equal((await repo.get(f.workflow.id, "t1")).snapshot.questions[0].commonMistake, "New revision only");
  assert.equal((await f.publish()).id, published.assignmentId);
});
