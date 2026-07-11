import { buildAssessmentPartitions, mapWithConcurrency } from "./assessment-partitions.js";
import {
  classifySolEscalationError,
  describeModelError,
  solEscalationEnabled,
  validateAssessmentPartition
} from "./model-escalation.js";

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
    defaultModel: "MiniMax-M3",
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
    label: "英语词汇解释",
    providerId: "gpt56",
    appSurface: "英语词汇助手"
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
    id: "vocabulary-voice",
    label: "词汇发音/跟读",
    providerId: "minimax",
    appSurface: "英语词汇助手"
  },
  {
    id: "spoken-practice",
    label: "口语对话",
    providerId: "minimax",
    appSurface: "英语词汇助手"
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
      "deepseek-v4-flash",
    minimaxApiKey: config.MINIMAX_API_KEY || config.minimaxApiKey || "",
    minimaxBaseUrl:
      config.MINIMAX_BASE_URL || config.minimaxBaseUrl || "https://api.minimaxi.com/v1",
    minimaxModel:
      config.MINIMAX_TEXT_MODEL || config.minimaxModel || "MiniMax-M3",
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
    ocrVisionModel: config.OCR_VISION_MODEL || config.ocrVisionModel || "coding_plan/vlm",
    ocrTesseractLang: config.OCR_TESSERACT_LANG || config.ocrTesseractLang || "chi_sim+eng",
    gpt56ApiKey: config.GPT56_API_KEY || config.gpt56ApiKey || config.GPT55_API_KEY || config.gpt55ApiKey || config.OPENAI_API_KEY || config.openaiApiKey || "",
    gpt56BaseUrl: config.GPT56_BASE_URL || config.gpt56BaseUrl || config.GPT55_BASE_URL || config.gpt55BaseUrl || config.OPENAI_BASE_URL || config.openaiBaseUrl || "https://api.openai.com/v1",
    gpt56Model: config.GPT56_MODEL || config.gpt56Model || config.GPT55_MODEL || config.gpt55Model || "gpt-5.6",
    gpt56GenerationTimeoutMs: Number(config.GPT56_GENERATION_TIMEOUT_MS || config.gpt56GenerationTimeoutMs || config.GPT56_ASSESSMENT_TIMEOUT_MS || config.gpt56AssessmentTimeoutMs || config.GPT55_ASSESSMENT_TIMEOUT_MS || config.gpt55AssessmentTimeoutMs || 90000),
    gpt56GradingTimeoutMs: Number(config.GPT56_GRADING_TIMEOUT_MS || config.gpt56GradingTimeoutMs || config.GPT56_ASSESSMENT_TIMEOUT_MS || config.gpt56AssessmentTimeoutMs || config.GPT55_ASSESSMENT_TIMEOUT_MS || config.gpt55AssessmentTimeoutMs || 90000),
    gpt56ReviewTimeoutMs: Number(config.GPT56_REVIEW_TIMEOUT_MS || config.gpt56ReviewTimeoutMs || config.GPT55_REVIEW_TIMEOUT_MS || config.gpt55ReviewTimeoutMs || 60000),
    gpt56ReasoningEffortEnabled: String(config.GPT56_REASONING_EFFORT_ENABLED ?? config.gpt56ReasoningEffortEnabled ?? "false").toLowerCase() === "true",
    gpt56SolFallbackEnabled: String(config.GPT56_SOL_FALLBACK_ENABLED ?? config.gpt56SolFallbackEnabled ?? "false").toLowerCase() === "true",
    gpt56SolModel: config.GPT56_SOL_MODEL || config.gpt56SolModel || "gpt-5.6-sol",
    gpt56SolFallbackTimeoutMs: Number(config.GPT56_SOL_FALLBACK_TIMEOUT_MS || config.gpt56SolFallbackTimeoutMs || 180000)
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
        model: runtime.gpt56Model,
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
  reasoningEffort
}) {
  if (!apiKey) throw new Error("Missing API key");

  const payload = { model, messages, temperature };
  if (responseFormat) payload.response_format = responseFormat;
  if (maxTokens) payload.max_tokens = maxTokens;
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response;
  let text;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller?.signal
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`MODEL_TIMEOUT after ${timeoutMs}ms`);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
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
        throw responseError;
      }
    }
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || text.trim() || response.statusText;
    const requestError = new Error(`${response.status} ${message}`);
    requestError.status = response.status;
    requestError.code = body?.error?.code || body?.code || null;
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

