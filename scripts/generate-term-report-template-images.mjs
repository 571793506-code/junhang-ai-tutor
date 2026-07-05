import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUT_DIR = path.join(ROOT, "skills", "student-profile", "templates", "term-report-image2");
const TRANSIENT_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);

const REPORT_TEMPLATES = {
  midterm: {
    id: "term-midterm-growth-report",
    title: "期中阶段综合档案",
    period: "2026春季期中",
    overview: "本阶段重点呈现阶段掌握、共性错因和后续两到四周辅导重点。",
    focusLabel: "接下来两到四周优先处理"
  },
  final: {
    id: "term-final-growth-report",
    title: "学期综合成长总结",
    period: "2026春季期末",
    overview: "本阶段重点呈现学期成长、稳定强项和假期或下阶段安排。",
    focusLabel: "假期或下阶段可以这样配合"
  }
};

export function loadDotEnv(filePath = path.join(ROOT, ".env")) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

export function reportTypesFromArgs(values = []) {
  const selected = values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return selected.length ? selected.map(normalizeReportType) : ["midterm", "final"];
}

export function buildPrompt(reportType) {
  const template = REPORT_TEMPLATES[normalizeReportType(reportType)];
  return `Use case: infographic-diagram
Asset type: Chinese vertical A4-like student growth report template preview
Primary request: 生成一张中文竖版学生阶段成长报告模板图，服务于君航 AI 助教教师端期中/期末 PDF 生成前的模板确认。
Template id: ${template.id}
Title text: "${template.title}"
Scene/backdrop: clean education report page, light background, professional after-school tutoring tone
Subject: one primary-school student growth report for grades 3 to 6, covering Chinese, Math, and English
Style/medium: polished UI mockup / report template image, clean print-friendly layout, not a poster
Composition/framing: portrait layout, first screen looks like an A4 PDF report page, clear section hierarchy and generous spacing
Color palette: low-saturation blue, muted green, warm gray, small warm orange emphasis
Text content to render in simplified Chinese:
"君航 AI 助教"
"${template.title}"
"学生：脱敏学生A"
"年级：五年级"
"周期：${template.period}"
"状态：教师确认后生成"
"综合成长摘要"
"${template.overview}"
"三科总览"
"语文：阅读定位和概括表达继续观察"
"数学：两步应用题审题和单位换算需要巩固"
"英语：词汇拼写和阅读关键词保持复习"
"重点科目展开"
"数学｜本周期证据：教师确认批改记录和错题记录"
"能力观察：审题、条件整理和列式表达需要持续训练"
"优先处理：先圈已知条件和问题，再列式"
"老师下一步：同类题复练，确认能独立复述思路"
"稳定表现"
"能按要求完成部分学习任务"
"已形成教师确认的批改记录"
"下阶段辅导重点"
"${template.focusLabel}"
"每周复盘错题订正，确认能否复述错因"
"家长下一步"
"每天 5 到 10 分钟，请孩子口头复述最容易出错的一步"
"关注订正过程，不只关注分数"
Constraints: all Chinese text must be clear, readable, simplified Chinese, no missing glyph boxes, no garbled text, no extra words, no watermark, no logo other than the text "君航 AI 助教"
Avoid: score ranking, estimated future score, class position, entrance-school pressure, battle-report style, real name, phone number, student ID, school name, chat transcript, model name, provider name, API details, prompt text, debug fields`;
}

