import { runAssessmentPipeline, runSubmissionPipeline } from "./teaching-pipeline.js";
import { normalizeGradeLevel } from "@junhang/core";
import { describeModelError } from "./model-escalation.js";
import { resolveTaskModelPolicy, resolveTeachingTaskPolicy } from "./model-policy.js";
import { loadTeachingRulePack } from "./teaching-rules.js";
import { runTeachingUnit } from "./teaching-model-runner.js";
import { collectUpstreamFailureDiagnostics } from "./upstream-failure-diagnostics.js";
import {
  QA_BLOCKED_ANSWER,
  QA_LEARNING_SIGNAL_SCHEMA_VERSION,
  QA_UNAVAILABLE_ANSWER,
  normalizeQaModelOutput,
  unavailableQaOutput
} from "./qa-learning-signal.js";

export {
  QA_BLOCKED_ANSWER,
  QA_LEARNING_SIGNAL_SCHEMA_VERSION,
  QA_UNAVAILABLE_ANSWER,
  normalizeQaModelOutput,
  unavailableQaOutput
};

export const providerCatalog = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrlKey: "DEEPSEEK_BASE_URL",
    modelKey: "DEEPSEEK_TEXT_MODEL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
    capabilities: ["emergency-text-rollback"]
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrlKey: "MINIMAX_BASE_URL",
    modelKey: "MINIMAX_TEXT_MODEL",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M3.1-Flash",
    capabilities: ["vocabulary-voice", "spoken-practice", "avatar-dialog", "vision-ocr"]
  },
  {
    id: "gpt56",
    label: "GPT-5.6",
    baseUrlKey: "GPT56_BASE_URL",
    modelKey: "GPT56_MODEL",
    defaultBaseUrl: "",
    defaultModel: "gpt-5.6",
    capabilities: ["qa", "vocabulary-text", "task-draft", "report-draft", "assessment-draft", "submission-reference-answer", "submission-grading", "premium-grading-review", "archive-gate"]
  }
];

export const capabilityCatalog = [
  {
    id: "qa",
    label: "AI 问答",
    providerId: "gpt56",
    appSurface: "AI 问答"
  },
  {
    id: "vocabulary-text",
    label: "英语词典查询",
    providerId: "gpt56",
    appSurface: "英语词典"
  },
  {
    id: "task-draft",
    label: "今日任务草稿",
    providerId: "gpt56",
    appSurface: "今日任务"
  },
  {
    id: "report-draft",
    label: "学生档案草稿",
    providerId: "gpt56",
    appSurface: "学生主页"
  },
  {
    id: "submission-grading",
    label: "图片批改",
    providerId: "gpt56",
    appSurface: "生成与批改"
  },
  {
    id: "assessment-draft",
    label: "教学内容生成",
    providerId: "gpt56",
    appSurface: "生成与批改"
  },
  {
    id: "vocabulary-voice",
    label: "词汇发音/跟读",
    providerId: "minimax",
    appSurface: "英语词典"
  },
  {
    id: "spoken-practice",
    label: "口语对话",
    providerId: "minimax",
    appSurface: "英语词典"
  },
  {
    id: "premium-grading-review",
    label: "批改高级审查",
    providerId: "gpt56",
    appSurface: "生成与批改"
  },
  {
    id: "avatar-dialog",
    label: "虚拟人物讲解",
    providerId: "minimax",
    appSurface: "AI 问答"
  }
];

