import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_RUNTIME_SCAN_PATHS = [
  "exports",
  "storage",
  "apps/api/storage/uploads",
  "logs",
  "tmp"
];

const PRESERVED_LOCAL_FILE_PATTERNS = [
  /^exports\/student-profile-template-pdfs\/.+\.(?:pdf|png)$/i,
  /^exports\/student-profile-template-pngs\/.+\.png$/i,
  /^tmp\/(?:export_student_archive_pngs|generate_student_archive_pdfs|make_pdf_contact_sheet)\.py$/i
];

const CLOSEOUT_PATTERNS = [
  /^AGENTS\.md$/i,
  /^SKILLS\.md$/i,
  /^docs\/(?:45-git-traceability-runbook|49-codex-plugin-usage-boundary-and-optimization|51-project-pitfall-review|52-workspace-guardian)\.md$/i,
  /^scripts\/workspace-guardian(?:-lib|\.test)?\.mjs$/i,
  /^scripts\/workspace-archive-residue\.mjs$/i
];

const CAUTION_PATTERNS = [
  /^apps\/miniprogram\//i,
  /^miniapp\//i,
  /^apps\/tablet\//i,
  /^apps\/public-screen\//i
];

const LOCAL_PATTERNS = [
  /^exports\//i,
  /^storage\//i,
  /^apps\/api\/storage\/uploads\//i,
  /^logs\//i,
  /^tmp\//i,
  /\.log$/i,
  /\.traineddata$/i,
  /\.tgz$/i,
  /(?:^|\/)console\.log/i,
  /(?:^|\/)\{console\.error/i
];

const TASK_REVIEW_BUCKETS = [
  ["closeout", "收口提交"],
  ["track", "继续跟踪"],
  ["local", "本地保存"],
  ["caution", "谨慎处理"]
];

const STAGE_SUGGESTION_BUCKETS = new Set(["closeout", "track"]);

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
  const ignoredFiles = ignoredLines
    .filter((line) => line.startsWith("!! "))
    .map(statusPath);
  const ignoredPreservedLocalFiles = ignoredFiles.filter(isPreservedLocalFile);
  const ignoredRuntimeFiles = ignoredFiles.filter((filePath) => !isPreservedLocalFile(filePath));
  const taskReview = buildTaskReview(status);
  const stageReview = buildTaskReview({
    stagedFiles: [],
    unstagedFiles: status.unstagedFiles,
    untrackedFiles: status.untrackedFiles
  });
  const pushStatus = buildPushStatus(status.branchLine);
  const riskReview = buildRiskReview({ ...status, ignoredRuntimeFiles, taskReview, pushStatus });
  const clean = !status.stagedFiles.length &&
    !status.unstagedFiles.length &&
    !status.untrackedFiles.length &&
    !ignoredRuntimeFiles.length &&
    !hasBehind(status.branchLine);

  return {
    clean,
    ...status,
    ignoredRuntimeFiles,
    ignoredPreservedLocalFiles,
    taskReview,
    riskReview,
    pushStatus,
    closeoutOrder: buildCloseoutOrder(taskReview),
    stageSuggestions: buildStageSuggestions(stageReview),
    recentCommits,
    recommendations: recommendWorkspaceActions({ ...status, ignoredRuntimeFiles })
  };
}

export function classifyWorkspaceFile(filePath = "") {
  const normalized = normalizeRelativePath(filePath);
  if (CLOSEOUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { bucket: "closeout", label: "收口提交" };
  }
  if (LOCAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { bucket: "local", label: "本地保存" };
  }
  if (CAUTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { bucket: "caution", label: "谨慎处理" };
  }
  return { bucket: "track", label: "继续跟踪" };
}

