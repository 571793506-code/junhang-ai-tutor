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
import { workflowHttpFixture } from "./test-support/teaching-workflow-http.mjs";

// Browser plugin not available. Reuse installed Playwright and Edge; no downloads.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const artifactDir = process.env.WEB_QA_OUTPUT || path.join(os.tmpdir(), "junhang-grading-web-qa");
const launch = () => chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const pageSvg = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><g font-family="sans-serif" font-size="24" fill="#163b45"><text x="50" y="65">合成作业 · 第 ${n} 页</text><text x="60" y="155">${n === 1 ? "1. 说明交换加数为什么和不变" : "2. 24 + 18 = 42"}</text><text x="60" y="205">${n === 1 ? "交换两堆小棒，总数一样。" : "个位相加满十，向十位进一。"}</text></g></svg>`;

test("legacy archive status, counts and actions share evidence readiness without treating draft flags as a block", { timeout: 60000 }, async t => {
  const vite = await createServer({ configFile: false, root: path.resolve("apps/web"), cacheDir: path.join(artifactDir, "legacy-readiness-vite"),
    plugins: [react()], server: { host: "127.0.0.1", port: 0 } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(12000);
  const errors = [], archiveWrites = [], queries = [];
  page.on("pageerror", error => errors.push(error.message));
  const teacher = { id: "t1", displayName: "测试教师", role: "teacher", status: "active" };
  const question = { id: "q1", questionNo: "1", prompt: "24+18", studentAnswer: "42", correctAnswer: "42", score: 5, maxScore: 5, status: "correct", reviewedByTeacher: true };
  const ready = { id: "ready", submissionId: "ready", assignmentId: "paper", title: "教师已核对试卷", studentId: "s1", studentName: "就绪学生", subject: "数学", kind: "试卷",
    materialType: "generated_assessment", status: "reviewing", workflowState: "draft", needsTeacherReview: true, archiveEligible: false, canArchive: true,
    archiveBlockers: [], questions: [question], pages: [{ id: "p1", pageNumber: 1, imageUrl: "/uploads/missing.svg", qualityStatus: "ready", markers: [{ id: "m1", questionNo: "1", label: "✓", status: "correct", x: 0.2, y: 0.2 }] }, { id: "p2", pageNumber: 2, imageUrl: "/uploads/good.svg", qualityStatus: "ready", markers: [] }], questionCount: 1, pendingQuestionCount: 0, reviewedQuestionCount: 1, questionReviewReady: true,
    quality: { lowConfidence: false }, ocrStatusLabel: "已核对", summary: "", uploadedBy: "teacher", submittedAt: "2026-11-07T08:00:00Z", archivedAt: null };
  const blocked = { ...ready, id: "blocked", submissionId: "blocked", title: "证据待补齐试卷", studentName: "阻断学生", canArchive: false, archiveBlockers: ["图片质量需复核"] };
  const denied = { ...ready, id: "denied", submissionId: "denied", title: "服务待确认试卷", studentName: "待确认学生", canArchive: false };
  const base = { ok: true, teacher, teachers: [teacher], sessionToken: "synthetic-intercept-only", students: [], tasks: [], assignments: [], classroomDevices: [], classroomBroadcasts: [],
    dictationTasks: [], readingTasks: [], corrections: [], logs: [], reports: [], submissions: [], jobs: [], assets: [], sources: [], events: [], modelRuns: [], index: null,
    database: { ok: true }, ai: { features: [], mode: "test" } };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/mark-reviewed")) archiveWrites.push(url.pathname);
    if (url.pathname === "/api/teaching/workflows") return route.fulfill({ status: 404, body: "Route absent" });
    queries.push(url.searchParams.get("queueState"));
    return route.fulfill({ json: { ...base, workbenches: url.searchParams.get("queueState") === "ready" ? [ready] : [blocked, ready, denied] } });
  });
  let imageRestored = false;
  await page.route("**/uploads/*.svg", route => route.request().url().endsWith("missing.svg") && !imageRestored
    ? route.fulfill({ status: 404, body: "Missing original" }) : route.fulfill({ contentType: "image/svg+xml", body: pageSvg(1) }));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/?gradingAssignment=paper`);
  await page.getByRole("button", { name: "登录同步真实数据", exact: true }).click();
  await page.getByRole("button", { name: "原有批改与来源管理", exact: true }).first().click();
  const panel = page.locator(".grading-workbench");
  await panel.locator(".grading-stage-head").getByText("待补齐归档条件", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "确认归档", exact: true }).isDisabled(), true);
  await panel.getByText("归档阻断：图片质量需复核", { exact: true }).waitFor();
  assert.match(await panel.locator(".grading-command-metrics").innerText(), /低置信\s*0\s*份/);
  assert.match(await panel.locator(".grading-command-metrics").innerText(), /可归档\s*1\s*份/);
  await panel.getByRole("button", { name: /待确认学生 · 试卷/ }).click();
  await panel.locator(".grading-stage-head").getByText("待补齐归档条件", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "确认归档", exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: /就绪学生 · 试卷/ }).click();
  await panel.locator(".grading-stage-head").getByText("待教师确认归档", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "确认归档", exact: true }).isEnabled(), true);
  await panel.getByRole("button", { name: "筛选", exact: true }).click();
  await panel.getByLabel("批改状态筛选", { exact: true }).selectOption("ready");
  await panel.getByRole("button", { name: "应用筛选", exact: true }).click();
  await panel.getByRole("heading", { name: "教师已核对试卷", exact: true }).waitFor();
  assert.equal(await panel.locator(".grading-batch-list > button").count(), 1);
  assert.ok(queries.includes("ready"));
  const imageStage = panel.locator(".grading-image-stage");
  await imageStage.getByText("第 1 页原图无法加载", { exact: true }).waitFor();
  assert.equal(await imageStage.locator(".annotation-marker").count(), 0);
  await imageStage.getByRole("link", { name: "上传新批次", exact: true }).click();
  assert.equal(await page.locator("#grading-upload").getAttribute("open"), "");
  await page.locator("#grading-upload").getByLabel("记录标题").fill("折叠保留测试");
  await page.locator("#grading-upload > summary").click();
  await page.locator("#grading-upload > summary").click();
  assert.equal(await page.locator("#grading-upload").getByLabel("记录标题").inputValue(), "折叠保留测试");
  await panel.getByRole("button", { name: "第 2 页", exact: true }).click();
  await imageStage.getByRole("img").evaluate(img => img.decode());
  assert.equal(await imageStage.locator(".grading-image-unavailable").count(), 0);
  await panel.getByRole("button", { name: "第 1 页", exact: true }).click();
  await imageStage.getByText("第 1 页原图无法加载", { exact: true }).waitFor();
  imageRestored = true;
  await imageStage.getByRole("button", { name: "重试加载", exact: true }).click();
  await imageStage.getByRole("img").evaluate(img => img.decode());
  await imageStage.locator(".annotation-marker").waitFor();
  await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, "grading-legacy-archive-readiness.png") });
  assert.deepEqual(archiveWrites, []); assert.deepEqual(errors, []);
});

