const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function submittedWords(terms) {
  return String(terms || "")
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

Page({
  data: {
    deletingId: "",
    entries: [],
    failures: [],
    loading: false,
    message: "",
    submitting: false,
    terms: ""
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (student) await this.loadEntries();
  },
  setTerms(event) {
    this.setData({ terms: event.detail.value });
  },
  async loadEntries() {
    this.setData({ loading: true });
    try {
      const response = await api.listStudentVocabulary();
      this.setData({ entries: response.result?.entries || [] });
    } catch (error) {
      this.setData({ message: error.message || "词汇本暂时无法加载。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async addVocabulary() {
    const words = submittedWords(this.data.terms);
    if (!words.length || this.data.submitting) {
      if (!words.length) wx.showToast({ title: "请先输入英文单词", icon: "none" });
      return;
    }
    this.setData({ submitting: true, failures: [], message: "" });
    try {
      const response = await api.createStudentVocabulary({ words });
      const failures = response.result?.failures || [];
      this.setData({
        terms: "",
        failures,
        message: failures.length ? "部分单词没有生成词卡。" : ""
      });
      await this.loadEntries();
    } catch (error) {
      this.setData({ message: error.message || "词卡暂时无法生成。" });
    } finally {
      this.setData({ submitting: false });
    }
  },
  removeVocabulary(event) {
    const entryId = event.currentTarget.dataset.id;
    if (!entryId || this.data.deletingId) return;
    wx.showModal({
      title: "删除词卡",
      content: "删除后将从你的词汇本中移除这张词卡。",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ deletingId: entryId, message: "" });
        try {
          await api.deleteStudentVocabulary(entryId);
          await this.loadEntries();
        } catch (error) {
          this.setData({ message: error.message || "词卡删除失败，请稍后重试。" });
        } finally {
          this.setData({ deletingId: "" });
        }
      }
    });
  }
});
