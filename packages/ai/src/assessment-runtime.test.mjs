import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { draftAssessment } from "./runtime.js";

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

function readJsonRequest(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function partitionPrompt(payload) {
  return String(payload.messages?.findLast((message) => message.role === "user")?.content || "");
}

function partitionTitle(payload) {
  return partitionPrompt(payload).match(/本次只生成分区：([^。]+)。/)?.[1] || "未知分区";
}

function firstAllowedItemType(payload) {
  return partitionPrompt(payload).match(/允许题型：([^。]+)。/)?.[1]?.split(",")[0]?.trim() || "fill";
}

function validPartitionContent(payload, marker = payload.model) {
  return JSON.stringify({
    title: "分区生成测试",
    layout: { paper: "A4", pages: 2 },
    sections: [
      {
        title: partitionTitle(payload),
        items: [
          {
            itemType: firstAllowedItemType(payload),
            prompt: `${partitionTitle(payload)}-${marker}`,
            answer: "测试答案",
            analysisSteps: ["读取条件。", "完成作答。"],
            knowledgePoint: "测试考点",
            commonMistake: "不要遗漏条件。"
          }
        ]
      }
    ]
  });
}

function sendChatContent(res, content) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

function enabledSolConfig(baseUrl, overrides = {}) {
  return {
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: baseUrl,
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_REASONING_EFFORT_ENABLED: "true",
    GPT56_SOL_FALLBACK_ENABLED: "true",
    GPT56_SOL_MODEL: "gpt-5.6-sol",
    GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000",
    ...overrides
  };
}

function compactAssessmentInput(overrides = {}) {
  return {
    subject: "数学",
    kind: "小测",
    grade: "五年级",
    requirement: "Sol 分区升级测试",
    assessmentMaxTokens: 16000,
    ...overrides
  };
}

test("draftAssessment honors request-level total timeout", { timeout: 2000 }, async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"late\",\"sections\":[]}" } }] }));
    }, 200);
  });
  const address = await listen(server);
  try {
    const startedAt = Date.now();
    const result = await draftAssessment(
      {
        GPT56_API_KEY: "test-key",
        GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
        GPT56_MODEL: "gpt-5.6"
      },
      {
        subject: "数学",
        kind: "小测",
        grade: "五年级",
        requirement: "短预算测试",
        assessmentTotalTimeoutMs: 40
      }
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.available, false);
    assert.equal(result.modelRun.status, "ERROR");
    assert.match(result.error || "", /MODEL_TIMEOUT|ASSESSMENT_TOTAL_TIMEOUT/);
    assert.equal(result.modelRun.metadata.assessmentTotalTimeoutMs, 40);
    assert.equal(result.modelRun.metadata.totalBudgetExhausted, true);
    assert.ok(result.modelRun.metadata.attempts.length >= 1);
    assert.equal(result.modelRun.metadata.attempts.every((item) => item.providerId === "gpt56"), true);
    assert.ok(elapsedMs < 180, `expected request to stop before delayed response, took ${elapsedMs}ms`);
  } finally {
    await close(server);
  }
});

test("draftAssessment splits request-level max token budget across project partitions", async () => {
  const requestPayloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestPayloads.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "六年级数学试卷",
                sections: [
                  {
                    title: "一、计算",
                    items: [
                      {
                        itemType: "calculation",
                        prompt: "计算：125×32。",
                        answer: "4000",
                        analysisSteps: ["把 32 拆成 8×4。"],
                        knowledgePoint: "乘法运算"
                      }
                    ]
                  }
                ]
              })
            }
          }
        ]
      }));
    });
  });
  const address = await listen(server);
  try {
    const result = await draftAssessment(
      {
        GPT56_API_KEY: "test-key",
        GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
        GPT56_MODEL: "gpt-5.6"
      },
      {
        subject: "数学",
        kind: "试卷",
        grade: "六年级",
        requirement: "高质量正式生成",
        assessmentMaxTokens: 20000
      }
    );

    assert.equal(result.available, true);
    assert.equal(result.providerId, "gpt56");
    assert.equal(requestPayloads.length, 4);
    assert.equal(requestPayloads.every((payload) => payload.model === "gpt-5.6"), true);
    assert.equal(requestPayloads.every((payload) => payload.max_tokens <= 5000), true);
    assert.equal(requestPayloads.reduce((sum, payload) => sum + payload.max_tokens, 0), 20000);
    assert.equal(result.modelRun.metadata.assessmentMaxTokens, 20000);
    assert.deepEqual(result.modelRun.metadata.partitions.map((item) => item.id), ["foundation", "calculation", "application", "operation"]);
  } finally {
    await close(server);
  }
});

