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

test("shared chapter drafts match the confirmed 2022 elementary math catalogs", async () => {
  const { chapterDraftsForTextbookAsset } = await import(moduleUrl);
  const catalogs = [
    {
      asset: { id: "math-3a", subject: "数学", grade: "三年级", volume: "上册" },
      units: ["第一单元", "第二单元", "第三单元", "数学实践活动一", "第四单元", "数学实践活动二", "第五单元", "第六单元", "第七单元"],
      titles: ["观察物体", "混合运算", "毫米、分米和千米", "曹冲称象的故事", "多位数乘一位数", "数字编码", "线和角", "分数的初步认识", "复习与关联"]
    },
    {
      asset: { id: "math-3b", subject: "数学", grade: "三年级", volume: "下册" },
      units: ["第一单元", "第二单元", "第三单元", "第四单元", "第五单元", "数学实践活动一", "第六单元", "第七单元"],
      titles: ["生活中的运动现象", "除数是一位数的除法", "长方形和正方形", "图形的面积", "数据的收集与整理", "年、月、日的秘密", "小数的初步认识", "复习与关联"]
    },
    {
      asset: { id: "math-4a", subject: "数学", grade: "四年级", volume: "上册" },
      units: ["第一单元", "数学实践活动一", "第二单元", "第三单元", "第四单元", "第五单元", "第六单元", "数学实践活动二", "第七单元"],
      titles: ["万以上数的认识", "亿有多大", "角的度量", "多位数乘两位数", "加法模型和乘法模型", "平行四边形和梯形", "条形统计图", "寻找宝藏", "复习与关联"]
    }
  ];

  for (const { asset, units, titles } of catalogs) {
    const chapters = chapterDraftsForTextbookAsset(asset);
    assert.deepEqual(chapters.map((chapter) => chapter.unit), units);
    assert.deepEqual(chapters.map((chapter) => chapter.title), titles);
    assert.ok(chapters.every((chapter) => chapter.id.startsWith(`${asset.id}-unit-`)));
  }
});
