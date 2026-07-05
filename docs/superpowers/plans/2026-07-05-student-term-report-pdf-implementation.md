# Student Term Report PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add teacher-only midterm/final PDF report generation, download, and manual WeChat-sent status inside the student profile module while keeping weekly/monthly online archive publishing unchanged.

**Architecture:** Reuse existing `StudentReport` for term report state and `GeneratedAsset` for generated PDF assets to avoid a database migration in the first release. Add a focused API helper for term report draft, role-safe mapping, HTML/PDF content, and WeChat copy text. Wire server routes for draft, PDF generation, mark-sent, and list; then update Web teacher UI and student status display.

**Tech Stack:** Node.js ES modules, Express API, Prisma, existing Chrome HTML-to-PDF renderer, React/TypeScript Web, Node built-in test runner, existing `jh.cmd` verification commands.

---

## File Structure

- Create `apps/api/src/student-term-report.js`
  - Owns term report draft building, teacher/public report mapping, PDF HTML generation, status transitions, and WeChat message text.
- Create `apps/api/src/student-term-report.test.mjs`
  - Tests role filtering, draft shape, HTML safety, and status visibility.
- Modify `apps/api/src/server.js`
  - Add routes:
    - `POST /api/students/:studentId/term-report/draft`
    - `POST /api/students/:studentId/term-report/:reportId/pdf`
    - `POST /api/students/:studentId/term-report/:reportId/mark-sent`
    - `GET /api/students/:studentId/term-reports`
  - Extend `/api/bootstrap` and `/api/students/:studentId/profile` report mapping so students only see sent manual status.
- Modify `packages/core/src/index.d.ts`
  - Extend `StudentReportCard` with optional term-report fields used by Web.
- Modify `apps/web/src/api.ts`
  - Add typed functions for term report draft, PDF generation, mark-sent, and list.
- Modify `apps/web/src/main.tsx`
  - Split teacher student profile module into weekly/monthly online archive and midterm/final PDF report panels.
  - Add student-side sent-status display without PDF URL or report body.
- Modify `apps/web/src/styles.css`
  - Add focused styles for the term report panel and archive status cards.
- Modify `docs/14-api-contract.md` and `skills/student-profile/SKILLS.md`
  - Document term report API and visibility boundary.

## Task 1: Term Report Helper With Tests

**Files:**
- Create: `apps/api/src/student-term-report.js`
- Create: `apps/api/src/student-term-report.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `apps/api/src/student-term-report.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTermReportDraft,
  mapTermReportForRole,
  normalizeTermReportType,
  renderTermReportHtml,
  termReportTypeToDb
} from "./student-term-report.js";

const student = {
  id: "stu_1",
  displayName: "张思源",
  grade: "五年级",
  className: "周六上午班",
  textbookVersion: "人教版",
  reports: [],
  tasks: [{ id: "task_1", title: "数学应用题训练", status: "COMPLETED", subject: { name: "数学" }, createdAt: new Date("2026-06-20T08:00:00.000Z") }],
  submissions: [{
    id: "sub_1",
    status: "REVIEWED",
    submittedAt: new Date("2026-06-21T08:00:00.000Z"),
    assignment: { title: "期末复习小测", subject: { name: "数学" }, metadata: {} },
    grading: { score: 86, result: { summary: "应用题审题有进步。", archiveEligible: true, confidence: "high" } }
  }],
  mistakes: [{
    id: "mistake_1",
    subject: "数学",
    prompt: "两步应用题",
    cause: "单位换算遗漏",
    masteryResolved: false,
    createdAt: new Date("2026-06-22T08:00:00.000Z"),
    knowledgePoint: { name: "两步应用题" },
    metadata: { nextPractice: "先圈单位，再列式。" }
  }],
  behaviorEvents: [],
  qaSessions: [],
  voiceInteractions: []
};

test("normalizeTermReportType supports only midterm and final", () => {
  assert.equal(normalizeTermReportType("midterm"), "midterm");
  assert.equal(normalizeTermReportType("final"), "final");
  assert.equal(normalizeTermReportType("weekly"), "final");
});

test("termReportTypeToDb maps to existing StudentReport enum values", () => {
  assert.equal(termReportTypeToDb("midterm"), "MIDTERM");
  assert.equal(termReportTypeToDb("final"), "FINAL");
});

