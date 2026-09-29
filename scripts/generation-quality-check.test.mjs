import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationQualityCases,
  buildGenerationQualityVerification,
  evaluateGenerationQualityResult
} from "./generation-quality-check.mjs";

test("focused and explanation acceptance follows requested purpose rather than a full exam blueprint", () => {
  const sample = { name: "focused", purpose: "focused", subject: "数学", kind: "练习", requestedItemCount: 1,
    requestedItemTypes: ["calculation"], generationProfile: "quiz-standard" };
  const result = { modelAvailable: true, usedDynamicFallback: false, draftAvailable: true, totalScore: 5, audit: { status: "passed" },
    generationPipeline: { model: { generationProfile: "quiz-standard" } }, draftItems: [
      { itemType: "calculation", prompt: "1+1", answer: "2", score: 5, analysisSteps: ["1加1得2"], knowledgePoint: "加法", commonMistake: "别减", rubric: "结果正确5分" }
    ] };
  assert.equal(evaluateGenerationQualityResult(sample, result).ok, true);
  const conflict = structuredClone(result);
  conflict.draftItems[0].rubric = "本题满分6分。";
  assert.ok(evaluateGenerationQualityResult(sample, conflict).detail.issues.includes("题干标注或评分细则与逐题分值冲突。"));
  assert.equal(evaluateGenerationQualityResult({ ...sample, requestedItemCount: 2 }, result).ok, false);
  const e = { ...result, draftItems: [], parsedDraft: { explanation: { concept: "加法", steps: ["合起来"], workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: ["合并两组"] }], commonMistakes: ["不要减"] } } };
  assert.equal(evaluateGenerationQualityResult({ ...sample, purpose: "explanation" }, e).ok, true);
  e.parsedDraft.explanation.workedExamples[0].analysisSteps = [];
  assert.equal(evaluateGenerationQualityResult({ ...sample, purpose: "explanation" }, e).ok, false);
});

test("quiz quality samples use expanded budget for three subject quizzes", () => {
  const cases = buildGenerationQualityCases("quiz");

  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((item) => `${item.subject}-${item.kind}`), [
    "数学-小测",
    "语文-小测",
    "英语-小测"
  ]);
  assert.equal(cases.every((item) => item.generationProfile === "quiz-standard"), true);
  assert.equal(cases.every((item) => item.assessmentTotalTimeoutMs === 120000), true);
  assert.equal(cases.every((item) => item.assessmentMaxTokens === 16000), true);
});

test("choice placeholders are rejected even when a historical audit claimed success", () => {
  const sample = { purpose: "focused", subject: "数学", kind: "练习", requestedItemCount: 1,
    requestedItemTypes: ["choice"], generationProfile: "quiz-standard" };
  const result = { modelAvailable: true, usedDynamicFallback: false, draftAvailable: true, totalScore: 2,
    audit: { status: "passed" }, generationPipeline: { model: { generationProfile: "quiz-standard" } },
    draftItems: [{ itemType: "choice", prompt: "1+1=（ ）", answer: "A", rubric: "选A得2分。",
      metadata: { score: 2, options: ["A. 2", "B. 3"], analysisSteps: ["1加1等于2。"], knowledgePoint: "加法", commonMistake: "不要相乘。" } }] };
  assert.equal(evaluateGenerationQualityResult(sample, result).ok, true);
  result.draftItems[0].metadata.options = ["[object Object]", "[object Object]"];
  const check = evaluateGenerationQualityResult(sample, result);
  assert.equal(check.ok, false);
  assert.ok(check.detail.issues.includes("选择题选项缺失或格式无效。"));
});

test("formal quality samples use formal budget for exams and personalized practice", () => {
  const cases = buildGenerationQualityCases("formal");

  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((item) => item.name), [
    "数学-小升初正式试卷",
    "英语-个性化练习",
    "语文-阅读表达练习"
  ]);
  assert.equal(cases.every((item) => item.generationProfile === "formal-full"), true);
  assert.equal(cases.every((item) => item.assessmentMaxTokens === 24000), true);
  assert.equal(cases[0].assessmentTotalTimeoutMs, 240000);
  assert.equal(cases[1].assessmentTotalTimeoutMs, 240000);
  assert.equal(cases[2].assessmentTotalTimeoutMs, 240000);
});

