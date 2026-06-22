const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

const fallbackRisks = {
  语文: "阅读概括、病句修改、易错字订正",
  数学: "应用题数量关系、几何分类讨论",
  英语: "词形变化、一般过去时、造句完整性"
};

const moduleBase = [
  {
    key: "tasks",
    desc: "查看老师发布的任务与完成状态。",
    icon: "任",
    status: "老师发布",
    title: "今日任务",
    tone: "blue"
  },
  {
    key: "qa",
    desc: "先想一步，再向 AI 提出问题。",
    icon: "问",
    status: "思路引导",
    title: "AI 问答",
    tone: "cyan"
  },
  {
    key: "vocabulary",
    desc: "查单词、看词性、练易错变化。",
    icon: "词",
    status: "词汇助手",
    title: "英语词汇",
    tone: "green"
  },
  {
    key: "upload",
    desc: "提交作业、练习、小测或试卷。",
    icon: "拍",
    status: "等待老师查看",
    title: "拍照提交",
    tone: "purple"
  },
  {
    key: "profile",
    desc: "查看老师复核后发布的阶段反馈。",
    icon: "档",
    status: "家长可读",
    title: "学生档案",
    tone: "orange"
  },
  {
    key: "optional",
    desc: "小队挑战等活动由老师开启后可用。",
    disabled: true,
    icon: "扩",
    status: "低强调预留",
    title: "互动扩展",
    tone: "green"
  }
];

Page({
  data: {
    activeSubject: "语文",
    assignments: [],
    masteryValue: 0,
    modules: moduleBase,
    openAssignments: [],
    student: {},
    students: [],
    subjectRisks: fallbackRisks["语文"],
    subjects: ["语文", "数学", "英语"],
    tasks: [],
    todayTasks: []
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (!student) {
      return;
    }
    this.setData({ student });
    this.loadData();
  },
  async loadData() {
    try {
      const bootstrap = await api.bootstrap();
      const fullStudent = (bootstrap.students || []).find((item) => item.id === this.data.student.id) || this.data.student;
      const todayTasks = (bootstrap.tasks || []).filter((item) => item.studentId === fullStudent.id || item.studentName === fullStudent.displayName);
      const openAssignments = (bootstrap.assignments || []).filter(
        (item) => item.studentId === fullStudent.id || item.studentName === fullStudent.displayName || item.targetGrade === fullStudent.grade
      );
      this.setData({
        assignments: bootstrap.assignments || [],
        openAssignments,
        student: fullStudent,
        students: bootstrap.students || [],
        tasks: bootstrap.tasks || [],
        todayTasks
      });
      this.refreshSubject();
    } catch (error) {
      wx.showToast({ title: "使用本地缓存", icon: "none" });
      this.refreshSubject();
    }
  },
  refreshSubject() {
    const subject = this.data.activeSubject;
    const mastery = this.data.student.mastery || {};
    const masteryValue = mastery[subject] || 0;
    const risks = Array.isArray(this.data.student.risks) && this.data.student.risks.length
      ? this.data.student.risks.join("、")
      : fallbackRisks[subject];
    this.setData({ masteryValue, subjectRisks: risks || fallbackRisks[subject] });
  },
  selectSubject(event) {
    this.setData({ activeSubject: event.currentTarget.dataset.subject }, () => this.refreshSubject());
  },
  openModule(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "tasks") return this.goTasks();
    if (key === "qa") return this.goQa();
    if (key === "vocabulary") return this.goVocabulary();
    if (key === "upload") return this.goUpload();
    if (key === "profile") return this.goProfile();
    wx.showToast({ title: "互动活动由老师开启后显示", icon: "none" });
    return null;
  },
  goTasks() {
    wx.navigateTo({ url: "/pages/student/tasks/index" });
  },
  goQa() {
    wx.navigateTo({ url: "/pages/student/qa/index" });
  },
  goVocabulary() {
    wx.navigateTo({ url: "/pages/student/vocabulary/index" });
  },
  goProfile() {
    wx.navigateTo({ url: "/pages/student/profile/index" });
  },
  goUpload() {
    wx.navigateTo({ url: "/pages/student/upload/index" });
  }
});
