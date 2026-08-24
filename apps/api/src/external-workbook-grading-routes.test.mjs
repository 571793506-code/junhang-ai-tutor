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

test("external workbook upload accepts answer source metadata and initializes recognition packet", () => {
  const route = multilineRouteSource("/api/submissions/grade");
  assert.match(route, /materialType/);
  assert.match(route, /answerSourceMode/);
  assert.match(route, /answerKeyText/);
  assert.match(route, /referenceSourceId/);
  assert.match(source, /externalGradingRecognition/);
  assert.match(source, /EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION/);
});

test("external recognition response exposes pages, answer source and archive eligibility", () => {
  const recognizeRoute = routeSource('post("/api/review/submissions/:submissionId/recognize"');
  assert.match(recognizeRoute, /recognition/);
  assert.match(source, /answerSource/);
  assert.match(source, /archiveEligible/);
  assert.match(source, /archiveBlockers/);
});

test("generated assignment grading keeps source package path separate from external workbook path", () => {
  assert.match(source, /gradingSourcePackageForAssignment/);
  assert.match(source, /materialType.*external_workbook/);
  assert.match(source, /assignmentId/);
});
