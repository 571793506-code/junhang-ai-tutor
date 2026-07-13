import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const generationModelBudgetMs = Number(env.CONTENT_CONTEXT_E2E_GENERATION_MODEL_BUDGET_MS || 45000);
const exportRequestTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_EXPORT_TIMEOUT_MS || 120000);
const nodeScriptTimeoutMs = Number(env.CONTENT_CONTEXT_E2E_NODE_SCRIPT_TIMEOUT_MS || 60000);
const e2eContentSentinel = "E2E_CONTENT_CONTEXT_SENTINEL_20260712";
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

export function buildContentContextE2eVerificationMeta({ generationModelBudgetMs } = {}) {
  return {
    verificationScope: "link-guard",
    assessesGenerationQuality: false,
    assessesModelCreativity: false,
    allowsDynamicFallback: true,
    modelBudgetMs: Number(generationModelBudgetMs) || null,
    qualityBoundary: "This low-budget E2E only proves the content-context, review-gate, timeout, fallback, and export link can close; it does not assess generation content quality.",
    proves: [
      "api-session-content-context-flow",
      "approved-content-context-sync",
      "approved-source-chunk-match",
      "bounded-assessment-draft-return",
      "teacher-review-gate",
      "draft-export-and-layout-review-gate"
    ]
  };
}

export function isDirectContentContextE2eRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(path.resolve(argvPath)).href;
}

export function selectContentContextE2eTextbook(assets = [], { subject, grade } = {}) {
  const candidates = Array.isArray(assets) ? assets : [];
  return candidates.find((asset) =>
    asset?.subject === subject &&
    asset?.grade === grade &&
    asset?.baselineMatched === true
  ) || null;
}

export function resolveContentContextE2eStorageRoots(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  return {
    uploadRoot: path.join(root, "apps", "api", "storage", "uploads"),
    generatedRoot: path.join(root, "apps", "api", "storage", "generated")
  };
}

export function isContentContextE2eUploadFileName(fileName, runId) {
  const name = path.basename(String(fileName || ""));
  const escapedRunId = String(runId || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedRunId) return false;
  return new RegExp(`^\\d+-[a-z0-9]{6}-${escapedRunId}-(?:content-context-upload-fixture\\.md|protected-textbook\\.edupdf)$`, "i").test(name);
}

export function isContentContextE2eFixtureSource(source, runId) {
  const sourcePath = String(source?.sourcePath || "").replace(/\\/g, "/");
  const sourceFileName = path.posix.basename(sourcePath);
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) return false;
  const fixtureSuffix = `-${normalizedRunId}-content-context-upload-fixture.md`;
  return sourceFileName.toLowerCase().endsWith(fixtureSuffix.toLowerCase())
    && isContentContextE2eUploadFileName(sourceFileName, runId);
}

