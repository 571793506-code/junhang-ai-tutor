# GPT-5.6 Sol Escalation Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `gpt-5.6-terra` as the normal generation and grading model while escalating only eligible failed units once to `gpt-5.6-sol` with `reasoning_effort=high` and an independent fallback budget.

**Architecture:** Add a small pure escalation-policy module for error classification and capability gates, then let the AI runtime perform model-specific calls and assessment-partition replacement. Keep project-content validation, grading evidence checks, question selection, score recomputation, teacher-review gates, and pipeline state in the services package. Sol is terminal for an escalated unit; successful model escalation is recorded separately from local dynamic fallback.

**Tech Stack:** Node.js ESM, native `fetch`, `node:test`, existing `@junhang/ai` and `@junhang/services` packages, OpenAI-compatible Chat Completions, PowerShell/`npm.cmd`.

---

## File Structure

- Create `packages/ai/src/model-escalation.js`: pure error serialization/classification, Sol capability gate, and assessment-partition hard validation.
- Create `packages/ai/src/model-escalation.test.mjs`: table-driven classifier, gate, and partition validation tests.
- Modify `packages/ai/src/runtime.js`: Sol config, preserved error details, model-overridable structured calls, assessment partition escalation, and escalation metadata.
- Modify `packages/ai/src/index.js` and `packages/ai/src/index.d.ts`: expose the new pure helpers and runtime option types.
- Modify `packages/ai/src/gpt56-runtime.test.mjs` and `packages/ai/src/assessment-runtime.test.mjs`: request-payload and fake-server routing coverage.
- Modify `packages/services/src/index.js`: reference-answer quality escalation, grading evidence gate, dispute-question selection and merge, score recomputation, and generation pipeline metadata.
- Modify `packages/services/src/assessment-draft-review.test.mjs`, `packages/services/src/deterministic-grading.test.mjs`, and `packages/services/src/grading-audit-gates.test.mjs`: service-level behavior tests.
- Modify `scripts/gpt56-capability-check.mjs` and its test: probe Terra and Sol independently with synthetic inputs.
- Create `scripts/sol-escalation-quality-check.mjs` and `scripts/sol-escalation-quality-check.test.mjs`: force Sol as the tested model through internal runner options without changing the public API.
- Modify `scripts/generation-quality-check.mjs` and its test: report model escalation separately from dynamic fallback and export reusable quality cases.
- Modify `.env.example`, local `.env`, `package.json`, `skills/generation/SKILLS.md`, `skills/grading/SKILLS.md`, `docs/14-api-contract.md`, and `docs/41-prompt-context-engineering-playbook.md`: configuration, commands, and project rules.

### Task 1: Escalation Policy And Runtime Configuration

**Files:**
- Create: `packages/ai/src/model-escalation.js`
- Create: `packages/ai/src/model-escalation.test.mjs`
- Modify: `packages/ai/src/runtime.js:90-140,285-326,432-445`
- Modify: `packages/ai/src/index.js`
- Modify: `packages/ai/src/index.d.ts`
- Modify: `packages/ai/src/gpt56-runtime.test.mjs`

- [x] **Step 1: Write failing config and policy tests**

Add table-driven cases proving that timeout, `524`, transient `429`, and `ECONNRESET` allow Sol; authentication, invalid requests, context length, and `insufficient_quota` do not. Also assert normalized config defaults and explicit overrides.

```js
test("Sol escalation distinguishes transient failures from configuration failures", () => {
  const cases = [
    [{ message: "MODEL_TIMEOUT after 90000ms" }, true, "availability"],
    [{ status: 524, message: "upstream timeout" }, true, "availability"],
    [{ status: 429, code: "rate_limit_exceeded", message: "temporary rate limit" }, true, "availability"],
    [{ code: "ECONNRESET", message: "socket reset" }, true, "availability"],
    [{ status: 401, message: "invalid key" }, false, "configuration"],
    [{ status: 400, code: "context_length_exceeded", message: "too long" }, false, "configuration"],
    [{ status: 429, code: "insufficient_quota", message: "quota exhausted" }, false, "configuration"]
  ];
  for (const [error, allowed, triggerClass] of cases) {
    assert.deepEqual(classifySolEscalationError(error), {
      allowed,
      triggerClass,
      triggerCode: error.code || String(error.status || "network")
    });
  }
});

test("normalizeRuntimeConfig exposes disabled Sol defaults", () => {
  const runtime = normalizeRuntimeConfig({});
  assert.equal(runtime.gpt56SolFallbackEnabled, false);
  assert.equal(runtime.gpt56SolModel, "gpt-5.6-sol");
  assert.equal(runtime.gpt56SolFallbackTimeoutMs, 180000);
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test packages\ai\src\model-escalation.test.mjs packages\ai\src\gpt56-runtime.test.mjs
```

