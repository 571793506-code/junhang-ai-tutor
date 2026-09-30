import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildPythonExtractorEnv, evaluateGenerationLayoutPdf } from "./generation-layout-check.mjs";

const source = fs.readFileSync(new URL("./generation-layout-check.mjs", import.meta.url), "utf8");

test("plain math calculation worksheets need no decorative header but still reject empty pages", () => {
  const text = "四年级数学四则混合运算专项练习\n1. 57×4－128\n2. 620－（46＋79）×4";
  const base = { name: "focused-draft-review-student.pdf", text, pages: 1,
    pageMetrics: [{ text, bottomBlankMm: 70, drawingCount: 0 }] };
  assert.equal(evaluateGenerationLayoutPdf(base).ok, true);
  assert.equal(evaluateGenerationLayoutPdf(base).detail.purpose, "focused");
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pages: 2, pageMetrics: [...base.pageMetrics, { text: "", bottomBlankMm: 297 }] }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pages: 2 }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: text.replace("专项练习", "单元试卷") }).ok, false);
});

test("calculation titles without the subject label and full-width brackets retain focused layout checks", () => {
  const text = "四年级计算专项练习（验收稿）\n1. 48＋18×4\n2. （156－84）÷6\n3. 240÷（18＋12）＋7×6\n4. 360÷［（27－15）×3］＋48÷6－5";
  const base = { name: "workflow-print.pdf", text, pages: 1,
    pageMetrics: [{ text, bottomBlankMm: 33.5, drawingCount: 12 }] };
  const checked = evaluateGenerationLayoutPdf(base);
  assert.equal(checked.ok, true);
  assert.equal(checked.detail.purpose, "focused");
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pages: 2, pageMetrics: [...base.pageMetrics, { text: "", bottomBlankMm: 297 }] }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: text.replace("计算专项练习（验收稿）", "单元试卷") }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: text.replace("48＋18×4", "阅读下面的短文") }).ok, false);
});

test("purpose-specific pages can be compact but cannot hide a blank page or overflow", () => {
  const base = { name: "数学练习-draft-review-test.pdf", pages: 1, text: "专项练习 · A4 · 第1/1页\n1. 用竖式计算24+18", pageMetrics: [{ bottomBlankMm: 90, text: "用竖式计算", drawingCount: 0 }] };
  assert.equal(evaluateGenerationLayoutPdf(base).ok, true);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: base.text.replace("专项练习", "每日练习") }).ok, true);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, name: "英语小测-题目.pdf" }).ok, true);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: base.text.replace("专项练习", "练习") }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pages: 2 }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pageMetrics: [{ bottomBlankMm: 255, text: "留白页" }] }).ok, false);
});

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

test("layout check infers quiz from the rendered header before guidance mentioning exams", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "assignment-draft-review-123.pdf",
    pages: 3,
    text: [
      "AI生成 · 教师内容审查草稿",
      "四年级英语下册第三单元小测（Weather）",
      "英语 · 小测围绕教材单元生成，不套用完整试卷结构。",
      "小测 · A4 · 第1/2页"
    ].join("\n"),
    pageMetrics: []
  });

  assert.equal(check.detail.kind, "小测");
  assert.equal(check.detail.targetPages, 2);
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

test("layout check inspects draft-review and final print student PDFs", () => {
  for (const name of ["assignment-draft-review-123.pdf", "assignment-print.pdf"]) {
    const check = evaluateGenerationLayoutPdf({
      name,
      pages: 3,
      text: "四年级英语 Unit 3 Weather 小测\n小测 · A4 · 第1/2页\n一、词汇与短语\n二、句子运用",
      pageMetrics: [
        { page: 1, bottomBlankMm: 40, drawingCount: 8 },
        { page: 2, bottomBlankMm: 210, drawingCount: 2 },
        { page: 3, bottomBlankMm: 60, drawingCount: 8 }
      ]
    });

    assert.equal(check.detail.skipped, undefined, name);
    assert.equal(check.ok, false, name);
    assert.ok(check.issues.includes("题目 PDF 实际页数 3 与目标 2 不一致。"), name);
  }
});

