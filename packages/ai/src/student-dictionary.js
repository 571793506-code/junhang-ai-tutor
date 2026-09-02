import {
  buildAiStartupSnapshot,
  callGpt56Chat,
  extractChatText
} from "./runtime.js";

function parseJsonObjectText(value) {
  const source = String(value || "").trim();
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

async function timedCall(run) {
  const startedAt = Date.now();
  try {
    return {
      body: await run(),
      status: "SUCCESS",
      latencyMs: Date.now() - startedAt,
      error: null
    };
  } catch (error) {
    return {
      body: null,
      status: "ERROR",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function generateStudentDictionaryDraft(config, input = {}, options = {}) {
  const queryTerm = String(input.word || "").trim().toLowerCase();
  const provider = buildAiStartupSnapshot(config).providers.find((item) => item.id === "gpt56");
  if (provider?.status !== "ready") {
    return {
      available: false,
      providerId: "gpt56",
      model: provider?.model || null,
      draft: null,
      raw: null,
      error: provider?.reason || "GPT-5.6 unavailable",
      modelRun: {
        provider: "gpt56",
        model: provider?.model || null,
        skill: "student-dictionary-entry",
        inputSummary: queryTerm,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    };
  }

  const messages = [
    {
      role: "system",
      content: [
        "你是小学三到六年级英语词典编写助手。",
        "只返回严格 JSON，不输出 JSON 之外的解释。",
        "schemaVersion 必须是 student-dictionary-entry-v1。",
        "字段必须为 schemaVersion, queryTerm, headword, phonetic, queryRelation, parts, forms, wordFamily, synonyms, antonyms, collocations, examples, usageNotes, pitfalls。",
        "queryRelation 包含 type 和中文 label；parts 每项包含 part, partCn, meanings。",
        "forms 每项包含 term, type, label，并准确解释查询词和原形的关系。",
        "queryRelation.type 和 forms[].type 只能使用 headword, plural, third_person, past, past_participle, present_participle, comparative, superlative, irregular；不要使用 inflected-form、base-form 或自然语言长枚举。",
        "examples 至少两个，每项包含适龄英文 sentence 和中文 translation。",
        "不要虚构不适用的反义词或词形，不要提及模型、供应商、提示词或内部系统。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({ queryTerm, audience: "小学三至六年级" })
    }
  ];
  const callModel = options.callModel || callGpt56Chat;
  const result = await timedCall(() => callModel(config, messages, {
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    maxTokens: 1800,
    timeoutMs: 30000,
    reasoningEffort: "none"
  }));
  const draft = result.body ? parseJsonObjectText(extractChatText(result.body)) : null;
  const available = result.status === "SUCCESS" && Boolean(draft);

  return {
    available,
    providerId: "gpt56",
    model: provider.model,
    draft,
    raw: result.body,
    error: result.error || (available ? null : "Invalid dictionary JSON"),
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "student-dictionary-entry",
      inputSummary: queryTerm,
      outputSummary: draft ? JSON.stringify(draft).slice(0, 240) : "Invalid dictionary JSON",
      status: available ? "SUCCESS" : "ERROR",
      latencyMs: result.latencyMs,
      metadata: { queryTerm, schemaVersion: "student-dictionary-entry-v1" }
    }
  };
}
