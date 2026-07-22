import assert from "node:assert/strict";
import test from "node:test";
import * as services from "./index.js";

function matchApprovedContentContext(input, sources) {
  assert.equal(typeof services.matchApprovedContentContext, "function");
  return services.matchApprovedContentContext(input, sources);
}

function validateAssessmentContentContext(input, contentContext) {
  assert.equal(typeof services.validateAssessmentContentContext, "function");
  return services.validateAssessmentContentContext(input, contentContext);
}

test("approved content matcher excludes unreviewed and cross-subject sources", () => {
  const result = matchApprovedContentContext(
    {
      subject: "数学",
      grade: "五年级",
      knowledgePoints: ["积的小数位数"]
    },
    [
      {
        id: "pending-math",
        title: "五年级数学小数乘法",
        subject: "数学",
        grade: "五年级",
        reviewStatus: "PENDING",
        allowedForGeneration: false,
        licenseStatus: "REVIEW_REQUIRED",
        chunks: [{ id: "pending-1", orderIndex: 1, text: "小数乘法练习。" }]
      },
      {
        id: "approved-english",
        title: "五年级英语阅读",
        subject: "英语",
        grade: "五年级",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        chunks: [{ id: "english-1", orderIndex: 1, text: "reading vocabulary" }]
      },
      {
        id: "approved-math",
        title: "五年级数学第二单元",
        subject: "数学",
        grade: "五年级",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        summary: "围绕小数乘法的计算方法。",
        metadata: { knowledgePoints: ["小数乘法", "积的小数位数"] },
        chunks: [
          { id: "math-1", orderIndex: 1, text: "本节先复习整数乘法。", preview: "本节先复习整数乘法。" },
          { id: "math-2", orderIndex: 2, text: "列竖式时先按整数乘法计算。", preview: "列竖式时先按整数乘法计算。" },
          { id: "math-3", orderIndex: 3, text: "最后根据因数的小数位数确定积的小数位数。", preview: "最后根据因数的小数位数确定积的小数位数。" }
        ]
      }
    ]
  );

  assert.equal(result.approvedOnly, true);
  assert.equal(result.approvedSourceCount, 1);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matches[0].id, "approved-math");
  assert.equal(result.matches[0].chunks[0].id, "math-3");
  assert.match(result.matches[0].chunks[0].preview, /积的小数位数/);
});

test("textbook-grounded assessment is blocked without an approved match", () => {
  const validation = validateAssessmentContentContext(
    {
      subject: "英语",
      grade: "四年级",
      kind: "小测",
      textbookAssetId: "tb-english-4b",
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      available: false,
      approvedOnly: true,
      approvedSourceCount: 0,
      matchedCount: 0,
      matches: [],
      reason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND"
    }
  );

  assert.equal(validation.ok, false);
  assert.equal(validation.required, true);
  assert.equal(validation.error, "ASSESSMENT_CONTENT_CONTEXT_REQUIRED");
});

test("teacher-confirmed textbook evidence cannot satisfy an unconfirmed chapter", () => {
  const result = matchApprovedContentContext(
    {
      subject: "数学",
      grade: "五年级",
      textbookAssetId: "tb-math-5a",
      textbookEdition: "人教版",
      textbookSeries: "人教版",
      textbookVolume: "上册",
      textbookRegion: "贵州遵义",
      textbookChapterId: "unit-2",
      textbookChapterTitle: "第二单元",
      knowledgePoints: ["整数四则运算"]
    },
    [{
      id: "scope-unit-1",
      title: "五年级数学上册教师确认范围",
      sourceType: "teacher-confirmed-textbook-scope",
      subject: "数学",
      grade: "五年级",
      edition: "人教版",
      volume: "上册",
      reviewStatus: "APPROVED",
      allowedForGeneration: true,
      licenseStatus: "TEACHER_CONFIRMED_SCOPE",
      metadata: {
        textbookAssetId: "tb-math-5a",
        curriculumSeries: "人教版",
        curriculumRegion: "贵州遵义",
        confirmedChapterIds: ["unit-1"]
      },
      chunks: [{ id: "scope-1", orderIndex: 1, text: "整数四则运算", preview: "第一单元" }]
    }]
  );

  assert.equal(result.matchedCount, 0);
  assert.equal(result.reason, "APPROVED_CONTENT_CONTEXT_NOT_FOUND");
});

test("any textbook intent without an asset id requires a real textbook asset", () => {
  const emptyApprovedContext = {
    available: false,
    approvedOnly: true,
    approvedSourceCount: 0,
    matchedCount: 0,
    matches: [],
    reason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND"
  };
  const textbookIntentFields = {
    textbookTitle: "英语四年级下册",
    textbookEdition: "人教版",
    textbookEditionDisplay: "人教版 PEP",
    textbookSeries: "PEP",
    textbookVolume: "下册",
    textbookRegion: "贵州遵义",
    textbookChapterId: "unit-3",
    textbookChapterTitle: "Unit 3 Weather"
  };

  for (const [field, value] of Object.entries(textbookIntentFields)) {
    const validation = validateAssessmentContentContext(
      { subject: "英语", grade: "四年级", kind: "小测", [field]: value },
      emptyApprovedContext
    );

    assert.equal(validation.ok, false, `${field} must require a textbook asset`);
    assert.equal(validation.required, true, `${field} must mark textbook context as required`);
    assert.equal(validation.error, "TEXTBOOK_ASSET_REQUIRED", `${field} must fail before evidence matching`);
  }
});

