import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessmentAnswerFormat } from "./assessment-answer-format.js";

test("only explicit equivalent grid formats become a blank canonical English grid", () => {
  for (const type of ["english-four-line", "english-writing", "english_four_line_grid"]) {
    assert.equal(normalizeAssessmentAnswerFormat(type), "english-four-line");
    const value = { type, prefilledText: "answer", widthMm: 99999 };
    assert.equal(normalizeAssessmentAnswerFormat(value), "english-four-line");
    assert.equal(value.prefilledText, "answer");
  }
  for (const value of [null, undefined, "none", "ruled", "chinese-square-grid", { type: "blank_space", heightMm: 38 },
    { type: "unknown", text: "english_four_line_grid" }, ["english-four-line"]]) {
    assert.equal(normalizeAssessmentAnswerFormat(value), value);
  }
});
