import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive } from "@junhang/services";

import { filterNewReviewedMistakes, loadCurrentTeachingEvidence } from "./grading-mistake-archive.js";

test("profile source loading fetches archive versions beyond the recent submission limit with student scope", async () => {
  const calls = [];
  const student = { id: "s1", submissions: [{ id: "legacy" }], mistakes: [] };
  const prisma = { submission: { findMany: async (args) => { calls.push(args); return []; } } };
  const result = await loadCurrentTeachingEvidence(prisma, student);
  assert.equal(calls[0].where.studentId, "s1");
  assert.deepEqual(calls[0].where.content.path, ["workflowArchive", "schemaVersion"]);
  assert.equal(calls[0].take, undefined);
  assert.deepEqual(result.submissions, student.submissions);
  assert.equal(await loadCurrentTeachingEvidence(prisma, null), null);
  assert.equal(calls.length, 1);
});

test("source loading retrieves an out-of-window archive so an old mistake cannot reappear", async () => {
  const source = buildGradingSourcePackage({ id: "paper", items: [{ prompt: "1+1", answer: "2", score: 5 }] }).package;
  const question = { id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "2", correctAnswer: "2", status: "correct", score: 5, maxScore: 5, explanation: "Correct.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" };
  const args = { actor: { teacherId: "t1" }, workflow: { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 3, request: { studentId: "s1" } },
    snapshot: { questions: [question], gradingSourcePackage: source }, submissionId: "a1", confirmedAt: "2026-07-04T09:00:00.000Z", resolveGradingSource: async () => source };
  const old = await buildTeachingWorkflowArchive(args);
  const next = await buildTeachingWorkflowArchive({ ...args, submissionId: "a2", workflow: { ...args.workflow, currentRevision: 5 }, previousArchive: old });
  const submissions = [old, next].map((a) => ({ id: a.id, studentId: "s1", status: "GRADED", content: { workflowArchive: a }, grading: { score: a.snapshot.finalScore, result: { ...a.snapshot, archiveEligible: true } } }));
  const student = { id: "s1", submissions: [submissions[0]], mistakes: [{ id: "old-mistake", metadata: { workflowArchiveId: "a1", sourceSubmissionId: "a1" } }] };
  const result = await loadCurrentTeachingEvidence({ submission: { findMany: async () => submissions } }, student);
  assert.deepEqual(result.submissions.map((s) => s.id), ["a2"]);
  assert.deepEqual(result.mistakes, []);
});

test("does not rearchive dialogue-confirmed questions from the same submission", () => {
  const reviewedMistakes = [
    { prompt: "第2题：乘法计算", metadata: { questionNos: ["2"] } },
    { prompt: "第3题：乘法计算", metadata: { questionNos: ["3"] } },
    { prompt: "第5题：除法计算", metadata: { questionNos: ["5"] } }
  ];
  const existingMistakes = [{
    metadata: {
      sourceSubmissionId: "submission-1",
      questionNos: ["2", "3"],
      archiveSource: "teacher-dialogue-archive"
    }
  }];

  assert.deepEqual(
    filterNewReviewedMistakes(existingMistakes, reviewedMistakes, "submission-1"),
    [{ prompt: "第5题：除法计算", metadata: { questionNos: ["5"] } }]
  );
});

test("keeps reviewed mistakes when the archived evidence belongs to another submission", () => {
  const reviewedMistakes = [{ prompt: "第2题：乘法计算", metadata: { questionNos: ["2"] } }];
  const existingMistakes = [{ metadata: { sourceSubmissionId: "submission-other", questionNos: ["2"] } }];

  assert.deepEqual(
    filterNewReviewedMistakes(existingMistakes, reviewedMistakes, "submission-1"),
    reviewedMistakes
  );
});

test("separates mistake deduplication by source revision", () => {
  const reviewed = [{ prompt: "新版第2题", metadata: { questionNos: ["2"], sourceVersion: 2 } }];
  const existing = [{ metadata: { sourceSubmissionId: "submission-1", questionNos: ["2"], sourceVersion: 1 } }];

  assert.deepEqual(
    filterNewReviewedMistakes(existing, reviewed, "submission-1", { sourceVersion: 2 }),
    reviewed
  );
  assert.deepEqual(
    filterNewReviewedMistakes([{ metadata: { sourceSubmissionId: "submission-1", questionNos: ["2"], sourceVersion: 2 } }], reviewed, "submission-1", { sourceVersion: 2 }),
    []
  );
});
