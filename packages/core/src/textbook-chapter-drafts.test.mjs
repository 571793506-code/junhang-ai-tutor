import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("./textbook-chapter-drafts.js", import.meta.url);

test("shared chapter drafts cover the unavailable grades and subjects without reading textbook content", async () => {
  const { chapterDraftsForTextbookAsset } = await import(moduleUrl);
  const assets = [
    { id: "cn-6b", subject: "语文", grade: "六年级", volume: "下册" },
    { id: "en-6b", subject: "英语", grade: "六年级", volume: "下册" },
    { id: "math-5a", subject: "数学", grade: "五年级", volume: "上册" },
    { id: "cn-4a", subject: "语文", grade: "四年级", volume: "上册" },
    { id: "en-3b", subject: "英语", grade: "三年级", volume: "下册" }
  ];

  for (const asset of assets) {
    const chapters = chapterDraftsForTextbookAsset(asset);
    assert.ok(chapters.length > 0, `${asset.grade}${asset.subject}${asset.volume} must have a usable chapter draft`);
    assert.ok(chapters.every((chapter) => chapter.id.startsWith(`${asset.id}-unit-`)));
    assert.ok(chapters.every((chapter) => /教师|范围|目录/.test(chapter.readingSupport || "")));
  }
  assert.equal(chapterDraftsForTextbookAsset(assets[1]).length, 6);
  assert.equal(chapterDraftsForTextbookAsset(assets[0]).length, 8);
  assert.equal(chapterDraftsForTextbookAsset(assets[2])[0].title, "小数乘法");
});

test("shared chapter repair keeps teacher-indexed chapters and only appends missing drafts", async () => {
  const { mergeTextbookChapterDrafts } = await import(moduleUrl);
  const asset = { id: "math-5a", subject: "数学", grade: "五年级", volume: "上册" };
  const existing = [{
    id: "teacher-unit-1",
    unit: "第一单元",
    title: "教师已核对的小数乘法",
    focusItems: ["积的小数位数"],
    readingSupport: "教师维护"
  }];

  const repaired = mergeTextbookChapterDrafts(asset, existing);

  assert.equal(repaired[0], existing[0]);
  assert.equal(repaired.length, 8);
  assert.equal(repaired.filter((chapter) => chapter.unit === "第一单元").length, 1);
  assert.equal(repaired[1].unit, "第二单元");
});

test("shared chapter drafts cover the teacher-confirmed 2022 grade seven math catalogs", async () => {
  const { chapterDraftsForTextbookAsset } = await import(moduleUrl);
  const firstTerm = chapterDraftsForTextbookAsset({ id: "math-7a", subject: "数学", grade: "七年级", volume: "上册" });
  const secondTerm = chapterDraftsForTextbookAsset({ id: "math-7b", subject: "数学", grade: "七年级", volume: "下册" });

  assert.equal(firstTerm.length, 6);
  assert.equal(secondTerm.length, 6);
  assert.deepEqual(firstTerm.map((chapter) => chapter.title), [
    "有理数",
    "有理数的运算",
    "代数式",
    "整式的加减",
    "一元一次方程",
    "几何图形初步"
  ]);
  assert.deepEqual(secondTerm.map((chapter) => chapter.title), [
    "相交线与平行线",
    "实数",
    "平面直角坐标系",
    "二元一次方程组",
    "不等式与不等式组",
    "数据的收集、整理与描述"
  ]);
  assert.match(firstTerm[0].readingSupport, /1\.1 正数和负数/);
  assert.match(secondTerm[3].readingSupport, /10\.2 消元/);
  assert.ok(firstTerm.every((chapter) => chapter.focusItems.length > 0));
  assert.ok(secondTerm.every((chapter) => chapter.focusItems.length > 0));
});
