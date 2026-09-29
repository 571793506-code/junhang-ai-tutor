import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core/grading-source-package";
import { buildSubmissionGradeInputFromRecord } from "./submission-grade-input.js";

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

test("linked grading prefers the persisted grading source package over mutable assignment fields", async () => {
  const original = { id: "source-a", subject: { name: "数学" }, grade: "四年级", kind: "小测",
    items: [{ orderIndex: 1, prompt: "32×24", answer: "768", score: 5, rubric: "按结构、过程与结果综合判分。" }] };
  const registered = buildGradingSourcePackage(original).package;
  const imported = buildGradingSourcePackage({ ...original, items: [{ orderIndex: 1, prompt: "旧题", answer: "旧答案", score: 2 }] }).package;
  assert.ok(registered);
  assert.ok(imported);
  const submission = { assignmentId: original.id, assignment: { ...original,
    items: [{ orderIndex: 1, prompt: "变更题干", answer: "变更答案", score: 99 }],
    metadata: { gradingSourcePackage: registered } }, content: { dialogueAnswerPackage: imported } };
  const gradeInput = await buildSubmissionGradeInputFromRecord(submission);
  assert.deepEqual(gradeInput.gradingSourcePackage, registered);
  assert.deepEqual(gradeInput.assignmentItems.map(q => ({ questionNo: q.questionNo, prompt: q.prompt, answer: q.answer, score: q.score })),
    registered.questions.map(q => ({ questionNo: q.questionNo, prompt: q.prompt, answer: q.correctAnswer, score: q.maxScore })));
  assert.deepEqual(gradeInput.answerKey, { "1": "768" });
  assert.deepEqual(gradeInput.assignmentAnalysis.gradingSource, { sourceId: registered.sourceId, version: registered.version, fingerprint: registered.fingerprint });

  delete submission.assignment.metadata.gradingSourcePackage;
  assert.deepEqual((await buildSubmissionGradeInputFromRecord(submission)).gradingSourcePackage, imported);
  submission.content.dialogueAnswerPackage = structuredClone(imported);
  submission.content.dialogueAnswerPackage.questions[0].correctAnswer = "tampered";
  assert.equal((await buildSubmissionGradeInputFromRecord(submission)).gradingSourcePackage, null);
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
