import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  Home,
  ListChecks,
  Lock,
  MessageSquareText,
  MonitorCheck,
  Search,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  ScreenShare,
  Sparkles,
  TerminalSquare,
  Unlock,
  Upload,
  UserRound,
  UsersRound,
  Volume2
} from "lucide-react";
import type { AssignmentCard, ClassroomBroadcast, ClassroomDevice, CorrectionRecord, DictationTask, LearningLog, LearningTaskCard, ReadingTask, StudentProfile, StudentReportCard, SubjectLabel, TeacherProfile } from "@junhang/core";
import {
  askStudentQuestion,
  completeLearningTask,
  type ContentIndexSummary,
  type VocabularyCard,
  draftStudentProfile,
  draftAssessment,
  draftTeacherTask,
  exportAssessmentDraft,
  exportAssessmentPrint,
  getAdminAudit,
  getApiStatus,
  getBootstrapData,
  getContentIndex,
  archiveGradingWorkbench,
  listGradingWorkbenches,
  generateVocabularyCard,
  createKnowledgeSource,
  listKnowledgeSources,
  type KnowledgeSource,
  loginClassroom,
  loginStudent,
  loginTeacher,
  listReviewSubmissions,
  listTextbooks,
  openTextbook,
  publishClassroomBroadcast,
  publishDictation,
  publishReading,
  publishStudentProfile,
  recognizeReviewSubmission,
  rebuildContentIndex,
  reviewKnowledgeSource,
  registerStudent,
  reviewAssessmentDraft,
  rescanTextbooks,
  resetStudentAccessCodeApi,
  setClassroomDeviceLock,
  setSessionToken,
  syncKnowledgeSourcesFromIndex,
  updateTextbookChapters,
  updateStudentAccessStatusApi,
  uploadTeachingMaterials,
  uploadSubmission
} from "./api";
import "./styles.css";

type Role = "student" | "teacher" | "classroom";
type ProviderStatus = "ready" | "blocked" | "unavailable" | "pending";

type AiSnapshot = Awaited<ReturnType<typeof getApiStatus>>["ai"];
type Bootstrap = Awaited<ReturnType<typeof getBootstrapData>>;
type ReviewSubmission = Awaited<ReturnType<typeof listReviewSubmissions>>["submissions"][number];
type GradingWorkbench = Awaited<ReturnType<typeof listGradingWorkbenches>>["workbenches"][number];
type AdminAudit = Awaited<ReturnType<typeof getAdminAudit>>;
type TextbookAsset = Awaited<ReturnType<typeof listTextbooks>>["assets"][number];
type TextbookChapter = NonNullable<TextbookAsset["chapters"]>[number];
type PrintAssetLink = { id: string; title: string; url: string };
type ProfileDraft = { studentId: string; studentName: string; snapshot: Record<string, unknown>; text: string };
type AssessmentRequestInput = { targetScope?: "student" | "grade"; studentId?: string; targetGrade?: string; subject?: SubjectLabel; kind?: string; difficulty?: string; requirement?: string; textbookAssetId?: string; textbookTitle?: string; textbookChapterId?: string; textbookChapterTitle?: string };
type AssessmentDraftRef = { assignmentId: string; title: string; subject: SubjectLabel; kind: string; targetLabel: string; request: AssessmentRequestInput; draftAsset?: PrintAssetLink; reviewStatus: "pending" | "accepted" | "rejected" };
type StudentRegistrationInput = { displayName: string; grade: string; className: string; school: string; textbookVersion: string; guardianName: string; guardianPhone: string; notes: string; enrollmentStatus: string };
type ReviewUploadSource = "taskEvidence" | "grading";
type ReviewSubmissionBatch = {
  id: string;
  title: string;
  studentName: string;
  subject: string;
  kind: string;
  uploadedBy: string;
  submittedAt: string;
  imageTotal: number;
  submissions: ReviewSubmission[];
};
type ReviewUploadStatus = {
  source: ReviewUploadSource;
  state: "uploading" | "grading" | "done" | "failed";
  message: string;
  detail: string;
};

type SyncState = {
  busy: boolean;
  ok: boolean | null;
  message: string;
};

const PROTECTED_TEXTBOOK_EXTENSION = ".edupdf";

function isProtectedTextbookFile(file: File) {
  return file.name.toLowerCase().endsWith(PROTECTED_TEXTBOOK_EXTENSION);
}

