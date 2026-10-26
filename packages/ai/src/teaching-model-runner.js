import { classifyTaskFailure, resolveTeachingTaskPolicy } from "./model-policy.js";
import { inspectEncodingPayload } from "@junhang/core";
import { sanitizeUpstreamFailureDiagnostics, sanitizeTransportDiagnostics } from "./upstream-failure-diagnostics.js";

const INTERNAL_KEYS = new Set([
  "__proto__", "constructor", "prototype", "prompt", "systemPrompt", "messages",
  "provider", "providerId", "model", "modelRun", "raw", "debug", "attempts", "rulePack",
  "rulePath", "root", "budget", "generationBudget", "reasoningEffort", "apiKey", "outputContract",
  "assessmentTotalTimeoutMs", "assessmentMaxTokens", "generationTimeoutMs", "generationMaxTokens",
  "confirmedBy", "confirmedAt", "archiveEligible", "finalScore", "upstreamDiagnostics", "transportDiagnostics", "onTransportProgress",
  "transportStages", "completionDiagnostics"
]);

const DIAGNOSTIC_ISSUES = new Set([
  "title_missing", "question_results_missing", "question_alignment_invalid",
  "student_evidence_insufficient", "judgment_evidence_missing", "max_score_invalid",
  "question_score_invalid", "reference_structure_invalid", "reference_alignment_invalid",
  "ocr_structure_invalid", "invalid_encoding", "internal_model_disclosure",
  "explanation_incomplete", "item_count_mismatch", "item_score_missing", "prompt_score_conflict",
  "rubric_score_conflict", "rubric_process_conflict", "partition_score_mismatch", "teaching_feedback_missing", "figure_missing",
  "choice_options_missing", "rubric_missing", "missing_sections", "missing_items", "missing_item_type",
  "disallowed_item_type", "incomplete_item", "reading_passage_missing", "reading_passage_inconsistent",
  "reading_passage_groups_insufficient", "reading_passage_too_short", "reading_context_questions_insufficient"
]);

function diagnosticIssue(code) {
  // Partition identity is attached by the pipeline. Do not retain arbitrary text
  // from a validator; only the known terminal code is safe for internal traces.
  const known = typeof code === "string" && code.startsWith("partition:") ? code.split(":").at(-1) : code;
  return DIAGNOSTIC_ISSUES.has(known) ? known : "domain_validation_failed";
}

const TRANSPORT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"
]);
const UPSTREAM_CODES = new Set([
  ...TRANSPORT_CODES, "invalid_upstream_response", "invalid_api_key", "invalid_request_error",
  "authentication_error", "permission_denied", "model_not_found", "unsupported_parameter",
  "unsupported_value", "context_length_exceeded", "insufficient_quota", "rate_limit_exceeded",
  "server_error", "service_unavailable", "overloaded_error", "no_available_channel"
]);

function failureDiagnostics(error) {
  // Do not infer a status from arbitrary error text or retain unknown upstream codes.
  const upstreamStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
  const code = error?.code || error?.cause?.code;
  const upstreamCode = code == null ? null : UPSTREAM_CODES.has(code) ? code : "unknown";
  const failureCode = ["invalid_json", "invalid_structure"].includes(code) ? code
    : /MODEL_TIMEOUT/.test(String(error?.message || "")) ? "MODEL_TIMEOUT"
    : code === "invalid_upstream_response" ? code
    : upstreamStatus >= 400 ? "http_error"
    : TRANSPORT_CODES.has(code) ? "transport_error" : "unknown_failure";
  const upstreamDiagnostics = sanitizeUpstreamFailureDiagnostics(error?.upstreamDiagnostics);
  return { failureCode, upstreamStatus, upstreamCode, ...(upstreamDiagnostics ? { upstreamDiagnostics } : {}) };
}

function sanitizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const counts = (source, keys) => Object.fromEntries(keys
    .filter(key => Number.isFinite(source?.[key]) && source[key] >= 0)
    .map(key => [key, source[key]]));
  const usage = counts(value, ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"]);
  for (const [key, fields] of [
    ["prompt_tokens_details", ["cached_tokens", "audio_tokens"]],
    ["completion_tokens_details", ["reasoning_tokens", "audio_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens"]],
    ["input_tokens_details", ["cached_tokens"]],
    ["output_tokens_details", ["reasoning_tokens"]]
  ]) {
    const details = counts(value[key], fields);
    if (Object.keys(details).length) usage[key] = details;
  }
  return usage;
}

function completionDiagnostics(value, outputTokens, maxTokens) {
  return {
    limitField: ["max_completion_tokens", "max_tokens"].includes(value?.limitField) ? value.limitField : null,
    finishReason: ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(value?.finishReason) ? value.finishReason : null,
    reportedOutputTokens: outputTokens ?? null,
    // Channel-reported counts are observations, not proof of billing or limit enforcement.
    exceedsRequestedLimit: outputTokens == null ? null : outputTokens > maxTokens
  };
}

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

async function boundedCall(call, route, messages, { timeoutMs, signal, maxTokens, onTransportProgress }) {
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
        return call(route, messages, { timeoutMs, signal: controller.signal, maxTokens, onTransportProgress });
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
    const remainingMs = Math.floor(budget.deadlineAt - now());
    if (remainingMs <= 0 || budget.remainingTokens < 1) return stop("TEACHING_BUDGET_EXHAUSTED");
    const canRetry = index === 0 && budget.additionalAttemptsUsed < policy.maxAdditionalAttempts;
    const timeoutMs = canRetry && policy.primaryTimeoutMs
      ? Math.min(remainingMs, policy.primaryTimeoutMs) : remainingMs;
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
    const startedAt = now();
    attempt.startedAt = new Date(startedAt).toISOString();
    let classification;
    let observing = true;
    try {
      const response = await boundedCall(call, route, messages, { timeoutMs, signal, maxTokens,
        onTransportProgress: (event) => {
          const diagnostic = sanitizeTransportDiagnostics(event);
          if (observing && diagnostic) {
            attempt.transportDiagnostics = diagnostic;
            attempt.transportStages ||= {};
            // At most three snapshots; preserve the first observation of each stage.
            attempt.transportStages[diagnostic.phase] ||= diagnostic;
          }
        }
      });
      const usage = sanitizeUsage(response?.usage);
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
      if (Number.isFinite(outputTokens) && outputTokens >= 0) {
        budget.remainingTokens = Math.max(0, budget.remainingTokens + maxTokens - outputTokens);
      }
      attempt.usage = usage;
      attempt.completionDiagnostics = completionDiagnostics(response?.completionDiagnostics, outputTokens, maxTokens);
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
      attempt.failureCode = "validation_failed";
      attempt.validationIssueCodes = [...new Set(issues.map(diagnosticIssue))];
    } catch (error) {
      if (signal?.aborted) return stop("TEACHING_CANCELLED");
      if (error?.code === "TEACHING_DEADLINE") {
        attempt.failureCode = "TEACHING_DEADLINE";
        attempt.triggerClass = "availability";
        if (!policy.primaryTimeoutMs || now() >= budget.deadlineAt) return stop("TEACHING_BUDGET_EXHAUSTED");
        classification = { triggerClass: "availability" };
      } else {
        classification = classifyTaskFailure(error, { evidenceSufficient });
        Object.assign(attempt, failureDiagnostics(error));
      }
      issues = [classification.triggerClass === "quality" ? "invalid_output" : classification.triggerClass];
    } finally {
      observing = false;
      attempt.elapsedMs = Math.max(0, now() - startedAt);
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
