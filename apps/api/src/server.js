import cors from "cors";
import express from "express";
import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  buildAiStartupSnapshot,
  buildModelOrchestrationPlan,
  createMiniMaxSpeechTask,
  draftStudentProfileNarrative
} from "@junhang/ai";
import { inspectEncodingPayload } from "@junhang/core";
import { recognizeImages } from "@junhang/ai/ocr-node";
import {
  createClassroomBroadcast,
  createDictationTask,
  createAssignmentDraft,
  createReadingTask,
  createStudentWithAccessCode,
  disableStudentAccess,
  hashAccessCode,
  listTeacherStudents,
  prisma,
  recordBehaviorEvent,
  recordModelRun,
  resetStudentAccessCode,
  updateStudentAccessStatus
} from "@junhang/db";
import {
  answerStudentQuestionService,
  dictationSpeechService,
  draftAssessmentService,
  draftTeacherTaskService,
  generateVocabularyCardService,
  gradeSubmissionService
} from "@junhang/services";
import { checkDatabaseStatus, persistenceOptions, requireDatabase } from "./db-status.js";
import { createEncodingGuardMiddleware } from "./encoding-guard-middleware.js";
import { loadRuntimeConfig, publicConfigSummary } from "./env.js";
import { gradingQuestionReviewState, requireAllQuestionsReviewedForArchive } from "./grading-review-gates.js";
import { createSessionToken, readBearerToken, requireSession, verifySessionToken } from "./session.js";
import {
  buildStudentGrowthSnapshot,
  filterStudentProfileSnapshot,
  mergeStudentProfileAiDraft,
  renderStudentGrowthProfilePrintHtml
} from "./student-growth-profile.js";
import {
  buildTermReportDraft,
  mapTermReportForRole,
  normalizeTermReportType,
  renderTermReportHtml,
  termReportTypeToDb
} from "./student-term-report.js";
import { publicGeneratedUrl, publicUploadUrl, storageGeneratedRoot, storageUploadRoot, submissionImageUpload, teachingMaterialUpload, uploadedFileMeta } from "./uploads.js";

const config = loadRuntimeConfig();
const app = express();
const port = Number(config.API_PORT || 8787);
const host = String(config.API_HOST || "127.0.0.1");
const execFileAsync = promisify(execFile);
const workspaceRoot = findWorkspaceRoot();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return callback(null, true);
      return callback(null, true);
    }
  })
);
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(createEncodingGuardMiddleware({ enabled: config.ENCODING_GUARD_ENABLED !== "false" }));
app.use("/uploads", express.static(storageUploadRoot()));
app.use("/generated", express.static(storageGeneratedRoot()));

