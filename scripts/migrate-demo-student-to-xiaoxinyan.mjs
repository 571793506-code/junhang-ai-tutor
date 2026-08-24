import { prisma } from "../packages/db/src/client.js";

const oldStudentId = "stu-wyx";
const oldStudentName = "王瑜瑄";
const targetStudentId = "cmrx8gpcd00016ydgu2hqz4dy";
const targetStudentName = "肖心妍";

const learningTaskIds = ["task-1", "task-2", "task-3", "task-4"];
const submissionIds = ["submission-assign-1", "submission-assign-3"];
const mistakeIds = ["corr-1", "corr-2", "corr-3"];
const reportIds = ["report-midterm", "report-final", "report-week", "report-month"];
const behaviorIds = ["log-1", "log-2", "log-3"];
const vocabularyIds = ["vocab-demo-1", "vocab-demo-2"];
const assignmentIds = ["assign-1", "assign-2", "assign-3"];

function replaceIdentity(value) {
  if (typeof value === "string") {
    return value.replaceAll(oldStudentId, targetStudentId).replaceAll(oldStudentName, targetStudentName);
  }
  if (Array.isArray(value)) return value.map(replaceIdentity);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceIdentity(item)]));
  }
  return value;
}

async function migrate() {
  const target = await prisma.student.findUnique({ where: { id: targetStudentId }, select: { id: true, displayName: true } });
  if (!target || target.displayName !== targetStudentName) {
    throw new Error(`Target student ${targetStudentId} is missing or does not match ${targetStudentName}`);
  }

  if (!process.argv.includes("--write")) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      source: { id: oldStudentId, name: oldStudentName },
      target,
      scope: { learningTaskIds, submissionIds, mistakeIds, reportIds, behaviorIds, vocabularyIds, assignmentIds }
    }, null, 2));
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const assignments = await tx.assignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, metadata: true } });
    const [learningTasks, submissions, mistakes, reports, behaviors, vocabulary] = await Promise.all([
      tx.learningTask.updateMany({ where: { id: { in: learningTaskIds } }, data: { studentId: targetStudentId } }),
      tx.submission.updateMany({ where: { id: { in: submissionIds } }, data: { studentId: targetStudentId } }),
      tx.mistakeRecord.updateMany({ where: { id: { in: mistakeIds } }, data: { studentId: targetStudentId } }),
      tx.studentReport.updateMany({ where: { id: { in: reportIds } }, data: { studentId: targetStudentId } }),
      tx.behaviorEvent.updateMany({ where: { id: { in: behaviorIds } }, data: { studentId: targetStudentId } }),
      tx.vocabularyRecord.updateMany({ where: { id: { in: vocabularyIds } }, data: { studentId: targetStudentId } })
    ]);

    for (const assignment of assignments) {
      await tx.assignment.update({ where: { id: assignment.id }, data: { metadata: replaceIdentity(assignment.metadata) } });
    }

    return {
      assignments: assignments.length,
      learningTasks: learningTasks.count,
      submissions: submissions.count,
      mistakes: mistakes.count,
      reports: reports.count,
      behaviors: behaviors.count,
      vocabulary: vocabulary.count
    };
  });

  console.log(JSON.stringify({ ok: true, dryRun: false, target, result }, null, 2));
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