function withProjectPromptPrinciples(content) {
  return `${projectPromptPrinciples}\n\n${content}`;
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
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const mode = input.mode || inferClassroomQaMode(input.question);

  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      mode,
      answer: "AI 问答暂时不可用，老师稍后会协助处理。",
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "student-qa",
        inputSummary: input.question,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const system =
    mode === "GUIDED_THINKING"
      ? withProjectPromptPrinciples("你是小学三到六年级课后辅导助教。遇到题目或作业问题时，只做思路引导、关键步骤提示和追问，不直接给最终答案。语气温和、简短。")
      : withProjectPromptPrinciples("你是小学三到六年级课后辅导助教。常识或知识概念可以直接解释，语言适合小学生和家长理解。");

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

  const result = await timedCall(() => callGpt56Chat(config, messages, { reasoningEffort: "low" }));
  const answer = result.body ? extractChatText(result.body) : "";

  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: provider.model,
    mode,
    answer: answer || "这次问题没有拿到稳定回答，建议老师复核。",
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "student-qa",
      inputSummary: input.question,
      outputSummary: answer.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: { mode, subject: input.subject || null }
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

function normalizeVocabularyCard(input = {}, parsed = {}) {
  const word = String(parsed.word || parsed.term || input.word || "").trim().toLowerCase();
  const related = Array.isArray(parsed.related)
    ? parsed.related.map((item) => ({
        word: String(item?.word || "").trim(),
        part: String(item?.part || item?.partOfSpeech || "").trim(),
        partCn: String(item?.partCn || item?.partOfSpeechCn || "").trim(),
        meaning: String(item?.meaning || "").trim()
      })).filter((item) => item.word)
    : [];
  const examples = Array.isArray(parsed.examples)
    ? parsed.examples.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    word: word || "word",
    phonetic: String(parsed.phonetic || "").trim(),
    part: String(parsed.part || parsed.partOfSpeech || "").trim(),
    partCn: String(parsed.partCn || parsed.partOfSpeechCn || "").trim(),
    meaning: String(parsed.meaning || "").trim(),
    related,
    examples,
    pitfall: String(parsed.pitfall || parsed.pitfalls || parsed.commonMistake || "").trim(),
    needsTeacherReview: Boolean(parsed.needsTeacherReview ?? true),
    aiGenerated: true
  };
}

export async function generateVocabularyCard(config, input = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const word = String(input.word || input.term || "").trim();
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      card: normalizeVocabularyCard(input, {
        word,
        meaning: "AI 词汇生成暂时不可用，请稍后重试或交给老师补充。",
        needsTeacherReview: true
      }),
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "vocabulary-card",
        inputSummary: word,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        "你是小学三到六年级英语词汇助教。根据学生输入的英文单词生成学习卡片，只返回严格 JSON，不要输出 JSON 之外的内容。字段必须为：word, phonetic, part, partCn, meaning, related, examples, pitfall, needsTeacherReview。related 是数组，每项包含 word, part, partCn, meaning；examples 给 2 个适合小学生的英文例句；pitfall 写易错点。不要提及模型或供应商。"
      )
    },
    {
      role: "user",
      content: JSON.stringify({
        word,
        grade: input.grade || null,
        studentName: input.studentName || null
      }, null, 2)
    }
  ];

  const result = await timedCall(() => callGpt56Chat(config, messages, {
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    maxTokens: 900,
    timeoutMs: 30000,
    reasoningEffort: "none"
  }));
  const text = result.body ? extractChatText(result.body) : "";
  const parsed = parseJsonObjectText(text) || {};
  const card = normalizeVocabularyCard(input, parsed);
  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: provider.model,
    card,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "vocabulary-card",
      inputSummary: word,
      outputSummary: JSON.stringify(card).slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: { word, grade: input.grade || null }
    }
  };
}

export async function draftTeacherTask(config, input = {}) {
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
      metadata: { studentId: input.studentId || null, subject: input.subject || null }
    }
  };
}

