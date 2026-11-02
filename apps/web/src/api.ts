import type {
  AssignmentCard,
  ClassroomBroadcast,
  ClassroomDevice,
  CorrectionRecord,
  DictationTask,
  LearningLog,
  LearningTaskCard,
  ModuleCapabilityStatus,
  ReadingTask,
  StudentProfile,
  StudentReportCard,
  TextbookAssetCard,
  TeacherProfile
} from "@junhang/core";
import { normalizeDisplayPayload } from "@junhang/core";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";
const SESSION_TOKEN_KEY = "junhang.web.sessionToken";

function getSessionToken() {
  return window.localStorage.getItem(SESSION_TOKEN_KEY) || "";
}

export function setSessionToken(token?: string) {
  if (token) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    clearSessionToken();
  }
}

export function clearSessionToken() {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

function jsonHeaders() {
  const token = getSessionToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text || response.statusText };
  }
  if (response.status === 401 || response.status === 403) {
    clearSessionToken();
  }
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText;
    throw new Error(message);
  }
  return normalizeDisplayPayload(body) as T;
}

export async function getApiStatus() {
  const token = getSessionToken();
  const response = await fetch(`${API_BASE_URL}${token ? "/api/ai/status" : "/api/status"}`, {
    headers: token ? authHeaders() : undefined
  });
  const body = await readJson<{
    ok: boolean;
    database?: { ok: boolean; reason: string };
    ai: {
      features: Array<{
        id: string;
        label: string;
        appSurface: string;
        status: "ready" | "blocked" | "unavailable";
        reason: string;
      }>;
      generatedAt: string;
      mode: string;
    };
    capabilities?: ModuleCapabilityStatus;
  }>(response);
  return {
    ...body,
    ai: {
      ...body.ai,
      features: body.ai.features
    },
    capabilities: body.capabilities || null
  };
}

export async function getBootstrapData() {
  const response = await fetch(`${API_BASE_URL}/api/bootstrap`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    generatedAt: string;
    teachers: TeacherProfile[];
    students: StudentProfile[];
    tasks: LearningTaskCard[];
    assignments: AssignmentCard[];
    classroomDevices: ClassroomDevice[];
    classroomBroadcasts: ClassroomBroadcast[];
    dictationTasks: DictationTask[];
    readingTasks: ReadingTask[];
    corrections: CorrectionRecord[];
    logs: LearningLog[];
    reports: StudentReportCard[];
  }>(response);
}

export async function askStudentQuestion(input: {
  question: string;
  studentId?: string;
  studentName?: string;
  subject?: string;
  deviceId?: string;
  context?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/api/ai/qa`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    result: {
      available: boolean;
      mode: "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";
      answer: string;
    };
  }>(response);
}

export type StudentDictionaryEntry = {
  schemaVersion: "student-dictionary-entry-v1";
  headword: string;
  phonetic: string;
  queryRelation: { term: string; headword: string; type: string; label: string };
  parts: Array<{ part: string; partCn: string; meanings: string[] }>;
  forms: Array<{ term: string; type: string; label: string }>;
  wordFamily: Array<{ word: string; partCn: string; meaning: string }>;
  synonyms: Array<{ word: string; meaning: string; difference: string }>;
  antonyms: Array<{ word: string; meaning: string }>;
  collocations: Array<{ phrase: string; meaning: string }>;
  examples: Array<{ sentence: string; translation: string }>;
  usageNotes: string[];
  pitfalls: string[];
};

export type AssessmentLayoutValidation = {
  version: "assessment-layout-validation-v1";
  ok: boolean;
  coordinateManifestValid: boolean;
  plannedPageCount: number | null;
  htmlPageCount: number | null;
  pdfPageCount: number | null;
  measuredPageCount: number | null;
  pdfGenerated: boolean;
  measurementOk: boolean;
  issues: string[];
};

export type AssessmentGenerationJob = {
  id: string;
  kind: string;
  subject: string;
  title: string;
  targetLabel: string;
  request: Record<string, unknown>;
  status: "queued" | "generating" | "exporting_draft" | "cancelling" | "ready_for_review" | "failed" | "cancelled";
  message: string;
  assignmentId: string | null;
  draftAsset: { id: string; title: string; url: string } | null;
  layoutValidation: AssessmentLayoutValidation | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export async function queryStudentDictionary(word: string) {
  const response = await fetch(`${API_BASE_URL}/api/student/dictionary/query`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ word })
  });
  return readJson<{ ok: true; result: { entry: StudentDictionaryEntry } }>(response);
}

export async function registerStudent(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/students`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    student: { id: string };
    accessCode: string;
    codePreview: string;
  }>(response);
}

export async function resetStudentAccessCodeApi(studentId: string, input: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/reset-access-code`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    student: { id: string };
    accessCode: string;
    codePreview: string;
  }>(response);
}

export async function updateStudentAccessStatusApi(studentId: string, input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/access-status`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    student: { id: string; enrollmentStatus: string; loginEnabled: boolean };
  }>(response);
}

