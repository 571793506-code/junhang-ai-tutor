import test from "node:test";
import assert from "node:assert/strict";
import { removeStudentAccess, updateStudentProfile } from "./repositories.js";

function createPrisma(existing) {
  const calls = { update: [], disableCodes: [] };
  const tx = {
    student: {
      findUnique: async () => existing,
      update: async ({ data }) => ({ id: existing.id, ...existing, ...data })
    },
    studentAccessCode: {
      updateMany: async (input) => {
        calls.disableCodes.push(input);
        return { count: 1 };
      }
    }
  };
  return {
    calls,
    prisma: {
      $transaction: async (callback) => callback(tx),
      student: tx.student,
      studentAccessCode: tx.studentAccessCode
    }
  };
}

test("removeStudentAccess closes login and retains historical student identity", async () => {
  const { prisma, calls } = createPrisma({ id: "student-1", deletedAt: null });
  const now = new Date("2026-08-30T09:00:00.000Z");
  const student = await removeStudentAccess("student-1", { prisma, now });

  assert.equal(student.loginEnabled, false);
  assert.equal(student.enrollmentStatus, "WITHDRAWN");
  assert.equal(student.deletedAt, now);
  assert.equal(calls.disableCodes.length, 1);
  assert.deepEqual(calls.disableCodes[0].where, { studentId: "student-1", status: "ACTIVE" });
  assert.deepEqual(calls.disableCodes[0].data, { status: "DISABLED", disabledAt: now });
});

test("removeStudentAccess blocks a second removal", async () => {
  const error = await assert.rejects(
    () => removeStudentAccess("student-1", { prisma: createPrisma({ id: "student-1", deletedAt: new Date() }).prisma }),
    (candidate) => candidate?.code === "STUDENT_ACCESS_ALREADY_REMOVED"
  );
  assert.equal(error, undefined);
});

test("updateStudentProfile changes only the normalized grade", async () => {
  const calls = [];
  const prisma = {
    student: {
      update: async (input) => {
        calls.push(input);
        return { id: "student-1", grade: input.data.grade, loginEnabled: true, enrollmentStatus: "ACTIVE" };
      }
    }
  };
  const student = await updateStudentProfile("student-1", { grade: "初一" }, { prisma });

  assert.equal(student.grade, "七年级");
  assert.deepEqual(calls[0], { where: { id: "student-1" }, data: { grade: "七年级" } });
});

test("updateStudentProfile rejects an empty grade", async () => {
  await assert.rejects(
    () => updateStudentProfile("student-1", { grade: "" }, { prisma: { student: { update: async () => null } } }),
    (error) => error?.code === "STUDENT_GRADE_INVALID"
  );
});
