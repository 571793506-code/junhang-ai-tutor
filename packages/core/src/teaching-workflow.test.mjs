import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowPatch, normalizeTeachingWorkflow } from "./teaching-workflow.js";

test("question patch changes only the target and reports its impact", () => {
  const before = { questions: [{ id: "q1", dayId: "d1", prompt: "2+3", answer: "5" }, { id: "q2", dayId: "d2", prompt: "4+6", answer: "10" }] };
  const result = applyWorkflowPatch(before, { type: "replace_question", questionId: "q2", value: { id: "q2", dayId: "d2", prompt: "14+6", answer: "20" } });
  assert.deepEqual(result.snapshot.questions[0], before.questions[0]);
  assert.deepEqual(result.affectedQuestionIds, ["q2"]);
  assert.equal(before.questions[1].prompt, "4+6");
});

test("shared material and day patches identify dependent questions", () => {
  const snapshot = { sharedMaterials: [{ id: "m1", text: "old" }], days: [{ dayId: "d1", goal: "old" }], questions: [{ id: "q1", sharedMaterialId: "m1", dayId: "d1" }] };
  assert.deepEqual(applyWorkflowPatch(snapshot, { type: "replace_shared_material", materialId: "m1", value: { id: "m1", text: "new" } }).affectedQuestionIds, ["q1"]);
  assert.deepEqual(applyWorkflowPatch(snapshot, { type: "replace_day", dayId: "d1", value: { dayId: "d1", goal: "new" } }).affectedQuestionIds, ["q1"]);
});

test("workflow input rejects unknown type and invalid revision", () => {
  assert.throws(() => normalizeTeachingWorkflow({ workflowId: "w", ownerTeacherId: "t", type: "other" }), /WORKFLOW_INPUT_INVALID/);
  assert.throws(() => normalizeTeachingWorkflow({ workflowId: "w", ownerTeacherId: "t", type: "generation", revision: 0 }), /WORKFLOW_REVISION_INVALID/);
});

test("local replacements cannot erase or rename question, material or day identities", () => {
  const snapshot = { questions: [{ id: "q1", sharedMaterialId: "m1", dayId: "d1" }], sharedMaterials: [{ id: "m1", text: "old" }], days: [{ dayId: "d1", goal: "old" }] };
  for (const [patch, field, error] of [
    [{ type: "replace_question", questionId: "q1" }, "id", "WORKFLOW_QUESTION_PATCH_INVALID"],
    [{ type: "replace_shared_material", materialId: "m1" }, "id", "WORKFLOW_MATERIAL_PATCH_INVALID"],
    [{ type: "replace_day", dayId: "d1" }, "dayId", "WORKFLOW_DAY_PATCH_INVALID"]
  ]) {
    for (const value of [[], {}, { [field]: "changed" }]) assert.throws(() => applyWorkflowPatch(snapshot, { ...patch, value }), { code: error });
  }
  assert.equal(snapshot.questions[0].id, "q1");
});
