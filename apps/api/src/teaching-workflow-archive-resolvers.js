import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildGradingSourcePackage, validateGradingSourcePackage } from "@junhang/core";
import { isTeachingWorkflowArchiveSubmission } from "@junhang/services";
import { requireAllQuestionsReviewedForArchive } from "./grading-review-gates.js";
import { EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION } from "./external-grading-recognition.js";
import { isImmutableTeachingArchive } from "./teaching-archive-guard.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const blocked = () => ({ ok: false });
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function legacyAssignmentQuestionTypes(assignment, sourcePackage) {
  const items = assignment.items || [];
  const canonical = buildGradingSourcePackage({ ...assignment, items }).package?.questions || [];
  return sourcePackage.questions.flatMap((ref) => {
    if (text(ref.context?.itemType)) return [];
    const matches = canonical.map((q, index) => ({ q, item: items[index] })).filter(({ q }) => q.questionNo === ref.questionNo);
    if (matches.length !== 1) return [];
    const { q, item } = matches[0];
    if (!text(item.itemType) || q.prompt !== ref.prompt || !isDeepStrictEqual(q.correctAnswer, ref.correctAnswer) || q.maxScore !== ref.maxScore) return [];
    return [{ questionNo: ref.questionNo, itemType: item.itemType }];
  });
}

