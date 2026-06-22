const api = require("../../../utils/api");
const session = require("../../../utils/session");

Page({
  data: {
    accessCode: "",
    loading: false,
    message: "",
    phone: ""
  },
  onLoad() {
    const teacher = session.getTeacher();
    if (teacher) wx.redirectTo({ url: "/pages/teacher/console/index" });
  },
  setPhone(event) {
    this.setData({ phone: event.detail.value });
  },
  setAccessCode(event) {
    this.setData({ accessCode: event.detail.value.toUpperCase() });
  },
  goRole() {
    wx.redirectTo({ url: "/pages/role/index?role=teacher" });
  },
  async login() {
    if (!this.data.phone.trim() || !this.data.accessCode.trim()) {
      this.setData({ message: "请补全手机号和教师码。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.loginTeacher({
        name: "",
        phone: this.data.phone.trim(),
        accessCode: this.data.accessCode.trim()
      });
      session.setToken(response.sessionToken);
      session.setTeacher(response.teacher);
      wx.redirectTo({ url: "/pages/teacher/console/index" });
    } catch (error) {
      this.setData({ message: error.message || "教师端登录失败，请检查教师权限。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
