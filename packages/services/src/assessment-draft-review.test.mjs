import assert from "node:assert/strict";
import test from "node:test";
import { buildAssessmentBlueprintCheck, draftAssessmentService } from "./index.js";

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

function weatherQuizDraftText({ includeOnlyOneItem = false } = {}) {
  const passage = [
    "On Monday morning, Lily checks the weather report before school. The sky is cloudy and the wind is cool, so she takes a light coat.",
    "At noon, the sun comes out and the playground becomes warm. Lily and her classmates record the temperature and draw weather symbols in their science notebooks.",
    "After lunch, dark clouds move over the school. Their teacher asks everyone to close the windows before a short rain shower begins.",
    "By three o'clock, the rain stops. The children compare the morning, noon and afternoon weather and learn that conditions can change during one day.",
    "Lily writes that checking the forecast helps people choose suitable clothes and plan outdoor activities safely. She also notes that a forecast is useful, but people should still observe the sky around them."
  ].join(" ");
  const sections = [
    {
      title: "一、词汇与短语",
      type: "fill",
      items: [
        ["根据中文写英文单词：多云的。", "cloudy"],
        ["根据中文写英文单词：下雨的。", "rainy"],
        ["根据中文写英文短语：天气预报。", "weather report"],
        ["根据中文写英文短语：穿上外套。", "put on a coat"]
      ].map(([prompt, answer]) => ({
        itemType: "fill",
        prompt,
        answer,
        answerFormat: "english-four-line",
        analysisSteps: ["识别天气主题词汇。", "核对英文拼写。", `答案为 ${answer}。`],
        commonMistake: "注意拼写完整。",
        knowledgePoint: "Unit 3 Weather"
      }))
    },
    {
      title: "二、句子运用",
      type: "solution",
      items: [
        ["用 cloudy 造一个描述天气的句子。", "It is cloudy today."],
        ["把句子翻译成英文：今天很冷，请穿上外套。", "It is cold today. Please put on your coat."]
      ].map(([prompt, answer]) => ({
        itemType: "solution",
        prompt,
        answer,
        answerFormat: "english-four-line",
        analysisSteps: ["确定天气表达。", "使用正确的主谓结构。", "检查大小写和标点。"],
        commonMistake: "不要漏写 be 动词。",
        knowledgePoint: "Unit 3 Weather"
      }))
    },
    {
      title: "三、单项选择题",
      type: "choice",
      items: [
        {
          itemType: "choice",
          prompt: "It is cold outside. You should ______ your coat.",
          options: ["A. put on", "B. take off", "C. look at", "D. listen to"],
          answer: "A",
          analysisSteps: ["根据 cold 判断需要保暖。", "put on 表示穿上。", "因此选择 A。"],
          commonMistake: "不要混淆 put on 和 take off。",
          knowledgePoint: "Unit 3 Weather"
        },
        {
          itemType: "choice",
          prompt: "- What's the weather like? - ______",
          options: ["A. It's rainy.", "B. It's Monday.", "C. I'm ten.", "D. At school."],
          answer: "A",
          analysisSteps: ["题干询问天气。", "回答使用 It's + 天气形容词。", "因此选择 A。"],
          commonMistake: "不要回答日期或地点。",
          knowledgePoint: "Unit 3 Weather"
        }
      ]
    },
    {
      title: "四、阅读理解",
      type: "reading",
      items: [
        ["According to the passage, what is the weather like on Monday morning?", "It is cloudy and cool."],
        ["Why does Lily take a light coat?", "Because the wind is cool."],
        ["What is the main idea of the passage?", "Weather can change, so observing it helps people plan safely."],
        ["What can we learn from Lily's weather record?", "We should use forecasts and observe real conditions."]
      ].map(([prompt, answer], index) => ({
        itemType: "reading",
        prompt,
        answer,
        passageGroupId: "unit-3-weather-reading",
        passageTitle: "A Changing Weather Day",
        passageText: passage,
        passageQuestionIndex: index + 1,
        showPassage: index === 0,
        analysisSteps: ["先阅读天气变化顺序。", "回到原文定位依据。", "用完整句回答。"],
        commonMistake: "不要脱离短文猜测。",
        knowledgePoint: "Unit 3 Weather"
      }))
    }
  ];
  if (includeOnlyOneItem) {
    sections.splice(1);
    sections[0].items = sections[0].items.slice(0, 1);
  }
  return JSON.stringify({ title: "四年级英语 Unit 3 Weather 小测", sections });
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

test("draftAssessmentService treats partial GPT-5.6 partition output as dynamic repair", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "四年级",
      requirement: "Unit 3 Weather",
      requestedItemCount: 12,
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        ...fakeAssessmentResult(),
        providerId: "gpt56",
        draftText: weatherQuizDraftText(),
        modelRun: {
          provider: "gpt56",
          model: "gpt-5.6",
          skill: "assessment-draft",
          status: "SUCCESS",
          metadata: { attempts: [], partialGeneration: true }
        }
      })
    }
  );

  assert.equal(result.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.repair.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.audit.status, "needs_teacher_review");
});

