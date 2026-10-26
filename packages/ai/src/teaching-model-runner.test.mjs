import assert from "node:assert/strict";
import test from "node:test";
import { loadTeachingRulePack } from "./teaching-rules.js";
import { runTeachingUnit, projectTeachingResult } from "./teaching-model-runner.js";

const rulePack = await loadTeachingRulePack("generation");
const gradingRules = await loadTeachingRulePack("grading");
const good = () => ({ text: JSON.stringify({ title: "draft" }), usage: { completion_tokens: 10 } });
const failure = (status, code) => Object.assign(new Error(code || `HTTP ${status}`), { status, code });

test("group primary overages reduce the shared repair reserve before another call", async () => {
  for (const [output, repairLimit] of [[7000, 500], [7500, null]]) {
    const budget = { deadlineAt: 180000, remainingTokens: 4500, additionalAttemptsUsed: 0 };
    const additionalAttemptBudget = { remainingTokens: 3000, additionalAttemptsUsed: 0 };
    const calls = [];
    await runTeachingUnit({ task: "grading", input: {}, rulePack: gradingRules, budget, additionalAttemptBudget }, {
      now: () => 0, repairIssues: () => [], call: async (_route, _messages, options) => {
        calls.push(options.maxTokens);
        return { text: "{", usage: { completion_tokens: calls.length === 1 ? output : options.maxTokens } };
      }
    });
    assert.deepEqual(calls, repairLimit == null ? [4500] : [4500, repairLimit]);
    assert.equal(additionalAttemptBudget.remainingTokens, 0);
  }
});

test("shared additional-attempt controls are removed recursively from input and candidate", async () => {
  let sent;
  const result = await runTeachingUnit({ task: "grading", input: {
    additionalAttemptBudget: { remainingTokens: 99999 }, nested: { questionGroupThreshold: 1, additionalAttemptBudget: {} }
  }, rulePack: gradingRules, budget: { deadlineAt: 180000, remainingTokens: 4500, additionalAttemptsUsed: 0 },
  additionalAttemptBudget: { remainingTokens: 3000, additionalAttemptsUsed: 0 } }, {
    now: () => 0, repairIssues: () => [], call: async (_route, messages) => {
      sent = JSON.parse(messages[1].content);
      return { text: JSON.stringify({ title: "draft", nested: { additionalAttemptBudget: {}, questionGroupThreshold: 1 } }) };
    }
  });
  assert.deepEqual(sent, { nested: {} });
  assert.deepEqual(result.candidate, { title: "draft", nested: {} });
});

test("grading can complete a response larger than the old half-pool cap on its first attempt", async () => {
  const calls = [];
  const budget = { deadlineAt: 180000, remainingTokens: 12000, additionalAttemptsUsed: 0 };
  let time = 0;
  const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: gradingRules, budget }, {
    now: () => time, repairIssues: candidate => candidate.title ? [] : ["title_missing"],
    call: async (_route, _messages, options) => {
      calls.push(options);
      // Deterministic truncated-response reproduction, not real model timing.
      const complete = options.maxTokens >= 7000;
      time += complete ? 160000 : 151000;
      return { text: complete ? '{"title":"draft"}' : '{"title":',
        usage: { completion_tokens: complete ? 7000 : options.maxTokens },
        completionDiagnostics: { limitField: "max_completion_tokens", finishReason: complete ? "stop" : "length" } };
    }
  });
  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxTokens, 9000);
  assert.equal(budget.remainingTokens, 5000);
  assert.equal(budget.additionalAttemptsUsed, 0);
});

test("grading repair only uses the shared remainder and cannot extend time or add a third call", async () => {
  for (const [usage, expectedRepair, finalBalance] of [
    [undefined, 3000, 2000],
    [{ completion_tokens: 7000 }, 5000, 4000],
    [{ completion_tokens: 10000 }, 2000, 1000],
    [{ completion_tokens: 12001 }, null, 0]
  ]) {
    const calls = [];
    const budget = { deadlineAt: 180000, remainingTokens: 12000, additionalAttemptsUsed: 0 };
    let time = 0;
    const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: gradingRules, budget }, {
      now: () => time, repairIssues: () => [], call: async (route, _messages, options) => {
        calls.push({ route, options });
        time += 1000;
        return calls.length === 1 ? { text: '{"title":', usage } : { text: '{"title":', usage: { completion_tokens: 1000 } };
      }
    });
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
    assert.equal(calls[0].options.maxTokens, 9000);
    assert.equal(calls[0].options.timeoutMs, 180000);
    assert.equal(calls.length, expectedRepair === null ? 1 : 2);
    if (expectedRepair !== null) {
      assert.equal(calls[1].options.maxTokens, expectedRepair);
      assert.equal(calls[1].options.timeoutMs, 179000);
      assert.deepEqual(calls[1].route, calls[0].route);
      assert.equal(result.internal.attempts[1].role, "quality-repair");
    }
    assert.equal(budget.remainingTokens, finalBalance);
    assert.equal(budget.deadlineAt, 180000);
  }
});

