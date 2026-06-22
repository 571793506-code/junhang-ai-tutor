const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    aiReady: false,
    displayAddress: "http://127.0.0.1:5173/",
    padControls: [
      { title: "今日任务提醒", status: "可发布到学生端和平板端" },
      { title: "语音播报", status: "教师端发布，平板端接收播放" },
      { title: "听写播报", status: "教师填写内容，平板端按规则播报" },
      { title: "课文跟读", status: "教师填写课文，系统辅助识别重点词" }
    ],
    pluginStates: [
      { title: "AI问答", status: "平板端学生提问，系统引导或解答" },
      { title: "今日任务", status: "学生完成后回传教师端归档" },
      { title: "听写/跟读", status: "由教师端控制发布" }
    ],
    statusText: "正在检查服务状态...",
    teacher: {}
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    this.setData({ teacher });
    api.teacherAiStatus()
      .then((status) => {
        const snapshot = status.ai || status;
        const providers = snapshot.providers || [];
        const ready = providers.some((item) => item.status === "ready");
        const allReady = providers.length > 0 && providers.every((item) => item.status === "ready");
        this.setData({
          aiReady: ready,
          statusText: ready ? (allReady ? "AI 服务全部可用。" : "AI 服务可用，部分能力待恢复。") : "AI 服务暂不可用。"
        });
      })
      .catch(() => this.setData({ aiReady: false, statusText: "API 暂时不可用，请检查本地服务。" }));
  },
  goStudents() {
    wx.navigateTo({ url: "/pages/teacher/students/index" });
  },
  goTasks() {
    wx.navigateTo({ url: "/pages/teacher/tasks/index" });
  },
  goContent() {
    wx.navigateTo({ url: "/pages/teacher/content/index" });
  },
  goGrading() {
    wx.navigateTo({ url: "/pages/teacher/grading/index" });
  },
  goReview() {
    wx.navigateTo({ url: "/pages/teacher/review/index" });
  },
  goAssessments() {
    wx.navigateTo({ url: "/pages/teacher/assessments/index" });
  },
  goProfile() {
    wx.navigateTo({ url: "/pages/teacher/profile/index" });
  },
  goClassroom() {
    wx.navigateTo({ url: "/pages/classroom/dashboard/index" });
  },
  copyDisplayAddress() {
    wx.setClipboardData({
      data: this.data.displayAddress,
      success() {
        wx.showToast({ title: "大屏地址已复制", icon: "none" });
      }
    });
  }
});