export async function draftAssessment(config, input = {}, execution = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const runtime = normalizeRuntimeConfig(config);
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      draftText: "",
      modelRun: {
        provider: "gpt56",
        model: provider?.model,
        skill: "assessment-draft",
        inputSummary: input.requirement || input.title,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const defaultPages = input.kind === "试卷" ? 4 : 2;
  const subject = String(input.subject || "");
  const kind = String(input.kind || "练习");
  const requirement = String(input.requirement || input.specialRequirements || "");
  const gradeText = String(input.grade || input.targetGrade || "");
  const gradeNumber = /三|3/.test(gradeText) ? 3 : /四|4/.test(gradeText) ? 4 : /五|5/.test(gradeText) ? 5 : 6;
  const includeListening = !/不需要听力|无需听力|不要听力|不含听力|无听力|不用听力|no listening|without listening/i.test(requirement) && /听力|听音|listening|audio|录音/i.test(requirement);
  const englishAssessmentRule = kind === "试卷"
    ? `英语试卷使用完整考试结构：${includeListening ? "听力、" : ""}单项选择题、词汇运用、阅读理解、写作。听力只在老师特殊要求中提到听力时生成，并把听力材料放入解析。词汇运用必须分成两类题：1）文章选词填空，给出一篇完整短文，在文中挖空，每空提供 A/B/C 三个意思或形式相近选项，学生根据上下文选最佳答案；这不是方框词题，不要提供方框词词库。2）完形填空/短文语法填空，在短文中给出括号提示词，学生根据词性、时态、单复数、比较级等进行变形。不要默认生成方框词选词填空；只有老师特殊要求明确写“方框词”时才允许方框词题。写作根据年级设置要求：三四年级句子/短段，五六年级短文。试卷题量要能撑满四页A4：${includeListening ? "听力约8题、" : ""}选择约${includeListening ? 12 : 15}题、词汇约${includeListening ? 12 : 15}题、阅读约10题、写作1题。阅读理解必须包含正式试卷长度的长篇短文或阅读材料，五六年级试卷每篇建议 280-330 个英文词，三四年级每篇建议 170-220 个英文词。`
    : kind === "小测"
      ? "英语小测围绕教材单元、课本章节或当周教学内容生成，结构必须短而集中：中英文互译、写单词、造句子、少量选择题和一篇阅读理解。中译英、根据中文写英文单词或短语、造句和中译英句子补全必须提供 answerFormat:'english-four-line'，作答区采用题干在上、英语四线格在下的上下结构，不使用普通横线。不得默认生成写作题、文章选词填空、完形填空或短文语法填空；除非老师明确要求听力，否则不生成听力。阅读应贴近单元主题，五六年级约 170-230 个英文词，三四年级约 120-170 个英文词，页面仍有空间时优先加长材料或增加上下文题，不用短篇凑数。"
      : "英语练习围绕学生近期错题、薄弱点或教师指定补弱目标生成，结构以巩固为主：针对性词汇巩固、句型表达练习、易错选择题和阅读巩固。涉及中译英、根据中文写英文单词或短语、造句和中译英句子补全时必须提供 answerFormat:'english-four-line'，用题干在上、英语四线格在下的上下结构作答。不得默认套用试卷结构，不默认生成写作题、文章选词填空、完形填空或短文语法填空；除非老师明确要求听力，否则不生成听力。阅读应服务于练习目标，五六年级约 170-240 个英文词，三四年级约 120-180 个英文词。";
  const englishReferencePattern = kind === "试卷"
    ? "参考公开小学英语试卷常见模式，但题目必须原创：单项选择覆盖时态、固定搭配、代词、连词、情景交际；词汇运用包含文章选词填空和短文语境完形填空；文章选词填空要在文段内挖空，每空提供 A/B/C 三个近义或近形选项，让学生根据上下文、句意和语法选择最佳答案，不默认使用方框词词库；完形/短文语法填空使用括号提示词并要求词性、时态、单复数或比较级变化；阅读理解使用两篇有完整上下文的长篇材料；写作只保留一个任务，五六年级短文，三四年级句子或短段。"
    : kind === "小测"
      ? "参考单元随堂检测常见模式，但题目必须原创：中英互译检查核心词汇和短语，写单词检查拼写，造句检查本单元句型，造句题可以包含中译英句子补全或指定词表达，选择题只做少量易错辨析，阅读围绕单元活动、日期、人物或主题情境。需要学生写英文的填空、短语、造句和句子补全必须使用 answerFormat:'english-four-line'。不要把试卷中的文章选词填空、完形填空或写作搬进小测。"
      : "参考个性化巩固练习常见模式，但题目必须原创：词汇巩固、句型表达、易错选择和短阅读要围绕薄弱点形成梯度；题量服务于补弱和复练，不套用完整试卷结构，不默认加入文章选词填空、完形填空或写作。";
  const subjectRules = {
    数学: "数学固定结构：填空题、选择题、计算题、解答题。没有特殊要求不要生成附加题。试卷题量要能撑满四页A4：填空约12题、选择约8题、计算约8题、解答约5题；小测/练习两页A4：填空约8题、选择约6题、计算约4题、解答约4题。计算题和解答题只需要给适度 answerSpaceMm，后端会渲染干净白色过程区，不要要求横线。需要图形的题必须提供 figure，不允许只写“如图”。",
    语文: `语文固定结构：基础知识、积累与应用、阅读理解；只有试卷才允许写作题，小测和练习绝对不要生成作文/习作题。${gradeNumber >= 5 ? "五六年级试卷可以加入文言文阅读或文言句意理解，但现代文阅读仍必须是主体。" : "三四年级不要主动加入文言文题。"} 试卷题量要能撑满四页A4：基础知识约12题、积累应用约8题、阅读理解约10-12题、写作1题；小测/练习两页A4：基础知识约8题、积累应用约6题、阅读理解约8题。语文现代文阅读材料必须像正式试卷材料，不允许短日记式片段；小测/练习现代文不少于550个汉字，试卷现代文不少于700个汉字，并设置内容概括、原因分析、句意理解、信息筛选、表达效果、拓展启示等上下文题。写作题只生成一个题目、提示和要求；如果写作题单独成页或空间充足，可提供 answerFormat:'chinese-square-grid' 和适度 answerSpaceMm，后端会渲染多列方格；如果空间不足则只显示题目要求。看拼音写词语不要写成“拼音+括号”，要提供 answerFormat:'tianzige' 和 pinyinWords:[{pinyin,cells}]；积累与应用只给短作答空间，阅读简答最多少量作答线，不要每道小题下方画分隔线。`,
    英语: `${englishAssessmentRule} 阅读题必须包含细节定位、原因推断、词义猜测、主旨标题或事件顺序等上下文题，不能只生成孤立选择题。阅读题请给 passageGroupId、passageTitle、passageText、passageQuestionIndex，且每组第一题 showPassage=true。`
  };
  const referencePatterns = {
    数学: "参考公开小学试卷和智慧中小学组题的常见模式，但题目必须原创：概念填空覆盖单位换算、分数小数百分数、比和比例、几何概念；选择题做易错概念辨析；计算题分直接计算、简便计算、解方程、图形公式计算；解答题加入生活情境、图形操作或数据表格。图形操作题归入解答题，不另起附加题。",
    语文: "参考公开小学语文试卷常见模式，但题目必须原创：基础知识包含看拼音写词语、易错字音字形、成语/词语、关联词、修辞；积累与应用包含句式转换、病句修改、标点、古诗文积累、口语交际或应用文信息提取；阅读理解必须使用完整现代文材料，不能用几句话凑阅读；高年级试卷可加一篇短文言文；小测和练习不出作文，试卷作文只列题目要求。",
    英语: englishReferencePattern
  };
  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        `你是小学教研出题助手。生成内容必须可以直接按 A4 试卷打印，不能只给一串未分类题目。可以参考公开小学试卷网站、教辅和智慧中小学组题模式的题型结构，但只能借鉴结构和考法，不能复制现成题目、阅读材料、答案或固定模板；每次生成都要围绕 requestId、年级、学科、难度和教师要求重新原创。返回严格 JSON：{title, layout, sections, printNotes}。sections 中每项必须包含 title, type, items。每道题必须包含 itemType(fill|choice|judgment|calculation|solution|operation|reading|writing|listening), prompt, answer, analysisSteps(string[]), commonMistake, knowledgePoint, score, answerSpaceMm；选择题还必须有 options(string[])。题目需要图形时必须提供 figure 对象，不允许只写“如图”却没有 figure。三角形可用 {type:'triangle',labels:['A','B','C'],angleLabels:{A:'50°'},equalAngles:['B','C']}；长方形可用 {type:'rectangle',widthLabel:'8cm',heightLabel:'5cm'}；圆可用 {type:'circle',radiusLabel:'5cm'}。看拼音写词语要用 answerFormat:'tianzige' 和 pinyinWords。阅读理解要给完整材料，不允许只有一个短句配一个答案。解析必须写出分步过程和关键依据，不能只有答案。不要在小题之间设计横线分隔；填空、选择、判断、写作题不要大块空白；计算和解答题只标注适度 answerSpaceMm，后端会渲染白色作答区。卷头的姓名、日期、得分只在首页出现；不要输出“用时”。小测和练习总分60分，试卷总分100分，有附加题时试卷总分110分。小测和练习默认两页 A4，试卷默认四页 A4。${subjectRules[subject] || ""} ${referencePatterns[subject] || ""}`
      )
    },
    {
      role: "user",
      content: `请只返回 json 对象，不要输出 json 之外内容。\n\n${JSON.stringify(
        {
          ...input,
          defaultPaper: "A4",
          defaultPages,
          assessmentKind: kind,
          subjectRule: subjectRules[subject] || "",
          referencePattern: referencePatterns[subject] || "",
          grades: ["三年级", "四年级", "五年级", "六年级"]
        },
        null,
        2
      )}`
    }
  ];

  const assessmentTotalTimeoutMs = firstPositiveNumber(
    input.assessmentTotalTimeoutMs,
    input.generationTimeoutMs,
    config.ASSESSMENT_DRAFT_TOTAL_TIMEOUT_MS,
    config.assessmentDraftTotalTimeoutMs
  );
  const assessmentTimeoutMs = firstPositiveNumber(
    config.GPT56_GENERATION_TIMEOUT_MS ||
    config.gpt56GenerationTimeoutMs ||
    runtime.gpt56GenerationTimeoutMs ||
    90000
  );
  const minimaxAssessmentTimeoutMs = firstPositiveNumber(
    config.MINIMAX_ASSESSMENT_TIMEOUT_MS ||
    config.minimaxAssessmentTimeoutMs ||
    150000
  );
  const assessmentMaxTokens = firstPositiveNumber(
    input.assessmentMaxTokens,
    input.generationMaxTokens,
    config.ASSESSMENT_DRAFT_MAX_TOKENS,
    config.assessmentDraftMaxTokens,
    12000
  );
  const totalStartedAt = Date.now();
  let totalBudgetExhausted = false;
  const remainingBudgetMs = () => {
    if (!assessmentTotalTimeoutMs) return null;
    return Math.max(1, assessmentTotalTimeoutMs - (Date.now() - totalStartedAt));
  };
  const attemptTimeoutMs = (configuredTimeoutMs) => {
    const remaining = remainingBudgetMs();
    return remaining == null ? configuredTimeoutMs : Math.min(configuredTimeoutMs, remaining);
  };
  const hasBudget = () => {
    const remaining = remainingBudgetMs();
    if (remaining == null || remaining > 1) return true;
    totalBudgetExhausted = true;
    return false;
  };
  const markBudgetFromResult = (attemptResult) => {
    if (/MODEL_TIMEOUT|ASSESSMENT_TOTAL_TIMEOUT/.test(String(attemptResult?.error || ""))) {
      const remaining = remainingBudgetMs();
      if (remaining != null && remaining <= 5) totalBudgetExhausted = true;
    }
  };
  const partitions = buildAssessmentPartitions({ subject, kind });
  const basePartitionTokens = Math.floor(assessmentMaxTokens / partitions.length);
  const extraPartitionTokens = assessmentMaxTokens % partitions.length;
  const partitionTokenBudget = (index) => {
    const allocated = basePartitionTokens + (index < extraPartitionTokens ? 1 : 0);
    return kind === "试卷" ? allocated : Math.min(allocated, 8000);
  };
  const primaryModel = execution.model || runtime.gpt56Model;
  const primaryReasoningEffort = primaryModel === runtime.gpt56SolModel
    ? "high"
    : execution.reasoningEffort || (kind === "试卷" ? "high" : "medium");
  const solGateOpen = (
    solEscalationEnabled(runtime) &&
    execution.disableSolEscalation !== true &&
    execution.evidenceSufficient !== false &&
    primaryModel !== runtime.gpt56SolModel
  );
  const attempts = [];
  const recordAttempt = (role, partition, attemptResult, options = {}) => {
    markBudgetFromResult(attemptResult);
    const trigger = options.trigger || null;
    attempts.push({
      role,
      partitionId: partition.id,
      providerId: "gpt56",
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      trigger: trigger ? {
        triggerClass: trigger.triggerClass,
        triggerCode: trigger.triggerCode,
        issues: trigger.issues || []
      } : null,
      triggerClass: trigger?.triggerClass || null,
      triggerCode: trigger?.triggerCode || null,
      triggerIssues: trigger?.issues || [],
      status: attemptResult.status,
      latencyMs: attemptResult.latencyMs ?? null,
      error: attemptResult.error || null
    });
  };
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
      content: `${message.content}\n\n本次只生成分区：${partition.title}。允许题型：${partition.itemTypes.join(", ")}。不要生成其他分区。顶层仍返回 {title,layout,sections,printNotes}，sections 只包含本分区。请精简输出，避免重复规则和冗长说明；优先保证 JSON 完整，并让每题的答案、解析步骤、考点、易错点和分值字段齐全。${trigger?.issues?.length ? `必须修复：${trigger.issues.join("；")}。` : ""}`
    });
    const result = await timedCall(() => callGpt56Chat(config, partitionMessages, {
      model,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      maxTokens: partitionTokens,
      timeoutMs,
      reasoningEffort
    }));
    recordAttempt(role, partition, result, {
      model,
      reasoningEffort,
      timeoutMs,
      maxTokens: partitionTokens,
      trigger
    });
    return { partition, index, partitionTokens, result };
  };
  const primaryCallOptions = {
    role: execution.role,
    model: primaryModel,
    reasoningEffort: primaryReasoningEffort,
    timeoutMs: execution.timeoutMs
  };
  let partitionResults = await mapWithConcurrency(
    partitions,
    2,
    (partition, index) => callPartition(partition, index, primaryCallOptions)
  );
  const reserveMs = assessmentTotalTimeoutMs ? Math.max(1000, Math.floor(assessmentTotalTimeoutMs * 0.15)) : 0;
  const retryable = partitionResults.filter((entry) => {
    if (entry.result.status === "SUCCESS") return false;
    const classification = classifySolEscalationError(entry.result.errorDetails || { message: entry.result.error });
    return !(solGateOpen && classification.allowed);
  });
  if (retryable.length && hasBudget() && (remainingBudgetMs() == null || remainingBudgetMs() > reserveMs)) {
    const retries = await mapWithConcurrency(retryable, 2, (entry) => callPartition(entry.partition, entry.index, {
      ...primaryCallOptions,
      role: "partition-retry"
    }));
    const retryByIndex = new Map(retries.map((entry) => [entry.index, entry]));
    partitionResults = partitionResults.map((entry) => retryByIndex.get(entry.index) || entry);
  }
  const parsePartition = (entry) => {
    const text = entry.result.body ? extractChatText(entry.result.body) : "";
    const parsed = parseJsonObjectText(text);
    let validation = null;
    let trigger = null;
    if (entry.result.status !== "SUCCESS") {
      trigger = classifySolEscalationError(entry.result.errorDetails || { message: entry.result.error });
    } else if (!parsed) {
      const issues = [`partition:${entry.partition.id}:malformed_json`];
      validation = { valid: false, codes: ["malformed_json"], issues };
      trigger = {
        allowed: true,
        triggerClass: "quality",
        triggerCode: "partition_validation",
        issues
      };
    } else {
      validation = validateAssessmentPartition(parsed, entry.partition);
      if (!validation.valid) {
        trigger = {
          allowed: true,
          triggerClass: "quality",
          triggerCode: "partition_validation",
          issues: validation.issues
        };
      }
    }
    return {
      ...entry,
      text,
      parsed,
      validation,
      trigger,
      usable: entry.result.status === "SUCCESS" && Boolean(parsed) && validation?.valid === true
    };
  };
  const parsedTerraPartitions = partitionResults.map(parsePartition);
  const eligibleFailures = solGateOpen
    ? parsedTerraPartitions.filter((entry) => !entry.usable && entry.trigger?.allowed === true)
    : [];
  const allTerraUnusable = parsedTerraPartitions.every((entry) => !entry.usable);
  const solScenarioBudgetMs = kind === "小测"
    ? 120000
    : kind === "试卷" || input.generationProfile === "formal-full"
      ? 240000
      : 150000;
  const solTotalBudgetMs = eligibleFailures.length > 0 && allTerraUnusable ? solScenarioBudgetMs : null;
  const solNow = typeof execution.now === "function" ? execution.now : Date.now;
  const solStartedAt = solNow();
  const solAttemptTimeoutMs = () => {
    if (!solTotalBudgetMs) return runtime.gpt56SolFallbackTimeoutMs;
    const remaining = Math.max(0, solTotalBudgetMs - (solNow() - solStartedAt));
    return Math.min(runtime.gpt56SolFallbackTimeoutMs, remaining);
  };
  const escalatedPartitions = await mapWithConcurrency(eligibleFailures, 2, async (entry) => {
    const timeoutMs = solAttemptTimeoutMs();
    if (timeoutMs <= 0) return entry;
    return callPartition(entry.partition, entry.index, {
      role: "sol-escalation",
      model: runtime.gpt56SolModel,
      reasoningEffort: "high",
      timeoutMs,
      trigger: entry.trigger
    }).then(parsePartition);
  });
  const escalatedByIndex = new Map(escalatedPartitions.map((entry) => [entry.index, entry]));
  const finalPartitions = parsedTerraPartitions.map((entry) => escalatedByIndex.get(entry.index) || entry);
  let successfulPartitions = finalPartitions.filter((entry) => entry.usable);
  const solAttempts = attempts.filter((attempt) => attempt.role === "sol-escalation");
  const escalationTriggered = solAttempts.length > 0;
  const usedModelEscalation = escalatedPartitions.some((entry) => entry.usable);
  const escalationScopes = solAttempts.map((attempt) => attempt.partitionId);
  let usedProvider = "gpt56";
  let usedModel = usedModelEscalation ? runtime.gpt56SolModel : primaryModel;
  let fallbackProvider = null;
  let fallbackBody = null;
  const emergencyFallbackEnabled = String(config.DEEPSEEK_EMERGENCY_FALLBACK_ENABLED ?? config.deepseekEmergencyFallbackEnabled ?? "false").toLowerCase() === "true";
  if (!successfulPartitions.length && !escalationTriggered && emergencyFallbackEnabled && runtime.deepseekApiKey && hasBudget()) {
    const fallbackResult = await timedCall(() => callDeepSeekChat(config, messages, {
      model: runtime.deepseekEmergencyFallbackModel,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      maxTokens: assessmentMaxTokens,
      timeoutMs: attemptTimeoutMs(assessmentTimeoutMs)
    }));
    markBudgetFromResult(fallbackResult);
    attempts.push({
      role: "emergency-rollback",
      partitionId: null,
      providerId: "deepseek",
      model: runtime.deepseekEmergencyFallbackModel,
      status: fallbackResult.status,
      latencyMs: fallbackResult.latencyMs ?? null,
      error: fallbackResult.error || null
    });
    const fallbackText = fallbackResult.body ? extractChatText(fallbackResult.body) : "";
    const fallbackParsed = parseJsonObjectText(fallbackText);
    if (fallbackResult.status === "SUCCESS" && fallbackParsed) {
      usedProvider = "deepseek";
      usedModel = runtime.deepseekEmergencyFallbackModel;
      fallbackProvider = "deepseek";
      fallbackBody = fallbackResult.body;
      successfulPartitions = [{
        index: 0,
        text: fallbackText,
        parsed: fallbackParsed,
        result: fallbackResult
      }];
    }
  }
  const mergedDraft = successfulPartitions.length ? {
    title: successfulPartitions.find((entry) => entry.parsed?.title)?.parsed.title || `${gradeText}${subject}${kind}`,
    layout: successfulPartitions.find((entry) => entry.parsed?.layout)?.parsed.layout || { paper: "A4", pages: defaultPages },
    sections: successfulPartitions.flatMap((entry) => Array.isArray(entry.parsed.sections) ? entry.parsed.sections : []),
    printNotes: Array.from(new Set(successfulPartitions.flatMap((entry) => Array.isArray(entry.parsed.printNotes) ? entry.parsed.printNotes : [])))
  } : null;
  const text = mergedDraft ? JSON.stringify(mergedDraft) : "";
  const status = successfulPartitions.length ? "SUCCESS" : "ERROR";
  const failedPartitions = fallbackProvider ? [] : finalPartitions.filter((entry) => !entry.usable);
  const latencyMs = Date.now() - totalStartedAt;
  const primaryError = failedPartitions[0]?.result.error || null;
  if (!successfulPartitions.length && assessmentTotalTimeoutMs && latencyMs >= assessmentTotalTimeoutMs - 5) totalBudgetExhausted = true;

  return {
    available: status === "SUCCESS",
    providerId: usedProvider,
    model: usedModel,
    draftText: text,
    raw: fallbackBody || successfulPartitions.map((entry) => entry.result.body),
    error: status === "ERROR" ? primaryError || "ASSESSMENT_PARTITIONS_FAILED" : undefined,
    modelRun: {
      provider: usedProvider,
      model: usedModel,
      skill: "assessment-draft",
      inputSummary: input.requirement || input.title || "",
      outputSummary: text.slice(0, 240),
      status,
      latencyMs,
      metadata: {
        kind: input.kind || null,
        subject: input.subject || null,
        defaultPages,
        primaryAssessmentModel: runtime.gpt56Model,
        fallbackAssessmentModel: null,
        primaryModel,
        escalationModel: runtime.gpt56SolModel,
        escalationTriggered,
        usedModelEscalation,
        usedDynamicFallback: false,
        escalationScopes,
        solFallbackTimeoutMs: runtime.gpt56SolFallbackTimeoutMs,
        solTotalBudgetMs,
        solBudget: {
          partitionTimeoutMs: runtime.gpt56SolFallbackTimeoutMs,
          totalTimeoutMs: solTotalBudgetMs,
          maxConcurrency: 2
        },
        emergencyFallbackEnabled,
        minimaxFallbackModel: runtime.minimaxModel || null,
        assessmentTimeoutMs,
        minimaxAssessmentTimeoutMs,
        assessmentTotalTimeoutMs: assessmentTotalTimeoutMs || null,
        assessmentMaxTokens,
        generationProfile: input.generationProfile || null,
        totalBudgetExhausted,
        partialGeneration: failedPartitions.length > 0,
        partitions: partitions.map((partition, index) => ({
          id: partition.id,
          title: partition.title,
          itemTypes: partition.itemTypes,
          maxTokens: partitionTokenBudget(index)
        })),
        fallbackProvider,
        attempts,
        primaryError,
        secondaryError: null
      }
    }
  };
}

