import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as contentContextE2e from "./content-context-e2e.mjs";
import {
  buildContentContextE2eVerificationMeta,
  isDirectContentContextE2eRun,
  selectContentContextE2eTextbook
} from "./content-context-e2e.mjs";

const contentContextE2eSource = fs.readFileSync(new URL("./content-context-e2e.mjs", import.meta.url), "utf8");

test("content context e2e is classified as a link guard, not a generation quality sample", () => {
  const meta = buildContentContextE2eVerificationMeta({ generationModelBudgetMs: 8000 });

  assert.equal(meta.verificationScope, "link-guard");
  assert.equal(meta.assessesGenerationQuality, false);
  assert.equal(meta.assessesModelCreativity, false);
  assert.equal(meta.allowsDynamicFallback, true);
  assert.equal(meta.modelBudgetMs, 8000);
  assert.match(meta.qualityBoundary, /does not assess generation content quality/i);
  assert.deepEqual(meta.proves, [
    "api-session-content-context-flow",
    "approved-content-context-sync",
    "approved-source-chunk-match",
    "bounded-assessment-draft-return",
    "teacher-review-gate",
    "draft-export-and-layout-review-gate"
  ]);
});

test("content context e2e detects direct script execution on Windows paths", () => {
  const scriptPath = fileURLToPath(new URL("./content-context-e2e.mjs", import.meta.url));
  const scriptUrl = pathToFileURL(scriptPath).href;

  assert.equal(isDirectContentContextE2eRun(scriptUrl, scriptPath), true);
  assert.equal(isDirectContentContextE2eRun(scriptUrl, undefined), false);
  assert.equal(isDirectContentContextE2eRun(scriptUrl, process.execPath), false);
});

test("content context e2e selects a supported fifth-grade baseline textbook", () => {
  const asset = selectContentContextE2eTextbook([
    { id: "math-2", subject: "数学", grade: "二年级", baselineMatched: true },
    { id: "math-5", subject: "数学", grade: "五年级", baselineMatched: true },
    { id: "math-5-other", subject: "数学", grade: "五年级", baselineMatched: false }
  ], { subject: "数学", grade: "五年级" });

  assert.equal(asset?.id, "math-5");
});

test("content context e2e carries the selected textbook asset id into source review payloads", () => {
  const reviewStart = contentContextE2eSource.indexOf("const reviewResponses = []");
  const reviewEnd = contentContextE2eSource.indexOf("const approvedFixture", reviewStart);
  const reviewSource = contentContextE2eSource.slice(reviewStart, reviewEnd);

  assert.match(reviewSource, /textbookAssetId:\s*e2eTextbook\?\.id/);
});

test("content context e2e resolves API-owned storage roots from the repository root", () => {
  assert.equal(typeof contentContextE2e.resolveContentContextE2eStorageRoots, "function");
  const repositoryRoot = path.resolve("tmp", "content-context-e2e-repository");

  assert.deepEqual(contentContextE2e.resolveContentContextE2eStorageRoots(repositoryRoot), {
    uploadRoot: path.join(repositoryRoot, "apps", "api", "storage", "uploads"),
    generatedRoot: path.join(repositoryRoot, "apps", "api", "storage", "generated")
  });
});

test("content context e2e recognizes only its upload fixture file names", () => {
  assert.equal(typeof contentContextE2e.isContentContextE2eUploadFileName, "function");
  const runId = "11111111-1111-4111-8111-111111111111";

  assert.equal(contentContextE2e.isContentContextE2eUploadFileName(`1783864150082-c5ers3-${runId}-content-context-upload-fixture.md`, runId), true);
  assert.equal(contentContextE2e.isContentContextE2eUploadFileName(`1783864150367-go08im-${runId}-protected-textbook.edupdf`, runId), true);
  assert.equal(contentContextE2e.isContentContextE2eUploadFileName(`${runId}-content-context-upload-fixture.md`, runId), false);
  assert.equal(contentContextE2e.isContentContextE2eUploadFileName(`1-a-${runId}-content-context-upload-fixture.md`, runId), false);
  assert.equal(contentContextE2e.isContentContextE2eUploadFileName(`1783864150082-c5ers3-${runId}-content-context-upload-fixture.md.bak`, runId), false);
  assert.equal(contentContextE2e.isContentContextE2eUploadFileName("teacher-unit-notes.md", runId), false);
});

