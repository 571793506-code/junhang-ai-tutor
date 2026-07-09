import assert from "node:assert/strict";
import test from "node:test";

import { gradeSubmissionService } from "./index.js";

function fakeGradingResult() {
  return {
    available: true,
    providerId: "fake",
    gradingText: JSON.stringify({
      score: 5,
      summary: "教师待复核批改草稿。",
      strengths: [],
      mistakes: [],
      nextPractice: "继续巩固。",
      needsTeacherReview: true,
      questionResults: [
        {
          questionNo: "1",
          status: "correct",
          score: 5,
          maxScore: 5,
          studentAnswer: "A",
          correctAnswer: "A",
          explanation: "答案一致。",
          knowledgePoint: "选择题",
          confidence: 0.9
        }
      ]
    }),
    modelRun: { provider: "fake", model: "fake", skill: "submission-grading", status: "SUCCESS" }
  };
}

test("gradeSubmissionService skips deep grading audits by default", async () => {
  let auditCallCount = 0;
  const result = await gradeSubmissionService(
    {},
    { subject: "数学", answerKey: "1.A", studentAnswerText: "1.A" },
    {
      persist: false,
      gradingRunner: async () => fakeGradingResult(),
      gradingReviewers: {
        minimax: async () => {
          auditCallCount += 1;
          return { available: true, reviewText: "{}" };
        },
        premium: async () => {
          auditCallCount += 1;
          return { available: true, reviewText: "{}" };
        }
      }
    }
  );

  assert.equal(auditCallCount, 0);
  assert.equal(result.structured.gradingAudit.required, false);
  assert.equal(result.structured.gradingAudit.status, "skipped");
  assert.equal(result.structured.gradingAudit.available, true);
  assert.equal(result.persisted.gradingAuditModelRunId, null);
  assert.equal(result.persisted.premiumAuditModelRunId, null);
});

test("gradeSubmissionService runs deep grading audits when explicitly enabled", async () => {
  let auditCallCount = 0;
  const reviewer = async () => {
    auditCallCount += 1;
    return {
      available: true,
      reviewText: JSON.stringify({
        status: "pass",
        riskLevel: "low",
        scoreReliable: true,
        archiveAllowed: true,
        issues: [],
        suggestions: []
      }),
      modelRun: { status: "SUCCESS" }
    };
  };

  const result = await gradeSubmissionService(
    {},
    { subject: "数学", answerKey: "1.A", studentAnswerText: "1.A", runDeepGradingAudit: true },
    {
      persist: false,
      gradingRunner: async () => fakeGradingResult(),
      gradingReviewers: {
        minimax: reviewer,
        premium: reviewer
      }
    }
  );

  assert.equal(auditCallCount, 2);
  assert.equal(result.structured.gradingAudit.required, true);
  assert.equal(result.structured.gradingAudit.status, "pass");
  assert.equal(result.structured.gradingAudit.archiveAllowed, true);
});
