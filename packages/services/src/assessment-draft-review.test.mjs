import assert from "node:assert/strict";
import test from "node:test";
import { draftAssessmentService } from "./index.js";

const sampleDraftText = JSON.stringify({
  title: "五年级英语小测",
  sections: [
    {
      title: "一、词汇与短语",
      type: "fill",
      items: [
        {
          itemType: "fill",
          prompt: "根据中文写英文短语：做作业。",
          answer: "do homework",
          answerFormat: "english-four-line",
          analysisSteps: ["识别动词短语。", "do 表示做。", "homework 表示作业。"],
          commonMistake: "不要漏写 homework。",
          knowledgePoint: "Unit 4 词汇"
        }
      ]
    }
  ]
});

function fakeAssessmentResult() {
  return {
    available: true,
    providerId: "fake",
    draftText: sampleDraftText,
    modelRun: {
      provider: "fake",
      model: "fake-assessment",
      skill: "assessment-draft",
      status: "SUCCESS",
      metadata: { attempts: [] }
    }
  };
}

test("draftAssessmentService does not run model review by default", async () => {
  let reviewCallCount = 0;
  const result = await draftAssessmentService(
    {},
    { subject: "英语", kind: "小测", grade: "五年级", requirement: "Unit 4" },
    {
      persist: false,
      assessmentDraftRunner: async () => fakeAssessmentResult(),
      assessmentModelReviewers: {
        minimax: async () => {
          reviewCallCount += 1;
          return { available: true, reviewText: "{}" };
        },
        premium: async () => {
          reviewCallCount += 1;
          return { available: true, reviewText: "{}" };
        }
      }
    }
  );

  assert.equal(reviewCallCount, 0);
  assert.equal(result.draftAvailable, true);
  assert.equal(result.generationPipeline.modelReview.required, false);
  assert.equal(result.generationPipeline.modelReview.status, "skipped");
  assert.equal(result.generationPipeline.gates.modelReviewRequired, false);
});

test("draftAssessmentService can run model review when explicitly requested", async () => {
  let reviewCallCount = 0;
  const reviewer = async () => {
    reviewCallCount += 1;
    return {
      available: true,
      reviewText: JSON.stringify({
        status: "pass",
        riskLevel: "low",
        exportReady: true,
        qualityScore: 90,
        issues: [],
        suggestions: []
      }),
      modelRun: { status: "SUCCESS" }
    };
  };

  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      requirement: "Unit 4",
      runModelReview: true
    },
    {
      persist: false,
      assessmentDraftRunner: async () => fakeAssessmentResult(),
      assessmentModelReviewers: {
        minimax: reviewer,
        premium: reviewer
      }
    }
  );

  assert.equal(reviewCallCount, 2);
  assert.equal(result.generationPipeline.modelReview.required, true);
  assert.equal(result.generationPipeline.modelReview.status, "passed");
  assert.equal(result.generationPipeline.gates.modelReviewRequired, true);
});

test("draftAssessmentService forwards assessment timeout budget to runner", async () => {
  let runnerInput = null;
  await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "小测",
      grade: "五年级",
      requirement: "短预算测试",
      assessmentTotalTimeoutMs: 1200
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return fakeAssessmentResult();
      }
    }
  );

  assert.equal(runnerInput.assessmentTotalTimeoutMs, 1200);
  assert.ok(runnerInput.generationContext);
});

test("draftAssessmentService assigns standard quiz generation budget", async () => {
  let runnerInput = null;
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      requirement: "第四单元小测"
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return fakeAssessmentResult();
      }
    }
  );

  assert.equal(runnerInput.generationProfile, "quiz-standard");
  assert.equal(runnerInput.assessmentTotalTimeoutMs, 60000);
  assert.equal(runnerInput.assessmentMaxTokens, 16000);
  assert.equal(runnerInput.generationContext.output.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.assessmentMaxTokens, 16000);
});

test("draftAssessmentService assigns formal budget to exams and personalized practice", async () => {
  const runnerInputs = [];
  const runner = async (_config, input) => {
    runnerInputs.push(input);
    return fakeAssessmentResult();
  };

  await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "试卷",
      grade: "六年级",
      requirement: "小升初难度偏高"
    },
    { persist: false, assessmentDraftRunner: runner }
  );
  await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "练习",
      grade: "五年级",
      studentId: "student-1",
      requirement: "针对近期错题做个性化练习"
    },
    { persist: false, assessmentDraftRunner: runner }
  );

  assert.equal(runnerInputs[0].generationProfile, "formal-full");
  assert.equal(runnerInputs[0].assessmentTotalTimeoutMs, 180000);
  assert.equal(runnerInputs[0].assessmentMaxTokens, 20000);
  assert.equal(runnerInputs[1].generationProfile, "formal-full");
  assert.equal(runnerInputs[1].assessmentTotalTimeoutMs, 120000);
  assert.equal(runnerInputs[1].assessmentMaxTokens, 20000);
});

test("draftAssessmentService preserves explicit generation budget overrides", async () => {
  let runnerInput = null;
  await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "小测",
      grade: "五年级",
      requirement: "手动预算",
      generationProfile: "manual",
      generationTimeoutMs: 9000,
      assessmentMaxTokens: 7777
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return fakeAssessmentResult();
      }
    }
  );

  assert.equal(runnerInput.generationProfile, "manual");
  assert.equal(runnerInput.assessmentTotalTimeoutMs, 9000);
  assert.equal(runnerInput.generationTimeoutMs, 9000);
  assert.equal(runnerInput.assessmentMaxTokens, 7777);
});

test("draftAssessmentService keeps exam total score at 100 when bonus is requested", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "试卷",
      grade: "六年级",
      requirement: "小升初难度偏高，题量适中，必须有一个附加题"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: true,
        providerId: "fake",
        draftText: JSON.stringify({
          title: "六年级小升初数学试卷",
          sections: [
            {
              title: "一、填空题",
              items: Array.from({ length: 12 }).map((_, index) => ({
                itemType: "fill",
                prompt: `填空题 ${index + 1}`,
                answer: "1",
                analysisSteps: ["根据题意计算。"],
                knowledgePoint: "数与代数"
              }))
            },
            {
              title: "二、选择题",
              items: Array.from({ length: 8 }).map((_, index) => ({
                itemType: "choice",
                prompt: `选择题 ${index + 1}`,
                options: ["A. 1", "B. 2", "C. 3", "D. 4"],
                answer: "A",
                analysisSteps: ["排除错误选项。"],
                knowledgePoint: "综合判断"
              }))
            },
            {
              title: "三、计算题",
              items: Array.from({ length: 8 }).map((_, index) => ({
                itemType: "calculation",
                prompt: `计算题 ${index + 1}`,
                answer: "10",
                analysisSteps: ["写出计算过程。"],
                knowledgePoint: "计算能力"
              }))
            },
            {
              title: "四、解答题",
              items: Array.from({ length: 6 }).map((_, index) => ({
                itemType: "solution",
                prompt: index === 5 ? "附加题：解决问题 6" : `解决问题 ${index + 1}`,
                answer: "略",
                analysisSteps: ["分析数量关系。"],
                knowledgePoint: "解决问题"
              }))
            }
          ]
        }),
        modelRun: {
          provider: "fake",
          model: "fake-assessment",
          skill: "assessment-draft",
          status: "SUCCESS",
          metadata: { attempts: [] }
        }
      })
    }
  );

  assert.equal(result.totalScore, 100);
  assert.equal(result.generationPipeline.repair.totalScore, 100);
});
