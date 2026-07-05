import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
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

const env = { ...process.env, ...loadEnv(path.resolve(".env")) };
const apiBaseUrl = (env.API_BASE_URL || `http://127.0.0.1:${env.API_PORT || 8787}`).replace(/\/$/, "");
const teacherPhone = env.SMOKE_TEACHER_PHONE || "13800000001";
const teacherCode = env.SMOKE_TEACHER_CODE || "T8JH21";
const defaultRequestTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_REQUEST_TIMEOUT_MS || 60000);
const generationRequestTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_GENERATION_TIMEOUT_MS || 180000);
const exportRequestTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_EXPORT_TIMEOUT_MS || 120000);
const nodeScriptTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_NODE_SCRIPT_TIMEOUT_MS || 60000);
const corruptNeedles = ["\u951f", "\ufffd", "\u935a", "\u947b", "\u93c1", "\u7487"];
const zh = {
  math: "\u6570\u5b66",
  quiz: "\u5c0f\u6d4b",
  grade5: "\u4e94\u5e74\u7ea7",
  base: "\u57fa\u7840",
  decimalMultiplication: "\u5c0f\u6570\u4e58\u6cd5",
  figure: "\u56fe\u5f62",
  guardRequirement:
    "\u7aef\u5230\u7aef\u5b88\u536b\u6d4b\u8bd5\uff0c\u56f4\u7ed5\u5c0f\u6570\u4e58\u6cd5\u548c\u56fe\u5f62\uff0c\u751f\u62102\u9875A4\u5c0f\u6d4b\uff0c\u5305\u542b\u7b54\u6848\u89e3\u6790\u3002"
};

const checks = [];
const fixtureDir = path.resolve("storage", "e2e-fixtures");
const fixturePath = path.join(fixtureDir, "content-context-upload-fixture.md");
const e2eMarkdownDir = "exports/markdown-ingestion-e2e";
const e2eMarkdownPath = path.resolve(e2eMarkdownDir);
const legacyMarkdownPath = path.resolve("exports/markdown-ingestion");
const contentIndexPath = path.resolve("exports/content-index/index.json");
const apiUploadRoot = path.resolve("apps/api/storage/uploads");

function hasCorrupt(value) {
  const text = JSON.stringify(value);
  return corruptNeedles.some((needle) => text.includes(needle)) || /\?{3,}/.test(text);
}

function progress(message) {
  process.stderr.write(`[content-context-e2e] ${message}\n`);
}

function pass(name, ok, detail = {}) {
  const check = { name, ok: Boolean(ok), detail };
  checks.push(check);
  progress(`${check.ok ? "pass" : "fail"} ${name}`);
  return check;
}

function resetE2eMarkdownDir() {
  const relative = path.relative(process.cwd(), e2eMarkdownPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !relative.split(path.sep).join("/").startsWith("exports/markdown-ingestion-e2e")) {
    throw new Error(`Refusing to clean unexpected E2E markdown directory: ${e2eMarkdownPath}`);
  }
  fs.rmSync(e2eMarkdownPath, { recursive: true, force: true });
  fs.mkdirSync(e2eMarkdownPath, { recursive: true });
}

