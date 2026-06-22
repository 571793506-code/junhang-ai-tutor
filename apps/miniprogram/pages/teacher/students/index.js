const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    createMessage: "",
    creating: false,
    draft: {
      className: "",
      displayName: "",
      guardianName: "",
      guardianPhone: "",
      notes: "",
      textbookVersion: ""
    },
    gradeIndex: 0,
    grades: ["三年级", "四年级", "五年级", "六年级"],
    students: []
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    api.bootstrap()
      .then((bootstrap) => {
        const ownStudents = (bootstrap.students || []).filter(
          (item) => !item.responsibleTeacherId || item.responsibleTeacherId === teacher.id
        );
        this.setData({ students: ownStudents });
      })
      .catch(() => wx.showToast({ title: "学生加载失败", icon: "none" }));
  },
  setDraft(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`draft.${field}`]: event.detail.value });
  },
  setGrade(event) {
    this.setData({ gradeIndex: Number(event.detail.value) });
  },
  async createStudent() {
    const teacher = session.getTeacher();
    const draft = this.data.draft;
    if (!teacher) {
      wx.redirectTo({ url: "/pages/role/index?role=teacher" });
      return;
    }
    if (!draft.displayName.trim() || !draft.guardianPhone.trim()) {
      wx.showToast({ title: "请填写姓名和家长电话", icon: "none" });
      return;
    }
    this.setData({ creating: true, createMessage: "" });
    try {
      const response = await api.registerStudent({
        ...draft,
        grade: this.data.grades[this.data.gradeIndex],
        responsibleTeacherId: teacher.id,
        createdByTeacherId: teacher.id,
        school: "君航课后辅导"
      });
      this.setData({
        createMessage: `已生成学生专属码：${response.accessCode}`,
        draft: {
          className: "",
          displayName: "",
          guardianName: "",
          guardianPhone: "",
          notes: "",
          textbookVersion: ""
        }
      });
      this.onShow();
    } catch (error) {
      this.setData({ createMessage: error.message || "学生登记失败。" });
    } finally {
      this.setData({ creating: false });
    }
  },
  async resetCode(event) {
    const studentId = event.currentTarget.dataset.id;
    const teacher = session.getTeacher();
    try {
      const response = await api.resetStudentCode(studentId, { createdByTeacherId: teacher?.id });
      wx.showModal({
        title: "新专属码",
        content: response.accessCode,
        showCancel: false
      });
      this.onShow();
    } catch (error) {
      wx.showToast({ title: error.message || "重置失败", icon: "none" });
    }
  },
  async disableAccess(event) {
    const studentId = event.currentTarget.dataset.id;
    try {
      await api.updateStudentAccess(studentId, {
        enrollmentStatus: "WITHDRAWN",
        loginEnabled: false
      });
      wx.showToast({ title: "已停用登录", icon: "none" });
      this.onShow();
    } catch (error) {
      wx.showToast({ title: error.message || "停用失败", icon: "none" });
    }
  }
});