test("generation quality verification rejects dynamic fallback samples", () => {
  const [sample] = buildGenerationQualityCases("quiz");
  const check = evaluateGenerationQualityResult(sample, {
    modelAvailable: false,
    draftAvailable: true,
    usedDynamicFallback: true,
    totalScore: 60,
    audit: { status: "passed", itemCount: 12, issues: [] },
    generationPipeline: {
      model: {
        generationProfile: "quiz-standard",
        assessmentTotalTimeoutMs: 60000,
        assessmentMaxTokens: 12000,
        primaryError: "MODEL_TIMEOUT after 60000ms",
        attempts: [
          {
            role: "primary",
            providerId: "gpt56",
            model: "gpt-5.6",
            status: "ERROR",
            latencyMs: 60000,
            error: "MODEL_TIMEOUT after 60000ms"
          }
        ]
      },
      repair: { itemCount: 12, totalScore: 60 }
    },
    parsedDraft: {
      sections: [
        {
          title: "一、填空",
          items: [
            { itemType: "fill", prompt: "填空题", answer: "答案", analysisSteps: ["解析"], knowledgePoint: "考点" }
          ]
        }
      ]
    }
  });

  assert.equal(check.ok, false);
  assert.ok(check.detail.issues.includes("质量样本必须来自真实模型生成，不能使用动态兜底。"));
  assert.equal(check.detail.issues.some((issue) => issue.includes("数学质量样本必须包含")), false);
  assert.equal(check.detail.primaryError, "MODEL_TIMEOUT after 60000ms");
  assert.equal(check.detail.attempts.length, 1);
  assert.equal(check.detail.attempts[0].providerId, "gpt56");
});

test("generation quality verification rejects a missing generation profile", () => {
  const sample = buildGenerationQualityCases("quiz")[0];
  const check = evaluateGenerationQualityResult(sample, {
    modelAvailable: true,
    draftAvailable: true,
    usedDynamicFallback: false,
    totalScore: 60,
    audit: { status: "passed", itemCount: 8, issues: [] },
    generationPipeline: {
      model: { assessmentTotalTimeoutMs: 120000, assessmentMaxTokens: 16000 },
      repair: { itemCount: 8, totalScore: 60 }
    },
    draftItems: []
  });

  assert.equal(check.ok, false);
  assert.ok(check.detail.issues.some((issue) => issue.includes("生成 profile 应为 quiz-standard")));
});

test("english quiz quality sample rejects full exam writing patterns", () => {
  const sample = buildGenerationQualityCases("quiz").find((item) => item.subject === "英语");
  const check = evaluateGenerationQualityResult(sample, {
    modelAvailable: true,
    draftAvailable: true,
    usedDynamicFallback: false,
    totalScore: 60,
    audit: { status: "passed", itemCount: 8, issues: [] },
    generationPipeline: {
      model: {
        generationProfile: "quiz-standard",
        assessmentTotalTimeoutMs: 210000,
        assessmentMaxTokens: 20000
      },
      repair: { itemCount: 8, totalScore: 60 }
    },
    parsedDraft: {
      sections: [
        {
          title: "一、写作",
          items: [
            { itemType: "writing", prompt: "Write a passage.", answer: "略", analysisSteps: ["看主题"], knowledgePoint: "写作" },
            { itemType: "choice", prompt: "Choose.", answer: "A", analysisSteps: ["排除"], knowledgePoint: "语法" }
          ]
        }
      ]
    }
  });

  assert.equal(check.ok, false);
  assert.ok(check.detail.issues.includes("英语小测质量样本不得出现写作题。"));
});