Expected: FAIL because `model-escalation.js` and Sol runtime fields do not exist.

- [x] **Step 3: Implement the pure policy module**

Create focused exports with no network calls:

```js
const TRANSIENT_STATUS = new Set([408, 500, 502, 503, 504, 524]);
const TRANSIENT_CODE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT/i;
const CONFIGURATION_CODE = /insufficient_quota|context_length|invalid_(api_)?key|invalid_request|model_not_found/i;

export function describeModelError(error = {}) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || message.match(/^\s*(\d{3})\b/)?.[1]) || null;
  const code = String(error?.code || "").trim() || null;
  return { message, status, code };
}

export function classifySolEscalationError(error = {}) {
  const detail = describeModelError(error);
  const text = `${detail.code || ""} ${detail.message}`;
  const quotaOrConfig = detail.status === 401 || detail.status === 403 ||
    CONFIGURATION_CODE.test(text) || /balance|billing|额度|余额|账户/.test(text);
  if (quotaOrConfig) {
    return { allowed: false, triggerClass: "configuration", triggerCode: detail.code || String(detail.status || "configuration") };
  }
  const transient429 = detail.status === 429 && /rate|limit|capacity|concurr|限流|并发|拥塞/i.test(text);
  const transient = /MODEL_TIMEOUT/i.test(text) || TRANSIENT_STATUS.has(detail.status) || transient429 || TRANSIENT_CODE.test(text);
  return transient
    ? { allowed: true, triggerClass: "availability", triggerCode: detail.code || String(detail.status || "network") }
    : { allowed: false, triggerClass: "configuration", triggerCode: detail.code || String(detail.status || "configuration") };
}

export function solEscalationEnabled(runtime = {}) {
  return runtime.gpt56SolFallbackEnabled === true &&
    runtime.gpt56ReasoningEffortEnabled === true &&
    Boolean(runtime.gpt56SolModel);
}
```

- [x] **Step 4: Preserve structured error details and add config**

Extend `normalizeRuntimeConfig`:

```js
gpt56SolFallbackEnabled: String(config.GPT56_SOL_FALLBACK_ENABLED ?? config.gpt56SolFallbackEnabled ?? "false").toLowerCase() === "true",
gpt56SolModel: config.GPT56_SOL_MODEL || config.gpt56SolModel || "gpt-5.6-sol",
gpt56SolFallbackTimeoutMs: Number(config.GPT56_SOL_FALLBACK_TIMEOUT_MS || config.gpt56SolFallbackTimeoutMs || 180000),
```

When `callOpenAiCompatibleChat` throws for a non-2xx response, attach `status` and the upstream structured code. Make `timedCall` retain `errorDetails` in addition to its existing string `error`, so callers can classify without parsing display text.

```js
const requestError = new Error(`${response.status} ${message}`);
requestError.status = response.status;
requestError.code = body?.error?.code || body?.code || null;
throw requestError;

// timedCall catch result
error: details.message,
errorDetails: details
```

Export the pure helpers through `index.js` and declare their exact return shapes in `index.d.ts`.

- [x] **Step 5: Run tests and verify GREEN**

Run the command from Step 2. Expected: all policy and existing GPT-5.6 runtime tests PASS.

- [x] **Step 6: Commit Task 1**

```powershell
git add -- packages/ai/src/model-escalation.js packages/ai/src/model-escalation.test.mjs packages/ai/src/runtime.js packages/ai/src/index.js packages/ai/src/index.d.ts packages/ai/src/gpt56-runtime.test.mjs
git commit -m "feat: classify GPT-5.6 Sol escalation"
```

