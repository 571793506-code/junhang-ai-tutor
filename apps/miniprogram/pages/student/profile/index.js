const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    corrections: [],
    reports: [],
    student: {},
    subjects: []
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (!student) {
      return;
    }
    api.bootstrap()
      .then((bootstrap) => {
        const fullStudent = (bootstrap.students || []).find((item) => item.id === student.id) || student;
        const mastery = fullStudent.mastery || {};
        this.setData({
          corrections: (bootstrap.corrections || []).slice(0, 8),
          reports: (bootstrap.reports || []).slice(0, 4),
          student: fullStudent,
          subjects: ["语文", "数学", "英语"].map((name) => ({ name, value: mastery[name] || 0 }))
        });
      })
      .catch(() => wx.showToast({ title: "档案加载失败", icon: "none" }));
  }
});
