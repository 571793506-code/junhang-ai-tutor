import assert from "node:assert/strict";
import test from "node:test";
import {
  getModuleCapability,
  listModuleCapabilities,
  validateModuleCapabilityRegistry
} from "./module-capability-registry.js";

test("registers the four cross-module capabilities in dependency order", () => {
  assert.deepEqual(
    listModuleCapabilities().map((item) => item.moduleId),
    ["generation", "grading", "teaching-materials", "student-profile"]
  );
  assert.equal(getModuleCapability("grading").dependencies.includes("generation"), true);
  assert.equal(getModuleCapability("student-profile").dependencies.includes("grading"), true);
});

test("every module declares client, teacher, and internal boundaries", () => {
  for (const capability of listModuleCapabilities()) {
    assert.ok(capability.requestContract.forbiddenClientFields.length > 0);
    assert.ok(capability.resultContract.teacherVisibleFields.length > 0);
    assert.ok(capability.resultContract.internalOnlyFields.length > 0);
    assert.ok(capability.verification.commands.length > 0);
  }
});

test("registry validation reports duplicate and unknown dependencies", () => {
  const result = validateModuleCapabilityRegistry([
    { ...getModuleCapability("generation"), moduleId: "generation", dependencies: ["unknown"] },
    { ...getModuleCapability("generation"), moduleId: "generation" }
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("duplicate moduleId")));
  assert.ok(result.issues.some((issue) => issue.includes("unknown dependency")));
});
