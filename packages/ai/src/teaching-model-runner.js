import { classifyTaskFailure, resolveTeachingTaskPolicy } from "./model-policy.js";
import { inspectEncodingPayload } from "@junhang/core";

const INTERNAL_KEYS = new Set([
  "__proto__", "constructor", "prototype", "prompt", "systemPrompt", "messages",
  "provider", "providerId", "model", "modelRun", "raw", "debug", "attempts", "rulePack",
  "rulePath", "root", "budget", "generationBudget", "reasoningEffort", "apiKey", "outputContract",
  "assessmentTotalTimeoutMs", "assessmentMaxTokens", "generationTimeoutMs", "generationMaxTokens",
  "confirmedBy", "confirmedAt", "archiveEligible", "finalScore"
]);

// Defense in depth; business fields and actor permissions are validated by the service.
function stripInternal(value, depth = 0) {
  if (Array.isArray(value)) return value.map((item) => stripInternal(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key === "prompt" ? depth > 0 : !INTERNAL_KEYS.has(key))
    .map(([key, item]) => [key, stripInternal(item, depth + 1)]));
}

export function projectTeachingResult(result, role) {
  if (role !== "teacher") return { status: "review_required" };
  return { status: result.status === "success" ? "draft" : result.status, candidate: result.candidate, needsTeacherReview: true };
}

async function boundedCall(call, route, messages, { timeoutMs, signal, maxTokens }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("Teaching deadline exhausted"), { code: "TEACHING_DEADLINE" })), timeoutMs);
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return call(route, messages, { timeoutMs, signal: controller.signal, maxTokens });
      }),
      new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      })
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

// Internal result only: consumers project candidate after their domain/review gates.
// budget.remainingTokens is an output-token allowance shared by the operation.
// Unknown usage consumes the reservation; no estimated currency cost is invented.
export async function runTeachingUnit(
  { task, input, rulePack, budget, signal, evidenceSufficient = true },
  { call, repairIssues, outputContract = "", config = {}, now = Date.now } = {}
) {
  const attempts = [];
  const internal = { attempts, rules: rulePack ? { module: rulePack.module, version: rulePack.version, hash: rulePack.hash } : null };
  const stop = (code) => ({ status: signal?.aborted ? "cancelled" : "review_required", candidate: null, issueCodes: [code], internal });
  let policy;
  try { policy = resolveTeachingTaskPolicy(task, config); } catch { return stop("TEACHING_TASK_INVALID"); }
  if (!evidenceSufficient) return stop("TEACHING_EVIDENCE_MISSING");
  if (rulePack?.module !== policy.module || !rulePack.text?.trim() || !/^[a-f0-9]{64}$/.test(rulePack.hash || "")) return stop("TEACHING_RULES_INVALID");
  if (typeof call !== "function" || typeof repairIssues !== "function") return stop("TEACHING_VALIDATOR_REQUIRED");
  if (!Number.isFinite(budget?.deadlineAt) || !Number.isFinite(budget?.remainingTokens) || !Number.isInteger(budget?.additionalAttemptsUsed) || budget.additionalAttemptsUsed < 0) return stop("TEACHING_BUDGET_INVALID");
  const cleanInput = stripInternal(input);
  let route = policy.primary;
  let issues = [];
  let reason = "primary";
  for (let index = 0; index <= policy.maxAdditionalAttempts; index++) {
    if (signal?.aborted) return stop("TEACHING_CANCELLED");
    const timeoutMs = Math.floor(budget.deadlineAt - now());
    if (timeoutMs <= 0 || budget.remainingTokens < 1) return stop("TEACHING_BUDGET_EXHAUSTED");
    if (index > 0) {
      if (budget.additionalAttemptsUsed >= policy.maxAdditionalAttempts) return stop("TEACHING_ATTEMPTS_EXHAUSTED");
      budget.additionalAttemptsUsed++;
    }
    const slots = index === 0 && budget.additionalAttemptsUsed < policy.maxAdditionalAttempts ? 2 : 1;
    const maxTokens = Math.max(1, Math.min(policy.budget.maxTokens, Math.floor(budget.remainingTokens / slots)));
    budget.remainingTokens -= maxTokens; // Reserve before awaiting, including concurrent units.
    const messages = [
      { role: "system", content: `${rulePack.text}\nRule version: ${rulePack.version}; SHA-256: ${rulePack.hash}\nTask: ${task}. Return a valid JSON object only.\n${outputContract}${issues.length ? `\nRepair these validation issues: ${JSON.stringify(issues)}` : ""}` },
      { role: "user", content: JSON.stringify(cleanInput) }
    ];
    const attempt = { role: reason, providerId: route.providerId, model: route.model, reasoningEffort: route.reasoningEffort, timeoutMs, maxTokens, status: "ERROR", usage: null, cost: "unknown" };
    attempts.push(attempt);
    let classification;
    try {
      const response = await boundedCall(call, route, messages, { timeoutMs, signal, maxTokens });
      const usage = response?.usage;
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
      if (Number.isFinite(outputTokens) && outputTokens >= 0) {
        budget.remainingTokens = Math.max(0, budget.remainingTokens + maxTokens - outputTokens);
      }
      attempt.usage = usage ? Object.fromEntries(Object.entries(usage).filter(([key, value]) => ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"].includes(key) && Number.isFinite(value) && value >= 0)) : null;
      if (signal?.aborted) return stop("TEACHING_CANCELLED");
      if (now() >= budget.deadlineAt) return stop("TEACHING_BUDGET_EXHAUSTED");
      let candidate;
      try { candidate = JSON.parse(response.text); } catch { throw Object.assign(new Error("Invalid JSON"), { code: "invalid_json" }); }
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw Object.assign(new Error("Invalid JSON object"), { code: "invalid_structure" });
      candidate = stripInternal(candidate);
      issues = await repairIssues(candidate, cleanInput);
      if (signal?.aborted) return stop("TEACHING_CANCELLED");
      if (now() >= budget.deadlineAt) return stop("TEACHING_BUDGET_EXHAUSTED");
      if (!Array.isArray(issues)) return stop("TEACHING_VALIDATOR_INVALID");
      if (!inspectEncodingPayload(candidate).ok) issues = [...issues, "invalid_encoding"];
      if (/gpt-\d|deepseek|minimax|openai|reasoning_effort|api[_-]?key/i.test(JSON.stringify(candidate))) issues = [...issues, "internal_model_disclosure"];
      if (issues.length === 0) {
        attempt.status = "SUCCESS";
        return { status: "success", candidate, issueCodes: [], internal };
      }
      classification = { triggerClass: "quality" };
    } catch (error) {
      if (signal?.aborted) return stop("TEACHING_CANCELLED");
      if (error?.code === "TEACHING_DEADLINE") return stop("TEACHING_BUDGET_EXHAUSTED");
      classification = classifyTaskFailure(error, { evidenceSufficient });
      issues = [classification.triggerClass === "quality" ? "invalid_output" : classification.triggerClass];
    }
    attempt.triggerClass = classification.triggerClass;
    if (index === policy.maxAdditionalAttempts) return stop("TEACHING_ATTEMPTS_EXHAUSTED");
    if (classification.triggerClass === "quality") {
      route = policy.primary;
      reason = "quality-repair";
    } else if (classification.triggerClass === "availability" && policy.replacement) {
      route = policy.replacement;
      reason = "availability-replacement";
      issues = [];
    } else {
      return stop(`TEACHING_${classification.triggerClass.toUpperCase()}_FAILED`);
    }
  }
  return stop("TEACHING_ATTEMPTS_EXHAUSTED");
}
