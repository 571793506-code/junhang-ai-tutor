---
name: grading
description: Use when changing generated-material grading, external-workbook grading, OCR-assisted grading, answer alignment, question confidence, teacher review, or archive gates in Junhang AI Tutor.
---

`AGENTS.md` project rules take priority. Before editing, read the `skills/grading/SKILLS.md` Playbook. For cross-module changes, read every affected module Playbook.

For generated materials, load the `generation` contract and read `gradingSourcePackage` / `questionLayoutManifest` before grading. For external materials, stay on the reference-answer path. When confirmed results feed a profile, load `skills/student-profile/SKILLS.md` after teacher confirmation.

Minimum verification: `cmd /c npm.cmd run check:api`.

Read `skills/grading/references/runtime-rules.md` for shared evidence, scoring and confirmation rules. Change teaching details there, then verify `cmd /c npm.cmd run check:skills`. Runtime loading belongs in the AI layer; uploads cannot select rules or grant confirmation. Model routing and budgets belong in `packages/ai/src/model-policy.js`.
