const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    answer: "",
    available: false,
    loading: false,
    question: ""
  },
  async onShow() {
    const identity = await guard.requireRole("student", this);
    if (!identity) return;
    api.status()
      .then((status) => {
        const qaFeature = (status.ai.features || []).find((item) => item.id === "qa");
        this.setData({ available: !qaFeature || qaFeature.status === "ready" });
      })
      .catch(() => this.setData({ available: false }));
  },
  setQuestion(event) {
    this.setData({ question: event.detail.value });
  },
  async ask() {
    const student = await guard.requireRole("student", this);
    if (!student) return;
    if (!this.data.question.trim()) {
      wx.showToast({ title: "请先输入问题", icon: "none" });
      return;
    }
    this.setData({ loading: true, answer: "" });
    try {
      const response = await api.askQuestion({
        studentId: student.id,
        studentName: student.displayName,
        question: this.data.question.trim()
      });
      this.setData({
        answer: response.result.answer || "已经收到问题，请继续补充题目条件。",
        available: Boolean(response.result.available)
      });
    } catch (error) {
      this.setData({ available: false, answer: error.message || "当前问答暂时不可用。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
