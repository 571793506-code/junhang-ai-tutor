DROP TABLE IF EXISTS "VocabularyEntry";

CREATE TABLE "DictionaryEntry" (
    "id" TEXT NOT NULL,
    "headword" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'student-dictionary-entry-v1',
    "card" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DictionaryAlias" (
    "term" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "relationLabel" TEXT NOT NULL,

    CONSTRAINT "DictionaryAlias_pkey" PRIMARY KEY ("term")
);

CREATE UNIQUE INDEX "DictionaryEntry_headword_key" ON "DictionaryEntry"("headword");
CREATE INDEX "DictionaryAlias_entryId_idx" ON "DictionaryAlias"("entryId");

ALTER TABLE "DictionaryAlias"
ADD CONSTRAINT "DictionaryAlias_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "DictionaryEntry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
