import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sourceFor = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("iPad teacher task and grading selectors use the API availability contract", () => {
  for (const relativePath of [
    "apps/miniprogram/pages/teacher/tasks/index.js",
    "apps/miniprogram/pages/teacher/grading/index.js"
  ]) {
    assert.match(sourceFor(relativePath), /item\.canReceiveNewWork/);
  }
});

test("iPad classroom roster uses the API availability contract", () => {
  const source = sourceFor("apps/miniprogram/pages/classroom/dashboard/index.js");
  assert.match(source, /item\.canReceiveNewWork/);
});
