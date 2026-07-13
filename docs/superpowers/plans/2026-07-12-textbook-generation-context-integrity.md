# 教材生成上下文完整性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让教材/资料上下文在生成前可追踪、可复核、可阻断，避免无教材正文或未复核资料静默进入生成。

**Architecture:** `KnowledgeSource` 中 `APPROVED + allowedForGeneration=true` 的来源作为服务端生成检索边界；`TextbookAsset` 继续只保存受保护教材的元数据和教师章节索引，不转换 `.edupdf`。API 在生成前解析已批准来源，服务层保留纯函数匹配与门禁，缺少必需证据时返回结构化 evidence failure，不调用模型、不创建草稿。

**Tech Stack:** Node.js ESM、Express、Prisma/PostgreSQL、Node test runner、现有 Markdown/index 脚本。

---

### Task 1: Approved content matching and generation gate

**Files:**
- Create: `packages/services/src/content-context.test.mjs`
- Modify: `packages/services/src/index.js`
- Create: `apps/api/src/approved-content-context.js`
- Create: `apps/api/src/approved-content-context.test.mjs`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Write failing pure-function tests** for subject/grade hard filtering, relevant chunk selection, approved-only context, and textbook requests with no match.
- [ ] **Step 2: Run the focused tests and confirm they fail for the missing API/functions or unsafe matching behavior.**
- [ ] **Step 3: Implement the pure matcher and context validation.** The matcher must return only approved sources, preserve source/chunk provenance, and select the chunks that contributed to the score.
- [ ] **Step 4: Add the API resolver.** Query only approved, generation-allowed, non-blocked sources with ordered chunks; never trust client-supplied `contentContext`.
- [ ] **Step 5: Add the generation preflight.** Textbook-grounded requests with no approved match return `422 ASSESSMENT_CONTENT_CONTEXT_REQUIRED`; other requests receive an empty, explicitly unavailable context instead of raw unreviewed index data.
- [ ] **Step 6: Run the focused tests and the service/API checks.**

### Task 2: Empty index and stale input guards

**Files:**
- Create: `scripts/build-content-index.test.mjs`
- Modify: `scripts/build-content-index.mjs`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Write failing tests** for missing/empty input and an index summary with zero documents.
- [ ] **Step 2: Run the tests and confirm empty input currently succeeds incorrectly.**
- [ ] **Step 3: Make the builder fail with a nonzero exit and a stable error code when no Markdown document is found.**
- [ ] **Step 4: Make API summaries report `available=false` for empty indexes and preserve a teacher-safe reason.**
- [ ] **Step 5: Run the focused tests.**

### Task 3: Preserve teacher chapters during textbook rescan

**Files:**
- Create: `scripts/textbook-asset-metadata.mjs`
- Create: `scripts/textbook-asset-metadata.test.mjs`
- Modify: `scripts/import-textbook-assets.mjs`
- Modify: `scripts/scan-textbook-assets.mjs`

- [ ] **Step 1: Write failing tests** showing `metadata.chapters` survives an import update and non-textbook instruction files are excluded.
- [ ] **Step 2: Run the tests and confirm the current metadata replacement loses chapters.**
- [ ] **Step 3: Implement metadata merge and a narrow textbook extension filter without touching `.edupdf` contents.**
- [ ] **Step 4: Run the focused tests and a read-only scanner check.**

### Task 4: Contract and regression verification

**Files:**
- Modify: `scripts/content-context-e2e.mjs`
- Modify: `docs/43-content-index-ui-runbook.md`
- Add or update only tests directly covering the new gate; preserve unrelated concurrent test changes.

- [ ] **Step 1: Update the E2E contract to exercise approved-source sync/review before generation and assert the matched source/chunk.**
- [ ] **Step 2: Run focused unit tests, `check:generation:blueprint`, `check:content-context`, `check:api`, and encoding checks as applicable.**
- [ ] **Step 3: Inspect `git diff --name-status`, classify remaining dirty files, and report unhandled concurrent changes without reverting them.**

