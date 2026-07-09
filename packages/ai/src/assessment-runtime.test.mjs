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
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "slow-model",
        DEEPSEEK_ASSESSMENT_FALLBACK_MODEL: "slow-model"
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
    assert.equal(result.modelRun.metadata.attempts.length, 1);
    assert.ok(elapsedMs < 180, `expected request to stop before delayed response, took ${elapsedMs}ms`);
  } finally {
    await close(server);
  }
});

test("draftAssessment forwards request-level max token budget", async () => {
  let requestPayload = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestPayload = JSON.parse(body);
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
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "token-model",
        DEEPSEEK_ASSESSMENT_FALLBACK_MODEL: "token-model"
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
    assert.equal(requestPayload.max_tokens, 20000);
    assert.equal(result.modelRun.metadata.assessmentMaxTokens, 20000);
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
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "default-timeout-model",
        DEEPSEEK_ASSESSMENT_FALLBACK_MODEL: "default-timeout-model"
      },
      {
        subject: "英语",
        kind: "小测",
        grade: "五年级",
        requirement: "默认模型上限检查"
      }
    );

    assert.equal(result.available, true);
    assert.equal(result.modelRun.metadata.assessmentTimeoutMs, 240000);
    assert.equal(result.modelRun.metadata.premiumAssessmentTimeoutMs, 240000);
    assert.equal(result.modelRun.metadata.minimaxAssessmentTimeoutMs, 150000);
  } finally {
    await close(server);
  }
});

test("draftAssessment lets request-level total budget expand primary assessment timeout", async () => {
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
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DEEPSEEK_ASSESSMENT_MODEL: "formal-budget-model",
        DEEPSEEK_ASSESSMENT_FALLBACK_MODEL: "formal-budget-model"
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
    assert.equal(result.modelRun.metadata.assessmentTimeoutMs, 270000);
    assert.equal(result.modelRun.metadata.assessmentTotalTimeoutMs, 270000);
  } finally {
    await close(server);
  }
});
