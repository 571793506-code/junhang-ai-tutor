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
    draftAssessmentServiceImpl = draftAssessmentService
  } = {}
) {
  const startedAt = Date.now();
  const runtime = normalizeRuntimeConfig(config);
  const execution = {
    ...buildSolExecutionOptions(),
    model: runtime.gpt56SolModel,
    timeoutMs: runtime.gpt56SolFallbackTimeoutMs
  };
  const assessmentDraftRunner = (runnerConfig, input) => (
    draftAssessmentImpl(runnerConfig, input, execution)
  );
  const checks = [];

  for (const sample of cases) {
    const sampleStartedAt = Date.now();
    progress(`start ${sample.name} (${runtime.gpt56SolModel}, high)`);
    const result = await draftAssessmentServiceImpl(config, sample, {
      persist: false,
      assessmentDraftRunner
    });
    const evaluated = evaluateGenerationQualityResult(sample, result);
    const latencyMs = Date.now() - sampleStartedAt;
    checks.push({
      case: sample.name,
      model: evaluated.detail.model || runtime.gpt56SolModel,
      effort: evaluated.detail.reasoningEffort || execution.reasoningEffort,
      role: execution.role,
      mode: "forced-sol-primary",
      latencyMs,
      ok: evaluated.ok,
      issues: evaluated.detail.issues,
      usedModelEscalation: result.usedModelEscalation === true,
      usedDynamicFallback: result.usedDynamicFallback === true,
      detail: evaluated.detail
    });
    progress(`${evaluated.ok ? "pass" : "fail"} ${sample.name}: ${latencyMs}ms`);
  }

  return {
    ok: checks.every((check) => check.ok),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
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
