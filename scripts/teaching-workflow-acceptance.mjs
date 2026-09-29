import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { callOpenAiCompatibleChat, extractChatText, normalizeRuntimeConfig, resolveTeachingTaskPolicy } from "@junhang/ai";
import { draftAssessmentService } from "@junhang/services";
import { createTeachingWorkflowExecution } from "../apps/api/src/teaching-workflow-execution.js";
import { hashQualityEvidence } from "./quality-gold-contract.mjs";
import { evaluateGenerationQualityResult } from "./generation-quality-check.mjs";
import { assessmentScoreIssues, inspectEncodingPayload } from "@junhang/core";
import { runAssessmentPipeline } from "../packages/ai/src/teaching-pipeline.js";
import { runTeachingTask } from "../packages/ai/src/runtime.js";

// Local diagnostics for the synthetic teaching requests below, never workflow
// content or an API projection. Do not retain prompts, raw responses or config.
export function collectScoringEvidence(candidate, partition) {
  const sections = Array.isArray(candidate?.sections) ? candidate.sections : [];
  return sections.flatMap((section) => Array.isArray(section?.items) ? section.items : []).slice(0, 100).map((q, index) => {
    const rubric = typeof q?.rubric === "string" ? q.rubric : "";
    const safe = rubric.length <= 3000 && inspectEncodingPayload({ rubric }).ok && !/api[_-]?key|bearer |sk-[a-z0-9]|https?:|gpt-\d|deepseek|minimax/i.test(rubric);
    return { index: index + 1, expectedScore: partition.itemScores?.[index] ?? null,
      score: Number.isFinite(q?.score) ? q.score : null, rubric: safe ? rubric : null,
      evidenceWithheld: !safe, issues: assessmentScoreIssues(q || {}) };
  });
}

export function buildWorkflowAcceptanceCases(subject = "数学") {
  if (!["数学", "语文", "英语"].includes(subject)) throw new Error("Unsupported acceptance subject");
  const base = { subject, grade: "四年级", kind: "练习", targetScope: "grade", generationProfile: "quiz-standard",
    assessmentTotalTimeoutMs: 120000, assessmentMaxTokens: 16000 };
  if (subject === "英语") return [{ ...base, purpose: "focused", requestedItemTypes: ["fill"], requestedItemCount: 4,
    requirement: "给四年级学生只出4道根据中文写英文单词或短语的专项练习，主题为学校生活，词义明确，难度适中，每题5分。每题中文题干在上、英语四线格在下，不用普通横线代替。附参考答案、简明解析、考点、易错点和评分依据，注明合理等价答案的处理。不加选择、阅读、作文或听力，不绑定教材单元。" }];
  if (subject === "语文") return [{ ...base, purpose: "focused", requestedItemTypes: ["solution"], requestedItemCount: 4,
    requirement: "给四年级学生只出4道修改病句专项练习，分别考查成分残缺、用词搭配不当、重复啰唆和前后矛盾，每句只有一种明确病因，难度适中，每题5分。保留原意，不增加作文或阅读，不绑定教材课文。附参考改句、病因分析、修改步骤、考点、易错点和评分依据，说明同义且正确的合理改法同样得分。学生卷保留书写空间，不提前提示病因或答案。" }];
  return [
    { ...base, purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 4, requirement: "只出4道三位数加减法计算题，含进退位，难度适中，不加应用题。每题5分，写完整解析、考点、易错点和评分依据。" },
    { ...base, purpose: "multi_day", dayPlan: [
      { dayId: "d1", goal: "进位加法", requestedItemCount: 2, requestedItemTypes: ["calculation"] },
      { dayId: "d2", goal: "退位减法", requestedItemCount: 2, requestedItemTypes: ["calculation"] }
    ], requirement: "安排两天计算练习，每天2题。第一天进位加法，第二天退位减法，每题5分，保留每日目标、完整解析、考点、易错点和评分依据。" },
    { ...base, purpose: "comprehensive", kind: "小测", requirement: "四年级数学综合小测，围绕整数四则运算与应用，2页A4、60分，含基础填空、选择、计算和解决问题，不用图形或教材单元引用。附完整解析、考点、易错点和评分依据。" },
    { ...base, purpose: "explanation", requirement: "给四年级学生讲清乘法分配律，含概念、推导步骤、两个不同的计算例题及完整解析、易错辨析。不要组卷或给分。" }
  ];
}

