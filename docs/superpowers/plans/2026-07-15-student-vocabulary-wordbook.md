# Student Vocabulary Wordbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the student Mini Program's static vocabulary lookup with a persistent, server-generated personal wordbook that supports batch creation, deduplicated refreshes, listing, and scoped deletion.

**Architecture:** Store wordbook cards in a new `VocabularyEntry` model keyed by `(studentId, word)` while leaving `VocabularyRecord` as the existing query-audit entity. The service layer normalizes input, calls the existing vocabulary-card generator, and upserts successful cards; student-only API routes expose a minimal card DTO. The Mini Program renders only these API results and never synthesizes a fallback card.

**Tech Stack:** Prisma/PostgreSQL, Node.js ESM services and tests, Express, WeChat Mini Program JavaScript/WXML/WXSS, Node test runner.

---

## Locked File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Declare the `VocabularyEntry` relation, fields, and unique constraint. |
| `packages/db/prisma/migrations/20260715123000_student_vocabulary_wordbook/migration.sql` | Create the production table, index, and student foreign key. |
| `packages/db/src/repositories.js` | Provide scoped wordbook upsert, list, and delete repository functions. |
| `packages/db/src/index.d.ts` | Declare the new repository functions. |
| `packages/db/src/vocabulary-entry.test.mjs` | Test repository query and ownership boundaries with a fake Prisma client. |
| `packages/services/src/index.js` | Normalize input and provide batch create, list, and delete wordbook services. |
| `packages/services/src/index.d.ts` | Declare the wordbook service API. |
| `packages/services/src/vocabulary-wordbook.test.mjs` | Test batch deduplication, upsert behavior, and partial generation failure. |
| `apps/api/src/server.js` | Register student-only wordbook routes and return a client-safe card DTO. |
| `apps/api/src/vocabulary-wordbook-routes.test.mjs` | Lock route authentication, session scope, and DTO boundary. |
| `apps/miniprogram/utils/api.js` | Add list, batch-create, and delete wrappers. |
| `apps/miniprogram/pages/student/vocabulary/index.js` | Load entries and perform add/delete actions through the wrappers. |
| `apps/miniprogram/pages/student/vocabulary/index.wxml` | Render batch input, state feedback, word cards, and delete controls. |
| `apps/miniprogram/pages/student/vocabulary/index.wxss` | Style the new list and loading/error states. |
| `scripts/student-vocabulary-wordbook-miniprogram.test.mjs` | Prevent a return to static vocabulary data or missing CRUD bindings without copying test code into the WeChat runtime mirror. |

## Task 1: Add the Persistent Wordbook Repository

**Files:**
- Modify: `packages/db/prisma/schema.prisma:108,388`
- Create: `packages/db/prisma/migrations/20260715123000_student_vocabulary_wordbook/migration.sql`
- Modify: `packages/db/src/repositories.js:429`
- Modify: `packages/db/src/index.d.ts:22`
- Create: `packages/db/src/vocabulary-entry.test.mjs`

- [ ] **Step 1: Write failing repository tests**

```js
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
```

- [ ] **Step 2: Run the repository test and verify it fails because the exports do not exist**

Run: `node --test packages/db/src/vocabulary-entry.test.mjs`

Expected: failure that `upsertVocabularyEntry` is not exported.

- [ ] **Step 3: Add the model, migration, repository functions, and declarations**

Add the student relation and model to `schema.prisma`:

```prisma
model Student {
  // existing fields
  vocabularyEntries VocabularyEntry[]
}

model VocabularyEntry {
  id        String   @id @default(cuid())
  studentId String
  word      String
  card      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  student   Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([studentId, word])
  @@index([studentId, updatedAt])
}
```

Create `migration.sql` with:

```sql
-- CreateTable
CREATE TABLE "VocabularyEntry" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "card" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_studentId_word_key" ON "VocabularyEntry"("studentId", "word");

-- CreateIndex
CREATE INDEX "VocabularyEntry_studentId_updatedAt_idx" ON "VocabularyEntry"("studentId", "updatedAt");

-- AddForeignKey
ALTER TABLE "VocabularyEntry" ADD CONSTRAINT "VocabularyEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Add these repository functions:

```js
export async function upsertVocabularyEntry(input, { prisma = defaultPrisma } = {}) {
  return prisma.vocabularyEntry.upsert({
    where: { studentId_word: { studentId: input.studentId, word: input.word } },
    create: { studentId: input.studentId, word: input.word, card: input.card },
    update: { card: input.card }
  });
}

