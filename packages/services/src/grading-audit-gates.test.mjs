import assert from "node:assert/strict";
import test from "node:test";
import { gradeSubmissionService } from "./index.js";

const subjective = {
  subject: "数学", totalScore: 5,
  referenceAnswers: [{ questionNo: "1", prompt: "说明理由", correctAnswer: "交换加数和不变", score: 5, confidence: 1 }],
  ocrQuestions: [{ questionNo: "1", printedPrompt: "说明理由", studentAnswer: "因为交换后仍是原来的数量", confidence: 0.95 }]
};
const answer = (patch = {}) => ({ questionNo: "1", status: "partial", score: 3, maxScore: 5, explanation: "思路正确，理由不完整", confidence: 0.9, ...patch });
const runtime = (questions, metadata = {}) => ({
  available: true, providerId: "gpt56", model: "gpt-6-astra",
  gradingText: JSON.stringify({ score: 999, questionResults: questions }),
  modelRun: { provider: "gpt56", model: "gpt-6-astra", skill: "submission-grading", status: "SUCCESS", metadata }
});

test("legacy flags and injected reviewers cannot add service calls or authorize archive", async () => {
  let gradingCalls = 0; let extraCalls = 0;
  const reviewer = async () => { extraCalls++; throw new Error("No service review allowed"); };
  const result = await gradeSubmissionService({ GRADING_RUN_DEEP_AUDIT: "true", GPT56_SOL_FALLBACK_ENABLED: "true" }, { ...subjective, runDeepGradingAudit: true }, {
    persist: false, runDeepGradingAudit: true,
    gradingRunner: async () => { gradingCalls++; return runtime([answer()]); },
    solGradingRunner: reviewer, gradingReviewers: { premium: reviewer, minimax: reviewer }
  });
  assert.equal(gradingCalls, 1); assert.equal(extraCalls, 0);
  assert.equal(result.structured.score, 3); assert.equal(result.structured.archiveEligible, false);
  assert.equal(result.structured.gradingAudit.required, false); assert.equal(result.structured.gradingAudit.status, "skipped");
  assert.equal(result.persisted.gradingAuditModelRunId, null); assert.equal(result.persisted.premiumAuditModelRunId, null);
});

test("objective evidence remains available with zero content or reviewer calls", async () => {
  const unexpected = async () => { throw new Error("Objective task must stay local"); };
  const result = await gradeSubmissionService({}, {
    subject: "数学", totalScore: 10, printedText: "1. 6*7=? 2. 3*6=?", answerKey: "1=42;2=18", studentAnswerText: "1.42 2.18", runDeepGradingAudit: true
  }, { persist: false, gradingRunner: unexpected, gradingReviewers: { premium: unexpected, minimax: unexpected } });
  assert.equal(result.structured.score, 10);
  assert.deepEqual(result.structured.questionResults.map((q) => q.questionNo), ["1", "2"]);
  assert.equal(result.structured.archiveEligible, false);
});

for (const patch of [{ status: "uncertain", score: 3, confidence: 0.4 }, { confidence: 0.4 }, { correctAnswer: "与参考答案冲突" }]) {
  test(`risky draft stays under teacher confirmation without service Sol (${JSON.stringify(patch)})`, async () => {
    let calls = 0;
    const result = await gradeSubmissionService({}, { ...subjective, assignmentId: "assignment-1" }, {
      persist: false, gradingRunner: async () => { calls++; return runtime([answer(patch)]); },
      solGradingRunner: async () => { throw new Error("No additional service call"); }
    });
    assert.equal(calls, 1); assert.equal(result.structured.archiveEligible, false);
    if (patch.status === "uncertain") {
      assert.equal(result.structured.questionResults[0].score, null); assert.equal(result.structured.score, null);
    }
  });
}

test("runtime replacement is persisted once and its unsuccessful attempt is not repeated", async () => {
  for (const successful of [true, false]) {
    const runs = [];
    const result = await gradeSubmissionService({}, { ...subjective, assignmentId: "assignment-1" }, {
      prisma: { modelRun: { create: async ({ data }) => { runs.push(data); return { id: "bounded-run", ...data }; } } },
      gradingRunner: async () => ({ ...runtime([answer(successful ? {} : { status: "uncertain", score: null })], {
        solAttempted: true, usedModelEscalation: successful, attempts: [{ model: "gpt-6-astra", status: "ERROR" }, { model: "gpt-5.6-sol", status: successful ? "SUCCESS" : "ERROR" }]
      }), model: successful ? "gpt-5.6-sol" : "gpt-6-astra" }),
      solGradingRunner: async () => { throw new Error("Must not repeat runtime attempt"); },
      gradingReviewers: { premium: async () => { throw new Error("Must not append review"); } }
    });
    assert.equal(runs.length, 1); assert.equal(result.persisted.modelRunId, "bounded-run");
    assert.equal(result.structured.archiveEligible, false);
    if (!successful) assert.equal(result.structured.score, null);
  }
});

test("persistence failure surfaces instead of publishing an unrecorded grading result", async () => {
  await assert.rejects(gradeSubmissionService({}, subjective, {
    prisma: { modelRun: { create: async () => { throw new Error("persistence unavailable"); } } },
    gradingRunner: async () => runtime([answer()])
  }), /persistence unavailable/);
});

test("insufficient image evidence is passed as a preflight block to the bounded runtime", async () => {
  let execution;
  const result = await gradeSubmissionService({}, { ...subjective, imageQuality: { status: "poor" } }, {
    persist: false, gradingRunner: async (_config, _input, options) => {
      execution = options;
      return { available: false, providerId: "gpt56", gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    }
  });
  assert.equal(execution.evidenceSufficient, false);
  assert.equal(result.structured.score, null); assert.equal(result.structured.archiveEligible, false);
});

test("reference and unresolved grading share one deadline and output-token pool", async () => {
  const budgets = []; const remaining = [];
  const result = await gradeSubmissionService({}, { subject: "数学", printedText: "1.说明理由", studentAnswerText: "1.我的推导", totalScore: 5 }, {
    persist: false, teachingExecution: { now: () => 1000, timeoutMs: 300, maxTokens: 1000 },
    referenceAnswerRunner: async (_config, _input, execution) => {
      budgets.push(execution.operationBudget); execution.operationBudget.remainingTokens -= 200;
      return { available: true, referenceText: JSON.stringify({ referenceAnswers: [{ questionNo: "1", prompt: "说明理由", correctAnswer: "标准推导", score: 5, confidence: 0.95 }] }) };
    },
    gradingRunner: async (_config, _input, execution) => {
      budgets.push(execution.operationBudget); remaining.push(execution.operationBudget.remainingTokens);
      return runtime([answer()]);
    }
  });
  assert.equal(budgets.length, 2); assert.equal(budgets[0], budgets[1]);
  assert.equal(budgets[0].deadlineAt, 1300); assert.deepEqual(remaining, [800]);
  assert.equal(result.structured.archiveEligible, false);
});
