const api = require("../../../utils/api");
const guard = require("../../../utils/guard");
const session = require("../../../utils/session");

Page({
  data: {
    answer: "",
    broadcasts: [],
    device: {},
    dictations: [],
    loading: false,
    plugins: [
      { key: "qa", enabled: true, icon: "问", note: "确认身份后提问", title: "AI 问答", tone: "cyan" },
      { key: "dictation", enabled: true, icon: "听", note: "接收教师端发布", title: "听写播报", tone: "green" },
      { key: "reading", enabled: true, icon: "读", note: "课文跟读任务", title: "课文跟读", tone: "blue" },
      { key: "team", enabled: false, icon: "组", note: "后续按需开启", title: "小队互动", tone: "orange" }
    ],
    question: "",
    readings: [],
    selectedName: "",
    selectedStudent: null,
    students: [],
    tasks: [],
    unlocked: false,
    voiceStatus: ""
  },
  async onShow() {
    const device = await guard.requireRole("classroom", this);
    if (!device) return;
    this.loadData();
  },
  async loadData() {
    try {
      const bootstrap = await api.bootstrap();
      const boundDevice = session.getDevice();
      const device =
        (bootstrap.classroomDevices || []).find((item) => item.id === boundDevice?.id) ||
        boundDevice ||
        (bootstrap.classroomDevices || [])[0] ||
        {};
      const grade = device.grade || "三年级";
      const students = (bootstrap.students || [])
        .filter((item) => item.grade === grade)
        .slice(0, 4)
        .map((item, index) => ({
          ...item,
          initial: (item.displayName || "学").slice(0, 1),
          selected: false,
          slot: assignSlot(item, index)
        }));
      this.setData({
        broadcasts: (bootstrap.classroomBroadcasts || []).filter((item) => !device.id || item.deviceId === device.id).slice(0, 4),
        device,
        dictations: (bootstrap.dictationTasks || []).filter((item) => !device.id || item.deviceId === device.id).slice(0, 3),
        readings: (bootstrap.readingTasks || [])
          .filter((item) => !device.id || item.deviceId === device.id)
          .slice(0, 3)
          .map((item) => ({
            ...item,
            focusText: Array.isArray(item.focusItems) ? item.focusItems.map(formatFocusItem).join(" / ") : ""
          })),
        students,
        tasks: (bootstrap.tasks || [])
          .filter((item) => students.some((student) => student.id === item.studentId || student.displayName === item.studentName))
          .slice(0, 6)
      });
    } catch (error) {
      wx.showToast({ title: "课堂数据加载失败", icon: "none" });
    }
  },
  unlockStudent(event) {
    const id = event.currentTarget.dataset.id;
    const selectedStudent = this.data.students.find((item) => item.id === id);
    const students = this.data.students.map((item) => ({
      ...item,
      selected: item.id === id
    }));
    this.setData({
      answer: "",
      question: "",
      selectedName: selectedStudent ? selectedStudent.displayName : "",
      selectedStudent,
      students,
      unlocked: true
    });
  },
  lockScreen() {
    if (!this.data.unlocked) return;
    this.setData({
      answer: "",
      question: "",
      selectedName: "",
      selectedStudent: null,
      students: this.data.students.map((item) => ({ ...item, selected: false })),
      unlocked: false,
      voiceStatus: ""
    });
  },
  startVoiceInput() {
    this.setData({ voiceStatus: "语音输入通道已预留；当前先使用文字模拟识别结果。" });
  },
  playAnswer() {
    if (!this.data.answer) {
      wx.showToast({ title: "暂无可播报内容", icon: "none" });
      return;
    }
    this.setData({ voiceStatus: "语音输出通道已预留；真实音频由服务端语音任务返回后播放。" });
  },
  setQuestion(event) {
    this.setData({ question: event.detail.value });
  },
  async ask() {
    if (!this.data.selectedStudent) {
      wx.showToast({ title: "请先点击学生头像", icon: "none" });
      return;
    }
    if (!this.data.question.trim()) {
      wx.showToast({ title: "请先输入问题", icon: "none" });
      return;
    }
    this.setData({ loading: true, answer: "" });
    try {
      const response = await api.askClassroomVoice({
        deviceId: this.data.device.id,
        studentId: this.data.selectedStudent.id,
        studentName: this.data.selectedStudent.displayName,
        transcript: this.data.question.trim()
      });
      this.setData({
        answer: response.result.answer || "已记录本次课堂提问。",
        voiceStatus: response.result.voice && response.result.voice.available ? "语音输出已生成。" : "问答已归档，语音输出暂不可用。"
      });
    } catch (error) {
      this.setData({ answer: error.message || "课堂问答暂时不可用。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});

const studentsSlotSeed = ["top", "right", "bottom", "left"];

function assignSlot(_student, index) {
  return studentsSlotSeed[index % studentsSlotSeed.length];
}

function formatFocusItem(item) {
  if (typeof item !== "string") return "";
  if (item.includes("-") || item.includes("—")) return item;
  const meanings = {
    carry: "搬运，携带",
    bright: "明亮的",
    quietly: "安静地",
    careful: "仔细的",
    story: "故事"
  };
  return meanings[item] ? `${item} - ${meanings[item]}` : item;
}