test("grading front allocation respects small pools, used slots, cancellation and server-owned policy", async () => {
  for (const [remainingTokens, used, expectedMaxTokens] of [[1, 0, 1], [3, 0, 2], [100, 0, 75], [100, 1, 100]]) {
    const budget = { deadlineAt: 180000, remainingTokens, additionalAttemptsUsed: used };
    const calls = [];
    const controller = new AbortController();
    const result = await runTeachingUnit({ task: "grading", rulePack: gradingRules, budget, signal: controller.signal,
      input: { primaryTokenShare: 1, nested: { primaryTokenShare: 1 } } }, {
      now: () => 0, repairIssues: () => [], call: async (_route, messages, options) => {
        calls.push(options);
        assert.doesNotMatch(messages[1].content, /primaryTokenShare/);
        controller.abort();
        return { text: '{"title":"draft","primaryTokenShare":1}', usage: { completion_tokens: 0 } };
      }
    });
    assert.equal(result.status, "cancelled");
    assert.equal(result.candidate, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].maxTokens, expectedMaxTokens);
    assert.ok(budget.remainingTokens <= remainingTokens);
  }
});

test("default Sol grading uses the shared deadline and never retries an unavailable identical model", async () => {
  const calls = [];
  const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: gradingRules,
    budget: { deadlineAt: 180000, remainingTokens: 12000, additionalAttemptsUsed: 0 } }, {
    now: () => 0, repairIssues: () => [],
    call: async (route, _messages, options) => {
      calls.push({ route, options });
      throw failure(503);
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route.model, "gpt-6.1-sol");
  assert.equal(calls[0].route.reasoningEffort, "high");
  assert.equal(calls[0].options.timeoutMs, 180000);
  assert.equal(result.status, "review_required");
});

