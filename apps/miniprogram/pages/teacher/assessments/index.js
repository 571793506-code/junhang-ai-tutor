const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

const JOB_STATUS_LABELS = {
  queued: "排队中",
  generating: "正在生成内容",
  exporting_draft: "正在生成审查 PDF",
  cancelling: "正在停止",
  ready_for_review: "待审查",
  failed: "生成失败",
  cancelled: "已取消"
};

function finalAssetsFromAssignment(assignment) {
  if (!assignment || !assignment.finalExportAssets) return [];
  return [assignment.finalExportAssets.studentPaper, assignment.finalExportAssets.answerAnalysis].filter(Boolean);
}

Page({
  data: {
    assignments: [],
    difficulties: ["基础", "提高", "综合"],
    difficultyIndex: 0,
    draftAsset: null,
    finalAssets: [],
    jobs: [],
    kindIndex: 0,
    kinds: ["练习", "小测", "试卷"],
    latestAssignmentId: "",
    latestJobId: "",
    loading: false,
    requirement: "",
    studentIndex: 0,
    studentNames: [],
    students: [],
    subjectIndex: 0,
    subjects: ["语文", "数学", "英语"],
    textbookIndex: 0,
    textbookNames: [],
    textbooks: [],
    chapterIndex: 0,
    chapterNames: [],
    chapters: []
  },
  async onShow() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    await this.loadContext(teacher);
    await this.refreshJobs();
    this.startJobPolling();
  },
  onHide() {
    this.stopJobPolling();
  },
  onUnload() {
    this.stopJobPolling();
  },
  startJobPolling() {
    this.stopJobPolling();
    this.jobTimer = setInterval(() => this.refreshJobs(), 2500);
  },
  stopJobPolling() {
    if (this.jobTimer) clearInterval(this.jobTimer);
    this.jobTimer = null;
  },
  async loadContext(teacher) {
    try {
      const bootstrap = await api.bootstrap();
      const students = (bootstrap.students || []).filter(
        (item) => (!item.responsibleTeacherId || item.responsibleTeacherId === teacher.id) && item.canReceiveNewWork
      );
      this.setData({
        assignments: bootstrap.assignments || [],
        students,
        studentNames: students.map((item) => `${item.displayName} · ${item.grade}`),
        studentIndex: 0
      });
      await this.loadTextbooks();
    } catch (error) {
      wx.showToast({ title: error.message || "生成上下文加载失败", icon: "none" });
    }
  },
  async loadTextbooks() {
    const student = this.data.students[this.data.studentIndex];
    if (!student) {
      this.setData({ textbooks: [], textbookNames: [], chapters: [], chapterNames: [] });
      return;
    }
    try {
      const response = await api.listTextbooks({
        subject: this.data.subjects[this.data.subjectIndex],
        grade: student.grade
      });
      const textbooks = response.assets || [];
      const chapters = (textbooks[0] && textbooks[0].chapters) || [];
      this.setData({
        textbooks,
        textbookNames: textbooks.map((item) => `${item.title} · ${item.volume}`),
        textbookIndex: 0,
        chapters,
        chapterNames: chapters.map((item) => item.title),
        chapterIndex: 0
      });
    } catch (error) {
      this.setData({ textbooks: [], textbookNames: [], chapters: [], chapterNames: [] });
      wx.showToast({ title: error.message || "教材加载失败", icon: "none" });
    }
  },
  setKind(event) {
    this.setData({ kindIndex: Number(event.detail.value) });
  },
  setStudent(event) {
    this.setData({ studentIndex: Number(event.detail.value) }, () => this.loadTextbooks());
  },
  setSubject(event) {
    this.setData({ subjectIndex: Number(event.detail.value) }, () => this.loadTextbooks());
  },
  setDifficulty(event) {
    this.setData({ difficultyIndex: Number(event.detail.value) });
  },
  setTextbook(event) {
    const textbookIndex = Number(event.detail.value);
    const textbook = this.data.textbooks[textbookIndex];
    const chapters = (textbook && textbook.chapters) || [];
    this.setData({ textbookIndex, chapters, chapterNames: chapters.map((item) => item.title), chapterIndex: 0 });
  },
  setChapter(event) {
    this.setData({ chapterIndex: Number(event.detail.value) });
  },
  setRequirement(event) {
    this.setData({ requirement: event.detail.value });
  },
  async submit() {
    const teacher = await guard.requireRole("teacher", this);
    if (!teacher) return;
    const student = this.data.students[this.data.studentIndex];
    const textbook = this.data.textbooks[this.data.textbookIndex];
    const chapter = this.data.chapters[this.data.chapterIndex];
    const kind = this.data.kinds[this.data.kindIndex];
    if (!student) {
      wx.showToast({ title: "请选择可接收新任务的学生", icon: "none" });
      return;
    }
    if (!this.data.requirement.trim()) {
      wx.showToast({ title: "请输入生成要求", icon: "none" });
      return;
    }
    if (kind === "小测" && (!textbook || !chapter)) {
      wx.showToast({ title: "教材小测必须选择教材和章节", icon: "none" });
      return;
    }
    const request = {
      teacherId: teacher.id,
      targetScope: "student",
      studentId: student.id,
      studentName: student.displayName,
      grade: student.grade,
      subject: this.data.subjects[this.data.subjectIndex],
      kind,
      difficulty: this.data.difficulties[this.data.difficultyIndex],
      requirement: this.data.requirement.trim(),
      contentScope: (chapter && chapter.title) || this.data.requirement.trim(),
      title: `${student.displayName}${this.data.subjects[this.data.subjectIndex]}${kind}`,
      generationBasis: kind === "小测" ? "textbook_reviewed" : "teacher_requirement",
      ...(kind === "小测" ? {
        textbookAssetId: textbook.id,
        textbookTitle: textbook.title,
        textbookEdition: textbook.edition,
        textbookSeries: textbook.curriculumSeries,
        textbookVolume: textbook.volume,
        textbookRegion: textbook.curriculumRegion,
        textbookChapterId: chapter.id,
        textbookChapterTitle: chapter.title
      } : {})
    };
    this.setData({ loading: true, draftAsset: null, finalAssets: [] });
    try {
      const response = await api.createAssessmentGenerationJob(request);
      this.setData({ latestJobId: response.job.id });
      await this.refreshJobs();
      wx.showToast({ title: "已加入生成队列", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "生成任务创建失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async refreshJobs() {
    try {
      const response = await api.listAssessmentGenerationJobs();
      const assignmentsById = new Map(this.data.assignments.map((item) => [item.id, item]));
      const jobs = (response.jobs || []).map((job) => {
        const assignment = job.assignmentId ? assignmentsById.get(job.assignmentId) : null;
        const finalAssets = finalAssetsFromAssignment(assignment);
        return {
          ...job,
          finalAssets,
          reviewStatus: assignment && assignment.draftReviewStatus,
          statusLabel: finalAssets.length ? "已正式导出" : assignment && assignment.draftReviewStatus === "rejected" ? "已退回" : JOB_STATUS_LABELS[job.status] || "处理中"
        };
      });
      const selected = jobs.find((job) => job.id === this.data.latestJobId) || jobs[0];
      const ready = selected && selected.status === "ready_for_review" && selected.assignmentId && selected.draftAsset && selected.reviewStatus !== "rejected" && !selected.finalAssets.length;
      this.setData({
        jobs,
        latestJobId: (selected && selected.id) || this.data.latestJobId,
        latestAssignmentId: ready ? selected.assignmentId : "",
        draftAsset: ready ? selected.draftAsset : null,
        finalAssets: (selected && selected.finalAssets) || []
      });
    } catch (error) {
      if (!this.data.jobs.length) wx.showToast({ title: error.message || "生成队列加载失败", icon: "none" });
    }
  },
  selectJob(event) {
    const job = this.data.jobs.find((item) => item.id === event.currentTarget.dataset.id);
    if (!job) return;
    const ready = job.status === "ready_for_review" && job.assignmentId && job.draftAsset && job.reviewStatus !== "rejected" && !job.finalAssets.length;
    this.setData({
      latestJobId: job.id,
      latestAssignmentId: ready ? job.assignmentId : "",
      draftAsset: ready ? job.draftAsset : null,
      finalAssets: job.finalAssets || []
    });
  },
  openDraft() {
    if (!this.data.draftAsset || !this.data.draftAsset.url) return;
    wx.downloadFile({
      url: this.data.draftAsset.url,
      success(res) {
        wx.openDocument({ filePath: res.tempFilePath, fileType: "pdf" });
      }
    });
  },
  openFinalAsset(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.downloadFile({
      url,
      success(res) {
        wx.openDocument({ filePath: res.tempFilePath, fileType: "pdf" });
      }
    });
  },
  async acceptDraft() {
    if (!this.data.latestAssignmentId) return;
    const assignmentId = this.data.latestAssignmentId;
    this.setData({ loading: true });
    try {
      await api.reviewAssessmentDraft(assignmentId, { decision: "accept" });
      const exported = await api.exportAssessmentPrint(assignmentId);
      const finalAssets = exported.assets || [exported.asset, exported.analysisAsset].filter(Boolean);
      this.setData({
        assignments: this.data.assignments.map((item) => item.id === assignmentId ? {
          ...item,
          draftReviewStatus: "accepted",
          finalExportAssets: { studentPaper: exported.asset, answerAnalysis: exported.analysisAsset || null }
        } : item),
        finalAssets,
        draftAsset: null,
        latestAssignmentId: ""
      });
      wx.showToast({ title: "正式 PDF 已生成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "导出失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async rejectDraft() {
    if (!this.data.latestAssignmentId) return;
    try {
      await api.reviewAssessmentDraft(this.data.latestAssignmentId, { decision: "reject" });
      this.setData({ latestAssignmentId: "", draftAsset: null });
      wx.showToast({ title: "草稿已退回", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "退回失败", icon: "none" });
    }
  },
  async cancelJob(event) {
    const jobId = event.currentTarget.dataset.id;
    if (!jobId) return;
    try {
      await api.cancelAssessmentGenerationJob(jobId);
      await this.refreshJobs();
    } catch (error) {
      wx.showToast({ title: error.message || "停止失败", icon: "none" });
    }
  }
});
