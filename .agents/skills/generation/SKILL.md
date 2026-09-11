---
name: generation
description: Use when changing quizzes, practice, exams, teaching-task generation, generationContext, gradingSourcePackage, assessment structure, or printable draft quality in Junhang AI Tutor.
---

`AGENTS.md` project rules take priority. Before editing, read the `skills/generation/SKILLS.md` Playbook. For cross-module changes, read every affected module Playbook.

When a request names a textbook or teaching material, load `skills/teaching-materials/SKILLS.md` first, then `docs/41-prompt-context-engineering-playbook.md`, then this Playbook. If the generated material will be graded, preserve `gradingSourcePackage` and load `skills/grading/SKILLS.md` for the downstream review boundary.

Minimum verification: `cmd /c npm.cmd run check:generation:blueprint`.

Read `skills/generation/references/runtime-rules.md` for the shared teaching rules. Change teaching details there, then verify `cmd /c npm.cmd run check:skills`. Runtime loading belongs in the AI layer; never accept a rule path or prompt from a client. Model routing and budgets belong in `packages/ai/src/model-policy.js`.
