# Workspace Guardian Policy Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Upgrade the workspace guardian into a policy-driven classifier that preserves generated/local assets, reports ignored files by purpose, and archives runtime residue only through an explicit safe command.

**Architecture:** Keep `scripts/workspace-guardian-lib.mjs` as the single classification/reporting and archive safety boundary. The read-only guardian will scan the newly ignored local paths, separate local, preserved, and runtime ignored files, and expose stable JSON fields. The archive CLI will add dry-run, hash manifest, and destination-conflict protection without staging, deleting, restoring, or overwriting anything.

**Tech Stack:** Node.js ESM, `node:test`, `node:fs/promises`, Git status porcelain output, SHA-256 via `node:crypto`, Markdown documentation, `.gitignore`.

---

### Task 1: Add regression tests for policy classification and ignored reporting

**Files:**
- Modify: `scripts/workspace-guardian.test.mjs`
- Test target: `scripts/workspace-guardian-lib.mjs`

- [x] **Step 1: Add failing classification tests**

Add tests asserting:

```js
assert.deepEqual(classifyWorkspaceFile("output/pdf/sample.pdf"), {
  bucket: "local",
  label: "本地保存",
  reason: "generated-output"
});
assert.deepEqual(classifyWorkspaceFile(".superpowers/brainstorm/demo/content.html"), {
  bucket: "local",
  label: "本地保存",
  reason: "session-artifact"
});
assert.deepEqual(classifyWorkspaceFile(".superpowers/brainstorm/demo/state/server.pid"), {
  bucket: "runtime",
  label: "运行残留",
  reason: "runtime-state"
});
```

Also update existing `classifyWorkspaceFile()` expectations to include the new `reason` field.

- [x] **Step 2: Run the focused suite and verify the new assertions fail for the missing policy behavior**

Run: `cmd /c npm.cmd run check:workspace-guardian`

Expected: the new classification assertions fail because the current classifier has no reasons and does not recognize the new paths.

- [x] **Step 3: Add failing report tests**

Add a report fixture where `git status --ignored` returns:

```text
!! output/pdf/sample.pdf
!! .superpowers/brainstorm/demo/content.html
!! .superpowers/brainstorm/demo/state/server.pid
!! exports/api-start.log
```

Assert `ignoredLocalFiles` contains the PDF and session HTML, `ignoredRuntimeFiles` contains the PID and log, and `clean` is false only because runtime residue exists. Add a local-only fixture asserting `clean === true`.

### Task 2: Implement policy-driven classification and guardian report fields

**Files:**
- Modify: `scripts/workspace-guardian-lib.mjs`
- Modify: `scripts/workspace-guardian.mjs` only if JSON handling needs an explicit stable serializer

- [x] **Step 1: Add narrow path policy constants and reasoned classifications**

Add scan paths for `output/pdf` and `.superpowers`. Add specific ignored-local matching for `output/pdf/**` and `.superpowers/brainstorm/**` except `state/server.pid`, `state/server-stopped`, and `state/server.log`. Add runtime-state matching for those three state files. Make `classifyWorkspaceFile()` return `{ bucket, label, reason }`, using a `runtime` bucket for explicit runtime-state paths and preserving the existing four-bucket priority for normal visible task review paths.

- [x] **Step 2: Make ignored files three-way classified**

Keep approved profile assets in `ignoredPreservedLocalFiles`; add `ignoredLocalFiles` for generated output and session artifacts; put only remaining ignored scan results in `ignoredRuntimeFiles`. Ensure `clean` and risk calculations consider runtime residue but do not fail for ignored local or preserved files.

- [x] **Step 3: Expose stable JSON and readable output**

Include `ignored.local`, `ignored.runtime`, and `ignored.preserved` in the report in addition to the existing top-level arrays for compatibility. Print the local ignored count separately and recommend no action for local/preserved files. Keep stage suggestions empty for local files.

- [x] **Step 4: Run the focused suite and verify all guardian tests pass**

Run: `cmd /c npm.cmd run check:workspace-guardian`

Expected: PASS, including the new path and ignored-report tests.

### Task 3: Make local generated paths ignored without hiding project source

**Files:**
- Modify: `.gitignore`

- [x] **Step 1: Add only root-scoped local rules**

Append exactly:

```gitignore
/output/pdf/
/.superpowers/
```

Do not add broad `output/`, `*.json`, or global session patterns.

- [x] **Step 2: Verify the real workspace classification is visible and non-destructive**

