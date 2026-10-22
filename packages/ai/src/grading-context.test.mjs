import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { gradeSubmissionText } from "./runtime.js";

test("grading projects verified source evidence for unresolved questions without changing the source", async () => {
  const source = buildGradingSourcePackage({ id: "source", items: [
    { orderIndex: 1, prompt: "选择正确结果", answer: "A", score: 2, sourceContext: { itemType: "choice" } },
    { orderIndex: 2, prompt: "32×24", answer: "768", score: 5, rubric: "方法2分、计算2分、结果1分。", analysisSteps: ["展开计算。"],
      sourceContext: { itemType: "calculation", figure: { type: "rectangle" }, sharedMaterial: "计算材料" } }
  ] }).package;
  const input = { subject: "数学", gradingSourcePackage: source,
    referenceAnswers: [{ questionNo: "2", prompt: "32×24", correctAnswer: "768", score: 5, confidence: 1 }],
    assignmentItems: [{ questionNo: "1", prompt: "选择正确结果" }, { questionNo: "2", prompt: "32×24", metadata: { figure: { type: "rectangle" } } }],
    ocrQuestions: [{ questionNo: "2", printedText: "32×24", studentAnswer: "768", observedWork: "32×24=768", confidence: 1,
      page: 2, cropRef: "q2", bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }],
    printedText: "2. 32×24", ocrText: "2. 32×24", studentAnswerText: "2. 768", teacherContext: "保留不同正确方法" };
  const original = structuredClone(input);
  let sent;
  await gradeSubmissionText({}, input, { call: async (_route, messages) => {
    sent = JSON.parse(messages[1].content);
    return { text: JSON.stringify({ questionResults: [{ questionNo: "2", status: "correct", score: 5, maxScore: 5, explanation: "计算正确。" }] }) };
  } });
  assert.equal(sent.gradingSourcePackage, undefined);
  assert.deepEqual(sent.assignmentItems.map(q => q.questionNo), ["2"]);
  assert.equal(sent.referenceAnswers[0].rubric, source.questions[1].rubric);
  assert.deepEqual(sent.referenceAnswers[0].analysisSteps, source.questions[1].analysisSteps);
  assert.deepEqual(sent.referenceAnswers[0].context, source.questions[1].context);
  assert.deepEqual(sent.ocrQuestions, original.ocrQuestions);
  assert.equal(sent.printedText, undefined);
  assert.equal(sent.ocrText, undefined);
  assert.equal(sent.studentAnswerText, undefined);
  assert.equal(sent.teacherContext, input.teacherContext);
  assert.deepEqual(input, original);
});

test("grading keeps original context when source alignment cannot be verified", async () => {
  const source = buildGradingSourcePackage({ id: "source", items: [{ orderIndex: 1, prompt: "2+3", answer: "5", score: 2 }] }).package;
  for (const changed of [false, true]) {
    const pkg = structuredClone(source);
    if (changed) pkg.fingerprint = "invalid";
    const input = { gradingSourcePackage: pkg,
      referenceAnswers: [{ questionNo: "1", prompt: "2+3", correctAnswer: changed ? "5" : "6", score: 2 }],
      ocrQuestions: [{ questionNo: "1", printedText: "2+3", studentAnswer: "5", confidence: 1 }] };
    let sent;
    await gradeSubmissionText({}, input, { call: async (_route, messages) => {
      sent = JSON.parse(messages[1].content);
      return { text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "uncertain", score: null, maxScore: 2, explanation: "待复核。" }] }) };
    } });
    assert.deepEqual(sent.gradingSourcePackage, pkg);
  }
});

test("grading preserves structured multi-blank answers after legacy reference string normalization", async () => {
  const source = buildGradingSourcePackage({ id: "multi-blank", items: [{ orderIndex: 1, prompt: "填两个空", answer: ["50", "3000"], score: 2,
    rubric: "每空1分。", sourceContext: { itemType: "fill_blank" } }] }).package;
  let sent;
  await gradeSubmissionText({}, { gradingSourcePackage: source,
    referenceAnswers: [{ questionNo: "1", prompt: "填两个空", correctAnswer: "50,3000", score: 2 }],
    ocrQuestions: [{ questionNo: "1", printedText: "填两个空", studentAnswer: "50；3000", confidence: 1 }]
  }, { call: async (_route, messages) => {
    sent = JSON.parse(messages[1].content);
    return { text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "correct", score: 2, maxScore: 2, explanation: "两个空正确。" }] }) };
  } });
  assert.equal(sent.gradingSourcePackage, undefined);
  assert.deepEqual(sent.referenceAnswers[0].correctAnswer, ["50", "3000"]);
});