export async function generateSubmissionReferenceAnswers(config, input = {}, execution = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const runtime = normalizeRuntimeConfig(config);
  const referenceModel = execution.model || runtime.gpt56Model;
  const primaryReasoningEffort = referenceModel === runtime.gpt56SolModel
    ? "high"
    : execution.reasoningEffort || "high";
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      referenceText: "",
      modelRun: {
        provider: "gpt56",
        model: referenceModel,
        skill: "submission-reference-answer",
        inputSummary: input.title || input.subject,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content: withProjectPromptPrinciples(
        "你是小学作业、练习、小测和试卷的标准答案生成助手。只根据已识别的印刷题干、阅读材料、图片OCR文本和老师提供的上下文生成参考答案，不批改学生作答。若输入包含 questionLayoutManifest，说明这是本系统生成卷或其导出清单，必须优先使用其中的 questionNo、prompt、answer、analysisSteps、knowledgePoint、score 作为题目和参考答案证据。若输入包含 ocrQuestions，只能使用其中的 printedPrompt、题号和上下文来分割题目；studentAnswer 和 observedWork 只能帮助判断学生作答区域，不能作为标准答案来源。必须返回严格 JSON，不要输出 JSON 之外内容。字段必须包含：referenceAnswers, summary, confidence, needsTeacherReview。referenceAnswers 是逐题数组，每项包含 questionNo, prompt, correctAnswer, analysisSteps, knowledgePoint, score, confidence。若题干、关键条件、图片内容或学生手写遮挡导致无法可靠生成，必须设置该题 confidence<0.65 并说明 needsTeacherReview=true；不能因为没有老师提供标准答案就放弃生成参考答案。"
      )
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          title: input.title || "",
          subject: input.subject || "",
          kind: input.kind || "",
          grade: input.grade || "",
          printedText: input.printedText || "",
          ocrText: input.ocrText || "",
          studentAnswerText: input.studentAnswerText || "",
          imageNames: input.imageNames || [],
          ocrConfidence: input.ocrConfidence ?? null,
          questionRange: input.questionRange || "",
          ocrQuestions: input.ocrQuestions || [],
          questionLayoutManifest: input.questionLayoutManifest || null,
          assignmentItems: input.assignmentItems || [],
          teacherContext: input.teacherContext || input.assignmentAnalysis || null
        },
        null,
        2
      )
    }
  ];

  const timeoutMs = firstPositiveNumber(execution.timeoutMs, runtime.gpt56GenerationTimeoutMs);
  const primaryResult = await timedCall(() => callGpt56Chat(config, messages, {
    model: referenceModel,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    maxTokens: 12000,
    timeoutMs,
    reasoningEffort: primaryReasoningEffort
  }));
  const attempts = [{
    role: execution.role || "primary",
    model: referenceModel,
    timeoutMs,
    reasoningEffort: primaryReasoningEffort,
    status: primaryResult.status,
    latencyMs: primaryResult.latencyMs,
    error: primaryResult.error || null
  }];
  let result = primaryResult;
  let usedModel = referenceModel;
  const classification = primaryResult.status === "ERROR"
    ? classifySolEscalationError(primaryResult.errorDetails || { message: primaryResult.error })
    : null;
  if (
    classification?.allowed === true &&
    execution.disableSolEscalation !== true &&
    referenceModel !== runtime.gpt56SolModel &&
    solEscalationEnabled(runtime)
  ) {
    const solTimeoutMs = runtime.gpt56SolFallbackTimeoutMs;
    result = await timedCall(() => callGpt56Chat(config, messages, {
      model: runtime.gpt56SolModel,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      maxTokens: 12000,
      timeoutMs: solTimeoutMs,
      reasoningEffort: "high"
    }));
    usedModel = runtime.gpt56SolModel;
    attempts.push({
      role: "sol-escalation",
      model: runtime.gpt56SolModel,
      timeoutMs: solTimeoutMs,
      reasoningEffort: "high",
      triggerClass: classification.triggerClass,
      triggerCode: classification.triggerCode,
      status: result.status,
      latencyMs: result.latencyMs,
      error: result.error || null
    });
  }
  const text = result.body ? extractChatText(result.body) : "";

  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: usedModel,
    referenceText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: usedModel,
      skill: "submission-reference-answer",
      inputSummary: input.title || input.subject || "",
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: {
        studentId: input.studentId || null,
        subject: input.subject || null,
        imageCount: input.imageNames?.length || 0,
        usedModelEscalation: attempts.some((attempt) => attempt.role === "sol-escalation"),
        attempts
      }
    }
  };
}

