import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectEncodingPayload, normalizeDisplayText } from "@junhang/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fix = process.argv.includes("--fix");
const includeGenerated = process.argv.includes("--include-generated");
const historyMode = process.argv.includes("--history");
const writeReport = process.argv.includes("--write-report") || historyMode;
const maxIssues = historyMode ? 5000 : 500;
const includeExt = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".wxml",
  ".wxss",
  ".html",
  ".css",
  ".prisma",
  ".sql",
  ".env",
  ""
]);
const ignoredFiles = new Set([
  path.normalize("docs/encoding-history-report.md")
]);
const ignoredDirs = new Set([
  ".git",
  "node_modules",
  ...(historyMode ? [] : ["exports"]),
  ...(historyMode || includeGenerated ? [] : ["dist"]),
  ...(historyMode || includeGenerated ? [] : ["uploads"]),
  ...(historyMode || includeGenerated ? [] : ["storage", "generated"])
]);

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (ignoredFiles.has(path.relative(root, fullPath))) continue;
    if (includeExt.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function isGuardImplementationLine(line) {
  return /^\s*\[".+",\s*".+"\],?\s*$/.test(line) ||
    line.includes("suspiciousPattern") ||
    line.includes("replace(/锟斤拷/g") ||
    line.includes("replace(/�/g");
}

function collectTextIssues(filePath, text) {
  const lines = text.split(/\r?\n/);
  const safeLines = [...lines];
  const issues = [];
  lines.forEach((line, index) => {
    if (isGuardImplementationLine(line)) return;
    const report = inspectEncodingPayload(line, { maxIssues: 1 });
    if (report.ok) return;
    const normalized = normalizeDisplayText(line);
    const normalizedReport = inspectEncodingPayload(normalized, { maxIssues: 1 });
    const autoFixable = normalized !== line && !line.includes("�") && normalizedReport.ok;
    if (autoFixable) safeLines[index] = normalized;
    issues.push({
      file: path.relative(root, filePath),
      line: index + 1,
      column: 1,
      value: line.trim().slice(0, 160),
      normalized: normalized.trim().slice(0, 160),
      autoFixable
    });
  });
  return { issues, normalized: safeLines.join("\n") };
}

function markdownCell(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

async function writeMarkdownReport(summary, issues) {
  const reportPath = path.join(root, "docs", "encoding-history-report.md");
  const grouped = new Map();
  for (const issue of issues) {
    if (!grouped.has(issue.file)) grouped.set(issue.file, []);
    grouped.get(issue.file).push(issue);
  }

  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, fileIssues]) => {
      const rows = fileIssues.slice(0, 40).map((issue) =>
        `| ${issue.line} | ${issue.autoFixable ? "是" : "否"} | \`${markdownCell(issue.value)}\` | \`${markdownCell(issue.normalized)}\` |`
      );
      const more = fileIssues.length > 40
        ? `\n\n该文件还有 ${fileIssues.length - 40} 条未在表格中展开。`
        : "";
      return `## ${file}\n\n| 行 | 可自动修复 | 原始片段 | 建议修复 |\n| --- | --- | --- | --- |\n${rows.join("\n")}${more}`;
    });

  const markdown = `# 历史乱码扫描报告

生成时间：${summary.generatedAt}

扫描模式：${summary.mode}

扫描文件数：${summary.checkedFiles}

问题数：${summary.issueCount}

自动修复文件数：${summary.fixedFiles}

${sections.length ? sections.join("\n\n") : "未发现乱码问题。"}
`;

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, markdown, "utf8");
  return path.relative(root, reportPath);
}

const files = await walk(root);
const allIssues = [];
let fixedFiles = 0;

for (const filePath of files) {
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  const result = collectTextIssues(filePath, text);
  if (!result.issues?.length) continue;
  allIssues.push(...result.issues);
  if (fix && result.normalized !== text) {
    await fs.writeFile(filePath, result.normalized, "utf8");
    fixedFiles += 1;
  }
}

const summary = {
  ok: allIssues.length === 0,
  checkedFiles: files.length,
  issueCount: allIssues.length,
  fixedFiles,
  mode: historyMode ? "history" : includeGenerated ? "generated" : "source",
  generatedAt: new Date().toISOString(),
  issues: allIssues.slice(0, maxIssues)
};

if (writeReport) {
  summary.reportPath = await writeMarkdownReport(summary, allIssues);
}

console.log(JSON.stringify(summary, null, 2));
if (allIssues.length > 0 && !fix) {
  process.exitCode = 1;
}
