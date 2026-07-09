import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  archiveRuntimeResidue,
  buildWorkspaceGuardianReport,
  formatWorkspaceGuardianReport,
  parseGitStatus,
  recommendWorkspaceActions
} from "./workspace-guardian-lib.mjs";

test("parseGitStatus separates staged, unstaged, and untracked files", () => {
  const result = parseGitStatus([
    "## main...origin/main [ahead 1, behind 2]",
    "M  SKILLS.md",
    " M docs/52-workspace-guardian.md",
    "A  scripts/workspace-guardian.mjs",
    "?? tmp-note.md"
  ]);

  assert.equal(result.branchLine, "## main...origin/main [ahead 1, behind 2]");
  assert.deepEqual(result.stagedFiles, [
    "SKILLS.md",
    "scripts/workspace-guardian.mjs"
  ]);
  assert.deepEqual(result.unstagedFiles, ["docs/52-workspace-guardian.md"]);
  assert.deepEqual(result.untrackedFiles, ["tmp-note.md"]);
});

test("buildWorkspaceGuardianReport collects git state without mutating the workspace", async () => {
  const calls = [];
  const runGit = async (args) => {
    calls.push(args);
    if (args.includes("--ignored")) {
      return [
        "!! exports/api-start.log",
        "!! apps/api/storage/uploads/demo.jpg"
      ];
    }
    if (args[0] === "status") {
      return [
        "## main...origin/main [ahead 1]",
        "M  SKILLS.md",
        " M docs/52-workspace-guardian.md",
        "?? scripts/workspace-guardian-lib.mjs"
      ];
    }
    if (args[0] === "log") {
      return ["abc1234 docs: update guard"];
    }
    return [];
  };

  const report = await buildWorkspaceGuardianReport({ runGit });

  assert.equal(report.clean, false);
  assert.deepEqual(report.stagedFiles, ["SKILLS.md"]);
  assert.deepEqual(report.unstagedFiles, ["docs/52-workspace-guardian.md"]);
  assert.deepEqual(report.untrackedFiles, ["scripts/workspace-guardian-lib.mjs"]);
  assert.deepEqual(report.ignoredRuntimeFiles, [
    "exports/api-start.log",
    "apps/api/storage/uploads/demo.jpg"
  ]);
  assert.deepEqual(report.recentCommits, ["abc1234 docs: update guard"]);
  assert.ok(calls.every((args) => !args.includes("add") && !args.includes("clean")));
});

test("buildWorkspaceGuardianReport treats local ahead as push reminder instead of dirty workspace", async () => {
  const runGit = async (args) => {
    if (args.includes("--ignored")) return [];
    if (args[0] === "status") return ["## main...origin/main [ahead 2]"];
    if (args[0] === "log") return ["abc1234 docs: update guard"];
    return [];
  };

  const report = await buildWorkspaceGuardianReport({ runGit });

  assert.equal(report.clean, true);
  assert.ok(report.recommendations.includes("本地领先远端；验证后可推送。"));
});

test("buildWorkspaceGuardianReport preserves approved student profile export PDFs and PNGs locally", async () => {
  const runGit = async (args) => {
    if (args.includes("--ignored")) {
      return [
        "!! exports/student-profile-template-pdfs/20260706-archive-print-clean/weekly-student-growth-archive.pdf",
        "!! exports/student-profile-template-pdfs/20260706-archive-print-clean/previews/weekly-page-1.png",
        "!! exports/student-profile-template-pngs/20260706-moments/weekly/weekly-moments-long.png",
        "!! tmp/generate_student_archive_pdfs.py",
        "!! exports/api-start.log"
      ];
    }
    if (args[0] === "status") return ["## main...origin/main"];
    if (args[0] === "log") return ["abc1234 docs: update guard"];
    return [];
  };

  const report = await buildWorkspaceGuardianReport({ runGit });

  assert.equal(report.clean, false);
  assert.deepEqual(report.ignoredRuntimeFiles, [
    "exports/api-start.log"
  ]);
  assert.deepEqual(report.ignoredPreservedLocalFiles, [
    "exports/student-profile-template-pdfs/20260706-archive-print-clean/weekly-student-growth-archive.pdf",
    "exports/student-profile-template-pdfs/20260706-archive-print-clean/previews/weekly-page-1.png",
    "exports/student-profile-template-pngs/20260706-moments/weekly/weekly-moments-long.png",
    "tmp/generate_student_archive_pdfs.py"
  ]);
});

