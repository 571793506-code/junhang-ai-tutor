# Generation Check Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generation verification observable and bounded by splitting checks, adding step progress, and enforcing timeouts.

**Architecture:** Keep generation business logic in services. Add a reusable script-level step runner for local checks, then wire it into the existing teaching-content check and content-context E2E without touching unrelated Web changes. Add lightweight generation verification commands so full E2E is a final gate, not the default loop.

**Tech Stack:** Node.js ESM scripts, `node:test`, project npm scripts, existing API/services contracts.

---

### Task 1: Script Step Runner

**Files:**
- Create: `scripts/check-step-runner.mjs`
- Create: `scripts/check-step-runner.test.mjs`

- [x] Write failing tests for streaming start/done/fail progress, timeout handling, JSON stdout parsing, and stop-on-first-failure behavior.
- [x] Implement `runStep`, `runSteps`, `parseJsonOrText`, and `timeoutMsFromEnv`.
- [x] Run `cmd /c node --test scripts\check-step-runner.test.mjs` and verify it passes.

### Task 2: Teaching Content Check Progress

**Files:**
- Modify: `scripts/teaching-content-check.mjs`

- [x] Replace `execFileAsync` orchestration with `runSteps`.
- [x] Add per-step timeouts for API start, upload UI contract, and full content-context E2E.
- [x] Stream progress to stderr while keeping final stdout as JSON.
- [x] Run `cmd /c node --check scripts\teaching-content-check.mjs`.

### Task 3: Content Context E2E Timeouts

**Files:**
- Modify: `scripts/content-context-e2e.mjs`

- [x] Add `fetchWithTimeout` using `AbortController`.
- [x] Route JSON requests, asset fetches, and multipart upload fetches through the timeout wrapper.
- [x] Emit major stage progress to stderr before slow API calls and export operations.
- [x] Run `cmd /c node --check scripts\content-context-e2e.mjs`.

### Task 4: Layered Generation Entry

**Files:**
- Create: `scripts/generation-blueprint-check.mjs`
- Modify: `package.json`

- [x] Add a lightweight generation check that validates service-layer generated assessment blueprints without API startup or PDF export.
- [x] Add `check:generation:blueprint` npm script.
- [x] Add `check:teaching-content:full` alias for the full E2E bundle.
- [x] Run `cmd /c node --check scripts\generation-blueprint-check.mjs`.

### Task 5: Rules And Runbooks

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/43-content-index-ui-runbook.md`
- Modify: `docs/51-project-pitfall-review.md`
- Modify: `docs/52-workspace-guardian.md`
- Modify: `skills/generation/SKILLS.md`

- [x] Document that full E2E is a final gate, not the default validation path.
- [x] Document the layered verification commands and when to use each one.
- [x] Add the known failure mode: no progress output plus missing timeout makes generation appear stuck.
- [x] Run `cmd /c npm.cmd run check:encoding`.

### Task 6: Final Verification

**Files:**
- No new files.

- [x] Run `cmd /c node --test scripts\check-step-runner.test.mjs`.
- [x] Run `cmd /c node --check scripts\teaching-content-check.mjs`.
- [x] Run `cmd /c node --check scripts\content-context-e2e.mjs`.
- [x] Run `cmd /c node --check scripts\generation-blueprint-check.mjs`.
- [x] Run `cmd /c npm.cmd run check:generation:blueprint`.
- [x] Run `cmd /c npm.cmd run check:encoding`.
- [x] Run `cmd /c npm.cmd run workspace:guard` and report remaining dirty files separately from pre-existing Web changes.
