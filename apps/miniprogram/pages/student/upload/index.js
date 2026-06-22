const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    files: [],
    kindIndex: 0,
    kinds: ["作业批改", "练习批改", "小测批改", "试卷批改", "听写批改"],
    loading: false,
    message: "",
    note: "",
    pageNumber: "",
    questionRange: "",
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"]
  },
  setKind(event) {
    this.setData({ kindIndex: Number(event.detail.value) });
  },
  setSubject(event) {
    this.setData({ subjectIndex: Number(event.detail.value) });
  },
  setNote(event) {
    this.setData({ note: event.detail.value });
  },
  setPageNumber(event) {
    this.setData({ pageNumber: event.detail.value });
  },
  setQuestionRange(event) {
    this.setData({ questionRange: event.detail.value });
  },
  chooseImages() {
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const paths = res.tempFiles.map((file) => file.tempFilePath);
        this.setData({ files: [...this.data.files, ...paths] });
      }
    });
  },
  async submit() {
    const student = await guard.requireRole("student", this);
    if (!student) return;
    if (!this.data.files.length) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      await api.uploadSubmission({
        files: this.data.files,
        fields: {
          studentId: student.id,
          studentName: student.displayName,
          subject: this.data.subjects[this.data.subjectIndex],
          kind: this.data.kinds[this.data.kindIndex],
          title: `${this.data.kinds[this.data.kindIndex]}-${student.displayName}`,
          uploadedBy: "student",
          ocrText: this.data.note,
          pageNumber: this.data.pageNumber,
          questionRange: this.data.questionRange
        }
      });
      this.setData({ files: [], note: "", pageNumber: "", questionRange: "", message: "已提交，等待老师复核。" });
    } catch (error) {
      this.setData({ message: error.message || "提交失败，请稍后再试。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