function cleanE2eUploadFiles(dir = apiUploadRoot) {
  if (!fs.existsSync(dir)) return;
  const relative = path.relative(apiUploadRoot, dir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to scan unexpected upload directory: ${dir}`);
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanE2eUploadFiles(fullPath);
      continue;
    }
    if (/content-context-upload-fixture|protected-textbook\.edupdf/.test(entry.name)) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

function cleanLegacyE2eMarkdownFiles() {
  if (!fs.existsSync(legacyMarkdownPath)) return;
  const relative = path.relative(process.cwd(), legacyMarkdownPath);
  if (relative !== path.join("exports", "markdown-ingestion")) {
    throw new Error(`Refusing to clean unexpected legacy markdown directory: ${legacyMarkdownPath}`);
  }
  for (const entry of fs.readdirSync(legacyMarkdownPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(legacyMarkdownPath, entry.name);
    if (/content-context-upload-fixture/.test(entry.name)) {
      fs.rmSync(fullPath, { force: true });
      continue;
    }
    if (entry.name === "manifest.json") {
      const text = fs.readFileSync(fullPath, "utf8");
      if (text.includes("content-context-upload-fixture")) fs.rmSync(fullPath, { force: true });
    }
  }
}

function captureContentIndex() {
  return fs.existsSync(contentIndexPath) ? fs.readFileSync(contentIndexPath, "utf8") : null;
}

function restoreContentIndex(snapshot) {
  const relative = path.relative(process.cwd(), contentIndexPath);
  if (relative !== path.join("exports", "content-index", "index.json")) {
    throw new Error(`Refusing to restore unexpected content index path: ${contentIndexPath}`);
  }
  fs.mkdirSync(path.dirname(contentIndexPath), { recursive: true });
  if (snapshot == null) {
    fs.rmSync(contentIndexPath, { force: true });
  } else {
    fs.writeFileSync(contentIndexPath, snapshot, "utf8");
  }
}

async function runNodeScript(script, args, options = {}) {
  const timeout = Number(options.timeoutMs || nodeScriptTimeoutMs);
  const startedAt = Date.now();
  progress(`start node ${script}`);
  try {
    const result = await execFileAsync(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024 * 16
    });
    progress(`done node ${script}: ${Date.now() - startedAt}ms`);
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    progress(`fail node ${script}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = defaultRequestTimeoutMs, label = "fetch") {
  const controller = new AbortController();
  const timeout = Number(timeoutMs || defaultRequestTimeoutMs);
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeout);
  progress(`start ${label}`);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    progress(`done ${label}: ${Date.now() - startedAt}ms`);
    return response;
  } catch (error) {
    progress(`fail ${label}: ${error instanceof Error ? error.message : String(error)}`);
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function formRequest(route, options = {}) {
  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}${route}`, {
      method: options.method || "POST",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {})
      },
      body: options.body
    }, options.timeoutMs || defaultRequestTimeoutMs, options.label || route);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok && body.ok !== false, body };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      body: { error: "NETWORK_ERROR", message: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function request(route, options = {}) {
  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}${route}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {})
      },
      body: options.body == null ? undefined : JSON.stringify(options.body)
    }, options.timeoutMs || defaultRequestTimeoutMs, options.label || route);
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, ok: response.ok && body.ok !== false, body };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      body: {
        error: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function fetchAsset(url) {
  if (!url) return { ok: false, status: 0, text: "" };
  const absoluteUrl = url.startsWith("http") ? url : `${apiBaseUrl}${url}`;
  try {
    const response = await fetchWithTimeout(absoluteUrl, {}, exportRequestTimeoutMs, `fetch asset ${url}`);
    const contentType = response.headers.get("content-type") || "";
    const text = contentType.includes("text") || contentType.includes("json") || contentType.includes("html")
      ? await response.text()
      : "";
    if (!text) await response.arrayBuffer();
    return { ok: response.ok, status: response.status, text, contentType };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      contentType: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

progress(`api base ${apiBaseUrl}`);

const health = await request("/health", { label: "api health", timeoutMs: 30000 });
pass("api health", health.ok && health.body.database?.ok, {
  status: health.status,
  database: health.body.database?.reason || null
});

resetE2eMarkdownDir();
cleanE2eUploadFiles();
cleanLegacyE2eMarkdownFiles();
const originalContentIndex = captureContentIndex();

const markdown = await runNodeScript("scripts/convert-to-markdown.mjs", [
  "docs/41-prompt-context-engineering-playbook.md",
  "--out",
  e2eMarkdownDir
]);
pass("markdown ingestion", markdown.ok && markdown.fileCount >= 1, {
  fileCount: markdown.fileCount || 0,
  outDir: markdown.outDir || null
});

const anonymousIndex = await request("/api/content/index", { label: "anonymous content index" });
pass("content index requires teacher session", anonymousIndex.status === 401, {
  status: anonymousIndex.status,
  error: anonymousIndex.body.error || null
});

const teacherLogin = await request("/api/teacher-login", {
  method: "POST",
  label: "teacher login",
  body: { phone: teacherPhone, accessCode: teacherCode }
});
const teacherToken = teacherLogin.body.sessionToken;
pass("teacher login", teacherLogin.ok && teacherToken, {
  status: teacherLogin.status,
  teacher: teacherLogin.body.teacher?.displayName || null
});

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  fixturePath,
  [
    "# E2E 上传资料",
    "",
    "五年级数学资料：小数乘法、图形、面积。",
    "本资料用于验证教师端上传资料可以转为 Markdown，并进入内容索引。"
  ].join("\n"),
  "utf8"
);
const uploadForm = new FormData();
uploadForm.append("files", new Blob([fs.readFileSync(fixturePath)], { type: "text/markdown" }), "content-context-upload-fixture.md");
uploadForm.append("outDir", e2eMarkdownDir);
const uploadResponse = teacherToken
  ? await formRequest("/api/content/markdown-ingestion", {
      token: teacherToken,
      body: uploadForm,
      label: "teacher material markdown ingestion"
    })
  : null;
pass("teacher can upload materials for markdown ingestion", uploadResponse?.ok && uploadResponse.body.fileCount >= 1, {
  status: uploadResponse?.status || 0,
  fileCount: uploadResponse?.body.fileCount || 0,
  outDir: uploadResponse?.body.outDir || null
});

const protectedUploadForm = new FormData();
protectedUploadForm.append("files", new Blob([Buffer.from("protected textbook placeholder")], { type: "application/octet-stream" }), "protected-textbook.edupdf");
const protectedUploadResponse = teacherToken
  ? await formRequest("/api/content/markdown-ingestion", {
      token: teacherToken,
      body: protectedUploadForm,
      label: "protected edupdf upload"
    })
  : null;
pass("protected edupdf upload is rejected", protectedUploadResponse?.status === 400 && protectedUploadResponse.body.error === "PROTECTED_TEXTBOOK_NOT_ALLOWED", {
  status: protectedUploadResponse?.status || 0,
  error: protectedUploadResponse?.body.error || null
});

const invalidOutDirForm = new FormData();
invalidOutDirForm.append("files", new Blob([fs.readFileSync(fixturePath)], { type: "text/markdown" }), "content-context-upload-fixture.md");
invalidOutDirForm.append("outDir", "../outside-workspace");
const invalidOutDirUpload = teacherToken
  ? await formRequest("/api/content/markdown-ingestion", {
      token: teacherToken,
      body: invalidOutDirForm,
      label: "invalid markdown ingestion outDir"
    })
  : null;
pass("upload output path outside workspace is rejected", invalidOutDirUpload?.status === 400 && invalidOutDirUpload.body.error === "INVALID_OUTPUT_PATH", {
  status: invalidOutDirUpload?.status || 0,
  error: invalidOutDirUpload?.body.error || null
});

const encodingCheck = teacherToken
  ? await request("/api/encoding/check", {
      method: "POST",
      token: teacherToken,
      label: "encoding check",
      body: {
        title: "AI\u951f\u65a4\u62f7\u951f\u65a4\u62f7",
        note: "abc???def"
      }
    })
  : null;
pass("encoding check detects mojibake", encodingCheck?.status === 200 && encodingCheck.body.issueCount >= 2, {
  status: encodingCheck?.status || 0,
  issueCount: encodingCheck?.body.issueCount || 0
});

const invalidRebuildInput = teacherToken
  ? await request("/api/content/index/rebuild", {
      method: "POST",
      token: teacherToken,
      label: "invalid content index rebuild",
      body: { inputs: ["../outside-workspace"], outDir: "exports/content-index" }
    })
  : null;
pass("content index input path outside workspace is rejected", invalidRebuildInput?.status === 400 && invalidRebuildInput.body.error === "INVALID_INPUT_PATH", {
  status: invalidRebuildInput?.status || 0,
  error: invalidRebuildInput?.body.error || null
});

const rebuilt = teacherToken
  ? await request("/api/content/index/rebuild", {
      method: "POST",
      token: teacherToken,
      label: "content index rebuild",
      body: { inputs: [e2eMarkdownDir], outDir: "exports/content-index" }
    })
  : null;
const rebuiltIndex = rebuilt?.body.index || {};
const firstDocument = rebuiltIndex.documents?.[0] || {};
pass("content index rebuild via api", rebuilt?.ok && rebuiltIndex.available && rebuiltIndex.documentCount >= 1 && !hasCorrupt(rebuilt.body), {
  documentCount: rebuiltIndex.documentCount || 0,
  summary: firstDocument.summary || null,
  subjects: firstDocument.subjects || []
});

const assessment = teacherToken
  ? await request("/api/assessments/draft", {
      method: "POST",
      token: teacherToken,
      label: "assessment draft",
      timeoutMs: generationRequestTimeoutMs,
      body: {
        targetScope: "grade",
        targetGrade: zh.grade5,
        subject: zh.math,
        kind: zh.quiz,
        difficulty: zh.base,
        requirement: zh.guardRequirement,
        knowledgePoints: [zh.decimalMultiplication, zh.figure]
      }
    })
  : null;
const assessmentResult = assessment?.body.result || {};
const assessmentId = assessmentResult.persisted?.assignmentId;
pass("assessment draft injects clean content context", assessment?.ok && assessmentId && assessmentResult.contentContext?.matchedCount >= 1 && !hasCorrupt(assessment.body), {
  status: assessment?.status || 0,
  error: assessment?.body.error || null,
  message: assessment?.body.message || null,
  assignmentId: assessmentId || null,
  matchedCount: assessmentResult.contentContext?.matchedCount || 0,
  requirement: assessmentResult.generationContext?.request?.requirement || null
});

const draftExport = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/draft-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "assessment draft export", body: {} })
  : null;
const draftAsset = draftExport?.body.asset || {};
const draftAssetFetch = await fetchAsset(draftAsset.url);
pass("teacher can export review draft", draftExport?.ok && draftAsset.url && draftAssetFetch.ok && (!draftAssetFetch.text || !hasCorrupt(draftAssetFetch.text)), {
  url: draftAsset.url || null,
  fetchStatus: draftAssetFetch.status,
  contentType: draftAssetFetch.contentType
});

const blockedPrint = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/print-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "blocked print export", body: {} })
  : null;
pass("final print is blocked before review", blockedPrint?.status === 409 && blockedPrint.body.error === "DRAFT_REVIEW_REQUIRED", {
  status: blockedPrint?.status || 0,
  error: blockedPrint?.body.error || null
});

const review = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/draft-review`, {
      method: "POST",
      token: teacherToken,
      label: "assessment draft review",
      body: { decision: "accept" }
    })
  : null;
pass("teacher can accept review draft", review?.ok && review.body.reviewStatus === "accepted", {
  reviewStatus: review?.body.reviewStatus || null
});

const printExport = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/print-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "final print export", body: {} })
  : null;
const printAssets = printExport?.body.assets || [];
const fetchedAssets = await Promise.all(printAssets.map((asset) => fetchAsset(asset.url)));
pass("final print exports student and analysis assets", printExport?.ok && printAssets.length >= 2 && fetchedAssets.every((item) => item.ok) && !hasCorrupt(printAssets), {
  status: printExport?.status || 0,
  error: printExport?.body.error || null,
  assets: printAssets.map((asset) => ({ title: asset.title, url: asset.url })),
  fetchStatuses: fetchedAssets.map((item) => item.status),
  contentTypes: fetchedAssets.map((item) => item.contentType)
});

restoreContentIndex(originalContentIndex);
pass("content index is restored after e2e", true, {
  restored: originalContentIndex != null,
  indexPath: path.relative(process.cwd(), contentIndexPath)
});

cleanE2eUploadFiles();

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  apiBaseUrl,
  generatedAt: new Date().toISOString(),
  checks
}, null, 2));

if (failed.length) process.exitCode = 1;
