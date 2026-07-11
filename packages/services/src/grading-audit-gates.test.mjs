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

test("gradeSubmissionService supplies structured evidence to deep grading audits from answer key and typed text", async () => {
  const auditPayloads = [];
  const reviewer = async (_config, payload) => {
    auditPayloads.push(payload);
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
    {
      subject: "数学",
      kind: "小测",
      title: "结构化证据审计",
      answerKey: "1=42;2=18",
      printedText: "1. 6*7=? 2. 3*6=?",
      studentAnswerText: "1. 42 2. 18",
      runDeepGradingAudit: true
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "fake",
        gradingText: JSON.stringify({
          score: 100,
          summary: "两题均正确。",
          needsTeacherReview: true,
          questionResults: [
            { questionNo: "1", status: "correct", studentAnswer: "42", correctAnswer: "42", confidence: 0.95 },
            { questionNo: "2", status: "correct", studentAnswer: "18", correctAnswer: "18", confidence: 0.95 }
          ]
        }),
        modelRun: { provider: "fake", model: "fake", skill: "submission-grading", status: "SUCCESS" }
      }),
      gradingReviewers: {
        minimax: reviewer,
        premium: reviewer
      }
    }
  );

  assert.equal(auditPayloads.length, 2);
  for (const payload of auditPayloads) {
    assert.deepEqual(
      payload.referenceAnswers.map((item) => [item.questionNo, item.correctAnswer]),
      [["1", "42"], ["2", "18"]]
    );
    assert.equal(payload.questionLayoutManifest.questionCount, 2);
    assert.deepEqual(
      payload.ocr.questions.map((item) => [item.questionNo, item.printedText, item.studentAnswer]),
      [["1", "6*7=?", "42"], ["2", "3*6=?", "18"]]
    );
    assert.equal(payload.ocr.confidence, 0.92);
  }
  assert.equal(result.structured.gradingAudit.status, "pass");
});

test("gradeSubmissionService runs one GPT-5.6 risk review for uncertain, low-confidence, or score-mismatch results", async () => {
  const cases = [
    { name: "uncertain", score: 0, status: "uncertain", confidence: 0.5, questionScore: 0 },
    { name: "low-confidence", score: 5, status: "correct", confidence: 0.4, questionScore: 5 },
    { name: "score-mismatch", score: 5, status: "correct", confidence: 0.95, questionScore: 2 }
  ];

  for (const sample of cases) {
    let minimaxCalls = 0;
    let premiumCalls = 0;
    const result = await gradeSubmissionService(
      {},
      {
        subject: "英语",
        totalScore: 5,
        answerKey: "1=A或B",
        studentAnswerText: "1. A"
      },
      {
        persist: false,
        gradingRunner: async () => ({
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: sample.score,
            summary: sample.name,
            questionResults: [
              {
                questionNo: "1",
                status: sample.status,
                score: sample.questionScore,
                maxScore: 5,
                studentAnswer: "A",
                correctAnswer: "A或B",
                confidence: sample.confidence
              }
            ]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
        }),
        gradingReviewers: {
          minimax: async () => {
            minimaxCalls += 1;
            return { available: true, reviewText: "{}" };
          },
          premium: async () => {
            premiumCalls += 1;
            return {
              available: true,
              reviewText: JSON.stringify({
                status: "needs_review",
                riskLevel: "medium",
                scoreReliable: false,
                archiveAllowed: false,
                issues: ["教师需复核。"]
              }),
              modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
            };
          }
        }
      }
    );

    assert.equal(minimaxCalls, 0, sample.name);
    assert.equal(premiumCalls, 1, sample.name);
    assert.equal(result.structured.gradingAudit.required, true, sample.name);
  }
});

test("gradeSubmissionService does not run risk review for a clean grading result", async () => {
  let reviewCalls = 0;
  await gradeSubmissionService(
    {},
    { subject: "英语", totalScore: 5, answerKey: "1=A或B", studentAnswerText: "1. A" },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({
          score: 5,
          summary: "证据清晰。",
          questionResults: [
            { questionNo: "1", status: "correct", score: 5, maxScore: 5, studentAnswer: "A", correctAnswer: "A或B", confidence: 0.95 }
          ]
        }),
        modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
      }),
      gradingReviewers: {
        premium: async () => {
          reviewCalls += 1;
          return { available: true, reviewText: "{}" };
        }
      }
    }
  );

  assert.equal(reviewCalls, 0);
});

function riskyTwoQuestionResult(overrides = {}) {
  return {
    available: true,
    providerId: "gpt56",
    gradingText: JSON.stringify({
      score: 7,
      summary: "其中一道题需复核。",
      questionResults: [
        { questionNo: "1", status: "correct", score: 4, maxScore: 4, studentAnswer: "C", correctAnswer: "C", confidence: 0.98 },
        { questionNo: "2", status: "uncertain", score: 3, maxScore: 6, studentAnswer: "人物很勇敢。", correctAnswer: "结合文本说明", confidence: 0.5, ...overrides }
      ]
    }),
    modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
  };
}

