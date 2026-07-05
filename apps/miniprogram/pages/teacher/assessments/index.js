const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    difficulties: ["基础", "提高", "综合", "冲刺"],
    difficultyIndex: 0,
    draftAsset: null,
    finalAssets: [],
    gradeIndex: 0,
    grades: ["三年级", "四年级", "五年级", "六年级"],
    lastRequest: null,
    latestAssignmentId: "",
    kindIndex: 0,
    kinds: ["练习", "小测", "试卷"],
    loading: false,
    requirement: "",
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"]
  },
  setKind(event) {
    this.setData({ kindIndex: Number(event.detail.value) });
  },
  setSubject(event) {
    this.setData({ subjectIndex: Number(event.detail.value) });
  },
  setGrade(event) {
    this.setData({ gradeIndex: Number(event.detail.value) });
  },
  setDifficulty(event) {
    this.setData({ difficultyIndex: Number(event.detail.value) });
  },
  setRequirement(event) {
    this.setData({ requirement: event.detail.value });
  },
  async submit() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    if (!this.data.requirement.trim()) {
      wx.showToast({ title: "请输入生成要求", icon: "none" });
      return;
    }
    await this.generateDraft(teacher);
  },
  async generateDraft(teacher, requestOverride) {
    const kind = this.data.kinds[this.data.kindIndex];
    const pages = kind === "试卷" ? 4 : 2;
    const request = requestOverride || {
      teacherId: teacher.id,
      kind,
      subject: this.data.subjects[this.data.subjectIndex],
      grade: this.data.grades[this.data.gradeIndex],
      difficulty: this.data.difficulties[this.data.difficultyIndex],
      requirement: this.data.requirement.trim(),
      pages,
      createAssignment: true
    };
    this.setData({ loading: true, draftAsset: null, finalAssets: [] });
    try {
      const response = await api.draftAssessment(request);
      const assignmentId = response.result && response.result.persisted && response.result.persisted.assignmentId;
      if (!assignmentId) throw new Error("未拿到可审查的生成记录");
      const draft = await api.exportAssessmentDraft(assignmentId);
      this.setData({ latestAssignmentId: assignmentId, lastRequest: request, draftAsset: draft.asset || null });
    } catch (error) {
      wx.showToast({ title: error.message || "AI生成失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  openDraft() {
    if (!this.data.draftAsset || !this.data.draftAsset.url) return;
    wx.downloadFile({
      url: this.data.draftAsset.url,
      success(res) {
        wx.openDocument({ filePath: res.tempFilePath, fileType: "pdf" });
      }
    });
  },
  async acceptDraft() {
    if (!this.data.latestAssignmentId) return;
    this.setData({ loading: true });
    try {
      await api.reviewAssessmentDraft(this.data.latestAssignmentId, { decision: "accept" });
      const exported = await api.exportAssessmentPrint(this.data.latestAssignmentId);
      this.setData({ finalAssets: exported.assets || [exported.asset, exported.analysisAsset].filter(Boolean) });
      wx.showToast({ title: "正式PDF已生成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "导出失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async rejectDraft() {
    if (!this.data.latestAssignmentId || !this.data.lastRequest) return;
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    try {
      await api.reviewAssessmentDraft(this.data.latestAssignmentId, { decision: "reject" });
      await this.generateDraft(teacher, this.data.lastRequest);
    } catch (error) {
      wx.showToast({ title: error.message || "重新生成失败", icon: "none" });
    }
  }
});
