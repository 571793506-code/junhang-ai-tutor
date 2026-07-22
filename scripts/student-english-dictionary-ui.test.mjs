import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const web = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const webApi = fs.readFileSync(new URL("../apps/web/src/api.ts", import.meta.url), "utf8");

test("Web student dictionary uses the shared query API and renders the complete contract", () => {
  const component = web.slice(
    web.indexOf("function StudentDictionary"),
    web.indexOf("function StudentModuleHome")
  );

  assert.match(webApi, /export async function queryStudentDictionary\(word: string\)/);
  assert.match(webApi, /\/api\/student\/dictionary\/query/);
  assert.doesNotMatch(webApi, /\/api\/ai\/vocabulary|\/api\/student\/vocabulary/);
  assert.match(component, /queryStudentDictionary\(wordInput\)/);
  for (const field of [
    "queryRelation", "parts", "forms", "wordFamily", "synonyms",
    "antonyms", "collocations", "examples", "usageNotes", "pitfalls"
  ]) {
    assert.match(component, new RegExp(`entry\\.${field}`));
  }
  assert.doesNotMatch(component, /demoVocabulary|generateVocabularyCard|删除|词汇本/);
});
