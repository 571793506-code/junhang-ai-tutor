import assert from "node:assert/strict";
import test from "node:test";
import { gradeSubmissionService } from "./index.js";

test("fully objective grading uses known answers without remote grading", async () => {
  let gradingCalls = 0;
  let solCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "数学",
      kind: "小测",
      totalScore: 10,
      answerKey: "1=A;2=42",
      studentAnswerText: "1. a。 2. 42.0",
      printedText: "1. 选择正确答案。 2. 6*7=?"
    },
    {
      persist: false,
      gradingRunner: async () => {
        gradingCalls += 1;
        throw new Error("remote grading should not run");
      },
      solGradingRunner: async () => {
        solCalls += 1;
        throw new Error("Sol grading should not run");
      }
    }
  );

  assert.equal(gradingCalls, 0);
  assert.equal(solCalls, 0);
  assert.equal(result.referenceAnswer.mode, "answer_key");
  assert.equal(result.persisted.referenceModelRunId, null);
  assert.equal(result.structured.score, 10);
  assert.deepEqual(result.structured.questionResults.map((item) => item.status), ["correct", "correct"]);
});

test("low-confidence generated references retry once with Sol only when printed evidence exists", async () => {
  const executions = [];
  const referenceAnswerRunner = async (_config, _input, execution) => {
    executions.push(execution || null);
    const isSol = execution?.role === "sol-reference-escalation";
    return {
      available: true,
      providerId: "gpt56",
      referenceText: JSON.stringify({
        referenceAnswers: [{ questionNo: "1", prompt: "1+1=?", correctAnswer: "2", confidence: isSol ? 0.99 : 0.5 }],
        confidence: isSol ? 0.99 : 0.5,
        needsTeacherReview: !isSol
      }),
      modelRun: { provider: "gpt56", model: isSol ? "gpt-5.6-sol" : "gpt-5.6", status: "SUCCESS" }
    };
  };
  const commonOptions = {
    persist: false,
    referenceAnswerRunner,
    gradingRunner: async () => ({
      available: true,
      providerId: "gpt56",
      gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
    })
  };

  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol", GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000" },
    { subject: "数学", totalScore: 5, printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    commonOptions
  );
  assert.equal(executions.length, 2);
  assert.equal(executions[1].model, "gpt-5.6-sol");
  assert.equal(executions[1].reasoningEffort, "high");
  assert.equal(executions[1].timeoutMs, 180000);
  assert.equal(result.referenceAnswer.confidence, 0.99);

  executions.length = 0;
  await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { subject: "数学", ocrText: "混合OCR内容", studentAnswerText: "1. 2" },
    commonOptions
  );
  assert.equal(executions.length, 1);
});

