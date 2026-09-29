import { GRADING_SOURCE_PACKAGE_SCHEMA_VERSION, gradingSourcePackageToAssignmentItems, validateGradingSourcePackage } from "@junhang/core/grading-source-package";

const safeJson = (value, fallback) => value && typeof value === "object" ? value : fallback;

export function gradingSourcePackageForAssignment(assignment = {}) {
  const metadata = safeJson(assignment.metadata, {});
  const sourcePackage = safeJson(metadata.gradingSourcePackage, null);
  if (!sourcePackage || sourcePackage.schemaVersion !== GRADING_SOURCE_PACKAGE_SCHEMA_VERSION) return null;
  if (sourcePackage.sourceId !== assignment.id || !Array.isArray(sourcePackage.questions) || !sourcePackage.questions.length) return null;
  if (!validateGradingSourcePackage(sourcePackage).ok) return null;
  return sourcePackage;
}

export function gradingSourceReference(sourcePackage = null) {
  if (!sourcePackage) return null;
  return {
    sourceId: sourcePackage.sourceId,
    version: sourcePackage.version,
    fingerprint: sourcePackage.fingerprint
  };
}

export async function buildSubmissionGradeInputFromRecord(submission, recognition = null, { findLatestQuestionLayoutManifest = async () => null } = {}) {
  const content = safeJson(submission.content, {});
  const assignment = submission.assignment || {};
  const assignmentMetadata = safeJson(assignment.metadata, {});
  const dialogueAnswerPackage = safeJson(content.dialogueAnswerPackage, null);
  const gradingSourcePackage = gradingSourcePackageForAssignment(assignment);
  const importedSourcePackage = dialogueAnswerPackage && validateGradingSourcePackage(dialogueAnswerPackage).ok
    ? dialogueAnswerPackage
    : null;
  // Assignment is the single source of truth. The submission copy remains a
  // legacy fallback for records created before shared package persistence.
  const authoritativeSourcePackage = gradingSourcePackage || importedSourcePackage;
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
    gradingSourcePackage: authoritativeSourcePackage,
    assignmentItems: authoritativeSourcePackage
      ? gradingSourcePackageToAssignmentItems(authoritativeSourcePackage).map((item) => ({
          ...item, questionNo: item.metadata.sourceQuestionNo, score: item.metadata.score
        }))
      : assignment.items?.map((item) => ({
          questionNo: item.orderIndex,
          prompt: item.prompt,
          answer: item.answer,
          rubric: item.rubric,
          metadata: item.metadata || {}
        })) || [],
    answerKey: authoritativeSourcePackage
      ? Object.fromEntries(authoritativeSourcePackage.questions.map((question) => [question.questionNo, question.correctAnswer]))
      : assignmentMetadata.answerKey || null,
    questionLayoutManifest,
    assignmentAnalysis: {
      subject: assignment.subject?.name || assignmentMetadata.subject || null,
      kind: assignmentMetadata.kind || null,
      difficulty: assignment.difficulty || null,
      questionLayoutManifest,
      gradingSource: gradingSourceReference(authoritativeSourcePackage)
    }
  };
}
