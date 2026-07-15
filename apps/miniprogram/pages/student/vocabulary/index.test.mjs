import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const markup = fs.readFileSync(new URL("./index.wxml", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../../../utils/api.js", import.meta.url), "utf8");

test("student vocabulary page is API-backed and supports add, list, and delete", () => {
  assert.doesNotMatch(page, /\bdictionary\b|\bfallback\b/);
  assert.match(page, /api\.listStudentVocabulary\(\)/);
  assert.match(page, /api\.createStudentVocabulary/);
  assert.match(page, /api\.deleteStudentVocabulary/);
  assert.match(markup, /wx:for="\{\{entries\}\}"/);
  assert.match(markup, /bindtap="removeVocabulary"/);
  assert.match(api, /listStudentVocabulary\(\)/);
  assert.match(api, /createStudentVocabulary\(input\)/);
  assert.match(api, /deleteStudentVocabulary\(entryId\)/);
});
