import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  answerStudentQuestion,
  buildAiStartupSnapshot,
  buildModelOrchestrationPlan,
  callGpt56Chat,
  draftStudentProfileNarrative,
  draftTeacherTask,
  generateSubmissionReferenceAnswers,
  generateVocabularyCard,
  gradeSubmissionText,
  normalizeRuntimeConfig,
  reviewWithGpt55
} from "./runtime.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("normalizeRuntimeConfig prefers GPT56 settings and supports GPT55 migration aliases", () => {
  const preferred = normalizeRuntimeConfig({
    GPT56_API_KEY: "new-key",
    GPT56_BASE_URL: "https://gpt56.example/v1",
    GPT56_MODEL: "gpt-5.6",
    GPT55_API_KEY: "old-key",
    GPT55_BASE_URL: "https://gpt55.example/v1",
    GPT55_MODEL: "gpt-5.5",
    GPT56_REASONING_EFFORT_ENABLED: "true"
  });

  assert.equal(preferred.gpt56ApiKey, "new-key");
  assert.equal(preferred.gpt56BaseUrl, "https://gpt56.example/v1");
  assert.equal(preferred.gpt56Model, "gpt-5.6");
  assert.equal(preferred.gpt56ReasoningEffortEnabled, true);

  const migrated = normalizeRuntimeConfig({
    GPT55_API_KEY: "legacy-key",
    GPT55_BASE_URL: "https://legacy.example/v1",
    GPT55_MODEL: "gpt-5.6"
  });

  assert.equal(migrated.gpt56ApiKey, "legacy-key");
  assert.equal(migrated.gpt56BaseUrl, "https://legacy.example/v1");
  assert.equal(migrated.gpt56Model, "gpt-5.6");
});

test("normalizeRuntimeConfig supports the GPT56 assessment timeout migration alias", () => {
  const preferred = normalizeRuntimeConfig({
    GPT56_GENERATION_TIMEOUT_MS: "180000",
    GPT56_ASSESSMENT_TIMEOUT_MS: "240000"
  });
  const migrated = normalizeRuntimeConfig({
    GPT56_ASSESSMENT_TIMEOUT_MS: "240000"
  });

  assert.equal(preferred.gpt56GenerationTimeoutMs, 180000);
  assert.equal(migrated.gpt56GenerationTimeoutMs, 240000);
  assert.equal(migrated.gpt56GradingTimeoutMs, 240000);
});

test("normalizeRuntimeConfig exposes Sol defaults and explicit overrides", () => {
  const defaults = normalizeRuntimeConfig({});
  assert.equal(defaults.gpt56SolFallbackEnabled, false);
  assert.equal(defaults.gpt56SolModel, "gpt-5.6-sol");
  assert.equal(defaults.gpt56SolFallbackTimeoutMs, 180000);

  const overridden = normalizeRuntimeConfig({
    GPT56_SOL_FALLBACK_ENABLED: "true",
    GPT56_SOL_MODEL: "gpt-5.6-sol-preview",
    GPT56_SOL_FALLBACK_TIMEOUT_MS: "210000"
  });
  assert.equal(overridden.gpt56SolFallbackEnabled, true);
  assert.equal(overridden.gpt56SolModel, "gpt-5.6-sol-preview");
  assert.equal(overridden.gpt56SolFallbackTimeoutMs, 210000);
});

test("buildAiStartupSnapshot assigns Junhang text capabilities to GPT-5.6", () => {
  const snapshot = buildAiStartupSnapshot({
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: "https://gpt56.example/v1",
    GPT56_MODEL: "gpt-5.6"
  });
  const provider = snapshot.providers.find((item) => item.id === "gpt56");

  assert.equal(provider?.status, "ready");
  assert.equal(provider?.model, "gpt-5.6");
  for (const capabilityId of ["qa", "vocabulary-text", "task-draft", "report-draft", "submission-grading"]) {
    assert.equal(snapshot.features.find((item) => item.id === capabilityId)?.providerId, "gpt56");
  }
  assert.equal(snapshot.features.find((item) => item.id === "grading-audit"), undefined);
  assert.deepEqual(
    snapshot.providers.find((item) => item.id === "minimax")?.capabilities,
    ["vocabulary-voice", "spoken-practice", "avatar-dialog", "vision-ocr"]
  );
  assert.deepEqual(
    snapshot.providers.find((item) => item.id === "deepseek")?.capabilities,
    ["emergency-text-rollback"]
  );
  assert.match(snapshot.providers.find((item) => item.id === "deepseek")?.reason || "", /紧急回滚/);
});