app.get("/", (req, res) => {
  const requestHost = String(req.headers.host || `127.0.0.1:${port}`);
  const webHost = requestHost.includes(":") ? requestHost.replace(/:\d+$/, ":5173") : `${requestHost}:5173`;
  const webUrl = `http://${webHost}/`;
  res.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>君航 AI 助教 API</title>
  </head>
  <body>
    <h1>这里是君航 AI 助教 API 服务</h1>
    <p>请打开 Web 地址：<a href="${webUrl}">${webUrl}</a></p>
    <p>如果你是在 iPad 或手机上查看页面，请使用 5173 端口，不要使用 8787 端口。</p>
  </body>
</html>`);
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function findWorkspaceRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, "scripts", "build-content-index.mjs"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

function parseMaybeJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function workspaceRelativePath(value, fallback, options = {}) {
  const raw = String(value || fallback || "").trim();
  const resolved = path.resolve(workspaceRoot, raw);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error(options.message || "Path must stay inside the project workspace.");
    error.code = options.code || "PATH_OUTSIDE_WORKSPACE";
    throw error;
  }
  return relative.split(path.sep).join("/");
}

function getBody(req) {
  const body = { ...req.body };
  for (const key of ["items", "focusItems", "mistakes", "imageNames", "metadata"]) {
    if (key in body) body[key] = parseMaybeJson(body[key], []);
  }
  return body;
}

function optionalText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildOcrMeta(input = {}) {
  const text = optionalText(input.ocrText || input.note);
  const manualText = optionalText(input.manualText || input.correctedText);
  const status =
    input.ocrStatus ||
    (manualText ? "MANUAL_CORRECTED" : text ? "USER_PROVIDED" : "PENDING");
  return {
    status,
    text,
    manualText,
    confidence: optionalNumber(input.ocrConfidence),
    pageNumber: optionalNumber(input.pageNumber),
    questionRange: optionalText(input.questionRange),
    imageIndex: optionalNumber(input.imageIndex),
    imageTotal: optionalNumber(input.imageTotal || input.expectedImageCount),
    source: input.uploadedBy === "student" ? "student_upload" : "teacher_upload",
    engine: input.ocrEngine || null,
    reviewed: false
  };
}

function ocrStatusToClient(status) {
  if (status === "MANUAL_CORRECTED") return "已人工校正";
  if (status === "USER_PROVIDED") return "已填文字";
  if (status === "READY") return "已识别";
  if (status === "RUNNING") return "识别中";
  if (status === "FAILED") return "识别失败";
  return "待识别";
}

async function recognizeSubmissionImages(input = {}) {
  return recognizeImages(config, input);
}

async function analyzeSubmissionImageQuality(imageFiles = []) {
  const paths = imageFiles.map((file) => file?.path).filter(Boolean);
  if (!paths.length) {
    return {
      available: false,
      status: "unavailable",
      score: null,
      pageCount: 0,
      pages: [],
      issues: ["没有可分析的图片文件。"],
      warnings: []
    };
  }
  const scriptPath = path.resolve(process.cwd(), "scripts", "analyze-submission-images.py");
  if (!fs.existsSync(scriptPath)) {
    return {
      available: false,
      status: "unavailable",
      score: null,
      pageCount: paths.length,
      pages: [],
      issues: ["图片质量分析脚本不存在。"],
      warnings: []
    };
  }
  try {
    const result = await execFileAsync(config.PYTHON_BIN || "python", [scriptPath, ...paths], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000
    });
    return JSON.parse(String(result.stdout || "{}"));
  } catch (error) {
    return {
      available: false,
      status: "unavailable",
      score: null,
      pageCount: paths.length,
      pages: [],
      issues: [`图片质量分析未完成：${error instanceof Error ? error.message : String(error)}`],
      warnings: []
    };
  }
}

async function buildSubmissionGradeInputFromRecord(submission, recognition = null) {
  const content = safeJson(submission.content, {});
  const assignment = submission.assignment || {};
  const assignmentMetadata = safeJson(assignment.metadata, {});
  const gradingResult = safeJson(submission.grading?.result, {});
  const questionLayoutManifest =
    safeJson(assignmentMetadata.questionLayoutManifest, null) ||
    safeJson(assignmentMetadata.latestQuestionLayoutManifest, null) ||
    await findLatestQuestionLayoutManifest(submission.assignmentId);
  const ocr = {
    ...safeJson(content.ocr, {}),
    ...(recognition
      ? {
          status: recognition.status,
          text: recognition.text || safeJson(content.ocr, {}).text || content.ocrText || "",
          studentAnswerText: recognition.studentAnswerText || safeJson(content.ocr, {}).studentAnswerText || content.studentAnswerText || "",
          printedText: recognition.printedText || safeJson(content.ocr, {}).printedText || content.printedText || "",
          confidence: recognition.confidence,
          engine: recognition.engine,
          reason: recognition.reason,
          questions: recognition.questions,
          imageQuality: recognition.imageQuality
        }
      : {})
  };
  return {
    assignmentId: submission.assignmentId,
    studentId: submission.studentId,
    subject: assignment.subject?.name || assignmentMetadata.subject || content.subject || gradingResult.evidence?.subject || "",
    kind: assignmentMetadata.kind || content.kind || "",
    title: assignment.title || "图片提交批改记录",
    uploadedBy: content.uploadedBy || assignmentMetadata.uploadedBy || "teacher",
    imageNames: content.imageNames || assignmentMetadata.imageNames || [],
    uploadedFiles: content.imageFiles || [],
    ocrText: ocr.manualText || ocr.text || content.ocrText || "",
    studentAnswerText: content.studentAnswerText || content.ocrStudentAnswerText || ocr.studentAnswerText || "",
    printedText: content.printedText || ocr.printedText || "",
    ocrStatus: ocr.status || content.ocrStatus || "PENDING",
    ocrConfidence: ocr.confidence ?? null,
    ocrEngine: ocr.engine || null,
    ocrReason: ocr.reason || null,
    ocrQuestions: ocr.questions || content.ocrQuestions || [],
    imageQuality: ocr.imageQuality || content.imageQuality || null,
    manualText: ocr.manualText || content.manualText || null,
    pageNumber: ocr.pageNumber ?? content.pageNumber ?? null,
    questionRange: ocr.questionRange ?? content.questionRange ?? null,
    assignmentItems: assignment.items?.map((item) => ({
      questionNo: item.orderIndex,
      prompt: item.prompt,
      answer: item.answer,
      rubric: item.rubric,
      metadata: item.metadata || {}
    })) || [],
    answerKey: assignmentMetadata.answerKey || null,
    questionLayoutManifest,
    assignmentAnalysis: {
      subject: assignment.subject?.name || assignmentMetadata.subject || null,
      kind: assignmentMetadata.kind || null,
      difficulty: assignment.difficulty || null,
      questionLayoutManifest
    }
  };
}

function queuedSubmissionResult(input = {}, submission = null) {
  const imageCount = input.imageNames?.length || input.uploadedFiles?.length || 0;
  return {
    available: false,
    queued: true,
    providerId: null,
    gradingText: "",
    structured: {
      score: null,
      summary: "照片已上传，正在后台识别批改。完成后会自动进入复核队列。",
      strengths: [],
      mistakes: [],
      questionResults: [],
      annotationMarkers: [],
      nextPractice: "",
      needsTeacherReview: true,
      reviewStatus: "processing",
      aiGenerated: false,
      available: false,
      evidence: {
        ocrStatus: "RUNNING",
        imageCount,
        uploadedBy: input.uploadedBy || "teacher"
      }
    },
    persisted: {
      submissionId: submission?.id || null,
      gradingResultId: submission?.grading?.id || null,
      assignmentId: submission?.assignmentId || input.assignmentId || null
    }
  };
}

async function createQueuedPhotoSubmission(input = {}) {
  const imageCount = input.imageNames?.length || input.uploadedFiles?.length || 0;
  const assignment = input.assignmentId
    ? await prisma.assignment.findUnique({ where: { id: input.assignmentId } })
    : await createAssignmentDraft({
        subject: input.subject || null,
        title: input.title || "图片提交批改记录",
        grade: input.grade || null,
        difficulty: input.difficulty || null,
        metadata: {
          kind: input.kind || "图片批改",
          source: "photo-upload",
          uploadedBy: input.uploadedBy || "teacher",
          imageNames: input.imageNames || [],
          expectedImageCount: imageCount,
          subject: input.subject || null
        }
      });
  if (!assignment?.id) throw new Error("无法创建图片批改记录。");
  const ocr = {
    status: "RUNNING",
    text: null,
    studentAnswerText: null,
    printedText: null,
    confidence: null,
    engine: null,
    reason: "照片已上传，正在后台识别批改。",
    imageTotal: imageCount,
    source: input.uploadedBy === "student" ? "student_upload" : "teacher_upload",
    reviewed: false
  };
  return prisma.submission.create({
    data: {
      assignmentId: assignment.id,
      studentId: input.studentId,
      status: "SUBMITTED",
      content: {
        subject: input.subject || null,
        kind: input.kind || null,
        ocrText: null,
        studentAnswerText: null,
        printedText: null,
        ocrStatus: "RUNNING",
        ocr,
        imageNames: input.imageNames || [],
        imageFiles: input.uploadedFiles || [],
        uploadedBy: input.uploadedBy || "teacher",
        uploadBatchId: input.batchId || null,
        imageTotal: imageCount,
        pageNumber: null,
        questionRange: input.questionRange || ""
      },
      grading: {
        create: {
          score: null,
          result: queuedSubmissionResult(input).structured,
          needsReview: true
        }
      }
    },
    include: { grading: true }
  });
}

async function markSubmissionProcessingFailed(submissionId, error) {
  const message = error instanceof Error ? error.message : String(error);
  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  const content = safeJson(submission?.content, {});
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      status: "NEEDS_REVIEW",
      content: {
        ...content,
        ocrStatus: "FAILED",
        ocr: {
          ...(safeJson(content.ocr, {})),
          status: "FAILED",
          reason: message
        }
      },
      grading: {
        update: {
          result: {
            score: null,
            summary: `后台识别批改失败：${message}`,
            strengths: [],
            mistakes: [],
            questionResults: [],
            annotationMarkers: [],
            nextPractice: "请重新识别并重批，或由教师人工复核。",
            needsTeacherReview: true,
            reviewStatus: "processing_failed",
            aiGenerated: false,
            available: false
          },
          needsReview: true
        }
      }
    }
  });
}

async function recognizeAndGradeSubmissionRecord(submissionId, { force = false } = {}) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { student: true, grading: true, assignment: { include: { subject: true, items: { orderBy: { orderIndex: "asc" } } } } }
  });
  if (!submission) return null;

  const content = safeJson(submission.content, {});
  const currentOcr = safeJson(content.ocr, {});
  const hasUsableOcr = optionalText(currentOcr.manualText || currentOcr.text || content.ocrText);
  const imageQuality = !force && content.imageQuality
    ? content.imageQuality
    : await analyzeSubmissionImageQuality(content.imageFiles || []);
  const recognition = !force && hasUsableOcr
    ? {
        available: true,
        status: currentOcr.status || content.ocrStatus || "READY",
        text: currentOcr.manualText || currentOcr.text || content.ocrText,
        studentAnswerText: currentOcr.studentAnswerText || content.studentAnswerText || null,
        printedText: currentOcr.printedText || content.printedText || null,
        confidence: currentOcr.confidence ?? null,
        engine: currentOcr.engine || "cached",
        reason: "使用已识别文本直接重新批改。",
        questions: currentOcr.questions || content.ocrQuestions || [],
        imageQuality
      }
    : await recognizeSubmissionImages({
        engine: config.OCR_ENGINE || "vision",
        imageNames: content.imageNames || [],
        imageFiles: content.imageFiles || [],
        fallbackText: currentOcr.manualText || currentOcr.text || content.ocrText || "",
        context: {
          studentName: submission.student?.displayName || "",
          subject: submission.assignment?.subject?.name || safeJson(submission.assignment?.metadata, {}).subject || content.subject || "",
          kind: safeJson(submission.assignment?.metadata, {}).kind || content.kind || "",
          title: submission.assignment?.title || "",
          imageQuality
        },
        imageQuality
      });
  if (!recognition.imageQuality) recognition.imageQuality = imageQuality;
  const nextOcr = {
    ...currentOcr,
    status: recognition.status,
    text: recognition.text || currentOcr.text || null,
    studentAnswerText: recognition.studentAnswerText || currentOcr.studentAnswerText || null,
    printedText: recognition.printedText || currentOcr.printedText || null,
    confidence: recognition.confidence,
    engine: recognition.engine,
    reason: recognition.reason,
    questions: recognition.questions || currentOcr.questions || [],
    imageQuality: recognition.imageQuality,
    recognizedAt: new Date().toISOString()
  };
  const gradeInput = await buildSubmissionGradeInputFromRecord(submission, recognition);
  const { options } = await persistenceOptions(gradeInput);
  const regrade = await gradeSubmissionService(config, gradeInput, { ...options, persist: false });
  const structured = regrade.structured || {};
  const gradingData = {
    modelRunId: regrade.persisted?.modelRunId || submission.grading?.modelRunId || null,
    score: structured.score ?? submission.grading?.score ?? null,
    result: {
      ...structured,
      rawText: regrade.gradingText || safeJson(submission.grading?.result, {}).rawText || "",
      providerId: regrade.providerId || safeJson(submission.grading?.result, {}).providerId || null,
      available: regrade.available
    },
    needsReview: true
  };
  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: "NEEDS_REVIEW",
      content: {
        ...content,
        ocrStatus: nextOcr.status,
        ocrText: nextOcr.text,
        studentAnswerText: nextOcr.studentAnswerText,
        printedText: nextOcr.printedText,
        ocrQuestions: nextOcr.questions,
        imageQuality: recognition.imageQuality,
        ocr: nextOcr
      },
      grading: submission.grading ? { update: gradingData } : { create: gradingData }
    },
    include: { student: true, grading: true, assignment: { include: { subject: true, items: { orderBy: { orderIndex: "asc" } } } } }
  });
  return { recognition, regrade, structured, updated };
}

function queueSubmissionRecognition(submissionId) {
  setTimeout(() => {
    recognizeAndGradeSubmissionRecord(submissionId, { force: true })
      .catch((error) => {
        console.error("[submission-grading] background processing failed", { submissionId, error: error instanceof Error ? error.message : String(error) });
        return markSubmissionProcessingFailed(submissionId, error).catch((innerError) => {
          console.error("[submission-grading] failed to mark processing failure", { submissionId, error: innerError instanceof Error ? innerError.message : String(innerError) });
        });
      });
  }, 0);
}

function sessionTeacherId(req, fallback = null) {
  return req.session?.role === "teacher" ? req.session.teacherId : fallback;
}

function assertStudentOwnsRequest(req, studentId) {
  if (req.session?.role !== "student") return null;
  if (!studentId || req.session.studentId !== studentId) {
    return {
      ok: false,
      error: "STUDENT_SCOPE_MISMATCH",
      message: "学生端只能访问自己的学习数据。"
    };
  }
  return null;
}

function forbidden(res, error, message) {
  return res.status(403).json({ ok: false, error, message });
}

async function teacherCanAccessStudent(teacherId, studentId) {
  if (!teacherId || !studentId) return false;
  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      OR: [
        { responsibleTeacherId: teacherId },
        { teacherAssignments: { some: { teacherId, activeTo: null } } }
      ]
    },
    select: { id: true }
  });
  return Boolean(student);
}

async function assertTeacherStudentScope(req, res, studentId) {
  if (req.session?.role !== "teacher" || !studentId) return true;
  if (await teacherCanAccessStudent(req.session.teacherId, studentId)) return true;
  forbidden(res, "TEACHER_STUDENT_SCOPE_MISMATCH", "当前教师无权访问该学生。");
  return false;
}

async function teacherCanAccessDevice(teacherId, deviceId) {
  if (!teacherId || !deviceId) return false;
  const device = await prisma.classroomDevice.findFirst({
    where: {
      id: deviceId,
      OR: [{ teacherId }, { teacherId: null }]
    },
    select: { id: true }
  });
  return Boolean(device);
}

async function assertTeacherOwnsDevice(req, res, deviceId) {
  if (req.session?.role !== "teacher" || !deviceId) return true;
  if (await teacherCanAccessDevice(req.session.teacherId, deviceId)) return true;
  forbidden(res, "TEACHER_DEVICE_SCOPE_MISMATCH", "当前教师无权控制该课堂平板。");
  return false;
}

function assertClassroomDeviceScope(req, res, deviceId) {
  if (req.session?.role !== "classroom") return true;
  if (deviceId && req.session.deviceId === deviceId) return true;
  forbidden(res, "CLASSROOM_DEVICE_SCOPE_MISMATCH", "课堂平板只能访问自己的设备数据。");
  return false;
}

async function classroomCanAccessStudent(deviceId, studentId) {
  if (!deviceId || !studentId) return false;
  const device = await prisma.classroomDevice.findUnique({
    where: { id: deviceId },
    select: { grade: true, className: true }
  });
  if (!device?.grade) return false;
  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      loginEnabled: true,
      enrollmentStatus: { not: "WITHDRAWN" },
      grade: device.grade,
      ...(device.className ? { className: device.className } : {})
    },
    select: { id: true }
  });
  return Boolean(student);
}

async function assertClassroomStudentScope(req, res, studentId) {
  if (req.session?.role !== "classroom" || !studentId) return true;
  if (await classroomCanAccessStudent(req.session.deviceId, studentId)) return true;
  forbidden(res, "CLASSROOM_STUDENT_SCOPE_MISMATCH", "课堂平板只能操作本设备年级或分组内的学生。");
  return false;
}

async function auditEvent(req, input = {}) {
  try {
    const session = req.session || verifySessionToken(config, readBearerToken(req));
    const actorType =
      input.actorType ||
      (session?.role === "teacher"
        ? "TEACHER"
        : session?.role === "student"
          ? "STUDENT"
          : session?.role === "classroom"
            ? "SYSTEM"
            : "SYSTEM");
    await recordBehaviorEvent({
      studentId: input.studentId || null,
      actorType,
      feature: input.feature,
      action: input.action,
      metadata: {
        ...(input.metadata || {}),
        actorRole: session?.role || null,
        teacherId: session?.teacherId || null,
        studentSessionId: session?.studentId || null,
        deviceId: session?.deviceId || input.deviceId || null
      }
    });
  } catch (error) {
    console.warn("audit event failed", error);
  }
}

function actorTypeToClient(actorType) {
  return String(actorType || "STUDENT").toLowerCase();
}

function enrollmentStatusToClient(status) {
  if (status === "TRIAL") return "测试";
  if (status === "PAUSED") return "暂停";
  if (status === "WITHDRAWN") return "退课保留档案";
  return "在读";
}

function taskStatusToClient(status) {
  if (status === "COMPLETED") return "已完成";
  if (status === "IN_PROGRESS") return "进行中";
  if (status === "REVIEWED") return "需复核";
  return "待完成";
}

function submissionStatusToClient(status) {
  if (status === "GRADED") return "已批改";
  if (status === "NEEDS_REVIEW") return "需复核";
  if (status === "RETURNED") return "需复核";
  return "已提交";
}

function reportTypeToClient(type) {
  if (type === "WEEKLY") return "本周";
  if (type === "MONTHLY") return "本月";
  if (type === "MIDTERM") return "期中";
  if (type === "FINAL") return "期末";
  return "本周";
}

function safeJson(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

function readContentIndexSummary(indexPath = path.resolve(workspaceRoot, "exports/content-index/index.json")) {
  if (!fs.existsSync(indexPath)) {
    return {
      available: false,
      indexPath,
      reason: "CONTENT_INDEX_NOT_FOUND",
      documentCount: 0,
      documents: []
    };
  }
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const documents = Array.isArray(index.documents) ? index.documents : [];
    return {
      available: true,
      indexPath,
      generatedAt: index.generatedAt || null,
      documentCount: index.documentCount || documents.length,
      subjectCounts: index.subjectCounts || {},
      gradeCounts: index.gradeCounts || {},
      knowledgePointCounts: index.knowledgePointCounts || {},
      documents: documents.slice(0, 80).map((document) => ({
        id: document.id,
        title: document.title,
        sourceType: document.sourceType,
        markdownPath: document.relativeMarkdownPath || document.markdownPath,
        summary: document.summary,
        subjects: document.subjects || [],
        grades: document.grades || [],
        knowledgePoints: document.knowledgePoints || [],
        chunkCount: document.chunkCount || 0,
        textLength: document.textLength || 0
      }))
    };
  } catch (error) {
    return {
      available: false,
      indexPath,
      reason: error instanceof Error ? error.message : String(error),
      documentCount: 0,
      documents: []
    };
  }
}

function readContentIndexRaw(indexPath = path.resolve(workspaceRoot, "exports/content-index/index.json")) {
  if (!fs.existsSync(indexPath)) return null;
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function stableKnowledgeSourceId(document) {
  const basis = document.relativeMarkdownPath || document.markdownPath || document.sourcePath || document.title || randomUUID();
  return `ks_${Buffer.from(String(basis)).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 36)}`;
}

function normalizeKnowledgeDisplayText(value) {
  return readableText(value, "")
    .replace(/Prompt Engineering/gi, "提示词工程")
    .replace(/Context Engineering/gi, "上下文工程")
    .replace(/playbook/gi, "使用手册")
    .replace(/reading/gi, "阅读")
    .replace(/grammar/gi, "语法")
    .replace(/vocabulary/gi, "词汇");
}

function knowledgeSourceTitle(document = {}) {
  const title = readableText(document.title, "");
  const summary = normalizeKnowledgeDisplayText(document.summary);
  const mostlyAscii = title && /^[\w\s._-]+$/.test(title);
  if (summary && (!title || mostlyAscii)) return summary;
  return normalizeKnowledgeDisplayText(title || summary || "未命名资料");
}

function mapKnowledgeSourceRow(row) {
  return {
    id: row.id,
    title: knowledgeSourceTitle(row),
    sourceType: row.sourceType,
    subject: row.subject || "",
    grade: row.grade || "",
    edition: row.edition || "",
    volume: row.volume || "",
    unit: row.unit || "",
    lesson: row.lesson || "",
    sourceUrl: row.sourceUrl || "",
    sourcePath: row.sourcePath || "",
    markdownPath: row.markdownPath || "",
    licenseStatus: row.licenseStatus,
    reviewStatus: row.reviewStatus,
    allowedForGeneration: Boolean(row.allowedForGeneration),
    confidence: row.confidence ?? null,
    summary: normalizeKnowledgeDisplayText(row.summary || ""),
    metadata: safeJson(row.metadata, {}),
    chunkCount: Number(row.chunkCount || 0),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  };
}

async function syncContentIndexToKnowledgeLibrary(index, teacherId = null) {
  const documents = Array.isArray(index?.documents) ? index.documents : [];
  let sourceCount = 0;
  let chunkCount = 0;
  for (const document of documents) {
    const id = stableKnowledgeSourceId(document);
    const metadata = {
      contentIndexId: document.id,
      subjects: document.subjects || [],
      grades: document.grades || [],
      knowledgePoints: document.knowledgePoints || [],
      textLength: document.textLength || 0,
      syncedByTeacherId: teacherId,
      syncedAt: new Date().toISOString()
    };
    await prisma.$executeRaw`
      INSERT INTO "KnowledgeSource" (
        "id", "title", "sourceType", "subject", "grade", "sourcePath", "markdownPath",
        "licenseStatus", "reviewStatus", "allowedForGeneration", "confidence", "summary",
        "metadata", "createdAt", "updatedAt"
      )
      VALUES (
        ${id}, ${knowledgeSourceTitle(document)}, ${readableText(document.sourceType, "teacher-upload")},
        ${(document.subjects || [])[0] || null}, ${(document.grades || [])[0] || null},
        ${document.sourcePath || null}, ${document.relativeMarkdownPath || document.markdownPath || null},
        'REVIEW_REQUIRED', 'PENDING', false, ${document.textLength ? 0.72 : null},
        ${document.summary || null}, ${JSON.stringify(metadata)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE SET
        "title" = EXCLUDED."title",
        "sourceType" = EXCLUDED."sourceType",
        "subject" = EXCLUDED."subject",
        "grade" = EXCLUDED."grade",
        "sourcePath" = EXCLUDED."sourcePath",
        "markdownPath" = EXCLUDED."markdownPath",
        "confidence" = EXCLUDED."confidence",
        "summary" = EXCLUDED."summary",
        "metadata" = EXCLUDED."metadata",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
    await prisma.$executeRaw`DELETE FROM "KnowledgeChunk" WHERE "sourceId" = ${id}`;
    const chunks = Array.isArray(document.chunks) ? document.chunks : [];
    for (const [index, chunk] of chunks.entries()) {
      const text = readableText(chunk.text, "");
      if (!text) continue;
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk" (
          "id", "sourceId", "orderIndex", "text", "preview", "knowledgePoints", "metadata", "createdAt"
        )
        VALUES (
          ${`kc_${randomUUID()}`}, ${id}, ${index + 1}, ${text}, ${chunk.preview || text.slice(0, 240)},
          ${JSON.stringify(document.knowledgePoints || [])}::jsonb,
          ${JSON.stringify({ contentIndexChunkId: chunk.id || null })}::jsonb,
          CURRENT_TIMESTAMP
        )
      `;
      chunkCount += 1;
    }
    sourceCount += 1;
  }
  return { sourceCount, chunkCount };
}

const mojibakeTextReplacements = [
  ["鑻辫", "英语"],
  ["璇枃", "语文"],
  ["鏁板", "数学"],
  ["缁冧範", "练习"],
  ["璇曞嵎", "试卷"],
  ["鍩虹", "基础"],
  ["鎻愰珮", "提高"],
  ["鍥伴毦", "困难"],
  ["鎸囧畾鏃ユ湡", "指定日期"],
  ["浠婃棩", "今日"],
  ["濮撳悕", "姓名"],
  ["鏃ユ湡", "日期"],
  ["寰楀垎", "得分"],
  ["涓昏鑰佸笀", "主讲老师"],
  ["AI鐢熸垚", "AI生成"],
  ["鏁欏笀澶嶆牳鍚庢墦鍗?", "教师复核后打印"],
  ["鏁欏笀澶嶆牳鐢ㄨВ鏋?", "教师复核用解析"],
  ["瑙ｆ瀽", "解析"],
  ["绛旀", "答案"],
  ["鑰冪偣", "考点"],
  ["鍥剧墖鎻愪氦鎵规敼璁板綍", "图片提交批改记录"],
  ["鍥剧墖鎵规敼", "图片批改"],
  ["鎵规敼璁板綍", "批改记录"],
  ["鏈懆", "本周"],
  ["鏈湀", "本月"],
  ["鏈熶腑", "期中"],
  ["鏈熸湯", "期末"],
  ["娴嬭瘯", "测试"],
  ["鏆傚仠", "暂停"],
  ["鍦ㄨ", "在读"],
  ["闇€澶嶆牳", "需复核"],
  ["宸叉帉鎻?", "已掌握"],
  ["寰呰姝?", "待订正"],
  ["澶嶄範涓?", "复习中"]
];

function normalizeDisplayText(value) {
  let text = String(value || "");
  const colonCount = (text.match(/：/g) || []).length;
  if (colonCount > 6 && colonCount > text.length * 0.25) {
    text = text.replace(/：/g, "");
  }
  for (const [bad, good] of mojibakeTextReplacements) {
    text = text.split(bad).join(good);
  }
  return text
    .replace(/锛\?/g, "：")
    .replace(/绗\?/g, "第")
    .replace(/椤\?/g, "页");
}

function normalizeDisplayPayload(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeDisplayPayload(item));
  if (!value || typeof value !== "object") return typeof value === "string" ? normalizeDisplayText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [normalizeDisplayText(key), normalizeDisplayPayload(item)]));
}

function readableText(value, fallback = "") {
  const text = normalizeDisplayText(value).trim();
  if (!text || /\?{2,}/.test(text)) return fallback;
  return text;
}

function parseStructuredDisplayText(value) {
  const text = readableText(value, "");
  if (!text) return null;
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!jsonText.startsWith("{") && !jsonText.startsWith("[")) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function taskDisplayDetails(task, metadata = {}) {
  const raw = task.description || metadata.draftText || metadata.requirement || "";
  const parsed = parseStructuredDisplayText(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const text = readableText(raw, "");
    return { summary: text, description: text };
  }

  const parentSummary = readableText(parsed.parentVisibleSummary, "");
  const studentGoal = readableText(parsed.studentGoal, "");
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.map((item) => readableText(item, "")).filter(Boolean)
    : [];
  const summaryParts = [parentSummary || studentGoal];
  if (steps.length) summaryParts.push(`具体事项：${steps.join("；")}`);
  const descriptionParts = [];
  if (studentGoal) descriptionParts.push(`学习目标：${studentGoal}`);
  if (steps.length) descriptionParts.push(`完成步骤：${steps.join("；")}`);
  if (parentSummary) descriptionParts.push(`家长查看：${parentSummary}`);
  const summary = summaryParts.filter(Boolean).join(" ");
  const description = descriptionParts.filter(Boolean).join("\n");
  return {
    summary: summary || readableText(raw, ""),
    description: description || summary || readableText(raw, "")
  };
}

function cleanQaResultForClient(result = {}) {
  const parsedAnswer = parseStructuredDisplayText(result.answer);
  const answer =
    parsedAnswer && typeof parsedAnswer === "object" && !Array.isArray(parsedAnswer)
      ? readableText(parsedAnswer.content || parsedAnswer.answer || parsedAnswer.text, result.answer)
      : readableText(result.answer, "AI 问答已收到，老师稍后会协助复核。");
  return {
    available: Boolean(result.available),
    mode: result.mode || "KNOWLEDGE_EXPLANATION",
    answer
  };
}

function readableKind(value, fallback = "练习") {
  const text = readableText(value, fallback);
  if (text.includes("试卷")) return "试卷";
  if (text.includes("小测")) return "小测";
  if (text.includes("听写")) return "听写";
  if (text.includes("作业")) return "作业";
  if (text.includes("图片") || text.includes("批改")) return "图片批改";
  if (text.includes("练习")) return "练习";
  return fallback;
}

function sanitizeLearnerPayload(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeLearnerPayload(item));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return normalizeDisplayText(value)
        .replace(/DeepSeek/gi, "AI")
        .replace(/MiniMax/gi, "AI")
        .replace(/deepseek/gi, "AI")
        .replace(/minimax/gi, "AI")
        .replace(/gpt[-\w.]*/gi, "AI");
    }
    return value;
  }
  const hiddenKeys = new Set([
    "provider",
    "providerId",
    "model",
    "modelRunId",
    "baseUrl",
    "solAttempted",
    "usedModelEscalation",
    "escalationModelRunId",
    "escalationPersistenceError"
  ]);
  const isInternalKey = (key) => {
    if (hiddenKeys.has(key)) return true;
    const normalized = String(key || "").toLowerCase();
    if (/model|provider|escalation|attempt|reasoning|budget|timeout|token|trigger|fallback|latency|internal/.test(normalized)) return true;
    return normalized !== "errorstep" && normalized.includes("error");
  };
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isInternalKey(key))
      .map(([key, item]) => [key, sanitizeLearnerPayload(item)])
  );
}

function teacherStatusToClient(status) {
  const text = String(status || "");
  if (text === "DISABLED" || text.includes("停用")) return "已停用";
  if (text === "PENDING" || text.includes("待")) return "待开通";
  return "已开通";
}

function enrollmentStatusToDb(status) {
  const text = String(status || "");
  if (text === "TRIAL" || text.includes("测试") || text.includes("试听")) return "TRIAL";
  if (text === "PAUSED" || text.includes("暂停")) return "PAUSED";
  if (text === "WITHDRAWN" || text.includes("退课")) return "WITHDRAWN";
  return "ACTIVE";
}

function mapStudent(student) {
  const profile = student.profiles?.[0]?.snapshot || {};
  const publishedProfileSnapshot = Object.keys(profile).length
    ? filterStudentProfileSnapshot(profile, "student")
    : null;
  const guardianLink = student.guardians?.[0];
  return {
    id: student.id,
    displayName: student.displayName,
    grade: student.grade || "",
    school: student.school || "",
    className: student.className || "",
    textbookVersion: student.textbookVersion || "",
    guardianName: guardianLink?.guardian?.name || "",
    guardianPhone: guardianLink?.guardian?.phone || "",
    responsibleTeacherId: student.responsibleTeacherId || "",
    responsibleTeacherName: student.responsibleTeacher?.name || "",
    accessCode: student.accessCodes?.[0]?.codePreview || null,
    enrollmentStatus: enrollmentStatusToClient(student.enrollmentStatus),
    loginEnabled: student.loginEnabled,
    registeredAt: student.createdAt.toISOString().slice(0, 10),
    focus: student.notes || "",
    weeklyScore: profile.weeklyScore ?? 0,
    streak: profile.streak ?? 0,
    mastery: profile.mastery || { 语文: 0, 数学: 0, 英语: 0 },
    strengths: profile.strengths || [],
    risks: profile.risks || [],
    tone: profile.tone || "持续观察",
    publishedProfileSnapshot,
    publishedProfileText: profile.publishedText || profile.narrative?.teacherEditedText || ""
  };
}

function mapClassroomStudent(student) {
  return {
    id: student.id,
    displayName: student.displayName,
    grade: student.grade || "",
    className: student.className || "",
    loginEnabled: student.loginEnabled,
    mastery: { 语文: 0, 数学: 0, 英语: 0 },
    strengths: [],
    risks: [],
    focus: ""
  };
}

function mapTask(task) {
  const metadata = safeJson(task.metadata, {});
  const details = taskDisplayDetails(task, metadata);
  return {
    id: task.id,
    studentId: task.studentId || "",
    studentName: task.student?.displayName || "",
    title: readableText(task.title, "今日学习任务"),
    subject: readableText(task.subject?.name || metadata.subject, "英语"),
    status: taskStatusToClient(task.status),
    minutes: metadata.minutes ?? 15,
    dueLabel: task.dueAt ? "指定日期" : "今日",
    source: readableText(metadata.source, "教师端生成"),
    knowledgePoints: (metadata.knowledgePoints || []).map((item) => readableText(item, "")).filter(Boolean),
    summary: details.summary,
    description: details.description
  };
}

function mapAssignment(assignment) {
  const metadata = safeJson(assignment.metadata, {});
  const submission = assignment.submissions?.[0] || null;
  const grading = submission?.grading?.result || metadata.grading || null;
  const kind = readableKind(metadata.kind, "练习");
  const title = readableText(assignment.title, kind === "图片批改" ? "图片批改记录" : `${kind}生成记录`);
  const subject = readableText(assignment.subject?.name || metadata.subject, "英语");
  const rawPrintProfile = safeJson(metadata.printProfile, null);
  const printProfile = rawPrintProfile
    ? {
        ...rawPrintProfile,
        subject: readableText(rawPrintProfile.subject, subject),
        answerSpace: readableText(rawPrintProfile.answerSpace, "保留完整作答区"),
        headerFields: (rawPrintProfile.headerFields || ["姓名", "日期", "得分"]).map((field) => readableText(field, "")).filter(Boolean),
        optimizationNotes: (rawPrintProfile.optimizationNotes || [])
          .map((note) => readableText(String(note || "").replace(/\?{2,}/g, kind), ""))
          .filter(Boolean),
        recommendedSections: (rawPrintProfile.recommendedSections || []).map((item) => readableText(item, "")).filter(Boolean)
      }
    : {
        paper: "A4",
        pages: kind === "试卷" ? 4 : 2,
        columns: kind === "试卷" ? 2 : 1,
        answerSpace: "保留完整作答区",
        headerFields: ["姓名", "日期", "得分"],
        optimizationNotes: []
      };
  return {
    id: assignment.id,
    studentId: metadata.targetStudentId || submission?.studentId || null,
    studentName: submission?.student?.displayName || metadata.studentName || "",
    targetScope: metadata.targetScope || (metadata.targetGrade ? "grade" : "student"),
    targetGrade: metadata.targetGrade || assignment.grade || null,
    kind,
    title,
    subject,
    status: submission ? submissionStatusToClient(submission.status) : "待完成",
    difficulty: readableText(assignment.difficulty || metadata.difficulty, "基础"),
    minutes: metadata.minutes || (kind === "试卷" ? 40 : 15),
    layoutTemplate: readableText(metadata.layoutTemplate, `${kind}排版模板`),
    printProfile,
    specialRequirements: readableText(metadata.specialRequirements, ""),
    submissionImageNames: submission?.content?.imageNames || metadata.submissionImageNames || [],
    score: submission?.grading?.score ?? null,
    totalScore: metadata.totalScore || (kind === "试卷" ? 100 : 60),
    items: assignment.items?.map((item) => item.prompt) || [],
    draftReviewStatus: metadata.draftReviewStatus || null,
    audit: metadata.audit || null,
    grading: grading?.summary
      ? grading
      : grading?.gradingText
        ? { summary: grading.gradingText, strengths: [], mistakes: [], nextPractice: "请教师复核后安排订正。" }
        : null
  };
}

function mapTextbookAsset(asset) {
  const metadata = safeJson(asset.metadata, {});
  const chapters = Array.isArray(metadata.chapters) ? metadata.chapters : [];
  return {
    id: asset.id,
    subject: readableText(asset.subject, "未识别"),
    grade: readableText(asset.grade, "未识别"),
    edition: readableText(asset.edition, "未识别"),
    volume: readableText(asset.volume, "未识别"),
    title: readableText(asset.title, "未命名教材"),
    source: asset.source || "",
    path: asset.path || "",
    relativePath: metadata.relativePath || "",
    ext: metadata.ext || "",
    size: metadata.size || 0,
    hash: asset.hash || "",
    updatedAt: asset.updatedAt?.toISOString?.() || "",
    openWith: metadata.openWith || "智慧中小学",
    openable: Boolean(asset.path && fs.existsSync(asset.path)),
    chapters,
    chapterCount: chapters.length,
    importState: metadata.importState || "只读索引"
  };
}

function normalizeTextbookChapter(input = {}, index = 0) {
  const title = readableText(input.title || input.name || input.chapterTitle, `章节 ${index + 1}`);
  const unit = readableText(input.unit || input.unitTitle, "");
  const pageStart = optionalNumber(input.pageStart || input.startPage);
  const pageEnd = optionalNumber(input.pageEnd || input.endPage);
  return {
    id: readableText(input.id, `${unit || "chapter"}-${index + 1}`).replace(/\s+/g, "-"),
    title,
    unit,
    pageStart,
    pageEnd,
    focusItems: Array.isArray(input.focusItems) ? input.focusItems.map((item) => readableText(item, "")).filter(Boolean) : [],
    dictationItems: Array.isArray(input.dictationItems) ? input.dictationItems.map((item) => readableText(item, "")).filter(Boolean) : [],
    readingSupport: readableText(input.readingSupport || input.supportNote, "")
  };
}

function mapDevice(device) {
  return {
    id: device.id,
    label: device.label,
    bindingCode: device.bindingCodePreview || "",
    grade: device.grade || "",
    className: device.className || "",
    teacherId: device.teacherId || "",
    teacherName: device.teacher?.name || "",
    status: device.status === "DISABLED" ? "已停用" : device.status === "PENDING" ? "待绑定" : "已绑定"
  };
}

function mapBroadcast(broadcast) {
  return {
    id: broadcast.id,
    deviceId: broadcast.deviceId,
    grade: broadcast.device?.grade || "",
    className: broadcast.device?.className || "",
    subject: broadcast.subject || "英语",
    title: broadcast.title,
    content: broadcast.content || "",
    voiceText: broadcast.voiceText,
    status: broadcast.status === "PLAYED" ? "已播报" : broadcast.status === "ARCHIVED" ? "已归档" : "待播报",
    createdByTeacherId: broadcast.teacherId || ""
  };
}

function mapDictation(task) {
  return {
    id: task.id,
    deviceId: task.deviceId,
    grade: task.grade || task.device?.grade || "",
    className: task.className || task.device?.className || "",
    subject: task.subject,
    title: task.title,
    items: task.items?.sort((a, b) => a.orderIndex - b.orderIndex).map((item) => item.text) || [],
    currentIndex: 0,
    difficulty: task.difficulty || "基础",
    repeats: task.repeats,
    intervalSeconds: task.intervalSeconds,
    status: task.status === "COMPLETED" ? "已完成" : task.status === "IN_PROGRESS" ? "进行中" : "待开始",
    createdByTeacherId: task.teacherId || ""
  };
}

function mapReading(task) {
  return {
    id: task.id,
    deviceId: task.deviceId,
    grade: task.grade || task.device?.grade || "",
    className: task.className || task.device?.className || "",
    subject: task.subject,
    title: task.title,
    passage: task.passage,
    focusItems: Array.isArray(task.focusItems) ? task.focusItems : [],
    supportNote: task.supportNote || "",
    status: task.status === "COMPLETED" ? "已完成" : task.status === "IN_PROGRESS" ? "跟读中" : "待跟读",
    createdByTeacherId: task.teacherId || ""
  };
}

function mapCorrection(record) {
  return {
    id: record.id,
    studentId: record.studentId || "",
    studentName: record.student?.displayName || "",
    subject: record.subject,
    point: record.metadata?.point || record.knowledgePoint?.name || record.prompt,
    prompt: record.prompt,
    studentAnswer: record.studentAnswer || "",
    correctAnswer: record.correctAnswer || "",
    cause: record.cause || "",
    state: record.masteryResolved ? "已掌握" : "待订正",
    knowledgePoint: record.knowledgePoint?.name || record.metadata?.knowledgePoint || ""
  };
}

function mapLog(event) {
  const time = event.occurredAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    id: event.id,
    time,
    feature: event.feature,
    action: event.action,
    result: event.metadata?.result || event.metadata?.summary || "",
    actorType: actorTypeToClient(event.actorType)
  };
}

function mapQaAuditEvent(session) {
  const metadata = safeJson(session.metadata, {});
  return {
    id: `qa-${session.id}`,
    time: session.createdAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    feature: "ai-qa",
    action: "ask-question",
    result: readableText(session.answer, "已生成回答").slice(0, 160),
    actorType: "student",
    studentName: session.student?.displayName || "",
    metadata: {
      ...metadata,
      studentId: session.studentId || null,
      subject: session.subject || metadata.subject || "全科",
      question: readableText(session.question, ""),
      answerPreview: readableText(session.answer, "").slice(0, 220)
    },
    occurredAt: session.createdAt
  };
}

function mapVocabularyAuditEvent(record) {
  const content = safeJson(record.content, {});
  const card = safeJson(content.card, {});
  const related = Array.isArray(card.related) ? card.related : [];
  return {
    id: `vocab-${record.id}`,
    time: record.createdAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    feature: "ai-vocabulary",
    action: "generate-card",
    result: readableText(card.meaning, "已生成词汇卡").slice(0, 120),
    actorType: "student",
    studentName: record.student?.displayName || "",
    metadata: {
      studentId: record.studentId,
      word: readableText(card.word || record.term, record.term),
      part: readableText(card.part, ""),
      partCn: readableText(card.partCn, ""),
      meaning: readableText(card.meaning, ""),
      related: related.slice(0, 4).map((item) => ({
        word: readableText(item?.word, ""),
        part: readableText(item?.part, ""),
        partCn: readableText(item?.partCn, ""),
        meaning: readableText(item?.meaning, "")
      })).filter((item) => item.word)
    },
    occurredAt: record.createdAt
  };
}

function mapReport(report, role = "student") {
  const metadata = safeJson(report.metadata, {});
  const termReport = mapTermReportForRole(report, role);
  if (metadata.termReport) return termReport;
  return {
    id: report.id,
    studentId: report.studentId || "",
    studentName: report.student?.displayName || "",
    period: metadata.period || reportTypeToClient(report.type),
    title: report.title,
    summary: report.content,
    highlights: metadata.highlights || [],
    concerns: metadata.concerns || [],
    nextActions: metadata.nextActions || []
  };
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function subjectFromValue(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("语文") || text.includes("chinese")) return "语文";
  if (text.includes("数学") || text.includes("math")) return "数学";
  if (text.includes("英语") || text.includes("english")) return "英语";
  return "英语";
}

function buildStudentProfileSnapshot(student) {
  const tasks = student.tasks || [];
  const submissions = student.submissions || [];
  const mistakes = student.mistakes || [];
  const reports = student.reports || [];
  const events = student.behaviorEvents || [];
  const qaSessions = student.qaSessions || [];
  const voiceInteractions = student.voiceInteractions || [];

  const completedTasks = tasks.filter((task) => task.status === "COMPLETED" || task.status === "REVIEWED").length;
  const taskScore = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 65;
  const gradedSubmissions = submissions.filter((item) => item.grading);
  const avgScore = gradedSubmissions.length
    ? Math.round(gradedSubmissions.reduce((sum, item) => sum + Number(item.grading?.score || 0), 0) / gradedSubmissions.length)
    : null;
  const unresolvedMistakes = mistakes.filter((item) => !item.masteryResolved);
  const activityScore = Math.min(20, events.length + qaSessions.length + voiceInteractions.length);
  const weeklyScore = clampPercent(Math.round(((avgScore ?? taskScore) * 0.55) + (taskScore * 0.25) + activityScore));

  const subjects = ["语文", "数学", "英语"];
  const mastery = Object.fromEntries(subjects.map((subject) => {
    const subjectTasks = tasks.filter((task) => subjectFromValue(task.subject?.name || task.metadata?.subject) === subject);
    const subjectSubmissions = submissions.filter((item) =>
      subjectFromValue(item.assignment?.subject?.name || safeJson(item.assignment?.metadata, {}).subject) === subject
    );
    const subjectMistakes = unresolvedMistakes.filter((item) => subjectFromValue(item.subject) === subject);
    const taskPart = subjectTasks.length
      ? (subjectTasks.filter((task) => task.status === "COMPLETED" || task.status === "REVIEWED").length / subjectTasks.length) * 35
      : 22;
    const scorePart = subjectSubmissions.length
      ? (subjectSubmissions.reduce((sum, item) => sum + Number(item.grading?.score || 0), 0) / subjectSubmissions.length) * 0.45
      : 30;
    const mistakePenalty = Math.min(30, subjectMistakes.length * 8);
    return [subject, clampPercent(taskPart + scorePart - mistakePenalty + 15)];
  }));

  const strengths = [];
  if (completedTasks > 0) strengths.push(`近期完成 ${completedTasks} 项任务，学习节奏已有记录。`);
  if (gradedSubmissions.length > 0) strengths.push(`已有 ${gradedSubmissions.length} 次批改结果，可用于后续针对性训练。`);
  if (qaSessions.length + voiceInteractions.length > 0) strengths.push(`AI问答/课堂语音互动 ${qaSessions.length + voiceInteractions.length} 次，问题意识正在沉淀。`);
  if (strengths.length === 0) strengths.push("新建档案，等待任务、批改和课堂互动继续补充。");

  const risks = unresolvedMistakes.slice(0, 5).map((item) => {
    const point = item.knowledgePoint?.name || safeJson(item.metadata, {}).point || item.prompt;
    return `${item.subject}：${point}`;
  });
  if (risks.length === 0) risks.push("暂无未解决错题，建议继续保持日常记录。");

  const latestReport = reports[0];
  const tone = latestReport
    ? `${reportTypeToClient(latestReport.type)}报告已归档`
    : unresolvedMistakes.length >= 3
      ? "需要针对性补强"
      : weeklyScore >= 80
        ? "近期状态稳定"
        : "持续观察";
  const timeline = [
    ...tasks.slice(0, 12).map((task) => ({
      type: "task",
      at: task.createdAt?.toISOString?.() || new Date().toISOString(),
      title: task.title,
      subject: task.subject?.name || task.metadata?.subject || "",
      status: taskStatusToClient(task.status),
      summary: task.description || task.metadata?.draftText || ""
    })),
    ...submissions.slice(0, 12).map((submission) => {
      const grading = safeJson(submission.grading?.result, {});
      return {
        type: "submission",
        at: submission.submittedAt?.toISOString?.() || new Date().toISOString(),
        title: submission.assignment?.title || "批改记录",
        subject: submission.assignment?.subject?.name || safeJson(submission.assignment?.metadata, {}).subject || "",
        status: submissionStatusToClient(submission.status),
        score: submission.grading?.score ?? grading.score ?? null,
        summary: grading.summary || grading.gradingText || ""
      };
    }),
    ...mistakes.slice(0, 12).map((mistake) => ({
      type: "mistake",
      at: mistake.createdAt?.toISOString?.() || new Date().toISOString(),
      title: mistake.knowledgePoint?.name || safeJson(mistake.metadata, {}).point || mistake.prompt,
      subject: mistake.subject,
      status: mistake.masteryResolved ? "已解决" : "待订正",
      summary: mistake.cause || mistake.prompt || ""
    })),
    ...reports.slice(0, 8).map((report) => ({
      type: "report",
      at: report.createdAt?.toISOString?.() || new Date().toISOString(),
      title: report.title,
      subject: "",
      status: reportTypeToClient(report.type),
      summary: report.content
    }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30);

  return {
    weeklyScore,
    streak: Math.min(30, completedTasks),
    mastery,
    strengths,
    risks,
    tone,
    generatedAt: new Date().toISOString(),
    sourceCounts: {
      tasks: tasks.length,
      submissions: submissions.length,
      mistakes: mistakes.length,
      reports: reports.length,
      behaviorEvents: events.length,
      qaSessions: qaSessions.length,
      voiceInteractions: voiceInteractions.length
    },
    recentReports: reports.slice(0, 5).map((report) => mapReport(report, "teacher")).filter(Boolean),
    unresolvedMistakes: unresolvedMistakes.slice(0, 10).map(mapCorrection),
    timeline
  };
}

function parseJsonObjectText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf("{") === -1 ? 0 : raw.indexOf("{"), raw.lastIndexOf("}") === -1 ? raw.length : raw.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function fallbackProfileNarrative(student, snapshot) {
  const riskText = (snapshot.risks || []).slice(0, 3).join("；");
  const strengthText = (snapshot.strengths || []).slice(0, 2).join("；");
  return {
    parentSummary: `${student.displayName}近期综合掌握度为 ${snapshot.weeklyScore}，${snapshot.tone}。${strengthText}`,
    teacherSummary: `规则汇总显示：任务 ${snapshot.sourceCounts.tasks} 条，批改 ${snapshot.sourceCounts.submissions} 条，未解决错题 ${snapshot.sourceCounts.mistakes} 条。`,
    weeklyFeedback: riskText ? `本周优先处理：${riskText}` : "本周暂未发现集中薄弱点，建议继续保持日常记录。",
    monthlyFeedback: "月度反馈会随着作业、批改、问答和课堂互动记录增加而自动更新。",
    midtermFeedback: "期中反馈暂以阶段错题和掌握度趋势为基础，后续可叠加测评数据。",
    finalFeedback: "期末反馈暂以长期掌握度、错题闭环和学习习惯为基础生成。",
    risks: snapshot.risks || [],
    nextActions: (snapshot.unresolvedMistakes || []).slice(0, 3).map((item) => `复盘${item.subject}：${item.point || item.prompt}`)
  };
}

async function buildStudentProfileNarrative(student, snapshot) {
  const result = await draftStudentProfileNarrative(config, {
    studentId: student.id,
    studentName: student.displayName,
    grade: student.grade,
    className: student.className,
    periodKey: snapshot.period?.label || new Date().toISOString().slice(0, 10),
    snapshot
  });
  let modelRun = null;
  if (result.modelRun) {
    modelRun = await recordModelRun(result.modelRun).catch((error) => {
      console.warn("profile narrative model run failed", error);
      return null;
    });
  }
  const parsed = parseJsonObjectText(result.narrativeText);
  return {
    structuredDraft: parsed,
    narrative: parsed ? null : fallbackProfileNarrative(student, snapshot),
    aiGenerated: result.available,
    generatedBy: "AI生成",
    modelRunId: modelRun?.id || null,
    unavailableReason: result.available ? null : result.reason || result.error || "AI生成暂不可用，请稍后重试。"
  };
}

function escapeHtml(value) {
  return normalizeDisplayText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printableItemType(item) {
  const type = String(item?.itemType || "").toLowerCase();
  if (type.includes("fill") || type.includes("填")) return "fill";
  if (type.includes("choice") || type.includes("选")) return "choice";
  if (type.includes("judgment") || type.includes("判断")) return "judgment";
  if (type.includes("calculation") || type.includes("计算") || type.includes("口算")) return "calculation";
  if (type.includes("operation") || type.includes("操作") || type.includes("画图")) return "operation";
  if (type.includes("writing") || type.includes("作文") || type.includes("表达")) return "writing";
  if (type.includes("reading") || type.includes("阅读")) return "reading";
  if (type.includes("listening") || type.includes("听力")) return "listening";
  return "solution";
}

function sectionTitleForItem(item) {
  const metadata = safeJson(item?.metadata, {});
  if (metadata.sectionTitle) return readableText(metadata.sectionTitle, "");
  return {
    fill: "一、填空题",
    choice: "二、选择题",
    judgment: "三、判断题",
    calculation: "三、计算题",
    solution: "四、解答题",
    operation: "五、操作与思考题",
    reading: "三、阅读理解",
    writing: "四、写作题",
    listening: "一、听力"
  }[printableItemType(item)] || "练习题";
}

function answerSpaceMm(item, subject = "", kind = "") {
  const metadata = safeJson(item?.metadata, {});
  const type = printableItemType(item);
  const subjectText = readableText(subject, "");
  const kindText = readableText(kind, "");
  const isExam = kindText.includes("试卷");
  const options = Array.isArray(metadata.options) ? metadata.options : [];
  const configured = Number(metadata.answerSpaceMm);
  const answerFormat = String(metadata.answerFormat || "");
  if (type === "writing" && answerFormat === "english-four-line") return configured > 0 ? Math.max(18, Math.min(configured, 54)) : 32;
  if (type === "writing" && answerFormat === "chinese-square-grid") return configured > 0 ? Math.max(72, Math.min(configured, isExam ? 96 : 148)) : isExam ? 96 : 132;
  if (answerFormat === "english-four-line" && type === "fill") return configured > 0 ? Math.max(10, Math.min(configured, 16)) : 10;
  if (answerFormat === "english-four-line" && (type === "solution" || type === "reading")) return configured > 0 ? Math.max(20, Math.min(configured, 38)) : 24;
  if (type === "choice" || type === "judgment" || type === "writing" || type === "listening") return 0;
  if (type === "fill") {
    if (/tianzige|ruled|english-four-line|english-writing/i.test(answerFormat)) return configured > 0 ? Math.max(4, Math.min(configured, 12)) : 5;
    return 0;
  }
  if (type === "reading" && options.length) return 0;
  if (configured > 0) {
    if (subjectText.includes("数学") && type === "calculation") return Math.max(10, Math.min(configured, 16));
    if (subjectText.includes("数学") && (type === "solution" || type === "operation")) return Math.max(18, Math.min(configured, 28));
    return Math.max(4, Math.min(configured, subjectText.includes("数学") ? 36 : 18));
  }
  return {
    fill: 0,
    choice: 0,
    judgment: 0,
    calculation: subjectText.includes("数学") ? 18 : 14,
    solution: subjectText.includes("数学") ? 28 : 8,
    operation: subjectText.includes("数学") ? 32 : 10,
    reading: 8,
    writing: 0,
    listening: 0
  }[printableItemType(item)] || 24;
}

function questionScoreText(item) {
  const metadata = safeJson(item?.metadata, {});
  const score = metadata.score ?? item?.score;
  return score != null && score !== "" ? `（${escapeHtml(score)}分）` : "";
}

function renderTriangleFigure(figure = {}, className = "figure-block") {
  const labels = figure.labels || ["A", "B", "C"];
  const angleLabels = safeJson(figure.angleLabels, {});
  const equalAngles = Array.isArray(figure.equalAngles) ? figure.equalAngles : [];
  return `<div class="${className}">
    <svg viewBox="0 0 340 185" role="img" aria-label="三角形示意图">
      <polygon points="170,28 54,152 286,152" fill="none" stroke="#1f2a36" stroke-width="3" />
      <text x="164" y="22">${escapeHtml(labels[0] || "A")}</text>
      <text x="38" y="174">${escapeHtml(labels[1] || "B")}</text>
      <text x="292" y="174">${escapeHtml(labels[2] || "C")}</text>
      ${angleLabels.A ? `<text x="176" y="58" class="angle">${escapeHtml(angleLabels.A)}</text>` : ""}
      ${angleLabels.B ? `<text x="64" y="143" class="angle">${escapeHtml(angleLabels.B)}</text>` : ""}
      ${angleLabels.C ? `<text x="248" y="143" class="angle">${escapeHtml(angleLabels.C)}</text>` : ""}
      ${equalAngles.includes("B") && equalAngles.includes("C") ? '<path d="M80 151 A27 27 0 0 1 68 128" fill="none" stroke="#1d5b8f" stroke-width="2"/><path d="M260 151 A27 27 0 0 0 272 128" fill="none" stroke="#1d5b8f" stroke-width="2"/>' : ""}
    </svg>
  </div>`;
}

function renderCircleSquareFigure(figure = {}, className = "figure-block") {
  const radiusLabel = figure.radiusLabel || figure.radius || "";
  const diameterLabel = figure.diameterLabel || figure.diameter || "";
  return `<div class="${className}">
    <svg viewBox="0 0 340 185" role="img" aria-label="圆内正方形示意图">
      <circle cx="170" cy="92" r="62" fill="none" stroke="#1f2a36" stroke-width="3" />
      <rect x="126" y="48" width="88" height="88" fill="none" stroke="#1f2a36" stroke-width="2.5" />
      <line x1="170" y1="92" x2="232" y2="92" stroke="#1d5b8f" stroke-width="2" />
      ${radiusLabel ? `<text x="190" y="84" class="angle">${escapeHtml(radiusLabel)}</text>` : ""}
      ${diameterLabel ? `<text x="142" y="164" class="angle">${escapeHtml(diameterLabel)}</text>` : ""}
    </svg>
  </div>`;
}

function renderPrintableFigure(item, options = {}) {
  const metadata = safeJson(item?.metadata, {});
  const figure = safeJson(metadata.figure, null);
  if (!figure) return "";
  const className = options.alignBottomRight ? "figure-block figure-bottom-right" : "figure-block";
  if (figure.type === "triangle") return renderTriangleFigure(figure, className);
  if (figure.type === "circle-square" || figure.type === "inscribed-square") return renderCircleSquareFigure(figure, className);
  if (figure.type === "rectangle") {
    const widthLabel = figure.widthLabel || figure.width || "";
    const heightLabel = figure.heightLabel || figure.height || "";
    return `<div class="${className}">
      <svg viewBox="0 0 320 170" role="img" aria-label="长方形示意图">
        <rect x="54" y="36" width="210" height="96" fill="none" stroke="#1f2a36" stroke-width="3" />
        ${widthLabel ? `<text x="143" y="154">${escapeHtml(widthLabel)}</text>` : ""}
        ${heightLabel ? `<text x="14" y="90">${escapeHtml(heightLabel)}</text>` : ""}
      </svg>
    </div>`;
  }
  if (figure.type === "circle") {
    const radiusLabel = figure.radiusLabel || figure.radius || "";
    return `<div class="${className}">
      <svg viewBox="0 0 320 170" role="img" aria-label="圆形示意图">
        <circle cx="160" cy="84" r="58" fill="none" stroke="#1f2a36" stroke-width="3" />
        <line x1="160" y1="84" x2="218" y2="84" stroke="#1d5b8f" stroke-width="2" />
        ${radiusLabel ? `<text x="178" y="76" class="angle">${escapeHtml(radiusLabel)}</text>` : ""}
      </svg>
    </div>`;
  }
  return `<div class="figure-placeholder">图形作答区</div>`;
}

function renderReadingPassage(metadata = {}) {
  const passageText = readableText(metadata.passageText, "");
  if (!passageText || metadata.showPassage === false) return "";
  const title = readableText(metadata.passageTitle, "");
  const lines = passageText.split(/\r?\n/);
  const firstLine = lines[0] || "";
  const bankMatch = firstLine.match(/^(方框词|提示词)：\s*(.+)$/);
  const bank = bankMatch
    ? `<div class="passage-word-bank"><strong>${escapeHtml(bankMatch[1])}：</strong>${bankMatch[2].trim().split(/\s+/).filter(Boolean).map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</div>`
    : "";
  const bodyText = bankMatch ? lines.slice(1).join("\n") : passageText;
  return `<div class="passage-block">
    ${title ? `<div class="passage-title">${escapeHtml(title)}</div>` : ""}
    ${bank}
    ${bodyText ? `<div class="passage-text">${escapeHtml(bodyText)}</div>` : ""}
  </div>`;
}

function needsTianzige(item, metadata = safeJson(item?.metadata, {})) {
  const prompt = readableText(item?.prompt, "");
  return metadata.answerFormat === "tianzige" || /田字格|看拼音写词语|规范书写|拼音写词/.test(prompt);
}

function renderTianzige(item, metadata = safeJson(item?.metadata, {})) {
  const words = Array.isArray(metadata.pinyinWords) && metadata.pinyinWords.length
    ? metadata.pinyinWords
    : String(item?.prompt || "")
      .match(/[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ ]+（[_＿\s]*）/g)?.slice(0, 6)
      .map((text) => ({ pinyin: text.replace(/（[\s\S]*$/, "").trim(), cells: 2 })) || [];
  const rows = words.length ? words : [{ pinyin: "拼音", cells: 4 }];
  return `<div class="tianzige-list">${rows.map((entry) => {
    const pinyin = typeof entry === "string" ? entry : entry.pinyin || entry.text || "";
    const cells = Math.max(2, Math.min(Number(entry.cells || entry.cellCount || 4) || 4, 8));
    return `<div class="tianzige-row"><div class="pinyin">${escapeHtml(pinyin)}</div><div class="tianzige-cells">${Array.from({ length: cells }).map(() => "<span></span>").join("")}</div></div>`;
  }).join("")}</div>`;
}

function renderEnglishFourLineSpace(spaceMm = 58, itemType = "") {
  const minGroups = itemType === "fill" ? 1 : 2;
  const groups = itemType === "fill"
    ? 1
    : Math.max(minGroups, Math.min(Math.ceil((Number(spaceMm) || 32) / 12), 5));
  return `<div class="english-four-line">${Array.from({ length: groups }).map(() => "<div><span></span><span></span><span></span><span></span></div>").join("")}</div>`;
}

function renderChineseSquareGrid(spaceMm = 100) {
  const rows = Math.max(8, Math.min(Math.floor((Number(spaceMm) || 120) / 8), 16));
  const cellsPerRow = 18;
  return `<div class="chinese-square-grid">${Array.from({ length: rows }).map(() =>
    `<div>${Array.from({ length: cellsPerRow }).map(() => "<span></span>").join("")}</div>`
  ).join("")}</div>`;
}

function renderAnswerSpace(item, itemType, spaceMm, subject = "") {
  const metadata = safeJson(item?.metadata, {});
  const subjectText = readableText(subject, "");
  if (metadata.answerFormat === "none") return "";
  if (needsTianzige(item, metadata)) return renderTianzige(item, metadata);
  if (metadata.answerFormat === "english-four-line") return renderEnglishFourLineSpace(spaceMm, itemType);
  if (metadata.answerFormat === "chinese-square-grid") return renderChineseSquareGrid(spaceMm);
  if (metadata.answerFormat === "ruled" || metadata.answerFormat === "reading-lines") {
    const lines = 1;
    return `<div class="ruled-lines compact">${Array.from({ length: lines }).map(() => "<span></span>").join("")}</div>`;
  }
  if (itemType === "calculation") {
    return `<div class="calculation-space" style="min-height:${spaceMm}mm"></div>`;
  }
  if (itemType === "solution" || itemType === "operation") {
    if (subjectText.includes("语文")) {
      return `<div class="ruled-lines compact"><span></span></div>`;
    }
    const className = subjectText.includes("数学") ? "work-space" : "short-response-space";
    return spaceMm > 0 ? `<div class="${className}" style="min-height:${spaceMm}mm"></div>` : "";
  }
  if (itemType === "reading") {
    if (spaceMm <= 0) return "";
    return subjectText.includes("语文")
      ? `<div class="ruled-lines compact"><span></span></div>`
      : `<div class="short-response-space" style="min-height:${spaceMm}mm"></div>`;
  }
  return spaceMm > 0 ? `<div class="answer-space" style="min-height:${spaceMm}mm"></div>` : "";
}

function renderStudentItem({ item, number, showSection, subject, kind = "", suppressWritingSpace = false }) {
  const metadata = safeJson(item?.metadata, {});
  const itemType = printableItemType(item);
  const spaceMm = answerSpaceMm(item, subject, kind);
  const options = Array.isArray(metadata.options) ? metadata.options : [];
  const compactOptions = options.length <= 4 && options.every((option) => String(option || "").length <= 18);
  const subjectText = readableText(subject, "");
  const promptText = readableText(item?.prompt || item, "");
  const promptAlreadyHasAnswerBox = /[（(][\s　_＿]*[）)]/.test(promptText);
  const needsChoiceAnswerBox = subjectText.includes("英语") && options.length > 0 && !promptAlreadyHasAnswerBox;
  const choiceAnswerBox = needsChoiceAnswerBox ? '<span class="choice-answer-box">（　　　）</span>' : "";
  const figureHtml = renderPrintableFigure(item, { alignBottomRight: subjectText.includes("数学") });
  const answerHtml = suppressWritingSpace && itemType === "writing" ? "" : renderAnswerSpace(item, itemType, spaceMm, subject);
  const bodyHtml = subjectText.includes("数学") && figureHtml
    ? `<div class="math-figure-answer-row"><div class="math-answer-area">${answerHtml}</div>${figureHtml}</div>`
    : `${figureHtml}${answerHtml}`;
  const optionsHtml = options.length
    ? `<div class="options ${compactOptions ? "four-column" : options.length <= 4 ? "two-column" : ""}">${options.map((option, optionIndex) => {
        const text = String(option || "");
        const hasLabel = /^[A-D][.、．]/i.test(text.trim());
        const label = ["A", "B", "C", "D"][optionIndex] || "";
        return `<span>${escapeHtml(hasLabel ? text : `${label}. ${text}`)}</span>`;
      }).join("")}</div>`
    : "";
  const scoreText = questionScoreText(item);
  return `${showSection ? `<h2 class="section-title">${escapeHtml(sectionTitleForItem(item))}</h2>` : ""}
    ${(itemType === "reading" || metadata.showPassage) ? renderReadingPassage(metadata) : ""}
    <div class="item item-${itemType}" data-question-id="${escapeHtml(item?.id || `question-${number}`)}" data-question-no="${escapeHtml(number)}">
      <div class="prompt"><strong>${number}.</strong><span class="score">${scoreText}</span> ${escapeHtml(promptText)}${choiceAnswerBox}</div>
      ${optionsHtml}
      ${bodyHtml}
    </div>`;
}

function splitSequentialPages(items = [], pageCount = 2, subject = "", kind = "") {
  const safePageCount = Math.max(1, pageCount);
  const pages = Array.from({ length: safePageCount }).map((_, pageIndex) => ({ pageIndex, items: [], heightPx: 0 }));
  const weighted = items.map((item, index) => {
    const type = printableItemType(item);
    const metadata = safeJson(item?.metadata, {});
    const optionCount = Array.isArray(metadata.options) ? metadata.options.length : 0;
    const compactChoice = type === "choice" && optionCount <= 4;
    const answerFormat = String(metadata.answerFormat || "");
    const passageText = readableText(metadata.passageText, "");
    const passageHeightPx = metadata.showPassage && passageText
      ? Math.min(360, Math.max(88, Math.ceil(passageText.length / 120) * 18 + 34))
      : 0;
    const spaceMm = answerSpaceMm(item, subject, kind);
    const answerSpaceHeightPx = answerFormat === "english-four-line"
      ? Math.ceil((type === "fill" ? 9 : Math.max(16, spaceMm)) * 2.35)
      : spaceMm > 0 ? Math.ceil(spaceMm * 3.2) : 0;
    const promptLineCount = Math.max(1, Math.ceil(readableText(item?.prompt, "").length / 110));
    const baseHeightPx =
      compactChoice ? 34 :
      type === "fill" && answerFormat === "english-four-line" ? 34 :
      type === "fill" || type === "judgment" || type === "listening" ? 32 :
      type === "reading" && optionCount ? 42 :
      type === "reading" ? 48 :
      type === "writing" ? 30 :
      type === "calculation" ? 52 :
      type === "operation" ? 64 :
      50;
    const estimatedHeightPx = passageHeightPx + baseHeightPx + answerSpaceHeightPx + Math.max(0, promptLineCount - 1) * 18;
    return { item, number: index + 1, estimatedHeightPx };
  });
  const subjectText = readableText(subject, "");
  const kindText = readableText(kind, "");
  const planningPageCount = safePageCount;
  const allocatableWeighted = weighted;
  const sectionWeightFor = (entry, previousEntry = null) => {
    if (!entry) return 0;
    const previousSection = previousEntry ? sectionTitleForItem(previousEntry.item) : "";
    return !previousSection || previousSection !== sectionTitleForItem(entry.item) ? 38 : 0;
  };
  const totalEstimatedHeightPx = allocatableWeighted.reduce((sum, entry, index) => {
    return sum + entry.estimatedHeightPx + sectionWeightFor(entry, allocatableWeighted[index - 1]);
  }, 0);
  const idealPageBudgetPx = Math.ceil(totalEstimatedHeightPx / planningPageCount);
  const pageBudgetFor = (index) => {
    const minBudgetPx = safePageCount >= 4
      ? subjectText.includes("语文") ? 800 : subjectText.includes("英语") ? 620 : subjectText.includes("数学") ? 470 : 580
      : subjectText.includes("英语") ? (kindText.includes("小测") ? 860 : 800) : subjectText.includes("数学") ? 650 : subjectText.includes("语文") ? 800 : 720;
    const physicalBudgetPx =
      subjectText.includes("语文") ? (index === 0 ? 820 : 850) :
      subjectText.includes("英语") ? (index === 0 ? (safePageCount >= 4 ? 820 : kindText.includes("小测") ? 980 : 860) : 900) :
      subjectText.includes("数学") ? (safePageCount >= 4 ? (index === 0 ? 650 : 700) : (index === 0 ? 760 : 820)) :
      (index === 0 ? 760 : 820);
    return Math.min(physicalBudgetPx, Math.max(minBudgetPx, Math.ceil(idealPageBudgetPx * 1.08)));
  };
  let pageIndex = 0;
  for (const entry of allocatableWeighted) {
    const page = pages[pageIndex];
    const pageBudgetPx = pageBudgetFor(pageIndex);
    const nextSection = Boolean(page.items.length && sectionTitleForItem(page.items[page.items.length - 1].item) !== sectionTitleForItem(entry.item));
    const sectionTitlePx = nextSection || !page.items.length ? 38 : 0;
    if (pageIndex < planningPageCount - 1 && page.items.length && page.heightPx + entry.estimatedHeightPx + sectionTitlePx > pageBudgetPx) {
      pageIndex += 1;
    }
    pages[pageIndex].items.push(entry);
    pages[pageIndex].heightPx += entry.estimatedHeightPx + sectionTitlePx;
  }
  for (let index = 1; index < planningPageCount; index += 1) {
    const pageBudgetPx = pageBudgetFor(index);
    while (pages[index].items.length < 2 && pages[index - 1].items.length > 3) {
      const moved = pages[index - 1].items.pop();
      const firstCurrent = pages[index].items[0]?.item;
      if (firstCurrent && sectionTitleForItem(moved.item) !== sectionTitleForItem(firstCurrent)) {
        pages[index - 1].items.push(moved);
        break;
      }
      pages[index - 1].heightPx -= moved.estimatedHeightPx;
      pages[index].items.unshift(moved);
      pages[index].heightPx += moved.estimatedHeightPx;
    }
    while (pages[index].heightPx < pageBudgetPx * 0.5 && pages[index - 1].items.length > 5) {
      const moved = pages[index - 1].items.pop();
      if (!moved) break;
      const firstCurrent = pages[index].items[0]?.item;
      if (firstCurrent && sectionTitleForItem(moved.item) !== sectionTitleForItem(firstCurrent)) {
        pages[index - 1].items.push(moved);
        break;
      }
      pages[index - 1].heightPx -= moved.estimatedHeightPx;
      pages[index].items.unshift(moved);
      pages[index].heightPx += moved.estimatedHeightPx;
    }
  }
  return pages;
}

function ensureEvenHtmlPages(html) {
  const pageCount = (html.match(/<section class="page">/g) || []).length;
  if (!pageCount || pageCount % 2 === 0) return { html, pageCount, addedBlankPage: false };
  const blankPage = `<section class="page blank-page">
  <div class="blank-page-inner">双面打印留白页</div>
</section>`;
  return {
    html: html.replace("</body>", `${blankPage}\n</body>`),
    pageCount: pageCount + 1,
    addedBlankPage: true
  };
}

function printableAssignmentHtml(assignment, options = {}) {
  const metadata = safeJson(assignment.metadata, {});
  const profile = metadata.printProfile || {};
  const items = assignment.items || [];
  const pageCount = Number(profile.pages || 2);
  const kind = readableKind(metadata.kind, "练习");
  const subject = readableText(profile.subject || metadata.subject || assignment.subject?.name, "英语");
  const columns = 1;
  const pageItems = splitSequentialPages(items, pageCount, subject, kind);
  const badgeText = options.badgeText || "AI生成 · 教师复核后打印";
  const footText = options.footText || "AI生成内容需教师复核后使用";
  const titleSuffix = options.titleSuffix || "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`${assignment.title}${titleSuffix}`)}</title>
<style>
@page { size: A4; margin: 14mm 15mm; }
body { margin: 0; color: #1f2a36; font-family: "SimSun", "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10pt; line-height: 1.42; }
.page { min-height: 269mm; box-sizing: border-box; page-break-after: always; }
.head { display: grid; grid-template-columns: 1fr auto; gap: 10px; border-bottom: 2px solid #1d5b8f; padding-bottom: 5px; }
.head-compact { border-bottom-width: 1px; padding-bottom: 3px; }
.badge { color: #1d5b8f; font-weight: 700; }
h1 { margin: 4px 0 2px; font-size: 16pt; text-align: center; font-family: "SimHei", "Microsoft YaHei", sans-serif; }
.head-compact h1 { margin: 0; font-size: 11pt; text-align: left; }
.subtitle { color: #5f6f80; font-size: 11px; }
.meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0; font-size: 12px; }
.meta span { border-bottom: 1px solid #9fb3c8; min-width: 108px; padding-bottom: 2px; }
.sections { margin: 3px 0 6px; font-size: 11px; color: #5f6f80; }
.items { column-count: ${columns}; column-gap: 18mm; }
.section-title { break-after: avoid; margin: 6px 0 4px; padding-bottom: 2px; border-bottom: 1px solid #9fb3c8; font-size: 11.5pt; text-align: left; }
.item { break-inside: avoid; margin: 0 0 4px; padding-bottom: 1px; }
.prompt { line-height: 1.48; }
.score { margin-left: 2px; color: #5f6f80; font-size: 9pt; font-weight: 400; }
.choice-answer-box { display: inline-block; margin-left: 8px; letter-spacing: 1px; }
.options { display: grid; gap: 1px 9px; margin: 2px 0 0 18px; }
.options.two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.options.four-column { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.answer-space { margin-top: 3px; background: #fff; }
.short-answer-line { height: 5mm; margin: 2px 0 0 18px; }
.calculation-space, .work-space, .short-response-space { margin: 3px 0 1px 18px; background: #fff; }
.calculation-space, .work-space { border: 0; }
.short-response-space { border: 0; }
.ruled-lines { margin: 4px 0 1px 18px; }
.ruled-lines span { display: block; height: 7mm; border-bottom: 1px solid #b9c6d3; }
.ruled-lines.compact { margin-top: 2px; }
.ruled-lines.compact span { height: 5.5mm; }
.tianzige-list { margin: 5px 0 3px 18px; display: flex; flex-wrap: wrap; gap: 7mm 10mm; align-items: flex-end; }
.tianzige-row { display: inline-flex; flex-direction: column; align-items: center; break-inside: avoid; }
.tianzige-row .pinyin { min-height: 5mm; margin-bottom: 1.5mm; text-align: center; font-family: Arial, sans-serif; font-size: 9.5pt; color: #1f2a36; }
.tianzige-cells { display: flex; gap: 1.2mm; }
.tianzige-cells span { width: 11mm; height: 11mm; border: 1px solid #111; box-sizing: border-box; position: relative; background: #fff; }
.tianzige-cells span::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 1px solid #111; transform: translateX(-0.5px); }
.tianzige-cells span::after { content: ""; position: absolute; top: 50%; left: 0; right: 0; border-top: 1px solid #111; transform: translateY(-0.5px); }
.english-four-line { margin: 2mm 0 0.5mm 18px; }
.english-four-line div { height: 6.6mm; position: relative; margin-bottom: 0.8mm; }
.english-four-line span { display: block; height: 1.55mm; border-bottom: 1px solid #b9c6d3; }
.chinese-square-grid { margin: 5mm 0 1mm 0; }
.chinese-square-grid div { display: grid; grid-template-columns: repeat(18, 1fr); }
.chinese-square-grid span { aspect-ratio: 1 / 1; border: 1px solid #111; border-right-width: 0; border-bottom-width: 0; box-sizing: border-box; background: #fff; }
.chinese-square-grid div span:last-child { border-right-width: 1px; }
.chinese-square-grid div:last-child span { border-bottom-width: 1px; }
.item-fill .answer-space, .item-choice .answer-space, .item-judgment .answer-space { border-bottom: 0; }
.passage-block { break-inside: avoid; margin: 2px 0 3px; padding: 3px 6px; border: 1px solid #c8d4df; background: #fbfdff; }
.passage-title { margin-bottom: 4px; font-weight: 700; text-align: center; }
.passage-word-bank { display: flex; flex-wrap: wrap; gap: 5px 9px; align-items: center; margin-bottom: 4px; line-height: 1.2; }
.passage-word-bank strong { margin-right: 1px; font-weight: 700; }
.passage-word-bank span { display: inline-block; padding: 1px 5px; border: 1px solid #b9c6d3; border-radius: 2px; background: #fff; font-family: Arial, sans-serif; }
.passage-text { line-height: 1.12; text-align: left; white-space: pre-wrap; }
.figure-block { display: flex; justify-content: center; margin: 4px 0 3px; }
.math-figure-answer-row { display: grid; grid-template-columns: minmax(0, 1fr) 48mm; column-gap: 5mm; align-items: end; }
.math-figure-answer-row .figure-block { justify-content: flex-end; align-self: end; margin: 1mm 0 0; }
.math-figure-answer-row .figure-block svg { width: 44mm; height: 23mm; }
.math-answer-area:empty { min-height: 8mm; }
.figure-block svg { width: 46mm; height: 24mm; }
.figure-block text { fill: #1f2a36; font-size: 15px; font-family: "Microsoft YaHei", sans-serif; }
.figure-block .angle { fill: #1d5b8f; font-size: 13px; font-weight: 700; }
.figure-placeholder { min-height: 30mm; margin: 8px 0; border: 1px dashed #9fb3c8; display: flex; align-items: center; justify-content: center; color: #6a7887; }
.foot { display: none; }
.blank-page { display: flex; align-items: center; justify-content: center; color: #9aa7b5; font-size: 12px; }
.blank-page-inner { border: 1px dashed #c8d4df; padding: 12px 18px; }
</style>
</head>
<body>
${pageItems.map(({ pageIndex, items: currentItems }) => {
  const isFirstPage = pageIndex === 0;
  const previousPageItems = pageIndex > 0 ? pageItems[pageIndex - 1]?.items || [] : [];
  const previousPageLastSection = previousPageItems.length ? sectionTitleForItem(previousPageItems[previousPageItems.length - 1].item) : "";
  const suppressWritingSpace = currentItems.some(({ item }) => printableItemType(item) === "writing") &&
    (
      (subject.includes("英语") && (
        currentItems.some(({ item }) => printableItemType(item) === "reading") ||
        (pageItems[pageIndex]?.heightPx || 0) > 830
      ))
    );
  return `<section class="page">
  <div class="head ${isFirstPage ? "" : "head-compact"}">
    <div>${isFirstPage ? `<span class="badge">${escapeHtml(badgeText)}</span>` : ""}<h1>${escapeHtml(isFirstPage ? assignment.title : `${assignment.title}（续）`)}</h1>${isFirstPage ? `<div class="subtitle">${escapeHtml(subject)} · ${escapeHtml(profile.answerSpace || "")}</div>` : ""}</div>
    <strong>${escapeHtml(kind)} · A4 · 第${pageIndex + 1}/${pageCount}页</strong>
  </div>
  ${isFirstPage ? `<div class="meta">${(profile.headerFields || ["姓名", "日期", "得分"]).map((field) => `<span>${escapeHtml(field)}：</span>`).join("")}</div>` : ""}
  ${isFirstPage ? `<div class="sections">${escapeHtml((profile.recommendedSections || []).join(" / "))}</div>` : ""}
  <div class="items">${currentItems.length ? currentItems.map(({ item, number }, index, list) => {
    const currentSection = sectionTitleForItem(item);
    const previousSection = index > 0 ? sectionTitleForItem(list[index - 1]?.item) : previousPageLastSection;
    return renderStudentItem({ item, number, showSection: !previousSection || previousSection !== currentSection, subject, kind, suppressWritingSpace });
  }).join("") : '<div class="blank-page-inner">本页留白，便于双面打印。</div>'}</div>
  ${footText ? "" : ""}
</section>`;
}).join("")}
</body>
</html>`;
}

function formatPrintableValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return normalizeDisplayText(value);
  if (Array.isArray(value)) return value.map(formatPrintableValue).filter(Boolean).join("；");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${formatPrintableValue(item)}`)
      .filter((item) => !item.endsWith(": "))
      .join("；");
  }
  return normalizeDisplayText(value);
}

function printableAnalysisSteps(item) {
  const metadata = safeJson(item?.metadata, {});
  const configured = Array.isArray(metadata.analysisSteps) ? metadata.analysisSteps.map(formatPrintableValue).filter(Boolean) : [];
  if (configured.length) return configured;
  const rubric = formatPrintableValue(item?.rubric || metadata.analysis || metadata.rubric || "");
  return rubric ? [rubric] : ["先整理题目给出的条件。", "根据对应知识点列出计算或判断依据。", "写出结论，并检查单位、符号和答句是否完整。"];
}

function itemAnswerForManifest(item, index, answerKey = null) {
  const metadata = safeJson(item?.metadata, {});
  return formatPrintableValue(item?.answer) ||
    formatPrintableValue(metadata.answer || metadata.correctAnswer || metadata.standardAnswer || "") ||
    formatPrintableValue(answerKey?.[index] || answerKey?.[String(index + 1)] || "");
}

function questionScoreNumber(item) {
  const metadata = safeJson(item?.metadata, {});
  return optionalNumber(metadata.score ?? item?.score ?? metadata.points ?? null);
}

function buildQuestionLayoutManifest(assignment, options = {}) {
  const metadata = safeJson(assignment.metadata, {});
  const profile = metadata.printProfile || {};
  const items = assignment.items || [];
  const answerKey = safeJson(metadata.answerKey, null);
  const pageCount = Number(profile.pages || options.pageCount || 2);
  const kind = readableKind(metadata.kind, "练习");
  const subject = readableText(profile.subject || metadata.subject || assignment.subject?.name, "英语");
  const pageItems = splitSequentialPages(items, pageCount, subject, kind);
  const questions = [];
  for (const page of pageItems) {
    const entries = page.items || [];
    const previousEntry = page.pageIndex > 0 ? pageItems[page.pageIndex - 1]?.items?.at(-1) : null;
    let previousSection = previousEntry ? sectionTitleForItem(previousEntry.item) : "";
    const weights = entries.map((entry) => {
      const currentSection = sectionTitleForItem(entry.item);
      const sectionWeight = !previousSection || previousSection !== currentSection ? 38 : 0;
      previousSection = currentSection;
      return Math.max(34, Number(entry.estimatedHeightPx || 50) + sectionWeight);
    });
    const totalWeight = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
    const top = page.pageIndex === 0 ? 0.15 : 0.08;
    const usableHeight = page.pageIndex === 0 ? 0.79 : 0.86;
    let cursor = top;
    for (const [index, entry] of entries.entries()) {
      const item = entry.item || {};
      const itemMetadata = safeJson(item.metadata, {});
      const height = Math.max(0.045, Math.min(0.26, (weights[index] / totalWeight) * usableHeight));
      const bboxHeight = Math.max(0.035, Math.min(height, Math.max(0.035, 0.94 - cursor)));
      const bbox = {
        page: page.pageIndex + 1,
        x: 0.06,
        y: Number(Math.min(0.94, cursor).toFixed(4)),
        w: 0.88,
        h: Number(bboxHeight.toFixed(4))
      };
      questions.push({
        assignmentItemId: item.id || null,
        orderIndex: item.orderIndex || entry.number || questions.length + 1,
        questionNo: String(entry.number || questions.length + 1),
        sectionTitle: sectionTitleForItem(item),
        itemType: printableItemType(item),
        prompt: readableText(item.prompt, ""),
        answer: itemAnswerForManifest(item, Number(entry.number || questions.length + 1) - 1, answerKey),
        analysisSteps: printableAnalysisSteps(item),
        knowledgePoint: formatPrintableValue(itemMetadata.knowledgePoint || itemMetadata.point || ""),
        commonMistake: formatPrintableValue(itemMetadata.commonMistake || ""),
        score: questionScoreNumber(item),
        page: page.pageIndex + 1,
        bbox,
        answerSpace: {
          format: itemMetadata.answerFormat || null,
          estimatedMm: answerSpaceMm(item, subject, kind)
        }
      });
      cursor += height;
    }
  }
  return {
    version: "question-layout-manifest-v1",
    source: "assessment-print-export",
    assignmentId: assignment.id,
    role: options.role || "student-paper",
    title: assignment.title,
    subject,
    kind,
    layoutTemplate: metadata.layoutTemplate || null,
    printProfile: profile,
    pageCount: options.pdfPageCount || options.htmlPageCount || pageItems.length,
    plannedPageCount: pageItems.length,
    questionCount: questions.length,
    generatedAt: new Date().toISOString(),
    questions
  };
}

async function findLatestQuestionLayoutManifest(assignmentId) {
  if (!assignmentId) return null;
  const assets = await prisma.generatedAsset.findMany({
    where: { kind: { contains: "assessment-print" } },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  for (const asset of assets) {
    const metadata = safeJson(asset.metadata, {});
    if (metadata.assignmentId !== assignmentId) continue;
    const manifest = safeJson(metadata.questionLayoutManifest, null);
    if (manifest?.questions?.length) {
      return {
        ...manifest,
        assetId: asset.id,
        assetUrl: asset.url || null
      };
    }
  }
  return null;
}

function mergeQuestionLayoutMeasurements(manifest, measurement = null, options = {}) {
  const measuredQuestions = Array.isArray(measurement?.questions) ? measurement.questions : [];
  const byQuestionNo = new Map(measuredQuestions.map((item) => [String(item.questionNo || ""), item]));
  const byQuestionId = new Map(measuredQuestions.map((item) => [String(item.questionId || ""), item]));
  const measured = Boolean(measurement?.ok && measuredQuestions.length);
  return {
    ...manifest,
    pageCount: options.pdfPageCount || options.htmlPageCount || manifest.pageCount,
    htmlPageCount: options.htmlPageCount || null,
    pdfPageCount: options.pdfPageCount || null,
    coordinateSource: measured ? "browser-dom" : "estimated",
    coordinateReason: measured ? null : measurement?.reason || "未执行浏览器坐标测量，已使用估算坐标。",
    measuredAt: measurement?.measuredAt || null,
    questions: (manifest.questions || []).map((question) => {
      const match = byQuestionId.get(String(question.assignmentItemId || "")) ||
        byQuestionNo.get(String(question.questionNo || ""));
      if (!match?.bbox) {
        return {
          ...question,
          bboxSource: "estimated"
        };
      }
      return {
        ...question,
        bbox: match.bbox,
        renderedBBox: match.bbox,
        bboxSource: "browser-dom"
      };
    })
  };
}

function mergeGenerationPipeline(metadata = {}, patch = {}) {
  const current = safeJson(metadata.generationPipeline, {});
  return {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    gates: {
      ...(current.gates || {}),
      ...(patch.gates || {})
    },
    assets: {
      ...(current.assets || {}),
      ...(patch.assets || {})
    },
    review: {
      ...(current.review || {}),
      ...(patch.review || {})
    }
  };
}

function answerAnalysisHtml(assignment) {
  const metadata = safeJson(assignment.metadata, {});
  const profile = metadata.printProfile || {};
  const items = assignment.items || [];
  const answerKey = safeJson(metadata.answerKey, null);
  const kind = readableKind(metadata.kind, "练习");
  const subject = readableText(profile.subject || metadata.subject || assignment.subject?.name, "英语");
  const notes = Array.isArray(metadata.printNotes) ? metadata.printNotes : [];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(assignment.title)} - 解析</title>
<style>
@page { size: A4; margin: 12mm 13mm; }
body { margin: 0; color: #1f2a36; font-family: "SimSun", "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 9.2pt; line-height: 1.34; }
.page { min-height: auto; page-break-after: auto; }
.head { border-bottom: 2px solid #1d5b8f; padding-bottom: 6px; margin-bottom: 7px; }
.badge { color: #1d5b8f; font-weight: 700; }
h1 { margin: 4px 0 2px; font-size: 15pt; text-align: center; font-family: "SimHei", "Microsoft YaHei", sans-serif; }
.subtitle, .foot { color: #5f6f80; font-size: 12px; }
.item { break-inside: avoid; margin: 0 0 5px; padding: 4px 0 6px; border-bottom: 1px dashed #c6d1dd; }
.prompt { font-weight: 700; line-height: 1.36; }
.answer, .analysis, .point, .mistake { margin-top: 3px; }
.label { display: inline-block; min-width: 58px; color: #1d5b8f; font-weight: 700; }
.steps { margin: 2px 0 0 58px; padding-left: 15px; }
.steps li { margin: 1px 0; }
.mistake { color: #8a4b20; }
.empty { color: #7b8794; }
</style>
</head>
<body>
<section class="page">
  <div class="head">
    <span class="badge">AI生成 · 教师复核用解析</span>
    <h1>${escapeHtml(assignment.title)} 题目解析</h1>
    <div class="subtitle">${escapeHtml(subject)} · ${escapeHtml(kind)} · 与学生题目 PDF 配套使用</div>
  </div>
  ${(items.length ? items : [{ prompt: "请教师补充题目内容。", answer: "", rubric: "" }]).map((item, index) => {
    const metadata = safeJson(item.metadata, {});
    const answer = formatPrintableValue(item.answer) || formatPrintableValue(answerKey?.[index] || answerKey?.[String(index + 1)] || "");
    const point = formatPrintableValue(metadata.knowledgePoint || metadata.point || "");
    const steps = printableAnalysisSteps(item);
    const commonMistake = formatPrintableValue(metadata.commonMistake || "");
    return `<div class="item">
      <div class="prompt">${index + 1}. ${escapeHtml(item.prompt || item)}</div>
      <div class="answer"><span class="label">答案</span>${answer ? escapeHtml(answer) : "<span class='empty'>等待教师补充或复核</span>"}</div>
      <div class="analysis"><span class="label">解析步骤</span><ol class="steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div>
      ${point ? `<div class="point"><span class="label">考点</span>${escapeHtml(point)}</div>` : ""}
      ${commonMistake ? `<div class="mistake"><span class="label">易错提醒</span>${escapeHtml(commonMistake)}</div>` : ""}
    </div>`;
  }).join("")}
  <div class="foot">${escapeHtml(notes.join(" / "))}</div>
</section>
</body>
</html>`;
}

function findPrintBrowser() {
  const candidates = [
    config.PRINT_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function renderPdfFromHtml(htmlPath, pdfPath) {
  const browserPath = findPrintBrowser();
  if (!browserPath) {
    return { ok: false, reason: "未配置 PDF 渲染运行时。" };
  }
  const htmlText = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
  const visibleText = htmlText.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  if (visibleText.length < 20) {
    return { ok: false, reason: "排版稿 HTML 内容为空，已阻止生成空白 PDF。" };
  }
  await execFileAsync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href
  ], { timeout: 30000, windowsHide: true });
  return fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1024
    ? { ok: true, browserPath }
    : { ok: false, reason: "PDF 渲染结果为空或文件过小。" };
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function measureQuestionLayoutFromHtml(htmlPath) {
  const browserPath = findPrintBrowser();
  if (!browserPath) return { ok: false, reason: "未配置浏览器渲染运行时，已使用估算坐标。" };
  if (!fs.existsSync(htmlPath)) return { ok: false, reason: "排版稿 HTML 不存在，已使用估算坐标。" };
  const marker = "__QUESTION_LAYOUT_JSON__";
  const sourceHtml = fs.readFileSync(htmlPath, "utf8");
  const script = `<script>
(() => {
  const marker = "${marker}";
  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const round = (value) => Number(value.toFixed(4));
  const run = () => {
    const pages = Array.from(document.querySelectorAll("section.page"));
    const questions = Array.from(document.querySelectorAll("[data-question-no]")).map((el) => {
      const page = el.closest("section.page");
      const pageIndex = Math.max(0, pages.indexOf(page));
      const pageRect = page ? page.getBoundingClientRect() : document.body.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, pageRect.width);
      const height = Math.max(1, pageRect.height);
      return {
        questionId: el.getAttribute("data-question-id") || null,
        questionNo: el.getAttribute("data-question-no") || "",
        page: pageIndex + 1,
        bbox: {
          page: pageIndex + 1,
          x: round(clamp((rect.left - pageRect.left) / width)),
          y: round(clamp((rect.top - pageRect.top) / height)),
          w: round(clamp(rect.width / width)),
          h: round(clamp(rect.height / height))
        }
      };
    });
    document.body.innerHTML = '<pre id="' + marker + '"></pre>';
    document.getElementById(marker).textContent = JSON.stringify({
      pageCount: pages.length,
      measuredAt: new Date().toISOString(),
      questions
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>`;
  const measurePath = path.join(os.tmpdir(), `${path.basename(htmlPath, ".html")}-${Date.now()}-measure.html`);
  fs.writeFileSync(measurePath, sourceHtml.replace("</body>", `${script}</body>`), "utf8");
  try {
    const output = await execFileAsync(browserPath, [
      "--headless",
      "--disable-gpu",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1500",
      "--dump-dom",
      pathToFileURL(measurePath).href
    ], { timeout: 30000, windowsHide: true });
    const stdout = String(output.stdout || "");
    const match = stdout.match(new RegExp(`<pre id="${marker}">([\\s\\S]*?)<\\/pre>`));
    if (!match) return { ok: false, reason: "浏览器未返回题目坐标，已使用估算坐标。" };
    const parsed = JSON.parse(decodeHtmlText(match[1]));
    return {
      ok: true,
      browserPath,
      pageCount: parsed.pageCount || 0,
      measuredAt: parsed.measuredAt || new Date().toISOString(),
      questions: Array.isArray(parsed.questions) ? parsed.questions : []
    };
  } catch (error) {
    return {
      ok: false,
      reason: `浏览器坐标测量失败：${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    fs.rmSync(measurePath, { force: true });
  }
}

function countPdfPages(pdfPath) {
  if (!fs.existsSync(pdfPath)) return null;
  const content = fs.readFileSync(pdfPath, "latin1");
  const matches = content.match(/\/Type\s*\/Page\b/g);
  return matches?.length || null;
}

function addPdfBlankPage(pdfPath) {
  if (!fs.existsSync(pdfPath)) return false;
  const original = fs.readFileSync(pdfPath, "latin1");
  const trailerMatch = original.match(/trailer\s*<<[\s\S]*?\/Root\s+(\d+)\s+0\s+R[\s\S]*?>>/);
  const pagesMatch = original.match(/(\d+)\s+0\s+obj\s*<<[\s\S]*?\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([\s\S]*?)\][\s\S]*?\/Count\s+(\d+)[\s\S]*?>>\s*endobj/);
  const startXrefIndex = original.lastIndexOf("startxref");
  if (!trailerMatch || !pagesMatch || startXrefIndex < 0) return false;
  const rootId = Number(trailerMatch[1]);
  const pagesId = Number(pagesMatch[1]);
  const existingKids = pagesMatch[2].trim();
  const existingCount = Number(pagesMatch[3]);
  const objectIds = [...original.matchAll(/(?:^|\n)(\d+)\s+0\s+obj/g)].map((match) => Number(match[1]));
  const pageId = Math.max(...objectIds) + 1;
  const contentId = pageId + 1;
  const infoMatch = original.match(/\/Info\s+(\d+)\s+0\s+R/);
  const previous = original.slice(0, startXrefIndex).trimEnd();
  const pagesObjectPattern = new RegExp(`${pagesId}\\s+0\\s+obj\\s*<<[\\s\\S]*?\\/Type\\s*\\/Pages[\\s\\S]*?>>\\s*endobj`);
  const updatedPagesObject = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${existingKids} ${pageId} 0 R] /Count ${existingCount + 1} >>\nendobj`;
  const rewritten = previous.replace(pagesObjectPattern, updatedPagesObject);
  const blankText = "BT /F1 10 Tf 250 420 Td (Blank page for duplex printing) Tj ET";
  const newObjects = [
    `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.92 841.92] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>\nendobj`,
    `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(blankText, "latin1")} >>\nstream\n${blankText}\nendstream\nendobj`
  ];
  let output = `${rewritten}\n${newObjects.join("\n")}\n`;
  const offsets = [0];
  const objectPattern = /(?:^|\n)(\d+)\s+0\s+obj/g;
  const ids = [];
  for (const match of output.matchAll(objectPattern)) {
    ids.push(Number(match[1]));
  }
  const maxId = Math.max(...ids);
  const offsetMap = new Map();
  for (const match of output.matchAll(objectPattern)) {
    const id = Number(match[1]);
    const offset = match.index + (match[0].startsWith("\n") ? 1 : 0);
    offsetMap.set(id, offset);
  }
  const xrefStart = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    const offset = offsetMap.get(id) || 0;
    output += `${String(offset).padStart(10, "0")} 00000 ${offset ? "n" : "f"} \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root ${rootId} 0 R${infoMatch ? ` /Info ${infoMatch[1]} 0 R` : ""} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  fs.writeFileSync(pdfPath, output, "latin1");
  return true;
}

function ensureEvenPdfPages(pdfPath) {
  const pageCount = countPdfPages(pdfPath);
  if (!pageCount || pageCount % 2 === 0) return { pageCount, addedBlankPage: false };
  const addedBlankPage = addPdfBlankPage(pdfPath);
  return { pageCount: addedBlankPage ? pageCount + 1 : pageCount, addedBlankPage };
}

function normalizeGeneratedHtml(html) {
  return normalizeDisplayText(html);
}

async function exportAssessmentPaperAsset(req, assignment, options = {}) {
  const metadata = safeJson(assignment.metadata, {});
  const suffix = options.suffix || "print";
  const titleSuffix = options.titleSuffix || "题目";
  const assetRole = options.role || "student-paper";
  const assetKind = options.kind || "assessment-print";
  const paperHtmlResult = ensureEvenHtmlPages(normalizeGeneratedHtml(printableAssignmentHtml(assignment, options.htmlOptions || {})));
  const htmlFileName = `${assignment.id}-${suffix}.html`;
  const pdfFileName = `${assignment.id}-${suffix}.pdf`;
  fs.mkdirSync(storageGeneratedRoot(), { recursive: true });
  const htmlPath = path.join(storageGeneratedRoot(), htmlFileName);
  const pdfPath = path.join(storageGeneratedRoot(), pdfFileName);
  fs.writeFileSync(htmlPath, paperHtmlResult.html, "utf8");
  const measuredLayout = await measureQuestionLayoutFromHtml(htmlPath);
  const pdfResult = await renderPdfFromHtml(htmlPath, pdfPath).catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error)
  }));
  const evenPdf = pdfResult.ok ? ensureEvenPdfPages(pdfPath) : { pageCount: null, addedBlankPage: false };
  const outputFileName = pdfResult.ok ? pdfFileName : htmlFileName;
  const questionLayoutManifest = mergeQuestionLayoutMeasurements(
    buildQuestionLayoutManifest(assignment, {
      role: assetRole,
      htmlPageCount: paperHtmlResult.pageCount,
      pdfPageCount: evenPdf.pageCount
    }),
    measuredLayout,
    {
      htmlPageCount: paperHtmlResult.pageCount,
      pdfPageCount: evenPdf.pageCount
    }
  );
  const asset = await prisma.generatedAsset.create({
    data: {
      kind: `${assetKind}-${pdfResult.ok ? "pdf" : "html"}`,
      title: `${assignment.title} - ${titleSuffix}`,
      path: path.join(storageGeneratedRoot(), outputFileName),
      url: publicGeneratedUrl(outputFileName, req),
      metadata: {
        assignmentId: assignment.id,
        role: assetRole,
        printProfile: metadata.printProfile || null,
        layoutTemplate: metadata.layoutTemplate || null,
        audit: metadata.audit || null,
        htmlUrl: publicGeneratedUrl(htmlFileName, req),
        htmlPageCount: paperHtmlResult.pageCount,
        addedBlankPage: paperHtmlResult.addedBlankPage,
        pdfPageCount: evenPdf.pageCount,
        pdfAddedBlankPage: evenPdf.addedBlankPage,
        questionLayoutManifest,
        pdfGenerated: pdfResult.ok,
        pdfReason: pdfResult.ok ? null : pdfResult.reason,
        reviewStatus: options.reviewStatus || null,
        note: options.note || (pdfResult.ok ? "A4 PDF generated from deterministic HTML layout." : "HTML print export generated; PDF rendering unavailable.")
      }
    }
  });
  return { asset, pdfResult, htmlFileName, pdfFileName, outputFileName, htmlResult: paperHtmlResult, evenPdf };
}

function normalizeReviewResultForDisplay(result = {}, storedScore = null) {
  const score = optionalNumber(result.score ?? storedScore);
  if (result.reviewStatus === "reviewed") return { result, score };
  const questions = Array.isArray(result.questionResults) ? result.questionResults : [];
  const uncertainCount = questions.filter((item) => item.status === "uncertain").length;
  const uncertainRatio = questions.length ? uncertainCount / questions.length : 0;
  const summary = String(result.summary || result.gradingText || "");
  const riskText = /缺少标准答案|缺少试卷原图|无原图|无法确认|无法判定|OCR 未|识别信息不足|未提取到清晰|图形.*无法/i.test(summary);
  const lowConfidence = riskText || uncertainRatio >= 0.25 || result.reviewStatus === "low_confidence_needs_review";
  if (!lowConfidence) return { result, score };
  return {
    score: null,
    result: {
      ...result,
      score: null,
      provisionalScore: result.provisionalScore ?? score,
      reviewStatus: "low_confidence_needs_review",
      needsTeacherReview: true,
      archiveEligible: false,
      summary: String(result.summary || "").startsWith("AI初判置信不足")
        ? result.summary
        : `AI初判置信不足，暂不生成最终分数，需教师复核后才可归档。${result.summary ? ` 原始AI初判：${result.summary}` : ""}`,
      quality: {
        ...(result.quality || {}),
        lowConfidence: true,
        uncertainCount,
        totalQuestions: questions.length,
        uncertainRatio: Number(uncertainRatio.toFixed(3)),
        reason: "旧记录展示降级：存在较多无法确认内容，需教师复核。"
      }
    }
  };
}

function mapReviewSubmission(submission) {
  const assignmentMetadata = safeJson(submission.assignment?.metadata, {});
  const content = safeJson(submission.content, {});
  const rawResult = safeJson(submission.grading?.result, {});
  const { result, score } = normalizeReviewResultForDisplay(rawResult, submission.grading?.score ?? null);
  const kind = readableKind(assignmentMetadata.kind, "图片批改");
  const subject = readableText(submission.assignment?.subject?.name || assignmentMetadata.subject || content.subject, "未标科目");
  const rawTitle = readableText(submission.assignment?.title, `${kind}记录`);
  const assignmentTitle = rawTitle.startsWith("async-upload-selfcheck")
    ? "图片批改自检记录"
    : rawTitle;
  const ocr = {
    ...buildOcrMeta({
      uploadedBy: content.uploadedBy || assignmentMetadata.uploadedBy,
      ocrText: content.ocrText || assignmentMetadata.note,
      ocrStatus: content.ocrStatus,
      manualText: content.manualText,
      pageNumber: content.pageNumber,
      questionRange: content.questionRange,
      imageIndex: content.imageIndex,
      imageTotal: content.imageTotal || assignmentMetadata.expectedImageCount
    }),
    ...safeJson(content.ocr, {}),
    imageQuality: safeJson(content.imageQuality || safeJson(content.ocr, {}).imageQuality, null)
  };
  return {
    id: submission.id,
    assignmentId: submission.assignmentId,
    assignmentTitle,
    studentId: submission.studentId,
    studentName: submission.student?.displayName || "",
    subject,
    kind,
    status: submission.status,
    needsReview: submission.status !== "GRADED" || Boolean(submission.grading?.needsReview),
    score,
    imageNames: content.imageNames || [],
    imageFiles: (content.imageFiles || []).map((file) => ({
      ...file,
      url: file.url || publicUploadUrl(file.relativePath || file.fileName, null)
    })),
    uploadedBy: content.uploadedBy || assignmentMetadata.uploadedBy || "",
    batchId: content.uploadBatchId || assignmentMetadata.uploadBatchId || null,
    imageIndex: ocr.imageIndex || content.imageIndex || null,
    imageTotal: ocr.imageTotal || content.imageTotal || assignmentMetadata.expectedImageCount || null,
    pageNumber: ocr.pageNumber || null,
    questionRange: ocr.questionRange || "",
    ocr,
    ocrStatusLabel: ocrStatusToClient(ocr.status),
    ocrTextPreview: String(ocr.manualText || ocr.text || "").slice(0, 120),
    gradingSummary: result.summary || result.gradingText || "",
    structuredGrading: {
      score,
      summary: result.summary || result.gradingText || "",
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      mistakes: Array.isArray(result.mistakes) ? result.mistakes : [],
      questionResults: Array.isArray(result.questionResults) ? result.questionResults : [],
      annotationMarkers: Array.isArray(result.annotationMarkers) ? result.annotationMarkers : [],
      nextPractice: result.nextPractice || "",
      reviewStatus: result.reviewStatus || (submission.grading?.needsReview ? "pending_teacher_review" : "reviewed"),
      aiGenerated: Boolean(result.aiGenerated ?? result.available),
      needsTeacherReview: Boolean(result.needsTeacherReview ?? submission.grading?.needsReview),
      provisionalScore: result.provisionalScore ?? null,
      archiveEligible: Boolean(result.archiveEligible),
      referenceAnswerMode: result.referenceAnswerMode || "",
      questionLayoutManifest: result.questionLayoutManifest || content.questionLayoutManifest || null,
      quality: result.quality || null
    },
    submittedAt: submission.submittedAt.toISOString()
  };
}

function normalizeQuestionWorkbenchItem(question = {}, index = 0, markers = []) {
  const questionNo = String(question.questionNo || question.no || index + 1);
  const marker = markers.find((item) => String(item.questionNo) === questionNo);
  const bbox = question.bbox || marker
    ? {
        page: Number(question.bbox?.page || marker?.page || 1),
        x: Number(question.bbox?.x ?? marker?.x ?? 0.08),
        y: Number(question.bbox?.y ?? marker?.y ?? Math.min(0.12 + index * 0.07, 0.86)),
        w: Number(question.bbox?.w ?? marker?.w ?? 0.18),
        h: Number(question.bbox?.h ?? marker?.h ?? 0.08)
      }
    : { page: 1, x: 0.08, y: Math.min(0.12 + index * 0.07, 0.86), w: 0.18, h: 0.08 };
  return {
    id: String(question.id || `question-${questionNo}`),
    questionNo,
    status: question.status || "uncertain",
    score: optionalNumber(question.score),
    maxScore: optionalNumber(question.maxScore || question.fullScore),
    studentAnswer: question.studentAnswer || "",
    correctAnswer: question.correctAnswer || "",
    studentProcess: Array.isArray(question.studentProcess) ? question.studentProcess : [],
    errorStep: question.errorStep || "",
    explanation: question.explanation || "",
    knowledgePoint: question.knowledgePoint || "",
    suggestedPractice: question.suggestedPractice || "",
    teacherNote: question.teacherNote || "",
    reviewedByTeacher: question.reviewedByTeacher === true,
    reviewedAt: question.reviewedAt || null,
    confidence: optionalNumber(question.confidence) ?? null,
    bbox
  };
}

function markerLabelForQuestionStatus(status) {
  return status === "correct" ? "对" : status === "wrong" ? "错" : status === "partial" ? "半" : "疑";
}

function normalizeQuestionReviewPatch(body = {}, currentQuestion = {}) {
  const allowedStatuses = new Set(["correct", "wrong", "partial", "uncertain"]);
  const next = { ...currentQuestion };
  if (body.status != null) {
    const status = String(body.status).trim();
    if (!allowedStatuses.has(status)) {
      return { error: "INVALID_QUESTION_STATUS", message: "题目状态只能是 correct、wrong、partial 或 uncertain。" };
    }
    next.status = status;
  }
  for (const [field, value] of Object.entries({
    studentAnswer: body.studentAnswer,
    correctAnswer: body.correctAnswer,
    errorStep: body.errorStep,
    explanation: body.explanation,
    knowledgePoint: body.knowledgePoint,
    suggestedPractice: body.suggestedPractice,
    teacherNote: body.teacherNote
  })) {
    if (value != null) next[field] = String(value).trim();
  }
  if (Array.isArray(body.studentProcess)) {
    next.studentProcess = body.studentProcess.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (body.score != null) {
    const score = optionalNumber(body.score);
    if (score == null || score < 0) return { error: "INVALID_QUESTION_SCORE", message: "请填写有效的题目得分。" };
    next.score = score;
  }
  if (body.maxScore != null) {
    const maxScore = optionalNumber(body.maxScore);
    if (maxScore == null || maxScore <= 0) return { error: "INVALID_QUESTION_MAX_SCORE", message: "请填写有效的题目满分。" };
    next.maxScore = maxScore;
  }
  if (body.bbox && typeof body.bbox === "object") {
    next.bbox = {
      page: optionalNumber(body.bbox.page) || currentQuestion.bbox?.page || 1,
      x: optionalNumber(body.bbox.x) ?? currentQuestion.bbox?.x ?? 0.08,
      y: optionalNumber(body.bbox.y) ?? currentQuestion.bbox?.y ?? 0.12,
      w: optionalNumber(body.bbox.w) ?? currentQuestion.bbox?.w ?? 0.18,
      h: optionalNumber(body.bbox.h) ?? currentQuestion.bbox?.h ?? 0.08
    };
  }
  next.reviewedByTeacher = true;
  next.reviewedAt = new Date().toISOString();
  return { question: next };
}

function sumReviewedQuestionScores(questions = []) {
  if (!questions.length) return null;
  const scores = questions.map((item) => optionalNumber(item.score));
  if (scores.some((score) => score == null)) return null;
  return Number(scores.reduce((sum, score) => sum + Number(score), 0).toFixed(2));
}

function syncAnnotationMarkersForQuestion(markers = [], question = {}) {
  const questionNo = String(question.questionNo || "");
  const nextMarker = {
    id: question.id || `marker-${questionNo || markers.length + 1}`,
    questionNo,
    status: question.status || "uncertain",
    label: markerLabelForQuestionStatus(question.status),
    page: Number(question.bbox?.page || 1),
    x: Number(question.bbox?.x ?? 0.08),
    y: Number(question.bbox?.y ?? 0.12),
    w: Number(question.bbox?.w ?? 0.18),
    h: Number(question.bbox?.h ?? 0.08)
  };
  const index = markers.findIndex((item) => String(item.questionNo || "") === questionNo || String(item.id || "") === String(question.id || ""));
  if (index === -1) return [...markers, nextMarker];
  return markers.map((item, currentIndex) => currentIndex === index ? { ...item, ...nextMarker } : item);
}

function mapGradingWorkbench(submission) {
  const review = mapReviewSubmission(submission);
  const grading = review.structuredGrading || {};
  const markers = Array.isArray(grading.annotationMarkers) ? grading.annotationMarkers : [];
  const imageFiles = review.imageFiles || [];
  const imageQuality = review.ocr?.imageQuality || null;
  const qualityPages = Array.isArray(imageQuality?.pages) ? imageQuality.pages : [];
  const pages = imageFiles.length
    ? imageFiles.map((file, index) => ({
        id: `${review.id}-page-${index + 1}`,
        pageNumber: index + 1,
        imageUrl: file.url || null,
        fileName: file.fileName || file.originalName || "",
        rotation: 0,
        qualityStatus: qualityPages[index]?.qualityStatus || (review.ocr?.status === "FAILED" ? "needs_review" : "ready"),
        qualityScore: qualityPages[index]?.score ?? null,
        qualityIssues: qualityPages[index]?.issues || [],
        qualityWarnings: qualityPages[index]?.warnings || [],
        ocrStatus: review.ocr?.status || "PENDING",
        markers: markers.filter((marker) => Number(marker.page || 1) === index + 1)
      }))
    : [{
        id: `${review.id}-page-1`,
        pageNumber: 1,
        imageUrl: null,
        fileName: "",
        rotation: 0,
        qualityStatus: qualityPages[0]?.qualityStatus || "needs_review",
        qualityScore: qualityPages[0]?.score ?? null,
        qualityIssues: qualityPages[0]?.issues || [],
        qualityWarnings: qualityPages[0]?.warnings || [],
        ocrStatus: review.ocr?.status || "PENDING",
        markers: markers.filter((marker) => Number(marker.page || 1) === 1)
      }];
  const questions = (Array.isArray(grading.questionResults) ? grading.questionResults : [])
    .map((question, index) => normalizeQuestionWorkbenchItem(question, index, markers));
  const questionReviewState = gradingQuestionReviewState(questions);
  return {
    id: review.batchId || review.id,
    submissionId: review.id,
    assignmentId: review.assignmentId,
    title: review.assignmentTitle,
    studentId: review.studentId,
    studentName: review.studentName,
    subject: review.subject,
    kind: review.kind,
    status: review.needsReview ? "reviewing" : "archived",
    score: grading.score ?? review.score ?? null,
    provisionalScore: grading.provisionalScore ?? null,
    needsTeacherReview: Boolean(grading.needsTeacherReview || review.needsReview),
    archiveEligible: Boolean(grading.archiveEligible),
    ocrStatusLabel: review.ocrStatusLabel || "",
    quality: grading.quality || null,
    referenceAnswerMode: grading.referenceAnswerMode || "",
    questionLayoutManifest: grading.questionLayoutManifest || null,
    summary: grading.summary || review.gradingSummary || "",
    pages,
    questions,
    questionCount: questions.length,
    pendingQuestionCount: questionReviewState.unresolved,
    reviewedQuestionCount: questionReviewState.reviewed,
    questionReviewReady: questionReviewState.readyForArchive,
    reviewedQuestionScore: questionReviewState.score,
    uploadedBy: review.uploadedBy,
    submittedAt: review.submittedAt
  };
}

function reviewedMistakesFromResult(result = {}, submission) {
  const subject = submission.assignment?.subject?.name || safeJson(submission.assignment?.metadata, {}).subject || "unknown";
  const explicitMistakes = Array.isArray(result.mistakes) ? result.mistakes : [];
  const questionMistakes = Array.isArray(result.questionResults)
    ? result.questionResults
        .filter((item) => ["wrong", "partial"].includes(item.status))
        .map((item) => ({
          prompt: `第${item.questionNo || ""}题：${item.knowledgePoint || "错题"}`,
          studentAnswer: item.studentAnswer || null,
          correctAnswer: item.correctAnswer || null,
          cause: item.errorStep || item.explanation || "教师复核确认后归档。",
          point: item.knowledgePoint || subject,
          severity: item.status === "partial" ? "partial" : "normal"
        }))
    : [];
  return (explicitMistakes.length ? explicitMistakes : questionMistakes)
    .filter((mistake) => mistake.prompt || mistake.point || mistake.cause)
    .map((mistake) => ({
      studentId: submission.studentId,
      subject: mistake.subject || subject,
      prompt: mistake.prompt || mistake.point || "错题记录",
      studentAnswer: mistake.studentAnswer || null,
      correctAnswer: mistake.correctAnswer || null,
      cause: mistake.cause || mistake.reason || mistake.errorStep || null,
      metadata: {
        ...(mistake.metadata || {}),
        source: "submission-review",
        submissionId: submission.id,
        assignmentId: submission.assignmentId,
        reviewStatus: "teacher_reviewed",
        severity: mistake.severity || "normal"
      }
    }));
}

app.get("/health", asyncRoute(async (_req, res) => {
  const database = await checkDatabaseStatus();
  res.json({
    ok: true,
    service: "junhang-api",
    generatedAt: new Date().toISOString(),
    config: publicConfigSummary(config),
    database
  });
}));

app.get("/api/status", asyncRoute(async (_req, res) => {
  const database = await checkDatabaseStatus();
  const snapshot = buildAiStartupSnapshot(config);
  res.json({
    ok: true,
    api: { status: "ready", port },
    database,
    ai: {
      generatedAt: snapshot.generatedAt,
      mode: snapshot.mode,
      providers: [],
      features: snapshot.features.filter((feature) => feature.id !== "avatar-dialog").map((feature) => ({
        id: feature.id,
        label: feature.label,
        appSurface: feature.appSurface,
        status: feature.status,
        reason: feature.status === "ready" ? "AI生成可用" : "AI生成暂不可用"
      }))
    }
  });
}));

app.post("/api/encoding/check", requireSession(config, ["teacher"]), (req, res) => {
  const report = inspectEncodingPayload(req.body, { maxIssues: 100 });
  res.json({
    ok: report.ok,
    issueCount: report.issueCount,
    issues: report.issues,
    checkedAt: new Date().toISOString()
  });
});

app.get("/api/ai/status", requireSession(config, ["teacher"]), (_req, res) => {
  res.json({ ok: true, ai: buildAiStartupSnapshot(config), orchestration: buildModelOrchestrationPlan(config) });
});

app.get("/api/session/verify", (req, res) => {
  const session = verifySessionToken(config, readBearerToken(req));
  if (!session) {
    return res.status(401).json({
      ok: false,
      error: "SESSION_INVALID",
      message: "登录已失效，请重新登录。"
    });
  }
  res.json({ ok: true, session });
});

app.get("/api/bootstrap", requireDatabase, requireSession(config, ["student", "teacher", "classroom"]), asyncRoute(async (req, res) => {
  const [
    teachers,
    students,
    tasks,
    assignments,
    devices,
    broadcasts,
    dictationTasks,
    readingTasks,
    corrections,
    logs,
    reports
  ] = await Promise.all([
    prisma.teacher.findMany({
      orderBy: { createdAt: "asc" },
      include: { accessCodes: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 1 } }
    }),
    prisma.student.findMany({
      orderBy: [{ grade: "asc" }, { displayName: "asc" }],
      include: {
        accessCodes: { where: { status: "ACTIVE" }, take: 1 },
        guardians: { include: { guardian: true }, take: 1 },
        responsibleTeacher: true,
        teacherAssignments: { where: { activeTo: null } },
        profiles: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    prisma.learningTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { student: true, subject: true }
    }),
    prisma.assignment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        subject: true,
        items: { orderBy: { orderIndex: "asc" } },
        submissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          include: { student: true, grading: true }
        }
      }
    }),
    prisma.classroomDevice.findMany({ orderBy: { createdAt: "asc" }, include: { teacher: true } }),
    prisma.taskBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { device: true } }),
    prisma.dictationTask.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { device: true, items: true } }),
    prisma.readingTask.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { device: true } }),
    prisma.mistakeRecord.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { knowledgePoint: true, student: true } }),
    prisma.behaviorEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 50 }),
    prisma.studentReport.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { student: true } })
  ]);

  const classroomDevice = req.session.role === "classroom"
    ? devices.find((device) => device.id === req.session.deviceId)
    : null;
  const visibleStudents = students.filter((student) => {
    if (req.session.role === "student") return student.id === req.session.studentId;
    if (req.session.role === "teacher") {
      return student.responsibleTeacherId === req.session.teacherId ||
        student.teacherAssignments.some((binding) => binding.teacherId === req.session.teacherId);
    }
    return Boolean(classroomDevice) &&
      student.grade === classroomDevice.grade &&
      (!classroomDevice.className || student.className === classroomDevice.className);
  });
  const visibleStudentIds = new Set(visibleStudents.map((student) => student.id));
  const visibleDevices = devices.filter((device) => {
    if (req.session.role === "teacher") return device.teacherId === req.session.teacherId || device.teacherId == null;
    return req.session.role === "classroom" && device.id === req.session.deviceId;
  });
  const visibleDeviceIds = new Set(visibleDevices.map((device) => device.id));
  const visibleTasks = tasks.filter((task) => task.studentId && visibleStudentIds.has(task.studentId));
  const visibleAssignments = assignments.filter((assignment) => {
    const metadata = safeJson(assignment.metadata, {});
    if (req.session.role === "teacher" && metadata.teacherId && metadata.teacherId !== req.session.teacherId) return false;
    return (metadata.targetStudentId && visibleStudentIds.has(metadata.targetStudentId)) ||
      (metadata.targetGrade && visibleStudents.some((student) => student.grade === metadata.targetGrade)) ||
      assignment.submissions?.some((submission) => visibleStudentIds.has(submission.studentId));
  });

  const bootstrapPayload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    teachers: (req.session.role === "teacher"
      ? teachers.filter((teacher) => teacher.id === req.session.teacherId)
      : req.session.role === "classroom" && classroomDevice?.teacherId
        ? teachers.filter((teacher) => teacher.id === classroomDevice.teacherId)
        : []).map((teacher) => req.session.role === "classroom"
      ? {
          id: teacher.id,
          displayName: teacher.name,
          role: teacher.role || "主讲老师",
          status: teacherStatusToClient(teacher.status)
        }
      : {
          id: teacher.id,
          displayName: teacher.name,
          phone: teacher.phone || "",
          role: teacher.role || "主讲老师",
          accessCode: teacher.accessCodes?.[0]?.codePreview || "",
          status: teacherStatusToClient(teacher.status)
        }),
    students: req.session.role === "classroom" ? visibleStudents.map(mapClassroomStudent) : visibleStudents.map(mapStudent),
    tasks: visibleTasks.map(mapTask),
    assignments: visibleAssignments.map(mapAssignment),
    classroomDevices: req.session.role === "classroom"
      ? visibleDevices.map((device) => ({
          id: device.id,
          label: device.label,
          grade: device.grade || "",
          className: device.className || "",
          teacherId: device.teacherId || "",
          teacherName: device.teacher?.name || "",
          status: device.status === "DISABLED" ? "已停用" : device.status === "PENDING" ? "待绑定" : "已绑定"
        }))
      : visibleDevices.map(mapDevice),
    classroomBroadcasts: broadcasts.filter((item) => visibleDeviceIds.has(item.deviceId)).map(mapBroadcast),
    dictationTasks: dictationTasks.filter((item) => visibleDeviceIds.has(item.deviceId)).map(mapDictation),
    readingTasks: readingTasks.filter((item) => visibleDeviceIds.has(item.deviceId)).map(mapReading),
    corrections: req.session.role === "classroom" ? [] : corrections.filter((item) => visibleStudentIds.has(item.studentId)).map(mapCorrection),
    logs: logs.filter((item) => item.studentId && visibleStudentIds.has(item.studentId)).map(mapLog),
    reports: req.session.role === "classroom" ? [] : reports.filter((item) => visibleStudentIds.has(item.studentId)).map((report) => mapReport(report, req.session.role)).filter(Boolean)
  };

  const normalizedPayload = normalizeDisplayPayload(bootstrapPayload);
  res.json(req.session.role === "teacher" ? normalizedPayload : sanitizeLearnerPayload(normalizedPayload));
}));

app.post("/api/ai/qa", requireSession(config, ["student", "teacher", "classroom"]), asyncRoute(async (req, res) => {
  const input = getBody(req);
  const session = req.session;
  if (session?.role === "student") {
    const scopeError = assertStudentOwnsRequest({ session }, input.studentId);
    if (scopeError) return res.status(403).json(scopeError);
  }
  if (session?.role === "teacher" && input.studentId) {
    if (!(await teacherCanAccessStudent(session.teacherId, input.studentId))) {
      return forbidden(res, "TEACHER_STUDENT_SCOPE_MISMATCH", "当前教师无权访问该学生。");
    }
  }
  if (session?.role === "classroom") {
    if (!assertClassroomDeviceScope({ session }, res, input.deviceId)) return;
    if (!(await assertClassroomStudentScope({ session }, res, input.studentId))) return;
  }
  const { options, persistence } = await persistenceOptions(input);
  const result = await answerStudentQuestionService(config, input, options);
  res.json({ ok: true, persistence, result: cleanQaResultForClient(result) });
}));

app.post("/api/ai/vocabulary", requireSession(config, ["student", "teacher", "classroom"]), asyncRoute(async (req, res) => {
  const input = getBody(req);
  const session = req.session;
  if (session?.role === "student") {
    const scopeError = assertStudentOwnsRequest({ session }, input.studentId);
    if (scopeError) return res.status(403).json(scopeError);
  }
  if (session?.role === "teacher" && input.studentId) {
    if (!(await teacherCanAccessStudent(session.teacherId, input.studentId))) {
      return forbidden(res, "TEACHER_STUDENT_SCOPE_MISMATCH", "当前教师无权访问该学生。");
    }
  }
  if (session?.role === "classroom" && input.studentId) {
    if (!(await assertClassroomStudentScope({ session }, res, input.studentId))) return;
  }
  const { options, persistence } = await persistenceOptions(input);
  const result = await generateVocabularyCardService(config, input, options);
  res.json({
    ok: true,
    persistence,
    result: {
      available: Boolean(result.available),
      card: result.card,
      persisted: result.persisted || {}
    }
  });
}));

app.post("/api/teacher/tasks", requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = { ...getBody(req), teacherId: sessionTeacherId(req, req.body?.teacherId) };
  if (!(await assertTeacherStudentScope(req, res, input.studentId))) return;
  const { options, persistence } = await persistenceOptions(input);
  const result = await draftTeacherTaskService(config, input, options);
  await auditEvent(req, {
    studentId: input.studentId || null,
    feature: "teacher-task",
    action: "draft-task",
    metadata: {
      subject: input.subject || null,
      learningTaskId: result.persisted?.learningTaskId || null
    }
  });
  res.json({ ok: true, persistence, result });
}));

app.patch("/api/tasks/:taskId/complete", requireDatabase, requireSession(config, ["student", "teacher", "classroom"]), asyncRoute(async (req, res) => {
  const input = getBody(req);
  const task = await prisma.learningTask.findUnique({
    where: { id: req.params.taskId },
    include: { student: true, subject: true }
  });
  if (!task) {
    return res.status(404).json({ ok: false, error: "TASK_NOT_FOUND", message: "今日任务不存在。" });
  }
  if (req.session.role === "student" && task.studentId !== req.session.studentId) {
    return forbidden(res, "STUDENT_TASK_SCOPE_MISMATCH", "学生只能完成自己的任务。");
  }
  if (req.session.role === "teacher" && !(await teacherCanAccessStudent(req.session.teacherId, task.studentId))) {
    return forbidden(res, "TEACHER_STUDENT_SCOPE_MISMATCH", "当前教师无权操作该学生任务。");
  }
  if (req.session.role === "classroom" && !(await classroomCanAccessStudent(req.session.deviceId, task.studentId))) {
    return forbidden(res, "CLASSROOM_STUDENT_SCOPE_MISMATCH", "课堂平板只能完成本设备年级或分组内的学生任务。");
  }
  const metadata = safeJson(task.metadata, {});
  const completedTask = await prisma.learningTask.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      metadata: {
        ...metadata,
        completedAt: new Date().toISOString(),
        completedByRole: req.session.role,
        completedByDeviceId: req.session.role === "classroom" ? req.session.deviceId : null,
        completionNote: readableText(input.note, "")
      }
    },
    include: { student: true, subject: true }
  });
  await auditEvent(req, {
    studentId: task.studentId || null,
    feature: "learning-task",
    action: "complete-task",
    metadata: {
      learningTaskId: task.id,
      completedByRole: req.session.role,
      deviceId: req.session.role === "classroom" ? req.session.deviceId : null
    }
  });
  res.json({ ok: true, task: mapTask(completedTask) });
}));

app.post("/api/assessments/draft", requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = { ...getBody(req), teacherId: sessionTeacherId(req, req.body?.teacherId) };
  if (input.studentId && !(await assertTeacherStudentScope(req, res, input.studentId))) return;
  const { options, persistence } = await persistenceOptions(input);
  const result = await draftAssessmentService(config, input, options);
  await auditEvent(req, {
    studentId: input.studentId || null,
    feature: "assessment",
    action: "draft-assessment",
    metadata: {
      subject: input.subject || null,
      kind: input.kind || null,
      assignmentId: result.persisted?.assignmentId || null,
      textbookAssetId: input.textbookAssetId || null,
      textbookTitle: input.textbookTitle || null,
      textbookChapterId: input.textbookChapterId || null,
      textbookChapterTitle: input.textbookChapterTitle || null,
      audioSource: input.audioSource || null
    }
  });
  res.json({ ok: true, persistence, result });
}));

app.post("/api/assessments/:assignmentId/draft-export", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.assignmentId },
    include: { subject: true, items: { orderBy: { orderIndex: "asc" } } }
  });
  if (!assignment) {
    return res.status(404).json({ ok: false, error: "ASSIGNMENT_NOT_FOUND", message: "未找到生成记录。" });
  }
  const metadata = safeJson(assignment.metadata, {});
  if (metadata.targetStudentId && !(await assertTeacherStudentScope(req, res, metadata.targetStudentId))) return;

  const exported = await exportAssessmentPaperAsset(req, assignment, {
    suffix: `draft-review-${Date.now()}`,
    titleSuffix: "内容审查草稿",
    role: "assessment-draft-review",
    kind: "assessment-draft-review",
    reviewStatus: "pending_teacher_review",
    htmlOptions: {
      badgeText: "AI生成 · 教师内容审查草稿",
      footText: "仅供教师审查，确认后再生成正式题目与解析 PDF",
      titleSuffix: " - 内容审查草稿"
    },
    note: "Draft review PDF generated for teacher approval before final export."
  });
  const generationPipeline = mergeGenerationPipeline(metadata, {
    stage: "draft_pdf_ready",
    gates: {
      draftPdfExported: true,
      teacherReviewStatus: "pending_teacher_review",
      finalExportAllowed: false,
      finalExported: false
    },
    assets: {
      draftReviewAssetId: exported.asset.id,
      draftReviewUrl: exported.asset.url || null,
      draftReviewGeneratedAt: new Date().toISOString()
    }
  });
  await prisma.assignment.update({
    where: { id: assignment.id },
    data: {
      metadata: {
        ...metadata,
        draftReviewStatus: "pending_teacher_review",
        draftReviewAssetId: exported.asset.id,
        draftReviewUpdatedAt: new Date().toISOString(),
        generationPipeline
      }
    }
  });
  await auditEvent(req, {
    studentId: metadata.targetStudentId || null,
    feature: "assessment",
    action: "draft-review-export",
    metadata: {
      assignmentId: assignment.id,
      generatedAssetId: exported.asset.id,
      url: exported.asset.url
    }
  });
  res.json({ ok: true, asset: exported.asset, reviewStatus: "pending_teacher_review", generationPipeline });
}));

app.post("/api/assessments/:assignmentId/draft-review", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const decision = optionalText(req.body?.decision);
  if (!["accept", "reject"].includes(decision)) {
    return res.status(400).json({ ok: false, error: "INVALID_REVIEW_DECISION", message: "请提交是或否的审查结果。" });
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.assignmentId },
    include: { subject: true, items: { orderBy: { orderIndex: "asc" } } }
  });
  if (!assignment) {
    return res.status(404).json({ ok: false, error: "ASSIGNMENT_NOT_FOUND", message: "未找到生成记录。" });
  }
  const metadata = safeJson(assignment.metadata, {});
  if (metadata.targetStudentId && !(await assertTeacherStudentScope(req, res, metadata.targetStudentId))) return;
  const reviewStatus = decision === "accept" ? "accepted" : "rejected";
  const generationPipeline = mergeGenerationPipeline(metadata, {
    stage: decision === "accept" ? "draft_accepted" : "draft_rejected",
    gates: {
      teacherReviewStatus: reviewStatus,
      finalExportAllowed: decision === "accept",
      finalExported: false
    },
    review: {
      decision,
      reviewStatus,
      feedback: optionalText(req.body?.feedback),
      reviewedAt: new Date().toISOString(),
      reviewedByTeacherId: req.session?.teacherId || null
    }
  });
  const updated = await prisma.assignment.update({
    where: { id: assignment.id },
    data: {
      metadata: {
        ...metadata,
        draftReviewStatus: reviewStatus,
        draftReviewFeedback: optionalText(req.body?.feedback),
        draftReviewUpdatedAt: new Date().toISOString(),
        draftReviewTeacherId: req.session?.teacherId || null,
        generationPipeline
      }
    }
  });
  await auditEvent(req, {
    studentId: metadata.targetStudentId || null,
    feature: "assessment",
    action: decision === "accept" ? "draft-review-accept" : "draft-review-reject",
    metadata: {
      assignmentId: assignment.id,
      reviewStatus,
      feedback: optionalText(req.body?.feedback)
    }
  });
  res.json({ ok: true, reviewStatus, assignmentId: updated.id, generationPipeline });
}));

app.post("/api/assessments/:assignmentId/print-export", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.assignmentId },
    include: { subject: true, items: { orderBy: { orderIndex: "asc" } } }
  });
  if (!assignment) {
    return res.status(404).json({ ok: false, error: "ASSIGNMENT_NOT_FOUND", message: "未找到生成记录。" });
  }
  const metadata = safeJson(assignment.metadata, {});
  if (metadata.targetStudentId && !(await assertTeacherStudentScope(req, res, metadata.targetStudentId))) return;
  if (metadata.draftReviewStatus !== "accepted") {
    return res.status(409).json({ ok: false, error: "DRAFT_REVIEW_REQUIRED", message: "请先审查并确认 PDF 草稿，再生成正式题目与解析 PDF。" });
  }

  const analysisHtmlResult = { html: normalizeGeneratedHtml(answerAnalysisHtml(assignment)), pageCount: null, addedBlankPage: false };
  const analysisHtml = analysisHtmlResult.html;
  const analysisHtmlFileName = `${assignment.id}-analysis.html`;
  const analysisPdfFileName = `${assignment.id}-analysis.pdf`;
  fs.mkdirSync(storageGeneratedRoot(), { recursive: true });
  const analysisHtmlPath = path.join(storageGeneratedRoot(), analysisHtmlFileName);
  const analysisPdfPath = path.join(storageGeneratedRoot(), analysisPdfFileName);
  fs.writeFileSync(analysisHtmlPath, analysisHtml, "utf8");
  const paperExport = await exportAssessmentPaperAsset(req, assignment, {
    suffix: "print",
    titleSuffix: "题目",
    role: "student-paper",
    kind: "assessment-print",
    reviewStatus: "accepted"
  });
  const analysisPdfResult = await renderPdfFromHtml(analysisHtmlPath, analysisPdfPath).catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error)
  }));
  const analysisEvenPdf = analysisPdfResult.ok ? ensureEvenPdfPages(analysisPdfPath) : { pageCount: null, addedBlankPage: false };
  const analysisOutputFileName = analysisPdfResult.ok ? analysisPdfFileName : analysisHtmlFileName;
  const asset = paperExport.asset;
  const paperAssetMetadata = safeJson(asset.metadata, {});
  const questionLayoutManifest = safeJson(paperAssetMetadata.questionLayoutManifest, null);
  const analysisAsset = await prisma.generatedAsset.create({
    data: {
      kind: analysisPdfResult.ok ? "assessment-analysis-pdf" : "assessment-analysis-html",
      title: `${assignment.title} - 解析`,
      path: path.join(storageGeneratedRoot(), analysisOutputFileName),
      url: publicGeneratedUrl(analysisOutputFileName, req),
      metadata: {
        assignmentId: assignment.id,
        role: "answer-analysis",
        pairedAssetId: asset.id,
        htmlUrl: publicGeneratedUrl(analysisHtmlFileName, req),
        htmlPageCount: analysisHtmlResult.pageCount,
        addedBlankPage: analysisHtmlResult.addedBlankPage,
        pdfPageCount: analysisEvenPdf.pageCount,
        pdfAddedBlankPage: analysisEvenPdf.addedBlankPage,
        pdfGenerated: analysisPdfResult.ok,
        pdfReason: analysisPdfResult.ok ? null : analysisPdfResult.reason,
        note: analysisPdfResult.ok ? "A4 answer analysis PDF generated from deterministic HTML layout." : "HTML answer analysis export generated; PDF rendering unavailable."
      }
    }
  });
  const generationPipeline = mergeGenerationPipeline(metadata, {
    stage: "final_exported",
    gates: {
      finalExportAllowed: true,
      finalExported: true,
      teacherReviewStatus: metadata.draftReviewStatus
    },
    assets: {
      studentPaperAssetId: asset.id,
      studentPaperUrl: asset.url || null,
      answerAnalysisAssetId: analysisAsset.id,
      answerAnalysisUrl: analysisAsset.url || null,
      finalExportedAt: new Date().toISOString()
    },
    print: {
      ...(safeJson(metadata.generationPipeline, {}).print || {}),
      questionLayoutManifestSource: questionLayoutManifest?.coordinateSource || null
    }
  });
  await prisma.assignment.update({
    where: { id: assignment.id },
    data: {
      metadata: {
        ...metadata,
        latestPrintAssetId: asset.id,
        latestAnalysisAssetId: analysisAsset.id,
        latestPrintExportedAt: new Date().toISOString(),
        questionLayoutManifest,
        latestQuestionLayoutManifest: questionLayoutManifest,
        generationPipeline
      }
    }
  });
  await auditEvent(req, {
    studentId: metadata.targetStudentId || null,
    feature: "assessment",
    action: "print-export",
    metadata: {
      assignmentId: assignment.id,
      generatedAssetId: asset.id,
      analysisAssetId: analysisAsset.id,
      url: asset.url,
      analysisUrl: analysisAsset.url
    }
  });
  res.json({ ok: true, asset, analysisAsset, assets: [asset, analysisAsset], generationPipeline });
}));

app.post(
  "/api/submissions/grade",
  requireSession(config, ["student", "teacher"]),
  submissionImageUpload.array("images"),
  asyncRoute(async (req, res) => {
    const input = {
      ...getBody(req),
      uploadedFiles: uploadedFileMeta(req.files || [])
    };
    input.uploadedFiles = input.uploadedFiles.map((file) => ({
      ...file,
      url: publicUploadUrl(file.relativePath || file.fileName, req)
    }));
    const scopeError = assertStudentOwnsRequest(req, input.studentId);
    if (scopeError) return res.status(403).json(scopeError);
    if (!(await assertTeacherStudentScope(req, res, input.studentId))) return;
    input.imageNames = [
      ...(Array.isArray(input.imageNames) ? input.imageNames : []),
      ...input.uploadedFiles.map((file) => file.fileName)
    ];
    if (input.assignmentId) {
      const sourceAssignment = await prisma.assignment.findUnique({
        where: { id: input.assignmentId },
        include: { subject: true, items: { orderBy: { orderIndex: "asc" } } }
      });
      if (sourceAssignment) {
        const metadata = safeJson(sourceAssignment.metadata, {});
        input.assignmentTitle = sourceAssignment.title;
        input.assignmentItems = sourceAssignment.items.map((item) => ({
          questionNo: item.orderIndex,
          prompt: item.prompt,
          answer: item.answer,
          rubric: item.rubric,
          metadata: item.metadata || {}
        }));
        input.answerKey = metadata.answerKey || null;
        input.assignmentAnalysis = {
          subject: sourceAssignment.subject?.name || metadata.subject || input.subject || null,
          kind: metadata.kind || input.kind || null,
          difficulty: sourceAssignment.difficulty || null
        };
      }
    }

    const submission = await createQueuedPhotoSubmission(input);
    queueSubmissionRecognition(submission.id);
    const result = queuedSubmissionResult(input, submission);
    await auditEvent(req, {
      studentId: input.studentId || null,
      feature: "submission",
      action: "grade-upload",
      metadata: {
        assignmentId: input.assignmentId || null,
        batchId: input.batchId || null,
        uploadedBy: input.uploadedBy || null,
        imageCount: input.imageNames?.length || 0,
        ocrStatus: "RUNNING",
        ocrEngine: null,
        ocrReason: "queued-background-processing",
        pageNumber: optionalNumber(input.pageNumber),
        questionRange: optionalText(input.questionRange),
        submissionId: submission.id,
        gradingResultId: submission.grading?.id || null
      }
    });
    res.status(202).json({ ok: true, persistence: { active: true, reason: "queued-background-processing" }, uploadedFiles: input.uploadedFiles, result });
  })
);

app.post("/api/submissions/batches", requireDatabase, requireSession(config, ["student", "teacher"]), asyncRoute(async (req, res) => {
  const input = {
    ...getBody(req),
    teacherId: sessionTeacherId(req, req.body?.teacherId)
  };
  const scopeError = assertStudentOwnsRequest(req, input.studentId);
  if (scopeError) return res.status(403).json(scopeError);
  if (!(await assertTeacherStudentScope(req, res, input.studentId))) return;
  const batchId = input.batchId || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ocr = buildOcrMeta(input);
  const assignment = await createAssignmentDraft({
    subject: input.subject || null,
    title: input.title || "图片提交批改记录",
    grade: input.grade || null,
    difficulty: input.difficulty || null,
    metadata: {
      kind: input.kind || "图片批改",
      source: "photo-upload-batch",
      uploadedBy: input.uploadedBy || "teacher",
      targetStudentId: input.studentId || null,
      studentName: input.studentName || null,
      teacherId: input.teacherId || null,
      uploadBatchId: batchId,
      expectedImageCount: Number(input.imageTotal || input.expectedImageCount || 0) || null,
      note: input.note || input.ocrText || null,
      ocr,
      pageNumber: ocr.pageNumber,
      questionRange: ocr.questionRange
    }
  });
  await auditEvent(req, {
    studentId: input.studentId || null,
    feature: "submission",
    action: "create-upload-batch",
    metadata: {
      assignmentId: assignment.id,
      batchId,
      uploadedBy: input.uploadedBy || null,
      expectedImageCount: Number(input.imageTotal || input.expectedImageCount || 0) || null
    }
  });

  res.status(201).json({
    ok: true,
    assignment: mapAssignment({
      ...assignment,
      subject: null,
      submissions: []
    }),
    assignmentId: assignment.id,
    batchId
  });
}));

app.post("/api/classroom/dictation", requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = { ...getBody(req), teacherId: sessionTeacherId(req, req.body?.teacherId) };
  if (!(await assertTeacherOwnsDevice(req, res, input.deviceId))) return;
  const { options, persistence } = await persistenceOptions(input);
  const speech = await dictationSpeechService(config, input, options);

  let dictationTask = null;
  if (persistence.active && input.deviceId && input.subject && input.title && input.items?.length) {
    dictationTask = await createDictationTask(input);
  }
  await auditEvent(req, {
    feature: "classroom",
    action: "publish-dictation",
    deviceId: input.deviceId || null,
    metadata: {
      deviceId: input.deviceId || null,
      dictationTaskId: dictationTask?.id || null,
      itemCount: input.items?.length || 0,
      textbookAssetId: input.textbookAssetId || null,
      textbookTitle: input.textbookTitle || null,
      textbookChapterId: input.textbookChapterId || null,
      textbookChapterTitle: input.textbookChapterTitle || null
    }
  });

  res.json({
    ok: true,
    persistence,
    result: {
      ...speech,
      persisted: {
        ...(speech.persisted || {}),
        dictationTaskId: dictationTask?.id || null
      }
    }
  });
}));

app.post("/api/classroom/speech", requireSession(config, ["teacher", "classroom"]), asyncRoute(async (req, res) => {
  const input = getBody(req);
  const result = await createMiniMaxSpeechTask(config, input);
  const { options, persistence } = await persistenceOptions(input);
  let modelRun = null;
  if (options.persist && result.modelRun) modelRun = await recordModelRun(result.modelRun);
  res.json({
    ok: true,
    persistence,
    result: {
      ...result,
      persisted: { modelRunId: modelRun?.id || null }
    }
  });
}));

app.post("/api/classroom/voice-qa", requireDatabase, requireSession(config, ["classroom"]), asyncRoute(async (req, res) => {
  const input = getBody(req);
  const deviceId = input.deviceId || req.session.deviceId;
  if (!assertClassroomDeviceScope(req, res, deviceId)) return;
  const transcript = optionalText(input.transcript || input.question);
  if (!transcript) {
    return res.status(400).json({ ok: false, error: "TRANSCRIPT_REQUIRED", message: "请先提交学生语音问题。" });
  }
  if (input.studentId) {
    const student = await prisma.student.findFirst({
      where: {
        id: input.studentId,
        loginEnabled: true,
        enrollmentStatus: { not: "WITHDRAWN" }
      },
      select: { id: true }
    });
    if (!student) {
      return res.status(403).json({ ok: false, error: "STUDENT_NOT_ALLOWED", message: "该学生不属于当前平板可访问范围。" });
    }
  }

  const { options, persistence } = await persistenceOptions({
    ...input,
    deviceId,
    question: transcript
  });
  const qa = await answerStudentQuestionService(config, {
    ...input,
    deviceId,
    question: transcript
  }, options);

  const speech = await createMiniMaxSpeechTask(config, {
    text: qa.answer,
    voiceId: input.voiceId,
    purpose: "classroom-answer"
  });

  await auditEvent(req, {
    studentId: input.studentId || null,
    feature: "classroom",
    action: "voice-qa",
    metadata: {
      deviceId,
      mode: qa.mode,
      available: qa.available,
      voiceAvailable: speech.available,
      voiceInteractionId: qa.persisted?.voiceInteractionId || null
    }
  });

  res.json({
    ok: true,
    persistence,
    result: {
      available: qa.available,
      mode: qa.mode,
      transcript,
      answer: qa.answer,
      voice: {
        available: speech.available,
        status: speech.status,
        audioUrl: speech.audioUrl || null,
        reason: speech.reason || null
      },
      persisted: qa.persisted
    }
  });
}));

app.post("/api/classroom/reading", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = { ...getBody(req), teacherId: sessionTeacherId(req, req.body?.teacherId) };
  if (!(await assertTeacherOwnsDevice(req, res, input.deviceId))) return;
  const task = await createReadingTask(input);
  await auditEvent(req, {
    feature: "classroom",
    action: "publish-reading",
    deviceId: input.deviceId || null,
    metadata: {
      deviceId: input.deviceId || null,
      readingTaskId: task.id,
      title: task.title,
      textbookAssetId: input.textbookAssetId || null,
      textbookTitle: input.textbookTitle || null,
      textbookChapterId: input.textbookChapterId || null,
      textbookChapterTitle: input.textbookChapterTitle || null
    }
  });
  res.json({ ok: true, task });
}));

app.post("/api/classroom/broadcasts", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = { ...getBody(req), teacherId: sessionTeacherId(req, req.body?.teacherId) };
  if (!(await assertTeacherOwnsDevice(req, res, input.deviceId))) return;
  const broadcast = await createClassroomBroadcast(input);
  await auditEvent(req, {
    feature: "classroom",
    action: "publish-broadcast",
    deviceId: input.deviceId || null,
    metadata: {
      deviceId: input.deviceId || null,
      broadcastId: broadcast.id,
      title: broadcast.title
    }
  });
  res.json({ ok: true, broadcast });
}));

app.post("/api/classroom/device-login", requireDatabase, asyncRoute(async (req, res) => {
  const { bindingCode } = getBody(req);
  if (!bindingCode) {
    return res.status(400).json({ ok: false, error: "DEVICE_CODE_REQUIRED", message: "请输入平板绑定码。" });
  }
  const device = await prisma.classroomDevice.findFirst({
    where: {
      status: { not: "DISABLED" },
      bindingCodeHash: hashAccessCode(bindingCode)
    },
    include: { teacher: true }
  });

  if (!device) {
    return res.status(401).json({
      ok: false,
      error: "INVALID_DEVICE_LOGIN",
      message: "平板绑定码无效或设备已停用。"
    });
  }

  const sessionToken = createSessionToken(config, {
    role: "classroom",
    deviceId: device.id,
    grade: device.grade || null,
    className: device.className || null
  });

  res.json({
    ok: true,
    sessionToken,
    device: mapDevice(device)
  });
}));

app.post("/api/classroom/devices/:deviceId/unlock", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherOwnsDevice(req, res, req.params.deviceId))) return;
  const device = await prisma.classroomDevice.update({
    where: { id: req.params.deviceId },
    data: {
      unlocked: true,
      unlockedBy: req.body?.unlockedBy || req.body?.teacherId || "teacher"
    }
  });
  await auditEvent(req, {
    feature: "classroom",
    action: "unlock-device",
    deviceId: req.params.deviceId,
    metadata: { deviceId: req.params.deviceId }
  });
  res.json({ ok: true, device });
}));

app.post("/api/classroom/devices/:deviceId/lock", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherOwnsDevice(req, res, req.params.deviceId))) return;
  const device = await prisma.classroomDevice.update({
    where: { id: req.params.deviceId },
    data: { unlocked: false, unlockedBy: null }
  });
  await auditEvent(req, {
    feature: "classroom",
    action: "lock-device",
    deviceId: req.params.deviceId,
    metadata: { deviceId: req.params.deviceId }
  });
  res.json({ ok: true, device });
}));

app.get("/api/classroom/devices/:deviceId", requireDatabase, requireSession(config, ["teacher", "classroom"]), asyncRoute(async (req, res) => {
  if (req.session.role === "classroom" && !assertClassroomDeviceScope(req, res, req.params.deviceId)) return;
  if (req.session.role === "teacher" && !(await assertTeacherOwnsDevice(req, res, req.params.deviceId))) return;
  const device = await prisma.classroomDevice.findUnique({
    where: { id: req.params.deviceId },
    include: {
      broadcasts: { orderBy: { createdAt: "desc" }, take: 10 },
      dictationTasks: { orderBy: { createdAt: "desc" }, take: 5, include: { items: true } },
      readingTasks: { orderBy: { createdAt: "desc" }, take: 5 }
    }
  });
  res.json({ ok: true, device });
}));

app.get("/api/review/submissions", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submissions = await prisma.submission.findMany({
    where: {
      grading: { needsReview: true },
      student: {
        OR: [
          { responsibleTeacherId: req.session.teacherId },
          { teacherAssignments: { some: { teacherId: req.session.teacherId, activeTo: null } } }
        ]
      }
    },
    orderBy: { submittedAt: "desc" },
    take: Math.min(Number(req.query.limit || 50), 100),
    include: {
      student: true,
      grading: true,
      assignment: { include: { subject: true } }
    }
  });

  res.json({
    ok: true,
    submissions: submissions.map(mapReviewSubmission)
  });
}));

app.get("/api/grading/workbench", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submissions = await prisma.submission.findMany({
    where: {
      grading: { needsReview: true },
      student: {
        OR: [
          { responsibleTeacherId: req.session.teacherId },
          { teacherAssignments: { some: { teacherId: req.session.teacherId, activeTo: null } } }
        ]
      }
    },
    orderBy: { submittedAt: "desc" },
    take: Math.min(Number(req.query.limit || 30), 100),
    include: {
      student: true,
      grading: true,
      assignment: { include: { subject: true } }
    }
  });

  res.json({
    ok: true,
    workbenches: submissions.map(mapGradingWorkbench)
  });
}));

app.get("/api/grading/workbench/:submissionId", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: {
      student: true,
      grading: true,
      assignment: { include: { subject: true } }
    }
  });
  if (!submission) {
    return res.status(404).json({ ok: false, error: "WORKBENCH_NOT_FOUND", message: "未找到批改工作台记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;
  res.json({ ok: true, workbench: mapGradingWorkbench(submission) });
}));

app.patch("/api/grading/workbench/:submissionId/questions/:questionId", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: {
      student: true,
      grading: true,
      assignment: { include: { subject: true } }
    }
  });
  if (!submission?.grading) {
    return res.status(404).json({ ok: false, error: "WORKBENCH_NOT_FOUND", message: "未找到批改工作台记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;

  const body = getBody(req);
  const currentResult = safeJson(submission.grading.result, {});
  const questions = Array.isArray(currentResult.questionResults) ? currentResult.questionResults : [];
  const questionIndex = questions.findIndex((item, index) =>
    String(item.id || "") === String(req.params.questionId) ||
    String(item.questionNo || item.no || index + 1) === String(req.params.questionId)
  );
  if (questionIndex === -1) {
    return res.status(404).json({ ok: false, error: "QUESTION_NOT_FOUND", message: "未找到需要复核的题目。" });
  }

  const patch = normalizeQuestionReviewPatch(body, questions[questionIndex]);
  if (patch.error) {
    return res.status(400).json({ ok: false, error: patch.error, message: patch.message });
  }

  const nextQuestions = questions.map((item, index) => index === questionIndex ? patch.question : item);
  const reviewedScore = sumReviewedQuestionScores(nextQuestions);
  const nextMarkers = syncAnnotationMarkersForQuestion(
    Array.isArray(currentResult.annotationMarkers) ? currentResult.annotationMarkers : [],
    patch.question
  );
  const nextResult = {
    ...currentResult,
    score: null,
    provisionalScore: reviewedScore ?? currentResult.provisionalScore ?? currentResult.score ?? null,
    questionResults: nextQuestions,
    annotationMarkers: nextMarkers,
    reviewStatus: "teacher_question_reviewing",
    needsTeacherReview: true,
    archiveEligible: false,
    teacherReviewUpdatedAt: new Date().toISOString(),
    teacherReviewUpdatedBy: req.session.teacherId
  };

  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: "NEEDS_REVIEW",
      grading: {
        update: {
          score: null,
          needsReview: true,
          result: nextResult
        }
      }
    },
    include: {
      student: true,
      grading: true,
      assignment: { include: { subject: true } }
    }
  });

  await auditEvent(req, {
    studentId: updated.studentId,
    feature: "grading-workbench",
    action: "patch-question-review",
    metadata: {
      submissionId: updated.id,
      questionId: req.params.questionId,
      questionNo: patch.question.questionNo,
      status: patch.question.status,
      score: patch.question.score ?? null
    }
  });

  res.json({ ok: true, workbench: mapGradingWorkbench(updated) });
}));

app.post("/api/review/submissions/:submissionId/recognize", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: { student: true }
  });
  if (!submission) {
    return res.status(404).json({ ok: false, error: "SUBMISSION_NOT_FOUND", message: "未找到提交记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;

  const requestedForce = req.body?.force === true || req.query.force === "true";
  const processed = await recognizeAndGradeSubmissionRecord(submission.id, { force: requestedForce });
  if (!processed) return res.status(404).json({ ok: false, error: "SUBMISSION_NOT_FOUND", message: "未找到提交记录。" });

  await auditEvent(req, {
    studentId: processed.updated.studentId,
    feature: "ocr",
    action: "recognize-submission",
    metadata: {
      submissionId: processed.updated.id,
      status: processed.recognition.status,
      engine: processed.recognition.engine,
      reason: processed.recognition.reason,
      regraded: Boolean(processed.regrade.available),
      gradingStatus: processed.regrade.modelRun?.status || null
    }
  });

  res.json({
    ok: true,
    available: processed.recognition.available,
    recognition: processed.recognition,
    submission: mapReviewSubmission(processed.updated)
  });
}));

app.patch("/api/review/submissions/:submissionId/ocr", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });
  if (!submission) {
    return res.status(404).json({ ok: false, error: "SUBMISSION_NOT_FOUND", message: "未找到提交记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;

  const body = getBody(req);
  const content = safeJson(submission.content, {});
  const currentOcr = safeJson(content.ocr, {});
  const manualText = optionalText(body.manualText || body.ocrText);
  const nextOcr = {
    ...currentOcr,
    status: manualText ? "MANUAL_CORRECTED" : currentOcr.status || "PENDING",
    manualText,
    text: manualText || currentOcr.text || null,
    confidence: body.ocrConfidence != null ? optionalNumber(body.ocrConfidence) : currentOcr.confidence ?? null,
    pageNumber: body.pageNumber != null ? optionalNumber(body.pageNumber) : currentOcr.pageNumber ?? content.pageNumber ?? null,
    questionRange: body.questionRange != null ? optionalText(body.questionRange) : currentOcr.questionRange ?? content.questionRange ?? null,
    correctedAt: new Date().toISOString(),
    correctedByTeacherId: req.session.teacherId
  };

  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      content: {
        ...content,
        ocrStatus: nextOcr.status,
        ocrText: nextOcr.text,
        manualText: nextOcr.manualText,
        pageNumber: nextOcr.pageNumber,
        questionRange: nextOcr.questionRange,
        ocr: nextOcr
      }
    },
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });

  await auditEvent(req, {
    studentId: updated.studentId,
    feature: "ocr",
    action: "manual-correct-ocr",
    metadata: {
      submissionId: updated.id,
      pageNumber: nextOcr.pageNumber,
      questionRange: nextOcr.questionRange
    }
  });

  res.json({ ok: true, submission: mapReviewSubmission(updated) });
}));

async function archiveSubmissionReview(req, res, submission, body = {}, action = "mark-submission-reviewed") {
  const currentResult = safeJson(submission.grading?.result, {});
  const questionArchiveGate = requireAllQuestionsReviewedForArchive(currentResult);
  if (!questionArchiveGate.ok) {
    res.status(400).json({
      ok: false,
      error: questionArchiveGate.error,
      message: questionArchiveGate.message,
      state: questionArchiveGate.state
    });
    return null;
  }
  const reviewedScoreFromQuestions = questionArchiveGate.state.score;
  const reviewedScoreInput = optionalNumber(body.score);
  const hasScoreField = Object.prototype.hasOwnProperty.call(body, "score");
  if (hasScoreField && reviewedScoreInput == null) {
    res.status(400).json({ ok: false, error: "INVALID_REVIEWED_SCORE", message: "请填写有效的教师确认分数。" });
    return null;
  }
  const lowConfidenceNeedsScore =
    currentResult.reviewStatus === "low_confidence_needs_review" ||
    currentResult.reviewStatus === "teacher_question_reviewing" ||
    currentResult.needsTeacherReview === true ||
    currentResult.archiveEligible === false ||
    currentResult.quality?.lowConfidence === true ||
    (currentResult.score == null && currentResult.provisionalScore != null);
  if (lowConfidenceNeedsScore && reviewedScoreInput == null && reviewedScoreFromQuestions == null) {
    res.status(400).json({
      ok: false,
      error: "LOW_CONFIDENCE_SCORE_REQUIRED",
      message: "该批改结果置信度不足或已经人工调整，请老师填写确认分数后再归档。"
    });
    return null;
  }
  const reviewedScore = reviewedScoreInput ?? reviewedScoreFromQuestions ?? optionalNumber(currentResult.score) ?? optionalNumber(currentResult.provisionalScore) ?? submission.grading?.score ?? null;
  const shouldArchiveMistakes = !currentResult.archivePublishedAt;
  const reviewedMistakes = shouldArchiveMistakes ? reviewedMistakesFromResult(currentResult, submission) : [];
  if (reviewedMistakes.length) {
    await prisma.mistakeRecord.createMany({ data: reviewedMistakes });
  }

  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: "GRADED",
      content: {
        ...safeJson(submission.content, {}),
        ocr: {
          ...safeJson(safeJson(submission.content, {}).ocr, {}),
          reviewed: true,
          reviewedAt: new Date().toISOString(),
          reviewedByTeacherId: req.session.teacherId
        }
      },
      grading: {
        update: {
          score: reviewedScore,
          needsReview: false,
          result: {
            ...currentResult,
            score: reviewedScore,
            provisionalScore: null,
            reviewedByTeacherId: req.session.teacherId,
            reviewedAt: new Date().toISOString(),
            reviewNote: body.reviewNote || null,
            reviewStatus: "reviewed",
            needsTeacherReview: false,
            archiveEligible: true,
            archivePublishedAt: currentResult.archivePublishedAt || new Date().toISOString(),
            archivedMistakeCount: (currentResult.archivedMistakeCount || 0) + reviewedMistakes.length
          }
        }
      }
    },
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });

  await auditEvent(req, {
    studentId: updated.studentId,
    feature: "review",
    action,
    metadata: {
      submissionId: updated.id,
      assignmentId: updated.assignmentId,
      reviewNote: body.reviewNote || null,
      reviewedScore
    }
  });

  return updated;
}

app.post("/api/review/submissions/:submissionId/mark-reviewed", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });
  if (!submission) {
    return res.status(404).json({ ok: false, error: "SUBMISSION_NOT_FOUND", message: "未找到提交记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;

  const body = getBody(req);
  const updated = await archiveSubmissionReview(req, res, submission, body, "mark-submission-reviewed");
  if (!updated) return;
  res.json({ ok: true, submission: mapReviewSubmission(updated) });
}));

app.post("/api/grading/workbench/:submissionId/archive", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: { student: true, grading: true, assignment: { include: { subject: true } } }
  });
  if (!submission?.grading) {
    return res.status(404).json({ ok: false, error: "WORKBENCH_NOT_FOUND", message: "未找到批改工作台记录。" });
  }
  if (!(await assertTeacherStudentScope(req, res, submission.studentId))) return;

  const updated = await archiveSubmissionReview(req, res, submission, getBody(req), "archive-grading-workbench");
  if (!updated) return;
  res.json({ ok: true, workbench: mapGradingWorkbench(updated), submission: mapReviewSubmission(updated) });
}));

app.post("/api/students", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = {
    ...getBody(req),
    enrollmentStatus: enrollmentStatusToDb(req.body?.enrollmentStatus),
    createdByTeacherId: sessionTeacherId(req, req.body?.createdByTeacherId),
    responsibleTeacherId: req.body?.responsibleTeacherId || sessionTeacherId(req, null)
  };
  const result = await createStudentWithAccessCode(input);

  if (input.guardianName || input.guardianPhone) {
    const guardian = await prisma.guardian.create({
      data: {
        name: input.guardianName || `${input.displayName}家长`,
        phone: input.guardianPhone || null,
        email: input.guardianEmail || null
      }
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: result.student.id,
        guardianId: guardian.id,
        relation: input.guardianRelation || "guardian"
      }
    });
  }

  await auditEvent(req, {
    studentId: result.student.id,
    feature: "student-access",
    action: "create-student",
    metadata: {
      studentId: result.student.id,
      codePreview: result.codePreview
    }
  });
  res.status(201).json({
    ok: true,
    student: result.student,
    accessCode: result.accessCode,
    codePreview: result.codePreview
  });
}));

app.post("/api/students/:studentId/disable-access", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  await disableStudentAccess(req.params.studentId);
  await auditEvent(req, {
    studentId: req.params.studentId,
    feature: "student-access",
    action: "disable-access",
    metadata: { studentId: req.params.studentId }
  });
  res.json({ ok: true, studentId: req.params.studentId });
}));

app.post("/api/students/:studentId/reset-access-code", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const result = await resetStudentAccessCode(req.params.studentId, {
    ...getBody(req),
    enrollmentStatus: "ACTIVE"
  });
  res.json({
    ok: true,
    student: result.student,
    accessCode: result.plainAccessCode,
    codePreview: result.codePreview
  });
  await auditEvent(req, {
    studentId: req.params.studentId,
    feature: "student-access",
    action: "reset-access-code",
    metadata: {
      studentId: req.params.studentId,
      codePreview: result.codePreview
    }
  });
}));

app.patch("/api/students/:studentId/access-status", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const body = getBody(req);
  const status = enrollmentStatusToDb(body.enrollmentStatus);
  const student = await updateStudentAccessStatus(req.params.studentId, {
    enrollmentStatus: status,
    loginEnabled: body.loginEnabled
  });
  await auditEvent(req, {
    studentId: req.params.studentId,
    feature: "student-access",
    action: "update-access-status",
    metadata: {
      studentId: req.params.studentId,
      enrollmentStatus: status,
      loginEnabled: body.loginEnabled
    }
  });
  res.json({ ok: true, student });
}));

async function loadStudentProfileSources(studentId) {
  return prisma.student.findUnique({
    where: { id: studentId },
    include: {
      accessCodes: { where: { status: "ACTIVE" }, take: 1 },
      guardians: { include: { guardian: true }, take: 1 },
      responsibleTeacher: true,
      tasks: { orderBy: { createdAt: "desc" }, take: 80, include: { subject: true } },
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 80,
        include: { grading: true, assignment: { include: { subject: true } } }
      },
      mistakes: { orderBy: { createdAt: "desc" }, take: 80, include: { knowledgePoint: true } },
      reports: { orderBy: { createdAt: "desc" }, take: 20 },
      behaviorEvents: { orderBy: { occurredAt: "desc" }, take: 100 },
      qaSessions: { orderBy: { createdAt: "desc" }, take: 50 },
      voiceInteractions: { orderBy: { occurredAt: "desc" }, take: 50 }
    }
  });
}

function normalizeProfilePeriodType(value, fallback = "weekly") {
  return value === "monthly" || value === "weekly" ? value : fallback;
}

function termReportPeriodKey(reportType, periodLabel) {
  const label = String(periodLabel || "").trim() || new Date().toISOString().slice(0, 10);
  return `${normalizeTermReportType(reportType)}:${label}`;
}

function mergeTermReportMetadata(currentMetadata, patch) {
  const metadata = safeJson(currentMetadata, {});
  return {
    ...metadata,
    termReport: {
      ...(metadata.termReport || {}),
      ...patch,
      updatedAt: new Date().toISOString()
    }
  };
}

async function loadTermReportStudent(studentId) {
  return loadStudentProfileSources(studentId);
}

app.post("/api/students/:studentId/profile/draft", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const body = getBody(req);
  const periodType = normalizeProfilePeriodType(body.periodType, "weekly");
  const student = await loadStudentProfileSources(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }

  const baseSnapshot = buildStudentGrowthSnapshot(student, { periodType });
  const narrativeResult = await buildStudentProfileNarrative(student, baseSnapshot);
  const mergedSnapshot = narrativeResult.structuredDraft
    ? mergeStudentProfileAiDraft(baseSnapshot, narrativeResult.structuredDraft)
    : {
        ...baseSnapshot,
        narrative: {
          ...baseSnapshot.narrative,
          ...narrativeResult.narrative
        }
      };
  const snapshot = {
    ...mergedSnapshot,
    generationState: {
      aiGenerated: narrativeResult.aiGenerated,
      generatedBy: narrativeResult.generatedBy,
      unavailableReason: narrativeResult.unavailableReason
    },
    draftStatus: "draft",
    draftGeneratedAt: new Date().toISOString()
  };

  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "draft-profile",
    metadata: {
      studentId: student.id,
      sourceCounts: snapshot.sourceCounts,
      weeklyScore: snapshot.weeklyScore
    }
  });

  res.json({
    ok: true,
    student: mapStudent({ ...student, profiles: [{ snapshot }] }),
    snapshot: filterStudentProfileSnapshot(snapshot, "teacher")
  });
}));

app.post("/api/students/:studentId/profile/publish", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const body = getBody(req);
  const student = await loadStudentProfileSources(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }

  const incomingSnapshot = safeJson(body.snapshot, null);
  const periodType = normalizeProfilePeriodType(incomingSnapshot?.period?.type || incomingSnapshot?.publishedView?.periodType, "monthly");
  const fallbackSnapshot = buildStudentGrowthSnapshot(student, { periodType });
  const structuredSnapshot = incomingSnapshot
    ? mergeStudentProfileAiDraft(fallbackSnapshot, incomingSnapshot)
    : fallbackSnapshot;
  const teacherEditedText = typeof body.text === "string" ? body.text.trim() : "";
  const narrative = safeJson(structuredSnapshot?.narrative, {});
  const snapshot = {
    ...structuredSnapshot,
    ...(teacherEditedText ? { publishedText: teacherEditedText } : {}),
    narrative: {
      ...narrative,
      ...(teacherEditedText ? { teacherEditedText } : {})
    },
    draftStatus: "published",
    publishedAt: new Date().toISOString(),
    publishedByTeacherId: req.session.teacherId
  };

  await prisma.studentProfile.create({ data: { studentId: student.id, snapshot } });
  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "publish-profile",
    metadata: {
      studentId: student.id,
      sourceCounts: snapshot.sourceCounts || null,
      weeklyScore: snapshot.weeklyScore || null
    }
  });

  res.json({
    ok: true,
    student: mapStudent({ ...student, profiles: [{ snapshot }] }),
    snapshot: filterStudentProfileSnapshot(snapshot, "teacher")
  });
}));

app.post("/api/students/:studentId/profile/print", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;
  const body = getBody(req);
  const student = await loadStudentProfileSources(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }

  const incomingSnapshot = safeJson(body.snapshot, null);
  const periodType = normalizeProfilePeriodType(incomingSnapshot?.period?.type || incomingSnapshot?.publishedView?.periodType || body.periodType, "weekly");
  const fallbackSnapshot = buildStudentGrowthSnapshot(student, { periodType });
  const structuredSnapshot = incomingSnapshot
    ? mergeStudentProfileAiDraft(fallbackSnapshot, incomingSnapshot)
    : fallbackSnapshot;
  const teacherEditedText = typeof body.text === "string" ? body.text.trim() : "";
  const snapshot = {
    ...structuredSnapshot,
    ...(teacherEditedText ? { publishedText: teacherEditedText } : {}),
    narrative: {
      ...safeJson(structuredSnapshot.narrative, {}),
      ...(teacherEditedText ? { teacherEditedText } : {})
    }
  };

  const html = renderStudentGrowthProfilePrintHtml(student, snapshot);
  fs.mkdirSync(storageGeneratedRoot(), { recursive: true });
  const timestamp = Date.now();
  const htmlFileName = `${student.id}-profile-${periodType}-${timestamp}.html`;
  const pdfFileName = `${student.id}-profile-${periodType}-${timestamp}.pdf`;
  const htmlPath = path.join(storageGeneratedRoot(), htmlFileName);
  const pdfPath = path.join(storageGeneratedRoot(), pdfFileName);
  fs.writeFileSync(htmlPath, normalizeGeneratedHtml(html), "utf8");
  const pdfResult = await renderPdfFromHtml(htmlPath, pdfPath).catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error)
  }));
  const outputFileName = pdfResult.ok ? pdfFileName : htmlFileName;
  const asset = await prisma.generatedAsset.create({
    data: {
      kind: `student-profile-print-${pdfResult.ok ? "pdf" : "html"}`,
      title: `${student.displayName} ${snapshot.printView?.title || "综合成长档案"} - 打印版`,
      path: path.join(storageGeneratedRoot(), outputFileName),
      url: publicGeneratedUrl(outputFileName, req),
      metadata: {
        studentId: student.id,
        profileType: snapshot.profileType || null,
        periodType,
        periodLabel: snapshot.period?.label || null,
        templateType: snapshot.printView?.templateType || "comprehensive_growth_archive",
        htmlUrl: publicGeneratedUrl(htmlFileName, req),
        pdfGenerated: pdfResult.ok,
        pdfReason: pdfResult.ok ? null : pdfResult.reason,
        visibility: "teacher_profile_print"
      }
    }
  });

  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "profile-print",
    metadata: { studentId: student.id, assetId: asset.id, periodType, pdfGenerated: pdfResult.ok }
  });

  res.json({
    ok: true,
    snapshot: filterStudentProfileSnapshot(snapshot, "teacher"),
    asset
  });
}));

app.post("/api/students/:studentId/profile/aggregate", requireDatabase, requireSession(config, ["student", "teacher"]), asyncRoute(async (req, res) => {
  const scopeError = assertStudentOwnsRequest(req, req.params.studentId);
  if (scopeError) return res.status(403).json(scopeError);
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const student = await loadStudentProfileSources(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }

  const body = getBody(req);
  const periodType = normalizeProfilePeriodType(body.periodType, "monthly");
  const baseSnapshot = buildStudentGrowthSnapshot(student, { periodType });
  const narrativeResult = await buildStudentProfileNarrative(student, baseSnapshot);
  const mergedSnapshot = narrativeResult.structuredDraft
    ? mergeStudentProfileAiDraft(baseSnapshot, narrativeResult.structuredDraft)
    : {
        ...baseSnapshot,
        narrative: {
          ...baseSnapshot.narrative,
          ...narrativeResult.narrative
        }
      };
  const snapshot = {
    ...mergedSnapshot,
    generationState: {
      aiGenerated: narrativeResult.aiGenerated,
      generatedBy: narrativeResult.generatedBy,
      unavailableReason: narrativeResult.unavailableReason
    }
  };
  await prisma.studentProfile.create({ data: { studentId: student.id, snapshot } });
  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "aggregate-profile",
    metadata: {
      studentId: student.id,
      sourceCounts: snapshot.sourceCounts,
      weeklyScore: snapshot.weeklyScore
    }
  });

  res.json({
    ok: true,
    student: mapStudent({ ...student, profiles: [{ snapshot }] }),
    snapshot: filterStudentProfileSnapshot(snapshot, req.session.role)
  });
}));

app.get("/api/students/:studentId/profile", requireDatabase, requireSession(config, ["student", "teacher"]), asyncRoute(async (req, res) => {
  const scopeError = assertStudentOwnsRequest(req, req.params.studentId);
  if (scopeError) return res.status(403).json(scopeError);
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    include: {
      accessCodes: { where: { status: "ACTIVE" }, take: 1 },
      guardians: { include: { guardian: true }, take: 1 },
      responsibleTeacher: true,
      profiles: { orderBy: { createdAt: "desc" }, take: 1 },
      reports: { orderBy: { createdAt: "desc" }, take: 20 },
      mistakes: { orderBy: { createdAt: "desc" }, take: 50, include: { knowledgePoint: true } }
    }
  });
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }
  res.json({
    ok: true,
    student: mapStudent(student),
    snapshot: filterStudentProfileSnapshot(student.profiles?.[0]?.snapshot || null, req.session.role),
    reports: student.reports.map((report) => mapReport(report, req.session.role)).filter(Boolean),
    unresolvedMistakes: student.mistakes.filter((item) => !item.masteryResolved).map(mapCorrection)
  });
}));

app.post("/api/students/:studentId/term-report/draft", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const body = getBody(req);
  const student = await loadTermReportStudent(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }

  const reportType = normalizeTermReportType(body.reportType);
  const draft = buildTermReportDraft(student, { reportType, periodLabel: body.periodLabel });
  const report = await prisma.studentReport.create({
    data: {
      studentId: student.id,
      type: termReportTypeToDb(reportType),
      periodKey: termReportPeriodKey(reportType, draft.periodLabel),
      title: draft.title,
      content: draft.sections.overview.text,
      metadata: { termReport: { ...draft, draft } }
    },
    include: { student: true }
  });
  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "draft-term-report",
    metadata: { reportId: report.id, reportType }
  });

  res.json({ ok: true, report: mapTermReportForRole(report, "teacher") });
}));

app.post("/api/students/:studentId/term-report/:reportId/pdf", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const body = getBody(req);
  const student = await loadTermReportStudent(req.params.studentId);
  if (!student) {
    return res.status(404).json({ ok: false, error: "STUDENT_NOT_FOUND", message: "未找到学生档案。" });
  }
  const report = await prisma.studentReport.findFirst({
    where: { id: req.params.reportId, studentId: student.id },
    include: { student: true }
  });
  if (!report) {
    return res.status(404).json({ ok: false, error: "REPORT_NOT_FOUND", message: "未找到阶段报告。" });
  }

  const teacherText = typeof body.teacherText === "string" && body.teacherText.trim() ? body.teacherText.trim() : report.content;
  const html = renderTermReportHtml(student, {
    ...report,
    content: teacherText,
    metadata: mergeTermReportMetadata(report.metadata, { teacherEditedText: teacherText })
  });
  fs.mkdirSync(storageGeneratedRoot(), { recursive: true });
  const htmlFileName = `${report.id}-term-report.html`;
  const pdfFileName = `${report.id}-term-report.pdf`;
  const htmlPath = path.join(storageGeneratedRoot(), htmlFileName);
  const pdfPath = path.join(storageGeneratedRoot(), pdfFileName);
  fs.writeFileSync(htmlPath, normalizeGeneratedHtml(html), "utf8");
  const pdfResult = await renderPdfFromHtml(htmlPath, pdfPath).catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error)
  }));
  const outputFileName = pdfResult.ok ? pdfFileName : htmlFileName;
  const metadata = safeJson(report.metadata, {});
  const asset = await prisma.generatedAsset.create({
    data: {
      kind: `student-term-report-${pdfResult.ok ? "pdf" : "html"}`,
      title: `${report.title} - PDF报告`,
      path: path.join(storageGeneratedRoot(), outputFileName),
      url: publicGeneratedUrl(outputFileName, req),
      metadata: {
        studentId: student.id,
        reportId: report.id,
        reportType: metadata.termReport?.reportType || null,
        htmlUrl: publicGeneratedUrl(htmlFileName, req),
        pdfGenerated: pdfResult.ok,
        pdfReason: pdfResult.ok ? null : pdfResult.reason,
        visibility: "teacher_pdf_only"
      }
    }
  });
  const updated = await prisma.studentReport.update({
    where: { id: report.id },
    data: {
      content: teacherText,
      metadata: mergeTermReportMetadata(report.metadata, {
        status: "pdf_ready",
        teacherEditedText: teacherText,
        pdfAssetId: asset.id,
        pdfUrl: asset.url,
        pdfTitle: asset.title
      })
    },
    include: { student: true }
  });
  await auditEvent(req, {
    studentId: student.id,
    feature: "student-profile",
    action: "term-report-pdf",
    metadata: { reportId: report.id, assetId: asset.id, pdfGenerated: pdfResult.ok }
  });

  res.json({ ok: true, report: mapTermReportForRole(updated, "teacher"), asset });
}));

app.post("/api/students/:studentId/term-report/:reportId/mark-sent", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const report = await prisma.studentReport.findFirst({
    where: { id: req.params.reportId, studentId: req.params.studentId },
    include: { student: true }
  });
  if (!report) {
    return res.status(404).json({ ok: false, error: "REPORT_NOT_FOUND", message: "未找到阶段报告。" });
  }

  const metadata = safeJson(report.metadata, {});
  if (!metadata.termReport?.pdfUrl) {
    return res.status(409).json({ ok: false, error: "PDF_REQUIRED", message: "请先生成 PDF，再标记已人工发送。" });
  }
  const updated = await prisma.studentReport.update({
    where: { id: report.id },
    data: {
      metadata: mergeTermReportMetadata(report.metadata, {
        status: "sent_manually",
        sentManuallyAt: new Date().toISOString(),
        sentByTeacherId: req.session.teacherId
      })
    },
    include: { student: true }
  });
  await auditEvent(req, {
    studentId: report.studentId,
    feature: "student-profile",
    action: "term-report-sent-manually",
    metadata: { reportId: report.id }
  });

  res.json({ ok: true, report: mapTermReportForRole(updated, "teacher") });
}));

app.get("/api/students/:studentId/term-reports", requireDatabase, requireSession(config, ["student", "teacher"]), asyncRoute(async (req, res) => {
  const scopeError = assertStudentOwnsRequest(req, req.params.studentId);
  if (scopeError) return res.status(403).json(scopeError);
  if (!(await assertTeacherStudentScope(req, res, req.params.studentId))) return;

  const reports = await prisma.studentReport.findMany({
    where: { studentId: req.params.studentId, type: { in: ["MIDTERM", "FINAL"] } },
    orderBy: { createdAt: "desc" },
    include: { student: true }
  });

  res.json({
    ok: true,
    reports: reports.map((report) => mapTermReportForRole(report, req.session.role)).filter(Boolean)
  });
}));

app.get("/api/teachers/:teacherId/students", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  if (req.session.teacherId !== req.params.teacherId) {
    return forbidden(res, "TEACHER_SCOPE_MISMATCH", "当前教师无权查看该数据。");
  }
  const students = await listTeacherStudents(req.params.teacherId);
  res.json({ ok: true, students });
}));

app.get("/api/admin/audit", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 80), 200);
  const [events, runs, assets, qaSessions, vocabularyRecords] = await Promise.all([
    prisma.behaviorEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { student: true }
    }),
    prisma.modelRun.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 80) }),
    prisma.generatedAsset.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 50) }),
    prisma.qaSession.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 80),
      include: { student: true }
    }),
    prisma.vocabularyRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 80),
      include: { student: true }
    })
  ]);
  const behaviorEvents = events.map((event) => ({
    ...mapLog(event),
    studentName: event.student?.displayName || "",
    metadata: event.metadata || {},
    occurredAt: event.occurredAt
  }));
  const visibleEvents = [
    ...behaviorEvents,
    ...qaSessions.map(mapQaAuditEvent),
    ...vocabularyRecords.map(mapVocabularyAuditEvent)
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit)
    .map(({ occurredAt, ...event }) => event);
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    events: visibleEvents,
    modelRuns: runs.map((run) => ({
      id: run.id,
      provider: run.provider,
      skill: run.skill || "",
      status: run.status,
      model: run.model || "",
      createdAt: run.createdAt.toISOString(),
      inputSummary: run.inputSummary || "",
      outputSummary: run.outputSummary || ""
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      url: asset.url || "",
      createdAt: asset.createdAt.toISOString()
    }))
  });
}));

app.get("/api/textbooks", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const subject = optionalText(req.query.subject);
  const grade = optionalText(req.query.grade);
  const volume = optionalText(req.query.volume);
  const search = optionalText(req.query.search);
  const where = {
    ...(subject ? { subject } : {}),
    ...(grade ? { grade } : {}),
    ...(volume ? { volume } : {}),
    ...(search ? { title: { contains: search } } : {}),
    ...(req.query.includeDemo === "true" ? {} : { path: { not: null } })
  };
  const assets = await prisma.textbookAsset.findMany({
    where,
    orderBy: [{ grade: "asc" }, { subject: "asc" }, { volume: "asc" }, { title: "asc" }],
    take: Math.min(Number(req.query.limit || 200), 500)
  });
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    assets: assets.map(mapTextbookAsset)
  });
}));

app.get("/api/content/index", requireSession(config, ["teacher"]), asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    index: readContentIndexSummary()
  });
}));

app.post(
  "/api/content/markdown-ingestion",
  requireSession(config, ["teacher"]),
  teachingMaterialUpload.array("files"),
  asyncRoute(async (req, res) => {
    const files = uploadedFileMeta(req.files || []);
    if (!files.length) {
      return res.status(400).json({ ok: false, error: "NO_FILES_UPLOADED", message: "请先选择需要导入的教学资料。" });
    }
    const blocked = files.find((file) => path.extname(file.originalName || file.fileName || "").toLowerCase() === ".edupdf");
    if (blocked) {
      return res.status(400).json({ ok: false, error: "PROTECTED_TEXTBOOK_NOT_ALLOWED", message: ".edupdf 受保护教材不能转换或改写。" });
    }

    let outDir = "exports/markdown-ingestion";
    try {
      outDir = workspaceRelativePath(req.body?.outDir, "exports/markdown-ingestion", {
        code: "INVALID_OUTPUT_PATH",
        message: "输出目录必须在项目工作区内。"
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.code || "INVALID_OUTPUT_PATH", message: error.message });
    }
    const scriptPath = path.resolve(workspaceRoot, "scripts/convert-to-markdown.mjs");
    const records = [];
    for (const file of files) {
      const result = await execFileAsync(process.execPath, [scriptPath, file.path, "--out", outDir], {
        cwd: workspaceRoot,
        env: { ...process.env },
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 16
      });
      records.push({
        originalName: file.originalName,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
        uploadUrl: file.url,
        uploadedPath: file.relativePath,
        conversion: parseMaybeJson(result.stdout, result.stdout)
      });
    }
    await auditEvent(req, {
      feature: "content-index",
      action: "markdown-ingestion",
      metadata: {
        fileCount: records.length,
        outDir,
        files: records.map((record) => ({
          originalName: record.originalName,
          size: record.size,
          uploadedPath: record.uploadedPath,
          conversion: record.conversion
        }))
      }
    });
    res.json({
      ok: true,
      outDir,
      fileCount: records.length,
      records
    });
  })
);

app.post("/api/content/index/rebuild", requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const body = getBody(req);
  const rawInputs = Array.isArray(body.inputs) && body.inputs.length
    ? body.inputs.map((item) => String(item))
    : ["exports/markdown-ingestion"];
  let inputs = rawInputs;
  try {
    inputs = rawInputs.map((item) => workspaceRelativePath(item, "exports/markdown-ingestion", {
      code: "INVALID_INPUT_PATH",
      message: "输入目录必须在项目工作区内。"
    }));
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.code || "INVALID_INPUT_PATH", message: error.message });
  }
  let outDir = "exports/content-index";
  try {
    outDir = workspaceRelativePath(body.outDir, "exports/content-index", {
      code: "INVALID_OUTPUT_PATH",
      message: "输出目录必须在项目工作区内。"
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.code || "INVALID_OUTPUT_PATH", message: error.message });
  }
  const scriptPath = path.resolve(workspaceRoot, "scripts/build-content-index.mjs");
  const resolvedOutDir = path.resolve(workspaceRoot, outDir);
  const args = [scriptPath, ...inputs, "--out", outDir];
  const result = await execFileAsync(process.execPath, args, {
    cwd: workspaceRoot,
    env: { ...process.env },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
  const parsed = parseMaybeJson(result.stdout, result.stdout);
  const index = readContentIndexSummary(path.resolve(resolvedOutDir, "index.json"));
  await auditEvent(req, {
    feature: "content-index",
    action: "rebuild",
    metadata: {
      inputs,
      outDir,
      stdout: result.stdout?.slice(-2000) || "",
      documentCount: index.documentCount
    }
  });
  res.json({
    ok: true,
    rebuild: parsed,
    index
  });
}));

app.get("/api/knowledge/sources", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const clauses = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  for (const [field, value] of [
    ["sourceType", optionalText(req.query.sourceType)],
    ["subject", optionalText(req.query.subject)],
    ["grade", optionalText(req.query.grade)],
    ["reviewStatus", optionalText(req.query.reviewStatus)]
  ]) {
    if (value) clauses.push(`s."${field}" = ${addParam(value)}`);
  }
  const search = optionalText(req.query.search);
  if (search) {
    const placeholder = addParam(`%${search}%`);
    clauses.push(`(s."title" ILIKE ${placeholder} OR COALESCE(s."summary", '') ILIKE ${placeholder})`);
  }
  const limit = Math.min(Number(req.query.limit || 80), 200);
  const limitPlaceholder = addParam(limit);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.*, COALESCE(c."chunkCount", 0)::int AS "chunkCount"
     FROM "KnowledgeSource" s
     LEFT JOIN (
       SELECT "sourceId", COUNT(*) AS "chunkCount"
       FROM "KnowledgeChunk"
       GROUP BY "sourceId"
     ) c ON c."sourceId" = s."id"
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY s."updatedAt" DESC
     LIMIT ${limitPlaceholder}`,
    ...params
  );
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    sources: rows.map(mapKnowledgeSourceRow)
  });
}));

