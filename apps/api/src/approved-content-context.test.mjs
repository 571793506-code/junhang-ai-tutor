import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./approved-content-context.js", import.meta.url);
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("chapter titles must resolve to a real chapter before querying approved sources", async () => {
  const { resolveApprovedAssessmentContentContext } = await import(moduleUrl);
  let sourceQueries = 0;
  const prisma = {
    textbookAsset: { findUnique: async () => ({
      id: "tb-math", title: "人教版五年级数学下册", subject: "数学", grade: "五年级",
      edition: "人教版", volume: "下册",
      metadata: { chapters: [{ id: "ch-1", title: "小数乘法", focusItems: ["小数位数"] }] }
    }) },
    knowledgeSource: { findMany: async () => { sourceQueries += 1; return []; } }
  };
  const missing = await resolveApprovedAssessmentContentContext(prisma, {
    textbookAssetId: "tb-math", textbookChapterTitle: "不存在的章节"
  });
  assert.equal(missing.reason, "TEXTBOOK_CHAPTER_NOT_FOUND");
  assert.equal(missing.textbookContext.resolved, false);
  assert.equal(sourceQueries, 0);
  const found = await resolveApprovedAssessmentContentContext(prisma, {
    textbookAssetId: "tb-math", textbookChapterTitle: " 小数乘法 "
  });
  assert.equal(found.textbookContext.resolved, true);
  assert.equal(found.textbookContext.chapterId, "ch-1");
  assert.deepEqual(found.textbookContext.knowledgePoints, ["小数位数"]);
  assert.equal(sourceQueries, 1);
});

test("approved content resolver queries only generation-approved sources", async () => {
  assert.equal(fs.existsSync(moduleUrl), true, "approved-content-context.js must exist");
  const { resolveApprovedAssessmentContentContext } = await import(moduleUrl);
  let query = null;
  const prisma = {
    knowledgeSource: {
      findMany: async (input) => {
        query = input;
        return [
          {
            id: "approved-math",
            title: "五年级数学第二单元",
            subject: "数学",
            grade: "五年级",
            reviewStatus: "APPROVED",
            allowedForGeneration: true,
            licenseStatus: "ALLOWED",
            summary: "小数乘法",
            metadata: { knowledgePoints: ["小数乘法"] },
            chunks: [{ id: "chunk-1", orderIndex: 1, text: "小数乘法计算方法。", preview: "小数乘法计算方法。" }]
          }
        ];
      }
    }
  };

  const result = await resolveApprovedAssessmentContentContext(prisma, {
    subject: "数学",
    grade: "五年级",
    kind: "练习",
    requirement: "小数乘法"
  });

  assert.deepEqual(query.where, {
    reviewStatus: "APPROVED",
    allowedForGeneration: true,
    licenseStatus: { not: "NOT_ALLOWED" }
  });
  assert.deepEqual(query.include.chunks.orderBy, { orderIndex: "asc" });
  assert.equal(result.approvedOnly, true);
  assert.equal(result.matchedCount, 1);
});

test("context preview exposes bounded source metadata but never raw chunks", async () => {
  const { summarizeApprovedAssessmentContentContext } = await import(moduleUrl);
  const result = summarizeApprovedAssessmentContentContext({
    available: true,
    approvedOnly: true,
    matchedCount: 1,
    textbookContext: { resolved: true, assetId: "tb_1", chapterId: "ch_1", chapterTitle: "分数加减" },
    matches: [{
      id: "src_1",
      title: "五年级数学单元资料",
      sourceType: "markdown",
      subject: "数学",
      grade: "五年级",
      summary: "分数加减",
      chunks: [{ id: "chunk_1", text: "private markdown" }]
    }]
  });
  assert.equal(result.status, "approved");
  assert.deepEqual(result.sourceIds, ["src_1"]);
  assert.equal("chunks" in result.matches[0], false);
  assert.equal("markdownPath" in result.matches[0], false);
});

