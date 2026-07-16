import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { cleanStudentDictionaryEntry } from "./student-dictionary-response.js";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("student dictionary route is authenticated, database-backed, and identity-free", () => {
  const start = source.indexOf('app.post("/api/student/dictionary/query"');
  const end = source.indexOf("\napp.", start + 1);
  assert.notEqual(start, -1);
  const route = source.slice(start, end === -1 ? source.length : end);

  assert.match(route, /requireDatabase/);
  assert.match(route, /requireSession\(config, \["student"\]\)/);
  assert.match(route, /queryStudentDictionaryService\(config, \{ word: body\.word \}\)/);
  assert.match(route, /cleanStudentDictionaryEntry\(result\.entry\)/);
  assert.doesNotMatch(route, /studentId|studentName|grade/);
  assert.doesNotMatch(source, /app\.(get|post|delete)\("\/api\/student\/vocabulary/);
  assert.doesNotMatch(source, /app\.post\("\/api\/ai\/vocabulary/);
});

test("student dictionary DTO removes every internal field", () => {
  const result = cleanStudentDictionaryEntry({
    schemaVersion: "student-dictionary-entry-v1",
    headword: "carry",
    phonetic: "/ˈkæri/",
    queryRelation: {
      term: "carried",
      headword: "carry",
      type: "past",
      label: "carried 是 carry 的过去式",
      provider: "secret"
    },
    parts: [{ part: "verb", partCn: "动词", meanings: ["携带"], raw: "secret" }],
    forms: [{ term: "carried", type: "past", label: "过去式", debug: true }],
    wordFamily: [{ word: "carrier", partCn: "名词", meaning: "搬运者", model: "secret" }],
    synonyms: [{ word: "bring", meaning: "带来", difference: "强调方向", raw: "secret" }],
    antonyms: [],
    collocations: [{ phrase: "carry on", meaning: "继续", provider: "secret" }],
    examples: [
      { sentence: "She carried the books.", translation: "她搬了这些书。", raw: "secret" },
      { sentence: "I carry my bag.", translation: "我背着书包。" }
    ],
    usageNotes: ["常用动词"],
    pitfalls: ["注意过去式"],
    provider: "secret",
    modelRunId: "run-1",
    raw: "secret",
    id: "cache-id"
  });

  assert.deepEqual(result, {
    schemaVersion: "student-dictionary-entry-v1",
    headword: "carry",
    phonetic: "/ˈkæri/",
    queryRelation: {
      term: "carried",
      headword: "carry",
      type: "past",
      label: "carried 是 carry 的过去式"
    },
    parts: [{ part: "verb", partCn: "动词", meanings: ["携带"] }],
    forms: [{ term: "carried", type: "past", label: "过去式" }],
    wordFamily: [{ word: "carrier", partCn: "名词", meaning: "搬运者" }],
    synonyms: [{ word: "bring", meaning: "带来", difference: "强调方向" }],
    antonyms: [],
    collocations: [{ phrase: "carry on", meaning: "继续" }],
    examples: [
      { sentence: "She carried the books.", translation: "她搬了这些书。" },
      { sentence: "I carry my bag.", translation: "我背着书包。" }
    ],
    usageNotes: ["常用动词"],
    pitfalls: ["注意过去式"]
  });
});