export function normalizeRuntimeConfig(config = {}) {
  const minimaxBalanceStatus =
    config.MINIMAX_BALANCE_STATUS ||
    config.minimaxBalanceStatus ||
    config.MINIMAX_RUNTIME_STATE ||
    "restored";

  return {
    deepseekApiKey: config.DEEPSEEK_API_KEY || config.deepseekApiKey || "",
    deepseekBaseUrl:
      config.DEEPSEEK_BASE_URL || config.deepseekBaseUrl || "https://api.deepseek.com",
    deepseekModel: config.DEEPSEEK_TEXT_MODEL || config.deepseekModel || "deepseek-v4-pro",
    deepseekAssessmentModel:
      config.DEEPSEEK_ASSESSMENT_MODEL ||
      config.deepseekAssessmentModel ||
      "deepseek-v4-pro",
    deepseekAssessmentFallbackModel:
      config.DEEPSEEK_ASSESSMENT_FALLBACK_MODEL ||
      config.deepseekAssessmentFallbackModel ||
      "deepseek-v4-pro",
    deepseekEmergencyFallbackModel:
      config.DEEPSEEK_EMERGENCY_FALLBACK_MODEL ||
      config.deepseekEmergencyFallbackModel ||
      "deepseek-flash",
    minimaxApiKey: config.MINIMAX_API_KEY || config.minimaxApiKey || "",
    minimaxBaseUrl:
      config.MINIMAX_BASE_URL || config.minimaxBaseUrl || "https://api.minimaxi.com/v1",
    minimaxModel:
      config.MINIMAX_TEXT_MODEL || config.minimaxModel || "MiniMax-M3.1-Flash",
    minimaxSpeechModel:
      config.MINIMAX_SPEECH_MODEL || config.minimaxSpeechModel || "speech-2.8-turbo",
    minimaxT2aBaseUrl:
      config.MINIMAX_T2A_BASE_URL || config.minimaxT2aBaseUrl || "https://api.minimaxi.com",
    minimaxBalanceStatus: String(minimaxBalanceStatus).toLowerCase(),
    ocrEngine: config.OCR_ENGINE || config.ocrEngine || "vision",
    ocrEnabled: String(config.OCR_ENABLED ?? config.ocrEnabled ?? "true").toLowerCase() !== "false",
    ocrHttpUrl: config.OCR_HTTP_URL || config.ocrHttpUrl || "",
    ocrHttpApiKey: config.OCR_HTTP_API_KEY || config.ocrHttpApiKey || "",
    ocrVisionProvider: config.OCR_VISION_PROVIDER || config.ocrVisionProvider || "minimax",
    ocrVisionBaseUrl: config.OCR_VISION_BASE_URL || config.ocrVisionBaseUrl || "",
    ocrVisionApiKey: config.OCR_VISION_API_KEY || config.ocrVisionApiKey || "",
    ocrVisionModel: config.OCR_VISION_MODEL || config.ocrVisionModel || "MiniMax-M3.1-Flash",
    ocrTesseractLang: config.OCR_TESSERACT_LANG || config.ocrTesseractLang || "chi_sim+eng",
    gpt56ApiKey: config.GPT56_API_KEY || config.gpt56ApiKey || config.GPT55_API_KEY || config.gpt55ApiKey || config.OPENAI_API_KEY || config.openaiApiKey || "",
    gpt56BaseUrl: config.GPT56_BASE_URL || config.gpt56BaseUrl || config.GPT55_BASE_URL || config.gpt55BaseUrl || config.OPENAI_BASE_URL || config.openaiBaseUrl || "https://api.openai.com/v1",
    gpt56Model: config.GPT56_MODEL || config.gpt56Model || config.GPT55_MODEL || config.gpt55Model || "gpt-5.6",
    gpt56GenerationTimeoutMs: Number(config.GPT56_GENERATION_TIMEOUT_MS || config.gpt56GenerationTimeoutMs || config.GPT56_ASSESSMENT_TIMEOUT_MS || config.gpt56AssessmentTimeoutMs || config.GPT55_ASSESSMENT_TIMEOUT_MS || config.gpt55AssessmentTimeoutMs || 90000),
    gpt56GradingTimeoutMs: Number(config.GPT56_GRADING_TIMEOUT_MS || config.gpt56GradingTimeoutMs || config.GPT56_ASSESSMENT_TIMEOUT_MS || config.gpt56AssessmentTimeoutMs || config.GPT55_ASSESSMENT_TIMEOUT_MS || config.gpt55AssessmentTimeoutMs || 90000),
    gpt56ReviewTimeoutMs: Number(config.GPT56_REVIEW_TIMEOUT_MS || config.gpt56ReviewTimeoutMs || config.GPT55_REVIEW_TIMEOUT_MS || config.gpt55ReviewTimeoutMs || 60000),
    gpt56ReasoningEffortEnabled: String(config.GPT56_REASONING_EFFORT_ENABLED ?? config.gpt56ReasoningEffortEnabled ?? "false").toLowerCase() === "true",
    gpt56SolFallbackEnabled: String(config.GPT56_SOL_FALLBACK_ENABLED ?? config.gpt56SolFallbackEnabled ?? "false").toLowerCase() === "true",
    gpt56SolModel: config.GPT56_SOL_MODEL || config.gpt56SolModel || "gpt-6.1-sol",
    gpt56SolFallbackTimeoutMs: Number(config.GPT56_SOL_FALLBACK_TIMEOUT_MS || config.gpt56SolFallbackTimeoutMs || 180000),
    gpt56ReadingDirectSolEnabled: String(config.GPT56_READING_DIRECT_SOL_ENABLED ?? config.gpt56ReadingDirectSolEnabled ?? "false").toLowerCase() === "true"
  };
}

export function buildAiStartupSnapshot(config = {}) {
  const runtime = normalizeRuntimeConfig(config);
  const deepseekStatus = runtime.deepseekApiKey ? "ready" : "unavailable";
  const minimaxReady =
    Boolean(runtime.minimaxApiKey) &&
    ["restored", "ready", "enabled", "ok"].includes(runtime.minimaxBalanceStatus);
  const minimaxStatus = minimaxReady ? "ready" : runtime.minimaxApiKey ? "blocked" : "unavailable";
  const gpt56Status = runtime.gpt56ApiKey && runtime.gpt56BaseUrl && runtime.gpt56Model ? "ready" : "unavailable";
  const providerById = new Map(providerCatalog.map((provider) => [provider.id, provider]));

  const providers = [
    {
      id: "deepseek",
      label: "DeepSeek",
      status: deepseekStatus,
      model: runtime.deepseekModel,
      assessmentModel: runtime.deepseekAssessmentModel,
      assessmentFallbackModel: runtime.deepseekAssessmentFallbackModel,
      baseUrl: runtime.deepseekBaseUrl,
      reason: deepseekStatus === "ready" ? "仅供显式紧急回滚，默认文本路由不使用" : "紧急回滚不可用：缺少 DEEPSEEK_API_KEY",
      capabilities: providerById.get("deepseek")?.capabilities || []
    },
    {
      id: "minimax",
      label: "MiniMax",
      status: minimaxStatus,
      model: runtime.minimaxModel,
      speechModel: runtime.minimaxSpeechModel,
      baseUrl: runtime.minimaxBaseUrl,
      reason:
        minimaxStatus === "ready"
          ? "语音和化身能力可开放"
          : minimaxStatus === "blocked"
            ? "MiniMax 余额未恢复，依赖语音/化身的功能保持阻塞"
            : "缺少 MINIMAX_API_KEY",
      capabilities: providerById.get("minimax")?.capabilities || []
    },
    {
      id: "gpt56",
      label: "GPT-5.6",
      status: gpt56Status,
      model: runtime.gpt56Model,
      baseUrl: runtime.gpt56BaseUrl,
      reason: gpt56Status === "ready" ? "文本生成、批改和高级审查可用" : "缺少 GPT56_API_KEY 或 GPT56_MODEL",
      capabilities: providerById.get("gpt56")?.capabilities || []
    }
  ];

  const features = capabilityCatalog.map((capability) => {
    const provider = providers.find((item) => item.id === capability.providerId);
    return {
      ...capability,
      status: provider?.status || "unavailable",
      reason: provider?.reason || "未找到提供商"
    };
  });

  return {
    mode: "web-phase1-demo",
    generatedAt: new Date().toISOString(),
    providers,
    features
  };
}