export async function updateStudentProfileApi(studentId: string, input: { grade: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    student: StudentProfile;
    historyRetained: boolean;
  }>(response);
}

export async function removeStudentAccessApi(studentId: string, confirmationName: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/access`, {
    method: "DELETE",
    headers: jsonHeaders(),
    body: JSON.stringify({ confirmationName })
  });
  return readJson<{ ok: boolean; student: StudentProfile; historyRetained: boolean }>(response);
}

export async function aggregateStudentProfile(studentId: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/aggregate`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: boolean;
    student: StudentProfile;
    snapshot: Record<string, unknown>;
    publishGate: { ok: boolean; blockers: string[]; excludedEvidenceRefs: string[] };
  }>(response);
}

export async function draftStudentProfile(studentId: string, periodType: "weekly" | "monthly" = "weekly") {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/draft`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ periodType })
  });
  return readJson<{
    ok: boolean;
    student: StudentProfile;
    snapshot: Record<string, unknown>;
    publishGate: { ok: boolean; blockers: string[]; excludedEvidenceRefs: string[] };
  }>(response);
}

export async function publishStudentProfile(studentId: string, snapshot: Record<string, unknown>, text?: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/publish`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ snapshot, text, confirmTeacherReview: true })
  });
  return readJson<{
    ok: boolean;
    student: StudentProfile;
    snapshot: Record<string, unknown>;
    publishGate: { ok: boolean; blockers: string[]; excludedEvidenceRefs: string[] };
  }>(response);
}

export async function generateStudentProfilePrint(studentId: string, input: { snapshot: Record<string, unknown>; text?: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/print`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ ...input, confirmTeacherReview: true })
  });
  return readJson<{
    ok: boolean;
    snapshot: Record<string, unknown>;
    asset: { id: string; url: string; title: string };
  }>(response);
}

export type TermReportType = "midterm" | "final";

export async function draftStudentTermReport(studentId: string, input: { reportType: TermReportType; periodLabel?: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/draft`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; report: StudentReportCard }>(response);
}

export async function generateStudentTermReportPdf(studentId: string, reportId: string, input: { teacherText: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/${reportId}/pdf`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; report: StudentReportCard; asset: { id: string; url: string; title: string } }>(response);
}

export async function markStudentTermReportSent(studentId: string, reportId: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-report/${reportId}/mark-sent`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{ ok: boolean; report: StudentReportCard }>(response);
}

export async function listStudentTermReports(studentId: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/term-reports`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; reports: StudentReportCard[] }>(response);
}

export async function loginStudent(input: { displayName: string; guardianPhone: string; accessCode: string }) {
  const response = await fetch(`${API_BASE_URL}/api/student-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    sessionToken?: string;
    student: { id: string; displayName: string; grade: string; className: string };
  }>(response);
}

export async function loginTeacher(input: { name: string; phone?: string; accessCode: string }) {
  const response = await fetch(`${API_BASE_URL}/api/teacher-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; sessionToken?: string; teacher: { id: string; displayName: string; phone: string; role: string; status: string } }>(response);
}

export async function loginClassroom(input: { bindingCode: string }) {
  const response = await fetch(`${API_BASE_URL}/api/classroom/device-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; sessionToken: string; device: ClassroomDevice }>(response);
}

export type GradingSourceReference = { sourceId: string; version: number; fingerprint: string; questionCount?: number };
export type GenerationContextSummary = {
  basis: string;
  target: { scope: string | null; studentId: string | null; grade: string | null; subject: string };
  textbook: { assetId: string | null; title: string | null; chapterId: string | null; chapterTitle: string | null };
  knowledgePoints: string[];
  contentContext: { status: string; sourceCount: number; sourceIds: string[] };
  studentSignalCount: number;
  reviewRequired: boolean;
};
export type AssessmentGenerationResult = {
  available: boolean;
  draftText?: string;
  parsedDraft?: Record<string, unknown> | null;
  draftItems?: Array<Record<string, unknown>>;
  audit?: Record<string, unknown> | null;
  generationPipeline?: Record<string, unknown> | null;
  generationContext?: Record<string, unknown> | null;
  contentContext?: Record<string, unknown> | null;
  persisted?: { modelRunId?: string | null; assignmentId?: string | null };
};

export async function draftAssessment(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/draft`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    persistence: { active: boolean; reason: string };
    result: AssessmentGenerationResult;
  }>(response);
}

export async function previewAssessmentContentContext(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/content/context/preview`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    context: {
      status: string;
      reason: string | null;
      approvedOnly: boolean;
      sourceCount: number;
      sourceIds: string[];
      matchedCount: number;
      textbookContext: Record<string, unknown>;
      matches: Array<Record<string, unknown>>;
    };
  }>(response);
}

