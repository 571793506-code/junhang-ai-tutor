import assert from "node:assert/strict";
import test from "node:test";
import { validateGradingGoldCases } from "./quality-gold-contract.mjs";

function validCase(overrides = {}) {
  return {
    caseId: "synthetic-generated-1",
    sourceType: "generated_assessment",
    input: {
      subject: "数学",
      kind: "练习",
      questionLayoutManifest: {
        questions: [{ questionNo: "1", prompt: "1+1=", correctAnswer: "2", maxScore: 5 }]
      },
      ocrQuestions: [{ questionNo: "1", printedPrompt: "1+1=", studentAnswer: "2", confidence: 0.98 }]
    },
    expected: {
      score: 5,
      needsTeacherReview: false,
      questionResults: [{ questionNo: "1", status: "correct", studentAnswer: "2", correctAnswer: "2" }]
    },
    teacherReview: {
      confirmedBy: "synthetic-teacher",
      confirmedAt: "2026-09-07T00:00:00.000Z",
      modifiedQuestionNos: []
    },
    ...overrides
  };
}

test("gold contract normalizes a teacher-confirmed case without mutating input", () => {
  const input = [validCase()];
  const result = validateGradingGoldCases(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.normalizedCases[0].caseId, "synthetic-generated-1");
  assert.equal(result.normalizedCases[0].teacherReview.confirmedAt, "2026-09-07T00:00:00.000Z");
  assert.notStrictEqual(result.normalizedCases[0], input[0]);
  assert.equal(input[0].teacherReview.confirmedAt, "2026-09-07T00:00:00.000Z");
});

test("gold contract rejects missing teacher confirmation fields", () => {
  const result = validateGradingGoldCases([validCase({
    teacherReview: { modifiedQuestionNos: [] }
  })]);

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /confirmedBy/);
  assert.match(result.issues.join("\n"), /confirmedAt/);
});

test("gold contract rejects duplicate cases, invalid statuses, and uncertain answers without reasons", () => {
  const result = validateGradingGoldCases([
    validCase({
      expected: {
        questionResults: [
          { questionNo: "1", status: "pending", correctAnswer: "2" },
          { questionNo: "2", status: "uncertain" }
        ]
      }
    }),
    validCase()
  ]);

  assert.equal(result.ok, false);
  const issues = result.issues.join("\n");
  assert.match(issues, /duplicate caseId/);
  assert.match(issues, /invalid status/);
  assert.match(issues, /uncertain.*reason/i);
});

test("gold contract rejects missing answer evidence and invalid confirmation time", () => {
  const result = validateGradingGoldCases([validCase({
    expected: {
      questionResults: [{ questionNo: "1", status: "wrong" }]
    },
    teacherReview: {
      confirmedBy: "teacher-1",
      confirmedAt: "not-a-date",
      modifiedQuestionNos: []
    }
  })]);

  assert.equal(result.ok, false);
  const issues = result.issues.join("\n");
  assert.match(issues, /teacher-confirmed answer/);
  assert.match(issues, /confirmedAt/);
});