export function createDemoAiSnapshot() {
  return buildAiStartupSnapshot({
    deepseekApiKey: "demo-deepseek-ready",
    minimaxApiKey: "demo-minimax-present",
    minimaxBalanceStatus: "restored",
    gpt56ApiKey: "demo-gpt56-ready",
    gpt56BaseUrl: "https://example.invalid/v1",
    gpt56Model: "gpt-5.6"
  });
}

export function routeCapability(capabilityId, snapshot = createDemoAiSnapshot()) {
  const feature = snapshot.features.find((item) => item.id === capabilityId);
  if (!feature) {
    return {
      id: capabilityId,
      label: capabilityId,
      providerId: "gpt56",
      appSurface: "未配置",
      status: "unavailable",
      reason: "未知 AI 能力"
    };
  }

  return feature;
}

export function buildModelOrchestrationPlan(config = {}) {
  const runtime = normalizeRuntimeConfig(config);
  const snapshot = buildAiStartupSnapshot(config);
  const minimax = snapshot.providers.find((item) => item.id === "minimax");
  const gpt56 = snapshot.providers.find((item) => item.id === "gpt56");
  return {
    brain: {
      owner: "Codex",
      duty: "统筹、审查、修复、落库、PDF/小程序输出，不把供应商原始输出直接交给学生或家长。"
    },
    routes: {
      qa: {
        providerId: "gpt56",
        model: runtime.gpt56Model,
        status: gpt56?.status || "unavailable",
        duty: "学生问答、词汇解释、任务草稿。"
      },
      assessmentDraft: {
        providerId: "gpt56",
        model: resolveTeachingTaskPolicy("generation", config).primary.model,
        status: gpt56?.status || "unavailable",
        duty: "按项目题型蓝图分区生成试卷/小测/练习草稿，必须经过服务层审查与修复。"
      },
      multimodalReview: {
        providerId: "minimax",
        model: runtime.minimaxModel,
        status: minimax?.status || "unavailable",
        duty: "视觉 OCR、多模态识别和图片证据提取。"
      },
      premiumGradingReview: {
        providerId: "gpt56",
        model: runtime.gpt56Model,
        status: gpt56?.status || "unavailable",
        duty: "批改结果高级审查、异常分数拦截、低置信归档门禁。"
      },
      speech: {
        providerId: "minimax",
        model: runtime.minimaxSpeechModel,
        status: minimax?.status || "unavailable",
        duty: "课堂播报、听写、跟读语音。"
      }
    }
  };
}

