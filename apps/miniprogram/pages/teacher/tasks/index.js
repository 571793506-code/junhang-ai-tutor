const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    draftText: "",
    loading: false,
    requirement: "",
    studentIndex: 0,
    studentNames: [],
    students: [],
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"],
    title: ""
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
  },
  setStudent(event) {
    this.setData({ studentIndex: Number(event.detail.value) });
  },
  setSubject(event) {
    this.setData({ subjectIndex: Number(event.detail.value) });
  },
  setTitle(event) {
    this.setData({ title: event.detail.value });
  },
  setRequirement(event) {
    this.setData({ requirement: event.detail.value });
  },
  async submit() {
    const teacher = session.getTeacher();
    const student = this.data.students[this.data.studentIndex];
    if (!teacher || !student) {
      wx.showToast({ title: "请先选择学生", icon: "none" });
      return;
    }
    if (!this.data.requirement.trim()) {
      wx.showToast({ title: "请输入任务内容", icon: "none" });
      return;
    }
    this.setData({ loading: true, draftText: "" });
    try {
      const response = await api.draftTask({
        teacherId: teacher.id,
        studentId: student.id,
        studentName: student.displayName,
        subject: this.data.subjects[this.data.subjectIndex],
        title: this.data.title.trim() || this.data.requirement.trim().slice(0, 20),
        requirement: this.data.requirement.trim(),
        minutes: 15,
        createTask: true
      });
      this.setData({ draftText: response.result.draftText || "AI生成任务已写入。" });
    } catch (error) {
      this.setData({ draftText: error.message || "AI生成任务失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