### Task 2: Terra And Sol Capability Probe

**Files:**
- Modify: `scripts/gpt56-capability-check.mjs`
- Modify: `scripts/gpt56-capability-check.test.mjs`
- Modify: `.env.example`

- [x] **Step 1: Write failing dual-target probe tests**

```js
test("capability check builds Terra and enabled Sol targets", () => {
  assert.deepEqual(buildGpt56ProbeTargets({
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_ENABLED: "true"
  }), [
    { role: "primary", model: "gpt-5.6-terra", required: true },
    { role: "sol-fallback", model: "gpt-5.6-sol", required: true }
  ]);
});

test("Sol reasoning probe always uses high", () => {
  const reasoning = buildGpt56ProbeCases("gpt-5.6-sol", { reasoningEffort: "high" })
    .find((item) => item.id === "reasoning_effort");
  assert.equal(reasoning.payload.reasoning_effort, "high");
});
```

- [x] **Step 2: Verify RED**

Run:

```powershell
node --test scripts\gpt56-capability-check.test.mjs
```

Expected: FAIL because probe targets/options are not implemented.

- [x] **Step 3: Implement per-model probe summaries**

Add `buildGpt56ProbeTargets(env)` and let `buildGpt56ProbeCases` accept `{ reasoningEffort }`. Run the existing synthetic cases for each target and return:

```js
{
  ok: targets.every((target) => !target.required || target.ok),
  baseUrl,
  targets: [
    { role: "primary", model: "gpt-5.6-terra", ok: true, checks: [] },
    { role: "sol-fallback", model: "gpt-5.6-sol", ok: true, checks: [] }
  ]
}
```

The Sol target is required only when `GPT56_SOL_FALLBACK_ENABLED=true`; it must still be probeable explicitly while disabled through `--include-sol`. Keep all inputs synthetic.

- [x] **Step 4: Add documented disabled defaults**

Append to `.env.example`:

```dotenv
GPT56_SOL_FALLBACK_ENABLED=false
GPT56_SOL_MODEL=gpt-5.6-sol
GPT56_SOL_FALLBACK_TIMEOUT_MS=180000
```

Keep `check:gpt56` as the single command; do not add a duplicate capability script.

- [x] **Step 5: Verify GREEN and commit**

```powershell
node --test scripts\gpt56-capability-check.test.mjs packages\ai\src\gpt56-runtime.test.mjs
git add -- scripts/gpt56-capability-check.mjs scripts/gpt56-capability-check.test.mjs .env.example
git commit -m "feat: probe GPT-5.6 Sol capabilities"
```

Expected: tests PASS; no real network call occurs in unit tests.

### Task 3: Assessment Partition Escalation

**Files:**
- Modify: `packages/ai/src/model-escalation.js`
- Modify: `packages/ai/src/model-escalation.test.mjs`
- Modify: `packages/ai/src/runtime.js:768-958`
- Modify: `packages/ai/src/assessment-runtime.test.mjs`
- Modify: `packages/ai/src/index.d.ts`

- [x] **Step 1: Write failing hard-validation tests**

Add `validateAssessmentPartition(parsed, partition)` cases for empty sections, disallowed item types, and missing required answer/analysis/knowledge fields.

```js
assert.deepEqual(validateAssessmentPartition({ sections: [] }, partition).codes, ["missing_sections"]);
assert.ok(validateAssessmentPartition({
  sections: [{ items: [{ itemType: "fill", prompt: "1+1=?" }] }]
}, partition).codes.includes("incomplete_item"));
```

- [x] **Step 2: Write fake-server escalation tests**

Add tests that distinguish requests by `payload.model` and prove:

1. one Terra partition returning `524` causes exactly that partition to call Sol once;
2. Terra malformed model JSON is classified as `quality` and replaced by Sol;
3. all Terra partitions failing causes every original partition to run once with Sol, at concurrency no greater than 2;
4. `401`, quota exhaustion, disabled gate, and failed evidence do not call Sol;
5. Sol always receives `reasoning_effort=high`, the original partition token cap, and the independent timeout;
6. Sol failure does not automatically call DeepSeek;
7. a valid Terra-only run sends no Sol request and preserves current timing and effort.

