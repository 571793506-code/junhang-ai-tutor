import assert from "node:assert/strict";
import test from "node:test";
import { buildReplayInput, replayGradingGoldCases, summarizeGradingEvidence } from "./replay-grading-gold.mjs";
import { evaluateGradingCases } from "./grading-quality-check.mjs";
import { runSubmissionPipeline } from "../packages/ai/src/teaching-pipeline.js";
import { runTeachingTask } from "../packages/ai/src/runtime.js";

const sample = () => ({ caseId: "synthetic-replay", sourceType: "generated_assessment",
  input: { subject: "数学", ocrQuestions: [{ questionNo: "1", printedPrompt: "1+1", studentAnswer: "2", confidence: 1 }],
    expected: "PRIVATE_LABEL", teacherReview: { confirmedBy: "PRIVATE_TEACHER" }, actual: "PRIVATE_ACTUAL" },
  expected: { score: 5, questionResults: [{ questionNo: "1", status: "correct", correctAnswer: "2", score: 5 }] },
  teacherReview: { confirmedBy: "synthetic-teacher", confirmedAt: "2026-09-01T00:00:00Z", modifiedQuestionNos: [] } });
const result = () => ({ available: true, structured: { score: 5, questionResults: [{ questionNo: "1", status: "correct", correctAnswer: "2", score: 5, maxScore: 5 }] } });

test("replay preserves available evidence fields and reports missing coverage without inventing it", () => {
  const source = sample();
  source.input.gradingSourcePackage = {
    questions: [{ questionNo: "1", prompt: "1+1", correctAnswer: "2", maxScore: 5,
      analysisSteps: ["相加"], knowledgePoint: "加法", rubric: "结果正确",
      context: { itemType: "calculation", sharedMaterial: { id: "m1", text: "材料" } } }]
  };
  source.input.ocrQuestions = [{ questionNo: "1", printedPrompt: "1+1", studentAnswer: "2", observedWork: "1+1=2", confidence: 0.8,
    bbox: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 } }];
  source.input.questionLayoutManifest = { questions: [{ questionNo: "1", itemType: "calculation" }] };
  const input = buildReplayInput(source.input);
  assert.equal(input.gradingSourcePackage.questions[0].context.itemType, "calculation");
  assert.equal(input.ocrQuestions[0].observedWork, "1+1=2");
  const coverage = summarizeGradingEvidence(input);
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.sourceContextCount, 1);
  assert.equal(coverage.observedWorkCount, 1);
});

test("replay validates gold before invoking runner and passes no evaluation labels to the runner", async () => {
  const inputs = [];
  const grade = async (_config, input, options) => { assert.equal(options.persist, false); inputs.push(input); return result(); };
  await assert.rejects(replayGradingGoldCases([{ ...sample(), teacherReview: null }], {}, { grade }));
  assert.equal(inputs.length, 0);
  const report = await replayGradingGoldCases([sample()], {}, { grade });
  assert.equal(inputs.length, 1); assert.doesNotMatch(JSON.stringify(inputs), /PRIVATE|expected|teacherReview|actual/);
  assert.equal(report.cases[0].actual.score, 5);
  assert.equal(report.cases[0].evaluationRun.scope, "grading-text");
  assert.equal(report.cases[0].evaluationRun.persist, false);
  const evaluated = evaluateGradingCases(report.cases);
  assert.equal(evaluated.ok, true); // identical answers are legitimate, not proof of leakage
  assert.equal(evaluated.productionAccuracyClaim, false);
  report.cases[0].actual.score = 100;
  assert.equal(evaluateGradingCases(report.cases).ok, false);
});

test("text replay never establishes full image/OCR acceptance", async () => {
  const report = await replayGradingGoldCases([sample()], {}, { grade: async () => result() });
  const evaluated = evaluateGradingCases(report.cases, { requiredScope: "grading-image" });
  assert.equal(evaluated.ok, false);
  assert.ok(evaluated.executionIssues.some((i) => i.code === "EXECUTION_SCOPE_MISMATCH"));
});

test("programmatic model selection configures the runner, and failed batches checkpoint before stopping", async () => {
  const checkpoints = [];
  const cases = [1, 2, 3, 4].map((n) => ({ ...sample(), caseId: `synthetic-${n}` }));
  let calls = 0;
  const configs = [];
  const report = await replayGradingGoldCases(cases, { TEACHING_PRIMARY_MODEL: "old" }, {
    model: "gpt-6-astra", maxConsecutiveFailures: 2,
    grade: async (config) => {
      calls += 1;
      configs.push(config);
      return { available: false, structured: {} };
    },
    checkpoint: async (entry) => checkpoints.push(entry)
  });
  assert.equal(calls, 2);
  assert.ok(configs.every((config) => config.TEACHING_PRIMARY_MODEL === "gpt-6-astra" && config.GPT56_SOL_FALLBACK_ENABLED === "false"));
  assert.equal(checkpoints.length, 2);
  assert.equal(report.completed, false);
  assert.equal(report.stopReason, "CONSECUTIVE_FAILURE_LIMIT");
  assert.equal(report.sourceCaseCount, 4);
  assert.equal(report.remainingCaseIds.length, 2);
  assert.equal(evaluateGradingCases(report.cases).ok, false);
});

