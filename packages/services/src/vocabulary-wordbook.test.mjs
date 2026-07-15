import assert from "node:assert/strict";
import test from "node:test";
import { addStudentVocabularyEntriesService, normalizeVocabularyWords } from "./index.js";

test("wordbook service deduplicates words and preserves successful cards when one generation fails", async () => {
  const written = [];
  const prisma = {
    vocabularyEntry: {
      upsert: async ({ create }) => {
        written.push(create.word);
        return { id: `entry-${create.word}`, ...create };
      }
    }
  };
  const generated = await addStudentVocabularyEntriesService({}, {
    studentId: "student-1",
    words: [" Carry ", "bright", "carry", "123"]
  }, {
    persist: false,
    prisma,
    generateCard: async (_config, input) => input.word === "bright"
      ? { available: false, card: null }
      : { available: true, card: { word: input.word, part: "v.", partCn: "动词", meaning: "释义" } }
  });

  assert.deepEqual(normalizeVocabularyWords([" Carry ", "carry", "bright"]), {
    words: ["carry", "bright"],
    rejected: []
  });
  assert.deepEqual(written, ["carry"]);
  assert.deepEqual(generated.entries.map((entry) => entry.word), ["carry"]);
  assert.deepEqual(generated.failures.map((item) => item.word).sort(), ["123", "bright"]);
});
