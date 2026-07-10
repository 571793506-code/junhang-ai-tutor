# GPT-5.6 Generation And Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make third-party `gpt-5.6` the default text generation, assessment, reference-answer, grading, and risk-review model while preserving Junhang AI Tutor's service-layer validation, teacher review, visibility, and archive gates.

**Architecture:** Add a GPT-5.6-compatible provider and capability probe, retain legacy `GPT55_*` reads only as migration aliases, and route all text work through GPT-5.6. Assessments use deterministic project blueprints and limited-concurrency section generation; grading uses known answer keys, deterministic objective comparison, GPT-5.6 subjective grading, and risk-triggered review. MiniMax remains responsible for vision OCR and speech; DeepSeek is an opt-in emergency fallback only.

**Tech Stack:** Node.js ESM, native `fetch`, `node:test`, Prisma/Postgres, existing `@junhang/ai` and `@junhang/services` workspaces, PowerShell/`npm.cmd`.

---

## File Structure

- Create `packages/ai/src/assessment-partitions.js`: project-aware section plans and limited-concurrency execution helper.
- Create `packages/ai/src/gpt56-runtime.test.mjs`: GPT-5.6 config, routing, request, and legacy-alias tests.
- Create `packages/ai/src/assessment-partitions.test.mjs`: section-plan and concurrency tests.
- Create `scripts/gpt56-capability-check.mjs`: no-student-data intermediary capability probe.
- Create `scripts/gpt56-capability-check.test.mjs`: probe request and result classification tests.
- Create `scripts/grading-quality-check.mjs`: machine-readable gold-case grading evaluator that does not require live provider calls.
- Create `scripts/grading-quality-check.test.mjs`: objective/status/score/low-confidence metric tests.
- Modify `packages/ai/src/runtime.js`: GPT-5.6 provider/config/client, text routes, partitioned assessment generation, review alias compatibility.
- Modify `packages/ai/src/assessment-runtime.test.mjs`: GPT-5.6 primary and budget/fallback assertions.
- Modify `packages/ai/src/ocr-node.js`: two-way limited-concurrency page OCR.
- Modify `packages/ai/src/index.d.ts`: `gpt56` provider and public runtime declarations.
- Modify `packages/services/src/index.js`: new generation budgets, partial-fallback marking, deterministic objective grading, risk-triggered GPT-5.6 audit.
- Modify service tests: cover GPT-5.6 metadata, deterministic grading, mixed grading, and risk review.
- Modify `.env`, `.env.example`, `apps/api/src/env.js`, `package.json`, and quality scripts: config migration, checks, and realistic budgets.
- Modify generation/grading Skills and directly affected docs: current routing and verification commands.

### Task 1: GPT-5.6 Provider And Capability Probe

- [x] Write failing tests asserting `GPT56_*` takes precedence, `GPT55_*` remains a compatibility alias, provider snapshots route text capabilities to `gpt56`, and `reasoning_effort` is only sent when enabled.
- [x] Run `node --test packages\ai\src\gpt56-runtime.test.mjs` and confirm failures identify missing GPT-5.6 behavior.
- [x] Implement `gpt56` provider/config/client in `packages/ai/src/runtime.js`, keep `callGpt55Chat` and `reviewWithGpt55` as deprecated aliases, and update declarations.
- [x] Write failing probe tests for text, JSON mode, reasoning-effort, JSON Schema, and image capability result classification.
- [x] Run `node --test scripts\gpt56-capability-check.test.mjs` and confirm the probe API is absent.
- [x] Implement `scripts/gpt56-capability-check.mjs` with synthetic prompts only and add `check:gpt56` to `package.json`.
- [x] Run both test files and confirm they pass.

### Task 2: Default Text Routes And Configuration Migration

- [x] Extend failing runtime tests so QA, vocabulary, teacher task, student profile, reference answer, grading, and premium review all report provider `gpt56` and model `gpt-5.6`.
- [x] Run the focused runtime tests and confirm the existing DeepSeek routes fail the new assertions.
- [x] Route those functions through `callGpt56Chat`, using `none/low` for short text, `medium` for reference/grading, and `high` for explicit risk review only when the intermediary capability flag is enabled.
- [x] Update `.env.example` with `GPT56_*`; update local `.env` to `GPT56_MODEL=gpt-5.6-terra` and retain its existing legacy key/base URL as aliases without exposing secrets.
- [x] Update API startup status, TypeScript declarations, demos, and compatibility checks from `gpt55` to `gpt56`.
- [x] Run `node --test packages\ai\src\gpt56-runtime.test.mjs packages\ai\src\assessment-runtime.test.mjs`.

### Task 3: Project Blueprint And Partitioned Assessment Generation

