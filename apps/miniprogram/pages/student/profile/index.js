const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    corrections: [],
    loading: false,
    profileMessage: "",
    publishedProfileText: "",
    reports: [],
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
      const response = await api.getStudentProfile(student.id);
      const fullStudent = response.student || student;
      const snapshot = response.snapshot || {};
      const mastery = fullStudent.mastery || snapshot.mastery || {};
      const publishedProfileText =
        fullStudent.publishedProfileText ||
        snapshot.publishedText ||
        snapshot.narrative?.teacherEditedText ||
        "";
      this.setData({
        corrections: (response.unresolvedMistakes || []).slice(0, 8),
        reports: (response.reports || []).slice(0, 4),
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
