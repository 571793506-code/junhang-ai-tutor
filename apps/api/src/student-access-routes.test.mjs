import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "..");
const source = fs.readFileSync(path.join(root, "apps/api/src/server.js"), "utf8");
const sessionSource = fs.readFileSync(path.join(root, "apps/api/src/session.js"), "utf8");

test("student access removal is a teacher-scoped soft-delete route", () => {
  assert.match(source, /app\.delete\("\/api\/students\/:studentId\/access"/);
  assert.match(source, /assertTeacherStudentScope\(req, res, req\.params\.studentId\)/);
  assert.match(source, /confirmationName !== student\.displayName/);
  assert.match(source, /removeStudentAccess\(req\.params\.studentId\)/);
  assert.match(source, /historyRetained: true/);
  assert.match(source, /STUDENT_ACCESS_ALREADY_REMOVED/);
});

test("removed students are excluded from login and new work", () => {
  assert.match(source, /id: studentId,\s+deletedAt: null,\s+loginEnabled: true/);
  assert.match(source, /displayName,\s+deletedAt: null,\s+loginEnabled: true/);
  assert.match(sessionSource, /currentSessionJti", "loginEnabled", "deletedAt"/);
  assert.match(sessionSource, /!student\.loginEnabled \|\| student\.deletedAt/);
});

test("teacher can update a student's grade without changing access status", () => {
  assert.match(source, /app\.patch\("\/api\/students\/:studentId\/profile"/);
  assert.match(source, /assertTeacherStudentScope\(req, res, req\.params\.studentId\)/);
  assert.match(source, /updateStudentProfile\(req\.params\.studentId/);
  assert.match(source, /normalizeGradeLevel\(body\.grade\)/);
  assert.match(source, /STUDENT_GRADE_INVALID/);
});