export async function callOpenAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.3,
  responseFormat,
  maxTokens,
  timeoutMs,
  reasoningEffort,
  signal,
  allowStructuredRetry = true,
  completionTokenLimit = false,
  omitTemperature = false,
  thinking,
  onTransportProgress
}) {
  if (!apiKey) throw new Error("Missing API key");
  const requestStartedAt = Date.now();

  const payload = { model, messages, temperature };
  if (omitTemperature) delete payload.temperature;
  if (responseFormat) payload.response_format = responseFormat;
  if (maxTokens) payload[completionTokenLimit ? "max_completion_tokens" : "max_tokens"] = maxTokens;
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
  if (thinking) payload.thinking = thinking;
  const requestBody = JSON.stringify(payload);
  const requestBytes = new TextEncoder().encode(requestBody).byteLength;
  const observeTransport = (phase, status = null, responseBytes) => {
    // Internal server-owned observer; diagnostics must not change call behavior.
    try { onTransportProgress?.({ phase, status, elapsedMs: Date.now() - requestStartedAt, requestBytes,
      ...(responseBytes !== undefined ? { responseBytes } : {}) }); } catch {}
  };
  const controller = timeoutMs || signal ? new AbortController() : null;
  const abortForCaller = () => controller?.abort(signal?.reason);
  if (signal?.aborted) abortForCaller();
  else signal?.addEventListener("abort", abortForCaller, { once: true });
  const timeout = timeoutMs && controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response;
  let text;
  try {
    observeTransport("request_started");
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: requestBody,
      signal: controller?.signal
    });
    observeTransport("response_headers", response.status);
    text = await response.text();
    observeTransport("response_body_complete", response.status, new TextEncoder().encode(text).byteLength);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || new Error("ASSESSMENT_GENERATION_CANCELLED");
    if (error?.name === "AbortError") throw new Error(`MODEL_TIMEOUT after ${timeoutMs}ms`);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", abortForCaller);
  }
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        const responseError = new Error(`Invalid upstream response: ${error.message}`, {
          cause: error
        });
        responseError.status = response.status;
        responseError.code = "invalid_upstream_response";
        responseError.upstreamDiagnostics = collectUpstreamFailureDiagnostics(response.headers, "", { secret: apiKey });
        throw responseError;
      }
    }
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || text.trim() || response.statusText;
    const canRetryStructuredRequest = allowStructuredRetry && responseFormat?.type === "json_object" && (
      (response.status === 502 && /json_object|response_format|must contain the word ['\"]?json|no available channel|channel unavailable/i.test(message)) ||
      (response.status === 503 && /no available channel|channel unavailable/i.test(message))
    );
    if (canRetryStructuredRequest) {
      const remainingTimeoutMs = timeoutMs ? Math.max(1, timeoutMs - (Date.now() - requestStartedAt)) : undefined;
      return callOpenAiCompatibleChat({
        baseUrl,
        apiKey,
        model,
        messages,
        temperature,
        maxTokens,
        timeoutMs: remainingTimeoutMs,
        reasoningEffort,
        signal,
        allowStructuredRetry,
        completionTokenLimit,
        omitTemperature
      });
    }
    const requestError = new Error(`${response.status} ${message}`);
    requestError.status = response.status;
    requestError.code = body?.error?.code || body?.code || null;
    requestError.upstreamDiagnostics = collectUpstreamFailureDiagnostics(response.headers, message, { secret: apiKey });
    throw requestError;
  }

  return body;
}

export async function callDeepSeekChat(config, messages, options = {}) {
  const runtime = normalizeRuntimeConfig(config);
  return callOpenAiCompatibleChat({
    baseUrl: runtime.deepseekBaseUrl,
    apiKey: runtime.deepseekApiKey,
    model: options.model || runtime.deepseekModel,
    messages,
    temperature: options.temperature,
    responseFormat: options.responseFormat,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs
  });
}

export async function callTeachingModel(config, route, messages, options = {}) {
  const runtime = normalizeRuntimeConfig(config);
  if (!["gpt56", "deepseek", "minimax"].includes(route?.providerId)) throw new Error("Unsupported teaching provider");
  const openai = route.providerId === "gpt56";
  const minimax = route.providerId === "minimax";
  const baseUrl = openai ? runtime.gpt56BaseUrl : minimax ? runtime.ocrVisionBaseUrl || runtime.minimaxBaseUrl : runtime.deepseekBaseUrl;
  const apiKey = openai ? runtime.gpt56ApiKey : minimax ? runtime.ocrVisionApiKey || runtime.minimaxApiKey : runtime.deepseekApiKey;
  if (!baseUrl || !apiKey || !route.model) throw new Error("Teaching model is not configured");
  const body = await callOpenAiCompatibleChat({
    baseUrl, apiKey, model: route.model, messages,
    responseFormat: { type: "json_object" },
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    reasoningEffort: openai || minimax ? route.reasoningEffort : undefined,
    thinking: route.providerId === "deepseek" ? { type: "disabled" } : undefined,
    allowStructuredRetry: false,
    completionTokenLimit: openai || minimax,
    omitTemperature: openai,
    onTransportProgress: options.onTransportProgress
  });
  return { text: extractChatText(body), usage: body.usage || null };
}

// execution contains server-owned dependencies, never a forwarded HTTP body.
export async function runTeachingTask(config, task, input, execution = {}) {
  const policy = resolveTeachingTaskPolicy(task, config);
  const now = execution.now || Date.now;
  const budget = execution.budget || {
    deadlineAt: now() + policy.budget.timeoutMs,
    remainingTokens: policy.budget.maxTokens,
    additionalAttemptsUsed: 0
  };
  let rulePack;
  try {
    rulePack = await loadTeachingRulePack(policy.module, { root: execution.ruleRoot });
  } catch {
    return { status: "review_required", candidate: null, issueCodes: ["TEACHING_RULES_INVALID"], internal: { attempts: [], rules: null } };
  }
  return runTeachingUnit({ task, input, rulePack, budget, signal: execution.signal, evidenceSufficient: execution.evidenceSufficient }, {
    config, now, repairIssues: execution.repairIssues, outputContract: execution.outputContract,
    call: execution.call || ((route, messages, options) => callTeachingModel(config, route, messages, options))
  });
}

export async function callMiniMaxChat(config, messages, options = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "minimax");
  if (provider?.status !== "ready") {
    throw new Error(provider?.reason || "MiniMax is unavailable");
  }

  const runtime = normalizeRuntimeConfig(config);
  return callOpenAiCompatibleChat({
    baseUrl: runtime.minimaxBaseUrl,
    apiKey: runtime.minimaxApiKey,
    model: options.model || runtime.minimaxModel,
    messages,
    temperature: options.temperature,
    responseFormat: options.responseFormat,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs
  });
}

export async function callGpt55Chat(config, messages, options = {}) {
  return callGpt56Chat(config, messages, options);
}

