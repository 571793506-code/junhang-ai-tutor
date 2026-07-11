import path from "node:path";
import { pathToFileURL } from "node:url";
import { draftAssessment, normalizeRuntimeConfig } from "@junhang/ai";
import { draftAssessmentService } from "@junhang/services";
import {
  buildGenerationQualityCases,
  evaluateGenerationQualityResult
} from "./generation-quality-check.mjs";

function directRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(path.resolve(argvPath)).href;
}

function progress(message) {
  process.stderr.write(`[sol-generation-quality] ${message}\n`);
}

export function buildSolQualityCases() {
  return [
    ...buildGenerationQualityCases("quiz"),
    ...buildGenerationQualityCases("formal")
  ];
}

export function buildSolExecutionOptions() {
  return {
    role: "sol-quality-check",
    reasoningEffort: "high",
    disableSolEscalation: true
  };
}

export async function runSolQualityCheck(
  config = process.env,
  {
    cases = buildSolQualityCases(),
    draftAssessmentImpl = draftAssessment,
    draftAssessmentServiceImpl = draftAssessmentService,
    now = Date.now
  } = {}
) {
  const startedAt = now();
  const runtime = normalizeRuntimeConfig(config);
  const execution = {
    ...buildSolExecutionOptions(),
    model: runtime.gpt56SolModel,
    timeoutMs: runtime.gpt56SolFallbackTimeoutMs
  };
  const assessmentDraftRunner = (runnerConfig, input) => (
    draftAssessmentImpl({
      ...runnerConfig,
      GPT56_REASONING_EFFORT_ENABLED: "true"
    }, input, execution)
  );
  const checks = [];

  for (const sample of cases) {
    const sampleStartedAt = now();
    progress(`start ${sample.name} (${runtime.gpt56SolModel}, high)`);
    const result = await draftAssessmentServiceImpl(config, sample, {
      persist: false,
      assessmentDraftRunner
    });
    const evaluated = evaluateGenerationQualityResult(sample, result);
    const latencyMs = now() - sampleStartedAt;
    const actualModel = evaluated.detail.model || null;
    const actualEffort = evaluated.detail.reasoningEffort || null;
    const declaredTotalTimeouts = [
      result?.generationPipeline?.model?.assessmentTotalTimeoutMs,
      sample.assessmentTotalTimeoutMs
    ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const declaredTotalTimeoutMs = declaredTotalTimeouts.length
      ? Math.min(...declaredTotalTimeouts)
      : null;
    const diagnosticIssues = [];
    if (!actualModel || !actualEffort) {
      diagnosticIssues.push("缺少实际模型或推理档位诊断。");
    }
    if (actualModel && actualModel !== runtime.gpt56SolModel) {
      diagnosticIssues.push("实际模型不是 Sol。");
    }
    if (actualEffort && actualEffort !== execution.reasoningEffort) {
      diagnosticIssues.push("实际推理档位不是 high。");
    }
    if (declaredTotalTimeoutMs && latencyMs > declaredTotalTimeoutMs) {
      diagnosticIssues.push(`样本耗时 ${latencyMs}ms 超过声明总预算 ${declaredTotalTimeoutMs}ms。`);
    }
    const issues = [...evaluated.detail.issues, ...diagnosticIssues];
    const ok = evaluated.ok && diagnosticIssues.length === 0;
    checks.push({
      case: sample.name,
      model: actualModel,
      effort: actualEffort,
      expectedModel: runtime.gpt56SolModel,
      expectedEffort: execution.reasoningEffort,
      role: execution.role,
      mode: "forced-sol-primary",
      latencyMs,
      ok,
      status: ok ? "passed" : "failed",
      issues,
      usedModelEscalation: result.usedModelEscalation === true,
      usedDynamicFallback: result.usedDynamicFallback === true,
      detail: evaluated.detail
    });
    progress(`${ok ? "pass" : "fail"} ${sample.name}: ${latencyMs}ms`);
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    status: ok ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    durationMs: now() - startedAt,
    verification: {
      scope: "sol-generation-quality",
      mode: "forced-sol-primary",
      role: execution.role,
      model: runtime.gpt56SolModel,
      effort: execution.reasoningEffort,
      timeoutMs: execution.timeoutMs,
      rejectsDynamicFallback: true,
      qualityBoundary: "This command proves forced Sol generation availability and project draft quality gates; it does not prove grading accuracy without teacher gold data."
    },
    checks
  };
}

if (directRun(import.meta.url)) {
  runSolQualityCheck()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
