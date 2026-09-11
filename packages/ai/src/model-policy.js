const TRANSIENT_STATUS = new Set([408, 500, 502, 503, 504, 524]);
const TRANSIENT_CODE = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)\b/i;
const CONFIGURATION_CODE = /insufficient_quota|context_length|invalid_(api_)?key|invalid_request|model_not_found|unsupported/i;
const ACCOUNT_CONFIGURATION = /quota|usage[_\s-]*limit|spending[_\s-]*limit|plan[_-]+limit|subscription|balance|billing|额度|余额|账户/i;
const EVIDENCE_CODE = /evidence|reference|ocr|student[_-]?answer|prompt[_-]?missing|content[_-]?context|textbook/i;

const TEACHING_TASKS = Object.freeze({
  generation: { module: "generation", role: "primary", timeoutMs: 240000, maxTokens: 24000 },
  grading: { module: "grading", role: "primary", timeoutMs: 180000, maxTokens: 12000 },
  reference: { module: "grading", role: "primary", timeoutMs: 180000, maxTokens: 12000 },
  "extract-requirement": { module: "generation", role: "assist", timeoutMs: 60000, maxTokens: 4000 },
  "extract-material": { module: "generation", role: "assist", timeoutMs: 60000, maxTokens: 8000 },
  recognize: { module: "grading", role: "assist", timeoutMs: 90000, maxTokens: 8000 },
  "rewrite-feedback": { module: "grading", role: "replacement", timeoutMs: 60000, maxTokens: 4000 }
});

export function resolveTeachingTaskPolicy(task, config = {}) {
  if (!Object.hasOwn(TEACHING_TASKS, task)) throw new Error(`Unknown teaching task: ${task}`);
  const defaults = TEACHING_TASKS[task];
  const routes = {
    primary: { providerId: "gpt56", model: config.TEACHING_PRIMARY_MODEL || config.teachingPrimaryModel || "gpt-6-astra", reasoningEffort: "high" },
    replacement: { providerId: "gpt56", model: config.TEACHING_REPLACEMENT_MODEL || config.teachingReplacementModel || "gpt-5.6-sol", reasoningEffort: "high" },
    assist: { providerId: "deepseek", model: config.TEACHING_ASSIST_MODEL || config.teachingAssistModel || "deepseek-flash", reasoningEffort: null }
  };
  const primary = routes[defaults.role];
  return {
    task, module: defaults.module, primary,
    replacement: defaults.role === "primary" && primary.model !== routes.replacement.model ? routes.replacement : null,
    maxAdditionalAttempts: 1,
    maxConcurrency: 2,
    budget: { timeoutMs: defaults.timeoutMs, maxTokens: defaults.maxTokens }
  };
}

const TASK_DEFAULTS = {
  qa: { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "low", escalation: false },
  "task-draft": { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "low", escalation: false },
  "assessment-draft": { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "medium", escalation: true },
  "reference-answer": { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "high", escalation: true },
  "submission-grading": { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "high", escalation: true },
  "student-profile": { providerId: "gpt56", modelFamily: "terra", reasoningEffort: "low", escalation: false },
  ocr: { providerId: "minimax", modelFamily: "vision", reasoningEffort: "none", escalation: false },
  speech: { providerId: "minimax", modelFamily: "speech", reasoningEffort: "none", escalation: false },
  "emergency-text": { providerId: "deepseek", modelFamily: "emergency", reasoningEffort: "none", escalation: false }
};

function runtimeValue(config, key, fallback = "") {
  const aliases = {
    gpt56Model: "GPT56_MODEL",
    gpt56SolModel: "GPT56_SOL_MODEL",
    gpt56SolFallbackEnabled: "GPT56_SOL_FALLBACK_ENABLED",
    deepseekEmergencyFallbackModel: "DEEPSEEK_EMERGENCY_FALLBACK_MODEL",
    minimaxModel: "MINIMAX_TEXT_MODEL"
  };
  return config?.[key] ?? config?.[aliases[key]] ?? fallback;
}

export function resolveTaskModelPolicy(task, config = {}, input = {}) {
  const taskKey = String(task || "").trim() || "task-draft";
  const defaults = TASK_DEFAULTS[taskKey] || TASK_DEFAULTS["task-draft"];
  const formalAssessment = taskKey === "assessment-draft" && ["试卷", "formal", "formal-full"].includes(String(input.kind || input.generationProfile || ""));
  const reasoningEffort = formalAssessment ? "high" : defaults.reasoningEffort;
  const configuredModel = defaults.providerId === "gpt56"
    ? runtimeValue(config, "gpt56Model", "gpt-5.6-terra")
    : defaults.providerId === "deepseek"
      ? runtimeValue(config, "deepseekEmergencyFallbackModel", "deepseek-v4-flash")
      : runtimeValue(config, "minimaxModel", "MiniMax-M3");
  const solModel = runtimeValue(config, "gpt56SolModel", "gpt-5.6-sol");
  const isSol = configuredModel === solModel || configuredModel.includes("-sol");
  const escalationEnabled = defaults.escalation && !isSol && String(runtimeValue(config, "gpt56SolFallbackEnabled", true)).toLowerCase() !== "false";
  return {
    task: taskKey,
    primary: {
      providerId: defaults.providerId,
      model: configuredModel,
      modelFamily: defaults.modelFamily,
      reasoningEffort
    },
    escalation: {
      enabled: escalationEnabled,
      providerId: "gpt56",
      model: solModel,
      reasoningEffort: "high",
      maxAttemptsPerUnit: escalationEnabled ? 1 : 0,
      blockedTriggerClasses: ["configuration", "evidence"],
      thirdTextModel: null
    }
  };
}

export function classifyTaskFailure(error = {}, context = {}) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || message.match(/\b(\d{3})\b/)?.[1]) || null;
  const code = String(error?.code || error?.cause?.code || "").trim() || null;
  const text = `${code || ""} ${message}`;
  const evidenceSufficient = context.evidenceSufficient !== false;
  if (!evidenceSufficient || EVIDENCE_CODE.test(text)) {
    return { triggerClass: "evidence", allowedToEscalate: false, code: code || "evidence_insufficient" };
  }
  if (status === 401 || status === 403 || CONFIGURATION_CODE.test(text) || ACCOUNT_CONFIGURATION.test(text)) {
    return { triggerClass: "configuration", allowedToEscalate: false, code: code || String(status || "configuration") };
  }
  const transient429 = status === 429 && /rate[_\s-]*limit|capacity|concurr|限流|并发|拥塞/i.test(text);
  if (TRANSIENT_STATUS.has(status) || transient429 || /MODEL_TIMEOUT|timeout|network/i.test(text) || TRANSIENT_CODE.test(text)) {
    return { triggerClass: "availability", allowedToEscalate: true, code: code || String(status || "availability") };
  }
  const quality = /malformed|invalid[_-]?(json|structure|output)|schema|quality|parse/i.test(text);
  if (quality) {
    return { triggerClass: "quality", allowedToEscalate: evidenceSufficient, code: code || "quality_failure" };
  }
  return { triggerClass: "configuration", allowedToEscalate: false, code: code || "unknown_failure" };
}
