import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive } from "@junhang/services";
import { buildExternalGradingRecognitionPacket } from "./external-grading-recognition.js";
import { createTeachingWorkflowArchiveResolvers } from "./teaching-workflow-archive-resolvers.js";

function fixture() {
  const sourcePackage = buildGradingSourcePackage({ id: "a1", subject: { name: "数学" }, items: [{ prompt: "1+1", answer: "2", score: 5 }] }).package;
  const row = { id: "s-original", studentId: "student1", assignmentId: "a1", content: { materialType: "generated_assessment", ocr: { text: "1+1=3" } }, grading: { result: {} } };
  const assignment = { id: "a1", metadata: { gradingSourcePackage: sourcePackage, targetStudentId: "student1" }, subject: { name: "数学" } };
  const queries = [];
  const tx = {
    student: { findFirst: async ({ where }) => { queries.push(where); return where.id === "student1" && where.OR[0].responsibleTeacherId === "t1" ? { id: "student1" } : null; } },
    submission: { findFirst: async ({ where }) => where.id === row.id && where.studentId === row.studentId ? structuredClone(row) : null },
    assignment: { findUnique: async () => structuredClone(assignment) },
    $queryRaw: async (strings, ...values) => { queries.push({ sql: strings.join("?"), values }); return [{ id: "locked" }]; }
  };
  const adapter = createTeachingWorkflowArchiveResolvers({ prisma: { $transaction: (run) => run(tx) } });
  const actor = { teacherId: "t1" };
  const request = { studentId: "student1", submissionId: "s-original", assignmentId: "a1" };
  const snapshot = { gradingSourcePackage: sourcePackage, questions: [{ id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "3", correctAnswer: "2", score: 0, maxScore: 5, status: "wrong", explanation: "Add one and one.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" }] };
  return { adapter, actor, request, snapshot, row, assignment, queries, tx };
}

test("legacy assignment types are source-aligned, bound and invalidate changed grading evidence", async () => {
  const f = fixture();
  f.assignment.items = [{ orderIndex: 1, prompt: "1+1", answer: "2", itemType: "fill_blank", metadata: { score: 5 } }];
  const originalFingerprint = f.assignment.metadata.gradingSourcePackage.fingerprint;
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.deepEqual(context.archiveEvidence.assignmentQuestionTypes, [{ questionNo: "1", itemType: "fill_blank" }]);
  assert.equal(context.sourcePackage.fingerprint, originalFingerprint);
  f.snapshot.archiveEvidence = context.archiveEvidence;
  f.assignment.items[0].itemType = "calculation";
  const changed = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.notEqual(changed.archiveEvidence.fingerprint, context.archiveEvidence.fingerprint);
  assert.equal((await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: f.snapshot, tx: f.tx })).ok, false);
});

test("mismatched, duplicate or missing legacy types never become authoritative grading types", async () => {
  for (const patch of [{ prompt: "2+2" }, { answer: "4" }, { metadata: { score: 2 } }, { orderIndex: 2 }, { itemType: "" }]) {
    const f = fixture();
    f.assignment.items = [{ orderIndex: 1, prompt: "1+1", answer: "2", itemType: "fill_blank", metadata: { score: 5 }, ...patch }];
    const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
    assert.equal(context.archiveEvidence.assignmentQuestionTypes, undefined);
  }
  const f = fixture();
  f.assignment.items = Array.from({ length: 2 }, () => ({ orderIndex: 1, prompt: "1+1", answer: "2", itemType: "fill_blank", metadata: { score: 5 } }));
  assert.equal((await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request })).archiveEvidence.assignmentQuestionTypes, undefined);
});

test("source-bound types take priority over legacy assignment types", async () => {
  const f = fixture();
  f.assignment.metadata.gradingSourcePackage = buildGradingSourcePackage({ id: "a1", items: [{ prompt: "1+1", answer: "2", score: 5, sourceContext: { itemType: "calculation" } }] }).package;
  f.assignment.items = [{ orderIndex: 1, prompt: "1+1", answer: "2", itemType: "fill_blank", metadata: { score: 5 } }];
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.equal(context.archiveEvidence.assignmentQuestionTypes, undefined);
  assert.equal(context.sourcePackage.questions[0].context.itemType, "calculation");
});

test("resolver reads teacher-scoped persisted evidence and binds it to the confirmed workflow", async () => {
  const f = fixture();
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.equal(context.ok, true); assert.equal(context.sourcePackage.sourceId, "a1");
  f.snapshot.archiveEvidence = context.archiveEvidence;
  const result = await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: f.snapshot, tx: f.tx });
  assert.equal(result.ok, true); assert.equal(result.assignmentId, "a1");
  assert.ok(f.queries.some((q) => q.sql?.includes('"Submission"') && q.sql.includes("FOR UPDATE")));
  assert.ok(f.queries.some((q) => q.sql?.includes('"AssignmentItem"') && q.sql.includes("FOR SHARE")));
  const changed = structuredClone(f.snapshot); changed.archiveEvidence.fingerprint = "forged";
  assert.equal((await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: changed, tx: f.tx })).ok, false);
  f.row.content.ocr.text = "changed evidence";
  assert.equal((await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: f.snapshot, tx: f.tx })).ok, false);
});

