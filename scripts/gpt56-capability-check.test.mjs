import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGpt56ProbeCases,
  classifyGpt56ProbeResult
} from "./gpt56-capability-check.mjs";

test("GPT-5.6 capability probes use synthetic Junhang-safe inputs", () => {
  const cases = buildGpt56ProbeCases();

  assert.deepEqual(cases.map((item) => item.id), [
    "text",
    "json_object",
    "reasoning_effort",
    "json_schema",
    "image_input",
    "project_grading_json"
  ]);
  assert.equal(cases.every((item) => !/学生|姓名|手机号|作业照片/.test(JSON.stringify(item.payload))), true);
});

test("GPT-5.6 capability result distinguishes supported and unsupported parameters", () => {
  assert.deepEqual(classifyGpt56ProbeResult({ ok: true, status: 200, body: { choices: [] } }), {
    supported: true,
    status: 200,
    reason: "ok"
  });
  assert.deepEqual(classifyGpt56ProbeResult({
    ok: false,
    status: 400,
    body: { error: { message: "Unsupported parameter: reasoning_effort" } }
  }), {
    supported: false,
    status: 400,
    reason: "unsupported_parameter"
  });
});