export async function runGenerationAcceptance(config, options = {}) {
  const samples = buildWorkflowAcceptanceCases(options.subject).filter((s) => !options.purpose || s.purpose === options.purpose);
  if (!samples.length) throw new Error("Unknown teaching purpose");
  const cases = [];
  for (const sample of samples) {
    const started = Date.now(); let raw; let snapshot; let failure = null; let validationIssues = [];
    const scoringEvidence = [];
    options.progress?.({ phase: "start", subject: sample.subject, purpose: sample.purpose, budgetMs: sample.assessmentTotalTimeoutMs });
    const execution = createTeachingWorkflowExecution({ config,
      resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...sample, ...request, contentContext: { approvedOnly: true, matches: [] }, studentSignals: [] } }),
      generate: async (env, input, args) => {
        raw = options.generate ? await options.generate(env, input, args) : await draftAssessmentService(env, input, {
          ...args, assessmentDraftRunner: (config, modelInput, execution) => runAssessmentPipeline(config, modelInput, execution,
            (config, task, unitInput, unitExecution) => runTeachingTask(config, task, unitInput, { ...unitExecution,
              repairIssues: async (candidate) => {
                const issues = await unitExecution.repairIssues(candidate);
                if (unitInput.partition.purpose !== "explanation") scoringEvidence.push({
                  partitionId: unitInput.partition.id, items: collectScoringEvidence(candidate, unitInput.partition)
                });
                return issues;
              }
            }))
        });
        return raw;
      },
      teachingExecution: { timeoutMs: sample.assessmentTotalTimeoutMs, maxTokens: sample.assessmentMaxTokens }
    });
    try {
      const actor = { teacherId: "acceptance-local-teacher" };
      const prepared = await execution.createDraft({ actor, input: { module: "generation", request: sample }, workflow: { id: `acceptance-${sample.purpose}` } });
      const checked = await execution.validateSnapshot(prepared.snapshot, { actor, module: "generation", request: prepared.request,
        workflow: { id: `acceptance-${sample.purpose}` }, nextRevision: 2 });
      if (!checked.ok) {
        validationIssues = Array.isArray(checked.issues) ? checked.issues.map((issue) => ({ code: issue.code || "UNKNOWN", detail: issue.detail || null })) : [];
        throw Object.assign(new Error("WORKFLOW_SNAPSHOT_INVALID"), { code: "WORKFLOW_SNAPSHOT_INVALID" });
      }
      snapshot = checked.snapshot;
    } catch (error) { failure = error.code || "GENERATION_ACCEPTANCE_FAILED"; }
    const model = raw?.modelRun?.metadata || {};
    const quality = evaluateGenerationQualityResult(sample, raw || {});
    const failureGates = [
      ...(raw?.modelAvailable !== true ? ["model_unavailable"] : []),
      ...(model.partialGeneration === true ? ["partial_generation"] : []),
      ...(raw?.usedDynamicFallback === true ? ["dynamic_fallback"] : []),
      ...(raw?.audit?.status === "passed" || raw?.audit?.passed === true ? [] : ["audit_not_passed"])
    ];
    const entry = { purpose: sample.purpose, inputHash: hashQualityEvidence(sample), request: sample,
      engineeringPassed: !!snapshot && quality.ok, failure, failureGates, quality, modelAvailable: raw?.modelAvailable === true, usedDynamicFallback: raw?.usedDynamicFallback === true,
      elapsedMs: Date.now() - started, validationIssues, scoringEvidence, rawContract: {
        partialGeneration: model.partialGeneration === true,
        auditStatus: raw?.audit?.status || null,
        auditPassed: raw?.audit?.passed === true,
        draftAvailable: raw?.draftAvailable === true,
        draftItemCount: Array.isArray(raw?.draftItems) ? raw.draftItems.length : 0
      }, ruleVersions: model.rules || [], attempts: model.attempts || raw?.generationPipeline?.model?.attempts || [],
      cost: null, teacherReview: null, teachingQualityPassed: false, pdfVerified: false, snapshot: snapshot || null };
    cases.push(entry); options.progress?.({ phase: "done", subject: sample.subject, purpose: sample.purpose, engineeringPassed: entry.engineeringPassed, failure, elapsedMs: entry.elapsedMs });
  }
  return { schemaVersion: "teaching-generation-acceptance-v1", generatedAt: new Date().toISOString(), persist: false,
    executionMode: options.generate ? "synthetic" : "live", contextSource: "explicit-request-no-textbook-or-student", productionReady: false, cases };
}

