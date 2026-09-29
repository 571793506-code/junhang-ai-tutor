import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateGradingGoldCases } from "./quality-gold-contract.mjs";

const GOLD_COLLECTION_SCHEMA_VERSION = "grading-gold-collection-v1";
const SOURCE_PACKAGE_SCHEMA_VERSION = "junhang-grading-source-v1";
const VALID_STATUSES = new Set(["correct", "wrong", "partial", "uncertain"]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "unknown"), "utf8").digest("hex").slice(0, 16);
}

function sanitizeText(value, privateNames = []) {
  let output = text(value);
  for (const privateName of privateNames.filter(Boolean).sort((a, b) => b.length - a.length)) {
    output = output.split(privateName).join("[REDACTED]");
  }
  return output
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]")
    .replace(/(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)/g, "[REDACTED]");
}

function sanitizeValue(value, privateNames = []) {
  if (typeof value === "string") return sanitizeText(value, privateNames);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, privateNames));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, privateNames)]));
  }
  return value;
}

function normalizeTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function questionNo(question, index) {
  return text(question?.questionNo ?? question?.no) || String(index + 1);
}

function questionResults(result) {
  const value = record(result);
  return list(value.questionResults).length ? list(value.questionResults) : list(value.questions);
}

function sourcePackageFor(row) {
  const content = record(row.content);
  const metadata = record(row.assignment?.metadata);
  const result = record(row.grading?.result);
  const packageValue = metadata.gradingSourcePackage || content.sourcePackage || result.sourcePackage;
  return record(packageValue);
}

function sourcePackageQuestions(packageValue) {
  return list(packageValue.questions).length ? list(packageValue.questions) : list(packageValue.questionResults);
}

function isTeacherReviewedQuestion(question) {
  return question?.reviewedByTeacher === true || question?.review?.reviewedByTeacher === true;
}

function sourceKind(row, packageValue) {
  const content = record(row.content);
  const metadata = record(row.assignment?.metadata);
  const result = record(row.grading?.result);
  if (Object.keys(packageValue).length > 0) return "generated_assessment";
  if (content.externalGradingRecognition || content.materialType === "external_workbook") return "external_workbook";
  if (metadata.kind || content.kind || result.gradingSource) return "historical_grading";
  return "unknown";
}

function isDemoRecord(row) {
  const content = record(row.content);
  const metadata = record(row.assignment?.metadata);
  const result = record(row.grading?.result);
  return [content.source, metadata.source, result.source].some((value) => text(value).toLowerCase() === "demo");
}

function confirmationValue(row, questions) {
  const result = record(row.grading?.result);
  const content = record(row.content);
  const reviewerId = result.reviewedByTeacherId || result.teacherReviewUpdatedBy || content.reviewedByTeacherId;
  const reviewedAt = normalizeTimestamp(
    result.reviewedAt || result.teacherReviewUpdatedAt || content.reviewedAt || questions.map((item) => item.reviewedAt).find(Boolean)
  );
  return {
    confirmedBy: `teacher-${shortHash(reviewerId || `${row.id}-confirmed`)}`,
    confirmedAt: reviewedAt,
    reviewerIdPresent: Boolean(reviewerId)
  };
}

