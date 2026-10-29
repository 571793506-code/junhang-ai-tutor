import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core/grading-source-package";
import { gradeSubmissionService } from "@junhang/services";
import { buildSubmissionGradeInputFromRecord, gradingSourcePackageForAssignment } from "./submission-grade-input.js";

function fixture() {
  const assignment = { id: "a1", title: "阅读练习", grade: "四年级", metadata: { subject: "语文", kind: "练习" },
    items: [{ orderIndex: 1, prompt: "结合材料说明小明为什么帮助同学。", answer: "小明关心同学。", score: 5,
      analysisSteps: ["找出帮助同学的行为。"], knowledgePoint: "人物分析", rubric: "结合材料说明人物品质。",
      sourceContext: { questionId: "q1", itemType: "reading", sharedMaterial: { id: "m1", title: "同桌", text: "同桌忘带铅笔，小明主动借出自己的铅笔。" },
        day: { dayId: "d1", goal: "人物分析" } } }] };
  assignment.metadata.gradingSourcePackage = buildGradingSourcePackage(assignment).package;
  return { assignmentId: "a1", studentId: "synthetic-student", assignment,
    content: { ocr: { questions: [{ questionNo: "1", printedPrompt: assignment.items[0].prompt, studentAnswer: "他想帮助别人。", confidence: 0.96 }] } } };
}

test("legacy image grading carries registered material through the actual shared grading service", async () => {
  const submission = fixture();
  const input = await buildSubmissionGradeInputFromRecord(submission);
  const expected = submission.assignment.metadata.gradingSourcePackage;
  assert.deepEqual(input.gradingSourcePackage, expected);
  assert.equal(input.assignmentItems[0].metadata.passageText, expected.questions[0].context.sharedMaterial.text);
  assert.deepEqual(input.ocrQuestions, submission.content.ocr.questions);
  const calls = [];
  const result = await gradeSubmissionService({}, input, { persist: false, teachingExecution: { call: async (_route, messages) => {
    calls.push(JSON.parse(messages[1].content));
    return { text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "partial", score: 3, maxScore: 5,
      studentAnswer: "他想帮助别人。", correctAnswer: "小明关心同学。", explanation: "理解了帮助他人，还需结合材料。", confidence: 0.95 }] }), usage: { completion_tokens: 20 } };
  } } });
  assert.equal(result.available, true);
  assert.equal(calls.length, 1);
  // The model receives the verified projection; the full package stays in the service input.
  assert.equal(calls[0].gradingSourcePackage, undefined);
  assert.deepEqual(calls[0].referenceAnswers[0].context, expected.questions[0].context);
  assert.equal(calls[0].referenceAnswers[0].rubric, expected.questions[0].rubric);
  assert.equal(calls[0].ocrQuestions[0].studentAnswer, "他想帮助别人。");
});

test("the registered source overrides a stale submission copy and preserves recognition input", async () => {
  const submission = fixture();
  submission.content.dialogueAnswerPackage = buildGradingSourcePackage({ ...submission.assignment,
    items: [{ orderIndex: 1, prompt: "旧题", answer: "旧答案", score: 5 }] }).package;
  const recognition = { status: "SUCCESS", questions: [{ questionNo: "1", printedPrompt: "原图题目", studentAnswer: "修正后的识别", confidence: 0.9 }] };
  const manifest = { version: "question-layout-manifest-v1", questions: [] };
  const input = await buildSubmissionGradeInputFromRecord(submission, recognition, {
    findLatestQuestionLayoutManifest: async (id) => { assert.equal(id, "a1"); return manifest; }
  });
  assert.equal(input.answerKey["1"], "小明关心同学。");
  assert.deepEqual(input.ocrQuestions, recognition.questions);
  assert.deepEqual(input.questionLayoutManifest, manifest);
  assert.equal(input.assignmentAnalysis.gradingSource.fingerprint, input.gradingSourcePackage.fingerprint);
  const modified = structuredClone(submission.assignment);
  modified.metadata.gradingSourcePackage.questions[0].context.sharedMaterial.text = "未更新指纹的材料";
  assert.equal(gradingSourcePackageForAssignment(modified), null);
});

test("historical assignments without a source package retain legacy items and answers", async () => {
  const submission = fixture();
  delete submission.assignment.metadata.gradingSourcePackage;
  submission.assignment.metadata.answerKey = { 1: "历史答案" };
  const input = await buildSubmissionGradeInputFromRecord(submission);
  assert.equal(input.gradingSourcePackage, null);
  assert.equal(input.assignmentItems[0].questionNo, 1);
  assert.deepEqual(input.answerKey, { 1: "历史答案" });
});