test("draftAssessmentService reports successful Sol escalation separately from dynamic repair", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "四年级",
      requirement: "Unit 3 Weather",
      requestedItemCount: 12,
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        ...fakeAssessmentResult(),
        providerId: "gpt56",
        draftText: weatherQuizDraftText(),
        modelRun: {
          provider: "gpt56",
          model: "gpt-5.6-sol",
          skill: "assessment-draft",
          status: "SUCCESS",
          metadata: {
            attempts: [
              { role: "primary", model: "gpt-5.6", status: "ERROR" },
              { role: "escalation", model: "gpt-5.6-sol", status: "SUCCESS" }
            ],
            primaryModel: "gpt-5.6",
            escalationModel: "gpt-5.6-sol",
            escalationTriggered: true,
            usedModelEscalation: true,
            escalationScopes: ["quiz-core"],
            partialGeneration: false
          }
        }
      })
    }
  );

  assert.equal(result.usedModelEscalation, true);
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.generationPipeline.model.escalationModel, "gpt-5.6-sol");
  assert.equal(result.generationPipeline.model.usedModelEscalation, true);
  assert.equal(result.generationPipeline.repair.usedDynamicFallback, false);
});

test("draftAssessmentService uses final validation state after an unusable Sol response", async () => {
  const result = await draftAssessmentService(
    {},
    { subject: "英语", kind: "小测", grade: "五年级", requirement: "Unit 4" },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: true,
        providerId: "gpt56",
        draftText: "{}",
        modelRun: {
          provider: "gpt56",
          model: "gpt-5.6",
          skill: "assessment-draft",
          status: "SUCCESS",
          metadata: {
            attempts: [
              { role: "primary", model: "gpt-5.6", status: "ERROR" },
              { role: "escalation", model: "gpt-5.6-sol", status: "SUCCESS" }
            ],
            escalationModel: "gpt-5.6-sol",
            escalationTriggered: true,
            usedModelEscalation: false,
            partialGeneration: true
          }
        }
      })
    }
  );

  assert.equal(result.usedModelEscalation, false);
  assert.equal(result.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.model.usedModelEscalation, false);
  assert.equal(result.generationPipeline.repair.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.audit.status, "needs_teacher_review");
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

test("draftAssessmentService uses one GPT-5.6 review outside the injected legacy double-review path", async () => {
  let premiumCalls = 0;
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
        premium: async () => {
          premiumCalls += 1;
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
            modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
          };
        }
      }
    }
  );

  assert.equal(premiumCalls, 1);
  assert.equal(result.generationPipeline.modelReview.status, "passed");
  assert.equal(result.modelReviews.minimax, undefined);
  assert.equal(result.modelReviews.premium.label, "GPT-5.6 生成风险审查");
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
  assert.equal(runnerInput.assessmentTotalTimeoutMs, 120000);
  assert.equal(runnerInput.assessmentMaxTokens, 16000);
  assert.equal(runnerInput.generationContext.output.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.generationProfile, "quiz-standard");
  assert.equal(result.generationPipeline.model.assessmentMaxTokens, 16000);
});

