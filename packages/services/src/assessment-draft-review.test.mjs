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
  assert.equal(runnerInput.assessmentTotalTimeoutMs, 210000);
  assert.equal(runnerInput.assessmentMaxTokens, 20000);
  assert.equal(runnerInput.generationContext.output.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.assessmentMaxTokens, 20000);
});

test("draftAssessmentService expands all configured generation profile budgets", async () => {
  const runnerInputs = [];
  const runner = async (_config, input) => {
    runnerInputs.push(input);
    return fakeAssessmentResult();
  };

  for (const generationProfile of ["e2e-fast", "fast-check", "practice-standard"]) {
    await draftAssessmentService(
      {},
      {
        subject: "英语",
        kind: "练习",
        grade: "五年级",
        requirement: `${generationProfile} 预算检查`,
        generationProfile
      },
      { persist: false, assessmentDraftRunner: runner }
    );
  }

  assert.deepEqual(
    runnerInputs.map((input) => ({
      profile: input.generationProfile,
      timeout: input.assessmentTotalTimeoutMs,
      maxTokens: input.assessmentMaxTokens
    })),
    [
      { profile: "e2e-fast", timeout: 105000, maxTokens: 16000 },
      { profile: "fast-check", timeout: 105000, maxTokens: 16000 },
      { profile: "practice-standard", timeout: 210000, maxTokens: 20000 }
    ]
  );
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
  assert.equal(runnerInputs[0].assessmentTotalTimeoutMs, 270000);
  assert.equal(runnerInputs[0].assessmentMaxTokens, 24000);
  assert.equal(runnerInputs[1].generationProfile, "formal-full");
  assert.equal(runnerInputs[1].assessmentTotalTimeoutMs, 270000);
  assert.equal(runnerInputs[1].assessmentMaxTokens, 24000);
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

test("draftAssessmentService repairs missing requested math bonus item without changing exam total", async () => {
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
                prompt: `解决问题 ${index + 1}`,
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
  assert.equal(
    result.draftItems.some((item) => /附加题|挑战|拓展/.test(`${item.metadata?.sectionTitle || ""} ${item.prompt || ""}`)),
    true
  );
});

test("draftAssessmentService replaces exam-style English quiz items during local repair", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      requirement: "Unit 4 单元词汇、句型和阅读，不要完形填空或文章选词填空"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: true,
        providerId: "fake",
        draftText: JSON.stringify({
          title: "五年级英语小测",
          sections: [
            {
              title: "一、词汇运用",
              items: Array.from({ length: 8 }).map((_, index) => ({
                itemType: "fill",
                prompt: `根据中文写单词 ${index + 1} ______。`,
                answer: "word",
                analysisSteps: ["看中文。", "写英文。", "检查拼写。"],
                knowledgePoint: "单词拼写"
              }))
            },
            {
              title: "二、句型表达",
              items: [
                {
                  itemType: "solution",
                  prompt: "文章选词填空：从方框中选择合适单词补全短文。",
                  answer: "略",
                  analysisSteps: ["通读短文。", "判断词性。", "填入答案。"],
                  knowledgePoint: "试卷式词汇运用"
                },
                {
                  itemType: "solution",
                  prompt: "完形填空：Read the passage and choose the best answer.",
                  answer: "略",
                  analysisSteps: ["通读短文。", "结合上下文。", "选择答案。"],
                  knowledgePoint: "试卷式完形"
                }
              ]
            },
            {
              title: "三、单项选择题",
              items: Array.from({ length: 4 }).map((_, index) => ({
                itemType: "choice",
                prompt: index === 0 ? "短文语法填空：Which word is correct?" : `Choose the best answer ${index + 1}.`,
                options: ["A. in", "B. on", "C. at", "D. to"],
                answer: "B",
                analysisSteps: ["读句子。", "判断搭配。", "选择答案。"],
                knowledgePoint: "介词"
              }))
            },
            {
              title: "四、阅读理解",
              items: Array.from({ length: 4 }).map((_, index) => ({
                itemType: "reading",
                prompt: `What does Amy do on special days? ${index + 1}`,
                options: ["A. Study and share.", "B. Sleep.", "C. Run home.", "D. Watch TV."],
                answer: "A",
                passageGroupId: "quiz-reading",
                passageTitle: "A Short Passage",
                passageText: "Amy has many special days at school. She writes the dates on her class calendar. She studies, plays, helps classmates and shares her work with friends.",
                passageQuestionIndex: index + 1,
                showPassage: index === 0,
                analysisSteps: ["读短文。", "定位信息。", "选择答案。"],
                knowledgePoint: "阅读理解"
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

  const repairedText = result.draftItems
    .map((item) => `${item.prompt || ""} ${item.passageTitle || ""}`)
    .join(" ");
  const auditIssues = result.generationPipeline.audit.issues.join(" ");
  const repairNotes = result.generationPipeline.repair.repairNotes.join(" ");

  assert.equal(/文章选词填空|完形填空|短文语法填空/.test(repairedText), false);
  assert.equal(result.generationPipeline.audit.passed, true);
  assert.equal(/文章选词填空|完形填空|短文语法填空/.test(auditIssues), false);
  assert.match(repairNotes, /英语小测\/练习中的试卷式题组/);
});

test("draftAssessmentService does not pad Chinese exam reading passages with repeated guidance", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "语文",
      kind: "试卷",
      grade: "六年级",
      requirement: "生成一份含现代文阅读、文言文阅读和写作的试卷"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: false,
        providerId: "fake-unavailable",
        draftText: "",
        modelRun: {
          provider: "fake",
          model: "fake-assessment",
          skill: "assessment-draft",
          status: "UNAVAILABLE",
          metadata: { attempts: [] }
        }
      })
    }
  );

  const modernReading = result.draftItems.find((item) => item.metadata?.passageGroupId === "chinese-modern-reading");
  const passageText = modernReading?.metadata?.passageText || "";
  const passageChars = passageText.replace(/[^\u4e00-\u9fa5]/g, "").length;
  const guidanceCount = (passageText.match(/老师在讲评时提醒大家/g) || []).length;

  assert.equal(result.usedDynamicFallback, true);
  assert.ok(passageChars >= 850);
  assert.ok(guidanceCount <= 1);
});
