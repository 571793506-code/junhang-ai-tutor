import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildContentContextE2eVerificationMeta,
  isDirectContentContextE2eRun
} from "./content-context-e2e.mjs";

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
    "bounded-assessment-draft-return",
    "teacher-review-gate",
    "draft-and-final-pdf-export"
  ]);
});

test("content context e2e detects direct script execution on Windows paths", () => {
  const scriptPath = fileURLToPath(new URL("./content-context-e2e.mjs", import.meta.url));
  const scriptUrl = pathToFileURL(scriptPath).href;

  assert.equal(isDirectContentContextE2eRun(scriptUrl, scriptPath), true);
  assert.equal(isDirectContentContextE2eRun(scriptUrl, undefined), false);
  assert.equal(isDirectContentContextE2eRun(scriptUrl, process.execPath), false);
});
