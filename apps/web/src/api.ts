import type {
  AssignmentCard,
  ClassroomBroadcast,
  ClassroomDevice,
  CorrectionRecord,
  DictationTask,
  LearningLog,
  LearningTaskCard,
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
      providers?: Array<{
        id: string;
        label: string;
        status: "ready" | "blocked" | "unavailable";
        model: string;
        baseUrl: string;
        reason: string;
        capabilities: string[];
      }>;
      features: Array<{
        id: string;
        label: string;
        providerId?: string;
        appSurface: string;
        status: "ready" | "blocked" | "unavailable";
        reason: string;
      }>;
      generatedAt: string;
      mode: string;
    };
  }>(response);
  return {
    ...body,
    ai: {
      ...body.ai,
      providers: body.ai.providers || [],
      features: body.ai.features.map((feature) => ({
        ...feature,
        providerId: feature.providerId || (feature.id.includes("voice") || feature.id.includes("spoken") ? "minimax" : "deepseek")
      }))
    }
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
    persistence: { active: boolean; reason: string };
    result: {
      available: boolean;
      mode: "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";
      answer: string;
      persisted?: {
        modelRunId?: string | null;
        qaSessionId?: string | null;
        voiceInteractionId?: string | null;
      };
    };
  }>(response);
}

export type VocabularyCard = {
  word: string;
  phonetic: string;
  part: string;
  partCn: string;
  meaning: string;
  related: Array<{ word: string; part: string; partCn: string; meaning: string }>;
  examples: string[];
  pitfall: string;
  needsTeacherReview?: boolean;
  aiGenerated?: boolean;
};

export async function generateVocabularyCard(input: {
  word: string;
  studentId?: string;
  studentName?: string;
  grade?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/api/ai/vocabulary`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson<{
    ok: boolean;
    result: {
      available: boolean;
      card: VocabularyCard;
      persisted?: { modelRunId?: string | null; vocabularyRecordId?: string | null };
    };
  }>(response);
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
  }>(response);
}

export async function publishStudentProfile(studentId: string, snapshot: Record<string, unknown>, text?: string) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/publish`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ snapshot, text })
  });
  return readJson<{
    ok: boolean;
    student: StudentProfile;
    snapshot: Record<string, unknown>;
  }>(response);
}

export async function generateStudentProfilePrint(studentId: string, input: { snapshot: Record<string, unknown>; text?: string }) {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/profile/print`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
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

export async function draftAssessment(input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/assessments/draft`, {
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
      persisted?: { modelRunId?: string | null; assignmentId?: string | null };
    };
  }>(response);
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
  }>(response);
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
      persisted?: { voiceInteractionId?: string | null; qaSessionId?: string | null; modelRunId?: string | null };
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

export type GradingWorkbench = {
  id: string;
  submissionId: string;
  assignmentId: string;
  title: string;
  studentId: string;
  studentName: string;
  subject: string;
  kind: string;
  status: string;
  score: number | null;
  provisionalScore?: number | null;
  needsTeacherReview: boolean;
  archiveEligible: boolean;
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
  uploadedBy: string;
  submittedAt: string;
};

export async function listGradingWorkbenches() {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; workbenches: GradingWorkbench[] }>(response);
}

export async function getGradingWorkbench(submissionId: string) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}`, {
    headers: authHeaders()
  });
  return readJson<{ ok: boolean; workbench: GradingWorkbench }>(response);
}

export async function patchGradingWorkbenchQuestion(submissionId: string, questionId: string, input: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/grading/workbench/${submissionId}/questions/${questionId}`, {
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
    recognition: { status: string; reason?: string; text?: string | null };
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
    markdownPath?: string;
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

export async function listKnowledgeSources(filters: { subject?: string; grade?: string; sourceType?: string; reviewStatus?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
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

export async function reviewKnowledgeSource(sourceId: string, input: Record<string, unknown>) {
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

export async function listTextbooks(filters: { subject?: string; grade?: string; volume?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
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