export async function listStudentVocabularyEntries(studentId, { prisma = defaultPrisma } = {}) {
  return prisma.vocabularyEntry.findMany({ where: { studentId }, orderBy: { updatedAt: "desc" } });
}

export async function deleteStudentVocabularyEntry(studentId, entryId, { prisma = defaultPrisma } = {}) {
  const result = await prisma.vocabularyEntry.deleteMany({ where: { id: entryId, studentId } });
  return result.count > 0;
}
```

Declare the same three functions in `packages/db/src/index.d.ts`.

- [ ] **Step 4: Run database validation and repository tests**

Run:

```bat
cmd /c npm.cmd run db:generate
cmd /c npm.cmd run db:validate
node --test packages/db/src/vocabulary-entry.test.mjs
```

Expected: Prisma Client generation, Prisma schema validation, and the test all pass.

- [ ] **Step 5: Commit the database boundary**

```bat
git add -- packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260715123000_student_vocabulary_wordbook/migration.sql packages/db/src/repositories.js packages/db/src/index.d.ts packages/db/src/vocabulary-entry.test.mjs
git commit -m "feat: add student vocabulary entries"
```

## Task 2: Add Wordbook Services Without Reusing Audit Records

**Files:**
- Modify: `packages/services/src/index.js:19-25,519,3975`
- Modify: `packages/services/src/index.d.ts:37`
- Create: `packages/services/src/vocabulary-wordbook.test.mjs`

- [ ] **Step 1: Write failing service tests**

```js
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

  assert.deepEqual(normalizeVocabularyWords([" Carry ", "carry", "bright"]), { words: ["carry", "bright"], rejected: [] });
  assert.deepEqual(written, ["carry"]);
  assert.deepEqual(generated.entries.map((entry) => entry.word), ["carry"]);
  assert.deepEqual(generated.failures.map((item) => item.word), ["bright", "123"]);
});
```

- [ ] **Step 2: Run the service test and verify it fails because the wordbook exports do not exist**

Run: `node --test packages/services/src/vocabulary-wordbook.test.mjs`

Expected: failure that `addStudentVocabularyEntriesService` is not exported.

- [ ] **Step 3: Implement normalization and wordbook services in the existing service module**

Import `upsertVocabularyEntry`, `listStudentVocabularyEntries`, and `deleteStudentVocabularyEntry` from `@junhang/db`. Keep the existing `generateVocabularyCardService`, make its generator injectable for the test, and add an opt-out so wordbook writes do not append an audit record:

```js
const generateCard = options.generateCard || generateVocabularyCard;
const result = await generateCard(config, input);

const vocabularyRecord =
  options.persist === false || options.recordVocabulary === false || !input.studentId
    ? null
    : await recordVocabularyRecord({
        studentId: input.studentId,
        term: result.card?.word || input.word,
        content: {
          card: result.card,
          available: result.available,
          modelRunId: modelRun?.id || null
        }
      }, options);
