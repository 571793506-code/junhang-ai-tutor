import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { draftAssessmentService } from "@junhang/services";

function findUp(fileName, startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadDotEnv(filePath = findUp(".env")) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

function directRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(path.resolve(argvPath)).href;
}

function baseCase(input) {
  return {
    targetScope: "grade",
    createAssignment: false,
    runModelReview: false,
    ...input
  };
}

export function buildGenerationQualityCases(mode = "quiz") {
  if (mode === "formal") {
    return [
      baseCase({
        name: "数学-小升初正式试卷",
        subject: "数学",
        kind: "试卷",
        grade: "六年级",
        difficulty: "偏高",
        requirement: "生成一份六年级小升初级别数学试卷，难度偏高，题量适中，必须有一个附加题，解析要写清步骤和易错点。",
        generationProfile: "formal-full",
        assessmentTotalTimeoutMs: 240000,
        assessmentMaxTokens: 24000
      }),
      baseCase({
        name: "英语-个性化练习",
        subject: "英语",
        kind: "练习",
        grade: "五年级",
        studentId: "quality-sample-student-english",
        difficulty: "中等",
        requirement: "针对五年级学生 Unit 4 词汇、句型表达和阅读薄弱点生成个性化练习，避免完整试卷结构。",
        generationProfile: "formal-full",
        assessmentTotalTimeoutMs: 240000,
        assessmentMaxTokens: 24000
      }),
      baseCase({
        name: "语文-阅读表达练习",
        subject: "语文",
        kind: "练习",
        grade: "五年级",
        studentId: "quality-sample-student-chinese",
        difficulty: "中等",
        requirement: "围绕现代文阅读理解、信息提取和表达薄弱点生成个性化练习，阅读材料要有完整上下文，不默认作文。",
        generationProfile: "formal-full",
        assessmentTotalTimeoutMs: 240000,
        assessmentMaxTokens: 24000
      })
    ];
  }

  return [
    baseCase({
      name: "数学-小测",
      subject: "数学",
      kind: "小测",
      grade: "五年级",
      difficulty: "中等",
      requirement: "围绕小数乘法、图形面积和应用题生成两页 A4 小测，计算题和解答题要有足够作答空间。",
      generationProfile: "quiz-standard",
      assessmentTotalTimeoutMs: 120000,
      assessmentMaxTokens: 16000
    }),
    baseCase({
      name: "语文-小测",
      subject: "语文",
      kind: "小测",
      grade: "五年级",
      difficulty: "中等",
      requirement: "围绕单元基础、词句运用和现代文阅读生成两页 A4 小测，阅读材料要有完整上下文，不默认作文。",
      generationProfile: "quiz-standard",
      assessmentTotalTimeoutMs: 120000,
      assessmentMaxTokens: 16000
    }),
    baseCase({
      name: "英语-小测",
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      difficulty: "中等",
      requirement: "围绕 Unit 4 词汇、短语、句型和阅读生成两页 A4 小测，包含中英文互译、写单词、造句、少量选择和阅读，不要写作、完形或文章选词填空。",
      generationProfile: "quiz-standard",
      assessmentTotalTimeoutMs: 120000,
      assessmentMaxTokens: 16000
    })
  ];
}

export function buildGenerationQualityVerification(mode = "quiz") {
  const isFormal = mode === "formal";
  return {
    verificationScope: "generation-quality-sample",
    budgetTier: isFormal ? "formal" : "medium",
    assessesGenerationQuality: true,
    assessesPdfLayout: false,
    rejectsDynamicFallback: true,
    expectedProfiles: isFormal ? ["formal-full"] : ["quiz-standard"],
    qualityBoundary: "This check samples real model draft quality only; it does not prove the full content-context E2E or PDF visual layout."
  };
}