export async function createAssessmentGenerationJob(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/generation-jobs`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; job: AssessmentGenerationJob }>(response);
}

export type AssessmentGenerationRecovery = {
  status: "ready" | "review_required";
  message: string;
  steps: Array<{ id: string; status: "completed" | "failed" | "skipped"; message: string }>;
  failure: { error: string; message: string } | null;
  temporaryDraftAllowed: boolean;
};

export async function recoverAssessmentGenerationContext(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/generation-recovery`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; recovery: AssessmentGenerationRecovery }>(response);
}

export async function listAssessmentGenerationJobs() {
  const response = await fetch(`${API_BASE_URL}/api/assessments/generation-jobs`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; jobs: AssessmentGenerationJob[] }>(response);
}

export async function cancelAssessmentGenerationJob(jobId: string) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/generation-jobs/${jobId}/cancel`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{ ok: boolean; job: AssessmentGenerationJob }>(response);
}

export async function exportAssessmentDraft(assignmentId: string) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/${assignmentId}/draft-export`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: boolean;
    reviewStatus: string;
    asset: { id: string; url: string; title: string; kind?: string };
    layoutValidation: AssessmentLayoutValidation;
  }>(response);
}

export type TeachingExplanation = {
  concept: string; steps: string[]; workedExamples: Array<{ prompt: string; answer: unknown; analysisSteps: string[] }>;
  commonMistakes: string[]; reviewedByTeacher?: boolean;
};
export type TeachingQuestion = {
  id: string; questionNo: string; prompt: string; answer: unknown; score: number; rubric: unknown;
  analysisSteps: string[]; knowledgePoint: string; commonMistake: string; reviewedByTeacher?: boolean;
  options?: string[]; sharedMaterialId?: string; dayId?: string; [key: string]: unknown;
};
export type TeachingWorkflowSummary = { id: string; module: "generation" | "grading"; revision: number; status: string; request: Record<string, unknown>;
  reviewStatus?: "teacher_confirmed" | "review_required";
  archive?: { id: string; workflowId: string; revision: number; status: "archived" } | null };
export type TeachingWorkflowView = TeachingWorkflowSummary & {
  content: { title?: string; purpose?: string; questions: TeachingQuestion[]; explanation?: TeachingExplanation;
    sharedMaterials: Array<{ id: string; title?: string; text: string }>; days: Array<{ dayId: string; goal: string; questionCount: number }> };
  issues: Array<{ code: string; message: string }>;
};
export type TeachingWorkflowCommand = {
  action: "revise" | "confirm" | "restore" | "cancel"; operationKey: string; expectedRevision: number;
  targetQuestionIds?: string[]; targetExplanation?: true; instruction?: string; patch?: Record<string, unknown>; restoreRevision?: number;
};

