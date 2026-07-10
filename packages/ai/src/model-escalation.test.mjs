import assert from "node:assert/strict";
import test from "node:test";
import * as modelEscalation from "./model-escalation.js";
import {
  classifySolEscalationError,
  describeModelError,
  solEscalationEnabled
} from "./model-escalation.js";

const validateAssessmentPartition = modelEscalation.validateAssessmentPartition || (() => ({
  valid: true,
  codes: [],
  issues: []
}));

test("assessment partition validation reports missing sections and items", () => {
  const partition = { id: "foundation", itemTypes: ["fill", "choice"] };

  const empty = validateAssessmentPartition({ sections: [] }, partition);
  assert.equal(empty.valid, false);
  assert.ok(empty.codes.includes("missing_sections"));
  assert.ok(empty.codes.includes("missing_items"));
  assert.ok(empty.issues.includes("partition:foundation:missing_sections"));
  assert.ok(empty.issues.includes("partition:foundation:missing_items"));

  const noItems = validateAssessmentPartition({ sections: [{ title: "基础", items: [] }] }, partition);
  assert.equal(noItems.valid, false);
  assert.deepEqual(noItems.codes, ["missing_items"]);
  assert.deepEqual(noItems.issues, ["partition:foundation:missing_items"]);
});

test("assessment partition validation rejects disallowed and incomplete items once", () => {
  const result = validateAssessmentPartition({
    sections: [
      {
        items: [
          { itemType: "writing", prompt: "写作", answer: "示例", analysisSteps: ["审题。"], knowledgePoint: "表达" },
          { itemType: "fill", prompt: "", answer: "", analysisSteps: [], commonMistake: "" },
          { itemType: "fill", prompt: "第二题", answer: "", analysisSteps: [], knowledgePoint: "" }
        ]
      }
    ]
  }, { id: "language", itemTypes: ["fill", "choice"] });

  assert.equal(result.valid, false);
  assert.deepEqual(result.codes, ["disallowed_item_type", "incomplete_item"]);
  assert.deepEqual(result.issues, [
    "partition:language:disallowed_item_type",
    "partition:language:incomplete_item"
  ]);
});

test("assessment partition validation accepts complete allowed items", () => {
  assert.deepEqual(validateAssessmentPartition({
    sections: [
      {
        items: [
          {
            itemType: "fill",
            prompt: "1 + 1 = ?",
            answer: "2",
            analysisSteps: ["计算两个一相加。"],
            commonMistake: "不要漏写答案。"
          }
        ]
      }
    ]
  }, { id: "foundation", itemTypes: ["fill"] }), {
    valid: true,
    codes: [],
    issues: []
  });
});

test("assessment partition validation rejects missing or blank item types", () => {
  const result = validateAssessmentPartition({
    sections: [
      {
        items: [
          {
            prompt: "缺少题型",
            answer: "答案",
            analysisSteps: ["分析。"],
            knowledgePoint: "考点"
          },
          {
            itemType: "   ",
            prompt: "空白题型",
            answer: "答案",
            analysisSteps: ["分析。"],
            commonMistake: "易错点"
          }
        ]
      }
    ]
  }, { id: "foundation", itemTypes: ["fill"] });

  assert.equal(result.valid, false);
  assert.deepEqual(result.codes, ["missing_item_type"]);
  assert.deepEqual(result.issues, ["partition:foundation:missing_item_type"]);
});

test("assessment partition validation accepts numeric and boolean answers", () => {
  const result = validateAssessmentPartition({
    sections: [
      {
        items: [
          {
            itemType: "fill",
            prompt: "零是自然数吗？",
            answer: 0,
            analysisSteps: ["识别数值。"],
            knowledgePoint: "自然数"
          },
          {
            itemType: "fill",
            prompt: "该判断是否正确？",
            answer: false,
            analysisSteps: ["判断命题。"],
            commonMistake: "不要把布尔值当成缺失。"
          }
        ]
      }
    ]
  }, { id: "foundation", itemTypes: ["fill"] });

  assert.deepEqual(result, { valid: true, codes: [], issues: [] });
});

test("assessment partition validation rejects null and blank-string answers", () => {
  const result = validateAssessmentPartition({
    sections: [
      {
        items: [
          {
            itemType: "fill",
            prompt: "缺少答案",
            answer: null,
            analysisSteps: ["分析。"],
            knowledgePoint: "考点"
          },
          {
            itemType: "fill",
            prompt: "空白答案",
            answer: "   ",
            analysisSteps: ["分析。"],
            commonMistake: "易错点"
          }
        ]
      }
    ]
  }, { id: "foundation", itemTypes: ["fill"] });

  assert.equal(result.valid, false);
  assert.deepEqual(result.codes, ["incomplete_item"]);
});

