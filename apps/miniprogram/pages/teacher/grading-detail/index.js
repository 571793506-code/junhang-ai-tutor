const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function displayText(value, fallback) {
  return value == null || value === "" ? fallback : String(value);
}

function normalizeQuestion(item) {
  return {
    id: item.id || item.questionId || item.questionNo || "",
    questionNo: displayText(item.questionNo, "-"),
    status: displayText(item.status, "待确认"),
    scoreText: `${displayText(item.score, "-")} / ${displayText(item.maxScore, "-")}`,
    confidenceText: item.confidence != null ? `${Math.round(Number(item.confidence) * 100)}%` : "待确认",
    studentAnswer: displayText(item.studentAnswer, "未识别到学生作答"),
    correctAnswer: displayText(item.correctAnswer, "待教师确认"),
    errorStep: displayText(item.errorStep, "暂无错误步骤说明"),
    explanation: displayText(item.explanation, "暂无解析说明"),
    knowledgePoint: displayText(item.knowledgePoint, "待标注")
  };
}

function normalizePage(item, index) {
  const issues = Array.isArray(item.qualityIssues) ? item.qualityIssues.join("；") : "";
  return {
    id: item.id || item.imageName || `page-${index + 1}`,
    title: `第${item.pageNumber || index + 1}页`,
    qualityText: displayText(item.qualityStatus, "待检查"),
    scoreText: item.qualityScore != null ? String(item.qualityScore) : "-",
    issuesText: issues || "暂无图片质量提示",
    imageUrl: item.imageUrl || ""
  };
}

Page({
  data: {
    loading: false,
    message: "",
    pages: [],
    questions: [],
    summary: {},
    workbench: null
  },
  async onLoad(options) {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    const submissionId = options && options.submissionId ? decodeURIComponent(options.submissionId) : "";
    if (!submissionId) {
      this.setData({ message: "缺少批改记录 ID。" });
      return;
    }
    this.loadWorkbench(submissionId);
  },
  async loadWorkbench(submissionId) {
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.getGradingWorkbench(submissionId);
      const workbench = response.workbench || response;
      this.setData({
        workbench,
        pages: (workbench.pages || []).map(normalizePage),
        questions: (workbench.questions || []).map(normalizeQuestion),
        summary: {
          title: workbench.title || `${workbench.subject || "批改"} · ${workbench.studentName || "学生"}`,
          statusText: workbench.needsTeacherReview ? "需要教师确认" : "可复核归档",
          scoreText: workbench.score != null ? String(workbench.score) : workbench.provisionalScore != null ? `${workbench.provisionalScore}（暂定）` : "待确认",
          qualityText: workbench.quality && workbench.quality.status ? workbench.quality.status : "待检查",
          pendingText: `${workbench.pendingQuestionCount || 0}题待确认`
        }
      });
    } catch (error) {
      this.setData({ message: error.message || "批改详情加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