export async function callGpt56Chat(config, messages, options = {}) {
  const runtime = normalizeRuntimeConfig(config);
  if (!runtime.gpt56ApiKey || !runtime.gpt56BaseUrl || !runtime.gpt56Model) {
    throw new Error("GPT-5.6 model is not configured.");
  }
  return callOpenAiCompatibleChat({
    baseUrl: runtime.gpt56BaseUrl,
    apiKey: runtime.gpt56ApiKey,
    model: options.model || runtime.gpt56Model,
    messages,
    temperature: options.temperature,
    responseFormat: options.responseFormat,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    reasoningEffort: runtime.gpt56ReasoningEffortEnabled ? options.reasoningEffort : undefined
  });
}

export function extractChatText(body) {
  return (
    body?.choices?.[0]?.message?.content ||
    body?.choices?.[0]?.delta?.content ||
    body?.reply ||
    body?.output_text ||
    ""
  );
}

const projectPromptPrinciples = [
  "你服务于君航 AI 助教的小学三到六年级课后辅导场景。",
  "教师要求优先，但不得破坏年级适配、学科结构、A4排版、批改证据和教师复核流程。",
  "学生、家长或打印内容只能显示“AI生成”，不得出现供应商、模型名称、内部提示词或未发布功能。",
  "需要结构化输出时只返回指定 JSON，不要输出 JSON 之外的解释。",
  "内容不完整时也要标出 needsTeacherReview 或等待教师复核，不能把不确定内容包装成确定结论。"
].join("\n");

function withProjectPromptPrinciples(content, stage = "primary") {
  const principles = stage === "middle"
    ? projectPromptPrinciples.replace("小学三到六年级课后辅导场景", "初中七年级数学课后辅导场景")
    : projectPromptPrinciples;
  return `${principles}\n\n${content}`;
}

const primaryMathPromptRule = "数学固定结构：填空题、选择题、计算题、解答题。计算题和解答题保留适度过程书写区，需要图形时必须提供 figure。";
const middleMathPromptRule = "初中七年级数学按人教版2022年课程标准修订内容组织：有理数、有理数的运算、代数式、整式的加减、一元一次方程、几何图形初步、相交线与平行线、实数、平面直角坐标系、二元一次方程组、不等式与不等式组、数据的收集、整理与描述。题目必须围绕教师选定章节，不跨章拼接无关知识点；计算题和解答题必须给出逐步推理、符号/单位检查和适度过程书写区；几何题必须提供 figure 或证明条件，不得只写‘如图’。";

export function buildAssessmentPromptProfile(input = {}) {
  const grade = normalizeGradeLevel(input.grade || input.targetGrade);
  const middle = input.subject === "数学" && grade?.stage === "middle" && grade.level === 7;
  return {
    stage: middle ? "middle" : grade?.stage || "primary",
    role: middle ? "初中七年级数学教研出题助手" : "小学教研出题助手",
    subjectRule: middle ? middleMathPromptRule : primaryMathPromptRule
  };
}

export function buildGradingPromptProfile(input = {}) {
  const grade = normalizeGradeLevel(input.grade || input.targetGrade);
  const middle = input.subject === "数学" && grade?.stage === "middle" && grade.level === 7;
  return {
    stage: middle ? "middle" : grade?.stage || "primary",
    role: middle ? "初中七年级数学作业批改助手" : "小学作业、练习、小测和试卷批改助手",
    guardrails: middle
      ? "初中数学必须区分印刷题干与学生作答，保留有理数符号、分式/根式、方程移项、几何证明和图像条件的步骤证据；OCR 无法确认负号、上下标、括号、图形或关键步骤时标记 needsTeacherReview=true，不只按最终答案判定。"
      : "小学数学按题目和答案证据保守批改；无法确认时标记 needsTeacherReview=true。"
  };
}

export function inferClassroomQaMode(question = "") {
  const text = String(question).trim();
  const guidedSignals = [
    "怎么做",
    "不会",
    "解题",
    "这道",
    "列式",
    "方程",
    "求",
    "作答",
    "应用题",
    "证明",
    "计算",
    "题",
    "作业",
    "试卷",
    "小测",
    "为什么错"
  ];
  return guidedSignals.some((signal) => text.includes(signal))
    ? "GUIDED_THINKING"
    : "KNOWLEDGE_EXPLANATION";
}

