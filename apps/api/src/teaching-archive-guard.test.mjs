import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { isImmutableTeachingArchive, rejectArchivedSubmissionMutation } from "./teaching-archive-guard.js";

test("immutable guard recognizes a damaged archive marker and reserved archive IDs", () => {
  assert.equal(isImmutableTeachingArchive({ id: "ordinary", content: { workflowArchive: { fingerprint: "invalid" } } }), true);
  assert.equal(isImmutableTeachingArchive({ id: "teaching-archive-123", content: {} }), true);
  assert.equal(isImmutableTeachingArchive({ id: "ordinary", content: { ocr: {} } }), false);
});

test("HTTP guard rejects an archive edit before mutation and lets an ordinary submission proceed", async (t) => {
  let mutations = 0;
  const app = express();
  app.patch("/submissions/:id", (req, res) => {
    if (rejectArchivedSubmissionMutation(res, { id: req.params.id })) return;
    mutations++; res.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rejected = await fetch(`${origin}/submissions/teaching-archive-123`, { method: "PATCH" });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, "WORKFLOW_ARCHIVE_IMMUTABLE");
  assert.equal(mutations, 0);
  assert.equal((await fetch(`${origin}/submissions/ordinary`, { method: "PATCH" })).status, 200);
  assert.equal(mutations, 1);
});
