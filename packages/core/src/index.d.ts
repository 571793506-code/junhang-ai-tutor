export type SubjectLabel = "语文" | "数学" | "英语";

export declare function validateGradingSourcePackage(
  sourcePackage?: Record<string, unknown>
): { ok: boolean; issues: string[] };

export declare function gradingSourcePackageToAssignmentItems(
  sourcePackage?: Record<string, unknown>
): Array<Record<string, unknown>>;

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
  accessRemovedAt?: string | null;
  canReceiveNewWork: boolean;
  registeredAt: string;
  focus: string;
  weeklyScore: number;
  streak: number;
  mastery: Record<SubjectLabel, number>;
  strengths: string[];
  risks: string[];
  tone: string;
  publishedProfileSnapshot?: Record<string, unknown> | null;
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
  dueAt?: string | null;
  createdAt?: string | null;
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
  gradingSource?: { sourceId: string; version: number; fingerprint: string; questionCount?: number } | null;
  gradingSourceQuestionCount?: number;
  generationContextSummary?: {
    basis: string;
    target: { scope: string | null; studentId: string | null; grade: string | null; subject: SubjectLabel };
    textbook: { assetId: string | null; title: string | null; chapterId: string | null; chapterTitle: string | null };
    knowledgePoints: string[];
    contentContext: { status: string; sourceCount: number; sourceIds: string[] };
    studentSignalCount: number;
    reviewRequired: boolean;
  };
  draftReviewStatus?: "pending_teacher_review" | "accepted" | "rejected" | null;
  draftReviewFeedback?: string | null;
  draftReviewAsset?: {
    id: string;
    title: string;
    url: string;
  } | null;
  finalExportAssets?: {
    studentPaper: {
      id: string;
      title: string;
      url: string;
    } | null;
    answerAnalysis: {
      id: string;
      title: string;
      url: string;
    } | null;
  } | null;
  draftRequest?: {
    targetScope?: "student" | "grade";
    studentId?: string;
    targetGrade?: string;
    subject?: SubjectLabel;
    kind?: string;
    difficulty?: string;
    requirement?: string;
    requestedItemCount?: number;
    contentScope?: string;
    textbookAssetId?: string;
    textbookTitle?: string;
    textbookEdition?: string;
    textbookSeries?: string;
    textbookVolume?: string;
    textbookRegion?: string;
    textbookChapterId?: string;
    textbookChapterTitle?: string;
    generationBasis?: "textbook_reviewed" | "teacher_requirement" | "teacher_requirement_emergency";
    recoveryReason?: string;
  } | null;
  layoutValidation?: {
    version?: string;
    ok: boolean;
    coordinateManifestValid?: boolean;
    plannedPageCount?: number | null;
    htmlPageCount?: number | null;
    pdfPageCount?: number | null;
    measuredPageCount?: number | null;
    pdfGenerated?: boolean;
    measurementOk?: boolean;
    issues?: string[];
  } | null;
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
  editionDisplay?: string;
  curriculumSeries?: string;
  curriculumRegion?: string;
  baselineMatched?: boolean;
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

export declare const ZUNYI_TEXTBOOK_REGION: "贵州遵义";

export type GradeStage = "primary" | "middle";

export interface GradeLevel {
  level: number;
  stage: GradeStage;
  label: string;
}

export declare function normalizeGradeLevel(value?: unknown): GradeLevel | null;
export declare function gradeLevelLabel(value?: unknown): string;

export declare function classifyTextbookBaseline(input?: {
  subject?: string;
  edition?: string;
  series?: string;
  title?: string;
  source?: string;
  path?: string;
}): {
  region: string;
  edition: string;
  series: string;
  displayName: string;
  baselineMatched: boolean;
};

export declare function matchesTextbookEvidenceScope(
  textbook?: Partial<TextbookAssetCard> & {
    assetId?: string;
    series?: string | string[];
    region?: string | string[];
    metadata?: unknown;
  },
  source?: {
    textbookAssetId?: string;
    assetId?: string;
    subject?: string | string[];
    grade?: string | string[];
    edition?: string | string[];
    curriculumSeries?: string | string[];
    series?: string | string[];
    volume?: string | string[];
    curriculumRegion?: string | string[];
    region?: string | string[];
    metadata?: unknown;
  }
): boolean;

export declare function matchesTeacherConfirmedTextbookChapterScope(
  source?: { sourceType?: string; metadata?: unknown },
  chapterId?: string
): boolean;

