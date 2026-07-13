import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./content-index-state.js", import.meta.url);
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("empty content indexes are unavailable instead of successful", async () => {
  assert.equal(fs.existsSync(moduleUrl), true, "content-index-state.js must exist");
  const { summarizeContentIndexState } = await import(moduleUrl);
  assert.deepEqual(summarizeContentIndexState({ documentCount: 3, documents: [] }), {
    available: false,
    documentCount: 0,
    documents: [],
    reason: "CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS"
  });
});

test("content index rebuild and sync expose the empty-index failure", () => {
  const rebuildStart = serverSource.indexOf('app.post("/api/content/index/rebuild"');
  const syncStart = serverSource.indexOf('app.post("/api/knowledge/sources/sync-content-index"');
  const reviewStart = serverSource.indexOf('app.patch("/api/knowledge/sources/:sourceId/review"');
  const rebuildSource = serverSource.slice(rebuildStart, syncStart);
  const syncSource = serverSource.slice(syncStart, reviewStart);

  assert.match(rebuildSource, /CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS/);
  assert.match(rebuildSource, /res\.status\(422\)/);
  assert.match(syncSource, /CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS/);
  assert.match(syncSource, /res\.status\(422\)/);
});