export function cleanContentContextE2eUploadFiles(uploadRoot, runId) {
  if (!String(uploadRoot || "").trim() || !String(runId || "").trim()) return 0;
  const root = path.resolve(uploadRoot);
  if (!fs.existsSync(root)) return 0;
  let deletedCount = 0;

  function visit(dir) {
    const relative = path.relative(root, dir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to scan unexpected upload directory: ${dir}`);
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (isContentContextE2eUploadFileName(entry.name, runId)) {
        fs.rmSync(fullPath, { force: true });
        deletedCount += 1;
      }
    }
  }

  visit(root);
  return deletedCount;
}

async function main() {
const verificationMeta = buildContentContextE2eVerificationMeta({ generationModelBudgetMs });
const checks = [];
const e2eRunId = randomUUID();
const fixtureUploadFileName = `${e2eRunId}-content-context-upload-fixture.md`;
const protectedUploadFileName = `${e2eRunId}-protected-textbook.edupdf`;
const fixtureDir = path.resolve("storage", "e2e-fixtures");
const fixturePath = path.join(fixtureDir, "content-context-upload-fixture.md");
const e2eMarkdownDir = "exports/markdown-ingestion-e2e";
const e2eMarkdownPath = path.resolve(e2eMarkdownDir);
const legacyMarkdownPath = path.resolve("exports/markdown-ingestion");
const contentIndexPath = path.resolve("exports/content-index/index.json");
const { uploadRoot: apiUploadRoot, generatedRoot } = resolveContentContextE2eStorageRoots();
let originalContentIndex = null;
let teacherToken = null;
let fixtureSourceId = null;
const sourceSnapshots = new Map();
const touchedSourceIds = new Set();
const createdAssignmentIds = new Set();
const createdModelRunIds = new Set();
const generatedArtifactPaths = new Set();

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

function trackGeneratedAsset(asset) {
  let assetPath = asset?.path ? path.resolve(asset.path) : null;
  if (!assetPath && asset?.url) {
    try {
      assetPath = path.join(generatedRoot, path.basename(decodeURIComponent(new URL(asset.url).pathname)));
    } catch {
      assetPath = null;
    }
  }
  if (!assetPath) return;
  const relative = path.relative(generatedRoot, assetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  const basePath = assetPath.replace(/\.(?:html|pdf)$/i, "");
  generatedArtifactPaths.add(`${basePath}.html`);
  generatedArtifactPaths.add(`${basePath}.pdf`);
}

function cleanGeneratedArtifacts() {
  for (const artifactPath of generatedArtifactPaths) {
    const relative = path.relative(generatedRoot, artifactPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to clean unexpected generated artifact: ${artifactPath}`);
    }
    fs.rmSync(artifactPath, { force: true });
  }
}

