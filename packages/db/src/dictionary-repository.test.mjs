import assert from "node:assert/strict";
import test from "node:test";
import {
  findDictionaryEntryByTerm,
  upsertDictionaryEntryWithAliases
} from "./dictionary-repository.js";

test("dictionary repository resolves a globally shared entry by alias", async () => {
  let lookup = null;
  const prisma = {
    dictionaryAlias: {
      findUnique: async (input) => {
        lookup = input;
        return {
          term: "carried",
          relationType: "past",
          relationLabel: "carried 是 carry 的过去式",
          entry: { id: "entry-1", headword: "carry", card: { headword: "carry" } }
        };
      }
    }
  };

  const result = await findDictionaryEntryByTerm("carried", { prisma });

  assert.deepEqual(lookup, {
    where: { term: "carried" },
    include: { entry: true }
  });
  assert.equal(result.entry.headword, "carry");
});

test("dictionary repository upserts one headword and all global aliases in one transaction", async () => {
  const aliasWrites = [];
  let entryWrite = null;
  let aliasReads = 0;
  const tx = {
    dictionaryEntry: {
      upsert: async (input) => {
        entryWrite = input;
        return { id: "entry-1", headword: "carry", card: input.create.card };
      }
    },
    dictionaryAlias: {
      findMany: async () => {
        aliasReads += 1;
        if (aliasReads === 1) return [];
        return aliasWrites.map((item) => ({
          term: item.where.term,
          entryId: item.create.entryId
        }));
      },
      upsert: async (input) => {
        aliasWrites.push(input);
        return input.create;
      }
    }
  };
  const prisma = { $transaction: async (run) => run(tx) };

  const result = await upsertDictionaryEntryWithAliases({
    headword: "carry",
    schemaVersion: "student-dictionary-entry-v1",
    card: { headword: "carry" },
    aliases: [
      { term: "carry", relationType: "headword", relationLabel: "carry 的原形" },
      { term: "carried", relationType: "past", relationLabel: "carried 是 carry 的过去式" }
    ]
  }, { prisma });

  assert.equal(entryWrite.where.headword, "carry");
  assert.equal(entryWrite.create.schemaVersion, "student-dictionary-entry-v1");
  assert.deepEqual(aliasWrites.map((item) => item.where.term), ["carry", "carried"]);
  assert.equal(aliasWrites.every((item) => item.create.entryId === "entry-1"), true);
  assert.equal(aliasWrites.every((item) => !("entryId" in item.update)), true);
  assert.equal(aliasReads, 2);
  assert.equal(result.headword, "carry");
});

test("dictionary repository rejects an alias already owned by another headword before alias writes", async () => {
  let aliasWrites = 0;
  const tx = {
    dictionaryEntry: {
      upsert: async ({ create }) => ({ id: "entry-1", ...create })
    },
    dictionaryAlias: {
      upsert: async () => {
        aliasWrites += 1;
        return {};
      },
      findMany: async () => [{ term: "better", entryId: "entry-good" }]
    }
  };
  const prisma = { $transaction: async (run) => run(tx) };

  await assert.rejects(
    upsertDictionaryEntryWithAliases({
      headword: "well",
      schemaVersion: "student-dictionary-entry-v1",
      card: { headword: "well" },
      aliases: [{ term: "better", relationType: "comparative", relationLabel: "比较级" }]
    }, { prisma }),
    /Dictionary alias conflict: better/
  );
  assert.equal(aliasWrites, 0);
});

test("dictionary repository rechecks alias ownership after writes", async () => {
  let aliasReads = 0;
  let aliasWrites = 0;
  const tx = {
    dictionaryEntry: {
      upsert: async ({ create }) => ({ id: "entry-well", ...create })
    },
    dictionaryAlias: {
      findMany: async () => {
        aliasReads += 1;
        return aliasReads === 1
          ? []
          : [{ term: "better", entryId: "entry-good" }];
      },
      upsert: async () => {
        aliasWrites += 1;
        return {};
      }
    }
  };
  const prisma = { $transaction: async (run) => run(tx) };

  await assert.rejects(
    upsertDictionaryEntryWithAliases({
      headword: "well",
      schemaVersion: "student-dictionary-entry-v1",
      card: { headword: "well" },
      aliases: [{ term: "better", relationType: "comparative", relationLabel: "比较级" }]
    }, { prisma }),
    /Dictionary alias conflict: better/
  );
  assert.equal(aliasWrites, 1);
  assert.equal(aliasReads, 2);
});
