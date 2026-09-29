import { isDeepStrictEqual } from "node:util";
import { normalizeImportedGradingSourcePackage, gradingSourcePackageToAssignmentItems } from "@junhang/core";
import { createTeachingWorkflowValidator } from "./teaching-workflow-validation.js";

const text = (value) => typeof value === "string" && Boolean(value.trim());
function fail(code, status = 422) { throw Object.assign(new Error(code), { code, status }); }
const equal = isDeepStrictEqual;
const schema = "teaching-workflow-assignment-v1";

function matches(assignment, expected) {
  if (assignment.id !== expected.id || assignment.title !== expected.title || assignment.grade !== expected.grade ||
    (assignment.difficulty ?? null) !== (expected.difficulty ?? null)) return false;
  // Export assets, layout results and review display state may evolve. Published
  // content, source binding and teacher identity cannot evolve in place.
  const mutable = new Set(["draftReviewStatus", "generationPipeline"]);
  if (Object.entries(expected.metadata).some(([key, value]) => !mutable.has(key) && !equal(assignment.metadata?.[key], value))) return false;
  const items = assignment.items || [];
  return items.length === expected.items.length && items.every((q, i) => q.orderIndex === i + 1 &&
    ["itemType", "prompt", "answer", "rubric", "metadata"].every((key) => equal(q[key] ?? null, expected.items[i][key] ?? null)));
}

export function createTeachingWorkflowAssignmentService({ repository, authorizeTarget = null, validateSnapshot = null, now = () => new Date() } = {}) {
  const run = async ({ actor, workflowId, expectedRevision }, existingOnly = false, observedAssignment = null) => {
    if (!text(actor?.teacherId)) fail("WORKFLOW_FORBIDDEN", 403);
    if (!text(workflowId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID");
    if (typeof repository?.publish !== "function" || typeof authorizeTarget !== "function" || typeof validateSnapshot !== "function") fail("WORKFLOW_ASSIGNMENT_UNAVAILABLE", 503);
    const teacher = { teacherId: actor.teacherId };
    const result = await repository.publish({ workflowId, ownerTeacherId: teacher.teacherId, expectedRevision, existingOnly,
      authorize: (context) => authorizeTarget({ ...context, actor: teacher }),
      validateExisting: (assignment, expected) => matches(assignment, expected) && (!observedAssignment || matches(observedAssignment, expected)),
      prepare: async ({ workflow, snapshot, assignmentId, revision, existing, tx }) => {
        if (snapshot.purpose === "explanation" || !Array.isArray(snapshot.questions) || !snapshot.questions.length ||
          snapshot.questions.some((q) => q.reviewedByTeacher !== true || q.confirmedBy !== teacher.teacherId || q.teacherConfirmation?.actorTeacherId !== teacher.teacherId)) fail("WORKFLOW_CONFIRMATION_REQUIRED");
        const context = { actor: teacher, workflow, request: workflow.request, module: "generation", nextRevision: revision, tx };
        const checked = await createTeachingWorkflowValidator()(structuredClone(snapshot), context);
        if (!checked.ok || !equal(checked.snapshot.gradingSourcePackage, snapshot.gradingSourcePackage)) fail("WORKFLOW_SNAPSHOT_INVALID");
        if (!existing && (await validateSnapshot(structuredClone(snapshot), context))?.ok !== true) fail("WORKFLOW_SNAPSHOT_INVALID");
        const source = normalizeImportedGradingSourcePackage(checked.snapshot.gradingSourcePackage, { sourceId: assignmentId });
        if (!source.ok) fail("WORKFLOW_ASSIGNMENT_INVALID");
        const request = snapshot.resolvedRequest || workflow.request;
        const publishedAt = existing?.metadata?.workflowPublication?.publishedAt || now().toISOString();
        if (!Number.isFinite(Date.parse(publishedAt))) fail("WORKFLOW_ASSIGNMENT_INVALID");
        const publication = { schemaVersion: schema, workflowId, revision, teacherId: teacher.teacherId, publishedAt,
          originSourceFingerprint: snapshot.gradingSourcePackage.fingerprint, sourceFingerprint: source.package.fingerprint };
        return { id: assignmentId, title: source.package.title, subject: source.package.subject, grade: source.package.grade,
          difficulty: request.difficulty || null, items: gradingSourcePackageToAssignmentItems(source.package),
          metadata: { source: "teaching-workflow", teacherId: teacher.teacherId, targetStudentId: request.studentId || null,
            targetScope: request.studentId ? "student" : "grade", targetGrade: source.package.grade, subject: source.package.subject,
            kind: source.package.kind, purpose: snapshot.purpose, specialRequirements: request.requirement || "",
            totalScore: source.package.totalScore, gradingSourcePackage: source.package, workflowPublication: publication,
            generationContext: snapshot.generationContext || null, dayPlan: snapshot.days || [],
            printProfile: snapshot.printProfile || { paper: "A4", subject: source.package.subject, pages: source.package.kind === "试卷" ? 4 : 2,
              columns: 1, headerFields: ["姓名", "日期", "得分"] },
            draftReviewStatus: "accepted", generationPipeline: { stage: "content_confirmed", gates: { teacherReviewStatus: "accepted", finalExportAllowed: false, finalExported: false },
              review: { source: "teaching-workflow", workflowId, revision } }
          } };
      }
    });
    return { status: "assignment_ready", assignmentId: result.assignment.id, workflowId, revision: expectedRevision, currentRevision: result.currentRevision, replayed: result.replayed };
  };
  return {
    publish: (input) => run(input),
    async verify({ actor, assignment }) {
      const record = assignment?.metadata?.workflowPublication;
      if (record?.schemaVersion !== schema || record.teacherId !== actor?.teacherId) fail("WORKFLOW_FORBIDDEN", 403);
      const result = await run({ actor, workflowId: record.workflowId, expectedRevision: record.revision }, true, assignment);
      if (result.assignmentId !== assignment.id) fail("WORKFLOW_ASSIGNMENT_INVALID");
      return true;
    }
  };
}
