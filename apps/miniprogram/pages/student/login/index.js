const api = require("../../../utils/api");
const session = require("../../../utils/session");

Page({
  data: {
    accessCode: "",
    displayName: "",
    guardianPhone: "",
    loading: false,
    message: ""
  },
  onLoad() {
    const student = session.getStudent();
    if (student) wx.redirectTo({ url: "/pages/student/home/index" });
  },
  setDisplayName(event) {
    this.setData({ displayName: event.detail.value });
  },
  setGuardianPhone(event) {
    this.setData({ guardianPhone: event.detail.value });
  },
  setAccessCode(event) {
    this.setData({ accessCode: event.detail.value.toUpperCase() });
  },
  goRole() {
    wx.redirectTo({ url: "/pages/role/index?role=student" });
  },
  async login() {
    if (!this.data.displayName.trim() || !this.data.guardianPhone.trim() || !this.data.accessCode.trim()) {
      this.setData({ message: "请补全学生姓名、家长电话和学生专属码。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.loginStudent({
        displayName: this.data.displayName.trim(),
        guardianPhone: this.data.guardianPhone.trim(),
        accessCode: this.data.accessCode.trim()
      });
      session.setToken(response.sessionToken);
      session.setStudent(response.student);
      wx.redirectTo({ url: "/pages/student/home/index" });
    } catch (error) {
      this.setData({ message: error.message || "学生端登录失败，请检查信息。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
