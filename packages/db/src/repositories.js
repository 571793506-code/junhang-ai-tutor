import { prisma as defaultPrisma } from "./client.js";
import { generateAccessCode, hashAccessCode, previewAccessCode } from "./access-codes.js";

export function normalizeGrade(grade) {
  if (!grade) return null;
  const text = String(grade).trim();
  const gradeMap = new Map([
    ["3", "三年级"],
    ["4", "四年级"],
    ["5", "五年级"],
    ["6", "六年级"]
  ]);
  return gradeMap.get(text) || text;
}

export function normalizeTeacherStatus(status) {
  const text = String(status || "").trim().toUpperCase();
  if (!text) return "ACTIVE";
  if (text === "ACTIVE" || text.includes("已开") || text.includes("開通")) return "ACTIVE";
  if (text === "PENDING" || text.includes("待") || text.includes("未开")) return "PENDING";
  if (text === "DISABLED" || text.includes("停") || text.includes("禁")) return "DISABLED";
  return "ACTIVE";
}

export async function recordModelRun(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.modelRun.create({
    data: {
      provider: input.provider,
      model: input.model || null,
      skill: input.skill || null,
      inputSummary: input.inputSummary || null,
      outputSummary: input.outputSummary || null,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      costEstimate: input.costEstimate ?? null,
      metadata: input.metadata || undefined
    }
  });
}

export async function upsertTeacherWithAccessCode(
  input,
  { prisma = defaultPrisma } = {}
) {
  const code = input.accessCode || generateAccessCode();
  const teacher = await prisma.teacher.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      name: input.name || input.displayName,
      phone: input.phone || null,
      email: input.email || null,
      openId: input.openId || null,
      role: input.role || "teacher",
      status: normalizeTeacherStatus(input.status)
    },
    update: {
      name: input.name || input.displayName,
      phone: input.phone || null,
      email: input.email || null,
      openId: input.openId || null,
      role: input.role || "teacher",
      status: normalizeTeacherStatus(input.status)
    }
  });

  await prisma.teacherAccessCode.updateMany({
    where: {
      teacherId: teacher.id,
      status: "ACTIVE",
      codePreview: null
    },
    data: { status: "DISABLED", disabledAt: new Date() }
  });

  await prisma.teacherAccessCode.upsert({
    where: { codeHash: hashAccessCode(code) },
    create: {
      teacherId: teacher.id,
      codeHash: hashAccessCode(code),
      codePreview: previewAccessCode(code),
      roleScope: input.roleScope || input.role || null,
      status: "ACTIVE"
    },
    update: {
      teacherId: teacher.id,
      codePreview: previewAccessCode(code),
      roleScope: input.roleScope || input.role || null,
      status: "ACTIVE",
      disabledAt: null
    }
  });

  return { teacher, accessCode: code, codePreview: previewAccessCode(code) };
}

export async function createStudentWithAccessCode(
  input,
  { prisma = defaultPrisma } = {}
) {
  const code = input.accessCode || generateAccessCode();
  const student = await prisma.student.create({
    data: {
      displayName: input.displayName,
      grade: normalizeGrade(input.grade),
      school: input.school || null,
      className: input.className || null,
      textbookVersion: input.textbookVersion || null,
      enrollmentStatus: input.enrollmentStatus || "ACTIVE",
      loginEnabled: input.loginEnabled ?? true,
      responsibleTeacherId: input.responsibleTeacherId || null,
      notes: input.notes || null,
      accessCodes: {
        create: {
          codeHash: hashAccessCode(code),
          codePreview: previewAccessCode(code),
          createdByTeacherId: input.createdByTeacherId || input.responsibleTeacherId || null,
          status: "ACTIVE"
        }
      },
      teacherAssignments: input.responsibleTeacherId
        ? {
            create: {
              teacherId: input.responsibleTeacherId,
              source: "student-registration"
            }
          }
        : undefined
    }
  });

  return { student, accessCode: code, codePreview: previewAccessCode(code) };
}

