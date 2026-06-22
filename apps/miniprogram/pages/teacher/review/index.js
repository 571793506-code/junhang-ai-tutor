const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    submissions: []
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    this.loadSubmissions();
  },
  async loadSubmissions() {
    try {
      const response = await api.listReviewSubmissions();
      const submissions = (response.submissions || []).map((item) => {
        const grading = item.structuredGrading || {};
        return {
          ...item,
          reviewScore: grading.score != null ? String(grading.score) : grading.provisionalScore != null ? String(grading.provisionalScore) : "",
          reviewNote: ""
        };
      });
      this.setData({ submissions });
    } catch (error) {
      wx.showToast({ title: error.message || "复核列表加载失败", icon: "none" });
    }
  },
  updateReviewScore(event) {
    const submissionId = event.currentTarget.dataset.id;
    const value = event.detail.value;
    this.setData({
      submissions: this.data.submissions.map((item) => item.id === submissionId ? { ...item, reviewScore: value } : item)
    });
  },
  updateReviewNote(event) {
    const submissionId = event.currentTarget.dataset.id;
    const value = event.detail.value;
    this.setData({
      submissions: this.data.submissions.map((item) => item.id === submissionId ? { ...item, reviewNote: value } : item)
    });
  },
  async markReviewed(event) {
    const submissionId = event.currentTarget.dataset.id;
    const submission = this.data.submissions.find((item) => item.id === submissionId);
    const scoreText = String(submission?.reviewScore || "").trim();
    const score = Number(scoreText);
    if (!scoreText || !Number.isFinite(score)) {
      wx.showToast({ title: "请先填写教师确认分数", icon: "none" });
      return;
    }
    try {
      await api.markSubmissionReviewed(submissionId, { score, reviewNote: submission.reviewNote || "小程序教师端确认复核" });
      wx.showToast({ title: "已复核", icon: "none" });
      this.loadSubmissions();
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    }
  }
});