function buildInput(row, packageValue, packageQuestions, gradingQuestions, privateNames) {
  const content = record(row.content);
  const metadata = record(row.assignment?.metadata);
  const result = record(row.grading?.result);
  const packageByNo = new Map(packageQuestions.map((item, index) => [questionNo(item, index), item]));
  const recognitionQuestions = list(content.ocrQuestions).length ? content.ocrQuestions : list(content.ocr?.questions);
  const recognitionByNo = new Map(recognitionQuestions.map((item, index) => [questionNo(item, index), item]));
  const sanitizedQuestions = packageQuestions.map((item, index) => ({
    questionNo: questionNo(item, index),
    prompt: sanitizeText(item.prompt, privateNames),
    correctAnswer: sanitizeValue(item.correctAnswer, privateNames),
    maxScore: finiteNumber(item.maxScore),
    analysisSteps: list(item.analysisSteps).map((step) => sanitizeText(step, privateNames)),
    knowledgePoint: sanitizeText(item.knowledgePoint, privateNames),
    rubric: sanitizeValue(item.rubric, privateNames),
    ...(item.context !== undefined ? { context: sanitizeValue(item.context, privateNames) } : {}),
    ...(item.itemType !== undefined ? { itemType: sanitizeText(item.itemType, privateNames) } : {}),
    ...(item.type !== undefined ? { type: sanitizeText(item.type, privateNames) } : {}),
    ...(item.figure !== undefined ? { figure: sanitizeValue(item.figure, privateNames) } : {})
  }));
  const ocrQuestions = gradingQuestions.map((item, index) => {
    const no = questionNo(item, index);
    const packageQuestion = packageByNo.get(no) || {};
    // The confirmed answer may contain a teacher correction; process and geometry
    // come from recognition evidence, never the grader's studentProcess/analysis.
    const recognition = { ...item, ...record(recognitionByNo.get(no)) };
    return {
      questionNo: no,
      printedPrompt: sanitizeText(packageQuestion.prompt || item.prompt, privateNames),
      studentAnswer: sanitizeValue(item.studentAnswer, privateNames),
      confidence: recognition.confidence == null ? null : finiteNumber(recognition.confidence),
      ...(recognition.observedWork !== undefined ? { observedWork: sanitizeValue(recognition.observedWork, privateNames) } : {}),
      ...(recognition.bbox !== undefined ? { bbox: sanitizeValue(recognition.bbox, privateNames) } : {}),
      ...(recognition.page !== undefined ? { page: finiteNumber(recognition.page) } : {}),
      ...(recognition.sourceImageRef !== undefined ? { sourceImageRef: sanitizeText(recognition.sourceImageRef, privateNames) } : {}),
      ...(recognition.cropRef !== undefined ? { cropRef: sanitizeText(recognition.cropRef, privateNames) } : {})
    };
  });

  return {
    subject: sanitizeText(packageValue.subject || metadata.subject || content.subject || result.subject, privateNames) || null,
    grade: sanitizeText(packageValue.grade || metadata.grade || content.grade, privateNames) || null,
    kind: sanitizeText(packageValue.kind || metadata.kind || content.kind, privateNames) || null,
    totalScore: finiteNumber(packageValue.totalScore || metadata.totalScore || result.maxScore || result.fullScore),
    gradingSourcePackage: {
      schemaVersion: text(packageValue.schemaVersion) || SOURCE_PACKAGE_SCHEMA_VERSION,
      version: text(packageValue.version) || null,
      fingerprint: text(packageValue.fingerprint) || null,
      subject: sanitizeText(packageValue.subject, privateNames) || null,
      grade: sanitizeText(packageValue.grade, privateNames) || null,
      kind: sanitizeText(packageValue.kind, privateNames) || null,
      totalScore: finiteNumber(packageValue.totalScore),
      questions: sanitizedQuestions
    },
    questionLayoutManifest: {
      questions: sanitizedQuestions.map((item) => ({
        questionNo: item.questionNo,
        prompt: item.prompt,
        correctAnswer: item.correctAnswer,
        maxScore: item.maxScore,
        ...(item.context !== undefined ? { context: item.context } : {}),
        ...(item.itemType !== undefined ? { itemType: item.itemType } : {}),
        ...(item.type !== undefined ? { type: item.type } : {}),
        ...(item.figure !== undefined ? { figure: item.figure } : {})
      }))
    },
    ocrQuestions
  };
}

function buildExpected(row, packageQuestions, gradingQuestions, privateNames) {
  const packageByNo = new Map(packageQuestions.map((item, index) => [questionNo(item, index), item]));
  const result = record(row.grading?.result);
  const questionResults = gradingQuestions.map((item, index) => {
    const no = questionNo(item, index);
    const packageQuestion = packageByNo.get(no) || {};
    const status = text(item.status).toLowerCase();
    const answer = item.correctAnswer ?? item.answer ?? packageQuestion.correctAnswer;
    const expected = {
      questionNo: no,
      status,
      studentAnswer: sanitizeValue(item.studentAnswer, privateNames),
      score: finiteNumber(item.score),
      maxScore: finiteNumber(item.maxScore ?? packageQuestion.maxScore),
      confidence: finiteNumber(item.confidence),
      knowledgePoint: sanitizeText(item.knowledgePoint, privateNames),
      errorStep: sanitizeText(item.errorStep, privateNames),
      explanation: sanitizeText(item.explanation, privateNames)
    };
    if (answer !== undefined && answer !== null && answer !== "") {
      expected.correctAnswer = sanitizeValue(answer, privateNames);
    }
    return Object.fromEntries(Object.entries(expected).filter(([, value]) => value !== null && value !== ""));
  });

  return {
    score: finiteNumber(row.grading?.score ?? result.score),
    needsTeacherReview: false,
    questionResults
  };
}