export async function upsertStudentWithAccessCode(
  input,
  { prisma = defaultPrisma } = {}
) {
  if (!input.id) return createStudentWithAccessCode(input, { prisma });

  const code = input.accessCode || generateAccessCode();
  const teacherId = input.responsibleTeacherId || null;

  const student = await prisma.student.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      displayName: input.displayName,
      grade: normalizeGrade(input.grade),
      school: input.school || null,
      className: input.className || null,
      textbookVersion: input.textbookVersion || null,
      enrollmentStatus: input.enrollmentStatus || "ACTIVE",
      loginEnabled: input.loginEnabled ?? true,
      responsibleTeacherId: teacherId,
      notes: input.notes || null
    },
    update: {
      displayName: input.displayName,
      grade: normalizeGrade(input.grade),
      school: input.school || null,
      className: input.className || null,
      textbookVersion: input.textbookVersion || null,
      enrollmentStatus: input.enrollmentStatus || "ACTIVE",
      loginEnabled: input.loginEnabled ?? true,
      responsibleTeacherId: teacherId,
      notes: input.notes || null
    }
  });

  await prisma.studentAccessCode.upsert({
    where: { codeHash: hashAccessCode(code) },
    create: {
      studentId: student.id,
      codeHash: hashAccessCode(code),
      codePreview: previewAccessCode(code),
      createdByTeacherId: input.createdByTeacherId || teacherId,
      status: "ACTIVE"
    },
    update: {
      studentId: student.id,
      codePreview: previewAccessCode(code),
      createdByTeacherId: input.createdByTeacherId || teacherId,
      status: "ACTIVE",
      disabledAt: null
    }
  });

  if (teacherId) {
    const existing = await prisma.teacherStudentAssignment.findFirst({
      where: { teacherId, studentId: student.id, activeTo: null }
    });
    if (!existing) {
      await prisma.teacherStudentAssignment.create({
        data: { teacherId, studentId: student.id, source: "student-registration" }
      });
    }
  }

  return { student, accessCode: code, codePreview: previewAccessCode(code) };
}

export async function disableStudentAccess(
  studentId,
  { prisma = defaultPrisma } = {}
) {
  return prisma.$transaction([
    prisma.student.update({
      where: { id: studentId },
      data: { loginEnabled: false, enrollmentStatus: "WITHDRAWN" }
    }),
    prisma.studentAccessCode.updateMany({
      where: { studentId, status: "ACTIVE" },
      data: { status: "DISABLED", disabledAt: new Date() }
    })
  ]);
}

export async function resetStudentAccessCode(
  studentId,
  input = {},
  { prisma = defaultPrisma } = {}
) {
  const code = input.accessCode || generateAccessCode();
  return prisma.$transaction(async (tx) => {
    await tx.studentAccessCode.updateMany({
      where: { studentId, status: "ACTIVE" },
      data: { status: "DISABLED", disabledAt: new Date() }
    });

    const student = await tx.student.update({
      where: { id: studentId },
      data: {
        loginEnabled: true,
        enrollmentStatus: input.enrollmentStatus || "ACTIVE"
      }
    });

    const accessCode = await tx.studentAccessCode.create({
      data: {
        studentId,
        codeHash: hashAccessCode(code),
        codePreview: previewAccessCode(code),
        createdByTeacherId: input.createdByTeacherId || student.responsibleTeacherId || null,
        status: "ACTIVE"
      }
    });

    return { student, accessCode, plainAccessCode: code, codePreview: previewAccessCode(code) };
  });
}

export async function updateStudentAccessStatus(
  studentId,
  input = {},
  { prisma = defaultPrisma } = {}
) {
  const enrollmentStatus = input.enrollmentStatus || "ACTIVE";
  const loginEnabled =
    input.loginEnabled ??
    (enrollmentStatus !== "WITHDRAWN" && enrollmentStatus !== "PAUSED");

  return prisma.$transaction(async (tx) => {
    const student = await tx.student.update({
      where: { id: studentId },
      data: { enrollmentStatus, loginEnabled }
    });

    if (!loginEnabled) {
      await tx.studentAccessCode.updateMany({
        where: { studentId, status: "ACTIVE" },
        data: { status: "DISABLED", disabledAt: new Date() }
      });
    }

    return student;
  });
}

export async function listTeacherStudents(
  teacherId,
  { prisma = defaultPrisma } = {}
) {
  return prisma.student.findMany({
    where: {
      OR: [
        { responsibleTeacherId: teacherId },
        { teacherAssignments: { some: { teacherId, activeTo: null } } }
      ]
    },
    include: {
      accessCodes: { where: { status: "ACTIVE" }, take: 1 },
      guardians: { include: { guardian: true } }
    },
    orderBy: [{ grade: "asc" }, { displayName: "asc" }]
  });
}

export async function createLearningTask(
  input,
  { prisma = defaultPrisma } = {}
) {
  let subjectId = input.subjectId || null;
  if (!subjectId && input.subject) {
    const subject = await prisma.subject.findFirst({
      where: { OR: [{ name: input.subject }, { code: input.subject }] }
    });
    subjectId = subject?.id || null;
  }

  return prisma.learningTask.create({
    data: {
      id: input.id || undefined,
      studentId: input.studentId || null,
      teacherId: input.teacherId || null,
      subjectId,
      title: input.title,
      description: input.description || null,
      status: input.status || "ASSIGNED",
      dueAt: input.dueAt || null,
      metadata: input.metadata || undefined
    }
  });
}

