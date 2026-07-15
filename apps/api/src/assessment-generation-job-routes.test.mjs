import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

function routeSource(path) {
  const start = source.indexOf(`app.${path}`);
  const end = source.indexOf("\napp.", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("assessment generation jobs validate before queueing and keep draft export review-gated", () => {
  assert.match(source, /createAssessmentGenerationJobs/);
  assert.match(source, /async function prepareAssessmentDraftInput/);
  assert.match(source, /async function exportAssessmentDraftForReview/);

  const createRoute = routeSource('post("/api/assessments/generation-jobs"');
  assert.match(createRoute, /requireDatabase/);
  assert.match(createRoute, /requireSession\(config, \["teacher"\]\)/);
  assert.match(createRoute, /prepareAssessmentDraftInput\(req\)/);
  assert.match(createRoute, /assessmentGenerationJobs\.enqueue/);
  assert.match(createRoute, /draftAssessmentService\(config, input, \{ \.\.\.options, signal \}\)/);
  assert.match(createRoute, /exportAssessmentDraftForReview\(req, assignment, \{ signal \}\)/);
  assert.match(createRoute, /createAssignment:\s*true/);

  const listRoute = routeSource('get("/api/assessments/generation-jobs"');
  assert.match(listRoute, /assessmentGenerationJobs\.list\(sessionTeacherId\(req\)\)/);

  const cancelRoute = routeSource('post("/api/assessments/generation-jobs/:jobId/cancel"');
  assert.match(cancelRoute, /assessmentGenerationJobs\.cancel\(sessionTeacherId\(req\), req\.params\.jobId\)/);
});

test("production assessment queue runs up to five independent teacher jobs", () => {
  assert.match(source, /createAssessmentGenerationJobs\(\{ concurrency:\s*5 \}\)/);
});

test("textbook recovery repairs evidence without auto-approving it", () => {
  const recoveryRoute = routeSource('post("/api/assessments/generation-recovery"');
  const recoveryStart = source.indexOf("async function recoverAssessmentGenerationContext");
  const recoveryEnd = source.indexOf("\nasync function discardAssessmentGenerationJob", recoveryStart);
  const recoverySource = source.slice(recoveryStart, recoveryEnd);

  assert.match(recoveryRoute, /recoverAssessmentGenerationContext/);
  assert.match(recoverySource, /status: prepared\.ok \? "ready" : "review_required"/);
  assert.match(recoverySource, /temporaryDraftAllowed: !prepared\.ok/);
  assert.match(recoverySource, /syncContentIndexToKnowledgeLibrary/);
  assert.doesNotMatch(recoverySource, /allowedForGeneration:\s*true/);
});

test("cancelled assessment jobs do not persist draft review assets after local rendering", () => {
  const exportStart = source.indexOf("async function exportAssessmentPaperAsset");
  const exportEnd = source.indexOf("\n}\n\nfunction normalizeReviewResultForDisplay", exportStart) + 2;
  const exportSource = source.slice(exportStart, exportEnd);

  assert.match(exportSource, /throwIfAssessmentGenerationCancelled\(options\.signal\)/);
  assert.match(exportSource, /prisma\.generatedAsset\.create/);
  assert.ok(exportSource.indexOf("throwIfAssessmentGenerationCancelled(options.signal)") < exportSource.indexOf("prisma.generatedAsset.create"));
});

test("teacher assignment records expose draft and completed export links", () => {
  const mapStart = source.indexOf("function mapAssignment");
  const mapEnd = source.indexOf("\n}\n\nfunction mapTextbookAsset", mapStart) + 2;
  const mapSource = source.slice(mapStart, mapEnd);

  assert.match(mapSource, /draftReviewAsset:/);
  assert.match(mapSource, /finalExportAssets:/);
  assert.match(mapSource, /studentPaper/);
  assert.match(mapSource, /answerAnalysis/);
});
