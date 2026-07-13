import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./knowledge-source-textbook-scope.js", import.meta.url);

async function loadScopeModule() {
  assert.equal(fs.existsSync(moduleUrl), true, "knowledge-source-textbook-scope.js must exist");
  return import(moduleUrl);
}

const textbookAsset = {
  id: "tb-pep-5b",
  subject: "英语",
  grade: "五年级",
  edition: "人教版",
  volume: "下册",
  title: "义务教育教科书英语五年级下册",
  path: "D:\\君航AI助教\\textbooks\\PEP-小学英语\\英语五年级下册.edupdf",
  metadata: { curriculumSeries: "PEP" }
};

test("knowledge source textbook binding is derived from the real textbook asset", async () => {
  const { buildKnowledgeSourceTextbookBinding } = await loadScopeModule();
  const result = buildKnowledgeSourceTextbookBinding({
    id: "source-weather",
    subject: "英语",
    grade: "五年级",
    metadata: { knowledgePoints: ["weather"] }
  }, textbookAsset);

  assert.equal(result.ok, true);
  assert.deepEqual(result.scope, {
    subject: "英语",
    grade: "五年级",
    edition: "人教版",
    volume: "下册",
    metadata: {
      knowledgePoints: ["weather"],
      textbookAssetId: "tb-pep-5b",
      textbookTitle: "义务教育教科书英语五年级下册",
      curriculumSeries: "PEP",
      curriculumRegion: "贵州遵义"
    }
  });
});

test("knowledge source textbook binding rejects explicit source conflicts", async () => {
  const { buildKnowledgeSourceTextbookBinding } = await loadScopeModule();
  const result = buildKnowledgeSourceTextbookBinding({
    subject: "英语",
    grade: "五年级",
    edition: "外研版",
    volume: "下册",
    metadata: { curriculumSeries: "外研版", curriculumRegion: "贵州遵义" }
  }, textbookAsset);

  assert.equal(result.ok, false);
  assert.equal(result.error, "KNOWLEDGE_SOURCE_TEXTBOOK_SCOPE_MISMATCH");
});

test("content index resync preserves a teacher-confirmed textbook binding", async () => {
  const { preserveKnowledgeSourceTextbookBinding } = await loadScopeModule();
  const result = preserveKnowledgeSourceTextbookBinding(
    {
      subject: "英语",
      grade: "五年级",
      edition: null,
      volume: null,
      metadata: { contentIndexId: "doc-0001", knowledgePoints: ["weather"] }
    },
    {
      subject: "英语",
      grade: "五年级",
      edition: "人教版",
      volume: "下册",
      metadata: {
        textbookAssetId: "tb-pep-5b",
        textbookTitle: "义务教育教科书英语五年级下册",
        curriculumSeries: "PEP",
        curriculumRegion: "贵州遵义",
        syncedAt: "old"
      }
    }
  );

  assert.equal(result.edition, "人教版");
  assert.equal(result.volume, "下册");
  assert.equal(result.metadata.contentIndexId, "doc-0001");
  assert.equal(result.metadata.textbookAssetId, "tb-pep-5b");
  assert.equal(result.metadata.curriculumSeries, "PEP");
  assert.equal(result.metadata.curriculumRegion, "贵州遵义");
  assert.notEqual(result.metadata.syncedAt, "old");
});

test("content index first sync accepts a missing existing source", async () => {
  const { preserveKnowledgeSourceTextbookBinding } = await loadScopeModule();
  const next = {
    subject: "数学",
    grade: "五年级",
    edition: "人教版",
    volume: "上册",
    metadata: { contentIndexId: "doc-first-sync", knowledgePoints: ["小数乘法"] }
  };

  const result = preserveKnowledgeSourceTextbookBinding(next, null);

  assert.deepEqual(result, next);
});
