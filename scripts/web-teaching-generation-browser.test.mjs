import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workflowHttpFixture } from "./test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowExecution } from "../apps/api/src/teaching-workflow-execution.js";
import { createTeachingWorkflowClient } from "./teaching-workflow-client.mjs";
import { demoStudents } from "@junhang/core";

// Browser plugin not available: use installed Playwright via an explicit module path.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve("apps/web");
const artifactDir = process.env.WEB_QA_OUTPUT || path.join(os.tmpdir(), "junhang-generation-web-qa");
const explanation = { concept: "进位加法", steps: ["对齐数位", "满十进一"], workedExamples: [{ prompt: "24+18", answer: "42", analysisSteps: ["个位相加满十", "十位加上进位"] }], commonMistakes: ["不要漏进位"] };
const item = (n) => ({ itemType: "calculation", prompt: `${20 + n}+18`, answer: String(38 + n), score: 5, rubric: "计算正确得5分", analysisSteps: ["先算个位", "再算十位"], knowledgePoint: "进位加法", commonMistake: "不要漏进位" });

test("rendered generation workbench shares HTTP versions, preserves conflicts and supports explanation and narrow screens", { timeout: 60000 }, async (t) => {
  let calls = 0;
  let studentSignals = [{ type: "mistake", ref: "mistake:web-qa", subject: "数学", knowledgePoint: "进位加法", studentAnswer: "29", correctAnswer: "39", cause: "漏进位" }];
  let releaseRevision;
  const heldRevision = new Promise((resolve) => { releaseRevision = resolve; });
  t.after(() => releaseRevision());
  const execution = createTeachingWorkflowExecution({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request, contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(studentSignals) } }),
    teachingExecution: { call: async (_route, messages) => {
      calls++; const sent = JSON.parse(messages[1].content);
      if (sent.instruction === "取消验证") await heldRevision;
      const result = sent.purpose === "explanation" || sent.partition?.purpose === "explanation" ? { title: "加法讲解", explanation }
        : sent.instruction ? { questions: sent.questions.map((q) => ({ ...q, prompt: "31+18", answer: "49" })) }
        : { title: "加法专项", sections: [{ title: "计算", items: [item(1), item(2)] }] };
      return { text: JSON.stringify(result), usage: { completion_tokens: 30 } };
    } }
  });
  const f = await workflowHttpFixture(t, execution);
  const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const vite = await createServer({ configFile: false, root, cacheDir: path.join(artifactDir, "vite-cache"), plugins: [react(), {
    name: "test-workbench-entry",
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__workbench") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml("/__workbench", '<html><head><title>生成工作台交互测试</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__workbench-entry"></script></body></html>'));
    }); },
    resolveId(id) { if (id === "\0workbench-entry") return id; },
    load(id) { if (id === "\0workbench-entry") return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GenerationWorkbench} from '/src/components/GenerationWorkbench.tsx'; import '/src/styles.css'; createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell',style:{padding:20}},React.createElement(GenerationWorkbench,{teacherId:'t1',students:[],active:true,onLegacy:()=>{},onMaterials:()=>{}})));`; }
  }], define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/__workflow-api") },
    server: { host: "127.0.0.1", port: 0, proxy: { "/__workflow-api": { target: f.baseUrl, rewrite: (p) => p.replace("/__workflow-api", "") } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((token) => localStorage.setItem("junhang.web.sessionToken", token), f.tokens.teacher);
  await page.goto(`${base}/__workbench`);
  await page.getByText("服务可用", { exact: true }).waitFor();
  await page.getByRole("button", { name: "新建内容", exact: true }).click();
  await page.getByLabel("具体要求", { exact: true }).fill("两道四年级进位加法专项练习");
  await page.getByLabel("题量", { exact: true }).fill("2");
  await page.getByRole("button", { name: "生成内容草稿", exact: true }).click();
  await page.getByRole("heading", { name: "加法专项", exact: true }).waitFor();
  assert.equal(await page.locator(".tw-question").count(), 2);
  assert.equal(await page.locator(".tw-answer details[open]").count(), 0);
  const firstQuestion = page.locator(".tw-question").first();
  await firstQuestion.getByText("答案与解析 · 待确认", { exact: true }).click();
  await firstQuestion.getByText("答案：39", { exact: true }).waitFor();
  assert.equal(await firstQuestion.getByText("计算正确得5分", { exact: true }).isVisible(), false);
  await firstQuestion.getByText("评分细则", { exact: true }).click();
  await firstQuestion.getByText("计算正确得5分", { exact: true }).waitFor();
  await page.getByText("查看完整生成要求", { exact: true }).click();
  await page.locator(".tw-content").getByText("两道四年级进位加法专项练习", { exact: true }).waitFor();
  await page.getByLabel("学生作答预览（隐藏答案）").check();
  assert.equal(await page.locator(".tw-answer").count(), 0);
  await page.getByLabel("学生作答预览（隐藏答案）").uncheck();
  await page.locator(".tw-question").first().getByRole("button", { name: "选择此题" }).click();
  await page.getByLabel("修改要求", { exact: true }).fill("降低第一题难度");
  await page.getByRole("button", { name: "按要求修改所选内容" }).click();
  await page.locator(".tw-question").first().getByText("31+18", { exact: true }).waitFor();
  assert.equal(await page.locator(".tw-question").nth(1).getByText("22+18", { exact: true }).count(), 1);
  await page.reload();
  await page.locator(".tw-question").first().getByText("31+18", { exact: true }).waitFor();
  await page.getByRole("button", { name: "手工编辑内容" }).click();
  await page.getByLabel("题干", { exact: true }).fill("保留的教师本地修改");
  const current = await client.get("workflow-1");
  await client.execute(current.id, { action: "confirm", operationKey: "dialogue-confirm", expectedRevision: current.revision, targetQuestionIds: ["q2"] });
  await page.getByRole("button", { name: "保存内容修改" }).click();
  await page.getByText("版本或操作状态已变化。你的编辑已保留，请刷新后比较。").waitFor();
  assert.equal(await page.getByLabel("题干", { exact: true }).inputValue(), "保留的教师本地修改");
  await page.getByRole("button", { name: "刷新当前版本" }).click();
  await page.getByText(/当前版本已变化；编辑已保留/).waitFor();
  assert.equal(await page.getByRole("button", { name: "保存内容修改" }).isDisabled(), true);
  await page.getByRole("button", { name: "放弃本地编辑" }).click();
  await page.getByRole("button", { name: "手工编辑内容" }).click();
  await page.getByLabel("题干", { exact: true }).fill("32+18");
  await page.getByLabel("标准答案", { exact: true }).fill("50");
  await page.getByRole("button", { name: "保存内容修改" }).click();
  await page.locator(".tw-question").first().getByText("32+18", { exact: true }).waitFor();
  const manuallyEdited = await client.get(current.id);
  assert.equal(manuallyEdited.content.questions[0].answer, "50");
  assert.equal(manuallyEdited.content.questions[1].reviewedByTeacher, true);
  assert.equal(calls, 2);
  await page.getByRole("button", { name: "已逐题核对，确认全部" }).click();
  await page.getByText("已记录你的内容确认。", { exact: true }).waitFor();
  assert.equal((await client.get(current.id)).content.questions.every((q) => q.reviewedByTeacher), true);
  await page.getByLabel("查看版本", { exact: true }).fill("2");
  await page.getByRole("button", { name: "查看历史版本", exact: true }).click();
  await page.getByText("历史内容只读。恢复会新增版本；当前最新版本不会被覆盖。").waitFor();
  assert.equal(await page.getByRole("button", { name: "手工编辑内容" }).isDisabled(), true);
  await page.getByRole("button", { name: "刷新当前版本" }).click();
  await page.getByRole("button", { name: "手工编辑内容" }).waitFor();
  // Export fixtures verify UI gates only; PDF rendering and assignment transactions have separate checks.
  let layoutOk = false, printCalls = 0;
  await page.route("**/api/teaching/workflows/*/assignment", (route) => route.fulfill({ json: { ok: true, assignment: { id: "preview-only", revision: 5, replayed: false } } }));
  await page.route("**/api/assessments/preview-only/draft-export", (route) => route.fulfill({ json: { ok: true, asset: { title: "教师预览", url: "/fixture-preview.pdf" }, layoutValidation: { ok: layoutOk, issues: layoutOk ? [] : ["测试排版未通过"] } } }));
  await page.route("**/api/assessments/preview-only/print-export", (route) => { printCalls++; return route.fulfill({ json: { ok: true, asset: { title: "学生卷", url: "/fixture-student.pdf" }, analysisAsset: { title: "解析卷", url: "/fixture-analysis.pdf" } } }); });
  await page.getByRole("button", { name: "生成 PDF 预览", exact: true }).click();
  await page.getByText("测试排版未通过", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "导出学生卷与解析卷", exact: true }).isDisabled(), true);
  assert.equal(printCalls, 0);
  layoutOk = true;
  await page.getByRole("button", { name: "生成 PDF 预览", exact: true }).click();
  await page.getByRole("button", { name: "导出学生卷与解析卷", exact: true }).click();
  await page.getByRole("link", { name: "学生卷", exact: true }).waitFor();
  await page.getByRole("link", { name: "解析卷", exact: true }).waitFor();
  assert.equal(printCalls, 1);
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "generation-desktop.png"), fullPage: false });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "内容成果", exact: true }).click();
    assert.ok(await page.locator(".tw-content").evaluate((el) => el.getBoundingClientRect().width) >= viewport.width - 100);
    await page.locator(".tw-question").first().getByRole("button", { name: "选择此题", exact: true }).click();
    await page.getByLabel("修改要求", { exact: true }).fill("iPad 尚未提交的修改");
    await page.getByRole("button", { name: "内容成果", exact: true }).click();
    await page.getByRole("button", { name: "修改与版本", exact: true }).click();
    assert.equal(await page.getByLabel("修改要求", { exact: true }).inputValue(), "iPad 尚未提交的修改");
    await page.getByLabel("修改要求", { exact: true }).fill("");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole("button", { name: "内容成果", exact: true }).click();
  await page.screenshot({ path: path.join(artifactDir, "generation-ipad.png"), fullPage: false });
  await page.setViewportSize({ width: 1480, height: 980 });
  await page.getByRole("button", { name: "查看历史版本", exact: true }).click();
  await page.getByRole("button", { name: "恢复为新版本", exact: true }).click();
  await page.locator(".tw-question").first().getByText("21+18", { exact: true }).waitFor();
  const restored = await client.get(current.id);
  assert.equal(restored.revision, 7);
  assert.equal(restored.content.questions.every((q) => !q.reviewedByTeacher), true);
  assert.equal(await page.getByRole("button", { name: "生成 PDF 预览", exact: true }).isDisabled(), true);
  await page.getByLabel("修改要求", { exact: true }).fill("取消验证");
  await page.getByRole("button", { name: "按要求修改所选内容" }).click();
  await page.getByRole("button", { name: "取消本次处理", exact: true }).click();
  await page.locator(".tw-content").getByText(/版本 7 · 已取消/).waitFor();
  releaseRevision();
  await page.reload();
  await page.locator(".tw-content").getByText(/版本 7 · 已取消/).waitFor();
  await page.getByLabel("查看版本", { exact: true }).fill("2");
  await page.getByRole("button", { name: "查看历史版本", exact: true }).click();
  await page.getByText("历史内容只读。恢复会新增版本；当前最新版本不会被覆盖。").waitFor();
  assert.equal(await page.getByRole("button", { name: "恢复为新版本", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "新建内容", exact: true }).click();
  await page.getByLabel("教学用途", { exact: true }).selectOption("explanation");
  await page.getByLabel("具体要求", { exact: true }).fill("用例题讲解进位加法");
  await page.getByRole("button", { name: "生成内容草稿", exact: true }).click();
  await page.getByRole("heading", { name: "加法讲解", exact: true }).waitFor();
  assert.equal(await page.locator(".tw-question").count(), 0);
  await page.getByRole("button", { name: "确认整份讲解" }).click();
  await page.getByText("内容已确认", { exact: true }).waitFor();
  assert.equal(calls, 4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "修改与版本", exact: true }).click();
  await page.getByRole("button", { name: "手工编辑内容" }).click();
  await page.getByLabel("概念", { exact: true }).fill("用小棒理解进位");
  await page.getByRole("button", { name: "内容成果", exact: true }).click();
  await page.getByRole("button", { name: "修改与版本", exact: true }).click();
  assert.equal(await page.getByLabel("概念", { exact: true }).inputValue(), "用小棒理解进位");
  await page.screenshot({ path: path.join(artifactDir, "generation-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "保存内容修改", exact: true }).click();
  await page.getByRole("button", { name: "内容成果", exact: true }).click();
  await page.getByRole("heading", { name: "用小棒理解进位", exact: true }).waitFor();
  await page.getByText("待教师确认", { exact: true }).waitFor();
  assert.equal(calls, 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // Change server-owned evidence, rather than mocking the conflict response.
  await page.setViewportSize({ width: 1480, height: 980 });
  await page.getByRole("button", { name: "新建内容", exact: true }).click();
  await page.getByLabel("教学用途", { exact: true }).selectOption("focused");
  await page.getByLabel("具体要求", { exact: true }).fill("两道四年级进位加法专项练习");
  await page.getByLabel("题量", { exact: true }).fill("2");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/teaching/workflows") && response.request().method() === "POST");
  await page.getByRole("button", { name: "生成内容草稿", exact: true }).click();
  const created = await (await createdResponse).json();
  assert.equal(created.workflow.status, "ready_for_review", JSON.stringify(created));
  await page.getByRole("heading", { name: "加法专项", exact: true }).waitFor();
  await page.getByRole("button", { name: "确认所选题目", exact: true }).click();
  await page.getByText("已记录你的内容确认。", { exact: true }).waitFor();
  const evidenceBefore = await client.get("workflow-3");
  await page.getByRole("button", { name: "手工编辑内容", exact: true }).click();
  await page.getByLabel("题干", { exact: true }).fill("错题依据变化时仍保留的本地编辑");
  studentSignals = [{ ...studentSignals[0], cause: "教师重新核对：抄错数字" }];
  const mutations = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/teaching/workflows")) mutations.push(request.postDataJSON());
  });
  const rejectedSave = page.waitForResponse((response) => response.url().endsWith("/workflow-3/commands") && response.status() === 409);
  await page.getByRole("button", { name: "保存内容修改", exact: true }).click();
  assert.equal((await (await rejectedSave).json()).error, "WORKFLOW_EVIDENCE_CHANGED");
  const evidenceMessage = "来源依据（如错题、教材或作答记录）已变化。你的本地编辑仍保留，旧版本和已有确认可查看。刷新不会更新旧草稿的依据；请核对当前依据后，决定是否另建任务并重新复核。";
  assert.equal(await page.getByRole("status").last().innerText(), evidenceMessage);
  assert.equal(await page.getByLabel("题干", { exact: true }).inputValue(), "错题依据变化时仍保留的本地编辑");
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/teaching/workflows/workflow-3") && response.request().method() === "GET");
  await page.getByRole("button", { name: "刷新当前版本", exact: true }).click(); await refreshed;
  assert.equal(await page.getByRole("status").last().innerText(), evidenceMessage);
  assert.equal(await page.getByLabel("题干", { exact: true }).inputValue(), "错题依据变化时仍保留的本地编辑");
  assert.deepEqual(await client.get("workflow-3"), evidenceBefore);
  assert.equal((await client.get("workflow-3", evidenceBefore.revision)).content.questions[0].reviewedByTeacher, true);
  await page.screenshot({ path: path.join(artifactDir, "generation-evidence-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "修改与版本", exact: true }).click();
  assert.equal(await page.getByLabel("题干", { exact: true }).inputValue(), "错题依据变化时仍保留的本地编辑");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifactDir, "generation-evidence-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "放弃本地编辑", exact: true }).click();
  await page.getByLabel("查看版本", { exact: true }).fill("1");
  await page.getByRole("button", { name: "查看历史版本", exact: true }).click();
  await page.getByText("历史内容只读。恢复会新增版本；当前最新版本不会被覆盖。").waitFor();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].expectedRevision, evidenceBefore.revision);
  assert.equal(calls, 5);
  assert.deepEqual(errors, []); assert.equal(await page.locator("vite-error-overlay").count(), 0);
  console.log(JSON.stringify({ browser: "Playwright (Browser plugin not available)", viewports: ["1480x980", "390x844"], screenshots: artifactDir, model: "synthetic only", database: "in-memory only", calls }));
});

test("running Web entry renders login without blank page or framework errors", { timeout: 20000 }, async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.WEB_BASE_URL || "http://127.0.0.1:5173/");
  await page.locator("#root").getByText(/君航/).first().waitFor();
  assert.ok((await page.locator("body").innerText()).length > 50);
  assert.deepEqual(errors, []); assert.equal(await page.locator("vite-error-overlay").count(), 0);
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "web-running.png"), fullPage: false });
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), screenshot: path.join(artifactDir, "web-running.png") }));
});

