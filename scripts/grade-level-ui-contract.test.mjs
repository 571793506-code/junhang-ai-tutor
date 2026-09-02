import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const files = [
  "apps/web/src/main.tsx",
  "apps/miniprogram/pages/teacher/students/index.js",
  "apps/miniprogram/pages/teacher/content/index.js"
];

test("web and miniprogram teacher grade selectors include grade seven", () => {
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /七年级/);
  }
});
