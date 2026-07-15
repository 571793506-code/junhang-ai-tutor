import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { cleanVocabularyEntryForStudent } from "./student-vocabulary-wordbook.js";

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
  assert.match(createRoute, /prisma\.student\.findUnique/);
  assert.match(createRoute, /studentName:\s*student\.displayName/);
  assert.match(createRoute, /grade:\s*student\.grade/);
  assert.match(deleteRoute, /deleteStudentVocabularyEntryService/);
  assert.match(source, /import \{ cleanVocabularyEntryForStudent \} from "\.\/student-vocabulary-wordbook\.js"/);
});

test("student vocabulary DTO keeps only student-visible card fields", () => {
  const entry = cleanVocabularyEntryForStudent({
    id: "entry-1",
    word: "carry",
    raw: { provider: "secret" },
    card: {
      word: "carry",
      phonetic: "/ˈkæri/",
      part: "v.",
      partCn: "动词",
      meaning: "携带",
      related: [{ word: "bring", part: "v.", partCn: "动词", meaning: "带来", provider: "secret" }],
      examples: ["I carry my bag."],
      pitfall: "注意第三人称单数。",
      provider: "secret",
      raw: "internal output",
      modelRunId: "run-1"
    },
    persisted: { modelRunId: "run-1" }
  });

  assert.deepEqual(entry, {
    id: "entry-1",
    word: "carry",
    card: {
      word: "carry",
      phonetic: "/ˈkæri/",
      part: "v.",
      partCn: "动词",
      meaning: "携带",
      related: [{ word: "bring", part: "v.", partCn: "动词", meaning: "带来" }],
      examples: ["I carry my bag."],
      pitfall: "注意第三人称单数。"
    }
  });
});
