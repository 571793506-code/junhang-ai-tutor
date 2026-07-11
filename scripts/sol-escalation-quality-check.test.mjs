import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolExecutionOptions,
  buildSolQualityCases,
  runSolQualityCheck
} from "./sol-escalation-quality-check.mjs";
import { buildGenerationQualityCases } from "./generation-quality-check.mjs";

function validMathQuizResult(overrides = {}) {
  const items = [
    ...Array.from({ length: 4 }, (_, index) => ({
      itemType: "calculation",
      prompt: `计算题 ${index + 1}`,
      answer: "12",
      analysisSteps: ["列式计算。"],
      knowledgePoint: "小数乘法"
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      itemType: "solution",
      prompt: `解答题 ${index + 1}`,
      answer: "答：12。",
      analysisSteps: ["分析数量关系。"],
      commonMistake: "不要漏写单位。"
    }))
  ];
  return {
    modelAvailable: true,
    draftAvailable: true,
    usedModelEscalation: false,
    usedDynamicFallback: false,
    totalScore: 60,
    audit: { status: "passed", itemCount: 8, issues: [] },
    generationPipeline: {
      model: {
        model: "gpt-5.6-sol",
        generationProfile: "quiz-standard",
        assessmentTotalTimeoutMs: 120000,
        assessmentMaxTokens: 16000,
        attempts: [{ role: "sol-quality-check", reasoningEffort: "high", latencyMs: 37 }]
      },
      repair: { usedDynamicFallback: false, itemCount: 8, totalScore: 60 },
      audit: { status: "passed", passed: true }
    },
    parsedDraft: { sections: [{ title: "计算与解答", items }] },
    ...overrides
  };
}

test("Sol quality check reuses all six project generation cases", () => {
  const expected = [
    ...buildGenerationQualityCases("quiz"),
    ...buildGenerationQualityCases("formal")
  ];

  assert.deepEqual(buildSolQualityCases(), expected);
  assert.deepEqual(buildSolQualityCases().map((item) => item.name), [
    "数学-小测",
    "语文-小测",
    "英语-小测",
    "数学-小升初正式试卷",
    "英语-个性化练习",
    "语文-阅读表达练习"
  ]);
});

test("Sol quality check fixes the internal execution role and effort", () => {
  assert.deepEqual(buildSolExecutionOptions(), {
    role: "sol-quality-check",
    reasoningEffort: "high",
    disableSolEscalation: true
  });
});

