import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

let findStaleTextbookAssetIds;
let mergeTextbookAssetMetadata;
try {
  ({ findStaleTextbookAssetIds, mergeTextbookAssetMetadata } = await import("./textbook-asset-metadata.mjs"));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = path.join(repoRoot, "scripts", "scan-textbook-assets.mjs");

test("rescan metadata preserves teacher-maintained chapters and chapter index fields", () => {
  assert.equal(
    typeof mergeTextbookAssetMetadata,
    "function",
    "textbook imports need a metadata merge helper"
  );

  const chapters = [{ id: "chapter-1", title: "第一单元", knowledgePoints: ["分数乘法"] }];
  const result = mergeTextbookAssetMetadata(
    {
      relativePath: "数学/五年级数学下册.edupdf",
      ext: ".edupdf",
      size: 2048,
      mtime: "2026-07-12T08:00:00.000Z",
      importState: "只读索引"
    },
    {
      relativePath: "旧路径.edupdf",
      size: 1024,
      chapters,
      chapterIndexStatus: "teacher-draft",
      chapterIndexUpdatedAt: "2026-07-11T08:00:00.000Z",
      chapterIndexUpdatedByTeacherId: "teacher-1"
    }
  );

  assert.equal(result.relativePath, "数学/五年级数学下册.edupdf");
  assert.equal(result.size, 2048);
  assert.deepEqual(result.chapters, chapters);
  assert.equal(result.chapterIndexStatus, "teacher-draft");
  assert.equal(result.chapterIndexUpdatedAt, "2026-07-11T08:00:00.000Z");
  assert.equal(result.chapterIndexUpdatedByTeacherId, "teacher-1");
});

test("scanner excludes ordinary instruction files from textbook assets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "textbook-scan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "五年级数学下册.edupdf"), "protected textbook fixture");
  fs.writeFileSync(path.join(root, "教材库使用说明.md"), "# 使用说明\n");
  fs.writeFileSync(path.join(root, "维护备注.txt"), "ordinary note\n");

  const result = spawnSync(process.execPath, [scannerPath, root], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.count, 1);
  assert.deepEqual(report.byExt, { ".edupdf": 1 });
  assert.deepEqual(report.samples.map((asset) => asset.title), ["五年级数学下册"]);
});

test("scanner recognizes first and second grade and preserves the Zunyi baseline labels", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "textbook-baseline-scan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [
    ["人教版-小学语文", "义务教育教科书·语文一年级上册.edupdf"],
    ["人教版-小学数学", "义务教育教科书·数学二年级下册.edupdf"],
    ["PEP-小学英语", "义务教育教科书·英语（三年级起点）三年级上册.edupdf"]
  ];
  for (const [directory, name] of files) {
    const fullDirectory = path.join(root, directory);
    fs.mkdirSync(fullDirectory, { recursive: true });
    fs.writeFileSync(path.join(fullDirectory, name), "protected textbook fixture");
  }

  const result = spawnSync(process.execPath, [scannerPath, root], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.count, 3);
  const byTitle = new Map(report.samples.map((asset) => [asset.title, asset]));
  assert.equal(byTitle.get("义务教育教科书·语文一年级上册")?.grade, "一年级");
  assert.equal(byTitle.get("义务教育教科书·数学二年级下册")?.grade, "二年级");
  assert.equal(byTitle.get("义务教育教科书·语文一年级上册")?.edition, "统编版");
  assert.equal(byTitle.get("义务教育教科书·语文一年级上册")?.curriculumSeries, "人教体系");
  assert.equal(byTitle.get("义务教育教科书·数学二年级下册")?.edition, "人教版");
  assert.equal(byTitle.get("义务教育教科书·英语（三年级起点）三年级上册")?.edition, "人教版");
  assert.equal(byTitle.get("义务教育教科书·英语（三年级起点）三年级上册")?.curriculumSeries, "PEP");
  assert.equal(byTitle.get("义务教育教科书·英语（三年级起点）三年级上册")?.curriculumRegion, "贵州遵义");
});

test("textbook import cleanup only removes stale managed records under the scanned root", () => {
  assert.equal(typeof findStaleTextbookAssetIds, "function");
  const root = "D:\\君航AI助教\\textbooks";
  const staleIds = findStaleTextbookAssetIds(
    [
      { id: "kept", source: root, path: `${root}\\人教版-小学数学\\数学五年级下册.edupdf` },
      { id: "stale-note", source: root, path: `${root}\\教材库使用说明.md` },
      { id: "external", source: "D:\\其他教材", path: "D:\\其他教材\\数学五年级下册.edupdf" },
      { id: "manual", source: root, path: null }
    ],
    [
      { id: "kept", path: `${root}\\人教版-小学数学\\数学五年级下册.edupdf` }
    ],
    root
  );

  assert.deepEqual(staleIds, ["stale-note"]);
});