test("generation quality verification evaluates repaired draft items", () => {
  const sample = buildGenerationQualityCases("formal").find((item) => item.name === "语文-阅读表达练习");
  const readingItems = Array.from({ length: 4 }, (_, index) => ({
    itemType: "reading",
    prompt: `阅读理解第 ${index + 1} 题`,
    answer: "参考答案",
    metadata: {
      sectionTitle: "三、阅读理解",
      knowledgePoint: "阅读理解",
      commonMistake: "答题要回到原文找依据。",
      passageText: "这是一段服务层修复后的完整现代文阅读材料。",
      analysisSteps: ["阅读全文。", "定位依据。", "组织答案。"]
    }
  }));
  const fillItems = Array.from({ length: 4 }, (_, index) => ({
    itemType: "fill",
    prompt: `基础填空第 ${index + 1} 题`,
    answer: "参考答案",
    metadata: {
      sectionTitle: "一、基础知识",
      knowledgePoint: "基础知识",
      commonMistake: "注意结合语境判断。",
      analysisSteps: ["审清题意。", "联系知识点。", "写出答案。"]
    }
  }));

  const check = evaluateGenerationQualityResult(sample, {
    modelAvailable: true,
    draftAvailable: true,
    usedDynamicFallback: false,
    totalScore: 60,
    audit: { status: "passed", itemCount: 8, issues: [] },
    generationPipeline: {
      model: {
        generationProfile: "formal-full",
        assessmentTotalTimeoutMs: 270000,
        assessmentMaxTokens: 24000
      },
      repair: { itemCount: 8, totalScore: 60 }
    },
    parsedDraft: { sections: [] },
    draftItems: [...fillItems, ...readingItems]
  });

  assert.equal(check.ok, true);
  assert.ok(check.detail.itemTypes.includes("reading"));
});

test("generation quality verification accepts a valid Sol escalation sample", () => {
  const sample = buildGenerationQualityCases("formal").find((item) => item.name === "语文-阅读表达练习");
  const items = [
    ...Array.from({ length: 4 }, (_, index) => ({
      itemType: "fill",
      prompt: `基础填空第 ${index + 1} 题`,
      answer: "参考答案",
      analysisSteps: ["审清题意。"],
      knowledgePoint: "基础知识"
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      itemType: "reading",
      prompt: `阅读理解第 ${index + 1} 题`,
      answer: "参考答案",
      analysisSteps: ["定位原文依据。"],
      knowledgePoint: "阅读理解"
    }))
  ];
  const check = evaluateGenerationQualityResult(sample, {
    modelAvailable: true,
    draftAvailable: true,
    usedModelEscalation: true,
    usedDynamicFallback: false,
    totalScore: 60,
    audit: { status: "passed", itemCount: 8, issues: [] },
    generationPipeline: {
      model: {
        model: "gpt-5.6-sol",
        escalationModel: "gpt-5.6-sol",
        usedModelEscalation: true,
        generationProfile: "formal-full",
        assessmentTotalTimeoutMs: 240000,
        assessmentMaxTokens: 24000
      },
      repair: { usedDynamicFallback: false, itemCount: 8, totalScore: 60 },
      audit: { status: "passed" }
    },
    parsedDraft: { sections: [{ title: "阅读与基础", items }] }
  });

  assert.equal(check.ok, true);
  assert.equal(check.detail.usedModelEscalation, true);
});

test("focused quality checks service metadata scores and still reject missing or inconsistent scores", () => {
  const sample = { purpose: "focused", subject: "数学", kind: "练习", requestedItemTypes: ["calculation"], requestedItemCount: 1, generationProfile: "quiz-standard" };
  const result = { modelAvailable: true, draftAvailable: true, usedDynamicFallback: false, totalScore: 5,
    audit: { status: "passed" }, generationPipeline: { model: { generationProfile: "quiz-standard" } },
    draftItems: [{ itemType: "calculation", prompt: "24+18", answer: "42", rubric: "按过程评分",
      metadata: { score: 5, analysisSteps: ["24+10+8=42"], knowledgePoint: "加法", commonMistake: "注意进位" } }] };
  assert.equal(evaluateGenerationQualityResult(sample, result).ok, true);
  for (const score of [undefined, 4]) {
    const changed = structuredClone(result);
    changed.draftItems[0].metadata.score = score;
    assert.ok(evaluateGenerationQualityResult(sample, changed).detail.issues.includes("逐题分值与总分不一致。"));
  }
});

test("generation quality verification metadata is separate from link guard e2e", () => {
  assert.deepEqual(buildGenerationQualityVerification("quiz"), {
    verificationScope: "generation-quality-sample",
    budgetTier: "medium",
    assessesGenerationQuality: true,
    assessesPdfLayout: false,
    rejectsDynamicFallback: true,
    expectedProfiles: ["quiz-standard"],
    qualityBoundary: "This check samples real model draft quality only; it does not prove the full content-context E2E or PDF visual layout."
  });
});