test("approved content resolver uses server-side textbook and chapter metadata", async () => {
  const { resolveApprovedAssessmentContentContext } = await import(moduleUrl);
  let textbookQuery = null;
  const prisma = {
    textbookAsset: {
      findUnique: async (input) => {
        textbookQuery = input;
        return {
          id: "tb-math-5b",
          title: "五年级数学下册",
          subject: "数学",
          grade: "五年级",
          edition: "人教版",
          volume: "下册",
          metadata: {
            chapters: [{
              id: "chapter-decimal",
              title: "小数乘法",
              focusItems: ["积的小数位数"],
              dictationItems: [],
              readingSupport: "先按整数乘法计算，再确定小数点位置。"
            }]
          }
        };
      }
    },
    knowledgeSource: {
      findMany: async () => [{
        id: "approved-math",
        title: "五年级数学小数乘法",
        subject: "数学",
        grade: "五年级",
        edition: "人教版",
        volume: "下册",
        reviewStatus: "APPROVED",
        allowedForGeneration: true,
        licenseStatus: "ALLOWED",
        metadata: {
          textbookAssetId: "tb-math-5b",
          curriculumSeries: "人教版",
          curriculumRegion: "贵州遵义",
          knowledgePoints: ["积的小数位数"]
        },
        chunks: [{ id: "math-chunk", orderIndex: 1, text: "根据因数的小数位数确定积的小数位数。" }]
      }]
    }
  };

  const result = await resolveApprovedAssessmentContentContext(prisma, {
    subject: "英语",
    grade: "四年级",
    textbookAssetId: "tb-math-5b",
    textbookTitle: "伪造标题",
    textbookChapterId: "chapter-decimal",
    textbookChapterTitle: "伪造章节"
  });

  assert.deepEqual(textbookQuery, { where: { id: "tb-math-5b" } });
  assert.equal(result.textbookContext.title, "五年级数学下册");
  assert.equal(result.textbookContext.edition, "人教版");
  assert.equal(result.textbookContext.curriculumSeries, "人教版");
  assert.equal(result.textbookContext.curriculumRegion, "贵州遵义");
  assert.equal(result.textbookContext.chapterTitle, "小数乘法");
  assert.deepEqual(result.textbookContext.knowledgePoints, ["积的小数位数"]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matches[0].id, "approved-math");
});

test("approved content resolver blocks a textbook outside the Zunyi baseline", async () => {
  const { resolveApprovedAssessmentContentContext } = await import(moduleUrl);
  let sourceQueryCount = 0;
  const prisma = {
    textbookAsset: {
      findUnique: async () => ({
        id: "tb-suji-math",
        title: "苏教版小学数学五年级上册",
        subject: "数学",
        grade: "五年级",
        edition: "苏教版",
        volume: "上册",
        path: "D:\\君航AI助教\\textbooks\\苏教版-小学数学\\数学五年级上册.edupdf",
        source: "D:\\君航AI助教\\textbooks",
        metadata: {}
      })
    },
    knowledgeSource: {
      findMany: async () => {
        sourceQueryCount += 1;
        return [];
      }
    }
  };

  const result = await resolveApprovedAssessmentContentContext(prisma, {
    subject: "数学",
    grade: "五年级",
    textbookAssetId: "tb-suji-math",
    textbookChapterTitle: "第一单元"
  });

  assert.equal(result.reason, "TEXTBOOK_BASELINE_MISMATCH");
  assert.equal(result.textbookContext.baselineMatched, false);
  assert.equal(sourceQueryCount, 0);
});

test("approved content resolver rejects any textbook intent without an asset before querying sources", async () => {
  const { resolveApprovedAssessmentContentContext } = await import(moduleUrl);
  let sourceQueryCount = 0;
  const prisma = {
    knowledgeSource: {
      findMany: async () => {
        sourceQueryCount += 1;
        return [{
          id: "approved-pep-weather",
          title: "Unit 3 Weather",
          subject: "英语",
          grade: "五年级",
          edition: "人教版",
          volume: "下册",
          reviewStatus: "APPROVED",
          allowedForGeneration: true,
          licenseStatus: "ALLOWED",
          metadata: { curriculumSeries: "PEP", curriculumRegion: "贵州遵义" },
          chunks: [{ id: "weather-1", orderIndex: 1, text: "Unit 3 Weather vocabulary" }]
        }];
      }
    }
  };
  const textbookIntentFields = {
    textbookTitle: "英语五年级下册",
    textbookEdition: "人教版",
    textbookEditionDisplay: "人教版 PEP",
    textbookSeries: "PEP",
    textbookVolume: "下册",
    textbookRegion: "贵州遵义",
    textbookChapterId: "unit-3",
    textbookChapterTitle: "Unit 3 Weather"
  };

  for (const [field, value] of Object.entries(textbookIntentFields)) {
    const result = await resolveApprovedAssessmentContentContext(prisma, {
      subject: "英语",
      grade: "五年级",
      [field]: value
    });

    assert.equal(result.reason, "TEXTBOOK_ASSET_REQUIRED", field);
    assert.equal(result.textbookContext?.resolved, false, field);
  }
  assert.equal(sourceQueryCount, 0);
});