test("objective comparison keeps unsafe multi-answer text unresolved", async () => {
  let runnerInput = null;
  await gradeSubmissionService(
    {},
    {
      subject: "英语",
      answerKey: "1=A或B",
      studentAnswerText: "1. A"
    },
    {
      persist: false,
      gradingRunner: async (_config, input) => {
        runnerInput = input;
        return {
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: 100,
            summary: "存在多答案规则，交由教师复核。",
            questionResults: [
              { questionNo: "1", status: "uncertain", studentAnswer: "A", correctAnswer: "A或B", confidence: 0.5 }
            ]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
        };
      },
      gradingReviewers: {
        premium: async () => ({
          available: true,
          reviewText: JSON.stringify({
            status: "pass",
            riskLevel: "low",
            scoreReliable: true,
            archiveAllowed: true,
            issues: [],
            suggestions: []
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
        })
      }
    }
  );

  assert.equal(runnerInput.ocrQuestions.length, 1);
});

test("mixed grading sends only unresolved questions and derives score from question results", async () => {
  let runnerInput = null;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "小测",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
        { questionNo: "2", prompt: "说明人物品质并结合文章分析。", correctAnswer: "言之有理即可", score: 6, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "选择题", studentAnswer: "c", confidence: 0.99 },
        { questionNo: "2", printedText: "说明人物品质并结合文章分析。", studentAnswer: "人物很勇敢，因为他主动帮助同伴。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async (_config, input) => {
        runnerInput = input;
        return {
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: 100,
            summary: "主观题基本合理。",
            questionResults: [
              { questionNo: "2", status: "partial", score: 3, maxScore: 6, studentAnswer: input.ocrQuestions[0].studentAnswer, correctAnswer: "言之有理即可", confidence: 0.8 }
            ]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
        };
      },
      gradingReviewers: {
        premium: async () => ({
          available: true,
          reviewText: JSON.stringify({
            status: "pass",
            riskLevel: "low",
            scoreReliable: true,
            archiveAllowed: true,
            issues: [],
            suggestions: []
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
        })
      }
    }
  );

  assert.deepEqual(runnerInput.ocrQuestions.map((item) => item.questionNo), ["2"]);
  assert.deepEqual(runnerInput.referenceAnswers.map((item) => item.questionNo), ["2"]);
  assert.doesNotMatch(runnerInput.studentAnswerText, /\bc\b/i);
  assert.equal(result.structured.score, 7);
  assert.deepEqual(
    result.structured.questionResults.map((item) => [item.questionNo, item.status, item.score]),
    [["1", "correct", 4], ["2", "partial", 3]]
  );
});

test("mixed grading keeps unresolved questions uncertain when remote grading fails", async () => {
  let reviewCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "小测",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
        { questionNo: "2", prompt: "结合文章说明人物品质。", correctAnswer: "言之有理即可", score: 6, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "选择题", studentAnswer: "C", confidence: 0.99 },
        { questionNo: "2", printedText: "结合文章说明人物品质。", studentAnswer: "人物很勇敢。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: false,
        providerId: "gpt56",
        gradingText: "",
        error: "MODEL_TIMEOUT",
        modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "ERROR" }
      }),
      gradingReviewers: {
        premium: async () => {
          reviewCalls += 1;
          return {
            available: false,
            reviewText: "",
            error: "MODEL_TIMEOUT",
            modelRun: { provider: "gpt56", model: "gpt-5.6", status: "ERROR" }
          };
        }
      }
    }
  );

  assert.deepEqual(result.structured.questionResults.map((item) => item.questionNo), ["1", "2"]);
  assert.equal(result.structured.questionResults[1].status, "uncertain");
  assert.equal(result.structured.score, null);
  assert.equal(result.structured.needsTeacherReview, true);
  assert.equal(reviewCalls, 1);
});

test("subjective grading keeps questions omitted by the remote model uncertain", async () => {
  let reviewCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "练习",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "概括段意。", correctAnswer: "意思合理即可", score: 5, confidence: 1 },
        { questionNo: "2", prompt: "分析人物品质。", correctAnswer: "言之有理即可", score: 5, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "概括段意。", studentAnswer: "写了春天的景色。", confidence: 0.95 },
        { questionNo: "2", printedText: "分析人物品质。", studentAnswer: "人物很勇敢。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({
          summary: "仅返回了一道题。",
          questionResults: [
            { questionNo: "1", status: "partial", score: 3, maxScore: 5, confidence: 0.8 }
          ]
        }),
        modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
      }),
      gradingReviewers: {
        premium: async () => {
          reviewCalls += 1;
          return {
            available: true,
            reviewText: JSON.stringify({ status: "pass", riskLevel: "low", scoreReliable: true, archiveAllowed: true, issues: [], suggestions: [] }),
            modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
          };
        }
      }
    }
  );

  assert.deepEqual(result.structured.questionResults.map((item) => item.questionNo), ["1", "2"]);
  assert.equal(result.structured.questionResults[1].status, "uncertain");
  assert.equal(result.structured.score, null);
  assert.equal(reviewCalls, 1);
});
