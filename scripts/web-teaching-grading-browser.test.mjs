import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { gradingWorkflowFixture } from "./test-support/grading-workflow.mjs";
import { createTeachingWorkflowClient } from "./teaching-workflow-client.mjs";

// Browser plugin not available. Reuse installed Playwright and Edge; no downloads.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const artifactDir = process.env.WEB_QA_OUTPUT || path.join(os.tmpdir(), "junhang-grading-web-qa");
const launch = () => chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const pageSvg = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><g font-family="sans-serif" font-size="24" fill="#163b45"><text x="50" y="65">合成作业 · 第 ${n} 页</text><text x="60" y="155">${n === 1 ? "1. 说明交换加数为什么和不变" : "2. 24 + 18 = 42"}</text><text x="60" y="205">${n === 1 ? "交换两堆小棒，总数一样。" : "个位相加满十，向十位进一。"}</text></g></svg>`;

test("actual teacher page preserves multipart upload, source management and disabled workflow fallback", { timeout: 40000 }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(`<html><meta charset="utf-8"><body>${pageSvg(1)}</body></html>`);
  const png = await page.locator("svg").screenshot();
  const teacher = { id: "t1", displayName: "测试教师", role: "teacher", status: "active" };
  const student = { id: "s1", displayName: "测试学生", grade: "四年级", canReceiveNewWork: true, enrollmentStatus: "在读", responsibleTeacherId: "t1",
    focus: "加法", weeklyScore: 0, streak: 0, mastery: {}, strengths: [], risks: [], tone: "待观察" };
  const disabled = { ...student, id: "disabled", displayName: "停用学生", canReceiveNewWork: false, enrollmentStatus: "已退课" };
  let uploaded = false, workflowStatus = 404, multipart = "";
  const workbench = { id: "submission1", submissionId: "submission1", assignmentId: "paper1", title: "测试上传", studentId: "s1", studentName: "测试学生",
    subject: "数学", kind: "作业", materialType: "external_workbook", status: "待复核", workflowState: "review_required", needsTeacherReview: true,
    archiveEligible: false, archiveBlockers: ["ANSWER_SOURCE_NOT_CONFIRMED"], questions: [], pages: [], questionCount: 0, pendingQuestionCount: 0,
    ocrStatusLabel: "待核对", summary: "合成上传记录", uploadedBy: "teacher", submittedAt: "2026-09-17T10:00:00Z" };
  const base = { ok: true, teacher, teachers: [teacher], sessionToken: "synthetic-intercept-only", students: [student, disabled], tasks: [], assignments: [],
    classroomDevices: [], classroomBroadcasts: [], dictationTasks: [], readingTasks: [], corrections: [], logs: [], reports: [], submissions: [], jobs: [], assets: [],
    sources: [], events: [], modelRuns: [], index: null, database: { ok: true }, ai: { features: [], mode: "test" } };
  // No request reaches the real API; this checks upload/entry integration, not OCR or source registration quality.
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/teaching/workflows") return route.fulfill(workflowStatus === 404 ? { status: 404, contentType: "text/html", body: "Route absent" } : { status: 503, json: { ok: false, error: "WORKFLOW_UNAVAILABLE" } });
    if (p === "/api/submissions/grade") { multipart = route.request().postData() || ""; uploaded = true;
      return route.fulfill({ json: { ok: true, result: { available: false, queued: true }, uploadedFiles: [], persistence: { active: false } } }); }
    return route.fulfill({ json: { ...base, workbenches: uploaded ? [workbench] : [] } });
  });
  await page.goto(process.env.WEB_BASE_URL || "http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "登录同步真实数据", exact: true }).click();
  await page.getByText("教师端已登录：测试教师", { exact: true }).waitFor();
  await page.getByRole("button", { name: "批改复核", exact: true }).click();
  const continuous = page.getByRole("region", { name: "持续批改工作台", exact: true });
  await continuous.getByText("服务暂未启用", { exact: true }).waitFor();
  await page.getByTestId("teacher-grading-image-picker-library-input").setInputFiles([{ name: "page1.png", mimeType: "image/png", buffer: png }, { name: "page2.png", mimeType: "image/png", buffer: png }]);
  await page.getByTestId("teacher-grading-image-picker").getByText("已加入 2 张图片", { exact: true }).waitFor();
  const upload = page.locator("section").filter({ has: page.getByTestId("teacher-grading-image-picker") });
  assert.equal(await upload.locator("option[value='disabled']").count(), 0);
  await upload.getByRole("button", { name: "上传并批改", exact: true }).click();
  await continuous.getByLabel("已上传批次", { exact: true }).locator("option[value='submission1']").waitFor({ state: "attached" });
  assert.match(multipart, /page1\.png/); assert.match(multipart, /page2\.png/);
  assert.match(multipart, /name="studentId"\r?\n\r?\ns1/);
  assert.equal(await continuous.getByRole("button", { name: "从此批次开始持续批改", exact: true }).isDisabled(), true);
  await continuous.getByRole("button", { name: "原有批改与来源管理", exact: true }).first().click();
  await page.locator(".legacy-grading-workspace").waitFor({ state: "visible" });
  await page.getByText("登记对话生成内容为统一批改来源", { exact: true }).waitFor();
  await page.getByRole("button", { name: "持续批改与版本", exact: true }).click();
  workflowStatus = 503;
  const response = page.waitForResponse((r) => r.url().includes("/api/teaching/workflows") && r.status() === 503);
  await continuous.getByRole("button", { name: "重新检查", exact: true }).click(); await response;
  await continuous.scrollIntoViewIfNeeded();
  await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, "grading-actual-entry.png") });
  assert.deepEqual(errors, []); assert.equal(await page.locator("vite-error-overlay").count(), 0);
});

test("grading browser corrects one answer, preserves confirmation, rejects stale saves and archives the confirmed version", { timeout: 60000 }, async (t) => {
  const f = await gradingWorkflowFixture(t);
  f.context.submission.content.ocr.questions[1].cropRef = "crop2";
  const c = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const vite = await createServer({ configFile: false, root: path.resolve("apps/web"), cacheDir: path.join(artifactDir, "vite-cache"), plugins: [react(), {
    name: "grading-browser-fixture",
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__grading") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await server.transformIndexHtml("/__grading", '<html><head><title>批改工作台交互验证</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__grading-entry"></script></body></html>'));
    }); },
    resolveId(id) { if (id === "\0grading-entry") return id; },
    load(id) { if (id === "\0grading-entry") return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GradingWorkbench} from '/src/components/GradingWorkbench.tsx'; import '/src/styles.css'; createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell',style:{padding:20}},React.createElement(GradingWorkbench,{teacherId:'t1',active:true,sources:[{submissionId:'submission1',studentId:'s1',assignmentId:'paper1',title:'加法作业',studentName:'测试学生'}],onLegacy:()=>{},onArchived:()=>{}})));`; }
  }], define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/__workflow-api") }, server: { host: "127.0.0.1", port: 0, proxy: { "/__workflow-api": { target: f.baseUrl, rewrite: (p) => p.replace("/__workflow-api", "") } } } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/qa/page*.png", (route) => route.fulfill({ contentType: "image/svg+xml", body: pageSvg(route.request().url().includes("page2") ? 2 : 1) }));
  await page.addInitScript((token) => localStorage.setItem("junhang.web.sessionToken", token), f.tokens.teacher);
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__grading`);
  await page.getByText("服务可用", { exact: true }).waitFor();
  await page.getByLabel("已上传批次", { exact: true }).selectOption("submission1");
  await page.getByRole("button", { name: "从此批次开始持续批改", exact: true }).click();
  await page.getByText("尚未可靠识别，不能按空白计零分", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "确认当前题目", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "归档当前确认版本", exact: true }).isDisabled(), true);
  await page.getByTestId("grading-question-region").waitFor();
  const box = await page.getByTestId("grading-question-region").getAttribute("style"); assert.match(box, /left: 10%/);
  await page.getByRole("button", { name: "第 2 题 · 正确", exact: true }).click();
  await page.getByRole("img", { name: "作业原图第 2 页" }).waitFor();
  assert.equal(await page.getByTestId("grading-question-region").count(), 0); // crop coordinates must not overlay original page
  await page.getByLabel("我已核对当前题的作答、得分和解析").check();
  await page.getByRole("button", { name: "确认当前题目", exact: true }).click();
  await page.getByRole("button", { name: "第 2 题 · 正确 · 已确认", exact: true }).waitFor();
  await page.getByRole("button", { name: "第 1 题 · 待核对", exact: true }).click();
  await page.getByRole("button", { name: "修正识别并仅重批本题", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "保存识别修正并重批本题", exact: true }).isDisabled(), true);
  await page.getByLabel("核对后的学生作答", { exact: true }).fill("交换两堆小棒，总数一样");
  await page.getByRole("button", { name: "保存识别修正并重批本题", exact: true }).click();
  await page.getByText("学生用交换两堆小棒说明总量不变，属于合理异解。", { exact: true }).waitFor();
  assert.deepEqual(f.calls[1].ocrQuestions.map((q) => q.questionNo), ["1"]);
  assert.equal((await c.get("workflow-1")).content.questions[1].reviewedByTeacher, true);
  await page.reload();
  await page.getByText("交换两堆小棒，总数一样", { exact: true }).waitFor();
  await page.getByLabel("本题重判要求", { exact: true }).fill("请核对学生的合理异解");
  await page.getByRole("button", { name: "按要求仅重判本题", exact: true }).click();
  await page.getByText("已保存新版本，请核对改动后的题目。", { exact: true }).waitFor();
  assert.equal(f.calls.length, 3); assert.deepEqual(f.calls[2].ocrQuestions.map((q) => q.questionNo), ["1"]);
  await page.getByRole("button", { name: "手工修正本题评分", exact: true }).click();
  await page.getByLabel("评分依据与解析", { exact: true }).fill("保留的教师评分说明");
  const before = await c.get("workflow-1");
  await c.execute(before.id, { action: "confirm", operationKey: "dialogue-confirm", expectedRevision: before.revision, targetQuestionIds: ["q2"] });
  await page.getByRole("button", { name: "保存本题评分草稿", exact: true }).click();
  await page.getByText("版本或操作状态已变化。你的编辑已保留，请刷新后比较。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "刷新当前批改", exact: true }).click();
  await page.getByText(/当前版本已变化，文本已保留/).waitFor();
  assert.equal(await page.getByLabel("评分依据与解析", { exact: true }).inputValue(), "保留的教师评分说明");
  assert.equal(await page.getByRole("button", { name: "保存本题评分草稿", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "放弃本地修改", exact: true }).click();
  await page.getByRole("button", { name: "手工修正本题评分", exact: true }).click();
  await page.getByLabel("本题判定", { exact: true }).selectOption("uncertain");
  await page.getByRole("button", { name: "保存本题评分草稿", exact: true }).click();
  await page.getByRole("heading", { name: "本题得分：待核对 · 待核对 / 5", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "手工修正本题评分", exact: true }).isDisabled(), false);
  assert.equal(await page.getByRole("button", { name: "确认当前题目", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "手工修正本题评分", exact: true }).click();
  await page.getByLabel("本题判定", { exact: true }).selectOption("correct");
  await page.getByLabel("评分依据与解析", { exact: true }).fill("教师核对：不同方法同样正确，给满分。");
  await page.getByRole("button", { name: "保存本题评分草稿", exact: true }).click();
  await page.getByText("教师核对：不同方法同样正确，给满分。", { exact: true }).waitFor();
  assert.equal(f.calls.length, 3);
  await page.getByLabel("我已核对当前题的作答、得分和解析").check();
  await page.getByRole("button", { name: "确认当前题目", exact: true }).click();
  await page.getByText("确认总分：10", { exact: true }).waitFor();
  const confirmed = await c.get(before.id);
  await page.getByRole("button", { name: "归档当前确认版本", exact: true }).click();
  await page.getByText("当前确认版本已归档。", { exact: true }).waitFor();
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  assert.equal(await page.getByRole("button", { name: "归档当前确认版本", exact: true }).isDisabled(), true);
  await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, "grading-desktop.png") });
  await page.getByLabel("批改历史版本", { exact: true }).fill("2");
  await page.getByRole("button", { name: "查看批改历史版本", exact: true }).click();
  await page.getByText("历史内容只读；恢复会新增版本，不覆盖已归档记录。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "修正识别并仅重批本题", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "恢复批改为新版本", exact: true }).click();
  await page.getByText("尚未可靠识别，不能按空白计零分", { exact: true }).waitFor();
  assert.equal((await c.get(before.id)).revision, confirmed.revision + 1);
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "修改与归档", exact: true }).click();
  await page.getByRole("button", { name: "修正识别并仅重批本题", exact: true }).click();
  await page.getByLabel("核对后的学生作答", { exact: true }).fill("窄屏未保存内容");
  await page.getByRole("button", { name: "原图", exact: true }).click();
  await page.getByRole("button", { name: "修改与归档", exact: true }).click();
  assert.equal(await page.getByLabel("核对后的学生作答", { exact: true }).inputValue(), "窄屏未保存内容");
  await page.screenshot({ path: path.join(artifactDir, "grading-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Reopen the separately resolved server archive via CLI; Web must retain teacher confirmation without another model call.
  const trustedArchive = f.archiveDb.snapshot().submissions[0].content.workflowArchive;
  f.context.submission.content.workflowArchive = structuredClone(trustedArchive);
  const reopened = await c.create({ module: "grading", requestKey: "reopen-confirmed-archive",
    request: { studentId: "s1", submissionId: trustedArchive.id, title: "对话已确认批改" } });
  assert.equal(f.calls.length, 3);
  assert.ok(reopened.content.questions.every((q) => q.reviewedByTeacher === true));
  await page.getByRole("button", { name: "放弃本地修改", exact: true }).click();
  const listed = page.waitForResponse((r) => r.url().includes("/workflows?module=grading") && r.status() === 200);
  await page.getByRole("button", { name: "刷新任务列表", exact: true }).click(); await listed;
  await page.getByLabel("继续已有批改任务", { exact: true }).selectOption(reopened.id);
  await page.getByText("确认总分：10", { exact: true }).waitFor();
  assert.equal(f.calls.length, 3);
  assert.equal(await page.locator("vite-error-overlay").count(), 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), screenshots: artifactDir, viewports: ["1500x1000", "390x844"], model: "synthetic", OCR: "synthetic", database: "in-memory", calls: f.calls.length }));
});
