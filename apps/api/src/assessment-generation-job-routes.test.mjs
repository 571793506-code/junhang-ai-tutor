import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

function routeSource(path) {
  const start = source.indexOf(`app.${path}`);
  const end = source.indexOf("\napp.", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

function multilineRouteSource(path) {
  const pathStart = source.indexOf(`"${path}"`);
  const start = source.lastIndexOf("app.post(", pathStart);
  const end = source.indexOf("\napp.", pathStart + 1);
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

test("assessment routes normalize grade targets before validation and queueing", () => {
  assert.match(source, /import \{ normalizeAssessmentTargetScope \} from "\.\/assessment-target-scope\.js"/);
  assert.match(source, /function assessmentDraftInputFromRequest\(req\) \{\s*return normalizeAssessmentTargetScope/);
  assert.match(source, /"requestedItemCount", "contentScope"/);
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

test("teacher task and assessment creation reject disabled student targets", () => {
  assert.match(source, /async function assertTeacherActiveStudentTarget/);
  assert.match(source, /loginEnabled:\s*true/);
  assert.match(source, /enrollmentStatus:\s*\{ not: "WITHDRAWN" \}/);

  const teacherTaskRoute = routeSource('post("/api/teacher/tasks"');
  const assessmentDraftRoute = routeSource('post("/api/assessments/draft"');
  const assessmentJobRoute = routeSource('post("/api/assessments/generation-jobs"');

  assert.match(teacherTaskRoute, /assertTeacherActiveStudentTarget\(req, res, input\.studentId\)/);
  assert.match(assessmentDraftRoute, /assertTeacherActiveStudentTarget\(req, res, scopedInput\.studentId\)/);
  assert.match(assessmentJobRoute, /assertTeacherActiveStudentTarget\(req, res, scopedInput\.studentId\)/);
});

test("grading uploads reject students that cannot receive new work", () => {
  const gradeRoute = multilineRouteSource("/api/submissions/grade");
  const batchRoute = routeSource('post("/api/submissions/batches"');

  assert.match(gradeRoute, /assertStudentAvailableForNewWork\(req, res, input\.studentId\)/);
  assert.match(batchRoute, /assertStudentAvailableForNewWork\(req, res, input\.studentId\)/);
});

test("classroom bootstrap excludes disabled students from the selectable roster", () => {
  const bootstrapStart = source.indexOf('app.get("/api/bootstrap"');
  const bootstrapEnd = source.indexOf('\napp.', bootstrapStart + 1);
  const bootstrapSource = source.slice(bootstrapStart, bootstrapEnd === -1 ? source.length : bootstrapEnd);

  assert.match(bootstrapSource, /student\.loginEnabled/);
  assert.match(bootstrapSource, /student\.enrollmentStatus !== "WITHDRAWN"/);
});

test("bootstrap exposes one active-target contract for every client", () => {
  const mapStart = source.indexOf("function mapStudent");
  const mapEnd = source.indexOf("\n}\n\nfunction map", mapStart) + 2;
  const mapSource = source.slice(mapStart, mapEnd);

  assert.match(mapSource, /canReceiveNewWork:\s*student\.loginEnabled && student\.enrollmentStatus !== "WITHDRAWN"/);
});
