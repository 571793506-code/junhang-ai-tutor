import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import test, { before, after } from "node:test";
import { createTeachingWorkflowRepository } from "./teaching-workflow-repository.js";

const enabled = process.env.RUN_WORKFLOW_POSTGRES_TESTS === "1";
// Freeze the actual pre-workflow schema, independent of future HEAD changes.
// This rehearses the additive migration, not the entire historical migration chain.
const baselineBlob = "3b6c352ed53c0650f36d1a751c2e51a5a7efeadb";
const migrationName = "202609110001_teaching_workflows";
const schemaName = `jh_migration_test_${randomUUID().replaceAll("-", "")}`;
const testDir = path.resolve("tmp", schemaName);
const schemaFile = path.join(testDir, "schema.prisma");
const baselineFile = path.join(testDir, "baseline.prisma");
const migrationsDir = path.join(testDir, "migrations");
const legacyModels = ["teacher", "student", "subject", "assignment", "assignmentItem", "submission", "gradingResult", "mistakeRecord"];
let admin, db, PrismaClient, isolatedUrl, legacyBefore, historyBefore, migrationBytes;
let schemaCreated = false;
let commandIndex = 0;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const redact = (value) => String(value || "").replaceAll(isolatedUrl || "__unused__", "[isolated database]")
  .replaceAll(process.env.DATABASE_URL || "__unused__", "[database]");
const caseTest = (name, fn) => test(name, { skip: !enabled, timeout: 90000 }, fn);

function runPrisma(args) {
  assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schemaName);
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    env: { ...process.env, DATABASE_URL: isolatedUrl }, encoding: "utf8", timeout: 60000, windowsHide: true
  });
  const evidence = { command: args.map(redact), status: result.status, stdout: redact(result.stdout), stderr: redact(result.stderr), error: redact(result.error?.message) };
  fs.writeFileSync(path.join(testDir, `prisma-${++commandIndex}.json`), JSON.stringify(evidence, null, 2), "utf8");
  assert.equal(result.status, 0, `isolated Prisma ${args[0]} failed: ${JSON.stringify(evidence)}`);
  return result.stdout;
}

async function readLegacy() {
  return Object.fromEntries(await Promise.all(legacyModels.map(async (model) => [model, await db[model].findMany({ orderBy: { id: "asc" } })])));
}

async function readHistory() {
  return db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name');
}

