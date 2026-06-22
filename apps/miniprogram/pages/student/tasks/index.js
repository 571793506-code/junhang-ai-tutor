const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    tasks: []
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (!student) {
      return;
    }
    api.bootstrap()
      .then((bootstrap) => {
        this.setData({
          tasks: (bootstrap.tasks || []).filter((item) => item.studentId === student.id || item.studentName === student.displayName)
        });
      })
      .catch(() => wx.showToast({ title: "任务加载失败", icon: "none" }));
  }
});
