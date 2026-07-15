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
      : {
        available: true,
        card: {
          word: input.word,
          phonetic: "/ˈkæri/",
          part: "v.",
          partCn: "动词",
          meaning: "携带",
          related: [],
          examples: ["I carry my bag.", "She carries a book."],
          pitfall: "注意第三人称单数。"
        }
      }
  });

  assert.deepEqual(normalizeVocabularyWords([" Carry ", "carry", "bright"]), {
    words: ["carry", "bright"],
    rejected: [],
    overflow: []
  });
  assert.deepEqual(written, ["carry"]);
  assert.deepEqual(generated.entries.map((entry) => entry.word), ["carry"]);
  assert.deepEqual(generated.failures.map((item) => item.word).sort(), ["123", "bright"]);
});

test("wordbook service does not persist incomplete or mismatched generated cards", async () => {
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
    words: ["carry", "bright"]
  }, {
    persist: false,
    prisma,
    generateCard: async (_config, input) => input.word === "carry"
      ? {
        available: true,
        card: {
          word: "carry",
          phonetic: "",
          part: "v.",
          partCn: "动词",
          meaning: "携带",
          related: [],
          examples: ["I carry my bag.", "She carries a book."],
          pitfall: "注意第三人称单数。"
        }
      }
      : {
        available: true,
        card: {
          word: "brighter",
          phonetic: "/ˈbraɪtər/",
          part: "adj.",
          partCn: "形容词",
          meaning: "更明亮的",
          related: [],
          examples: ["The room is brighter.", "Today is brighter."],
          pitfall: "注意比较级。"
        }
      }
  });

  assert.deepEqual(written, []);
  assert.deepEqual(generated.entries, []);
  assert.deepEqual(generated.failures.map((item) => item.word).sort(), ["bright", "carry"]);
});

test("wordbook service reports words beyond the batch limit", () => {
  const result = normalizeVocabularyWords([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"
  ]);

  assert.deepEqual(result.words, [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"
  ]);
  assert.deepEqual(result.overflow, ["eleven"]);
});
