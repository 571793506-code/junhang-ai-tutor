# GPT-5.6 Reasoning Tier Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `gpt-5.6-terra` as the single text model while raising quiz/practice requests to `medium` and formal-exam plus grading requests to `high`.

**Architecture:** Preserve the existing provider routing, partitioning, budgets, fallbacks, OCR ownership, and teacher-review gates. Change only the per-call `reasoningEffort` values in `packages/ai/src/runtime.js`, with request-payload tests proving the intermediary receives the intended tier when `GPT56_REASONING_EFFORT_ENABLED=true`.

**Tech Stack:** Node.js ESM, native `fetch`, `node:test`, existing `@junhang/ai` runtime, PowerShell/`npm.cmd`.

---

### Task 1: Assessment Reasoning Tiers

**Files:**
- Modify: `packages/ai/src/assessment-runtime.test.mjs`
- Modify: `packages/ai/src/runtime.js`

- [x] Add a local fake-server test that calls `draftAssessment` for `小测`, `练习`, and `试卷` with `GPT56_REASONING_EFFORT_ENABLED=true` and asserts the request payloads use `medium`, `medium`, and `high` respectively.
- [x] Run `node --test packages\ai\src\assessment-runtime.test.mjs` and confirm the existing `low`, `low`, and `medium` values fail the new assertions.
- [x] Change the assessment partition call to use `high` for `kind === "试卷"` and `medium` for every other assessment kind.
- [x] Re-run `node --test packages\ai\src\assessment-runtime.test.mjs` and confirm all tests pass.

### Task 2: Grading Reasoning Tiers

**Files:**
- Modify: `packages/ai/src/gpt56-runtime.test.mjs`
- Modify: `packages/ai/src/runtime.js`

- [x] Extend the GPT-5.6 workflow request test to identify reference-answer, grading, and premium-review prompts and assert all three send `reasoning_effort=high`.
- [x] Run `node --test packages\ai\src\gpt56-runtime.test.mjs` and confirm reference-answer and grading requests still fail with `medium`.
- [x] Change `generateSubmissionReferenceAnswers` and `gradeSubmissionText` to use `high`; keep `reviewWithGpt56` at its existing `high` tier.
- [x] Re-run `node --test packages\ai\src\gpt56-runtime.test.mjs` and confirm all tests pass.

### Task 3: Project Rules And Verification

**Files:**
- Modify: `skills/generation/SKILLS.md`
- Modify: `skills/grading/SKILLS.md`
- Modify: `docs/superpowers/specs/2026-07-10-gpt56-generation-grading-pipeline-design.md`

- [x] Record that quiz/practice uses `medium`, formal exams use `high`, and the grading chain uses `high` while short text stays `none/low`.
- [x] Run the focused AI tests plus generation blueprint, API check, service smoke, and GPT-5.6 capability probe.
- [x] Run `.\jh.cmd check:encoding`, `git diff --check`, and `cmd /c npm.cmd run workspace:guard` before explicit staging and commit.