export async function createClassroomBroadcast(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.taskBroadcast.create({
    data: {
      deviceId: input.deviceId,
      teacherId: input.teacherId || null,
      subject: input.subject || null,
      title: input.title,
      content: input.content || null,
      voiceText: input.voiceText || input.content || input.title,
      status: input.status || "PENDING",
      metadata: input.metadata || undefined
    }
  });
}

export async function createDictationTask(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.dictationTask.create({
    data: {
      deviceId: input.deviceId,
      teacherId: input.teacherId || null,
      grade: normalizeGrade(input.grade),
      className: input.className || null,
      subject: input.subject,
      title: input.title,
      difficulty: input.difficulty || null,
      repeats: input.repeats ?? 2,
      intervalSeconds: input.intervalSeconds ?? 10,
      status: input.status || "PENDING",
      items: {
        create: (input.items || []).map((text, index) => ({
          orderIndex: index + 1,
          text: typeof text === "string" ? text : text.text,
          hint: typeof text === "string" ? null : text.hint || null,
          metadata: typeof text === "string" ? undefined : text.metadata || undefined
        }))
      }
    },
    include: { items: true }
  });
}

export async function createReadingTask(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.readingTask.create({
    data: {
      deviceId: input.deviceId,
      teacherId: input.teacherId || null,
      grade: normalizeGrade(input.grade),
      className: input.className || null,
      subject: input.subject,
      title: input.title,
      passage: input.passage,
      focusItems: input.focusItems || [],
      supportNote: input.supportNote || null,
      status: input.status || "PENDING"
    }
  });
}

export async function recordVoiceInteraction(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.voiceInteraction.create({
    data: {
      deviceId: input.deviceId,
      studentId: input.studentId || null,
      modelRunId: input.modelRunId || null,
      mode: input.mode || null,
      transcript: input.transcript,
      answerSummary: input.answerSummary || null,
      metadata: input.metadata || undefined
    }
  });
}

export async function recordQaSession(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.qaSession.create({
    data: {
      studentId: input.studentId || null,
      modelRunId: input.modelRunId || null,
      subject: input.subject || null,
      question: input.question,
      answer: input.answer || null,
      metadata: input.metadata || undefined
    }
  });
}

export async function recordVocabularyRecord(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.vocabularyRecord.create({
    data: {
      studentId: input.studentId,
      term: input.term,
      content: input.content || {}
    }
  });
}

export async function recordBehaviorEvent(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.behaviorEvent.create({
    data: {
      studentId: input.studentId || null,
      actorType: input.actorType || "SYSTEM",
      feature: input.feature,
      action: input.action,
      durationSeconds: input.durationSeconds ?? null,
      metadata: input.metadata || undefined
    }
  });
}

export async function createAssignmentDraft(
  input,
  { prisma = defaultPrisma } = {}
) {
  let subjectId = input.subjectId || null;
  if (!subjectId && input.subject) {
    const subject = await prisma.subject.findFirst({
      where: { OR: [{ name: input.subject }, { code: input.subject }] }
    });
    subjectId = subject?.id || null;
  }

  return prisma.assignment.create({
    data: {
      id: input.id || undefined,
      subjectId,
      title: input.title,
      grade: normalizeGrade(input.grade),
      difficulty: input.difficulty || null,
      metadata: input.metadata || undefined,
      items: input.items
        ? {
            create: input.items.map((item, index) => ({
              orderIndex: index + 1,
              itemType: item.itemType || item.type || "question",
              prompt: item.prompt,
              answer: item.answer || undefined,
              rubric: item.rubric || undefined,
              metadata: item.metadata || undefined
            }))
          }
        : undefined
    },
    include: { items: true }
  });
}

export async function recordSubmissionGrading(
  input,
  { prisma = defaultPrisma } = {}
) {
  const submission = await prisma.submission.create({
    data: {
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      status: input.status || "GRADED",
      content: input.content || undefined,
      grading: {
        create: {
          modelRunId: input.modelRunId || null,
          score: input.score ?? null,
          result: input.result || {},
          needsReview: input.needsReview ?? true
        }
      }
    },
    include: { grading: true }
  });

  if (input.mistakes?.length) {
    await prisma.mistakeRecord.createMany({
      data: input.mistakes.map((mistake) => ({
        studentId: input.studentId,
        subject: mistake.subject || input.subject || "unknown",
        prompt: mistake.prompt,
        studentAnswer: mistake.studentAnswer || null,
        correctAnswer: mistake.correctAnswer || null,
        cause: mistake.cause || null,
        metadata: mistake.metadata || undefined
      }))
    });
  }

  return submission;
}
