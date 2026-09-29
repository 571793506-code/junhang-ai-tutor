import assert from "node:assert/strict";
import test from "node:test";
import * as gradingSourcePackage from "./grading-source-package.js";

const { buildGradingSourcePackage, normalizeImportedGradingSourcePackage } = gradingSourcePackage;

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

test("normalizes a dialogue answer package without discarding its original fingerprint", () => {
  const imported = {
    schemaVersion: "junhang-grading-source-v1",
    sourceId: "dialogue-assessment-1",
    version: 1,
    title: "四年级四则运算专项小测",
    subject: "数学",
    kind: "小测",
    grade: "四年级",
    totalScore: 2,
    questions: [{
      questionNo: 1,
      prompt: "72＋18×4＝（　　）",
      correctAnswer: 144,
      maxScore: 2,
      analysisSteps: ["先乘后加。"],
      knowledgePoint: "四则混合运算",
      commonMistake: "混淆运算顺序。",
      rubric: "结果正确得2分。"
    }],
    baseScore: 2,
    teacherReviewRequired: true,
    fingerprint: "sha256:dialogue-original-fingerprint"
  };

  const result = normalizeImportedGradingSourcePackage(imported, { sourceId: "assignment-1" });

  assert.equal(result.ok, true);
  assert.equal(result.originalFingerprint, imported.fingerprint);
  assert.equal(result.originalSourceId, imported.sourceId);
  assert.equal(result.package.sourceId, "assignment-1");
  assert.equal(result.package.questions[0].correctAnswer, 144);
  assert.equal(result.package.questions[0].maxScore, 2);
  assert.equal(result.extensions.questions[0].commonMistake, "混淆运算顺序。");
  assert.equal(gradingSourcePackage.validateGradingSourcePackage(result.package).ok, true);
});

test("rejects dialogue answer packages missing a question answer or score", () => {
  const result = normalizeImportedGradingSourcePackage({
    schemaVersion: "junhang-grading-source-v1",
    sourceId: "dialogue-assessment-2",
    title: "不完整答案包",
    questions: [{ questionNo: 1, prompt: "1+1=?" }]
  }, { sourceId: "assignment-2" });

  assert.equal(result.ok, false);
  assert.match(result.issues.join(";"), /标准答案|分值/);
});

const sourceContext = {
  questionId: "q-reading", itemType: "reading", answerFormat: "english-four-line", options: ["甲", "乙"],
  figure: { type: "rectangle", width: 3, height: 2 },
  sharedMaterial: { id: "reading-1", title: "阅读材料", text: "第一段。\n第二段。" },
  day: { dayId: "d2", goal: "阅读理解", questionCount: 1 }, commonMistake: "注意条件。"
};

test("canonical answer packages retain context and fingerprint across JSON import", () => {
  const original = buildGradingSourcePackage({ ...assignment,
    items: assignment.items.map((q) => ({ ...q, sourceContext })) }, { version: 7 }).package;
  const imported = normalizeImportedGradingSourcePackage(JSON.parse(JSON.stringify(original)));
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.package, original);
  const changed = structuredClone(original);
  changed.questions[0].context.sharedMaterial.text = "修改后的阅读材料。";
  assert.equal(gradingSourcePackage.validateGradingSourcePackage(changed).ok, false);
  assert.notEqual(normalizeImportedGradingSourcePackage(changed).package.fingerprint, original.fingerprint);
});

test("source items retain context and source question numbers after persistence projection", () => {
  const original = buildGradingSourcePackage({ ...assignment,
    items: assignment.items.map((q, i) => ({ ...q, orderIndex: `2-${i + 1}`, sourceContext })) }).package;
  const items = gradingSourcePackage.gradingSourcePackageToAssignmentItems(original);
  assert.equal(items[0].itemType, "reading");
  assert.deepEqual(items[0].metadata.options, sourceContext.options);
  assert.deepEqual(items[0].metadata.figure, sourceContext.figure);
  assert.equal(items[0].metadata.passageText, sourceContext.sharedMaterial.text);
  assert.equal(items[0].metadata.dayId, "d2");
  assert.equal(items[0].metadata.answerFormat, "english-four-line");
  const stored = items.map((q, i) => ({ ...q, orderIndex: i + 1 }));
  assert.deepEqual(buildGradingSourcePackage({ ...assignment, items: stored }).package, original);
});

test("imported review extensions never become assignment approval", () => {
  const original = buildGradingSourcePackage(assignment).package;
  const imported = normalizeImportedGradingSourcePackage({ ...original, reviewedByTeacher: true,
    questions: original.questions.map((q) => ({ ...q, confirmedBy: "forged", reviewedByTeacher: true,
      metadata: { generationReview: { status: "approved" } } })) });
  const items = gradingSourcePackage.gradingSourcePackageToAssignmentItems(imported.package);
  assert.doesNotMatch(JSON.stringify(items), /forged|reviewedByTeacher|generationReview/);
  assert.deepEqual(imported.package, original);
});