function flattenItems(result = {}) {
  if (Array.isArray(result.draftItems) && result.draftItems.length) {
    return result.draftItems.map((item) => {
      const metadata = item?.metadata || {};
      return {
        ...(typeof item === "string" ? { prompt: item } : item),
        analysisSteps: item?.analysisSteps || metadata.analysisSteps || [],
        commonMistake: item?.commonMistake || metadata.commonMistake || "",
        knowledgePoint: item?.knowledgePoint || metadata.knowledgePoint || "",
        passageText: item?.passageText || metadata.passageText || "",
        sectionTitle: item?.sectionTitle || metadata.sectionTitle || ""
      };
    });
  }
  const sections = Array.isArray(result.parsedDraft?.sections) ? result.parsedDraft.sections : [];
  return sections.flatMap((section) => {
    const items = Array.isArray(section.items) ? section.items : Array.isArray(section.questions) ? section.questions : [];
    return items.map((item) => ({
      ...(typeof item === "string" ? { prompt: item } : item),
      sectionTitle: item?.sectionTitle || section.title || ""
    }));
  });
}

function hasText(value, pattern) {
  return pattern.test(String(value || ""));
}

function itemType(item) {
  return String(item.itemType || item.type || "").toLowerCase();
}

function progress(message) {
  process.stderr.write(`[generation-quality] ${message}\n`);
}