export async function archiveRuntimeResidue(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const ignoredRuntimeFiles = options.ignoredRuntimeFiles || [];
  const timestamp = options.timestamp || timestampForArchive(new Date());
  const archiveRoot = path.resolve(options.archiveRoot || path.join(cwd, "..", `${path.basename(cwd)}-local-archive`));
  const archiveDir = path.join(archiveRoot, `${timestamp}-run-residue`);
  const movedFiles = [];
  const skippedFiles = [];

  await fs.mkdir(archiveDir, { recursive: true });

  for (const relativeFile of ignoredRuntimeFiles) {
    const safeRelativePath = normalizeRelativePath(relativeFile);
    if (!safeRelativePath) {
      skippedFiles.push({ file: relativeFile, reason: "INVALID_PATH" });
      continue;
    }
    if (isPreservedLocalFile(safeRelativePath)) {
      skippedFiles.push({ file: safeRelativePath, reason: "PRESERVED_LOCAL_FILE" });
      continue;
    }

    const sourcePath = path.resolve(cwd, safeRelativePath);
    if (!sourcePath.startsWith(cwd + path.sep)) {
      skippedFiles.push({ file: relativeFile, reason: "OUTSIDE_WORKSPACE" });
      continue;
    }

    const targetPath = path.resolve(archiveDir, safeRelativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.rename(sourcePath, targetPath);
      movedFiles.push({ file: safeRelativePath, target: targetPath });
    } catch (error) {
      skippedFiles.push({
        file: safeRelativePath,
        reason: error?.code || "MOVE_FAILED"
      });
    }
  }

  return {
    ok: skippedFiles.length === 0,
    archiveDir,
    movedFiles,
    skippedFiles
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
    recommendations.push("可运行 cmd /c npm.cmd run workspace:archive-residue 将运行残留移到本地归档。");
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
    `- 风险等级：${report.riskReview?.label || "未知"}`,
    ...formatItems(report.riskReview?.reasons || []),
    `- 推送状态：${formatPushStatus(report.pushStatus)}`,
    `- 已暂存：${report.stagedFiles.length}`,
    ...formatItems(report.stagedFiles),
    `- 未暂存：${report.unstagedFiles.length}`,
    ...formatItems(report.unstagedFiles),
    `- 未跟踪：${report.untrackedFiles.length}`,
    ...formatItems(report.untrackedFiles),
    `- 被忽略运行残留：${report.ignoredRuntimeFiles.length}`,
    ...formatItems(report.ignoredRuntimeFiles),
    `- 被忽略本地保留：${report.ignoredPreservedLocalFiles?.length || 0}`,
    ...formatItems(report.ignoredPreservedLocalFiles || []),
    "- 任务审查：",
    ...formatTaskReview(report.taskReview),
    "- 收口顺序：",
    ...formatCloseoutOrder(report.closeoutOrder),
    "- 显式 stage 建议：",
    ...formatStageSuggestions(report.stageSuggestions),
    "- 最近提交：",
    ...formatItems(report.recentCommits),
    "- 建议下一步：",
    ...formatItems(report.recommendations)
  ].join("\n") + "\n";
}

export function buildPushStatus(branchLine = "") {
  const ahead = matchBranchCount(branchLine, "ahead");
  const behind = matchBranchCount(branchLine, "behind");
  if (!branchLine) {
    return {
      state: "unknown",
      label: "未知",
      action: "无法读取分支状态；先运行 git status --short --branch。"
    };
  }
  if (ahead && behind) {
    return {
      state: "diverged",
      label: `分叉（ahead ${ahead}, behind ${behind}）`,
      action: "开始新任务前先确认同步策略。"
    };
  }
  if (behind) {
    return {
      state: "behind",
      label: `落后远端（behind ${behind}）`,
      action: "开始新任务前先 fetch/rebase 或确认同步策略。"
    };
  }
  if (ahead) {
    return {
      state: "ahead",
      label: `领先远端（ahead ${ahead}）`,
      action: "验证后可推送。"
    };
  }
  if (branchLine.includes("...")) {
    return {
      state: "synced",
      label: "已同步",
      action: "无需推送。"
    };
  }
  return {
    state: "local",
    label: "本地分支",
    action: "没有远端跟踪信息；需要推送时先确认 upstream。"
  };
}

function buildRiskReview(report) {
  const reasons = [];
  const stagedLocal = (report.stagedFiles || []).filter((filePath) => classifyWorkspaceFile(filePath).bucket === "local");
  const stagedCaution = (report.stagedFiles || []).filter((filePath) => classifyWorkspaceFile(filePath).bucket === "caution");
  const visibleCount = (report.stagedFiles?.length || 0) +
    (report.unstagedFiles?.length || 0) +
    (report.untrackedFiles?.length || 0);

  if (report.pushStatus?.state === "diverged" || report.pushStatus?.state === "behind") {
    reasons.push("本地分支落后远端；先确认同步策略。");
  }
  if (stagedLocal.length) {
    reasons.push("暂存区包含本地保存类文件；提交前需要人工确认。");
  }
  if (stagedCaution.length) {
    reasons.push("暂存区包含谨慎处理类文件；提交前需要单独验证边界。");
  }
  if (report.taskReview?.caution?.length) {
    reasons.push("存在小程序、平板或公共屏等谨慎处理范围。");
  }
  if (report.ignoredRuntimeFiles?.length) {
    reasons.push("存在被忽略运行残留；默认本地保存，不纳入 Git。");
  }
  if (visibleCount) {
    reasons.push("存在可见未收口文件；按任务审查顺序分组处理。");
  }
  if (!visibleCount && !report.ignoredRuntimeFiles?.length && report.pushStatus?.state === "ahead") {
    reasons.push("工作区干净，本地提交尚未推送。");
  }
  if (!reasons.length) {
    reasons.push("工作区无可见未提交文件，无 ignored 运行残留。");
  }

  const highRisk = report.pushStatus?.state === "diverged" ||
    report.pushStatus?.state === "behind" ||
    stagedLocal.length ||
    stagedCaution.length;
  if (highRisk) {
    return { level: "high", label: "高风险", reasons };
  }
  if (visibleCount || report.ignoredRuntimeFiles?.length || report.pushStatus?.state === "ahead") {
    return { level: "attention", label: "需关注", reasons };
  }
  return { level: "clean", label: "干净", reasons };
}

