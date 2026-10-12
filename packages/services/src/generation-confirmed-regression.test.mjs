import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { draftAssessmentService } from "./index.js";
import { assessmentScoreIssues } from "@junhang/core";

const fixture = JSON.parse(fs.readFileSync(new URL("../../../fixtures/quality/generation-confirmed-calculation.json", import.meta.url), "utf8"));

test("shared generation preserves the reviewed four-question scope and rubrics without publishing", async () => {
  const original = structuredClone(fixture);
  const input = { ...fixture.request, requirement: fixture.request.requirement + "保留给定四题及逐题评分口径。" };
  let calls = 0;
  const result = await draftAssessmentService({}, input, { persist: false, teachingExecution: {
    call: async (_route, messages) => {
      calls++;
      const modelInput = JSON.parse(messages[1].content);
      assert.equal(modelInput.requirement, input.requirement);
      assert.equal(modelInput.generationContext.request.requirement, input.requirement);
      assert.equal(modelInput.partition.targetItemCount, fixture.request.requestedItemCount);
      return { text: JSON.stringify({ title: fixture.content.title, sections: [{ title: "计算", items: fixture.content.questions }] }) };
    }
  } });
  assert.equal(calls, 1);
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.audit.passed, true);
  assert.equal(result.draftItems.length, 4);
  assert.equal(result.totalScore, 20);
  for (const [index, actual] of result.draftItems.entries()) {
    const reviewed = fixture.content.questions[index];
    assert.equal(actual.prompt, reviewed.prompt);
    assert.equal(actual.answer, reviewed.answer);
    assert.equal(actual.metadata.score, reviewed.score);
    assert.equal(actual.rubric, reviewed.rubric);
    assert.deepEqual(actual.metadata.analysisSteps, reviewed.analysisSteps);
    assert.deepEqual(assessmentScoreIssues({ ...actual, ...actual.metadata }), []);
  }
  assert.deepEqual(fixture, original);
});

test("reviewed baseline keeps exact arithmetic and its own result-only awards", () => {
  const answers = [48 + 18 * 4, (156 - 84) / 6, 240 / (18 + 12) + 7 * 6, 360 / ((27 - 15) * 3) + 48 / 6 - 5];
  for (const [index, question] of fixture.content.questions.entries()) {
    assert.equal(Number(question.answer), answers[index]);
    assert.equal(question.score, 5);
    assert.match(question.rubric, /只写正确结果.+得1分/);
    assert.match(question.rubric, /连带错误口径/);
  }
  assert.equal(fixture.request.requestedItemCount, 4);
  assert.deepEqual(fixture.request.requestedItemTypes, ["calculation"]);
});

test("legacy score allocation never rewrites existing comprehensive rubric or partial scores", async () => {
  for (const explicitScore of [null, 7]) {
    const question = { itemType: "calculation", prompt: "48＋18×4", answer: "120",
      ...(explicitScore === null ? {} : { score: explicitScore }), rubric: "本题满分7分，方法3分、计算3分、结果1分。",
      analysisSteps: ["18×4＝72。", "48＋72＝120。"], knowledgePoint: "四则运算", commonMistake: "先乘后加。" };
    const result = await draftAssessmentService({}, { subject: "数学", grade: "四年级", kind: "试卷" },
      { persist: false, assessmentDraftRunner: async () => ({ available: true,
        draftText: JSON.stringify({ title: "数学试卷", sections: [{ title: "计算", items: [question] }] }) }) });
    const kept = result.draftItems.find(item => item.prompt === question.prompt);
    assert.ok(kept);
    assert.equal(kept.rubric, question.rubric);
    if (explicitScore !== null) assert.equal(kept.metadata.score, explicitScore);
    assert.notEqual(result.audit.passed, true);
  }
});
