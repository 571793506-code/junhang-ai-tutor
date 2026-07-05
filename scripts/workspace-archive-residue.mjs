import {
  archiveRuntimeResidue,
  buildWorkspaceGuardianReport
} from "./workspace-guardian-lib.mjs";

const json = process.argv.includes("--json");
const report = await buildWorkspaceGuardianReport();

if (!report.ignoredRuntimeFiles.length) {
  const result = {
    ok: true,
    archiveDir: null,
    movedFiles: [],
    skippedFiles: []
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write("工作区运行残留归档：无残留需要归档\n");
  }
  process.exit(0);
}

const result = await archiveRuntimeResidue({
  ignoredRuntimeFiles: report.ignoredRuntimeFiles
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
    `工作区运行残留归档：${result.ok ? "完成" : "部分失败"}`,
    "",
    `- 归档目录：${result.archiveDir || "无"}`,
    `- 已移动：${result.movedFiles.length}`,
    ...formatMoved(result.movedFiles),
    `- 跳过：${result.skippedFiles.length}`,
    ...formatSkipped(result.skippedFiles)
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
