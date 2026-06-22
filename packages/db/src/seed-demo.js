import {
  demoAssignments,
  demoClassroomBroadcasts,
  demoClassroomDevices,
  demoCorrectionRecords,
  demoDictationTasks,
  demoLearningLogs,
  demoReadingTasks,
  demoStudentReports,
  demoStudents,
  demoTeachers,
  demoTextbooks,
  demoTasks,
  demoVocabularyEntries,
  subjectLabels
} from "@junhang/core";
import { fileURLToPath } from "node:url";
import { prisma } from "./client.js";
import { hashAccessCode, previewAccessCode } from "./access-codes.js";
import { upsertStudentWithAccessCode, upsertTeacherWithAccessCode } from "./repositories.js";

const subjectCodes = new Map([
  ["语文", "chinese"],
  ["数学", "math"],
  ["英语", "english"]
]);

function taskStatus(status = "") {
  if (status.includes("完成")) return "COMPLETED";
  if (status.includes("进行")) return "IN_PROGRESS";
  if (status.includes("复核") || status.includes("批")) return "REVIEWED";
  return "ASSIGNED";
}

function submissionStatus(status = "") {
  if (status.includes("批")) return "GRADED";
  if (status.includes("复核")) return "NEEDS_REVIEW";
  return "SUBMITTED";
}

function enrollmentStatus(status = "") {
  if (status.includes("测试") || status.includes("试听")) return "TRIAL";
  if (status.includes("暂停")) return "PAUSED";
  if (status.includes("退")) return "WITHDRAWN";
  return "ACTIVE";
}

function reportType(period = "") {
  if (period.includes("周")) return "WEEKLY";
  if (period.includes("月")) return "MONTHLY";
  if (period.includes("期中")) return "MIDTERM";
  if (period.includes("期末")) return "FINAL";
  return "TERM";
}

async function seedSubjects() {
  for (const name of subjectLabels) {
    await prisma.subject.upsert({
      where: { code: subjectCodes.get(name) || name },
      create: { code: subjectCodes.get(name) || name, name },
      update: { name }
    });
  }
}

async function seedTeachers() {
  for (const teacher of demoTeachers) {
    await upsertTeacherWithAccessCode(
      {
        id: teacher.id,
        displayName: teacher.displayName,
        phone: teacher.phone,
        role: teacher.role,
        status: teacher.status,
        accessCode: teacher.accessCode
      },
      { prisma }
    );
  }
}

async function seedStudents() {
  for (const student of demoStudents) {
    await upsertStudentWithAccessCode(
      {
        id: student.id,
        displayName: student.displayName,
        grade: student.grade,
        school: student.school,
        className: student.className,
        textbookVersion: student.textbookVersion,
        enrollmentStatus: enrollmentStatus(student.enrollmentStatus),
        loginEnabled: student.loginEnabled,
        responsibleTeacherId: student.responsibleTeacherId,
        createdByTeacherId: student.responsibleTeacherId,
        accessCode: student.accessCode,
        notes: student.focus
      },
      { prisma }
    );

    if (student.guardianName || student.guardianPhone) {
      const guardianId = `guardian-${student.id}`;
      await prisma.guardian.upsert({
        where: { id: guardianId },
        create: {
          id: guardianId,
          name: student.guardianName || `${student.displayName}家长`,
          phone: student.guardianPhone || null
        },
        update: {
          name: student.guardianName || `${student.displayName}家长`,
          phone: student.guardianPhone || null
        }
      });
      await prisma.studentGuardian.upsert({
        where: { studentId_guardianId: { studentId: student.id, guardianId } },
        create: { studentId: student.id, guardianId, relation: "guardian" },
        update: { relation: "guardian" }
      });
    }

    await prisma.studentProfile.create({
      data: {
        studentId: student.id,
        snapshot: {
          weeklyScore: student.weeklyScore,
          streak: student.streak,
          mastery: student.mastery,
          strengths: student.strengths,
          risks: student.risks,
          tone: student.tone
        }
      }
    });
  }
}