// Keep machine-readable conflicts for the editor, but never render raw server errors.
async function teachingWorkflowRequest<T>(suffix: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/teaching/workflows${suffix}`, {
      method: body === undefined ? "GET" : "POST", headers: jsonHeaders(), redirect: "error", signal: AbortSignal.timeout(300000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch { throw Object.assign(new Error("暂未收到操作结果，请刷新任务核对，避免重复提交。"), { code: "WORKFLOW_CONNECTION_FAILED" }); }
  let data: any;
  try { data = await response.json(); } catch {
    const unavailable = response.status === 404 || response.status === 503;
    throw Object.assign(new Error(unavailable ? "持续编辑服务暂未启用，可继续使用原有生成与打印。" : "服务暂不可用，请稍后检查任务。"),
      { code: "WORKFLOW_RESPONSE_INVALID", status: response.status, unavailable });
  }
  if (!response.ok || data?.ok !== true) {
    const code = typeof data?.error === "string" && /^(WORKFLOW_|SESSION_)[A-Z_]+$/.test(data.error) ? data.error : "WORKFLOW_REQUEST_FAILED";
    const unavailable = response.status === 503 && data?.error === "WORKFLOW_UNAVAILABLE" || response.status === 404 && !data?.error;
    throw Object.assign(new Error(response.status === 409 && code === "WORKFLOW_EVIDENCE_CHANGED"
      ? "来源依据（如错题、教材或作答记录）已变化。你的本地编辑仍保留，旧版本和已有确认可查看。刷新不会更新旧草稿的依据；请核对当前依据后，决定是否另建任务并重新复核。"
      : response.status === 409 ? "版本或操作状态已变化。你的编辑已保留，请刷新后比较。"
      : unavailable ? "持续编辑服务暂未启用，可继续使用原有生成与打印。"
      : response.status === 401 || response.status === 403 ? "当前登录无权操作，请重新登录或检查权限。"
      : "操作未完成，请检查教学条件、内容完整性和教师确认状态。"), { code, status: response.status, unavailable });
  }
  return normalizeDisplayPayload(data) as T;
}
export const listTeachingWorkflows = (module: "generation" | "grading" = "generation") => teachingWorkflowRequest<{ workflows: TeachingWorkflowSummary[] }>(`?module=${module}`);
export const createTeachingWorkflow = (input: { requestKey: string; module: "generation"; request: Record<string, unknown> }) => teachingWorkflowRequest<{ workflow: TeachingWorkflowView }>("", input);
export const getTeachingWorkflow = (id: string, revision?: number) => teachingWorkflowRequest<{ workflow: TeachingWorkflowView }>(`/${encodeURIComponent(id)}${revision ? `/revisions/${revision}` : ""}`);
export const executeTeachingWorkflow = (id: string, command: TeachingWorkflowCommand) => teachingWorkflowRequest<{ workflow: TeachingWorkflowView }>(`/${encodeURIComponent(id)}/commands`, command);
export const publishTeachingAssignment = (id: string, expectedRevision: number) => teachingWorkflowRequest<{ assignment: { id: string; revision: number; replayed: boolean } }>(`/${encodeURIComponent(id)}/assignment`, { expectedRevision });

export type GradingWorkflowQuestion = {
  id: string; questionNo: string; printedPrompt?: string; prompt?: string; studentAnswer: unknown; correctAnswer: unknown;
  status: "correct" | "wrong" | "partial" | "uncertain"; score: number | null; maxScore: number | null;
  explanation: string; knowledgePoint?: string; rubric?: unknown; analysisSteps?: string[]; errorStep?: string;
  suggestedPractice?: string; teacherNote?: string; reviewedByTeacher?: boolean; recognitionCorrectedByTeacher?: boolean;
  confidence?: number; page?: number; sourceImageRef?: string; cropRef?: string;
  bbox?: { page: number; x: number; y: number; w: number; h: number };
};
export type GradingWorkflowPage = { pageNumber: number; imageUrl: string | null; fileName: string; imageRefs: string[]; cropRef?: string | null; qualityStatus: string };
export type GradingWorkflowView = TeachingWorkflowSummary & {
  content: { title?: string; questions: GradingWorkflowQuestion[]; pages?: GradingWorkflowPage[];
    gradingSummary?: { score: number | null; confirmedScore: number | null; totalScore: number | null; unresolvedCount: number; confirmedCount: number } };
  issues: Array<{ code: string; message: string }>;
};
export const createGradingWorkflow = (requestKey: string, request: Record<string, unknown>) => teachingWorkflowRequest<{ workflow: GradingWorkflowView }>("", { module: "grading", requestKey, request });
export const getGradingWorkflow = (id: string, revision?: number) => teachingWorkflowRequest<{ workflow: GradingWorkflowView }>(`/${encodeURIComponent(id)}${revision ? `/revisions/${revision}` : ""}`);
export const executeGradingWorkflow = (id: string, command: TeachingWorkflowCommand) => teachingWorkflowRequest<{ workflow: GradingWorkflowView }>(`/${encodeURIComponent(id)}/commands`, command);
export async function archiveTeachingGrading(id: string, expectedRevision: number) {
  const result = await teachingWorkflowRequest<{ archive: { id: string; workflowId: string; revision: number; currentRevision: number; status: string; replayed: boolean } }>(`/${encodeURIComponent(id)}/archive`, { expectedRevision });
  const a = result.archive;
  if (!a?.id || a.workflowId !== id || a.revision !== expectedRevision || a.currentRevision < a.revision || a.status !== "archived") throw new Error("归档结果尚未确认，请刷新核对。");
  return a;
}
export function teachingImageUrl(value?: string | null) {
  if (!value) return "";
  try {
    const apiBase = new URL(API_BASE_URL, window.location.origin);
    const url = new URL(value, apiBase);
    // Historical local uploads belong to this API deployment. Resolve only
    // their display URL; keep stored evidence and external resources intact.
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && url.port === "8787" && url.pathname.startsWith("/uploads/")
      && !url.username && !url.password && ["http:", "https:"].includes(url.protocol)) {
      return new URL(`${url.pathname}${url.search}${url.hash}`, apiBase).href;
    }
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export async function reviewAssessmentDraft(assignmentId: string, decision: "accept" | "reject", feedback?: string) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/${assignmentId}/draft-review`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ decision, feedback })
  });
  return readJson<{
    ok: boolean;
    reviewStatus: "accepted" | "rejected";
    assignmentId: string;
  }>(response);
}

export async function exportAssessmentPrint(assignmentId: string) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/${assignmentId}/print-export`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: boolean;
    asset: { id: string; url: string; title: string };
    analysisAsset?: { id: string; url: string; title: string };
    assets?: Array<{ id: string; url: string; title: string; kind?: string }>;
  }>(response);
}

export async function draftTeacherTask(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/teacher/tasks`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    persistence: { active: boolean; reason: string };
    result: {
      available: boolean;
      draftText: string;
      persisted?: { modelRunId?: string | null; learningTaskId?: string | null };
    };
  }>(response);
}