before(async () => {
  if (!enabled) return;
  assert.ok(process.env.DATABASE_URL, "run via scripts/run-with-env.mjs");
  assert.match(schemaName, /^jh_migration_test_[a-f0-9]{32}$/);
  const url = new URL(process.env.DATABASE_URL);
  assert.notEqual(url.searchParams.get("schema"), schemaName);
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("connection_limit", "4");
  isolatedUrl = url.href;
  fs.mkdirSync(testDir, { recursive: true });
  const baseline = spawnSync("git", ["cat-file", "blob", baselineBlob], { encoding: "utf8", windowsHide: true });
  assert.equal(baseline.status, 0, "pre-workflow schema blob must be available in Git history");
  assert.doesNotMatch(baseline.stdout, /model TeachingWorkflow\b/);
  fs.writeFileSync(baselineFile, baseline.stdout, "utf8");
  const clientDir = path.join(testDir, "client");
  const current = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  fs.writeFileSync(schemaFile, current.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientDir.replaceAll("\\", "/"))}`), "utf8");
  runPrisma(["generate", "--schema", schemaFile]);
  ({ PrismaClient } = await import(pathToFileURL(path.join(clientDir, "index.js"))));
  admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  db = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
  assert.equal((await db.$queryRaw`SELECT current_schema() AS schema`)[0].schema, schemaName);

  const baselineSql = runPrisma(["migrate", "diff", "--from-empty", "--to-schema-datamodel", baselineFile, "--script"]);
  const baselineDir = path.join(migrationsDir, "202609100000_synthetic_baseline");
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(path.join(baselineDir, "migration.sql"), baselineSql, "utf8");
  fs.writeFileSync(path.join(migrationsDir, "migration_lock.toml"), 'provider = "postgresql"\n', "utf8");
  runPrisma(["migrate", "deploy", "--schema", schemaFile]);
  runPrisma(["migrate", "diff", "--from-schema-datasource", schemaFile, "--to-schema-datamodel", baselineFile, "--exit-code"]);
  assert.equal((await db.$queryRawUnsafe('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ($2, $3)', schemaName, "TeachingWorkflow", "TeachingWorkflowRevision")).length, 0);

  const at = new Date("2026-09-01T08:09:10.123Z");
  await db.teacher.create({ data: { id: "legacy-teacher", name: "Synthetic teacher", createdAt: at, updatedAt: at } });
  await db.student.create({ data: { id: "legacy-student", displayName: "Synthetic student", grade: "四年级", responsibleTeacherId: "legacy-teacher", createdAt: at, updatedAt: at } });
  await db.subject.create({ data: { id: "legacy-subject", code: "math", name: "数学" } });
  await db.assignment.create({ data: { id: "legacy-assignment", title: "合成旧版练习", subjectId: "legacy-subject", grade: "四年级", createdAt: at, updatedAt: at,
    metadata: { synthetic: true, note: "保留旧格式", nested: { flags: [true, null, 0] } }, items: { create: {
      id: "legacy-item", orderIndex: 1, itemType: "calculation", prompt: "24+18", answer: { value: "42" }, rubric: { result: 1, process: 4 }
    } } } });
  await db.submission.create({ data: { id: "legacy-submission", assignmentId: "legacy-assignment", studentId: "legacy-student", status: "GRADED", submittedAt: at,
    content: { questions: [{ questionNo: "1", studentAnswer: "32", confidence: null }] }, grading: { create: {
      id: "legacy-grading", score: 0, result: { synthetic: true, teacherConfirmed: true, questions: [{ score: 0, status: "wrong" }] }, createdAt: at
    } } } });
  await db.mistakeRecord.create({ data: { id: "legacy-mistake", studentId: "legacy-student", subject: "数学", prompt: "24+18", studentAnswer: "32", correctAnswer: "42",
    cause: "合成进位错误", metadata: { sourceSubmissionId: "legacy-submission", synthetic: true }, createdAt: at, updatedAt: at } });
  legacyBefore = await readLegacy();
  assert.ok(legacyModels.every((model) => legacyBefore[model].length === 1));
  fs.writeFileSync(path.join(testDir, "legacy-before.json"), JSON.stringify(legacyBefore, null, 2), "utf8");
  console.log(`Seeded eight legacy tables in ${schemaName}; deploying exact workflow migration.`);

  migrationBytes = fs.readFileSync(new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url));
  const upgradeDir = path.join(migrationsDir, migrationName);
  fs.mkdirSync(upgradeDir);
  fs.writeFileSync(path.join(upgradeDir, "migration.sql"), migrationBytes);
  runPrisma(["migrate", "deploy", "--schema", schemaFile]);
  historyBefore = await readHistory();
}, { timeout: 240000 });

after(async () => {
  await db?.$disconnect();
  if (!admin) return;
  try {
    if (schemaCreated) {
      assert.match(schemaName, /^jh_migration_test_[a-f0-9]{32}$/);
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      assert.equal((await admin.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1", schemaName)).length, 0);
      fs.writeFileSync(path.join(testDir, "boundary.json"), JSON.stringify({ schemaName, baselineBlob, testSchemaRemoved: true,
        isolation: "random schema on existing PostgreSQL server", baseline: "synthetic migration generated from frozen old datamodel",
        fullHistoricalMigrationChainTested: false, productionMigrationApplied: false, syntheticDataOnly: true, modelCalls: 0,
        workflowMigrationSha256: migrationBytes ? sha256(migrationBytes) : null }, null, 2), "utf8");
      console.log(`Verified removal of ${schemaName}; evidence: ${testDir}`);
    }
  } finally { await admin.$disconnect(); }
});

caseTest("additive deploy preserves legacy rows, JSON, timestamps and relations", async () => {
  assert.deepEqual(await readLegacy(), legacyBefore);
  const submission = await db.submission.findUnique({ where: { id: "legacy-submission" }, include: { assignment: { include: { items: true } }, student: { include: { responsibleTeacher: true } }, grading: true } });
  assert.equal(submission.assignment.items[0].id, "legacy-item");
  assert.equal(submission.student.responsibleTeacher.id, "legacy-teacher");
  assert.equal(submission.grading.id, "legacy-grading");
  assert.equal(await db.teachingWorkflow.count(), 0);
  assert.equal(await db.teachingWorkflowRevision.count(), 0);
});

caseTest("deployed schema has no datamodel drift and records the exact migration checksum", async () => {
  runPrisma(["migrate", "diff", "--from-schema-datasource", schemaFile, "--to-schema-datamodel", schemaFile, "--exit-code"]);
  assert.equal(historyBefore.length, 2);
  const upgrade = historyBefore.find((row) => row.migration_name === migrationName);
  assert.equal(upgrade.checksum, sha256(migrationBytes));
  for (const row of historyBefore) {
    assert.ok(row.finished_at instanceof Date);
    assert.equal(row.rolled_back_at, null);
    assert.equal(row.applied_steps_count, 1);
  }
});

caseTest("second deploy is a no-op for migration history and old business data", async () => {
  runPrisma(["migrate", "deploy", "--schema", schemaFile]);
  assert.deepEqual(await readHistory(), historyBefore);
  assert.deepEqual(await readLegacy(), legacyBefore);
});

caseTest("upgraded repository persists revisions and rejects stale writes without changing old rows", async () => {
  const repo = createTeachingWorkflowRepository(db);
  const head = await repo.create({ ownerTeacherId: "legacy-teacher", module: "generation", requestKey: "synthetic-request",
    request: { assignmentId: "legacy-assignment", synthetic: true }, snapshot: { questions: [{ id: "q1", prompt: "2+3", answer: "5" }] } });
  const input = { workflowId: head.id, ownerTeacherId: "legacy-teacher", expectedRevision: 1, operationKey: "synthetic-revise", operation: "revise",
    snapshot: { questions: [{ id: "q1", prompt: "3+3", answer: "6" }] } };
  await repo.commitRevision(input);
  await assert.rejects(repo.commitRevision({ ...input, operationKey: "stale-revise" }), /WORKFLOW_VERSION_CONFLICT/);
  await db.$disconnect();
  db = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
  const reloaded = createTeachingWorkflowRepository(db);
  assert.equal((await reloaded.get(head.id, "legacy-teacher")).currentRevision, 2);
  assert.equal((await reloaded.getRevision(head.id, 1, "legacy-teacher")).snapshot.questions[0].answer, "5");
  assert.equal((await reloaded.getRevision(head.id, 2, "legacy-teacher")).snapshot.questions[0].answer, "6");
  assert.equal(await db.teachingWorkflowRevision.count({ where: { workflowId: head.id } }), 2);
  assert.deepEqual(await readLegacy(), legacyBefore);
});

caseTest("legacy assignment and grading writes remain usable after upgrade", async () => {
  const assignment = await db.assignment.create({ data: { title: "合成升级后练习", subjectId: "legacy-subject", items: { create: { orderIndex: 1, itemType: "calculation", prompt: "1+1", answer: { value: "2" } } } } });
  const submission = await db.submission.create({ data: { assignmentId: assignment.id, studentId: "legacy-student", status: "GRADED",
    content: { synthetic: true, studentAnswer: "2" }, grading: { create: { score: 5, result: { synthetic: true, status: "correct" } } } }, include: { grading: true } });
  assert.equal(submission.grading.score, 5);
  assert.equal(await db.assignmentItem.count({ where: { assignmentId: assignment.id } }), 1);
  const now = await readLegacy();
  for (const model of legacyModels) assert.deepEqual(now[model].filter((row) => legacyBefore[model].some((old) => old.id === row.id)), legacyBefore[model]);
});