test("actual teacher page retains legacy generation when workflow service is unavailable", { timeout: 30000 }, async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const teacher = { id: "web-qa-teacher", displayName: "交互测试教师", phone: "test-only", role: "teacher", status: "active" };
  const empty = { ok: true, teacher, teachers: [teacher], sessionToken: "synthetic-no-server-session",
    students: [], tasks: [], assignments: [], classroomDevices: [], classroomBroadcasts: [], dictationTasks: [], readingTasks: [],
    corrections: [], logs: [], reports: [], submissions: [], workbenches: [], jobs: [], assets: [], sources: [], events: [], modelRuns: [],
    index: null, database: { ok: true }, ai: { features: [], generatedAt: "2026-09-17", mode: "test" } };
  let serviceStatus = 404;
  // Intercept all API calls: synthetic login never submits credentials or writes to the running database.
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/teaching/workflows") return route.fulfill(serviceStatus === 404
      ? { status: 404, contentType: "text/html", body: "<p>Route not found</p>" }
      : { status: 503, json: { ok: false, error: "WORKFLOW_UNAVAILABLE" } });
    return route.fulfill({ json: empty });
  });
  await page.goto(process.env.WEB_BASE_URL || "http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "登录同步真实数据", exact: true }).click();
  await page.getByText("教师端已登录：交互测试教师", { exact: true }).waitFor();
  await page.getByRole("button", { name: "生成打印", exact: true }).click();
  const workbench = page.getByRole("region", { name: "持续生成工作台", exact: true });
  await workbench.getByText("服务暂未启用", { exact: true }).waitFor();
  await workbench.getByRole("button", { name: "新建内容", exact: true }).click();
  assert.equal(await workbench.getByRole("button", { name: "生成内容草稿", exact: true }).isDisabled(), true);
  serviceStatus = 503;
  const unavailable = page.waitForResponse((r) => r.url().includes("/api/teaching/workflows") && r.status() === 503);
  await workbench.getByRole("button", { name: "重新检查", exact: true }).click(); await unavailable;
  await workbench.getByRole("button", { name: "原有生成与打印", exact: true }).click();
  assert.equal(await workbench.isVisible(), false);
  await page.locator(".generation-workbench-shell").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "生成与继续修改", exact: true }).click();
  await workbench.waitFor({ state: "visible" });
  assert.equal(await page.locator(".generation-workbench-shell").isVisible(), false);
  assert.deepEqual(errors, []);
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "teacher-unavailable.png"), fullPage: false });
});

