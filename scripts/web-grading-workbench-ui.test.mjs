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

test("grading workbench filter button exposes actionable queue filters", () => {
  assert.match(source, /queueFilter/);
  assert.match(source, /showQueueFilter/);
  assert.match(source, /visibleWorkbenches/);
  assert.match(source, /待确认/);
  assert.match(source, /低置信/);
  assert.match(source, /可归档/);
  assert.match(source, /setShowQueueFilter\(\(value\) => !value\)/);
  assert.match(source, /visibleWorkbenches\.some\(\(item\) => item\.submissionId === activeId\)/);
  assert.doesNotMatch(source, /<button className="secondary-button" disabled type="button"><Search size=\{15\} \/>筛选<\/button>/);
});

test("grading queue placeholders are status-only when no structured workbench exists", () => {
  assert.match(source, /className="grading-batch-placeholder"/);
  assert.doesNotMatch(source, /<button disabled key=\{batch\.id\}>/);
});

test("external workbook upload exposes ordered iPad photo and answer-source controls", () => {
  assert.match(source, /外部练习册/);
  assert.match(source, /iPad/);
  assert.match(source, /answerSourceMode/);
  assert.match(source, /teacher_confirmed/);
  assert.match(source, /teacher_selected_reference/);
  assert.match(source, /model_draft/);
  assert.match(source, /missing/);
  assert.match(source, /referenceSourceId/);
  assert.match(source, /multiple/);
  assert.match(source, /accept="image\/\*"/);
});

test("generated assessment upload requires a selectable assignment source and forwards its id", () => {
  assert.match(source, /关联生成作业/);
  assert.match(source, /selectedGeneratedAssignmentId/);
  assert.match(source, /assignmentId:\s*uploadMaterialType === "generated_assessment" \? selectedGeneratedAssignmentId/);
});

test("web grading workbench can register dialogue answer packages as shared sources", () => {
  assert.match(source, /DialogueSourceRegistrationPanel/);
  assert.match(source, /登记对话生成内容为统一批改来源/);
  assert.match(source, /registerDialogueAnswerPackage/);
  assert.match(source, /系统生成材料/);
});

test("external workbench displays original recognition evidence and blocks archive", () => {
  assert.match(source, /recognitionPacket/);
  assert.match(source, /archiveBlockers/);
  assert.match(source, /原始识别/);
  assert.match(source, /答案来源/);
  assert.match(source, /确认答案来源/);
  assert.match(source, /archiveDisabled.*archiveBlockers/);
});

test("grading queue exposes server-backed student, subject, kind, exception, and pagination controls", () => {
  assert.match(source, /onQueryGradingWorkbenches/);
  assert.match(source, /gradingStudentFilter/);
  assert.match(source, /gradingSubjectFilter/);
  assert.match(source, /gradingKindFilter/);
  assert.match(source, /value="exception">异常记录/);
  assert.match(source, /应用筛选/);
  assert.match(source, /上一页/);
  assert.match(source, /下一页/);
});