async function timedCall(run) {
  const started = Date.now();
  try {
    const body = await run();
    return { body, latencyMs: Date.now() - started, status: "SUCCESS" };
  } catch (error) {
    const errorDetails = describeModelError(error);
    return {
      body: null,
      latencyMs: Date.now() - started,
      status: "ERROR",
      error: errorDetails.message,
      errorDetails
    };
  }
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function fallbackUnavailable(providerId, reason, fallback) {
  return {
    available: false,
    providerId,
    status: "unavailable",
    reason,
    ...fallback
  };
}

export async function answerStudentQuestion(config, input = {}) {
  const taskPolicy = resolveTaskModelPolicy("qa", config, input);
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const mode = input.mode === "GUIDED_THINKING" || input.mode === "KNOWLEDGE_EXPLANATION"
    ? input.mode
    : inferClassroomQaMode(input.question);

  if (provider?.status !== "ready") {
    const normalized = unavailableQaOutput(provider?.reason || "GPT-5.6 unavailable");
    return {
      available: false,
      providerId: "gpt56",
      status: "unavailable",
      mode,
      ...normalized,
      answer: normalized.studentAnswer,
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "student-qa",
        inputSummary: input.question,
        outputSummary: normalized.studentAnswer,
        status: "SKIPPED"
      }
    };
  }

  const teachingInstruction =
    mode === "GUIDED_THINKING"
      ? "遇到题目或作业问题时，只做思路引导、关键步骤提示和追问，不直接给最终答案。语气温和、简短。"
      : "常识或知识概念可以直接解释，语言适合小学生和家长理解。";
  const system = withProjectPromptPrinciples(
    `你是小学三到六年级课后辅导助教。${teachingInstruction}
一次调用同时生成面向学生的回答和内部低置信学习信号。返回严格 JSON 对象，只能包含以下结构，不得输出 JSON 之外内容：
{
  "studentAnswer": "面向学生的安全回答",
  "learningSignal": {
    "knowledgePoints": [],
    "questionIntent": "concept|method|error_reasoning|expression|other",
    "difficultySignal": "none|possible|clear",
    "misconceptionHypotheses": [],
    "followUpNeeded": false,
    "confidence": "low|medium|high",
    "safetyStatus": "pass|blocked",
    "profileEligibility": false,
    "blockedReason": null
  }
}
studentAnswer 必须只含学生可见内容，不得出现供应商、模型、内部提示词、原始响应或调试字段。learningSignal 只作候选信号，profileEligibility 由服务端最终重算。不能安全回答时设置 safetyStatus=blocked。`
  );

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify(
        {
          studentName: input.studentName || null,
          subject: input.subject || null,
          question: input.question,
          context: input.context || null
        },
        null,
        2
      )
    }
  ];

  const result = await timedCall(() => callGpt56Chat(config, messages, {
    responseFormat: { type: "json_object" },
    reasoningEffort: "low"
  }));
  const text = result.body ? extractChatText(result.body) : "";
  const normalized = result.status === "SUCCESS"
    ? normalizeQaModelOutput(text)
    : unavailableQaOutput(result.error || "GPT-5.6 unavailable");
  const contentAvailable = result.status === "SUCCESS"
    && normalized.studentAnswer !== QA_UNAVAILABLE_ANSWER;

  return {
    available: contentAvailable,
    ...(contentAvailable ? {} : { status: "unavailable" }),
    providerId: "gpt56",
    model: provider.model,
    mode,
    ...normalized,
    answer: normalized.studentAnswer,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "student-qa",
      inputSummary: input.question,
      outputSummary: normalized.studentAnswer.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: { mode, subject: input.subject || null, taskPolicy }
    }
  };
}

function parseJsonObjectText(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export async function draftTeacherTask(config, input = {}) {
  const taskPolicy = resolveTaskModelPolicy("task-draft", config, input);
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      draft: null,
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "task-draft",
        inputSummary: input.requirement || input.title,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        "你是课后辅导教师助手。根据老师输入，为指定学生生成今日任务草稿。必须返回 JSON，字段为 title, subject, minutes, studentGoal, steps, teacherNote, parentVisibleSummary。"
      )
    },
    {
      role: "user",
      content: JSON.stringify(input, null, 2)
    }
  ];

  const result = await timedCall(() => callGpt56Chat(config, messages, { reasoningEffort: "low" }));
  const text = result.body ? extractChatText(result.body) : "";

  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: provider.model,
    draftText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "task-draft",
      inputSummary: input.requirement || input.title || "",
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
        metadata: { studentId: input.studentId || null, subject: input.subject || null, taskPolicy }
    }
  };
}

export async function draftAssessment(config, input = {}, execution = {}) {
  return runAssessmentPipeline(config, input, execution, runTeachingTask);
}

export async function generateSubmissionReferenceAnswers(config, input = {}, execution = {}) {
  return runSubmissionPipeline(config, "reference", input, execution, runTeachingTask);
}

export async function gradeSubmissionText(config, input = {}, execution = {}) {
  return runSubmissionPipeline(config, "grading", input, execution, runTeachingTask);
}

export async function draftStudentProfileNarrative(config, input = {}) {
  const taskPolicy = resolveTaskModelPolicy("student-profile", config, input);
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      narrative: null,
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "student-profile-narrative",
        inputSummary: input.studentName || input.studentId || "",
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        "你是小学三到六年级课后辅导的学情分析助手。根据服务端提供的 profileEvidencePack 和 snapshot 生成周档案或月度综合长期成长档案草稿。只输出严格 JSON，不要输出解释性正文。顶层字段必须包含 profileType, period, publishedView, teacherReview。profileType 只能是 weekly_growth 或 monthly_comprehensive_growth。publishedView 必须包含 overview, subjectOverview, focusSubjects, correctionLoop, stableGrowth, tutoringFocus, parentNextSteps, timelinePreview；每个可展示结论都必须带 evidenceRefs 和 confidence，confidence 只能是 confirmed、supported、weak、blocked。teacherObservationEvidence 是教师确认的每日观察：可作为当天表现和下一次辅导动作的依据，但单条观察不得推断掌握度、分数或长期趋势。teacherReview 必须包含 evidenceItems, sampleLimitNotes, pendingConfirmations, internalRisks, publishChecklist。证据不足时写继续观察，不编造强结论。不要提及任何模型或供应商。语气温和、具体、可行动。"
      )
    },
    {
      role: "user",
      content: JSON.stringify(input, null, 2)
    }
  ];

  const result = await timedCall(() => callGpt56Chat(config, messages, { reasoningEffort: "low" }));
  const text = result.body ? extractChatText(result.body) : "";

  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: provider.model,
    narrativeText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "student-profile-narrative",
      inputSummary: `${input.studentName || input.studentId || "student"} ${input.periodKey || ""}`.trim(),
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: {
        studentId: input.studentId || null,
         periodKey: input.periodKey || null,
         taskPolicy
      }
    }
  };
}