export async function gradeSubmissionText(config, input = {}, execution = {}) {
  const snapshot = buildAiStartupSnapshot(config);
  const provider = snapshot.providers.find((item) => item.id === "gpt56");
  const runtime = normalizeRuntimeConfig(config);
  const gradingModel = execution.model || runtime.gpt56Model;
  const primaryReasoningEffort = gradingModel === runtime.gpt56SolModel
    ? "high"
    : execution.reasoningEffort || "high";
  if (provider?.status !== "ready") {
    return fallbackUnavailable("gpt56", provider?.reason || "GPT-5.6 unavailable", {
      gradingText: "",
      modelRun: {
        provider: "gpt56",
        model: gradingModel,
        skill: "submission-grading",
        inputSummary: input.title || input.subject,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    });
  }

  const messages = [
    {
      role: "system",
      content:
        "你是小学作业批改助手。基于老师提供的 OCR 文本、题目或答案证据批改。必须优先使用 studentAnswerText、manualText、answerKey 和 assignmentItems；普通 ocrText 可能包含印刷题干，不能把印刷题干或示例答案当作学生作答。必须返回 JSON，字段为 score, summary, strengths, mistakes, nextPractice, needsTeacherReview。无法确认时标记 needsTeacherReview=true。"
    },
    { role: "user", content: `请按 json 对象输出批改结果，不要输出 json 之外内容。\n\n${JSON.stringify(input, null, 2)}` }
  ];
  messages[0].content = withProjectPromptPrinciples(
    "你是小学作业、练习、小测和试卷批改助手。必须按最高置信链路批改：1）优先使用 answerKey、assignmentItems 和 questionLayoutManifest；其中 questionLayoutManifest 是本系统生成 PDF 的逐题清单，包含题号、题干、答案、解析、分值和页内相对区域，必须作为生成卷批改的权威证据；2）没有老师答案键或生成卷清单时，优先使用 referenceAnswers 作为参考答案；3）referenceAnswers 也不足时，才根据 printedText/ocrText 自行推导正确答案和解题步骤；4）studentAnswerText、manualText 是学生作答的最高优先证据，普通 ocrText 可能混有印刷题干，不能把印刷题干、题目自带答案或示例内容当作学生作答。若输入包含 ocrQuestions，必须优先按 ocrQuestions 逐题批改：使用 printedPrompt 理解题目，使用 studentAnswer/observedWork 判断学生作答，使用 bbox 生成对应题目的相对图片坐标；不要把其他题或印刷题干串到本题作答里。若 questionLayoutManifest 和 ocrQuestions 同时存在，先按题号对齐，再用 ocrQuestions 判定学生作答。不得因为缺少标准答案而直接判定无法确认；只有题干、关键条件、图片内容或学生作答识别不清时，才允许 status=uncertain，并说明是图片/OCR证据不足。必须只返回 JSON，不要解释 JSON 之外的内容。字段必须包含：score, summary, strengths, mistakes, nextPractice, needsTeacherReview, referenceAnswerMode, questionResults。questionResults 是逐题结果数组，每项字段为 questionNo, status(correct|wrong|partial|uncertain), studentAnswer, correctAnswer, studentProcess(数组), errorStep, explanation, knowledgePoint, suggestedPractice, confidence(0-1), bbox。bbox 使用相对图片坐标，字段为 page, x, y, w, h，范围 0-1；正确题说明关键作答过程；错误题指出哪一步导致错误，并给出正确思路。不要输出供应商或模型名称。"
  );

  const timeoutMs = firstPositiveNumber(execution.timeoutMs, runtime.gpt56GradingTimeoutMs);
  const primaryResult = await timedCall(() => callGpt56Chat(config, messages, {
    model: gradingModel,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    maxTokens: 12000,
    timeoutMs,
    reasoningEffort: primaryReasoningEffort
  }));
  const attempts = [{
    role: execution.role || "primary",
    model: gradingModel,
    timeoutMs,
    reasoningEffort: primaryReasoningEffort,
    status: primaryResult.status,
    latencyMs: primaryResult.latencyMs,
    error: primaryResult.error || null
  }];
  let result = primaryResult;
  let usedModel = gradingModel;
  const classification = primaryResult.status === "ERROR"
    ? classifySolEscalationError(primaryResult.errorDetails || { message: primaryResult.error })
    : null;
  if (
    classification?.allowed === true &&
    execution.disableSolEscalation !== true &&
    gradingModel !== runtime.gpt56SolModel &&
    solEscalationEnabled(runtime)
  ) {
    const solTimeoutMs = runtime.gpt56SolFallbackTimeoutMs;
    result = await timedCall(() => callGpt56Chat(config, messages, {
      model: runtime.gpt56SolModel,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      maxTokens: 12000,
      timeoutMs: solTimeoutMs,
      reasoningEffort: "high"
    }));
    usedModel = runtime.gpt56SolModel;
    attempts.push({
      role: "sol-escalation",
      model: runtime.gpt56SolModel,
      timeoutMs: solTimeoutMs,
      reasoningEffort: "high",
      triggerClass: classification.triggerClass,
      triggerCode: classification.triggerCode,
      status: result.status,
      latencyMs: result.latencyMs,
      error: result.error || null
    });
  }
  const text = result.body ? extractChatText(result.body) : "";

  return {
    available: result.status === "SUCCESS",
    providerId: "gpt56",
    model: usedModel,
    gradingText: text,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: usedModel,
      skill: "submission-grading",
      inputSummary: input.title || input.subject || "",
      outputSummary: text.slice(0, 240),
      status: result.status,
      latencyMs: result.latencyMs,
      metadata: {
        studentId: input.studentId || null,
        subject: input.subject || null,
        imageCount: input.imageNames?.length || 0,
        usedModelEscalation: attempts.some((attempt) => attempt.role === "sol-escalation"),
        attempts
      }
    }
  };
}

export async function draftStudentProfileNarrative(config, input = {}) {
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
        "你是小学三到六年级课后辅导的学情分析助手。根据服务端提供的 profileEvidencePack 和 snapshot 生成周档案或月度综合长期成长档案草稿。只输出严格 JSON，不要输出解释性正文。顶层字段必须包含 profileType, period, publishedView, teacherReview。profileType 只能是 weekly_growth 或 monthly_comprehensive_growth。publishedView 必须包含 overview, subjectOverview, focusSubjects, correctionLoop, stableGrowth, tutoringFocus, parentNextSteps, timelinePreview；每个可展示结论都必须带 evidenceRefs 和 confidence，confidence 只能是 confirmed、supported、weak、blocked。teacherReview 必须包含 evidenceItems, sampleLimitNotes, pendingConfirmations, internalRisks, publishChecklist。证据不足时写继续观察，不编造强结论。不要提及任何模型或供应商。语气温和、具体、可行动。"
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
        periodKey: input.periodKey || null
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
