# Student Growth Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement weekly and monthly student growth archive generation with evidence packs, role-safe published views, teacher review data, and Web/API documentation updates.

**Architecture:** Add a focused API-side profile module that builds `profileEvidencePack`, `publishedView`, `teacherReview`, and compatibility fields from already-loaded student sources. Keep `server.js` as the route owner, but move content generation and visibility filtering into a testable helper. Update the AI runtime prompt to request the new strict JSON shape, then update Web to display the new snapshot while preserving existing plain-text fallback.

**Tech Stack:** Node.js ES modules, Express API, Prisma JSON snapshots, React/TypeScript Web, Node built-in test runner, existing `jh.cmd` verification commands.

---

## File Structure

- Create `apps/api/src/student-growth-profile.js`
  - Owns period calculation, evidence pack creation, published view fallback, teacher review fallback, AI JSON normalization, and student/teacher visibility helpers.
- Create `apps/api/src/student-growth-profile.test.mjs`
  - Node tests for evidence filtering, weekly/monthly period behavior, blocked source exclusion, and role-safe output.
- Modify `apps/api/src/server.js`
  - Use the new helper in `/api/students/:studentId/profile/draft`, `/publish`, `/aggregate`, and `/profile`.
- Modify `packages/ai/src/runtime.js`
  - Update `draftStudentProfileNarrative` system prompt to require strict `profileType/period/publishedView/teacherReview` JSON.
- Modify `apps/web/src/api.ts`
  - Allow `draftStudentProfile(studentId, periodType)` and keep publish shape unchanged.
- Modify `apps/web/src/main.tsx`
  - Add weekly/monthly draft selection, render structured draft review and structured student archive sections with legacy fallback.
- Modify `docs/14-api-contract.md`
  - Document new snapshot shape and visibility boundary.
- Modify `skills/student-profile/SKILLS.md`
  - Update local student-profile rules with weekly/monthly evidence-driven contract.

## Task 1: API Profile Helper With Tests

**Files:**
- Create: `apps/api/src/student-growth-profile.js`
- Create: `apps/api/src/student-growth-profile.test.mjs`

- [ ] **Step 1: Write failing test for evidence pack filtering**

Create `apps/api/src/student-growth-profile.test.mjs` with:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfileEvidencePack,
  buildStudentGrowthSnapshot,
  filterStudentProfileSnapshot
} from "./student-growth-profile.js";

const now = new Date("2026-07-05T12:00:00.000Z");

function studentFixture() {
  return {
    id: "stu_1",
    displayName: "张思源",
    grade: "五年级",
    className: "周六上午班",
    textbookVersion: "人教版",
    tasks: [
      {
        id: "task_1",
        title: "数学两步应用题",
        status: "COMPLETED",
        createdAt: new Date("2026-07-03T09:00:00.000Z"),
        subject: { name: "数学" },
        description: "圈条件再列式"
      }
    ],
    submissions: [
      {
        id: "sub_ok",
        status: "REVIEWED",
        submittedAt: new Date("2026-07-04T09:00:00.000Z"),
        assignment: { title: "应用题练习", subject: { name: "数学" }, metadata: {} },
        grading: {
          score: 82,
          result: {
            summary: "应用题审题仍需关注。",
            archiveEligible: true,
            needsTeacherReview: false,
            confidence: "high",
            questionResults: [
              {
                knowledgePoint: "两步应用题",
                errorStep: "漏看条件",
                suggestedPractice: "先圈条件，再列式。"
              }
            ]
          }
        }
      },
      {
        id: "sub_blocked",
        status: "SUBMITTED",
        submittedAt: new Date("2026-07-04T10:00:00.000Z"),
        assignment: { title: "低置信识别", subject: { name: "语文" }, metadata: {} },
        grading: {
          score: null,
          result: {
            summary: "低置信 OCR。",
            archiveEligible: false,
            needsTeacherReview: true,
            provisionalScore: 70,
            confidence: "low"
          }
        }
      }
    ],
    mistakes: [
      {
        id: "mistake_1",
        subject: "数学",
        prompt: "应用题条件遗漏",
        cause: "审题时漏掉单位",
        masteryResolved: false,
        createdAt: new Date("2026-07-04T11:00:00.000Z"),
        knowledgePoint: { name: "两步应用题" },
        metadata: { nextPractice: "复述题意后再计算。" }
      }
    ],
    reports: [],
    behaviorEvents: [],
    qaSessions: [
      {
        id: "qa_1",
        createdAt: new Date("2026-07-05T08:00:00.000Z"),
        subject: "数学",
        question: "为什么要先圈条件？",
        answer: "可以避免漏掉已知信息。",
        metadata: { confirmed: true }
      }
    ],
    voiceInteractions: []
  };
}

