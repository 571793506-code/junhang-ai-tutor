const api = require("../../utils/api");
const session = require("../../utils/session");

const ROLE_META = {
  student: {
    button: "进入学生端",
    desc: "任务、AI 问答、词汇、拍照提交和学习档案。",
    formTitle: "学生端登录",
    icon: "学",
    kicker: "学生 / 家长端",
    name: "学生端",
    note: "使用学生姓名、家长电话和老师提供的学生专属码登录。",
    shortNote: "家庭学习入口"
  },
  teacher: {
    button: "进入教师端",
    desc: "学生权限、任务发布、批改复核和展示控制。",
    formTitle: "教师端登录",
    icon: "师",
    kicker: "教师端",
    name: "教师端",
    note: "使用教师手机号和教师码登录，进入工作台后再管理任务与复核。",
    shortNote: "教学管理入口"
  },
  classroom: {
    button: "绑定并进入平板端",
    desc: "公共待机、头像确认、课堂问答和互动插件。",
    formTitle: "平板端绑定",
    icon: "板",
    kicker: "课堂平板端",
    name: "平板端",
    note: "输入设备绑定码后进入课堂公共屏，本端不展示学生完整个人主页。",
    shortNote: "课堂公共设备入口"
  }
};

function buildRoles(activeRole) {
  return ["student", "teacher", "classroom"].map((key) => ({
    key,
    active: key === activeRole,
    ...ROLE_META[key]
  }));
}

Page({
  data: {
    activeMeta: ROLE_META.student,
    activeRole: "student",
    bindingCode: "",
    displayName: "",
    guardianPhone: "",
    loading: false,
    message: "",
    roles: buildRoles("student"),
    selected: false,
    studentCode: "",
    teacherCode: "",
    teacherPhone: ""
  },
  onLoad(options) {
    if (options && ROLE_META[options.role]) {
      this.applyRole(options.role, true);
    }
  },
  applyRole(role, selected) {
    this.setData({
      activeMeta: ROLE_META[role],
      activeRole: role,
      message: "",
      roles: buildRoles(role),
      selected
    });
  },
  selectRole(event) {
    const role = event.currentTarget.dataset.role;
    if (!ROLE_META[role]) return;
    this.applyRole(role, true);
  },
  setDisplayName(event) {
    this.setData({ displayName: event.detail.value });
  },
  setGuardianPhone(event) {
    this.setData({ guardianPhone: event.detail.value });
  },
  setStudentCode(event) {
    this.setData({ studentCode: event.detail.value.toUpperCase() });
  },
  setTeacherPhone(event) {
    this.setData({ teacherPhone: event.detail.value });
  },
  setTeacherCode(event) {
    this.setData({ teacherCode: event.detail.value.toUpperCase() });
  },
  setBindingCode(event) {
    this.setData({ bindingCode: event.detail.value.toUpperCase() });
  },
  async login() {
    const role = this.data.activeRole;
    if (role === "student") {
      await this.loginStudent();
      return;
    }
    if (role === "teacher") {
      await this.loginTeacher();
      return;
    }
    await this.loginDevice();
  },
  async loginStudent() {
    if (!this.data.displayName.trim() || !this.data.guardianPhone.trim() || !this.data.studentCode.trim()) {
      this.setData({ message: "请补全学生姓名、家长电话和学生专属码。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.loginStudent({
        displayName: this.data.displayName.trim(),
        guardianPhone: this.data.guardianPhone.trim(),
        accessCode: this.data.studentCode.trim()
      });
      session.setToken(response.sessionToken);
      session.setStudent(response.student);
      wx.redirectTo({ url: "/pages/student/home/index" });
    } catch (error) {
      this.setData({ message: error.message || "学生端登录失败，请检查信息。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loginTeacher() {
    if (!this.data.teacherPhone.trim() || !this.data.teacherCode.trim()) {
      this.setData({ message: "请补全手机号和教师码。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.loginTeacher({
        name: "",
        phone: this.data.teacherPhone.trim(),
        accessCode: this.data.teacherCode.trim()
      });
      session.setToken(response.sessionToken);
      session.setTeacher(response.teacher);
      wx.redirectTo({ url: "/pages/teacher/console/index" });
    } catch (error) {
      this.setData({ message: error.message || "教师端登录失败，请检查教师权限。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loginDevice() {
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
