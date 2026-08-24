import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiSource = fs.readFileSync(new URL("../apps/miniprogram/utils/api.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../apps/miniprogram/pages/teacher/assessments/index.js", import.meta.url), "utf8");
const templateSource = fs.readFileSync(new URL("../apps/miniprogram/pages/teacher/assessments/index.wxml", import.meta.url), "utf8");
const consoleSource = fs.readFileSync(new URL("../apps/miniprogram/pages/teacher/console/index.wxml", import.meta.url), "utf8");
const gradingDetailSource = fs.readFileSync(new URL("../apps/miniprogram/pages/teacher/grading-detail/index.js", import.meta.url), "utf8");
const gradingDetailTemplate = fs.readFileSync(new URL("../apps/miniprogram/pages/teacher/grading-detail/index.wxml", import.meta.url), "utf8");

function createAssessmentPage(apiOverrides = {}) {
  let pageDefinition;
  const api = {
    reviewAssessmentDraft: async () => ({ ok: true }),
    exportAssessmentPrint: async () => ({
      asset: { id: "student-pdf", title: "学生卷 PDF", url: "/student.pdf" },
      analysisAsset: { id: "analysis-pdf", title: "答案解析 PDF", url: "/analysis.pdf" },
      assets: [
        { id: "student-pdf", title: "学生卷 PDF", url: "/student.pdf" },
        { id: "analysis-pdf", title: "答案解析 PDF", url: "/analysis.pdf" }
      ]
    }),
    listAssessmentGenerationJobs: async () => ({ jobs: [] }),
    ...apiOverrides
  };
  vm.runInNewContext(pageSource, {
    Page(definition) {
      pageDefinition = definition;
    },
    clearInterval,
    console,
    require(request) {
      if (request === "../../../utils/api") return api;
      if (request === "../../../utils/guard") return {};
      throw new Error(`Unexpected require: ${request}`);
    },
    setInterval,
    wx: {
      downloadFile() {},
      openDocument() {},
      showToast() {}
    }
  });
  const page = {
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(update) {
      Object.assign(this.data, update);
    }
  };
  return page;
}

test("miniprogram generation uses the server job queue and textbook context", () => {
  assert.match(apiSource, /listTextbooks\(/);
  assert.match(apiSource, /createAssessmentGenerationJob\(/);
  assert.match(apiSource, /listAssessmentGenerationJobs\(/);
  assert.match(pageSource, /api\.listTextbooks\(/);
  assert.match(pageSource, /api\.createAssessmentGenerationJob\(/);
  assert.match(pageSource, /textbookAssetId/);
  assert.match(pageSource, /textbookChapterId/);
  assert.match(pageSource, /api\.listAssessmentGenerationJobs\(/);
  assert.match(templateSource, /教材/);
  assert.match(templateSource, /章节/);
});

test("miniprogram exposes one teacher grading workbench entry", () => {
  assert.match(consoleSource, /批改工作台/);
  assert.equal((consoleSource.match(/class="module-title">批改工作台/g) || []).length, 1);
  assert.doesNotMatch(consoleSource, /bindtap="goReview"/);
});

test("miniprogram hides the draft actions after formal PDF export", () => {
  assert.match(pageSource, /const finalAssets = exported\.assets \|\| \[exported\.asset, exported\.analysisAsset\]\.filter\(Boolean\)/);
  assert.match(pageSource, /\n\s+finalAssets,\n/);
  assert.match(pageSource, /draftAsset: null/);
  assert.match(pageSource, /latestAssignmentId: ""/);
  assert.match(templateSource, /wx:if="\{\{draftAsset && !finalAssets\.length\}\}"/);
});

test("miniprogram prevents duplicate draft actions while an export is running", () => {
  assert.match(templateSource, /disabled="\{\{loading\}\}"[^>]*bindtap="acceptDraft"/);
  assert.match(templateSource, /disabled="\{\{loading\}\}"[^>]*bindtap="rejectDraft"/);
});

test("miniprogram grading detail reflects archived state and disables repeat archive", () => {
  assert.match(gradingDetailSource, /statusText: workbench\.status === "archived" \? "已归档"/);
  assert.match(gradingDetailTemplate, /disabled="\{\{archiveLoading \|\| summary\.statusText === '已归档'\}\}"/);
});

test("miniprogram formal PDF assets can be opened from the completed task", () => {
  assert.match(pageSource, /openFinalAsset\(event\)/);
  assert.match(pageSource, /event\.currentTarget\.dataset\.url/);
  assert.match(pageSource, /wx\.openDocument/);
  assert.match(templateSource, /data-url="\{\{item\.url\}\}"/);
  assert.match(templateSource, /bindtap="openFinalAsset"/);
});

test("miniprogram restores formal export state after leaving and reopening the page", () => {
  assert.match(pageSource, /assignments: \[\]/);
  assert.match(pageSource, /assignments: bootstrap\.assignments \|\| \[\]/);
  assert.match(pageSource, /function finalAssetsFromAssignment\(assignment\)/);
  assert.match(pageSource, /statusLabel: finalAssets\.length \? "已正式导出"/);
  assert.match(pageSource, /finalAssets: \(selected && selected\.finalAssets\) \|\| \[\]/);
});

test("miniprogram polling preserves a just-completed formal export before bootstrap refreshes assignments", async () => {
  const page = createAssessmentPage({
    listAssessmentGenerationJobs: async () => ({
      jobs: [{
        id: "job-1",
        assignmentId: "assignment-new",
        draftAsset: { id: "draft-pdf", title: "审查 PDF", url: "/draft.pdf" },
        status: "ready_for_review",
        subject: "数学",
        title: "肖心妍数学小测"
      }]
    })
  });
  page.data.latestJobId = "job-1";
  page.data.latestAssignmentId = "assignment-new";
  page.data.draftAsset = { id: "draft-pdf", title: "审查 PDF", url: "/draft.pdf" };

  await page.acceptDraft();
  await page.refreshJobs();

  assert.equal(page.data.latestAssignmentId, "");
  assert.equal(page.data.draftAsset, null);
  assert.equal(page.data.finalAssets.length, 2);
});

test("miniprogram polling keeps a rejected new draft hidden before bootstrap refreshes assignments", async () => {
  const page = createAssessmentPage({
    listAssessmentGenerationJobs: async () => ({
      jobs: [{
        id: "job-2",
        assignmentId: "assignment-rejected",
        draftAsset: { id: "draft-rejected", title: "审查 PDF", url: "/draft-rejected.pdf" },
        status: "ready_for_review",
        subject: "英语",
        title: "肖心妍英语小测"
      }]
    })
  });
  page.data.latestJobId = "job-2";
  page.data.latestAssignmentId = "assignment-rejected";
  page.data.draftAsset = { id: "draft-rejected", title: "审查 PDF", url: "/draft-rejected.pdf" };

  await page.rejectDraft();
  await page.refreshJobs();

  assert.equal(page.data.latestAssignmentId, "");
  assert.equal(page.data.draftAsset, null);
  assert.equal(page.data.jobs[0].statusLabel, "已退回");
});
