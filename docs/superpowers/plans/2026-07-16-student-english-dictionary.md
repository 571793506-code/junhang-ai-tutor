# Student Shared English Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the student personal vocabulary wordbook and legacy one-off card generator with a shared, API-backed English dictionary that resolves common word forms to a headword and returns a complete, student-safe dictionary entry.

**Architecture:** Store one validated `student-dictionary-entry-v1` card per global headword and resolve queried forms through globally unique aliases. A focused AI adapter produces strict JSON drafts, a focused service validates and caches them, and a student-only API returns a whitelist DTO with a query-specific relation. Web and Mini Program render the same single-result contract and contain no static dictionary or personal CRUD behavior.

**Tech Stack:** Prisma/PostgreSQL, Node.js ESM and Node test runner, Express, React/TypeScript/Vite, WeChat Mini Program JavaScript/WXML/WXSS.

---

## Locked File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Replace the personal `VocabularyEntry` relation/model with global `DictionaryEntry` and `DictionaryAlias` models. |
| `packages/db/prisma/migrations/20260716100000_student_english_dictionary/migration.sql` | Drop the unused personal wordbook table and create shared dictionary cache tables and constraints. |
| `packages/db/src/dictionary-repository.js` | Query by alias and transactionally upsert one headword plus all validated aliases. |
| `packages/db/src/dictionary-repository.test.mjs` | Lock alias lookup, global ownership, and transactional upsert behavior. |
| `packages/db/src/index.js` | Export the focused dictionary repository. |
| `packages/db/src/index.d.ts` | Declare the shared dictionary repository functions and remove personal wordbook declarations. |
| `packages/ai/src/student-dictionary.js` | Call GPT-5.6 for a strict shared dictionary draft without persistence or student personalization. |
| `packages/ai/src/student-dictionary.test.mjs` | Lock the prompt, strict JSON request, provider failure, and parsed draft behavior using an injected fake model call. |
| `packages/ai/src/index.js` | Export the new dictionary generator. |
| `packages/ai/src/index.d.ts` | Declare the new generator and retire the legacy vocabulary-card declaration. |
| `packages/ai/src/runtime.js` | Remove the obsolete `generateVocabularyCard` implementation after the new adapter is tested. |
| `packages/ai/src/gpt56-runtime.test.mjs` | Replace the legacy vocabulary workflow assertion with the new dictionary workflow assertion. |
| `packages/core/src/domain.js` | Rename the Mini Program surface metadata to `英语词典`. |
| `packages/core/src/startup-mode.js` | Rename the startup demo scope to `英语词典`. |
| `packages/services/src/student-dictionary.js` | Normalize input, validate model output, build aliases, serve cache hits, persist valid misses, and create the student result. |
| `packages/services/src/student-dictionary.test.mjs` | Lock validation, cache-hit zero-call behavior, cache miss persistence, form resolution, and failure-without-persistence. |
| `packages/services/src/index.js` | Export the dictionary service and remove obsolete personal wordbook imports/functions. |
| `packages/services/src/index.d.ts` | Declare the dictionary service contract and remove personal wordbook declarations. |
| `apps/api/src/student-dictionary-response.js` | Whitelist nested dictionary fields for students. |
| `apps/api/src/student-dictionary-routes.test.mjs` | Lock student-only authentication, generic errors, no student identity forwarding, and response filtering. |
| `apps/api/src/qa-response.test.mjs` | Keep QA route/type slicing valid after the old vocabulary route and type are removed. |
| `apps/api/src/server.js` | Register `POST /api/student/dictionary/query` and remove legacy vocabulary routes. |
| `apps/web/src/api.ts` | Define the shared entry type and query wrapper. |
| `apps/web/src/main.tsx` | Render one rich dictionary result and remove personal/static vocabulary behavior from the student module. |
| `apps/web/src/styles.css` | Style the structured entry sections and responsive dictionary layout. |
| `apps/miniprogram/utils/api.js` | Add the shared dictionary query wrapper and remove personal wordbook wrappers. |
| `apps/miniprogram/pages/student/vocabulary/index.js` | Submit one word, retain input on failure, and render only a complete API result. |
| `apps/miniprogram/pages/student/vocabulary/index.wxml` | Render the shared dictionary entry hierarchy. |
| `apps/miniprogram/pages/student/vocabulary/index.wxss` | Style query, loading, error, and entry sections. |
| `apps/miniprogram/pages/student/vocabulary/index.json` | Rename the navigation title to `英语词典`. |
| `apps/miniprogram/pages/student/home/index.js` | Rename the module card and description to dictionary query language. |
| `scripts/student-english-dictionary-ui.test.mjs` | Prevent Web or Mini Program from returning to static matching, personal CRUD, or incomplete card rendering. |
| `package.json` | Replace the personal wordbook check with one shared dictionary check. |
| `docs/14-api-contract.md` | Document the student dictionary request, response, errors, and privacy boundary. |
| `docs/44-miniprogram-migration-runbook.md` | Record that the student vocabulary page now uses the shared dictionary API. |

The applied migration `packages/db/prisma/migrations/20260715123000_student_vocabulary_wordbook/migration.sql` remains in Git history. Do not edit or delete an applied migration; the new migration removes its table.

The unrelated user change in `apps/miniprogram/pages/teacher/students/index.wxml` must remain unstaged and unchanged throughout implementation.

## Task 1: Replace the Personal Wordbook Table With a Shared Dictionary Cache

**Files:**
- Modify: `packages/db/prisma/schema.prisma:90-115,389-414`
- Create: `packages/db/prisma/migrations/20260716100000_student_english_dictionary/migration.sql`
- Create: `packages/db/src/dictionary-repository.js`
- Create: `packages/db/src/dictionary-repository.test.mjs`
- Modify: `packages/db/src/index.js:1-3`
- Modify: `packages/db/src/index.d.ts:1-27`
- Modify: `packages/db/src/repositories.js:429-486`
- Delete: `packages/db/src/vocabulary-entry.test.mjs`

- [ ] **Step 1: Write the failing repository test**

Create `packages/db/src/dictionary-repository.test.mjs`:

```js
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
  const tx = {
    dictionaryEntry: {
      upsert: async (input) => {
        entryWrite = input;
        return { id: "entry-1", headword: "carry", card: input.create.card };
      }
    },
    dictionaryAlias: {
      findMany: async () => aliasWrites.map((item) => ({
        term: item.where.term,
        entryId: "entry-1"
      })),
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
  assert.equal(result.headword, "carry");
});

test("dictionary repository rejects an alias already owned by another headword", async () => {
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
```

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bat
node --test packages/db/src/dictionary-repository.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `dictionary-repository.js`.

- [ ] **Step 3: Replace the Prisma model and add the forward migration**

Remove `vocabularyEntries VocabularyEntry[]` from `Student`. Remove the `VocabularyEntry` model. Add:

```prisma
model DictionaryEntry {
  id            String            @id @default(cuid())
  headword      String            @unique
  schemaVersion String            @default("student-dictionary-entry-v1")
  card          Json
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  aliases       DictionaryAlias[]
}

model DictionaryAlias {
  term          String          @id
  entryId       String
  relationType  String
  relationLabel String
  entry         DictionaryEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)

  @@index([entryId])
}
```

Create `packages/db/prisma/migrations/20260716100000_student_english_dictionary/migration.sql`:

```sql
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
```

- [ ] **Step 4: Implement the focused repository and exports**

Create `packages/db/src/dictionary-repository.js`:

```js
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
```

Add to `packages/db/src/index.js`:

```js
export * from "./dictionary-repository.js";
```

Replace the personal declarations in `packages/db/src/index.d.ts` with:

```ts
export declare function findDictionaryEntryByTerm(
  term: string,
  options?: { prisma?: PrismaClient }
): Promise<any>;
export declare function upsertDictionaryEntryWithAliases(
  input: Record<string, any>,
  options?: { prisma?: PrismaClient }
): Promise<any>;
```

Remove `upsertVocabularyEntry`, `listStudentVocabularyEntries`, `deleteStudentVocabularyEntry`, and the obsolete `recordVocabularyRecord` write helper from `packages/db/src/repositories.js` and `packages/db/src/index.d.ts`. Keep the `VocabularyRecord` Prisma model, its existing rows, and the API audit mapper unchanged; the new student dictionary never appends personal query records.

- [ ] **Step 5: Remove the obsolete repository test and verify GREEN**

Delete `packages/db/src/vocabulary-entry.test.mjs`, then run:

```bat
node --test packages/db/src/dictionary-repository.test.mjs
cmd /c npm.cmd run db:generate
cmd /c npm.cmd run db:validate
```

Expected: 3 tests pass; Prisma generation and validation exit 0.

- [ ] **Step 6: Commit the database layer**

```bat
git add -- packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260716100000_student_english_dictionary/migration.sql packages/db/src/dictionary-repository.js packages/db/src/dictionary-repository.test.mjs packages/db/src/index.js packages/db/src/index.d.ts packages/db/src/repositories.js packages/db/src/vocabulary-entry.test.mjs
git commit -m "feat: add shared student dictionary cache"
```

## Task 2: Add the Strict Dictionary Draft Generator

**Files:**
- Create: `packages/ai/src/student-dictionary.js`
- Create: `packages/ai/src/student-dictionary.test.mjs`
- Modify: `packages/ai/src/index.js:1-4`
- Modify: `packages/ai/src/index.d.ts:195-210`
- Modify: `packages/ai/src/runtime.js:640-760`
- Modify: `packages/ai/src/gpt56-runtime.test.mjs:1-20,680-750`
- Modify: `packages/core/src/domain.js:85-95`
- Modify: `packages/core/src/startup-mode.js:1-12`

- [ ] **Step 1: Write the failing AI adapter tests**

Create `packages/ai/src/student-dictionary.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { generateStudentDictionaryDraft } from "./student-dictionary.js";

const config = {
  GPT56_API_KEY: "test-key",
  GPT56_BASE_URL: "http://127.0.0.1:9999",
  GPT56_MODEL: "gpt-5.6"
};

test("dictionary generator requests a strict non-personalized JSON draft", async () => {
  let capturedMessages = null;
  let capturedOptions = null;
  const result = await generateStudentDictionaryDraft(config, { word: "carried" }, {
    callModel: async (_config, messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return {
        choices: [{
          message: {
            content: JSON.stringify({
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
              usageNotes: ["carry 强调携带或搬运"],
              pitfalls: ["过去式要把 y 变成 i 再加 ed"]
            })
          }
        }]
      };
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.draft.headword, "carry");
  assert.equal(capturedOptions.responseFormat.type, "json_object");
  assert.equal(capturedOptions.reasoningEffort, "none");
  assert.match(capturedMessages[0].content, /student-dictionary-entry-v1/);
  assert.doesNotMatch(capturedMessages[1].content, /studentId|studentName/);
});

test("dictionary generator returns unavailable without a configured provider", async () => {
  const result = await generateStudentDictionaryDraft({}, { word: "carry" });
  assert.equal(result.available, false);
  assert.equal(result.draft, null);
  assert.equal(result.modelRun.status, "SKIPPED");
});
```

- [ ] **Step 2: Run the AI tests and verify RED**

Run:

```bat
node --test packages/ai/src/student-dictionary.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `student-dictionary.js`.

- [ ] **Step 3: Implement the dictionary AI adapter**

Create `packages/ai/src/student-dictionary.js` with this public function and local helpers:

```js
import {
  buildAiStartupSnapshot,
  callGpt56Chat,
  extractChatText
} from "./runtime.js";