test("Sol quality check injects forced Sol only through the internal draft runner", async () => {
  const [sample] = buildSolQualityCases();
  let capturedInput = null;
  let capturedConfig = null;
  let capturedExecution = null;
  const fakeDraftAssessment = async (config, _input, execution) => {
    capturedConfig = config;
    capturedExecution = execution;
    return { available: true };
  };
  const fakeDraftAssessmentService = async (config, input, options) => {
    capturedInput = input;
    await options.assessmentDraftRunner(config, input);
    return validMathQuizResult();
  };

  const summary = await runSolQualityCheck({
    GPT56_API_KEY: "synthetic-key",
    GPT56_REASONING_EFFORT_ENABLED: "false",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000"
  }, {
    cases: [sample],
    draftAssessmentImpl: fakeDraftAssessment,
    draftAssessmentServiceImpl: fakeDraftAssessmentService
  });

  assert.equal(capturedInput.model, undefined);
  assert.equal(capturedInput.reasoningEffort, undefined);
  assert.equal(capturedInput.role, undefined);
  assert.equal(capturedConfig.GPT56_API_KEY, "synthetic-key");
  assert.equal(capturedConfig.GPT56_REASONING_EFFORT_ENABLED, "true");
  assert.deepEqual(capturedExecution, {
    role: "sol-quality-check",
    reasoningEffort: "high",
    disableSolEscalation: true,
    model: "gpt-5.6-sol",
    timeoutMs: 180000
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.status, "passed");
  assert.equal(summary.verification.mode, "forced-sol-primary");
  assert.equal(summary.checks[0].case, "数学-小测");
  assert.equal(summary.checks[0].status, "passed");
  assert.equal(summary.checks[0].model, "gpt-5.6-sol");
  assert.equal(summary.checks[0].effort, "high");
  assert.equal(summary.checks[0].role, "sol-quality-check");
  assert.equal(summary.checks[0].usedModelEscalation, false);
  assert.equal(summary.checks[0].usedDynamicFallback, false);
  assert.deepEqual(summary.checks[0].issues, []);
  assert.equal(Number.isFinite(summary.checks[0].latencyMs), true);
});

test("Sol quality check rejects a local dynamic fallback result", async () => {
  const [sample] = buildSolQualityCases();
  const summary = await runSolQualityCheck({}, {
    cases: [sample],
    draftAssessmentImpl: async () => ({ available: false }),
    draftAssessmentServiceImpl: async (config, input, options) => {
      await options.assessmentDraftRunner(config, input);
      return validMathQuizResult({
        modelAvailable: false,
        usedDynamicFallback: true,
        generationPipeline: {
          model: { model: "gpt-5.6-sol", generationProfile: "quiz-standard" },
          repair: { usedDynamicFallback: true, itemCount: 8, totalScore: 60 },
          audit: { status: "needs_teacher_review", passed: false }
        }
      });
    }
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.status, "failed");
  assert.equal(summary.checks[0].status, "failed");
  assert.equal(summary.checks[0].usedDynamicFallback, true);
  assert.ok(summary.checks[0].issues.includes("质量样本必须来自真实模型生成，不能使用动态兜底。"));
});

test("Sol quality check requires an explicit passed project audit", async () => {
  const [sample] = buildSolQualityCases();
  const resultWithoutAudit = validMathQuizResult();
  delete resultWithoutAudit.audit;
  delete resultWithoutAudit.generationPipeline.audit;
  const summary = await runSolQualityCheck({}, {
    cases: [sample],
    draftAssessmentImpl: async () => ({ available: true }),
    draftAssessmentServiceImpl: async (config, input, options) => {
      await options.assessmentDraftRunner(config, input);
      return resultWithoutAudit;
    }
  });

  assert.equal(summary.ok, false);
  assert.ok(summary.checks[0].issues.includes("服务层本地审查未通过。"));
});

test("Sol quality check rejects missing availability and fallback flags", async () => {
  const [sample] = buildSolQualityCases();
  const resultWithoutFlags = validMathQuizResult();
  delete resultWithoutFlags.modelAvailable;
  delete resultWithoutFlags.usedDynamicFallback;
  const summary = await runSolQualityCheck({}, {
    cases: [sample],
    draftAssessmentImpl: async () => ({ available: true }),
    draftAssessmentServiceImpl: async (config, input, options) => {
      await options.assessmentDraftRunner(config, input);
      return resultWithoutFlags;
    }
  });

  assert.equal(summary.ok, false);
  assert.ok(summary.checks[0].issues.includes("质量样本必须来自可用模型。"));
  assert.ok(summary.checks[0].issues.includes("质量样本必须来自真实模型生成，不能使用动态兜底。"));
});

for (const diagnosticCase of [
  {
    name: "non-Sol actual model",
    mutate(result) {
      result.generationPipeline.model.model = "gpt-5.6-terra";
    },
    expectedIssue: "实际模型不是 Sol。",
    expectedModel: "gpt-5.6-terra",
    expectedEffort: "high"
  },
  {
    name: "non-high actual reasoning effort",
    mutate(result) {
      result.generationPipeline.model.attempts[0].reasoningEffort = "medium";
    },
    expectedIssue: "实际推理档位不是 high。",
    expectedModel: "gpt-5.6-sol",
    expectedEffort: "medium"
  },
  {
    name: "missing actual model and effort diagnostics",
    mutate(result) {
      delete result.generationPipeline.model.model;
      result.generationPipeline.model.attempts = [];
    },
    expectedIssue: "缺少实际模型或推理档位诊断。",
    expectedModel: null,
    expectedEffort: null
  }
]) {
  test(`Sol quality check rejects ${diagnosticCase.name}`, async () => {
    const [sample] = buildSolQualityCases();
    const result = validMathQuizResult();
    diagnosticCase.mutate(result);
    const summary = await runSolQualityCheck({}, {
      cases: [sample],
      draftAssessmentImpl: async () => ({ available: true }),
      draftAssessmentServiceImpl: async (config, input, options) => {
        await options.assessmentDraftRunner(config, input);
        return result;
      }
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.status, "failed");
    assert.equal(summary.checks[0].ok, false);
    assert.equal(summary.checks[0].status, "failed");
    assert.equal(summary.checks[0].model, diagnosticCase.expectedModel);
    assert.equal(summary.checks[0].effort, diagnosticCase.expectedEffort);
    assert.ok(summary.checks[0].issues.includes(diagnosticCase.expectedIssue));
  });
}
