import test from "node:test";
import assert from "node:assert/strict";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive } from "@junhang/services";
import { buildReplayInput, summarizeGradingEvidence } from "./replay-grading-gold.mjs";

import {
  buildGradingGoldCollection,
  buildGradingGoldCase
} from "./collect-grading-gold.mjs";

function packageQuestion(questionNo, answer = "2") {
  return {
    questionNo: String(questionNo),
    prompt: `${questionNo} + 1 = ?`,
    correctAnswer: answer,
    maxScore: 5,
    analysisSteps: ["按题意计算"],
    knowledgePoint: "基础计算",
    rubric: "结果正确得分"
  };
}

function reviewedRow(overrides = {}) {
  const question = {
    questionNo: "1",
    status: "correct",
    studentAnswer: "2",
    correctAnswer: "2",
    score: 5,
    maxScore: 5,
    confidence: 0.98,
    reviewedByTeacher: true,
    reviewedAt: "2026-09-08T10:00:00.000Z"
  };
  return {
    id: "submission-real-1",
    submittedAt: new Date("2026-09-08T09:00:00.000Z"),
    student: { displayName: "学生甲" },
    content: {
      imageNames: ["学生甲作业.jpg"],
      studentAnswerText: "学生甲，电话 13800138000",
      source: "teacher-conversation-manual-grading"
    },
    grading: {
      score: 5,
      needsReview: false,
      result: {
        reviewStatus: "reviewed",
        reviewedByTeacherId: "teacher-secret-id",
        reviewedAt: "2026-09-08T10:00:00.000Z",
        archiveEligible: true,
        providerId: "internal-provider",
        rawText: "raw model output",
        questionResults: [question]
      }
    },
    assignment: {
      title: "不应写入 gold 的作业标题",
      grade: "四年级",
      metadata: {
        source: "teacher-conversation-manual-grading",
        kind: "小测",
        gradingSourcePackage: {
          schemaVersion: "junhang-grading-source-v1",
          sourceId: "source-secret-id",
          version: "1",
          fingerprint: "sha256:source-fingerprint",
          subject: "数学",
          grade: "四年级",
          kind: "小测",
          totalScore: 5,
          questions: [packageQuestion(1)]
        }
      },
      items: [{ prompt: "1 + 1 = ?", answer: "2", rubric: "结果正确" }]
    },
    ...overrides
  };
}

test("teacher-confirmed conversation grading becomes a de-identified gold case", () => {
  const result = buildGradingGoldCase(reviewedRow());

  assert.equal(result.ok, true);
  assert.match(result.caseValue.caseId, /^grading-[a-f0-9]{16}$/);
  assert.equal(result.caseValue.sourceType, "generated_assessment");
  assert.equal(result.caseValue.teacherReview.confirmedBy.startsWith("teacher-"), true);
  assert.equal(result.caseValue.teacherReview.modifiedQuestionNos.length, 0);
  assert.equal(result.caseValue.expected.questionResults[0].correctAnswer, "2");
  assert.equal(result.caseValue.input.ocrQuestions[0].studentAnswer, "2");
  assert.equal(result.caseValue.input.questionLayoutManifest.questions[0].correctAnswer, "2");
  assert.equal(result.caseValue.input.gradingSourcePackage.sourceId, undefined);
  assert.equal(result.caseValue.input.studentAnswerText, undefined);
  assert.equal(result.caseValue.input.imageNames, undefined);
  assert.equal(result.caseValue.input.assignmentTitle, undefined);
  assert.equal(JSON.stringify(result.caseValue).includes("学生甲"), false);
  assert.equal(JSON.stringify(result.caseValue).includes("13800138000"), false);
  assert.equal(JSON.stringify(result.caseValue).includes("raw model output"), false);
  assert.equal(JSON.stringify(result.caseValue).includes("internal-provider"), false);
});