test("draftAssessmentService forwards the authoritative textbook baseline in generationContext", async () => {
  let runnerInput = null;
  await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      requirement: "Unit 3 Weather",
      textbookAssetId: "tb-pep-5b",
      textbookTitle: "义务教育教科书·英语（三年级起点）五年级下册",
      textbookEdition: "人教版",
      textbookSeries: "PEP",
      textbookVolume: "下册",
      textbookRegion: "贵州遵义",
      textbookChapterId: "unit-3",
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return fakeAssessmentResult();
      }
    }
  );

  assert.deepEqual(runnerInput.generationContext.teaching.textbook, {
    assetId: "tb-pep-5b",
    title: "义务教育教科书·英语（三年级起点）五年级下册",
    edition: "人教版",
    series: "PEP",
    volume: "下册",
    region: "贵州遵义",
    chapterId: "unit-3",
    chapterTitle: "Unit 3 Weather"
  });
});

test("draftAssessmentService keeps teacher-requirement emergency quizzes free of textbook claims", async () => {
  let runnerInput = null;
  await draftAssessmentService(
    {},
    {
      subject: "数学",
      kind: "小测",
      grade: "五年级",
      requirement: "围绕小数乘法，重点检查竖式和小数点位置。",
      generationBasis: "teacher_requirement_emergency",
      recoveryReason: "APPROVED_CONTENT_CONTEXT_NOT_FOUND",
      contentContext: {
        available: false,
        approvedOnly: false,
        approvedSourceCount: 0,
        matchedCount: 0,
        reason: "TEACHER_REQUIREMENT_EMERGENCY",
        matches: []
      }
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return fakeAssessmentResult();
      }
    }
  );

  assert.equal(runnerInput.generationContext.rules.teacherRequirementEmergency, true);
  assert.equal(runnerInput.generationContext.teaching.textbook.assetId, null);
  assert.equal(runnerInput.generationContext.teaching.contentContext.reason, "TEACHER_REQUIREMENT_EMERGENCY");
  assert.equal(runnerInput.generationContext.request.recoveryReason, "APPROVED_CONTENT_CONTEXT_NOT_FOUND");
});

test("assessment blueprint scales an English quiz to the requested item count", () => {
  const result = buildAssessmentBlueprintCheck({
    subject: "英语",
    kind: "小测",
    grade: "四年级",
    requestedItemCount: 12,
    textbookChapterTitle: "Unit 3 Weather"
  });

  assert.equal(result.blueprint.minItems, 12);
  assert.equal(result.blueprint.maxItems, 12);
  assert.equal(result.blueprint.sections.reduce((sum, section) => sum + section.target, 0), 12);
  assert.equal(result.itemCount, 12);
});

test("draftAssessmentService keeps complete Weather model content and the requested 12 items", async () => {
  let runnerInput = null;
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "四年级",
      requirement: "生成 Unit 3 Weather 英语小测。",
      requestedItemCount: 12,
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      persist: false,
      assessmentDraftRunner: async (_config, input) => {
        runnerInput = input;
        return {
          ...fakeAssessmentResult(),
          draftText: weatherQuizDraftText()
        };
      }
    }
  );

  const content = result.draftItems.map((item) => [
    item.prompt,
    item.metadata?.passageTitle,
    item.metadata?.passageText,
    item.metadata?.knowledgePoint
  ].filter(Boolean).join(" ")).join("\n");

  assert.equal(runnerInput.requestedItemCount, 12);
  assert.equal(runnerInput.generationContext.output.requestedItemCount, 12);
  assert.equal(runnerInput.generationContext.teaching.textbookChapterTitle, "Unit 3 Weather");
  assert.equal(result.draftItems.length, 12);
  assert.match(content, /Weather|weather|cloudy|rainy/);
  assert.doesNotMatch(content, /Special Days|art show|sports meet|school trip|April|third|fourth|fifth/i);
  assert.equal(result.usedDynamicFallback, false);
});

