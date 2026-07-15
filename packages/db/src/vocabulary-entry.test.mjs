import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteStudentVocabularyEntry,
  listStudentVocabularyEntries,
  upsertVocabularyEntry
} from "./index.js";

test("vocabulary entry repository scopes every operation to one student", async () => {
  let upsertInput = null;
  let listInput = null;
  let deleteInput = null;
  const prisma = {
    vocabularyEntry: {
      upsert: async (input) => {
        upsertInput = input;
        return { id: "entry-1", studentId: "student-1", word: "carry", card: { word: "carry" } };
      },
      findMany: async (input) => {
        listInput = input;
        return [];
      },
      deleteMany: async (input) => {
        deleteInput = input;
        return { count: 1 };
      }
    }
  };

  await upsertVocabularyEntry({ studentId: "student-1", word: "carry", card: { word: "carry" } }, { prisma });
  await listStudentVocabularyEntries("student-1", { prisma });
  assert.equal(await deleteStudentVocabularyEntry("student-1", "entry-1", { prisma }), true);

  assert.deepEqual(upsertInput.where, { studentId_word: { studentId: "student-1", word: "carry" } });
  assert.deepEqual(listInput, { where: { studentId: "student-1" }, orderBy: { updatedAt: "desc" } });
  assert.deepEqual(deleteInput, { where: { id: "entry-1", studentId: "student-1" } });
});