test("draftAssessment caps compact partition output at 8000 tokens per request", async () => {
  const requestPayloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requestPayloads.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ title: "小测", sections: [{ title: "分区", items: [{ itemType: "fill", prompt: "1+1=?", answer: "2", analysisSteps: ["计算。"], knowledgePoint: "加法" }] }] }) } }]
      }));
    });
  });
  const address = await listen(server);
  try {
    const result = await draftAssessment(
      { GPT56_API_KEY: "test-key", GPT56_BASE_URL: `http://127.0.0.1:${address.port}`, GPT56_MODEL: "gpt-5.6" },
      { subject: "数学", kind: "小测", grade: "五年级", requirement: "紧凑分区预算", assessmentMaxTokens: 16000 }
    );

    assert.equal(result.available, true);
    assert.equal(requestPayloads.length, 2);
    assert.equal(requestPayloads.every((payload) => payload.max_tokens === 8000), true);
    assert.equal(result.modelRun.metadata.partitions.every((item) => item.maxTokens === 8000), true);
  } finally {
    await close(server);
  }
});

test("draftAssessment uses medium reasoning for quiz and practice and high for exams", async () => {
  const requestPayloads = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requestPayloads.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ title: "档位检查", sections: [{ title: "分区", items: [{ itemType: "fill", prompt: "1+1=?", answer: "2", analysisSteps: ["计算。"], knowledgePoint: "加法" }] }] }) } }]
      }));
    });
  });
  const address = await listen(server);
  const config = {
    GPT56_API_KEY: "test-key",
    GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
    GPT56_MODEL: "gpt-5.6-terra",
    GPT56_REASONING_EFFORT_ENABLED: "true"
  };
  const input = {
    subject: "数学",
    grade: "五年级",
    requirement: "推理档位检查"
  };

  try {
    const quizStart = requestPayloads.length;
    await draftAssessment(config, { ...input, kind: "小测" });
    const quizPayloads = requestPayloads.slice(quizStart);

    const practiceStart = requestPayloads.length;
    await draftAssessment(config, { ...input, kind: "练习" });
    const practicePayloads = requestPayloads.slice(practiceStart);

    const examStart = requestPayloads.length;
    await draftAssessment(config, { ...input, kind: "试卷" });
    const examPayloads = requestPayloads.slice(examStart);

    assert.equal(quizPayloads.length, 2);
    assert.equal(practicePayloads.length, 2);
    assert.equal(examPayloads.length, 4);
    assert.equal(quizPayloads.every((payload) => payload.reasoning_effort === "medium"), true);
    assert.equal(practicePayloads.every((payload) => payload.reasoning_effort === "medium"), true);
    assert.equal(examPayloads.every((payload) => payload.reasoning_effort === "high"), true);
  } finally {
    await close(server);
  }
});

test("draftAssessment uses expanded default assessment model attempt timeouts", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "五年级英语小测",
              sections: [
                {
                  title: "一、词汇",
                  items: [
                    {
                      itemType: "fill",
                      prompt: "根据中文写英文：学习。",
                      answer: "study",
                      analysisSteps: ["识别词义。"],
                      knowledgePoint: "词汇"
                    }
                  ]
                }
              ]
            })
          }
        }
      ]
    }));
  });
  const address = await listen(server);
  try {
    const result = await draftAssessment(
      {
        GPT56_API_KEY: "test-key",
        GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
        GPT56_MODEL: "gpt-5.6"
      },
      {
        subject: "英语",
        kind: "小测",
        grade: "五年级",
        requirement: "默认模型上限检查"
      }
    );

    assert.equal(result.available, true);
    assert.equal(result.modelRun.metadata.assessmentTimeoutMs, 90000);
    assert.equal(result.modelRun.metadata.primaryAssessmentModel, "gpt-5.6");
    assert.equal(result.modelRun.metadata.minimaxAssessmentTimeoutMs, 150000);
  } finally {
    await close(server);
  }
});