function redImage() {
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const body = Buffer.concat([Buffer.from(name), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(64 * (1 + 64 * 3)); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}

export async function probeTeachingCapabilities(config, options = {}) {
  const runtime = normalizeRuntimeConfig(config);
  const routes = [resolveTeachingTaskPolicy("generation", config).primary, resolveTeachingTaskPolicy("rewrite-feedback", config).primary, resolveTeachingTaskPolicy("recognize", config).primary];
  const checks = [];
  for (const route of routes) {
    for (const mode of ["text", "json", "image"]) {
      const started = Date.now(); let body; let value; let errorCode = null;
      options.progress?.({ phase: "start", model: route.model, mode });
      const openai = route.providerId === "gpt56";
      const content = mode === "image" ? [{ type: "text", text: 'Return JSON {"color":"..."} with the dominant color of the attached synthetic image, in English.' }, { type: "image_url", image_url: { url: redImage() } }]
        : mode === "json" ? 'Return JSON {"ok":true}. This is a synthetic capability check.' : "Reply with the single word OK. Synthetic capability check.";
      try {
        body = await (options.call || callOpenAiCompatibleChat)({ baseUrl: openai ? runtime.gpt56BaseUrl : runtime.deepseekBaseUrl,
          apiKey: openai ? runtime.gpt56ApiKey : runtime.deepseekApiKey, model: route.model, messages: [{ role: "user", content }],
          ...(mode !== "text" ? { responseFormat: { type: "json_object" } } : {}), reasoningEffort: openai ? route.reasoningEffort : undefined,
          maxTokens: 2048, timeoutMs: 30000, completionTokenLimit: openai, omitTemperature: openai, allowStructuredRetry: false });
        const response = extractChatText(body);
        value = mode === "text" ? response.trim() === "OK" : mode === "json" ? JSON.parse(response).ok === true : String(JSON.parse(response).color).toLowerCase() === "red";
        if (!value) errorCode = "PROBE_CONTENT_INVALID";
      } catch (error) {
        // Never persist upstream error text, headers or credentials.
        errorCode = /TIMEOUT|AbortError/i.test(String(error.message)) ? "PROBE_TIMEOUT" : "PROBE_REQUEST_OR_PARSE_FAILED";
      }
      const check = { model: route.model, provider: route.providerId, mode, passed: value === true, errorCode, elapsedMs: Date.now() - started,
        usage: body?.usage ? Object.fromEntries(Object.entries(body.usage).filter(([k, v]) => /^(prompt|completion|total|input|output)_tokens$/.test(k) && Number.isFinite(v))) : null, cost: null };
      checks.push(check); options.progress?.({ phase: "done", ...check });
      if (errorCode === "PROBE_TIMEOUT") break; // no repeated budget burn on an unreachable route
    }
  }
  return { schemaVersion: "teaching-capability-probe-v1", generatedAt: new Date().toISOString(), syntheticInputs: true, provesOcrQuality: false, timeoutMs: 30000, maxTokens: 2048, checks };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
  const mode = arg("mode"); const output = arg("output");
  if (!["probes", "generation"].includes(mode) || !output) throw new Error("Use --mode probes|generation --output <new local JSON> [--subject 数学|语文|英语] [--purpose focused|multi_day|comprehensive|explanation]");
  if (fs.existsSync(output)) throw new Error("Output already exists; choose a new evaluation file");
  const options = { subject: arg("subject") || undefined, purpose: arg("purpose"), progress: (event) => console.log(JSON.stringify(event)) };
  const report = mode === "probes" ? await probeTeachingCapabilities(process.env, options) : await runGenerationAcceptance(process.env, options);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (mode === "probes" ? report.checks.some((c) => !c.passed) : report.cases.some((c) => !c.engineeringPassed)) process.exitCode = 1;
  console.log(JSON.stringify({ output: path.resolve(output), productionReady: false }));
}
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