export async function extractImageBytes(responseJson) {
  const data = responseJson?.data;
  if (!Array.isArray(data) || !data.length || typeof data[0] !== "object") return null;
  const first = data[0];
  for (const key of ["b64_json", "image_base64", "base64"]) {
    if (typeof first[key] === "string" && first[key].trim()) {
      return Buffer.from(first[key], "base64");
    }
  }
  if (typeof first.url === "string" && first.url.trim()) {
    const response = await fetch(first.url);
    if (!response.ok) throw new Error(`image download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
}

export function sanitizeForLog(value) {
  return String(value).replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]");
}

export function isTransientImage2Error(error) {
  const status = error?.status || error?.cause?.status;
  return TRANSIENT_HTTP_STATUS_CODES.has(Number(status)) ||
    ["AbortError", "TimeoutError"].includes(error?.name) ||
    /timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(String(error?.message || ""));
}

async function generateImage(prompt, { apiKey, baseUrl, model, size, quality, timeoutMs }) {
  if (!apiKey) throw new Error("missing IMAGE2_API_KEY");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`image 2 request failed: HTTP ${response.status}: ${sanitizeForLog(text.slice(0, 500))}`);
      error.status = response.status;
      throw error;
    }
    const bytes = await extractImageBytes(JSON.parse(text));
    if (!bytes) throw new Error("image 2 response did not include image bytes");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateImageWithRetries(prompt, options) {
  const attempts = Math.max(1, options.retries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await generateImage(prompt, options);
    } catch (error) {
      if (attempt >= attempts || !isTransientImage2Error(error)) throw error;
      const delay = options.retryBaseDelayMs * attempt;
      console.log(`image 2 transient failure; retrying in ${delay}ms (${attempt + 1}/${attempts}): ${sanitizeForLog(error.message)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("image 2 retry loop ended unexpectedly");
}

function writeGallery(outDir) {
  const images = fs.readdirSync(outDir)
    .filter((name) => /^term-report-template-.*\.png$/.test(name))
    .sort();
  const cards = images.map((name) => `      <article><img src="${escapeHtml(name)}" alt="${escapeHtml(name)}" /><p>${escapeHtml(name)}</p></article>`).join("\n");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>期中期末阶段报告 image 2 模板候选图</title>
<style>
body { margin: 0; padding: 24px; font-family: "Microsoft YaHei", Arial, sans-serif; background: #f5f7f7; color: #17212b; }
h1 { margin: 0 0 18px; font-size: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
article { background: white; border: 1px solid #d9e1e7; border-radius: 8px; padding: 12px; }
img { width: 100%; height: auto; display: block; border-radius: 6px; }
p { margin: 10px 0 0; color: #5c6a75; font-size: 13px; word-break: break-all; }
</style>
</head>
<body>
<h1>期中期末阶段报告 image 2 模板候选图</h1>
<section class="grid">
${cards}
</section>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeReportType(value) {
  return value === "midterm" ? "midterm" : "final";
}

function parseArgs(argv) {
  const args = {
    reports: [],
    outDir: DEFAULT_OUT_DIR,
    size: "1024x1536",
    quality: "high",
    timeoutMs: 300000,
    retries: 3,
    retryBaseDelayMs: 8000,
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--reports") args.reports.push(argv[++index] || "");
    else if (value === "--out-dir") args.outDir = path.resolve(argv[++index] || args.outDir);
    else if (value === "--size") args.size = argv[++index] || args.size;
    else if (value === "--quality") args.quality = argv[++index] || args.quality;
    else if (value === "--timeout") args.timeoutMs = Number(argv[++index] || "300") * 1000;
    else if (value === "--retries") args.retries = Number(argv[++index] || "3");
    else if (value === "--retry-base-delay") args.retryBaseDelayMs = Number(argv[++index] || "8") * 1000;
    else if (value === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadDotEnv() };
  const options = {
    apiKey: env.IMAGE2_API_KEY || "",
    baseUrl: env.IMAGE2_BASE_URL || "https://fast.aifast.top/v1/images/generations",
    model: env.IMAGE2_MODEL || "gpt-image-2",
    size: args.size,
    quality: args.quality,
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    retryBaseDelayMs: args.retryBaseDelayMs
  };

  fs.mkdirSync(args.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const reportTypes = reportTypesFromArgs(args.reports);

  for (const reportType of reportTypes) {
    const prompt = buildPrompt(reportType);
    const promptPath = path.join(args.outDir, `term-report-template-${reportType}-${stamp}.txt`);
    fs.writeFileSync(promptPath, prompt, "utf8");
    console.log(`wrote prompt: ${promptPath}`);
    if (args.dryRun) continue;

    try {
      const imageBytes = await generateImageWithRetries(prompt, options);
      const imagePath = path.join(args.outDir, `term-report-template-${reportType}-${stamp}.png`);
      fs.writeFileSync(imagePath, imageBytes);
      console.log(`wrote image: ${imagePath}`);
    } catch (error) {
      console.error(`term report image generation failed for ${reportType}: ${sanitizeForLog(error.message)}`);
      return 1;
    }
  }
  writeGallery(args.outDir);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