test("draftAssessment reserves request-level total budget instead of giving all time to primary attempts", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "语文阅读表达练习",
              sections: [
                {
                  title: "三、阅读提升",
                  items: [
                    {
                      itemType: "reading",
                      prompt: "短文主要写了什么？",
                      answer: "围绕阅读材料概括主要内容。",
                      analysisSteps: ["先读全文。", "再概括人物和事件。"],
                      knowledgePoint: "阅读概括"
                    }
                  ]
                }
              ]
            })
          }
        }
      ]
    }));
  });
  const address = await listen(server);
  try {
    const result = await draftAssessment(
      {
        GPT56_API_KEY: "test-key",
        GPT56_BASE_URL: `http://127.0.0.1:${address.port}`,
        GPT56_MODEL: "gpt-5.6"
      },
      {
        subject: "语文",
        kind: "练习",
        grade: "五年级",
        requirement: "正式预算生成",
        assessmentTotalTimeoutMs: 270000
      }
    );

    assert.equal(result.available, true);
    assert.equal(result.modelRun.metadata.assessmentTimeoutMs, 90000);
    assert.equal(result.modelRun.metadata.assessmentTotalTimeoutMs, 270000);
    assert.equal(result.modelRun.metadata.emergencyFallbackEnabled, false);
  } finally {
    await close(server);
  }
});

test("draftAssessment only uses DeepSeek emergency rollback when explicitly enabled", async () => {
  let deepseekCalls = 0;
  const gptServer = http.createServer((_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "intermediary unavailable" } }));
  });
  const deepseekServer = http.createServer((_req, res) => {
    deepseekCalls += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "五年级数学小测",
              sections: [
                {
                  title: "一、计算",
                  items: [
                    { itemType: "calculation", prompt: "计算：25×4。", answer: "100", analysisSteps: ["直接计算。"], knowledgePoint: "乘法" }
                  ]
                }
              ]
            })
          }
        }
      ]
    }));
  });
  const gptAddress = await listen(gptServer);
  const deepseekAddress = await listen(deepseekServer);

  try {
    const result = await draftAssessment(
      {
        GPT56_API_KEY: "test-key",
        GPT56_BASE_URL: `http://127.0.0.1:${gptAddress.port}`,
        GPT56_MODEL: "gpt-5.6",
        DEEPSEEK_API_KEY: "rollback-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${deepseekAddress.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "deepseek-v4-pro",
        DEEPSEEK_EMERGENCY_FALLBACK_MODEL: "deepseek-v4-flash",
        DEEPSEEK_EMERGENCY_FALLBACK_ENABLED: "true"
      },
      {
        subject: "数学",
        kind: "小测",
        grade: "五年级",
        requirement: "中转故障回滚",
        assessmentTotalTimeoutMs: 1000
      }
    );

    assert.equal(deepseekCalls, 1);
    assert.equal(result.available, true);
    assert.equal(result.providerId, "deepseek");
    assert.equal(result.model, "deepseek-v4-flash");
    assert.equal(result.modelRun.metadata.emergencyFallbackEnabled, true);
    assert.equal(result.modelRun.metadata.fallbackProvider, "deepseek");
    assert.equal(result.modelRun.metadata.attempts.at(-1).role, "emergency-rollback");
  } finally {
    await close(gptServer);
    await close(deepseekServer);
  }
});