export function evaluateGenerationQualityResult(sample, result = {}) {
  const issues = [];
  const items = flattenItems(result);
  const itemTypes = new Set(items.map(itemType).filter(Boolean));
  const sectionTitles = items.length
    ? items.map((item) => String(item.sectionTitle || "")).filter(Boolean)
    : Array.isArray(result.parsedDraft?.sections)
    ? result.parsedDraft.sections.map((section) => String(section.title || ""))
    : [];
  const totalScore = Number(result.totalScore || result.generationPipeline?.repair?.totalScore || 0);
  const itemCount = Number(result.audit?.itemCount || result.generationPipeline?.repair?.itemCount || items.length || 0);
  const model = result.generationPipeline?.model || {};
  const modelDiagnostics = {
    model: model.model || null,
    reasoningEffort: Array.isArray(model.attempts)
      ? model.attempts.find((attempt) => attempt?.reasoningEffort)?.reasoningEffort || null
      : null,
    primaryError: model.primaryError || null,
    secondaryError: model.secondaryError || null,
    fallbackProvider: model.fallbackProvider || null,
    assessmentTotalTimeoutMs: model.assessmentTotalTimeoutMs || null,
    assessmentMaxTokens: model.assessmentMaxTokens || null,
    attempts: Array.isArray(model.attempts) ? model.attempts : []
  };

  if (result.modelAvailable !== true) issues.push("质量样本必须来自可用模型。");
  if (result.usedDynamicFallback !== false) issues.push("质量样本必须来自真实模型生成，不能使用动态兜底。");
  if (!result.draftAvailable) issues.push("质量样本必须形成结构化草稿。");
  if (model.generationProfile && model.generationProfile !== sample.generationProfile) {
    issues.push(`生成 profile 应为 ${sample.generationProfile}，实际为 ${model.generationProfile}。`);
  }
  if (model.assessmentMaxTokens && Number(model.assessmentMaxTokens) < Number(sample.assessmentMaxTokens)) {
    issues.push(`模型 token 上限低于样本预算 ${sample.assessmentMaxTokens}。`);
  }
  if (result.modelAvailable !== true || result.usedDynamicFallback !== false || !result.draftAvailable) {
    return {
      name: sample.name,
      ok: false,
      detail: {
        subject: sample.subject,
        kind: sample.kind,
        generationProfile: model.generationProfile || sample.generationProfile,
        modelAvailable: Boolean(result.modelAvailable),
        usedModelEscalation: result.usedModelEscalation === true,
        usedDynamicFallback: Boolean(result.usedDynamicFallback),
        itemCount,
        totalScore,
        itemTypes: Array.from(itemTypes),
        ...modelDiagnostics,
        issues
      }
    };
  }
  if (result.audit?.status !== "passed") {
    issues.push("服务层本地审查未通过。");
  }
  if (sample.kind === "试卷" && totalScore !== 100) issues.push("试卷质量样本总分应为 100。");
  if (sample.kind !== "试卷" && totalScore !== 60) issues.push("小测/练习质量样本总分应为 60。");
  if (itemCount < (sample.kind === "试卷" ? 20 : 8)) issues.push("题量过少，不能作为质量样本。");

  const missingAnalysis = items.filter((item) => !item.answer || !Array.isArray(item.analysisSteps) || item.analysisSteps.length === 0);
  if (missingAnalysis.length) issues.push("存在缺少答案或解析步骤的题目。");
  const missingKnowledge = items.filter((item) => !item.knowledgePoint && !item.commonMistake);
  if (missingKnowledge.length) issues.push("存在缺少考点或易错提示的题目。");

  if (sample.subject === "英语" && sample.kind === "小测") {
    if (itemTypes.has("writing")) issues.push("英语小测质量样本不得出现写作题。");
    if (items.some((item) => hasText(item.prompt, /完形|选词填空|短文语法填空|write a passage/i))) {
      issues.push("英语小测质量样本不得套用完整试卷题型。");
    }
    for (const required of ["fill", "solution", "choice", "reading"]) {
      if (!itemTypes.has(required)) issues.push(`英语小测质量样本缺少 ${required} 题型。`);
    }
  }

  if (sample.subject === "语文" && sample.kind !== "试卷") {
    if (itemTypes.has("writing") || sectionTitles.some((title) => /作文|写作/.test(title))) {
      issues.push("语文小测/练习质量样本不得默认作文。");
    }
    if (!itemTypes.has("reading")) issues.push("语文质量样本必须包含阅读理解。");
  }

  if (sample.subject === "数学") {
    if (!itemTypes.has("calculation")) issues.push("数学质量样本必须包含计算题。");
    if (!itemTypes.has("solution")) issues.push("数学质量样本必须包含解答题。");
    if (/附加题/.test(sample.requirement) && !items.some((item) => hasText(`${item.sectionTitle} ${item.prompt}`, /附加题|挑战|拓展/))) {
      issues.push("教师要求附加题时，数学正式试卷必须包含附加题。");
    }
  }

  return {
    name: sample.name,
    ok: issues.length === 0,
    detail: {
      subject: sample.subject,
      kind: sample.kind,
      generationProfile: model.generationProfile || sample.generationProfile,
      modelAvailable: Boolean(result.modelAvailable),
      usedModelEscalation: result.usedModelEscalation === true,
      usedDynamicFallback: Boolean(result.usedDynamicFallback),
      itemCount,
      totalScore,
      itemTypes: Array.from(itemTypes),
      ...modelDiagnostics,
      issues
    }
  };
}

async function runQualityCheck(mode = "quiz", env = { ...process.env, ...loadDotEnv() }) {
  const startedAt = Date.now();
  const cases = buildGenerationQualityCases(mode);
  const verification = buildGenerationQualityVerification(mode);
  const checks = [];

  for (const sample of cases) {
    const sampleStartedAt = Date.now();
    progress(`start ${sample.name} (${sample.generationProfile}, ${sample.assessmentTotalTimeoutMs}ms, ${sample.assessmentMaxTokens} tokens)`);
    const result = await draftAssessmentService(env, sample, { persist: false });
    const check = evaluateGenerationQualityResult(sample, result);
    checks.push(check);
    progress(`${check.ok ? "pass" : "fail"} ${sample.name}: ${Date.now() - sampleStartedAt}ms`);
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    mode,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    verification,
    checks
  };
}

if (directRun(import.meta.url)) {
  const mode = process.argv.includes("--formal") ? "formal" : "quiz";
  runQualityCheck(mode)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
