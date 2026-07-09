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