test("draftAssessment escalates only one failed Terra partition to Sol once", async () => {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    if (payload.model === "gpt-5.6-terra" && partitionTitle(payload) === "基础概念与计算") {
      res.writeHead(524, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "upstream_timeout", message: "temporary upstream timeout" } }));
      return;
    }
    sendChatContent(res, validPartitionContent(payload));
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput()
    );
    const terraPayloads = payloads.filter((payload) => payload.model === "gpt-5.6-terra");
    const solPayloads = payloads.filter((payload) => payload.model === "gpt-5.6-sol");
    const solAttempts = result.modelRun.metadata.attempts.filter((attempt) => attempt.role === "sol-escalation");

    assert.equal(terraPayloads.length, 2);
    assert.equal(solPayloads.length, 1);
    assert.equal(partitionTitle(solPayloads[0]), "基础概念与计算");
    assert.equal(solPayloads[0].reasoning_effort, "high");
    assert.equal(solPayloads[0].max_tokens, terraPayloads.find((payload) => partitionTitle(payload) === "基础概念与计算").max_tokens);
    assert.equal(result.available, true);
    assert.equal(result.modelRun.metadata.partialGeneration, false);
    assert.equal(result.modelRun.metadata.primaryModel, "gpt-5.6-terra");
    assert.equal(result.modelRun.metadata.escalationModel, "gpt-5.6-sol");
    assert.equal(result.modelRun.metadata.escalationTriggered, true);
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
    assert.deepEqual(result.modelRun.metadata.escalationScopes, ["foundation-calculation"]);
    assert.equal(result.modelRun.metadata.solFallbackTimeoutMs, 180000);
    assert.equal(solAttempts.length, 1);
    assert.equal(solAttempts[0].providerId, "gpt56");
    assert.equal(solAttempts[0].model, "gpt-5.6-sol");
    assert.equal(solAttempts[0].reasoningEffort, "high");
    assert.equal(solAttempts[0].timeoutMs, 180000);
    assert.equal(solAttempts[0].triggerClass, "availability");
    assert.equal(solAttempts[0].triggerCode, "upstream_timeout");
  } finally {
    await close(server);
  }
});

test("draftAssessment classifies malformed Terra model JSON as quality and replaces it with Sol", async () => {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    if (payload.model === "gpt-5.6-terra" && partitionTitle(payload) === "基础概念与计算") {
      sendChatContent(res, "{malformed business json");
      return;
    }
    sendChatContent(res, validPartitionContent(payload));
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput()
    );
    const solPayload = payloads.find((payload) => payload.model === "gpt-5.6-sol");
    const solAttempt = result.modelRun.metadata.attempts.find((attempt) => attempt.role === "sol-escalation");

    assert.ok(solPayload);
    assert.match(partitionPrompt(solPayload), /必须修复：partition:foundation-calculation:malformed_json/);
    assert.doesNotMatch(partitionPrompt(solPayload), /malformed business json/);
    assert.equal(solAttempt.triggerClass, "quality");
    assert.equal(solAttempt.triggerCode, "partition_validation");
    assert.deepEqual(solAttempt.triggerIssues, ["partition:foundation-calculation:malformed_json"]);
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
    assert.equal(result.modelRun.metadata.partialGeneration, false);
  } finally {
    await close(server);
  }
});

test("draftAssessment classifies hard-invalid Terra content as quality", async () => {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    if (payload.model === "gpt-5.6-terra" && partitionTitle(payload) === "基础概念与计算") {
      sendChatContent(res, JSON.stringify({
        title: "硬校验失败",
        sections: [{ items: [{ itemType: "writing", prompt: "越界题型", answer: "", analysisSteps: [] }] }]
      }));
      return;
    }
    sendChatContent(res, validPartitionContent(payload));
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput()
    );
    const solAttempt = result.modelRun.metadata.attempts.find((attempt) => attempt.role === "sol-escalation");

    assert.equal(payloads.filter((payload) => payload.model === "gpt-5.6-sol").length, 1);
    assert.equal(solAttempt.triggerClass, "quality");
    assert.equal(solAttempt.triggerCode, "partition_validation");
    assert.deepEqual(solAttempt.triggerIssues, [
      "partition:foundation-calculation:disallowed_item_type",
      "partition:foundation-calculation:incomplete_item"
    ]);
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
  } finally {
    await close(server);
  }
});