```js
assert.equal(solPayloads.length, 1);
assert.equal(solPayloads[0].model, "gpt-5.6-sol");
assert.equal(solPayloads[0].reasoning_effort, "high");
assert.equal(result.modelRun.metadata.usedModelEscalation, true);
assert.equal(result.modelRun.metadata.partialGeneration, false);
assert.equal(result.modelRun.metadata.attempts.filter((item) => item.role === "sol-escalation").length, 1);
```

- [x] **Step 3: Run tests and verify RED**

```powershell
node --test packages\ai\src\model-escalation.test.mjs packages\ai\src\assessment-runtime.test.mjs
```

Expected: new escalation assertions FAIL while existing assessment tests remain green.

- [x] **Step 4: Generalize partition execution without changing the public request contract**

Change the signature to accept internal execution options:

```js
export async function draftAssessment(config, input = {}, execution = {})
```

Refactor only the partition call so it accepts:

```js
const callPartition = async (partition, index, {
  role = "primary",
  model = runtime.gpt56Model,
  reasoningEffort = kind === "试卷" ? "high" : "medium",
  timeoutMs = attemptTimeoutMs(assessmentTimeoutMs),
  trigger = null
} = {}) => {
  const partitionTokens = partitionTokenBudget(index);
  const partitionMessages = messages.map((message) => message.role !== "user" ? message : {
    ...message,
    content: `${message.content}\n\n本次只生成分区：${partition.title}。允许题型：${partition.itemTypes.join(", ")}。${trigger?.issues?.length ? `必须修复：${trigger.issues.join("；")}。` : ""}`
  });
  const result = await timedCall(() => callGpt56Chat(config, partitionMessages, {
    model,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    maxTokens: partitionTokens,
    timeoutMs,
    reasoningEffort
  }));
  recordAttempt(role, partition, result, { model, reasoningEffort, trigger });
  return { partition, index, partitionTokens, result };
};
```

Do not expose `execution.model` through API request bodies; it is only for service/test runner injection.

- [x] **Step 5: Replace eligible failed units once with Sol**

Implement the partition validator in `model-escalation.js`:

```js
export function validateAssessmentPartition(parsed = {}, partition = {}) {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const items = sections.flatMap((section) => Array.isArray(section?.items) ? section.items : []);
  const codes = [];
  if (!sections.length) codes.push("missing_sections");
  if (!items.length) codes.push("missing_items");
  const allowed = new Set(partition.itemTypes || []);
  if (items.some((item) => item?.itemType && allowed.size && !allowed.has(item.itemType))) codes.push("disallowed_item_type");
  if (items.some((item) => !item?.prompt || !item?.answer || !Array.isArray(item?.analysisSteps) || !item.analysisSteps.length || (!item?.knowledgePoint && !item?.commonMistake))) {
    codes.push("incomplete_item");
  }
  const uniqueCodes = [...new Set(codes)];
  return {
    valid: uniqueCodes.length === 0,
    codes: uniqueCodes,
    issues: uniqueCodes.map((code) => `partition:${partition.id || "unknown"}:${code}`)
  };
}
```

After the Terra batch, parse and hard-validate every partition. Treat a readable but invalid model message as `{ allowed: true, triggerClass: "quality", triggerCode: "partition_validation", issues }`. When Sol is enabled, replace eligible failures with one Sol call per failed unit. Give partial failures `runtime.gpt56SolFallbackTimeoutMs`; when all Terra units are unusable, create a new Sol total-budget clock using the original scene budget. Preserve max concurrency 2.

Record each attempt with its real model and trigger:

```js
{
  role: "sol-escalation",
  partitionId: partition.id,
  providerId: "gpt56",
  model: runtime.gpt56SolModel,
  reasoningEffort: "high",
  triggerClass: trigger.triggerClass,
  triggerCode: trigger.triggerCode,
  triggerIssues: trigger.issues || [],
  status: result.status,
  latencyMs: result.latencyMs,
  error: result.error || null
}
```