test("layout PDF extractor includes draft-review and final print file names", () => {
  assert.match(source, /draft-review/);
  assert.match(source, /-print\.pdf/);
});

test("layout PDF extractor includes answer-line drawings in bottom blank measurement", () => {
  assert.match(source, /drawing_bottoms\s*=\s*\[\]/);
  assert.match(source, /content_bottom\s*=\s*max\(text_bottom, drawing_bottom\)/);
  assert.match(source, /float\(page\.rect\.height\) - content_bottom/);
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

test("layout check ignores template guidance text when scanning English short assessment patterns", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "英语练习-题目.pdf",
    pages: 2,
    text: [
      "五年级英语练习排版稿",
      "英语 · 练习围绕学生需求或教师指定薄弱点生成，包含词汇巩固、句型表达、易错选择和短阅读；不默认使用试卷式文章选词填空、完形填空、短文语法填空或写作。",
      "一、词汇巩固",
      "1. 根据中文写单词：日历 ______。",
      "二、句型表达",
      "2. 用 special day 造句。",
      "三、阅读巩固",
      "What does Amy do on special days?"
    ].join("\n"),
    pageMetrics: [
      { page: 1, bottomBlankMm: 92.1, drawingCount: 12 },
      { page: 2, bottomBlankMm: 91.3, drawingCount: 12 }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});

test("layout check does not treat guidance or option text as an English writing section", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "英语练习-题目.pdf",
    pages: 2,
    text: [
      "五年级英语练习排版稿",
      "英语 · 不默认使用试卷式文章选词填空、完形填空、短文语法填空或写作。",
      "三、易错选择题",
      "9. What did Mia want to improve? （　　　）",
      "A. English speaking",
      "B. Maths writing",
      "四、短阅读巩固"
    ].join("\n"),
    pageMetrics: [
      { page: 1, bottomBlankMm: 92.1, drawingCount: 12 },
      { page: 2, bottomBlankMm: 133.8, drawingCount: 5 }
    ]
  });

  assert.equal(check.ok, false);
  assert.ok(check.issues.includes("末页底部留白 133.8mm，疑似题量或作答区分配不足。"));
  assert.equal(check.issues.some((issue) => issue.includes("写作页")), false);
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

test("layout check allows intentional blank work space on math calculation pages", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学试卷-题目.pdf",
    pages: 4,
    text: "六年级数学试卷\n试卷 · A4 · 第1/4页\n试卷 · A4 · 第2/4页\n试卷 · A4 · 第3/4页\n试卷 · A4 · 第4/4页\n三、计算题\n四、解答题",
    pageMetrics: [
      { page: 1, bottomBlankMm: 70.2, drawingCount: 6, text: "一、填空题" },
      { page: 2, bottomBlankMm: 151.4, drawingCount: 7, text: "三、计算题\n21. 计算：12.5×0.32×8。" },
      { page: 3, bottomBlankMm: 146.3, drawingCount: 8, text: "三、计算题\n25. 计算：7/12+5/18-1/6。" },
      { page: 4, bottomBlankMm: 138.6, drawingCount: 9, text: "四、解答题" }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});

test("layout check allows intentional final math solution work space", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学练习-题目.pdf",
    pages: 2,
    text: "五年级数学练习\n练习 · A4 · 第1/2页\n练习 · A4 · 第2/2页\n三、计算题\n四、解决问题",
    pageMetrics: [
      { page: 1, bottomBlankMm: 96.8, drawingCount: 10, text: "三、计算题\n9. 解方程：x÷1.5 = 6.4。" },
      { page: 2, bottomBlankMm: 128.5, drawingCount: 10, text: "四、解决问题\n13. 如图，三角形 ABC 中，∠A=46°，∠B=∠C。" }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});

test("layout check allows final math exam page with labeled solution and bonus work areas", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学试卷-题目.pdf",
    pages: 4,
    text: "六年级数学试卷\n试卷 · A4 · 第1/4页\n试卷 · A4 · 第2/4页\n试卷 · A4 · 第3/4页\n试卷 · A4 · 第4/4页\n六、综合应用题\n综合分析与解答\n七、附加题\n附加题思考过程",
    pageMetrics: [
      { page: 1, bottomBlankMm: 70.2, drawingCount: 6, text: "一、填空题" },
      { page: 2, bottomBlankMm: 60.1, drawingCount: 6, text: "三、计算题\n计算过程" },
      { page: 3, bottomBlankMm: 84.7, drawingCount: 6, text: "五、解决问题\n解答过程" },
      { page: 4, bottomBlankMm: 226.1, drawingCount: 2, text: "六、综合应用题\n综合分析与解答\n七、附加题\n附加题思考过程" }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});

test("layout check allows final math exam page with word problems reserving answer space", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学试卷-题目.pdf",
    pages: 4,
    text: "六年级数学试卷\n试卷 · A4 · 第1/4页\n试卷 · A4 · 第2/4页\n试卷 · A4 · 第3/4页\n试卷 · A4 · 第4/4页\n四、解答题",
    pageMetrics: [
      { page: 1, bottomBlankMm: 70.2, drawingCount: 6, text: "一、填空题" },
      { page: 2, bottomBlankMm: 60.1, drawingCount: 6, text: "三、计算题\n计算过程" },
      { page: 3, bottomBlankMm: 84.7, drawingCount: 6, text: "四、解答题\n解答过程" },
      { page: 4, bottomBlankMm: 226.1, drawingCount: 5, text: "33. 一个圆柱形水桶（无盖）。（1）做这个水桶至少需要多少平方分米的铁皮？（2）这个水桶能盛水多少升？\n34. 甲乙两地相距多少千米？" }
    ]
  });

  assert.equal(check.ok, true);
  assert.deepEqual(check.issues, []);
});

