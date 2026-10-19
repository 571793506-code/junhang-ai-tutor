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

test("a complete English quiz survives both model and service reading gates at 60 points", async () => {
  const vocabulary = ["走路", "玩耍", "看望", "清洁", "打开", "关闭", "听", "观看"];
  const subjects = ["Amy", "Ben", "Clara", "Dan", "Emma", "Frank"];
  const result = await draftAssessmentService({}, { subject: "英语", grade: "六年级", kind: "小测", requirement: "一般过去时基础小测" }, {
    persist: false, teachingExecution: { call: async (_route, messages) => {
      const { partition } = JSON.parse(messages[1].content);
      const type = partition.itemTypes[0];
      const items = partition.itemScores.map((score, index) => ({
        itemType: type,
        prompt: type === "fill" ? `根据中文写英文单词：${vocabulary[index]}。`
          : type === "solution" ? `把句子翻译成英文：${subjects[index]}昨天去了公园。`
            : type === "choice" ? `${subjects[index]} ______ to school yesterday.`
              : `According to the passage, what did ${subjects[index]} do?`,
        answer: type === "choice" ? "A" : "walked", score,
        rubric: `答案正确得${score}分。`, analysisSteps: ["根据yesterday判断过去时。", "使用动词过去式。"],
        knowledgePoint: "一般过去时", commonMistake: "注意动词过去式。",
        ...(type === "choice" ? { options: ["A. walked", "B. walk", "C. walks", "D. walking"] } : {}),
        ...(type === "reading" ? { passageGroupId: "past-day", passageTitle: "Yesterday", passageText: "A child walked to the park and played with friends yesterday. ".repeat(12), passageQuestionIndex: index + 1 } : {})
      }));
      return { text: JSON.stringify({ title: "一般过去时小测", sections: [{ title: partition.title, items }] }) };
    } }
  });
  assert.equal(result.modelAvailable, true);
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.totalScore, 60);
  assert.equal(result.draftItems.length, 20);
  assert.equal(result.audit.status, "passed");
  assert.equal(result.generationPipeline.audit.passed, true);
  assert.deepEqual(result.persisted, { modelRunId: null, draftReviewModelRunIds: {}, assignmentId: null });
});