Set metadata fields `primaryModel`, `escalationModel`, `escalationTriggered`, `usedModelEscalation`, `escalationScopes`, and the Sol budget. Set `partialGeneration` only from the final post-Sol partition set. Skip automatic DeepSeek rollback whenever a Sol attempt occurred.

- [x] **Step 6: Verify GREEN and commit**

```powershell
node --test packages\ai\src\model-escalation.test.mjs packages\ai\src\assessment-runtime.test.mjs packages\ai\src\gpt56-runtime.test.mjs
git add -- packages/ai/src/model-escalation.js packages/ai/src/model-escalation.test.mjs packages/ai/src/runtime.js packages/ai/src/assessment-runtime.test.mjs packages/ai/src/index.d.ts
git commit -m "feat: escalate failed assessment partitions to Sol"
```

### Task 4: Generation Pipeline State And Quality Acceptance

**Files:**
- Modify: `packages/services/src/index.js:3400-3525,3652-3848`
- Modify: `packages/services/src/assessment-draft-review.test.mjs`
- Modify: `scripts/generation-quality-check.mjs`
- Modify: `scripts/generation-quality-check.test.mjs`

- [x] **Step 1: Write failing service-state tests**

Use a valid fake assessment result whose metadata contains a successful Sol escalation. Assert that it stays a real model draft, not dynamic repair.

```js
assert.equal(result.usedModelEscalation, true);
assert.equal(result.usedDynamicFallback, false);
assert.equal(result.generationPipeline.model.escalationModel, "gpt-5.6-sol");
assert.equal(result.generationPipeline.repair.usedDynamicFallback, false);
```

Also assert that Sol failure followed by local item-pool repair still sets `usedDynamicFallback=true` and `needs_teacher_review`.

- [x] **Step 2: Write failing quality-evaluator tests**

Add a successful model-escalation sample:

```js
const check = evaluateGenerationQualityResult(sample, {
  modelAvailable: true,
  draftAvailable: true,
  usedModelEscalation: true,
  usedDynamicFallback: false,
  // valid draft and pipeline data
});
assert.equal(check.ok, true);
assert.equal(check.detail.usedModelEscalation, true);
```

- [x] **Step 3: Verify RED**

```powershell
node --test packages\services\src\assessment-draft-review.test.mjs scripts\generation-quality-check.test.mjs
```

- [x] **Step 4: Propagate model escalation separately**

Read `result.modelRun.metadata.usedModelEscalation` into normalized draft output and `generationPipeline.model`, but keep the existing dynamic fallback expression limited to final missing/partial model content:

```js
const usedModelEscalation = result.modelRun?.metadata?.usedModelEscalation === true;
const usedDynamicFallback = !result.available || !items.length || result.modelRun?.metadata?.partialGeneration === true;
```

Expose `usedModelEscalation` in service output and quality diagnostics. Do not weaken any audit or teacher-review gate.

- [x] **Step 5: Verify GREEN and commit**

```powershell
node --test packages\services\src\assessment-draft-review.test.mjs scripts\generation-quality-check.test.mjs
git add -- packages/services/src/index.js packages/services/src/assessment-draft-review.test.mjs scripts/generation-quality-check.mjs scripts/generation-quality-check.test.mjs
git commit -m "feat: report Sol generation escalation"
```

### Task 5: Reference Answer And Grading Escalation

**Files:**
- Modify: `packages/ai/src/runtime.js:960-1108`
- Modify: `packages/ai/src/gpt56-runtime.test.mjs`
- Modify: `packages/ai/src/index.d.ts`
- Modify: `packages/services/src/index.js:588-653,1315-1461,3852-4011`
- Modify: `packages/services/src/deterministic-grading.test.mjs`
- Modify: `packages/services/src/grading-audit-gates.test.mjs`

- [x] **Step 1: Write failing runtime availability-escalation tests**

For reference answers and grading, make Terra return `524`, Sol return valid JSON, and assert exactly two total requests, Sol `high`, `180000ms` timeout metadata, and no third model call. Add quota/configuration cases that never call Sol.

- [x] **Step 2: Write failing service quality-escalation tests**

Cover:

- low-confidence generated reference answers with clear printed text are regenerated once with Sol;
- missing printed question evidence never calls Sol;
- `uncertain`, confidence `<0.62`, answer conflict, and score mismatch select only affected question numbers;
- poor image quality, missing student answer, missing prompt, and unseparated OCR evidence do not call Sol;
- a successful Sol result replaces only selected question results and total score is recomputed;
- Sol unresolved results preserve `provisionalScore`, clear final score, and do not run the old Terra risk reviewer afterward;
- fully deterministic objective grading never calls Terra or Sol.

Use injected `referenceAnswerRunner`, `gradingRunner`, and `solGradingRunner` counters so tests are deterministic.

```js
assert.deepEqual(solInputs[0].ocrQuestions.map((item) => item.questionNo), ["2"]);
assert.equal(premiumReviewCalls, 0);
assert.equal(result.structured.questionResults.find((item) => item.questionNo === "1").modelEscalated, undefined);
assert.equal(result.structured.questionResults.find((item) => item.questionNo === "2").modelEscalated, true);
```

- [x] **Step 3: Run tests and verify RED**

```powershell
node --test packages\ai\src\gpt56-runtime.test.mjs packages\services\src\deterministic-grading.test.mjs packages\services\src\grading-audit-gates.test.mjs
```

- [x] **Step 4: Add internal model execution options**

Extend these signatures without changing existing callers:

```js
export async function generateSubmissionReferenceAnswers(config, input = {}, execution = {})
export async function gradeSubmissionText(config, input = {}, execution = {})
```

`execution` may contain only internal `model`, `timeoutMs`, `reasoningEffort`, `role`, and `disableSolEscalation`. Default calls use Terra; forced Sol calls always override effort to `high`. Availability failures use `classifySolEscalationError` and at most one Sol attempt.

- [x] **Step 5: Add evidence-aware service helpers**

Keep pure helpers near existing grading quality logic:

```js
function hasSufficientSolGradingEvidence(input, ocr, reference) {
  const imageBlocked = ["poor", "needs_review"].includes(String(ocr.imageQuality?.status || "").toLowerCase());
  const hasStudentWork = Boolean(input.studentAnswerText || ocr.studentAnswerText || ocr.questions?.some((item) => String(item.studentAnswer || "").trim()));
  const hasPrompt = Boolean(input.printedText || ocr.printedText || ocr.questions?.some((item) => String(item.printedPrompt || "").trim()));
  return !imageBlocked && hasStudentWork && hasPrompt && reference.available;
}

function selectSolGradingQuestions(structured, input, ocr, reference) {
  if (!hasSufficientSolGradingEvidence(input, ocr, reference)) return [];
  return structured.questionResults.filter((item) =>
    item.status === "uncertain" || Number(item.confidence ?? 1) < 0.62 || structured.quality?.scoreMismatch === true
  );
}
```

Build a filtered input from matching `ocrQuestions`, `referenceAnswers`, and layout-manifest questions. Merge Sol results by `questionNo`, mark only replacements with `modelEscalated=true`, rerun `normalizeGradingResult`, and recompute score from question results.

- [x] **Step 6: Replace automatic Terra risk review when Sol is active**

When Sol is enabled and evidence is sufficient, the Sol regrade is the single risk operation. Do not call the existing automatic Terra premium reviewer afterward. Preserve explicitly injected legacy double-review behavior only for explicit `deepAuditRequired` tests/config; it must not chain after an actual Sol attempt.

If Sol still leaves risk, create a local blocking audit result with `scoreReliable=false` and `archiveAllowed=false`; do not call another text model.

- [x] **Step 7: Verify GREEN and commit**

```powershell
node --test packages\ai\src\gpt56-runtime.test.mjs packages\services\src\deterministic-grading.test.mjs packages\services\src\grading-audit-gates.test.mjs
git add -- packages/ai/src/runtime.js packages/ai/src/gpt56-runtime.test.mjs packages/ai/src/index.d.ts packages/services/src/index.js packages/services/src/deterministic-grading.test.mjs packages/services/src/grading-audit-gates.test.mjs
git commit -m "feat: escalate grading risks to Sol"
```

### Task 6: Sol Quality Command And Project Rules