export async function completeLearningTask(taskId: string, input: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/complete`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; task: LearningTaskCard }>(response);
}

export async function uploadSubmission(input: {
  assignmentId?: string;
  materialType?: "external_workbook" | "generated_assessment";
  answerSourceMode?: "teacher_confirmed" | "teacher_selected_reference" | "model_draft" | "missing";
  answerKeyText?: string;
  referenceSourceId?: string;
  studentId: string;
  subject: string;
  title?: string;
  kind?: string;
  grade?: string;
  difficulty?: string;
  ocrText?: string;
  ocrStatus?: string;
  manualText?: string;
  ocrConfidence?: number;
  pageNumber?: number | string;
  questionRange?: string;
  uploadedBy: "student" | "teacher";
  images: File[];
}) {
  const form = new FormData();
  if (input.assignmentId) form.set("assignmentId", input.assignmentId);
  if (input.materialType) form.set("materialType", input.materialType);
  if (input.answerSourceMode) form.set("answerSourceMode", input.answerSourceMode);
  if (input.answerKeyText) form.set("answerKeyText", input.answerKeyText);
  if (input.referenceSourceId) form.set("referenceSourceId", input.referenceSourceId);
  form.set("studentId", input.studentId);
  form.set("subject", input.subject);
  form.set("title", input.title || "图片提交");
  if (input.kind) form.set("kind", input.kind);
  if (input.grade) form.set("grade", input.grade);
  if (input.difficulty) form.set("difficulty", input.difficulty);
  form.set("ocrText", input.ocrText || "");
  if (input.ocrStatus) form.set("ocrStatus", input.ocrStatus);
  if (input.manualText) form.set("manualText", input.manualText);
  if (input.ocrConfidence != null) form.set("ocrConfidence", String(input.ocrConfidence));
  if (input.pageNumber != null) form.set("pageNumber", String(input.pageNumber));
  if (input.questionRange) form.set("questionRange", input.questionRange);
  form.set("uploadedBy", input.uploadedBy);
  for (const image of input.images) form.append("images", image);

  const response = await fetch(`${API_BASE_URL}/api/submissions/grade`, {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  return readJson<{
    ok: boolean;
    persistence: { active: boolean; reason: string };
    uploadedFiles: Array<{ fileName: string; originalName: string; path: string }>;
    result: {
      available: boolean;
      queued?: boolean;
      gradingText?: string;
      persisted?: {
        modelRunId?: string | null;
        submissionId?: string | null;
        gradingResultId?: string | null;
      };
    };
  }>(response);
}

export async function publishClassroomBroadcast(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/classroom/broadcasts`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; broadcast: { id: string } }>(response);
}

export async function publishDictation(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/classroom/dictation`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; result: { persisted?: { dictationTaskId?: string | null } } }>(response);
}

export async function publishReading(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/classroom/reading`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; task: { id: string } }>(response);
}

export async function setClassroomDeviceLock(deviceId: string, unlocked: boolean, unlockedBy = "teacher") {
  const response = await fetch(
    `${API_BASE_URL}/api/classroom/devices/${deviceId}/${unlocked ? "unlock" : "lock"}`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ unlockedBy })
    }
  );
  return readJson<{ ok: boolean; device: { id: string } }>(response);
}