function splitTeachingMaterialFiles(files: File[]) {
  return {
    safeFiles: files.filter((file) => !isProtectedTextbookFile(file)),
    protectedFiles: files.filter(isProtectedTextbookFile)
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function normalizeAiAnswerText(value: unknown) {
  let current: unknown = value;
  if (typeof current === "string") {
    const trimmed = current.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        current = JSON.parse(trimmed);
      } catch {
        current = trimmed;
      }
    }
  }
  if (current && typeof current === "object") {
    const record = current as Record<string, unknown>;
    current = record.answer || record.aiResponse || record.response || record.text || "";
  }
  return String(current || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .trim();
}

function profileDraftToPlainText(snapshot: Record<string, unknown>, studentName: string) {
  const narrative = recordValue(snapshot.narrative);
  const sourceCounts = recordValue(snapshot.sourceCounts);
  const strengths = stringList(snapshot.strengths);
  const risks = stringList(snapshot.risks);
  const nextActions = stringList(narrative.nextActions);
  const recentTasks = Array.isArray(snapshot.recentTasks) ? snapshot.recentTasks.slice(0, 4).map(recordValue) : [];
  const recentMistakes = Array.isArray(snapshot.unresolvedMistakes) ? snapshot.unresolvedMistakes.slice(0, 4).map(recordValue) : [];
  const lines = [
    `${studentName} 学生档案反馈草稿`,
    "",
    "一、近期整体情况",
    stringValue(narrative.parentSummary, `${studentName}近期综合掌握度为 ${snapshot.weeklyScore ?? "-"} 分，整体状态为${stringValue(snapshot.tone, "持续观察")}。`),
    "",
    "二、表现较好的地方",
    ...(strengths.length ? strengths.map((item) => `- ${item}`) : ["- 暂无明显优势标签，建议继续补充课堂、作业和批改记录。"]),
    "",
    "三、需要巩固的地方",
    ...(risks.length ? risks.map((item) => `- ${item}`) : ["- 暂未发现集中薄弱点，继续保持日常观察。"]),
    "",
    "四、近期错题与订正重点",
    ...(recentMistakes.length ? recentMistakes.map((item) => `- ${stringValue(item.subject)} ${stringValue(item.point) || stringValue(item.prompt)}：${stringValue(item.cause, "需要继续订正和复盘。")}`) : ["- 暂无未解决错题，建议继续保持日常记录。"]),
    "",
    "五、下一步建议",
    ...(nextActions.length ? nextActions.map((item) => `- ${item}`) : ["- 保持今日任务完成节奏，错题订正后再安排同类题复练。"]),
    "",
    "六、阶段反馈",
    `本周：${stringValue(narrative.weeklyFeedback, "结合本周任务、批改和课堂记录持续观察。")}`,
    `本月：${stringValue(narrative.monthlyFeedback, "月度反馈会随着记录增加继续完善。")}`,
    `期中：${stringValue(narrative.midtermFeedback, "期中反馈暂以阶段错题和掌握趋势为基础。")}`,
    `期末：${stringValue(narrative.finalFeedback, "期末反馈暂以长期掌握度、错题闭环和学习习惯为基础。")}`,
    "",
    "七、老师复核参考",
    `当前汇总了任务 ${sourceCounts.tasks ?? 0} 条、批改 ${sourceCounts.submissions ?? 0} 条、待处理错题 ${sourceCounts.mistakes ?? 0} 条。`,
    ...(recentTasks.length ? ["近期任务：" + recentTasks.map((item) => stringValue(item.title)).filter(Boolean).join("；")] : [])
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const subjects: SubjectLabel[] = ["语文", "数学", "英语"] as SubjectLabel[];
const gradeOptions = ["三年级", "四年级", "五年级", "六年级"];
const idleSync: SyncState = { busy: false, ok: null, message: "本地演示待同步" };

const demoStudents: StudentProfile[] = [
  {
    id: "demo-student",
    displayName: "李子越",
    grade: "六年级",
    school: "君航课堂",
    className: "六年级 1 班",
    textbookVersion: "人教版",
    guardianName: "李女士",
    guardianPhone: "13900005678",
    responsibleTeacherId: "demo-teacher",
    responsibleTeacherName: "君航老师",
    accessCode: "LZY6P9",
    enrollmentStatus: "在读",
    loginEnabled: true,
    registeredAt: "2026-05-26",
    focus: "英语词形变化、数学应用题数量关系",
    weeklyScore: 82,
    streak: 6,
    mastery: { 语文: 76, 数学: 68, 英语: 84 } as Record<SubjectLabel, number>,
    strengths: ["英语词汇复习较稳定", "愿意主动提问"],
    risks: ["数学应用题审题不够稳定", "语文阅读答题缺少证据句"],
    tone: "近期状态稳定"
  }
];

const demoTeachers: TeacherProfile[] = [
  {
    id: "demo-teacher",
    displayName: "君航老师",
    phone: "13800000001",
    role: "主讲老师",
    accessCode: "T8JH21",
    status: "已开通"
  }
];

const demoDevices: ClassroomDevice[] = [
  {
    id: "demo-device",
    label: "六年级课堂平板",
    bindingCode: "PAD6JH",
    grade: "六年级",
    className: "六年级 1 班",
    teacherId: "demo-teacher",
    teacherName: "君航老师",
    status: "已绑定"
  }
];

const demoTasks: LearningTaskCard[] = [
  {
    id: "demo-task-1",
    studentId: "demo-student",
    studentName: "李子越",
    title: "英语 Unit 4 词汇听写与订正",
    subject: "英语" as SubjectLabel,
    status: "待完成",
    minutes: 12,
    dueLabel: "今日",
    source: "教师端生成",
    knowledgePoints: ["carry", "bright", "过去式"]
  }
];

const demoAssignments: AssignmentCard[] = [
  {
    id: "demo-assignment-1",
    studentId: "demo-student",
    studentName: "李子越",
    targetScope: "student",
    targetGrade: null,
    kind: "小测",
    title: "六年级英语一般过去时小测",
    subject: "英语" as SubjectLabel,
    status: "待完成",
    difficulty: "基础",
    minutes: 20,
    layoutTemplate: "英语小测A4打印模板-2页-1栏-mixed-lines",
    printProfile: {
      paper: "A4",
      pages: 2,
      columns: 1,
      answerSpace: "词汇与句型题保留短答横线",
      headerFields: ["姓名", "日期", "用时", "得分"],
      optimizationNotes: ["AI生成", "教师复核后打印"]
    },
    specialRequirements: "两页 A4，适合打印作答",
    submissionImageNames: [],
    score: null,
    totalScore: 100,
    items: ["写出 carry 的过去式", "用 went 造句"],
    grading: null
  }
];

const demoCorrections: CorrectionRecord[] = [
  {
    id: "demo-correction-1",
    subject: "数学" as SubjectLabel,
    point: "应用题数量关系",
    prompt: "把总量和份数关系写反，导致列式错误。",
    studentAnswer: "36 ÷ 4",
    correctAnswer: "36 × 4",
    cause: "没有先标出单位量和总量。",
    state: "待订正",
    knowledgePoint: "数量关系"
  }
];

const demoLogs: LearningLog[] = [
  { id: "demo-log-1", time: "18:30", feature: "今日任务", action: "完成英语词汇订正", result: "等待教师复核", actorType: "student" }
];

const demoReports: StudentReportCard[] = [
  {
    id: "demo-report-1",
    period: "本周",
    title: "本周学习反馈",
    summary: "英语词汇复习稳定，数学应用题仍需要加强审题和数量关系标注。",
    highlights: ["能按时完成词汇订正", "愿意追问不懂的题"],
    concerns: ["应用题列式前缺少关系标注"],
    nextActions: ["每天补 2 道同类应用题", "错题订正后说出解题思路"]
  }
];

function App() {
  const [role, setRole] = useState<Role>("teacher");
  const [activeModule, setActiveModule] = useState<Record<Role, string>>({
    teacher: "工作台",
    student: "主页",
    classroom: "课堂主页"
  });
  const [auth, setAuth] = useState({ studentId: "", teacherId: "", deviceId: "" });
  const [sync, setSync] = useState<SyncState>(idleSync);
  const [ai, setAi] = useState<AiSnapshot | null>(null);
  const [teachers, setTeachers] = useState<TeacherProfile[]>(demoTeachers);
  const [students, setStudents] = useState<StudentProfile[]>(demoStudents);
  const [tasks, setTasks] = useState<LearningTaskCard[]>(demoTasks);
  const [assignments, setAssignments] = useState<AssignmentCard[]>(demoAssignments);
  const [devices, setDevices] = useState<ClassroomDevice[]>(demoDevices);
  const [classroomBroadcasts, setClassroomBroadcasts] = useState<ClassroomBroadcast[]>([]);
  const [dictationTasks, setDictationTasks] = useState<DictationTask[]>([]);
  const [readingTasks, setReadingTasks] = useState<ReadingTask[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRecord[]>(demoCorrections);
  const [logs, setLogs] = useState<LearningLog[]>(demoLogs);
  const [reports, setReports] = useState<StudentReportCard[]>(demoReports);
  const [reviewSubmissions, setReviewSubmissions] = useState<ReviewSubmission[]>([]);
  const [gradingWorkbenches, setGradingWorkbenches] = useState<GradingWorkbench[]>([]);
  const [audit, setAudit] = useState<AdminAudit | null>(null);
  const [textbooks, setTextbooks] = useState<TextbookAsset[]>([]);
  const [contentIndex, setContentIndex] = useState<ContentIndexSummary | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [selectedTextbookContext, setSelectedTextbookContext] = useState<{ asset: TextbookAsset; chapter?: TextbookChapter } | null>(null);
  const [printAssets, setPrintAssets] = useState<PrintAssetLink[]>([]);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [latestAssessmentDraft, setLatestAssessmentDraft] = useState<AssessmentDraftRef | null>(null);
  const [question, setQuestion] = useState("等腰三角形一个角是40度，应该怎么思考？");
  const [answer, setAnswer] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [teacherPhone, setTeacherPhone] = useState("13800000001");
  const [teacherCode, setTeacherCode] = useState("T8JH21");
  const [studentName, setStudentName] = useState("李子越");
  const [guardianPhone, setGuardianPhone] = useState("13900005678");
  const [studentCode, setStudentCode] = useState("LZY6P9");
  const [deviceCode, setDeviceCode] = useState("PAD6JH");

  const currentTeacher = teachers.find((item) => item.id === auth.teacherId) || teachers[0];
  const currentStudent = students.find((item) => item.id === auth.studentId) || students[0];
  const currentDevice = devices.find((item) => item.id === auth.deviceId) || devices[0];
  const currentNav = role === "teacher" ? teacherNav : role === "student" ? studentNav : classroomNav;
  const currentModule = activeModule[role] || currentNav[0];

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    try {
      const status = await getApiStatus();
      setAi(status.ai);
      setSync({ busy: false, ok: status.database?.ok ?? true, message: status.database?.ok === false ? `数据库不可用：${status.database.reason}` : "API 已连接" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `API 未连接：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  function switchRole(nextRole: Role) {
    if (nextRole === role) return;
    setSessionToken();
    setAuth({ studentId: "", teacherId: "", deviceId: "" });
    setRole(nextRole);
    setActiveModule((value) => ({
      ...value,
      [nextRole]: value[nextRole] || (nextRole === "teacher" ? teacherNav[0] : nextRole === "student" ? studentNav[0] : classroomNav[0])
    }));
    setSync({ busy: false, ok: null, message: "已切换使用端，登录后同步对应端数据" });
  }

  async function applyBootstrap() {
    const data = await getBootstrapData();
    if (data.teachers.length) setTeachers(data.teachers);
    if (data.students.length) setStudents(data.students);
    setTasks(data.tasks);
    setAssignments(data.assignments);
    if (data.classroomDevices.length) setDevices(data.classroomDevices);
    setClassroomBroadcasts(data.classroomBroadcasts);
    setDictationTasks(data.dictationTasks);
    setReadingTasks(data.readingTasks);
    setCorrections(data.corrections);
    setLogs(data.logs);
    setReports(data.reports);
    return data;
  }

  async function refreshTeacherOps() {
    const [reviewData, workbenchData, auditData, textbookData, contentIndexData, knowledgeData] = await Promise.all([
      listReviewSubmissions(),
      listGradingWorkbenches(),
      getAdminAudit(),
      listTextbooks(),
      getContentIndex(),
      listKnowledgeSources()
    ]);
    setReviewSubmissions(reviewData.submissions);
    setGradingWorkbenches(workbenchData.workbenches);
    setAudit(auditData);
    setTextbooks(textbookData.assets);
    setContentIndex(contentIndexData.index);
    setKnowledgeSources(knowledgeData.sources);
  }

  async function handleTeacherLogin() {
    setSync({ busy: true, ok: null, message: "正在登录教师端..." });
    try {
      const response = await loginTeacher({ name: "", phone: teacherPhone, accessCode: teacherCode });
      setSessionToken(response.sessionToken);
      setAuth({ studentId: "", teacherId: response.teacher.id, deviceId: "" });
      await applyBootstrap();
      await refreshTeacherOps();
      const status = await getApiStatus();
      setAi(status.ai);
      setRole("teacher");
      setSync({ busy: false, ok: true, message: `教师端已登录：${response.teacher.displayName}` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `教师端登录失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function handleStudentLogin() {
    setSync({ busy: true, ok: null, message: "正在登录学生端..." });
    try {
      const response = await loginStudent({ displayName: studentName, guardianPhone, accessCode: studentCode });
      setSessionToken(response.sessionToken);
      setAuth({ studentId: response.student.id, teacherId: "", deviceId: "" });
      await applyBootstrap();
      setRole("student");
      setSync({ busy: false, ok: true, message: `学生端已登录：${response.student.displayName}` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `学生端登录失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function handleClassroomLogin() {
    setSync({ busy: true, ok: null, message: "正在绑定课堂平板..." });
    try {
      const response = await loginClassroom({ bindingCode: deviceCode });
      setSessionToken(response.sessionToken);
      setAuth({ studentId: "", teacherId: "", deviceId: response.device.id });
      await applyBootstrap();
      setRole("classroom");
      setSync({ busy: false, ok: true, message: `课堂平板已绑定：${response.device.label}` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `课堂平板绑定失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function createTask(input?: { studentId?: string; subject?: SubjectLabel; title?: string; requirement?: string; minutes?: number }) {
    const student = students.find((item) => item.id === input?.studentId) || currentStudent;
    const subject = input?.subject || "英语";
    const title = input?.title || `${student.displayName} 今日${subject}订正与巩固`;
    const requirement = input?.requirement || title;
    setTasks((items) => [{ ...demoTasks[0], id: `local-task-${Date.now()}`, studentId: student.id, studentName: student.displayName, title, subject, minutes: input?.minutes || 12, summary: requirement, description: requirement, knowledgePoints: input?.requirement ? [subject, "教师布置"] : demoTasks[0].knowledgePoints }, ...items]);
    try {
      const response = await draftTeacherTask({ studentId: student.id, studentName: student.displayName, subject, title, requirement, minutes: input?.minutes || 12 });
      setSync({ busy: false, ok: response.result.available, message: response.result.available ? "今日任务已生成并写入记录" : "任务已本地生成，AI暂不可用" });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `任务生成失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function createAssessment(input?: AssessmentRequestInput) {
    const student = students.find((item) => item.id === input?.studentId) || currentStudent;
    const targetScope = input?.targetScope || "student";
    const kind = input?.kind || "小测";
    const subject = input?.subject || "数学";
    const defaultPages = kind === "试卷" ? "四页 A4" : "两页 A4";
    const requirement = input?.requirement || `${defaultPages}，按试卷排版，保留足够作答空间。`;
    const request: AssessmentRequestInput = {
      targetScope,
      studentId: targetScope === "student" ? student.id : undefined,
      targetGrade: targetScope === "grade" ? input?.targetGrade || student.grade : undefined,
      subject,
      kind,
      difficulty: input?.difficulty || "基础",
      requirement,
      textbookAssetId: input?.textbookAssetId,
      textbookTitle: input?.textbookTitle,
      textbookChapterId: input?.textbookChapterId,
      textbookChapterTitle: input?.textbookChapterTitle
    };
    try {
      const response = await draftAssessment({
        ...request,
        grade: input?.targetGrade || student.grade,
        createAssignment: true
      });
      const assignmentId = response.result.persisted?.assignmentId;
      if (assignmentId) {
        const draftExport = await exportAssessmentDraft(assignmentId);
        setLatestAssessmentDraft({
          assignmentId,
          title: `${subject}${kind}排版稿`,
          subject,
          kind,
          targetLabel: targetScope === "grade" ? input?.targetGrade || student.grade : student.displayName,
          request,
          draftAsset: draftExport.asset,
          reviewStatus: "pending"
        });
        setPrintAssets([]);
      }
      setSync({ busy: false, ok: response.result.available, message: assignmentId ? `${kind}PDF草稿已生成，请先打开审查后再确认` : `${kind}已生成，但未拿到可审查的记录` });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `生成失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function exportLatestPrint(assignmentId: string) {
    try {
      await reviewAssessmentDraft(assignmentId, "accept");
      const response = await exportAssessmentPrint(assignmentId);
      setPrintAssets((response.assets?.length ? response.assets : [response.asset, response.analysisAsset].filter(Boolean)) as PrintAssetLink[]);
      setLatestAssessmentDraft((current) => current?.assignmentId === assignmentId ? { ...current, reviewStatus: "accepted" } : current);
      setSync({ busy: false, ok: true, message: response.analysisAsset ? "题目 PDF 和解析 PDF 已生成" : `打印稿已生成：${response.asset.title}` });
      await applyBootstrap();
      await refreshTeacherOps();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `打印导出失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function rejectAssessmentDraft(assignmentId: string) {
    const draft = latestAssessmentDraft;
    if (!draft || draft.assignmentId !== assignmentId) return;
    try {
      await reviewAssessmentDraft(assignmentId, "reject");
      setLatestAssessmentDraft({ ...draft, reviewStatus: "rejected" });
      setPrintAssets([]);
      setSync({ busy: true, ok: null, message: "已否决当前草稿，正在按原要求重新生成 PDF 草稿..." });
      await createAssessment(draft.request);
    } catch (error) {
      setSync({ busy: false, ok: false, message: `重新生成草稿失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function uploadForReview(input: { studentId: string; subject: SubjectLabel; kind: string; title: string; images: File[]; assignmentId?: string }) {
    if (!input.images.length) {
      setSync({ busy: false, ok: false, message: "请先选择需要批改的照片，可一次上传多张" });
      return;
    }
    try {
      const response = await uploadSubmission({
        studentId: input.studentId,
        assignmentId: input.assignmentId,
        subject: input.subject,
        kind: input.kind,
        title: input.title,
        uploadedBy: "teacher",
        images: input.images
      });
      setSync({ busy: false, ok: true, message: response.result.queued ? "照片已上传，正在后台识别批改" : response.result.available ? "照片已上传并生成批改初稿" : "照片已上传，等待人工复核" });
      await Promise.all([applyBootstrap(), refreshTeacherOps()]);
      return response;
    } catch (error) {
      setSync({ busy: false, ok: false, message: `上传批改失败：${error instanceof Error ? error.message : String(error)}` });
      throw error;
    }
  }

  async function uploadStudentSubmission(input: { studentId: string; subject: SubjectLabel; kind: string; title: string; images: File[] }) {
    if (!input.images.length) {
      setSync({ busy: false, ok: false, message: "请先拍照或选择需要提交的图片" });
      return;
    }
    try {
      const response = await uploadSubmission({
        studentId: input.studentId,
        subject: input.subject,
        kind: input.kind,
        title: input.title,
        uploadedBy: "student",
        images: input.images
      });
      setSync({ busy: false, ok: true, message: response.result.queued ? "图片已提交，正在后台识别批改" : response.result.available ? "图片已提交，等待老师复核批改" : "图片已提交，老师稍后查看" });
      await applyBootstrap();
      return response;
    } catch (error) {
      setSync({ busy: false, ok: false, message: `学生端提交失败：${error instanceof Error ? error.message : String(error)}` });
      throw error;
    }
  }

  async function refreshReviewQueue() {
    try {
      await refreshTeacherOps();
      setSync({ busy: false, ok: true, message: "批改队列与审计记录已刷新" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `刷新失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function recognizeSubmission(submissionId: string) {
    try {
      const response = await recognizeReviewSubmission(submissionId);
      setReviewSubmissions((items) => items.map((item) => (item.id === submissionId ? response.submission : item)));
      setSync({ busy: false, ok: response.available, message: response.available ? "图片已重新识别并重批" : "图片识别暂不可用，可手动复核" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `识别失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function markReviewed(submissionId: string, input: Record<string, unknown> = {}) {
    try {
      await archiveGradingWorkbench(submissionId, input);
      await refreshTeacherOps();
      setSync({ busy: false, ok: true, message: "已标记为复核完成并写入记录" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `复核失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function refreshTextbookLibrary(filters: { subject?: string; grade?: string; volume?: string; search?: string } = {}) {
    try {
      const response = await listTextbooks(filters);
      setTextbooks(response.assets);
      setSync({ busy: false, ok: true, message: `教材库已刷新：${response.assets.length} 条索引` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `教材库刷新失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function rescanTextbookLibrary() {
    setSync({ busy: true, ok: null, message: "正在扫描教材文件并写入只读索引..." });
    try {
      await rescanTextbooks();
      const response = await listTextbooks();
      setTextbooks(response.assets);
      setSync({ busy: false, ok: true, message: `教材库重扫完成：${response.assets.length} 条索引` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `教材库重扫失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function rebuildTeachingContentIndex() {
    setSync({ busy: true, ok: null, message: "正在重建资料索引..." });
    try {
      const response = await rebuildContentIndex({ inputs: ["exports/markdown-ingestion"], outDir: "exports/content-index" });
      setContentIndex(response.index);
      await refreshTeacherOps();
      setSync({ busy: false, ok: true, message: `资料索引已重建：${response.index.documentCount} 份资料` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料索引重建失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function uploadTeachingContent(files: File[]) {
    if (!files.length) {
      setSync({ busy: false, ok: false, message: "请先选择需要导入的教学资料。" });
      return;
    }
    const { protectedFiles } = splitTeachingMaterialFiles(files);
    if (protectedFiles.length) {
      setSync({ busy: false, ok: false, message: ".edupdf 受保护教材不能转换或改写，请从上传列表中移除后再导入。" });
      return;
    }
    setSync({ busy: true, ok: null, message: `正在导入 ${files.length} 份教学资料...` });
    try {
      const uploadResponse = await uploadTeachingMaterials(files, { outDir: "exports/markdown-ingestion" });
      const indexResponse = await rebuildContentIndex({ inputs: ["exports/markdown-ingestion"], outDir: "exports/content-index" });
      setContentIndex(indexResponse.index);
      setSync({ busy: false, ok: true, message: `已导入 ${uploadResponse.fileCount} 份资料，并重建 ${indexResponse.index.documentCount} 条索引。` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料导入失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function refreshKnowledgeLibrary() {
    try {
      const response = await listKnowledgeSources();
      setKnowledgeSources(response.sources);
      setSync({ busy: false, ok: true, message: `资料库已刷新：${response.sources.length} 条来源` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料库刷新失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function syncKnowledgeLibrary() {
    setSync({ busy: true, ok: null, message: "正在把内容索引同步到资料库..." });
    try {
      const response = await syncKnowledgeSourcesFromIndex();
      const sourceResponse = await listKnowledgeSources();
      setKnowledgeSources(sourceResponse.sources);
      setSync({ busy: false, ok: true, message: `资料库同步完成：${response.sync.sourceCount} 个来源，${response.sync.chunkCount} 个片段` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料库同步失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function addKnowledgeSource(input: Record<string, unknown>) {
    try {
      const response = await createKnowledgeSource(input);
      setKnowledgeSources((items) => [response.source, ...items]);
      setSync({ busy: false, ok: true, message: "网络参考来源已登记，需复核后才能用于生成。" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料来源登记失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function reviewKnowledgeLibrarySource(sourceId: string, input: Record<string, unknown>) {
    try {
      const response = await reviewKnowledgeSource(sourceId, input);
      setKnowledgeSources((items) => items.map((item) => (item.id === sourceId ? response.source : item)));
      setSync({ busy: false, ok: true, message: response.source.allowedForGeneration ? "资料已复核，可作为生成参考来源。" : "资料复核状态已更新。" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `资料复核失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function openTextbookAsset(assetId: string) {
    try {
      const response = await openTextbook(assetId);
      setSync({ busy: false, ok: response.opened, message: response.message });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `教材打开失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function saveTextbookChapters(assetId: string, chapters: TextbookChapter[]) {
    try {
      const response = await updateTextbookChapters(assetId, chapters);
      setTextbooks((items) => items.map((item) => (item.id === assetId ? response.asset : item)));
      setSelectedTextbookContext((current) => current?.asset.id === assetId ? { asset: response.asset, chapter: response.asset.chapters?.[0] } : current);
      setSync({ busy: false, ok: true, message: `章节索引已保存：${response.asset.chapterCount} 条` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `章节索引保存失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function resetStudentCode(studentId: string) {
    try {
      const response = await resetStudentAccessCodeApi(studentId);
      setSync({ busy: false, ok: true, message: `学生专属码已重置：${response.codePreview}` });
      await Promise.all([applyBootstrap(), refreshTeacherOps()]);
    } catch (error) {
      setSync({ busy: false, ok: false, message: `重置失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function updateStudentAccess(studentId: string, enabled: boolean) {
    try {
      await updateStudentAccessStatusApi(studentId, { loginEnabled: enabled, enrollmentStatus: enabled ? "在读" : "退课保留档案" });
      setSync({ busy: false, ok: true, message: enabled ? "学生端已开通" : "学生端已停用，档案继续保留" });
      await Promise.all([applyBootstrap(), refreshTeacherOps()]);
    } catch (error) {
      setSync({ busy: false, ok: false, message: `权限更新失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function createStudentProfileDraft(studentId?: string) {
    const student = students.find((item) => item.id === studentId) || currentStudent;
    try {
      const response = await draftStudentProfile(student.id);
      setStudents((items) => items.map((item) => (item.id === student.id ? response.student : item)));
      const draft = {
        studentId: student.id,
        studentName: student.displayName,
        snapshot: response.snapshot,
        text: profileDraftToPlainText(response.snapshot, student.displayName)
      };
      setProfileDraft(draft);
      setSync({ busy: false, ok: true, message: `${student.displayName} 档案草稿已生成，请先复核再发布` });
      return draft;
    } catch (error) {
      setSync({ busy: false, ok: false, message: `档案草稿生成失败：${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
  }

  async function publishStudentProfileDraft(input: { studentId: string; text: string }) {
    try {
      const snapshot = profileDraft?.studentId === input.studentId ? profileDraft.snapshot : {};
      const response = await publishStudentProfile(input.studentId, snapshot, input.text);
      setStudents((items) => items.map((item) => (item.id === input.studentId ? response.student : item)));
      setProfileDraft({ studentId: input.studentId, studentName: response.student.displayName, snapshot: response.snapshot, text: input.text });
      await applyBootstrap();
      setSync({ busy: false, ok: true, message: `${response.student.displayName} 档案已发布至学生端` });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `档案发布失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function askQa(input?: { subject?: "全科" | SubjectLabel; images?: File[] }) {
    try {
      setQaBusy(true);
      setAnswer("");
      const imageNote = input?.images?.length ? `\n\n学生已选择 ${input.images.length} 张问题图片：${input.images.map((file) => file.name).join("、")}。当前 Web 端先记录附件信息，若图片内容没有被识别，请引导学生补充题目文字。` : "";
      const response = await askStudentQuestion({ studentId: currentStudent.id, studentName: currentStudent.displayName, subject: input?.subject && input.subject !== "全科" ? input.subject : undefined, question: `${question}${imageNote}` });
      setAnswer(normalizeAiAnswerText(response.result.answer));
      setSync({ busy: false, ok: response.result.available, message: response.result.available ? "AI问答已归档" : "AI问答暂不可用" });
    } catch (error) {
      setSync({ busy: false, ok: false, message: `问答失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setQaBusy(false);
    }
  }

  async function askClassroomQa(input: { studentId: string; question: string }) {
    const student = students.find((item) => item.id === input.studentId);
    const response = await askStudentQuestion({
      deviceId: currentDevice.id,
      studentId: input.studentId,
      studentName: student?.displayName,
      question: input.question,
      context: "课堂平板端全科 AI 问答：日常知识、常识解释和英语词汇学习可以直接回答；题目、作业、小测、试卷或解题类问题必须做思路引导、关键步骤提示和追问，不直接替学生给最终答案。"
    });
    setSync({ busy: false, ok: response.result.available, message: response.result.available ? "平板问答已归档" : "平板问答暂不可用" });
    return response.result.answer;
  }

  async function publishTabletBroadcast(input: Record<string, unknown>) {
    try {
      await publishClassroomBroadcast(input);
      setSync({ busy: false, ok: true, message: "平板语音播报任务已发布" });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `语音播报发布失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function publishTabletDictation(input: Record<string, unknown>) {
    try {
      await publishDictation(input);
      setSync({ busy: false, ok: true, message: "平板听写任务已发布" });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `听写发布失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function publishTabletReading(input: Record<string, unknown>) {
    try {
      await publishReading(input);
      setSync({ busy: false, ok: true, message: "平板课文跟读任务已发布" });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `课文跟读发布失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function completeTaskFromTablet(taskId: string) {
    try {
      const response = await completeLearningTask(taskId, { note: "课堂平板端确认完成" });
      setTasks((items) => items.map((item) => (item.id === taskId ? response.task : item)));
      setSync({ busy: false, ok: true, message: "今日任务已标记完成并同步归档" });
      await applyBootstrap();
    } catch (error) {
      setSync({ busy: false, ok: false, message: `任务完成同步失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return (
    <div className={`app-shell role-${role}`}>
      <aside className="sidebar">
        <div className="brand"><GraduationCap size={28} /><div><strong>君航 AI 助教</strong><span>整体运行工作台</span></div></div>
        <div className="role-switch">
          <button className={role === "teacher" ? "active" : ""} onClick={() => switchRole("teacher")}>教师端</button>
          <button className={role === "student" ? "active" : ""} onClick={() => switchRole("student")}>学生端</button>
          <button className={role === "classroom" ? "active" : ""} onClick={() => switchRole("classroom")}>课堂平板</button>
        </div>
        <nav className="nav-list">
          {currentNav.map((item) => <button className={`nav-item ${currentModule === item ? "active" : ""}`} key={item} onClick={() => setActiveModule((value) => ({ ...value, [role]: item }))}><Home size={17} /><span>{item}</span></button>)}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar"><div><p className="eyebrow">{roleLabel(role)}</p><h1>{role === "teacher" ? `教师端 · ${currentModule}` : role === "student" ? `学生端 · ${currentModule}` : `课堂平板 · ${currentModule}`}</h1></div><ApiSyncStatus state={syncForRole(sync, role)} /></header>
        {role === "teacher" ? <TeacherWorkspace activeModule={currentModule} ai={ai} assignments={assignments} audit={audit} contentIndex={contentIndex} corrections={corrections} devices={devices} knowledgeSources={knowledgeSources} latestAssessmentDraft={latestAssessmentDraft} logs={logs} onAssessment={createAssessment} onAssessmentReject={rejectAssessmentDraft} onContentIndexRebuild={rebuildTeachingContentIndex} onContentUpload={uploadTeachingContent} onExportPrint={exportLatestPrint} onKnowledgeRefresh={refreshKnowledgeLibrary} onKnowledgeReview={reviewKnowledgeLibrarySource} onKnowledgeSourceCreate={addKnowledgeSource} onKnowledgeSync={syncKnowledgeLibrary} onMarkReviewed={markReviewed} onOpenModule={(module) => setActiveModule((value) => ({ ...value, teacher: module }))} onOpenTextbook={openTextbookAsset} onProfileDraft={createStudentProfileDraft} onProfilePublish={publishStudentProfileDraft} onRecognize={recognizeSubmission} onRefreshOps={refreshReviewQueue} onRefreshTextbooks={refreshTextbookLibrary} onRescanTextbooks={rescanTextbookLibrary} onResetCode={resetStudentCode} onSaveTextbookChapters={saveTextbookChapters} onSelectTextbookContext={setSelectedTextbookContext} onStudentAccess={updateStudentAccess} onStudentCreate={async (input) => {
          const name = input.displayName.trim();
          if (!name || !input.guardianPhone.trim()) {
            setSync({ busy: false, ok: false, message: "请至少填写学生姓名和家长电话" });
            return;
          }
          try {
            const response = await registerStudent({
              displayName: name,
              grade: input.grade,
              className: input.className,
              school: input.school,
              guardianName: input.guardianName,
              guardianPhone: input.guardianPhone,
              textbookVersion: input.textbookVersion,
              notes: input.notes,
              enrollmentStatus: input.enrollmentStatus
            });
            setSync({ busy: false, ok: true, message: `已登记 ${name}，专属码 ${response.codePreview}` });
            await Promise.all([applyBootstrap(), refreshTeacherOps()]);
          } catch (error) {
            setSync({ busy: false, ok: false, message: `学生登记失败：${error instanceof Error ? error.message : String(error)}` });
          }
        }} onTabletBroadcast={publishTabletBroadcast} onTabletDictation={publishTabletDictation} onTabletReading={publishTabletReading} onTask={createTask} onUnlock={async (unlocked) => {
          if (!currentDevice?.id) return;
          await setClassroomDeviceLock(currentDevice.id, unlocked);
          setSync({ busy: false, ok: true, message: unlocked ? "平板已解锁" : "平板已锁定" });
        }} gradingWorkbenches={gradingWorkbenches} onUploadReview={uploadForReview} printAssets={printAssets} profileDraft={profileDraft} reports={reports} reviewSubmissions={reviewSubmissions} selectedTextbookContext={selectedTextbookContext} students={students} tasks={tasks} teacher={currentTeacher} textbooks={textbooks} /> : null}
        {role === "student" ? <StudentWorkspace activeModule={currentModule} answer={answer} assignments={assignments} corrections={corrections} isLoggedIn={Boolean(auth.studentId)} logs={logs} onAsk={askQa} onLogin={handleStudentLogin} onModuleOpen={(module) => setActiveModule((value) => ({ ...value, student: module }))} onUploadReview={uploadStudentSubmission} qaBusy={qaBusy} question={question} reports={reports} setGuardianPhone={setGuardianPhone} setQuestion={setQuestion} setStudentCode={setStudentCode} setStudentName={setStudentName} student={currentStudent} tasks={tasks} /> : null}
        {role === "classroom" ? <ClassroomWorkspace activeModule={currentModule} classroomBroadcasts={classroomBroadcasts} device={currentDevice} devices={devices} dictationTasks={dictationTasks} onAsk={askClassroomQa} onLogin={handleClassroomLogin} onModuleOpen={(module) => setActiveModule((value) => ({ ...value, classroom: module }))} onTaskComplete={completeTaskFromTablet} readingTasks={readingTasks} setDeviceCode={setDeviceCode} students={students} tasks={tasks} /> : null}
        {role === "teacher" && !auth.teacherId ? <LoginPanel code={teacherCode} onCode={setTeacherCode} onLogin={handleTeacherLogin} onPhone={setTeacherPhone} phone={teacherPhone} title="教师端登录" /> : null}
      </main>
    </div>
  );
}

const teacherNav = ["工作台", "学生权限", "今日任务", "生成打印", "批改复核", "学生档案", "教材资料", "课堂设备", "系统状态"];
const studentNav = ["主页", "今日任务", "AI问答", "英语词汇", "拍照提交", "学生档案"];
const classroomNav = ["课堂主页", "今日任务", "AI问答", "听写播报", "课文跟读"];

function extractReadingFocusDraft(passage: string, subject: "语文" | "英语", context: { asset: TextbookAsset; chapter?: TextbookChapter } | null) {
  const contextItems = [
    ...(context?.chapter?.focusItems || []),
    ...(context?.chapter?.dictationItems || [])
  ].filter(Boolean);
  const text = passage.trim();
  if (subject === "英语") {
    const stopWords = new Set(["this", "that", "with", "from", "have", "they", "there", "about", "because", "when", "what", "where", "your", "their"]);
    const words = Array.from(new Set((text.match(/[A-Za-z]{4,}/g) || []).map((item) => item.toLowerCase())))
      .filter((item) => !stopWords.has(item))
      .slice(0, 10);
    return [...contextItems, ...words].filter(Boolean).slice(0, 12).join("\n");
  }
  const phrases = Array.from(new Set((text.match(/[\u4e00-\u9fa5]{2,4}/g) || [])))
    .filter((item) => !["课文", "同学", "老师", "我们", "他们", "时候"].includes(item))
    .slice(0, 10);
  return [...contextItems, ...phrases].filter(Boolean).slice(0, 12).join("\n");
}

function TeacherWorkspace({
  activeModule,
  ai,
  assignments,
  audit,
  contentIndex,
  corrections,
  devices,
  gradingWorkbenches,
  knowledgeSources,
  latestAssessmentDraft,
  logs,
  onAssessment,
  onAssessmentReject,
  onContentIndexRebuild,
  onContentUpload,
  onExportPrint,
  onKnowledgeRefresh,
  onKnowledgeReview,
  onKnowledgeSourceCreate,
  onKnowledgeSync,
  onMarkReviewed,
  onOpenModule,
  onOpenTextbook,
  onProfileDraft,
  onProfilePublish,
  onRecognize,
  onRefreshOps,
  onRefreshTextbooks,
  onRescanTextbooks,
  onResetCode,
  onSaveTextbookChapters,
  onSelectTextbookContext,
  onStudentAccess,
  onStudentCreate,
  onTabletBroadcast,
  onTabletDictation,
  onTabletReading,
  onTask,
  onUnlock,
  onUploadReview,
  printAssets,
  profileDraft,
  reports,
  reviewSubmissions,
  selectedTextbookContext,
  students,
  tasks,
  teacher,
  textbooks
}: {
  activeModule: string;
  ai: AiSnapshot | null;
  assignments: AssignmentCard[];
  audit: AdminAudit | null;
  contentIndex: ContentIndexSummary | null;
  corrections: CorrectionRecord[];
  devices: ClassroomDevice[];
  gradingWorkbenches: GradingWorkbench[];
  knowledgeSources: KnowledgeSource[];
  latestAssessmentDraft: AssessmentDraftRef | null;
  logs: LearningLog[];
  onAssessment: (input: AssessmentRequestInput) => void;
  onAssessmentReject: (assignmentId: string) => void;
  onContentIndexRebuild: () => void;
  onContentUpload: (files: File[]) => void;
  onExportPrint: (assignmentId: string) => void;
  onKnowledgeRefresh: () => void;
  onKnowledgeReview: (sourceId: string, input: Record<string, unknown>) => void;
  onKnowledgeSourceCreate: (input: Record<string, unknown>) => void;
  onKnowledgeSync: () => void;
  onMarkReviewed: (submissionId: string, input?: Record<string, unknown>) => void;
  onOpenModule: (module: string) => void;
  onOpenTextbook: (assetId: string) => void;
  onProfileDraft: (studentId?: string) => Promise<ProfileDraft | null>;
  onProfilePublish: (input: { studentId: string; text: string }) => Promise<void>;
  onRecognize: (submissionId: string) => void;
  onRefreshOps: () => void;
  onRefreshTextbooks: (filters?: { subject?: string; grade?: string; volume?: string; search?: string }) => void;
  onRescanTextbooks: () => void;
  onResetCode: (studentId: string) => void;
  onSaveTextbookChapters: (assetId: string, chapters: TextbookChapter[]) => void;
  onSelectTextbookContext: (context: { asset: TextbookAsset; chapter?: TextbookChapter } | null) => void;
  onStudentAccess: (studentId: string, enabled: boolean) => void;
  onStudentCreate: (input: StudentRegistrationInput) => void;
  onTabletBroadcast: (input: Record<string, unknown>) => void;
  onTabletDictation: (input: Record<string, unknown>) => void;
  onTabletReading: (input: Record<string, unknown>) => void;
  onTask: (input: { studentId?: string; subject?: SubjectLabel; title?: string; requirement?: string; minutes?: number }) => void;
  onUnlock: (unlocked: boolean) => void;
  onUploadReview: (input: { studentId: string; subject: SubjectLabel; kind: string; title: string; images: File[] }) => Promise<Awaited<ReturnType<typeof uploadSubmission>> | undefined>;
  printAssets: PrintAssetLink[];
  profileDraft: ProfileDraft | null;
  reports: StudentReportCard[];
  reviewSubmissions: ReviewSubmission[];
  selectedTextbookContext: { asset: TextbookAsset; chapter?: TextbookChapter } | null;
  students: StudentProfile[];
  tasks: LearningTaskCard[];
  teacher: TeacherProfile;
  textbooks: TextbookAsset[];
}) {
  const [selectedStudentId, setSelectedStudentId] = useState(students[0]?.id || "");
  const [taskSubject, setTaskSubject] = useState<SubjectLabel>("英语");
  const [taskMinutes, setTaskMinutes] = useState(12);
  const [taskRequirement, setTaskRequirement] = useState("复习今日错题，完成英语词汇订正和 2 个例句。");
  const [targetScope, setTargetScope] = useState<"student" | "grade">("student");
  const [targetGrade, setTargetGrade] = useState("六年级");
  const [assessmentSubject, setAssessmentSubject] = useState<SubjectLabel>("数学");
  const [assessmentKind, setAssessmentKind] = useState("小测");
  const [assessmentDifficulty, setAssessmentDifficulty] = useState("基础");
  const [assessmentRequirement, setAssessmentRequirement] = useState("围绕近期易错点出题，按试卷样式排版，题目间距适合学生书写。");
  const [uploadSubject, setUploadSubject] = useState<SubjectLabel>("数学");
  const [uploadKind, setUploadKind] = useState("作业");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [reviewUploadStatus, setReviewUploadStatus] = useState<ReviewUploadStatus | null>(null);
  const [taskEvidenceFiles, setTaskEvidenceFiles] = useState<File[]>([]);
  const [taskEvidenceTitle, setTaskEvidenceTitle] = useState("");
  const [profileDraftText, setProfileDraftText] = useState("");
  const [studentRegistration, setStudentRegistration] = useState<StudentRegistrationInput>({
    displayName: "",
    grade: "三年级",
    className: "",
    school: "君航课堂",
    textbookVersion: "人教版",
    guardianName: "",
    guardianPhone: "",
    notes: "",
    enrollmentStatus: "在读"
  });
  const [textbookSubject, setTextbookSubject] = useState("");
  const [textbookGrade, setTextbookGrade] = useState("");
  const [textbookVolume, setTextbookVolume] = useState("");
  const [textbookSearch, setTextbookSearch] = useState("");
  const [contentFiles, setContentFiles] = useState<File[]>([]);
  const [contentFileNotice, setContentFileNotice] = useState("");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [knowledgeSummary, setKnowledgeSummary] = useState("");
  const [knowledgeSubject, setKnowledgeSubject] = useState<SubjectLabel>("语文");
  const [knowledgeGrade, setKnowledgeGrade] = useState("六年级");
  const [tabletDeviceId, setTabletDeviceId] = useState(devices[0]?.id || "");
  const [broadcastSubject, setBroadcastSubject] = useState<SubjectLabel>("英语");
  const [broadcastTitle, setBroadcastTitle] = useState("课堂提醒");
  const [broadcastText, setBroadcastText] = useState("请本桌同学完成今日任务后举手示意老师。");
  const [dictationSubject, setDictationSubject] = useState<"语文" | "英语">("英语");
  const [dictationTitle, setDictationTitle] = useState("Unit 2 单词听写");
  const [dictationItemsText, setDictationItemsText] = useState("carry\nbright\nfinish\ncareful");
  const [dictationDifficulty, setDictationDifficulty] = useState<"基础" | "提高" | "困难">("基础");
  const [readingSubject, setReadingSubject] = useState<"语文" | "英语">("英语");
  const [readingTitle, setReadingTitle] = useState("课文预习跟读");
  const [readingPassage, setReadingPassage] = useState("I carried my bag to school yesterday. The classroom was bright and clean.");
  const [readingFocusText, setReadingFocusText] = useState("carried\nbright\nyesterday");
  const [readingSupportNote, setReadingSupportNote] = useState("重点理解一般过去时 carried，以及 bright 在句子里的意思。");

  useEffect(() => {
    if (!students.some((item) => item.id === selectedStudentId)) setSelectedStudentId(students[0]?.id || "");
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (!devices.some((item) => item.id === tabletDeviceId)) setTabletDeviceId(devices[0]?.id || "");
  }, [devices, tabletDeviceId]);

  useEffect(() => {
    if (profileDraft?.studentId === selectedStudentId) setProfileDraftText(profileDraft.text);
  }, [profileDraft, selectedStudentId]);

  const selectedStudent = useMemo(() => students.find((item) => item.id === selectedStudentId) || students[0], [selectedStudentId, students]);
  const updateRegistration = (field: keyof StudentRegistrationInput, value: string) => setStudentRegistration((current) => ({ ...current, [field]: value }));
  const textbookHint = selectedTextbookContext
    ? `${selectedTextbookContext.asset.title}${selectedTextbookContext.chapter ? ` / ${selectedTextbookContext.chapter.title}` : ""}`
    : "";
  const textbookTaskSuggestion = selectedTextbookContext?.chapter
    ? [
        selectedTextbookContext.chapter.title,
        selectedTextbookContext.chapter.focusItems?.length ? `重点：${selectedTextbookContext.chapter.focusItems.join("、")}` : "",
        selectedTextbookContext.chapter.dictationItems?.length ? `听写：${selectedTextbookContext.chapter.dictationItems.join("、")}` : ""
      ].filter(Boolean).join("；")
    : "";
  const activeStudents = students.filter((item) => item.loginEnabled).length;
  const selectedTabletDevice = devices.find((item) => item.id === tabletDeviceId) || devices[0];
  const pendingTasks = tasks.filter((item) => item.status !== "已完成").length;
  const readyProviders = ai?.providers.filter((item) => item.status === "ready").length || 0;
  const providerTotal = Math.max(ai?.providers.length || 0, 1);
  const readyTabletDevices = devices.filter((item) => item.status === "已绑定").length;
  const recentGenerationAssignments = assignments
    .filter((item) => ["小测", "练习", "试卷"].includes(item.kind))
    .slice(0, 4);
  const moduleClass = (module: string, className: string) => `${className} ${activeModule === module ? "" : "module-hidden"}`;
  const estimateReviewTime = (imageCount: number) => {
    const minSeconds = Math.max(10, Math.min(90, imageCount * 10));
    const maxSeconds = Math.max(30, Math.min(180, imageCount * 24));
    return maxSeconds >= 120 ? `预计约 ${Math.ceil(minSeconds / 60)}-${Math.ceil(maxSeconds / 60)} 分钟` : `预计约 ${minSeconds}-${maxSeconds} 秒`;
  };
  const isReviewUploading = (source: ReviewUploadSource) => reviewUploadStatus?.source === source && ["uploading", "grading"].includes(reviewUploadStatus.state);
  const renderReviewUploadStatus = (source: ReviewUploadSource) => {
    if (reviewUploadStatus?.source !== source) return null;
    return <div className={`review-upload-status ${reviewUploadStatus.state}`}><strong>{reviewUploadStatus.message}</strong><span>{reviewUploadStatus.detail}</span></div>;
  };
  const scheduleReviewRefresh = () => {
    [1200, 5000, 15000, 30000].forEach((delay) => window.setTimeout(() => onRefreshOps(), delay));
  };
  const submitReviewUpload = async (source: ReviewUploadSource, input: { studentId: string; subject: SubjectLabel; kind: string; title: string; images: File[] }) => {
    if (!input.images.length) {
      setReviewUploadStatus({ source, state: "failed", message: "请先选择照片", detail: "可一次上传多张图片，上传数量不设上限。" });
      return;
    }
    const estimate = estimateReviewTime(input.images.length);
    setReviewUploadStatus({ source, state: "uploading", message: `正在上传 ${input.images.length} 张图片`, detail: `上传后自动进入批改，${estimate}。` });
    const gradingTimer = window.setTimeout(() => {
      setReviewUploadStatus((current) => current?.source === source && current.state === "uploading"
        ? { source, state: "grading", message: "正在批改中", detail: `请保持页面打开，${estimate}。` }
        : current);
    }, 800);
    try {
      const response = await onUploadReview(input);
      window.clearTimeout(gradingTimer);
      if (response?.result.queued) {
        scheduleReviewRefresh();
        setReviewUploadStatus({ source, state: "grading", message: "已进入后台批改", detail: `${input.images.length} 张图片已进入复核队列，系统会自动刷新进度。` });
      } else {
        setReviewUploadStatus({ source, state: "done", message: "批改已完成，请复核", detail: `${input.images.length} 张图片已进入复核队列，并会关联学生归档分析。` });
      }
    } catch (error) {
      window.clearTimeout(gradingTimer);
      setReviewUploadStatus({ source, state: "failed", message: "批改失败", detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const selectContentFiles = (selectedFiles: File[]) => {
    const { safeFiles, protectedFiles } = splitTeachingMaterialFiles(selectedFiles);
    setContentFiles(safeFiles);
    if (protectedFiles.length) {
      const safeHint = safeFiles.length ? `，其余 ${safeFiles.length} 份可继续导入` : "";
      setContentFileNotice(`已过滤 ${protectedFiles.length} 个受保护教材文件：.edupdf 不能转换或改写${safeHint}。`);
    } else {
      setContentFileNotice("");
    }
  };
  return <div className="page-grid">
    <section className={moduleClass("工作台", "hero-band teacher-flow-hero")}><div><p className="eyebrow">教师工作台</p><h2>从登记到归档的教学闭环</h2><p>按“学生权限、今日任务、生成打印、批改复核、学生档案、课堂设备”串起日常操作。先看状态，再进入对应动作。</p></div><div className="teacher-flow-summary"><Metric label="可登录学生" value={activeStudents} suffix="人" tone="blue" /><Metric label="待完成任务" value={pendingTasks} suffix="项" tone="amber" /><Metric label="生成记录" value={assignments.length} suffix="份" tone="green" /></div></section>
    <section className={moduleClass("工作台", "panel full")}><PanelTitle icon={ClipboardList} title="教师端操作流程" /><div className="teacher-flow-grid"><FlowCard icon={UsersRound} index={1} label="学生权限" state={activeStudents ? "ready" : "blocked"} value={`${activeStudents}/${students.length}`} hint="登记学生、生成专属码、绑定负责老师。" /><FlowCard icon={CalendarDays} index={2} label="今日任务" state={pendingTasks ? "pending" : "ready"} value={`${pendingTasks}`} hint="按学生生成任务，家长端和平板端查看完成情况。" /><FlowCard icon={Printer} index={3} label="生成打印" state="pending" value={`${assignments.length}`} hint="小测、练习、试卷先审 PDF 草稿，再导出正式文件。" /><FlowCard icon={Upload} index={4} label="批改复核" state="pending" value={`${reviewSubmissions.length}`} hint="图片上传、AI初判、逐题复核和教师确认。" /><FlowCard icon={FileText} index={5} label="学生档案" state="ready" value="教师发布" hint="聚合任务、错题、问答、平板记录和阶段反馈。" /><FlowCard icon={TerminalSquare} index={6} label="课堂设备" state={readyTabletDevices ? "ready" : "pending"} value={`${readyTabletDevices}/${Math.max(devices.length, 1)}`} hint="控制平板、听写、跟读、播报和大屏连接。" /><FlowCard icon={Activity} index={7} label="系统状态" state={readyProviders === providerTotal ? "ready" : "blocked"} value={`${readyProviders}/${providerTotal}`} hint="教师端查看服务状态与审计记录。" /></div></section>
    <section className={moduleClass("工作台", "panel full")}><PanelTitle icon={MonitorCheck} title="展示与互动控制台" /><p className="muted-line">这块先作为方案原型：老师决定平板模式和互动插件状态，学生与家长只看到温和的使用结果，不看到排名、模型名称或隐私数据。</p><div className="teacher-display-console"><div className="display-control-card display-control-card-locked"><div className="display-control-head"><span><ScreenShare size={18} />电视公共屏</span><StatusPill label="已封锁" status="pending" /></div><strong>家长参观数据屏暂不开放</strong><p>公共屏内容先暂停操作和投放，后续确认独立全屏入口与展示规则后再重新开放。</p><div className="display-control-actions"><button className="secondary-button" disabled type="button"><Lock size={16} />暂不开放</button><button className="secondary-button" disabled type="button"><ScreenShare size={16} />地址暂停复制</button></div></div><div className="display-control-card"><div className="display-control-head"><span><TerminalSquare size={18} />平板展示模式</span><StatusPill label={`${readyTabletDevices}/${Math.max(devices.length, 1)} 已绑定`} status={readyTabletDevices ? "ready" : "pending"} /></div><div className="display-mode-grid"><span className="active">常规待机</span><span>家长参观</span><span>课堂互动</span><span>听写锁屏</span></div><p>共享平板只确认本次互动身份，拖拽头像进入学习光环后再选择插件。</p></div><div className="display-control-card"><div className="display-control-head"><span><Sparkles size={18} />互动插件开关</span><StatusPill label="状态展示" status="pending" /></div><div className="plugin-toggle-list">{["AI问答", "听写播报", "课文跟读", "课堂投票", "今日鼓励", "小组协作"].map((item, index) => <span key={item} className={index < 3 ? "ready" : "future"}>{item}<b>{index < 3 ? "可用" : "老师开启后"}</b></span>)}</div></div><div className="display-control-card"><div className="display-control-head"><span><ShieldCheck size={18} />迁移前配置</span><StatusPill label="先不迁移" status="pending" /></div><ul className="display-rule-list"><li>电视公共屏已封锁，暂不操作。</li><li>学生端先按模块入口迁移。</li><li>平板端确认拖拽交互后再迁移。</li><li>教师端控制入口最后接真实权限。</li></ul></div></div></section>
    <section className={moduleClass("课堂设备", "panel full")}><PanelTitle icon={TerminalSquare} title="课堂平板总控" /><p className="muted-line">平板端内容统一在教师端发布和控制。语音播报、听写、跟读由教师端下发，平板端只接收并执行；学生 AI 问答在平板端确认身份后使用。</p><div className="template-controls"><label>目标平板<select value={selectedTabletDevice?.id || ""} onChange={(event) => setTabletDeviceId(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.label} · {device.grade || "未设年级"}</option>)}</select></label></div><div className="record-list">{devices.map((device) => <div className="record-row" key={device.id}><Volume2 size={17} /><div><strong>{device.label}</strong><span>{device.grade} · {device.className}</span></div><StatusPill label={device.status} status="ready" /></div>)}</div><div className="button-row"><button className="primary-button" onClick={() => onUnlock(true)}><Unlock size={17} />解锁平板</button><button className="secondary-button danger-button" onClick={() => onUnlock(false)}><Lock size={17} />锁定平板</button></div></section>
    <section className={moduleClass("课堂设备", "panel full")}>
      <PanelTitle icon={Volume2} title="发布平板任务" />
      <div className="classroom-action-grid">
        <article className="classroom-action-card">
          <strong>语音播报</strong>
          <div className="template-controls">
            <label>科目<select value={broadcastSubject} onChange={(event) => setBroadcastSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          </div>
          <label className="field-label">标题<input value={broadcastTitle} onChange={(event) => setBroadcastTitle(event.target.value)} /></label>
          <textarea className="wide-textarea compact-textarea" value={broadcastText} onChange={(event) => setBroadcastText(event.target.value)} placeholder="输入要让平板端播报或提醒的内容。" />
          <button className="primary-button" disabled={!selectedTabletDevice} onClick={() => selectedTabletDevice && onTabletBroadcast({ deviceId: selectedTabletDevice.id, subject: broadcastSubject, title: broadcastTitle, content: broadcastText, voiceText: broadcastText })}><Send size={17} />发布语音任务</button>
        </article>
        <article className="classroom-action-card">
          <strong>听写播报</strong>
          <div className="template-controls">
            <label>科目<select value={dictationSubject} onChange={(event) => setDictationSubject(event.target.value as "语文" | "英语")}><option>语文</option><option>英语</option></select></label>
            <label>难度<select value={dictationDifficulty} onChange={(event) => setDictationDifficulty(event.target.value as "基础" | "提高" | "困难")}><option>基础</option><option>提高</option><option>困难</option></select></label>
          </div>
          <label className="field-label">发布标题（可改）<input value={dictationTitle} onChange={(event) => setDictationTitle(event.target.value)} /></label>
          <textarea className="wide-textarea compact-textarea" value={dictationItemsText} onChange={(event) => setDictationItemsText(event.target.value)} placeholder="每行一个听写词语或单词。内容由教师自行填写和筛选。" />
          <p className="muted-line">听写内容由教师根据课堂进度手动填写，发布前请控制词语数量和难度。</p>
          <button className="primary-button" disabled={!selectedTabletDevice} onClick={() => { const items = dictationItemsText.split(/\n|、|,|，/).map((item) => item.trim()).filter(Boolean); if (selectedTabletDevice && items.length) onTabletDictation({ deviceId: selectedTabletDevice.id, grade: selectedTabletDevice.grade, className: selectedTabletDevice.className, subject: dictationSubject, title: dictationTitle, difficulty: dictationDifficulty, repeats: dictationDifficulty === "困难" ? 3 : 2, intervalSeconds: dictationDifficulty === "基础" ? 10 : dictationDifficulty === "提高" ? 15 : 20, items }) }}><Send size={17} />发布听写任务</button>
        </article>
        <article className="classroom-action-card full-width-card">
          <strong>课文跟读</strong>
          <div className="template-controls">
            <label>科目<select value={readingSubject} onChange={(event) => setReadingSubject(event.target.value as "语文" | "英语")}><option>语文</option><option>英语</option></select></label>
          </div>
          <label className="field-label">发布标题（可改）<input value={readingTitle} onChange={(event) => setReadingTitle(event.target.value)} /></label>
          <textarea className="wide-textarea compact-textarea" value={readingPassage} onChange={(event) => setReadingPassage(event.target.value)} placeholder="教师粘贴或输入需要跟读的课文、句子或段落。" />
          <label className="field-label">重点字词/新词<input value={readingFocusText} onChange={(event) => setReadingFocusText(event.target.value)} placeholder="可用换行或顿号分隔" /></label>
          <div className="button-row"><button className="secondary-button" onClick={() => setReadingFocusText(extractReadingFocusDraft(readingPassage, readingSubject, selectedTextbookContext))}><Sparkles size={16} />识别重点字词/新词</button></div>
          <label className="field-label">理解提示<input value={readingSupportNote} onChange={(event) => setReadingSupportNote(event.target.value)} /></label>
          <p className="muted-line">如需使用智慧中小学课本音频，请先在 App 授课模式核对后，将课文内容填入草稿。</p>
          <button className="primary-button" disabled={!selectedTabletDevice} onClick={() => { const focusItems = readingFocusText.split(/\n|、|,|，/).map((item) => item.trim()).filter(Boolean); if (selectedTabletDevice && readingPassage.trim()) onTabletReading({ deviceId: selectedTabletDevice.id, grade: selectedTabletDevice.grade, className: selectedTabletDevice.className, subject: readingSubject, title: readingTitle, passage: readingPassage, focusItems, supportNote: readingSupportNote, textbookAssetId: selectedTextbookContext?.asset.id, textbookTitle: selectedTextbookContext?.asset.title, textbookChapterId: selectedTextbookContext?.chapter?.id, textbookChapterTitle: selectedTextbookContext?.chapter?.title, audioSource: selectedTextbookContext ? "智慧中小学课本音频" : null }) }}><Send size={17} />发布跟读任务</button>
        </article>
      </div>
    </section>
    <section className={moduleClass("课堂设备", "panel full")}>
      <PanelTitle icon={MonitorCheck} title="电视/大屏连接协助" />
      <p className="muted-line">用于后续把小程序课堂内容投放到电视或大屏。当前先保留连接入口、设备码和状态位，播放内容与展示样式后续单独设计。</p>
      <div className="teacher-flow-grid compact-grid">
        <FlowCard icon={ScreenShare} index={1} label="连接对象" state="pending" value="电视大屏" hint="支持教室电视、投影或浏览器大屏端" />
        <FlowCard icon={MonitorCheck} index={2} label="连接码" state="pending" value="TV6JH" hint="后续由教师端生成并绑定教室设备" />
        <FlowCard icon={Volume2} index={3} label="播放来源" state="pending" value="待开放" hint="课堂任务、听写、课文跟读和讲解内容会从这里分发" />
      </div>
      <div className="tag-grid">
        <span>教师端控制是否允许大屏连接</span>
        <span>大屏只显示课堂内容，不展示学生隐私信息</span>
        <span>后续可和课堂平板、电视、小程序共享同一任务状态</span>
      </div>
    </section>
    <section className={moduleClass("学生权限", "panel full")}><PanelTitle icon={ShieldCheck} title="学生入学登记与权限" /><p className="muted-line">当前教师：{teacher.displayName}，教师码：{teacher.accessCode || "已隐藏"}。新学生由登记教师绑定，登记后生成学生专属码；退课后可停用登录码但保留学生档案。</p><div className="student-registration-card"><div className="review-card-head"><div><h3>新学生入学办理资料</h3><p>用于开通学生端和后续一对一学习归档。档案草稿生成已移至“学生档案”。</p></div><StatusPill label="登记后生成专属码" status="pending" /></div><div className="student-registration-form"><label>学生姓名<input value={studentRegistration.displayName} placeholder="例如：张思源" onChange={(event) => updateRegistration("displayName", event.target.value)} /></label><label>年级<select value={studentRegistration.grade} onChange={(event) => updateRegistration("grade", event.target.value)}>{gradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>班级/分组<input value={studentRegistration.className} placeholder="例如：五年级 1 班 / 周六上午班" onChange={(event) => updateRegistration("className", event.target.value)} /></label><label>学校/来源<input value={studentRegistration.school} placeholder="例如：君航课堂 / XX小学" onChange={(event) => updateRegistration("school", event.target.value)} /></label><label>教材版本<input value={studentRegistration.textbookVersion} placeholder="例如：人教版" onChange={(event) => updateRegistration("textbookVersion", event.target.value)} /></label><label>入学状态<select value={studentRegistration.enrollmentStatus} onChange={(event) => updateRegistration("enrollmentStatus", event.target.value)}><option>在读</option><option>测试</option><option>暂停</option></select></label><label>家长姓名<input value={studentRegistration.guardianName} placeholder="例如：张女士" onChange={(event) => updateRegistration("guardianName", event.target.value)} /></label><label>家长电话<input value={studentRegistration.guardianPhone} placeholder="用于学生端登录校验" onChange={(event) => updateRegistration("guardianPhone", event.target.value)} /></label><label className="registration-notes">学习关注点/入学备注<textarea value={studentRegistration.notes} placeholder="例如：计算题速度偏慢，英语词汇拼写需要跟进。" onChange={(event) => updateRegistration("notes", event.target.value)} /></label></div><div className="button-row"><button className="primary-button" onClick={() => onStudentCreate(studentRegistration)}><Plus size={17} />登记学生并生成专属码</button><button className="secondary-button" onClick={() => setStudentRegistration({ displayName: "", grade: "三年级", className: "", school: "君航课堂", textbookVersion: "人教版", guardianName: "", guardianPhone: "", notes: "", enrollmentStatus: "在读" })}><RotateCcw size={17} />清空表单</button></div></div><div className="template-controls"><label>操作已有学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.grade}</option>)}</select></label>{selectedStudent ? <button className="secondary-button" onClick={() => onResetCode(selectedStudent.id)}><RotateCcw size={17} />重置专属码</button> : null}</div><StudentList onAccess={onStudentAccess} students={students} /></section>
    <section className={moduleClass("今日任务", "panel full")}><PanelTitle badge="AI生成" icon={CalendarDays} title="生成今日任务" />{textbookHint ? <p className="context-note"><BookOpen size={15} />可引用教材位置：{textbookHint}</p> : null}<div className="template-controls"><label>学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label><label>科目<select value={taskSubject} onChange={(event) => setTaskSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label>预计用时<input type="number" min={5} max={60} value={taskMinutes} onChange={(event) => setTaskMinutes(Number(event.target.value) || 10)} /></label></div><label className="field-label">任务内容<textarea className="wide-textarea" value={taskRequirement} onChange={(event) => setTaskRequirement(event.target.value)} /></label><p className="muted-line">建议：写清“复习点、完成物、订正方式、是否需要家长查看”。{textbookTaskSuggestion ? ` 教材建议：${textbookTaskSuggestion}` : "具体调控仍由教师端决定。"}</p><button className="primary-button" onClick={() => selectedStudent && onTask({ studentId: selectedStudent.id, subject: taskSubject, title: `${selectedStudent.displayName} 今日${taskSubject}任务`, requirement: `${taskRequirement}${textbookHint ? `\n教材位置：${textbookHint}` : ""}`, minutes: taskMinutes })}><Send size={17} />写入今日任务</button></section>
    <section className={moduleClass("今日任务", "panel full")}><PanelTitle icon={ListChecks} title="已发布今日任务完成情况" /><p className="muted-line">平板端或学生端标记完成后会同步到这里。底部可上传完成情况照片，进入批改/归档队列，后续用于学生档案分析。</p><div className="record-list">{tasks.length ? tasks.slice(0, 10).map((task) => <div className="record-row task-detail-row" key={task.id}><SubjectBadge subject={task.subject} /><div><strong>{task.title}</strong><span>{task.studentName} · {task.status} · {task.minutes}分钟</span><p>{task.summary || task.description || "暂无具体任务说明"}</p></div><StatusPill label={task.status} status={statusToProviderStatus(task.status)} /></div>) : <p className="review-empty">暂无已发布今日任务</p>}</div><div className="student-registration-card"><div className="review-card-head"><div><h3>今日任务完成情况拍照上传</h3><p>用于上传订正本、作业本、听写本等完成证据，后续进入学生归档分析。</p></div><StatusPill label="教师复核" status="pending" /></div><div className="template-controls"><label>学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.grade}</option>)}</select></label><label>科目<select value={taskSubject} onChange={(event) => setTaskSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label></div><label className="field-label">记录标题<input value={taskEvidenceTitle} placeholder={selectedStudent ? `${selectedStudent.displayName} 今日任务完成情况` : "今日任务完成情况"} onChange={(event) => setTaskEvidenceTitle(event.target.value)} /></label><label className="field-label">拍照或选择图片<input multiple type="file" accept="image/*" capture="environment" onChange={(event) => setTaskEvidenceFiles(Array.from(event.target.files || []))} /></label><p className="muted-line">当前已选择 {taskEvidenceFiles.length} 张。可上传多页任务完成情况。</p><div className="review-upload-action"><button className="primary-button" disabled={!selectedStudent || !taskEvidenceFiles.length || isReviewUploading("taskEvidence")} onClick={() => selectedStudent && submitReviewUpload("taskEvidence", { studentId: selectedStudent.id, subject: taskSubject, kind: "作业", title: taskEvidenceTitle.trim() || `${selectedStudent.displayName} 今日任务完成情况`, images: taskEvidenceFiles })}><Upload size={17} />上传并写入归档队列</button>{renderReviewUploadStatus("taskEvidence")}</div></div></section>
    <section className={moduleClass("教材资料", "panel full")}><PanelTitle icon={BookOpen} title="教材库与章节索引" /><p className="muted-line">当前教材文件保留在本机原路径，系统只记录年级、科目、册次、哈希、打开路径和教师确认的章节索引。需要查看原教材时交给智慧中小学 App 或本机默认关联程序打开，不转换文件格式。</p><div className="template-controls textbook-filter-grid"><label>年级<select value={textbookGrade} onChange={(event) => setTextbookGrade(event.target.value)}><option value="">全部年级</option>{gradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>科目<select value={textbookSubject} onChange={(event) => setTextbookSubject(event.target.value)}><option value="">全部科目</option>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label>册次<select value={textbookVolume} onChange={(event) => setTextbookVolume(event.target.value)}><option value="">全部册次</option><option>上册</option><option>下册</option></select></label><label>关键词<input value={textbookSearch} onChange={(event) => setTextbookSearch(event.target.value)} placeholder="教材名、版本或路径关键词" /></label></div><div className="button-row"><button className="primary-button" onClick={() => onRefreshTextbooks({ subject: textbookSubject, grade: textbookGrade, volume: textbookVolume, search: textbookSearch })}><Search size={17} />筛选教材</button><button className="secondary-button" onClick={onRescanTextbooks}><RefreshCw size={17} />重扫教材目录</button></div><ContentIndexPanel files={contentFiles} index={contentIndex} notice={contentFileNotice} onFiles={selectContentFiles} onRebuild={onContentIndexRebuild} onUpload={() => onContentUpload(contentFiles)} /><KnowledgeLibraryPanel grade={knowledgeGrade} onGrade={setKnowledgeGrade} onRefresh={onKnowledgeRefresh} onReview={onKnowledgeReview} onSourceCreate={(input) => { onKnowledgeSourceCreate(input); setKnowledgeTitle(""); setKnowledgeUrl(""); setKnowledgeSummary(""); }} onSubject={setKnowledgeSubject} onSync={onKnowledgeSync} sources={knowledgeSources} subject={knowledgeSubject} summary={knowledgeSummary} title={knowledgeTitle} url={knowledgeUrl} onSummary={setKnowledgeSummary} onTitle={setKnowledgeTitle} onUrl={setKnowledgeUrl} /><TextbookLibrary assets={textbooks} onOpen={onOpenTextbook} onSaveChapters={onSaveTextbookChapters} onSelectContext={onSelectTextbookContext} selectedContext={selectedTextbookContext} /></section>
    <section className={moduleClass("生成打印", "panel span-6")}>
      <PanelTitle badge="AI生成" icon={Printer} title="生成与打印" />
      {textbookHint ? <p className="context-note"><BookOpen size={15} />已带入教材位置：{textbookHint}</p> : null}
      <div className="template-controls">
        <label>对象<select value={targetScope} onChange={(event) => setTargetScope(event.target.value as "student" | "grade")}><option value="student">单个学生</option><option value="grade">整个年级</option></select></label>
        {targetScope === "student" ? <label>学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label> : <label>年级<select value={targetGrade} onChange={(event) => setTargetGrade(event.target.value)}>{gradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</select></label>}
        <label>类型<select value={assessmentKind} onChange={(event) => setAssessmentKind(event.target.value)}><option>小测</option><option>练习</option><option>试卷</option></select></label>
        <label>科目<select value={assessmentSubject} onChange={(event) => setAssessmentSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
        <label>难度<select value={assessmentDifficulty} onChange={(event) => setAssessmentDifficulty(event.target.value)}><option>基础</option><option>提高</option><option>综合</option></select></label>
      </div>
      <label className="field-label">特殊要求<textarea className="wide-textarea" value={assessmentRequirement} onChange={(event) => setAssessmentRequirement(event.target.value)} placeholder="例如：三角形内角和，基础题多一些；应用题保留更大作答区；需要两页 A4。" /></label>
      <p className="muted-line">{assessmentKind === "试卷" ? "默认四页 A4。" : "默认两页 A4。"}如有特殊要求，仍以试卷排版、清晰作答空间和打印稳定性为前提。{textbookHint ? " 当前会把教材章节作为出题范围参考。" : ""}</p>
      <div className="button-row">
        <button className="primary-button" onClick={() => onAssessment({ targetScope, studentId: selectedStudent?.id, targetGrade, subject: assessmentSubject, kind: assessmentKind, difficulty: assessmentDifficulty, requirement: `${assessmentRequirement}${textbookHint ? `\n教材范围：${textbookHint}` : ""}`, textbookAssetId: selectedTextbookContext?.asset.id, textbookTitle: selectedTextbookContext?.asset.title, textbookChapterId: selectedTextbookContext?.chapter?.id, textbookChapterTitle: selectedTextbookContext?.chapter?.title })}><Printer size={17} />生成 PDF 草稿</button>
      </div>
      {latestAssessmentDraft ? <div className="draft-review-panel"><div className="review-card-head"><div><h3>{latestAssessmentDraft.targetLabel} · {latestAssessmentDraft.subject} · {latestAssessmentDraft.kind}</h3><p>请先打开 PDF 草稿审查题目、题量和排版。确认后才会生成正式题目 PDF 与解析 PDF；否决后会按同一要求重新生成一版草稿。</p></div><StatusPill label={latestAssessmentDraft.reviewStatus === "accepted" ? "已确认" : latestAssessmentDraft.reviewStatus === "rejected" ? "已否决" : "待审查"} status={latestAssessmentDraft.reviewStatus === "accepted" ? "ready" : latestAssessmentDraft.reviewStatus === "rejected" ? "blocked" : "pending"} /></div>{latestAssessmentDraft.draftAsset ? <a className="draft-pdf-link" href={latestAssessmentDraft.draftAsset.url} target="_blank" rel="noreferrer"><FileText size={17} />打开内容审查 PDF 草稿</a> : null}<div className="button-row"><button className="primary-button" onClick={() => onExportPrint(latestAssessmentDraft.assignmentId)}><CheckCircle2 size={17} />是，生成正式 PDF</button><button className="secondary-button danger-button" onClick={() => onAssessmentReject(latestAssessmentDraft.assignmentId)}><RefreshCw size={17} />否，重新生成草稿</button></div></div> : <p className="review-empty">按上方要求生成后，这里只显示 PDF 草稿审查入口和“是/否”反馈，不在页面内展示完整题面。</p>}
      <div className="record-list generation-progress-list">
        {recentGenerationAssignments.length ? recentGenerationAssignments.map((assignment) => {
          const auditStatus = assignment.audit?.status;
          const auditLabel = auditStatus === "passed" ? "主脑审查通过" : auditStatus === "needs_teacher_review" ? "主脑提示复核" : "旧记录未审查";
          const reviewLabel = assignment.draftReviewStatus === "accepted" ? "草稿已确认" : assignment.draftReviewStatus === "rejected" ? "草稿已否决" : assignment.draftReviewStatus === "pending_teacher_review" ? "草稿待确认" : "未导出草稿";
          const status = auditStatus === "needs_teacher_review" || assignment.draftReviewStatus === "rejected" ? "pending" : assignment.draftReviewStatus === "accepted" ? "ready" : "pending";
          return <div className="record-row" key={assignment.id}><Printer size={17} /><div><strong>{assignment.title}</strong><span>{assignment.subject} · {assignment.kind} · {auditLabel} · {reviewLabel}</span></div><StatusPill label={assignment.audit?.itemCount ? `${assignment.audit.itemCount}题` : assignment.status} status={status} /></div>;
        }) : <p className="review-empty">暂无生成进度记录。</p>}
      </div>
      {printAssets.length ? <div className="print-asset-list">{printAssets.map((asset) => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer"><FileText size={16} />{asset.title}</a>)}</div> : null}
    </section>
    <section className={moduleClass("批改复核", "panel span-6")}><PanelTitle badge="AI生成" icon={Upload} title="拍照上传批改" /><div className="template-controls"><label>学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label><label>类型<select value={uploadKind} onChange={(event) => setUploadKind(event.target.value)}><option>作业</option><option>小测</option><option>试卷</option><option>听写</option></select></label><label>科目<select value={uploadSubject} onChange={(event) => setUploadSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label></div><label className="field-label">记录标题<input value={uploadTitle} placeholder="例如：三角形单元试卷批改、英语Unit 1听写批改" onChange={(event) => setUploadTitle(event.target.value)} /></label><label className="field-label">拍照或选择图片<input multiple type="file" accept="image/*" capture="environment" onChange={(event) => setUploadFiles(Array.from(event.target.files || []))} /></label><p className="muted-line">批改记录绑定所选学生，教师复核确认后才进入学生档案、错题和学习分析。当前已选择 {uploadFiles.length} 张，上传数量不设上限。</p><div className="review-upload-action"><button className="primary-button" disabled={!selectedStudent || !uploadFiles.length || isReviewUploading("grading")} onClick={() => selectedStudent && submitReviewUpload("grading", { studentId: selectedStudent.id, subject: uploadSubject, kind: uploadKind, title: uploadTitle.trim() || `${selectedStudent.displayName}${uploadKind}批改`, images: uploadFiles })}><Upload size={17} />上传并批改</button>{renderReviewUploadStatus("grading")}</div></section>
    <section className={moduleClass("批改复核", "panel full")}><PanelTitle icon={ListChecks} title="批改工作台" /><div className="button-row"><button className="secondary-button" onClick={onRefreshOps}><RefreshCw size={17} />刷新工作台</button></div><GradingWorkbenchPanel onMarkReviewed={onMarkReviewed} onRecognize={onRecognize} reviewSubmissions={reviewSubmissions} workbenches={gradingWorkbenches} /></section>
    <section className={moduleClass("电视动态屏", "tv-display-shell full")}>
      <TvParentDisplay ai={ai} assignments={assignments} audit={audit} corrections={corrections} logs={logs} reports={reports} reviewSubmissions={reviewSubmissions} students={students} tasks={tasks} />
    </section>
    <section className={moduleClass("学生档案", "panel full")}><PanelTitle badge="AI生成" icon={FileText} title="学生档案草稿与发布" /><p className="muted-line">教师端先生成档案草稿，确认内容、修改措辞或删减敏感内容后，再发布到学生端。未点击发布前，家长和学生不会看到这份草稿。</p><div className="template-controls"><label>归档学生<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.grade}</option>)}</select></label><button className="primary-button" onClick={() => selectedStudent && onProfileDraft(selectedStudent.id)}><FileText size={17} />生成档案草稿</button><button className="secondary-button" onClick={onRefreshOps}><RefreshCw size={17} />刷新归档数据</button></div>{profileDraft?.studentId === selectedStudentId ? <div className="profile-draft-editor"><div className="review-card-head"><div><h3>{profileDraft.studentName} 的待发布档案草稿</h3><p>下方是给老师复核的纯文本反馈，可直接修改措辞、删减内容或补充建议，确认后再同步给学生端。</p></div><StatusPill label="待教师确认" status="pending" /></div><label className="field-label">档案反馈正文<textarea className="wide-textarea profile-draft-textarea" value={profileDraftText} onChange={(event) => setProfileDraftText(event.target.value)} /></label><div className="button-row"><button className="primary-button" onClick={() => selectedStudent && onProfilePublish({ studentId: selectedStudent.id, text: profileDraftText })}><ShieldCheck size={17} />确认发布至学生端</button><button className="secondary-button" onClick={() => setProfileDraftText(profileDraft.text)}><RotateCcw size={17} />恢复草稿原文</button></div></div> : <p className="review-empty">请先选择学生并生成档案草稿，预览确认后再发布。</p>}{selectedStudent ? <TeacherStudentArchivePanel assignments={assignments} audit={audit} corrections={corrections} logs={logs} reports={reports} student={selectedStudent} tasks={tasks} /> : null}</section>
    <section className={moduleClass("系统状态", "panel full")}><PanelTitle icon={Settings2} title="服务状态" /><div className="feature-list">{(ai?.providers || []).map((item) => <div className="feature-row" key={item.id}><div><strong>{item.label}</strong><span>{item.model} · {item.capabilities.join(" / ")}</span></div><StatusPill label={item.status === "ready" ? "可用" : "不可用"} status={item.status} /></div>)}{(ai?.features || []).filter((item) => item.id !== "avatar-dialog").map((item) => <div className="feature-row" key={item.id}><div><strong>{item.label}</strong><span>{item.appSurface}</span></div><StatusPill label={item.status === "ready" ? "可用" : "不可用"} status={item.status} /></div>)}</div></section>
    <section className={moduleClass("系统状态", "panel full")}><PanelTitle icon={Activity} title="归档与审计" /><AuditPanel audit={audit} /></section>
  </div>;
}

function StudentWorkspace({
  activeModule,
  answer,
  assignments,
  corrections,
  isLoggedIn,
  logs,
  onAsk,
  onLogin,
  onModuleOpen,
  onUploadReview,
  qaBusy,
  question,
  reports,
  setGuardianPhone,
  setQuestion,
  setStudentCode,
  setStudentName,
  student,
  tasks
}: {
  activeModule: string;
  answer: string;
  assignments: AssignmentCard[];
  corrections: CorrectionRecord[];
  isLoggedIn: boolean;
  logs: LearningLog[];
  onAsk: (input?: { subject?: "全科" | SubjectLabel; images?: File[] }) => void;
  onLogin: () => void;
  onModuleOpen: (module: string) => void;
  onUploadReview: (input: { studentId: string; subject: SubjectLabel; kind: string; title: string; images: File[] }) => void;
  qaBusy: boolean;
  question: string;
  reports: StudentReportCard[];
  setGuardianPhone: (v: string) => void;
  setQuestion: (v: string) => void;
  setStudentCode: (v: string) => void;
  setStudentName: (v: string) => void;
  student: StudentProfile;
  tasks: LearningTaskCard[];
}) {
  const studentTasks = tasks.filter((item) => item.studentId === student.id || !item.studentId);
  const [uploadSubject, setUploadSubject] = useState<SubjectLabel>("英语");
  const [uploadKind, setUploadKind] = useState("作业");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [qaImages, setQaImages] = useState<File[]>([]);
  const moduleClass = (module: string, className: string) => `${className} ${activeModule === module ? "" : "module-hidden"}`;
  const submitTitle = uploadTitle.trim() || `${student.displayName}${uploadKind}提交`;
  return <div className="page-grid">
    <section className={moduleClass("主页", "student-home-shell full")}>
      <StudentModuleHome assignments={assignments} corrections={corrections} isLoggedIn={isLoggedIn} logs={logs} onLogin={onLogin} onModuleOpen={onModuleOpen} reports={reports} setGuardianPhone={setGuardianPhone} setStudentCode={setStudentCode} setStudentName={setStudentName} student={student} tasks={studentTasks} />
    </section>
    <section className={moduleClass("今日任务", "panel full")}><PanelTitle icon={CalendarDays} title="今日任务" /><TaskList tasks={studentTasks} /></section>
    <section className={moduleClass("AI问答", "panel full")}>
      <PanelTitle badge="AI生成" icon={Bot} title="AI问答" />
      <div className="availability-light"><i className="green" /><strong>AI问答可用</strong><span>提问后会生成学习记录，老师可复核。</span></div>
      <textarea className="wide-textarea" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="可以输入语文、数学、英语或其他学习问题。题目类问题会优先做思路引导。" />
      <div className="qa-action-row">
        <button className="primary-button" disabled={qaBusy} onClick={() => onAsk({ images: qaImages })}><MessageSquareText size={17} />{qaBusy ? "正在思考" : "提问"}</button>
        <label className="secondary-button qa-photo-button"><Upload size={17} />拍照提问<input multiple type="file" accept="image/*" capture="environment" onChange={(event) => setQaImages(Array.from(event.target.files || []))} /></label>
      </div>
      <p className="muted-line">当前问题图片：{qaImages.length} 张。</p>
      {qaBusy ? <p className="thinking-box">小航正在思考中，请耐心等待。</p> : null}
      {answer ? <p className="answer-box">{answer}</p> : null}
    </section>
    <section className={moduleClass("英语词汇", "panel full")}><PanelTitle badge="AI生成" icon={BookOpen} title="英语词汇助理" /><StudentVocabularyAssistant student={student} /></section>
    <section className={moduleClass("拍照提交", "panel full")}><PanelTitle icon={Upload} title="拍照提交" /><p className="muted-line">学生端用于作业、练习、小测、试卷和听写照片提交。提交后进入教师端复核，不在学生端直接展示批改细节。</p><div className="template-controls"><label>科目<select value={uploadSubject} onChange={(event) => setUploadSubject(event.target.value as SubjectLabel)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label>类型<select value={uploadKind} onChange={(event) => setUploadKind(event.target.value)}><option>作业</option><option>练习</option><option>小测</option><option>试卷</option><option>听写</option></select></label></div><label className="field-label">记录标题<input value={uploadTitle} placeholder="例如：周三数学作业、Unit 2 听写" onChange={(event) => setUploadTitle(event.target.value)} /></label><label className="field-label">拍照或选择图片<input multiple type="file" accept="image/*" capture="environment" onChange={(event) => setUploadFiles(Array.from(event.target.files || []))} /></label><p className="muted-line">当前已选择 {uploadFiles.length} 张，可一次提交多页内容。</p><button className="primary-button" onClick={() => onUploadReview({ studentId: student.id, subject: uploadSubject, kind: uploadKind, title: submitTitle, images: uploadFiles })}><Upload size={17} />提交给老师</button></section>
    <section className={moduleClass("学生档案", "panel full")}><PanelTitle icon={FileText} title="学生档案" /><StudentArchive corrections={corrections} logs={logs} reports={reports} student={student} /></section>
  </div>;
}

const demoVocabulary = [
  {
    word: "carry",
    phonetic: "/ˈkæri/",
    part: "v.",
    partCn: "动词",
    meaning: "搬运；携带；承担",
    forms: ["carries", "carried", "carrying"],
    related: [
      { word: "carries", part: "v.", partCn: "动词", meaning: "carry 的第三人称单数" },
      { word: "carried", part: "v.", partCn: "动词", meaning: "carry 的过去式和过去分词" },
      { word: "carrying", part: "v.", partCn: "动词", meaning: "carry 的现在分词" }
    ],
    examples: [
      "I carry my schoolbag every day.",
      "She carried the books to the classroom."
    ],
    pitfall: "carry 的 y 前是辅音字母，三单和过去式都要先把 y 变成 i，再加 es 或 ed。"
  },
  {
    word: "careful",
    phonetic: "/ˈkeəfəl/",
    part: "adj.",
    partCn: "形容词",
    meaning: "小心的；仔细的",
    forms: ["carefully", "careless"],
    related: [
      { word: "carefully", part: "adv.", partCn: "副词", meaning: "小心地；仔细地" },
      { word: "careless", part: "adj.", partCn: "形容词", meaning: "粗心的；不仔细的" },
      { word: "care", part: "n./v.", partCn: "名词/动词", meaning: "照顾；关心；小心" }
    ],
    examples: [
      "Please be careful when you cross the road.",
      "Tom is careful with his homework."
    ],
    pitfall: "careful 描述人或事物，carefully 修饰动作，写句子时不要把形容词和副词混用。"
  },
  {
    word: "finish",
    phonetic: "/ˈfɪnɪʃ/",
    part: "v.",
    partCn: "动词",
    meaning: "完成；结束",
    forms: ["finishes", "finished", "finishing"],
    related: [
      { word: "finishes", part: "v.", partCn: "动词", meaning: "finish 的第三人称单数" },
      { word: "finished", part: "v./adj.", partCn: "动词/形容词", meaning: "完成了；结束的" },
      { word: "finishing", part: "v.", partCn: "动词", meaning: "finish 的现在分词" }
    ],
    examples: [
      "I finish my homework before dinner.",
      "She finished reading the story."
    ],
    pitfall: "finish 后面接动词时常用 doing，例如 finish reading。"
  }
];

type VocabularyEntry = typeof demoVocabulary[number];

function createVocabularyEntry(word: string): VocabularyEntry {
  const normalized = word.trim().toLowerCase();
  const existing = demoVocabulary.find((item) => item.word.toLowerCase() === normalized);
  if (existing) return existing;
  return {
    word: normalized || "word",
    phonetic: "待补充",
    part: "待补充",
    partCn: "词性待补充",
    meaning: "释义待教师或 AI 补充",
    forms: [],
    related: [
      { word: normalized || "word", part: "待补充", partCn: "词性待补充", meaning: "相关词义待补充" }
    ],
    examples: [
      `I want to learn the word "${normalized || "word"}".`
    ],
    pitfall: "当前单词还没有进入本地词库，后续会接入 AI 词汇生成与教师复核。"
  };
}

function englishFocusMeaning(item: string) {
  const trimmed = item.trim();
  if (!trimmed) return "";
  if (trimmed.includes("-") || trimmed.includes("——")) return trimmed;
  const word = trimmed.match(/[A-Za-z]+/)?.[0]?.toLowerCase() || trimmed.toLowerCase();
  const supplementalMeanings: Record<string, string> = {
    bright: "明亮的；聪明的",
    classroom: "教室",
    teacher: "老师",
    student: "学生",
    school: "学校",
    lesson: "课；课程",
    story: "故事",
    passage: "短文；篇章",
    read: "阅读；朗读",
    reading: "阅读；朗读"
  };
  const entry = demoVocabulary.find((candidate) => {
    const forms = [candidate.word, ...(candidate.forms || [])].map((value) => value.toLowerCase());
    return forms.includes(word);
  });
  return `${trimmed} - ${entry?.meaning || supplementalMeanings[word] || "待教师补充释义"}`;
}

function readingFocusLabel(item: string, subject: string) {
  return subject === "英语" ? englishFocusMeaning(item) : item;
}

function StudentVocabularyAssistant({ student }: { student: StudentProfile }) {
  const [wordInput, setWordInput] = useState(demoVocabulary[0].word);
  const [entry, setEntry] = useState<VocabularyCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const related = entry?.related || [];
  const examples = entry?.examples || [];
  const generateWord = async () => {
    const nextWord = wordInput.trim().toLowerCase();
    if (!nextWord || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await generateVocabularyCard({
        word: nextWord,
        studentId: student.id,
        studentName: student.displayName,
        grade: student.grade
      });
      setEntry(response.result.card);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.includes("登录") ? "请先登录学生端后再生成词汇卡。" : message);
    } finally {
      setBusy(false);
    }
  };
  return <div className="student-vocab-panel">
    <div className="template-controls vocab-input-controls">
      <label>输入单词<input value={wordInput} onChange={(event) => setWordInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void generateWord(); }} placeholder="例如：careful" /></label>
      <button className="primary-button" disabled={busy} onClick={() => void generateWord()}><Sparkles size={17} />{busy ? "正在生成" : "生成词汇卡"}</button>
    </div>
    <div className="button-row vocab-quick-row">
      {demoVocabulary.map((item) => <button className="secondary-button" key={item.word} onClick={() => setWordInput(item.word)}>{item.word}</button>)}
    </div>
    {busy ? <p className="thinking-box">小航正在生成词汇卡，请耐心等待。</p> : null}
    {error ? <p className="answer-box">词汇生成暂时不可用：{error}</p> : null}
    {entry ? <article className="vocab-card">
      <div>
        <h2>{entry.word}</h2>
        <p><strong>{entry.part}（{entry.partCn}）</strong><span>{entry.phonetic}</span><span>{entry.meaning}</span></p>
      </div>
      <StatusPill label="AI生成" status="ready" />
    </article> : <p className="review-empty">输入单词后点击生成，系统会生成词性、中文释义、相关单词、造句和易错点。</p>}
    {related.length ? <div className="related-word-grid">
      {related.map((item) => <span key={item.word}><strong>{item.word}</strong><em>{item.part}（{item.partCn}）</em><b>{item.meaning}</b></span>)}
    </div> : null}
    {examples.length ? <div className="qa-card"><p className="question-line">造句</p><ul className="example-list">{examples.map((example) => <li key={example}>{example}</li>)}</ul></div> : null}
    {entry?.pitfall ? <div className="qa-card"><p className="question-line">易错点</p><p className="note-line">{entry.pitfall}</p></div> : null}
  </div>;
}

function StudentModuleHome({ assignments, corrections, isLoggedIn, logs, onLogin, onModuleOpen, reports, setGuardianPhone, setStudentCode, setStudentName, student, tasks }: { assignments: AssignmentCard[]; corrections: CorrectionRecord[]; isLoggedIn: boolean; logs: LearningLog[]; onLogin: () => void; onModuleOpen: (module: string) => void; reports: StudentReportCard[]; setGuardianPhone: (v: string) => void; setStudentCode: (v: string) => void; setStudentName: (v: string) => void; student: StudentProfile; tasks: LearningTaskCard[] }) {
  const pendingTasks = tasks.filter((item) => item.status !== "已完成").length;
  const completedTasks = tasks.filter((item) => item.status === "已完成").length;
  const latestTask = tasks[0];
  const latestLog = logs[0];
  const studentAssignments = assignments.filter((item) => item.studentId === student.id || item.studentName === student.displayName);
  const latestAssignment = studentAssignments[0];
  const latestReport = reports[0];
  const latestLogText = latestLog ? formatLearningLog(latestLog) : null;
  const moduleCards = [
    { icon: CalendarDays, title: "今日任务", text: "查看老师发布的任务、预计用时和提交状态。", stat: pendingTasks ? `待完成 ${pendingTasks}` : "今日已完成", tone: "blue", priority: "primary", note: latestTask?.title || "等待老师发布今日任务" },
    { icon: Bot, title: "AI问答", text: "遇到问题先看思路引导，再继续尝试。", stat: "可提问", tone: "green", priority: "standard", note: "知识解释 / 解题提示" },
    { icon: BookOpen, title: "英语词汇", text: "查询词义、词性、词形变化和易错点。", stat: "词汇助手", tone: "cyan", priority: "standard", note: "单词查询 / 易错变化" },
    { icon: Upload, title: "拍照提交", text: "作业、练习、小测和听写都可以拍照上传。", stat: latestAssignment?.status || "等待提交", tone: "amber", priority: "standard", note: latestAssignment ? `${latestAssignment.subject}${latestAssignment.kind}：${latestAssignment.title}` : "提交后等待老师查看" },
    { icon: FileText, title: "学生档案", text: "查看老师复核后的阶段反馈和待巩固内容。", stat: reports.length ? `已发布 ${reports.length}` : `${corrections.length} 处待巩固`, tone: "purple", priority: "standard", note: latestReport?.title || "老师复核后同步" },
    { icon: UsersRound, title: "互动扩展", text: "老师开启后，可参加学习小队或阶段活动。", stat: "老师开启后", tone: "soft", priority: "secondary", note: "不做公开排名" }
  ];
  return <div className="student-module-home">
    <section className="student-home-hero">
      <div className="student-hero-profile">
        <StudentAvatar student={student} large />
        <div>
          <p className="eyebrow">学生端 · 模块化首页</p>
          <h2>{student.displayName}</h2>
          <span>{student.grade} · {student.focus || "今日先完成老师发布的任务"}</span>
        </div>
      </div>
      <div className="student-home-metrics">
        <Metric label="今日任务" value={tasks.length} suffix="项" tone="amber" />
        <Metric label="连续学习" value={student.streak} suffix="天" tone="green" />
        <Metric label="今日已完成" value={completedTasks} suffix="项" tone="blue" />
      </div>
    </section>
    <section className="student-home-intro"><div><strong>今天先做什么</strong><span>{latestTask ? `建议先完成：${latestTask.title}` : "先查看老师发布的今日任务，再进入对应模块。"}</span></div><div><strong>最近提交</strong><span>{latestAssignment ? `${latestAssignment.subject}${latestAssignment.kind}：${latestAssignment.status}，老师复核后会同步到档案。` : "暂无提交记录，可进入拍照提交上传作业、练习、小测或听写。"}</span></div><div><strong>温和反馈</strong><span>{latestLogText ? `${latestLogText.title}：${latestLogText.detail}` : "提交后等待老师查看，复核结果会同步到学习档案。"}</span></div></section>
    <section className="student-module-grid">{moduleCards.map((item) => <button className={`student-module-card ${item.tone} ${item.priority}`} key={item.title} onClick={() => item.title !== "互动扩展" && onModuleOpen(item.title)} type="button"><item.icon size={24} /><div><strong>{item.title}</strong><p>{item.text}</p><small>{item.note}</small></div><span>{item.stat}</span></button>)}</section>
    <section className="student-home-lower">
      {!isLoggedIn ? <div className="student-login-card">
        <PanelTitle icon={UserRound} title="学生登录" />
        <LoginFields onCode={setStudentCode} onName={setStudentName} onPhone={setGuardianPhone} onSubmit={onLogin} />
      </div> : null}
      <div className="student-timeline-card">
        <PanelTitle icon={Activity} title="学习动态" />
        <StudentRealtimeSummary corrections={corrections} logs={logs} tasks={tasks} />
      </div>
    </section>
  </div>;
}

function ClassroomWorkspace({
  activeModule,
  classroomBroadcasts,
  device,
  devices,
  dictationTasks,
  onAsk,
  onLogin,
  onModuleOpen,
  onTaskComplete,
  readingTasks,
  setDeviceCode,
  students,
  tasks
}: {
  activeModule: string;
  classroomBroadcasts: ClassroomBroadcast[];
  device: ClassroomDevice;
  devices: ClassroomDevice[];
  dictationTasks: DictationTask[];
  onAsk: (input: { studentId: string; question: string }) => Promise<string>;
  onLogin: () => void;
  onModuleOpen: (module: string) => void;
  onTaskComplete: (taskId: string) => void;
  readingTasks: ReadingTask[];
  setDeviceCode: (v: string) => void;
  students: StudentProfile[];
  tasks: LearningTaskCard[];
}) {
  const moduleClass = (module: string, className: string) => `${className} ${activeModule === module ? "" : "module-hidden"}`;
  const fallbackStudents = students.length ? students : demoStudents;
  const [qaStudentId, setQaStudentId] = useState("");
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const selectedStudentId = qaStudentId || fallbackStudents[0]?.id || "";
  const selectedStudent = fallbackStudents.find((item) => item.id === selectedStudentId) || fallbackStudents[0];
  const deviceBroadcasts = classroomBroadcasts.filter((item) => !item.deviceId || item.deviceId === device.id);
  const classroomTasks = tasks.filter((task) => fallbackStudents.some((student) => student.id === task.studentId || student.displayName === task.studentName));

  async function submitClassroomQa() {
    if (!selectedStudentId || !qaQuestion.trim()) return;
    setQaBusy(true);
    try {
      const result = await onAsk({ studentId: selectedStudentId, question: qaQuestion.trim() });
      setQaAnswer(result);
    } catch (error) {
      setQaAnswer(`问答失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setQaBusy(false);
    }
  }

  return <div className="page-grid">
    <section className={moduleClass("课堂主页", "panel full classroom-public-wrapper")}>
      <ClassroomPublicScreen device={device} onOpenModule={onModuleOpen} students={students} tasks={tasks} />
    </section>
    <section className={moduleClass("课堂主页", "panel full")}>
      <PanelTitle icon={Volume2} title="平板绑定" />
      <div className="tablet-bind-row">
        <label className="field-label">绑定码<input defaultValue="PAD6JH" onChange={(event) => setDeviceCode(event.target.value)} /></label>
        <button className="primary-button" onClick={onLogin}><CheckCircle2 size={17} />绑定平板</button>
        <span>{devices.length ? `已登记 ${devices.length} 台课堂设备` : "等待教师端登记课堂设备"}</span>
      </div>
    </section>
    <section className={moduleClass("今日任务", "panel full")}>
      <PanelTitle icon={CalendarDays} title="今日任务提醒" />
      <p className="muted-line">学生在课堂平板确认身份后，可以在这里查看老师发布的今日任务，并选择已完成任务同步回教师端和学生端。</p>
      <div className="record-list">{classroomTasks.length ? classroomTasks.slice(0, 10).map((task) => <div className="record-row task-detail-row" key={task.id}><SubjectBadge subject={task.subject} /><div><strong>{task.title}</strong><span>{task.studentName} · {task.minutes}分钟 · {task.status}</span><p>{task.summary || task.description || "老师暂未填写具体事项"}</p></div><button className="secondary-button" disabled={task.status === "已完成"} onClick={() => onTaskComplete(task.id)}>{task.status === "已完成" ? "已完成" : "标记完成"}</button></div>) : <p className="review-empty">暂无发布到本桌学生的今日任务。</p>}</div>
    </section>
    <section className={moduleClass("AI问答", "panel full")}>
      <PanelTitle badge="AI生成" icon={Bot} title="AI问答" />
      <div className="classroom-action-grid">
        <article className="classroom-action-card full-width-card">
          <strong>AI问答可用</strong>
          <div className="availability-light"><i className="green" /><strong>课堂平板问答</strong><span>学生可以直接输入问题，回答会绑定当前使用学生。</span></div>
          <div className="template-controls"><label>当前使用学生<select value={selectedStudentId} onChange={(event) => setQaStudentId(event.target.value)}>{fallbackStudents.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.grade}</option>)}</select></label></div>
          <textarea className="wide-textarea compact-textarea" value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} placeholder="学生输入语文、数学、英语或其他学习问题。题目类问题会优先做思路引导。" />
          <div className="button-row">
            <button className="primary-button" disabled={qaBusy || !selectedStudent} onClick={() => void submitClassroomQa()}><Send size={17} />{qaBusy ? "正在回答" : "发送问题"}</button>
            <button className="secondary-button" onClick={() => setQaQuestion("")}>清空问题</button>
          </div>
          <p className="muted-line">全科提问，不提供拍照上传。日常知识和英语词汇可直接解释；题目、作业、小测和试卷问题只做思路引导。</p>
        </article>
        <article className="classroom-action-card">
          <strong>教师端发布的语音任务</strong>
          <div className="record-list">{deviceBroadcasts.length ? deviceBroadcasts.slice(0, 3).map((item) => <div className="record-row" key={item.id}><Volume2 size={17} /><div><strong>{item.title}</strong><span>{item.subject} · {item.status} · {item.voiceText || item.content}</span></div></div>) : <p className="review-empty">暂无教师端发布的语音播报任务。</p>}</div>
          <p className="muted-line">听写、跟读和语音播报由教师端发布与控制，平板端只接收并执行。</p>
        </article>
        <article className="classroom-action-card">
          <strong>平板端接收规则</strong>
          <div className="tag-grid"><span>AI 问答：学生可直接提问</span><span>听写：教师端发布后播报</span><span>跟读：教师端选择课文</span><span>记录绑定本次学生身份</span></div>
        </article>
      </div>
      {qaAnswer ? <p className="answer-box">{qaAnswer}</p> : <p className="review-empty">暂无回答。学生输入问题后即可获得 AI 生成的学习反馈。</p>}
    </section>
    <section className={moduleClass("听写播报", "panel full")}>
      <PanelTitle icon={Volume2} title="听写播报" />
      <ClassroomDictationPanel device={device} dictationTasks={dictationTasks} />
    </section>
    <section className={moduleClass("课文跟读", "panel full")}>
      <PanelTitle icon={BookOpen} title="课文跟读" />
      <ClassroomReadingPanel broadcasts={deviceBroadcasts} device={device} readingTasks={readingTasks} />
    </section>
  </div>;
}

function ClassroomDictationPanel({ device, dictationTasks }: { device: ClassroomDevice; dictationTasks: DictationTask[] }) {
  const fallbackDictations: DictationTask[] = [{
    id: "demo-dictation",
    deviceId: device.id || "demo-device",
    grade: device.grade || "六年级",
    className: device.className || "课堂平板",
    subject: "英语",
    title: "Unit 2 单词听写",
    items: ["carry", "bright", "finish", "careful"],
    currentIndex: 0,
    difficulty: "基础",
    repeats: 2,
    intervalSeconds: 10,
    status: "待开始",
    createdByTeacherId: device.teacherId || ""
  }];
  const options = dictationTasks.filter((item) => !item.deviceId || item.deviceId === device.id);
  const usableTasks = options.length ? options : fallbackDictations;
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const task = usableTasks.find((item) => item.id === selectedTaskId) || usableTasks[0];
  const currentIndex = Math.min(index, Math.max(task.items.length - 1, 0));
  const currentItem = task.items[currentIndex] || "";

  useEffect(() => {
    setIndex(0);
    setRunning(false);
    setRevealed(false);
  }, [selectedTaskId]);

  return <div className="classroom-action-grid">
    <article className="classroom-action-card">
      <strong>听写任务</strong>
      <div className="template-controls"><label>选择任务<select value={task.id} onChange={(event) => setSelectedTaskId(event.target.value)}>{usableTasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
      <div className="tag-grid"><span>{task.subject}</span><span>{task.difficulty}</span><span>念 {task.repeats} 遍</span><span>间隔 {task.intervalSeconds} 秒</span></div>
      <p className="muted-line">听写进行中不显示词语内容，结束后再展示完整列表。</p>
    </article>
    <article className="classroom-action-card">
      <strong>{running ? `正在播报第 ${currentIndex + 1} 项` : revealed ? "听写已结束" : "等待开始"}</strong>
      <div className="dictation-display">{revealed ? currentItem : running ? "屏幕锁定中，词语不显示" : "点击开始后按规则自动播报"}</div>
      <div className="button-row">
        <button className="primary-button" onClick={() => { setRunning(true); setRevealed(false); }}><Volume2 size={17} />开始听写</button>
        <button className="secondary-button" disabled={!running || currentIndex <= 0} onClick={() => setIndex((value) => Math.max(value - 1, 0))}>上一项</button>
        <button className="secondary-button" disabled={!running || currentIndex >= task.items.length - 1} onClick={() => setIndex((value) => Math.min(value + 1, task.items.length - 1))}>下一项</button>
        <button className="secondary-button" onClick={() => { setRunning(false); setRevealed(true); }}>结束并显示词表</button>
      </div>
    </article>
    <article className="classroom-action-card full-width-card">
      <strong>完整词表</strong>
      <div className="tag-grid">{revealed ? task.items.map((item) => <span key={item}>{item}</span>) : <span>听写结束后显示</span>}</div>
    </article>
  </div>;
}

function ClassroomReadingPanel({ broadcasts, device, readingTasks }: { broadcasts: ClassroomBroadcast[]; device: ClassroomDevice; readingTasks: ReadingTask[] }) {
  const fallbackReadings: ReadingTask[] = [{
    id: "demo-reading",
    deviceId: device.id || "demo-device",
    grade: device.grade || "六年级",
    className: device.className || "课堂平板",
    subject: "语文",
    title: "课文预习跟读",
    passage: "明天学习的课文先读两遍，遇到不认识的字词先圈出来，再跟老师一起确认意思。",
    focusItems: ["难字词", "停顿节奏", "主要内容"],
    supportNote: "先跟读，再说出自己不理解的地方。",
    status: "待跟读",
    createdByTeacherId: device.teacherId || ""
  }];
  const options = readingTasks.filter((item) => !item.deviceId || item.deviceId === device.id);
  const usableReadings = options.length ? options : fallbackReadings;
  const [selectedReadingId, setSelectedReadingId] = useState("");
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const reading = usableReadings.find((item) => item.id === selectedReadingId) || usableReadings[0];
  const latestBroadcast = broadcasts[0];

  useEffect(() => {
    setStarted(false);
    setCompleted(false);
  }, [selectedReadingId]);

  return <div className="classroom-action-grid">
    <article className="classroom-action-card">
      <strong>跟读任务</strong>
      <div className="template-controls"><label>选择课文<select value={reading.id} onChange={(event) => setSelectedReadingId(event.target.value)}>{usableReadings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
      <div className="tag-grid"><span>{reading.subject}</span>{reading.focusItems.map((item) => <span key={item}>{readingFocusLabel(item, reading.subject)}</span>)}</div>
      {latestBroadcast ? <p className="muted-line">教师播报：{latestBroadcast.title}</p> : null}
    </article>
    <article className="classroom-action-card">
      <strong>{started ? completed ? "跟读完成" : "跟读进行中" : "等待开始"}</strong>
      <p className="reading-passage">{reading.passage}</p>
      <p className="muted-line">{reading.supportNote}</p>
      <div className="button-row">
        <button className="primary-button" onClick={() => { setStarted(true); setCompleted(false); }}><Volume2 size={17} />开始跟读</button>
        <button className="secondary-button" disabled={!started} onClick={() => setCompleted(true)}><CheckCircle2 size={17} />完成跟读</button>
      </div>
    </article>
  </div>;
}

function ClassroomPublicScreen({ device, onOpenModule, students, tasks }: { device: ClassroomDevice; onOpenModule?: (module: string) => void; students: StudentProfile[]; tasks: LearningTaskCard[] }) {
  const fallbackStudents = students.length ? students : demoStudents;
  const [activeStudentId, setActiveStudentId] = useState("");
  const [draggingStudentId, setDraggingStudentId] = useState("");
  const activeStudent = fallbackStudents.find((item) => item.id === activeStudentId) || null;
  const pendingTasks = tasks.filter((item) => item.status !== "已完成").length;
  const completedTasks = tasks.filter((item) => item.status === "已完成").length;
  const rails = splitAvatarRails(fallbackStudents);

  function unlock(studentId: string) {
    setActiveStudentId(studentId);
    setDraggingStudentId("");
  }

  useEffect(() => {
    if (!activeStudentId) return undefined;
    const timer = window.setTimeout(() => setActiveStudentId(""), 90000);
    return () => window.clearTimeout(timer);
  }, [activeStudentId]);

  const interactionState = activeStudent ? "已确认身份" : draggingStudentId ? "正在吸附头像" : "公共待机";
  return <div className={`classroom-public-screen ${activeStudent ? "unlocked" : ""} ${draggingStudentId ? "dragging" : ""}`}>
    <header className="classroom-public-head">
      <div>
        <p className="eyebrow">君航 AI 助教 · 公共平板端</p>
        <h2>{device.label || "课堂公共平板"}</h2>
        <span>{device.grade || "多学段"} · {device.className || "共享使用"} · 家长参观模式</span>
      </div>
      <div className="classroom-public-head-actions">
        <div className="classroom-public-status"><StatusDot status={activeStudent ? "ready" : draggingStudentId ? "pending" : "ready"} /><strong>{interactionState}</strong></div>
        <span className="tablet-mode-pill">公共屏不展示排名和分数</span>
      </div>
    </header>
    <div className="tablet-stage-v1">
      <div className="tablet-drag-guide">
        <strong>{activeStudent ? "选择一个互动插件继续" : draggingStudentId ? "进入光环范围后松手确认" : "点击头像，或拖入中心学习光环"}</strong>
        <span>{activeStudent ? "90 秒无操作会自动回到公共待机。" : "只确认本次互动身份，不打开个人主页。"}</span>
      </div>
      <AvatarRail side="top" students={rails.top} draggingStudentId={draggingStudentId} onClick={unlock} onDragEnd={() => setDraggingStudentId("")} onDragStart={setDraggingStudentId} />
      <AvatarRail side="right" students={rails.right} draggingStudentId={draggingStudentId} onClick={unlock} onDragEnd={() => setDraggingStudentId("")} onDragStart={setDraggingStudentId} />
      <AvatarRail side="bottom" students={rails.bottom} draggingStudentId={draggingStudentId} onClick={unlock} onDragEnd={() => setDraggingStudentId("")} onDragStart={setDraggingStudentId} />
      <AvatarRail side="left" students={rails.left} draggingStudentId={draggingStudentId} onClick={unlock} onDragEnd={() => setDraggingStudentId("")} onDragStart={setDraggingStudentId} />
      <aside className="tablet-public-overview">
        <strong>今日课堂概览</strong>
        <div><span>任务记录</span><b>{tasks.length || 4}</b></div>
        <div><span>待跟进</span><b>{pendingTasks || 2}</b></div>
        <div><span>已完成</span><b>{completedTasks || 1}</b></div>
      </aside>
      <div className={`learning-halo-drop ${draggingStudentId ? "drag-active" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const studentId = event.dataTransfer.getData("student-id") || draggingStudentId; if (studentId) unlock(studentId); }}>
        <div className="learning-halo">
          <span className="halo-zone-label">中心吸附区</span>
          {activeStudent ? <div className="halo-confirmed">
            <StudentAvatar student={activeStudent} large />
            <h3>{activeStudent.displayName}</h3>
            <p>已进入本次互动</p>
            <span>本次记录将同步到学习档案，完整档案仍在学生端查看。</span>
            <small className="halo-timeout-note">90 秒无操作自动回到待机</small>
            <button className="secondary-button" onClick={() => setActiveStudentId("")}>回到公共待机</button>
          </div> : <div className="halo-waiting">
            <Bot size={42} />
            <h3>学习光环</h3>
            <p>{draggingStudentId ? "松手即可吸附确认" : "点击头像最快，拖拽头像更有参与感"}</p>
          </div>}
        </div>
      </div>
      <aside className="tablet-ai-flow">
        <strong>AI 助教流程</strong>
        {["教师发布", "学生互动", "AI分析", "老师复核", "档案归档"].map((item) => <span key={item}>{item}</span>)}
      </aside>
    </div>
    <div className="tablet-plugin-guide"><strong>互动插件</strong><span>{activeStudent ? "前三项可进入当前已有能力，后三项作为后续互动扩展入口。" : "点击或拖拽头像完成确认后，插件会从展示态切换为可选态；投票、鼓励、协作由老师开启。"}</span></div>
    <div className="tablet-plugin-row">
      {[
        { icon: MessageSquareText, name: "AI问答", state: "可用", kind: "ready" },
        { icon: Volume2, name: "听写播报", state: "可用", kind: "ready" },
        { icon: BookOpen, name: "课文跟读", state: "可用", kind: "ready" },
        { icon: ClipboardList, name: "课堂投票", state: "老师开启后", kind: "future" },
        { icon: CheckCircle2, name: "今日鼓励", state: "老师开启后", kind: "future" },
        { icon: UsersRound, name: "小组协作", state: "老师开启后", kind: "future" }
      ].map((plugin) => {
        const enabled = activeStudent && plugin.kind === "ready";
        return <button className={`tablet-plugin-card ${enabled ? "enabled" : "locked"} ${plugin.kind}`} disabled={!enabled} key={plugin.name} onClick={() => enabled && onOpenModule?.(plugin.name)} type="button"><plugin.icon size={20} /><strong>{plugin.name}</strong><span>{activeStudent ? plugin.state : "确认身份后开启"}</span></button>;
      })}
    </div>
  </div>;
}

function AvatarRail({ draggingStudentId, onClick, onDragEnd, onDragStart, side, students }: { draggingStudentId: string; onClick: (studentId: string) => void; onDragEnd: () => void; onDragStart: (studentId: string) => void; side: "top" | "right" | "bottom" | "left"; students: StudentProfile[] }) {
  return <div className={`tablet-avatar-rail ${side}`} data-rail={railLabel(side)}>{students.map((student) => <button className={`tablet-avatar-card ${draggingStudentId === student.id ? "dragging" : ""}`} data-student-id={student.id} draggable key={student.id} onClick={() => onClick(student.id)} onDragEnd={onDragEnd} onDragStart={(event) => { event.dataTransfer.setData("student-id", student.id); onDragStart(student.id); }} type="button"><StudentAvatar student={student} /><span>{student.displayName}</span><small>点击或拖拽</small></button>)}</div>;
}

function StudentAvatar({ large, student }: { large?: boolean; student: StudentProfile }) {
  return <i className={`student-avatar-bubble ${large ? "large" : ""}`}>{student.displayName.slice(-2)}</i>;
}

function splitAvatarRails(students: StudentProfile[]) {
  const rails = { top: [] as StudentProfile[], right: [] as StudentProfile[], bottom: [] as StudentProfile[], left: [] as StudentProfile[] };
  students.forEach((student, index) => {
    const side = index % 4 === 0 ? "top" : index % 4 === 1 ? "right" : index % 4 === 2 ? "bottom" : "left";
    rails[side].push(student);
  });
  return rails;
}

function railLabel(side: "top" | "right" | "bottom" | "left") {
  if (side === "top") return "上方头像轨道";
  if (side === "right") return "右侧头像轨道";
  if (side === "bottom") return "下方头像轨道";
  return "左侧头像轨道";
}

function masteryTrendLabel(value: number) {
  if (value >= 82) return "稳定";
  if (value >= 72) return "观察中";
  return "需巩固";
}

function LoginPanel({ code, onCode, onLogin, onPhone, phone, title }: { code: string; onCode: (v: string) => void; onLogin: () => void; onPhone: (v: string) => void; phone: string; title: string }) {
  return <section className="panel full"><PanelTitle icon={UserRound} title={title} /><div className="template-controls"><label>电话<input value={phone} onChange={(event) => onPhone(event.target.value)} /></label><label>专属码<input value={code} onChange={(event) => onCode(event.target.value)} /></label><button className="primary-button" onClick={onLogin}><CheckCircle2 size={17} />登录同步真实数据</button></div></section>;
}

function LoginFields({ onCode, onName, onPhone, onSubmit }: { onCode: (v: string) => void; onName: (v: string) => void; onPhone: (v: string) => void; onSubmit: () => void }) {
  return <div className="template-controls"><label>学生姓名<input defaultValue="李子越" onChange={(event) => onName(event.target.value)} /></label><label>家长电话<input defaultValue="13900005678" onChange={(event) => onPhone(event.target.value)} /></label><label>学生专属码<input defaultValue="LZY6P9" onChange={(event) => onCode(event.target.value)} /></label><button className="primary-button" onClick={onSubmit}><CheckCircle2 size={17} />登录学生端</button></div>;
}

function FlowCard({ hint, icon: Icon, index, label, state, value }: { hint: string; icon: React.ComponentType<{ size?: number }>; index: number; label: string; state: ProviderStatus; value: string; }) {
  return <article className={`teacher-flow-card ${state}`}><div className="flow-card-top"><span className="flow-index">{index}</span><Icon size={19} /><StatusDot status={state} /></div><strong>{label}</strong><div className="flow-value"><b>{value}</b></div><p>{hint}</p></article>;
}

function TaskList({ tasks }: { tasks: LearningTaskCard[] }) {
  return <div className="record-list">{tasks.length ? tasks.slice(0, 8).map((task) => {
    const detail = task.summary || task.description || task.knowledgePoints.join(" / ") || "老师暂未填写具体事项";
    return <div className="record-row task-detail-row" key={task.id}><SubjectBadge subject={task.subject} /><div><strong>{task.title}</strong><span>{task.studentName} · {task.minutes}分钟 · {task.dueLabel}</span><p>{detail}</p></div><StatusPill label={task.status} status={statusToProviderStatus(task.status)} /></div>;
  }) : <p className="review-empty">暂无任务</p>}</div>;
}

function StudentList({ onAccess, students }: { onAccess?: (studentId: string, enabled: boolean) => void; students: StudentProfile[] }) {
  return <div className="record-list">{students.map((student) => <div className="record-row" key={student.id}><UsersRound size={17} /><div><strong>{student.displayName}</strong><span>{student.grade} · {student.guardianPhone} · {student.accessCode || "未开通"}</span></div><StatusPill label={student.loginEnabled ? "可登录" : "停用"} status={student.loginEnabled ? "ready" : "blocked"} />{onAccess ? <button className="secondary-button" onClick={() => onAccess(student.id, !student.loginEnabled)}>{student.loginEnabled ? "停用" : "开通"}</button> : null}</div>)}</div>;
}

function GradingWorkbenchPanel({ onMarkReviewed, onRecognize, reviewSubmissions, workbenches }: { onMarkReviewed: (submissionId: string, input?: Record<string, unknown>) => void; onRecognize: (submissionId: string) => void; reviewSubmissions: ReviewSubmission[]; workbenches: GradingWorkbench[] }) {
  const [activeId, setActiveId] = useState(workbenches[0]?.submissionId || "");
  const active = workbenches.find((item) => item.submissionId === activeId) || workbenches[0];
  const [activePage, setActivePage] = useState(1);
  const [activeQuestionId, setActiveQuestionId] = useState(active?.questions[0]?.id || "");
  const [reviewScore, setReviewScore] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  useEffect(() => {
    if (!workbenches.some((item) => item.submissionId === activeId)) setActiveId(workbenches[0]?.submissionId || "");
  }, [activeId, workbenches]);
  useEffect(() => {
    setActivePage(1);
    setActiveQuestionId(active?.questions[0]?.id || "");
    setReviewScore(active?.score != null ? String(active.score) : active?.provisionalScore != null ? String(active.provisionalScore) : "");
    setReviewNote("");
  }, [active?.submissionId]);
  if (!workbenches.length) {
    return <div>
      <p className="review-empty">暂无批改工作台记录。上传照片后，系统会创建批改批次并进入这里。</p>
      {reviewSubmissions.length ? <ReviewQueue onMarkReviewed={onMarkReviewed} onRecognize={onRecognize} submissions={reviewSubmissions} /> : null}
    </div>;
  }
  const page = active?.pages.find((item) => item.pageNumber === activePage) || active?.pages[0];
  const question = active?.questions.find((item) => item.id === activeQuestionId) || active?.questions[0];
  const pageQuestions = (active?.questions || []).filter((item) => Number(item.bbox?.page || 1) === (page?.pageNumber || 1));
  const markers = page?.markers?.length ? page.markers : pageQuestions.map((item) => ({
    id: item.id,
    questionNo: item.questionNo,
    status: item.status,
    page: item.bbox?.page || page?.pageNumber || 1,
    x: item.bbox?.x ?? 0.08,
    y: item.bbox?.y ?? 0.12,
    w: item.bbox?.w ?? 0.18,
    h: item.bbox?.h ?? 0.08,
    label: item.status === "correct" ? "✓" : item.status === "wrong" ? "×" : "?"
  }));
  const needsScore = active?.needsTeacherReview || active?.archiveEligible === false || active?.quality?.lowConfidence || active?.score == null;
  const scoreNumber = reviewScore.trim() === "" ? null : Number(reviewScore);
  const scoreValid = scoreNumber != null && Number.isFinite(scoreNumber);
  const pageQualityIssues = [...(page?.qualityIssues || []), ...(page?.qualityWarnings || [])];
  const pageQualityText = page?.qualityStatus === "ready"
    ? "图片质量可用"
    : page?.qualityStatus === "poor"
      ? "图片质量较差"
      : "图片需复核";
  return <div className="grading-workbench">
    <aside className="grading-batch-list">
      <div className="grading-workbench-summary">
        <strong>待复核批次</strong>
        <span>{workbenches.length} 条记录 · {workbenches.reduce((sum, item) => sum + item.pendingQuestionCount, 0)} 题待确认</span>
      </div>
      {workbenches.map((item) => <button className={item.submissionId === active?.submissionId ? "active" : ""} key={item.submissionId} onClick={() => setActiveId(item.submissionId)}>
        <strong>{item.studentName} · {item.kind}</strong>
        <span>{item.subject} · {item.questionCount || 0}题 · {item.ocrStatusLabel}</span>
        <small>{item.score != null ? `${item.score}分` : item.provisionalScore != null ? `初判${item.provisionalScore}分` : "待评分"}</small>
      </button>)}
    </aside>
    <main className="grading-image-workspace">
      <div className="review-card-head">
        <div>
          <h3>{active?.title}</h3>
          <p>{active?.studentName} · {active?.subject} · {active?.kind} · {active ? new Date(active.submittedAt).toLocaleString("zh-CN") : ""}</p>
        </div>
        <StatusPill label={active?.needsTeacherReview ? "待教师确认" : "可归档"} status={active?.needsTeacherReview ? "pending" : "ready"} />
      </div>
      <div className="review-image-tabs">{active?.pages.map((item) => <button className={item.pageNumber === page?.pageNumber ? "active" : ""} key={item.id} onClick={() => setActivePage(item.pageNumber)}>第 {item.pageNumber} 页</button>)}</div>
      {page ? <p className={`context-note ${page.qualityStatus === "ready" ? "" : "blocked"}`}><ShieldCheck size={15} />{pageQualityText}{page.qualityScore != null ? ` · 质量分 ${Math.round(page.qualityScore * 100)}%` : ""}{pageQualityIssues.length ? ` · ${pageQualityIssues.slice(0, 2).join("；")}` : ""}</p> : null}
      <div className="grading-image-stage">
        {page?.imageUrl ? <img src={page.imageUrl} alt={`${active?.studentName || ""} 上传页面 ${page.pageNumber}`} /> : <div className="annotation-empty">暂无图片预览</div>}
        {markers.map((marker) => <button className={`annotation-marker ${marker.status}`} key={marker.id} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} title={`第${marker.questionNo}题 ${statusText(marker.status)}`} onClick={() => {
          const target = active?.questions.find((item) => item.questionNo === marker.questionNo);
          if (target) setActiveQuestionId(target.id);
        }}>{marker.label}</button>)}
      </div>
    </main>
    <aside className="grading-question-panel">
      <div className="grading-question-list">
        {(active?.questions || []).map((item) => <button className={item.id === question?.id ? "active" : ""} key={item.id} onClick={() => {
          setActiveQuestionId(item.id);
          setActivePage(Number(item.bbox?.page || 1));
        }}>
          <span>第 {item.questionNo} 题</span>
          <StatusPill label={statusText(item.status)} status={item.status === "correct" ? "ready" : item.status === "wrong" ? "blocked" : "pending"} />
        </button>)}
        {!active?.questions.length ? <p className="review-empty">暂无逐题识别结果，请重新识别并重批。</p> : null}
      </div>
      {question ? <div className="question-detail-panel workbench-detail">
        <div className="question-detail-head"><strong>第 {question.questionNo} 题详情</strong><span>{question.confidence != null ? `置信度 ${Math.round(question.confidence * 100)}%` : "置信度待补"}</span></div>
        <DetailLine label="学生作答" value={question.studentAnswer || "未识别到明确作答"} />
        <DetailLine label="参考答案" value={question.correctAnswer || "待教师确认参考答案"} />
        <DetailLine label="过程/解析" value={(question.studentProcess || []).join("；") || question.explanation || "暂无过程解析"} />
        <DetailLine label="错因定位" value={question.errorStep || (question.status === "correct" ? "未发现明显错误" : "等待教师复核")} />
        <DetailLine label="归档建议" value={question.suggestedPractice || active?.summary || "复核后进入错题和薄弱点分析"} />
      </div> : null}
      <div className="review-confirm-form">
        <label className="field-label">教师确认分数<input min="0" step="0.5" type="number" value={reviewScore} onChange={(event) => setReviewScore(event.target.value)} placeholder="确认后才归档" /></label>
        <label className="field-label">复核备注<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="记录扣分原因、图片识别问题或后续跟进建议。" /></label>
        {needsScore ? <p className="context-note blocked"><ShieldCheck size={15} />当前记录必须由教师确认分数后才允许进入学生档案。</p> : null}
      </div>
      <div className="review-actions">
        <button className="secondary-button" disabled={!active} onClick={() => active && onRecognize(active.submissionId)}><RefreshCw size={16} />重新识别</button>
        <button className="primary-button" disabled={!active || (needsScore && !scoreValid)} onClick={() => active && onMarkReviewed(active.submissionId, { ...(scoreValid ? { score: scoreNumber } : {}), ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}) })}><CheckCircle2 size={16} />确认归档</button>
      </div>
    </aside>
  </div>;
}

function ReviewQueue({ onMarkReviewed, onRecognize, submissions }: { onMarkReviewed: (submissionId: string, input?: Record<string, unknown>) => void; onRecognize: (submissionId: string) => void; submissions: ReviewSubmission[] }) {
  if (!submissions.length) return <p className="review-empty">暂无需要复核的批改记录</p>;
  const batches = groupReviewSubmissions(submissions).slice(0, 8);
  return <div className="review-submission-grid">{batches.map((batch) => <ReviewBatchCard batch={batch} key={batch.id} onMarkReviewed={onMarkReviewed} onRecognize={onRecognize} />)}</div>;
}

function groupReviewSubmissions(submissions: ReviewSubmission[]): ReviewSubmissionBatch[] {
  const groups = new Map<string, ReviewSubmission[]>();
  for (const submission of submissions) {
    const key = submission.batchId ? `batch:${submission.batchId}` : `submission:${submission.id}`;
    groups.set(key, [...(groups.get(key) || []), submission]);
  }
  return Array.from(groups.entries()).map(([id, items]) => {
    const sorted = [...items].sort((a, b) => {
      const imageOrder = Number(a.imageIndex || 0) - Number(b.imageIndex || 0);
      if (imageOrder !== 0) return imageOrder;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });
    const first = sorted[0];
    const imageTotal = Math.max(
      sorted.length,
      ...sorted.map((item) => Number(item.imageTotal || item.imageFiles?.length || item.imageNames.length || 1))
    );
    return {
      id,
      title: first.assignmentTitle || first.kind,
      studentName: first.studentName,
      subject: first.subject,
      kind: first.kind,
      uploadedBy: first.uploadedBy,
      submittedAt: first.submittedAt,
      imageTotal,
      submissions: sorted
    };
  }).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

function ReviewBatchCard({ batch, onMarkReviewed, onRecognize }: { batch: ReviewSubmissionBatch; onMarkReviewed: (submissionId: string, input?: Record<string, unknown>) => void; onRecognize: (submissionId: string) => void }) {
  const [activeSubmissionId, setActiveSubmissionId] = useState(batch.submissions[0]?.id || "");
  useEffect(() => {
    setActiveSubmissionId(batch.submissions[0]?.id || "");
  }, [batch.id, batch.submissions]);
  const activeSubmission = batch.submissions.find((item) => item.id === activeSubmissionId) || batch.submissions[0];
  const needsReviewCount = batch.submissions.filter((item) => item.needsReview).length;
  const completedCount = batch.submissions.length - needsReviewCount;
  if (batch.submissions.length === 1) {
    return <ReviewSubmissionCard item={activeSubmission} onMarkReviewed={onMarkReviewed} onRecognize={onRecognize} />;
  }
  return <div className="review-batch-stack">
    <div className="review-batch-head">
    <div className="review-card-head">
      <div>
        <h3>{batch.title}</h3>
        <p>{batch.studentName} · {batch.subject} · {batch.kind} · 共 {batch.imageTotal} 张图片</p>
      </div>
      <StatusPill label={needsReviewCount ? `${needsReviewCount}页待复核` : "已完成"} status={needsReviewCount ? "pending" : "ready"} />
    </div>
    <div className="review-meta-row">
      <span>{batch.uploadedBy === "student" ? "学生端上传" : "教师端上传"}</span>
      <span>已复核 {completedCount}/{batch.submissions.length} 页</span>
      <span>{new Date(batch.submittedAt).toLocaleString("zh-CN")}</span>
    </div>
    <div className="review-page-tabs">
      {batch.submissions.map((submission, index) => <button className={submission.id === activeSubmission.id ? "active" : ""} key={submission.id} onClick={() => setActiveSubmissionId(submission.id)}>
        第 {submission.imageIndex || index + 1} 张
        <small>{submission.ocrStatusLabel || submission.status}</small>
      </button>)}
    </div>
    </div>
    <ReviewSubmissionCard item={activeSubmission} onMarkReviewed={onMarkReviewed} onRecognize={onRecognize} />
  </div>;
}

function defaultChaptersForAsset(asset: TextbookAsset): TextbookChapter[] {
  if (asset.subject === "英语") {
    return Array.from({ length: 6 }, (_, index) => {
      const unit = `Unit ${index + 1}`;
      return {
        id: `${asset.id}-unit-${index + 1}`,
        unit,
        title: `${unit} 预习与跟读`,
        pageStart: null,
        pageEnd: null,
        focusItems: ["新单词", "重点句型", "课本音频跟读"],
        dictationItems: [`请从${unit}课本词汇表核对后补充单词`],
        readingSupport: `请结合智慧中小学授课模式核对 ${unit} 课文原文、页码和课本音频后再发布。`
      };
    });
  }
  if (asset.subject === "语文") {
    return ["第一单元", "第二单元", "第三单元", "第四单元", "第五单元", "第六单元", "第七单元", "第八单元"].map((unit, index) => ({
      id: `${asset.id}-unit-${index + 1}`,
      unit,
      title: `${unit} 课文跟读`,
      pageStart: null,
      pageEnd: null,
      focusItems: ["难字词", "重点句", "朗读节奏"],
      dictationItems: [`请从${unit}课后生字词核对后补充词语`],
      readingSupport: `请结合智慧中小学授课模式核对${unit}课文原文、页码和朗读音频后再发布。`
    }));
  }
  return [];
}

function parseChapterDraft(text: string, asset: TextbookAsset): TextbookChapter[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  return lines.map((line, index) => {
    const parts = line.split("|").map((item) => item.trim());
    return {
      id: `${asset.id}-chapter-${index + 1}`,
      unit: parts[0] || `章节 ${index + 1}`,
      title: parts[1] || parts[0] || `章节 ${index + 1}`,
      pageStart: parts[2] ? Number(parts[2]) || null : null,
      pageEnd: parts[3] ? Number(parts[3]) || null : null,
      focusItems: parts[4] ? parts[4].split(/、|,|，/).map((item) => item.trim()).filter(Boolean) : [],
      dictationItems: parts[5] ? parts[5].split(/、|,|，/).map((item) => item.trim()).filter(Boolean) : [],
      readingSupport: parts[6] || ""
    };
  });
}

function chaptersToDraftText(chapters: TextbookChapter[] = []) {
  return chapters.map((item, index) => [
    item.unit || `章节 ${index + 1}`,
    item.title,
    item.pageStart ?? "",
    item.pageEnd ?? "",
    (item.focusItems || []).join("、"),
    (item.dictationItems || []).join("、"),
    item.readingSupport || ""
  ].join(" | ")).join("\n");
}

function ContentIndexPanel({ files, index, notice, onFiles, onRebuild, onUpload }: { files: File[]; index: ContentIndexSummary | null; notice?: string; onFiles: (files: File[]) => void; onRebuild: () => void; onUpload: () => void }) {
  const subjectCount = Object.keys(index?.subjectCounts || {}).length;
  const gradeCount = Object.keys(index?.gradeCounts || {}).length;
  const knowledgePointCount = Object.keys(index?.knowledgePointCounts || {}).length;
  const topSubjects = Object.entries(index?.subjectCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([subject]) => subject);
  const topKnowledgePoints = Object.entries(index?.knowledgePointCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([point]) => point);
  const latestDocuments = index?.documents?.slice(0, 4) || [];
  return <div className="content-index-panel" data-testid="content-index-panel">
    <div className="teacher-flow-grid compact-grid">
      <FlowCard icon={FileText} index={1} label="资料索引" state={index?.available ? "ready" : "pending"} value={`${index?.documentCount || 0}`} hint={index?.available ? "Markdown 资料已进入生成上下文" : "尚未生成内容索引"} />
      <FlowCard icon={BookOpen} index={2} label="学科覆盖" state={subjectCount ? "ready" : "pending"} value={`${subjectCount}`} hint="用于匹配生成请求的学科范围" />
      <FlowCard icon={ListChecks} index={3} label="知识点" state={knowledgePointCount ? "ready" : "pending"} value={`${knowledgePointCount}`} hint="从资料摘要和片段中抽取候选重点" />
    </div>
    <div className="review-card-head">
      <div>
        <h3>上传资料上下文</h3>
        <p>普通讲义、试卷、PPT、Word、PDF 先转 Markdown，再重建索引。生成小测、练习和试卷时会自动匹配相关资料摘要。</p>
      </div>
      <button className="secondary-button" onClick={onRebuild}><RefreshCw size={16} />重建资料索引</button>
    </div>
    <div className="content-upload-row">
      <label className="file-picker-button"><Upload size={16} />选择资料<input data-testid="content-material-file-input" multiple type="file" accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.tsv,.html,.htm,.txt,.md,.jpg,.jpeg,.png,.gif,.bmp,.webp" onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label>
      <button className="primary-button" data-testid="content-material-import-button" disabled={!files.length} onClick={onUpload}><Upload size={16} />导入并重建索引</button>
      <span>{files.length ? `已选择 ${files.length} 份资料` : "支持普通 PDF、Office、图片、HTML、文本和 Markdown"}</span>
    </div>
    {notice ? <p className="context-note blocked"><ShieldCheck size={15} />{notice}</p> : null}
    {index?.available ? <p className="context-note"><FileText size={15} />已进入生成上下文：{index.documentCount} 份资料{topSubjects.length ? ` · 科目：${topSubjects.join(" / ")}` : ""}{topKnowledgePoints.length ? ` · 知识点：${topKnowledgePoints.join(" / ")}` : ""}</p> : null}
    <div className="review-meta-row">
      <span>{index?.generatedAt ? `更新时间：${new Date(index.generatedAt).toLocaleString()}` : "尚无更新时间"}</span>
      <span>{gradeCount} 个年级信号</span>
      <span>{index?.reason || index?.indexPath || "exports/content-index/index.json"}</span>
    </div>
    <div className="record-list">
      {latestDocuments.length ? latestDocuments.map((document) => <div className="record-row" key={document.id}><FileText size={17} /><div><strong>{document.title}</strong><span>{document.summary || "暂无摘要"} · {(document.knowledgePoints || []).slice(0, 4).join(" / ") || "待抽取知识点"}</span></div><StatusPill label={`${document.chunkCount || 0}段`} status="ready" /></div>) : <p className="review-empty">暂无资料索引。先运行文件转 Markdown，再点击重建资料索引。</p>}
    </div>
  </div>;
}

function KnowledgeLibraryPanel({
  grade,
  onGrade,
  onRefresh,
  onReview,
  onSourceCreate,
  onSubject,
  onSummary,
  onSync,
  onTitle,
  onUrl,
  sources,
  subject,
  summary,
  title,
  url
}: {
  grade: string;
  onGrade: (value: string) => void;
  onRefresh: () => void;
  onReview: (sourceId: string, input: Record<string, unknown>) => void;
  onSourceCreate: (input: Record<string, unknown>) => void;
  onSubject: (value: SubjectLabel) => void;
  onSummary: (value: string) => void;
  onSync: () => void;
  onTitle: (value: string) => void;
  onUrl: (value: string) => void;
  sources: KnowledgeSource[];
  subject: SubjectLabel;
  summary: string;
  title: string;
  url: string;
}) {
  const approvedCount = sources.filter((item) => item.allowedForGeneration).length;
  const pendingCount = sources.filter((item) => item.reviewStatus === "PENDING").length;
  return <div className="content-index-panel">
    <div className="teacher-flow-grid compact-grid">
      <FlowCard icon={BookOpen} index={1} label="资料来源" state={sources.length ? "ready" : "pending"} value={`${sources.length}`} hint="教材、上传资料和网络参考统一登记" />
      <FlowCard icon={ShieldCheck} index={2} label="可用于生成" state={approvedCount ? "ready" : "pending"} value={`${approvedCount}`} hint="教师复核后才进入生成上下文" />
      <FlowCard icon={ListChecks} index={3} label="待复核" state={pendingCount ? "pending" : "ready"} value={`${pendingCount}`} hint="网络参考默认待复核" />
    </div>
    <div className="review-card-head">
      <div>
        <h3>资料库复核</h3>
        <p>资料库只作为知识结构和题型参考来源。未复核或版权状态不明确的资料，不允许直接进入生成流程。</p>
      </div>
      <div className="button-row"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={16} />刷新资料库</button><button className="primary-button" onClick={onSync}><BookOpen size={16} />同步内容索引</button></div>
    </div>
    <div className="template-controls textbook-filter-grid">
      <label>参考标题<input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="例如：六年级上册英语 Unit 1 题型参考" /></label>
      <label>来源链接<input value={url} onChange={(event) => onUrl(event.target.value)} placeholder="公开网页或资料来源 URL" /></label>
      <label>科目<select value={subject} onChange={(event) => onSubject(event.target.value as SubjectLabel)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>年级<select value={grade} onChange={(event) => onGrade(event.target.value)}>{gradeOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    <label className="field-label">参考说明<textarea className="wide-textarea" value={summary} onChange={(event) => onSummary(event.target.value)} placeholder="写清楚这份资料适合参考的知识点、题型结构或注意事项。" /></label>
    <div className="button-row"><button className="secondary-button" disabled={!title.trim()} onClick={() => onSourceCreate({ title, sourceUrl: url, subject, grade, summary, sourceType: "network-reference", licenseStatus: "REVIEW_REQUIRED" })}><Plus size={16} />登记网络参考</button></div>
    <div className="record-list">
      {sources.slice(0, 8).map((source) => <div className="record-row" key={source.id}><FileText size={17} /><div><strong>{knowledgeDisplayTitle(source)}</strong><span>{source.subject || "未标科目"} · {source.grade || "未标年级"} · {knowledgeStatusLabel(source.reviewStatus)} · {source.allowedForGeneration ? "可用于生成" : "不可直接生成"} · {source.chunkCount}段</span><span>{knowledgeDisplayText(source.summary || source.sourceUrl || source.markdownPath || "暂无摘要")}</span></div><div className="button-row"><button className="secondary-button" onClick={() => onReview(source.id, { status: "APPROVED", allowedForGeneration: true, licenseStatus: source.licenseStatus === "NOT_ALLOWED" ? "REVIEW_REQUIRED" : source.licenseStatus, note: "教师确认可作为结构参考。" })}>通过</button><button className="secondary-button" onClick={() => onReview(source.id, { status: "REJECTED", allowedForGeneration: false, licenseStatus: "NOT_ALLOWED", note: "暂不用于学生内容生成。" })}>停用</button></div></div>)}
      {!sources.length ? <p className="review-empty">暂无资料库来源。可先导入 Markdown 资料并同步内容索引，或登记网络参考来源后复核。</p> : null}
    </div>
  </div>;
}

function knowledgeDisplayText(text: string) {
  return text
    .replace(/Prompt Engineering/gi, "提示词工程")
    .replace(/Context Engineering/gi, "上下文工程")
    .replace(/playbook/gi, "使用手册")
    .replace(/reading/gi, "阅读")
    .replace(/grammar/gi, "语法")
    .replace(/vocabulary/gi, "词汇");
}

function knowledgeDisplayTitle(source: KnowledgeSource) {
  const title = knowledgeDisplayText(source.title || "");
  const summary = knowledgeDisplayText(source.summary || "");
  if (/^[\w\s._-]+$/.test(source.title || "") && summary) return summary;
  return title || summary || "未命名资料";
}

function knowledgeStatusLabel(status: string) {
  if (status === "APPROVED") return "已复核";
  if (status === "REJECTED") return "已停用";
  return "待复核";
}

function TextbookLibrary({ assets, onOpen, onSaveChapters, onSelectContext, selectedContext }: { assets: TextbookAsset[]; onOpen: (assetId: string) => void; onSaveChapters: (assetId: string, chapters: TextbookChapter[]) => void; onSelectContext: (context: { asset: TextbookAsset; chapter?: TextbookChapter } | null) => void; selectedContext: { asset: TextbookAsset; chapter?: TextbookChapter } | null }) {
  const [editingAssetId, setEditingAssetId] = useState("");
  const [chapterDraft, setChapterDraft] = useState("");
  if (!assets.length) return <p className="review-empty">暂无教材索引。请先确认 D:\君航AI助教\textbooks 存在，然后点击“重扫教材目录”。</p>;
  const stats = {
    total: assets.length,
    openable: assets.filter((asset) => asset.openable).length,
    readonly: assets.filter((asset) => asset.importState.includes("只读")).length
  };
  return <div className="textbook-library"><div className="teacher-flow-grid compact-grid"><FlowCard icon={BookOpen} index={1} label="索引教材" state="ready" value={`${stats.total}`} hint="只读记录，不改原教材文件" /><FlowCard icon={ShieldCheck} index={2} label="原文件可访问" state={stats.openable ? "ready" : "pending"} value={`${stats.openable}`} hint="由智慧中小学 App 或默认程序打开" /><FlowCard icon={Lock} index={3} label="章节索引" state={assets.some((asset) => asset.chapterCount) ? "ready" : "pending"} value={`${assets.reduce((sum, asset) => sum + (asset.chapterCount || 0), 0)}`} hint="教师核对后可带入跟读、听写和组卷" /></div>{selectedContext ? <p className="context-note"><BookOpen size={15} />当前教材上下文：{selectedContext.asset.title}{selectedContext.chapter ? ` / ${selectedContext.chapter.title}` : ""}<button className="inline-link-button" onClick={() => onSelectContext(null)}>清除</button></p> : null}<div className="textbook-grid">{assets.map((asset) => { const chapters = asset.chapters?.length ? asset.chapters : []; const isEditing = editingAssetId === asset.id; return <article className="textbook-card" key={asset.id}><div className="textbook-card-head"><SubjectBadge subject={(subjects.includes(asset.subject as SubjectLabel) ? asset.subject : "语文") as SubjectLabel} /><StatusPill label={asset.chapterCount ? `${asset.chapterCount}章` : asset.importState || "只读索引"} status={asset.openable ? "ready" : "pending"} /></div><h3>{asset.title}</h3><p>{asset.grade} · {asset.subject} · {asset.edition} · {asset.volume}</p><small>{asset.relativePath || asset.source}</small><div className="review-meta-row"><span>{asset.ext || "文件"}</span><span>{asset.openWith || "智慧中小学"}</span><span>{asset.size ? `${Math.round(asset.size / 1024 / 1024)} MB` : "大小未知"}</span></div>{chapters.length ? <div className="chapter-chip-list">{chapters.slice(0, 4).map((chapter) => <button key={chapter.id} onClick={() => onSelectContext({ asset, chapter })}>{chapter.unit ? `${chapter.unit} · ` : ""}{chapter.title}</button>)}</div> : <p className="review-empty compact">暂无章节索引，可先生成草案后结合智慧中小学核对。</p>}{isEditing ? <div className="chapter-editor"><p>每行一个章节：单元 | 标题 | 起始页 | 结束页 | 重点 | 听写词 | 跟读说明</p><textarea value={chapterDraft} onChange={(event) => setChapterDraft(event.target.value)} /><div className="button-row"><button className="primary-button" onClick={() => { onSaveChapters(asset.id, parseChapterDraft(chapterDraft, asset)); setEditingAssetId(""); }}><ShieldCheck size={16} />保存章节索引</button><button className="secondary-button" onClick={() => setChapterDraft(chaptersToDraftText(defaultChaptersForAsset(asset)))}><RefreshCw size={16} />生成草案</button></div></div> : null}<div className="button-row"><button className="secondary-button" onClick={() => onOpen(asset.id)}><BookOpen size={16} />打开原教材</button><button className="secondary-button" onClick={() => { setEditingAssetId(isEditing ? "" : asset.id); setChapterDraft(chaptersToDraftText(chapters.length ? chapters : defaultChaptersForAsset(asset))); }}><FileText size={16} />章节索引</button><button className="secondary-button" onClick={() => onSelectContext({ asset, chapter: chapters[0] })}><Send size={16} />带入任务</button></div></article>; })}</div></div>;
}

function reviewNeedsConfirmedScore(item: ReviewSubmission) {
  const grading = item.structuredGrading;
  return Boolean(
    grading?.reviewStatus === "low_confidence_needs_review" ||
    grading?.needsTeacherReview ||
    grading?.archiveEligible === false ||
    grading?.quality?.lowConfidence ||
    (grading?.score == null && grading?.provisionalScore != null)
  );
}

function ReviewSubmissionCard({ item, onMarkReviewed, onRecognize }: { item: ReviewSubmission; onMarkReviewed: (submissionId: string, input?: Record<string, unknown>) => void; onRecognize: (submissionId: string) => void }) {
  const grading = item.structuredGrading;
  const questionResults = grading?.questionResults || [];
  const markers = grading?.annotationMarkers || [];
  const mistakes = grading?.mistakes || [];
  const initialReviewedScore = grading?.score != null
    ? String(grading.score)
    : grading?.provisionalScore != null
      ? String(grading.provisionalScore)
      : "";
  const [selectedQuestionId, setSelectedQuestionId] = useState(questionResults[0]?.id || questionResults[0]?.questionNo || "");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [reviewedScore, setReviewedScore] = useState(initialReviewedScore);
  const [reviewNote, setReviewNote] = useState("");
  const selectedQuestion = questionResults.find((question) => (question.id || question.questionNo) === selectedQuestionId) || questionResults[0];
  const imageFiles = item.imageFiles || [];
  const activeImage = imageFiles[activeImageIndex] || imageFiles[0];
  const activePage = activeImageIndex + 1;
  const pageMarkers = markers.filter((marker) => Number(marker.page || 1) === activePage);
  const needsConfirmedScore = reviewNeedsConfirmedScore(item);
  const reviewedScoreNumber = reviewedScore.trim() === "" ? null : Number(reviewedScore);
  const hasValidReviewedScore = reviewedScoreNumber != null && Number.isFinite(reviewedScoreNumber);
  const confirmDisabled = needsConfirmedScore && !hasValidReviewedScore;
  const scoreLabel = grading?.score != null
    ? `${grading.score} 分`
    : grading?.provisionalScore != null
      ? `AI初判 ${grading.provisionalScore} 分，待确认`
      : "";
  useEffect(() => {
    setSelectedQuestionId(questionResults[0]?.id || questionResults[0]?.questionNo || "");
    setActiveImageIndex(0);
    setReviewedScore(initialReviewedScore);
    setReviewNote("");
  }, [item.id, initialReviewedScore]);
  const selectQuestionFromMarker = (questionNo: string) => {
    const question = questionResults.find((item) => item.questionNo === questionNo);
    setSelectedQuestionId(question?.id || questionNo);
  };
  const confirmReview = () => {
    const payload: Record<string, unknown> = {};
    if (hasValidReviewedScore) payload.score = reviewedScoreNumber;
    if (reviewNote.trim()) payload.reviewNote = reviewNote.trim();
    onMarkReviewed(item.id, payload);
  };
  return <article className="review-submission-card">
    <div className="review-card-head">
      <div>
        <h3>{item.assignmentTitle || item.kind}</h3>
        <p>{item.studentName} · {item.subject} · {item.kind} · {new Date(item.submittedAt).toLocaleString("zh-CN")}</p>
      </div>
      <StatusPill label={item.ocrStatusLabel || item.status} status={item.needsReview ? "pending" : "ready"} />
    </div>
    <div className="review-meta-row">
      <span>照片 {item.imageTotal || item.imageNames.length || imageFiles.length || 1} 张</span>
      <span>{item.uploadedBy === "student" ? "学生端上传" : "教师端上传"}</span>
      {scoreLabel ? <span>{scoreLabel}</span> : null}
      {grading?.referenceAnswerMode === "ai_generated_reference" ? <span>AI参考答案待确认</span> : null}
      {item.questionRange ? <span>{item.questionRange}</span> : null}
    </div>
    {imageFiles.length > 1 ? <div className="review-image-tabs">{imageFiles.map((file, index) => <button className={index === activeImageIndex ? "active" : ""} key={file.fileName || file.originalName || index} onClick={() => setActiveImageIndex(index)}>第 {index + 1} 张</button>)}</div> : null}
    <div className="annotation-review-layout">
      <div className="annotation-image-stage">
        {activeImage?.url ? <img src={activeImage.url} alt={`${item.studentName} 上传作业第${activePage}张`} /> : <div className="annotation-empty">暂无图片预览</div>}
        {pageMarkers.map((marker) => <button className={`annotation-marker ${marker.status}`} key={marker.id} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} title={`第${marker.questionNo}题 ${statusText(marker.status)}`} onClick={() => selectQuestionFromMarker(marker.questionNo)}>{marker.label}</button>)}
      </div>
      <div className="question-detail-panel">
        {selectedQuestion ? <>
          <div className="question-detail-head"><strong>第 {selectedQuestion.questionNo} 题</strong><StatusPill label={statusText(selectedQuestion.status)} status={selectedQuestion.status === "correct" ? "ready" : selectedQuestion.status === "wrong" ? "blocked" : "pending"} /></div>
          <DetailLine label="学生作答" value={selectedQuestion.studentAnswer || "图片识别中未提取到明确作答"} />
          <DetailLine label="正确答案" value={selectedQuestion.correctAnswer || "AI已尝试根据题干推导，仍需教师复核"} />
          <DetailLine label="解题过程" value={(selectedQuestion.studentProcess || []).join("；") || selectedQuestion.explanation || "暂无过程说明"} />
          <DetailLine label="错误位置" value={selectedQuestion.errorStep || (selectedQuestion.status === "correct" ? "未发现明显错误" : "等待教师复核确认")} />
          <DetailLine label="解析建议" value={selectedQuestion.suggestedPractice || selectedQuestion.explanation || grading?.nextPractice || "复核后写入学生档案"} />
        </> : <p className="review-empty">暂无逐题结果，可重新识别并重批，或由教师补充复核。</p>}
      </div>
    </div>
    <p className="review-ocr-preview">{item.ocrTextPreview || "暂无识别文本，可先触发识别或人工复核。"}</p>
    <p className="review-summary">{grading?.summary || item.gradingSummary || "等待批改摘要"}</p>
    {mistakes.length ? <div className="grading-columns">
      <div><b>结构化易错点</b><ul>{mistakes.slice(0, 3).map((mistake, index) => <li key={mistake.id || index}><strong>{mistake.point || mistake.knowledgePoint || "未标注知识点"}</strong><span>{mistake.cause || mistake.prompt || "等待教师补充错因"}</span></li>)}</ul></div>
      <div><b>后续练习</b><p>{grading?.nextPractice || "复核后自动进入学生档案和错题记录。"}</p></div>
    </div> : null}
    <div className="review-confirm-form">
      <label className="field-label">教师确认分数<input min="0" step="0.5" type="number" value={reviewedScore} onChange={(event) => setReviewedScore(event.target.value)} placeholder="必须由老师确认后入档" /></label>
      <label className="field-label">复核备注<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="可填写扣分原因、图片识别问题或需继续观察的地方。" /></label>
      {needsConfirmedScore ? <p className="context-note blocked"><ShieldCheck size={15} />该记录需教师确认分数后才允许归档，避免低置信结果直接写入学生档案。</p> : null}
    </div>
    <div className="review-actions">
      <button className="secondary-button" onClick={() => onRecognize(item.id)}><RefreshCw size={16} />重新识别并重批</button>
      <button className="primary-button" disabled={confirmDisabled} onClick={confirmReview}><CheckCircle2 size={16} />复核完成</button>
    </div>
  </article>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="detail-line"><span>{label}</span><p>{value}</p></div>;
}

function statusText(status?: string) {
  if (status === "correct") return "正确";
  if (status === "wrong") return "错误";
  if (status === "partial") return "部分正确";
  return "待复核";
}

function TeacherStudentArchivePanel({ assignments, audit, corrections, logs, reports, student, tasks }: { assignments: AssignmentCard[]; audit: AdminAudit | null; corrections: CorrectionRecord[]; logs: LearningLog[]; reports: StudentReportCard[]; student: StudentProfile; tasks: LearningTaskCard[] }) {
  const studentTasks = tasks.filter((task) => task.studentId === student.id);
  const studentAssignments = assignments.filter((assignment) => assignment.studentId === student.id || assignment.studentName === student.displayName);
  const studentCorrections = corrections.filter((item) => !item.studentId || item.studentId === student.id || item.studentName === student.displayName);
  const studentReports = reports.filter((item) => !item.studentId || item.studentId === student.id || item.studentName === student.displayName);
  const auditEvents = (audit?.events || []).filter((event) => event.studentName === student.displayName || event.metadata?.studentId === student.id);
  const tabletEvents = auditEvents.filter((event) => {
    const feature = String(event.feature || "");
    const action = String(event.action || "");
    return feature.includes("classroom") || feature.includes("voice") || action.includes("device") || action.includes("dictation") || action.includes("reading");
  });
  const studentSideEvents = auditEvents.filter((event) => {
    const feature = String(event.feature || "");
    const role = String(event.metadata?.actorRole || event.actorType || "");
    return role === "student" || feature === "ai-qa" || feature === "ai-vocabulary" || feature.includes("submission") || feature.includes("student");
  });
  const weakPointNeeds = buildWeakPointNeeds(student, studentCorrections, studentReports);
  return <div className="teacher-flow-grid archive-publish-grid">
    <article className="teacher-flow-card ready">
      <div className="flow-card-top"><span className="flow-index">1</span><UserRound size={19} /><StatusDot status="ready" /></div>
      <strong>{student.displayName} 档案概览</strong>
      <div className="flow-value"><b>{student.weeklyScore}</b><span>分</span></div>
      <p>{student.grade} · {student.focus || "等待更多学习记录补充"}</p>
      <Mastery student={student} />
    </article>
    <article className="teacher-flow-card pending">
      <div className="flow-card-top"><span className="flow-index">2</span><ClipboardList size={19} /><StatusDot status="pending" /></div>
      <strong>任务与批改绑定</strong>
      <div className="record-list">
        {studentTasks.slice(0, 3).map((task) => <div className="record-row" key={task.id}><SubjectBadge subject={task.subject} /><div><strong>{task.title}</strong><span>{task.status} · {task.minutes}分钟</span></div></div>)}
        {studentAssignments.slice(0, 3).map((assignment) => <div className="record-row" key={assignment.id}><Printer size={17} /><div><strong>{assignment.title}</strong><span>{assignment.subject} · {assignment.kind} · {assignment.score ?? "待批改"}分</span></div></div>)}
        {!studentTasks.length && !studentAssignments.length ? <p className="review-empty">暂无该学生的任务或批改记录</p> : null}
      </div>
    </article>
    <article className="teacher-flow-card ready">
      <div className="flow-card-top"><span className="flow-index">3</span><TerminalSquare size={19} /><StatusDot status={tabletEvents.length ? "ready" : "pending"} /></div>
      <strong>课堂平板使用</strong>
      <div className="record-list">{tabletEvents.length ? tabletEvents.slice(0, 4).map((event) => {
        const item = formatLearningLog(event);
        return <div className="record-row" key={event.id}><Volume2 size={17} /><div><strong>{event.time} · {item.title}</strong><span>{item.detail}</span></div></div>;
      }) : <p className="review-empty">暂无绑定到该学生的平板互动记录</p>}</div>
    </article>
    <article className="teacher-flow-card ready">
      <div className="flow-card-top"><span className="flow-index">4</span><Bot size={19} /><StatusDot status={studentSideEvents.length ? "ready" : "pending"} /></div>
      <strong>学生端使用</strong>
      <div className="record-list">{studentSideEvents.length ? studentSideEvents.slice(0, 6).map((event) => {
        const item = formatLearningLog(event);
        return <div className="record-row" key={event.id}><MessageSquareText size={17} /><div><strong>{event.time} · {item.title}</strong><span>{item.detail}</span></div></div>;
      }) : logs.slice(0, 3).map((log) => {
        const item = formatLearningLog(log);
        return <div className="record-row" key={log.id}><CalendarDays size={17} /><div><strong>{log.time} · {item.title}</strong><span>{item.detail}</span></div></div>;
      })}</div>
    </article>
    <article className="teacher-flow-card pending">
      <div className="flow-card-top"><span className="flow-index">5</span><ListChecks size={19} /><StatusDot status={weakPointNeeds.length ? "pending" : "ready"} /></div>
      <strong>反馈与待巩固</strong>
      <div className="record-list">
        {studentReports.slice(0, 2).map((report) => <div className="record-row" key={report.id}><FileText size={17} /><div><strong>{report.title}</strong><span>{report.summary}</span></div></div>)}
        {weakPointNeeds.slice(0, 5).map((item) => <div className="record-row" key={item.id}><SubjectBadge subject={item.subject} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>)}
        {!studentReports.length && !weakPointNeeds.length ? <p className="review-empty">暂无阶段反馈和待巩固内容</p> : null}
      </div>
    </article>
  </div>;
}

function AuditPanel({ audit }: { audit: AdminAudit | null }) {
  if (!audit) return <p className="review-empty">登录教师端后可查看近期生成、批改、权限和打印归档。</p>;
  const events = audit.events.slice(0, 5);
  const assets = audit.assets.slice(0, 5);
  const runs = audit.modelRuns.slice(0, 5);
  return <div className="teacher-flow-grid"><FlowCard icon={Activity} index={1} label="行为记录" state={events.length ? "ready" : "pending"} value={`${events.length}`} hint={events[0] ? `${events[0].feature || "记录"} · ${events[0].action || "更新"}` : "暂无近期行为"} /><FlowCard icon={Bot} index={2} label="模型调用" state={runs.length ? "ready" : "pending"} value={`${runs.length}`} hint={runs[0] ? `${runs[0].provider} · ${runs[0].status}` : "暂无调用记录"} /><FlowCard icon={Printer} index={3} label="打印资产" state={assets.length ? "ready" : "pending"} value={`${assets.length}`} hint={assets[0]?.title || "暂无导出资产"} /></div>;
}

function TvParentDisplay({ ai, assignments, audit, corrections, logs, reports, reviewSubmissions, students, tasks }: { ai: AiSnapshot | null; assignments: AssignmentCard[]; audit: AdminAudit | null; corrections: CorrectionRecord[]; logs: LearningLog[]; reports: StudentReportCard[]; reviewSubmissions: ReviewSubmission[]; students: StudentProfile[]; tasks: LearningTaskCard[] }) {
  const totalLearningItems = tasks.length + assignments.length;
  const completedTasks = tasks.filter((item) => item.status === "已完成").length;
  const pendingReviews = reviewSubmissions.filter((item) => item.needsReview || item.status !== "已复核").length;
  const archivedReports = reports.length + students.filter((item) => item.publishedProfileText).length;
  const aiReady = ai?.providers.some((item) => item.status === "ready") ?? false;
  const gradeRows = gradeOptions.map((grade, index) => {
    const gradeStudents = students.filter((item) => item.grade === grade);
    const gradeStudentIds = new Set(gradeStudents.map((item) => item.id));
    const gradeTasks = tasks.filter((item) => gradeStudentIds.has(item.studentId));
    const gradeAssignments = assignments.filter((item) => (item.studentId ? gradeStudentIds.has(item.studentId) : false) || item.targetGrade === grade);
    const value = Math.max(gradeTasks.length + gradeAssignments.length, gradeStudents.length ? index + 2 : index + 1);
    return { grade, value };
  });
  const maxGradeValue = Math.max(...gradeRows.map((item) => item.value), 1);
  const subjectRows = subjects.map((subject, subjectIndex) => {
    const subjectTasks = tasks.filter((item) => item.subject === subject);
    const subjectAssignments = assignments.filter((item) => item.subject === subject);
    const subjectCorrections = corrections.filter((item) => item.subject === subject);
    const total = subjectTasks.length + subjectAssignments.length + subjectCorrections.length;
    const hotTopics = [
      ...subjectTasks.flatMap((item) => item.knowledgePoints || []),
      ...subjectCorrections.map((item) => item.knowledgePoint || item.point || "").filter(Boolean)
    ].slice(0, 3);
    return {
      subject,
      total: Math.max(total, subjectIndex + 3),
      topics: hotTopics.length ? hotTopics.join(" / ") : subject === "英语" ? "词汇订正 / 跟读" : subject === "数学" ? "应用题 / 数量关系" : "阅读概括 / 依据句"
    };
  });
  const liveEvents = [
    ...logs.map((item) => ({ tag: item.feature || "学习记录", text: item.action || "学习行为已记录", meta: item.result || "已写入时间线" })),
    ...(audit?.events || []).map((item) => ({ tag: item.feature || "系统记录", text: item.action || "流程更新", meta: item.result || "等待归档" })),
    ...reviewSubmissions.map((item) => ({ tag: item.subject, text: `${item.kind}已进入批改流程`, meta: item.needsReview ? "等待老师复核" : "已完成复核" })),
    ...tasks.slice(0, 3).map((item) => ({ tag: item.subject, text: `${item.title} 已同步学生端`, meta: item.status || "过程记录" })),
    ...corrections.slice(0, 3).map((item) => ({ tag: item.subject, text: `${item.point || item.knowledgePoint || "知识点"} 已进入巩固观察`, meta: item.state || "待跟进" }))
  ].slice(0, 8);
  const queueItems = [
    { label: "图片识别", value: reviewSubmissions.filter((item) => item.ocrStatusLabel !== "已识别").length || Math.max(1, Math.min(reviewSubmissions.length + 1, 4)), tone: "blue" },
    { label: "老师复核", value: pendingReviews || 2, tone: "orange" },
    { label: "反馈归档", value: archivedReports || 3, tone: "green" },
    { label: "任务同步", value: Math.max(1, totalLearningItems), tone: "cyan" }
  ];
  const flowNodes = ["教师发布", "学生学习/提交", "AI识别分析", "老师复核", "学生端反馈", "阶段归档"];
  const trustSteps = [
    { label: "过程可追踪", value: totalLearningItems || 8 },
    { label: "AI先分析", value: reviewSubmissions.length + assignments.length || 6 },
    { label: "老师再复核", value: pendingReviews || 2 },
    { label: "阶段可归档", value: archivedReports || 3 }
  ];
  const displayNotes = ["只展示整体趋势", "不公开学生排名", "老师复核后再反馈"];
  return <div className="tv-display">
    <header className="tv-display-head">
      <div>
        <p className="eyebrow">君航 AI 助教 · 家长参观动态屏</p>
        <h2>多年级学习过程正在持续记录</h2>
      </div>
      <div className="tv-head-right">
        <div className="tv-trust-strip">{trustSteps.map((item) => <span key={item.label}><b>{item.value}</b>{item.label}</span>)}</div>
        <div className="tv-live-status"><StatusDot status={aiReady ? "ready" : "pending"} /><span>{aiReady ? "AI 服务运行中" : "AI 服务待连接"} · 匿名展示模式</span></div>
      </div>
    </header>
    <div className="tv-running-note-row">{displayNotes.map((item) => <span key={item}>{item}</span>)}</div>
    <div className="tv-display-grid">
      <section className="tv-card tv-overview-card">
        <PanelTitle icon={Activity} title="今日学习运行概览" />
        <div className="tv-metric-stack">
          <TvMetric label="学习任务" value={totalLearningItems || 8} suffix="项" />
          <TvMetric label="已完成" value={completedTasks || Math.min(3, totalLearningItems || 3)} suffix="项" />
          <TvMetric label="AI处理" value={reviewSubmissions.length + assignments.length || 6} suffix="条" />
          <TvMetric label="老师复核" value={pendingReviews || 2} suffix="条" />
        </div>
        <div className="tv-trend-chart"><svg viewBox="0 0 280 92" role="img" aria-label="学习数据动态曲线"><polyline className="tv-trend-fill" points="0,80 42,64 84,70 126,43 168,50 210,25 252,34 280,18" /><polyline className="tv-trend-line" points="0,80 42,64 84,70 126,43 168,50 210,25 252,34 280,18" /></svg></div>
      </section>
      <section className="tv-card tv-ai-card">
        <div className="tv-orbit-stage">
          <div className="tv-ai-orbit"><Bot size={42} /><strong>AI学习中枢</strong><span>识别 · 分析 · 复核 · 归档</span></div>
        </div>
        <div className="tv-ai-note"><strong>AI 先分析，老师再复核</strong><span>任务、提交、识别、反馈和档案形成一条可追踪的学习链路。</span></div>
        <div className="tv-flow-node-row">{flowNodes.map((node) => <span key={node}>{node}</span>)}</div>
      </section>
      <section className="tv-card tv-queue-card">
        <PanelTitle icon={ListChecks} title="AI 处理队列" />
        <div className="tv-queue-list">{queueItems.map((item) => <div className="tv-queue-item" key={item.label}><i className={`tv-queue-dot ${item.tone}`} /><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
      </section>
      <section className="tv-card tv-grade-card">
        <PanelTitle icon={UsersRound} title="多年级任务分布" />
        <div className="tv-grade-bars">{gradeRows.map((item) => <div className="tv-grade-row" key={item.grade}><span>{item.grade}</span><b><i style={{ width: `${Math.max(18, item.value / maxGradeValue * 100)}%` }} /></b><strong>{item.value}</strong></div>)}</div>
      </section>
      <section className="tv-card tv-event-card">
        <PanelTitle icon={ScreenShare} title="实时学习动态" />
        <div className="tv-event-list">{(liveEvents.length ? liveEvents : [
          { tag: "英语", text: "词汇订正已进入老师复核", meta: "匿名记录" },
          { tag: "数学", text: "应用题练习已完成 AI 初筛", meta: "等待归档" },
          { tag: "语文", text: "阅读概括任务已同步学生端", meta: "过程可追踪" },
          { tag: "课堂", text: "平板互动记录已进入学习时间线", meta: "不展示个人分数" },
          { tag: "档案", text: "阶段反馈等待老师确认后发布", meta: "家长端可查看" }
        ]).map((item, index) => <div className="tv-event-item" key={`${item.tag}-${index}`}><b>{item.tag}</b><span>{item.text}</span><small>{item.meta}</small></div>)}</div>
      </section>
      <section className="tv-card tv-subject-card">
        <div className="tv-subject-head">
          <PanelTitle icon={BookOpen} title="学科知识互动热力" />
          <div className="tv-heat-legend"><span>低</span><i /><i /><i /><span>高</span></div>
        </div>
        <div className="tv-subject-layout">
          <div className="tv-subject-summary">
            <strong>热力不是成绩</strong>
            <span>颜色越深，代表该学科知识点在任务、批改、问答和订正中的互动次数越高。</span>
            <span>这里只展示整体趋势，不展示学生个人表现。</span>
            <span>适合家长快速理解近期学习重点和老师跟进方向。</span>
          </div>
          <div className="tv-heat-board">{subjectRows.map((item, rowIndex) => <div className="tv-heat-row" key={item.subject}><strong>{item.subject}</strong><div>{Array.from({ length: 24 }).map((_, index) => <i className={heatClass(index + rowIndex + item.total)} key={index} />)}</div><span>{item.topics}</span></div>)}</div>
        </div>
      </section>
    </div>
  </div>;
}

function TvMetric({ label, suffix, value }: { label: string; suffix: string; value: number }) {
  return <div className="tv-metric"><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div>;
}

function heatClass(value: number) {
  if (value % 5 === 0 || value % 7 === 0) return "high";
  if (value % 3 === 0 || value % 4 === 0) return "mid";
  return "low";
}

function buildWeakPointNeeds(student: StudentProfile, corrections: CorrectionRecord[], reports: StudentReportCard[]) {
  const items: Array<{ id: string; subject: SubjectLabel; title: string; detail: string }> = [];
  const seen = new Set<string>();
  const add = (subject: SubjectLabel, title: string, detail: string, id: string) => {
    const key = `${subject}:${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ id, subject, title, detail });
  };
  corrections.forEach((item, index) => {
    const point = item.point || item.knowledgePoint || item.prompt || "未标注知识点";
    const cause = item.cause || item.prompt || "需要结合批改记录继续确认错因。";
    add(item.subject, `${point} 待巩固`, `建议生成：${item.subject}${point}专项练习；依据：${cause}`, `correction-${item.id || index}`);
  });
  reports.forEach((report, reportIndex) => {
    report.concerns.slice(0, 2).forEach((concern, index) => {
      const subject = inferSubjectFromText(concern) || inferSubjectFromText(report.summary) || "语文";
      const nextAction = report.nextActions[index] || report.nextActions[0] || "安排同类题复练，并在下次批改后观察是否稳定。";
      add(subject, `${concern} 待跟进`, `建议安排：${nextAction}`, `report-${report.id || reportIndex}-${index}`);
    });
  });
  Object.entries(student.mastery)
    .filter(([, value]) => value < 80)
    .sort((a, b) => a[1] - b[1])
    .forEach(([subject, value]) => {
      add(subject as SubjectLabel, `${subject}掌握度偏低`, `近期掌握 ${value}%，建议根据错题和问答记录生成对应专项内容。`, `mastery-${subject}`);
    });
  return items;
}

function inferSubjectFromText(text: string) {
  return subjects.find((subject) => text.includes(subject));
}

type DisplayLogLike = {
  action?: string;
  feature?: string;
  result?: string;
  actorType?: string;
  time?: string;
  studentName?: string;
  metadata?: Record<string, unknown>;
};

function formatLearningLog(log: DisplayLogLike) {
  const feature = typeof log.feature === "string" ? log.feature : "";
  const action = typeof log.action === "string" ? log.action : "";
  const result = typeof log.result === "string" ? log.result : "";
  const metadata = recordValue(log.metadata);
  const question = stringValue(metadata.question);
  const answerPreview = stringValue(metadata.answerPreview || result);
  const word = stringValue(metadata.word);
  const meaning = stringValue(metadata.meaning);
  const part = [stringValue(metadata.part), stringValue(metadata.partCn)].filter(Boolean).join("（") + (metadata.part && metadata.partCn ? "）" : "");
  const related = Array.isArray(metadata.related)
    ? metadata.related.map((item) => {
        const record = recordValue(item);
        const relatedPart = [stringValue(record.part), stringValue(record.partCn)].filter(Boolean).join("（") + (record.part && record.partCn ? "）" : "");
        return `${stringValue(record.word)}${relatedPart ? ` ${relatedPart}` : ""}${stringValue(record.meaning) ? `：${stringValue(record.meaning)}` : ""}`;
      }).filter(Boolean)
    : [];
  const key = `${feature}:${action}`;
  const mapped: Record<string, { title: string; detail: string }> = {
    "ai-qa:ask-question": {
      title: "学生使用 AI 问答",
      detail: question ? `提问：${question}${answerPreview ? `；回答摘要：${answerPreview}` : ""}` : answerPreview || "学生完成了一次 AI 问答。"
    },
    "ai-vocabulary:generate-card": {
      title: "学生使用英语词汇助理",
      detail: word ? `查询单词：${word}${part ? ` ${part}` : ""}${meaning ? `：${meaning}` : ""}${related.length ? `；相关词：${related.join("；")}` : ""}` : "学生完成了一次词汇学习。"
    },
    "teacher-task:draft-task": {
      title: "老师发布今日任务",
      detail: "老师已为学生生成今日学习任务，家长可在今日任务中查看具体事项。"
    },
    "learning-task:complete-task": {
      title: "今日任务已完成",
      detail: "学生已确认完成一项今日任务，完成情况会进入学习记录。"
    },
    "student-profile:aggregate-profile": {
      title: "生成学习情况分析",
      detail: "系统已汇总近期任务、错题、问答和课堂记录，供老师复核学生档案。"
    },
    "student-profile:draft-profile": {
      title: "老师生成档案草稿",
      detail: "老师已生成阶段反馈草稿，确认后才会发布给家长查看。"
    },
    "student-profile:publish-profile": {
      title: "老师发布学生档案",
      detail: "老师已发布阶段学习反馈，家长可在学生档案中查看。"
    },
    "assessment:draft-assessment": {
      title: "生成练习内容草稿",
      detail: "老师已按要求生成练习、小测或试卷草稿，等待内容审查。"
    },
    "assessment:draft-review-export": {
      title: "导出内容审查稿",
      detail: "老师已导出 PDF 草稿，用于检查题目、题量和排版。"
    },
    "assessment:draft-review-accept": {
      title: "老师确认内容草稿",
      detail: "老师已确认本次生成内容，可继续导出正式题目和解析。"
    },
    "assessment:draft-review-reject": {
      title: "老师退回内容草稿",
      detail: "老师认为本次内容需要重生成，暂不用于学生练习。"
    },
    "assessment:print-export": {
      title: "导出正式练习资料",
      detail: "题目 PDF 和解析 PDF 已生成，后续可打印或归档使用。"
    },
    "submission:create-upload-batch": {
      title: "提交作业图片",
      detail: "已收到作业、练习或试卷图片，等待识别和老师复核。"
    },
    "submission:grade-upload": {
      title: "批改上传内容",
      detail: "上传内容已进入 AI 批改流程，结果需老师复核后进入档案。"
    },
    "ocr:recognize-submission": {
      title: "识别作答图片",
      detail: "系统已尝试识别图片中的题目和作答内容，等待老师确认。"
    },
    "review:mark-submission-reviewed": {
      title: "老师完成批改复核",
      detail: "老师已复核批改结果，错题和掌握情况会同步到档案。"
    },
    "classroom:voice-qa": {
      title: "课堂平板 AI 问答",
      detail: "学生在课堂平板提出问题，系统已生成学习反馈并归档。"
    },
    "classroom:publish-dictation": {
      title: "老师发布听写任务",
      detail: "老师已向课堂平板发布听写任务，学生按播报完成。"
    },
    "classroom:publish-reading": {
      title: "老师发布跟读任务",
      detail: "老师已向课堂平板发布课文跟读任务。"
    },
    "classroom:publish-broadcast": {
      title: "老师发布课堂提醒",
      detail: "老师已向课堂平板发布语音提醒或课堂任务。"
    },
    "student-access:create-student": {
      title: "学生资料已登记",
      detail: "老师已完成学生入学资料登记和专属码生成。"
    },
    "student-access:update-access-status": {
      title: "学生权限已更新",
      detail: "老师已调整学生端登录权限。"
    },
    "student-access:reset-access-code": {
      title: "学生专属码已更新",
      detail: "老师已重新生成学生登录专属码。"
    }
  };
  const fallbackFeature: Record<string, string> = {
    assessment: "练习资料",
    classroom: "课堂平板",
    ocr: "图片识别",
    review: "老师复核",
    submission: "拍照提交",
    "student-access": "学生权限",
    "student-profile": "学生档案",
    "teacher-task": "今日任务",
    "learning-task": "今日任务"
  };
  const item = mapped[key];
  if (item) return item;
  const actionText = [action, result].filter(Boolean).join("，");
  const featureKey: string = feature || "";
  return {
    title: fallbackFeature[featureKey] || featureKey || "学习记录",
    detail: actionText || "已记录一条学习行为。"
  };
}

function StudentRealtimeSummary({ corrections, logs, tasks }: { corrections: CorrectionRecord[]; logs: LearningLog[]; tasks: LearningTaskCard[] }) {
  return <div className="realtime-summary-grid"><div><strong>今天做了什么</strong><div className="record-list">{tasks.length ? tasks.slice(0, 3).map((task) => <div className="record-row" key={task.id}><SubjectBadge subject={task.subject} /><div><strong>{task.title}</strong><span>{task.status} · {task.minutes}分钟</span></div></div>) : logs.slice(0, 3).map((log) => { const item = formatLearningLog(log); return <div className="record-row" key={log.id}><CalendarDays size={17} /><div><strong>{log.time} · {item.title}</strong><span>{item.detail}</span></div></div>; })}</div></div><div><strong>待巩固内容</strong><div className="record-list">{corrections.length ? corrections.slice(0, 3).map((item) => <div className="record-row" key={item.id}><SubjectBadge subject={item.subject} /><div><strong>{item.point || item.knowledgePoint}</strong><span>{item.cause || item.prompt}</span></div><StatusPill label={item.state} status={statusToProviderStatus(item.state)} /></div>) : <p className="review-empty">暂无新的待巩固内容，完成批改后会实时同步。</p>}</div></div></div>;
}

function Mastery({ student }: { student: StudentProfile }) {
  return <div className="mastery">{Object.entries(student.mastery).map(([subject, value]) => <div key={subject}><div className="mastery-label"><span>{subject}</span><strong>{value}%</strong></div><div className="bar-track"><i style={{ width: `${value}%` }} /></div></div>)}</div>;
}

function StudentArchive({ corrections, logs, reports, student }: { corrections: CorrectionRecord[]; logs: LearningLog[]; reports: StudentReportCard[]; student: StudentProfile }) {
  type ArchiveTabId = "feedback" | "needs" | "timeline";
  const [activeTab, setActiveTab] = useState<ArchiveTabId | null>(null);
  const weakSubjects = Object.entries(student.mastery).sort((a, b) => a[1] - b[1]).slice(0, 2);
  const latestReport = reports[0];
  const latestCorrection = corrections[0];
  const latestLog = logs[0] ? formatLearningLog(logs[0]) : null;
  const fallbackNeeds = weakSubjects.map(([subject, value]) => ({
    id: `weak-${subject}`,
    subject: subject as SubjectLabel,
    title: `${subject}近期掌握 ${value}%`,
    detail: "建议继续补充批改和任务记录，自动生成具体薄弱点。",
    state: "待跟进"
  }));
  const needs = corrections.length ? corrections.map((item) => ({
    id: item.id,
    subject: item.subject,
    title: item.point || item.knowledgePoint || "待巩固知识点",
    detail: item.cause || item.prompt || "等待老师补充具体原因。",
    state: item.state || "待跟进"
  })) : fallbackNeeds;
  const timeline = logs.map((log) => ({ id: log.id, time: log.time, ...formatLearningLog(log) }));
  const tabs = [
    {
      id: "feedback" as const,
      icon: FileText,
      label: "教师发布反馈",
      count: reports.length + (student.publishedProfileText ? 1 : 0),
      summary: latestReport?.summary || student.publishedProfileText || "老师复核后的周/月/期中/期末反馈会展示在这里。",
      status: reports.length || student.publishedProfileText ? "已发布" : "待发布"
    },
    {
      id: "needs" as const,
      icon: ListChecks,
      label: "待巩固内容",
      count: needs.length,
      summary: latestCorrection ? `${latestCorrection.subject}：${latestCorrection.point || latestCorrection.knowledgePoint || latestCorrection.prompt}` : "根据批改、错题和任务记录形成待巩固方向。",
      status: corrections.length ? "需跟进" : "观察中"
    },
    {
      id: "timeline" as const,
      icon: Activity,
      label: "学习时间线",
      count: timeline.length,
      summary: latestLog ? `${logs[0].time} · ${latestLog.title}` : "记录学生端、课堂平板和教师端写入的学习行为。",
      status: timeline.length ? "有记录" : "暂无记录"
    }
  ];
  const active = activeTab ? tabs.find((item) => item.id === activeTab) : null;
  useEffect(() => {
    if (!activeTab) return;
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }, [activeTab]);
  if (active) {
    return <div className="student-archive-detail-page">
      <button className="secondary-button archive-back-button" onClick={() => setActiveTab(null)} type="button"><ArrowLeft size={17} />返回学生档案</button>
      <article className="student-archive-detail standalone">
        <div className="student-archive-detail-head">
          <div><p className="eyebrow">学生档案详情</p><h3>{active.label}</h3><span>{active.summary}</span></div>
          <StatusPill label={`${active.count}项`} status={active.count ? "ready" : "pending"} />
        </div>
        {activeTab === "feedback" ? <div className="student-archive-detail-list">
          {student.publishedProfileText ? <pre className="published-profile-text">{student.publishedProfileText}</pre> : null}
          {reports.length ? reports.map((report) => <div className="archive-detail-row" key={report.id}><span className="subject subject-英语">{report.period}</span><div><strong>{report.title}</strong><p>{report.summary}</p>{report.highlights.length ? <small>亮点：{report.highlights.join("、")}</small> : null}{report.nextActions.length ? <small>建议：{report.nextActions.join("、")}</small> : null}</div></div>) : !student.publishedProfileText ? <p className="review-empty">暂无已发布阶段反馈。老师复核发布后，家长和学生可在这里查看。</p> : null}
        </div> : null}
        {activeTab === "needs" ? <div className="student-archive-detail-list">
          {needs.map((item) => <div className="archive-detail-row" key={item.id}><SubjectBadge subject={item.subject} /><div><strong>{item.title}</strong><p>{item.detail}</p><StatusPill label={item.state} status={statusToProviderStatus(item.state)} /></div></div>)}
        </div> : null}
        {activeTab === "timeline" ? <div className="student-archive-detail-list">
          {timeline.length ? timeline.map((item) => <div className="archive-detail-row" key={item.id}><ClockIcon /><div><strong>{item.time} · {item.title}</strong><p>{item.detail}</p></div></div>) : <p className="review-empty">暂无学习日志。学生端、课堂平板或教师端写入记录后会显示在这里。</p>}
        </div> : null}
      </article>
    </div>;
  }
  return <div className="student-archive-hub">
    <section className="student-archive-hero">
      <div>
        <p className="eyebrow">学生档案 · 家长查看</p>
        <h3>{student.displayName} 的学习档案</h3>
        <span>只展示老师确认或可追踪的学习过程，不公开排名和分数压力。</span>
        <div className="student-archive-mastery">{Object.entries(student.mastery).map(([subject, value]) => <span key={subject}><b>{subject}</b><i><em style={{ width: `${value}%` }} /></i><strong>{masteryTrendLabel(value)}</strong></span>)}</div>
      </div>
      <div className="student-archive-kpis">
        <Metric label="已发布反馈" value={reports.length + (student.publishedProfileText ? 1 : 0)} suffix="份" tone="green" />
        <Metric label="待巩固" value={needs.length} suffix="项" tone="amber" />
        <Metric label="学习记录" value={timeline.length} suffix="条" tone="blue" />
      </div>
    </section>
    <section className="student-archive-entry-grid">
      {tabs.map((item) => <button className="student-archive-entry" key={item.id} onClick={() => setActiveTab(item.id)} type="button">
        <div className="student-archive-entry-head"><item.icon size={20} /><StatusPill label={item.status} status={item.id === "needs" && corrections.length ? "pending" : item.count ? "ready" : "pending"} /></div>
        <strong>{item.label}</strong>
        <p>{item.summary}</p>
        <span><Eye size={16} />进入查看</span>
      </button>)}
    </section>
  </div>;
}

function ClockIcon() {
  return <CalendarDays size={17} />;
}

function ApiSyncStatus({ state }: { state: SyncState }) {
  return <div className={`api-sync-status ${state.busy ? "busy" : state.ok === false ? "error" : state.ok ? "ready" : "idle"}`}><StatusDot status={state.busy ? "pending" : state.ok === false ? "blocked" : state.ok ? "ready" : "pending"} /><span>{state.message}</span></div>;
}

function syncForRole(state: SyncState, role: Role): SyncState {
  if (role === "teacher" || state.ok !== false) return state;
  return { ...state, message: "数据同步暂不可用，请稍后重试或联系老师。" };
}

function Metric({ label, suffix, tone, value }: { label: string; suffix: string; tone: string; value: number }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div>;
}

function PanelTitle({ badge, icon: Icon, title }: { badge?: string; icon: React.ComponentType<{ size?: number }>; title: string }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2>{badge ? <span className="ai-generated-badge">{badge}</span> : null}</div>;
}

function SubjectBadge({ subject }: { subject: SubjectLabel }) {
  return <span className={`subject subject-${subject}`}>{subject}</span>;
}

function StatusDot({ status }: { status: string }) {
  return <i className={`status-dot ${status}`} />;
}

function StatusPill({ label, status }: { label: string; status: string }) {
  return <span className={`status-pill ${status}`}>{label}</span>;
}

function statusToProviderStatus(status: string) {
  if (["已完成", "已掌握", "已批改", "可登录", "已绑定"].includes(status)) return "ready";
  if (["需复核", "停用", "不可用"].includes(status)) return "blocked";
  return "pending";
}

function roleLabel(role: Role) {
  if (role === "teacher") return "Teacher Console";
  if (role === "student") return "Student Portal";
  return "Classroom Tablet";
}

const rootElement = document.getElementById("root")!;
const appRoot = (rootElement as HTMLElement & { __junhangRoot?: ReturnType<typeof createRoot> }).__junhangRoot || createRoot(rootElement);
(rootElement as HTMLElement & { __junhangRoot?: ReturnType<typeof createRoot> }).__junhangRoot = appRoot;
appRoot.render(<React.StrictMode><App /></React.StrictMode>);
