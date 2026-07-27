import assert from "node:assert/strict";
import test from "node:test";
import * as gradingSourcePackage from "./grading-source-package.js";

const { buildGradingSourcePackage } = gradingSourcePackage;

const assignment = {
  id: "assignment-source-1",
  title: "五年级数学计算练习",
  grade: "五年级",
  metadata: {
    subject: "数学",
    kind: "练习",
    totalScore: 10
  },
  items: [
    {
      orderIndex: 1,
      itemType: "calculation",
      prompt: "计算 36 x 4。",
      answer: "144",
      rubric: "列竖式计算。",
      metadata: {
        score: 4,
        analysisSteps: ["先计算个位。", "再计算十位。"],
        knowledgePoint: "两位数乘一位数"
      }
    },
    {
      orderIndex: 2,
      itemType: "calculation",
      prompt: "计算 72 - 18。",
      answer: "54",
      rubric: "注意借位。",
      metadata: {
        score: 6,
        analysisSteps: ["先算个位并借位。", "再算十位。"],
        knowledgePoint: "两位数减法"
      }
    }
  ]
};

test("builds a versioned grading source package from persisted assignment questions", () => {
  const result = buildGradingSourcePackage(assignment);

  assert.equal(result.ok, true);
  assert.equal(result.package.schemaVersion, "junhang-grading-source-v1");
  assert.equal(result.package.sourceId, assignment.id);
  assert.equal(result.package.version, 1);
  assert.equal(result.package.totalScore, 10);
  assert.equal(result.package.questions.length, 2);
  assert.deepEqual(result.package.questions[0], {
    questionNo: "1",
    prompt: "计算 36 x 4。",
    correctAnswer: "144",
    maxScore: 4,
    analysisSteps: ["先计算个位。", "再计算十位。"],
    knowledgePoint: "两位数乘一位数",
    rubric: "列竖式计算。"
  });
  assert.match(result.package.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("uses a deterministic fingerprint for the same canonical source", () => {
  const first = buildGradingSourcePackage(assignment);
  const second = buildGradingSourcePackage({ ...assignment, metadata: { ...assignment.metadata } });

  assert.equal(first.package.fingerprint, second.package.fingerprint);
});

test("rejects a grading source package whose fingerprint no longer matches its content", () => {
  assert.equal(typeof gradingSourcePackage.validateGradingSourcePackage, "function");
  const result = buildGradingSourcePackage(assignment);
  const validation = gradingSourcePackage.validateGradingSourcePackage({
    ...result.package,
    questions: [{ ...result.package.questions[0], correctAnswer: "143" }, result.package.questions[1]]
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("答案包完整性指纹不匹配。"));
});

test("rejects incomplete question answers, scores, and inconsistent total score", () => {
  const result = buildGradingSourcePackage({
    ...assignment,
    metadata: { ...assignment.metadata, totalScore: 12 },
    items: [
      assignment.items[0],
      {
        ...assignment.items[1],
        answer: "",
        metadata: { ...assignment.items[1].metadata, score: 0 }
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("第 2 题缺少标准答案。"));
  assert.ok(result.issues.includes("第 2 题分值必须大于 0。"));
  assert.ok(result.issues.includes("题目分值合计 4 与总分 12 不一致。"));
});