- [x] Write failing tests for two-part quiz/practice plans, four-part exam plans, subject-specific allowed item types, stable output ordering, and maximum concurrency two.
- [x] Run `node --test packages\ai\src\assessment-partitions.test.mjs` and confirm missing module/behavior failures.
- [x] Implement `buildAssessmentPartitions()` and `mapWithConcurrency()` in the new focused module.
- [x] Add failing assessment runtime tests asserting default GPT-5.6 partition requests, per-part token budgets, one retry for failed partitions, partial-generation metadata, and no automatic DeepSeek fallback unless explicitly enabled.
- [x] Run the assessment runtime tests and confirm the existing single-request/DeepSeek behavior fails.
- [x] Integrate section generation in `draftAssessment`; merge ordered sections, reserve total budget for local retry/emergency fallback, and record attempt metadata per partition.
- [x] Update service defaults to `120000ms / 16000 tokens` for quizzes, `150000ms / 16000 tokens` for ordinary practice, and `240000ms / 24000 tokens` for exams and personalized practice while keeping explicit request overrides intact.
- [x] Mark partial or repaired model output as `usedDynamicFallback=true`; keep local dynamic fallback teacher-only.
- [x] Update generation quality sample budgets and tests.
- [x] Run AI, service assessment, blueprint, and generation-quality unit tests.

### Task 4: Deterministic Objective Grading And GPT-5.6 Subjective Grading

- [x] Add failing service tests showing known answer keys skip reference generation, fully objective work can skip remote grading, numeric/case/punctuation normalization is conservative, and mixed work sends only unresolved subjective questions to GPT-5.6.
- [x] Run the focused service tests and confirm the deterministic path is absent.
- [x] Implement answer normalization, objective eligibility, deterministic question results, unresolved-question extraction, and result merge in `packages/services/src/index.js`.
- [x] Keep the existing `prepareSubmissionReferenceAnswers` answer-key-first path unchanged; use GPT-5.6 only for missing external references.
- [x] Ensure total score is derived from question results and remote top-level score cannot override it.
- [x] Add risk-triggered review tests: uncertain/low-confidence/mismatch invokes one GPT-5.6 review; clean work and default drafts do not invoke synchronous multi-model review.
- [x] Replace default MiniMax-plus-GPT serial grading audit with a single GPT-5.6 risk review while retaining explicit legacy reviewer injection for tests/compatibility.
- [x] Run grading service and API archive-gate tests.

### Task 5: Vision OCR Concurrency And Grading Evaluation

- [x] Write a failing OCR test with a local fake VLM server proving page requests never exceed concurrency two and output page order remains stable.
- [x] Run the OCR test and confirm current serial processing fails the concurrency assertion.
- [x] Reuse `mapWithConcurrency()` in `packages/ai/src/ocr-node.js` for MiniMax page OCR with maximum concurrency two.
- [x] Write failing grading evaluator tests for per-question accuracy, status agreement, score absolute error, low-confidence recall, unsafe-high-confidence error rate, and teacher modification rate.
- [x] Implement `scripts/grading-quality-check.mjs` and add `check:grading:quality`.
- [x] Run OCR and grading evaluator tests.

### Task 6: Documentation, Live Probe, And Layered Verification

- [x] Update `skills/generation/SKILLS.md`, `skills/grading/SKILLS.md`, `docs/14-api-contract.md`, `docs/35-generation-model-collaboration-template.md`, `docs/41-prompt-context-engineering-playbook.md`, and `docs/48-grading-workbench-redesign.md` to match actual routing.
- [x] Run `cmd /c npm.cmd run check:gpt56`; record supported intermediary capabilities without printing secrets or student data.
- [x] Run focused Node tests for all changed AI/service/scripts.
- [x] Run `cmd /c npm.cmd run check:generation:blueprint`.
- [x] Run `cmd /c npm.cmd run check --workspace apps/api`.
- [x] Run `cmd /c npm.cmd run check:content-context` if service/API integration changed its generation/review contract.
- [x] Run `cmd /c npm.cmd run check:encoding`.
- [x] Run `cmd /c npm.cmd run workspace:guard`, review the final diff by file group, and commit implementation without generated outputs or local secrets.

## Completion Record

- Implementation commit: `8a9487a feat: route generation and grading through GPT-5.6`.
- Selected intermediary model: `gpt-5.6-terra`; text, JSON mode, reasoning effort, JSON Schema, and synthetic project grading JSON passed live capability checks. Image input remains unsupported, so MiniMax keeps visual OCR ownership.
- Live generation quality: three subject quizzes, one formal mathematics exam, and two personalized practices passed without dynamic fallback.
- Layered verification: AI, service/grading, script and API env tests; generation blueprint; API check; Web typecheck; miniprogram JavaScript check; service smoke; content-context link guard; and encoding guard passed before the implementation commit.
- External acceptance gate: the evaluator is implemented, but production grading accuracy still requires a teacher-confirmed real gold dataset. Synthetic cases must not be reported as production accuracy evidence.
