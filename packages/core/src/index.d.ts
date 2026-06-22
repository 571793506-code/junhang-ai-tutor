export type SubjectLabel = "语文" | "数学" | "英语";

export interface EntityBlueprint {
  name: string;
  keyFields: string[];
  relations: string[];
  notes: string;
}

export interface ImportPlanItem {
  sourceRoot: string;
  targetTables: string[];
  steps: string[];
  checks: string[];
}

export interface TeacherProfile {
  id: string;
  displayName: string;
  phone: string;
  role: "主讲老师" | "助教" | "管理员";
  accessCode: string;
  status: "已开通" | "待开通" | "已停用";
}

export interface ClassroomDevice {
  id: string;
  label: string;
  bindingCode: string;
  grade: string;
  className: string;
  teacherId: string;
  teacherName: string;
  status: "已绑定" | "待绑定" | "已停用";
}

export interface StudentProfile {
  id: string;
  displayName: string;
  grade: string;
  school: string;
  className: string;
  textbookVersion: string;
  guardianName: string;
  guardianPhone: string;
  responsibleTeacherId: string;
  responsibleTeacherName: string;
  accessCode: string | null;
  enrollmentStatus: "测试" | "在读" | "暂停" | "已退课";
  loginEnabled: boolean;
  registeredAt: string;
  focus: string;
  weeklyScore: number;
  streak: number;
  mastery: Record<SubjectLabel, number>;
  strengths: string[];
  risks: string[];
  tone: string;
  publishedProfileText?: string;
}

export interface LearningTaskCard {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  subject: SubjectLabel;
  status: "待完成" | "进行中" | "已完成" | "需复核";
  minutes: number;
  dueLabel: string;
  source: string;
  knowledgePoints: string[];
  summary?: string;
  description?: string;
}

export interface ClassroomBroadcast {
  id: string;
  deviceId: string;
  grade: string;
  className: string;
  subject: SubjectLabel;
  title: string;
  content: string;
  voiceText: string;
  status: "待播报" | "已播报" | "已归档";
  createdByTeacherId: string;
}

export interface DictationTask {
  id: string;
  deviceId: string;
  grade: string;
  className: string;
  subject: "语文" | "英语";
  title: string;
  items: string[];
  currentIndex: number;
  difficulty: "基础" | "提高" | "困难";
  repeats: number;
  intervalSeconds: number;
  status: "待开始" | "进行中" | "已完成";
  createdByTeacherId: string;
}

export interface ReadingTask {
  id: string;
  deviceId: string;
  grade: string;
  className: string;
  subject: "语文" | "英语";
  title: string;
  passage: string;
  focusItems: string[];
  supportNote: string;
  status: "待跟读" | "跟读中" | "已完成";
  createdByTeacherId: string;
}

export interface AssignmentCard {
  id: string;
  studentId: string | null;
  studentName: string;
  targetScope: "student" | "grade";
  targetGrade: string | null;
  kind: "练习" | "小测" | "试卷";
  title: string;
  subject: SubjectLabel;
  status: "待完成" | "已提交" | "已批改" | "需复核";
  difficulty: string;
  minutes: number;
  layoutTemplate: string;
  printProfile: {
    paper: string;
    pages: number;
    columns: number;
    answerSpace: string;
    headerFields: string[];
    optimizationNotes: string[];
  };
  specialRequirements: string;
  submissionImageNames: string[];
  score: number | null;
  totalScore: number;
  items: string[];
  grading: {
    summary: string;
    strengths: string[];
    mistakes: string[];
    nextPractice: string;
  } | null;
  draftReviewStatus?: "pending_teacher_review" | "accepted" | "rejected" | null;
  audit?: {
    reviewer?: string;
    status?: "passed" | "needs_teacher_review" | string;
    teacherMessage?: string;
    issues?: string[];
    repairNotes?: string[];
    sectionCounts?: Record<string, number>;
    itemCount?: number;
  } | null;
}

export interface CorrectionRecord {
  id: string;
  studentId?: string;
  studentName?: string;
  subject: SubjectLabel;
  point: string;
  prompt: string;
  studentAnswer: string;
  correctAnswer: string;
  cause: string;
  state: "待订正" | "复习中" | "已掌握";
  knowledgePoint: string;
}

export interface TextbookAssetCard {
  id: string;
  subject: SubjectLabel;
  grade: string;
  edition: string;
  volume: string;
  title: string;
  source: string;
  path?: string;
  relativePath?: string;
  ext?: string;
  size?: number;
  hash?: string;
  updatedAt?: string;
  openWith?: string;
  openable?: boolean;
  chapters?: Array<{
    id: string;
    title: string;
    unit?: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    focusItems?: string[];
    dictationItems?: string[];
    readingSupport?: string;
  }>;
  chapterCount: number;
  importState: string;
}

export interface LearningLog {
  id: string;
  time: string;
  feature: string;
  action: string;
  result: string;
  actorType: "student" | "guardian" | "teacher" | "system";
}

export interface VocabularyEntry {
  term: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  collocations: string[];
  examples: string[];
  pitfalls: string[];
}

export interface SubjectInsight {
  summary: string;
  weakPoints: Array<{
    point: string;
    status: "未掌握" | "掌握不稳" | "需巩固";
    evidence: string;
  }>;
  mastered: string[];
  nextActions: string[];
}

export interface StudentReportCard {
  id: string;
  studentId?: string;
  studentName?: string;
  period: "本周" | "本月" | "期中" | "期末";
  title: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  nextActions: string[];
}

export interface StartupMode {
  id: string;
  label: string;
  description: string;
  demoScope: string[];
  providerPolicy: {
    textProvider: string;
    mediaProvider: string;
    mediaGate: string;
  };
  migrationTargets: string[];
  entityBlueprints: EntityBlueprint[];
  importPlan: Record<string, ImportPlanItem>;
}

export declare const subjects: SubjectLabel[];
export declare const subjectLabels: SubjectLabel[];
export declare const miniProgramSurface: string[];
export declare const entityBlueprints: EntityBlueprint[];
export declare const importPlan: Record<string, ImportPlanItem>;
export declare const startupMode: StartupMode;
export declare const demoTeachers: TeacherProfile[];
export declare const demoClassroomDevices: ClassroomDevice[];
export declare const demoStudents: StudentProfile[];
export declare const demoClassroomBroadcasts: ClassroomBroadcast[];
export declare const demoDictationTasks: DictationTask[];
export declare const demoReadingTasks: ReadingTask[];
export declare const demoTasks: LearningTaskCard[];
export declare const demoAssignments: AssignmentCard[];
export declare const demoCorrectionRecords: CorrectionRecord[];
export declare const demoTextbooks: TextbookAssetCard[];
export declare const demoLearningLogs: LearningLog[];
export declare const demoVocabularyEntries: VocabularyEntry[];
export declare const demoSubjectInsights: Record<SubjectLabel, SubjectInsight>;
export declare const demoStudentReports: StudentReportCard[];

export interface EncodingIssue {
  path: string;
  value: string;
  normalized: string;
  changed: boolean;
  key?: boolean;
}

export interface EncodingInspection {
  ok: boolean;
  issueCount: number;
  issues: EncodingIssue[];
}

export declare function normalizeDisplayText(value: unknown): string;
export declare function normalizeDisplayPayload<T>(value: T): T;
export declare function inspectEncodingPayload(value: unknown, options?: { maxIssues?: number }): EncodingInspection;
export declare function encodingGuardStatus(value: unknown): { ok: boolean; issueCount: number; checkedAt: string };
