import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

test("grading workbench archives only after all questions are reviewed", () => {
  assert.match(source, /patchGradingWorkbenchQuestion/);
  assert.match(source, /allQuestionsReviewed/);
  assert.match(source, /reviewedQuestionScore/);
  assert.match(source, /待逐题确认/);
  assert.match(source, /确认本题/);
  assert.match(source, /逐题确认完成后自动汇总/);
  assert.doesNotMatch(source, /教师确认分数<input min="0" step="0\.5" type="number" value=\{reviewScore\}/);
});

test("grading workbench collects mistake archive evidence per reviewed question", () => {
  assert.match(source, /questionKnowledgePoint/);
  assert.match(source, /questionErrorStep/);
  assert.match(source, /questionSuggestedPractice/);
  assert.match(source, /知识点/);
  assert.match(source, /错因定位/);
  assert.match(source, /后续练习/);
  assert.match(source, /knowledgePoint: questionKnowledgePoint\.trim\(\)/);
  assert.match(source, /errorStep: questionErrorStep\.trim\(\)/);
  assert.match(source, /suggestedPractice: questionSuggestedPractice\.trim\(\)/);
  assert.match(source, /questionMistakeEvidenceRequired/);
  assert.match(source, /setQuestionErrorStep\(activeQuestionForForm\?\.errorStep \|\| activeQuestionForForm\?\.explanation \|\| ""\)/);
  assert.match(source, /if \(status === "correct"\) \{\s*setQuestionScore\(String\(max\)\);\s*setQuestionErrorStep\(""\);\s*setQuestionSuggestedPractice\(""\);\s*\}/);
});