// These adapters only read server data. Snapshot bindings must be attached by a
// server draft executor, not accepted as HTTP/CLI request fields.
export function createTeachingWorkflowArchiveResolvers({ prisma }) {
  const transaction = (tx, run) => tx ? run(tx) : prisma.$transaction(run);
  const authorizeStudent = async ({ actor, studentId, tx }) => {
    if (!text(actor?.teacherId) || !text(studentId)) return false;
    return transaction(tx, async (db) => Boolean(await db.student.findFirst({ where: { id: studentId,
      OR: [{ responsibleTeacherId: actor.teacherId }, { teacherAssignments: { some: { teacherId: actor.teacherId, activeTo: null } } }]
    }, select: { id: true } })));
  };
  const read = async ({ actor, request, tx }) => {
    if (!text(request?.submissionId) || !text(request?.studentId) || !await authorizeStudent({ actor, studentId: request.studentId, tx })) return blocked();
    const first = await tx.submission.findFirst({ where: { id: request.submissionId, studentId: request.studentId } });
    if (!first || (request.assignmentId && request.assignmentId !== first.assignmentId)) return blocked();
    // Match the existing answer-import writer's Assignment -> Submission order.
    // Re-read after locking so the evidence hash cannot describe a stale version.
    if (!(await tx.$queryRaw`SELECT id FROM "Assignment" WHERE id = ${first.assignmentId} FOR SHARE`).length) return blocked();
    // FOR UPDATE also excludes a concurrent first GradingResult insert through
    // its Submission foreign key, where there is no grading row to lock yet.
    if (!(await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${first.id} AND "studentId" = ${request.studentId} FOR UPDATE`).length) return blocked();
    await tx.$queryRaw`SELECT id FROM "GradingResult" WHERE "submissionId" = ${first.id} FOR SHARE`;
    const submission = await tx.submission.findFirst({ where: { id: first.id, studentId: request.studentId }, include: { grading: true } });
    if (!submission || submission.assignmentId !== first.assignmentId) return blocked();
    await tx.$queryRaw`SELECT id FROM "AssignmentItem" WHERE "assignmentId" = ${first.assignmentId} ORDER BY id FOR SHARE`;
    const assignment = await tx.assignment.findUnique({ where: { id: first.assignmentId }, include: { subject: true, items: { orderBy: { orderIndex: "asc" } } } });
    if (!assignment || (assignment.metadata?.targetStudentId && assignment.metadata.targetStudentId !== request.studentId) || assignment.metadata?.draftReviewStatus === "rejected") return blocked();
    const archived = isImmutableTeachingArchive(submission);
    if (archived && !isTeachingWorkflowArchiveSubmission(submission, request.studentId)) return blocked();
    const sourcePackage = archived ? submission.content.workflowArchive.snapshot.gradingSourcePackage : assignment.metadata?.gradingSourcePackage;
    if (!object(sourcePackage) || !validateGradingSourcePackage(sourcePackage).ok || (!archived && sourcePackage.sourceId !== assignment.id)) return blocked();
    const subject = assignment.subject?.name || assignment.metadata?.subject || sourcePackage.subject;
    if (!text(subject)) return blocked();
    const assignmentQuestionTypes = archived ? [] : legacyAssignmentQuestionTypes(assignment, sourcePackage);
    const typeEvidence = assignmentQuestionTypes.length ? { assignmentQuestionTypes } : {};
    const archiveEvidence = archived ? submission.content.workflowArchive.snapshot.archiveEvidence : { schemaVersion: "teaching-workflow-grading-evidence-v1", submissionId: submission.id, studentId: request.studentId,
      assignmentId: assignment.id, sourceFingerprint: sourcePackage.fingerprint,
      materialType: submission.content?.materialType === "external_workbook" || submission.content?.externalGradingRecognition != null ||
        ["photo-upload", "photo-upload-batch"].includes(assignment.metadata?.source) ? "external_workbook" : submission.content?.materialType ?? null,
      externalGradingRecognition: submission.content?.externalGradingRecognition ?? null,
      ...typeEvidence,
      fingerprint: `sha256:${createHash("sha256").update(stable({ content: submission.content || {}, grading: submission.grading?.result || {}, sourcePackage, ...typeEvidence })).digest("hex")}` };
    // An immutable archive retains the original binding; hashing its wrapper
    // would invalidate unchanged teacher confirmations and lose external gates.
    if (!object(archiveEvidence) || archiveEvidence.schemaVersion !== "teaching-workflow-grading-evidence-v1" ||
      !text(archiveEvidence.submissionId) || archiveEvidence.studentId !== request.studentId || archiveEvidence.assignmentId !== assignment.id ||
      archiveEvidence.sourceFingerprint !== sourcePackage.fingerprint || !/^sha256:[a-f0-9]{64}$/.test(archiveEvidence.fingerprint) ||
      !Object.hasOwn(archiveEvidence, "materialType") || !Object.hasOwn(archiveEvidence, "externalGradingRecognition")) return blocked();
    return { ok: true, studentId: request.studentId, assignmentId: assignment.id, subject, sourcePackage: structuredClone(sourcePackage), archiveEvidence: structuredClone(archiveEvidence), submission };
  };
  const resolveGradingContext = ({ actor, request, tx }) => transaction(tx, (db) => read({ actor, request, tx: db }));
  return {
    authorizeStudent,
    resolveGradingContext,
    async resolveConfirmedArchive({ actor, request, tx }) {
      const context = await resolveGradingContext({ actor, request, tx });
      const archive = context.submission?.content?.workflowArchive;
      return context.ok && archive?.teacherId === actor.teacherId ? structuredClone(archive) : null;
    },
    async resolveArchiveEvidence({ actor, workflow, snapshot, tx }) {
      // Publication must supply the transaction that already locked the workflow.
      if (!tx) return blocked();
      const context = await read({ actor, request: workflow.request, tx });
      if (!context.ok || !isDeepStrictEqual(snapshot.archiveEvidence, context.archiveEvidence) || snapshot.gradingSourcePackage?.fingerprint !== context.sourcePackage.fingerprint) return blocked();
      const content = context.archiveEvidence;
      let packet = content.externalGradingRecognition;
      const external = content.materialType === "external_workbook" || packet != null;
      if (external) {
        if (packet?.schemaVersion !== EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION || !Array.isArray(packet.pages) || !packet.pages.length ||
          packet.pages.some((page) => !Array.isArray(page?.questions) || !page.questions.length || !["usable", "ready", "good"].includes(page.quality?.status)) ||
          !["teacher_confirmed", "teacher_selected_reference"].includes(packet.answerSource?.mode) || packet.answerSource?.status !== "confirmed") return blocked();
        const packetQuestions = packet.pages.flatMap((page) => page.questions);
        if (!Array.isArray(snapshot.questions) || snapshot.questions.some((q) => !text(q?.questionNo)) || packetQuestions.some((q) => !text(q?.questionNo))) return blocked();
        const byNo = new Map(snapshot.questions.map((q) => [q.questionNo, q]));
        if (new Set(packetQuestions.map((q) => q.questionNo)).size !== packetQuestions.length || packetQuestions.length !== byNo.size ||
          packetQuestions.some((q) => !byNo.has(q.questionNo)) || context.sourcePackage.questions.length !== packetQuestions.length ||
          context.sourcePackage.questions.some((q) => !isDeepStrictEqual(packet.answerSource.answers?.[q.questionNo], q.correctAnswer))) return blocked();
        packet = { ...packet, pages: packet.pages.map((page) => ({ ...page, questions: page.questions.map((original) => {
          const q = byNo.get(original.questionNo);
          const reviewed = q.reviewedByTeacher === true && q.confirmedBy === actor.teacherId;
          return { ...original, status: q.status, score: q.score, maxScore: q.maxScore,
            recognitionStatus: reviewed ? "confirmed" : original.recognitionStatus, review: { ...original.review, reviewedByTeacher: reviewed } };
        }) })) };
      }
      if (!requireAllQuestionsReviewedForArchive({ questionResults: snapshot.questions }, external ? packet : null).ok) return blocked();
      return { ok: true, studentId: context.studentId, assignmentId: context.assignmentId, subject: context.subject, sourcePackage: context.sourcePackage };
    }
  };
}