test("buildTermReportDraft creates teacher PDF only draft", () => {
  const draft = buildTermReportDraft(student, { reportType: "final", periodLabel: "2026春季期末", now: new Date("2026-07-05T12:00:00.000Z") });

  assert.equal(draft.reportType, "final");
  assert.equal(draft.status, "draft");
  assert.equal(draft.visibility, "teacher_pdf_only");
  assert.equal(draft.periodLabel, "2026春季期末");
  assert.ok(draft.sections.overview.text.includes("张思源"));
  assert.ok(draft.sections.subjects.length >= 3);
  assert.ok(draft.wechatMessage.includes("成长报告"));
});

test("mapTermReportForRole hides PDF and body from student until sent", () => {
  const report = {
    id: "report_1",
    studentId: "stu_1",
    student: { displayName: "张思源" },
    type: "FINAL",
    periodKey: "2026-final",
    title: "张思源 2026春季期末成长报告",
    content: "教师确认正文",
    createdAt: new Date("2026-07-05T12:00:00.000Z"),
    metadata: {
      termReport: {
        reportType: "final",
        status: "pdf_ready",
        periodLabel: "2026春季期末",
        pdfUrl: "/generated/report.pdf",
        teacherEditedText: "教师确认正文",
        wechatMessage: "您好，请查收。"
      }
    }
  };

  assert.equal(mapTermReportForRole(report, "student"), null);

  report.metadata.termReport.status = "sent_manually";
  const studentView = mapTermReportForRole(report, "student");
  assert.equal(studentView.status, "已发送");
  assert.equal(studentView.summary, "老师已发送阶段报告给家长");
  assert.equal(studentView.pdfUrl, undefined);
  assert.equal(studentView.teacherEditedText, undefined);

  const teacherView = mapTermReportForRole(report, "teacher");
  assert.equal(teacherView.pdfUrl, "/generated/report.pdf");
  assert.equal(teacherView.wechatMessage, "您好，请查收。");
});

