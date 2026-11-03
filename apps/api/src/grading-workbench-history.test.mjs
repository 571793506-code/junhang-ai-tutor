import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive } from "@junhang/services";
import { gradingArchivePublishedAt, gradingWorkbenchArchivedSnapshot, loadGradingWorkbenchRows, projectArchivedGradingQuestion } from "./grading-workbench-history.js";

const archived = (id = "archive") => ({ id, status: "GRADED", grading: { needsReview: false, result: {
  archivePublishedAt: "2026-11-02T12:27:57.997Z", reviewStatus: "reviewed", reviewedByTeacherId: "t1", needsTeacherReview: false
} } });

test("frozen evidence renders multi-blank/structured answers, preserves observed process and unknown OCR without changing the snapshot", () => {
  const question = { id: "q2", correctAnswer: ["200", "60", "12", "1128"], studentAnswer: null, observedWork: "4×50  3×20  3×4  1128", score: 2 };
  const original = structuredClone(question);
  const view = projectArchivedGradingQuestion(question);
  assert.equal(view.correctAnswer, "200；60；12；1128");
  assert.equal(view.studentAnswer, "");
  assert.deepEqual(view.studentProcess, [question.observedWork]);
  assert.deepEqual(question, original);
  assert.equal(projectArchivedGradingQuestion({ correctAnswer: { value: "2", unit: "km" }, studentAnswer: 0 }).studentAnswer, "0");
  assert.equal(projectArchivedGradingQuestion({ correctAnswer: { value: "2", unit: "km" } }).correctAnswer, '{"value":"2","unit":"km"}');
  assert.deepEqual(projectArchivedGradingQuestion({ studentProcess: ["教师核对过程"], observedWork: "原始识别" }).studentProcess, ["教师核对过程"]);
  assert.deepEqual(projectArchivedGradingQuestion({ observedWork: null }).studentProcess, []);
});

test("history requires persisted independent archive evidence, not a draft or review flag alone", () => {
  const row = archived();
  assert.equal(gradingArchivePublishedAt(row), "2026-11-02T12:27:57.997Z");
  assert.equal(gradingArchivePublishedAt({ ...row, grading: { ...row.grading, result: JSON.stringify(row.grading.result) } }), gradingArchivePublishedAt(row));
  for (const candidate of [null, { ...row, status: "SUBMITTED" }, { ...row, grading: { ...row.grading, needsReview: true } },
    ...[{ archivePublishedAt: null }, { archivePublishedAt: "invalid" }, { reviewStatus: "pending_teacher_review" },
      { reviewedByTeacherId: "" }, { needsTeacherReview: true }].map(patch => ({ ...row, grading: { ...row.grading, result: { ...row.grading.result, ...patch } } })),
    { ...row, grading: { needsReview: false, result: "broken JSON" } }]) {
    assert.equal(gradingArchivePublishedAt(candidate), null);
  }
});

test("default queue remains unreviewed and both list modes keep the teacher/student database scope", async () => {
  const calls = [];
  const db = { submission: { findMany: async (args) => { calls.push(args); return []; } } };
  await loadGradingWorkbenchRows(db, { teacherId: "t1", studentId: "s1" });
  assert.deepEqual(calls[0].where.grading, { needsReview: true });
  assert.equal(calls[0].where.studentId, "s1");
  await loadGradingWorkbenchRows(db, { teacherId: "t2", reviewState: "archived" });
  assert.deepEqual(calls[1].where.grading, { needsReview: false });
  assert.equal(calls[1].where.status, "GRADED");
  for (const [i, teacherId] of ["t1", "t2"].entries()) {
    assert.deepEqual(calls[i].where.student.OR, [
      { responsibleTeacherId: teacherId }, { teacherAssignments: { some: { teacherId, activeTo: null } } }
    ]);
    assert.equal(calls[i].take, 500);
    assert.equal(calls[i].include.grading, true);
  }
});

test("archived list excludes legacy unmarked rows and paginates only after archive verification", async () => {
  const rows = [archived("one"), { id: "reviewed-only", status: "GRADED", grading: { needsReview: false, result: {} } }, archived("two")];
  const db = { submission: { findMany: async () => rows } };
  const result = await loadGradingWorkbenchRows(db, { teacherId: "t1", reviewState: "archived" });
  assert.deepEqual(result.rows.map(row => row.id), ["one", "two"]);
  assert.equal(result.capped, false);
  // The legacy queue continues to use its database result without silently changing membership.
  assert.deepEqual((await loadGradingWorkbenchRows(db, { teacherId: "t1" })).rows, rows);
});

test("versioned archives expose frozen questions/images/source only after immutable evidence validation", async () => {
  const source = buildGradingSourcePackage({ id: "paper", items: [{ prompt: "1+1", answer: "2", score: 5 }] }).package;
  const question = { id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "2", correctAnswer: "2", status: "correct", score: 5, maxScore: 5, explanation: "Correct", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" };
  const archive = await buildTeachingWorkflowArchive({ actor: { teacherId: "t1" }, workflow: { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 1, request: { studentId: "s1" } },
    snapshot: { questions: [question], pages: [{ pageNumber: 1, imageUrl: "/uploads/original.jpg" }], gradingSourcePackage: source },
    submissionId: "teaching-archive-one", confirmedAt: archived().grading.result.archivePublishedAt, resolveGradingSource: async () => source });
  const row = { ...archived(archive.id), studentId: "s1", content: { workflowArchive: archive } };
  row.grading.score = archive.snapshot.finalScore;
  row.grading.result = { ...row.grading.result, ...archive.snapshot, archiveEligible: true, provisionalScore: null };
  assert.deepEqual(gradingWorkbenchArchivedSnapshot(row).questions, archive.snapshot.questions);
  assert.equal(gradingWorkbenchArchivedSnapshot(row).pages[0].imageUrl, "/uploads/original.jpg");
  assert.equal(gradingWorkbenchArchivedSnapshot(row).gradingSourcePackage.fingerprint, source.fingerprint);
  assert.ok(gradingArchivePublishedAt(row));
  const tampered = structuredClone(row);
  tampered.grading.result.questions[0].score = 0;
  assert.equal(gradingArchivePublishedAt(tampered), null);
  assert.equal(gradingWorkbenchArchivedSnapshot(tampered), null);
  assert.equal(gradingArchivePublishedAt({ ...archived("teaching-archive-missing") }), null);
});
