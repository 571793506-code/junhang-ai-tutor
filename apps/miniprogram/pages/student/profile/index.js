const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function formatSentTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

Page({
  data: {
    corrections: [],
    loading: false,
    profileMessage: "",
    publishedProfileText: "",
    reports: [],
    sentTermReports: [],
    student: {},
    subjects: []
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (!student) {
      return;
    }
    this.setData({ loading: true, profileMessage: "" });
    try {
      const [response, termReportsResponse] = await Promise.all([
        api.getStudentProfile(student.id),
        api.listStudentTermReports(student.id).catch(() => ({ reports: [] }))
      ]);
      const fullStudent = response.student || student;
      const snapshot = response.snapshot || {};
      const mastery = fullStudent.mastery || snapshot.mastery || {};
      const publishedProfileText =
        fullStudent.publishedProfileText ||
        snapshot.publishedText ||
        "";
      const sentTermReports = (termReportsResponse.reports || [])
        .filter((report) => report.status === "已发送")
        .map((report) => ({
          ...report,
          displayPeriod: report.periodLabel || report.period || "阶段报告",
          sentTimeText: formatSentTime(report.sentManuallyAt)
        }));
      this.setData({
        corrections: (response.unresolvedMistakes || []).slice(0, 8),
        reports: (response.reports || []).filter((report) => !report.reportType).slice(0, 4),
        sentTermReports: sentTermReports.slice(0, 4),
        student: fullStudent,
        subjects: ["语文", "数学", "英语"].map((name) => ({ name, value: mastery[name] || 0 })),
        publishedProfileText,
        profileMessage: publishedProfileText ? "" : "老师还未发布阶段反馈。发布后学生和家长会在这里看到确认后的内容。"
      });
    } catch (error) {
      this.setData({ profileMessage: error.message || "档案加载失败。" });
      wx.showToast({ title: "档案加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
