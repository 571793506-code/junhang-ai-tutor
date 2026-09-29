import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessmentOptions, assessmentChoiceOptionsValid } from "./assessment-options.js";

test("explicit option labels and text normalize without reordering or double prefixes", () => {
  const input = [{ label: "B", text: " 32 " }, { label: "A", text: "A. 42" }];
  const before = structuredClone(input);
  assert.deepEqual(normalizeAssessmentOptions(input), ["B. 32", "A. 42"]);
  assert.deepEqual(input, before);
  assert.deepEqual(normalizeAssessmentOptions("A. 42\nB. 32"), ["A. 42", "B. 32"]);
  assert.equal(assessmentChoiceOptionsValid(normalizeAssessmentOptions(input)), true);
});

test("malformed options reject the list rather than dropping choices or inferring answer labels", () => {
  for (const bad of ["[object Object]", "", null, 42, { label: "A" }, { text: "42" },
    { label: "A", text: { text: "42" } }, { label: "A", text: "B. 42" }]) {
    assert.deepEqual(normalizeAssessmentOptions(["A. 42", bad, "C. 99"]), []);
  }
  assert.equal(assessmentChoiceOptionsValid(["A. 42", "[object Object]"]), false);
  assert.equal(assessmentChoiceOptionsValid([{ label: "A", text: "42" }, { label: "B", text: "32" }]), false);
});
