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