function parseJsonObjectText(value) {
  const source = String(value || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

async function timedCall(run) {
  const startedAt = Date.now();
  try {
    const body = await run();
    return { body, status: "SUCCESS", latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      body: null,
      status: "ERROR",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function generateStudentDictionaryDraft(config, input = {}, options = {}) {
  const queryTerm = String(input.word || "").trim().toLowerCase();
  const provider = buildAiStartupSnapshot(config).providers.find((item) => item.id === "gpt56");
  if (provider?.status !== "ready") {
    return {
      available: false,
      draft: null,
      modelRun: {
        provider: "gpt56",
        model: provider?.model || null,
        skill: "student-dictionary-entry",
        inputSummary: queryTerm,
        outputSummary: "Provider unavailable",
        status: "SKIPPED"
      }
    };
  }

  const messages = [
    {
      role: "system",
      content: [
        "你是小学三到六年级英语词典编写助手。",
        "只返回严格 JSON，不输出 JSON 之外的解释。",
        "schemaVersion 必须是 student-dictionary-entry-v1。",
        "字段必须为 schemaVersion, queryTerm, headword, phonetic, queryRelation, parts, forms, wordFamily, synonyms, antonyms, collocations, examples, usageNotes, pitfalls。",
        "queryRelation 包含 type 和中文 label。parts 每项包含 part, partCn, meanings。",
        "forms 每项包含 term, type, label；必须覆盖查询词与原形的关系。",
        "examples 至少两项，每项包含 sentence 和中文 translation。",
        "不要虚构不适用的反义词或词形，不要提及模型、供应商、提示词或内部系统。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({ queryTerm, audience: "小学三至六年级" })
    }
  ];
  const callModel = options.callModel || callGpt56Chat;
  const result = await timedCall(() => callModel(config, messages, {
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    maxTokens: 1800,
    timeoutMs: 30000,
    reasoningEffort: "none"
  }));
  const draft = result.body ? parseJsonObjectText(extractChatText(result.body)) : null;

  return {
    available: result.status === "SUCCESS" && Boolean(draft),
    draft,
    raw: result.body,
    error: result.error,
    modelRun: {
      provider: "gpt56",
      model: provider.model,
      skill: "student-dictionary-entry",
      inputSummary: queryTerm,
      outputSummary: draft ? JSON.stringify(draft).slice(0, 240) : "Invalid dictionary JSON",
      status: result.status === "SUCCESS" && draft ? "SUCCESS" : "ERROR",
      latencyMs: result.latencyMs,
      metadata: { queryTerm, schemaVersion: "student-dictionary-entry-v1" }
    }
  };
}
```

- [ ] **Step 4: Export the adapter and retire the old generator**

Add to `packages/ai/src/index.js`:

```js
export * from "./student-dictionary.js";
```

Replace the old declaration in `packages/ai/src/index.d.ts` with:

```ts
export declare function generateStudentDictionaryDraft(
  config: RuntimeConfigLike,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
```

Remove `normalizeVocabularyCard` and `generateVocabularyCard` from `packages/ai/src/runtime.js`. In `packages/ai/src/gpt56-runtime.test.mjs`, import `generateStudentDictionaryDraft`, return a full `student-dictionary-entry-v1` object when the prompt contains `英语词典编写助手`, call it with `{ word: "study" }`, and change the marker assertion from `词汇助教` to `英语词典编写助手`.

In the `vocabulary-text` capability entry, change the label to `英语词典查询` and `appSurface` to `英语词典`. Change the `vocabulary-voice` and `spoken-practice` `appSurface` values to `英语词典` without enabling their deferred UI features. Change `packages/core/src/domain.js` and `packages/core/src/startup-mode.js` from `英语词汇助手` to `英语词典` only in shared surface metadata.

- [ ] **Step 5: Verify the AI layer**

Run:

```bat
node --test packages/ai/src/student-dictionary.test.mjs packages/ai/src/gpt56-runtime.test.mjs
```

Expected: all tests pass; the provider routing test still reports GPT-5.6 and `reasoning_effort=none` for the dictionary workflow.

- [ ] **Step 6: Commit the AI layer**

```bat
git add -- packages/ai/src/student-dictionary.js packages/ai/src/student-dictionary.test.mjs packages/ai/src/index.js packages/ai/src/index.d.ts packages/ai/src/runtime.js packages/ai/src/gpt56-runtime.test.mjs packages/core/src/domain.js packages/core/src/startup-mode.js
git commit -m "feat: generate structured student dictionary entries"
```

## Task 3: Implement Validation, Alias Resolution, and Shared Cache Semantics

**Files:**
- Create: `packages/services/src/student-dictionary.js`
- Create: `packages/services/src/student-dictionary.test.mjs`
- Modify: `packages/services/src/index.js:1-35,3978-4085`
- Modify: `packages/services/src/index.d.ts:50-85`
- Delete: `packages/services/src/vocabulary-wordbook.test.mjs`

- [ ] **Step 1: Write failing service tests**

Create `packages/services/src/student-dictionary.test.mjs` with one valid fixture and these tests:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("dictionary term normalization accepts words and rejects other input", () => {
  assert.equal(normalizeDictionaryTerm(" Carried "), "carried");
  assert.equal(normalizeDictionaryTerm("mother-in-law"), "mother-in-law");
  assert.equal(normalizeDictionaryTerm("123"), "");
  assert.equal(normalizeDictionaryTerm("中文"), "");
});

test("dictionary validation requires a real form relationship and two bilingual examples", () => {
  assert.equal(validateDictionaryDraft("carried", validDraft, { requireQueryRelation: true }).ok, true);
  assert.equal(validateDictionaryDraft("better", { ...validDraft, queryTerm: "better" }).ok, false);
  assert.equal(validateDictionaryDraft("carried", { ...validDraft, examples: validDraft.examples.slice(0, 1) }).ok, false);
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
  assert.equal(result.entry.queryRelation.term, "carried");
  assert.equal(modelCalls, 0);
});

test("cache miss generates once and persists the headword plus aliases", async () => {
  let saved = null;
  const result = await queryStudentDictionaryService({}, { word: "carried" }, {
    findEntry: async () => null,
    generateDraft: async () => ({ available: true, draft: validDraft, modelRun: null }),
    saveEntry: async (input) => {
      saved = input;
      return { id: "entry-1", headword: input.headword, card: input.card };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(saved.headword, "carry");
  assert.equal("queryTerm" in saved.card, false);
  assert.equal("queryRelation" in saved.card, false);
  assert.equal(saved.aliases.some((item) => item.term === "carry" && item.relationType === "headword"), true);
  assert.equal(saved.aliases.some((item) => item.term === "carried" && item.relationType === "past"), true);
});

test("invalid generated content is not persisted or returned", async () => {
  let saveCalls = 0;
  const result = await queryStudentDictionaryService({}, { word: "carried" }, {
    findEntry: async () => null,
    generateDraft: async () => ({ available: false, draft: null, modelRun: null }),
    saveEntry: async () => {
      saveCalls += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "DICTIONARY_QUERY_UNAVAILABLE");
  assert.equal(saveCalls, 0);
});

test("thrown generation failures return a generic error without persistence", async () => {
  let saveCalls = 0;
  const result = await queryStudentDictionaryService({}, { word: "carry" }, {
    findEntry: async () => null,
    generateDraft: async () => {
      throw new Error("upstream secret");
    },
    saveEntry: async () => {
      saveCalls += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "暂时无法完成查询，请稍后重试。");
  assert.equal(saveCalls, 0);
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```bat
node --test packages/services/src/student-dictionary.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `student-dictionary.js`.

- [ ] **Step 3: Implement normalization and strict validation**

Create `packages/services/src/student-dictionary.js`. Export these constants and helpers:

```js
import { generateStudentDictionaryDraft } from "@junhang/ai";
import { inspectEncodingPayload } from "@junhang/core";
import {
  findDictionaryEntryByTerm,
  recordModelRun,
  upsertDictionaryEntryWithAliases
} from "@junhang/db";

export const DICTIONARY_SCHEMA_VERSION = "student-dictionary-entry-v1";
export const DICTIONARY_RELATION_TYPES = new Set([
  "headword",
  "plural",
  "third_person",
  "past",
  "past_participle",
  "present_participle",
  "comparative",
  "superlative",
  "irregular"
]);

function text(value) {
  return String(value ?? "").trim();
}

function textList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function normalizeDictionaryTerm(value) {
  const term = text(value).toLowerCase();
  return /^[a-z]+(?:['-][a-z]+)*$/.test(term) ? term : "";
}

export function normalizeDictionaryDraft(queryTerm, draft = {}) {
  return {
    schemaVersion: text(draft.schemaVersion),
    queryTerm: normalizeDictionaryTerm(draft.queryTerm || queryTerm),
    headword: normalizeDictionaryTerm(draft.headword),
    phonetic: text(draft.phonetic),
    queryRelation: {
      type: text(draft.queryRelation?.type),
      label: text(draft.queryRelation?.label)
    },
    parts: Array.isArray(draft.parts) ? draft.parts.map((item) => ({
      part: text(item?.part),
      partCn: text(item?.partCn),
      meanings: textList(item?.meanings)
    })).filter((item) => item.partCn && item.meanings.length) : [],
    forms: Array.isArray(draft.forms) ? draft.forms.map((item) => ({
      term: normalizeDictionaryTerm(item?.term),
      type: text(item?.type),
      label: text(item?.label)
    })).filter((item) => item.term) : [],
    wordFamily: Array.isArray(draft.wordFamily) ? draft.wordFamily.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      partCn: text(item?.partCn),
      meaning: text(item?.meaning)
    })).filter((item) => item.word && item.meaning) : [],
    synonyms: Array.isArray(draft.synonyms) ? draft.synonyms.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      meaning: text(item?.meaning),
      difference: text(item?.difference)
    })).filter((item) => item.word && item.meaning) : [],
    antonyms: Array.isArray(draft.antonyms) ? draft.antonyms.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      meaning: text(item?.meaning)
    })).filter((item) => item.word && item.meaning) : [],
    collocations: Array.isArray(draft.collocations) ? draft.collocations.map((item) => ({
      phrase: text(item?.phrase),
      meaning: text(item?.meaning)
    })).filter((item) => item.phrase && item.meaning) : [],
    examples: Array.isArray(draft.examples) ? draft.examples.map((item) => ({
      sentence: text(item?.sentence),
      translation: text(item?.translation)
    })).filter((item) => item.sentence && item.translation) : [],
    usageNotes: textList(draft.usageNotes),
    pitfalls: textList(draft.pitfalls)
  };
}

export function sharedDictionaryCard(card) {
  const { queryTerm: _queryTerm, queryRelation: _queryRelation, ...shared } = card;
  return shared;
}

export function validateDictionaryDraft(queryTerm, draft, options = {}) {
  const query = normalizeDictionaryTerm(queryTerm);
  const card = normalizeDictionaryDraft(query, draft);
  const issues = [];
  if (!query) issues.push("invalid-query");
  if (card.queryTerm !== query) issues.push("query-term-mismatch");
  if (card.schemaVersion !== DICTIONARY_SCHEMA_VERSION) issues.push("invalid-schema-version");
  if (!card.headword || !card.phonetic) issues.push("missing-headword-or-phonetic");
  if (!card.parts.length) issues.push("missing-parts");
  if (card.examples.length < 2) issues.push("missing-bilingual-examples");
  if (options.requireQueryRelation !== false) {
    if (!DICTIONARY_RELATION_TYPES.has(card.queryRelation.type) || !card.queryRelation.label) {
      issues.push("invalid-query-relation");
    }
    if (query === card.headword && card.queryRelation.type !== "headword") {
      issues.push("headword-relation-mismatch");
    }
    if (query !== card.headword) {
      const matchingForm = card.forms.find((item) =>
        item.term === query && item.type === card.queryRelation.type && item.label
      );
      if (!matchingForm) issues.push("query-form-not-explained");
    }
  }
  if (card.forms.some((item) => !DICTIONARY_RELATION_TYPES.has(item.type) || !item.label)) {
    issues.push("invalid-form");
  }
  if (!inspectEncodingPayload(card).ok) issues.push("invalid-encoding");
  return { ok: issues.length === 0, issues, card };
}
```

- [ ] **Step 4: Implement aliases, cache hits, and valid cache misses**

Add to the same file:

```js
export function buildDictionaryAliases(queryTerm, card) {
  const aliases = new Map();
  aliases.set(card.headword, {
    term: card.headword,
    relationType: "headword",
    relationLabel: `${card.headword} 的原形`
  });
  for (const form of card.forms) {
    if (!aliases.has(form.term)) {
      aliases.set(form.term, {
        term: form.term,
        relationType: form.type,
        relationLabel: `${form.term} 是 ${card.headword} 的${form.label}`
      });
    }
  }
  const query = normalizeDictionaryTerm(queryTerm);
  if (query === card.headword) return [...aliases.values()];
  const queryForm = card.forms.find((item) =>
    item.term === query && item.type === card.queryRelation.type
  );
  if (queryForm) {
    aliases.set(query, {
      term: query,
      relationType: card.queryRelation.type,
      relationLabel: card.queryRelation.label
    });
  }
  return [...aliases.values()];
}

export function buildStudentDictionaryEntry(card, alias) {
  return {
    ...card,
    queryRelation: {
      term: alias.term,
      headword: card.headword,
      type: alias.relationType,
      label: alias.relationLabel
    }
  };
}

function unavailableResult() {
  return {
    ok: false,
    error: "DICTIONARY_QUERY_UNAVAILABLE",
    message: "暂时无法完成查询，请稍后重试。"
  };
}

export async function queryStudentDictionaryService(config, input = {}, options = {}) {
  const term = normalizeDictionaryTerm(input.word);
  if (!term) {
    return { ok: false, error: "DICTIONARY_WORD_INVALID", message: "请输入英文单词。" };
  }

  const findEntry = options.findEntry || findDictionaryEntryByTerm;
  const generateDraft = options.generateDraft || generateStudentDictionaryDraft;
  const saveEntry = options.saveEntry || upsertDictionaryEntryWithAliases;
  const recordRun = options.recordRun || recordModelRun;

  let cached = null;
  try {
    cached = await findEntry(term, { prisma: options.prisma });
  } catch {
    return unavailableResult();
  }

  if (cached?.entry?.card) {
    const validated = validateDictionaryDraft(term, {
      ...cached.entry.card,
      queryTerm: term,
      queryRelation: {
        type: cached.relationType,
        label: cached.relationLabel
      }
    }, { requireQueryRelation: true });
    if (validated.ok) {
      return {
        ok: true,
        entry: buildStudentDictionaryEntry(validated.card, cached)
      };
    }
  }

  let generated = null;
  try {
    generated = await generateDraft(config, { word: term });
    if (generated.modelRun && options.persist !== false) {
      await recordRun(generated.modelRun, { prisma: options.prisma });
    }
  } catch {
    return unavailableResult();
  }
  if (!generated.available || !generated.draft) return unavailableResult();

  const validated = validateDictionaryDraft(term, generated.draft, { requireQueryRelation: true });
  if (!validated.ok) return unavailableResult();
  const aliases = buildDictionaryAliases(term, validated.card);
  const queryAlias = aliases.find((item) => item.term === term);
  if (!queryAlias) return unavailableResult();

  if (options.persist !== false) {
    try {
      await saveEntry({
        headword: validated.card.headword,
        schemaVersion: DICTIONARY_SCHEMA_VERSION,
        card: sharedDictionaryCard(validated.card),
        aliases
      }, { prisma: options.prisma });
    } catch {
      return unavailableResult();
    }
  }

  return {
    ok: true,
    entry: buildStudentDictionaryEntry(validated.card, queryAlias)
  };
}
```

- [ ] **Step 5: Export the service and remove personal wordbook services**

Add to `packages/services/src/index.js`:

```js
export * from "./student-dictionary.js";
```

Remove the `generateVocabularyCard`, personal vocabulary repository imports, `generateVocabularyCardService`, `normalizeVocabularyWords`, `addStudentVocabularyEntriesService`, `listStudentVocabularyEntriesService`, and `deleteStudentVocabularyEntryService` code from `packages/services/src/index.js`. Remove their declarations from `packages/services/src/index.d.ts` and add:

```ts
export declare function normalizeDictionaryTerm(value: unknown): string;
export declare function validateDictionaryDraft(
  queryTerm: string,
  draft: Record<string, unknown>,
  options?: { requireQueryRelation?: boolean }
): { ok: boolean; issues: string[]; card: Record<string, unknown> };
export declare function queryStudentDictionaryService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
```

Delete `packages/services/src/vocabulary-wordbook.test.mjs`.

- [ ] **Step 6: Verify the service layer**

Run:

```bat
node --test packages/services/src/student-dictionary.test.mjs
cmd /c npm.cmd run check:services
```

Expected: 6 dictionary tests pass and service smoke exits 0.

- [ ] **Step 7: Commit the service layer**

```bat
git add -- packages/services/src/student-dictionary.js packages/services/src/student-dictionary.test.mjs packages/services/src/index.js packages/services/src/index.d.ts packages/services/src/vocabulary-wordbook.test.mjs
git commit -m "feat: add shared dictionary query service"
```

## Task 4: Expose a Student-Only Dictionary API and Retire Legacy Routes

**Files:**
- Create: `apps/api/src/student-dictionary-response.js`
- Create: `apps/api/src/student-dictionary-routes.test.mjs`
- Modify: `apps/api/src/server.js:25-55,3310-3390`
- Modify: `apps/api/src/qa-response.test.mjs:390-425`
- Delete: `apps/api/src/student-vocabulary-wordbook.js`
- Delete: `apps/api/src/vocabulary-wordbook-routes.test.mjs`
- Modify: `docs/14-api-contract.md`

- [ ] **Step 1: Write the failing route and DTO tests**

Create `apps/api/src/student-dictionary-routes.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { cleanStudentDictionaryEntry } from "./student-dictionary-response.js";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("student dictionary route is authenticated, database-backed, and identity-free", () => {
  const start = source.indexOf('app.post("/api/student/dictionary/query"');
  const end = source.indexOf("\napp.", start + 1);
  assert.notEqual(start, -1);
  const route = source.slice(start, end);
  assert.match(route, /requireDatabase/);
  assert.match(route, /requireSession\(config, \["student"\]\)/);
  assert.match(route, /queryStudentDictionaryService\(config, \{ word: body\.word \}\)/);
  assert.doesNotMatch(route, /studentId|studentName|grade/);
  assert.doesNotMatch(source, /app\.(get|post|delete)\("\/api\/student\/vocabulary/);
  assert.doesNotMatch(source, /app\.post\("\/api\/ai\/vocabulary/);
});

test("student dictionary DTO removes every internal field", () => {
  const result = cleanStudentDictionaryEntry({
    schemaVersion: "student-dictionary-entry-v1",
    headword: "carry",
    phonetic: "/ˈkæri/",
    queryRelation: {
      term: "carried",
      headword: "carry",
      type: "past",
      label: "carried 是 carry 的过去式",
      provider: "secret"
    },
    parts: [{ part: "verb", partCn: "动词", meanings: ["携带"], raw: "secret" }],
    forms: [],
    wordFamily: [],
    synonyms: [],
    antonyms: [],
    collocations: [],
    examples: [
      { sentence: "She carried the books.", translation: "她搬了这些书。" },
      { sentence: "I carry my bag.", translation: "我背着书包。" }
    ],
    usageNotes: ["常用动词"],
    pitfalls: ["注意过去式"],
    provider: "secret",
    modelRunId: "run-1",
    raw: "secret"
  });

  assert.equal(result.headword, "carry");
  assert.equal(result.queryRelation.term, "carried");
  assert.equal("provider" in result, false);
  assert.equal("raw" in result.parts[0], false);
});
```

- [ ] **Step 2: Run the API test and verify RED**

Run:

```bat
node --test apps/api/src/student-dictionary-routes.test.mjs
```

Expected: FAIL because `student-dictionary-response.js` and the route do not exist.

- [ ] **Step 3: Implement the student response whitelist**

Create `apps/api/src/student-dictionary-response.js` with nested whitelist mapping:

```js
function value(input) {
  return String(input ?? "").trim();
}

function list(input, map) {
  return Array.isArray(input) ? input.map(map).filter(Boolean) : [];
}

export function cleanStudentDictionaryEntry(entry = {}) {
  return {
    schemaVersion: value(entry.schemaVersion),
    headword: value(entry.headword),
    phonetic: value(entry.phonetic),
    queryRelation: {
      term: value(entry.queryRelation?.term),
      headword: value(entry.queryRelation?.headword),
      type: value(entry.queryRelation?.type),
      label: value(entry.queryRelation?.label)
    },
    parts: list(entry.parts, (item) => ({
      part: value(item?.part),
      partCn: value(item?.partCn),
      meanings: list(item?.meanings, value)
    })),
    forms: list(entry.forms, (item) => ({
      term: value(item?.term),
      type: value(item?.type),
      label: value(item?.label)
    })),
    wordFamily: list(entry.wordFamily, (item) => ({
      word: value(item?.word),
      partCn: value(item?.partCn),
      meaning: value(item?.meaning)
    })),
    synonyms: list(entry.synonyms, (item) => ({
      word: value(item?.word),
      meaning: value(item?.meaning),
      difference: value(item?.difference)
    })),
    antonyms: list(entry.antonyms, (item) => ({
      word: value(item?.word),
      meaning: value(item?.meaning)
    })),
    collocations: list(entry.collocations, (item) => ({
      phrase: value(item?.phrase),
      meaning: value(item?.meaning)
    })),
    examples: list(entry.examples, (item) => ({
      sentence: value(item?.sentence),
      translation: value(item?.translation)
    })),
    usageNotes: list(entry.usageNotes, value),
    pitfalls: list(entry.pitfalls, value)
  };
}
```

- [ ] **Step 4: Replace all legacy vocabulary routes with the dictionary route**

In `apps/api/src/server.js`, import `queryStudentDictionaryService` and `cleanStudentDictionaryEntry`. Remove personal vocabulary service imports and the legacy cleaner import. Replace the four legacy vocabulary routes with:

```js
app.post(
  "/api/student/dictionary/query",
  requireDatabase,
  requireSession(config, ["student"]),
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const result = await queryStudentDictionaryService(config, { word: body.word });
    if (!result.ok) {
      const status = result.error === "DICTIONARY_WORD_INVALID" ? 400 : 503;
      return res.status(status).json({
        ok: false,
        error: result.error,
        message: result.message
      });
    }
    res.json({
      ok: true,
      result: { entry: cleanStudentDictionaryEntry(result.entry) }
    });
  })
);
```

Delete `apps/api/src/student-vocabulary-wordbook.js` and `apps/api/src/vocabulary-wordbook-routes.test.mjs`.

Update `apps/api/src/qa-response.test.mjs` so the QA route slice ends at `app.post("/api/student/dictionary/query"` and the Web QA type slice ends at `export type StudentDictionaryEntry`. Do not weaken its assertions about hidden persistence fields.

- [ ] **Step 5: Document the exact API contract**

Append this contract to `docs/14-api-contract.md`:

```markdown
## 2026-07-16 学生共享英语词典

- `POST /api/student/dictionary/query`
  - 仅接受已登录学生会话，请求为 `{ "word": "carried" }`。
  - 查询不接收或保存 `studentId`、学生姓名、年级、个人历史或个人笔记。
  - 缓存命中直接返回共享词条；未命中时生成、校验并写入共享缓存。
  - 成功响应为 `{ "ok": true, "result": { "entry": student-dictionary-entry-v1 } }`。
  - 非英文输入返回 `400 DICTIONARY_WORD_INVALID`。
  - 模型失败、结构不完整或共享缓存不可用返回通用 `503 DICTIONARY_QUERY_UNAVAILABLE`。
  - 响应不得包含供应商、模型名、prompt、raw、模型运行 ID、数据库 ID 或缓存状态。
```

- [ ] **Step 6: Verify the API layer**

Run:

```bat
node --test apps/api/src/student-dictionary-routes.test.mjs apps/api/src/qa-response.test.mjs
cmd /c npm.cmd run check:api
```

Expected: route/DTO tests pass and API check exits 0.

- [ ] **Step 7: Commit the API layer**

```bat
git add -- apps/api/src/student-dictionary-response.js apps/api/src/student-dictionary-routes.test.mjs apps/api/src/qa-response.test.mjs apps/api/src/server.js apps/api/src/student-vocabulary-wordbook.js apps/api/src/vocabulary-wordbook-routes.test.mjs docs/14-api-contract.md
git commit -m "feat: expose shared student dictionary api"
```

## Task 5: Replace the Web Vocabulary Card With a Rich Dictionary Result

**Files:**
- Create: `scripts/student-english-dictionary-ui.test.mjs`
- Modify: `apps/web/src/api.ts:150-225`
- Modify: `apps/web/src/main.tsx:35-95,1295,2070-2250`
- Modify: `apps/web/src/styles.css:1275-1360,5194-5200,5870-5890`

- [ ] **Step 1: Write the failing Web contract test**

Create `scripts/student-english-dictionary-ui.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the Web contract test and verify RED**

Run:

```bat
node --test scripts/student-english-dictionary-ui.test.mjs
```

Expected: FAIL because `queryStudentDictionary` and `StudentDictionary` do not exist.

- [ ] **Step 3: Replace the Web API type and wrapper**

Replace `VocabularyCard` and `generateVocabularyCard` in `apps/web/src/api.ts` with:

```ts
export type StudentDictionaryEntry = {
  schemaVersion: "student-dictionary-entry-v1";
  headword: string;
  phonetic: string;
  queryRelation: { term: string; headword: string; type: string; label: string };
  parts: Array<{ part: string; partCn: string; meanings: string[] }>;
  forms: Array<{ term: string; type: string; label: string }>;
  wordFamily: Array<{ word: string; partCn: string; meaning: string }>;
  synonyms: Array<{ word: string; meaning: string; difference: string }>;
  antonyms: Array<{ word: string; meaning: string }>;
  collocations: Array<{ phrase: string; meaning: string }>;
  examples: Array<{ sentence: string; translation: string }>;
  usageNotes: string[];
  pitfalls: string[];
};

export async function queryStudentDictionary(word: string) {
  const response = await fetch(`${API_BASE_URL}/api/student/dictionary/query`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ word })
  });
  return readJson<{ ok: true; result: { entry: StudentDictionaryEntry } }>(response);
}
```

- [ ] **Step 4: Implement the single-result Web component**

Rename the student navigation/module label from `英语词汇` to `英语词典`. Replace `StudentVocabularyAssistant` with `StudentDictionary`. The component must use this state and request flow:

```tsx
function StudentDictionary() {
  const [wordInput, setWordInput] = useState("");
  const [entry, setEntry] = useState<StudentDictionaryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const queryWord = async () => {
    if (!wordInput.trim() || busy) return;
    setBusy(true);
    setError("");
    setEntry(null);
    try {
      const response = await queryStudentDictionary(wordInput);
      setEntry(response.result.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return <div className="student-vocab-panel student-dictionary-panel">
    <div className="template-controls vocab-input-controls">
      <label>输入单词<input value={wordInput} onChange={(event) => setWordInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void queryWord(); }} placeholder="例如：carried" /></label>
      <button className="primary-button" disabled={busy} onClick={() => void queryWord()}><Search size={17} />{busy ? "正在查询" : "查询单词"}</button>
    </div>
    {busy ? <p className="thinking-box">正在查询并整理词条，请稍候。</p> : null}
    {error ? <p className="answer-box">{error}</p> : null}
    {!busy && !error && !entry ? <p className="review-empty">输入英文单词或常见变化形式，查看完整词义与用法。</p> : null}
    {entry ? <article className="dictionary-entry">
      <header className="dictionary-entry-head"><div><h2>{entry.headword}</h2><p>{entry.phonetic}</p><strong>{entry.queryRelation.label}</strong></div><StatusPill label="AI生成" status="ready" /></header>
      <section><h3>词性与释义</h3>{entry.parts.map((item) => <div className="dictionary-part" key={`${item.part}-${item.partCn}`}><strong>{item.partCn} · {item.part}</strong><ul>{item.meanings.map((meaning) => <li key={meaning}>{meaning}</li>)}</ul></div>)}</section>
      {entry.forms.length ? <section><h3>词形变化</h3><div className="dictionary-chip-grid">{entry.forms.map((item) => <span key={`${item.term}-${item.type}`}><strong>{item.term}</strong>{item.label}</span>)}</div></section> : null}
      {entry.wordFamily.length ? <section><h3>派生词</h3><div className="dictionary-card-grid">{entry.wordFamily.map((item) => <div key={item.word}><strong>{item.word}</strong><span>{item.partCn}</span><p>{item.meaning}</p></div>)}</div></section> : null}
      {entry.synonyms.length ? <section><h3>近义词与区别</h3><div className="dictionary-card-grid">{entry.synonyms.map((item) => <div key={item.word}><strong>{item.word}</strong><p>{item.meaning}</p><span>{item.difference}</span></div>)}</div></section> : null}
      {entry.antonyms.length ? <section><h3>反义词</h3><div className="dictionary-chip-grid">{entry.antonyms.map((item) => <span key={item.word}><strong>{item.word}</strong>{item.meaning}</span>)}</div></section> : null}
      {entry.collocations.length ? <section><h3>常用搭配</h3><div className="dictionary-chip-grid">{entry.collocations.map((item) => <span key={item.phrase}><strong>{item.phrase}</strong>{item.meaning}</span>)}</div></section> : null}
      <section><h3>双语例句</h3><div className="dictionary-example-list">{entry.examples.map((item) => <div key={item.sentence}><strong>{item.sentence}</strong><span>{item.translation}</span></div>)}</div></section>
      {entry.usageNotes.length ? <section><h3>用法说明</h3><ul>{entry.usageNotes.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      {entry.pitfalls.length ? <section><h3>易错点</h3><ul>{entry.pitfalls.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    </article> : null}
  </div>;
}
```

Import `StudentDictionaryEntry` and `queryStudentDictionary`, call `<StudentDictionary />`, and remove the old query component's dependency on `student`. Remove the dead `createVocabularyEntry` function. The separate `demoVocabulary` usage inside `englishFocusMeaning` may remain because it supports task-focus display, but it must not appear in `StudentDictionary`.

- [ ] **Step 5: Add focused Web styles**

Add these classes to `apps/web/src/styles.css` without changing unrelated panels:

```css
.dictionary-entry {
  display: grid;
  gap: 14px;
}

.dictionary-entry > section,
.dictionary-entry-head {
  padding: 16px;
  border: 1px solid #dce8ed;
  border-radius: 10px;
  background: #fbfcfd;
}

.dictionary-entry-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dictionary-entry-head h2 {
  margin: 0;
  font-size: 32px;
}

.dictionary-entry h3 {
  margin: 0 0 10px;
  font-size: 16px;
}

.dictionary-card-grid,
.dictionary-chip-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.dictionary-card-grid > div,
.dictionary-chip-grid > span,
.dictionary-example-list > div {
  display: grid;
  gap: 5px;
  padding: 12px;
  border-radius: 8px;
  background: #eef4f6;
}

.dictionary-example-list {
  display: grid;
  gap: 10px;
}

@media (max-width: 760px) {
  .dictionary-card-grid,
  .dictionary-chip-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Verify the Web implementation**

Run:

```bat
node --test scripts/student-english-dictionary-ui.test.mjs
cmd /c npm.cmd run typecheck --workspace apps/web
```

Expected: Web contract test passes and TypeScript exits 0.

- [ ] **Step 7: Commit the Web implementation**

```bat
git add -- scripts/student-english-dictionary-ui.test.mjs apps/web/src/api.ts apps/web/src/main.tsx apps/web/src/styles.css
git commit -m "feat: add student Web dictionary query"
```

## Task 6: Replace the Mini Program Wordbook With the Shared Dictionary

**Files:**
- Modify: `scripts/student-english-dictionary-ui.test.mjs`
- Modify: `apps/miniprogram/utils/api.js:100-125`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.js`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.wxml`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.wxss`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.json`
- Modify: `apps/miniprogram/pages/student/home/index.js:20-40`
- Delete: `scripts/student-vocabulary-wordbook-miniprogram.test.mjs`
- Modify: `package.json:20-30`

- [ ] **Step 1: Extend the UI test with failing Mini Program assertions**

Append to `scripts/student-english-dictionary-ui.test.mjs`:

```js
const miniPage = fs.readFileSync(new URL("../apps/miniprogram/pages/student/vocabulary/index.js", import.meta.url), "utf8");
const miniMarkup = fs.readFileSync(new URL("../apps/miniprogram/pages/student/vocabulary/index.wxml", import.meta.url), "utf8");
const miniApi = fs.readFileSync(new URL("../apps/miniprogram/utils/api.js", import.meta.url), "utf8");

test("Mini Program student dictionary uses one shared query result without personal CRUD", () => {
  assert.match(miniApi, /queryStudentDictionary\(input\)/);
  assert.match(miniApi, /\/api\/student\/dictionary\/query/);
  assert.doesNotMatch(miniApi, /listStudentVocabulary|createStudentVocabulary|deleteStudentVocabulary|\/api\/ai\/vocabulary/);
  assert.match(miniPage, /api\.queryStudentDictionary\(\{ word \}\)/);
  assert.doesNotMatch(miniPage, /entries|loadEntries|removeVocabulary|delete/);
  for (const field of [
    "queryRelation", "parts", "forms", "wordFamily", "synonyms",
    "antonyms", "collocations", "examples", "usageNotes", "pitfalls"
  ]) {
    assert.match(miniMarkup, new RegExp(`result\\.${field}`));
  }
  assert.doesNotMatch(miniMarkup, /词汇本|删除词卡|添加词汇/);
});
```

- [ ] **Step 2: Run the UI test and verify Mini Program RED**

Run:

```bat
node --test scripts/student-english-dictionary-ui.test.mjs
```

Expected: Web test passes and Mini Program test fails on the missing `queryStudentDictionary` wrapper.

- [ ] **Step 3: Replace the Mini Program API wrappers and page logic**

Replace all four vocabulary wrappers in `apps/miniprogram/utils/api.js` with:

```js
queryStudentDictionary(input) {
  return request("/api/student/dictionary/query", { method: "POST", data: input });
},
```

Replace `apps/miniprogram/pages/student/vocabulary/index.js` with:

```js
const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

Page({
  data: {
    loading: false,
    message: "",
    result: null,
    word: ""
  },
  async onShow() {
    await guard.requireRole("student", this);
  },
  setWord(event) {
    this.setData({ word: event.detail.value });
  },
  async queryWord() {
    const word = String(this.data.word || "").trim();
    if (!word || this.data.loading) {
      if (!word) wx.showToast({ title: "请先输入英文单词", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "", result: null });
    try {
      const response = await api.queryStudentDictionary({ word });
      this.setData({ result: response.result?.entry || null });
    } catch (error) {
      this.setData({ message: error.message || "暂时无法完成查询，请稍后重试。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
```

- [ ] **Step 4: Replace the Mini Program markup and styles**

Use this hierarchy in `index.wxml`:

```xml
<view class="page student-page">
  <view class="hero">
    <text class="eyebrow">英语词典</text>
    <text class="title">查单词，也看懂它怎么用</text>
    <text class="subtitle">支持原形和常见变化形式，查询完整词义、词形、搭配与例句。</text>
  </view>
  <view class="card query-card">
    <input class="input" placeholder="例如：carried" value="{{word}}" bindinput="setWord" confirm-type="search" bindconfirm="queryWord" />
    <button class="button warm" loading="{{loading}}" bindtap="queryWord">{{loading ? "正在查询" : "查询单词"}}</button>
  </view>
  <view wx:if="{{message}}" class="card"><text class="error-text">{{message}}</text></view>
  <view wx:if="{{result}}" class="dictionary-entry">
    <view class="card entry-head"><text class="headword">{{result.headword}}</text><text class="phonetic">{{result.phonetic}}</text><text class="relation">{{result.queryRelation.label}}</text></view>
    <view class="card"><text class="section-title">词性与释义</text><view wx:for="{{result.parts}}" wx:key="part" class="entry-list"><text class="pill">{{item.partCn}} · {{item.part}}</text><text wx:for="{{item.meanings}}" wx:for-item="meaning" wx:key="*this" class="block-text">{{meaning}}</text></view></view>
    <view wx:if="{{result.forms.length}}" class="card"><text class="section-title">词形变化</text><view class="chip-grid"><view wx:for="{{result.forms}}" wx:key="term" class="chip"><text class="chip-word">{{item.term}}</text><text>{{item.label}}</text></view></view></view>
    <view wx:if="{{result.wordFamily.length}}" class="card"><text class="section-title">派生词</text><view wx:for="{{result.wordFamily}}" wx:key="word" class="entry-row"><text class="row-word">{{item.word}}</text><text>{{item.partCn}} · {{item.meaning}}</text></view></view>
    <view wx:if="{{result.synonyms.length}}" class="card"><text class="section-title">近义词与区别</text><view wx:for="{{result.synonyms}}" wx:key="word" class="entry-row"><text class="row-word">{{item.word}} · {{item.meaning}}</text><text>{{item.difference}}</text></view></view>
    <view wx:if="{{result.antonyms.length}}" class="card"><text class="section-title">反义词</text><view wx:for="{{result.antonyms}}" wx:key="word" class="entry-row"><text class="row-word">{{item.word}}</text><text>{{item.meaning}}</text></view></view>
    <view wx:if="{{result.collocations.length}}" class="card"><text class="section-title">常用搭配</text><view wx:for="{{result.collocations}}" wx:key="phrase" class="entry-row"><text class="row-word">{{item.phrase}}</text><text>{{item.meaning}}</text></view></view>
    <view class="card"><text class="section-title">双语例句</text><view wx:for="{{result.examples}}" wx:key="sentence" class="example-row"><text class="sentence">{{item.sentence}}</text><text>{{item.translation}}</text></view></view>
    <view wx:if="{{result.usageNotes.length}}" class="card"><text class="section-title">用法说明</text><text wx:for="{{result.usageNotes}}" wx:key="*this" class="block-text">{{item}}</text></view>
    <view wx:if="{{result.pitfalls.length}}" class="card"><text class="section-title">易错点</text><text wx:for="{{result.pitfalls}}" wx:key="*this" class="block-text">{{item}}</text></view>
  </view>
</view>
```

Replace `index.wxss` with:

```css
.query-card {
  display: grid;
  gap: 16rpx;
}

.dictionary-entry {
  display: grid;
  gap: 20rpx;
}

.entry-head {
  display: grid;
  gap: 10rpx;
}

.headword {
  color: #162532;
  font-size: 52rpx;
  font-weight: 800;
}

.phonetic {
  color: #167c7d;
  font-size: 28rpx;
}

.relation {
  color: #52606c;
  font-size: 26rpx;
  line-height: 1.55;
}

.entry-list,
.entry-row,
.example-row {
  display: grid;
  gap: 10rpx;
  margin-top: 16rpx;
}

.chip-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 16rpx;
}

.chip,
.entry-row,
.example-row {
  padding: 18rpx;
  border: 1rpx solid #dce8ed;
  border-radius: 12rpx;
  background: #eef4f6;
}

.chip {
  display: grid;
  gap: 6rpx;
  min-width: 0;
  color: #52606c;
  font-size: 24rpx;
}

.chip-word,
.row-word,
.sentence {
  color: #162532;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.block-text,
.entry-row,
.example-row {
  color: #52606c;
  font-size: 25rpx;
  line-height: 1.6;
}

.error-text {
  color: #b42318;
  font-size: 26rpx;
  line-height: 1.55;
}
```

These styles reuse the existing page and card surfaces and introduce no component library.

Set `index.json` navigation title to `英语词典`. In `pages/student/home/index.js`, change the module title to `英语词典`, status to `单词查询`, and description to `查词义、词形、近义词、搭配和双语例句。`.

- [ ] **Step 5: Replace the old check command and remove its test**

Delete `scripts/student-vocabulary-wordbook-miniprogram.test.mjs`. Replace the old package script with:

```json
"check:student-english-dictionary": "node --test packages/db/src/dictionary-repository.test.mjs packages/ai/src/student-dictionary.test.mjs packages/ai/src/gpt56-runtime.test.mjs packages/services/src/student-dictionary.test.mjs apps/api/src/student-dictionary-routes.test.mjs apps/api/src/qa-response.test.mjs scripts/student-english-dictionary-ui.test.mjs"
```

- [ ] **Step 6: Verify the Mini Program implementation**

Run:

```bat
cmd /c npm.cmd run check:student-english-dictionary
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
```

Expected: all dictionary tests pass; Mini Program JavaScript and encoding checks exit 0.

- [ ] **Step 7: Commit the Mini Program implementation**

```bat
git add -- scripts/student-english-dictionary-ui.test.mjs scripts/student-vocabulary-wordbook-miniprogram.test.mjs apps/miniprogram/utils/api.js apps/miniprogram/pages/student/vocabulary/index.js apps/miniprogram/pages/student/vocabulary/index.wxml apps/miniprogram/pages/student/vocabulary/index.wxss apps/miniprogram/pages/student/vocabulary/index.json apps/miniprogram/pages/student/home/index.js package.json
git commit -m "feat: add student Mini Program dictionary query"
```

## Task 7: Complete Migration, Documentation, Runtime Sync, and Full Verification

**Files:**
- Modify: `docs/44-miniprogram-migration-runbook.md`
- Verify only: all files changed in Tasks 1-6
- Preserve: `apps/miniprogram/pages/teacher/students/index.wxml`

- [ ] **Step 1: Record the final Mini Program boundary**

Add this statement to the student section of `docs/44-miniprogram-migration-runbook.md`:

```markdown
- 英语词典页只调用 `POST /api/student/dictionary/query`，一次展示一个共享词条；不保存个人查询历史，不提供个人词卡新增、列表、删除或端侧静态匹配。
```

- [ ] **Step 2: Prove legacy product code is gone**

Run each search separately in PowerShell:

```powershell
rg -n "api/student/vocabulary" apps packages scripts package.json --glob '!packages/db/prisma/migrations/**'
rg -n "api/ai/vocabulary" apps packages scripts package.json --glob '!packages/db/prisma/migrations/**'
rg -n "VocabularyEntry|upsertVocabularyEntry|listStudentVocabularyEntries|deleteStudentVocabularyEntry|generateVocabularyCard|recordVocabularyRecord" apps packages scripts package.json --glob '!packages/db/prisma/migrations/**'
rg -n "listStudentVocabulary|createStudentVocabulary|deleteStudentVocabulary" apps packages scripts package.json
```

Expected: no matches in active source, tests, or package scripts. Historical documents and applied migrations remain unchanged and are intentionally outside these searches.

- [ ] **Step 3: Apply and validate the database migration**

Run:

```bat
cmd /c npm.cmd run db:generate
cmd /c npm.cmd run db:migrate
cmd /c npm.cmd run db:validate
```

Expected: migration `20260716100000_student_english_dictionary` applies, Prisma client generation succeeds, and schema validation exits 0.

- [ ] **Step 4: Run the complete source verification set**

Run:

```bat
cmd /c npm.cmd run check:student-english-dictionary
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:services
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
git diff --check
```

Expected: every command exits 0. No authenticated cache-miss request is required because that would trigger a paid model call; the injected-model tests prove generation behavior without external side effects.

- [ ] **Step 5: Inspect and synchronize the WeChat runtime directory safely**

First run the read-only comparison:

```bat
cmd /c npm.cmd run check:miniprogram-sync
```

Expected before sync: differences are limited to the intended dictionary files (`utils/api.js`, `pages/student/vocabulary/*`, and `pages/student/home/index.js`). Confirm `pages/teacher/students/index.wxml` is not an unexpected difference. Then run:

```bat
cmd /c npm.cmd run sync:miniapp1
cmd /c npm.cmd run check:miniprogram-sync
cmd /c npm.cmd run check:miniapp1
```

Expected after sync: mirror check is clean and the runtime Mini Program check exits 0. Do not overwrite runtime-only project configuration files.

- [ ] **Step 6: Verify the unauthenticated runtime boundary**

Restart the project API through its existing launcher if needed, then run:

```powershell
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:8787/api/student/dictionary/query" -ContentType "application/json" -Body '{"word":"carry"}' -TimeoutSec 10
  throw "Expected an unauthenticated request to fail"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}
```

Expected: HTTP 401 with the public session-required response. Do not make a live authenticated dictionary miss during verification.

- [ ] **Step 7: Recheck the protected user change and workspace state**

Run:

```bat
git diff -- apps/miniprogram/pages/teacher/students/index.wxml
git status --short
cmd /c npm.cmd run workspace:guard
```

Expected: the teacher placeholder change remains exactly `教材版本，例如：人教版`; it is unstaged and is the only unrelated dirty file. Dictionary source and docs are ready for explicit staging.

- [ ] **Step 8: Commit documentation and final verification metadata**

```bat
git add -- docs/44-miniprogram-migration-runbook.md
git commit -m "docs: record shared student dictionary rollout"
```

## Completion Criteria

Implementation is complete only when all of the following are true:

- `carried` can resolve to a validated `carry` entry through a stored alias relation.
- Cache hits execute zero model calls in service tests.
- Invalid or unavailable model output performs zero dictionary writes.
- The API accepts only an authenticated student and never forwards or stores student identity for dictionary queries.
- Student responses contain the complete whitelist contract and no provider, model, prompt, raw, persistence, cache ID, or debug field.
- Web and Mini Program display one complete entry and have no personal list, add, delete, history, or static query-match behavior.
- The old personal `VocabularyEntry` table is removed by a forward migration while historical `VocabularyRecord` rows remain readable.
- All listed verification commands pass with fresh output.
- The unrelated teacher Mini Program placeholder change remains preserved and unstaged.
