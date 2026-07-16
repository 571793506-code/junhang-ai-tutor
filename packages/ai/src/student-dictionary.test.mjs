import assert from "node:assert/strict";
import test from "node:test";
import { generateStudentDictionaryDraft } from "./student-dictionary.js";

const config = {
  GPT56_API_KEY: "test-key",
  GPT56_BASE_URL: "http://127.0.0.1:9999",
  GPT56_MODEL: "gpt-5.6"
};

const validDraft = {
  schemaVersion: "student-dictionary-entry-v1",
  queryTerm: "carried",
  headword: "carry",
  phonetic: "/ˈkæri/",
  queryRelation: { type: "past", label: "carried 是 carry 的过去式" },
  parts: [{ part: "verb", partCn: "动词", meanings: ["携带", "搬运"] }],
  forms: [{ term: "carried", type: "past", label: "过去式" }],
  wordFamily: [],
  synonyms: [],
  antonyms: [],
  collocations: [{ phrase: "carry on", meaning: "继续" }],
  examples: [
    { sentence: "She carried the books.", translation: "她搬了这些书。" },
    { sentence: "I carry my bag to school.", translation: "我背书包去学校。" }
  ],
  usageNotes: ["carry 表示携带或搬运"],
  pitfalls: ["过去式要把 y 变成 i 再加 ed"]
};

test("dictionary generator requests strict non-personalized JSON", async () => {
  let capturedMessages = null;
  let capturedOptions = null;
  const result = await generateStudentDictionaryDraft(config, {
    word: "carried",
    studentId: "student-secret",
    studentName: "学生姓名",
    grade: "五年级"
  }, {
    callModel: async (_config, messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { choices: [{ message: { content: JSON.stringify(validDraft) } }] };
    }
  });

  assert.equal(result.available, true);
  assert.deepEqual(result.draft, validDraft);
  assert.equal(result.providerId, "gpt56");
  assert.equal(capturedOptions.responseFormat.type, "json_object");
  assert.equal(capturedOptions.reasoningEffort, "none");
  assert.equal(capturedOptions.maxTokens, 1800);
  assert.equal(capturedOptions.timeoutMs, 30000);
  assert.match(capturedMessages[0].content, /student-dictionary-entry-v1/);
  assert.match(capturedMessages[0].content, /至少两个.*中文/);
  assert.deepEqual(JSON.parse(capturedMessages[1].content), {
    queryTerm: "carried",
    audience: "小学三至六年级"
  });
  assert.doesNotMatch(capturedMessages[1].content, /studentId|studentName|grade|学生姓名/);
});

test("dictionary generator returns unavailable when GPT-5.6 is not configured", async () => {
  const result = await generateStudentDictionaryDraft({}, { word: "carry" });

  assert.equal(result.available, false);
  assert.equal(result.draft, null);
  assert.equal(result.modelRun.status, "SKIPPED");
});

test("dictionary generator rejects invalid JSON output", async () => {
  const result = await generateStudentDictionaryDraft(config, { word: "carry" }, {
    callModel: async () => ({ choices: [{ message: { content: "not json" } }] })
  });

  assert.equal(result.available, false);
  assert.equal(result.draft, null);
  assert.equal(result.modelRun.status, "ERROR");
});
