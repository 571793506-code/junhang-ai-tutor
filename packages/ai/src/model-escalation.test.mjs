import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySolEscalationError,
  describeModelError,
  solEscalationEnabled
} from "./model-escalation.js";

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