export async function reviewWithMiniMax(config, input = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "minimax");
  const isSubmissionAudit = input.reviewTask === "submission-grading-audit";
  const isAssessmentDraftAudit = input.reviewTask === "assessment-draft-quality-audit";
  if (provider?.status !== "ready") {
    return fallbackUnavailable("minimax", provider?.reason || "MiniMax unavailable", {
      reviewText: "",
      modelRun: {
        provider: "minimax",
        model: provider?.model,
        skill: isAssessmentDraftAudit ? "assessment-draft-quality-audit" : isSubmissionAudit ? "submission-grading-audit" : "model-review",
        inputSummary: input.title || input.kind || "",
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const runtime = normalizeRuntimeConfig(config);
  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        isSubmissionAudit
          ? "你是图片批改结果的第二模型审计助手。你不重新给最终分，只审计批改证据是否可靠。重点检查：学生作答是否和印刷题干区分清楚、参考答案是否存在或已生成、生成卷的 questionLayoutManifest 是否已和 OCR 逐题对齐、逐题对错是否与作答证据一致、分数是否和逐题结果一致、是否有 OCR/图片证据不足、是否存在把题干当答案或把批改痕迹当学生作答。客观题、填空题和简单计算题只要学生答案与参考答案清晰可比，不要因为没有完整解题过程或 bbox 较粗略就直接判为不可信；解答题、图形题和过程题才重点要求过程证据。AI 生成参考答案在题干清楚、答案明显、confidence 较高时可以作为审计依据；教师最终确认归档是业务流程，不应单独作为模型审计阻塞原因。archiveAllowed 表示模型审计认为可进入教师确认归档流程，不代表自动入档；不要仅因为仍需教师确认而设置 false。没有具体、可操作的问题时必须 status=pass、scoreReliable=true、archiveAllowed=true；如果 status=needs_review，issues 必须列出具体证据问题。返回严格 json 对象：{status, issues, suggestions, riskLevel, scoreReliable, archiveAllowed}。status 只能为 pass 或 needs_review；riskLevel 为 low/medium/high；只要证据不足或分数不可信，scoreReliable=false 且 archiveAllowed=false。"
          : isAssessmentDraftAudit
            ? "你是君航 AI 助教生成与打印模块的第二模型质量审查器。你不重新生成整套题，只检查草稿是否值得进入 PDF 草稿给教师审查。重点检查：科目结构是否符合小学语文/数学/英语通用卷面，难度和年级是否匹配，题量是否支撑目标 A4 页数且不过度留白，每个大题小题数量是否为偶数，是否存在重复、同质题或明显套用固定题池，是否只是替换数字/人名而没有改变考法，语文田字格/横线/阅读/作文规则是否合理，数学填空/选择/计算/解答和图形元数据是否齐全，英语阅读、完形、写作和听力提示是否合理，答案、解析步骤、考点、易错点和分值是否完整。返回严格 json 对象：{status, issues, suggestions, riskLevel, exportReady, qualityScore}。status 只能为 pass 或 needs_review；riskLevel 为 low/medium/high；发现会影响打印、作答、解析或家长信任的问题时 exportReady=false。不要输出供应商、模型名称或给前端展示用文案。"
            : "你是第二模型复核助手。只检查结构、题量、年级适配、解析完整性、图片/OCR证据和排版风险。返回严格 json 对象：{status, issues, suggestions, riskLevel}。不要重写整份内容。"
      )
    },
    { role: "user", content: `请按 json 对象输出审查结果，不要输出 json 之外内容。\n\n${JSON.stringify(input, null, 2)}` }
  ];
  const result = await timedCall(() => callMiniMaxChat(config, messages, {
    model: runtime.minimaxModel,
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: 4000
  }));
  const text = result.body ? extractChatText(result.body) : "";
  return {
    available: result.status === "SUCCESS",
    providerId: "minimax",
    model: runtime.minimaxModel,
    reviewText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "minimax",
      model: runtime.minimaxModel,
      skill: isAssessmentDraftAudit ? "assessment-draft-quality-audit" : isSubmissionAudit ? "submission-grading-audit" : "model-review",
      inputSummary: input.title || input.kind || "",
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: { subject: input.subject || null, kind: input.kind || null, reviewTask: input.reviewTask || null }
    }
  };
}