test("buildModelOrchestrationPlan uses GPT-5.6 for QA and assessment generation", () => {
  const plan = buildModelOrchestrationPlan({
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: "https://gpt56.example/v1",
    GPT56_MODEL: "gpt-5.6"
  });

  assert.equal(plan.routes.qa.providerId, "gpt56");
  assert.equal(plan.routes.qa.model, "gpt-5.6");
  assert.equal(plan.routes.assessmentDraft.providerId, "gpt56");
  assert.equal(plan.routes.assessmentDraft.model, "gpt-5.6");
});

test("callGpt56Chat only sends reasoning_effort when intermediary support is enabled", async () => {
  const payloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      payloads.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
  });
  const address = await listen(server);
  const baseConfig = {
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
    GPT56_MODEL: "gpt-5.6"
  };

  try {
    await callGpt56Chat(baseConfig, [{ role: "user", content: "first" }], { reasoningEffort: "low" });
    await callGpt56Chat(
      { ...baseConfig, GPT56_REASONING_EFFORT_ENABLED: "true" },
      [{ role: "user", content: "second" }],
      { reasoningEffort: "medium" }
    );

    assert.equal(Object.hasOwn(payloads[0], "reasoning_effort"), false);
    assert.equal(payloads[1].reasoning_effort, "medium");
    assert.equal(payloads[1].model, "gpt-5.6");
  } finally {
    await close(server);
  }
});

test("callGpt56Chat preserves upstream status and error code", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: "quota exhausted",
        code: "insufficient_quota"
      }
    }));
  });
  const address = await listen(server);

  try {
    await assert.rejects(
      callGpt56Chat(
        {
          GPT56_API_KEY: "test-key",
          GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
          GPT56_MODEL: "gpt-5.6"
        },
        [{ role: "user", content: "test" }]
      ),
      (error) => {
        assert.equal(error.message, "429 quota exhausted");
        assert.equal(error.status, 429);
        assert.equal(error.code, "insufficient_quota");
        return true;
      }
    );
  } finally {
    await close(server);
  }
});

test("callGpt56Chat preserves status for a non-JSON upstream error", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(524, { "Content-Type": "text/plain" });
    res.end("upstream timeout");
  });
  const address = await listen(server);

  try {
    await assert.rejects(
      callGpt56Chat(
        {
          GPT56_API_KEY: "test-key",
          GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
          GPT56_MODEL: "gpt-5.6"
        },
        [{ role: "user", content: "test" }]
      ),
      (error) => {
        assert.equal(error.message, "524 upstream timeout");
        assert.equal(error.status, 524);
        assert.equal(error.code, null);
        return true;
      }
    );
  } finally {
    await close(server);
  }
});

test("callGpt56Chat classifies a successful non-JSON upstream response", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>gateway error</html>");
  });
  const address = await listen(server);

  try {
    await assert.rejects(
      callGpt56Chat(
        {
          GPT56_API_KEY: "test-key",
          GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
          GPT56_MODEL: "gpt-5.6"
        },
        [{ role: "user", content: "test" }]
      ),
      (error) => {
        assert.match(error.message, /Invalid upstream response/);
        assert.equal(error.status, 200);
        assert.equal(error.code, "invalid_upstream_response");
        return true;
      }
    );
  } finally {
    await close(server);
  }
});

async function runSubmissionEscalationCase(workflow, primaryResponse) {
  const payloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      payloads.push(payload);
      if (payload.model === "gpt-5.6") {
        res.writeHead(primaryResponse.status, { "Content-Type": primaryResponse.contentType });
        res.end(primaryResponse.body);
        return;
      }
      const content = workflow === "reference"
        ? JSON.stringify({ referenceAnswers: [{ questionNo: "1", correctAnswer: "2", confidence: 0.99 }] })
        : JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", confidence: 0.99 }] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  const address = await listen(server);
  const config = {
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
    GPT56_MODEL: "gpt-5.6",
    GPT56_REASONING_EFFORT_ENABLED: "true",
    GPT56_SOL_FALLBACK_ENABLED: "true",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000"
  };
  try {
    const result = workflow === "reference"
      ? await generateSubmissionReferenceAnswers(config, { printedText: "1. 1+1=?" })
      : await gradeSubmissionText(config, { printedText: "1. 1+1=?", studentAnswerText: "1. 2" });
    return { payloads, result };
  } finally {
    await close(server);
  }
}

