import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assessmentPageBalanceFillRatio,
  buildAssessmentLayoutValidation
} from "./assessment-layout-validation.js";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("assessment print export cannot bypass draft review with force", () => {
  const routeStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf('app.post(', routeStart + 1);
  const routeSource = source.slice(routeStart, routeEnd === -1 ? source.length : routeEnd);

  assert.match(routeSource, /metadata\.draftReviewStatus\s*!==\s*"accepted"/);
  assert.doesNotMatch(routeSource, /req\.body\?\.force/);
  assert.doesNotMatch(routeSource, /teacherReviewStatus:\s*metadata\.draftReviewStatus\s*\|\|\s*"accepted"/);
});

test("assessment layout validation rejects a three-page PDF planned as two pages", () => {
  const validation = buildAssessmentLayoutValidation({
    plannedPageCount: 2,
    htmlPageCount: 2,
    pdfPageCount: 3,
    pdfGenerated: true,
    measurementOk: true
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.coordinateManifestValid, false);
  assert.ok(validation.issues.includes("PDF 实际页数 3 与目标页数 2 不一致。"));
});

test("assessment layout validation accepts matching planned, HTML and PDF page counts", () => {
  const validation = buildAssessmentLayoutValidation({
    plannedPageCount: 2,
    htmlPageCount: 2,
    pdfPageCount: 2,
    pdfGenerated: true,
    measurementOk: true
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.coordinateManifestValid, true);
  assert.deepEqual(validation.issues, []);
});

test("assessment layout validation rejects missing browser measurements", () => {
  const validation = buildAssessmentLayoutValidation({
    plannedPageCount: 2,
    htmlPageCount: 2,
    pdfPageCount: 2,
    pdfGenerated: true,
    measurementOk: false
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.coordinateManifestValid, false);
  assert.ok(validation.issues.includes("浏览器布局测量失败，无法确认题目坐标与页面留白。"));
});

test("assessment layout validation rejects a sparse final English quiz page", () => {
  const validation = buildAssessmentLayoutValidation({
    subject: "英语",
    kind: "小测",
    plannedPageCount: 2,
    htmlPageCount: 2,
    pdfPageCount: 2,
    pdfGenerated: true,
    measurementOk: true,
    pageMetrics: [
      { page: 1, bottomBlankMm: 78.5 },
      { page: 2, bottomBlankMm: 143.9 }
    ]
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.coordinateManifestValid, false);
  assert.ok(validation.issues.includes("末页底部留白 143.9mm，疑似题量或作答区分配不足。"));
});

test("assessment layout validation rejects a sparse non-final English quiz page", () => {
  const validation = buildAssessmentLayoutValidation({
    subject: "英语",
    kind: "小测",
    plannedPageCount: 2,
    htmlPageCount: 2,
    pdfPageCount: 2,
    pdfGenerated: true,
    measurementOk: true,
    pageMetrics: [
      { page: 1, bottomBlankMm: 134.9 },
      { page: 2, bottomBlankMm: 101.9 }
    ]
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("第 1 页后续仍有内容，但本页底部留白 134.9mm，疑似预分页和真实分页脱节。"));
});

test("short English quizzes use stronger two-page balancing", () => {
  assert.equal(assessmentPageBalanceFillRatio({ subject: "英语", kind: "小测", itemCount: 12, pageCount: 2 }), 0.72);
  assert.equal(assessmentPageBalanceFillRatio({ subject: "英语", kind: "小测", itemCount: 20, pageCount: 2 }), 0.5);
  assert.equal(assessmentPageBalanceFillRatio({ subject: "数学", kind: "小测", itemCount: 12, pageCount: 2 }), 0.5);
});

test("assessment HTML measurement feeds sparse-page metrics into layout validation", () => {
  const measureStart = source.indexOf("async function measureQuestionLayoutFromHtml");
  const measureEnd = source.indexOf("\n}\n\nfunction countPdfPages", measureStart) + 2;
  const measureSource = source.slice(measureStart, measureEnd);
  const splitStart = source.indexOf("function splitSequentialPages");
  const splitEnd = source.indexOf("\n}\n\nfunction ensureEvenHtmlPages", splitStart) + 2;
  const splitSource = source.slice(splitStart, splitEnd);

  assert.match(measureSource, /pageMetrics/);
  assert.match(measureSource, /bottomBlankMm/);
  assert.match(source, /pageMetrics:\s*measuredLayout\.pageMetrics/);
  assert.match(splitSource, /assessmentPageBalanceFillRatio/);
});

test("headless PDF export and layout measurement use isolated browser profiles", () => {
  const renderStart = source.indexOf("async function renderPdfFromHtml");
  const renderEnd = source.indexOf("\n}\n\nfunction decodeHtmlText", renderStart) + 2;
  const renderSource = source.slice(renderStart, renderEnd);
  const measureStart = source.indexOf("async function measureQuestionLayoutFromHtml");
  const measureEnd = source.indexOf("\n}\n\nfunction countPdfPages", measureStart) + 2;
  const measureSource = source.slice(measureStart, measureEnd);

  assert.match(source, /function createHeadlessBrowserProfile/);
  assert.match(source, /function cleanupHeadlessBrowserProfile/);
  assert.match(renderSource, /--user-data-dir=\$\{profilePath\}/);
  assert.match(renderSource, /cleanupHeadlessBrowserProfile\(profilePath\)/);
  assert.match(measureSource, /--user-data-dir=\$\{profilePath\}/);
  assert.match(measureSource, /cleanupHeadlessBrowserProfile\(profilePath\)/);
});

test("short English quizzes move a complete trailing section to balance the final page", () => {
  const splitStart = source.indexOf("function splitSequentialPages");
  const splitEnd = source.indexOf("\n}\n\nfunction ensureEvenHtmlPages", splitStart) + 2;
  const createSplitter = new Function(
    "printableItemType",
    "safeJson",
    "readableText",
    "answerSpaceMm",
    "sectionTitleForItem",
    "assessmentPageBalanceFillRatio",
    `${source.slice(splitStart, splitEnd)}; return splitSequentialPages;`
  );
  const splitSequentialPages = createSplitter(
    (item) => item.itemType,
    (value, fallback) => value || fallback,
    (value, fallback) => String(value || fallback || ""),
    (item) => Number(item.answerSpaceMm || 0),
    (item) => item.metadata.sectionTitle,
    assessmentPageBalanceFillRatio
  );
  const sectionItems = (count, itemType, sectionTitle, metadata = {}) => Array.from({ length: count }, () => ({
    itemType,
    answerSpaceMm: metadata.answerSpaceMm || 0,
    prompt: metadata.prompt || "Weather question",
    metadata: {
      sectionTitle,
      answerFormat: metadata.answerFormat || "",
      options: metadata.options || [],
      showPassage: metadata.showPassage || false,
      passageText: metadata.passageText || ""
    }
  }));
  const items = [
    ...sectionItems(4, "fill", "一、词汇与短语", { answerFormat: "english-four-line", answerSpaceMm: 10 }),
    ...sectionItems(2, "solution", "二、句子运用", { answerFormat: "english-four-line", answerSpaceMm: 24 }),
    ...sectionItems(2, "choice", "三、单项选择题", { options: ["A", "B", "C", "D"] }),
    ...sectionItems(1, "reading", "四、阅读理解", {
      options: ["A", "B", "C", "D"],
      showPassage: true,
      passageText: "Weather ".repeat(320)
    }),
    ...sectionItems(3, "reading", "四、阅读理解", { options: ["A", "B", "C", "D"] })
  ];

  const pages = splitSequentialPages(items, 2, "英语", "小测");

  assert.deepEqual(pages.map((page) => page.items.map((entry) => entry.number)), [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12]
  ]);
});

test("draft review acceptance and print export reject failed layout validation", () => {
  const reviewStart = source.indexOf('app.post("/api/assessments/:assignmentId/draft-review"');
  const reviewEnd = source.indexOf('app.post(', reviewStart + 1);
  const reviewSource = source.slice(reviewStart, reviewEnd === -1 ? source.length : reviewEnd);
  const printStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  const printEnd = source.indexOf('app.post(', printStart + 1);
  const printSource = source.slice(printStart, printEnd === -1 ? source.length : printEnd);

  assert.match(reviewSource, /decision === "accept" && metadata\.layoutValidation\?\.ok !== true/);
  assert.match(reviewSource, /ASSESSMENT_LAYOUT_INVALID/);
  assert.match(printSource, /metadata\.layoutValidation\?\.ok !== true/);
  assert.match(printSource, /ASSESSMENT_LAYOUT_INVALID/);
});

test("formal print export validates layout before persisting its generated asset", () => {
  const helperStart = source.indexOf("async function exportAssessmentPaperAsset");
  const helperEnd = source.indexOf("\n}\n\nfunction normalizeReviewResultForDisplay", helperStart) + 2;
  const helperSource = source.slice(helperStart, helperEnd);
  const validationGate = helperSource.indexOf("options.requireValidLayout");
  const assetCreate = helperSource.indexOf("prisma.generatedAsset.create");
  const printStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  const printEnd = source.indexOf('app.post(', printStart + 1);
  const printSource = source.slice(printStart, printEnd === -1 ? source.length : printEnd);

  assert.ok(validationGate >= 0);
  assert.ok(assetCreate > validationGate);
  assert.match(printSource, /requireValidLayout:\s*true/);
});

test("assignment bootstrap exposes layout validation to teacher clients", () => {
  const mapStart = source.indexOf("function mapAssignment");
  const mapEnd = source.indexOf("\n}\n\nfunction mapTextbookAsset", mapStart) + 2;
  const mapSource = source.slice(mapStart, mapEnd);
  const bootstrapStart = source.indexOf('app.get("/api/bootstrap"');
  const bootstrapEnd = source.indexOf('\napp.', bootstrapStart + 1);
  const bootstrapSource = source.slice(bootstrapStart, bootstrapEnd === -1 ? source.length : bootstrapEnd);

  assert.match(mapSource, /layoutValidation:\s*metadata\.layoutValidation\s*\|\|\s*null/);
  assert.match(mapSource, /options\.includeDraftReviewAsset/);
  assert.match(mapSource, /draftReviewAsset:/);
  assert.match(bootstrapSource, /includeDraftReviewAsset:\s*req\.session\.role\s*===\s*"teacher"/);
});

test("assessment print layout keeps English four-line estimates compact", () => {
  assert.match(source, /type === "fill" \? 9 : Math\.max\(16, spaceMm\)\) \* 2\.35/);
  assert.match(source, /\.english-four-line div \{ height: 6\.6mm; position: relative; margin-bottom: 0\.8mm; \}/);
  assert.doesNotMatch(source, /type === "fill" \? 16 : spaceMm\) \* 3\.2/);
});

test("English-to-Chinese fill items reserve a visible short answer line", () => {
  const answerSpaceStart = source.indexOf("function answerSpaceMm");
  const answerSpaceEnd = source.indexOf("\n}\n\nfunction questionScoreText", answerSpaceStart) + 2;
  const createAnswerSpace = new Function(
    "safeJson",
    "printableItemType",
    "readableText",
    `${source.slice(answerSpaceStart, answerSpaceEnd)}; return answerSpaceMm;`
  );
  const answerSpaceMm = createAnswerSpace(
    (value, fallback) => value || fallback,
    (item) => item.itemType,
    (value, fallback) => String(value || fallback || "")
  );
  const renderStart = source.indexOf("function renderAnswerSpace");
  const renderEnd = source.indexOf("\n}\n\nfunction renderStudentItem", renderStart) + 2;
  const renderSource = source.slice(renderStart, renderEnd);

  assert.equal(answerSpaceMm({ itemType: "fill", prompt: "英译汉：weather", metadata: {} }, "英语", "小测"), 8);
  assert.equal(answerSpaceMm({ itemType: "fill", prompt: "用 weather 填空：It is ____ today.", metadata: {} }, "英语", "小测"), 0);
  assert.match(renderSource, /itemType === "fill" && subjectText\.includes\("英语"\).*short-answer-line/s);
  assert.match(renderSource, /short-answer-line" style="height:\$\{spaceMm\}mm/);
  assert.match(source, /\.short-answer-line \{[^}]*border-bottom: 1px solid #b9c6d3;/);
});

test("learner payload sanitizer recursively removes model escalation internals", () => {
  const start = source.indexOf("function sanitizeLearnerPayload");
  const end = source.indexOf("\n}\n\nfunction teacherStatusToClient", start) + 2;
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const createSanitizer = new Function(
    "normalizeDisplayText",
    `${source.slice(start, end)}; return sanitizeLearnerPayload;`
  );
  const sanitize = createSanitizer((value) => String(value));
  const payload = sanitize({
    score: 5,
    summary: "保留给学生的反馈",
    errorStep: "计算第二步有误",
    referenceAnswer: {
      correctAnswer: "2",
      solAttempted: true,
      usedModelEscalation: true,
      escalationModelRunId: "run-sol",
      escalationPersistenceError: "internal persistence failure",
      attempts: [{ model: "gpt-5.6-sol", reasoningEffort: "high", timeoutMs: 180000 }]
    },
    generationPipeline: {
      model: "gpt-5.6-terra",
      triggerCode: "524",
      tokenBudget: 12000,
      providerId: "gpt56",
      errorCode: "UPSTREAM_TIMEOUT",
      errorMessage: "internal gateway failure"
    }
  });

  assert.equal(payload.score, 5);
  assert.equal(payload.summary, "保留给学生的反馈");
  assert.equal(payload.errorStep, "计算第二步有误");
  assert.equal(payload.referenceAnswer.correctAnswer, "2");
  assert.deepEqual(Object.keys(payload.referenceAnswer), ["correctAnswer"]);
  assert.deepEqual(payload.generationPipeline, {});
});
