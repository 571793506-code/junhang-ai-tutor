# Student Profile Comprehensive Print Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive-only weekly and monthly growth archive print templates with deeper text sections and HTML rendering.

**Architecture:** Extend the existing API-side `student-growth-profile` helper so every weekly/monthly snapshot includes `printView`. Keep single-subject reports out of the data contract. Add a render function for printable HTML, then document the contract for teacher UI and later PDF generation.

**Tech Stack:** Node.js ES modules, Node built-in test runner, existing Express profile snapshot flow, UTF-8 Chinese templates.

---

## File Structure

- Modify `apps/api/src/student-growth-profile.test.mjs`
  - Adds failing tests for comprehensive-only `printView`, weekly/monthly section depth, role filtering, and HTML rendering.
- Modify `apps/api/src/student-growth-profile.js`
  - Builds `printView` from the existing evidence pack and published view.
  - Exports `renderStudentGrowthProfilePrintHtml(student, snapshot)`.
- Modify `docs/14-api-contract.md`
  - Documents `printView` and comprehensive-only template rules.
- Modify `skills/student-profile/SKILLS.md`
  - Updates project-local student profile rules to remove single-subject template direction.

## Task 1: Failing Tests

- [ ] Add tests asserting weekly snapshots include `printView.templateType=comprehensive_growth_archive`, title `周综合成长档案`, and no `singleSubjectTemplate`.
- [ ] Add tests asserting monthly snapshots include deeper sections: `evidenceCoverage`, `subjectAbilityMap`, `commonCauseAnalysis`, `learningProcess`, `homeSchoolCollaboration`.
- [ ] Add tests asserting student role does not receive `teacherReview` or `profileEvidencePack` but can receive public `printView` without internal evidence pack.
- [ ] Add tests asserting `renderStudentGrowthProfilePrintHtml` renders Chinese HTML from template text and does not include model/provider/prompt/debug fields.
- [ ] Run `node --test apps/api/src/student-growth-profile.test.mjs` and confirm failure because `printView` and render function do not exist yet.

## Task 2: Service Implementation

- [ ] Add `buildPrintView(pack, publishedView)` inside `student-growth-profile.js`.
- [ ] Weekly `printView.sections` includes: archiveInfo, comprehensiveSummary, subjectOverview, focusDirections, correctionLoop, stableGrowth, tutoringPlan, parentNextSteps.
- [ ] Monthly `printView.sections` also includes: evidenceCoverage, subjectAbilityMap, commonCauseAnalysis, learningProcess, homeSchoolCollaboration, parentCommunicationSummary.
- [ ] Add rendering policy: `pdfTextSource=html_template`, `imagePreviewUsage=visual_reference_only`, `requiresTeacherReview=true`.
- [ ] Add `renderStudentGrowthProfilePrintHtml(student, snapshot)` with A4 print-safe HTML.
- [ ] Run `node --test apps/api/src/student-growth-profile.test.mjs` and confirm pass.

## Task 3: Documentation

- [ ] Update `docs/14-api-contract.md` student profile section with `printView` structure.
- [ ] Update `skills/student-profile/SKILLS.md` to state this project only uses comprehensive templates.
- [ ] Run `cmd /c npm.cmd run check:encoding`.

## Task 4: Verification

- [ ] Run `node --test apps/api/src/student-growth-profile.test.mjs apps/api/src/student-term-report.test.mjs`.
- [ ] Run `cmd /c npm.cmd run check --workspace apps/api`.
- [ ] Run `cmd /c npm.cmd run check:encoding`.
- [ ] Inspect `git diff --stat` and confirm only intended files changed.

## Self-Review

This plan covers the approved scope: comprehensive-only template family, deeper weekly/monthly print content, HTML/PDF text rendering boundary, role visibility, and documentation. It intentionally excludes single-subject templates and微信自动发送.
