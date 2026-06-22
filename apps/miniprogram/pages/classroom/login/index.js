const api = require("../../../utils/api");
const session = require("../../../utils/session");

Page({
  data: {
    bindingCode: "",
    loading: false,
    message: ""
  },
  onLoad() {
    const device = session.getDevice();
    if (device) wx.redirectTo({ url: "/pages/classroom/dashboard/index" });
  },
  setBindingCode(event) {
    this.setData({ bindingCode: event.detail.value.toUpperCase() });
  },
  goRole() {
    wx.redirectTo({ url: "/pages/role/index?role=classroom" });
  },
  async login() {
    if (!this.data.bindingCode.trim()) {
      this.setData({ message: "请输入设备绑定码。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.loginDevice({ bindingCode: this.data.bindingCode.trim() });
      session.setToken(response.sessionToken);
      session.setDevice(response.device);
      wx.redirectTo({ url: "/pages/classroom/dashboard/index" });
    } catch (error) {
      this.setData({ message: error.message || "平板端绑定失败，请检查绑定码。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