function baseSummary(row, packageValue, gradingQuestions, reasons) {
  const result = record(row.grading?.result);
  const reviewCount = gradingQuestions.filter(isTeacherReviewedQuestion).length;
  return {
    caseId: `grading-${shortHash(row.id)}`,
    sourceType: sourceKind(row, packageValue),
    questionCount: gradingQuestions.length,
    reviewedQuestionCount: reviewCount,
    archiveEligible: result.archiveEligible === true,
    reasons
  };
}

export function buildGradingGoldCase(row = {}) {
  const content = record(row.content);
  const metadata = record(row.assignment?.metadata);
  const grading = record(row.grading);
  const result = record(grading.result);
  const packageValue = sourcePackageFor(row);
  const packageQuestions = sourcePackageQuestions(packageValue);
  const gradingQuestions = questionResults(result);
  const privateNames = [row.student?.displayName, content.studentName, metadata.studentName].map(text).filter(Boolean);
  const reasons = [];
  const confirmation = confirmationValue(row, gradingQuestions);
  const archived = result.archiveEligible === true;
  const reviewStatus = text(result.reviewStatus).toLowerCase();

  if (!row.id) reasons.push("SUBMISSION_ID_MISSING");
  if (isDemoRecord(row)) reasons.push("SYNTHETIC_OR_DEMO_SOURCE");
  if (!grading.result || typeof grading.result !== "object") reasons.push("GRADING_RESULT_MISSING");
  if (!gradingQuestions.length) reasons.push("NO_QUESTION_RESULTS");
  if (grading.needsReview === true) reasons.push("RESULT_STILL_NEEDS_REVIEW");
  if (!archived) reasons.push("ARCHIVE_NOT_ELIGIBLE");
  if (reviewStatus !== "reviewed" && !archived) reasons.push("TEACHER_REVIEW_NOT_CONFIRMED");
  if (reviewStatus !== "reviewed" && archived) reasons.push("ARCHIVE_CONFIRMATION_FALLBACK");
  if (gradingQuestions.some((item) => !isTeacherReviewedQuestion(item))) reasons.push("QUESTION_TEACHER_REVIEW_REQUIRED");
  if (!Object.keys(packageValue).length) reasons.push("GRADING_SOURCE_PACKAGE_REQUIRED");
  if (Object.keys(packageValue).length > 0 && (
    packageQuestions.length !== gradingQuestions.length
    || text(packageValue.schemaVersion) !== SOURCE_PACKAGE_SCHEMA_VERSION
    || !text(packageValue.sourceId)
    || !text(packageValue.fingerprint).startsWith("sha256:")
    || packageQuestions.some((item, index) => (
      !questionNo(item, index)
      || !text(item.prompt)
      || !hasMeaningfulValue(item.correctAnswer)
      || finiteNumber(item.maxScore) == null
      || finiteNumber(item.maxScore) <= 0
    ))
  )) reasons.push("GRADING_SOURCE_PACKAGE_INCOMPLETE");
  if (!confirmation.confirmedAt) reasons.push("TEACHER_CONFIRMATION_TIME_MISSING");

  const questionNos = new Set();
  gradingQuestions.forEach((item, index) => {
    const no = questionNo(item, index);
    if (questionNos.has(no)) reasons.push("QUESTION_NUMBER_INVALID");
    questionNos.add(no);
    const status = text(item.status).toLowerCase();
    if (!VALID_STATUSES.has(status)) reasons.push("QUESTION_STATUS_INVALID");
    const packageQuestion = packageQuestions.find((candidate, candidateIndex) => questionNo(candidate, candidateIndex) === no) || {};
    const answer = item.correctAnswer ?? item.answer ?? packageQuestion.correctAnswer;
    const reason = item.reason ?? item.uncertainReason ?? item.explanation ?? item.errorStep;
    if (status === "uncertain" && !text(reason) && !answer) reasons.push("UNCERTAIN_REASON_MISSING");
    if (status !== "uncertain" && (answer === undefined || answer === null || answer === "")) reasons.push("TEACHER_CONFIRMED_ANSWER_MISSING");
  });

  const summary = baseSummary(row, packageValue, gradingQuestions, [...new Set(reasons)]);
  if (summary.reasons.length) return { ok: false, summary };

  const sourceType = sourceKind(row, packageValue);
  const caseValue = {
    caseId: summary.caseId,
    sourceType,
    input: buildInput(row, packageValue, packageQuestions, gradingQuestions, privateNames),
    expected: buildExpected(row, packageQuestions, gradingQuestions, privateNames),
    teacherReview: {
      confirmedBy: confirmation.confirmedBy,
      confirmedAt: confirmation.confirmedAt,
      modifiedQuestionNos: [],
      modificationEvidence: "not_recorded",
      confirmationSource: "teacher_confirmed_archive"
    }
  };
  const validation = validateGradingGoldCases([caseValue]);
  if (!validation.ok) {
    return {
      ok: false,
      summary: { ...summary, reasons: ["GOLD_CASE_CONTRACT_INVALID", ...validation.issues] }
    };
  }
  return { ok: true, caseValue: validation.normalizedCases[0], summary };
}