test("default Sol retains one bounded same-model structure repair", async () => {
  const calls = [];
  const result = await runTeachingUnit({ task: "generation", input: {}, rulePack,
    budget: { deadlineAt: 240000, remainingTokens: 24000, additionalAttemptsUsed: 0 } }, {
    now: () => 0, repairIssues: candidate => candidate.title ? [] : ["title_missing"],
    call: async route => {
      calls.push(route.model);
      return calls.length === 1 ? { text: "{}" } : good();
    }
  });
  assert.equal(result.status, "success");
  assert.deepEqual(calls, ["gpt-6.1-sol", "gpt-6.1-sol"]);
  assert.equal(result.internal.attempts[1].role, "quality-repair");
});
function setup(responses, overrides = {}) {
  const calls = [];
  const budget = { deadlineAt: 1000, remainingTokens: 100, additionalAttemptsUsed: 0 };
  let time = 0;
  const deps = {
    config: { TEACHING_PRIMARY_MODEL: "gpt-6-astra" },
    now: () => time,
    call: async (route, messages, options) => {
      calls.push({ route, messages, options });
      time += 100;
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    repairIssues: (candidate) => candidate.title ? [] : ["title_missing"],
    ...overrides
  };
  return { calls, budget, run: (input = {}) => runTeachingUnit({ task: "generation", input: { requirement: "original requirement" }, rulePack, budget, ...input }, deps) };
}

test("normal path loads actual rules and original requirements with one primary call", async () => {
  const task = setup([good()]);
  const result = await task.run();
  assert.equal(result.status, "success");
  assert.deepEqual(result.candidate, { title: "draft" });
  assert.equal(task.calls.length, 1);
  assert.equal(task.calls[0].route.model, "gpt-6-astra");
  assert.ok(task.calls[0].messages[0].content.includes(rulePack.text));
  assert.ok(task.calls[0].messages[0].content.includes(rulePack.hash));
  assert.match(task.calls[0].messages[1].content, /original requirement/);
  assert.equal(task.budget.remainingTokens, 90);
  assert.equal(result.internal.attempts[0].cost, "unknown");
});

test("availability uses Sol once; quality repair uses the primary once", async () => {
  for (const [responses, models] of [
    [[failure(503), good()], ["gpt-6-astra", "gpt-6.1-sol"]],
    [[{ text: "not JSON" }, good()], ["gpt-6-astra", "gpt-6-astra"]],
    [[{ text: "{}" }, good()], ["gpt-6-astra", "gpt-6-astra"]]
  ]) {
    const task = setup(responses);
    assert.equal((await task.run()).status, "success");
    assert.deepEqual(task.calls.map((call) => call.route.model), models);
    assert.equal(task.budget.additionalAttemptsUsed, 1);
    assert.equal(task.calls[1].options.timeoutMs, 900);
    assert.ok(task.calls[1].options.maxTokens <= task.budget.remainingTokens + 10);
  }
});

test("extra failures never create a third attempt or cross-model quality escalation", async () => {
  for (const responses of [[failure(503), { text: "{}" }], [{ text: "{}" }, failure(503)]]) {
    const task = setup(responses);
    const result = await task.run();
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
    assert.equal(task.calls.length, 2);
  }
});

test("configuration and evidence failures do not cause fallback", async () => {
  for (const error of [failure(401), failure(404, "model_not_found"), failure(429, "insufficient_quota"), failure(503, "OCR_EVIDENCE_MISSING")]) {
    const task = setup([error]);
    assert.equal((await task.run()).status, "review_required");
    assert.equal(task.calls.length, 1);
  }
  const task = setup([]);
  assert.equal((await task.run({ evidenceSufficient: false })).status, "review_required");
  assert.equal(task.calls.length, 0);
});

test("deadline, tokens, cancellation and consumed extra slot are enforced", async () => {
  for (const budget of [
    { deadlineAt: 0, remainingTokens: 100, additionalAttemptsUsed: 0 },
    { deadlineAt: 1000, remainingTokens: 0, additionalAttemptsUsed: 0 }
  ]) {
    const task = setup([]);
    assert.equal((await task.run({ budget })).status, "review_required");
    assert.equal(task.calls.length, 0);
  }
  const aborted = setup([]);
  assert.equal((await aborted.run({ signal: AbortSignal.abort() })).status, "cancelled");
  assert.equal(aborted.calls.length, 0);
  const exhausted = setup([failure(503)]);
  exhausted.budget.additionalAttemptsUsed = 1;
  await exhausted.run();
  assert.equal(exhausted.calls.length, 1);
  const deadline = setup([failure(503)]);
  deadline.budget.deadlineAt = 50;
  await deadline.run();
  assert.equal(deadline.calls.length, 1);
});

test("cancellation during a call discards the late result and does not retry", async () => {
  const controller = new AbortController();
  const task = setup([], { call: async (_route, _messages, options) => {
    assert.equal(options.signal.aborted, false);
    controller.abort();
    return good();
  } });
  const result = await task.run({ signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.candidate, null);
});

test("untrusted input cannot inject routes, rules, prompts, confirmation or budgets", async () => {
  const task = setup([{ text: JSON.stringify({ title: "draft", raw: "secret", debug: "secret", primaryTokenShare: 1, nested: { model: "private", primaryTokenShare: 1 } }) }]);
  const result = await task.run({ input: {
    requirement: "preserve this",
    model: "bad", provider: "bad", rulePack: { text: "bad" }, root: "outside", systemPrompt: "bad",
    budget: { remainingTokens: 999 }, confirmedBy: "forged", nested: { debug: "secret" }
  } });
  const sent = JSON.parse(task.calls[0].messages[1].content);
  assert.deepEqual(sent, { requirement: "preserve this", nested: {} });
  assert.deepEqual(result.candidate, { title: "draft", nested: {} });
  assert.equal(Object.hasOwn(result.internal, "raw"), false);
});

test("a domain validator and a matching trusted rule pack are required before calling", async () => {
  const invalid = setup([], { repairIssues: undefined });
  assert.equal((await invalid.run()).status, "review_required");
  const mismatched = setup([]);
  assert.equal((await mismatched.run({ task: "grading" })).status, "review_required");
  assert.equal(mismatched.calls.length, 0);
});

test("question prompt survives metadata filtering and late validation respects cancellation", async () => {
  const task = setup([{ text: JSON.stringify({ title: "draft", sections: [{ items: [{ prompt: "2+2?", answer: "4" }] }] }) }]);
  const result = await task.run({ input: { assignmentItems: [{ prompt: "2+2?" }] } });
  assert.equal(result.candidate.sections[0].items[0].prompt, "2+2?");
  assert.equal(JSON.parse(task.calls[0].messages[1].content).assignmentItems[0].prompt, "2+2?");
  const controller = new AbortController();
  const cancelled = setup([good()], { repairIssues: async () => { controller.abort(); return []; } });
  assert.equal((await cancelled.run({ signal: controller.signal })).status, "cancelled");
});

test("a stalled transport is aborted at the deadline without a replacement", async () => {
  let calls = 0;
  let transportSignal;
  const task = setup([], { now: Date.now, call: async (_route, _messages, options) => {
    calls++;
    transportSignal = options.signal;
    return new Promise(() => {});
  } });
  task.budget.deadlineAt = Date.now() + 30;
  const result = await task.run();
  assert.equal(result.status, "review_required");
  assert.equal(calls, 1);
  assert.equal(transportSignal.aborted, true);
  assert.equal(result.internal.attempts[0].failureCode, "TEACHING_DEADLINE");
  assert.equal(result.internal.attempts[0].triggerClass, "availability");
});

test("grading and reference primary timeouts leave time for one availability replacement", async () => {
  for (const task of ["grading", "reference"]) {
    let time = 0;
    const calls = [];
    const budget = { deadlineAt: 180000, remainingTokens: 12000, additionalAttemptsUsed: 0 };
    const result = await runTeachingUnit({ task, input: {}, rulePack: gradingRules, budget }, {
      config: { TEACHING_PRIMARY_MODEL: "gpt-6-astra" },
      now: () => time,
      repairIssues: () => [],
      call: async (route, _messages, options) => {
        calls.push({ route, options });
        if (calls.length === 1) {
          time += options.timeoutMs;
          throw failure(null, "TEACHING_DEADLINE");
        }
        time += 100;
        return good();
      }
    });
    assert.equal(result.status, "success");
    assert.deepEqual(calls.map(x => x.route.model), ["gpt-6-astra", "gpt-6.1-sol"]);
    assert.deepEqual(calls.map(x => x.options.timeoutMs), [120000, 60000]);
    assert.equal(result.internal.attempts[0].failureCode, "TEACHING_DEADLINE");
    assert.equal(result.internal.attempts[0].triggerClass, "availability");
    assert.equal(budget.additionalAttemptsUsed, 1);
  }
});

test("grading timeout respects exhaustion, cancellation and the single extra slot", async () => {
  for (const mode of ["exhausted", "cancelled", "replacement-failed", "slot-used"]) {
    let time = 0;
    let calls = 0;
    const controller = new AbortController();
    const budget = { deadlineAt: 180000, remainingTokens: 12000, additionalAttemptsUsed: mode === "slot-used" ? 1 : 0 };
    const result = await runTeachingUnit({ task: "grading", input: {}, rulePack: gradingRules, budget, signal: controller.signal }, {
      config: { TEACHING_PRIMARY_MODEL: "gpt-6-astra" },
      now: () => time,
      repairIssues: () => [],
      call: async (_route, _messages, options) => {
        calls++;
        time += mode === "exhausted" ? 180000 : options.timeoutMs;
        if (mode === "cancelled") controller.abort();
        throw failure(null, "TEACHING_DEADLINE");
      }
    });
    assert.equal(calls, mode === "replacement-failed" ? 2 : 1);
    assert.equal(result.status, mode === "cancelled" ? "cancelled" : "review_required");
    assert.equal(result.candidate, null);
    assert.ok(time <= 180000);
  }
});

test("grading quality repair stays on primary and short budgets never extend the deadline", async () => {
  for (const [responses, deadlineAt, expectedModels, expectedTimeouts] of [
    [[{ text: "{}" }, good()], 180000, ["gpt-6-astra", "gpt-6-astra"], [120000, 179900]],
    [[failure(null, "TEACHING_DEADLINE")], 50, ["gpt-6-astra"], [50]],
    [[failure(401)], 180000, ["gpt-6-astra"], [120000]],
    [[failure(503, "OCR_EVIDENCE_MISSING")], 180000, ["gpt-6-astra"], [120000]]
  ]) {
    const task = setup(responses);
    task.budget.deadlineAt = deadlineAt;
    const result = await task.run({ task: "grading", rulePack: gradingRules });
    assert.deepEqual(task.calls.map(x => x.route.model), expectedModels);
    assert.deepEqual(task.calls.map(x => x.options.timeoutMs), expectedTimeouts);
    assert.equal(result.status, expectedModels.length === 2 ? "success" : "review_required");
  }
});

test("diagnostics distinguish invalid JSON from domain fields without retaining raw output", async () => {
  const task = setup([{ text: "SECRET invalid json" }, { text: "{}" }]);
  const result = await task.run();
  assert.equal(result.internal.attempts[0].failureCode, "invalid_json");
  assert.deepEqual(result.internal.attempts[1].validationIssueCodes, ["title_missing"]);
  assert.doesNotMatch(JSON.stringify(result.internal), /SECRET/);
});

test("public projections never expose internal attempts or unconfirmed student drafts", async () => {
  const result = await setup([good()]).run();
  const teacher = projectTeachingResult(result, "teacher");
  assert.deepEqual(teacher, { status: "draft", candidate: { title: "draft" }, needsTeacherReview: true });
  for (const role of ["student", "parent", "unknown"]) {
    assert.deepEqual(projectTeachingResult(result, role), { status: "review_required" });
  }
});

test("upstream diagnostics retain bounded status and known codes without secrets or extra calls", async () => {
  const cases = [
    [failure(400, "unsupported_parameter"), 400, "unsupported_parameter", "http_error"],
    [failure(429, "insufficient_quota"), 429, "insufficient_quota", "http_error"],
    [Object.assign(new Error("fetch failed at https://private.test/key SECRET"), { cause: { code: "ECONNRESET" } }), null, "ECONNRESET", "transport_error"],
    [failure(200, "invalid_upstream_response"), 200, "invalid_upstream_response", "invalid_upstream_response"],
    [failure(503, "SECRET https://private.test/key"), 503, "unknown", "http_error"],
    [failure(900, "SECRET"), null, "unknown", "unknown_failure"],
    [new Error("SECRET 401 https://private.test/key"), null, null, "unknown_failure"]
  ];
  for (const [error, status, code, failureCode] of cases) {
    const task = setup([error]);
    task.budget.additionalAttemptsUsed = 1;
    const result = await task.run();
    const attempt = result.internal.attempts[0];
    assert.equal(attempt.upstreamStatus, status);
    assert.equal(attempt.upstreamCode, code);
    assert.equal(attempt.failureCode, failureCode);
    assert.equal(task.calls.length, 1);
    assert.equal(task.budget.remainingTokens, 0);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private\.test/);
    for (const role of ["teacher", "student", "parent"]) {
      assert.doesNotMatch(JSON.stringify(projectTeachingResult(result, role)), /upstream|failureCode|triggerClass/);
    }
  }
});

test("generation diagnostics preserve known failure codes but never arbitrary partition identifiers or text", async () => {
  const task = setup([good()], { repairIssues: () => ["rubric_score_conflict", "partition_score_mismatch",
    "partition:PRIVATE_PARTITION:incomplete_item", "partition:PRIVATE_PARTITION:PRIVATE_TEXT", "PRIVATE_TEXT"] });
  task.budget.additionalAttemptsUsed = 1;
  const result = await task.run();
  assert.equal(result.candidate, null);
  assert.deepEqual(result.internal.attempts[0].validationIssueCodes,
    ["rubric_score_conflict", "partition_score_mismatch", "incomplete_item", "domain_validation_failed"]);
  assert.doesNotMatch(JSON.stringify(result.internal), /PRIVATE_/);
});

test("encoding defects and model names in prose fail closed after a bounded repair", async () => {
  for (const title of ["gpt-6-astra generated this", String.fromCodePoint(0xfffd)]) {
    const task = setup([{ text: JSON.stringify({ title }) }, { text: JSON.stringify({ title }) }]);
    const result = await task.run();
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
    assert.equal(task.calls.length, 2);
  }
});

test("channel accounting keeps missing usage unknown and charges reported overages without new retries", async () => {
  for (const [usage, remaining, reported, exceeds] of [
    [undefined, 50, null, null],
    [{ completion_tokens: 0 }, 100, 0, false],
    [{ completion_tokens: 150, completion_tokens_details: { reasoning_tokens: 100 } }, 0, 150, true]
  ]) {
    const task = setup([{ text: '{"title":"draft"}', usage,
      completionDiagnostics: { limitField: "max_tokens", finishReason: "length" } }]);
    const result = await task.run();
    assert.equal(result.status, "success");
    assert.equal(task.calls.length, 1);
    assert.equal(task.budget.remainingTokens, remaining);
    assert.deepEqual(result.internal.attempts[0].completionDiagnostics, {
      limitField: "max_tokens", finishReason: "length", reportedOutputTokens: reported, exceedsRequestedLimit: exceeds
    });
    assert.equal(result.internal.attempts[0].cost, "unknown");
  }
});