function cleanE2eWorkspaceFiles() {
  const markdownRelative = path.relative(process.cwd(), e2eMarkdownPath);
  if (!markdownRelative || markdownRelative.startsWith("..") || path.isAbsolute(markdownRelative)) {
    throw new Error(`Refusing to clean unexpected E2E markdown path: ${e2eMarkdownPath}`);
  }
  fs.rmSync(e2eMarkdownPath, { recursive: true, force: true });
  fs.rmSync(fixturePath, { force: true });
  if (fs.existsSync(fixtureDir) && fs.readdirSync(fixtureDir).length === 0) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function cleanE2eDatabaseRecords() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for E2E cleanup");
  process.env.DATABASE_URL = env.DATABASE_URL;
  const { prisma } = await import("@junhang/db");
  try {
    const assignmentIds = [...createdAssignmentIds];
    const modelRunIds = [...createdModelRunIds];
    const sourceIds = [...touchedSourceIds];
    const generatedAssets = assignmentIds.length
      ? await prisma.generatedAsset.deleteMany({
          where: { OR: assignmentIds.map((id) => ({ path: { contains: id } })) }
        })
      : { count: 0 };
    const assignments = assignmentIds.length
      ? await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } })
      : { count: 0 };
    const modelRuns = modelRunIds.length
      ? await prisma.modelRun.deleteMany({ where: { id: { in: modelRunIds } } })
      : { count: 0 };
    const sources = sourceIds.length
      ? await prisma.knowledgeSource.deleteMany({ where: { id: { in: sourceIds } } })
      : { count: 0 };
    return {
      assignments: assignments.count,
      generatedAssets: generatedAssets.count,
      modelRuns: modelRuns.count,
      sources: sources.count,
      expectedSources: sourceIds.length
    };
  } finally {
    await prisma.$disconnect();
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

function normalizeRepoPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function isE2eMarkdownSource(source, markdownDir) {
  const sourcePath = normalizeRepoPath(source?.markdownPath);
  const root = normalizeRepoPath(markdownDir);
  return Boolean(sourcePath && root && (sourcePath === root || sourcePath.startsWith(`${root}/`)));
}

function reviewRestorePayload(source, { forceUnavailable = false } = {}) {
  const reviewStatus = String(source?.reviewStatus || "PENDING").toUpperCase();
  const licenseStatus = String(source?.licenseStatus || "REVIEW_REQUIRED").toUpperCase();
  if (forceUnavailable) {
    return {
      status: "PENDING",
      allowedForGeneration: false,
      licenseStatus,
      note: "content-context-e2e cleanup: test source must remain unavailable for generation"
    };
  }
  return {
    status: reviewStatus,
    allowedForGeneration: reviewStatus === "APPROVED" && source?.allowedForGeneration === true,
    licenseStatus,
    note: "content-context-e2e cleanup: restore previous review state"
  };
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

try {
progress(`api base ${apiBaseUrl}`);
originalContentIndex = captureContentIndex();

const health = await request("/health", { label: "api health", timeoutMs: 30000 });
pass("api health", health.ok && health.body.database?.ok, {
  status: health.status,
  database: health.body.database?.reason || null
});

resetE2eMarkdownDir();
cleanContentContextE2eUploadFiles(apiUploadRoot, e2eRunId);
cleanLegacyE2eMarkdownFiles();

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
teacherToken = teacherLogin.body.sessionToken;
pass("teacher login", teacherLogin.ok && teacherToken, {
  status: teacherLogin.status,
  teacher: teacherLogin.body.teacher?.displayName || null
});

const textbookResponse = teacherToken
  ? await request(`/api/textbooks?subject=${encodeURIComponent(zh.math)}&includeDemo=true&limit=200`, {
      token: teacherToken,
      label: "select server textbook asset"
    })
  : null;
const e2eTextbook = selectContentContextE2eTextbook(textbookResponse?.body.assets, {
  subject: zh.math,
  grade: zh.grade5
});
pass("server resolves a real math textbook asset", Boolean(e2eTextbook?.id && e2eTextbook?.grade), {
  status: textbookResponse?.status || 0,
  assetId: e2eTextbook?.id || null,
  title: e2eTextbook?.title || null,
  grade: e2eTextbook?.grade || null
});

const sourcesBeforeSync = teacherToken
  ? await request("/api/knowledge/sources?limit=200", {
      token: teacherToken,
      label: "knowledge sources before e2e sync"
    })
  : null;
for (const source of sourcesBeforeSync?.body.sources || []) {
  if (!isE2eMarkdownSource(source, e2eMarkdownDir)) continue;
  sourceSnapshots.set(source.id, { ...source });
}
pass("knowledge source snapshot captured", !teacherToken || sourcesBeforeSync?.ok, {
  status: sourcesBeforeSync?.status || 0,
  existingE2eSourceCount: sourceSnapshots.size
});

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  fixturePath,
  [
    "# E2E 上传资料",
    "",
    `${e2eTextbook?.grade || zh.grade5}${zh.math}资料：${e2eTextbook?.title || "教材"}、${zh.decimalMultiplication}、${zh.figure}、面积。`,
    `本资料用于验证教师端上传资料可以转为 Markdown，并进入内容索引。测试标记 ${e2eContentSentinel}。`
  ].join("\n"),
  "utf8"
);
const uploadForm = new FormData();
uploadForm.append("files", new Blob([fs.readFileSync(fixturePath)], { type: "text/markdown" }), fixtureUploadFileName);
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
protectedUploadForm.append("files", new Blob([Buffer.from("protected textbook placeholder")], { type: "application/octet-stream" }), protectedUploadFileName);
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
invalidOutDirForm.append("files", new Blob([fs.readFileSync(fixturePath)], { type: "text/markdown" }), fixtureUploadFileName);
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

const synced = teacherToken
  ? await request("/api/knowledge/sources/sync-content-index", {
      method: "POST",
      token: teacherToken,
      label: "sync content index to knowledge library",
      body: { indexPath: "exports/content-index/index.json" }
    })
  : null;
pass("content index syncs to knowledge sources and chunks", synced?.ok && synced.body.sync?.sourceCount >= 1 && synced.body.sync?.chunkCount >= 1, {
  status: synced?.status || 0,
  sourceCount: synced?.body.sync?.sourceCount || 0,
  chunkCount: synced?.body.sync?.chunkCount || 0,
  error: synced?.body.error || null
});

const sourcesAfterSync = teacherToken
  ? await request("/api/knowledge/sources?limit=200", {
      token: teacherToken,
      label: "knowledge sources after e2e sync"
    })
  : null;
const e2eSources = (sourcesAfterSync?.body.sources || []).filter((source) => isE2eMarkdownSource(source, e2eMarkdownDir));
for (const source of e2eSources) {
  if (!sourceSnapshots.has(source.id)) sourceSnapshots.set(source.id, null);
}
const fixtureSource = e2eSources.find((source) => isContentContextE2eFixtureSource(source, e2eRunId));
fixtureSourceId = fixtureSource?.id || null;
pass("synced E2E fixture source has chunks", Boolean(fixtureSourceId && Number(fixtureSource?.chunkCount || 0) > 0), {
  sourceId: fixtureSourceId,
  sourceCount: e2eSources.length,
  chunkCount: fixtureSource?.chunkCount || 0,
  markdownPath: fixtureSource?.markdownPath || null
});

const reviewResponses = [];
for (const source of e2eSources) {
  const isFixture = source.id === fixtureSourceId;
  touchedSourceIds.add(source.id);
  reviewResponses.push({
    source,
    isFixture,
    response: await request(`/api/knowledge/sources/${encodeURIComponent(source.id)}/review`, {
      method: "PATCH",
      token: teacherToken,
      label: `${isFixture ? "approve" : "disable"} E2E knowledge source`,
      body: {
        status: isFixture ? "APPROVED" : "PENDING",
        licenseStatus: isFixture ? "ALLOWED" : (source.licenseStatus || "REVIEW_REQUIRED"),
        allowedForGeneration: isFixture,
        textbookAssetId: e2eTextbook?.id,
        note: "content-context-e2e temporary review state"
      }
    })
  });
}
const approvedFixture = reviewResponses.find((item) => item.isFixture)?.response?.body.source;
const disabledE2eSources = reviewResponses
  .filter((item) => !item.isFixture)
  .map((item) => item.response?.body.source)
  .filter(Boolean);
pass("only the E2E fixture source is approved for generation", Boolean(
  fixtureSourceId
    && approvedFixture?.id === fixtureSourceId
    && approvedFixture.reviewStatus === "APPROVED"
    && approvedFixture.allowedForGeneration === true
    && reviewResponses.every((item) => item.response?.ok)
    && disabledE2eSources.every((source) => source.reviewStatus !== "APPROVED" || source.allowedForGeneration !== true)
), {
  fixtureSourceId,
  approvedSourceId: approvedFixture?.id || null,
  approvedReviewStatus: approvedFixture?.reviewStatus || null,
  approvedForGeneration: approvedFixture?.allowedForGeneration ?? null,
  disabledSourceIds: disabledE2eSources.map((source) => source.id)
});

const assessment = teacherToken
  ? await request("/api/assessments/draft", {
      method: "POST",
      token: teacherToken,
      label: "assessment draft",
      timeoutMs: generationRequestTimeoutMs,
      body: {
        targetScope: "grade",
        targetGrade: e2eTextbook?.grade || zh.grade5,
        subject: zh.math,
        kind: zh.quiz,
        difficulty: zh.base,
        textbookAssetId: e2eTextbook?.id || null,
        textbookTitle: "客户端伪造教材标题",
        textbookChapterTitle: zh.decimalMultiplication,
        requirement: zh.guardRequirement,
        assessmentTotalTimeoutMs: generationModelBudgetMs,
        knowledgePoints: [zh.decimalMultiplication, zh.figure, e2eContentSentinel]
      }
    })
  : null;
const assessmentResult = assessment?.body.result || {};
const assessmentId = assessmentResult.persisted?.assignmentId;
if (assessmentId) createdAssignmentIds.add(assessmentId);
for (const modelRunId of [
  assessmentResult.persisted?.modelRunId,
  ...(Array.isArray(assessmentResult.persisted?.draftReviewModelRunIds)
    ? assessmentResult.persisted.draftReviewModelRunIds
    : [])
].filter(Boolean)) {
  createdModelRunIds.add(modelRunId);
}
const matchedSources = assessmentResult.contentContext?.matches || [];
const matchedFixture = matchedSources.find((source) => source.id === fixtureSourceId);
const matchedFixtureChunk = matchedFixture?.chunks?.find((chunk) =>
  `${chunk.text || ""} ${chunk.preview || ""}`.includes(e2eContentSentinel)
);
pass("assessment draft injects clean content context", assessment?.ok && assessmentId && assessmentResult.contentContext?.matchedCount >= 1 && !hasCorrupt(assessment.body), {
  verificationScope: verificationMeta.verificationScope,
  assessesGenerationQuality: verificationMeta.assessesGenerationQuality,
  qualityBoundary: verificationMeta.qualityBoundary,
  status: assessment?.status || 0,
  error: assessment?.body.error || null,
  message: assessment?.body.message || null,
  assignmentId: assessmentId || null,
  matchedCount: assessmentResult.contentContext?.matchedCount || 0,
  modelAvailable: assessmentResult.modelAvailable ?? null,
  usedDynamicFallback: assessmentResult.usedDynamicFallback ?? null,
  modelBudgetMs: generationModelBudgetMs,
  requirement: assessmentResult.generationContext?.request?.requirement || null,
  matchedSourceIds: matchedSources.map((source) => source.id),
  matchedChunkIds: matchedFixture?.chunks?.map((chunk) => chunk.id) || []
});
pass("assessment context names the approved fixture source and matching chunk", Boolean(
  assessment?.ok
    && matchedSources.length === 1
    && matchedFixture?.id === fixtureSourceId
    && assessmentResult.contentContext?.textbookContext?.assetId === e2eTextbook?.id
    && matchedFixtureChunk
), {
  fixtureSourceId,
  textbookAssetId: assessmentResult.contentContext?.textbookContext?.assetId || null,
  matchedSourceIds: matchedSources.map((source) => source.id),
  matchedChunkId: matchedFixtureChunk?.id || null,
  matchedChunkPreview: matchedFixtureChunk?.preview || null,
  approvedOnly: assessmentResult.contentContext?.approvedOnly ?? null
});

const draftExport = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/draft-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "assessment draft export", body: {} })
  : null;