for (const workflow of ["reference", "grading"]) {
  test(`${workflow} retries a Terra 524 once with Sol high and an independent timeout`, async () => {
    const { payloads, result } = await runSubmissionEscalationCase(workflow, {
      status: 524,
      contentType: "text/plain",
      body: "upstream timeout"
    });

    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads.map((item) => item.model), ["gpt-5.6", "gpt-5.6-sol"]);
    assert.equal(payloads[1].reasoning_effort, "high");
    assert.equal(result.available, true);
    assert.equal(result.model, "gpt-5.6-sol");
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
    assert.equal(result.modelRun.metadata.attempts.length, 2);
    assert.equal(result.modelRun.metadata.attempts[1].role, "sol-escalation");
    assert.equal(result.modelRun.metadata.attempts[1].timeoutMs, 180000);
    assert.equal(result.modelRun.metadata.attempts[1].reasoningEffort, "high");
  });

  test(`${workflow} does not escalate authentication or quota failures`, async () => {
    for (const response of [
      { status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "invalid key", code: "invalid_api_key" } }) },
      { status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "quota exhausted", code: "insufficient_quota" } }) }
    ]) {
      const { payloads, result } = await runSubmissionEscalationCase(workflow, response);
      assert.equal(payloads.length, 1);
      assert.equal(result.available, false);
      assert.equal(result.modelRun.metadata.usedModelEscalation, false);
    }
  });
}

test("submission runtime does not treat malformed model content as an availability failure", async () => {
  const response = {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { content: "not-json" } }] })
  };
  const { payloads, result } = await runSubmissionEscalationCase("grading", response);
  assert.equal(payloads.length, 1);
  assert.equal(result.available, true);
  assert.equal(result.gradingText, "not-json");
  assert.equal(result.modelRun.metadata.usedModelEscalation, false);
});

test("Junhang text workflows use GPT-5.6 as their primary provider", async () => {
  const payloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      payloads.push(payload);
      const system = String(payload.messages?.[0]?.content || "");
      const content = system.includes("词汇助教")
        ? JSON.stringify({ word: "study", meaning: "学习", related: [], examples: [], needsTeacherReview: true })
        : system.includes("标准答案生成助手")
          ? JSON.stringify({ referenceAnswers: [], confidence: 0.8, needsTeacherReview: true })
          : system.includes("批改助手")
            ? JSON.stringify({ score: 0, summary: "待复核", questionResults: [], needsTeacherReview: true })
            : system.includes("质量审查器")
              ? JSON.stringify({ status: "pass", riskLevel: "low", scoreReliable: true, archiveAllowed: true, issues: [], suggestions: [] })
              : system.includes("学情分析助手")
                ? JSON.stringify({ profileType: "weekly_growth", period: {}, publishedView: {}, teacherReview: {} })
                : system.includes("教师助手")
                  ? JSON.stringify({ title: "今日任务", steps: [] })
                  : "引导回答";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  const address = await listen(server);
  const config = {
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
    GPT56_MODEL: "gpt-5.6",
    GPT56_REASONING_EFFORT_ENABLED: "true"
  };

  try {
    const results = await Promise.all([
      answerStudentQuestion(config, { question: "什么是小数？", subject: "数学" }),
      generateVocabularyCard(config, { word: "study", grade: "五年级" }),
      draftTeacherTask(config, { title: "今日任务", requirement: "复习小数" }),
      draftStudentProfileNarrative(config, { studentId: "synthetic", periodKey: "synthetic" }),
      generateSubmissionReferenceAnswers(config, { title: "合成样例", printedText: "1+1=?" }),
      gradeSubmissionText(config, { title: "合成样例", answerKey: "1.2", studentAnswerText: "1.2" }),
      reviewWithGpt55(config, { reviewTask: "submission-premium-grading-review", title: "合成样例" })
    ]);

    assert.equal(results.every((result) => result.providerId === "gpt56"), true);
    assert.equal(results.every((result) => result.modelRun?.provider === "gpt56"), true);
    assert.equal(results.every((result) => result.modelRun?.model === "gpt-5.6"), true);
    assert.equal(payloads.length, 7);
    assert.equal(payloads.every((payload) => payload.model === "gpt-5.6"), true);
    const effortForSystem = (marker) => payloads.find((payload) =>
      String(payload.messages?.[0]?.content || "").includes(marker)
    )?.reasoning_effort;
    assert.equal(effortForSystem("课后辅导助教"), "low");
    assert.equal(effortForSystem("词汇助教"), "none");
    assert.equal(effortForSystem("教师助手"), "low");
    assert.equal(effortForSystem("学情分析助手"), "low");
    assert.equal(effortForSystem("标准答案生成助手"), "high");
    assert.equal(effortForSystem("作业、练习、小测和试卷批改助手"), "high");
    assert.equal(effortForSystem("最高级质量审查器"), "high");
  } finally {
    await close(server);
  }
});
