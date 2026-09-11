import assert from "node:assert/strict";
import test from "node:test";

import { classifyTaskFailure, resolveTaskModelPolicy, resolveTeachingTaskPolicy } from "./model-policy.js";

test("teaching policies isolate Astra, Flash and Sol responsibilities from QA", () => {
  for (const task of ["generation", "grading", "reference"]) {
    const policy = resolveTeachingTaskPolicy(task, { GPT56_MODEL: "legacy-model" });
    assert.equal(policy.primary.model, "gpt-6-astra");
    assert.equal(policy.primary.reasoningEffort, "high");
    assert.equal(policy.replacement.model, "gpt-5.6-sol");
    assert.equal(policy.maxAdditionalAttempts, 1);
  }
  for (const task of ["extract-requirement", "extract-material", "recognize"]) {
    const policy = resolveTeachingTaskPolicy(task);
    assert.equal(policy.primary.model, "deepseek-flash");
    assert.equal(policy.primary.providerId, "deepseek");
    assert.equal(policy.replacement, null);
  }
  assert.equal(resolveTeachingTaskPolicy("rewrite-feedback").primary.model, "gpt-5.6-sol");
  assert.equal(resolveTeachingTaskPolicy("rewrite-feedback").replacement, null);
  assert.equal(resolveTaskModelPolicy("qa").primary.model, "gpt-5.6-terra");
  assert.equal(resolveTaskModelPolicy("qa").escalation.enabled, false);
  assert.throws(() => resolveTeachingTaskPolicy("qa"), /Unknown teaching task/);
});

test("teaching configuration overrides do not mutate global runtime configuration", () => {
  const config = Object.freeze({ GPT56_MODEL: "gpt-5.6-terra", TEACHING_PRIMARY_MODEL: "astra-gateway-alias" });
  assert.equal(resolveTeachingTaskPolicy("grading", config).primary.model, "astra-gateway-alias");
  assert.equal(resolveTaskModelPolicy("qa", config).primary.model, "gpt-5.6-terra");
  assert.equal(resolveTeachingTaskPolicy("generation", { teachingPrimaryModel: "astra-alias" }).primary.model, "astra-alias");
});

test("assessment and grading use Terra defaults with one bounded Sol escalation", () => {
  const assessment = resolveTaskModelPolicy("assessment-draft", {}, { kind: "小测" });
  const formal = resolveTaskModelPolicy("assessment-draft", {}, { kind: "试卷" });
  const grading = resolveTaskModelPolicy("submission-grading", {}, {});
  assert.equal(assessment.primary.reasoningEffort, "medium");
  assert.equal(formal.primary.reasoningEffort, "high");
  assert.equal(grading.primary.reasoningEffort, "high");
  assert.equal(assessment.escalation.maxAttemptsPerUnit, 1);
  assert.deepEqual(assessment.escalation.blockedTriggerClasses, ["configuration", "evidence"]);
});

test("QA never escalates and evidence failure cannot call Sol", () => {
  const qa = resolveTaskModelPolicy("qa", {}, {});
  const evidence = classifyTaskFailure({ code: "REFERENCE_EVIDENCE_MISSING" }, { evidenceSufficient: false });
  assert.equal(qa.escalation.enabled, false);
  assert.equal(evidence.triggerClass, "evidence");
  assert.equal(evidence.allowedToEscalate, false);
});

test("configuration and quality failures are classified separately", () => {
  assert.equal(classifyTaskFailure({ code: "invalid_api_key" }).allowedToEscalate, false);
  assert.equal(classifyTaskFailure({ code: "malformed_json" }, { evidenceSufficient: true }).triggerClass, "quality");
  assert.equal(classifyTaskFailure({ status: 524 }).triggerClass, "availability");
  assert.equal(classifyTaskFailure({ status: 524 }).allowedToEscalate, true);
});

test("Sol and third text model are never chained by a policy", () => {
  const sol = resolveTaskModelPolicy("assessment-draft", { GPT56_MODEL: "gpt-5.6-sol" }, {});
  const emergency = resolveTaskModelPolicy("emergency-text", {}, {});
  assert.equal(sol.escalation.enabled, false);
  assert.equal(emergency.primary.providerId, "deepseek");
  assert.equal(emergency.escalation.enabled, false);
});