const draftAsset = draftExport?.body.asset || {};
trackGeneratedAsset(draftAsset);
const draftLayoutValidation = draftExport?.body.layoutValidation || null;
const draftLayoutValid = draftLayoutValidation?.ok === true;
const draftAssetFetch = await fetchAsset(draftAsset.url);
pass("teacher can export review draft", draftExport?.ok && draftAsset.url && draftAssetFetch.ok && (!draftAssetFetch.text || !hasCorrupt(draftAssetFetch.text)), {
  url: draftAsset.url || null,
  fetchStatus: draftAssetFetch.status,
  contentType: draftAssetFetch.contentType,
  layoutValidation: draftLayoutValidation
});

const blockedPrint = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/print-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "blocked print export", body: {} })
  : null;
const expectedPreReviewError = draftLayoutValid ? "DRAFT_REVIEW_REQUIRED" : "ASSESSMENT_LAYOUT_INVALID";
pass("final print is blocked before review or valid layout", blockedPrint?.status === 409 && blockedPrint.body.error === expectedPreReviewError, {
  status: blockedPrint?.status || 0,
  error: blockedPrint?.body.error || null,
  expectedError: expectedPreReviewError,
  draftLayoutValid
});

const review = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/draft-review`, {
      method: "POST",
      token: teacherToken,
      label: "assessment draft review",
      body: { decision: "accept" }
    })
  : null;
pass("teacher review obeys layout validation", draftLayoutValid
  ? review?.ok && review.body.reviewStatus === "accepted"
  : review?.status === 409 && review.body.error === "ASSESSMENT_LAYOUT_INVALID", {
  status: review?.status || 0,
  error: review?.body.error || null,
  reviewStatus: review?.body.reviewStatus || null,
  draftLayoutValid
});

const printExport = teacherToken && assessmentId
  ? await request(`/api/assessments/${assessmentId}/print-export`, { method: "POST", token: teacherToken, timeoutMs: exportRequestTimeoutMs, label: "final print export", body: {} })
  : null;
const printAssets = printExport?.body.assets || [];
for (const asset of printAssets) trackGeneratedAsset(asset);
const fetchedAssets = await Promise.all(printAssets.map((asset) => fetchAsset(asset.url)));
pass("final print export obeys layout validation", draftLayoutValid
  ? printExport?.ok && printAssets.length >= 2 && fetchedAssets.every((item) => item.ok) && !hasCorrupt(printAssets)
  : printExport?.status === 409 && printExport.body.error === "ASSESSMENT_LAYOUT_INVALID", {
  status: printExport?.status || 0,
  error: printExport?.body.error || null,
  draftLayoutValid,
  assets: printAssets.map((asset) => ({ title: asset.title, url: asset.url })),
  fetchStatuses: fetchedAssets.map((item) => item.status),
  contentTypes: fetchedAssets.map((item) => item.contentType)
});
} finally {
  let sourcesRestored = true;
  const restoreResults = [];
  if (teacherToken) {
    for (const sourceId of touchedSourceIds) {
      const snapshot = sourceSnapshots.get(sourceId);
      const response = await request(`/api/knowledge/sources/${encodeURIComponent(sourceId)}/review`, {
        method: "PATCH",
        token: teacherToken,
        label: "restore E2E knowledge source review state",
        body: reviewRestorePayload(snapshot, { forceUnavailable: sourceId === fixtureSourceId })
      });
      const ok = response.ok;
      sourcesRestored = sourcesRestored && ok;
      restoreResults.push({ sourceId, ok, status: response.status, error: response.body?.error || null });
    }
  }
  let fixtureUnavailable = !fixtureSourceId;
  if (teacherToken && fixtureSourceId) {
    const afterCleanup = await request("/api/knowledge/sources?limit=200", {
      token: teacherToken,
      label: "verify E2E source cleanup"
    });
    const source = (afterCleanup.body.sources || []).find((item) => item.id === fixtureSourceId);
    fixtureUnavailable = Boolean(
      afterCleanup.ok
        && source
        && (source.reviewStatus !== "APPROVED" || source.allowedForGeneration !== true)
    );
  }
  pass("E2E test sources are unavailable after cleanup", sourcesRestored && fixtureUnavailable, {
    fixtureSourceId,
    fixtureUnavailable,
    restoredSourceIds: restoreResults.map((item) => item.sourceId),
    restoreResults
  });

  let indexRestored = true;
  try {
    restoreContentIndex(originalContentIndex);
  } catch (error) {
    indexRestored = false;
    progress(`fail restore content index: ${error instanceof Error ? error.message : String(error)}`);
  }
  pass("content index is restored after e2e", indexRestored, {
    restored: originalContentIndex != null,
    indexPath: path.relative(process.cwd(), contentIndexPath)
  });

  try {
    cleanContentContextE2eUploadFiles(apiUploadRoot, e2eRunId);
    cleanGeneratedArtifacts();
    cleanE2eWorkspaceFiles();
    pass("E2E filesystem artifacts are cleaned", true, {
      generatedArtifactCount: generatedArtifactPaths.size
    });
  } catch (error) {
    pass("E2E filesystem artifacts are cleaned", false, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  try {
    const deleted = await cleanE2eDatabaseRecords();
    pass("E2E database records are cleaned", deleted.sources === deleted.expectedSources, deleted);
  } catch (error) {
    pass("E2E database records are cleaned", false, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  apiBaseUrl,
  generatedAt: new Date().toISOString(),
  verification: verificationMeta,
  checks
}, null, 2));

if (failed.length) process.exitCode = 1;
}

if (isDirectContentContextE2eRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