export async function reviewWithGpt56(config, input = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const runtime = normalizeRuntimeConfig(config);
  const isAssessmentDraftAudit = input.reviewTask === "assessment-draft-quality-audit";
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      reviewText: "",
      modelRun: {
        provider: "gpt56",
        model: runtime.gpt56Model,
        skill: isAssessmentDraftAudit ? "assessment-draft-quality-audit" : "premium-grading-review",
        inputSummary: input.title || input.kind || "",
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        isAssessmentDraftAudit
          ? "你是君航 AI 助教生成与打印模块的最高级质量审查器。你不重新出整套题，只审查生成草稿是否适合进入 PDF 草稿给教师复核。重点检查：是否符合年级和科目结构、题量是否支撑目标 A4 页数、是否有重复同质题或明显套用固定题池、是否只是替换数字/人名而没有改变考法、阅读材料是否有上下文、数学图形题是否有 figure 元数据、语文田字格/横线/作文规则是否合理、英语完形/提示词填空和写作是否符合要求、每题是否有答案、分值、解析步骤、考点和易错提醒。教师最终确认是业务流程，不应单独作为审查阻塞原因。返回严格 json 对象：{status,riskLevel,exportReady,issues,suggestions,blockedReasons,qualityScore}。status 只能为 pass 或 needs_review；如果存在会影响打印、作答、解析或家长信任的问题，exportReady=false。不要输出供应商、模型名称或给前端展示用文案。"
          : "你是君航 AI 助教图片批改模块的最高级质量审查器。你不直接面向学生和家长，只负责内部归档前门禁。请根据 OCR 证据、参考答案、生成卷 questionLayoutManifest、服务层客观题比较结果和主观题批改结果，判断分数是否可信。必须重点拦截：多页漏识、生成卷题号和 OCR 作答没有对齐、把印刷题干当学生答案、学生作答区域缺失、参考答案明显不可靠、逐题分数和总分不一致、异常低分或异常高分、公式/图形题证据不足。客观题、填空题和简单计算题只要学生答案与参考答案清晰可比，不要因为没有完整解题过程或 bbox 较粗略就直接判为不可信；解答题、图形题和过程题才重点要求过程证据。AI 生成参考答案在题干清楚、答案明显、confidence 较高时可以作为高级审查依据；教师最终确认归档是业务流程，不应单独作为高级审查阻塞原因。archiveAllowed 表示高级审查认为可进入教师确认归档流程，不代表自动入档；不要仅因为仍需教师确认而设置 false。返回严格 json 对象：{status,riskLevel,scoreReliable,archiveAllowed,finalScoreRecommended,issues,suggestions,blockedReasons,questionFlags}。status 只能为 pass 或 needs_review；只要证据不足、模型分歧未解决或分数异常，scoreReliable=false 且 archiveAllowed=false。不要输出供应商、模型名称或给前端展示用文案。"
      )
    },
    { role: "user", content: `请按 json 对象输出审查结果，不要输出 json 之外内容。\n\n${JSON.stringify(input, null, 2)}` }
  ];
  const result = await timedCall(() => callGpt56Chat(config, messages, {
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: 5000,
    timeoutMs: runtime.gpt56ReviewTimeoutMs,
    reasoningEffort: "high"
  }));
  const text = result.body ? extractChatText(result.body) : "";
  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: runtime.gpt56Model,
    reviewText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: runtime.gpt56Model,
      skill: isAssessmentDraftAudit ? "assessment-draft-quality-audit" : "premium-grading-review",
      inputSummary: input.title || input.kind || "",
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: {
        subject: input.subject || null,
        reviewTask: input.reviewTask || null,
        score: input.grading?.score ?? null
      }
    }
  };
}

export async function reviewWithGpt55(config, input = {}) {
  return reviewWithGpt56(config, input);
}

export function buildDictationSpeechPlan(input = {}) {
  const difficulty = input.difficulty || "基础";
  const repeats = input.repeats ?? (difficulty.includes("提高") || difficulty.includes("综合") ? 3 : 2);
  const intervalSeconds =
    input.intervalSeconds ?? (difficulty.includes("提高") || difficulty.includes("综合") ? 15 : 10);

  return {
    title: input.title,
    subject: input.subject,
    repeats,
    intervalSeconds,
    items: (input.items || []).map((text, index) => ({
      orderIndex: index + 1,
      text,
      voiceText: Array.from({ length: repeats }, () => text).join("。")
    })),
    lockScreenDuringPlayback: true,
    revealAfterCompleted: true
  };
}

export async function createMiniMaxSpeechTask(config, input = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "minimax");
  if (provider?.status !== "ready") {
    return fallbackUnavailable("minimax", provider?.reason || "MiniMax unavailable", {
      task: null,
      modelRun: {
        provider: "minimax",
        model: provider?.model,
        skill: "speech-synthesis",
        inputSummary: input.text?.slice(0, 120) || "",
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const runtime = normalizeRuntimeConfig(config);
  const url = `${runtime.minimaxT2aBaseUrl.replace(/\/$/, "")}/v1/t2a_async_v2`;
  const result = await timedCall(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.minimaxApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: runtime.minimaxSpeechModel,
        text: input.text,
        voice_setting: input.voiceSetting || {
          voice_id: input.voiceId || "male-qn-qingse",
          speed: input.speed || 1,
          vol: input.volume || 1,
          pitch: input.pitch || 0
        },
        audio_setting: input.audioSetting || {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1
        }
      })
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = body?.base_resp?.status_msg || body?.message || response.statusText;
      throw new Error(`${response.status} ${message}`);
    }
    return body;
  });

  return {
    available: result.status === "SUCCESS",
    providerId: "minimax",
    model: runtime.minimaxSpeechModel,
    task: result.body,
    error: result.error,
    modelRun: {
      provider: "minimax",
      model: runtime.minimaxSpeechModel,
      skill: "speech-synthesis",
      inputSummary: input.text?.slice(0, 120) || "",
      outputSummary: JSON.stringify(result.body || {}).slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: { url }
    }
  };
}
