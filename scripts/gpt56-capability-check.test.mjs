import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGpt56ProbeCases,
  buildGpt56ProbeTargets,
  classifyGpt56ProbeResult,
  runProbe
} from "./gpt56-capability-check.mjs";

function syntheticResponse({ ok = true, status = 200, body = { choices: [] } } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body)
  };
}

function identifyProbeId(payload) {
  if (payload.response_format?.type === "json_schema") return "json_schema";
  if (payload.reasoning_effort) return "reasoning_effort";
  if (payload.max_tokens === 128) return "project_grading_json";
  if (payload.response_format?.type === "json_object") return "json_object";
  if (payload.messages[0]?.content instanceof Array) return "image_input";
  return "text";
}

test("GPT-5.6 capability targets require Terra and enabled Sol fallback", () => {
  assert.deepEqual(buildGpt56ProbeTargets({
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "true"
  }), [
    { role: "primary", model: "gpt-5.6-terra", required: true },
    { role: "sol-fallback", model: "gpt-5.6-sol", required: true }
  ]);
});

test("GPT-5.6 capability targets include disabled Sol only when explicitly requested", () => {
  const env = {
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "false"
  };

  assert.deepEqual(buildGpt56ProbeTargets(env), [
    { role: "primary", model: "gpt-5.6-terra", required: true }
  ]);
  assert.deepEqual(buildGpt56ProbeTargets(env, { includeSol: true }), [
    { role: "primary", model: "gpt-5.6-terra", required: true },
    { role: "sol-fallback", model: "gpt-5.6-sol", required: false }
  ]);
});

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

test("GPT-5.6 capability probes use high reasoning effort for Sol", () => {
  const terraReasoning = buildGpt56ProbeCases("gpt-5.6-terra")
    .find((item) => item.id === "reasoning_effort");
  const solReasoning = buildGpt56ProbeCases("gpt-5.6-sol", { reasoningEffort: "high" })
    .find((item) => item.id === "reasoning_effort");

  assert.equal(terraReasoning?.payload.reasoning_effort, "low");
  assert.equal(solReasoning?.payload.reasoning_effort, "high");
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

test("GPT-5.6 capability check probes each required target and aggregates results", async () => {
  const payloads = [];
  const summary = await runProbe({
    GPT56_API_KEY: "synthetic-key",
    GPT56_BASE_URL: "https://synthetic.invalid/v1",
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "true"
  }, {
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      if (payload.model === "gpt-5.6-sol") {
        return syntheticResponse({ ok: false, status: 503, body: { error: { message: "synthetic unavailable" } } });
      }
      return syntheticResponse();
    }
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.baseUrl, "https://synthetic.invalid/v1");
  assert.deepEqual(summary.targets.map(({ role, model, ok }) => ({ role, model, ok })), [
    { role: "primary", model: "gpt-5.6-terra", ok: true },
    { role: "sol-fallback", model: "gpt-5.6-sol", ok: false }
  ]);
  assert.equal(summary.targets.every((target) => target.checks.length === 6), true);
  assert.equal(payloads.length, 12);
  assert.equal(payloads.find((payload) => payload.model === "gpt-5.6-sol" && payload.reasoning_effort)?.reasoning_effort, "high");
});

for (const failedProbeId of ["json_object", "reasoning_effort", "json_schema", "project_grading_json"]) {
  test(`GPT-5.6 enabled Sol fails when ${failedProbeId} is unsupported`, async () => {
    const summary = await runProbe({
      GPT56_API_KEY: "synthetic-key",
      GPT56_MODEL: "gpt-5.6-terra",
      GPT56_SOL_MODEL: "gpt-5.6-sol",
      GPT56_SOL_FALLBACK_ENABLED: "true"
    }, {
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        const probeId = identifyProbeId(payload);
        if (payload.model === "gpt-5.6-sol" && probeId === failedProbeId) {
          return syntheticResponse({ ok: false, status: 400, body: { error: { message: `Synthetic ${failedProbeId} failure` } } });
        }
        return syntheticResponse();
      }
    });
    const sol = summary.targets.find((target) => target.role === "sol-fallback");

    assert.equal(sol?.checks.find((check) => check.id === "text")?.supported, true);
    assert.equal(sol?.checks.find((check) => check.id === failedProbeId)?.supported, false);
    assert.equal(sol?.ok, false);
    assert.equal(summary.ok, false);
  });
}

test("GPT-5.6 Sol image input failure does not fail its required capability gate", async () => {
  const summary = await runProbe({
    GPT56_API_KEY: "synthetic-key",
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "true"
  }, {
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const isSolImage = payload.model === "gpt-5.6-sol" && payload.messages[0]?.content instanceof Array;
      return isSolImage
        ? syntheticResponse({ ok: false, status: 400, body: { error: { message: "Synthetic image failure" } } })
        : syntheticResponse();
    }
  });
  const sol = summary.targets.find((target) => target.role === "sol-fallback");

  assert.equal(sol?.checks.find((check) => check.id === "image_input")?.supported, false);
  assert.equal(sol?.ok, true);
  assert.equal(summary.ok, true);
});

test("GPT-5.6 capability check ignores explicitly included optional Sol failure", async () => {
  const summary = await runProbe({
    GPT56_API_KEY: "synthetic-key",
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "false"
  }, {
    includeSol: true,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      return payload.model === "gpt-5.6-sol"
        ? syntheticResponse({ ok: false, status: 400, body: { error: { message: "synthetic unsupported" } } })
        : syntheticResponse();
    }
  });

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.targets.map(({ role, model, ok }) => ({ role, model, ok })), [
    { role: "primary", model: "gpt-5.6-terra", ok: true },
    { role: "sol-fallback", model: "gpt-5.6-sol", ok: false }
  ]);
});
