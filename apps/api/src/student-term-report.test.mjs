import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTermReportDraft,
  mapTermReportForRole,
  normalizeTermReportType,
  renderTermReportHtml,
  termReportTypeToDb
} from "./student-term-report.js";

const qaLearningSignal = {
  knowledgePoints: ["小数意义"],
  questionIntent: "concept",
  difficultySignal: "possible",
  misconceptionHypotheses: ["需要继续观察小数位值理解"],
  followUpNeeded: true,
  confidence: "medium",
  safetyStatus: "pass"
};

function qaMetadata(overrides = {}) {
  return {
    schemaVersion: "qa-learning-signal-v1",
    actorRole: "student",
    identityConfirmed: true,
    available: true,
    mode: "KNOWLEDGE_EXPLANATION",
    profileEligibility: true,
    blockedReason: null,
    learningSignal: { ...qaLearningSignal },
    ...overrides
  };
}

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
  assert.equal(draft.renderingPolicy.pdfTextSource, "html_template");
  assert.equal(draft.renderingPolicy.imagePreviewUsage, "visual_reference_only");
  assert.equal(draft.renderingPolicy.requiresTeacherReview, true);
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
  assert.equal(midterm.template.reportTitle, "期中阶段综合档案");
  assert.equal(final.template.reportTitle, "学期综合成长总结");
  assert.ok(midterm.sections.overview.text.includes("阶段掌握"));
  assert.ok(final.sections.overview.text.includes("学期成长"));
  assert.deepEqual(midterm.sections.subjectOverview.map((item) => item.subject), ["语文", "数学", "英语"]);
  assert.ok(midterm.sections.subjectOverview.every((item) => item.observation));
  assert.ok(midterm.sections.focusSubjects.length >= 1);
  assert.ok(midterm.sections.focusSubjects.length <= 2);
  assert.ok(midterm.sections.focusSubjects.every((item) => item.evidence && item.abilityObservation && item.priorityAction && item.teacherNextStep));
  assert.ok(midterm.sections.stableGrowth.length >= 1);
  assert.ok(midterm.sections.stableGrowth.every((item) => item.text && item.evidence));
  assert.ok(final.sections.tutoringFocus.some((item) => item.includes("下阶段") || item.includes("假期")));
  assert.ok(final.sections.parentNextStep.length >= 1);
  assert.ok(final.sections.parentNextStep.every((item) => item.text));
  assert.deepEqual(final.sections.parentNextSteps, final.sections.parentNextStep);

  const serialized = JSON.stringify({ midterm, final });
  for (const forbidden of ["排名", "预测分", "冲刺", "升学风险", "班级位置"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("buildTermReportDraft includes deeper stage report content blocks", () => {
  const draft = buildTermReportDraft(student, {
    reportType: "midterm",
    periodLabel: "2026春季期中",
    now: new Date("2026-07-05T12:00:00.000Z")
  });

  assert.ok(draft.sections.stageConclusions.length >= 3);
  assert.ok(draft.sections.stageConclusions.every((item) => item.title && item.text && item.evidence));
  assert.ok(draft.sections.evidenceSummary.length >= 3);
  assert.ok(draft.sections.subjectAbilityMap.length === 3);
  assert.ok(draft.sections.subjectAbilityMap.every((item) => (
    item.subject &&
    item.currentLevel &&
    item.keyAbility &&
    item.evidence &&
    item.nextStep
  )));
  assert.ok(draft.sections.commonCauseAnalysis.length >= 2);
  assert.ok(draft.sections.actionPlan.length >= 3);
  assert.ok(Array.isArray(draft.sections.growthTrajectory));
  assert.ok(draft.sections.growthTrajectory.length >= 3);
  assert.ok(draft.sections.growthTrajectory.every((item) => item.title && item.text && item.evidence));
  assert.ok(Array.isArray(draft.sections.evidenceCoverage));
  assert.ok(draft.sections.evidenceCoverage.length >= 4);
  assert.ok(Array.isArray(draft.sections.learningProcess));
  assert.ok(draft.sections.learningProcess.length >= 3);
  assert.ok(Array.isArray(draft.sections.homeSchoolCollaboration));
  assert.ok(draft.sections.homeSchoolCollaboration.length >= 3);
  assert.ok(Array.isArray(draft.sections.teacherReviewChecklist));
  assert.ok(draft.sections.teacherReviewChecklist.length >= 4);
  assert.ok(draft.sections.teacherReviewChecklist.some((item) => item.text.includes("人工发送")));
  assert.ok(draft.sections.parentCommunicationSummary.text.includes("家长"));
  assert.equal(JSON.stringify(draft).includes("平均表现约"), false);
});

test("term report excludes ineligible qa and every qa-backed voice interaction", () => {
  const fixture = {
    ...student,
    qaSessions: [
      {
        id: "qa_unavailable",
        createdAt: new Date("2026-07-01T08:00:00.000Z"),
        subject: "数学",
        metadata: qaMetadata({ available: false, profileEligibility: false, blockedReason: "model-unavailable" })
      },
      {
        id: "qa_unsafe",
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
        subject: "数学",
        metadata: qaMetadata({
          profileEligibility: false,
          blockedReason: "unsafe-content",
          learningSignal: { ...qaLearningSignal, safetyStatus: "blocked" }
        })
      },
      {
        id: "qa_unconfirmed",
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
        subject: "数学",
        metadata: qaMetadata({ identityConfirmed: false, profileEligibility: false, blockedReason: "identity-unconfirmed" })
      }
    ],
    voiceInteractions: [
      { id: "voice_unavailable", metadata: { qaSessionId: "qa_unavailable", available: false } },
      { id: "voice_unsafe", metadata: { qaSessionId: "qa_unsafe", available: true } },
      { id: "voice_unconfirmed", metadata: { qaSessionId: "qa_unconfirmed", available: true } }
    ]
  };

  const draft = buildTermReportDraft(fixture, { reportType: "final", periodLabel: "2026春季期末" });
  const interactionTexts = [
    draft.sections.learningHabits[1],
    draft.sections.evidenceSummary.find((item) => item.title === "问答互动").text,
    draft.sections.evidenceCoverage.find((item) => item.title === "互动覆盖").text
  ];

  assert.equal(interactionTexts.every((text) => text.includes("记录较少")), true);
});

test("term report counts unique eligible qa plus standalone classroom evidence once", () => {
  const eligibleQa = {
    id: "qa_eligible",
    createdAt: new Date("2026-07-02T08:00:00.000Z"),
    subject: "数学",
    metadata: qaMetadata({
      learningSignal: { ...qaLearningSignal, knowledgePoints: ["小数意义", "小数位值"] }
    })
  };
  const fixture = {
    ...student,
    qaSessions: [
      eligibleQa,
      { ...eligibleQa, createdAt: new Date("2026-07-02T09:00:00.000Z") }
    ],
    voiceInteractions: [
      { id: "voice_qa", metadata: { qaSessionId: "qa_eligible", available: true } },
      {
        id: "voice_standalone",
        subject: "语文",
        question: "课堂复述",
        occurredAt: new Date("2026-07-02T10:00:00.000Z"),
        metadata: { available: true }
      }
    ]
  };

  const draft = buildTermReportDraft(fixture, { reportType: "final", periodLabel: "2026春季期末" });
  const interactionTexts = [
    draft.sections.learningHabits[1],
    draft.sections.evidenceSummary.find((item) => item.title === "问答互动").text,
    draft.sections.evidenceCoverage.find((item) => item.title === "互动覆盖").text
  ];

  assert.equal(interactionTexts.every((text) => text.includes("2 次")), true);
  assert.equal(interactionTexts.some((text) => text.includes("3 次") || text.includes("4 次")), false);
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

  for (const heading of ["阶段关键结论", "成长轨迹", "证据摘要", "证据覆盖说明", "三科总览", "学科能力拆解", "重点科目展开", "共性错因分析", "课堂与作业过程", "跟进计划", "家校协同建议", "家长沟通摘要"]) {
    assert.ok(html.includes(heading), `missing heading: ${heading}`);
  }
  assert.ok(html.includes("教师确认后生成"));
  assert.equal(html.includes("教师复核清单"), false);
  assert.equal(html.includes("image2"), false);
  assert.equal(html.includes("排名"), false);
  assert.equal(html.includes("预测分"), false);
});
