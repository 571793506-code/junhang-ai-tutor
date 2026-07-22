import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("./textbook-generation-scope.js", import.meta.url);

const textbook = {
  id: "tb-pep-5b",
  title: "义务教育教科书英语五年级下册",
  subject: "英语",
  grade: "五年级",
  edition: "人教版",
  volume: "下册",
  path: "D:\\君航AI助教\\textbooks\\PEP-小学英语\\英语五年级下册.edupdf",
  metadata: {
    curriculumSeries: "PEP",
    chapters: [
      { id: "unit-1", unit: "Unit 1", title: "Unit 1 预习与跟读" },
      { id: "unit-2", unit: "Unit 2", title: "Unit 2 预习与跟读" }
    ]
  }
};

test("teacher-confirmed textbook scope creates exact-bound approved context without textbook body text", async () => {
  const { buildTeacherConfirmedTextbookScope } = await import(moduleUrl);
  const result = buildTeacherConfirmedTextbookScope(textbook, ["unit-2"], { teacherId: "teacher-1" });

  assert.equal(result.ok, true);
  assert.equal(result.source.sourceType, "teacher-confirmed-textbook-scope");
  assert.equal(result.source.reviewStatus, "APPROVED");
  assert.equal(result.source.allowedForGeneration, true);
  assert.equal(result.source.metadata.textbookAssetId, "tb-pep-5b");
  assert.equal(result.source.metadata.curriculumSeries, "PEP");
  assert.equal(result.source.metadata.curriculumRegion, "贵州遵义");
  assert.deepEqual(result.source.metadata.confirmedChapterIds, ["unit-2"]);
  assert.match(result.chunks[0].text, /Unit 2 预习与跟读/);
  assert.match(result.chunks[0].text, /不代表或摘录教材正文/);
  assert.doesNotMatch(result.chunks[0].text, /课文原文/);
});

test("teacher-confirmed textbook scope rejects a missing or non-baseline chapter range", async () => {
  const { buildTeacherConfirmedTextbookScope } = await import(moduleUrl);
  assert.equal(buildTeacherConfirmedTextbookScope(textbook, ["missing"]).error, "TEXTBOOK_CHAPTER_NOT_FOUND");
  assert.equal(buildTeacherConfirmedTextbookScope({ ...textbook, metadata: { chapters: [] } }).error, "TEXTBOOK_CHAPTER_INDEX_REQUIRED");
  assert.equal(buildTeacherConfirmedTextbookScope({ ...textbook, edition: "外研版", path: "D:\\textbooks\\外研版英语五年级下册.edupdf" }).error, "TEXTBOOK_BASELINE_MISMATCH");
});

test("teacher confirmations retain earlier valid chapters for the same textbook", async () => {
  const { mergeTeacherConfirmedTextbookScopeChapterIds } = await import(moduleUrl);

  assert.deepEqual(
    mergeTeacherConfirmedTextbookScopeChapterIds(textbook, ["unit-1", "removed-unit"], ["unit-2"]),
    ["unit-1", "unit-2"]
  );
});