test("gold collection preserves available context, recognition work and geometry", () => {
  const row = reviewedRow();
  row.assignment.metadata.gradingSourcePackage.questions[0].context = {
    itemType: "calculation",
    sharedMaterial: { id: "material-1", text: "脱敏材料" }
  };
  row.grading.result.questionResults[0].observedWork = "1+1=2";
  row.grading.result.questionResults[0].bbox = { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
  row.grading.result.questionResults[0].page = 1;
  row.grading.result.questionResults[0].sourceImageRef = "upload-1";
  row.grading.result.questionResults[0].cropRef = "crop-1";
  const result = buildGradingGoldCase(row);
  assert.equal(result.ok, true);
  assert.equal(result.caseValue.input.gradingSourcePackage.questions[0].context.itemType, "calculation");
  assert.equal(result.caseValue.input.questionLayoutManifest.questions[0].context.sharedMaterial.id, "material-1");
  assert.equal(result.caseValue.input.ocrQuestions[0].observedWork, "1+1=2");
  assert.deepEqual(result.caseValue.input.ocrQuestions[0].bbox, { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
  assert.equal(result.caseValue.input.ocrQuestions[0].sourceImageRef, "upload-1");
});

test("collection restores only source-aligned registered legacy types through replay", () => {
  const row = reviewedRow();
  row.assignment.id = "source-secret-id";
  row.assignment.items = [{ orderIndex: 1, itemType: "choice", prompt: row.assignment.metadata.gradingSourcePackage.questions[0].prompt,
    answer: "2", metadata: { score: 5 } }];
  const before = structuredClone(row);
  const gold = buildGradingGoldCase(row).caseValue;
  assert.equal(gold.input.gradingSourcePackage.questions[0].itemType, "choice");
  assert.equal(gold.input.questionLayoutManifest.questions[0].itemType, "choice");
  assert.equal(gold.input.ocrQuestions[0].itemType, "choice");
  const replay = buildReplayInput(gold.input);
  assert.equal(replay.gradingSourcePackage.questions[0].context.itemType, "choice");
  assert.equal(summarizeGradingEvidence(replay).questionTypeCount, 1);
  assert.deepEqual(row, before);
  for (const patch of [{ prompt: "different" }, { answer: "99" }, { metadata: { score: 2 } }, { orderIndex: 2 }, { itemType: "" }]) {
    const changed = structuredClone(row);
    Object.assign(changed.assignment.items[0], patch);
    assert.equal(buildGradingGoldCase(changed).caseValue.input.gradingSourcePackage.questions[0].itemType, undefined);
  }
  row.assignment.items.push(structuredClone(row.assignment.items[0]));
  assert.equal(buildGradingGoldCase(row).caseValue.input.gradingSourcePackage.questions[0].itemType, undefined);
});

test("validated immutable archive types survive changed live assignment fields; tampering is blocked", async () => {
  const row = reviewedRow();
  const source = buildGradingSourcePackage({ id: "paper1", subject: { name: "数学" }, grade: "四年级",
    items: [{ orderIndex: 1, prompt: "1+1", answer: "2", score: 5 }] }).package;
  const snapshot = { gradingSourcePackage: source,
    archiveEvidence: { assignmentQuestionTypes: [{ questionNo: "1", itemType: "fill_blank" }] },
    questions: [{ id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "2", correctAnswer: "2", maxScore: 5, score: 5,
      status: "correct", explanation: "correct", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" }] };
  const archive = await buildTeachingWorkflowArchive({ actor: { teacherId: "t1" },
    workflow: { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 1, request: { studentId: "s1" } },
    snapshot, submissionId: "archive1", confirmedAt: "2026-10-10T10:00:00Z", resolveGradingSource: async () => source });
  Object.assign(row, { id: archive.id, studentId: "s1", status: "GRADED", content: { workflowArchive: archive },
    grading: { score: 5, needsReview: false, result: { ...archive.snapshot, archiveEligible: true,
      reviewStatus: "reviewed", reviewedByTeacherId: "t1", reviewedAt: archive.confirmedAt } } });
  row.assignment.id = "paper1";
  row.assignment.metadata.gradingSourcePackage = source;
  row.assignment.items = [{ orderIndex: 1, itemType: "calculation", prompt: "1+1", answer: "2", metadata: { score: 5 } }];
  assert.equal(buildGradingGoldCase(row).caseValue.input.gradingSourcePackage.questions[0].itemType, "fill_blank");
  row.content.workflowArchive.snapshot.archiveEvidence.assignmentQuestionTypes[0].itemType = "choice";
  const invalid = buildGradingGoldCase(row);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.summary.reasons.includes("WORKFLOW_ARCHIVE_EVIDENCE_INVALID"));
});

test("source-bound type overrides legacy and OCR types; OCR alone cannot supply a grading type", () => {
  const row = reviewedRow();
  row.assignment.items = [{ orderIndex: 1, itemType: "choice", prompt: row.assignment.metadata.gradingSourcePackage.questions[0].prompt,
    answer: "2", metadata: { score: 5 } }];
  row.content.ocrQuestions = [{ questionNo: "1", itemType: "choice", confidence: 0.8 }];
  row.assignment.metadata.gradingSourcePackage.questions[0].context = { itemType: "calculation" };
  const gold = buildGradingGoldCase(row).caseValue;
  assert.equal(gold.input.gradingSourcePackage.questions[0].context.itemType, "calculation");
  assert.equal(gold.input.ocrQuestions[0].itemType, "calculation");
  delete row.assignment.metadata.gradingSourcePackage.questions[0].context;
  row.assignment.metadata.gradingSourcePackage.questions[0].type = "calculation";
  const standalone = buildGradingGoldCase(row).caseValue;
  assert.equal(standalone.input.ocrQuestions[0].itemType, "calculation");
  assert.equal(buildReplayInput(standalone.input).gradingSourcePackage.questions[0].context.itemType, "calculation");
  delete row.assignment.metadata.gradingSourcePackage.questions[0].type;
  row.assignment.items = [];
  assert.equal(buildGradingGoldCase(row).caseValue.input.ocrQuestions[0].itemType, undefined);
});

test("collection retains original recognition evidence without deriving work from grading reasoning", () => {
  const row = reviewedRow();
  row.content.ocrQuestions = [{ questionNo: "1", observedWork: "学生甲写了 1+1=2", confidence: 0.6, bbox: { page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, sourceImageRef: "学生甲.jpg" }];
  row.grading.result.questionResults[0].studentProcess = ["GRADING_REASONING_NOT_RECOGNITION"];
  const question = buildGradingGoldCase(row).caseValue.input.ocrQuestions[0];
  assert.equal(question.observedWork, "[REDACTED]写了 1+1=2");
  assert.equal(question.confidence, 0.6);
  assert.equal(question.bbox.page, 2);
  assert.equal(question.sourceImageRef, "[REDACTED].jpg");
  assert.doesNotMatch(JSON.stringify(question), /GRADING_REASONING/);
  delete row.content.ocrQuestions;
  assert.equal(buildGradingGoldCase(row).caseValue.input.ocrQuestions[0].observedWork, undefined);
});

test("unconfirmed and incomplete records stay in the blocked report", () => {
  const pending = reviewedRow({
    id: "submission-pending",
    grading: {
      score: null,
      needsReview: true,
      result: { reviewStatus: "pending_teacher_review", questionResults: [] }
    }
  });
  const external = reviewedRow({
    id: "submission-external",
    content: { source: "photo-upload", materialType: "external_workbook", imageNames: ["page.jpg"] },
    grading: {
      score: 5,
      needsReview: false,
      result: {
        reviewStatus: "reviewed",
        reviewedByTeacherId: "teacher-secret-id",
        reviewedAt: "2026-09-08T10:00:00.000Z",
        archiveEligible: true,
        questionResults: [{
          questionNo: "1",
          status: "correct",
          studentAnswer: "2",
          correctAnswer: "2",
          score: 5,
          maxScore: 5,
          reviewedByTeacher: true,
          reviewedAt: "2026-09-08T10:00:00.000Z"
        }]
      }
    },
    assignment: { metadata: { source: "photo-upload", kind: "小测" }, items: [] }
  });

  const report = buildGradingGoldCollection([pending, external]);
  assert.equal(report.cases.length, 0);
  assert.equal(report.counts.teacherConfirmedCases, 0);
  assert.equal(report.counts.blockedCases, 2);
  assert.equal(report.blocked.some((item) => item.reasons.includes("TEACHER_REVIEW_NOT_CONFIRMED")), true);
  assert.equal(report.blocked.some((item) => item.reasons.includes("GRADING_SOURCE_PACKAGE_REQUIRED")), true);
  const externalBlocked = report.blocked.find((item) => item.sourceType === "external_workbook");
  assert.equal(externalBlocked.reasons.includes("GRADING_SOURCE_PACKAGE_INCOMPLETE"), false);
});

test("collection output validates as a non-synthetic gold case list", () => {
  const report = buildGradingGoldCollection([reviewedRow()]);
  assert.equal(report.counts.teacherConfirmedCases, 1);
  assert.equal(report.counts.productionEligible, false);
  assert.equal(report.cases[0].input.gradingSourcePackage.schemaVersion, "junhang-grading-source-v1");
});

test("incomplete source package is blocked even when its question count matches", () => {
  const row = reviewedRow();
  row.assignment.metadata.gradingSourcePackage.questions[0].correctAnswer = "";
  row.assignment.metadata.gradingSourcePackage.fingerprint = "";

  const result = buildGradingGoldCase(row);

  assert.equal(result.ok, false);
  assert.equal(result.summary.reasons.includes("GRADING_SOURCE_PACKAGE_INCOMPLETE"), true);
});
