import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { buildGradingSourcePackage } from "@junhang/core/grading-source-package";
import { registerGradingCollectionRoutes } from "./grading-collection-routes.js";
import { isGradingSourceEligible } from "./grading-collection.js";

test("HTTP dialogue review guards identity, version, decision, replay and concurrent writes", async t => {
  const gradingSourcePackage = buildGradingSourcePackage({ id: "paper", title: "练习", grade: "三年级", metadata: { subject: "数学", kind: "练习" },
    items: [{ orderIndex: 1, prompt: "1+1", answer: "2", score: 1 }] }).package;
  let assignment = { id: "paper", grade: "三年级", metadata: { source: "dialogue-import", teacherId: "t1", gradingSourcePackage } };
  let conflict = false, writes = 0, audits = 0;
  const app = express(); app.use(express.json());
  registerGradingCollectionRoutes(app, { prisma: { assignment: {
    findUnique: async () => structuredClone(assignment),
    updateMany: async ({ where, data }) => { assert.deepEqual(where.metadata.equals, assignment.metadata); if (conflict) return { count: 0 };
      writes++; assignment = { ...assignment, metadata: data.metadata }; return { count: 1 }; }
  } }, middleware: [(req, res, next) => { req.session = { teacherId: req.headers["x-teacher"] || "t1" }; next(); }],
  asyncRoute: fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
  mapAssignment: a => ({ id: a.id, gradingEligible: isGradingSourceEligible(a) }), auditEvent: async () => { audits++; } });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const review = (body, teacher = "t1") => fetch(`http://127.0.0.1:${server.address().port}/api/grading/source-packages/dialogue/paper/review`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-teacher": teacher }, body: JSON.stringify(body) });
  const input = { decision: "accept", fingerprint: gradingSourcePackage.fingerprint, note: "本份内容可用" };
  assert.equal((await review(input, "t2")).status, 403);
  assert.equal((await review({ ...input, fingerprint: "wrong" })).status, 409);
  assert.equal((await review({ ...input, note: "" })).status, 400);
  conflict = true; assert.equal((await review(input)).status, 409); assert.equal(writes, 0);
  conflict = false; const accepted = await review(input); assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).assignment.gradingEligible, true);
  assert.equal((await (await review(input)).json()).replayed, true);
  assert.equal((await review({ ...input, decision: "reject" })).status, 409);
  assert.equal(writes, 1); assert.equal(audits, 1);
});

test("HTTP collection history uses teacher and batch filters and current student permissions", async t => {
  const app = express(); let where;
  registerGradingCollectionRoutes(app, { prisma: { submission: { findMany: async query => {
    where = query.where; return ["s1", "s2"].map(studentId => ({ id: `sub-${studentId}`, studentId, assignmentId: "paper", content: {
      collectionBatchId: "b1", collectionTitle: "周测", imageTotal: 2 }, status: "SUBMITTED" }));
  } } }, middleware: [(req, res, next) => { req.session = { teacherId: "t1" }; next(); }],
  asyncRoute: fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next), teacherCanAccessStudent: async (teacher, student) => teacher === "t1" && student === "s1" });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/grading/collections?batchId=b1`);
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.submissions.length, 1); assert.equal(body.submissions[0].studentId, "s1");
  assert.deepEqual(where.AND, [{ content: { path: ["collectionTeacherId"], equals: "t1" } }, { content: { path: ["collectionBatchId"], equals: "b1" } }]);
});
