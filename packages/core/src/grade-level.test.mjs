import test from "node:test";
import assert from "node:assert/strict";
import { gradeLevelLabel, normalizeGradeLevel } from "./grade-level.js";

test("normalizes middle-school grade seven aliases without falling back to primary six", () => {
  for (const value of ["七年级", "初一", "7年级", "7", "七年级上册"]) {
    assert.deepEqual(normalizeGradeLevel(value), { level: 7, stage: "middle", label: "七年级" });
    assert.equal(gradeLevelLabel(value), "七年级");
  }
});

test("keeps primary grade six distinct from middle school", () => {
  assert.deepEqual(normalizeGradeLevel("六年级"), { level: 6, stage: "primary", label: "六年级" });
});

test("returns null for unsupported or empty grades", () => {
  assert.equal(normalizeGradeLevel("高中一年级"), null);
  assert.equal(normalizeGradeLevel(""), null);
  assert.equal(gradeLevelLabel("高中一年级"), "");
});