async function seedClassroomDevices() {
  for (const device of demoClassroomDevices) {
    await prisma.classroomDevice.upsert({
      where: { id: device.id },
      create: {
        id: device.id,
        label: device.label,
        bindingCodeHash: device.bindingCode ? hashAccessCode(device.bindingCode) : null,
        bindingCodePreview: device.bindingCode ? previewAccessCode(device.bindingCode) : null,
        grade: device.grade,
        className: device.className,
        teacherId: device.teacherId,
        status: "BOUND"
      },
      update: {
        label: device.label,
        bindingCodeHash: device.bindingCode ? hashAccessCode(device.bindingCode) : null,
        bindingCodePreview: device.bindingCode ? previewAccessCode(device.bindingCode) : null,
        grade: device.grade,
        className: device.className,
        teacherId: device.teacherId,
        status: "BOUND"
      }
    });
  }
}

async function seedClassroomContent() {
  for (const broadcast of demoClassroomBroadcasts) {
    await prisma.taskBroadcast.upsert({
      where: { id: broadcast.id },
      create: {
        id: broadcast.id,
        deviceId: broadcast.deviceId,
        teacherId: broadcast.createdByTeacherId,
        subject: broadcast.subject,
        title: broadcast.title,
        content: broadcast.content,
        voiceText: broadcast.voiceText,
        status: broadcast.status?.includes("已") ? "PLAYED" : "PENDING"
      },
      update: {
        title: broadcast.title,
        content: broadcast.content,
        voiceText: broadcast.voiceText,
        status: broadcast.status?.includes("已") ? "PLAYED" : "PENDING"
      }
    });
  }

  for (const task of demoDictationTasks) {
    await prisma.dictationTask.upsert({
      where: { id: task.id },
      create: {
        id: task.id,
        deviceId: task.deviceId,
        teacherId: task.createdByTeacherId,
        grade: task.grade,
        className: task.className,
        subject: task.subject,
        title: task.title,
        difficulty: task.difficulty,
        repeats: task.repeats,
        intervalSeconds: task.intervalSeconds,
        status: "PENDING"
      },
      update: {
        title: task.title,
        difficulty: task.difficulty,
        repeats: task.repeats,
        intervalSeconds: task.intervalSeconds,
        status: "PENDING"
      }
    });
    await prisma.dictationItem.deleteMany({ where: { dictationTaskId: task.id } });
    await prisma.dictationItem.createMany({
      data: task.items.map((text, index) => ({
        dictationTaskId: task.id,
        orderIndex: index + 1,
        text
      }))
    });
  }

  for (const task of demoReadingTasks) {
    await prisma.readingTask.upsert({
      where: { id: task.id },
      create: {
        id: task.id,
        deviceId: task.deviceId,
        teacherId: task.createdByTeacherId,
        grade: task.grade,
        className: task.className,
        subject: task.subject,
        title: task.title,
        passage: task.passage,
        focusItems: task.focusItems,
        supportNote: task.supportNote,
        status: "PENDING"
      },
      update: {
        title: task.title,
        passage: task.passage,
        focusItems: task.focusItems,
        supportNote: task.supportNote,
        status: "PENDING"
      }
    });
  }
}

async function seedLearningContent() {
  for (const task of demoTasks) {
    const subject = await prisma.subject.findFirst({ where: { name: task.subject } });
    await prisma.learningTask.upsert({
      where: { id: task.id },
      create: {
        id: task.id,
        studentId: task.studentId,
        subjectId: subject?.id,
        title: task.title,
        status: taskStatus(task.status),
        metadata: task
      },
      update: {
        title: task.title,
        status: taskStatus(task.status),
        metadata: task
      }
    });
  }

  for (const textbook of demoTextbooks) {
    await prisma.textbookAsset.upsert({
      where: { id: textbook.id },
      create: {
        id: textbook.id,
        subject: textbook.subject,
        edition: textbook.edition,
        grade: textbook.grade,
        volume: textbook.volume,
        title: textbook.title,
        source: textbook.source,
        metadata: textbook
      },
      update: {
        subject: textbook.subject,
        edition: textbook.edition,
        grade: textbook.grade,
        volume: textbook.volume,
        title: textbook.title,
        source: textbook.source,
        metadata: textbook
      }
    });
  }

  for (const [index, entry] of demoVocabularyEntries.entries()) {
    await prisma.vocabularyRecord.upsert({
      where: { id: `vocab-demo-${index + 1}` },
      create: {
        id: `vocab-demo-${index + 1}`,
        studentId: demoStudents[0].id,
        term: entry.term,
        content: entry
      },
      update: { term: entry.term, content: entry }
    });
  }
}

