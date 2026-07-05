import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_RUNTIME_SCAN_PATHS = [
  "exports",
  "storage",
  "apps/api/storage/uploads",
  "logs",
  "tmp"
];

export function parseGitStatus(lines = []) {
  const branchLine = lines.find((line) => line.startsWith("## ")) || "";
  const stagedFiles = [];
  const unstagedFiles = [];
  const untrackedFiles = [];

  for (const line of lines) {
    if (!line || line.startsWith("## ")) continue;
    if (line.startsWith("?? ")) {
      untrackedFiles.push(statusPath(line));
      continue;
    }

    const stagedMark = line[0];
    const unstagedMark = line[1];
    const filePath = statusPath(line);
    if (stagedMark && stagedMark !== " " && stagedMark !== "?") {
      stagedFiles.push(filePath);
    }
    if (unstagedMark && unstagedMark !== " " && unstagedMark !== "?") {
      unstagedFiles.push(filePath);
    }
  }

  return { branchLine, stagedFiles, unstagedFiles, untrackedFiles };
}

export async function buildWorkspaceGuardianReport(options = {}) {
  const runGit = options.runGit || ((args) => gitLines(args, options.cwd));
  const statusLines = await runGit(["status", "--short", "--branch", "--untracked-files=all"]);
  const ignoredLines = await runGit([
    "status",
    "--ignored",
    "--short",
    "--untracked-files=all",
    "--",
    ...(options.runtimeScanPaths || DEFAULT_RUNTIME_SCAN_PATHS)
  ]);
  const recentCommits = await runGit(["log", "--oneline", "-5"]);
  const status = parseGitStatus(statusLines);
  const ignoredRuntimeFiles = ignoredLines
    .filter((line) => line.startsWith("!! "))
    .map(statusPath);
  const clean = !status.stagedFiles.length &&
    !status.unstagedFiles.length &&
    !status.untrackedFiles.length &&
    !hasAhead(status.branchLine) &&
    !hasBehind(status.branchLine);

  return {
    clean,
    ...status,
    ignoredRuntimeFiles,
    recentCommits,
    recommendations: recommendWorkspaceActions({ ...status, ignoredRuntimeFiles })
  };
}

export function recommendWorkspaceActions(report) {
  const recommendations = [];
  if (report.stagedFiles?.length) {
    recommendations.push("暂存区已有内容；提交前再次确认只包含本次收口范围。");
  }
  if (report.unstagedFiles?.length) {
    recommendations.push("存在未暂存修改；先按文档、脚本、服务层、Web、小程序或本地保存分组。");
  }
  if (report.untrackedFiles?.length) {
    recommendations.push("存在未跟踪文件；不要使用 git add .，先确认是否为源码、文档、资产或运行产物。");
  }
  if (report.ignoredRuntimeFiles?.length) {
    recommendations.push("存在被忽略运行残留；默认保留本地，不纳入 Git。");
  }
  if (hasAhead(report.branchLine)) {
    recommendations.push("本地领先远端；验证后可推送。");
  }
  if (hasBehind(report.branchLine)) {
    recommendations.push("本地落后远端；开始新任务前先 fetch/rebase 或确认同步策略。");
  }
  if (!recommendations.length) {
    recommendations.push("工作区无未提交文件，且本地分支未显示 ahead/behind。");
  }
  return recommendations;
}

export function formatWorkspaceGuardianReport(report) {
  return [
    `工作区守护者：${report.clean ? "通过" : "不通过"}`,
    "",
    `- 分支状态：${report.branchLine || "未知"}`,
    `- 已暂存：${report.stagedFiles.length}`,
    ...formatItems(report.stagedFiles),
    `- 未暂存：${report.unstagedFiles.length}`,
    ...formatItems(report.unstagedFiles),
    `- 未跟踪：${report.untrackedFiles.length}`,
    ...formatItems(report.untrackedFiles),
    `- 被忽略运行残留：${report.ignoredRuntimeFiles.length}`,
    ...formatItems(report.ignoredRuntimeFiles),
    "- 最近提交：",
    ...formatItems(report.recentCommits),
    "- 建议下一步：",
    ...formatItems(report.recommendations)
  ].join("\n") + "\n";
}

function statusPath(line) {
  return line.slice(3).trim().replace(/^"|"$/g, "");
}

function hasAhead(branchLine = "") {
  return /\bahead\s+\d+/.test(branchLine);
}

function hasBehind(branchLine = "") {
  return /\bbehind\s+\d+/.test(branchLine);
}

function formatItems(items = []) {
  if (!items.length) return ["  - 无"];
  return items.map((item) => `  - ${item}`);
}

function gitLines(args, cwd = process.cwd()) {
  return new Promise((resolve) => {
    const child = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd: path.resolve(cwd),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => resolve([]));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\r?\n/).filter((line) => line.trim()));
    });
  });
}
