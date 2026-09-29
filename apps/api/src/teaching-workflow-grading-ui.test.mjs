import assert from "node:assert/strict";
import test from "node:test";
import { gradingRequest, gradingWorkflowFixture } from "../../../scripts/test-support/grading-workflow.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

test("grading UI contract exposes bound images and server totals; recognition correction regrades only that question", async (t) => {
  const f = await gradingWorkflowFixture(t);
  const c = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const first = await c.create(gradingRequest);
  assert.equal(first.content.pages.length, 2);
  assert.equal(first.content.questions[0].sourceImageRef, "page1.png");
  assert.equal(first.content.questions[0].confidence, 0.3);
  assert.equal(first.content.gradingSummary.score, null);
  assert.equal(first.content.questions[1].reviewedByTeacher, undefined);
  await assert.rejects(c.execute(first.id, { action: "revise", operationKey: "forge-score", expectedRevision: 2, targetQuestionIds: ["q1"],
    patch: { type: "replace_question", questionId: "q1", value: { ...first.content.questions[0], status: "correct", score: 5, confidence: 1,
      recognitionCorrectedByTeacher: true, studentAnswerReview: { actorTeacherId: "t1", studentAnswer: null } } } }));
  await assert.rejects(c.execute(first.id, { action: "confirm", operationKey: "blur", expectedRevision: 2, targetQuestionIds: ["q1"] }));
  const confirmed = await c.execute(first.id, { action: "confirm", operationKey: "clear", expectedRevision: 2, targetQuestionIds: ["q2"] });
  const next = await c.execute(first.id, { action: "revise", operationKey: "recognition", expectedRevision: confirmed.revision,
    targetQuestionIds: ["q1"], patch: { type: "correct_recognition", questionId: "q1", value: { studentAnswer: "交换两堆小棒，总数一样", confidence: 1, reviewedByTeacher: true } } });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].ocrQuestions.map((q) => q.questionNo), ["1"]);
  assert.equal(next.content.questions[0].studentAnswer, "交换两堆小棒，总数一样");
  assert.equal(next.content.questions[0].confidence, 0.3); // measured OCR confidence is not fabricated
  assert.equal(next.content.questions[0].recognitionCorrectedByTeacher, true);
  assert.equal(next.content.questions[0].reviewedByTeacher, undefined);
  assert.deepEqual(next.content.questions[1], confirmed.content.questions[1]);
  assert.equal(next.content.gradingSummary.score, 10);
  assert.equal(next.content.gradingSummary.confirmedScore, null);
  assert.doesNotMatch(JSON.stringify(next), /FORGED|actorTeacherId|studentAnswerReview/);
  const done = await c.execute(first.id, { action: "confirm", operationKey: "corrected", expectedRevision: next.revision, targetQuestionIds: ["q1"] });
  assert.equal(done.content.gradingSummary.confirmedScore, 10);
  const archived = await c.archive(first.id, { expectedRevision: done.revision });
  assert.equal(archived.status, "archived"); assert.equal(f.archiveDb.snapshot().submissions.length, 1);
});

test("grading correction validates its shape, preserves evidence coordinates, and cannot write against changed evidence", async (t) => {
  const f = await gradingWorkflowFixture(t);
  const c = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const first = await c.create(gradingRequest);
  const base = { action: "revise", operationKey: "invalid", expectedRevision: first.revision, targetQuestionIds: ["q1"] };
  await assert.rejects(c.execute(first.id, { ...base, patch: { type: "correct_recognition", questionId: "q1", value: { studentAnswer: null } } }));
  assert.equal(f.calls.length, 1);
  // A legacy full-question edit that changes the answer must also regrade, never carry over its supplied score.
  const corrected = await c.execute(first.id, { ...base, operationKey: "full-patch", patch: { type: "replace_question", questionId: "q1",
    value: { ...first.content.questions[0], studentAnswer: "交换两堆小棒，总数一样", score: 0, status: "wrong", printedPrompt: "伪造题干",
      bbox: { page: 2, x: 0, y: 0, w: 1, h: 1 }, confidence: 1 } } });
  assert.equal(f.calls.length, 2); assert.equal(corrected.content.questions[0].score, 5);
  assert.equal(corrected.content.questions[0].printedPrompt, first.content.questions[0].printedPrompt);
  assert.deepEqual(corrected.content.questions[0].bbox, first.content.questions[0].bbox);
  const saved = await c.get(first.id);
  f.context.archiveEvidence.fingerprint = "changed";
  await assert.rejects(c.execute(first.id, { ...base, operationKey: "stale-evidence", expectedRevision: saved.revision,
    patch: { type: "correct_recognition", questionId: "q1", value: { studentAnswer: "另一种表述" } } }));
  assert.equal(f.calls.length, 2);
  const after = await c.get(first.id);
  assert.equal(after.revision, saved.revision); assert.deepEqual(after.content, saved.content);
});
