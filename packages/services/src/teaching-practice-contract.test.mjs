import assert from "node:assert/strict";
import test from "node:test";
import { draftAssessmentService, gradeSubmissionService } from "./index.js";
import { buildPracticeStageCases, buildCarryForwardCase } from "../../../scripts/test-support/teaching-practice-cases.mjs";
import { loadTeachingRulePack } from "../../ai/src/teaching-rules.js";

test("all practice stages preserve teacher scope, counts and evidence through the shared service and current rules", async () => {
  const rules = await loadTeachingRulePack("generation");
  const signals = [{ type: "unresolved_mistake", ref: "synthetic-history:1", subject: "数学", knowledgePoint: "乘法进位",
    prompt: "48×6－137", studentAnswer: "191", correctAnswer: "151", cause: "合成历史证据，不证明当前掌握程度" }];
  for (const { request } of buildPracticeStageCases()) {
    let calls = 0;
    const result = await draftAssessmentService({}, { ...request, studentSignals: signals }, { persist: false,
      teachingExecution: { call: async (_route, messages) => {
        calls++;
        assert.ok(messages[0].content.includes(rules.text));
        const payload = JSON.parse(messages[1].content);
        assert.equal(payload.requirement, request.requirement);
        assert.equal(payload.generationContext.request.requirement, request.requirement);
        assert.equal(payload.partition.targetItemCount, 4);
        assert.deepEqual(payload.studentSignals, payload.generationContext.studentSignals);
        assert.equal(payload.studentSignals[0].ref, signals[0].ref);
        return { text: JSON.stringify({ title: "四年级数学计算专项练习", sections: [{ title: "计算", items: Array.from({ length: 4 }, (_, i) => ({
          itemType: "calculation", prompt: `${57 + i}×4－128`, answer: String((57 + i) * 4 - 128), score: 5,
          rubric: "乘法正确得2分；减法正确得2分；运算关系正确得1分。", analysisSteps: ["先乘后减。"], knowledgePoint: "四则运算", commonMistake: "注意进位。"
        })) }] }) };
      } } });
    assert.equal(calls, 1);
    assert.equal(result.usedDynamicFallback, false);
    assert.equal(result.draftItems.length, 4);
    assert.equal(result.audit.passed, true);
  }
});

test("carry-forward scoring preserves source rubrics and visible work, including an unresolved legacy rubric", async () => {
  const { input, cases } = buildCarryForwardCase();
  const before = structuredClone(input);
  const rules = await loadTeachingRulePack("grading");
  let calls = 0;
  const result = await gradeSubmissionService({}, input, { persist: false, teachingExecution: { call: async (_route, messages) => {
    calls++;
    assert.ok(messages[0].content.includes(rules.text));
    const payload = JSON.parse(messages[1].content);
    for (const q of input.ocrQuestions) assert.equal(payload.ocrQuestions.find((p) => p.questionNo === q.questionNo).observedWork, q.observedWork);
    for (const q of input.assignmentItems) assert.equal(payload.assignmentItems.find((p) => p.questionNo === q.questionNo).rubric, q.rubric);
    return { text: JSON.stringify({ questionResults: cases.map((q) => ({ questionNo: q.questionNo,
      studentAnswer: q.answer, correctAnswer: "100", score: q.expectedScore, maxScore: 5,
      status: q.expectedScore === null ? "uncertain" : q.expectedScore === 5 ? "correct" : q.expectedScore === 0 ? "wrong" : "partial",
      explanation: q.reason, confidence: 1
    })) }) };
  } } });
  assert.equal(calls, 1);
  assert.deepEqual(input, before);
  for (const q of cases) assert.equal(result.structured.questionResults.find((p) => p.questionNo === q.questionNo).score, q.expectedScore);
  assert.equal(result.structured.questionResults.find((q) => q.questionNo === "6").status, "uncertain");
});

test("contradictory result-only full credit is rejected through bounded service repair", async () => {
  let calls = 0;
  const result = await draftAssessmentService({}, { ...buildPracticeStageCases()[0].request, requestedItemCount: 1 }, {
    persist: false, teachingExecution: { call: async () => {
      calls++;
      return { text: JSON.stringify({ title: "计算专项", sections: [{ title: "计算", items: [{ itemType: "calculation", prompt: "76×4",
        answer: "304", score: 5, rubric: "方法2分。计算2分。最终答案1分。只写正确结果304且无过程，得5分。",
        analysisSteps: ["先计算个位再进位，得304。"], knowledgePoint: "乘法进位", commonMistake: "漏加进位。" }] }] }) };
    } }
  });
  assert.equal(calls, 2);
  assert.notEqual(result.audit?.passed, true);
  assert.match(JSON.stringify(result.modelRun?.metadata), /rubric_process_conflict/);
});
