import { selectCurrentTeachingEvidence } from "@junhang/services";

export function reviewedMistakesFromResult(result = {}, submission = {}) {
  const subject = submission.assignment?.subject?.name || submission.assignment?.metadata?.subject || "unknown";
  const sourceVersion = result.workflowRevision ?? result.sourceRevision ?? result.gradingSource?.version ?? null;
  const questionMistakes = Array.isArray(result.questionResults)
    ? result.questionResults
        .filter((item) => ["wrong", "partial"].includes(item?.status) && item?.reviewedByTeacher === true)
        .map((item) => ({
          prompt: item.prompt || `第${item.questionNo || ""}题：${item.knowledgePoint || "错题"}`,
          studentAnswer: item.studentAnswer || null,
          correctAnswer: item.correctAnswer || null,
          cause: item.teacherNote || item.errorStep || item.explanation || "教师复核确认后归档。",
          point: item.knowledgePoint || subject,
          severity: item.status === "partial" ? "partial" : "normal",
          metadata: {
            questionNos: [String(item.questionNo || "").trim()].filter(Boolean),
            ...(item.teacherNote ? { teacherNote: item.teacherNote } : {}),
            ...(sourceVersion == null ? {} : { sourceVersion })
          }
        }))
    : [];
  return questionMistakes
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
        sourceSubmissionId: submission.id,
        assignmentId: submission.assignmentId,
        ...(sourceVersion == null ? {} : { sourceVersion }),
        reviewStatus: "teacher_reviewed",
        severity: mistake.severity || "normal"
      }
    }));
}

export async function loadCurrentTeachingEvidence(prisma, student) {
  if (!student) return null;
  // The recent-80 window is not an archive authority: a zero-mistake correction
  // may replace an older record even when its original submission is outside it.
  const archives = await prisma.submission.findMany({
    where: { studentId: student.id, content: { path: ["workflowArchive", "schemaVersion"], equals: "teaching-workflow-archive-v1" } },
    include: { grading: true, assignment: { include: { subject: true } } }
  });
  const byId = new Map((student.submissions || []).map((submission) => [submission.id, submission]));
  for (const submission of archives) byId.set(submission.id, submission);
  return selectCurrentTeachingEvidence({ ...student, submissions: [...byId.values()] });
}

function questionNos(metadata = {}) {
  return new Set(
    (Array.isArray(metadata.questionNos) ? metadata.questionNos : [])
      .map((questionNo) => String(questionNo || "").trim())
      .filter(Boolean)
  );
}

export function filterNewReviewedMistakes(existingMistakes = [], reviewedMistakes = [], submissionId = "", options = {}) {
  const sourceVersion = options.sourceVersion == null ? null : String(options.sourceVersion);
  const archivedQuestionNos = new Set();
  for (const mistake of Array.isArray(existingMistakes) ? existingMistakes : []) {
    const metadata = mistake?.metadata && typeof mistake.metadata === "object" ? mistake.metadata : {};
    if (String(metadata.sourceSubmissionId || metadata.submissionId || "") !== String(submissionId || "")) continue;
    if (sourceVersion != null && String(metadata.sourceVersion || "") !== sourceVersion) continue;
    for (const questionNo of questionNos(metadata)) archivedQuestionNos.add(questionNo);
  }
  return (Array.isArray(reviewedMistakes) ? reviewedMistakes : []).filter((mistake) => {
    const mistakeQuestionNos = questionNos(mistake?.metadata);
    return !mistakeQuestionNos.size || [...mistakeQuestionNos].some((questionNo) => !archivedQuestionNos.has(questionNo));
  });
}