test("buildProfileEvidencePack includes reviewed evidence and blocks provisional grading", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.period.type, "weekly");
  assert.equal(pack.gradingEvidence.length, 1);
  assert.equal(pack.gradingEvidence[0].id, "sub_ok");
  assert.equal(pack.blockedEvidence.length, 1);
  assert.equal(pack.blockedEvidence[0].id, "sub_blocked");
  assert.equal(pack.sourceQuality.hasBlockedEvidence, true);
});

test("buildStudentGrowthSnapshot creates structured weekly published view with confidence", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });

  assert.equal(snapshot.profileType, "weekly_growth");
  assert.equal(snapshot.publishedView.periodType, "weekly");
  assert.ok(snapshot.publishedView.overview.text.includes("本周"));
  assert.ok(snapshot.publishedView.focusSubjects.length <= 1);
  assert.ok(snapshot.publishedView.focusSubjects[0].evidenceRefs.length > 0);
  assert.equal(snapshot.teacherReview.pendingConfirmations.length, 1);
});

test("filterStudentProfileSnapshot hides teacher review from student role", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "monthly", now });
  const filtered = filterStudentProfileSnapshot(snapshot, "student");

  assert.equal(filtered.profileType, "monthly_comprehensive_growth");
  assert.equal(filtered.teacherReview, undefined);
  assert.equal(filtered.profileEvidencePack, undefined);
  assert.ok(filtered.publishedView);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/student-growth-profile.test.mjs`

Expected: FAIL with module/function not found.

- [ ] **Step 3: Implement minimal helper**

Create `apps/api/src/student-growth-profile.js` exporting `buildProfileEvidencePack`, `buildStudentGrowthSnapshot`, and `filterStudentProfileSnapshot`. Implement only the behavior asserted above, plus compatible fields `weeklyScore`, `mastery`, `strengths`, `risks`, `tone`, `timeline`, and `narrative`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/student-growth-profile.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- apps/api/src/student-growth-profile.js apps/api/src/student-growth-profile.test.mjs
git commit -m "feat: add student growth profile evidence builder"
```

## Task 2: Wire API Routes To Structured Snapshots

**Files:**
- Modify: `apps/api/src/server.js`
- Test: `apps/api/src/student-growth-profile.test.mjs`

- [ ] **Step 1: Add failing route-shape test through helper**

Extend the helper test to assert `filterStudentProfileSnapshot(snapshot, "teacher")` includes `teacherReview` and `profileEvidencePack`, while `student` does not.

- [ ] **Step 2: Run focused test and verify failure if helper missing teacher branch**

Run: `node --test apps/api/src/student-growth-profile.test.mjs`

Expected: FAIL until helper supports teacher visibility.

- [ ] **Step 3: Update `server.js`**

Import helper functions and update:

- `/profile/draft`: read `periodType` from request body, build base structured snapshot, pass it to AI narrative generation as context, merge AI JSON only when valid.
- `/profile/publish`: persist incoming structured snapshot, preserving `publishedText` when teacher edits text.
- `/profile/aggregate`: build monthly snapshot by default for compatibility.
- `/profile`: return teacher-filtered snapshot for teacher sessions and student-filtered snapshot for student sessions.

