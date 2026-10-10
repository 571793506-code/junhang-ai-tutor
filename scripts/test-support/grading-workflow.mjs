import { buildGradingSourcePackage } from "@junhang/core";
import { createTeachingWorkflowExecution } from "../../apps/api/src/teaching-workflow-execution.js";
import { createTeachingWorkflowArchiveService } from "../../packages/services/src/teaching-workflow-publication.js";
import { createTeachingWorkflowArchiveRepository } from "../../packages/db/src/teaching-workflow-archive-repository.js";
import { fakeTeachingArchivePrisma } from "./teaching-archive-prisma.mjs";
import { workflowHttpFixture } from "./teaching-workflow-http.mjs";

// Synthetic recognition/model data and in-memory persistence, never real OCR/DB evidence.
export async function gradingWorkflowFixture(t) {
  const source = buildGradingSourcePackage({ id: "paper1", grade: "四年级", subject: { name: "数学" },
    items: [1, 2].map((n) => ({ orderIndex: n, prompt: n === 1 ? "说明交换加数为什么和不变" : "24+18", answer: n === 1 ? "交换两组数量，总数不变" : "42", score: 5,
      analysisSteps: ["结合数量解释"], rubric: "思路与结果正确得5分", knowledgePoint: "加法" })) }).package;
  const context = { ok: true, sourcePackage: source, subject: "数学", studentId: "s1", assignmentId: "paper1",
    archiveEvidence: { schemaVersion: "teaching-workflow-grading-evidence-v1", fingerprint: "fixture-evidence", sourceFingerprint: source.fingerprint },
    submission: { id: "submission1", content: { imageFiles: [{ fileName: "page1.png", url: "/qa/page1.png" }, { fileName: "page2.png", url: "/qa/page2.png" }],
      ocr: { questions: [
        { questionNo: "1", printedPrompt: source.questions[0].prompt, studentAnswer: null, confidence: 0.3, bbox: { page: 1, x: 0.1, y: 0.15, w: 0.7, h: 0.2 }, sourceImageRef: "page1.png" },
        { questionNo: "2", printedPrompt: "24+18", studentAnswer: "42", confidence: 0.99, bbox: { page: 2, x: 0.12, y: 0.25, w: 0.7, h: 0.15 }, sourceImageRef: "page2.png" }
      ] } } } };
  const calls = [];
  const execution = createTeachingWorkflowExecution({ resolveGradingContext: async () => structuredClone(context),
    grade: async (_config, input, options) => {
      calls.push(structuredClone(input));
      if (options.persist !== false) throw new Error("TEST_MUST_NOT_PERSIST");
      return { available: true, structured: { questionResults: input.ocrQuestions.map((q) => ({ questionNo: q.questionNo,
        studentAnswer: q.studentAnswer, correctAnswer: input.referenceAnswers.find((r) => r.questionNo === q.questionNo).correctAnswer,
        status: q.studentAnswer == null ? "uncertain" : "correct", score: q.studentAnswer == null ? null : 5, maxScore: 5,
        explanation: q.studentAnswer == null ? "字迹不清，需核对原图" : q.questionNo === "1" ? "学生用交换两堆小棒说明总量不变，属于合理异解。" : "计算正确",
        knowledgePoint: "加法", rubric: "思路与结果正确得5分", reviewedByTeacher: true, confirmedBy: "FORGED" })) } };
    } });
  const archiveDb = fakeTeachingArchivePrisma();
  let http;
  const publisher = createTeachingWorkflowArchiveService({ repository: createTeachingWorkflowArchiveRepository(archiveDb),
    authorizeStudent: async ({ actor, studentId }) => actor.teacherId === "t1" && studentId === "s1",
    resolveArchiveEvidence: async () => ({ ok: true, studentId: "s1", assignmentId: "paper1", subject: "数学", sourcePackage: source }) });
  const archiveService = { publish: async (input) => {
    const head = await http.repo.get(input.workflowId, input.actor.teacherId);
    if (!head) throw Object.assign(new Error("not found"), { code: "WORKFLOW_NOT_FOUND" });
    const old = archiveDb.snapshot();
    archiveDb.seed({ workflows: [head], revisions: [...old.revisions.filter((r) => r.workflowId !== head.id || r.revision !== head.currentRevision),
      { workflowId: head.id, revision: head.currentRevision, snapshot: head.snapshot }] });
    return publisher.publish(input);
  } };
  http = await workflowHttpFixture(t, { ...execution, archiveService,
    resolveArchive: (id) => archiveDb.snapshot().submissions.find((row) => row.id === id) || null,
    resolveConfirmedArchive: async () => context.submission.content.workflowArchive || null });
  return { ...http, source, context, calls, archiveDb };
}

export const gradingRequest = { module: "grading", requestKey: "grading-request", request: { studentId: "s1", submissionId: "submission1", assignmentId: "paper1", title: "加法作业" } };