export function buildGradingGoldCollection(rows = [], options = {}) {
  const cases = [];
  const blocked = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const result = buildGradingGoldCase(row);
    if (result.ok) cases.push(result.caseValue);
    else blocked.push(result.summary);
  }
  const validation = validateGradingGoldCases(cases);
  if (!validation.ok) throw new Error(["GOLD_CASE_COLLECTION_INVALID", ...validation.issues].join("\n"));
  return {
    schemaVersion: GOLD_COLLECTION_SCHEMA_VERSION,
    mode: options.mode || "dry-run",
    counts: {
      scannedCases: Array.isArray(rows) ? rows.length : 0,
      teacherConfirmedCases: cases.length,
      blockedCases: blocked.length,
      questions: cases.reduce((sum, item) => sum + item.expected.questionResults.length, 0),
      productionEligible: false
    },
    cases: validation.normalizedCases,
    blocked,
    evidenceBoundary: {
      teacherConfirmed: cases.length > 0,
      productionEligible: false,
      productionAccuracyClaim: false,
      note: "采集结果仍需由教师确认样本范围后单独运行质量评估，不自动形成生产准确率结论。"
    }
  };
}

async function loadRows(prisma) {
  return prisma.submission.findMany({
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      submittedAt: true,
      content: true,
      student: { select: { displayName: true } },
      grading: { select: { score: true, needsReview: true, result: true } },
      assignment: {
        select: {
          metadata: true,
          items: { select: { prompt: true, answer: true, rubric: true, metadata: true } }
        }
      }
    }
  });
}

function writeCases(filePath, cases) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  return resolved;
}

function parseArgs(args) {
  const writeIndex = args.indexOf("--write");
  if (writeIndex === -1) return { writePath: null };
  const writePath = args[writeIndex + 1];
  if (!writePath || writePath.startsWith("--")) throw new Error("--write requires a file path");
  return { writePath };
}

async function runCli() {
  const { writePath } = parseArgs(process.argv.slice(2));
  const { prisma } = await import("@junhang/db");
  try {
    const rows = await loadRows(prisma);
    const collection = buildGradingGoldCollection(rows, { mode: writePath ? "write" : "dry-run" });
    let writtenPath = null;
    if (writePath) writtenPath = writeCases(writePath, collection.cases);
    const report = {
      schemaVersion: collection.schemaVersion,
      mode: collection.mode,
      counts: collection.counts,
      evidenceBoundary: collection.evidenceBoundary,
      blocked: collection.blocked,
      writtenPath
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
