import fs from "node:fs";
import path from "node:path";
import {
  answerStudentQuestionService,
  dictationSpeechService,
  draftAssessmentService,
  draftTeacherTaskService
} from "@junhang/services";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

function timeoutMsFor(stepId) {
  const envKey = `SERVICE_SMOKE_${stepId.toUpperCase()}_TIMEOUT_MS`;
  return Number(process.env[envKey] || process.env.SERVICE_SMOKE_STEP_TIMEOUT_MS || 180000);
}

async function withTimeout(stepId, promiseFactory) {
  const timeoutMs = timeoutMsFor(stepId);
  let timeoutHandle;
  const startedAt = Date.now();
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${stepId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([promiseFactory(), timeoutPromise]);
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      value
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runStep(stepId, label, promiseFactory, summarize) {
  process.stderr.write(`[service-smoke] start ${stepId}: ${label}\n`);
  const result = await withTimeout(stepId, promiseFactory);
  if (!result.ok) {
    process.stderr.write(`[service-smoke] fail ${stepId}: ${result.error}\n`);
    return {
      ok: false,
      label,
      durationMs: result.durationMs,
      error: result.error
    };
  }
  process.stderr.write(`[service-smoke] done ${stepId}: ${result.durationMs}ms\n`);
  return {
    ok: true,
    label,
    durationMs: result.durationMs,
    ...summarize(result.value)
  };
}

const env = { ...process.env, ...loadEnv(path.resolve(".env")) };
const startedAt = Date.now();
const results = {};

results.qa = await runStep(
  "qa",
  "AI 问答",
  () => answerStudentQuestionService(
    env,
    {
      studentId: "stu-wyx",
      studentName: "王瑶瑶",
      subject: "数学",
      question: "等腰三角形一个角是40度，这道题怎么思考？"
    },
    { persist: false }
  ),
  (qa) => ({
    available: qa.available,
    mode: qa.mode,
    status: qa.modelRun?.status,
    answerPreview: String(qa.answer || "").slice(0, 80)
  })
);

results.task = await runStep(
  "task",
  "今日任务草稿",
  () => draftTeacherTaskService(
    env,
    {
      studentId: "stu-wyx",
      studentName: "王瑶瑶",
      subject: "英语",
      requirement: "今天复习一般过去时和 carry 的词形变化。"
    },
    { persist: false }
  ),
  (task) => ({
    available: task.available,
    status: task.modelRun?.status,
    draftPreview: String(task.draftText || "").slice(0, 80)
  })
);

results.assessment = await runStep(
  "assessment",
  "生成类草稿",
  () => draftAssessmentService(
    env,
    {
      kind: "小测",
      grade: "六年级",
      subject: "英语",
      difficulty: "基础",
      requirement: "围绕一般过去时，默认两页 A4。"
    },
    { persist: false }
  ),
  (assessment) => ({
    available: assessment.available,
    providerId: assessment.providerId || null,
    status: assessment.modelRun?.status,
    error: assessment.error || null,
    primaryError: assessment.modelRun?.metadata?.primaryError || null,
    fallbackProvider: assessment.modelRun?.metadata?.fallbackProvider || null,
    draftReady: Number(assessment.audit?.itemCount || 0) > 0,
    itemCount: Number(assessment.audit?.itemCount || 0),
    totalScore: assessment.totalScore || null,
    usedDynamicFallback: Boolean(assessment.usedDynamicFallback),
    draftPreview: String(assessment.draftText || "").slice(0, 80)
  })
);

results.dictation = await runStep(
  "dictation",
  "听写计划",
  () => dictationSpeechService(
    env,
    {
      title: "Unit 4 听写",
      subject: "英语",
      difficulty: "基础",
      items: ["carry", "bright"]
    },
    { persist: false }
  ),
  (dictation) => ({
    available: dictation.available,
    repeats: dictation.plan.repeats,
    intervalSeconds: dictation.plan.intervalSeconds,
    itemCount: dictation.plan.items.length
  })
);

const ok = Object.values(results).every((result) => result.ok);
console.log(
  JSON.stringify(
    {
      ok,
      durationMs: Date.now() - startedAt,
      results
    },
    null,
    2
  )
);

if (!ok) process.exit(1);