```

Add the following service shape. It calls `generateVocabularyCardService` so successful wordbook generation keeps the existing model-run persistence, while `recordVocabulary: false` keeps `VocabularyRecord` out of this workflow:

```js
export function normalizeVocabularyWords(values) {
  const seen = new Set();
  const words = [];
  const rejected = [];
  for (const value of Array.isArray(values) ? values : []) {
    const word = String(value || "").trim().toLowerCase();
    if (!/^[a-z]+(?:['-][a-z]+)*$/.test(word)) {
      if (word) rejected.push(word);
      continue;
    }
    if (!seen.has(word) && words.length < 10) {
      seen.add(word);
      words.push(word);
    }
  }
  return { words, rejected };
}

export async function addStudentVocabularyEntriesService(config, input = {}, options = {}) {
  const { words, rejected } = normalizeVocabularyWords(input.words);
  const entries = [];
  const failures = rejected.map((word) => ({ word, message: "请输入英文单词。" }));
  for (const word of words) {
    const generated = await generateVocabularyCardService(config, {
      word,
      studentId: input.studentId,
      grade: input.grade || null,
      studentName: input.studentName || null
    }, { ...options, recordVocabulary: false });
    if (!generated.available || !generated.card) {
      failures.push({ word, message: "词卡暂时无法生成，请稍后重试。" });
      continue;
    }
    entries.push(await upsertVocabularyEntry({ studentId: input.studentId, word, card: generated.card }, options));
  }
  return { entries, failures };
}

export async function listStudentVocabularyEntriesService(input = {}, options = {}) {
  return listStudentVocabularyEntries(input.studentId, options);
}

export async function deleteStudentVocabularyEntryService(input = {}, options = {}) {
  return deleteStudentVocabularyEntry(input.studentId, input.entryId, options);
}
```

Declare the four new functions in `index.d.ts` as `Promise<Record<string, unknown>>` or `Record<string, unknown>` consistently with the existing package declarations.

- [ ] **Step 4: Run the service test and verify it passes**

Run: `node --test packages/services/src/vocabulary-wordbook.test.mjs`

Expected: the service test passes with one upsert and two failures.

- [ ] **Step 5: Commit the service boundary**

```bat
git add -- packages/services/src/index.js packages/services/src/index.d.ts packages/services/src/vocabulary-wordbook.test.mjs
git commit -m "feat: add vocabulary wordbook services"
```

## Task 3: Expose Student-Only Wordbook Routes

**Files:**
- Modify: `apps/api/src/server.js:36-44,3307`
- Create: `apps/api/src/vocabulary-wordbook-routes.test.mjs`

- [ ] **Step 1: Write failing route-contract tests**

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

function routeSource(signature) {
  const start = source.indexOf(signature);
  const end = source.indexOf("\napp.", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("student vocabulary routes use the authenticated student scope and safe DTO", () => {
  for (const signature of [
    'app.post("/api/student/vocabulary"',
    'app.get("/api/student/vocabulary"',
    'app.delete("/api/student/vocabulary/:entryId"'
  ]) {
    assert.notEqual(source.indexOf(signature), -1, `${signature} must exist`);
  }
  const createRoute = routeSource('app.post("/api/student/vocabulary"');
  const deleteRoute = routeSource('app.delete("/api/student/vocabulary/:entryId"');
  assert.match(createRoute, /requireDatabase/);
  assert.match(createRoute, /requireSession\(config, \["student"\]\)/);
  assert.match(createRoute, /studentId:\s*req\.session\.studentId/);
  assert.match(createRoute, /addStudentVocabularyEntriesService/);
  assert.doesNotMatch(createRoute, /body\.studentId/);
  assert.match(deleteRoute, /deleteStudentVocabularyEntryService/);
  assert.match(source, /function cleanVocabularyEntryForStudent/);
});
```

- [ ] **Step 2: Run the route test and verify it fails because the routes do not exist**

Run: `node --test apps/api/src/vocabulary-wordbook-routes.test.mjs`

Expected: failure that `app.post("/api/student/vocabulary"` is missing.

- [ ] **Step 3: Add safe DTO and three routes**

Import the three wordbook services. Add `cleanVocabularyEntryForStudent(entry)` that returns only an opaque entry ID and card learning fields:

```js
function cleanVocabularyEntryForStudent(entry = {}) {
  const card = entry.card && typeof entry.card === "object" ? entry.card : {};
  return {
    id: String(entry.id || ""),
    word: readableText(entry.word || card.word, "word"),
    card: {
      word: readableText(card.word || entry.word, "word"),
      phonetic: readableText(card.phonetic),
      part: readableText(card.part),
      partCn: readableText(card.partCn),
      meaning: readableText(card.meaning),
      related: Array.isArray(card.related) ? card.related.map((item) => ({
        word: readableText(item?.word),
        part: readableText(item?.part),
        partCn: readableText(item?.partCn),
        meaning: readableText(item?.meaning)
      })).filter((item) => item.word) : [],
      examples: Array.isArray(card.examples) ? card.examples : [],
      pitfall: readableText(card.pitfall)
    }
  };
}
```

Register `POST`, `GET`, and `DELETE` routes with `requireDatabase` and `requireSession(config, ["student"])`. Each route obtains the student only from `req.session.studentId`, maps entries through the cleaner, and returns no model/provider/raw/persistence fields. `DELETE` returns `404` when the scoped delete service returns `false`.

Use this route shape after the existing vocabulary route so the route signatures remain easy to locate in source tests:

```js
app.post("/api/student/vocabulary", requireDatabase, requireSession(config, ["student"]), asyncRoute(async (req, res) => {
  const body = getBody(req);
  const { options } = await persistenceOptions({ studentId: req.session.studentId });
  const result = await addStudentVocabularyEntriesService(config, {
    studentId: req.session.studentId,
    words: body.words
  }, options);
  res.json({
    ok: true,
    result: {
      entries: result.entries.map(cleanVocabularyEntryForStudent),
      failures: result.failures
    }
  });
}));

app.get("/api/student/vocabulary", requireDatabase, requireSession(config, ["student"]), asyncRoute(async (req, res) => {
  const entries = await listStudentVocabularyEntriesService({ studentId: req.session.studentId });
  res.json({ ok: true, result: { entries: entries.map(cleanVocabularyEntryForStudent) } });
}));

app.delete("/api/student/vocabulary/:entryId", requireDatabase, requireSession(config, ["student"]), asyncRoute(async (req, res) => {
  const deleted = await deleteStudentVocabularyEntryService({
    studentId: req.session.studentId,
    entryId: req.params.entryId
  });
  if (!deleted) return res.status(404).json({ ok: false, error: "VOCABULARY_ENTRY_NOT_FOUND", message: "词卡不存在或已删除。" });
  res.json({ ok: true, result: { entryId: req.params.entryId } });
}));
```

- [ ] **Step 4: Run route tests and API syntax validation**

Run:

```bat
node --test apps/api/src/vocabulary-wordbook-routes.test.mjs
cmd /c npm.cmd run check:api
```

Expected: both commands pass.

- [ ] **Step 5: Commit the API boundary**

```bat
git add -- apps/api/src/server.js apps/api/src/vocabulary-wordbook-routes.test.mjs
git commit -m "feat: add student vocabulary wordbook api"
```

## Task 4: Replace the Static Mini Program Page

**Files:**
- Modify: `apps/miniprogram/utils/api.js:104`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.js`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.wxml`
- Modify: `apps/miniprogram/pages/student/vocabulary/index.wxss`
- Create: `scripts/student-vocabulary-wordbook-miniprogram.test.mjs`

- [ ] **Step 1: Write failing Mini Program wiring tests**

```js
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
```

- [ ] **Step 2: Run the Mini Program test and verify it fails because static lookup remains**

Run: `node --test scripts/student-vocabulary-wordbook-miniprogram.test.mjs`

Expected: failure matching `dictionary` or a missing API wrapper.

- [ ] **Step 3: Add API wrappers and implement API-backed page state**

Add wrappers:

```js
listStudentVocabulary() {
  return request("/api/student/vocabulary");
},
createStudentVocabulary(input) {
  return request("/api/student/vocabulary", { method: "POST", data: input });
},
deleteStudentVocabulary(entryId) {
  return request(`/api/student/vocabulary/${entryId}`, { method: "DELETE" });
},
```

Replace the page with this API-backed state. It parses only newline and comma-separated terms so a future phrase feature is not blocked by splitting ordinary spaces:

```js
const api = require("../../../utils/api");
const guard = require("../../../utils/guard");

function submittedWords(terms) {
  return String(terms || "").split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

Page({
  data: {
    deletingId: "",
    entries: [],
    failures: [],
    loading: false,
    message: "",
    submitting: false,
    terms: ""
  },
  async onShow() {
    const student = await guard.requireRole("student", this);
    if (student) await this.loadEntries();
  },
  setTerms(event) {
    this.setData({ terms: event.detail.value });
  },
  async loadEntries() {
    this.setData({ loading: true, message: "" });
    try {
      const response = await api.listStudentVocabulary();
      this.setData({ entries: response.result?.entries || [] });
    } catch (error) {
      this.setData({ message: error.message || "词汇本暂时无法加载。" });
  } finally {
      this.setData({ loading: false });
    }
  },
  async addVocabulary() {
    const words = submittedWords(this.data.terms);
    if (!words.length || this.data.submitting) return;
    this.setData({ submitting: true, failures: [], message: "" });
    try {
      const response = await api.createStudentVocabulary({ words });
      this.setData({
        terms: "",
        failures: response.result?.failures || [],
        message: response.result?.failures?.length ? "部分单词没有生成词卡。" : ""
      });
      await this.loadEntries();
    } catch (error) {
      this.setData({ message: error.message || "词卡暂时无法生成。" });
    } finally {
      this.setData({ submitting: false });
    }
  },
  removeVocabulary(event) {
    const entryId = event.currentTarget.dataset.id;
    if (!entryId || this.data.deletingId) return;
    wx.showModal({
      title: "删除词卡",
      content: "删除后将从你的词汇本中移除这张词卡。",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ deletingId: entryId, message: "" });
        try {
          await api.deleteStudentVocabulary(entryId);
          await this.loadEntries();
        } catch (error) {
          this.setData({ message: error.message || "词卡删除失败，请稍后重试。" });
        } finally {
          this.setData({ deletingId: "" });
        }
      }
    });
  }
});
```

Replace the WXML body with this interaction shape, keeping existing shared classes where appropriate:

```xml
<view class="card">
  <text class="section-title">添加词汇</text>
  <textarea class="textarea" placeholder="每行一个单词，或用逗号分隔" value="{{terms}}" bindinput="setTerms" />
  <button class="button warm" loading="{{submitting}}" bindtap="addVocabulary">生成词卡</button>
</view>
<view wx:if="{{message}}" class="card"><text class="muted">{{message}}</text></view>
<view wx:if="{{failures.length}}" class="card"><text wx:for="{{failures}}" wx:key="word" class="muted">{{item.word}}：{{item.message}}</text></view>
<view wx:if="{{loading}}" class="card"><text class="muted">正在加载词汇本...</text></view>
<view wx:elif="{{!entries.length}}" class="card"><text class="muted">还没有词卡，输入单词后开始积累吧。</text></view>
<view wx:for="{{entries}}" wx:key="id" class="card vocab-card">
  <view class="row between"><text class="section-title">{{item.card.word}}</text><button class="text-button" data-id="{{item.id}}" bindtap="removeVocabulary">删除</button></view>
  <text class="pill">{{item.card.part}}（{{item.card.partCn}}）</text>
  <text class="muted">{{item.card.meaning}}</text>
  <view wx:if="{{item.card.related.length}}" class="list"><text wx:for="{{item.card.related}}" wx:key="word" class="muted">相关词：{{item.word}} {{item.meaning}}</text></view>
  <view wx:if="{{item.card.examples.length}}" class="list"><text wx:for="{{item.card.examples}}" wx:key="*this" class="muted">例句：{{item}}</text></view>
  <text wx:if="{{item.card.pitfall}}" class="muted">易错点：{{item.card.pitfall}}</text>
</view>
```

Remove all `dictionary`, fallback, and default-card markup. In WXSS add only the local `.vocab-card` spacing and `.text-button` destructive-action color needed by the markup.

- [ ] **Step 4: Run Mini Program wiring and static checks**

Run:

```bat
node --test scripts/student-vocabulary-wordbook-miniprogram.test.mjs
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
```

Expected: all commands pass.

- [ ] **Step 5: Commit the Mini Program implementation**

```bat
git add -- apps/miniprogram/utils/api.js apps/miniprogram/pages/student/vocabulary/index.js apps/miniprogram/pages/student/vocabulary/index.wxml apps/miniprogram/pages/student/vocabulary/index.wxss scripts/student-vocabulary-wordbook-miniprogram.test.mjs
git commit -m "feat: add student vocabulary wordbook"
```

## Task 5: Run the Cross-Layer Verification and Protect the Runtime Project

**Files:**
- Verify only: all files above
- Inspect only: `C:\Users\86188\WeChatProjects\miniapp-1\pages\teacher\students\index.wxml`

- [ ] **Step 1: Run all direct regression checks**

```bat
node --test packages/db/src/vocabulary-entry.test.mjs packages/services/src/vocabulary-wordbook.test.mjs apps/api/src/vocabulary-wordbook-routes.test.mjs scripts/student-vocabulary-wordbook-miniprogram.test.mjs
cmd /c npm.cmd run db:validate
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
```

Expected: every command exits with code `0`.

- [ ] **Step 2: Inspect Mini Program runtime sync without writing files**

Run: `cmd /c npm.cmd run check:miniprogram-sync`

Expected: it still reports the pre-existing `pages/teacher/students/index.wxml` runtime difference and the new vocabulary-page source/runtime differences.

- [ ] **Step 3: Do not overwrite the unrelated runtime teacher-page difference**

Do not run `sync:miniapp1` while the unrelated teacher-page difference is unresolved. Report the exact sync state to the user and request direction before reconciling or copying that file. This preserves the existing runtime work while keeping the wordbook code complete and verified in the repository.

- [ ] **Step 4: Run the final workspace check**

Run: `cmd /c npm.cmd run workspace:guard`

Expected: report only the committed implementation and no unexpected generated residue.
