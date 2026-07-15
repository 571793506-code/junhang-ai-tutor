import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const policyModuleUrl = new URL("./assessment-generation-emergency.js", import.meta.url);

test("teacher-requirement emergency quizzes require a scope and reject textbook fields", async () => {
  assert.equal(fs.existsSync(policyModuleUrl), true, "assessment emergency policy must exist");
  const { prepareTeacherRequirementEmergency } = await import(policyModuleUrl);

  const ready = prepareTeacherRequirementEmergency({
    generationBasis: "teacher_requirement_emergency",
    kind: "小测",
    subject: "数学",
    targetGrade: "五年级",
    requirement: "围绕小数乘法，重点检查竖式和小数点位置。",
    recoveryReason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND"
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.input.textbookAssetId, undefined);
  assert.equal(ready.input.contentContext.reason, "TEACHER_REQUIREMENT_EMERGENCY");
  assert.equal(ready.input.generationBasis, "teacher_requirement_emergency");

  const blocked = prepareTeacherRequirementEmergency({
    ...ready.input,
    textbookAssetId: "pretend-textbook"
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.failure.error, "EMERGENCY_DRAFT_TEXTBOOK_FIELDS_NOT_ALLOWED");
});
