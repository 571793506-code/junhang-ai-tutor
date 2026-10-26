import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { normalizeDisplayText } from "@junhang/core";
import { gradingSourceQuestionMap } from "@junhang/core/grading-source-package";
import { gradingSourcePackageForAssignment, gradingSourceReference } from "./submission-grade-input.js";
import { assessmentPageBalanceFillRatio, buildAssessmentLayoutValidation } from "./assessment-layout-validation.js";
import { createTeachingWorkflowValidator } from "../../../packages/services/src/teaching-workflow-validation.js";
import { gradingSourcePackageToAssignmentItems } from "@junhang/core";

const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const declaration = (name) => { const start = server.indexOf(`function ${name}(`); return server.slice(start, server.indexOf("\n}\n", start) + 2); };
const printFunctions = server.slice(server.indexOf("function escapeHtml("), server.indexOf("function findPrintBrowser("));
const render = vm.runInNewContext(`${declaration("readableText")}\n${declaration("readableKind")}\n${printFunctions}\n({printableAssignmentHtml,buildQuestionLayoutManifest,answerAnalysisHtml})`, {
  normalizeDisplayText, assessmentPageBalanceFillRatio, gradingSourcePackageForAssignment, gradingSourceReference, gradingSourceQuestionMap,
  safeJson: (v, fallback) => v && typeof v === "object" ? v : fallback, optionalNumber: (v) => v == null ? null : Number(v)
});
function assignment(purpose, count = 4) {
  return { id: "print-test", title: "四年级数学练习", metadata: { purpose, subject: "数学", kind: "练习", printProfile: { pages: 2 }, dayPlan: [{ dayId: "d1", goal: "进位加法" }, { dayId: "d2", goal: "退位减法" }] },
    items: Array.from({ length: count }, (_, i) => ({ id: `q${i+1}`, orderIndex: i+1, itemType: "calculation", prompt: `用竖式计算：${236+i}+178`, answer: "教师答案标记",
      metadata: { score: 5, sourceContext: purpose === "multi_day" ? { day: { dayId: i < count/2 ? "d1" : "d2", goal: i < count/2 ? "进位加法" : "退位减法" } } : {} } })) };
}
test("focused content uses real pages and enough vertical calculation space without a duplex filler", () => {
  const input = assignment("focused");
  const html = render.printableAssignmentHtml(input);
  assert.equal((html.match(/<section class="page">/g) || []).length, 1);
  assert.doesNotMatch(html, /第1\/1页/);
  assert.equal((html.match(/min-height:102mm/g) || []).length, 4);
  assert.doesNotMatch(html, /本页留白|教师答案标记/);
  const manifest = render.buildQuestionLayoutManifest(input);
  assert.equal(manifest.pageCount, 1);
  assert.deepEqual(Array.from(manifest.questions, (question) => question.answerSpace.estimatedMm), [102, 102, 102, 102]);
  assert.ok(manifest.questions[2].bbox.y > manifest.questions[0].bbox.y);
});
test("multi-day source goals reach both papers and pagination does not lose questions", () => {
  const input = assignment("multi_day");
  const before = structuredClone(input);
  const html = render.printableAssignmentHtml(input);
  assert.match(html, /第1天：进位加法/);
  assert.match(html, /第2天：退位减法/);
  assert.match(render.answerAnalysisHtml(input), /第2天：退位减法/);
  assert.equal((html.match(/data-question-no=/g) || []).length, 4);
  assert.deepEqual(input, before);
  const many = assignment("multi_day", 20);
  const manifest = render.buildQuestionLayoutManifest(many);
  assert.ok(manifest.pageCount > 2);
  assert.equal(manifest.questions.length, 20);
  assert.equal(new Set(manifest.questions.map((q) => q.questionNo)).size, 20);
});
test("comprehensive default pagination remains fixed", () => {
  const html = render.printableAssignmentHtml(assignment("comprehensive"));
  assert.equal((html.match(/<section class="page">/g) || []).length, 2);
});

