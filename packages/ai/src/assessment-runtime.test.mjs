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