export declare function matchesTextbookAssetSearch(
  asset?: Partial<TextbookAssetCard> & {
    series?: string | string[];
    region?: string | string[];
    metadata?: unknown;
  },
  search?: string
): boolean;

export declare function chapterDraftsForTextbookAsset(asset?: Partial<TextbookAssetCard>): NonNullable<TextbookAssetCard["chapters"]>;

export declare function mergeTextbookChapterDrafts(
  asset?: Partial<TextbookAssetCard>,
  existingChapters?: NonNullable<TextbookAssetCard["chapters"]>
): NonNullable<TextbookAssetCard["chapters"]>;

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
  reportType?: "midterm" | "final";
  periodLabel?: string;
  status?: string;
  statusRaw?: string;
  sentManuallyAt?: string | null;
  pdfUrl?: string | null;
  pdfTitle?: string | null;
  pdfAssetId?: string | null;
  wechatMessage?: string;
  teacherEditedText?: string;
  draft?: Record<string, unknown>;
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

export type ModuleCapabilityId =
  | "generation"
  | "grading"
  | "teaching-materials"
  | "student-profile";

export interface ModuleCapabilityDefinition {
  moduleId: ModuleCapabilityId;
  triggers: string[];
  dependencies: string[];
  requestContract: {
    requiredFields: string[];
    optionalFields: string[];
    serverDerivedFields: string[];
    forbiddenClientFields: string[];
  };
  resultContract: {
    teacherVisibleFields: string[];
    studentVisibleFields: string[];
    internalOnlyFields: string[];
  };
  modelPolicy: {
    primaryTask: string;
    primaryRoute: string;
    supportRoutes: string[];
    defaultReasoning: Record<string, string>;
    escalation: {
      allowedTriggerClasses: string[];
      blockedTriggerClasses: string[];
      maxAttemptsPerUnit: number;
    };
  };
  reviewGate: "instant_safe_response" | "teacher_review" | "teacher_confirmation" | "blocked";
  verification: {
    tests: string[];
    commands: string[];
  };
}

export interface ModuleCapabilityStatus {
  schemaVersion: "junhang-module-capability-v1";
  generatedAt: string;
  capabilities: Array<{
    moduleId: ModuleCapabilityId;
    status: "available" | "draft" | "review_required" | "blocked" | "failed";
    dependencyStatus: "ready" | "review_required" | "blocked";
    reviewGate: ModuleCapabilityDefinition["reviewGate"];
    teacherMessage: string;
    verification: ModuleCapabilityDefinition["verification"];
  }>;
}

export declare const MODULE_CAPABILITY_SCHEMA_VERSION: "junhang-module-capability-v1";
export declare const moduleCapabilityCatalog: readonly ModuleCapabilityDefinition[];
export declare function listModuleCapabilities(): ModuleCapabilityDefinition[];
export declare function getModuleCapability(moduleId: ModuleCapabilityId): ModuleCapabilityDefinition | undefined;
export declare function validateModuleCapabilityRegistry(
  registry?: ModuleCapabilityDefinition[] | readonly ModuleCapabilityDefinition[]
): { ok: boolean; issues: string[] };
export declare function normalizeTeachingPurpose(input?: Record<string, unknown>): {
  purpose: "comprehensive" | "focused" | "multi_day" | "explanation";
  requestedItemTypes: string[];
  dayPlan: Array<{ dayId: string; goal: string; requestedItemTypes: string[]; requestedItemCount: number }>;
};
export type TeachingWorkflowType = "generation" | "grading";
export declare function teachingExplanationContent(value: unknown): Record<string, unknown> | null;
export declare function applyWorkflowPatch(snapshot?: Record<string, unknown>, patch?: Record<string, unknown>): {
  snapshot: Record<string, unknown>; affectedQuestionIds: string[]; affectedExplanation?: boolean;
};
export declare function normalizeTeachingWorkflow(input?: Record<string, unknown>): {
  workflowId: string; ownerTeacherId: string; type: TeachingWorkflowType; revision: number; operationKey: string; snapshot: Record<string, unknown>;
};
export function allocateAssessmentScores(types: string[], input?: { subject?: string; kind?: string }): number[];
export function assessmentScoreIssues(item?: { prompt?: unknown; score?: number; metadata?: { score?: number }; rubric?: unknown; itemType?: string }): string[];
export function normalizeAssessmentOptions(value: unknown): string[];
export function normalizeAssessmentAnswerFormat(value: unknown): unknown;
export function assessmentChoiceOptionsValid(value: unknown): boolean;
