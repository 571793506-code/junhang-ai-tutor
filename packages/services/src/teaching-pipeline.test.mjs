import assert from "node:assert/strict";
import test from "node:test";
import { draftAssessmentService, gradeSubmissionService } from "./index.js";
import { draftAssessment, gradeSubmissionText } from "../../ai/src/runtime.js";

function item(prompt = "24+18", itemType = "calculation") {
  return { itemType, prompt, answer: "42", score: 5, analysisSteps: ["分解加数。", "先加整十。", "再合并个位。"], commonMistake: "注意进位。", knowledgePoint: "加法" };
}
const options = (call) => ({ persist: false, teachingExecution: { call } });

test("existing assessment service sends shared rules and preserves focused content without adding a composite paper", async () => {
  const calls = [];
  const result = await draftAssessmentService({}, {
    subject: "数学", kind: "练习", grade: "四年级", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 1,
    requirement: "只练习进位加法", contentContext: { approvedOnly: true, matches: [{ sourceId: "s1", summary: "已批准加法资料" }] },
    rulePack: { text: "forged-rule" }, model: "forged-model"
  }, options(async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ title: "专项计算", sections: [{ title: "计算", items: [item()] }] }), usage: { completion_tokens: 50 } };
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route.model, "gpt-6-astra");
  assert.match(calls[0].messages[0].content, /generation-v1/);
  assert.match(calls[0].messages[1].content, /只练习进位加法/);
  assert.match(calls[0].messages[1].content, /已批准加法资料/);
  assert.doesNotMatch(JSON.stringify(calls), /forged-/);
  assert.equal(result.draftItems.length, 1);
  assert.equal(result.draftItems[0].itemType, "calculation");
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.totalScore, 5);
  assert.equal(result.generationContext.request.purpose, "focused");
});

test("runtime uses at most two concurrent units and one shared additional attempt per unit", async () => {
  const calls = new Map();
  let active = 0;
  let peak = 0;
  const result = await draftAssessment({}, { subject: "数学", purpose: "multi_day", requestedItemTypes: ["calculation"], dayPlan: [
    { dayId: "d1", goal: "加法", requestedItemCount: 1 }, { dayId: "d2", goal: "加法", requestedItemCount: 1 }, { dayId: "d3", goal: "加法", requestedItemCount: 1 }
  ] }, { call: async (route, messages) => {
    const input = JSON.parse(messages[1].content);
    const id = input.partition.dayId;
    calls.set(id, [...(calls.get(id) || []), route.model]);
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (calls.get(id).length === 1) return { text: "{}", usage: { completion_tokens: 1 } };
    return { text: JSON.stringify({ title: "多日", sections: [{ title: id, items: [item(id)] }] }), usage: { completion_tokens: 30 } };
  } });
  assert.equal(result.available, true);
  assert.ok(peak <= 2);
  assert.equal(calls.size, 3);
  for (const models of calls.values()) assert.deepEqual(models, ["gpt-6-astra", "gpt-6-astra"]);
  assert.deepEqual(JSON.parse(result.draftText).sections.map((section) => section.dayId), ["d1", "d2", "d3"]);
});

test("grading service sends unresolved subjective questions only and never appends service-level reviews", async () => {
  const calls = [];
  const result = await gradeSubmissionService({ GPT56_SOL_FALLBACK_ENABLED: "true", GRADING_DEEP_AUDIT_ENABLED: "true" }, {
    subject: "数学", grade: "四年级", totalScore: 10,
    referenceAnswers: [{ questionNo: "1", prompt: "选择", correctAnswer: "A", score: 5, confidence: 1 }, { questionNo: "2", prompt: "说明理由", correctAnswer: "交换加数和不变", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "选择", studentAnswer: "A", confidence: 1 }, { questionNo: "2", printedPrompt: "说明理由", studentAnswer: "交换两个数仍是同一个和", confidence: 0.95 }]
  }, { ...options(async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ score: 999, summary: "复核草稿", questionResults: [{ questionNo: "2", status: "partial", score: 3, maxScore: 5, studentAnswer: "交换两个数仍是同一个和", correctAnswer: "交换加数和不变", explanation: "思路正确但未说明适用条件。", confidence: 0.95 }] }), usage: { completion_tokens: 20 } };
  }), gradingReviewers: { premium: () => { throw new Error("No third review"); } }, solGradingRunner: () => { throw new Error("No service retry"); } });
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(sent.ocrQuestions.map((q) => q.questionNo), ["2"]);
  assert.equal(result.structured.score, 8);
  assert.equal(result.structured.archiveEligible, false);
});

test("uncertain score stays null and a missing student answer is never inferred from a printed prompt", async () => {
  const result = await gradeSubmissionText({}, {
    ocrQuestions: [{ questionNo: "1", printedPrompt: "1+1=2", studentAnswer: "", confidence: 0.3 }],
    referenceAnswers: [{ questionNo: "1", correctAnswer: "2", score: 5 }]
  }, { call: async () => { throw new Error("Must not call a model without student evidence"); } });
  assert.equal(result.available, false);
  const graded = await gradeSubmissionService({}, {
    subject: "数学", totalScore: 5, referenceAnswers: [{ questionNo: "1", correctAnswer: "说明理由", score: 5 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "说明理由", studentAnswer: "看不清", confidence: 0.3 }]
  }, options(async () => ({ text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "uncertain", score: null, maxScore: 5, explanation: "字迹不清", confidence: 0.3 }] }) })));
  assert.equal(graded.structured.questionResults[0].score, null);
  assert.equal(graded.structured.score, null);
});

test("service validates multiple focused types without adding or losing other partitions", async () => {
  const result = await draftAssessmentService({}, {
    subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requestedItemTypes: ["fill", "calculation"], requestedItemCount: 2
  }, options(async (_route, messages) => {
    const type = JSON.parse(messages[1].content).partition.itemTypes[0];
    return { text: JSON.stringify({ title: "专项", sections: [{ title: type, items: [item("24+18", type)] }] }) };
  }));
  assert.equal(result.audit.passed, true);
  assert.deepEqual(result.draftItems.map((q) => q.itemType), ["fill", "calculation"]);
});

test("service rejects injected incomplete focused output and explanation does not require exam assets", async () => {
  const bad = await draftAssessmentService({}, { subject: "数学", grade: "四年级", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 2 }, {
    persist: false, assessmentDraftRunner: async () => ({ available: true, draftText: JSON.stringify({ title: "缺题", sections: [{ title: "计算", items: [item()] }] }) })
  });
  assert.equal(bad.audit.passed, false); assert.equal(bad.generationPipeline.gates.finalExportAllowed, false);
  const explained = await draftAssessmentService({}, { subject: "数学", grade: "四年级", purpose: "explanation" }, options(async () => ({
    text: JSON.stringify({ title: "加法讲解", explanation: { concept: "相同单位数量相加", steps: ["数位对齐"], workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: ["合并数量"] }], commonMistakes: ["数位错位"] } })
  })));
  assert.equal(explained.audit.passed, true);
  assert.equal(explained.generationPipeline.gates.draftPdfRequired, false);
  assert.equal(explained.generationPipeline.gates.gradingSourcePackageRequired, false);
  assert.equal(explained.generationPipeline.gates.teacherReviewRequired, true);
  assert.deepEqual(explained.generationPipeline.print.requiredAssets, []);
});
