import assert from "node:assert/strict";
import test from "node:test";
import { buildPythonExtractorEnv, evaluateGenerationLayoutPdf } from "./generation-layout-check.mjs";

test("layout checker forces Python PDF extraction to emit UTF-8 on Windows", () => {
  assert.equal(buildPythonExtractorEnv({}).PYTHONIOENCODING, "utf-8");
  assert.equal(buildPythonExtractorEnv({}).PYTHONUTF8, "1");
});

test("layout check infers subject and kind from file name before explanatory body text", () => {
  const englishQuiz = evaluateGenerationLayoutPdf({
    name: "五年级英语第四单元小测-题目.pdf",
    pages: 3,
    text: "小测围绕教材单元生成，不套用完整试卷结构。",
    pageMetrics: []
  });
  const mathPractice = evaluateGenerationLayoutPdf({
    name: "数学练习-题目.pdf",
    pages: 2,
    text: "数学 · 小测和练习不设置作文题。English token in an unrelated note.",
    pageMetrics: []
  });

  assert.equal(englishQuiz.detail.kind, "小测");
  assert.equal(englishQuiz.detail.targetPages, 2);
  assert.equal(mathPractice.detail.subject, "数学");
  assert.equal(mathPractice.detail.kind, "练习");
});

test("layout check rejects quiz PDF when real pages exceed the target and header total is stale", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "五年级英语第四单元小测-题目.pdf",
    pages: 3,
    text: "五年级英语第四单元小测\n小测 · A4 · 第1/2页\n小测 · A4 · 第2/2页",
    pageMetrics: [
      { page: 1, bottomBlankMm: 71.1, drawingCount: 4 },
      { page: 2, bottomBlankMm: 218.5, drawingCount: 12 },
      { page: 3, bottomBlankMm: 124.0, drawingCount: 2 }
    ]
  });

  assert.equal(check.ok, false);
  assert.ok(check.issues.includes("题目 PDF 实际页数 3 与目标 2 不一致。"));
  assert.ok(check.issues.includes("页眉总页数 2 与真实页数 3 不一致。"));
  assert.ok(check.issues.includes("第 2 页后续仍有内容，但本页底部留白 218.5mm，疑似预分页和真实分页脱节。"));
});

test("layout check rejects English quiz when it uses exam-style cloze patterns", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "英语小测-题目.pdf",
    pages: 2,
    text: "六年级英语小测排版稿\n二、词汇运用\n完形填空\nPassage C: The Map Under the Desk",
    pageMetrics: [
      { page: 1, bottomBlankMm: 23.5, drawingCount: 3 },
      { page: 2, bottomBlankMm: 98.3, drawingCount: 2 }
    ]
  });

  assert.equal(check.ok, false);
  assert.ok(check.issues.includes("英语小测/练习不得出现试卷式文章选词填空、完形填空或短文语法填空。"));
  assert.ok(check.issues.includes("英语小测缺少中英文互译、写单词、造句题型信号。"));
});

test("layout check accepts a dense two-page math quiz", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学小测-题目.pdf",
    pages: 2,
    text: "六年级数学小测排版稿\n小测 · A4 · 第1/2页\n小测 · A4 · 第2/2页\n一、填空题\n三、计算题\n四、解答题",
    pageMetrics: [
      { page: 1, bottomBlankMm: 42.5, drawingCount: 8 },
      { page: 2, bottomBlankMm: 54.7, drawingCount: 10 }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});
