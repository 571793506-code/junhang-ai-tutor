import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Browser plugin not available. Use the existing Playwright/Chrome runtime.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

test("archive history is read only, keeps score groups and selected detail after reload, and handles empty/error states", { timeout: 45000 }, async t => {
  const vite = await createServer({ configFile: false, root: path.resolve("apps/web"),
    cacheDir: path.join(os.tmpdir(), "junhang-history-vite"), plugins: [react(), {
      name: "history-browser-fixture",
      configureServer(server) { server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__history")) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await server.transformIndexHtml("/__history", '<html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/@id/__x00__history-entry"></script></body></html>'));
      }); },
      resolveId(id) { if (id === "\0history-entry") return id; },
      load(id) { if (id === "\0history-entry") return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GradingArchiveHistory} from '/src/components/GradingArchiveHistory.tsx'; import '/src/styles.css'; createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(GradingArchiveHistory,{active:true})));`; }
    }], define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/__history-api") }, server: { host: "127.0.0.1", port: 0 } });
  await vite.listen(); t.after(() => vite.close());
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [], writes = [], listQueries = [];
  page.on("pageerror", e => errors.push(e.message));
  const row = { id: "a1", submissionId: "a1", title: "合成测试卷", studentName: "测试学生", subject: "数学", kind: "试卷",
    archivedAt: "2026-11-02T12:27:57.997Z", status: "archived", score: 79, summary: "过时AI摘要不应展示",
    submittedAt: "2026-10-29T08:00:00Z", questionCount: 2, questions: [
      { id: "q1", questionNo: "1", prompt: "长题干独占一行", studentAnswer: "减法；86", correctAnswer: "减法；69", score: 1, maxScore: 2, status: "partial", reviewedByTeacher: true, teacherNote: "首次作答，订正另记", explanation: "按从左到右的顺序计算。" },
      { id: "q31", questionNo: "31", prompt: "附加题", score: 0, maxScore: 10, status: "wrong", reviewedByTeacher: true }
    ].reverse(), pages: [], scoreGroups: [{ id: "base", label: "基础分", score: 79, maxScore: 100 }, { id: "bonus", label: "附加分", score: 0, maxScore: 10 }] };
  let fail = false, oldServer = false;
  await page.route("**/__history-api/api/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== "GET") writes.push(req.method());
    if (fail) return route.fulfill({ status: 503, json: { ok: false } });
    if (url.pathname.endsWith("/a1")) return route.fulfill({ json: { ok: true, workbench: row } });
    if (url.pathname.endsWith("/draft")) return route.fulfill({ json: { ok: true, workbench: { ...row, submissionId: "draft", archivedAt: null } } });
    listQueries.push(url.searchParams.get("reviewState"));
    return route.fulfill({ json: { ok: true, ...(oldServer ? {} : { reviewState: "archived" }), workbenches: url.searchParams.get("search") === "无记录" ? [] : [row],
      pagination: { page: 1, total: 1, totalPages: 1, hasMore: false }, summary: {} } });
  });
  const base = `http://127.0.0.1:${vite.httpServer.address().port}/__history`;
  await page.goto(base);
  const history = page.getByRole("region", { name: "已归档批改记录", exact: true });
  await history.getByRole("button", { name: /测试学生.*合成测试卷/ }).click();
  await history.getByRole("heading", { name: "教师最终评分", exact: true }).waitFor();
  assert.deepEqual(await history.getByRole("navigation", { name: "查看归档题目" }).getByRole("button").allTextContents(), ["第 1 题 · 部分正确", "第 31 题 · 错误"]);
  await history.getByRole("heading", { name: "第 1 题 · 部分正确 · 1 / 2 分", exact: true }).waitFor();
  assert.match(await history.innerText(), /基础分.*79\s*\/\s*100/s);
  assert.match(await history.innerText(), /附加分.*0\s*\/\s*10/s);
  assert.equal(await history.getByText(row.summary, { exact: true }).count(), 0);
  assert.equal(await history.locator('textarea, input[type="number"], input[type="file"]').count(), 0);
  assert.equal(await history.getByRole("button", { name: /归档|确认|保存|重批/ }).count(), 0);
  await history.getByRole("button", { name: "第 1 题 · 部分正确", exact: true }).click();
  await history.getByText("首次作答，订正另记", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("gradingArchive"), "a1");
  await page.reload();
  await history.getByRole("heading", { name: "教师最终评分", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await history.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await history.getByLabel("检索归档记录").fill("无记录");
  await history.getByRole("button", { name: "查询", exact: true }).click();
  await history.getByText("没有找到已归档记录。", { exact: true }).waitFor();
  fail = true;
  await history.getByRole("button", { name: "刷新记录", exact: true }).click();
  await history.getByText("归档列表加载失败，请稍后重试。", { exact: true }).waitFor();
  fail = false; oldServer = true;
  await history.getByRole("button", { name: "刷新记录", exact: true }).click();
  await history.getByText("当前服务尚未支持归档历史，请更新服务后重试。", { exact: true }).waitFor();
  oldServer = false;
  await page.goto(`${base}?gradingArchive=draft`);
  await history.getByText("此记录尚未完成独立归档，请在待复核工作台处理。", { exact: true }).waitFor();
  assert.equal(await history.getByRole("heading", { name: "教师最终评分", exact: true }).count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  assert.ok(listQueries.length >= 4 && listQueries.every(state => state === "archived"));
});
