import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("assessment print export cannot bypass draft review with force", () => {
  const routeStart = source.indexOf('app.post("/api/assessments/:assignmentId/print-export"');
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf('app.post(', routeStart + 1);
  const routeSource = source.slice(routeStart, routeEnd === -1 ? source.length : routeEnd);

  assert.match(routeSource, /metadata\.draftReviewStatus\s*!==\s*"accepted"/);
  assert.doesNotMatch(routeSource, /req\.body\?\.force/);
  assert.doesNotMatch(routeSource, /teacherReviewStatus:\s*metadata\.draftReviewStatus\s*\|\|\s*"accepted"/);
});

test("assessment print layout keeps English four-line estimates compact", () => {
  assert.match(source, /type === "fill" \? 9 : Math\.max\(16, spaceMm\)\) \* 2\.35/);
  assert.match(source, /\.english-four-line div \{ height: 6\.6mm; position: relative; margin-bottom: 0\.8mm; \}/);
  assert.doesNotMatch(source, /type === "fill" \? 16 : spaceMm\) \* 3\.2/);
});
