import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { gradingQuestionReviewState, gradingSourceScoreGroups } from "./grading-review-gates.js";
import { externalRecognitionArchiveBlockers } from "./external-grading-recognition.js";

// Execute the actual legacy projection/query functions without starting a server
// or touching student records. Only record hydration is replaced by a fixture.
const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
const declaration = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\napp.get(", start));
};
const { mapGradingWorkbench, gradingWorkbenchMatchesQuery } = new Function("deps", `
  const { gradingQuestionReviewState, gradingSourceScoreGroups, externalRecognitionArchiveBlockers } = deps;
  const mapReviewSubmission = row => row;
  const gradingWorkbenchArchivedSnapshot = () => null;
  const gradingArchivePublishedAt = row => row.archivedAt || null;
  const hydrateQuestionDraftsFromOcr = questions => questions;
  const normalizeQuestionWorkbenchItem = question => question;
  const gradingSourcePackageForAssignment = () => null;
  const projectArchivedGradingQuestion = question => question;
  ${declaration("mapGradingWorkbench")}
  ${declaration("gradingWorkbenchMatchesQuery")}
  return { mapGradingWorkbench, gradingWorkbenchMatchesQuery };
`)({ gradingQuestionReviewState, gradingSourceScoreGroups, externalRecognitionArchiveBlockers });

const reviewed = () => ({ id: "q1", questionNo: "1", status: "correct", score: 5, maxScore: 5, reviewedByTeacher: true });
const row = () => ({ id: "s1", needsReview: true, archivedAt: null,
  imageFiles: [{ url: "/uploads/fixture.png" }], ocr: { status: "DONE", imageQuality: { pages: [{ qualityStatus: "ready" }] } },
  structuredGrading: { needsTeacherReview: true, archiveEligible: false, answerSource: { status: "confirmed" }, quality: { lowConfidence: false }, questionResults: [reviewed()] } });

test("fully reviewed drafts can request independent archive despite pre-archive flags", () => {
  const input = row(), before = structuredClone(input);
  const item = mapGradingWorkbench(input);
  assert.equal(item.archiveEligible, false);
  assert.equal(item.needsTeacherReview, true);
  assert.equal(item.questionReviewReady, true);
  assert.equal(item.canArchive, true);
  assert.equal(item.archivedAt, null);
  assert.equal(item.reviewedQuestionScore, 5);
  assert.equal(gradingWorkbenchMatchesQuery(item, { queueState: "ready" }), true);
  assert.equal(gradingWorkbenchMatchesQuery(item, { queueState: "low_confidence" }), false);
  assert.deepEqual(input, before);
});

test("evidence blockers, unreviewed questions and completed archives stay out of the ready queue", () => {
  for (const mutate of [
    r => { r.structuredGrading.answerSource = null; },
    r => { r.ocr.imageQuality.pages[0].qualityStatus = "needs_review"; },
    r => { r.structuredGrading.questionResults[0].reviewedByTeacher = false; },
    r => { r.structuredGrading.questionResults = []; },
    r => { r.archivedAt = "2026-11-07T08:00:00.000Z"; r.needsReview = false; }
  ]) {
    const input = row(); mutate(input);
    const item = mapGradingWorkbench(input);
    assert.equal(item.canArchive, false);
    assert.equal(gradingWorkbenchMatchesQuery(item, { queueState: "ready" }), false);
  }
  const input = row(); input.structuredGrading.quality.lowConfidence = true;
  assert.equal(gradingWorkbenchMatchesQuery(mapGradingWorkbench(input), { queueState: "low_confidence" }), true);
});
