const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function asText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function listLines(items, fallback) {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${asText(String(item), "")}`).filter(Boolean)
    : [`- ${fallback}`];
}

function profileDraftToText(snapshot, studentName) {
  const source = snapshot || {};
  const narrative = source.narrative || {};
  const mastery = source.mastery || {};
  const sourceCounts = source.sourceCounts || {};
  const risks = source.risks || [];
  const strengths = source.strengths || [];
  const nextActions = narrative.nextActions || risks;

  return [
    `${studentName} 学生档案反馈草稿`,
    "",
    "一、近期概况",
    asText(narrative.teacherSummary, "系统已汇总近期任务、批改、问答和课堂记录，等待老师复核。"),
    "",
    "二、知识掌握",
    `语文：${mastery["语文"] || 0}%`,
    `数学：${mastery["数学"] || 0}%`,
    `英语：${mastery["英语"] || 0}%`,
    "",
    "三、表现亮点",
    ...listLines(strengths, "暂无明显优势标签，建议继续补充课堂、作业和批改记录。"),
    "",
    "四、待巩固内容",
    ...listLines(risks, "暂未形成稳定薄弱点，继续观察错题和任务完成情况。"),
    "",
    "五、下一步建议",
    ...listLines(nextActions, "保持今日任务完成节奏，错题订正后再安排同类题复练。"),
    "",
    "六、阶段反馈",
    `本周：${asText(narrative.weeklyFeedback, "结合本周任务、批改和课堂记录持续观察。")}`,
    `本月：${asText(narrative.monthlyFeedback, "月度反馈会随着更多学习记录自动更新。")}`,
    "",
    "七、老师复核参考",
    `当前汇总了任务 ${sourceCounts.tasks || 0} 条、批改 ${sourceCounts.submissions || 0} 条、待处理错题 ${sourceCounts.mistakes || 0} 条。`
  ].join("\n");
}

function listReportItems(items, key, fallback) {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${asText(String(item[key] || item.text || item.title || item), "")}`).filter(Boolean)
    : [`- ${fallback}`];
}

function termReportDraftToText(report, studentName) {
  const source = report || {};
  const draft = source.draft || {};
  const sections = draft.sections || {};
  return [
    source.title || `${studentName} 阶段报告`,
    "",
    "一、阶段概况",
    asText(sections.overview?.text || source.summary, "服务端已生成阶段报告草稿，请老师复核后保存 PDF。"),
    "",
    "二、阶段关键结论",
    ...listReportItems(sections.stageConclusions, "text", "暂无阶段结论，请结合学生近期表现补充。"),
    "",
    "三、三科总览",
    ...(Array.isArray(sections.subjectOverview) && sections.subjectOverview.length
      ? sections.subjectOverview.map((item) => `- ${item.subject}：${item.observation || item.summary || "继续观察。"}${item.nextStep ? ` 下一步：${item.nextStep}` : ""}`)
      : ["- 暂无三科总览，请老师结合课堂与批改记录补充。"]),
    "",
    "四、重点跟进",
    ...listReportItems(sections.tutoringFocus || sections.actionPlan, "text", "保持错题订正、课堂反馈和阶段复盘。"),
    "",
    "五、家校协同建议",
    ...listReportItems(sections.homeSchoolCollaboration || sections.parentNextSteps, "text", "家长配合查看老师发送的 PDF 报告并关注下一步安排。")
  ].join("\n");
}

function upsertTermReport(reports, report) {
  const source = Array.isArray(reports) ? reports : [];
  if (!report || !report.id) return source;
  const exists = source.some((item) => item.id === report.id);
  return exists ? source.map((item) => (item.id === report.id ? report : item)) : [report, ...source];
}