export async function askClassroomVoice(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/classroom/voice-qa`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    result: {
      available: boolean;
      mode: "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";
      transcript: string;
      answer: string;
      voice: { available: boolean; status?: string; audioUrl?: string | null; reason?: string | null };
    };
  }>(response);
}

export async function listReviewSubmissions() {
  const response = await fetch(`${API_BASE_URL}/api/review/submissions`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    submissions: Array<{
      id: string;
      assignmentId: string;
      assignmentTitle: string;
      studentId: string;
      studentName: string;
      subject: string;
      kind: string;
      status: string;
      needsReview: boolean;
      imageNames: string[];
      imageFiles?: Array<{ fileName: string; originalName: string; path: string; relativePath?: string; url?: string }>;
      uploadedBy: string;
      batchId: string | null;
      imageIndex?: number | null;
      imageTotal?: number | null;
      pageNumber?: number | null;
      questionRange?: string;
      ocr?: {
        status: string;
        text?: string | null;
        manualText?: string | null;
        confidence?: number | null;
        pageNumber?: number | null;
        questionRange?: string | null;
        imageIndex?: number | null;
        imageTotal?: number | null;
        source?: string;
        engine?: string | null;
        reviewed?: boolean;
      };
      ocrStatusLabel?: string;
      ocrTextPreview?: string;
      gradingSummary: string;
      structuredGrading?: {
        score: number | null;
        provisionalScore?: number | null;
        summary: string;
        strengths: string[];
        mistakes: Array<{
          id?: string;
          subject?: string;
          point?: string;
          knowledgePoint?: string;
          prompt?: string;
          studentAnswer?: string;
          correctAnswer?: string;
          cause?: string;
          severity?: string;
          nextAction?: string;
        }>;
        questionResults?: Array<{
          id?: string;
          questionNo: string;
          status: "correct" | "wrong" | "partial" | "uncertain";
          studentAnswer?: string;
          correctAnswer?: string;
          studentProcess?: string[];
          errorStep?: string;
          explanation?: string;
          knowledgePoint?: string;
          suggestedPractice?: string;
          confidence?: number;
          bbox?: { page: number; x: number; y: number; w: number; h: number };
        }>;
        annotationMarkers?: Array<{
          id: string;
          questionNo: string;
          status: "correct" | "wrong" | "partial" | "uncertain";
          page: number;
          x: number;
          y: number;
          w: number;
          h: number;
          label: string;
        }>;
        nextPractice: string;
        reviewStatus: string;
        aiGenerated: boolean;
        needsTeacherReview: boolean;
        archiveEligible?: boolean;
        referenceAnswerMode?: string;
        quality?: {
          lowConfidence?: boolean;
          uncertainCount?: number;
          totalQuestions?: number;
          uncertainRatio?: number;
          averageConfidence?: number;
          reason?: string;
        } | null;
      };
      submittedAt: string;
    }>;
  }>(response);
}

export type ExternalGradingAnswerSource = {
  mode: "teacher_confirmed" | "teacher_selected_reference" | "model_draft" | "missing" | "gradingSourcePackage" | "referenceAnswers";
  status: "confirmed" | "needs_teacher_review" | "missing" | "available" | "draft";
  answers: Record<string, string>;
};

export type ExternalGradingRecognitionPacket = {
  schemaVersion: "external-grading-recognition-v1";
  materialType: "external_workbook";
  gradingStatus: "needs_teacher_review" | "teacher_confirmed";
  archiveEligible: boolean;
  archiveBlockers: string[];
  answerSource: ExternalGradingAnswerSource;
  pages: Array<{
    pageNumber: number;
    fileName: string;
    imageUrl: string | null;
    quality: { status: string; score: number | null; issues: string[]; warnings: string[] };
    questions: Array<{
      id: string;
      questionNo: string;
      printedPrompt: string;
      studentAnswer: string;
      correctAnswer: string;
      recognitionConfidence: number | null;
      recognitionStatus: "confirmed" | "needs_teacher_review" | "unreadable";
      recognition: { originalPrintedPrompt: string; originalStudentAnswer: string };
      review: { reviewedByTeacher: boolean; reviewedAt: string | null; teacherNote: string };
    }>;
  }>;
};

export type GradingWorkbench = {
  id: string;
  submissionId: string;
  assignmentId: string;
  title: string;
  studentId: string;
  studentName: string;
  subject: string;
  kind: string;
  materialType: "external_workbook" | "generated_assessment";
  status: string;
  workflowState: "draft" | "review_required" | "blocked" | "failed" | "archived";
  score: number | null;
  provisionalScore?: number | null;
  needsTeacherReview: boolean;
  archiveEligible: boolean;
  archiveBlockers: string[];
  answerSource?: ExternalGradingAnswerSource | null;
  recognitionPacket?: ExternalGradingRecognitionPacket | null;
  ocrStatusLabel: string;
  quality?: {
    lowConfidence?: boolean;
    uncertainCount?: number;
    totalQuestions?: number;
    uncertainRatio?: number;
    averageConfidence?: number;
    reason?: string;
  } | null;
  referenceAnswerMode?: string;
  summary: string;
  pages: Array<{
    id: string;
    pageNumber: number;
    imageUrl: string | null;
    fileName: string;
    rotation: number;
    qualityStatus: string;
    qualityScore?: number | null;
    qualityIssues?: string[];
    qualityWarnings?: string[];
    ocrStatus: string;
    markers: Array<{
      id: string;
      questionNo: string;
      status: "correct" | "wrong" | "partial" | "uncertain";
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      label: string;
    }>;
  }>;
  questions: Array<{
    id: string;
    questionNo: string;
    status: "correct" | "wrong" | "partial" | "uncertain";
    score?: number | null;
    maxScore?: number | null;
    prompt?: string;
    studentAnswer?: string;
    correctAnswer?: string;
    studentProcess?: string[];
    errorStep?: string;
    explanation?: string;
    knowledgePoint?: string;
    suggestedPractice?: string;
    teacherNote?: string;
    reviewedByTeacher?: boolean;
    reviewedAt?: string | null;
    confidence?: number | null;
    bbox?: { page: number; x: number; y: number; w: number; h: number };
  }>;
  questionCount: number;
  pendingQuestionCount: number;
  reviewedQuestionCount?: number;
  questionReviewReady?: boolean;
  reviewedQuestionScore?: number | null;
  scoreGroups?: Array<{
    id: "base" | "bonus";
    label: string;
    score: number | null;
    maxScore: number;
    total: number;
    reviewed: number;
    pending: number;
  }> | null;
  uploadedBy: string;
  submittedAt: string;
};

export type GradingWorkbenchFilters = {
  page?: number;
  pageSize?: number;
  studentId?: string;
  subject?: string;
  kind?: string;
  queueState?: "all" | "pending" | "low_confidence" | "ready" | "exception";
  search?: string;
};

export async function listGradingWorkbenches(filters: GradingWorkbenchFilters = {}) {
  const query = new URLSearchParams();
  query.set("page", String(filters.page || 1));
  query.set("pageSize", String(filters.pageSize || 50));
  if (filters.studentId) query.set("studentId", filters.studentId);
  if (filters.subject) query.set("subject", filters.subject);
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.queueState && filters.queueState !== "all") query.set("queueState", filters.queueState);
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench?${query.toString()}`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    workbenches: GradingWorkbench[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean; capped?: boolean };
    summary: { batches: number; pendingQuestions: number; lowConfidence: number; ready: number; exceptions: number };
  }>(response);
}