async function seedAssignmentsAndGrading() {
  for (const assignment of demoAssignments) {
    const subject = await prisma.subject.findFirst({ where: { name: assignment.subject } });
    await prisma.assignment.upsert({
      where: { id: assignment.id },
      create: {
        id: assignment.id,
        subjectId: subject?.id,
        title: assignment.title,
        grade: assignment.targetGrade || demoStudents[0].grade,
        difficulty: assignment.difficulty,
        metadata: assignment
      },
      update: {
        title: assignment.title,
        grade: assignment.targetGrade || demoStudents[0].grade,
        difficulty: assignment.difficulty,
        metadata: assignment
      }
    });
    await prisma.assignmentItem.deleteMany({ where: { assignmentId: assignment.id } });
    await prisma.assignmentItem.createMany({
      data: assignment.items.map((prompt, index) => ({
        assignmentId: assignment.id,
        orderIndex: index + 1,
        itemType: "question",
        prompt,
        metadata: { source: "demo" }
      }))
    });

    if (assignment.score != null || assignment.grading) {
      const submission = await prisma.submission.upsert({
        where: { id: `submission-${assignment.id}` },
        create: {
          id: `submission-${assignment.id}`,
          assignmentId: assignment.id,
          studentId: assignment.studentId,
          status: submissionStatus(assignment.status),
          content: {
            imageNames: assignment.submissionImageNames,
            source: "demo"
          }
        },
        update: {
          status: submissionStatus(assignment.status),
          content: {
            imageNames: assignment.submissionImageNames,
            source: "demo"
          }
        }
      });
      await prisma.gradingResult.upsert({
        where: { submissionId: submission.id },
        create: {
          submissionId: submission.id,
          score: assignment.score,
          needsReview: assignment.status?.includes("复核") || false,
          result: assignment.grading || { summary: "Demo grading placeholder" }
        },
        update: {
          score: assignment.score,
          needsReview: assignment.status?.includes("复核") || false,
          result: assignment.grading || { summary: "Demo grading placeholder" }
        }
      });
    }
  }

  for (const record of demoCorrectionRecords) {
    await prisma.mistakeRecord.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        studentId: demoStudents[0].id,
        subject: record.subject,
        prompt: record.prompt,
        studentAnswer: record.studentAnswer,
        correctAnswer: record.correctAnswer,
        cause: record.cause,
        masteryResolved: record.state?.includes("掌握") || false,
        metadata: record
      },
      update: {
        subject: record.subject,
        prompt: record.prompt,
        studentAnswer: record.studentAnswer,
        correctAnswer: record.correctAnswer,
        cause: record.cause,
        masteryResolved: record.state?.includes("掌握") || false,
        metadata: record
      }
    });
  }
}

async function seedReportsAndLogs() {
  for (const report of demoStudentReports) {
    await prisma.studentReport.upsert({
      where: { id: report.id },
      create: {
        id: report.id,
        studentId: demoStudents[0].id,
        type: reportType(report.period),
        periodKey: report.period,
        title: report.title,
        content: report.summary,
        metadata: report
      },
      update: {
        type: reportType(report.period),
        periodKey: report.period,
        title: report.title,
        content: report.summary,
        metadata: report
      }
    });
  }

  for (const log of demoLearningLogs) {
    await prisma.behaviorEvent.upsert({
      where: { id: log.id },
      create: {
        id: log.id,
        studentId: demoStudents[0].id,
        actorType: log.actorType?.toUpperCase() === "SYSTEM" ? "SYSTEM" : "STUDENT",
        feature: log.feature,
        action: log.action,
        metadata: log
      },
      update: {
        feature: log.feature,
        action: log.action,
        metadata: log
      }
    });
  }
}

export async function seedDemoData() {
  await seedSubjects();
  await seedTeachers();
  await seedStudents();
  await seedClassroomDevices();
  await seedClassroomContent();
  await seedLearningContent();
  await seedAssignmentsAndGrading();
  await seedReportsAndLogs();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemoData()
    .then(async () => {
      console.log("Demo seed completed.");
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
