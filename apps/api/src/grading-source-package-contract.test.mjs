import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

function functionSource(name, nextMarker) {
  const start = source.indexOf(`function ${name}`) >= 0
    ? source.indexOf(`function ${name}`)
    : source.indexOf(`async function ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.ok(end > start, `${name} end marker must exist`);
  return source.slice(start, end);
}

test("linked grading prefers the persisted grading source package over mutable assignment fields", () => {
  const gradeInput = functionSource("buildSubmissionGradeInputFromRecord", "\nfunction queuedSubmissionResult");

  assert.match(source, /GRADING_SOURCE_PACKAGE_SCHEMA_VERSION/);
  assert.match(gradeInput, /gradingSourcePackageForAssignment\(assignment\)/);
  assert.match(gradeInput, /const authoritativeSourcePackage = gradingSourcePackage \|\| importedSourcePackage/);
  assert.match(gradeInput, /dialogueAnswerPackage && validateGradingSourcePackage\(dialogueAnswerPackage\)\.ok/);
  assert.match(gradeInput, /authoritativeSourcePackage\.questions\.map/);
  assert.match(gradeInput, /answer:\s*question\.correctAnswer/);
  assert.match(gradeInput, /score:\s*question\.maxScore/);
  assert.match(gradeInput, /gradingSource:\s*gradingSourceReference\(authoritativeSourcePackage\)/);
});

test("student paper, analysis paper, and layout manifest retain the same source reference", () => {
  const manifest = functionSource("buildQuestionLayoutManifest", "\nasync function findLatestQuestionLayoutManifest");
  const analysis = functionSource("answerAnalysisHtml", "\nfunction findPrintBrowser");
  const exportPaper = functionSource("exportAssessmentPaperAsset", "\nasync function exportAssessmentDraftForReview");
  const printRouteStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  const printRouteEnd = source.indexOf("\napp.", printRouteStart + 1);
  const printRoute = source.slice(printRouteStart, printRouteEnd === -1 ? source.length : printRouteEnd);

  assert.match(manifest, /gradingSource:\s*gradingSourceReference\(gradingSourcePackage\)/);
  assert.match(manifest, /sourceQuestion\.correctAnswer/);
  assert.match(analysis, /sourceQuestion\.correctAnswer/);
  assert.match(exportPaper, /gradingSource,\n\s*htmlUrl/);
  assert.match(printRoute, /role: "answer-analysis",[\s\S]*gradingSource,/);
});
