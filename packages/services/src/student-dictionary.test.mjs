import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDictionaryAliases,
  normalizeDictionaryTerm,
  queryStudentDictionaryService,
  sharedDictionaryCard,
  validateDictionaryDraft
} from "./student-dictionary.js";

const validDraft = {
  schemaVersion: "student-dictionary-entry-v1",
  queryTerm: "carried",
  headword: "carry",
  phonetic: "/ˈkæri/",
  queryRelation: { type: "past", label: "carried 是 carry 的过去式" },
  parts: [{ part: "verb", partCn: "动词", meanings: ["携带", "搬运"] }],
  forms: [
    { term: "carries", type: "third_person", label: "第三人称单数" },
    { term: "carried", type: "past", label: "过去式" },
    { term: "carried", type: "past_participle", label: "过去分词" },
    { term: "carrying", type: "present_participle", label: "现在分词" }
  ],
  wordFamily: [{ word: "carrier", partCn: "名词", meaning: "搬运者；运输工具" }],
  synonyms: [{ word: "bring", meaning: "带来", difference: "bring 强调带到说话人所在处" }],
  antonyms: [],
  collocations: [{ phrase: "carry on", meaning: "继续" }],
  examples: [
    { sentence: "She carried the books.", translation: "她搬了这些书。" },
    { sentence: "I carry my bag to school.", translation: "我背书包去学校。" }
  ],
  usageNotes: ["carry 可表示携带、搬运或承担"],
  pitfalls: ["过去式 carried 要把 y 变成 i 再加 ed"]
};

test("dictionary term normalization accepts English words and rejects other input", () => {
  assert.equal(normalizeDictionaryTerm(" Carried "), "carried");
  assert.equal(normalizeDictionaryTerm("mother-in-law"), "mother-in-law");
  assert.equal(normalizeDictionaryTerm("can't"), "can't");
  assert.equal(normalizeDictionaryTerm("123"), "");
  assert.equal(normalizeDictionaryTerm("中文"), "");
});

test("dictionary validation requires a real form relationship and two bilingual examples", () => {
  assert.equal(validateDictionaryDraft("carried", validDraft).ok, true);
  assert.equal(validateDictionaryDraft("better", { ...validDraft, queryTerm: "better" }).ok, false);
  assert.equal(validateDictionaryDraft("carried", {
    ...validDraft,
    examples: validDraft.examples.slice(0, 1)
  }).ok, false);
  assert.equal(validateDictionaryDraft("carried", {
    ...validDraft,
    parts: [{ part: "", partCn: "动词", meanings: ["携带"] }]
  }).ok, false);
});

test("dictionary aliases preserve the query-specific relation for duplicate forms", () => {
  const aliases = buildDictionaryAliases("carried", validDraft);
  assert.deepEqual(aliases.find((item) => item.term === "carried"), {
    term: "carried",
    relationType: "past",
    relationLabel: "carried 是 carry 的过去式"
  });
  assert.equal(aliases.some((item) => item.term === "carry" && item.relationType === "headword"), true);
});

test("cache hit returns the alias relation without calling the model", async () => {
  let modelCalls = 0;
  const result = await queryStudentDictionaryService({}, { word: "carried" }, {
    findEntry: async () => ({
      term: "carried",
      relationType: "past",
      relationLabel: "carried 是 carry 的过去式",
      entry: { headword: "carry", card: sharedDictionaryCard(validDraft) }
    }),
    generateDraft: async () => {
      modelCalls += 1;
      return { available: true, draft: validDraft };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.entry.headword, "carry");
  assert.deepEqual(result.entry.queryRelation, {
    term: "carried",
    headword: "carry",
    type: "past",
    label: "carried 是 carry 的过去式"
  });
  assert.equal(modelCalls, 0);
});

test("cache miss generates once and persists only the shared card and aliases", async () => {
  let generatedInput = null;
  let saved = null;
  const result = await queryStudentDictionaryService({}, {
    word: "carried",
    studentId: "student-secret",
    studentName: "学生姓名"
  }, {
    findEntry: async () => null,
    generateDraft: async (_config, input) => {
      generatedInput = input;
      return { available: true, draft: validDraft, modelRun: null };
    },
    saveEntry: async (input) => {
      saved = input;
      return { id: "entry-1", headword: input.headword, card: input.card };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(generatedInput, { word: "carried" });
  assert.equal(saved.headword, "carry");
  assert.equal("queryTerm" in saved.card, false);
  assert.equal("queryRelation" in saved.card, false);
  assert.equal(saved.aliases.some((item) => item.term === "carry" && item.relationType === "headword"), true);
  assert.equal(saved.aliases.some((item) => item.term === "carried" && item.relationType === "past"), true);
});

test("invalid input and unavailable generation perform zero dictionary writes", async () => {
  let modelCalls = 0;
  let saveCalls = 0;
  const invalid = await queryStudentDictionaryService({}, { word: "123" }, {
    generateDraft: async () => {
      modelCalls += 1;
    },
    saveEntry: async () => {
      saveCalls += 1;
    }
  });
  const unavailable = await queryStudentDictionaryService({}, { word: "carry" }, {
    findEntry: async () => null,
    generateDraft: async () => {
      modelCalls += 1;
      return { available: false, draft: null, modelRun: null };
    },
    saveEntry: async () => {
      saveCalls += 1;
    }
  });

  assert.equal(invalid.error, "DICTIONARY_WORD_INVALID");
  assert.equal(unavailable.error, "DICTIONARY_QUERY_UNAVAILABLE");
  assert.equal(modelCalls, 1);
  assert.equal(saveCalls, 0);
});

test("thrown cache or generation failures return a generic student error", async () => {
  const cacheFailure = await queryStudentDictionaryService({}, { word: "carry" }, {
    findEntry: async () => {
      throw new Error("database secret");
    }
  });
  const generationFailure = await queryStudentDictionaryService({}, { word: "carry" }, {
    findEntry: async () => null,
    generateDraft: async () => {
      throw new Error("upstream secret");
    }
  });

  for (const result of [cacheFailure, generationFailure]) {
    assert.equal(result.ok, false);
    assert.equal(result.error, "DICTIONARY_QUERY_UNAVAILABLE");
    assert.equal(result.message, "暂时无法完成查询，请稍后重试。");
  }
});