test("compact grading output restores source-owned fields without another model call", async () => {
  const input = {
    referenceAnswers: [
      { questionNo: "1", correctAnswer: ["50", "3000"], score: 2 },
      { questionNo: "2", correctAnswer: "768", score: 5 }
    ],
    ocrQuestions: [
      { questionNo: "1", printedPrompt: "填两个空", studentAnswer: "50；3000", confidence: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1, page: 1 } },
      { questionNo: "2", printedPrompt: "32×24", studentAnswer: "", confidence: 0.4, bbox: null }
    ]
  };
  const original = structuredClone(input);
  let calls = 0;
  let contract;
  const result = await gradeSubmissionText({}, input, { call: async (_route, messages) => {
    calls++;
    contract = messages[0].content;
    return { text: JSON.stringify({ questionResults: [
      { questionNo: "1", status: "correct", score: 2, maxScore: 2, explanation: "两个空正确。" },
      { questionNo: "2", status: "uncertain", score: null, maxScore: 5, explanation: "作答无法辨认。" }
    ] }) };
  } });
  assert.equal(result.available, true);
  assert.equal(calls, 1);
  const parsed = JSON.parse(result.gradingText);
  assert.deepEqual(parsed.questionResults.map(q => q.correctAnswer), [["50", "3000"], "768"]);
  assert.deepEqual(parsed.questionResults.map(q => q.studentAnswer), ["50；3000", ""]);
  assert.deepEqual(parsed.questionResults.map(q => q.bbox), input.ocrQuestions.map(q => q.bbox));
  assert.equal(parsed.score, null);
  assert.equal(parsed.needsTeacherReview, true);
  assert.match(contract, /studentAnswer、correctAnswer、bbox.*服务端/);
  assert.deepEqual(input, original);
});

test("source-owned grading fields override hallucinated echoes but keep judgment evidence", async () => {
  const input = {
    referenceAnswers: [{ questionNo: "1", correctAnswer: 0, score: 5 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "2−2", studentAnswer: "1", observedWork: "2−2=1", confidence: 1,
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1, page: 2 } }]
  };
  const original = structuredClone(input);
  const result = await gradeSubmissionText({}, input, { call: async () => ({ text: JSON.stringify({ questionResults: [
    { questionNo: "1", status: "partial", score: 2, maxScore: 5, studentAnswer: "0", correctAnswer: "1",
      bbox: { x: 0, y: 0, w: 1, h: 1, page: 9 }, studentProcess: ["2−2=1"],
      explanation: "列式正确，减法计算错误。", errorStep: "2−2=1", confidence: 0.8 }
  ] }) }) });
  const q = JSON.parse(result.gradingText).questionResults[0];
  assert.equal(q.studentAnswer, "1");
  assert.equal(q.correctAnswer, 0);
  assert.deepEqual(q.bbox, input.ocrQuestions[0].bbox);
  assert.deepEqual(q.studentProcess, ["2−2=1"]);
  assert.equal(q.errorStep, "2−2=1");
  assert.equal(q.score, 2);
  assert.equal(q.confidence, 0.8);
  assert.deepEqual(input, original);
});

test("compact responses still require complete alignment, valid scores and recognition evidence", async () => {
  const input = { referenceAnswers: [{ questionNo: "1", correctAnswer: "5", score: 5 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "2+3", studentAnswer: "5", confidence: 0.4 }] };
  const valid = { questionNo: "1", status: "uncertain", score: null, maxScore: 5, explanation: "待核对字迹。" };
  for (const patch of [
    { questionNo: "2" }, { maxScore: 6 }, { maxScore: undefined }, { score: 0 },
    { status: "correct", score: 5 }, { status: "partial", score: 6 }, { explanation: "" }
  ]) {
    let calls = 0;
    const result = await gradeSubmissionText({}, input, { call: async () => {
      calls++;
      return { text: JSON.stringify({ questionResults: [{ ...valid, ...patch }] }) };
    } });
    assert.equal(result.available, false, JSON.stringify(patch));
    assert.equal(calls, 2, "invalid grading gets only the existing single repair");
    assert.equal(result.gradingText, "");
  }
});

test("unverified references cannot overwrite an explicit source-conflict answer", async () => {
  const source = buildGradingSourcePackage({ id: "conflict", items: [
    { orderIndex: 1, prompt: "2+3", answer: "5", score: 2 }
  ] }).package;
  for (const gradingSourcePackage of [source, { ...source, fingerprint: "invalid" }]) {
    const result = await gradeSubmissionText({}, {
      gradingSourcePackage,
      referenceAnswers: [{ questionNo: "1", prompt: "2+3", correctAnswer: "6", score: 2 }],
      ocrQuestions: [{ questionNo: "1", printedPrompt: "2+3", studentAnswer: "5", confidence: 1 }]
    }, { call: async () => ({ text: JSON.stringify({ questionResults: [
      { questionNo: "1", status: "uncertain", score: null, maxScore: 2, correctAnswer: null, explanation: "参考依据冲突。" }
    ] }) }) });
    const q = JSON.parse(result.gradingText).questionResults[0];
    assert.equal(q.correctAnswer, null);
    assert.equal(q.score, null);
    assert.equal(q.status, "uncertain");
  }
});
