---
name: student-profile
description: Use when changing weekly or monthly student growth profiles, grading evidence aggregation, parent summaries, report visibility, or teacher confirmation in Junhang AI Tutor.
---

`AGENTS.md` project rules take priority. Before editing, read the `skills/student-profile/SKILLS.md` Playbook. For cross-module changes, read every affected module Playbook.

Load `skills/grading/SKILLS.md` first for grading-derived evidence, then this Playbook. Only teacher-confirmed evidence enters `profileEvidencePack`; student and parent surfaces receive the filtered `publishedView`.

Minimum verification: `node --test apps/api/src/student-growth-profile.test.mjs`.
