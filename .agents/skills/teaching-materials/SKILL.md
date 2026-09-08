---
name: teaching-materials
description: Use when uploading teaching materials, ingesting teaching documents, converting ordinary materials to Markdown, indexing content, reviewing sources, or injecting textbook context in Junhang AI Tutor.
---

`AGENTS.md` project rules take priority. Before editing, read the `skills/teaching-materials/SKILLS.md` Playbook. For cross-module changes, read every affected module Playbook.

Load this Playbook before `generation` whenever a request names a textbook, chapter, source file, or content index. After source approval, pass only the bounded `contentContext` summary to generation, grading, or profile services.

Minimum verification: `cmd /c npm.cmd run check:content-context`.
