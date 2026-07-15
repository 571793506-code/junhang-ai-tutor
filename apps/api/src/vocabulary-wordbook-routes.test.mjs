import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

function routeSource(signature) {
  const start = source.indexOf(signature);
  const end = source.indexOf("\napp.", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("student vocabulary routes use the authenticated student scope and safe DTO", () => {
  for (const signature of [
    'app.post("/api/student/vocabulary"',
    'app.get("/api/student/vocabulary"',
    'app.delete("/api/student/vocabulary/:entryId"'
  ]) {
    assert.notEqual(source.indexOf(signature), -1, `${signature} must exist`);
  }
  const createRoute = routeSource('app.post("/api/student/vocabulary"');
  const deleteRoute = routeSource('app.delete("/api/student/vocabulary/:entryId"');
  assert.match(createRoute, /requireDatabase/);
  assert.match(createRoute, /requireSession\(config, \["student"\]\)/);
  assert.match(createRoute, /studentId:\s*req\.session\.studentId/);
  assert.match(createRoute, /addStudentVocabularyEntriesService/);
  assert.doesNotMatch(createRoute, /body\.studentId/);
  assert.match(deleteRoute, /deleteStudentVocabularyEntryService/);
  assert.match(source, /function cleanVocabularyEntryForStudent/);
});