export async function getGradingWorkbench(submissionId: string) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; workbench: GradingWorkbench }>(response);
}

export async function importDialogueAnswerPackage(submissionId: string, answerPackage: unknown) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}/dialogue-answer-package`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ answerPackage })
  });
  return readJson<{
    ok: boolean;
    regraded: boolean;
    imported: { originalSourceId: string | null; originalFingerprint: string | null; fingerprint: string; questionCount: number };
    workbench: GradingWorkbench;
  }>(response);
}

export async function registerDialogueAnswerPackage(input: {
  answerPackage: unknown;
  assignmentId?: string;
  title?: string;
  subject?: string;
  kind?: string;
  grade?: string;
  targetGrade?: string;
  studentId?: string;
  difficulty?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/api/grading/source-packages/dialogue`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    assignment: Record<string, unknown>;
    gradingSource: { sourceId: string; version: number; fingerprint: string };
    imported: { originalSourceId: string | null; originalFingerprint: string | null; fingerprint: string; questionCount: number };
  }>(response);
}

export async function patchGradingWorkbenchQuestion(submissionId: string, questionId: string, input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}/questions/${questionId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; workbench: GradingWorkbench }>(response);
}

export async function confirmGradingAnswerSource(submissionId: string, input: {
  mode: "teacher_confirmed" | "teacher_selected_reference";
  answerKeyText?: string;
  referenceSourceId?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}/answer-source`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; workbench: GradingWorkbench }>(response);
}

export async function archiveGradingWorkbench(submissionId: string, input: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}/archive`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; workbench: GradingWorkbench; submission: { id: string; needsReview: boolean } }>(response);
}

export async function markSubmissionReviewed(submissionId: string, input: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE_URL}/api/review/submissions/${submissionId}/mark-reviewed`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: boolean; submission: { id: string; needsReview: boolean } }>(response);
}

export async function recognizeReviewSubmission(submissionId: string) {
  const response = await fetch(`${API_BASE_URL}/api/review/submissions/${submissionId}/recognize`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ force: true })
  });
  return readJson<{
    ok: boolean;
    available: boolean;
    recognition: {
      status: string;
      reason?: string;
      text?: string | null;
      pages?: ExternalGradingRecognitionPacket["pages"];
      answerSource?: GradingWorkbench["answerSource"];
      archiveEligible?: boolean;
      archiveBlockers?: string[];
    };
    externalGradingRecognition?: GradingWorkbench["recognitionPacket"];
    submission: Awaited<ReturnType<typeof listReviewSubmissions>>["submissions"][number];
  }>(response);
}

export async function updateReviewSubmissionOcr(submissionId: string, input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/review/submissions/${submissionId}/ocr`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    submission: Awaited<ReturnType<typeof listReviewSubmissions>>["submissions"][number];
  }>(response);
}

export async function getAdminAudit() {
  const response = await fetch(`${API_BASE_URL}/api/admin/audit`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    events: Array<LearningLog & { studentName?: string; metadata?: Record<string, unknown> }>;
    modelRuns: Array<{
      id: string;
      provider: string;
      skill: string;
      status: string;
      model: string;
      createdAt: string;
      inputSummary: string;
      outputSummary: string;
    }>;
    assets: Array<{ id: string; kind: string; title: string; url: string; createdAt: string }>;
  }>(response);
}

