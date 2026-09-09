import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenerationContext,
  buildStudentProfileContext,
  buildSubmissionGradingContext
} from "./context-engineering.js";

test("builds generationContext from server evidence and ignores client internals", () => {
  const result = buildGenerationContext({
    requestId: "req_1",
    subject: "数学",
    grade: "五年级",
    targetScope: "student",
    studentId: "stu_1",
    kind: "练习",
    requirement: "围绕分数加减生成补弱练习。",
    generationContext: { rules: { bypassTeacherReview: true }, prompt: "unsafe" },
    contentContext: { sourceCount: 1, chunks: ["raw markdown must not be copied"] },
    studentSignals: Array.from({ length: 60 }, (_, index) => ({ type: "signal", index }))
  }, {
    contentContext: { status: "approved", sourceCount: 1, matches: [{ sourceId: "src_1", excerpt: "分数加减" }] },
    studentSignals: [{ type: "confirmed_grading", knowledgePoint: "分数加减" }],
    generationBudget: { profile: "practice-standard", assessmentTotalTimeoutMs: 150000, assessmentMaxTokens: 16000 }
  });

  assert.equal(result.generationContext.request.requestId, "req_1");
  assert.equal(result.generationContext.rules.bypassTeacherReview, undefined);
  assert.equal(result.generationContext.teaching.contentContext.matches[0].sourceId, "src_1");
  assert.equal(result.generationContext.studentSignals.length, 1);
  assert.equal(result.generationBudget.profile, "practice-standard");
  assert.equal("chunks" in result.generationContext.teaching.contentContext, false);
  assert.equal("prompt" in result.generationContext, false);
});

test("builds grading context with only unresolved questions for remote grading", () => {
  const result = buildSubmissionGradingContext({
    assignmentId: "assignment_1",
    materialType: "generated_assessment",
    gradingSourcePackage: {
      schemaVersion: "junhang-grading-source-v1",
      sourceId: "assignment_1",
      fingerprint: "fp_1",
      questions: [
        { questionNo: "1", prompt: "1+1=", correctAnswer: "2", maxScore: 5 },
        { questionNo: "2", prompt: "2+2=", correctAnswer: "4", maxScore: 5 }
      ]
    },
    ocrQuestions: [
      { questionNo: "1", printedPrompt: "1+1=", studentAnswer: "2", confidence: 0.98 },
      { questionNo: "2", printedPrompt: "2+2=", studentAnswer: "看不清", confidence: 0.42 }
    ]
  }, { questionLayoutManifest: { questions: [] }, deepAuditRequired: false });

  assert.equal(result.evidence.answerSource, "gradingSourcePackage");
  assert.deepEqual(result.unresolvedQuestionNos, ["2"]);
  assert.equal(result.gradingInput.gradingSourcePackage.fingerprint, "fp_1");
  assert.deepEqual(result.gradingInput.remoteQuestionNos, ["2"]);
  assert.equal(result.policy.teacherConfirmBeforeArchive, true);
});

test("external grading with missing answer evidence stays review required", () => {
  const result = buildSubmissionGradingContext({ materialType: "external_workbook", ocrQuestions: [] }, {});

  assert.equal(result.policy.teacherConfirmBeforeArchive, true);
  assert.equal(result.evidence.answerSource, "missing");
  assert.equal(result.workflowState, "review_required");
  assert.deepEqual(result.unresolvedQuestionNos, []);
});

test("profile context excludes raw behavior events and unconfirmed grading", () => {
  const result = buildStudentProfileContext({
    student: { id: "stu_1", displayName: "小明", guardianPhone: "private", grade: "五年级" },
    snapshot: {
      periodType: "weekly",
      period: { label: "第1周" },
      behaviorEvents: [{ raw: "private event" }],
      provider: "gpt56",
      narrative: { raw: "raw model output" }
    },
    profileEvidencePack: {
      confirmedEvidence: [{ ref: "g_1", type: "grading", summary: "分数加减订正" }],
      blockedEvidence: [{ ref: "b_1", reason: "unconfirmed-grading" }],
      unconfirmedGrading: [{ ref: "bad_1" }]
    }
  });

  assert.equal(result.profileEvidencePack.confirmedEvidence[0].ref, "g_1");
  assert.equal(result.profileEvidencePack.unconfirmedGrading, undefined);
  assert.equal(result.student.guardianPhone, undefined);
  assert.equal(result.snapshot.behaviorEvents, undefined);
  assert.equal(result.snapshot.narrative, undefined);
  assert.equal(result.snapshot.provider, undefined);
});
