const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function asText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function listLines(items, fallback) {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${asText(String(item), "")}`).filter(Boolean)
    : [`- ${fallback}`];
}

function profileDraftToText(snapshot, studentName) {
  const source = snapshot || {};
  const narrative = source.narrative || {};
  const mastery = source.mastery || {};
  const sourceCounts = source.sourceCounts || {};
  const risks = source.risks || [];
  const strengths = source.strengths || [];
  const nextActions = narrative.nextActions || risks;

  return [
    `${studentName} 学生档案反馈草稿`,
    "",
    "一、近期概况",
    asText(narrative.teacherSummary, "系统已汇总近期任务、批改、问答和课堂记录，等待老师复核。"),
    "",
    "二、知识掌握",
    `语文：${mastery["语文"] || 0}%`,
    `数学：${mastery["数学"] || 0}%`,
    `英语：${mastery["英语"] || 0}%`,
    "",
    "三、表现亮点",
    ...listLines(strengths, "暂无明显优势标签，建议继续补充课堂、作业和批改记录。"),
    "",
    "四、待巩固内容",
    ...listLines(risks, "暂未形成稳定薄弱点，继续观察错题和任务完成情况。"),
    "",
    "五、下一步建议",
    ...listLines(nextActions, "保持今日任务完成节奏，错题订正后再安排同类题复练。"),
    "",
    "六、阶段反馈",
    `本周：${asText(narrative.weeklyFeedback, "结合本周任务、批改和课堂记录持续观察。")}`,
    `本月：${asText(narrative.monthlyFeedback, "月度反馈会随着更多学习记录自动更新。")}`,
    "",
    "七、老师复核参考",
    `当前汇总了任务 ${sourceCounts.tasks || 0} 条、批改 ${sourceCounts.submissions || 0} 条、待处理错题 ${sourceCounts.mistakes || 0} 条。`
  ].join("\n");
}

Page({
  data: {
    draftText: "",
    loading: false,
    message: "",
    selectedIndex: 0,
    selectedStudentName: "",
    snapshot: null,
    students: []
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) {
      return;
    }
    try {
      const bootstrap = await api.bootstrap();
      const students = (bootstrap.students || []).filter(
        (item) => !item.responsibleTeacherId || item.responsibleTeacherId === teacher.id
      );
      const selectedStudent = students[this.data.selectedIndex] || students[0] || null;
      this.setData({ students, selectedStudentName: selectedStudent ? selectedStudent.displayName : "" });
      if (students.length && !this.data.draftText) {
        const student = selectedStudent;
        this.setData({
          draftText: student.publishedProfileText || "请选择“生成档案草稿”，系统会根据任务、批改、问答和课堂记录生成可编辑文本。"
        });
      }
    } catch (error) {
      wx.showToast({ title: error.message || "学生档案加载失败", icon: "none" });
    }
  },
  setStudent(event) {
    const selectedIndex = Number(event.detail.value);
    const student = this.data.students[selectedIndex];
    this.setData({
      selectedIndex,
      selectedStudentName: student ? student.displayName : "",
      snapshot: null,
      draftText: student && student.publishedProfileText
        ? student.publishedProfileText
        : "请选择“生成档案草稿”，系统会根据任务、批改、问答和课堂记录生成可编辑文本。",
      message: ""
    });
  },
  setDraftText(event) {
    this.setData({ draftText: event.detail.value });
  },
  async generateDraft() {
    const student = this.data.students[this.data.selectedIndex];
    if (!student) {
      wx.showToast({ title: "请先选择学生", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "正在生成学生档案草稿..." });
    try {
      const response = await api.draftStudentProfile(student.id);
      const text = profileDraftToText(response.snapshot, student.displayName);
      this.setData({
        snapshot: response.snapshot,
        draftText: text,
        message: "草稿已生成，请老师查看并修改后再发布。"
      });
    } catch (error) {
      this.setData({ message: error.message || "档案草稿生成失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async publishDraft() {
    const student = this.data.students[this.data.selectedIndex];
    const text = this.data.draftText.trim();
    if (!student || !text) {
      wx.showToast({ title: "请先生成或填写档案内容", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "正在发布至学生端..." });
    try {
      await api.publishStudentProfile(student.id, {
        snapshot: this.data.snapshot || {},
        text
      });
      this.setData({ message: "已发布至学生端。家长和学生只能看到老师确认后的内容。" });
      wx.showToast({ title: "已发布", icon: "success" });
    } catch (error) {
      this.setData({ message: error.message || "档案发布失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
