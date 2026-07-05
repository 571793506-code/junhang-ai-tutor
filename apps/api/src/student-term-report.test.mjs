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
  tasks: [
    {
      id: "task_1",
      title: "数学应用题训练",
      status: "COMPLETED",
      subject: { name: "数学" },
      createdAt: new Date("2026-06-20T08:00:00.000Z")
    }
  ],
  submissions: [
    {
      id: "sub_1",
      status: "REVIEWED",
      submittedAt: new Date("2026-06-21T08:00:00.000Z"),
      assignment: { title: "期末复习小测", subject: { name: "数学" }, metadata: {} },
      grading: { score: 86, result: { summary: "应用题审题有进步。", archiveEligible: true, confidence: "high" } }
    }
  ],
  mistakes: [
    {
      id: "mistake_1",
      subject: "数学",
      prompt: "两步应用题",
      cause: "单位换算遗漏",
      masteryResolved: false,
      createdAt: new Date("2026-06-22T08:00:00.000Z"),
      knowledgePoint: { name: "两步应用题" },
      metadata: { nextPractice: "先圈单位，再列式。" }
    }
  ],
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
  const draft = buildTermReportDraft(student, {
    reportType: "final",
    periodLabel: "2026春季期末",
    now: new Date("2026-07-05T12:00:00.000Z")
  });

  assert.equal(draft.reportType, "final");
  assert.equal(draft.status, "draft");
  assert.equal(draft.visibility, "teacher_pdf_only");
  assert.equal(draft.periodLabel, "2026春季期末");
  assert.ok(draft.sections.overview.text.includes("张思源"));
  assert.ok(draft.sections.subjects.length >= 3);
  assert.ok(draft.wechatMessage.includes("成长报告"));
});

test("buildTermReportDraft applies midterm and final content templates", () => {
  const midterm = buildTermReportDraft(student, {
    reportType: "midterm",
    periodLabel: "2026春季期中",
    now: new Date("2026-07-05T12:00:00.000Z")
  });
  const final = buildTermReportDraft(student, {
    reportType: "final",
    periodLabel: "2026春季期末",
    now: new Date("2026-07-05T12:00:00.000Z")
  });

  assert.equal(midterm.template.id, "term-midterm-growth-report");
  assert.equal(final.template.id, "term-final-growth-report");
  assert.equal(midterm.template.focusLabel, "接下来两到四周优先处理");
  assert.equal(final.template.focusLabel, "假期或下阶段可以这样配合");
  assert.deepEqual(midterm.sections.subjectOverview.map((item) => item.subject), ["语文", "数学", "英语"]);
  assert.ok(midterm.sections.focusSubjects.length >= 1);
  assert.ok(midterm.sections.stableGrowth.length >= 1);
  assert.ok(final.sections.tutoringFocus.some((item) => item.includes("下阶段") || item.includes("假期")));
  assert.ok(final.sections.parentNextStep.length >= 1);

  const serialized = JSON.stringify({ midterm, final });
  for (const forbidden of ["排名", "预测分", "冲刺", "升学风险", "班级位置"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
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

test("mapTermReportForRole keeps teacher delivery fields and limits student status fields", () => {
  const report = {
    id: "report_2",
    studentId: "stu_1",
    student: { displayName: "张思源" },
    type: "MIDTERM",
    periodKey: "midterm:2026春季期中",
    title: "张思源 2026春季期中成长报告",
    content: "教师确认正文",
    createdAt: new Date("2026-07-05T12:00:00.000Z"),
    metadata: {
      termReport: {
        reportType: "midterm",
        status: "sent_manually",
        periodLabel: "2026春季期中",
        pdfUrl: "/generated/report-midterm.pdf",
        pdfTitle: "张思源 2026春季期中成长报告 - PDF报告",
        pdfAssetId: "asset_1",
        sentManuallyAt: "2026-07-05T12:30:00.000Z",
        teacherEditedText: "教师确认正文",
        wechatMessage: "您好，请查收期中报告。"
      }
    }
  };

  const teacherView = mapTermReportForRole(report, "teacher");
  assert.equal(teacherView.statusRaw, "sent_manually");
  assert.equal(teacherView.pdfUrl, "/generated/report-midterm.pdf");
  assert.equal(teacherView.pdfTitle, "张思源 2026春季期中成长报告 - PDF报告");
  assert.equal(teacherView.pdfAssetId, "asset_1");
  assert.equal(teacherView.wechatMessage, "您好，请查收期中报告。");

  const studentView = mapTermReportForRole(report, "student");
  assert.equal(studentView.status, "已发送");
  assert.equal(studentView.summary, "老师已发送阶段报告给家长");
  assert.equal(studentView.sentManuallyAt, "2026-07-05T12:30:00.000Z");
  assert.equal(Object.hasOwn(studentView, "pdfUrl"), false);
  assert.equal(Object.hasOwn(studentView, "wechatMessage"), false);
  assert.equal(Object.hasOwn(studentView, "teacherEditedText"), false);
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

test("renderTermReportHtml includes term report template sections", () => {
  const draft = buildTermReportDraft(student, { reportType: "final", periodLabel: "2026春季期末" });
  const html = renderTermReportHtml(student, {
    id: "report_3",
    title: "张思源 2026春季期末成长报告",
    content: draft.sections.overview.text,
    metadata: { termReport: draft }
  });

  for (const heading of ["三科总览", "重点科目展开", "稳定表现", "下阶段辅导重点", "家长下一步"]) {
    assert.ok(html.includes(heading), `missing heading: ${heading}`);
  }
  assert.ok(html.includes("教师确认后生成"));
  assert.equal(html.includes("排名"), false);
  assert.equal(html.includes("预测分"), false);
});
