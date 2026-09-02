import assert from "node:assert/strict";
import test from "node:test";
import * as textbookBaseline from "./textbook-baseline.js";

const { ZUNYI_TEXTBOOK_REGION, classifyTextbookBaseline } = textbookBaseline;

test("classifies the Zunyi baseline for Chinese, math, and PEP English", () => {
  assert.deepEqual(
    classifyTextbookBaseline({
      subject: "语文",
      title: "（根据2022年版课程标准修订）义务教育教科书·语文五年级上册",
      source: "D:\\君航AI助教\\textbooks",
      path: "D:\\君航AI助教\\textbooks\\人教版-小学语文\\语文五年级上册.edupdf"
    }),
    {
      region: ZUNYI_TEXTBOOK_REGION,
      edition: "统编版",
      series: "人教体系",
      displayName: "统编版 / 人教体系",
      baselineMatched: true
    }
  );

  assert.equal(
    classifyTextbookBaseline({
      subject: "数学",
      title: "义务教育教科书·数学二年级下册",
      path: "D:\\君航AI助教\\textbooks\\人教版-小学数学\\数学二年级下册.edupdf"
    }).displayName,
    "人教版"
  );

  assert.equal(
    classifyTextbookBaseline({
      subject: "英语",
      title: "义务教育教科书·英语（三年级起点）六年级下册",
      path: "D:\\君航AI助教\\textbooks\\PEP-小学英语\\英语六年级下册.edupdf"
    }).displayName,
    "人教版 PEP"
  );
});

test("rejects a non-baseline textbook instead of silently treating it as 人教版", () => {
  const result = classifyTextbookBaseline({
    subject: "数学",
    edition: "苏教版",
    title: "苏教版小学数学五年级上册",
    path: "D:\\君航AI助教\\textbooks\\苏教版-小学数学\\数学五年级上册.edupdf"
  });

  assert.equal(result.region, ZUNYI_TEXTBOOK_REGION);
  assert.equal(result.baselineMatched, false);
  assert.equal(result.edition, "苏教版");
});

test("textbook asset search matches edition, PEP series, and path", () => {
  assert.equal(typeof textbookBaseline.matchesTextbookAssetSearch, "function");
  const asset = {
    title: "义务教育教科书·英语（三年级起点）五年级下册",
    edition: "人教版",
    editionDisplay: "人教版 PEP",
    curriculumSeries: "PEP",
    path: "D:\\君航AI助教\\textbooks\\PEP-小学英语\\英语五年级下册.edupdf",
    relativePath: "PEP-小学英语/英语五年级下册.edupdf"
  };

  assert.equal(textbookBaseline.matchesTextbookAssetSearch(asset, "人教版"), true);
  assert.equal(textbookBaseline.matchesTextbookAssetSearch(asset, "pep"), true);
  assert.equal(textbookBaseline.matchesTextbookAssetSearch(asset, "PEP-小学英语"), true);
  assert.equal(textbookBaseline.matchesTextbookAssetSearch(asset, "苏教版"), false);
});

test("shared textbook evidence scope requires asset, subject, grade, edition, series, volume, and region", () => {
  assert.equal(typeof textbookBaseline.matchesTextbookEvidenceScope, "function");
  const textbook = {
    id: "tb-pep-5b",
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    curriculumSeries: "PEP",
    volume: "下册",
    curriculumRegion: "贵州遵义"
  };
  const source = {
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    volume: "下册",
    metadata: {
      textbookAssetId: "tb-pep-5b",
      curriculumSeries: "PEP",
      curriculumRegion: "贵州遵义"
    }
  };

  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, source), true);
  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, {
    metadata: {
      textbookAssetId: ["tb-pep-5b"],
      subjects: ["英语"],
      grades: ["五年级"],
      editions: ["人教版"],
      series: ["PEP"],
      volumes: ["下册"],
      regions: ["贵州遵义"]
    }
  }), true);
  for (const [label, incomplete] of [
    ["asset", { ...source, metadata: { curriculumSeries: "PEP", curriculumRegion: "贵州遵义" } }],
    ["different asset", { ...source, metadata: { ...source.metadata, textbookAssetId: "tb-pep-5a" } }],
    ["subject", { ...source, subject: undefined }],
    ["grade", { ...source, grade: undefined }],
    ["edition", { ...source, edition: undefined }],
    ["series", { ...source, metadata: { textbookAssetId: "tb-pep-5b", curriculumRegion: "贵州遵义" } }],
    ["volume", { ...source, volume: undefined }],
    ["region", { ...source, metadata: { textbookAssetId: "tb-pep-5b", curriculumSeries: "PEP" } }]
  ]) {
    assert.equal(
      textbookBaseline.matchesTextbookEvidenceScope(textbook, incomplete),
      false,
      `source missing ${label} must not satisfy textbook evidence`
    );
  }
});

test("shared textbook evidence scope requires an exact textbook asset binding", () => {
  const textbook = {
    assetId: "tb-pep-5b",
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    curriculumSeries: "PEP",
    volume: "下册",
    curriculumRegion: "贵州遵义"
  };
  const source = {
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    volume: "下册",
    metadata: {
      textbookAssetId: "tb-pep-5b",
      curriculumSeries: "PEP",
      curriculumRegion: "贵州遵义"
    }
  };

  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, source), true);
  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, {
    ...source,
    metadata: { ...source.metadata, textbookAssetId: "tb-other" }
  }), false);
  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, {
    ...source,
    metadata: { ...source.metadata, textbookAssetId: undefined }
  }), false);
});

test("matches grade seven math textbook evidence without treating it as primary grade six", () => {
  const textbook = {
    id: "tb-math-7a",
    subject: "数学",
    grade: "七年级",
    edition: "人教版",
    curriculumSeries: "人教版",
    volume: "上册",
    curriculumRegion: "贵州遵义"
  };
  const source = {
    subject: "数学",
    grade: "初一",
    edition: "人教版",
    volume: "上册",
    metadata: {
      textbookAssetId: "tb-math-7a",
      curriculumSeries: "人教版",
      curriculumRegion: "贵州遵义"
    }
  };

  assert.equal(textbookBaseline.matchesTextbookEvidenceScope(textbook, source), true);
});

test("teacher-confirmed textbook scopes only cover their confirmed chapters", () => {
  assert.equal(typeof textbookBaseline.matchesTeacherConfirmedTextbookChapterScope, "function");
  const source = {
    sourceType: "teacher-confirmed-textbook-scope",
    metadata: { confirmedChapterIds: ["unit-1", "unit-3"] }
  };

  assert.equal(textbookBaseline.matchesTeacherConfirmedTextbookChapterScope(source, "unit-1"), true);
  assert.equal(textbookBaseline.matchesTeacherConfirmedTextbookChapterScope(source, "unit-2"), false);
  assert.equal(textbookBaseline.matchesTeacherConfirmedTextbookChapterScope(source, ""), true);
  assert.equal(textbookBaseline.matchesTeacherConfirmedTextbookChapterScope({ ...source, sourceType: "teacher-upload" }, "unit-2"), true);
});