test("draftAssessment gives all failed Terra partitions one Sol attempt with concurrency at most two", async () => {
  const payloads = [];
  let activeSol = 0;
  let maxActiveSol = 0;
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    if (payload.model === "gpt-5.6-terra") {
      res.writeHead(524, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "upstream_timeout", message: "temporary timeout" } }));
      return;
    }
    activeSol += 1;
    maxActiveSol = Math.max(maxActiveSol, activeSol);
    setTimeout(() => {
      activeSol -= 1;
      sendChatContent(res, validPartitionContent(payload));
    }, 25);
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput({ kind: "试卷", assessmentMaxTokens: 24000 })
    );
    const terraPayloads = payloads.filter((payload) => payload.model === "gpt-5.6-terra");
    const solPayloads = payloads.filter((payload) => payload.model === "gpt-5.6-sol");

    assert.equal(terraPayloads.length, 4);
    assert.equal(solPayloads.length, 4);
    assert.equal(maxActiveSol <= 2, true);
    assert.equal(result.modelRun.metadata.attempts.filter((attempt) => attempt.role === "sol-escalation").length, 4);
    assert.equal(new Set(result.modelRun.metadata.escalationScopes).size, 4);
    assert.equal(result.modelRun.metadata.solTotalBudgetMs, 240000);
    assert.equal(result.modelRun.metadata.partialGeneration, false);
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
  } finally {
    await close(server);
  }
});

test("draftAssessment does not escalate configuration, disabled, or insufficient-evidence failures", async (t) => {
  const cases = [
    {
      name: "authentication",
      status: 401,
      error: { code: "invalid_api_key", message: "authentication failed" }
    },
    {
      name: "quota",
      status: 429,
      error: { code: "insufficient_quota", message: "quota exhausted" }
    },
    {
      name: "disabled gate",
      status: 524,
      error: { code: "upstream_timeout", message: "temporary timeout" },
      config: { GPT56_SOL_FALLBACK_ENABLED: "false" }
    },
    {
      name: "insufficient evidence",
      status: 524,
      error: { code: "upstream_timeout", message: "temporary timeout" },
      execution: { evidenceSufficient: false }
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let solCalls = 0;
      const server = http.createServer(async (req, res) => {
        const payload = await readJsonRequest(req);
        if (payload.model === "gpt-5.6-sol") {
          solCalls += 1;
          sendChatContent(res, validPartitionContent(payload));
          return;
        }
        res.writeHead(scenario.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: scenario.error }));
      });
      const address = await listen(server);

      try {
        const result = await draftAssessment(
          enabledSolConfig(`http://127.0.0.1:${address.port}`, scenario.config),
          compactAssessmentInput(),
          scenario.execution
        );

        assert.equal(solCalls, 0);
        assert.equal(result.modelRun.metadata.usedModelEscalation, false);
        assert.equal(result.modelRun.metadata.escalationTriggered, false);
      } finally {
        await close(server);
      }
    });
  }
});

test("draftAssessment stops after failed Sol attempts instead of calling DeepSeek", async () => {
  let solCalls = 0;
  let deepseekCalls = 0;
  const gptServer = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    if (payload.model === "gpt-5.6-sol") solCalls += 1;
    res.writeHead(payload.model === "gpt-5.6-sol" ? 503 : 524, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "upstream_timeout", message: "temporary model failure" } }));
  });
  const deepseekServer = http.createServer((_req, res) => {
    deepseekCalls += 1;
    sendChatContent(res, JSON.stringify({ title: "不应调用", sections: [] }));
  });
  const gptAddress = await listen(gptServer);
  const deepseekAddress = await listen(deepseekServer);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${gptAddress.port}`, {
        DEEPSEEK_API_KEY: "rollback-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${deepseekAddress.port}`,
        DEEPSEEK_EMERGENCY_FALLBACK_ENABLED: "true"
      }),
      compactAssessmentInput()
    );

    assert.equal(solCalls, 2);
    assert.equal(deepseekCalls, 0);
    assert.equal(result.available, false);
    assert.equal(result.modelRun.metadata.usedModelEscalation, false);
    assert.equal(result.modelRun.metadata.escalationTriggered, true);
    assert.equal(result.modelRun.metadata.attempts.filter((attempt) => attempt.role === "sol-escalation").length, 2);
    assert.equal(result.modelRun.metadata.fallbackProvider, null);
  } finally {
    await close(gptServer);
    await close(deepseekServer);
  }
});

