import fs from "node:fs";
import path from "node:path";

const checks = [];

function pass(name, ok, detail = {}) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function read(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function hasCorrupt(value) {
  return /[\uFFFD]|\u951f\u65a4\u62f7|\?{3,}/.test(value);
}

const webMain = read("apps/web/src/main.tsx");
const webApi = read("apps/web/src/api.ts");
const materialInputSnippet = webMain.match(/<input[^>]+data-testid="content-material-file-input"[^>]+>/)?.[0] || "";

pass("content upload panel has stable test id", webMain.includes('data-testid="content-index-panel"'));
pass("content material file input has stable test id", webMain.includes('data-testid="content-material-file-input"'));
pass("content material import button has stable test id", webMain.includes('data-testid="content-material-import-button"'));
pass("protected edupdf extension is filtered in web", webMain.includes('const PROTECTED_TEXTBOOK_EXTENSION = ".edupdf"') && webMain.includes("splitTeachingMaterialFiles"));
pass("file picker excludes edupdf from accept list", Boolean(materialInputSnippet) && !/accept="[^"]*\.edupdf/i.test(materialInputSnippet), {
  acceptSnippet: materialInputSnippet.match(/accept="[^"]+"/)?.[0] || null
});
pass("file picker includes supported teaching material extensions", [".pdf", ".docx", ".pptx", ".xlsx", ".md"].every((ext) => materialInputSnippet.includes(ext)), {
  acceptSnippet: materialInputSnippet.match(/accept="[^"]+"/)?.[0] || null
});
pass("file picker clears value after selection", webMain.includes("event.currentTarget.value = \"\""));
pass("upload notice is wired into content panel", webMain.includes("notice={contentFileNotice}") && webMain.includes("context-note blocked"));
pass("content context summary is visible in panel", webMain.includes("\u5df2\u8fdb\u5165\u751f\u6210\u4e0a\u4e0b\u6587"));
pass("web api uploads materials with multipart form data", webApi.includes("new FormData()") && webApi.includes('formData.append("files", file)'));
pass("web api posts to markdown ingestion endpoint", webApi.includes("/api/content/markdown-ingestion"));
pass("web api passes optional outDir", webApi.includes('formData.append("outDir", input.outDir)'));
pass("checked sources do not contain replacement mojibake", !hasCorrupt(webMain) && !hasCorrupt(webApi));

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({ ok, generatedAt: new Date().toISOString(), checks }, null, 2));
if (!ok) process.exit(1);
