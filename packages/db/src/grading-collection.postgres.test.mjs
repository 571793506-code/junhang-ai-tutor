import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test, { before, after } from "node:test";
import { collectionSubmissionId, persistCollectionSubmission } from "../../../apps/api/src/grading-collection.js";

const enabled = process.env.RUN_WORKFLOW_POSTGRES_TESTS === "1";
const schemaName = `jh_collection_test_${randomUUID().replaceAll("-", "")}`;
const testDir = path.resolve("tmp", schemaName);
let admin, db, schemaCreated = false;
const caseTest = (name, fn) => test(name, { skip: !enabled, timeout: 30000 }, fn);

before(async () => {
  if (!enabled) return;
  assert.ok(process.env.DATABASE_URL, "run via scripts/run-with-env.mjs");
  assert.match(schemaName, /^jh_collection_test_[a-f0-9]{32}$/);
  const url = new URL(process.env.DATABASE_URL);
  assert.notEqual(url.searchParams.get("schema"), schemaName);
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("connection_limit", "6");
  fs.mkdirSync(testDir, { recursive: true });
  const clientDir = path.join(testDir, "client");
  const schemaFile = path.join(testDir, "schema.prisma");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
    .replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientDir.replaceAll("\\", "/"))}`);
  fs.writeFileSync(schemaFile, schema, "utf8");
  const runPrisma = args => {
    assert.equal(new URL(url.href).searchParams.get("schema"), schemaName);
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args, "--schema", schemaFile], {
      env: { ...process.env, DATABASE_URL: url.href }, encoding: "utf8", timeout: 60000, windowsHide: true
    });
    const redact = value => String(value || "").replaceAll(url.href, "[isolated database]")
      .replaceAll(process.env.DATABASE_URL, "[database]");
    assert.equal(result.status, 0, `isolated Prisma ${args[0]} failed: ${redact(result.stderr || result.error?.message || result.stdout)}`);
  };
  runPrisma(["generate"]);
  const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, "index.js")));
  admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  // Initialize only our random, empty schema. Never reset or migrate business data.
  runPrisma(["db", "push", "--skip-generate"]);
  db = new PrismaClient({ datasources: { db: { url: url.href } } });
  assert.equal((await db.$queryRaw`SELECT current_schema() AS schema`)[0].schema, schemaName);
  await db.student.createMany({ data: [
    { id: "s1", displayName: "Synthetic A", grade: "三年级" },
    { id: "s2", displayName: "Synthetic B", grade: "三年级" }
  ] });
  await db.assignment.createMany({ data: [
    { id: "paper", title: "Synthetic assessment", grade: "三年级" },
    { id: "other-paper", title: "Synthetic alternative", grade: "三年级" }
  ] });
  console.log(`Collection concurrency tests use only synthetic data in ${schemaName}.`);
}, { timeout: 150000 });

after(async () => {
  await db?.$disconnect();
  if (!admin) return;
  try {
    if (schemaCreated) {
      assert.match(schemaName, /^jh_collection_test_[a-f0-9]{32}$/);
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      assert.equal((await admin.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1", schemaName)).length, 0);
      fs.writeFileSync(path.join(testDir, "boundary.json"), JSON.stringify({ schemaName, testSchemaRemoved: true,
        syntheticDataOnly: true, productionMigrationApplied: false, modelCalls: 0 }, null, 2) + "\n", "utf8");
      console.log(`Verified removal of ${schemaName}; business records and migration settings unchanged.`);
    }
  } finally { await admin.$disconnect(); }
});

function inputFor(batchId, studentId = "s1", overrides = {}) {
  const input = { assignmentId: "paper", studentId, collectionBatchId: batchId, collectionTeacherId: "t1",
    collectionContentFingerprint: `sha256:synthetic-${studentId}`, collectionTitle: "Synthetic batch", ...overrides };
  return { ...input, collectionSubmissionId: collectionSubmissionId(input.collectionBatchId, input.studentId, input.collectionTeacherId) };
}

function createSubmission(input, tx) {
  return tx.submission.create({ data: { id: input.collectionSubmissionId, assignmentId: input.assignmentId, studentId: input.studentId,
    content: { collectionBatchId: input.collectionBatchId, collectionTeacherId: input.collectionTeacherId,
      collectionContentFingerprint: input.collectionContentFingerprint, collectionTitle: input.collectionTitle,
      imageFiles: [{ name: `${input.studentId}.png` }] },
    grading: { create: { needsReview: true, result: { synthetic: true, reviewStatus: "pending_teacher_review" } } }
  }, include: { grading: true } });
}
const save = input => persistCollectionSubmission(db, input, createSubmission);
const batchRows = batchId => db.submission.findMany({ where: { content: { path: ["collectionBatchId"], equals: batchId } }, include: { grading: true } });

caseTest("PostgreSQL serializes simultaneous identical uploads and replays one submission", async () => {
  const input = inputFor(randomUUID());
  const results = await Promise.all([save(input), save({ ...input })]);
  assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]);
  assert.equal(results[0].submission.id, results[1].submission.id);
  const rows = await batchRows(input.collectionBatchId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "SUBMITTED");
  assert.equal(rows[0].grading.needsReview, true);
  const replay = await save(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.submission.grading.id, rows[0].grading.id);
});

caseTest("PostgreSQL keeps two students independent in the same assessment batch", async () => {
  const batchId = randomUUID();
  const results = await Promise.all([save(inputFor(batchId, "s1")), save(inputFor(batchId, "s2"))]);
  assert.ok(results.every(r => r.replayed === false));
  assert.notEqual(results[0].submission.id, results[1].submission.id);
  const rows = await batchRows(batchId);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.studentId).sort(), ["s1", "s2"]);
  assert.ok(rows.every(r => r.assignmentId === "paper" && r.status === "SUBMITTED"));
  assert.equal(new Set(rows.map(r => r.grading.id)).size, 2);
});

caseTest("PostgreSQL rejects competing sources in one batch without partial records", async () => {
  const batchId = randomUUID();
  const results = await Promise.all([save(inputFor(batchId)), save(inputFor(batchId, "s2", { assignmentId: "other-paper" }))]);
  assert.equal(results.filter(r => r.submission).length, 1);
  assert.equal(results.filter(r => r.error === "COLLECTION_BATCH_SOURCE_CONFLICT").length, 1);
  assert.equal((await batchRows(batchId)).length, 1);
});

caseTest("PostgreSQL preserves original photos and permits changes only in a new batch", async () => {
  const input = inputFor(randomUUID());
  const first = await save(input);
  const conflict = await save({ ...input, collectionContentFingerprint: "sha256:changed" });
  assert.equal(conflict.error, "COLLECTION_SUBMISSION_CONFLICT");
  assert.equal((await batchRows(input.collectionBatchId))[0].content.collectionContentFingerprint, input.collectionContentFingerprint);
  const revised = await save(inputFor(randomUUID(), "s1", { collectionContentFingerprint: "sha256:changed" }));
  assert.equal(revised.replayed, false);
  assert.notEqual(revised.submission.id, first.submission.id);
});

caseTest("PostgreSQL scopes batch identities to the teacher and retains the original batch title", async () => {
  const batchId = randomUUID();
  await save(inputFor(batchId));
  const same = await save(inputFor(batchId, "s2", { collectionTitle: "Attempted rename" }));
  assert.equal(same.submission.content.collectionTitle, "Synthetic batch");
  const otherTeacher = await save(inputFor(batchId, "s1", { collectionTeacherId: "t2", assignmentId: "other-paper" }));
  assert.equal(otherTeacher.replayed, false);
  assert.equal(otherTeacher.submission.assignmentId, "other-paper");
});

caseTest("PostgreSQL rolls back submission and grading together when creation fails", async () => {
  const input = inputFor(randomUUID());
  const gradingBefore = await db.gradingResult.count();
  await assert.rejects(persistCollectionSubmission(db, input, async (value, tx) => {
    await createSubmission(value, tx);
    throw new Error("synthetic transaction failure");
  }), /synthetic transaction failure/);
  assert.equal((await batchRows(input.collectionBatchId)).length, 0);
  assert.equal(await db.gradingResult.count(), gradingBefore);
  assert.equal((await save(input)).replayed, false);
  assert.equal(await db.mistakeRecord.count(), 0);
  assert.equal(await db.studentProfile.count(), 0);
});
