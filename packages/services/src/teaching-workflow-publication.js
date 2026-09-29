import { createHash } from "node:crypto";
import { buildTeachingWorkflowArchive, isTeachingWorkflowArchiveSubmission, selectCurrentTeachingEvidence } from "./teaching-workflow-archive.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
function fail(code, status = 422) { throw Object.assign(new Error(code), { code, status }); }
const answerText = (value) => typeof value === "string" ? value : JSON.stringify(value ?? null);

export function createTeachingWorkflowArchiveService({ repository, authorizeStudent = null, resolveArchiveEvidence = null, now = () => new Date() } = {}) {
  return {
    async publish({ actor, workflowId, expectedRevision }) {
      if (!text(actor?.teacherId)) fail("WORKFLOW_FORBIDDEN", 403);
      if (!text(workflowId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID");
      if (typeof repository?.publish !== "function" || typeof authorizeStudent !== "function" || typeof resolveArchiveEvidence !== "function") fail("WORKFLOW_ARCHIVE_UNAVAILABLE", 503);
      // Copy authenticated identity; no snapshot, source, score or ownership comes
      // from this operation's input. Preparation reads the locked stored revision.
      const teacher = { teacherId: actor.teacherId };
      const result = await repository.publish({ workflowId, ownerTeacherId: teacher.teacherId, expectedRevision,
        authorize: ({ workflow, tx }) => authorizeStudent({ actor: teacher, studentId: workflow.request.studentId, workflow, tx }),
        validateExisting: ({ submission, workflow }) => isTeachingWorkflowArchiveSubmission(submission, workflow.request.studentId),
        prepare: async ({ workflow, snapshot, archiveId, previousSubmissions, tx }) => {
          const evidence = await resolveArchiveEvidence({ actor: teacher, workflow, snapshot: structuredClone(snapshot), tx });
          if (evidence?.ok !== true || evidence.studentId !== workflow.request.studentId || !text(evidence.assignmentId) || !text(evidence.subject) ||
            (workflow.request.assignmentId && evidence.assignmentId !== workflow.request.assignmentId)) fail("WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED");
          const previous = previousSubmissions.map((submission) => {
            if (!isTeachingWorkflowArchiveSubmission(submission, workflow.request.studentId) ||
              submission.content.workflowArchive.teacherId !== teacher.teacherId || submission.content.workflowArchive.workflowId !== workflow.id) fail("WORKFLOW_ARCHIVE_INVALID");
            return submission.content.workflowArchive;
          }).sort((a, b) => b.revision - a.revision);
          if (previous.length) {
            const selected = selectCurrentTeachingEvidence({ id: workflow.request.studentId, submissions: previousSubmissions, mistakes: [] });
            if (selected.submissions.length !== 1 || selected.teachingArchiveIssues.length || previous[0].revision >= workflow.currentRevision) fail("WORKFLOW_ARCHIVE_INVALID");
          }
          const archive = await buildTeachingWorkflowArchive({ actor: teacher, workflow, snapshot, submissionId: archiveId,
            confirmedAt: now().toISOString(), previousArchive: previous[0] || null, resolveGradingSource: async () => evidence.sourcePackage });
          const mistakes = archive.snapshot.questions.filter((q) => ["wrong", "partial"].includes(q.status)).map((q) => ({
            id: `teaching-mistake-${createHash("sha256").update(JSON.stringify([archive.id, q.id])).digest("hex")}`,
            studentId: archive.studentId, subject: evidence.subject, prompt: q.printedPrompt || q.prompt,
            studentAnswer: answerText(q.studentAnswer), correctAnswer: answerText(q.correctAnswer ?? archive.snapshot.gradingSourcePackage.questions.find((ref) => ref.questionNo === q.questionNo)?.correctAnswer),
            cause: q.errorStep || q.explanation,
            metadata: { workflowArchiveId: archive.id, sourceSubmissionId: archive.id, submissionId: archive.id, sourceWorkflowId: workflow.id,
              sourceVersion: archive.revision, assignmentId: evidence.assignmentId, questionNos: [q.questionNo], point: q.knowledgePoint,
              reviewStatus: "teacher_reviewed", suggestedPractice: q.suggestedPractice || "" }
          }));
          return { archive, assignmentId: evidence.assignmentId, mistakes };
        }
      });
      return { status: "archived", archiveId: result.archive.id, workflowId: result.archive.workflowId, revision: result.archive.revision,
        currentRevision: result.currentRevision, replayed: result.replayed };
    }
  };
}