test("printed section numbers follow actual order across pages without changing source titles", () => {
  const draft = assignment("comprehensive", 20);
  draft.metadata.subject = "英语";
  draft.metadata.kind = "小测";
  draft.items.forEach((q, i) => {
    q.itemType = i < 8 ? "fill" : i < 10 ? "solution" : i < 14 ? "choice" : "reading";
    q.prompt = `Question ${i + 1}`;
    q.metadata.answerFormat = i < 10 ? "english-four-line" : null;
    if (i >= 10) q.metadata.options = ["A. one", "B. two", "C. three", "D. four"];
    if (i >= 8 && i < 10) q.metadata.sectionTitle = "四、句子翻译";
  });
  const before = structuredClone(draft);
  const html = render.printableAssignmentHtml(draft);
  const headings = [...html.matchAll(/<h2 class="section-title">([^<]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(headings, ["一、填空题", "二、句子翻译", "三、选择题", "四、阅读理解"]);
  assert.equal((html.match(/data-question-no=/g) || []).length, 20);
  assert.equal((html.match(/<section class="page">/g) || []).length, 2);
  assert.deepEqual(draft, before);
});

test("Chinese writingLines survive the source package and reserve matching blank writing space", async () => {
  const input = { title: "语文病句专项", subject: "语文", grade: "四年级", kind: "练习", purpose: "focused", questions: [{
    id: "q1", questionNo: "1", itemType: "solution", prompt: "参加这次跳绳比赛的同学全部到齐了，只有小林还没有到。", answer: "教师答案标记", score: 5,
    rubric: "正确得5分。", analysisSteps: ["前后矛盾。"], knowledgePoint: "修改病句", commonMistake: "保留原意。",
    answerFormat: { type: "writingLines", lineCount: 2, prefilledText: "教师答案标记" }
  }] };
  const checked = await createTeachingWorkflowValidator()(input, { module: "generation", workflow: { id: "chinese-lines" }, nextRevision: 2 });
  assert.equal(checked.ok, true);
  const draft = { id: "chinese-lines", title: input.title, metadata: { subject: "语文", kind: "练习", purpose: "focused", gradingSourcePackage: checked.snapshot.gradingSourcePackage },
    items: gradingSourcePackageToAssignmentItems(checked.snapshot.gradingSourcePackage) };
  const before = structuredClone(draft);
  const html = render.printableAssignmentHtml(draft);
  assert.match(html, /<div class="ruled-lines"><span><\/span><span><\/span><\/div>/);
  assert.doesNotMatch(html, /教师答案标记|前后矛盾/);
  assert.equal(render.buildQuestionLayoutManifest(draft).pageCount, 1);
  assert.deepEqual(draft, before);
});

test("writing line limits and pagination handle large or invalid model counts without expanding other answer types", () => {
  const make = (lineCount, count = 1) => {
    const draft = assignment("focused", count);
    draft.metadata.subject = "语文";
    for (const item of draft.items) { item.itemType = "solution"; item.metadata.answerFormat = { type: "writingLines", lineCount }; }
    return draft;
  };
  const countLines = (draft) => [...render.printableAssignmentHtml(draft).matchAll(/<div class="ruled-lines">(.*?)<\/div>/g)]
    .reduce((n, m) => n + (m[1].match(/<span><\/span>/g) || []).length, 0);
  assert.equal(countLines(make(3)), 3);
  assert.equal(countLines(make(1000000)), 8);
  for (const invalid of [0, -1, 1.5, "3", NaN, Infinity, null]) assert.equal(countLines(make(invalid)), 2);
  const dense = make(8, 12);
  assert.ok(render.buildQuestionLayoutManifest(dense).pageCount > render.buildQuestionLayoutManifest(make(2, 12)).pageCount);
  assert.equal(render.buildQuestionLayoutManifest(dense).questions.length, 12);
  const choice = make(3); choice.items[0].itemType = "choice"; choice.items[0].metadata.options = ["A. 甲", "B. 乙"];
  assert.equal(countLines(choice), 0);
  const math = make(3); math.metadata.subject = "数学";
  assert.equal(countLines(math), 0);
});

test("focused and daily subtitles use actual question counts instead of comprehensive guidance", () => {
  const guidance = "包含词汇巩固、句型表达、易错选择和短阅读";
  for (const purpose of ["focused", "multi_day"]) {
    const draft = assignment(purpose);
    draft.metadata.printProfile.answerSpace = guidance;
    const html = render.printableAssignmentHtml(draft);
    if (purpose === "focused") assert.doesNotMatch(html, /<div class="subtitle">/);
    else assert.match(html, /<div class="subtitle">数学 · 共4题<\/div>/);
    assert.doesNotMatch(html, new RegExp(guidance));
  }
  const full = assignment("comprehensive"); full.metadata.printProfile.answerSpace = guidance;
  assert.match(render.printableAssignmentHtml(full), new RegExp(guidance));
});

test("calculation-only focused student sheets contain one title, expressions and work spaces without review clutter", () => {
  const draft = assignment("focused");
  draft.title = "四年级数学脱式计算练习（待教师复核稿）";
  draft.items.forEach((q, i) => { q.prompt = `用脱式计算，写出每一步计算。\n${57 + i}×4－（100＋28）`; });
  draft.items[0].rubric = "过程4分，结果1分。";
  const before = structuredClone(draft);
  const html = render.printableAssignmentHtml(draft, { badgeText: "仅供排版检查" });
  const body = html.slice(html.indexOf("<body"));
  assert.equal((body.match(/<h1/g) || []).length, 1);
  assert.match(body, /<h1>四年级数学脱式计算练习<\/h1>/);
  assert.doesNotMatch(body, /待教师|仅供排版|AI生成|class="score"|class="meta"|section-title|用脱式计算|写出每一步|姓名|得分|共4题/);
  assert.equal((body.match(/class="calculation-space"/g) || []).length, 4);
  for (let i = 0; i < 4; i++) assert.ok(body.includes(`${57 + i}×4－（100＋28）`));
  assert.deepEqual(draft, before);
  const analysis = render.answerAnalysisHtml(draft);
  assert.match(analysis, /教师答案标记/);
  assert.match(analysis, /评分标准/);
  assert.match(analysis, /过程4分，结果1分/);
  assert.equal(render.buildQuestionLayoutManifest(draft).questions.length, 4);
});

test("compact calculation printing preserves method constraints and mixed-paper structure", () => {
  const draft = assignment("focused");
  draft.items[0].prompt = "用简便方法计算：25×4×17";
  assert.match(render.printableAssignmentHtml(draft), /用简便方法计算/);
  draft.items[1].itemType = "solution";
  assert.match(render.printableAssignmentHtml(draft), /<div class="meta">/);
  const many = assignment("focused", 20);
  const html = render.printableAssignmentHtml(many);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.equal((html.match(/data-question-no=/g) || []).length, 20);
  assert.ok(render.buildQuestionLayoutManifest(many).pageCount > 1);
});

test("calculation reference layout packs paired rows and preserves enlarged writing space", () => {
  const draft = assignment("focused", 20);
  const manifest = render.buildQuestionLayoutManifest(draft);
  assert.equal(manifest.pageCount, 3);
  assert.deepEqual(Array.from(manifest.questions, (q) => q.page), Array.from({ length: 20 }, (_, i) => i < 8 ? 1 : i < 14 ? 2 : 3));
  assert.equal(manifest.questions[0].bbox.y, manifest.questions[1].bbox.y);
  assert.ok(manifest.questions[0].bbox.x + manifest.questions[0].bbox.w < manifest.questions[1].bbox.x);
  assert.ok(manifest.questions[2].bbox.y > manifest.questions[0].bbox.y);
  draft.items.forEach((q) => { q.prompt = "用脱式计算，写出每一步计算。\n900－（144÷9＋58）×7"; });
  assert.equal(render.buildQuestionLayoutManifest(draft).pageCount, 3);
  const html = render.printableAssignmentHtml(draft);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  draft.items.forEach((q) => { q.metadata.answerSpaceMm = 64; });
  assert.ok(render.buildQuestionLayoutManifest(draft).pageCount > 3);
  assert.equal(render.buildQuestionLayoutManifest(draft).questions.length, 20);
});

test("restored English grid metadata survives source-package conversion into actual four-line HTML", async () => {
  const input = { title: "英语专项", subject: "英语", grade: "四年级", kind: "练习", purpose: "focused", questions: [{
    id: "q1", questionNo: "1", itemType: "fill", prompt: "教室", answer: "classroom", score: 5,
    rubric: "正确得5分。", analysisSteps: ["classroom表示教室。"], knowledgePoint: "学校词汇", commonMistake: "注意双写。",
    answerFormat: { type: "english_four_line_grid", position: "below_prompt", prefilledText: "classroom" }
  }] };
  const checked = await createTeachingWorkflowValidator()(input, { module: "generation", workflow: { id: "grid-recheck" }, nextRevision: 2 });
  assert.equal(checked.ok, true);
  assert.equal(checked.snapshot.questions[0].answerFormat, "english-four-line");
  assert.equal(input.questions[0].answerFormat.type, "english_four_line_grid");
  const pkg = checked.snapshot.gradingSourcePackage;
  const html = render.printableAssignmentHtml({ id: pkg.sourceId, title: input.title,
    metadata: { subject: "英语", kind: "练习", purpose: "focused", gradingSourcePackage: pkg },
    items: gradingSourcePackageToAssignmentItems(pkg).map((q, i) => ({ ...q, id: `q${i+1}`, orderIndex: i+1 })) });
  assert.match(html, /<div class="english-four-line">/);
  assert.doesNotMatch(html, /classroom/);
});

test("export adapter keeps compact page totals and blocks a real-page mismatch before saving the asset", async () => {
  const start = server.indexOf("async function exportAssessmentPaperAsset(");
  const exportSource = server.slice(start, server.indexOf("\n}\n", start) + 2);
  let html = "";
  let saved = 0;
  let pdfPages = 1;
  const adapter = vm.runInNewContext(`${declaration("readableText")}\n${declaration("readableKind")}\n${printFunctions}\n${exportSource}\n(exportAssessmentPaperAsset)`, {
    normalizeDisplayText, assessmentPageBalanceFillRatio, buildAssessmentLayoutValidation, gradingSourcePackageForAssignment, gradingSourceReference, gradingSourceQuestionMap, path,
    safeJson: (v, fallback) => v && typeof v === "object" ? v : fallback, optionalNumber: (v) => v == null ? null : Number(v),
    normalizeGeneratedHtml: (v) => v, storageGeneratedRoot: () => "preview-only", publicGeneratedUrl: (name) => `/preview/${name}`,
    fs: { mkdirSync() {}, writeFileSync(_path, text) { html = text; } },
    measureQuestionLayoutFromHtml: async () => ({ ok: true, pageCount: (html.match(/<section class="page">/g) || []).length, questions: [], pageMetrics: [{ bottomBlankMm: 80 }] }),
    renderPdfFromHtml: async () => ({ ok: true }), countPdfPages: () => pdfPages,
    throwIfAssessmentGenerationCancelled() {}, prisma: { generatedAsset: { create: async ({ data }) => { saved++; return data; } } }
  });
  const good = await adapter({}, assignment("focused"), { requireValidLayout: true });
  assert.equal(good.htmlResult.pageCount, 1);
  assert.equal(good.htmlResult.addedBlankPage, false);
  assert.equal(good.layoutValidation.plannedPageCount, 1);
  assert.equal(good.asset.metadata.questionLayoutManifest.plannedPageCount, 1);
  assert.equal(saved, 1);
  pdfPages = 2;
  const overflow = await adapter({}, assignment("focused"), { requireValidLayout: true });
  assert.equal(overflow.asset, null);
  assert.equal(overflow.layoutValidation.ok, false);
  assert.equal(saved, 1);
});