**Files:**
- Create: `scripts/sol-escalation-quality-check.mjs`
- Create: `scripts/sol-escalation-quality-check.test.mjs`
- Modify: `scripts/generation-quality-check.mjs`
- Modify: `package.json`
- Modify: `skills/generation/SKILLS.md`
- Modify: `skills/grading/SKILLS.md`
- Modify: `docs/14-api-contract.md`
- Modify: `docs/41-prompt-context-engineering-playbook.md`

- [x] **Step 1: Write failing Sol quality-command tests**

Test that the command reuses existing project cases, injects Sol only through the internal runner options, forces `high`, and rejects local dynamic fallback.

```js
assert.deepEqual(buildSolQualityCases().map((item) => item.name), [
  "数学-小测",
  "语文-小测",
  "英语-小测",
  "数学-小升初正式试卷",
  "英语-个性化练习",
  "语文-阅读表达练习"
]);
assert.deepEqual(buildSolExecutionOptions(), {
  role: "sol-quality-check",
  reasoningEffort: "high",
  disableSolEscalation: true
});
```

- [x] **Step 2: Verify RED**

```powershell
node --test scripts\sol-escalation-quality-check.test.mjs scripts\generation-quality-check.test.mjs
```

- [x] **Step 3: Implement the real-quality command**

Export the reusable quality cases from `generation-quality-check.mjs`. In the new command, call `draftAssessmentService` with an injected `assessmentDraftRunner` that invokes:

```js
draftAssessment(config, input, {
  model: runtime.gpt56SolModel,
  reasoningEffort: "high",
  timeoutMs: runtime.gpt56SolFallbackTimeoutMs,
  role: "sol-quality-check",
  disableSolEscalation: true
});
```

Require `modelAvailable=true`, `usedDynamicFallback=false`, project audit pass, correct totals, required item types, answers, analysis, and knowledge fields. Output machine-readable model/effort/latency diagnostics.

- [x] **Step 4: Add command and update project rules**

Add:

```json
"check:generation:quality:sol": "node scripts/run-with-env.mjs node scripts/sol-escalation-quality-check.mjs"
```

Document the exact trigger classes, evidence exclusion, one-attempt rule, independent budget, hidden model metadata, teacher review, and the fact that Sol availability does not prove grading accuracy without teacher gold data.

- [x] **Step 5: Verify GREEN and commit**

```powershell
node --test scripts\sol-escalation-quality-check.test.mjs scripts\generation-quality-check.test.mjs
.\jh.cmd check:encoding
git add -- scripts/sol-escalation-quality-check.mjs scripts/sol-escalation-quality-check.test.mjs scripts/generation-quality-check.mjs package.json skills/generation/SKILLS.md skills/grading/SKILLS.md docs/14-api-contract.md docs/41-prompt-context-engineering-playbook.md
git commit -m "test: add Sol escalation quality gate"
```

### Task 7: Full Verification, Local Enablement, And Closeout

**Files:**
- Modify locally only after acceptance: `.env`
- Modify: `docs/superpowers/plans/2026-07-10-gpt56-sol-escalation-fallback.md` (completion checkboxes and evidence)

- [x] **Step 1: Run all focused automated tests**

```powershell
$aiTests = Get-ChildItem packages\ai\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $aiTests
$serviceTests = Get-ChildItem packages\services\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $serviceTests
node --test scripts\gpt56-capability-check.test.mjs scripts\generation-quality-check.test.mjs scripts\sol-escalation-quality-check.test.mjs scripts\grading-quality-check.test.mjs
```

Expected: all tests PASS with zero failures.

- [x] **Step 2: Run project-local checks**

```powershell
cmd /c npm.cmd run check:generation:blueprint
.\jh.cmd check:api
npm.cmd run typecheck --workspace apps/web
.\jh.cmd check:miniprogram-js
cmd /c npm.cmd run check:services
.\jh.cmd check:encoding
```

Expected: every command exits `0`. The API summary must keep provider/model internals out of student-facing payloads.

- [x] **Step 3: Probe Terra and Sol on the real intermediary**

Run with Sol included while fallback remains disabled:

```powershell
cmd /c npm.cmd run check:gpt56 -- --include-sol
```

