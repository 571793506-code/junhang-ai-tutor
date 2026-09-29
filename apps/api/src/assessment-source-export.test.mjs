import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { buildGradingSourcePackage, gradingSourcePackageToAssignmentItems, gradingSourceQuestionMap } from "@junhang/core/grading-source-package";
import { gradingSourcePackageForAssignment, gradingSourceReference } from "./submission-grade-input.js";

// Load the real pure render functions without starting the API or database.
const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const names = ["renderStudentItem", "renderReadingPassage", "assessmentPrintPlan", "buildQuestionLayoutManifest", "answerAnalysisHtml"];
const functions = names.map((name) => {
  const start = server.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = server.indexOf("\n}\n", start);
  assert.ok(end > start);
  return server.slice(start, end + 2);
}).join("\n");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const render = vm.runInNewContext(`${functions}\n({${names.join(",")}})`, {
  safeJson: (v, fallback) => v && typeof v === "object" ? v : fallback,
  escapeHtml, readableText: (v, fallback = "") => v == null ? fallback : String(v), readableKind: (v, fallback) => v || fallback,
  printableItemType: (item) => item.itemType, answerSpaceMm: () => 10, renderAnswerSpace: () => '<div class="answer-space"></div>',
  renderPrintableFigure: () => "", sectionTitleForItem: () => "阅读", questionScoreText: () => "（5分）",
  gradingSourcePackageForAssignment, gradingSourceReference, gradingSourceQuestionMap,
  splitSequentialPages: (items) => [{ pageIndex: 0, items: items.map((item, index) => ({ item, number: index + 1, estimatedHeightPx: 50 })) }],
  formatPrintableValue: (v) => String(v ?? ""), optionalNumber: (v) => v == null ? null : Number(v),
  printableAnalysisSteps: () => [], itemAnswerForManifest: () => "", questionScoreNumber: (item) => item.metadata.score
});

test("student HTML, answer HTML and layout manifest agree on imported source question numbers", () => {
  const context = { itemType: "reading", sharedMaterial: { id: "m1", title: "阅读", text: "小明帮助了同学。" }, options: ["关心同学", "不关心同学"] };
  const source = buildGradingSourcePackage({ id: "a1", title: "导入阅读", metadata: { subject: "语文", kind: "练习" }, items: [{
    orderIndex: '2-1<script>', prompt: "小明有什么品质？", answer: "独立答案标记", score: 5, analysisSteps: ["从行为分析人物。"], sourceContext: context
  }] }).package;
  const items = gradingSourcePackageToAssignmentItems(source).map((q, i) => ({ ...q, id: `i${i}`, orderIndex: i + 1 }));
  const assignment = { id: "a1", title: "导入阅读", metadata: { subject: "语文", kind: "练习", gradingSourcePackage: source }, items };
  const studentHtml = render.renderStudentItem({ item: items[0], number: 1, showSection: true, subject: "语文" });
  assert.match(studentHtml, /data-question-no="2-1&lt;script&gt;"/);
  assert.match(studentHtml, /小明帮助了同学/);
  assert.match(studentHtml, /关心同学/);
  assert.doesNotMatch(studentHtml, /独立答案标记|<script>/);
  const answerHtml = render.answerAnalysisHtml(assignment);
  assert.match(answerHtml, /2-1&lt;script&gt;\./);
  assert.match(answerHtml, /独立答案标记/);
  const manifest = render.buildQuestionLayoutManifest(assignment);
  assert.equal(manifest.questions[0].questionNo, source.questions[0].questionNo);
  assert.equal(manifest.questions[0].answer, "独立答案标记");
  assert.deepEqual(manifest.questions[0].context, source.questions[0].context);
  assert.equal(manifest.gradingSource.fingerprint, source.fingerprint);
});
