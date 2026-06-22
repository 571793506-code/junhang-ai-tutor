const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

Page({
  data: {
    grades: ["三年级", "四年级", "五年级", "六年级"],
    gradeIndex: 3,
    index: null,
    loading: false,
    message: "",
    sourceDraft: {
      sourceUrl: "",
      summary: "",
      title: ""
    },
    sources: [],
    stats: {
      approved: 0,
      documents: 0,
      pending: 0,
      sources: 0
    },
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"],
    teacher: {}
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    this.setData({ teacher });
    this.loadContentContext();
  },
  currentSubject() {
    return this.data.subjects[this.data.subjectIndex] || "语文";
  },
  currentGrade() {
    return this.data.grades[this.data.gradeIndex] || "六年级";
  },
  setSubject(event) {
    this.setData({ subjectIndex: Number(event.detail.value) });
  },
  setGrade(event) {
    this.setData({ gradeIndex: Number(event.detail.value) });
  },
  setDraft(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`sourceDraft.${field}`]: event.detail.value });
  },
  refreshStats(index, sources) {
    const safeSources = sources || [];
    this.setData({
      stats: {
        approved: safeSources.filter((item) => item.allowedForGeneration).length,
        documents: index?.documentCount || 0,
        pending: safeSources.filter((item) => item.reviewStatus === "PENDING").length,
        sources: safeSources.length
      }
    });
  },
  async loadContentContext() {
    this.setData({ loading: true, message: "" });
    try {
      const [indexResponse, sourceResponse] = await Promise.all([
        api.getContentIndex(),
        api.listKnowledgeSources()
      ]);
      const index = indexResponse.index || null;
      const sources = sourceResponse.sources || [];
      this.setData({ index, sources });
      this.refreshStats(index, sources);
    } catch (error) {
      this.setData({ message: error.message || "资料上下文加载失败，请检查 API 服务。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async syncIndex() {
    this.setData({ loading: true, message: "" });
    try {
      const result = await api.syncKnowledgeSourcesFromIndex();
      await this.loadContentContext();
      this.setData({ message: `已同步 ${result.sync.sourceCount} 个来源、${result.sync.chunkCount} 个片段，等待教师复核。` });
    } catch (error) {
      this.setData({ message: error.message || "同步内容索引失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async createSource() {
    const draft = this.data.sourceDraft;
    if (!draft.title.trim()) {
      wx.showToast({ title: "请填写参考标题", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      await api.createKnowledgeSource({
        grade: this.currentGrade(),
        licenseStatus: "REVIEW_REQUIRED",
        sourceType: "network-reference",
        sourceUrl: draft.sourceUrl.trim(),
        subject: this.currentSubject(),
        summary: draft.summary.trim(),
        title: draft.title.trim()
      });
      this.setData({
        message: "网络参考已登记，复核通过后才可作为生成参考。",
        sourceDraft: { sourceUrl: "", summary: "", title: "" }
      });
      await this.loadContentContext();
    } catch (error) {
      this.setData({ message: error.message || "登记网络参考失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async approveSource(event) {
    const sourceId = event.currentTarget.dataset.id;
    await this.reviewSource(sourceId, {
      allowedForGeneration: true,
      licenseStatus: "REVIEW_REQUIRED",
      note: "教师确认可作为知识结构和题型参考。",
      status: "APPROVED"
    });
  },
  async disableSource(event) {
    const sourceId = event.currentTarget.dataset.id;
    await this.reviewSource(sourceId, {
      allowedForGeneration: false,
      licenseStatus: "NOT_ALLOWED",
      note: "暂不用于生成参考。",
      status: "REJECTED"
    });
  },
  async reviewSource(sourceId, input) {
    if (!sourceId) return;
    this.setData({ loading: true, message: "" });
    try {
      await api.reviewKnowledgeSource(sourceId, input);
      await this.loadContentContext();
      this.setData({ message: input.status === "APPROVED" ? "资料已复核通过。" : "资料已停用。" });
    } catch (error) {
      this.setData({ message: error.message || "资料复核失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