test("draftAssessment keeps valid Terra-only requests on the existing model and budget", async () => {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    sendChatContent(res, validPartitionContent(payload));
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput({ model: "gpt-5.6-sol", evidenceSufficient: false })
    );

    assert.equal(payloads.length, 2);
    assert.equal(payloads.every((payload) => payload.model === "gpt-5.6-terra"), true);
    assert.equal(payloads.every((payload) => payload.reasoning_effort === "medium"), true);
    assert.equal(payloads.every((payload) => payload.max_tokens === 8000), true);
    assert.equal(result.available, true);
    assert.equal(result.model, "gpt-5.6-terra");
    assert.equal(result.modelRun.metadata.escalationTriggered, false);
    assert.equal(result.modelRun.metadata.usedModelEscalation, false);
    assert.deepEqual(result.modelRun.metadata.escalationScopes, []);
    assert.equal(result.modelRun.metadata.partialGeneration, false);
    assert.equal(result.modelRun.metadata.attempts.every((attempt) => attempt.role === "primary"), true);
    assert.equal(result.modelRun.metadata.attempts.every((attempt) => attempt.model === "gpt-5.6-terra"), true);
    assert.equal(result.modelRun.metadata.attempts.every((attempt) => attempt.reasoningEffort === "medium"), true);
    assert.equal(result.modelRun.metadata.attempts.every((attempt) => attempt.timeoutMs === 90000), true);
  } finally {
    await close(server);
  }
});

test("draftAssessment forces high reasoning for direct internal Sol execution", async (t) => {
  for (const kind of ["小测", "练习"]) {
    await t.test(kind, async () => {
      const payloads = [];
      const server = http.createServer(async (req, res) => {
        const payload = await readJsonRequest(req);
        payloads.push(payload);
        sendChatContent(res, validPartitionContent(payload));
      });
      const address = await listen(server);

      try {
        const result = await draftAssessment(
          enabledSolConfig(`http://127.0.0.1:${address.port}`),
          compactAssessmentInput({ kind }),
          { model: "gpt-5.6-sol", reasoningEffort: "low" }
        );

        assert.equal(payloads.length, 2);
        assert.equal(payloads.every((payload) => payload.model === "gpt-5.6-sol"), true);
        assert.equal(payloads.every((payload) => payload.reasoning_effort === "high"), true);
        assert.equal(result.modelRun.metadata.attempts.every((attempt) => attempt.reasoningEffort === "high"), true);
      } finally {
        await close(server);
      }
    });
  }
});

test("draftAssessment stops queued Sol partitions when the new scenario budget is exhausted", async () => {
  const payloads = [];
  let nowMs = 0;
  let activeSol = 0;
  let maxActiveSol = 0;
  const server = http.createServer(async (req, res) => {
    const payload = await readJsonRequest(req);
    payloads.push(payload);
    if (payload.model === "gpt-5.6-terra") {
      res.writeHead(524, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "upstream_timeout", message: "temporary timeout" } }));
      return;
    }

    activeSol += 1;
    maxActiveSol = Math.max(maxActiveSol, activeSol);
    nowMs += 120000;
    setTimeout(() => {
      activeSol -= 1;
      sendChatContent(res, validPartitionContent(payload));
    }, 10);
  });
  const address = await listen(server);

  try {
    const result = await draftAssessment(
      enabledSolConfig(`http://127.0.0.1:${address.port}`),
      compactAssessmentInput({ kind: "试卷", assessmentMaxTokens: 24000 }),
      { now: () => nowMs }
    );
    const solPayloads = payloads.filter((payload) => payload.model === "gpt-5.6-sol");
    const solAttempts = result.modelRun.metadata.attempts.filter((attempt) => attempt.role === "sol-escalation");

    assert.equal(solPayloads.length, 2);
    assert.equal(solAttempts.length, 2);
    assert.equal(maxActiveSol <= 2, true);
    assert.equal(result.modelRun.metadata.escalationScopes.length, 2);
    assert.equal(result.modelRun.metadata.solTotalBudgetMs, 240000);
    assert.equal(result.modelRun.metadata.partialGeneration, true);
    assert.equal(result.modelRun.metadata.usedModelEscalation, true);
    assert.equal(result.modelRun.metadata.fallbackProvider, null);
  } finally {
    await close(server);
  }
});