test("teacher daily UI filters task evidence, preserves material inputs and shows actual profile state", { timeout: 60000 }, async (t) => {
  const vite = await createServer({ configFile: false, root, cacheDir: path.join(artifactDir, "daily-vite"), plugins: [react()], server: { host: "127.0.0.1", port: 0 } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(10000);
  const errors = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  const teacher = { id: "daily-teacher", displayName: "日常界面测试教师", role: "teacher", status: "active" };
  const students = [
    { ...demoStudents[0], id: "daily-a", displayName: "学生甲", canReceiveNewWork: true, publishedProfileSnapshot: { draftStatus: "review_required", period: { label: "11月记录" } } },
    { ...demoStudents[0], id: "daily-b", displayName: "学生乙", canReceiveNewWork: true, publishedProfileSnapshot: { draftStatus: "published", period: { label: "10月记录" } } }
  ];
  const task = (id, studentId, date, status = "待完成") => ({ id, studentId, studentName: studentId === "daily-a" ? "学生甲" : "学生乙", title: `任务${id}`, subject: "数学", status, minutes: 10, dueAt: date, dueLabel: "今日", source: "教师", knowledgePoints: [], summary: "简要内容", description: `完整任务说明${id}` });
  const tasks = [task("a-today", "daily-a", "2026-11-10T06:00:00Z"), task("a-done", "daily-a", "2026-11-10T06:00:00Z", "已完成"),
    ...Array.from({ length: 10 }, (_, i) => task(`a-history-${i}`, "daily-a", "2026-10-01T06:00:00Z")), task("unknown", "daily-a", null), task("b-only", "daily-b", "2026-11-10T06:00:00Z")];
  const base = { ok: true, teacher, teachers: [teacher], sessionToken: "synthetic-intercept-only", students, tasks, assignments: [], classroomDevices: [], classroomBroadcasts: [], dictationTasks: [], readingTasks: [],
    corrections: [], logs: [{ id: "other-log", time: "今天", feature: "ai-qa", action: "其他学生的记录", result: "不能归给当前学生", actorType: "student" }], reports: [], submissions: [], workbenches: [], jobs: [], assets: [], events: [], modelRuns: [], index: null,
    sources: [{ id: "source-one", title: "六年级分数练习参考", summary: "分数除法", subject: "数学", grade: "六年级", reviewStatus: "PENDING", chunkCount: 1, allowedForGeneration: false }], database: { ok: true }, ai: { features: [], mode: "test" } };
  await page.route("**/api/**", route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET" && url.pathname !== "/api/teacher-login") writes.push(url.pathname);
    if (url.pathname === "/api/teaching/workflows") return route.fulfill({ status: 404, body: "Route absent" });
    return route.fulfill({ json: base });
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/`);
  await page.getByRole("button", { name: "登录同步真实数据", exact: true }).click();
  await page.getByRole("heading", { name: "日常工作入口", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "展示与互动控制台", exact: true }).isVisible(), false);
  await page.getByRole("button", { name: "今日任务", exact: true }).click();
  const list = page.locator(".teacher-task-list");
  assert.equal(await list.locator(".daily-task-card").count(), 10);
  await list.getByRole("button", { name: "下一页", exact: true }).click();
  await list.getByText(/日期未记录/).last().waitFor();
  await list.getByLabel("任务日期", { exact: true }).fill("2026-11-10");
  assert.equal(await list.locator(".daily-task-card").count(), 2);
  assert.equal(await list.getByText("完整任务说明a-today", { exact: true }).isVisible(), false);
  await list.getByText("任务a-today", { exact: true }).click();
  await list.getByText("完整任务说明a-today", { exact: true }).waitFor();
  const taskForm = page.locator("section").filter({ has: page.getByRole("heading", { name: "生成今日任务", exact: true }) });
  await taskForm.getByRole("combobox").first().selectOption("daily-b");
  assert.equal(await list.locator(".daily-task-card").count(), 1);
  await list.getByText("任务b-only", { exact: true }).waitFor();
  await list.getByLabel("任务学生范围", { exact: true }).selectOption("all");
  await list.getByLabel("任务完成状态", { exact: true }).selectOption("已完成");
  assert.equal(await list.locator(".daily-task-card").count(), 1);
  await list.getByText("任务a-done", { exact: true }).waitFor();
  await page.getByRole("button", { name: "教材资料", exact: true }).click();
  assert.equal(await page.getByTestId("content-index-panel").isVisible(), false);
  await page.getByRole("button", { name: "资料来源与复核", exact: true }).click();
  await page.getByLabel("检索资料来源", { exact: true }).fill("没有的关键词");
  assert.equal(await page.getByText("六年级分数练习参考", { exact: true }).isVisible(), false);
  await page.getByLabel("检索资料来源", { exact: true }).fill("分数");
  await page.getByText("六年级分数练习参考", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导入与索引管理", exact: true }).click();
  await page.getByTestId("content-material-file-input").setInputFiles({ name: "合成讲义.txt", mimeType: "text/plain", buffer: Buffer.from("合成测试资料") });
  await page.getByText("已选择 1 份资料", { exact: true }).waitFor();
  await page.getByRole("button", { name: "教材检索", exact: true }).click();
  await page.getByRole("button", { name: "导入与索引管理", exact: true }).click();
  await page.getByText("已选择 1 份资料", { exact: true }).waitFor();
  await page.getByRole("button", { name: "学生档案", exact: true }).click();
  await page.getByRole("combobox", { name: /^归档学生/ }).selectOption("daily-a");
  await page.getByText("当前版本发布后可见", { exact: true }).waitFor();
  const overview = page.locator(".archive-overview");
  await overview.getByText("档案范围：11月记录", { exact: true }).waitFor();
  assert.equal(await overview.getByText("其他学生的记录", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector(".archive-overview").getBoundingClientRect().top < document.querySelector(".student-profile-workspace").getBoundingClientRect().top), true);
  await page.getByRole("combobox", { name: /^归档学生/ }).selectOption("daily-b");
  await page.getByText("当前保存版本已发布", { exact: true }).waitFor();
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "daily-profile-desktop.png") });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    for (const module of ["学生档案", "今日任务", "教材资料", "工作台"]) {
      await page.getByRole("button", { name: module, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${module} ${viewport.width}`);
    }
    assert.ok(await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().height) < 150, "iPad navigation should leave room for teaching content");
  }
  await page.screenshot({ path: path.join(artifactDir, "daily-home-ipad.png") });
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
});