test("content context e2e identifies the current-run fixture source by its uploaded source path", () => {
  assert.equal(typeof contentContextE2e.isContentContextE2eFixtureSource, "function");
  const runId = "11111111-1111-4111-8111-111111111111";
  const uploadName = `1783864150082-c5ers3-${runId}-content-context-upload-fixture.md`;
  const source = {
    sourcePath: path.join("apps", "api", "storage", "uploads", "2026-07-12", uploadName),
    markdownPath: path.join("exports", "markdown-ingestion-e2e", `001-${uploadName}`)
  };
  const protectedSource = {
    sourcePath: path.join("apps", "api", "storage", "uploads", "2026-07-12", `1783864150367-go08im-${runId}-protected-textbook.edupdf`)
  };

  assert.equal(contentContextE2e.isContentContextE2eFixtureSource(source, runId), true);
  assert.equal(contentContextE2e.isContentContextE2eFixtureSource(protectedSource, runId), false);
  assert.equal(contentContextE2e.isContentContextE2eFixtureSource({ markdownPath: source.markdownPath }, runId), false);
  assert.equal(contentContextE2e.isContentContextE2eFixtureSource(source, "22222222-2222-4222-8222-222222222222"), false);
});

test("content context e2e recursively cleans only current-run uploads inside its upload root", (t) => {
  assert.equal(typeof contentContextE2e.cleanContentContextE2eUploadFiles, "function");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "content-context-e2e-cleanup-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const uploadRoot = path.join(tempRoot, "uploads");
  const dateDir = path.join(uploadRoot, "2026-07-12");
  const outsideRoot = path.join(tempRoot, "outside");
  fs.mkdirSync(dateDir, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  const runId = "11111111-1111-4111-8111-111111111111";
  const otherRunId = "22222222-2222-4222-8222-222222222222";
  const ownedFixture = path.join(dateDir, `1783864150082-c5ers3-${runId}-content-context-upload-fixture.md`);
  const ownedProtected = path.join(dateDir, `1783864150367-go08im-${runId}-protected-textbook.edupdf`);
  const otherRunFixture = path.join(dateDir, `1783864150376-sjtr6r-${otherRunId}-content-context-upload-fixture.md`);
  const nearMatch = path.join(dateDir, `1783864150082-c5ers3-${runId}-content-context-upload-fixture.md.bak`);
  const outsideSentinel = path.join(outsideRoot, `1783864150082-c5ers3-${runId}-content-context-upload-fixture.md`);
  for (const filePath of [ownedFixture, ownedProtected, otherRunFixture, nearMatch, outsideSentinel]) {
    fs.writeFileSync(filePath, "fixture", "utf8");
  }

  assert.equal(contentContextE2e.cleanContentContextE2eUploadFiles(uploadRoot, runId), 2);
  assert.equal(fs.existsSync(ownedFixture), false);
  assert.equal(fs.existsSync(ownedProtected), false);
  assert.equal(fs.existsSync(otherRunFixture), true);
  assert.equal(fs.existsSync(nearMatch), true);
  assert.equal(fs.existsSync(outsideSentinel), true);
});

test("content context e2e binds the approved fixture to the selected real textbook", () => {
  const source = fs.readFileSync(new URL("./content-context-e2e.mjs", import.meta.url), "utf8");
  assert.match(source, /textbookAssetId:\s*e2eTextbook\?\.id/);
});