Required Sol checks: text, `json_object`, `reasoning_effort=high`, JSON Schema, and synthetic project grading JSON all pass. Image input may remain unsupported because MiniMax retains OCR.

- [x] **Step 4: Run real generation acceptance samples**

```powershell
cmd /c npm.cmd run check:generation:quality:sol
cmd /c npm.cmd run check:generation:quality:quiz
cmd /c npm.cmd run check:generation:quality:formal
```

Expected: six Sol samples and the normal Terra samples pass with `usedDynamicFallback=false`. Record per-sample latency and any intermediary `524`; one transient failure may be rerun unchanged once for diagnosis, but both attempts must be reported.

- [x] **Step 5: Handle grading accuracy honestly**

Use the project acceptance path `materials\evaluation\teacher-grading-gold-cases.json` when a teacher-confirmed file exists:

```powershell
$goldPath = 'materials\evaluation\teacher-grading-gold-cases.json'
if (Test-Path -LiteralPath $goldPath) {
  & npm.cmd run check:grading:quality -- $goldPath
} else {
  Write-Output 'Teacher grading gold file is not available; production grading accuracy remains unverified.'
}
```

If no gold file exists, record the missing operational acceptance gate. Do not claim production grading accuracy from synthetic probe data.

- [x] **Step 6: Enable Sol only after Steps 3-4 pass**

Update local ignored `.env` without exposing its key/base URL:

```dotenv
GPT56_SOL_FALLBACK_ENABLED=true
GPT56_SOL_MODEL=gpt-5.6-sol
GPT56_SOL_FALLBACK_TIMEOUT_MS=180000
```

Rerun `check:api`, `check:services`, and the focused fake-server tests to confirm the enabled gate does not change normal Terra requests.

- [x] **Step 7: Review scope and close out explicitly**

```powershell
git diff --check
cmd /c npm.cmd run workspace:guard
git status --short --branch
```

Review changed files by group. Preserve ignored local assets and unrelated user changes. Never use `git add .`.

- [x] **Step 8: Commit the completion record**

```powershell
git add -- docs/superpowers/plans/2026-07-10-gpt56-sol-escalation-fallback.md
git commit -m "docs: close GPT-5.6 Sol fallback rollout"
```

Do not push unless the user explicitly requests the remote update after reviewing the final workspace state.

## Completion Evidence (2026-07-11)

- Focused automated tests: AI `57/57`, services `42/42`, and capability/generation/Sol/grading scripts `30/30`; zero failures.
- Project checks: generation blueprint, API check, Web typecheck, miniprogram JavaScript check, service smoke, and source encoding check all exited `0`; encoding checked 251 files with zero issues.
- Real capability probe with fallback still disabled: Terra and Sol passed text, `json_object`, reasoning effort, JSON Schema, and synthetic project grading JSON. Image input returned `500` for both and remains outside this text-model gate because MiniMax owns OCR. No `524` or retry occurred.
- Forced Sol quality: `6/6` passed with `high` effort and `usedDynamicFallback=false`; case latencies were `93891`, `84999`, `72738`, `228588`, `81619`, and `101815` ms. Total duration was `663652` ms; no retry occurred.
- Normal Terra quiz quality: `3/3` passed with `medium` effort and `usedDynamicFallback=false`; case latencies were `56939`, `80731`, and `52381` ms. Total duration was `190051` ms.
- Normal Terra formal-tier quality: `3/3` passed with `usedDynamicFallback=false`; the formal exam used `high`, while personalized/ordinary practice used `medium`. Case latencies were `158012`, `59475`, and `75826` ms. Total duration was `293313` ms.
- Teacher grading gold: `materials/evaluation/teacher-grading-gold-cases.json` was not present. Production grading accuracy therefore remains unverified; synthetic capability and quality checks are not an accuracy claim.
- Local enablement: after the real capability and quality gates passed, the ignored repository-local `.env` was updated with the three approved Sol fallback fields. No key or base URL was changed or copied into Git.
- Enabled-gate regression: API check and service smoke exited `0`; focused AI/service fake-server tests passed `94/94`, confirming valid normal requests remain on Terra.
- Remote state: no push was performed.
