import assert from "node:assert/strict";
import test from "node:test";
import { buildModuleCapabilityStatus } from "./module-capability-status.js";

test("projects runtime readiness into four teacher-safe module statuses", () => {
  const result = buildModuleCapabilityStatus({
    aiSnapshot: {
      generatedAt: "2026-09-07T00:00:00.000Z",
      features: [
        { id: "assessment-draft", status: "ready" },
        { id: "submission-grading", status: "ready" },
        { id: "spoken-interaction", status: "unavailable" }
      ]
    }
  });

  assert.deepEqual(
    result.capabilities.map((item) => item.moduleId),
    ["generation", "grading", "teaching-materials", "student-profile"]
  );
  assert.equal(result.capabilities.find((item) => item.moduleId === "generation").status, "available");
  assert.equal("model" in result.capabilities[0], false);
  assert.equal("prompt" in result.capabilities[0], false);
});

test("maps unavailable and missing runtime features without exposing provider fields", () => {
  const result = buildModuleCapabilityStatus({
    aiSnapshot: {
      generatedAt: "2026-09-07T00:00:00.000Z",
      features: [{ id: "assessment-draft", status: "unavailable", providerId: "gpt56", model: "secret" }]
    }
  });

  const generation = result.capabilities.find((item) => item.moduleId === "generation");
  const profile = result.capabilities.find((item) => item.moduleId === "student-profile");
  const materials = result.capabilities.find((item) => item.moduleId === "teaching-materials");
  assert.equal(generation.status, "blocked");
  assert.equal(profile.status, "review_required");
  assert.equal(materials.status, "available");
  assert.equal(materials.dependencyStatus, "review_required");
  assert.equal("providerId" in generation, false);
  assert.equal("model" in generation, false);
});
