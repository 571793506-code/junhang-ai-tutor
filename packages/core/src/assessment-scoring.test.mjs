import assert from "node:assert/strict";
import test from "node:test";
import { allocateAssessmentScores, assessmentScoreIssues } from "./assessment-scoring.js";

test("objective rubrics reject explicit process scoring while keeping answer analyses separate", () => {
  for (const itemType of ["choice", "fill", "judgment"]) {
    for (const rubric of ["按结构、过程与结果综合判分。", "按步骤评分。", "列式得1分；结果得1分。", "过程正确得1分，选C得1分。"]) {
      assert.ok(assessmentScoreIssues({ itemType, score: 2, rubric }).includes("rubric_process_conflict"));
    }
    assert.deepEqual(assessmentScoreIssues({ itemType, score: 2, rubric: "答对得2分，不计过程分。", analysisSteps: ["先列式，再计算。"] }), []);
    assert.deepEqual(assessmentScoreIssues({ itemType, score: 2, rubric: "答对得2分，不按步骤评分。" }), []);
  }
  for (const itemType of ["calculation", "solution"]) {
    assert.deepEqual(assessmentScoreIssues({ itemType, score: 2, rubric: "列式得1分；结果得1分。" }), []);
  }
});
test("score allocation precedes content and yields exact totals", () => {
  const types = [...Array(6).fill("fill"), ...Array(4).fill("choice"), ...Array(4).fill("calculation"), ...Array(4).fill("solution")];
  assert.deepEqual(allocateAssessmentScores(types, { subject: "数学", kind: "小测" }), [...Array(10).fill(2), ...Array(4).fill(4), ...Array(4).fill(6)]);
  for (const subject of ["数学", "语文", "英语"]) {
    const scores = allocateAssessmentScores(types, { subject, kind: "试卷" });
    assert.equal(scores.reduce((sum, s) => sum + s, 0), 100);
    assert.ok(scores.every((s) => Number.isInteger(s) && s > 0));
  }
  assert.throws(() => allocateAssessmentScores(Array(61).fill("fill")), /ASSESSMENT_SCORE_ALLOCATION_INVALID/);
});
test("explicit score conflicts are rejected without summing conditional alternatives", () => {
  assert.deepEqual(assessmentScoreIssues({ prompt: "计算（5分）", score: 4 }), ["prompt_score_conflict"]);
  assert.deepEqual(assessmentScoreIssues({ score: 2, itemType: "choice", rubric: "选B得3分；错选、多选或未选得0分。" }), ["rubric_score_conflict"]);
  assert.deepEqual(assessmentScoreIssues({ score: 4, rubric: "列式得2分；计算得2分；答语得1分。其他方法等价给分。" }), ["rubric_score_conflict"]);
  assert.deepEqual(assessmentScoreIssues({ score: 5, rubric: "本题满分4分，按步骤评分。" }), ["rubric_score_conflict"]);
  assert.deepEqual(assessmentScoreIssues({ score: 5, rubric: "列式得2分；计算得2分；答语得1分。只写结果得1分。" }), []);
  assert.deepEqual(assessmentScoreIssues({ score: 5, rubric: "列式得2分；计算正确得2分，只有一处错误得1分；答语得1分。" }), []);
  assert.deepEqual(assessmentScoreIssues({ score: 5, rubric: "列式得1分；两处计算各得1分；结果得2分。" }), []);
});

test("nested scoring clauses count every award rather than only the final award of each clause", () => {
  // Minimal scoring evidence from the isolated live solution diagnostic.
  const rubric = "求新购科普书本数3分：列式18×24得2分，算得432本得1分；求现有总本数2分：列式432＋156得1分，算得588本得1分；单位及答句完整、正确得1分。综合算式或其他合理方法按对应评分点给分，不重复计分。";
  assert.deepEqual(assessmentScoreIssues({ itemType: "solution", score: 6, rubric }), []);
  assert.deepEqual(assessmentScoreIssues({ itemType: "solution", score: 6,
    rubric: rubric.replace("正确得1分", "正确得2分") }), ["rubric_score_conflict"]);
  assert.deepEqual(assessmentScoreIssues({ itemType: "solution", score: 6,
    rubric: "列式得2分，计算得1分；列式得1分，计算得1分；答句得1分。" }), []);
});

test("process-scored questions cannot award full credit for only a final answer", () => {
  for (const itemType of ["calculation", "solution"]) {
    for (const rubric of [
      "共5分。方法2分：运算顺序正确。计算2分。最终答案1分。只写正确结果304且无过程，得5分。",
      "方法与运算关系0.5分。计算3.5分。最终答案1分。仅写正确答案得5分。",
      "方法分1分。计算分3分。最终答案分1分。只写正确结果，得5分，不得方法分或计算分。",
      "列式得2分；计算得2分；结果得1分。只写正确结果，没有过程得5分。"
    ]) assert.ok(assessmentScoreIssues({ itemType, score: 5, rubric }).includes("rubric_process_conflict"));
    assert.deepEqual(assessmentScoreIssues({ itemType, score: 5, rubric: "列式得2分；计算得2分；结果得1分。只写正确结果，没有过程得2分。" }), []);
    assert.deepEqual(assessmentScoreIssues({ itemType, score: 5, rubric: "列式得2分；计算得2分；结果得1分。只写正确结果不得5分，只得1分。" }), []);
  }
  assert.deepEqual(assessmentScoreIssues({ itemType: "calculation", score: 5, rubric: "口算不要求过程，只写正确结果得5分。" }), []);
  assert.deepEqual(assessmentScoreIssues({ itemType: "fill", score: 5, rubric: "只写正确结果得5分。" }), []);
});
