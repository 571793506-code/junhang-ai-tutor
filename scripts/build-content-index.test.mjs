import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./build-content-index.mjs", import.meta.url));

function runBuilder(inputDir, outDir) {
  return spawnSync(process.execPath, [scriptPath, inputDir, "--out", outDir], {
    encoding: "utf8"
  });
}

function createWorkspace(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-test-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

test("content index builder rejects a missing input directory", (t) => {
  const workspace = createWorkspace(t);
  const outDir = path.join(workspace, "index");
  const result = runBuilder(path.join(workspace, "missing"), outDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS/);
  assert.equal(fs.existsSync(path.join(outDir, "index.json")), false);
});

test("content index builder rejects an empty input directory", (t) => {
  const workspace = createWorkspace(t);
  const inputDir = path.join(workspace, "markdown");
  const outDir = path.join(workspace, "index");
  fs.mkdirSync(inputDir);
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ documentCount: 1, documents: [{ id: "stale" }] }));

  const result = runBuilder(inputDir, outDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS/);
  assert.equal(fs.existsSync(path.join(outDir, "index.json")), false);
});

test("content index builder writes an index when Markdown input exists", (t) => {
  const workspace = createWorkspace(t);
  const inputDir = path.join(workspace, "markdown");
  const outDir = path.join(workspace, "index");
  fs.mkdirSync(inputDir);
  fs.writeFileSync(
    path.join(inputDir, "fractions.md"),
    "# 五年级数学分数除法\n\n本资料用于练习分数除法、竖式计算和应用题。",
    "utf8"
  );

  const result = runBuilder(inputDir, outDir);

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(outDir, "index.json"), "utf8"));
  assert.equal(index.documentCount, 1);
  assert.equal(index.documents.length, 1);
});

test("content index builder preserves textbook edition metadata for matching", (t) => {
  const workspace = createWorkspace(t);
  const inputDir = path.join(workspace, "markdown");
  const outDir = path.join(workspace, "index");
  fs.mkdirSync(inputDir);
  fs.writeFileSync(
    path.join(inputDir, "pep-weather.md"),
    [
      "---",
      'sourcePath: "D:/teacher-materials/PEP五年级下册Unit3.md"',
      'edition: "人教版"',
      'volume: "下册"',
      'curriculumSeries: "PEP"',
      'curriculumRegion: "贵州遵义"',
      "---",
      "# 五年级英语 Unit 3 Weather",
      "",
      "本资料用于复习 Unit 3 Weather 的词汇、句型和阅读。"
    ].join("\n"),
    "utf8"
  );

  const result = runBuilder(inputDir, outDir);

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(outDir, "index.json"), "utf8"));
  assert.equal(index.documents[0].edition, "人教版");
  assert.equal(index.documents[0].volume, "下册");
  assert.equal(index.documents[0].curriculumSeries, "PEP");
  assert.equal(index.documents[0].curriculumRegion, "贵州遵义");
});