test("renderTermReportHtml escapes edited text and includes no scripts", () => {
  const draft = buildTermReportDraft(student, { reportType: "midterm", periodLabel: "2026春季期中" });
  const html = renderTermReportHtml(student, {
    id: "report_2",
    title: "张思源 <期中>",
    content: "老师确认 <script>alert(1)</script>",
    metadata: { termReport: draft }
  });

  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("期中成长报告"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/student-term-report.test.mjs`

Expected: FAIL with module/function not found.

- [ ] **Step 3: Implement helper**

Create `apps/api/src/student-term-report.js` with:

```js
const SUBJECTS = ["语文", "数学", "英语"];

export function normalizeTermReportType(value) {
  return value === "midterm" ? "midterm" : "final";
}

export function termReportTypeToDb(value) {
  return normalizeTermReportType(value) === "midterm" ? "MIDTERM" : "FINAL";
}

export function dbTermReportTypeToClient(value) {
  return value === "MIDTERM" ? "midterm" : "final";
}

export function termReportTypeLabel(value) {
  return normalizeTermReportType(value) === "midterm" ? "期中成长报告" : "期末成长报告";
}

export function buildTermReportDraft(student, options = {}) {
  const reportType = normalizeTermReportType(options.reportType);
  const periodLabel = String(options.periodLabel || defaultPeriodLabel(reportType, options.now)).trim();
  const subjects = SUBJECTS.map((subject) => subjectSection(student, subject));
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  const title = `${student.displayName} ${periodLabel}${termReportTypeLabel(reportType)}`;
  return {
    reportType,
    status: "draft",
    visibility: "teacher_pdf_only",
    periodLabel,
    title,
    generatedAt: new Date().toISOString(),
    sections: {
      overview: {
        text: `${student.displayName}本阶段学习记录已完成汇总，建议重点关注${focus.subject}的持续巩固和订正闭环。`
      },
      subjects,
      correctionLoop: correctionLoop(student),
      learningHabits: learningHabits(student),
      progress: progressList(student),
      nextActions: nextActions(subjects),
      parentSuggestions: parentSuggestions(subjects)
    },
    wechatMessage: `您好，这是${student.displayName}同学${periodLabel}${termReportTypeLabel(reportType)}，请查收。`
  };
}

export function mapTermReportForRole(report, role = "student") {
  const metadata = safeObject(report.metadata);
  const termReport = safeObject(metadata.termReport);
  if (!termReport.reportType) return null;
  const sent = termReport.status === "sent_manually";
  const base = {
    id: report.id,
    studentId: report.studentId || "",
    studentName: report.student?.displayName || "",
    period: termReport.reportType === "midterm" ? "期中" : "期末",
    reportType: termReport.reportType,
    periodLabel: termReport.periodLabel || report.periodKey,
    title: report.title,
    summary: sent ? "老师已发送阶段报告给家长" : report.content,
    status: sent ? "已发送" : termReport.status === "pdf_ready" ? "PDF已生成" : "草稿",
    sentManuallyAt: termReport.sentManuallyAt || null,
    highlights: [],
    concerns: [],
    nextActions: []
  };
  if (role !== "teacher") return sent ? base : null;
  return {
    ...base,
    summary: report.content,
    teacherEditedText: termReport.teacherEditedText || report.content,
    pdfUrl: termReport.pdfUrl || null,
    pdfTitle: termReport.pdfTitle || null,
    pdfAssetId: termReport.pdfAssetId || null,
    wechatMessage: termReport.wechatMessage || "",
    statusRaw: termReport.status || "draft",
    draft: termReport.draft || termReport
  };
}

export function renderTermReportHtml(student, report) {
  const metadata = safeObject(report.metadata);
  const termReport = safeObject(metadata.termReport);
  const draft = safeObject(termReport.draft || termReport);
  const sections = safeObject(draft.sections);
  const subjects = Array.isArray(sections.subjects) ? sections.subjects : [];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title)}</title>
<style>
@page { size: A4; margin: 16mm 15mm; }
body { margin: 0; color: #1f2a36; font-family: "SimSun", "Microsoft YaHei", Arial, sans-serif; font-size: 10.5pt; line-height: 1.58; }
.cover { min-height: 210mm; display: grid; align-content: center; gap: 16px; border-bottom: 4px solid #226b8f; }
.badge { color: #226b8f; font-weight: 700; letter-spacing: 0; }
h1 { margin: 0; font-size: 24pt; font-family: "SimHei", "Microsoft YaHei", sans-serif; }
h2 { margin: 14px 0 6px; font-size: 15pt; color: #164b65; border-bottom: 1px solid #c8d8e3; padding-bottom: 4px; }
h3 { margin: 8px 0 4px; font-size: 12pt; color: #1f2a36; }
.meta { display: grid; gap: 5px; color: #526575; }
.section { break-inside: avoid; margin: 0 0 8px; }
.card { border: 1px solid #d8e2ea; border-radius: 6px; padding: 10px 12px; margin: 7px 0; background: #fbfdff; }
ul { margin: 5px 0 0 18px; padding: 0; }
li { margin: 2px 0; }
.foot { margin-top: 12px; color: #6b7a86; font-size: 9pt; }
</style>
</head>
<body>
<section class="cover">
  <div class="badge">君航 AI 助教 · 教师确认版</div>
  <h1>${escapeHtml(report.title)}</h1>
  <div class="meta">
    <span>学生：${escapeHtml(student.displayName || "")}</span>
    <span>年级：${escapeHtml(student.grade || "")}</span>
    <span>班级：${escapeHtml(student.className || "")}</span>
    <span>周期：${escapeHtml(termReport.periodLabel || report.periodKey || "")}</span>
  </div>
</section>
<section>
  <h2>一、综合成长摘要</h2>
  <div class="card">${paragraphs(termReport.teacherEditedText || report.content || sections.overview?.text)}</div>
  <h2>二、学科表现</h2>
  ${subjects.map((item) => `<div class="section card"><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.summary || "")}</p>${list("优势", item.highlights)}${list("关注点", item.concerns)}</div>`).join("")}
  <h2>三、错题与订正闭环</h2>
  ${listBlock(sections.correctionLoop)}
  <h2>四、学习习惯与阶段进步</h2>
  ${listBlock([...(sections.learningHabits || []), ...(sections.progress || [])])}
  <h2>五、下阶段建议</h2>
  ${listBlock(sections.nextActions)}
  <h2>六、家长配合建议</h2>
  ${listBlock(sections.parentSuggestions)}
  <div class="foot">本报告由教师确认后生成，供家长通过微信私聊查收。</div>
</section>
</body>
</html>`;
}

function defaultPeriodLabel(reportType, nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date();
  const year = now.getFullYear();
  const term = now.getMonth() + 1 >= 9 || now.getMonth() + 1 <= 1 ? "秋季" : "春季";
  return `${year}${term}${reportType === "midterm" ? "期中" : "期末"}`;
}

function subjectSection(student, subject) {
  const tasks = (student.tasks || []).filter((item) => subjectFromValue(item.subject?.name || item.metadata?.subject) === subject);
  const submissions = (student.submissions || []).filter((item) => subjectFromValue(item.assignment?.subject?.name || item.assignment?.metadata?.subject) === subject);
  const mistakes = (student.mistakes || []).filter((item) => subjectFromValue(item.subject) === subject);
  const reviewed = submissions.filter((item) => item.status === "REVIEWED" && item.grading);
  const avg = reviewed.length ? Math.round(reviewed.reduce((sum, item) => sum + Number(item.grading?.score || 0), 0) / reviewed.length) : null;
  return {
    subject,
    summary: reviewed.length ? `${subject}已有 ${reviewed.length} 次教师确认批改记录，平均表现约 ${avg} 分。` : `${subject}本阶段记录较少，建议继续观察课堂和作业表现。`,
    highlights: tasks.some((item) => item.status === "COMPLETED" || item.status === "REVIEWED") ? ["能按要求完成部分学习任务。"] : ["继续积累学习任务记录。"],
    concerns: mistakes.slice(0, 2).map((item) => item.knowledgePoint?.name || item.prompt || "待巩固知识点")
  };
}

function correctionLoop(student) {
  const mistakes = student.mistakes || [];
  return mistakes.length
    ? mistakes.slice(0, 5).map((item) => `${item.subject}：${item.knowledgePoint?.name || item.prompt || "错题"}，${item.masteryResolved ? "已订正，可用同类题确认稳定。" : item.cause || "需继续订正复盘。"}`)
    : ["本阶段暂无可发布的错题订正闭环，建议继续积累批改记录。"];
}

function learningHabits(student) {
  const qaCount = (student.qaSessions || []).length + (student.voiceInteractions || []).length;
  const completed = (student.tasks || []).filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED").length;
  return [
    completed ? `已完成 ${completed} 项学习任务，学习节奏有记录可追踪。` : "学习任务完成记录仍需继续积累。",
    qaCount ? `主动提问或课堂互动 ${qaCount} 次，问题意识正在形成。` : "主动提问和课堂互动记录较少，后续继续观察。"
  ];
}

function progressList(student) {
  const reviewed = (student.submissions || []).filter((item) => item.status === "REVIEWED" && item.grading);
  return reviewed.length ? ["已形成教师确认的批改记录，可作为后续补弱依据。"] : ["阶段进步需要更多教师确认记录支撑。"];
}

function nextActions(subjects) {
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  return [
    `${focus.subject}：围绕${focus.concerns[0] || "基础知识和订正质量"}安排下一阶段巩固。`,
    "每周复盘一次错题订正，确认是否能独立复述解题思路。"
  ];
}

function parentSuggestions(subjects) {
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  return [
    `每天 5 到 10 分钟，请孩子口头复述${focus.subject}中最容易出错的一步。`,
    "关注订正过程，不只关注分数。"
  ];
}

function subjectFromValue(value) {
  const text = String(value || "");
  if (text.includes("语文") || text.toLowerCase().includes("chinese")) return "语文";
  if (text.includes("数学") || text.toLowerCase().includes("math")) return "数学";
  if (text.includes("英语") || text.toLowerCase().includes("english")) return "英语";
  return "";
}

function list(label, items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return visible.length ? `<strong>${escapeHtml(label)}</strong><ul>${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
}

function listBlock(items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return `<div class="card"><ul>${(visible.length ? visible : ["暂无记录，继续观察。"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function paragraphs(text) {
  return String(text || "").split(/\n+/).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Run focused test**

Run: `node --test apps/api/src/student-term-report.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- apps/api/src/student-term-report.js apps/api/src/student-term-report.test.mjs
git commit -m "feat: add student term report helper"
```

## Task 2: API Routes And PDF Asset Generation

**Files:**
- Modify: `apps/api/src/server.js`
- Test: `apps/api/src/student-term-report.test.mjs`

- [ ] **Step 1: Add route contract test through helper**

Extend `apps/api/src/student-term-report.test.mjs` with one test asserting `mapTermReportForRole(report, "teacher")` keeps `statusRaw`, `pdfUrl`, and `wechatMessage`, while `student` only sees sent status.

- [ ] **Step 2: Run focused test**

Run: `node --test apps/api/src/student-term-report.test.mjs`

Expected: PASS after Task 1; this protects the route mapping contract before wiring.

- [ ] **Step 3: Update server imports**

In `apps/api/src/server.js`, import:

```js
import {
  buildTermReportDraft,
  mapTermReportForRole,
  normalizeTermReportType,
  renderTermReportHtml,
  termReportTypeLabel,
  termReportTypeToDb
} from "./student-term-report.js";
```

- [ ] **Step 4: Add term report helpers in server**

Add small server-local helpers near profile helpers:

```js
function termReportPeriodKey(reportType, periodLabel) {
  return `${normalizeTermReportType(reportType)}:${String(periodLabel || "").trim() || new Date().toISOString().slice(0, 10)}`;
}

function mergeTermReportMetadata(currentMetadata, patch) {
  const metadata = safeJson(currentMetadata, {});
  return {
    ...metadata,
    termReport: {
      ...(metadata.termReport || {}),
      ...patch,
      updatedAt: new Date().toISOString()
    }
  };
}

async function loadTermReportStudent(studentId) {
  return loadStudentProfileSources(studentId);
}
```

- [ ] **Step 5: Add routes**

Add routes after student profile routes:

```js
app.post("/api/students/:studentId/term-report/draft", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const body = getBody(req);
  const student = await loadTermReportStudent(req.params.studentId);
  if (!student) return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  const reportType = normalizeTermReportType(body.reportType);
  const draft = buildTermReportDraft(student, { reportType, periodLabel: body.periodLabel });
  const report = await prisma.studentReport.create({
    data: {
      studentId: student.id,
      type: termReportTypeToDb(reportType),
      periodKey: termReportPeriodKey(reportType, draft.periodLabel),
      title: draft.title,
      content: draft.sections.overview.text,
      metadata: { termReport: { ...draft, draft } }
    },
    include: { student: true }
  });
  await auditEvent(req, { studentId: student.id, feature: "student-profile", action: "draft-term-report", metadata: { reportId: report.id, reportType } });
  res.json({ ok: true, report: mapTermReportForRole(report, "teacher") });
}));

app.post("/api/students/:studentId/term-report/:reportId/pdf", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const body = getBody(req);
  const student = await loadTermReportStudent(req.params.studentId);
  if (!student) return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  const report = await prisma.studentReport.findFirst({ where: { id: req.params.reportId, studentId: student.id }, include: { student: true } });
  if (!report) return res.status(404).json({ ok: false, error: "REPORT_NOT_FOUND", message: "未找到阶段报告。" });
  const teacherText = typeof body.teacherText === "string" && body.teacherText.trim() ? body.teacherText.trim() : report.content;
  const html = renderTermReportHtml(student, { ...report, content: teacherText });
  fs.mkdirSync(storageGeneratedRoot(), { recursive: true });
  const htmlFileName = `${report.id}-term-report.html`;
  const pdfFileName = `${report.id}-term-report.pdf`;
  const htmlPath = path.join(storageGeneratedRoot(), htmlFileName);
  const pdfPath = path.join(storageGeneratedRoot(), pdfFileName);
  fs.writeFileSync(htmlPath, normalizeGeneratedHtml(html), "utf8");
  const pdfResult = await renderPdfFromHtml(htmlPath, pdfPath).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
  const outputFileName = pdfResult.ok ? pdfFileName : htmlFileName;
  const asset = await prisma.generatedAsset.create({
    data: {
      kind: `student-term-report-${pdfResult.ok ? "pdf" : "html"}`,
      title: `${report.title} - PDF报告`,
      path: path.join(storageGeneratedRoot(), outputFileName),
      url: publicGeneratedUrl(outputFileName, req),
      metadata: {
        studentId: student.id,
        reportId: report.id,
        reportType: safeJson(report.metadata, {}).termReport?.reportType || null,
        htmlUrl: publicGeneratedUrl(htmlFileName, req),
        pdfGenerated: pdfResult.ok,
        pdfReason: pdfResult.ok ? null : pdfResult.reason,
        visibility: "teacher_pdf_only"
      }
    }
  });
  const updated = await prisma.studentReport.update({
    where: { id: report.id },
    data: {
      content: teacherText,
      metadata: mergeTermReportMetadata(report.metadata, {
        status: "pdf_ready",
        teacherEditedText: teacherText,
        pdfAssetId: asset.id,
        pdfUrl: asset.url,
        pdfTitle: asset.title
      })
    },
    include: { student: true }
  });
  await auditEvent(req, { studentId: student.id, feature: "student-profile", action: "term-report-pdf", metadata: { reportId: report.id, assetId: asset.id } });
  res.json({ ok: true, report: mapTermReportForRole(updated, "teacher"), asset });
}));

app.post("/api/students/:studentId/term-report/:reportId/mark-sent", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const report = await prisma.studentReport.findFirst({ where: { id: req.params.reportId, studentId: req.params.studentId }, include: { student: true } });
  if (!report) return res.status(404).json({ ok: false, error: "REPORT_NOT_FOUND", message: "未找到阶段报告。" });
  const metadata = safeJson(report.metadata, {});
  if (!metadata.termReport?.pdfUrl) return res.status(409).json({ ok: false, error: "PDF_REQUIRED", message: "请先生成 PDF，再标记已人工发送。" });
  const updated = await prisma.studentReport.update({
    where: { id: report.id },
    data: {
      metadata: mergeTermReportMetadata(report.metadata, {
        status: "sent_manually",
        sentManuallyAt: new Date().toISOString(),
        sentByTeacherId: req.session.teacherId
      })
    },
    include: { student: true }
  });
  await auditEvent(req, { studentId: report.studentId, feature: "student-profile", action: "term-report-sent-manually", metadata: { reportId: report.id } });
  res.json({ ok: true, report: mapTermReportForRole(updated, "teacher") });
}));

app.get("/api/students/:studentId/term-reports", requireDatabase, requireSession(config, ["student", "teacher"]), asyncRoute(async (req, res) => {
  const scopeError = assertStudentOwnsRequest(req, req.params.studentId);
  if (scopeError) return res.status(403).json(scopeError);
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const reports = await prisma.studentReport.findMany({
    where: { studentId: req.params.studentId, type: { in: ["MIDTERM", "FINAL"] } },
    orderBy: { createdAt: "desc" },
    include: { student: true }
  });
  res.json({ ok: true, reports: reports.map((report) => mapTermReportForRole(report, req.session.role)).filter(Boolean) });
}));
```

- [ ] **Step 6: Update `mapReport`**

Update `mapReport(report)` to call `mapTermReportForRole(report, "student")` for term reports when `metadata.termReport` exists, preserving existing reports otherwise.

- [ ] **Step 7: Run verification**

Run:

```powershell
node --test apps/api/src/student-term-report.test.mjs
.\jh.cmd check:api
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add -- apps/api/src/server.js apps/api/src/student-term-report.js apps/api/src/student-term-report.test.mjs
git commit -m "feat: add student term report api"
```

## Task 3: Web API And Types

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `packages/core/src/index.d.ts`

- [ ] **Step 1: Extend `StudentReportCard`**

Add optional fields:

```ts
  reportType?: "midterm" | "final";
  periodLabel?: string;
  status?: string;
  statusRaw?: string;
  sentManuallyAt?: string | null;
  pdfUrl?: string | null;
  pdfTitle?: string | null;
  pdfAssetId?: string | null;
  wechatMessage?: string;
  teacherEditedText?: string;
  draft?: Record<string, unknown>;
```

- [ ] **Step 2: Add Web API functions**

In `apps/web/src/api.ts`, add:

```ts
export type TermReportType = "midterm" | "final";

export async function draftStudentTermReport(studentId: string, input: { reportType: TermReportType; periodLabel?: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/draft`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; report: StudentReportCard }>(response);
}

export async function generateStudentTermReportPdf(studentId: string, reportId: string, input: { teacherText: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/${reportId}/pdf`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; report: StudentReportCard; asset: { id: string; url: string; title: string } }>(response);
}

export async function markStudentTermReportSent(studentId: string, reportId: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/${reportId}/mark-sent`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{ ok: boolean; report: StudentReportCard }>(response);
}

export async function listStudentTermReports(studentId: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-reports`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; reports: StudentReportCard[] }>(response);
}
```

- [ ] **Step 3: Run Web typecheck**

Run: `npm.cmd run typecheck --workspace apps/web`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```powershell
git add -- apps/web/src/api.ts packages/core/src/index.d.ts
git commit -m "feat: add term report web api"
```

## Task 4: Teacher UI And Student Status Display

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Import API functions and type**

Import `draftStudentTermReport`, `generateStudentTermReportPdf`, `markStudentTermReportSent`, and `TermReportType`.

- [ ] **Step 2: Add App state and handlers**

Add state:

```ts
const [termReportDraft, setTermReportDraft] = useState<StudentReportCard | null>(null);
```

Add handlers:

```ts
async function createStudentTermReportDraft(studentId: string, reportType: TermReportType, periodLabel: string) {
  const response = await draftStudentTermReport(studentId, { reportType, periodLabel });
  setTermReportDraft(response.report);
  setReports((items) => [response.report, ...items.filter((item) => item.id !== response.report.id)]);
  return response.report;
}

async function generateStudentTermReportPdfFile(studentId: string, reportId: string, teacherText: string) {
  const response = await generateStudentTermReportPdf(studentId, reportId, { teacherText });
  setTermReportDraft(response.report);
  setReports((items) => [response.report, ...items.filter((item) => item.id !== response.report.id)]);
  return response.report;
}

async function markStudentTermReportManuallySent(studentId: string, reportId: string) {
  const response = await markStudentTermReportSent(studentId, reportId);
  setTermReportDraft(response.report);
  setReports((items) => [response.report, ...items.filter((item) => item.id !== response.report.id)]);
}
```

- [ ] **Step 3: Pass handlers to `TeacherWorkspace`**

Add props for term report draft, PDF generation, and mark-sent.

- [ ] **Step 4: Add teacher term report panel**

Inside the teacher student profile section, keep the existing weekly/monthly panel, then add a new `TermReportPanel` component with:

- report type segmented buttons: `期中报告` / `期末报告`
- period label input
- button: `生成阶段报告草稿`
- textarea for teacher edited report body
- button: `保存并生成 PDF`
- if `pdfUrl`, show download link
- button: `复制微信话术`
- button: `标记已人工发送`

- [ ] **Step 5: Add student sent-status display**

In `StudentArchive`, split:

```ts
const termReports = reports.filter((report) => report.reportType === "midterm" || report.reportType === "final");
const visibleSentTermReports = termReports.filter((report) => report.status === "已发送");
const onlineReports = reports.filter((report) => !report.reportType);
```

In feedback detail, render sent term reports as status rows with `老师已发送阶段报告给家长`, without PDF link.

- [ ] **Step 6: Add CSS**

Add classes:

- `.student-profile-workspace`
- `.profile-online-panel`
- `.term-report-panel`
- `.term-report-controls`
- `.term-report-actions`
- `.term-report-archive-list`
- `.term-report-status-card`

- [ ] **Step 7: Run verification**

Run:

```powershell
npm.cmd run typecheck --workspace apps/web
.\jh.cmd check:encoding
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add -- apps/web/src/main.tsx apps/web/src/styles.css
git commit -m "feat: add term report teacher workflow"
```

## Task 5: Docs And Final Verification

**Files:**
- Modify: `docs/14-api-contract.md`
- Modify: `skills/student-profile/SKILLS.md`

- [ ] **Step 1: Update API contract**

Document the four term report endpoints, teacher-only PDF visibility, manual WeChat delivery, and student sent-status-only display.

- [ ] **Step 2: Update student profile skill**

Add the finalized boundary:

- 周/月发布到学生端；
- 期中/期末只在教师端生成 PDF；
- 微信人工发送；
- 学生端只显示发送状态。

- [ ] **Step 3: Run final verification**

Run:

```powershell
node --test apps/api/src/student-term-report.test.mjs
node --test apps/api/src/student-growth-profile.test.mjs
.\jh.cmd check:api
npm.cmd run typecheck --workspace apps/web
.\jh.cmd check:encoding
cmd /c npm.cmd run workspace:guard
```

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add -- docs/14-api-contract.md skills/student-profile/SKILLS.md
git commit -m "docs: document term report pdf delivery"
```

## Self-Review

Spec coverage:

- Teacher-only midterm/final PDF workflow: Tasks 1, 2, 4.
- Manual WeChat delivery and sent status: Tasks 1, 2, 4, 5.
- Student-side status only, no PDF/body: Tasks 1, 2, 4.
- No database migration first release: Task 2 uses `StudentReport` and `GeneratedAsset`.
- Weekly/monthly unchanged: Task 4 keeps existing panel and adds a separate term report panel.
- PDF generation and verification: Tasks 2 and 5.

No placeholders are intentionally left. Implementation stays in API/helper and shared contracts; Web remains a teacher workflow surface.

