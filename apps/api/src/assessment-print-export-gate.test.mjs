import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("assessment print export cannot bypass draft review with force", () => {
  const routeStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf('app.post(', routeStart + 1);
  const routeSource = source.slice(routeStart, routeEnd === -1 ? source.length : routeEnd);

  assert.match(routeSource, /metadata\.draftReviewStatus\s*!==\s*"accepted"/);
  assert.doesNotMatch(routeSource, /req\.body\?\.force/);
  assert.doesNotMatch(routeSource, /teacherReviewStatus:\s*metadata\.draftReviewStatus\s*\|\|\s*"accepted"/);
});

test("assessment print layout keeps English four-line estimates compact", () => {
  assert.match(source, /type === "fill" \? 9 : Math\.max\(16, spaceMm\)\) \* 2\.35/);
  assert.match(source, /\.english-four-line div \{ height: 6\.6mm; position: relative; margin-bottom: 0\.8mm; \}/);
  assert.doesNotMatch(source, /type === "fill" \? 16 : spaceMm\) \* 3\.2/);
});

test("learner payload sanitizer recursively removes model escalation internals", () => {
  const start = source.indexOf("function sanitizeLearnerPayload");
  const end = source.indexOf("\n}\n\nfunction teacherStatusToClient", start) + 2;
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const createSanitizer = new Function(
    "normalizeDisplayText",
    `${source.slice(start, end)}; return sanitizeLearnerPayload;`
  );
  const sanitize = createSanitizer((value) => String(value));
  const payload = sanitize({
    score: 5,
    summary: "保留给学生的反馈",
    errorStep: "计算第二步有误",
    referenceAnswer: {
      correctAnswer: "2",
      solAttempted: true,
      usedModelEscalation: true,
      escalationModelRunId: "run-sol",
      escalationPersistenceError: "internal persistence failure",
      attempts: [{ model: "gpt-5.6-sol", reasoningEffort: "high", timeoutMs: 180000 }]
    },
    generationPipeline: {
      model: "gpt-5.6-terra",
      triggerCode: "524",
      tokenBudget: 12000,
      providerId: "gpt56",
      errorCode: "UPSTREAM_TIMEOUT",
      errorMessage: "internal gateway failure"
    }
  });

  assert.equal(payload.score, 5);
  assert.equal(payload.summary, "保留给学生的反馈");
  assert.equal(payload.errorStep, "计算第二步有误");
  assert.equal(payload.referenceAnswer.correctAnswer, "2");
  assert.deepEqual(Object.keys(payload.referenceAnswer), ["correctAnswer"]);
  assert.deepEqual(payload.generationPipeline, {});
});