test("a chapter-named assessment cannot bypass textbook evidence by omitting the asset id", () => {
  const validation = validateAssessmentContentContext(
    {
      subject: "英语",
      grade: "四年级",
      kind: "小测",
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      available: false,
      approvedOnly: true,
      approvedSourceCount: 0,
      matchedCount: 0,
      matches: [],
      reason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND"
    }
  );

  assert.equal(validation.ok, false);
  assert.equal(validation.required, true);
});

test("general assessment can continue with an explicit empty approved context", () => {
  const validation = validateAssessmentContentContext(
    {
      subject: "数学",
      grade: "六年级",
      kind: "试卷",
      requirement: "小升初综合测评，覆盖数与代数、图形与几何。"
    },
    {
      available: false,
      approvedOnly: true,
      approvedSourceCount: 0,
      matchedCount: 0,
      matches: [],
      reason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND"
    }
  );

  assert.equal(validation.ok, true);
  assert.equal(validation.required, false);
});

test("approved content matcher excludes an explicitly conflicting textbook edition or volume", () => {
  const result = matchApprovedContentContext(
    {
      subject: "英语",
      grade: "五年级",
      textbookAssetId: "tb-pep-5b",
      textbookEdition: "人教版",
      textbookSeries: "PEP",
      textbookVolume: "下册",
      textbookRegion: "贵州遵义",
      textbookChapterTitle: "Unit 3 Weather"
    },
    [
      {
        id: "wrong-edition",
        title: "Unit 3 Weather",
        subject: "英语",
        grade: "五年级",
        edition: "外研版",
        volume: "下册",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        metadata: { textbookAssetId: "tb-pep-5b", curriculumSeries: "外研版", curriculumRegion: "贵州遵义" },
        chunks: [{ id: "wrong-1", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
      },
      {
        id: "wrong-volume",
        title: "Unit 3 Weather",
        subject: "英语",
        grade: "五年级",
        edition: "人教版",
        volume: "上册",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        metadata: { textbookAssetId: "tb-pep-5b", curriculumSeries: "PEP", curriculumRegion: "贵州遵义" },
        chunks: [{ id: "wrong-2", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
      },
      {
        id: "pep-lower",
        title: "Unit 3 Weather",
        subject: "英语",
        grade: "五年级",
        edition: "人教版",
        volume: "下册",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        metadata: { textbookAssetId: "tb-pep-5b", curriculumSeries: "PEP", curriculumRegion: "贵州遵义" },
        chunks: [{ id: "right-1", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
      }
    ]
  );

  assert.equal(result.matchedCount, 1);
  assert.equal(result.matches[0].id, "pep-lower");
  assert.equal(result.matches[0].edition, "人教版");
  assert.equal(result.matches[0].volume, "下册");
  assert.equal(result.matches[0].curriculumSeries, "PEP");
});

test("textbook-bound matcher rejects approved sources missing any edition, series, volume, or region scope", () => {
  const input = {
    subject: "英语",
    grade: "五年级",
    textbookAssetId: "tb-pep-5b",
    textbookEdition: "人教版",
    textbookSeries: "PEP",
    textbookVolume: "下册",
    textbookRegion: "贵州遵义",
    textbookChapterTitle: "Unit 3 Weather"
  };
  const baseSource = {
    id: "pep-weather",
    title: "Unit 3 Weather",
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    volume: "下册",
    reviewStatus: "APPROVED",
    allowedForGeneration: true,
    licenseStatus: "ALLOWED",
    metadata: { textbookAssetId: "tb-pep-5b", curriculumSeries: "PEP", curriculumRegion: "贵州遵义" },
    chunks: [{ id: "weather-1", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
  };
  const incompleteSources = [
    { label: "edition", source: { ...baseSource, edition: undefined } },
    { label: "series", source: { ...baseSource, metadata: { curriculumRegion: "贵州遵义" } } },
    { label: "volume", source: { ...baseSource, volume: undefined } },
    { label: "region", source: { ...baseSource, metadata: { curriculumSeries: "PEP" } } }
  ];

  for (const { label, source } of incompleteSources) {
    const result = matchApprovedContentContext(input, [source]);
    assert.equal(result.matchedCount, 0, `source missing ${label} must not satisfy textbook evidence`);
    assert.equal(result.reason, "APPROVED_CONTENT_CONTEXT_NOT_FOUND");
  }
});

test("textbook-bound matcher requires the approved source to bind to the requested asset id", () => {
  const input = {
    subject: "英语",
    grade: "五年级",
    textbookAssetId: "tb-pep-5b",
    textbookEdition: "人教版",
    textbookSeries: "PEP",
    textbookVolume: "下册",
    textbookRegion: "贵州遵义",
    textbookChapterTitle: "Unit 3 Weather"
  };
  const source = {
    id: "pep-weather",
    title: "Unit 3 Weather",
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    volume: "下册",
    reviewStatus: "APPROVED",
    allowedForGeneration: true,
    licenseStatus: "ALLOWED",
    metadata: {
      textbookAssetId: "tb-other",
      curriculumSeries: "PEP",
      curriculumRegion: "贵州遵义"
    },
    chunks: [{ id: "weather-1", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
  };

  const result = matchApprovedContentContext(input, [source]);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.reason, "APPROVED_CONTENT_CONTEXT_NOT_FOUND");
});