test("assessment draft route reuses server-side context preparation and blocks missing textbook evidence", () => {
  const routeStart = serverSource.indexOf('app.post("/api/assessments/draft"');
  const routeEnd = serverSource.indexOf("app.post(", routeStart + 1);
  const routeSource = serverSource.slice(routeStart, routeEnd === -1 ? serverSource.length : routeEnd);
  const prepareStart = serverSource.indexOf("async function prepareAssessmentDraftInput");
  const prepareEnd = serverSource.indexOf("\nfunction assessmentGenerationJobRequest", prepareStart);
  const preparationSource = serverSource.slice(prepareStart, prepareEnd === -1 ? serverSource.length : prepareEnd);

  assert.match(routeSource, /prepareAssessmentDraftInput\(req\)/);
  assert.match(routeSource, /res\.status\(422\)/);
  assert.match(preparationSource, /resolveApprovedAssessmentContentContext/);
  assert.match(preparationSource, /validateAssessmentContentContext/);
  assert.match(preparationSource, /assessmentContentContextFailure/);
  assert.match(preparationSource, /contentContext/);
  assert.match(preparationSource, /textbookContext/);
});

test("textbook list hides stale non-edupdf records even before import cleanup", () => {
  const routeStart = serverSource.indexOf('app.get("/api/textbooks"');
  const routeEnd = serverSource.indexOf("app.", routeStart + 1);
  const routeSource = serverSource.slice(routeStart, routeEnd === -1 ? serverSource.length : routeEnd);

  assert.match(routeSource, /endsWith:\s*"\.edupdf"/);
});

test("textbook list uses the shared edition, series, and path search contract", () => {
  const routeStart = serverSource.indexOf('app.get("/api/textbooks"');
  const routeEnd = serverSource.indexOf("app.", routeStart + 1);
  const routeSource = serverSource.slice(routeStart, routeEnd === -1 ? serverSource.length : routeEnd);

  assert.match(routeSource, /matchesTextbookAssetSearch/);
});

test("knowledge source review derives textbook scope from a real asset id", () => {
  const routeStart = serverSource.indexOf('app.patch("/api/knowledge/sources/:sourceId/review"');
  const routeEnd = serverSource.indexOf("app.", routeStart + 1);
  const routeSource = serverSource.slice(routeStart, routeEnd === -1 ? serverSource.length : routeEnd);

  assert.match(routeSource, /body\.textbookAssetId/);
  assert.match(routeSource, /prisma\.textbookAsset\.findUnique/);
  assert.match(routeSource, /buildKnowledgeSourceTextbookBinding/);
  assert.doesNotMatch(routeSource, /body\.(?:edition|curriculumSeries|volume|curriculumRegion)/);
  assert.match(serverSource, /preserveKnowledgeSourceTextbookBinding/);
});

test("content-index sync preserves textbook asset binding", () => {
  const syncStart = serverSource.indexOf("async function syncContentIndexToKnowledgeLibrary");
  const syncEnd = serverSource.indexOf("app.post(\"/api/knowledge/sources/sync-content-index\"", syncStart);
  const syncSource = serverSource.slice(syncStart, syncEnd);
  assert.match(syncSource, /textbookAssetId:\s*document\.textbookAssetId/);
  assert.match(syncSource, /sourceUrl:\s*document\.sourceUrl/);
  assert.match(syncSource, /curriculumStandard:\s*document\.curriculumStandard/);
});

test("knowledge-source review keeps textbook asset binding visible", () => {
  const reviewStart = serverSource.indexOf('app.patch("/api/knowledge/sources/:sourceId/review"');
  const reviewEnd = serverSource.indexOf("app.patch(", reviewStart + 1);
  const reviewSource = serverSource.slice(reviewStart, reviewEnd === -1 ? serverSource.length : reviewEnd);
  assert.match(reviewSource, /textbookAssetId/);
  assert.match(reviewSource, /metadata/);
});

test("textbook routes repair only chapter metadata and require a fresh teacher scope confirmation", () => {
  const repairStart = serverSource.indexOf('app.post("/api/textbooks/chapter-drafts/repair"');
  const confirmStart = serverSource.indexOf('app.post("/api/textbooks/:assetId/confirm-generation-scope"');
  const chapterPatchStart = serverSource.indexOf('app.patch("/api/textbooks/:assetId/chapters"');
  const chapterPatchEnd = serverSource.indexOf("app.post(\"/api/textbooks/rescan\"", chapterPatchStart);
  const chapterPatchSource = serverSource.slice(chapterPatchStart, chapterPatchEnd);

  assert.ok(repairStart >= 0);
  assert.ok(confirmStart >= 0);
  assert.match(serverSource.slice(repairStart, confirmStart), /mergeTextbookChapterDrafts/);
  assert.match(serverSource.slice(confirmStart), /replaceTeacherConfirmedTextbookScope/);
  assert.match(chapterPatchSource, /invalidateTeacherConfirmedTextbookScopes/);
  assert.match(serverSource, /TEACHER_CONFIRMED_TEXTBOOK_SCOPE/);
});