test("foreign teacher/student, mismatched assignment and missing registered source fail closed", async () => {
  const f = fixture();
  for (const override of [{ actor: { teacherId: "other" } }, { request: { ...f.request, studentId: "other" } }, { request: { ...f.request, assignmentId: "other" } }]) {
    assert.equal((await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request, ...override })).ok, false);
  }
  delete f.assignment.metadata.gradingSourcePackage;
  assert.equal((await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request })).ok, false);
});

test("external evidence reuses workflow confirmation without bypassing quality or answer-source gates", async () => {
  const f = fixture();
  f.row.content.materialType = "external_workbook";
  const packet = buildExternalGradingRecognitionPacket({ answerSourceMode: "teacher_confirmed", answerSource: { answers: { "1": "2" } }, pages: [{ quality: { status: "usable" }, questions: [{ questionNo: "1", printedPrompt: "1+1", studentAnswer: "3", maxScore: 5, score: null, recognitionConfidence: 0.7 }] }] });
  f.row.content.externalGradingRecognition = packet;
  const run = async () => {
    const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
    assert.equal(context.ok, true);
    return f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: { ...f.snapshot, archiveEvidence: context.archiveEvidence }, tx: f.tx });
  };
  assert.equal((await run()).ok, true);
  packet.pages[0].quality.status = "poor";
  assert.equal((await run()).ok, false);
  packet.pages[0].quality.status = "usable";
  packet.answerSource.status = "missing";
  assert.equal((await run()).ok, false);
  packet.answerSource.status = "confirmed"; packet.answerSource.answers["1"] = "99";
  assert.equal((await run()).ok, false);
  packet.answerSource.answers["1"] = "2"; packet.pages = [];
  assert.equal((await run()).ok, false);
  packet.pages = [{ quality: { status: "usable" }, questions: [null] }];
  assert.equal((await run()).ok, false);
});

test("archived external input preserves original evidence and confirmation without losing quality gates", async () => {
  const f = fixture();
  f.assignment.items = [{ orderIndex: 1, prompt: "1+1", answer: "2", itemType: "fill_blank", metadata: { score: 5 } }];
  f.row.content.materialType = "external_workbook";
  f.row.content.externalGradingRecognition = buildExternalGradingRecognitionPacket({ answerSourceMode: "teacher_confirmed", answerSource: { answers: { "1": "2" } }, pages: [{ quality: { status: "poor" }, questions: [{ questionNo: "1", printedPrompt: "1+1", studentAnswer: "3", maxScore: 5 }] }] });
  const original = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  f.snapshot.archiveEvidence = original.archiveEvidence;
  // Preparation alone cannot certify publication; simulate a legacy archive
  // whose integrity is valid but whose original external image was poor.
  const archive = await buildTeachingWorkflowArchive({ actor: f.actor,
    workflow: { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 3, request: f.request },
    snapshot: f.snapshot, submissionId: "teaching-archive-input", confirmedAt: "2026-09-14T12:00:00Z",
    resolveGradingSource: async () => f.snapshot.gradingSourcePackage });
  Object.assign(f.row, { id: archive.id, status: "GRADED", content: { workflowArchive: archive },
    grading: { score: archive.snapshot.finalScore, result: { ...archive.snapshot, archiveEligible: true } } });
  f.request.submissionId = archive.id;
  f.assignment.items[0].itemType = "calculation";
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.equal(context.ok, true);
  assert.deepEqual(context.archiveEvidence, original.archiveEvidence);
  assert.equal(context.archiveEvidence.assignmentQuestionTypes[0].itemType, "fill_blank");
  assert.deepEqual(await f.adapter.resolveConfirmedArchive({ actor: f.actor, request: f.request }), archive);
  assert.equal((await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: archive.snapshot, tx: f.tx })).ok, false);
});

test("an external packet cannot disappear or be replaced by snapshot claims", async () => {
  const f = fixture(); f.row.content.materialType = "external_workbook";
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  const result = await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: { ...f.snapshot, archiveEvidence: context.archiveEvidence, externalGradingRecognition: { archiveEligible: true } }, tx: f.tx });
  assert.equal(result.ok, false);
  delete f.row.content.materialType;
  f.assignment.metadata.source = "photo-upload-batch";
  const inferred = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  assert.equal((await f.adapter.resolveArchiveEvidence({ actor: f.actor, workflow: { request: f.request }, snapshot: { ...f.snapshot, archiveEvidence: inferred.archiveEvidence }, tx: f.tx })).ok, false);
});

test("missing locks, changed reference answers, and publication without a transaction fail closed", async () => {
  const f = fixture();
  const context = await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request });
  f.snapshot.archiveEvidence = context.archiveEvidence;
  const args = { actor: f.actor, workflow: { request: f.request }, snapshot: f.snapshot, tx: f.tx };
  assert.equal((await f.adapter.resolveArchiveEvidence({ ...args, tx: null })).ok, false);
  f.assignment.metadata.gradingSourcePackage = buildGradingSourcePackage({ id: "a1", items: [{ prompt: "2+2", answer: "4", score: 5 }] }).package;
  assert.equal((await f.adapter.resolveArchiveEvidence(args)).ok, false);
  f.tx.$queryRaw = async () => [];
  assert.equal((await f.adapter.resolveGradingContext({ actor: f.actor, request: f.request })).ok, false);
});
