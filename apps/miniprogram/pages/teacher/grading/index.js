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
    studentIndex: 0,
    studentNames: [],
    students: [],
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"],
    workbenches: [],
    workbenchMessage: ""
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    api.bootstrap()
      .then((bootstrap) => {
        const students = (bootstrap.students || []).filter(
          (item) => !item.responsibleTeacherId || item.responsibleTeacherId === teacher.id
        );
        this.setData({
          students,
          studentNames: students.map((item) => `${item.displayName} · ${item.grade}`)
        });
      })
      .catch(() => wx.showToast({ title: "学生加载失败", icon: "none" }));
    this.loadWorkbenches();
  },
  async loadWorkbenches() {
    try {
      const response = await api.listGradingWorkbenches();
      const workbenches = (response.workbenches || []).map((item) => ({
        ...item,
        displayTitle: item.title || `${item.subject || "批改"} · ${item.studentName || "学生"}`,
        qualityText: item.quality && item.quality.status ? item.quality.status : "待检查",
        statusText: item.needsTeacherReview ? "需要教师确认" : "可归档复核",
        pendingText: `${item.pendingQuestionCount || 0}题待确认`
      }));
      this.setData({
        workbenches,
        workbenchMessage: workbenches.length ? "" : "暂无待复核批改记录。"
      });
    } catch (error) {
      this.setData({ workbenchMessage: error.message || "批改工作台加载失败。" });
    }
  },
  setStudent(event) {
    this.setData({ studentIndex: Number(event.detail.value) });
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
  openWorkbenchDetail(event) {
    const submissionId = event.currentTarget.dataset.id;
    if (!submissionId) {
      wx.showToast({ title: "缺少批改记录 ID", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/teacher/grading-detail/index?submissionId=${encodeURIComponent(submissionId)}` });
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
    const teacher = session.getTeacher();
    const student = this.data.students[this.data.studentIndex];
    if (!teacher || !student) {
      wx.showToast({ title: "请先选择学生", icon: "none" });
      return;
    }
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
          grade: student.grade,
          uploadedBy: "teacher",
          teacherId: teacher.id,
          ocrText: this.data.note,
          pageNumber: this.data.pageNumber,
          questionRange: this.data.questionRange
        }
      });
      this.setData({ files: [], note: "", pageNumber: "", questionRange: "", message: "批改记录已提交，后续可继续复核。" });
      this.loadWorkbenches();
    } catch (error) {
      this.setData({ message: error.message || "上传批改失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
