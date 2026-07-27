# Primary English Phonetics Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and verify a four-part, print-ready learning pack for the 48 English phonetic symbols, with adjacent Chinese mnemonic hints for students entering Grade 5.

**Architecture:** Keep a single structured content source for all 48 symbols and derive four separate DOCX artifacts from it so symbols, mnemonics, examples, lessons, exercises, and answer keys stay consistent. Convert each DOCX to PDF through the bundled document renderer, then validate structured content and inspect every rendered page.

**Tech Stack:** Bundled Python 3.12, `python-docx`, LibreOffice-based `render_docx.py`, Poppler/PyMuPDF visual QA, UTF-8 Markdown/JSON source files.

---

### Task 1: Build the verified phonetic content source

**Files:**
- Create: `E:\AppData\Cache\Temp\primary_phonetics_pack\phonetics_content.json`
- Create: `E:\AppData\Cache\Temp\primary_phonetics_pack\validate_content.py`

- [ ] Record all 20 vowels and 28 consonants in lesson order with fields for symbol, mnemonic, mnemonic caution, articulation, voice/length feature, examples, blend example, and common error.
- [ ] Add the ten lesson definitions and the seven required contrast pairs.
- [ ] Validate exact counts, unique symbols, required fields, lesson membership, and student-safe wording.
- [ ] Run: `python validate_content.py`
- [ ] Expected: exit code 0 with `48 symbols; 20 vowels; 28 consonants; all required fields present`.

### Task 2: Generate the four DOCX artifacts

**Files:**
- Create: `E:\AppData\Cache\Temp\primary_phonetics_pack\generate_pack.py`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标学习手册_学生版.docx`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标教学指南_教师版.docx`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标速查表.docx`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标专项练习册.docx`

- [ ] Implement one shared A4 style system based on `compact_reference_guide` plus the named `A4_print_override`.
- [ ] Generate student learning cards, ten teacher lesson plans and answers, a two-page quick-reference chart, and ten workbook units from the same structured source.
- [ ] Add four-line English writing grids only to word and sentence writing tasks; use IPA tracing boxes for phonetic-symbol writing.
- [ ] Inspect the DOCX ZIP/XML structure for missing fonts, missing page setup, or percentage-width tables.

### Task 3: Render DOCX and produce the requested PDFs

**Files:**
- Create: `E:\AppData\Cache\Temp\primary_phonetics_pack\renders\<artifact>\page-<N>.png`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标学习手册_学生版.pdf`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标教学指南_教师版.pdf`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标速查表.pdf`
- Create: `E:\UserData\86188\Desktop\小学教学资料\小学英语48个音标学习_20260727\小学英语48个音标专项练习册.pdf`

- [ ] Run the bundled `render_docx.py` with `--emit_pdf` for each DOCX.
- [ ] Copy only the four final PDFs to the output directory; keep PNG renders in the temporary QA directory.
- [ ] Open and inspect every rendered page at 100 percent zoom for glyphs, clipping, overlap, page breaks, answer leakage, and usable writing space.
- [ ] Revise the generator and repeat rendering until all pages pass.

### Task 4: Run final content and workspace checks

**Files:**
- Verify: all eight output artifacts
- Verify: `docs/superpowers/specs/2026-07-27-primary-english-phonetics-pack-design.md`
- Verify: `docs/superpowers/plans/2026-07-27-primary-english-phonetics-pack.md`

- [ ] Extract text from each PDF and confirm all required section titles are present.
- [ ] Confirm the student manual and workbook contain no answer-key headings or teacher-only notes.
- [ ] Run: `.\jh.cmd check:encoding`
- [ ] Run: `git status --short` and verify unrelated pre-existing files remain untouched.
- [ ] Report final file paths, page counts, validation results, and the unchanged dirty-worktree boundary.
