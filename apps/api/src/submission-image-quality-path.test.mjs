import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("submission image quality analysis resolves the repository scripts directory", () => {
  assert.match(source, /path\.resolve\(workspaceRoot, "scripts", "analyze-submission-images\.py"\)/);
});
