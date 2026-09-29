import test from "node:test";
import assert from "node:assert/strict";

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