test("buildWorkspaceGuardianReport stays clean when ignored files are only approved local PDFs and PNGs", async () => {
  const runGit = async (args) => {
    if (args.includes("--ignored")) {
      return [
        "!! exports/student-profile-template-pdfs/20260706-archive-showcase/final-student-growth-archive.pdf",
        "!! exports/student-profile-template-pdfs/20260706-archive-showcase/previews/final-page-1.png",
        "!! exports/student-profile-template-pngs/20260706-moments/final/final-moments-long.png"
      ];
    }
    if (args[0] === "status") return ["## main...origin/main"];
    if (args[0] === "log") return ["abc1234 docs: update guard"];
    return [];
  };

  const report = await buildWorkspaceGuardianReport({ runGit });

  assert.equal(report.clean, true);
  assert.deepEqual(report.ignoredRuntimeFiles, []);
  assert.equal(report.ignoredPreservedLocalFiles.length, 3);
});

test("recommendWorkspaceActions classifies next actions conservatively", () => {
  const recommendations = recommendWorkspaceActions({
    stagedFiles: ["SKILLS.md"],
    unstagedFiles: ["apps/web/src/main.tsx"],
    untrackedFiles: ["exports/demo.pdf"],
    ignoredRuntimeFiles: ["tmp/demo.log"],
    branchLine: "## main...origin/main [ahead 1, behind 1]"
  });

  assert.ok(recommendations.includes("暂存区已有内容；提交前再次确认只包含本次收口范围。"));
  assert.ok(recommendations.includes("存在未暂存修改；先按文档、脚本、服务层、Web、小程序或本地保存分组。"));
  assert.ok(recommendations.includes("存在未跟踪文件；不要使用 git add .，先确认是否为源码、文档、资产或运行产物。"));
  assert.ok(recommendations.includes("存在被忽略运行残留；默认保留本地，不纳入 Git。"));
  assert.ok(recommendations.includes("可运行 cmd /c npm.cmd run workspace:archive-residue 将运行残留移到本地归档。"));
  assert.ok(recommendations.includes("本地领先远端；验证后可推送。"));
  assert.ok(recommendations.includes("本地落后远端；开始新任务前先 fetch/rebase 或确认同步策略。"));
});

test("formatWorkspaceGuardianReport renders a readable Chinese summary", () => {
  const text = formatWorkspaceGuardianReport({
    clean: false,
    branchLine: "## main...origin/main [ahead 1]",
    stagedFiles: ["SKILLS.md"],
    unstagedFiles: [],
    untrackedFiles: ["scripts/workspace-guardian-lib.mjs"],
    ignoredRuntimeFiles: ["exports/api-start.log"],
    ignoredPreservedLocalFiles: [],
    recentCommits: ["abc1234 docs: update guard"],
    recommendations: ["存在未跟踪文件；不要使用 git add .，先确认是否为源码、文档、资产或运行产物。"]
  });

  assert.match(text, /工作区守护者：不通过/);
  assert.match(text, /已暂存：1/);
  assert.match(text, /未跟踪：1/);
  assert.match(text, /被忽略运行残留：1/);
  assert.match(text, /不要使用 git add \./);
});

test("archiveRuntimeResidue moves ignored runtime files outside the workspace", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-workspace-"));
  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-archive-"));
  const relativeFiles = [
    "exports/markdown-ingestion-e2e/manifest.json",
    "storage/e2e-fixtures/content-context-upload-fixture.md"
  ];

  for (const relativePath of relativeFiles) {
    const sourcePath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, relativePath, "utf8");
  }

  const result = await archiveRuntimeResidue({
    cwd: workspaceRoot,
    archiveRoot,
    ignoredRuntimeFiles: relativeFiles,
    timestamp: "2026-07-05T11-00-00"
  });

  assert.equal(result.ok, true);
  assert.equal(result.movedFiles.length, 2);
  assert.deepEqual(result.skippedFiles, []);
  for (const relativePath of relativeFiles) {
    assert.equal(fs.existsSync(path.join(workspaceRoot, relativePath)), false);
    assert.equal(fs.readFileSync(path.join(result.archiveDir, relativePath), "utf8"), relativePath);
  }
});