test("describeModelError preserves structured error details", () => {
  assert.deepEqual(
    describeModelError({
      message: "524 upstream timeout",
      status: 524,
      code: "upstream_timeout"
    }),
    {
      message: "524 upstream timeout",
      status: 524,
      code: "upstream_timeout"
    }
  );

  assert.deepEqual(describeModelError(new Error("503 service unavailable")), {
    message: "503 service unavailable",
    status: 503,
    code: null
  });
});

test("describeModelError preserves a nested fetch cause code", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
  });

  assert.deepEqual(describeModelError(error), {
    message: "fetch failed",
    status: null,
    code: "UND_ERR_SOCKET"
  });
});

test("Sol escalation only allows whitelisted nested fetch failures", () => {
  for (const code of [
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT"
  ]) {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("upstream connection failed"), { code })
    });

    assert.deepEqual(classifySolEscalationError(error), {
      allowed: true,
      triggerClass: "availability",
      triggerCode: code
    });
  }

  const configurationError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("invalid request argument"), { code: "UND_ERR_INVALID_ARG" })
  });
  assert.deepEqual(classifySolEscalationError(configurationError), {
    allowed: false,
    triggerClass: "configuration",
    triggerCode: "UND_ERR_INVALID_ARG"
  });
});

test("Sol escalation distinguishes transient failures from configuration failures", () => {
  const cases = [
    [{ message: "MODEL_TIMEOUT after 90000ms" }, true, "availability", "network"],
    [{ status: 524, message: "upstream timeout" }, true, "availability", "524"],
    [
      { status: 429, code: "rate_limit_exceeded", message: "temporary rate limit" },
      true,
      "availability",
      "rate_limit_exceeded"
    ],
    [
      { status: 429, code: "server_capacity", message: "temporary capacity exhausted" },
      true,
      "availability",
      "server_capacity"
    ],
    [
      { status: 429, code: "concurrency_exceeded", message: "temporary concurrency limit" },
      true,
      "availability",
      "concurrency_exceeded"
    ],
    [{ status: 429, message: "上游临时限流" }, true, "availability", "429"],
    [{ code: "ECONNRESET", message: "socket reset" }, true, "availability", "ECONNRESET"],
    [
      { status: 401, code: "invalid_api_key", message: "authentication failed" },
      false,
      "configuration",
      "invalid_api_key"
    ],
    [
      { status: 400, code: "invalid_request_error", message: "invalid request" },
      false,
      "configuration",
      "invalid_request_error"
    ],
    [
      { status: 400, code: "context_length_exceeded", message: "too long" },
      false,
      "configuration",
      "context_length_exceeded"
    ],
    [
      { status: 429, code: "insufficient_quota", message: "quota exhausted" },
      false,
      "configuration",
      "insufficient_quota"
    ],
    [{ status: 429, message: "request rejected" }, false, "configuration", "429"]
  ];

  for (const [error, allowed, triggerClass, triggerCode] of cases) {
    assert.deepEqual(classifySolEscalationError(error), {
      allowed,
      triggerClass,
      triggerCode
    });
  }
});

test("Sol escalation treats account-level 429 limits as configuration failures", () => {
  const cases = [
    { code: "quota_exceeded", message: "quota limit reached" },
    { code: "usage_limit_reached", message: "monthly usage limit reached" },
    { code: "spending_limit_reached", message: "spending limit reached" },
    { code: "plan_limit_reached", message: "upgrade your plan to increase limits" },
    { code: "subscription_limit_reached", message: "subscription rate limit reached" }
  ];

  for (const error of cases) {
    assert.deepEqual(classifySolEscalationError({ status: 429, ...error }), {
      allowed: false,
      triggerClass: "configuration",
      triggerCode: error.code
    });
  }
});

test("Sol escalation only allows explicitly classified upstream parse failures", () => {
  assert.deepEqual(
    classifySolEscalationError({
      status: 200,
      code: "invalid_upstream_response",
      message: "Invalid upstream response: unexpected HTML"
    }),
    {
      allowed: true,
      triggerClass: "availability",
      triggerCode: "invalid_upstream_response"
    }
  );

  assert.deepEqual(classifySolEscalationError(new SyntaxError("Unexpected token '<'")), {
    allowed: false,
    triggerClass: "configuration",
    triggerCode: "configuration"
  });
});

test("Sol escalation requires fallback, reasoning effort, and a model", () => {
  const enabled = {
    gpt56SolFallbackEnabled: true,
    gpt56ReasoningEffortEnabled: true,
    gpt56SolModel: "gpt-5.6-sol"
  };

  assert.equal(solEscalationEnabled(enabled), true);
  assert.equal(solEscalationEnabled({ ...enabled, gpt56SolFallbackEnabled: false }), false);
  assert.equal(solEscalationEnabled({ ...enabled, gpt56ReasoningEffortEnabled: false }), false);
  assert.equal(solEscalationEnabled({ ...enabled, gpt56SolModel: "" }), false);
});
