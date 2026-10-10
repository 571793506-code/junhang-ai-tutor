import assert from "node:assert/strict";
import test from "node:test";
import { gradingWorkflowFixture, gradingRequest } from "../../../scripts/test-support/grading-workflow.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

test("teacher review and exact-version archive summaries survive reads without writing or granting confirmation", async (t) => {
  const f = await gradingWorkflowFixture(t);
  f.context.submission.content.ocr.questions[0].studentAnswer = "交换两组，总数不变";
  f.context.submission.content.ocr.questions[0].confidence = 0.99;
  const client = createTeachingWorkflowClient({ baseUrl: f.baseUrl, session: { sessionToken: f.tokens.teacher } });
  const created = await client.create(gradingRequest);
  assert.equal(created.reviewStatus, "review_required");
  assert.equal(created.archive, null);
  const confirmed = await client.execute(created.id, { action: "confirm", expectedRevision: created.revision,
    operationKey: "teacher-reviewed-all", targetQuestionIds: ["q1", "q2"] });
  assert.equal(confirmed.reviewStatus, "teacher_confirmed");
  assert.equal(confirmed.archive, null);
  assert.equal(f.archiveDb.snapshot().submissions.length, 0);
  const published = await client.archive(created.id, { expectedRevision: confirmed.revision });
  const before = f.archiveDb.snapshot();
  const current = await client.get(created.id);
  assert.deepEqual(current.archive, { id: published.id, workflowId: created.id, revision: confirmed.revision, status: "archived" });
  const { workflows } = await (await f.request("/workflows?module=grading")).json();
  assert.equal(workflows[0].reviewStatus, "teacher_confirmed");
  assert.deepEqual(workflows[0].archive, current.archive);
  assert.deepEqual(f.archiveDb.snapshot(), before, "GET/list must not write an archive or mistakes");
  assert.equal((await f.request(`/workflows/${created.id}`, { token: f.tokens.other })).status, 404);
  assert.equal((await f.request(`/workflows/${created.id}`, { token: f.tokens.student })).status, 403);
  const restored = await client.execute(created.id, { action: "restore", expectedRevision: confirmed.revision,
    operationKey: "restore-unconfirmed-content", restoreRevision: created.revision });
  assert.equal(restored.reviewStatus, "review_required");
  assert.equal(restored.archive, null);
  const historical = await client.getRevision(created.id, confirmed.revision);
  assert.equal(historical.status, "historical");
  assert.deepEqual(historical.archive, current.archive);
  assert.equal(f.archiveDb.snapshot().submissions.length, 1);
  for (const mutate of [
    (row) => { row.content.workflowArchive.teacherId = "other-teacher"; },
    (row) => { row.content.workflowArchive.workflowId = "other-workflow"; },
    (row) => { row.content.workflowArchive.revision += 1; },
    (row) => { row.grading.score += 1; }
  ]) {
    const altered = structuredClone(before); mutate(altered.submissions[0]); f.archiveDb.seed(altered);
    assert.equal((await client.getRevision(created.id, confirmed.revision)).archive, null);
  }
  assert.equal(f.calls.length, 1, "review/restore/archive/read must not add model calls");
});