Run: `cmd /c npm.cmd run workspace:guard -- --json`

Expected: `output/pdf` and `.superpowers` appear under ignored local, approved assets remain under ignored preserved, runtime residue remains separately classified, and none of the nine tracked modifications is changed.

### Task 4: Add safe dry-run and hash-manifest archive behavior

**Files:**
- Modify: `scripts/workspace-guardian-lib.mjs`
- Modify: `scripts/workspace-archive-residue.mjs`
- Modify: `scripts/workspace-guardian.test.mjs`

- [x] **Step 1: Add failing archive tests**

Cover these behaviors:

```js
const dryRun = await archiveRuntimeResidue({
  cwd: workspaceRoot,
  archiveRoot,
  ignoredRuntimeFiles: ["tmp/demo.log"],
  timestamp: "2026-08-19T10-00-00",
  dryRun: true
});
assert.equal(dryRun.ok, true);
assert.equal(dryRun.movedFiles.length, 0);
assert.equal(dryRun.plannedFiles[0].sha256.length, 64);
assert.equal(fs.existsSync(sourcePath), true);
```

Add a conflict fixture with an existing target and assert it is reported as `DESTINATION_CONFLICT` without overwriting either file. Add a test that passing `output/pdf/sample.pdf` or a session artifact is skipped as `LOCAL_FILE`, while approved profile assets remain skipped as `PRESERVED_LOCAL_FILE`.

- [x] **Step 2: Run the focused suite and verify the archive tests fail**

Run: `cmd /c npm.cmd run check:workspace-guardian`

Expected: failure because dry-run, hashes, conflict protection, and ignored-local protection are not implemented yet.

- [x] **Step 3: Implement a two-phase archive operation**

For each safe runtime path, validate it stays inside the workspace, reject preserved/local paths, stat and hash the source, calculate the target, and detect an existing target before any move. In dry-run mode return the planned entries without creating directories or moving files. In normal mode create the archive directory, write `manifest.json` containing relative source, target, size, mtime, SHA-256, and reason, then rename only planned files. Never overwrite a destination.

- [x] **Step 4: Update the archive CLI output and flags**

Parse `--dry-run` and `--json`. Dry-run must state that no files were moved and list planned files; normal output must report moved, planned, skipped, and conflicts. Preserve the existing no-residue zero-exit behavior.

- [x] **Step 5: Run the focused suite and verify all archive tests pass**

Run: `cmd /c npm.cmd run check:workspace-guardian`

Expected: PASS with the existing move/preserve tests and the new dry-run/hash/conflict tests.

### Task 5: Document the upgraded guardian contract

**Files:**
- Modify: `docs/52-workspace-guardian.md`
- Modify: `docs/superpowers/specs/2026-08-19-workspace-guardian-policy-upgrade-design.md` only if implementation details require a clarified contract

- [x] **Step 1: Document the three ignored categories**

Explain that `output/pdf/**` and non-state `.superpowers/brainstorm/**` are local preservation, approved student-profile assets are preserved local assets, and `.superpowers/brainstorm/**/state/server.pid`, `server-stopped`, and `server.log` plus upload/temp/log paths are runtime residue. State that ignored local and preserved assets do not make the guardian fail.

- [x] **Step 2: Document explicit archive safety controls**

Document `workspace:archive-residue --dry-run`, the SHA-256 manifest, destination conflict skip, and the fact that the guardian never stages, commits, pushes, deletes, restores, or overwrites.

- [x] **Step 3: Run documentation and diff checks**

Run: `cmd /c npm.cmd run check:encoding`

Run: `git diff --check`

Expected: both commands exit 0.

### Task 6: Run end-to-end guardian verification and inspect scope

**Files:**
- Verify only; no additional business files may be modified.

- [x] **Step 1: Run the complete guardian test and report checks**

Run:

```text
cmd /c npm.cmd run check:workspace-guardian
cmd /c npm.cmd run check:encoding
git diff --check
cmd /c npm.cmd run workspace:guard
```

Expected: focused tests and encoding/diff checks pass; the final guard reports the known nine tracked modifications and local generated/session content without suggesting those local files be staged or deleted.

- [x] **Step 2: Inspect the final file scope**

Run: `git status --short --untracked-files=all` and `git diff --name-status`.

Confirm only guardian implementation, tests, `.gitignore`, plan, and guardian documentation changed; do not stage or commit the pre-existing nine tracked files, generated PDFs, session artifacts, or approved local assets.