export type ContentIndexSummary = {
  available: boolean;
  indexPath: string;
  reason?: string | null;
  generatedAt?: string | null;
  documentCount: number;
  subjectCounts?: Record<string, number>;
  gradeCounts?: Record<string, number>;
  knowledgePointCounts?: Record<string, number>;
  documents: Array<{
    id: string;
    title: string;
    sourceType?: string;
    sourceUrl?: string;
    markdownPath?: string;
    curriculumStandard?: string;
    summary?: string;
    subjects?: string[];
    grades?: string[];
    knowledgePoints?: string[];
    chunkCount?: number;
    textLength?: number;
  }>;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  sourceType: string;
  subject: string;
  grade: string;
  edition: string;
  volume: string;
  unit: string;
  lesson: string;
  sourceUrl: string;
  sourcePath: string;
  markdownPath: string;
  licenseStatus: string;
  reviewStatus: string;
  allowedForGeneration: boolean;
  confidence: number | null;
  summary: string;
  textbookAssetId: string;
  textbookTitle: string;
  curriculumSeries: string;
  curriculumRegion: string;
  curriculumStandard: string;
  metadata: Record<string, unknown>;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export async function getContentIndex() {
  const response = await fetch(`${API_BASE_URL}/api/content/index`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    index: ContentIndexSummary;
  }>(response);
}

export async function listKnowledgeSources(filters: { subject?: string; grade?: string; sourceType?: string; reviewStatus?: string; search?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, String(value));
  }
  query.set("limit", String(filters.limit || 200));
  const response = await fetch(`${API_BASE_URL}/api/knowledge/sources${query.toString() ? `?${query.toString()}` : ""}`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    generatedAt: string;
    sources: KnowledgeSource[];
  }>(response);
}

export async function syncKnowledgeSourcesFromIndex(input: { indexPath?: string } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/knowledge/sources/sync-content-index`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    sync: { sourceCount: number; chunkCount: number };
  }>(response);
}

export async function createKnowledgeSource(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/knowledge/sources`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    source: KnowledgeSource;
  }>(response);
}

export type KnowledgeSourceReviewInput = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  allowedForGeneration: boolean;
  licenseStatus?: string;
  note?: string;
  textbookAssetId?: string;
};

export async function reviewKnowledgeSource(sourceId: string, input: KnowledgeSourceReviewInput) {
  const response = await fetch(`${API_BASE_URL}/api/knowledge/sources/${sourceId}/review`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    source: KnowledgeSource;
  }>(response);
}

export async function rebuildContentIndex(input: { inputs?: string[]; outDir?: string } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/content/index/rebuild`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    rebuild: Record<string, unknown>;
    index: ContentIndexSummary;
  }>(response);
}

export async function uploadTeachingMaterials(files: File[], input: { outDir?: string } = {}) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (input.outDir) formData.append("outDir", input.outDir);
  const response = await fetch(`${API_BASE_URL}/api/content/markdown-ingestion`, {
    method: "POST",
    headers: authHeaders(),
    body: formData
  });
  return readJson<{
    ok: boolean;
    outDir: string;
    fileCount: number;
    records: Array<{
      originalName: string;
      fileName: string;
      size: number;
      mimeType: string;
      uploadUrl?: string;
      uploadedPath?: string;
      conversion?: Record<string, unknown>;
    }>;
  }>(response);
}

export async function listTextbooks(filters: { subject?: string; grade?: string; volume?: string; search?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, String(value));
  }
  query.set("limit", String(filters.limit || 200));
  const response = await fetch(`${API_BASE_URL}/api/textbooks${query.toString() ? `?${query.toString()}` : ""}`, {
    headers: authHeaders()
  });
  return readJson<{
    ok: boolean;
    generatedAt: string;
    assets: TextbookAssetCard[];
  }>(response);
}

export async function rescanTextbooks() {
  const response = await fetch(`${API_BASE_URL}/api/textbooks/rescan`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: boolean;
    scan: Record<string, unknown>;
    import: Record<string, unknown>;
  }>(response);
}

export async function openTextbook(assetId: string) {
  const response = await fetch(`${API_BASE_URL}/api/textbooks/${assetId}/open`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: boolean;
    opened: boolean;
    message: string;
    asset: TextbookAssetCard;
  }>(response);
}

export async function updateTextbookChapters(assetId: string, chapters: TextbookAssetCard["chapters"] = []) {
  const response = await fetch(`${API_BASE_URL}/api/textbooks/${assetId}/chapters`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ chapters })
  });
  return readJson<{
    ok: boolean;
    asset: TextbookAssetCard;
  }>(response);
}

export async function repairTextbookChapterDrafts() {
  const response = await fetch(`${API_BASE_URL}/api/textbooks/chapter-drafts/repair`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
  return readJson<{ ok: boolean; repairedAssetCount: number; assets: TextbookAssetCard[] }>(response);
}

export async function confirmTextbookGenerationScope(assetId: string, chapterIds: string[]) {
  const response = await fetch(`${API_BASE_URL}/api/textbooks/${assetId}/confirm-generation-scope`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ chapterIds })
  });
  return readJson<{ ok: boolean; source: KnowledgeSource }>(response);
}