test("draftAssessmentService marks service-side item repair as dynamic fallback", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "四年级",
      requirement: "生成 Unit 3 Weather 英语小测。",
      requestedItemCount: 12,
      textbookChapterTitle: "Unit 3 Weather"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        ...fakeAssessmentResult(),
        draftText: weatherQuizDraftText({ includeOnlyOneItem: true })
      })
    }
  );

  assert.equal(result.draftItems.length, 12);
  assert.equal(result.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.repair.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.audit.status, "needs_teacher_review");
  assert.ok(result.audit.repairNotes.some((note) => /补足|替换/.test(note)));
  const weatherPassage = result.draftItems.find((item) => item.itemType === "reading" && item.metadata?.showPassage)?.metadata?.passageText || "";
  assert.match(weatherPassage, /forecast|temperature|clouds|rain/i);
  assert.doesNotMatch(weatherPassage, /make the story sound perfect|facts, feelings and actions/i);
});

test("draftAssessmentService fallback English unit quiz reserves enough reading content for two-page layout", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "小测",
      grade: "五年级",
      requirement: "五年级下册第四单元英语小测，包含中英文互译、写单词、造句、选择和阅读。"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: false,
        providerId: "fake",
        draftText: "",
        modelRun: {
          provider: "fake",
          model: "fake-assessment",
          skill: "assessment-draft",
          status: "FAILED",
          metadata: { attempts: [] }
        }
      })
    }
  );

  const readingItems = result.draftItems.filter((item) => item.itemType === "reading");
  const visiblePassage = readingItems.find((item) => item.metadata?.showPassage);

  assert.equal(result.usedDynamicFallback, true);
  assert.ok(readingItems.length >= 6);
  assert.ok(String(visiblePassage?.metadata?.passageText || "").length >= 900);
});

test("draftAssessmentService fallback English practice keeps enough reading work instead of sparse second page", async () => {
  const result = await draftAssessmentService(
    {},
    {
      subject: "英语",
      kind: "练习",
      grade: "五年级",
      requirement: "针对 Unit 4 词汇、句型表达和阅读薄弱点生成英语练习。"
    },
    {
      persist: false,
      assessmentDraftRunner: async () => ({
        available: false,
        providerId: "fake",
        draftText: "",
        modelRun: {
          provider: "fake",
          model: "fake-assessment",
          skill: "assessment-draft",
          status: "FAILED",
          metadata: { attempts: [] }
        }
      })
    }
  );

  const readingItems = result.draftItems.filter((item) => item.itemType === "reading");
  const visiblePassage = readingItems.find((item) => item.metadata?.showPassage);

  assert.equal(result.usedDynamicFallback, true);
  assert.ok(readingItems.length >= 4);
  assert.ok(String(visiblePassage?.metadata?.passageText || "").length >= 650);
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
      { profile: "practice-standard", timeout: 150000, maxTokens: 16000 }
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
  assert.equal(runnerInputs[0].assessmentTotalTimeoutMs, 240000);
  assert.equal(runnerInputs[0].assessmentMaxTokens, 24000);
  assert.equal(runnerInputs[1].generationProfile, "formal-full");
  assert.equal(runnerInputs[1].assessmentTotalTimeoutMs, 240000);
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
  assert.equal(result.usedDynamicFallback, true);
  assert.equal(result.generationPipeline.audit.passed, false);
  assert.equal(result.generationPipeline.audit.status, "needs_teacher_review");
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