test("layout check still rejects sparse final math pages without work-space signals", () => {
  const check = evaluateGenerationLayoutPdf({
    name: "数学练习-题目.pdf",
    pages: 2,
    text: "五年级数学练习\n练习 · A4 · 第1/2页\n练习 · A4 · 第2/2页\n一、基础巩固",
    pageMetrics: [
      { page: 1, bottomBlankMm: 96.8, drawingCount: 10, text: "一、基础巩固\n1. 填空题。" },
      { page: 2, bottomBlankMm: 132.0, drawingCount: 1, text: "一、基础巩固\n8. 填空题。" }
    ]
  });

  assert.equal(check.ok, false);
  assert.ok(check.issues.includes("末页底部留白 132.0mm，疑似题量或作答区分配不足。"));
});

test("a single-page short focused task need not fill A4 but an empty page is still rejected", () => {
  const base = { name: "语文-draft-review-student.pdf", pages: 1,
    text: "四年级语文专项\n专项练习 · A4 · 第1/1页\n1. （5分） 修改病句。\n2. （5分） 修改病句。\n3. （5分） 修改病句。\n4. （5分） 修改病句。",
    pageMetrics: [{ page: 1, bottomBlankMm: 189.9, drawingCount: 4 }] };
  assert.equal(evaluateGenerationLayoutPdf(base).ok, true);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pageMetrics: [{ ...base.pageMetrics[0], text: base.text }] }).ok, true);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: "专项练习 · A4 · 第1/1页\n本页留白" }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pageMetrics: [{ ...base.pageMetrics[0], text: "本页留白" }] }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, pages: 2 }).ok, false);
  assert.equal(evaluateGenerationLayoutPdf({ ...base, text: base.text.replace("专项练习", "练习") }).ok, false);
});
