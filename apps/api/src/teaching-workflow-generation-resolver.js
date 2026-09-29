import { normalizeGradeLevel } from "@junhang/core";

// Called under the workflow publication transaction. Existing publications remain
// readable after withdrawal, but creating a new version requires an active target.
export function createTeachingAssignmentTargetAuthorizer({ authorizeStudent }) {
  return async ({ actor, workflow, tx, existing }) => {
    if (!actor?.teacherId || workflow.ownerTeacherId !== actor.teacherId || !tx) return false;
    const studentId = workflow.request?.studentId;
    if (!studentId) return true;
    if (await authorizeStudent({ actor, studentId, tx }) !== true) return false;
    if (existing) return true;
    if (!(await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR SHARE`).length) return false;
    const student = await tx.student.findUnique({ where: { id: studentId },
      select: { id: true, grade: true, deletedAt: true, loginEnabled: true, enrollmentStatus: true } });
    if (!student || student.deletedAt || student.loginEnabled !== true || student.enrollmentStatus === "WITHDRAWN") return false;
    const requested = workflow.request.grade || workflow.request.targetGrade;
    return !requested || normalizeGradeLevel(student.grade)?.level === normalizeGradeLevel(requested)?.level;
  };
}

// Reuse the assessment context preparer after enforcing the workflow actor and
// active target. No model calls, exports, or data writes belong in this adapter.
export function createTeachingWorkflowGenerationResolver({ prisma, authorizeStudent, prepareInput }) {
  return async ({ actor, request }) => {
    if (!actor?.teacherId) return { ok: false };
    const input = structuredClone(request);
    if (input.studentId) {
      if (await authorizeStudent({ actor, studentId: input.studentId }) !== true) return { ok: false };
      const student = await prisma.student.findUnique({ where: { id: input.studentId },
        select: { id: true, grade: true, deletedAt: true, loginEnabled: true, enrollmentStatus: true } });
      if (!student || student.deletedAt || student.loginEnabled !== true || student.enrollmentStatus === "WITHDRAWN") return { ok: false };
      const grade = normalizeGradeLevel(student.grade);
      const requested = normalizeGradeLevel(input.grade || input.targetGrade);
      if (!grade || (input.grade || input.targetGrade) && (!requested || requested.level !== grade.level)) return { ok: false };
      input.grade = grade.label;
      input.targetScope = "student";
    }
    return prepareInput({ actor, request: input });
  };
}
