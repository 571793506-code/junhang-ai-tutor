import {
  archiveRuntimeResidue,
  buildWorkspaceGuardianReport
} from "./workspace-guardian-lib.mjs";

const json = process.argv.includes("--json");
const dryRun = process.argv.includes("--dry-run");
const report = await buildWorkspaceGuardianReport();

if (!report.ignoredRuntimeFiles.length) {
  const result = {
    ok: true,
    dryRun,
    archiveDir: null,
    manifestPath: null,
    plannedFiles: [],
    movedFiles: [],
    skippedFiles: [],
    conflicts: []
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write("工作区运行残留归档：无残留需要归档\n");
  }
  process.exit(0);
}

const result = await archiveRuntimeResidue({
  ignoredRuntimeFiles: report.ignoredRuntimeFiles,
  dryRun
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  process.stdout.write(formatArchiveResult(result));
}

if (!result.ok) {
  process.exitCode = 1;
}

function formatArchiveResult(result) {
  return [
    `工作区运行残留归档：${result.dryRun ? "预览" : result.ok ? "完成" : "部分失败"}`,
    "",
    result.dryRun ? "- dry-run：未移动文件。" : "- 已生成清单并执行显式移动。",
    `- 归档目录：${result.archiveDir || "无"}`,
    `- 计划：${result.plannedFiles?.length || 0}`,
    ...formatMoved(result.plannedFiles || []),
    `- 已移动：${result.movedFiles.length}`,
    ...formatMoved(result.movedFiles),
    `- 跳过：${result.skippedFiles.length}`,
    ...formatSkipped(result.skippedFiles),
    `- 冲突：${result.conflicts?.length || 0}`,
    ...formatSkipped(result.conflicts || [])
  ].join("\n") + "\n";
}

function formatMoved(items = []) {
  if (!items.length) return ["  - 无"];
  return items.map((item) => `  - ${item.file}`);
}

function formatSkipped(items = []) {
  if (!items.length) return ["  - 无"];
  return items.map((item) => `  - ${item.file}：${item.reason}`);
}
