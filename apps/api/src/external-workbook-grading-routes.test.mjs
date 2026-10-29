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

test("generated upload rejects missing assignment source and validates its scope", () => {
  const route = multilineRouteSource("/api/submissions/grade");
  assert.match(route, /GENERATED_ASSIGNMENT_REQUIRED/);
  assert.match(route, /ASSIGNMENT_NOT_FOUND/);
  assert.match(route, /assertAssignmentStudentScope/);
  assert.match(source, /ASSIGNMENT_STUDENT_MISMATCH/);
  assert.match(source, /ASSIGNMENT_GRADE_MISMATCH/);
  assert.match(route, /ASSIGNMENT_TEACHER_SCOPE_MISMATCH/);
});

test("dialogue answer package regrade keeps the original package identity and uses the normalized source", () => {
  const route = routeSource('patch("/api/grading/workbench/:submissionId/dialogue-answer-package"');
  assert.match(route, /normalizeImportedGradingSourcePackage/);
  assert.match(route, /originalFingerprint/);
  assert.match(route, /dialogueAnswerPackage/);
  assert.match(route, /recognizeAndGradeSubmissionRecord/);
});

test("dialogue answer package has a database registration route for shared Assignment sources", () => {
  const route = routeSource('post("/api/grading/source-packages/dialogue"');
  assert.match(route, /normalizeImportedGradingSourcePackage/);
  assert.match(route, /createAssignmentDraft/);
  assert.match(route, /gradingSourcePackageRequested/);
  assert.match(route, /dialogue-import/);
  assert.match(route, /register-dialogue-answer-package/);
});

test("submission regrading prefers the canonical Assignment source package", () => {
  const helper = source.slice(source.indexOf("async function buildSubmissionGradeInputFromRecord"), source.indexOf("function queuedSubmissionResult"));
  assert.match(helper, /return buildSubmissionGradeInput\(submission, recognition/);
  const sharedHelper = fs.readFileSync(new URL("./submission-grade-input.js", import.meta.url), "utf8");
  assert.match(sharedHelper, /const authoritativeSourcePackage = gradingSourcePackage \|\| importedSourcePackage/);
});

test("dialogue grading result import is normalized into teacher-review questions", () => {
  const route = routeSource('patch("/api/grading/workbench/:submissionId/dialogue-answer-package"');
  assert.match(route, /normalizeImportedDialogueGradingResult/);
  assert.match(route, /dialogueGradingResult/);
  assert.match(route, /grading-result/);
});

test("external workbench exposes packet blockers and supports explicit answer source confirmation", () => {
  const patchRoute = routeSource('patch("/api/grading/workbench/:submissionId/questions/:questionId"');
  assert.match(source, /recognitionPacket/);
  assert.match(source, /archiveBlockers/);
  assert.match(patchRoute, /mergeExternalQuestionTeacherReview/);
  assert.match(source, /\/api\/grading\/workbench\/:submissionId\/answer-source/);
});