for (const outcome of ["success", "failure"]) test(`failed grading recovery safely replays a lost response, successor ${outcome}`, { timeout: 40000 }, async (t) => {
  let calls = 0;
  const request = { studentId: "s1", submissionId: "submission1", title: "恢复测试", requirement: "首次作答评分，订正另记" };
  const f = await workflowHttpFixture(t, { createDraft: async ({ input }) => {
    calls++; assert.deepEqual(input.request, request);
    if (calls === 1 || outcome === "failure") throw new Error("PRIVATE");
    return { snapshot: { questions: [{ id: "q1", questionNo: "1", prompt: "1+1", answer: "2", studentAnswer: "2", correctAnswer: "2", score: 2, maxScore: 2, status: "correct", explanation: "计算正确" }] } };
  } });
  const c = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const failed = await c.create({ module: "grading", requestKey: "failed-browser", request });
  const original = structuredClone(await f.repo.get(failed.id, "t1"));
  const vite = await createServer({ configFile: false, root: path.resolve("apps/web"), cacheDir: path.join(artifactDir, `recovery-${outcome}-vite-cache`), plugins: [react(), {
    name: "grading-recovery-fixture",
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__recovery") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await server.transformIndexHtml("/__recovery", '<html><body><div id="root"></div><script type="module" src="/@id/__x00__recovery-entry"></script></body></html>'));
    }); },
    resolveId(id) { if (id === "\0recovery-entry") return id; },
    load(id) { if (id === "\0recovery-entry") return `import React from 'react';import {createRoot} from 'react-dom/client';import {GradingWorkbench} from '/src/components/GradingWorkbench.tsx';import '/src/styles.css';createRoot(document.getElementById('root')).render(React.createElement(GradingWorkbench,{teacherId:'t1',active:true,sources:[],onLegacy:()=>{},onArchived:()=>{throw new Error('unexpected archive')}}));`; }
  }], define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/__workflow-api") }, server: { host: "127.0.0.1", port: 0, proxy: { "/__workflow-api": { target: f.baseUrl, rewrite: (p) => p.replace("/__workflow-api", "") } } } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(({ token, id }) => { localStorage.setItem("junhang.web.sessionToken", token); if (!localStorage.getItem("junhang.grading-workflow.v1.t1")) localStorage.setItem("junhang.grading-workflow.v1.t1", id); }, { token: f.tokens.teacher, id: failed.id });
  let loseResponse = true; const keys = [];
  await page.route("**/workflows/*/recover", async (route) => {
    keys.push(route.request().postDataJSON().operationKey);
    const response = await route.fetch();
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    return route.fulfill({ response });
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__recovery`);
  const recover = page.getByRole("button", { name: "按原要求恢复批改", exact: true });
  await recover.click();
  await page.getByText("暂未收到操作结果，请刷新任务核对，避免重复提交。", { exact: true }).waitFor();
  assert.equal(calls, 2);
  await page.reload();
  await recover.click();
  const finalState = outcome === "success" ? page.getByRole("heading", { name: "恢复测试 · 版本 2 · 待教师复核", exact: true })
    : page.getByText("恢复仍未完成，请保留本任务并排查来源、识别证据或服务状态后再处理。", { exact: true });
  await finalState.waitFor();
  assert.equal(await recover.count(), 0);
  assert.equal(calls, 2); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.deepEqual(await f.repo.get(failed.id, "t1"), original);
  assert.equal(await page.getByRole("button", { name: "归档当前确认版本", exact: true }).isDisabled(), true);
  await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, `grading-recovery-${outcome}.png`) });
  await page.reload();
  await finalState.waitFor();
  assert.equal(await recover.count(), 0);
  assert.equal(calls, 2); assert.deepEqual(errors, []);
});

test("actual teacher page prefills dialogue entry and preserves multipart upload, source management and disabled workflow fallback", { timeout: 90000 }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(`<html><meta charset="utf-8"><body>${pageSvg(1)}</body></html>`);
  const png = await page.locator("svg").screenshot();
  const teacher = { id: "t1", displayName: "测试教师", role: "teacher", status: "active" };
  const student = { id: "s1", displayName: "测试学生", grade: "四年级", canReceiveNewWork: true, enrollmentStatus: "在读", responsibleTeacherId: "t1",
    focus: "加法", weeklyScore: 0, streak: 0, mastery: {}, strengths: [], risks: [], tone: "待观察" };
  const disabled = { ...student, id: "disabled", displayName: "停用学生", canReceiveNewWork: false, enrollmentStatus: "已退课" };
  const dialogueStudent = { ...student, id: "s2", displayName: "对话材料学生", grade: "三年级" };
  const dialogueAssignment = { id: "dialogue-paper", title: "对话生成试卷", studentId: "s2", subject: "数学", kind: "试卷", status: "待完成",
    gradingSource: { sourceId: "dialogue-paper", version: 1, fingerprint: "synthetic" }, gradingSourceQuestionCount: 1,
    items: [{ id: "q1", orderIndex: 1, prompt: "1+1", itemType: "fill" }] };
  let uploaded = false, uploadCount = 0, workflowStatus = 404, multipart = "";
  const workbench = { id: "submission1", submissionId: "submission1", assignmentId: "paper1", title: "测试上传", studentId: "s1", studentName: "测试学生",
    subject: "数学", kind: "作业", materialType: "external_workbook", status: "待复核", workflowState: "review_required", needsTeacherReview: true,
    archiveEligible: false, archiveBlockers: ["ANSWER_SOURCE_NOT_CONFIRMED"], questions: [],
    pages: [{ id: "page1", pageNumber: 1, imageUrl: "http://127.0.0.1:8787/uploads/qa-page.png", qualityStatus: "ready" }], questionCount: 0, pendingQuestionCount: 0,
    ocrStatusLabel: "待核对", summary: "合成上传记录", uploadedBy: "teacher", submittedAt: "2026-09-17T10:00:00Z" };
  let currentAssignments = [dialogueAssignment];
  let registeredRequest = null;
  let registeredAssignment = null;
  const base = { ok: true, teacher, teachers: [teacher], sessionToken: "synthetic-intercept-only", students: [student, dialogueStudent, disabled], tasks: [], assignments: currentAssignments,
    classroomDevices: [], classroomBroadcasts: [], dictationTasks: [], readingTasks: [], corrections: [], logs: [], reports: [], submissions: [], jobs: [], assets: [],
    sources: [], events: [], modelRuns: [], index: null, database: { ok: true }, ai: { features: [], mode: "test" } };
  // No request reaches the real API; this checks upload/entry integration, not OCR or source registration quality.
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/teaching/workflows") return route.fulfill(workflowStatus === 404 ? { status: 404, contentType: "text/html", body: "Route absent" } : { status: 503, json: { ok: false, error: "WORKFLOW_UNAVAILABLE" } });
    if (p === "/api/submissions/grade") { multipart = route.request().postData() || ""; uploaded = true;
      uploadCount++;
      // This flow proceeds to another upload; the first synthetic grading must finish first.
      return route.fulfill({ json: { ok: true, result: { available: true, queued: false }, uploadedFiles: [], persistence: { active: false } } }); }
    if (p === "/api/grading/source-packages/dialogue") {
      registeredRequest = route.request().postDataJSON();
      registeredAssignment = { id: "registered-practice", title: "三年级计算专项练习", studentId: null, studentName: "", targetScope: "grade", targetGrade: "三年级",
        subject: "数学", kind: "练习", status: "待完成", gradingSource: { sourceId: "registered-practice", version: 1, fingerprint: "synthetic-registered" },
        gradingSourceQuestionCount: 1, items: [{ id: "q2", orderIndex: 1, prompt: "9 × 8", itemType: "calculation" }] };
      currentAssignments = [...currentAssignments, registeredAssignment];
      return route.fulfill({ json: { ok: true, assignment: registeredAssignment } });
    }
    return route.fulfill({ json: { ...base, assignments: currentAssignments, workbenches: uploaded ? [workbench] : [] } });
  });
  await page.route("**/uploads/qa-page.png", (route) => route.fulfill({ contentType: "image/svg+xml", body: pageSvg(1) }));
  const entry = new URL(process.env.WEB_BASE_URL || "http://127.0.0.1:5173/");
  entry.searchParams.set("gradingAssignment", dialogueAssignment.id);
  await page.goto(entry.href);
  console.log("grading-entry: page loaded");
  await page.getByRole("button", { name: "登录同步真实数据", exact: true }).click();
  await page.getByText("教师端已登录：测试教师", { exact: true }).waitFor();
  console.log("grading-entry: logged in");
  const upload = page.locator("#grading-upload");
  assert.equal(await upload.getAttribute("open"), "");
  await upload.locator("select").nth(4).waitFor();
  assert.equal(await upload.locator("select").nth(0).inputValue(), "s2");
  assert.equal(await upload.locator("select").nth(1).inputValue(), "generated_assessment");
  assert.equal(await upload.locator("select").nth(2).inputValue(), "试卷");
  assert.equal(await upload.locator("select").nth(4).inputValue(), "dialogue-paper");
  assert.equal(await upload.getByRole("button", { name: "上传并批改", exact: true }).isDisabled(), true);
  console.log("grading-entry: prefill verified");
  // Explicit teacher changes remain effective after the one-time prefill.
  await upload.locator("select").nth(0).selectOption("s1");
  await upload.locator("select").nth(1).selectOption("external_workbook");
  await upload.locator("select").nth(2).selectOption("作业");
  const continuous = page.getByRole("region", { name: "持续批改工作台", exact: true });
  await continuous.getByText("服务暂未启用", { exact: true }).waitFor();
  await page.getByTestId("teacher-grading-image-picker-library-input").setInputFiles([{ name: "page1.png", mimeType: "image/png", buffer: png }, { name: "page2.png", mimeType: "image/png", buffer: png }]);
  await page.getByTestId("teacher-grading-image-picker").getByText("已加入 2 张图片", { exact: true }).waitFor();
  assert.equal(await upload.locator("option[value='disabled']").count(), 0);
  await upload.getByRole("button", { name: "上传并批改", exact: true }).click();
  await continuous.getByLabel("已上传批次", { exact: true }).locator("option[value='submission1']").waitFor({ state: "attached" });
  assert.match(multipart, /page1\.png/); assert.match(multipart, /page2\.png/);
  assert.match(multipart, /name="studentId"\r?\n\r?\ns1/);
  assert.equal(await continuous.getByRole("button", { name: "从此批次开始持续批改", exact: true }).isDisabled(), true);
  await continuous.getByRole("button", { name: "原有批改与来源管理", exact: true }).first().click();
  await page.locator(".legacy-grading-workspace").waitFor({ state: "visible" });
  const legacyImage = page.getByRole("img", { name: "测试学生 上传页面 1", exact: true });
  const apiOrigin = await page.evaluate(async () => {
    const { teachingImageUrl } = await import("/src/api.ts");
    return new URL(teachingImageUrl("/uploads/qa-page.png")).origin;
  });
  assert.equal(await legacyImage.getAttribute("src"), `${apiOrigin}/uploads/qa-page.png`);
  await legacyImage.evaluate((img) => img.decode());
  await page.locator("summary").filter({ hasText: "登记对话答案来源" }).click();
  await page.getByText("登记对话生成内容为统一批改来源", { exact: true }).waitFor();
  console.log("grading-entry: legacy view visible");
  const packageText = JSON.stringify({ schemaVersion: "junhang-grading-source-v1", sourceId: "dialogue-source", version: 1, title: "三年级计算专项练习",
    subject: "数学", kind: "练习", grade: "三年级", questions: [{ questionNo: "1", prompt: "9 × 8", answer: "72" }] });
  const registration = page.locator(".dialogue-answer-package-panel").filter({ hasText: "登记对话生成内容为统一批改来源" });
  await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").fill(packageText);
  assert.equal(await registration.getByLabel("内容标题").inputValue(), "三年级计算专项练习");
  assert.equal(await registration.getByRole("textbox", { name: "年级", exact: true }).inputValue(), "三年级");
  assert.equal(await registration.getByLabel("科目").inputValue(), "数学");
  assert.equal(await registration.getByLabel("类型").inputValue(), "练习");
  await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").fill("");
  assert.equal(await registration.getByLabel("内容标题").inputValue(), "");
  assert.equal(await registration.getByRole("textbox", { name: "年级", exact: true }).inputValue(), "");
  assert.equal(await registration.getByRole("button", { name: "登记共享答案来源", exact: true }).isDisabled(), true);
  await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").fill(packageText);
  await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").fill("{");
  assert.equal(await registration.getByLabel("内容标题").inputValue(), "");
  assert.equal(await registration.getByRole("textbox", { name: "年级", exact: true }).inputValue(), "");
  await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").fill(packageText);
  await page.locator("summary").filter({ hasText: "登记对话答案来源" }).click();
  await page.locator("summary").filter({ hasText: "登记对话答案来源" }).click();
  assert.equal(await registration.getByPlaceholder("粘贴对话输出的结构化答案包 JSON").inputValue(), packageText);
  await upload.locator("summary").click();
  assert.equal(await upload.getAttribute("open"), null);
  await registration.getByRole("button", { name: "登记共享答案来源", exact: true }).click();
  await page.getByText("已登记统一答案来源：三年级计算专项练习", { exact: false }).waitFor();
  assert.equal(await registration.getByLabel("内容标题").inputValue(), "");
  assert.equal(await registration.getByRole("textbox", { name: "年级", exact: true }).inputValue(), "");
  console.log("grading-entry: source registered");
  assert.equal(registeredRequest.title, "三年级计算专项练习");
  assert.equal(registeredRequest.subject, "数学");
  assert.equal(registeredRequest.kind, "练习");
  assert.equal(registeredRequest.grade, "三年级");
  const registeredUpload = page.locator("#grading-upload");
  assert.equal(await registeredUpload.getAttribute("open"), "");
  assert.equal(await registeredUpload.locator("select").nth(1).inputValue(), "generated_assessment");
  assert.equal(await registeredUpload.locator("select").nth(2).inputValue(), "练习");
  assert.equal(await registeredUpload.locator("select").nth(4).inputValue(), "registered-practice");
  console.log("grading-entry: upload source prefilled");
  await page.getByTestId("teacher-grading-image-picker-library-input").setInputFiles([{ name: "shared-page.png", mimeType: "image/png", buffer: png }]);
  await registeredUpload.getByText("所选学生与答案来源适用范围不匹配，请先选择对应年级或学生。", { exact: true }).waitFor();
  assert.equal(await registeredUpload.getByRole("button", { name: "上传并批改", exact: true }).isDisabled(), true);
  console.log("grading-entry: mismatched student blocked");
  await registeredUpload.locator("select").nth(0).selectOption("s2");
  await registeredUpload.getByText("所选学生与答案来源适用范围不匹配，请先选择对应年级或学生。", { exact: true }).waitFor({ state: "detached" });
  assert.equal(await registeredUpload.getByRole("button", { name: "上传并批改", exact: true }).isEnabled(), true, await registeredUpload.innerText());
  assert.equal(uploadCount, 1);
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
    load(id) { if (id === "\0grading-entry") return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GradingWorkbench} from '/src/components/GradingWorkbench.tsx'; import '/src/styles.css'; createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement('div',{className:'app-shell',style:{padding:20}},React.createElement(GradingWorkbench,{teacherId:'t1',active:true,sources:[{submissionId:'submission1',studentId:'s1',assignmentId:'paper1',title:'加法作业',studentName:'测试学生'}],onLegacy:()=>{},onArchived:()=>{}}))));`; }
  }], define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/__workflow-api") }, server: { host: "127.0.0.1", port: 0, proxy: { "/__workflow-api": { target: f.baseUrl, rewrite: (p) => p.replace("/__workflow-api", "") } } } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/qa/page*.png", (route) => route.fulfill({ contentType: "image/svg+xml", body: pageSvg(route.request().url().includes("page2") ? 2 : 1) }));
  await page.addInitScript((token) => localStorage.setItem("junhang.web.sessionToken", token), f.tokens.teacher);
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__grading`, { timeout: 30000 });
  const imageUrls = await page.evaluate(async () => {
    const { teachingImageUrl } = await import("/src/api.ts");
    return [
      "http://127.0.0.1:8787/uploads/2026-10-09/page.jpg",
      "http://localhost:8787/uploads/page.jpg?version=1#page",
      "http://[::1]:8787/uploads/page.jpg",
      "/uploads/page.jpg",
      "https://school.example/uploads/page.jpg",
      "http://127.0.0.1:9000/uploads/page.jpg",
      "http://127.0.0.1:8787/other/page.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AA=="
    ].map(teachingImageUrl);
  });
  const webOrigin = new URL(page.url()).origin;
  assert.deepEqual(imageUrls, [
    `${webOrigin}/uploads/2026-10-09/page.jpg`,
    `${webOrigin}/uploads/page.jpg?version=1#page`,
    `${webOrigin}/uploads/page.jpg`,
    `${webOrigin}/uploads/page.jpg`,
    "https://school.example/uploads/page.jpg",
    "http://127.0.0.1:9000/uploads/page.jpg",
    "http://127.0.0.1:8787/other/page.jpg", "", ""
  ]);
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
  // StrictMode replays mount effects. A saved task must load again after the
  // first read is invalidated, without a manual selection or another grading.
  const callsBeforeReload = f.calls.length;
  await page.reload();
  await page.getByText("交换两堆小棒，总数一样", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("继续已有批改任务", { exact: true }).inputValue(), "workflow-1");
  assert.equal(f.calls.length, callsBeforeReload);
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
  assert.equal(confirmed.reviewStatus, "teacher_confirmed");
  assert.equal(confirmed.archive, null);
  await page.getByRole("heading", { name: `加法作业 · 版本 ${confirmed.revision} · 教师已确认`, exact: true }).waitFor();
  await page.getByRole("button", { name: "归档当前确认版本", exact: true }).click();
  await page.getByText("当前确认版本已归档。", { exact: true }).waitFor();
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  assert.equal(await page.getByRole("button", { name: "归档当前确认版本", exact: true }).isDisabled(), true);
  await page.reload();
  await page.getByRole("heading", { name: `加法作业 · 版本 ${confirmed.revision} · 已归档`, exact: true }).waitFor();
  await page.getByText(`版本 ${confirmed.revision} 已归档。后续修改需要重新确认并另行归档。`, { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "归档当前确认版本", exact: true }).isDisabled(), true);
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, "grading-desktop.png") });
  await page.getByLabel("批改历史版本", { exact: true }).fill("2");
  await page.getByRole("button", { name: "查看批改历史版本", exact: true }).click();
  await page.getByText("历史内容只读；恢复会新增版本，不覆盖已归档记录。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "修正识别并仅重批本题", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "恢复批改为新版本", exact: true }).click();
  await page.getByText("尚未可靠识别，不能按空白计零分", { exact: true }).waitFor();
  assert.equal((await c.get(before.id)).revision, confirmed.revision + 1);
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  assert.equal((await c.get(before.id)).archive, null);
  assert.equal(await page.getByText(`版本 ${confirmed.revision} 已归档。后续修改需要重新确认并另行归档。`, { exact: true }).count(), 0);
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