app.post("/api/knowledge/sources", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const body = getBody(req);
  const title = readableText(body.title, "");
  if (!title) {
    return res.status(400).json({ ok: false, error: "TITLE_REQUIRED", message: "请填写资料标题。" });
  }
  const id = `ks_${randomUUID()}`;
  const sourceType = readableText(body.sourceType, "network-reference");
  const licenseStatus = readableText(body.licenseStatus, "REVIEW_REQUIRED");
  const metadata = {
    knowledgePoints: Array.isArray(body.knowledgePoints) ? body.knowledgePoints : [],
    note: body.note || null,
    createdByTeacherId: req.session.teacherId,
    createdFrom: "teacher-manual-source"
  };
  await prisma.$executeRaw`
    INSERT INTO "KnowledgeSource" (
      "id", "title", "sourceType", "subject", "grade", "edition", "volume", "unit", "lesson",
      "sourceUrl", "sourcePath", "markdownPath", "licenseStatus", "reviewStatus",
      "allowedForGeneration", "confidence", "summary", "metadata", "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${title}, ${sourceType}, ${optionalText(body.subject)}, ${optionalText(body.grade)},
      ${optionalText(body.edition)}, ${optionalText(body.volume)}, ${optionalText(body.unit)}, ${optionalText(body.lesson)},
      ${optionalText(body.sourceUrl)}, ${optionalText(body.sourcePath)}, ${optionalText(body.markdownPath)},
      ${licenseStatus}, 'PENDING', false, ${optionalNumber(body.confidence) ?? 0.6},
      ${optionalText(body.summary)}, ${JSON.stringify(metadata)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await auditEvent(req, {
    feature: "knowledge-library",
    action: "create-source",
    metadata: { sourceId: id, title, sourceType, licenseStatus }
  });
  const rows = await prisma.$queryRaw`SELECT *, 0::int AS "chunkCount" FROM "KnowledgeSource" WHERE "id" = ${id}`;
  res.json({ ok: true, source: mapKnowledgeSourceRow(rows[0]) });
}));

app.post("/api/knowledge/sources/sync-content-index", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const body = getBody(req);
  const indexPath = path.resolve(workspaceRoot, workspaceRelativePath(body.indexPath, "exports/content-index/index.json", {
    code: "INVALID_INDEX_PATH",
    message: "内容索引路径必须在项目工作区内。"
  }));
  const index = readContentIndexRaw(indexPath);
  if (!index) {
    return res.status(404).json({ ok: false, error: "CONTENT_INDEX_NOT_FOUND", message: "请先重建内容索引，再同步到资料库。" });
  }
  const sync = await syncContentIndexToKnowledgeLibrary(index, req.session.teacherId);
  await auditEvent(req, {
    feature: "knowledge-library",
    action: "sync-content-index",
    metadata: {
      indexPath: path.relative(workspaceRoot, indexPath),
      sourceCount: sync.sourceCount,
      chunkCount: sync.chunkCount
    }
  });
  res.json({ ok: true, sync });
}));

app.patch("/api/knowledge/sources/:sourceId/review", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const body = getBody(req);
  const status = readableText(body.status, "PENDING").toUpperCase();
  const licenseStatus = readableText(body.licenseStatus, "");
  const note = readableText(body.note, "");
  const allowedForGeneration = status === "APPROVED" && body.allowedForGeneration === true && licenseStatus !== "NOT_ALLOWED";
  const rows = await prisma.$queryRaw`SELECT * FROM "KnowledgeSource" WHERE "id" = ${req.params.sourceId} LIMIT 1`;
  if (!rows.length) {
    return res.status(404).json({ ok: false, error: "KNOWLEDGE_SOURCE_NOT_FOUND", message: "未找到资料来源。" });
  }
  await prisma.$executeRaw`
    UPDATE "KnowledgeSource"
    SET "reviewStatus" = ${status},
        "licenseStatus" = COALESCE(NULLIF(${licenseStatus}, ''), "licenseStatus"),
        "allowedForGeneration" = ${allowedForGeneration},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${req.params.sourceId}
  `;
  await prisma.$executeRaw`
    INSERT INTO "SourceReview" ("id", "sourceId", "teacherId", "status", "note", "createdAt")
    VALUES (${`sr_${randomUUID()}`}, ${req.params.sourceId}, ${req.session.teacherId}, ${status}, ${note || null}, CURRENT_TIMESTAMP)
  `;
  await auditEvent(req, {
    feature: "knowledge-library",
    action: "review-source",
    metadata: {
      sourceId: req.params.sourceId,
      status,
      allowedForGeneration
    }
  });
  const updated = await prisma.$queryRaw`
    SELECT s.*, COALESCE(c."chunkCount", 0)::int AS "chunkCount"
    FROM "KnowledgeSource" s
    LEFT JOIN (
      SELECT "sourceId", COUNT(*) AS "chunkCount"
      FROM "KnowledgeChunk"
      GROUP BY "sourceId"
    ) c ON c."sourceId" = s."id"
    WHERE s."id" = ${req.params.sourceId}
    LIMIT 1
  `;
  res.json({ ok: true, source: mapKnowledgeSourceRow(updated[0]) });
}));

app.patch("/api/textbooks/:assetId/chapters", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const asset = await prisma.textbookAsset.findUnique({ where: { id: req.params.assetId } });
  if (!asset) {
    return res.status(404).json({ ok: false, error: "TEXTBOOK_NOT_FOUND", message: "未找到教材索引。" });
  }
  const body = getBody(req);
  const currentMetadata = safeJson(asset.metadata, {});
  const chapters = Array.isArray(body.chapters)
    ? body.chapters.map(normalizeTextbookChapter)
    : [];
  const updated = await prisma.textbookAsset.update({
    where: { id: asset.id },
    data: {
      metadata: {
        ...currentMetadata,
        chapters,
        chapterIndexStatus: chapters.length ? "teacher-draft" : "empty",
        chapterIndexUpdatedAt: new Date().toISOString(),
        chapterIndexUpdatedByTeacherId: req.session.teacherId
      }
    }
  });
  await auditEvent(req, {
    feature: "textbook-library",
    action: "update-chapters",
    metadata: {
      assetId: asset.id,
      title: asset.title,
      chapterCount: chapters.length
    }
  });
  res.json({ ok: true, asset: mapTextbookAsset(updated) });
}));

app.post("/api/textbooks/rescan", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const scriptPath = path.resolve(workspaceRoot, "scripts/scan-textbook-assets.mjs");
  const result = await execFileAsync(process.execPath, [scriptPath, "--write"], {
    cwd: workspaceRoot,
    env: { ...process.env, TEXTBOOK_ROOT: config.TEXTBOOK_ROOT || process.env.TEXTBOOK_ROOT || "" },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
  const importScriptPath = path.resolve(workspaceRoot, "scripts/import-textbook-assets.mjs");
  const importResult = await execFileAsync(process.execPath, [importScriptPath], {
    cwd: workspaceRoot,
    env: { ...process.env },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
  await auditEvent(req, {
    feature: "textbook-library",
    action: "rescan-import",
    metadata: {
      stdout: result.stdout?.slice(-2000) || "",
      importStdout: importResult.stdout?.slice(-2000) || ""
    }
  });
  res.json({
    ok: true,
    scan: parseMaybeJson(result.stdout, result.stdout),
    import: parseMaybeJson(importResult.stdout, importResult.stdout)
  });
}));

app.post("/api/textbooks/:assetId/open", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const asset = await prisma.textbookAsset.findUnique({ where: { id: req.params.assetId } });
  if (!asset) {
    return res.status(404).json({ ok: false, error: "TEXTBOOK_NOT_FOUND", message: "未找到教材索引。" });
  }
  if (!asset.path || !fs.existsSync(asset.path)) {
    return res.status(404).json({ ok: false, error: "TEXTBOOK_FILE_NOT_FOUND", message: "教材原文件不存在或路径不可访问。" });
  }

  const platform = os.platform();
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", asset.path] : [asset.path];
  const opened = await execFileAsync(command, args, { windowsHide: true }).then(
    () => true,
    () => false
  );
  await auditEvent(req, {
    feature: "textbook-library",
    action: "open-source-file",
    metadata: {
      assetId: asset.id,
      title: asset.title,
      path: asset.path,
      opened
    }
  });

  res.json({
    ok: opened,
    opened,
    asset: mapTextbookAsset(asset),
    message: opened ? "已尝试用本机默认程序打开教材。" : "未能自动打开，请确认 .edupdf 已关联智慧中小学 App。"
  });
}));

app.post("/api/teacher-login", requireDatabase, asyncRoute(async (req, res) => {
  const { name, phone, accessCode } = getBody(req);
  const teacher = await prisma.teacher.findFirst({
    where: {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      accessCodes: { some: { codeHash: hashAccessCode(accessCode), status: "ACTIVE" } }
    },
    include: { accessCodes: { where: { status: "ACTIVE" }, take: 1 } }
  });

  if (!teacher || teacher.status !== "ACTIVE") {
    return res.status(401).json({
      ok: false,
      error: "INVALID_TEACHER_LOGIN",
      message: "教师登录失败，请检查电话和专属码。"
    });
  }

  const sessionToken = createSessionToken(config, {
    role: "teacher",
    teacherId: teacher.id,
    displayName: teacher.name
  });

  res.json({
    ok: true,
    sessionToken,
    teacher: {
      id: teacher.id,
      displayName: teacher.name,
      phone: teacher.phone || "",
      role: teacher.role || "",
      status: teacherStatusToClient(teacher.status)
    }
  });
}));

app.post("/api/student-login", requireDatabase, asyncRoute(async (req, res) => {
  const { displayName, guardianPhone, accessCode } = getBody(req);
  const student = await prisma.student.findFirst({
    where: {
      displayName,
      loginEnabled: true,
      accessCodes: { some: { codeHash: hashAccessCode(accessCode), status: "ACTIVE" } },
      guardians: guardianPhone
        ? { some: { guardian: { phone: guardianPhone } } }
        : undefined
    },
    include: {
      responsibleTeacher: true,
      guardians: { include: { guardian: true } }
    }
  });

  if (!student) {
    return res.status(401).json({
      ok: false,
      error: "INVALID_STUDENT_LOGIN",
      message: "学生登录失败，请检查姓名、家长电话和专属码。"
    });
  }

  const sessionToken = createSessionToken(config, {
    role: "student",
    studentId: student.id,
    displayName: student.displayName
  });
  const sessionPayload = verifySessionToken(config, sessionToken);
  await prisma.$executeRaw`
    UPDATE "Student"
    SET "currentSessionJti" = ${sessionPayload?.jti || null},
        "currentSessionAt" = ${new Date()}
    WHERE "id" = ${student.id}
  `;

  res.json({
    ok: true,
    sessionToken,
    student: {
      id: student.id,
      displayName: student.displayName,
      grade: student.grade,
      className: student.className,
      responsibleTeacher: student.responsibleTeacher
        ? { id: student.responsibleTeacher.id, name: student.responsibleTeacher.name }
        : null
    }
  });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : String(err)
  });
});

if (process.argv.includes("--check")) {
  const database = await checkDatabaseStatus({ force: true });
  console.log(
    JSON.stringify(
      {
        ok: true,
        config: publicConfigSummary(config),
        database,
        ai: buildAiStartupSnapshot(config)
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
} else {
  app.listen(port, host, () => {
    console.log(`Junhang API listening at http://${host}:${port}`);
  });
}