- [ ] **Step 4: Run API check**

Run: `.\jh.cmd check:api`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- apps/api/src/server.js apps/api/src/student-growth-profile.js apps/api/src/student-growth-profile.test.mjs
git commit -m "feat: wire student growth snapshots into profile api"
```

## Task 3: Update AI Runtime Contract

**Files:**
- Modify: `packages/ai/src/runtime.js`

- [ ] **Step 1: Add failing static contract check**

Create or extend a script-level check if practical, otherwise add a Node test near API helper that reads `packages/ai/src/runtime.js` and asserts the prompt includes `profileType`, `publishedView`, `teacherReview`, `evidenceRefs`, and `confidence`.

- [ ] **Step 2: Run test to verify it fails**

Run the new test command.

- [ ] **Step 3: Update prompt**

Change `draftStudentProfileNarrative` system prompt to require strict JSON with `profileType`, `period`, `publishedView`, `teacherReview`, `evidenceRefs`, and `confidence`. Keep no supplier/model exposure rule.

- [ ] **Step 4: Run focused test and API check**

Run:

```powershell
node --test apps/api/src/student-growth-profile.test.mjs
.\jh.cmd check:api
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- packages/ai/src/runtime.js apps/api/src/student-growth-profile.test.mjs
git commit -m "feat: require structured student profile ai output"
```

## Task 4: Web Weekly/Monthly Draft And Display

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css` if needed

- [ ] **Step 1: Add typed API support**

Update `draftStudentProfile(studentId, periodType)` to POST `{ periodType }`.

- [ ] **Step 2: Update teacher UI**

Add a small period selector in the teacher student profile section with `weekly` and `monthly`. Display structured `publishedView` and `teacherReview.publishChecklist` when present, with the existing text area as fallback/editable summary.

- [ ] **Step 3: Update student archive UI**

In `StudentArchive`, render `student` snapshot data if available through mapped `publishedProfileText` or new profile fields. Preserve old cards and report list fallback.

- [ ] **Step 4: Run web typecheck**

Run: `npm.cmd run typecheck --workspace apps/web`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- apps/web/src/api.ts apps/web/src/main.tsx apps/web/src/styles.css
git commit -m "feat: show weekly and monthly student growth archive"
```

## Task 5: Docs And Skill Contract

**Files:**
- Modify: `docs/14-api-contract.md`
- Modify: `skills/student-profile/SKILLS.md`

- [ ] **Step 1: Update API contract**

Document `periodType`, `profileType`, `publishedView`, `teacherReview`, `profileEvidencePack`, and role filtering for student profile endpoints.

- [ ] **Step 2: Update student profile skill**

Add weekly/monthly evidence-driven rules, confidence states, and blocked-source policy.

- [ ] **Step 3: Run encoding check**

Run: `.\jh.cmd check:encoding`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```powershell
git add -- docs/14-api-contract.md skills/student-profile/SKILLS.md
git commit -m "docs: document student growth archive contract"
```

## Task 6: Final Verification

**Files:**
- No source edits unless failures require fixes.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test apps/api/src/student-growth-profile.test.mjs
.\jh.cmd check:api
npm.cmd run typecheck --workspace apps/web
.\jh.cmd check:encoding
```

- [ ] **Step 2: Inspect git diff**

Run:

```powershell
git diff --stat
git status --short
```

Confirm only intended implementation files are touched by this feature and pre-existing unrelated files are not staged.

- [ ] **Step 3: Commit final fixes if any**

If verification required fixes, stage explicit paths and commit with a focused message.

## Self-Review

Spec coverage:

- Weekly and monthly page core: Task 1, Task 2, Task 4.
- Evidence pack and confidence states: Task 1, Task 2.
- Strict AI JSON: Task 3.
- Role filtering: Task 1, Task 2.
- Docs and local skill update: Task 5.
- Verification commands: Task 6.

No placeholders are intentionally left. This plan avoids database migration for first release because `StudentProfile.snapshot` already stores JSON.