test("Sol regrades only risky questions, replaces only those results, and recomputes total score", async () => {
  const solInputs = [];
  let premiumCalls = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol", GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000" },
    {
      subject: "语文",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
        { questionNo: "2", prompt: "结合文本说明人物品质。", correctAnswer: "勇敢并结合文本", score: 6, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "选择题", studentAnswer: "C", confidence: 0.99 },
        { questionNo: "2", printedText: "结合文本说明人物品质。", studentAnswer: "人物很勇敢。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async () => riskyTwoQuestionResult(),
      solGradingRunner: async (_config, input, execution) => {
        solInputs.push({ input, execution });
        return {
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: 5,
            summary: "复核完成。",
            questionResults: [{ questionNo: "2", status: "partial", score: 5, maxScore: 6, studentAnswer: "人物很勇敢。", correctAnswer: "勇敢并结合文本", confidence: 0.9 }]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6-sol", status: "SUCCESS" }
        };
      },
      gradingReviewers: { premium: async () => { premiumCalls += 1; return { available: true, reviewText: "{}" }; } }
    }
  );

  assert.equal(solInputs.length, 1);
  assert.deepEqual(solInputs[0].input.ocrQuestions.map((item) => item.questionNo), ["2"]);
  assert.deepEqual(solInputs[0].input.referenceAnswers.map((item) => item.questionNo), ["2"]);
  assert.deepEqual(solInputs[0].input.questionLayoutManifest.questions.map((item) => item.questionNo), ["2"]);
  assert.equal(solInputs[0].execution.reasoningEffort, "high");
  assert.equal(premiumCalls, 0);
  assert.equal(result.structured.questionResults[0].modelEscalated, undefined);
  assert.equal(result.structured.questionResults[1].modelEscalated, true);
  assert.equal(result.structured.score, 9);
});

test("Sol selection includes low confidence, answer conflict, and locatable score mismatch only", async () => {
  const cases = [
    { overrides: { status: "correct", confidence: 0.4 }, expected: ["2"] },
    { overrides: { status: "correct", confidence: 0.95, correctAnswer: "另一个答案" }, expected: ["2"] },
    { overrides: { status: "correct", confidence: 0.95, score: 7, maxScore: 6 }, expected: ["2"] }
  ];
  for (const sample of cases) {
    const selected = [];
    await gradeSubmissionService(
      { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
      {
        subject: "语文",
        totalScore: 10,
        referenceAnswers: [
          { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
          { questionNo: "2", prompt: "分析人物。", correctAnswer: "勇敢", score: 6, confidence: 1 }
        ],
        ocrQuestions: [
          { questionNo: "1", printedText: "选择题", studentAnswer: "C", confidence: 0.99 },
          { questionNo: "2", printedText: "分析人物。", studentAnswer: "勇敢", confidence: 0.99 }
        ]
      },
      {
        persist: false,
        gradingRunner: async () => riskyTwoQuestionResult(sample.overrides),
        solGradingRunner: async (_config, input) => {
          selected.push(...input.ocrQuestions.map((item) => item.questionNo));
          return riskyTwoQuestionResult({ status: "correct", confidence: 0.95, score: 6, maxScore: 6, correctAnswer: "勇敢" });
        }
      }
    );
    assert.deepEqual(selected, sample.expected);
  }
});

test("insufficient grading evidence never calls Sol", async () => {
  const cases = [
    { imageQuality: { status: "poor" } },
    { imageQuality: { status: "needs_review" } },
    { studentAnswerText: "", ocrQuestions: [{ questionNo: "1", printedText: "1+1=?", studentAnswer: "" }] },
    { printedText: "", ocrQuestions: [{ questionNo: "1", printedText: "", studentAnswer: "2" }] },
    { ocrStatus: "UNSEPARATED" }
  ];
  for (const evidence of cases) {
    let solCalls = 0;
    await gradeSubmissionService(
      { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
      {
        subject: "数学",
        totalScore: 5,
        referenceAnswers: [{ questionNo: "1", prompt: "1+1=?", correctAnswer: "2", score: 5, confidence: 1 }],
        printedText: "1. 1+1=?",
        studentAnswerText: "1. 2",
        ocrQuestions: [{ questionNo: "1", printedText: "1+1=?", studentAnswer: "2", confidence: 0.95 }],
        ...evidence
      },
      {
        persist: false,
        gradingRunner: async () => riskyTwoQuestionResult(),
        solGradingRunner: async () => { solCalls += 1; return riskyTwoQuestionResult(); },
        gradingReviewers: { premium: async () => ({ available: false, reviewText: "" }) }
      }
    );
    assert.equal(solCalls, 0, JSON.stringify(evidence));
  }
});

test("unresolved Sol preserves provisional score, blocks audit, and does not chain a Terra reviewer", async () => {
  let premiumCalls = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    {
      subject: "语文",
      totalScore: 6,
      referenceAnswers: [{ questionNo: "1", prompt: "分析人物。", correctAnswer: "勇敢", score: 6, confidence: 1 }],
      ocrQuestions: [{ questionNo: "1", printedText: "分析人物。", studentAnswer: "勇敢", confidence: 0.95 }]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 3, questionResults: [{ questionNo: "1", status: "uncertain", score: 3, maxScore: 6, confidence: 0.5 }] })
      }),
      solGradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 3, questionResults: [{ questionNo: "1", status: "uncertain", score: 3, maxScore: 6, confidence: 0.55 }] })
      }),
      gradingReviewers: { premium: async () => { premiumCalls += 1; return { available: true, reviewText: "{}" }; } }
    }
  );

  assert.equal(premiumCalls, 0);
  assert.equal(result.structured.score, null);
  assert.equal(result.structured.provisionalScore, 3);
  assert.equal(result.structured.gradingAudit.required, true);
  assert.equal(result.structured.gradingAudit.scoreReliable, false);
  assert.equal(result.structured.gradingAudit.archiveAllowed, false);
});