test("a broken checkpoint fails loudly without converting a completed run into a duplicate failed case", async () => {
  await assert.rejects(replayGradingGoldCases([sample()], {}, {
    grade: async () => result(), checkpoint: async () => { throw new Error("DISK_WRITE_FAILED"); }
  }), /DISK_WRITE_FAILED/);
});

test("replay records a safe failure class without exposing provider error text", async () => {
  const report = await replayGradingGoldCases([sample()], {}, {
    grade: async () => {
      const error = new Error("401 invalid api key PRIVATE_PROVIDER_DETAIL");
      error.status = 401;
      throw error;
    }
  });
  assert.equal(report.cases[0].evaluationRun.failureReason, "configuration");
  assert.equal(report.runs[0].failureReason, "configuration");
  assert.equal(Object.hasOwn(report.runs[0], "error"), false);
  assert.doesNotMatch(JSON.stringify(report.runs), /PRIVATE_PROVIDER_DETAIL/);
});

test("replay maps runner availability and quality classes to safe report reasons", async () => {
  for (const [triggerClass, expectedReason] of [["availability", "availability"], ["quality", "quality_invalid_output"]]) {
    const report = await replayGradingGoldCases([sample()], {}, {
      grade: async () => ({ available: false, structured: {}, modelRun: { metadata: { attempts: [{ triggerClass }] } } })
    });
    assert.equal(report.cases[0].evaluationRun.failureReason, expectedReason);
    assert.equal(report.runs[0].failureReason, expectedReason);
  }
});

test("replay distinguishes deadline and output budgets and does not mark recovered attempts failed", async () => {
  for (const [error, reason] of [["TEACHING_BUDGET_EXHAUSTED", "budget_exhausted"], ["TEACHING_DEADLINE", "timeout"]]) {
    const report = await replayGradingGoldCases([sample()], {}, { grade: async () => ({ available: false, error }) });
    assert.equal(report.runs[0].failureReason, reason);
  }
  const recovered = await replayGradingGoldCases([sample()], {}, { grade: async () => ({ ...result(), modelRun: { metadata: { attempts: [{ triggerClass: "quality" }, { status: "SUCCESS" }] } } }) });
  assert.equal(recovered.runs[0].failureReason, null);
});

test("teacher confirmation summaries cannot substitute for original student answers in replay", async () => {
  const source = sample();
  source.input.ocrQuestions[0].studentAnswer = "教师复核确认作答正确。";
  let calls = 0;
  const report = await replayGradingGoldCases([source], {}, { grade: async () => { calls++; return result(); } });
  assert.equal(calls, 0);
  assert.equal(report.runs[0].failureReason, "evidence_insufficient");
  assert.deepEqual(report.cases[0].teacherReview, { ...source.teacherReview, confirmedAt: new Date(source.teacherReview.confirmedAt).toISOString() });
  assert.equal(report.cases[0].evaluationRun.evidenceCoverage.summaryAnswerCount, 1);
});

test("standalone type and figure survive rebuilding and null confidence is not evidence", () => {
  const input = buildReplayInput({ gradingSourcePackage: { questions: [{ questionNo: "1", prompt: "如图", correctAnswer: "2", maxScore: 5, itemType: "solution", figure: { type: "rectangle" } }] }, ocrQuestions: [{ questionNo: "1", confidence: null }] });
  assert.equal(input.gradingSourcePackage.questions[0].context.itemType, "solution");
  assert.deepEqual(input.gradingSourcePackage.questions[0].context.figure, { type: "rectangle" });
  assert.equal(summarizeGradingEvidence(input).confidenceCount, 0);
  assert.equal(input.assignmentItems[0].metadata.sourceContext.itemType, "solution");
  assert.equal(summarizeGradingEvidence({ ocrQuestions: [{ studentAnswer: "教师复核确认选择错误" }] }).summaryAnswerCount, 1);
});

test("shared runner deadline reaches replay and evaluator as timeout without raw transport detail", async () => {
  const report = await replayGradingGoldCases([sample()], {}, { grade: async (_config, input) =>
    // Keep preparation latency outside the deadline case under test. The runner's
    // real 100 ms abort timer still has to cancel the hanging call.
    runSubmissionPipeline({}, "grading", input, { timeoutMs: 100, now: () => 0, disableSolEscalation: true,
      call: async () => new Promise(() => {}) }, runTeachingTask)
  });
  const run = report.cases[0].evaluationRun;
  assert.equal(run.failureReason, "timeout");
  assert.equal(run.attempts.length, 1);
  assert.equal(run.attempts[0].failureCode, "TEACHING_DEADLINE");
  assert.deepEqual(evaluateGradingCases(report.cases).failureReasons, { timeout: 1 });
});
