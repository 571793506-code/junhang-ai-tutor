import type { PrismaClient } from "@prisma/client";

export declare const prisma: PrismaClient;
export declare function createPrismaClient(options?: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient;
export declare function generateAccessCode(length?: number): string;
export declare function hashAccessCode(code: string, pepper?: string): string;
export declare function previewAccessCode(code: string): string;
export declare function recordModelRun(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function upsertTeacherWithAccessCode(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createStudentWithAccessCode(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function upsertStudentWithAccessCode(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function disableStudentAccess(studentId: string, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function resetStudentAccessCode(studentId: string, input?: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function updateStudentAccessStatus(studentId: string, input?: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function updateStudentProfile(studentId: string, input?: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function removeStudentAccess(studentId: string, options?: { prisma?: PrismaClient; now?: Date }): Promise<unknown>;
export declare function listTeacherStudents(teacherId: string, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createLearningTask(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createClassroomBroadcast(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createDictationTask(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createReadingTask(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function recordVoiceInteraction(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function recordQaSession(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function findDictionaryEntryByTerm(
  term: string,
  options?: { prisma?: PrismaClient }
): Promise<any>;
export declare function upsertDictionaryEntryWithAliases(
  input: Record<string, any>,
  options?: { prisma?: PrismaClient }
): Promise<any>;
export declare function createAssignmentDraft(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createTeachingWorkflowAssignmentRepository(prisma?: PrismaClient): {
  publish(input: Record<string, any>): Promise<Record<string, any>>;
};
export declare function recordSubmissionGrading(input: Record<string, unknown>, options?: { prisma?: PrismaClient }): Promise<unknown>;
export declare function createTeachingWorkflowRepository(prisma?: PrismaClient): {
  getCreation(input: Record<string, unknown>): Promise<unknown>;
  reserveCreation(input: Record<string, unknown>): Promise<unknown>;
  create(input: Record<string, unknown>): Promise<unknown>;
  get(workflowId: string, ownerTeacherId: string): Promise<unknown>;
  list(ownerTeacherId: string, module?: "generation" | "grading"): Promise<unknown>;
  getRevision(workflowId: string, revision: number, ownerTeacherId: string): Promise<unknown>;
  beginOperation(input: Record<string, unknown>): Promise<unknown>;
  commitRevision(input: Record<string, unknown>): Promise<unknown>;
  getOperation(workflowId: string, operationKey: string, ownerTeacherId: string): Promise<unknown>;
  saveCheckpoint(input: Record<string, unknown>): Promise<unknown>;
  endOperation(input: Record<string, unknown>): Promise<unknown>;
  cancel(input: { workflowId: string; ownerTeacherId: string; expectedRevision?: number }): Promise<unknown>;
  markInterrupted(): Promise<unknown>;
};

export declare function createTeachingWorkflowArchiveRepository(prisma?: PrismaClient): {
  publish(input: {
    workflowId: string;
    ownerTeacherId: string;
    expectedRevision: number;
    authorize: (context: Record<string, any>) => Promise<boolean> | boolean;
    prepare: (context: Record<string, any>) => Promise<Record<string, any>>;
    validateExisting: (context: Record<string, any>) => Promise<boolean> | boolean;
  }): Promise<Record<string, any>>;
};
