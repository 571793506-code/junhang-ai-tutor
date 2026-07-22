import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessmentTargetScope } from "./assessment-target-scope.js";

test("grade assessment targets clear personal fields and use a grade-scoped title", () => {
  const target = normalizeAssessmentTargetScope({
    targetScope: "grade",
    grade: "六年级",
    targetGrade: "四年级",
    studentId: "stu-lzy",
    studentName: "李子越",
    title: "李子越数学小测临时草稿",
    subject: "数学",
    kind: "小测",
    contentScope: "三角形"
  });

  assert.equal(target.targetScope, "grade");
  assert.equal(target.targetGrade, "四年级");
  assert.equal(target.grade, "四年级");
  assert.equal(target.studentId, undefined);
  assert.equal(target.studentName, undefined);
  assert.equal(target.title, "四年级数学三角形小测");
});

test("student assessment targets preserve the selected student and title", () => {
  const target = normalizeAssessmentTargetScope({
    targetScope: "student",
    targetGrade: "四年级",
    studentId: "stu-cyy",
    studentName: "陈娅娅",
    title: "陈娅娅数学三角形小测",
    subject: "数学",
    kind: "小测"
  });

  assert.equal(target.targetScope, "student");
  assert.equal(target.studentId, "stu-cyy");
  assert.equal(target.studentName, "陈娅娅");
  assert.equal(target.title, "陈娅娅数学三角形小测");
});
