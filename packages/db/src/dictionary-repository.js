import { prisma as defaultPrisma } from "./client.js";

export async function findDictionaryEntryByTerm(
  term,
  { prisma = defaultPrisma } = {}
) {
  return prisma.dictionaryAlias.findUnique({
    where: { term },
    include: { entry: true }
  });
}

export async function upsertDictionaryEntryWithAliases(
  input,
  { prisma = defaultPrisma } = {}
) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.dictionaryEntry.upsert({
      where: { headword: input.headword },
      create: {
        headword: input.headword,
        schemaVersion: input.schemaVersion,
        card: input.card
      },
      update: {
        schemaVersion: input.schemaVersion,
        card: input.card
      }
    });

    const terms = input.aliases.map((alias) => alias.term);
    const existingAliases = await tx.dictionaryAlias.findMany({
      where: { term: { in: terms } },
      select: { term: true, entryId: true }
    });
    const existingConflict = existingAliases.find((alias) => alias.entryId !== entry.id);
    if (existingConflict) {
      throw new Error(`Dictionary alias conflict: ${existingConflict.term}`);
    }

    for (const alias of input.aliases) {
      await tx.dictionaryAlias.upsert({
        where: { term: alias.term },
        create: { ...alias, entryId: entry.id },
        update: {
          relationType: alias.relationType,
          relationLabel: alias.relationLabel
        }
      });
    }

    const storedAliases = await tx.dictionaryAlias.findMany({
      where: { term: { in: terms } },
      select: { term: true, entryId: true }
    });
    const conflict = storedAliases.find((alias) => alias.entryId !== entry.id);
    if (conflict) throw new Error(`Dictionary alias conflict: ${conflict.term}`);

    return entry;
  });
}
