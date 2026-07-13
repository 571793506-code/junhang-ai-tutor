import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./knowledge-source-id.js", import.meta.url);

test("knowledge source ids do not collide for paths with a shared prefix", async () => {
  assert.equal(fs.existsSync(moduleUrl), true, "knowledge-source-id.js must exist");
  const { stableKnowledgeSourceId } = await import(moduleUrl);
  const first = stableKnowledgeSourceId({ relativeMarkdownPath: "exports/markdown-ingestion-e2e/guide.md" });
  const second = stableKnowledgeSourceId({ relativeMarkdownPath: "exports/markdown-ingestion-e2e/content-context-upload-fixture.md" });

  assert.notEqual(first, second);
  assert.match(first, /^ks_[a-f0-9]{40}$/);
  assert.match(second, /^ks_[a-f0-9]{40}$/);
});

test("existing sources keep their id and teacher review history", async () => {
  const { resolveKnowledgeSourceId } = await import(moduleUrl);
  let query = null;
  const prisma = {
    knowledgeSource: {
      findFirst: async (input) => {
        query = input;
        return { id: "ks_existing_reviewed_source" };
      }
    }
  };
  const id = await resolveKnowledgeSourceId(prisma, {
    relativeMarkdownPath: "exports/markdown-ingestion/approved.md",
    sourcePath: "storage/uploads/approved.docx"
  });

  assert.equal(id, "ks_existing_reviewed_source");
  assert.deepEqual(query, {
    where: { markdownPath: "exports/markdown-ingestion/approved.md" },
    select: { id: true }
  });
});