function buildCloseoutOrder(taskReview = {}) {
  return TASK_REVIEW_BUCKETS
    .map(([bucket, label]) => {
      const files = taskReview[bucket] || [];
      return {
        bucket,
        label,
        count: files.length,
        files,
        action: closeoutAction(bucket)
      };
    })
    .filter((item) => item.count);
}

function buildStageSuggestions(taskReview = {}) {
  return TASK_REVIEW_BUCKETS
    .map(([bucket, label]) => {
      const files = taskReview[bucket] || [];
      if (!files.length) return null;
      if (!STAGE_SUGGESTION_BUCKETS.has(bucket)) {
        return {
          bucket,
          label,
          files,
          command: null,
          note: bucket === "local" ?
            "默认本地保存或加入忽略，不建议纳入提交。" :
            "先确认 API/服务层边界和专项验证，再决定是否显式 stage。"
        };
      }
      return {
        bucket,
        label,
        files,
        command: `git add -- ${files.map(quoteGitPath).join(" ")}`,
        note: bucket === "closeout" ?
          "适合守护者或规则收口提交，提交前运行对应验证。" :
          "按模块确认验证范围后再使用。"
      };
    })
    .filter(Boolean);
}

function statusPath(line) {
  return normalizeRelativePath(line.slice(3).trim().replace(/^"|"$/g, ""));
}

function hasAhead(branchLine = "") {
  return /\bahead\s+\d+/.test(branchLine);
}

function hasBehind(branchLine = "") {
  return /\bbehind\s+\d+/.test(branchLine);
}

function matchBranchCount(branchLine = "", key) {
  const match = branchLine.match(new RegExp(`\\b${key}\\s+(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function normalizeRelativePath(filePath = "") {
  const normalized = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized === "..") return "";
  return normalized;
}

function buildTaskReview(status) {
  const review = Object.fromEntries(TASK_REVIEW_BUCKETS.map(([bucket]) => [bucket, []]));
  const visibleFiles = [
    ...(status.stagedFiles || []),
    ...(status.unstagedFiles || []),
    ...(status.untrackedFiles || [])
  ];
  for (const filePath of visibleFiles) {
    const { bucket } = classifyWorkspaceFile(filePath);
    if (!review[bucket].includes(filePath)) {
      review[bucket].push(filePath);
    }
  }
  return review;
}

function isPreservedLocalFile(filePath = "") {
  const normalized = normalizeRelativePath(filePath);
  return PRESERVED_LOCAL_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function timestampForArchive(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "T" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function formatItems(items = []) {
  if (!items.length) return ["  - 无"];
  return items.map((item) => `  - ${item}`);
}

function formatPushStatus(pushStatus) {
  if (!pushStatus) return "未知";
  return `${pushStatus.label}；${pushStatus.action}`;
}

function formatTaskReview(taskReview = {}) {
  return TASK_REVIEW_BUCKETS.flatMap(([bucket, label]) => {
    const files = taskReview[bucket] || [];
    return [
      `  - ${label}：${files.length}`,
      ...files.map((filePath) => `    - ${filePath}`)
    ];
  });
}

function formatCloseoutOrder(closeoutOrder = []) {
  if (!closeoutOrder.length) return ["  - 无"];
  return closeoutOrder.map((item, index) => (
    `  ${index + 1}. ${item.label}：${item.count}；${item.action}`
  ));
}

function formatStageSuggestions(stageSuggestions = []) {
  if (!stageSuggestions.length) return ["  - 无"];
  return stageSuggestions.flatMap((item) => {
    if (!item.command) {
      return [`  - ${item.label}：${item.note}`];
    }
    return [
      `  - ${item.label}：${item.note}`,
      `    ${item.command}`
    ];
  });
}

function closeoutAction(bucket) {
  if (bucket === "closeout") {
    return "优先验证并提交。";
  }
  if (bucket === "track") {
    return "按模块验证后单独提交。";
  }
  if (bucket === "local") {
    return "默认本地保存或加入忽略，不提交。";
  }
  if (bucket === "caution") {
    return "先确认边界和专项验证，不混入普通收口。";
  }
  return "人工确认。";
}

function quoteGitPath(filePath) {
  const normalized = normalizeRelativePath(filePath);
  if (/^[A-Za-z0-9_./-]+$/.test(normalized)) return normalized;
  return `"${normalized.replace(/(["\\$`])/g, "\\$1")}"`;
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