Page({
  data: {
    draftText: "",
    loading: false,
    message: "",
    selectedIndex: 0,
    selectedStudentName: "",
    snapshot: null,
    students: [],
    selectedTermReport: null,
    termReportCopyState: "",
    termReportMessage: "",
    termReportPeriodLabel: "",
    termReports: [],
    termReportText: "",
    termReportType: "final"
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    try {
      const bootstrap = await api.bootstrap();
      const students = (bootstrap.students || []).filter(
        (item) => !item.responsibleTeacherId || item.responsibleTeacherId === teacher.id
      );
      const selectedStudent = students[this.data.selectedIndex] || students[0] || null;
      this.setData({ students, selectedStudentName: selectedStudent ? selectedStudent.displayName : "" });
      if (students.length && !this.data.draftText) {
        const student = selectedStudent;
        this.setData({
          draftText: student.publishedProfileText || "请选择“生成档案草稿”，系统会根据任务、批改、问答和课堂记录生成可编辑文本。"
        });
      }
      if (selectedStudent) {
        await this.loadTermReports(selectedStudent.id);
      }
    } catch (error) {
      wx.showToast({ title: error.message || "学生档案加载失败", icon: "none" });
    }
  },
  setStudent(event) {
    const selectedIndex = Number(event.detail.value);
    const student = this.data.students[selectedIndex];
    this.setData({
      selectedIndex,
      selectedStudentName: student ? student.displayName : "",
      snapshot: null,
      selectedTermReport: null,
      draftText: student && student.publishedProfileText
        ? student.publishedProfileText
        : "请选择“生成档案草稿”，系统会根据任务、批改、问答和课堂记录生成可编辑文本。",
      message: "",
      termReportCopyState: "",
      termReportMessage: "",
      termReports: [],
      termReportText: ""
    });
    if (student) {
      this.loadTermReports(student.id);
    }
  },
  setDraftText(event) {
    this.setData({ draftText: event.detail.value });
  },
  setTermReportType(event) {
    this.setData({ termReportType: event.currentTarget.dataset.type || "final" });
  },
  setTermReportPeriodLabel(event) {
    this.setData({ termReportPeriodLabel: event.detail.value });
  },
  setTermReportText(event) {
    this.setData({ termReportText: event.detail.value });
  },
  async loadTermReports(studentId) {
    try {
      const response = await api.listStudentTermReports(studentId);
      const termReports = response.reports || [];
      const selectedTermReport = termReports[0] || null;
      this.setData({
        termReports,
        selectedTermReport,
        termReportText: selectedTermReport ? termReportDraftToText(selectedTermReport, this.data.selectedStudentName) : "",
        termReportMessage: selectedTermReport ? "已加载该学生最近的阶段报告记录。" : "暂无期中/期末阶段报告。"
      });
    } catch (error) {
      this.setData({ termReportMessage: error.message || "阶段报告加载失败。" });
    }
  },
  async generateDraft() {
    const student = this.data.students[this.data.selectedIndex];
    if (!student) {
      wx.showToast({ title: "请先选择学生", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "正在生成学生档案草稿..." });
    try {
      const response = await api.draftStudentProfile(student.id);
      const text = profileDraftToText(response.snapshot, student.displayName);
      this.setData({
        snapshot: response.snapshot,
        draftText: text,
        message: "草稿已生成，请老师查看并修改后再发布。"
      });
    } catch (error) {
      this.setData({ message: error.message || "档案草稿生成失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async generateTermReportDraft() {
    const student = this.data.students[this.data.selectedIndex];
    if (!student) {
      wx.showToast({ title: "请先选择学生", icon: "none" });
      return;
    }
    this.setData({ loading: true, termReportMessage: "正在生成阶段报告草稿..." });
    try {
      const response = await api.draftStudentTermReport(student.id, {
        reportType: this.data.termReportType,
        periodLabel: this.data.termReportPeriodLabel
      });
      const report = response.report;
      this.setData({
        selectedTermReport: report,
        termReports: upsertTermReport(this.data.termReports, report),
        termReportText: termReportDraftToText(report, student.displayName),
        termReportMessage: "阶段报告草稿已生成，请老师复核正文后保存 PDF。"
      });
    } catch (error) {
      this.setData({ termReportMessage: error.message || "阶段报告草稿生成失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async saveTermReportPdf() {
    const student = this.data.students[this.data.selectedIndex];
    const report = this.data.selectedTermReport;
    const teacherText = this.data.termReportText.trim();
    if (!student || !report || !teacherText) {
      wx.showToast({ title: "请先生成并确认报告正文", icon: "none" });
      return;
    }
    this.setData({ loading: true, termReportMessage: "正在保存阶段报告资产..." });
    try {
      const response = await api.generateStudentTermReportPdf(student.id, report.id, { teacherText });
      const updated = response.report;
      this.setData({
        selectedTermReport: updated,
        termReports: upsertTermReport(this.data.termReports, updated),
        termReportText: termReportDraftToText(updated, student.displayName),
        termReportMessage: response.asset?.url ? "报告资产已生成，请复制链接或下载后通过微信私聊人工发送。" : "报告已保存，请老师确认资产状态。"
      });
    } catch (error) {
      this.setData({ termReportMessage: error.message || "阶段报告保存失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  copyTermReportPdfUrl() {
    const report = this.data.selectedTermReport || {};
    if (!report.pdfUrl) {
      wx.showToast({ title: "请先生成 PDF", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: report.pdfUrl,
      success: () => this.setData({ termReportCopyState: "报告链接已复制，请在微信私聊中人工发送给家长。" })
    });
  },
  copyTermReportMessage() {
    const report = this.data.selectedTermReport || {};
    if (!report.wechatMessage) {
      wx.showToast({ title: "暂无微信话术", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: report.wechatMessage,
      success: () => this.setData({ termReportCopyState: "微信发送话术已复制。" })
    });
  },
  async markTermReportSent() {
    const student = this.data.students[this.data.selectedIndex];
    const report = this.data.selectedTermReport;
    if (!student || !report) {
      wx.showToast({ title: "请先选择报告", icon: "none" });
      return;
    }
    if (!report.pdfUrl) {
      wx.showToast({ title: "请先生成 PDF", icon: "none" });
      return;
    }
    this.setData({ loading: true, termReportMessage: "正在标记人工发送状态..." });
    try {
      const response = await api.markStudentTermReportSent(student.id, report.id);
      const updated = response.report;
      this.setData({
        selectedTermReport: updated,
        termReports: upsertTermReport(this.data.termReports, updated),
        termReportMessage: "已标记为微信私聊人工发送。学生端只显示发送状态，不显示报告正文或链接。"
      });
    } catch (error) {
      this.setData({ termReportMessage: error.message || "发送状态标记失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async publishDraft() {
    const student = this.data.students[this.data.selectedIndex];
    const text = this.data.draftText.trim();
    if (!student || !text) {
      wx.showToast({ title: "请先生成或填写档案内容", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "正在发布至学生端..." });
    try {
      await api.publishStudentProfile(student.id, {
        snapshot: this.data.snapshot || {},
        text
      });
      this.setData({ message: "已发布至学生端。家长和学生只能看到老师确认后的内容。" });
      wx.showToast({ title: "已发布", icon: "success" });
    } catch (error) {
      this.setData({ message: error.message || "档案发布失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
