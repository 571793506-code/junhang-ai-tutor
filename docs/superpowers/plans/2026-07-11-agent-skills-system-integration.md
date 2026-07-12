# Agent/Skills System Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一个可追踪的集成分支中合入已验证的 Sol 升级链路，建立可自动发现的项目 Skills 和双目录同步守卫，并让安全、身份确认的学生问答成为学生档案的结构化辅助证据。

**Architecture:** 保留 `skills/*/SKILLS.md` 和 `docs/41-prompt-context-engineering-playbook.md` 作为项目规则正文，新增 `.agents/skills/*/SKILL.md` 薄路由层和 `check:skills` 自动守卫。AI 问答最多执行一次 Terra 低推理文本调用，Terra 不可用时零调用且绝不调用 Sol；实际调用成功时，同一次调用返回 `studentAnswer + learningSignal`。服务层校验和规范化模型 `safetyStatus`，再计算最终会话角色、身份、可用性、结构完整性和档案准入；第一版复用 `QaSession.metadata`，不做数据库迁移。`miniapp-1` 仍是微信开发者工具运行目录，`apps/miniprogram` 仍是 Git 镜像，反向同步必须显式执行并拒绝覆盖脏镜像。

**Tech Stack:** Node.js 22+、ES modules、Node test runner、Express、Prisma JSON metadata、PowerShell/cmd、Git worktree、Codex repository Skills。

---

## Current Evidence And Review Reconciliation

- 当前集成分支：`codex/agent-skills-system-integration`。
- Tasks 1-10 已全部完成；历史提交与分层验证证据保留在下方执行记录中。
- Sol 分支 `codex/gpt56-sol-escalation` 继续保留并已纳入当前集成线；本地 Sol worktree 注册与目录已在验证后移除。
- 当前执行结论以本节状态和下方证据为准；本摘要不预先声明后续修复提交 SHA。

## File Map

### Rules And Routing

- Modify: `AGENTS.md` - 区分即时问答与生成/批改/档案的教师复核边界。
- Modify: `SKILLS.md` - 增加 Prompt/Context 路由，保持 AI 视频退出。
- Modify: `skills/project-grill-review/SKILLS.md` - 删除视频专属、机器路径和旧重启说明。
- Modify: `skills/ai-qa/SKILLS.md` - 写明即时返回、结构化信号和档案准入。
- Modify: `skills/student-profile/SKILLS.md` - 写明问答仅为辅助证据和正式档案仍需教师确认。
- Modify: `skills/miniprogram/SKILLS.md` - 使用可移植运行目录表达并加入双向同步命令。
- Modify: `skills/grading/SKILLS.md` - 合并 Sol 后消除“只调用一次 GPT-5.6”与条件式 Sol 升级的歧义。
- Modify: `docs/14-api-contract.md`, `docs/41-prompt-context-engineering-playbook.md`, `docs/44-miniprogram-migration-runbook.md` - 固化多端契约、问答回档和同步边界。

### Skill Discovery

- Create: `.agents/skills/{ai-qa,student-profile,teaching-materials,generation,grading,miniprogram,miniprogram-ui,project-grill-review,prompt-context-engineering}/SKILL.md` - 标准发现薄路由。
- Create: `scripts/skills-check-lib.mjs` - Skill 路由和文档规则校验核心。
- Create: `scripts/skills-check.test.mjs` - 失败夹具和回归测试。
- Create: `scripts/skills-check.mjs` - CLI 入口。
- Modify: `package.json` - 增加 `check:skills`。

### Miniprogram Sync

- Create: `scripts/miniprogram-sync-lib.mjs` - 比较、过滤、路径保护和显式同步。
- Create: `scripts/miniprogram-sync-lib.test.mjs` - 新增、修改、删除、排除和脏镜像测试。
- Create: `scripts/sync-miniapp-to-repo.mjs` - `--check` / `--write` CLI。
- Modify: `package.json` - 增加 `check:miniprogram-sync` 和 `sync:miniprogram-from-miniapp`。

### Q&A Runtime, Persistence, And API

- Create: `packages/ai/src/qa-learning-signal.js` - 结构解析、白名单规范化和降级结果。
- Create: `packages/ai/src/qa-learning-signal.test.mjs` - 结构、安全和长度回归测试。
- Modify: `packages/ai/src/runtime.js` - Terra 低推理严格 JSON 问答调用。
- Modify: `packages/ai/src/gpt56-runtime.test.mjs` - 请求负载、正常解析和降级测试。
- Modify: `packages/ai/src/index.d.ts` - 问答结构类型。
- Create: `packages/services/src/qa-learning-record.js` - 服务层准入和 metadata 组装。
- Create: `packages/services/src/qa-learning-record.test.mjs` - 角色/身份/失败状态矩阵。
- Modify: `packages/services/src/index.js` - 统一持久化 QaSession 和 VoiceInteraction 引用。
- Create: `apps/api/src/qa-response.js` - 会话身份上下文和客户端字段白名单。
- Create: `apps/api/src/qa-response.test.mjs` - 学生、教师、课堂响应可见性测试。
- Modify: `apps/api/src/server.js` - 两个问答路由接入会话上下文和安全响应 helper。

### Student Profile

- Modify: `apps/api/src/student-growth-profile.js` - 过滤并聚合合格问答信号，避免单次问答形成强结论。
- Modify: `apps/api/src/student-growth-profile.test.mjs` - 准入、聚合、历史数据和角色过滤测试。

## Task 1: Close Current Root Rules And Grill Residue

**Files:**
- Modify: `AGENTS.md`
- Modify: `SKILLS.md`
- Modify: `skills/project-grill-review/SKILLS.md`

- [x] **Step 1: Reconfirm the exact dirty scope**

Run:

```powershell
git status --short --branch
git diff -- AGENTS.md SKILLS.md skills/project-grill-review/SKILLS.md
```

Expected: only the three approved rule paths appear. Do not proceed if another staged path appears.

- [x] **Step 2: Correct the review boundary in `AGENTS.md`**

Replace the universal “all model output requires teacher review” wording with these task-aware rules:

```markdown
- 学生 AI 问答在服务层完成结构解析、模型 `safetyStatus` 校验和规范化以及普通端字段过滤后可以即时返回，不需要教师逐条预审。
- 只有精确匹配 `qa-learning-signal-v1`，模型 `safetyStatus` 经服务端校验和规范化，并由服务端计算最终 actor、身份确认、可用性、结构有效性和 `profileEligibility`，且来源日期有效的学生/课堂问答记录可以进入学生档案辅助分析；教师测试、匿名/未确认课堂问答、不可用、不安全、结构异常、日期无效和 legacy 记录不得进入公开证据。
- 小测、练习、试卷、批改、周/月档案、阶段报告、家长摘要和正式导出仍是草稿流程，必须由教师确认后才能发布、打印、归档或同步给学生/家长。
- 一个唯一来源问答不能提高掌握度、分数或形成强结论；同一标准化 `subject + knowledgePoint` 的重复信号可形成 `supported`，但仍是辅助证据。教师确认的非问答证据优先，冲突只生成教师复核备注。
```

Keep the existing parse/normalize/validate/repair and multi-end visibility rules. Restrict `review-state handling` to the task-specific policy instead of asserting that every Q&A response waits for review.

- [x] **Step 3: Correct the root `SKILLS.md` routing text**

Use the same boundary in concise form and add the missing Prompt/Context route:

```markdown
| Prompt/Context 工程 | `docs/41-prompt-context-engineering-playbook.md` | 模型提示词、结构化上下文、输出修复和任务级复核边界 |
```

The current module table must contain no AI video row and no link to `skills/ai-video-production`.

- [x] **Step 4: Make the Grill Playbook portable and project-scoped**

Apply all of these exact changes to `skills/project-grill-review/SKILLS.md`:

- Remove “视频制作流程”, “AI 视频”, video assets, and `mmx.cmd` from triggers and review dimensions.
- Replace the three `C:\Users\86188\.codex\skills\...` paths with skill names only: `grill-me`, `grilling`, and `grill-all`.
- Replace the stale restart statement with: “外部 Skill 是否在当前任务可见必须以当前 Skills 列表为准；不可见时仍按本项目 Playbook 执行，不假设重启一定生效。”
- Preserve one-question-at-a-time, source-first investigation, recommendation, reversibility, and explicit verification rules.

- [x] **Step 5: Verify the rule-only change**

Run:

```powershell
cmd /c npm.cmd run check:encoding
git diff --check
rg -n "ai-video-production|AI 视频|mmx\.cmd|C:\\Users\\86188\\.codex\\skills|安装后需要重启" AGENTS.md SKILLS.md skills/project-grill-review/SKILLS.md
```

Expected: encoding exits `0`, `git diff --check` is empty, and `rg` returns no matches.

- [x] **Step 6: Commit only the rule group**

```powershell
git add -- AGENTS.md SKILLS.md skills/project-grill-review/SKILLS.md
git diff --cached --check
git commit -m "docs: align agent and skills boundaries"
```

Expected: one commit containing exactly those three paths.

## Task 2: Merge The Verified Sol Branch With History Preserved

**Files:**
- Merge commit only; no manual source edit is expected.

- [x] **Step 1: Prove both worktrees and commits are in the expected state**

```powershell
git status --short --branch
git worktree list --porcelain
git rev-parse codex/gpt56-sol-escalation
git rev-parse e52e9a6
```

Expected: integration worktree is clean, Sol branch and `e52e9a6` resolve to the same object, and the Sol worktree still exists.

- [x] **Step 2: Perform the approved non-fast-forward merge**

```powershell
git merge --no-ff codex/gpt56-sol-escalation -m "merge: integrate GPT-5.6 Sol escalation"
```

Expected: merge succeeds without overwriting Task 1. If a conflict appears, resolve only by preserving Task 1’s Q&A/routing wording and Sol’s generation/grading implementation; then inspect every conflict path before continuing.

- [x] **Step 3: Verify merge ancestry and scope**

```powershell
git merge-base --is-ancestor e52e9a6 HEAD
git show --stat --oneline --summary HEAD
git status --short --branch
```

Expected: ancestry command exits `0`, HEAD is a merge commit, and the worktree is clean.

## Task 3: Re-run Sol Integration Gates On The Unified Baseline

**Files:**
- No source edits unless a deterministic regression is reproduced.
- Append verification evidence later in Task 9.

- [x] **Step 1: Run focused fake-server and pure unit tests**

```powershell
$aiTests = Get-ChildItem packages\ai\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $aiTests
$serviceTests = Get-ChildItem packages\services\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $serviceTests
node --test scripts\gpt56-capability-check.test.mjs scripts\generation-quality-check.test.mjs scripts\sol-escalation-quality-check.test.mjs scripts\grading-quality-check.test.mjs
node --test apps\api\src\assessment-print-export-gate.test.mjs apps\api\src\grading-review-gates.test.mjs
```

Expected: all tests pass with zero failures. A deterministic failure must be fixed before Task 4; do not weaken an escalation or learner-visibility gate.

- [x] **Step 2: Run project checks affected by the merge**

```powershell
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:services
cmd /c npm.cmd run check:encoding
```

Expected: every command exits `0`.

- [x] **Step 3: Probe the real intermediary once after formal merge**

```powershell
cmd /c npm.cmd run check:gpt56 -- --include-sol
```

Expected: Terra and Sol pass text, JSON object, reasoning effort, JSON Schema, and synthetic grading probes. Image input may remain unsupported because MiniMax owns OCR.

- [x] **Step 4: Re-run the explicit Sol generation acceptance gate**

```powershell
cmd /c npm.cmd run check:generation:quality:sol
```

Expected: six samples pass with Sol `high` and `usedDynamicFallback=false`. Record latency and any external `524`. One unchanged retry is allowed only to distinguish transient intermediary failure from a deterministic code failure.

- [x] **Step 5: Preserve the known grading-accuracy limitation**

```powershell
$goldPath = 'materials\evaluation\teacher-grading-gold-cases.json'
if (Test-Path -LiteralPath $goldPath) {
  cmd /c npm.cmd run check:grading:quality -- $goldPath
} else {
  Write-Output 'Teacher grading gold file is unavailable; production grading accuracy remains unverified.'
}
```

Expected: either the teacher-confirmed gold gate passes or the missing operational acceptance gate is recorded without claiming production accuracy.

## Task 4: Add Standard Repository Skill Discovery And `check:skills`

**Files:**
- Create: `.agents/skills/*/SKILL.md` for the nine approved routes
- Create: `scripts/skills-check-lib.mjs`
- Create: `scripts/skills-check.test.mjs`
- Create: `scripts/skills-check.mjs`
- Modify: `skills/miniprogram/SKILLS.md`
- Modify: `SKILLS.md`
- Modify: `package.json`

- [x] **Step 1: Write failing Skill guard tests**

Create `scripts/skills-check.test.mjs` with temporary workspace fixtures covering:

```javascript
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSkillsWorkspace } from "./skills-check-lib.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junhang-skills-"));
  fs.mkdirSync(path.join(root, ".agents", "skills", "ai-qa"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "ai-qa"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "ai-qa", "SKILLS.md"), "# AI Q&A\n", "utf8");
  fs.writeFileSync(path.join(root, "SKILLS.md"), "| AI 问答类 | `skills/ai-qa/SKILLS.md` | 问答 |\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { "check:api": "node check.mjs" } }), "utf8");
  return root;
}

test("reports missing required repository skills", () => {
  const result = validateSkillsWorkspace(fixture(), { requiredRoutes: ["ai-qa", "grading"] });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.type === "missing-skill" && item.skill === "grading"));
});

test("rejects mismatched frontmatter, missing playbooks, absolute user paths, and video routing", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, ".agents", "skills", "ai-qa", "SKILL.md"), `---\nname: wrong-name\ndescription: Use when handling student questions\n---\nRead C:\\Users\\someone\\skill.md and skills/ai-video-production/SKILLS.md.\n`, "utf8");
  const result = validateSkillsWorkspace(root, { requiredRoutes: ["ai-qa"] });
  assert.ok(result.failures.some((item) => item.type === "name-mismatch"));
  assert.ok(result.failures.some((item) => item.type === "absolute-user-path"));
  assert.ok(result.failures.some((item) => item.type === "forbidden-video-route"));
});

test("rejects validation commands that are absent from package scripts", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, ".agents", "skills", "ai-qa", "SKILL.md"), `---\nname: ai-qa\ndescription: Use when handling student questions\n---\nRead skills/ai-qa/SKILLS.md. Run cmd /c npm.cmd run check:missing.\n`, "utf8");
  const result = validateSkillsWorkspace(root, { requiredRoutes: ["ai-qa"] });
  assert.ok(result.failures.some((item) => item.type === "missing-npm-script"));
});
```

- [x] **Step 2: Run the new tests and verify RED**

```powershell
node --test scripts\skills-check.test.mjs
```

Expected: FAIL because `scripts/skills-check-lib.mjs` does not exist.

- [x] **Step 3: Implement the Skill guard core and CLI**

Implement `validateSkillsWorkspace(root, options)` in `scripts/skills-check-lib.mjs` with this fixed route map:

```javascript
export const REQUIRED_SKILL_ROUTES = {
  "ai-qa": "skills/ai-qa/SKILLS.md",
  "student-profile": "skills/student-profile/SKILLS.md",
  "teaching-materials": "skills/teaching-materials/SKILLS.md",
  generation: "skills/generation/SKILLS.md",
  grading: "skills/grading/SKILLS.md",
  miniprogram: "skills/miniprogram/SKILLS.md",
  "miniprogram-ui": "skills/miniprogram-ui/SKILLS.md",
  "project-grill-review": "skills/project-grill-review/SKILLS.md",
  "prompt-context-engineering": "docs/41-prompt-context-engineering-playbook.md"
};
```

The validator must return `{ ok, checkedSkills, failures }` and enforce:

- each required `.agents/skills/<name>/SKILL.md` exists;
- frontmatter has only valid `name` and non-empty `description`, the name matches the directory, and description starts with `Use when`;
- each file references its exact route from `REQUIRED_SKILL_ROUTES` and that route exists;
- root `SKILLS.md` references every route;
- project Skill files contain no drive-qualified `Users` path;
- every `npm.cmd run <name>` token refers to an existing root script; when the same command contains `--workspace <workspace-name-or-path>`, resolve that workspace through the root `workspaces` list and validate the script against the workspace `package.json` instead;
- `ai-video-production`, `skills/ai-video-production`, and an `.agents/skills/ai-video-production` directory are forbidden.

Create `scripts/skills-check.mjs` as a thin CLI:

```javascript
import { validateSkillsWorkspace } from "./skills-check-lib.mjs";

const result = validateSkillsWorkspace(process.cwd());
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
```

- [x] **Step 4: Add the nine thin discovery wrappers**

Each wrapper must contain only valid frontmatter, the route to read, cross-module requirements, and the smallest verification command. Use these exact names and triggering descriptions:

| Directory/name | Description | Required route | Minimum verification |
| --- | --- | --- | --- |
| `ai-qa` | `Use when changing student questions, explanations, classroom voice Q&A, Q&A safety, or Q&A profile signals in Junhang AI Tutor.` | `skills/ai-qa/SKILLS.md` | `cmd /c npm.cmd run check:api` |
| `student-profile` | `Use when changing student growth profiles, evidence aggregation, parent summaries, report visibility, or teacher confirmation in Junhang AI Tutor.` | `skills/student-profile/SKILLS.md` | `node --test apps/api/src/student-growth-profile.test.mjs` |
| `teaching-materials` | `Use when ingesting teaching documents, converting ordinary materials to Markdown, indexing content, or injecting textbook context in Junhang AI Tutor.` | `skills/teaching-materials/SKILLS.md` | `cmd /c npm.cmd run check:content-context` |
| `generation` | `Use when changing quizzes, practice, exams, teaching-task generation, assessment structure, or printable draft quality in Junhang AI Tutor.` | `skills/generation/SKILLS.md` | `cmd /c npm.cmd run check:generation:blueprint` |
| `grading` | `Use when changing OCR-assisted grading, answer alignment, grading confidence, teacher review, or archive gates in Junhang AI Tutor.` | `skills/grading/SKILLS.md` | `cmd /c npm.cmd run check:api` |
| `miniprogram` | `Use when changing WeChat Mini Program pages, routes, API wrappers, runtime-project sync, or developer-tool workflows in Junhang AI Tutor.` | `skills/miniprogram/SKILLS.md` | `cmd /c npm.cmd run check:miniprogram-js` |
| `miniprogram-ui` | `Use when changing Mini Program information hierarchy, components, responsive states, or student, teacher, and classroom UI in Junhang AI Tutor.` | `skills/miniprogram-ui/SKILLS.md` | `cmd /c npm.cmd run check:miniprogram-js` |
| `project-grill-review` | `Use when stress-testing a Junhang AI Tutor plan, architecture, migration, permission boundary, or implementation sequence before coding.` | `skills/project-grill-review/SKILLS.md` | `cmd /c npm.cmd run check:encoding` |
| `prompt-context-engineering` | `Use when changing prompts, context packs, structured model output, repair policy, model routing, or task-specific review boundaries in Junhang AI Tutor.` | `docs/41-prompt-context-engineering-playbook.md` | `cmd /c npm.cmd run check:encoding` |

Every body must state that `AGENTS.md` has higher project-rule priority and that the routed Playbook must be read before editing.

- [x] **Step 5: Remove the remaining absolute Skill path and register the command**

In `skills/miniprogram/SKILLS.md`, replace the machine path with:

```markdown
- 微信开发者工具运行目录：优先读取 `JH_MINIAPP_TARGET`，未设置时使用 `%USERPROFILE%\WeChatProjects\miniapp-1`。
```

Add to `package.json`:

```json
"check:skills": "node scripts/skills-check.mjs"
```

- [x] **Step 6: Run GREEN and full Skill checks**

```powershell
node --test scripts\skills-check.test.mjs
cmd /c npm.cmd run check:skills
cmd /c npm.cmd run check:encoding
git diff --check
```

Expected: all tests and checks pass; output reports nine checked Skills and zero failures.

- [x] **Step 7: Commit the discovery layer**

```powershell
git add -- .agents/skills scripts/skills-check-lib.mjs scripts/skills-check.test.mjs scripts/skills-check.mjs package.json SKILLS.md skills/miniprogram/SKILLS.md
git diff --cached --check
git commit -m "feat: add repository skill discovery guard"
```

## Task 5: Add Safe `miniapp-1 -> apps/miniprogram` Reverse Sync

**Files:**
- Create: `scripts/miniprogram-sync-lib.mjs`
- Create: `scripts/miniprogram-sync-lib.test.mjs`
- Create: `scripts/sync-miniapp-to-repo.mjs`
- Modify: `package.json`
- Modify: `skills/miniprogram/SKILLS.md`
- Modify: `docs/44-miniprogram-migration-runbook.md`

- [x] **Step 1: Write failing sync tests**

Create tests using temporary source/repository directories. The test matrix must assert:

```javascript
test("check reports added, changed, and deleted allowed files without writing", async () => {});
test("write mirrors allowed files and makes the next check clean", async () => {});
test("config, private, cache, node_modules, and miniprogram_npm paths are excluded", async () => {});
test("write refuses to run when the repository mirror is dirty", async () => {});
test("delete operations cannot resolve outside the repository mirror", async () => {});
```

Use these fixture files in the first test:

```text
source/app.js                    changed
source/pages/student/index.js   added
repo/utils/obsolete.js          deleted from source
source/project.config.json      excluded
source/miniprogram_npm/x.js     excluded
source/.cache/tool-state.json   excluded
```

- [x] **Step 2: Run tests and verify RED**

```powershell
node --test scripts\miniprogram-sync-lib.test.mjs
```

Expected: FAIL because `scripts/miniprogram-sync-lib.mjs` does not exist.

- [x] **Step 3: Implement deterministic comparison and write protection**

Export these functions from `scripts/miniprogram-sync-lib.mjs`:

```javascript
export const ROOT_EXCLUDES = new Set([
  "project.config.json",
  "project.private.config.json",
  "project.miniapp.json",
  "app.miniapp.json"
]);

export const DIRECTORY_EXCLUDES = new Set([
  ".git", ".idea", ".vscode", ".cache", "cache", "node_modules", "miniprogram_npm"
]);

export function listSyncFiles(root) {}
export function compareMiniprogramTrees(sourceRoot, targetRoot) {}
export function assertPathInside(root, candidate) {}
export function applyMiniprogramSync(sourceRoot, targetRoot, differences) {}
export function assertRepositoryMirrorClean(repoRoot, runGit) {}
```

`compareMiniprogramTrees` must return sorted POSIX-style arrays `{ added, changed, deleted }` using byte comparison. `applyMiniprogramSync` must create parent directories, copy added/changed files, delete only allowed target files, remove only newly empty allowed directories, and run `assertPathInside` before every write or delete.

- [x] **Step 4: Implement the CLI modes**

Create `scripts/sync-miniapp-to-repo.mjs` with:

```text
--check  compare only; exit 0 when clean and 1 when allowed-source differences exist
--write  first run git status --porcelain -- apps/miniprogram; refuse on any output; apply differences; compare again; exit 0 only when clean
```

Resolve the source from `JH_MINIAPP_TARGET` or `path.join(os.homedir(), "WeChatProjects", "miniapp-1")`. Resolve the target as `<repo>/apps/miniprogram`. Reject any mode other than `--check` or `--write`.

- [x] **Step 5: Register commands and documentation**

Add to `package.json`:

```json
"check:miniprogram-sync": "node scripts/sync-miniapp-to-repo.mjs --check",
"sync:miniprogram-from-miniapp": "node scripts/sync-miniapp-to-repo.mjs --write"
```

Update `skills/miniprogram/SKILLS.md` and `docs/44-miniprogram-migration-runbook.md` so the direction is explicit:

```text
apps/miniprogram -> miniapp-1: sync:miniapp1, used to restore/update the runtime project
miniapp-1 -> apps/miniprogram: check:miniprogram-sync then explicit sync:miniprogram-from-miniapp
```

State that no ordinary validation command performs `--write` automatically.

- [x] **Step 6: Run GREEN and static checks**

```powershell
node --test scripts\miniprogram-sync-lib.test.mjs
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:miniapp1
cmd /c npm.cmd run check:encoding
git diff --check
```

Expected: unit tests and static checks pass.

- [x] **Step 7: Commit the reverse-sync guard**

```powershell
git add -- scripts/miniprogram-sync-lib.mjs scripts/miniprogram-sync-lib.test.mjs scripts/sync-miniapp-to-repo.mjs package.json skills/miniprogram/SKILLS.md docs/44-miniprogram-migration-runbook.md
git diff --cached --check
git commit -m "feat: guard miniprogram reverse sync"
```

- [x] **Step 8: Compare the live runtime tree and explicitly close any source drift**

Run the read-only comparison after the guard commit:

```powershell
cmd /c npm.cmd run check:miniprogram-sync
```

If it exits `0`, no source-sync commit is needed. If it exits `1`, require concrete `added`, `changed`, and `deleted` path arrays, then run:

```powershell
git status --short -- apps/miniprogram
cmd /c npm.cmd run sync:miniprogram-from-miniapp
git diff --name-status -- apps/miniprogram
cmd /c npm.cmd run check:miniprogram-sync
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
```

Expected: the pre-write Git status for `apps/miniprogram` is empty, the write copies only allowed source paths, the second comparison exits `0`, and static/encoding checks pass. Review the listed paths, then commit the module-scoped source changes separately:

```powershell
git add -- apps/miniprogram
git diff --cached --check
git commit -m "chore: sync miniprogram runtime source"
```

Do not create this commit when the original read-only comparison is already clean.

## Task 6: Produce Structured Q&A Output Without Sol Escalation

**Files:**
- Create: `packages/ai/src/qa-learning-signal.js`
- Create: `packages/ai/src/qa-learning-signal.test.mjs`
- Modify: `packages/ai/src/runtime.js`
- Modify: `packages/ai/src/gpt56-runtime.test.mjs`
- Modify: `packages/ai/src/index.d.ts`

- [x] **Step 1: Write failing normalization tests**

Cover this exact contract:

```javascript
const validPayload = {
  studentAnswer: "先把 0.5 看成 5 个十分之一。",
  learningSignal: {
    knowledgePoints: ["小数意义"],
    questionIntent: "concept",
    difficultySignal: "possible",
    misconceptionHypotheses: ["可能把十分位理解成十位"],
    followUpNeeded: true,
    confidence: "medium",
    safetyStatus: "pass",
    profileEligibility: true,
    blockedReason: null
  }
};
```

Tests must prove:

- valid JSON is normalized and marked `structureValid=true`;
- unknown keys are removed and arrays/strings are length-limited;
- invalid enums fall back to `other`, `none`, `low`, or `blocked` as appropriate;
- `safetyStatus=blocked` forces an approved refusal and `profileEligibility=false`;
- malformed JSON can return a sanitized plain-text answer but has no eligible learning signal;
- provider, model, raw, prompt, and debug fields never enter `studentAnswer` or `learningSignal`.

- [x] **Step 2: Run the helper test and verify RED**

```powershell
node --test packages\ai\src\qa-learning-signal.test.mjs
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the Q&A parser and normalizer**

Export from `packages/ai/src/qa-learning-signal.js`:

```javascript
export const QA_LEARNING_SIGNAL_SCHEMA_VERSION = "qa-learning-signal-v1";
export const QA_UNAVAILABLE_ANSWER = "AI 问答暂时不可用，请稍后再试。";
export const QA_BLOCKED_ANSWER = "这个问题暂时不能直接回答，请换一种安全、清楚的方式提问。";
export function normalizeQaModelOutput(text) {}
export function unavailableQaOutput(reason) {}
```

Use strict enum sets, trim strings, cap `studentAnswer` at 2000 characters, knowledge points at 8 items/80 characters each, misconception hypotheses at 5 items/160 characters each, and never trust model-provided `profileEligibility` as the final service eligibility.

- [x] **Step 4: Write failing runtime request tests**

Extend `packages/ai/src/gpt56-runtime.test.mjs` to assert that `answerStudentQuestion`:

- sends `response_format: { type: "json_object" }`;
- sends `reasoning_effort: "low"` when enabled;
- asks for the exact `studentAnswer + learningSignal` structure;
- returns normalized `studentAnswer`, `learningSignal`, and `structureValid`;
- does not call or mention Sol after an unavailable, malformed, or blocked response.

- [x] **Step 5: Implement the minimal runtime change**

In `packages/ai/src/runtime.js`, keep the provider route on `gpt56` Terra and change the call to:

```javascript
const result = await timedCall(() => callGpt56Chat(config, messages, {
  responseFormat: { type: "json_object" },
  reasoningEffort: "low"
}));
```

Parse with `normalizeQaModelOutput`. Return `answer` as an internal compatibility alias of `studentAnswer`; retain raw/model fields only inside the internal runtime result and model run, never in public API helpers.

- [x] **Step 6: Run GREEN and all AI regressions**

```powershell
node --test packages\ai\src\qa-learning-signal.test.mjs packages\ai\src\gpt56-runtime.test.mjs
$aiTests = Get-ChildItem packages\ai\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $aiTests
git diff --check
```

Expected: all AI tests pass and existing generation/grading Sol behavior is unchanged.

- [x] **Step 7: Commit the runtime contract**

```powershell
git add -- packages/ai/src/qa-learning-signal.js packages/ai/src/qa-learning-signal.test.mjs packages/ai/src/runtime.js packages/ai/src/gpt56-runtime.test.mjs packages/ai/src/index.d.ts
git diff --cached --check
git commit -m "feat: structure student qa learning signals"
```

## Task 7: Persist Actor, Identity, Safety, And Eligibility Through Service And API

**Files:**
- Create: `packages/services/src/qa-learning-record.js`
- Create: `packages/services/src/qa-learning-record.test.mjs`
- Modify: `packages/services/src/index.js`
- Create: `apps/api/src/qa-response.js`
- Create: `apps/api/src/qa-response.test.mjs`
- Modify: `apps/api/src/server.js`

- [x] **Step 1: Write the service eligibility matrix first**

Create tests for `buildQaLearningRecord(input, result)` with these expected outcomes:

| actorRole | identityConfirmed | available | structure/safety | eligible |
| --- | ---: | ---: | --- | ---: |
| `student` | true | true | valid/pass | true |
| `classroom` | true | true | valid/pass | true |
| `teacher` | true | true | valid/pass | false |
| `student` | false | true | valid/pass | false |
| `classroom` | false | true | valid/pass | false |
| any | any | false | any | false |
| any | any | true | malformed | false |
| any | any | true | blocked | false |

The returned metadata must contain only:

```javascript
{
  actorRole,
  identityConfirmed,
  available,
  mode,
  learningSignal,
  profileEligibility,
  blockedReason,
  schemaVersion: "qa-learning-signal-v1"
}
```

- [x] **Step 2: Run the service test and verify RED**

```powershell
node --test packages\services\src\qa-learning-record.test.mjs
```

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement service-level eligibility and persistence**

In `packages/services/src/qa-learning-record.js`, compute eligibility in service code; never accept the client’s or model’s final boolean. Use deterministic blocked reasons:

```text
teacher-test
identity-unconfirmed
model-unavailable
unsafe-content
malformed-output
```

Update `answerStudentQuestionService` to use `options.qaRunner || answerStudentQuestion`, persist the approved metadata to `QaSession.metadata`, persist `studentAnswer` to `QaSession.answer`, and store only `{ qaSessionId, available, mode }` on `VoiceInteraction.metadata`. Do not duplicate the full learning signal into `VoiceInteraction`.

- [x] **Step 4: Write API helper tests before changing routes**

Create `apps/api/src/qa-response.test.mjs` for:

```javascript
buildQaActorContext({ role: "student", studentId: "s1" }, { studentId: "s1" })
// => { actorRole: "student", identityConfirmed: true }

buildQaActorContext({ role: "teacher", teacherId: "t1" }, { studentId: "s1" })
// => { actorRole: "teacher", identityConfirmed: false }

buildQaActorContext({ role: "classroom", deviceId: "d1" }, { studentId: "s1" }, { classroomStudentConfirmed: true })
// => { actorRole: "classroom", identityConfirmed: true }
```

Also assert learner responses contain only approved fields:

```javascript
{
  available: true,
  mode: "KNOWLEDGE_EXPLANATION",
  answer: "安全回答"
}
```

Classroom voice responses may additionally contain `transcript` and `voice: { available, status, audioUrl, reason }`; they must not expose `providerId`, `model`, `raw`, `error`, `learningSignal`, `profileEligibility`, `blockedReason`, or `persisted`.

- [x] **Step 5: Run the API helper test and verify RED**

```powershell
node --test apps\api\src\qa-response.test.mjs
```

Expected: FAIL because `apps/api/src/qa-response.js` does not exist.

- [x] **Step 6: Implement API identity and response helpers**

Export these functions from `apps/api/src/qa-response.js`:

```javascript
export function buildQaActorContext(session, input, options = {}) {}
export function cleanQaResultForClient(result = {}) {}
export function cleanClassroomQaResultForClient({ qa, transcript, voice }) {}
```

Move the current `cleanQaResultForClient` behavior out of `server.js`. The helper must sanitize display text and whitelist fields; it must not recursively pass unknown properties.

- [x] **Step 7: Wire both routes using server-confirmed context**

For `/api/ai/qa`, perform existing scope checks first, then call the service with:

```javascript
const actorContext = buildQaActorContext(session, input, {
  classroomStudentConfirmed: session.role === "classroom" && Boolean(input.studentId)
});
const result = await answerStudentQuestionService(config, { ...input, ...actorContext }, options);
```

For `/api/classroom/voice-qa`, replace the broad active-student lookup with `assertClassroomStudentScope({ session: req.session }, res, input.studentId)` so a student outside the device grade/class cannot be treated as confirmed. Only set `classroomStudentConfirmed=true` after that check succeeds. Pass `qa.studentAnswer || qa.answer` to speech and use `cleanClassroomQaResultForClient` for the response.

- [x] **Step 8: Run GREEN and service/API regressions**

```powershell
node --test packages\services\src\qa-learning-record.test.mjs apps\api\src\qa-response.test.mjs
$serviceTests = Get-ChildItem packages\services\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $serviceTests
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:services
git diff --check
```

Expected: all tests pass; Q&A still returns immediately and no teacher-review state is required by either learner endpoint.

- [x] **Step 9: Commit service and API wiring**

```powershell
git add -- packages/services/src/qa-learning-record.js packages/services/src/qa-learning-record.test.mjs packages/services/src/index.js apps/api/src/qa-response.js apps/api/src/qa-response.test.mjs apps/api/src/server.js
git diff --cached --check
git commit -m "feat: enforce qa profile eligibility"
```

## Task 8: Filter And Aggregate Eligible Q&A In Student Profiles

**Files:**
- Modify: `apps/api/src/student-growth-profile.js`
- Modify: `apps/api/src/student-growth-profile.test.mjs`

- [x] **Step 1: Replace the old permissive fixture with explicit eligible and blocked records**

Add fixtures for:

- one eligible `student` Q&A on `小数意义`;
- a second eligible Q&A on the same point;
- one teacher test;
- one unconfirmed classroom question;
- one unavailable result;
- one blocked result;
- one malformed result;
- one legacy record with `{ confirmed: true }` but no schema version.

- [x] **Step 2: Write failing profile tests**

Tests must prove:

```javascript
test("only eligible qa-learning-signal-v1 records enter qaEvidence", () => {});
test("qaEvidence contains summaries and refs but not full question or answer text", () => {});
test("one eligible qa signal remains weak and cannot raise mastery or score", () => {});
test("repeated signals on the same knowledge point can become supported", () => {});
test("teacher, unconfirmed, unavailable, unsafe, malformed, and legacy qa stay out of public evidence", () => {});
test("teacher blocked evidence contains only a minimal reason summary", () => {});
test("student and parent views hide learningSignal, profileEvidencePack, and full qa text", () => {});
```

- [x] **Step 3: Run the focused test and verify RED**

```powershell
node --test apps\api\src\student-growth-profile.test.mjs
```

Expected: at least the eligibility and no-full-text assertions fail against the current permissive `qaSessions.map(...)` implementation.

- [x] **Step 4: Implement eligibility filtering and signal aggregation**

In `buildProfileEvidencePack`:

1. Parse `session.metadata` as an object.
2. Accept only `schemaVersion=qa-learning-signal-v1`, allowed actor role, confirmed identity, available result, `safetyStatus=pass`, `profileEligibility=true`, and valid learning signal.
3. Group accepted records by normalized `subject + knowledgePoint`.
4. Emit one evidence item per group with `sessionCount`, `questionIntent`, `difficultySignal`, `followUpNeeded`, `sourceRefs`, and confidence `weak` for one session or `supported` for two or more.
5. Do not copy `question`, `answer`, provider, model, raw, prompt, or debug into `qaEvidence`.
6. Put ineligible current records and legacy records into teacher-only `blockedEvidence` using only ID, type, date, and a fixed reason.

- [x] **Step 5: Prevent Q&A-only strong conclusions**

Apply these deterministic rules:

- `buildMastery` and `computeScore` do not use Q&A counts.
- `buildStableGrowth` uses `weak` for one eligible signal and `supported` only when an aggregated signal has `sessionCount >= 2`.
- `buildFocusSubjects` may mention Q&A only as “继续观察” unless grading, mistake, task, or classroom evidence supports the same subject.
- conflicts between Q&A and confirmed grading/mistake evidence add a teacher review note rather than choosing one side automatically.

- [x] **Step 6: Run GREEN and profile/API checks**

```powershell
node --test apps\api\src\student-growth-profile.test.mjs apps\api\src\student-term-report.test.mjs
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:encoding
git diff --check
```

Expected: all tests pass; teacher snapshots can inspect minimal blocked reasons, while student/parent snapshots contain neither internal evidence packs nor Q&A learning signals.

- [x] **Step 7: Commit profile aggregation**

```powershell
git add -- apps/api/src/student-growth-profile.js apps/api/src/student-growth-profile.test.mjs
git diff --cached --check
git commit -m "feat: aggregate eligible qa profile evidence"
```

## Task 9: Align Playbooks, Contracts, And Final Layered Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `SKILLS.md`
- Modify: `skills/ai-qa/SKILLS.md`
- Modify: `skills/student-profile/SKILLS.md`
- Modify: `skills/grading/SKILLS.md`
- Modify: `docs/14-api-contract.md`
- Modify: `docs/41-prompt-context-engineering-playbook.md`
- Modify: `docs/44-miniprogram-migration-runbook.md`
- Modify: `docs/superpowers/plans/2026-07-11-agent-skills-system-integration.md` - mark executed checkboxes and append evidence only during execution

- [x] **Step 1: Document the final Q&A contract**

The Playbook and API contract must state:

- at most one Terra low-reasoning text call; zero provider calls when Terra is unavailable; never Sol; when the call succeeds, that same call returns `studentAnswer + learningSignal`;
- successful safe answers return immediately without teacher pre-review;
- only server-computed eligible signals enter profile analysis;
- teacher tests, anonymous/unconfirmed classroom, unavailable, unsafe, malformed, and legacy records are excluded from public evidence;
- Q&A never triggers Sol;
- learner responses expose no learning signal or model-routing metadata;
- weekly/monthly profiles, stage reports, parent summaries, print, and PDF remain teacher-confirmed outputs.

- [x] **Step 2: Resolve stale grading wording after the Sol merge**

In `skills/grading/SKILLS.md`, make the sequence unambiguous:

```markdown
- 正常批改先完成一次 Terra 主批改/风险复判；只有已分类为可恢复 availability 或证据充分的 quality 故障时，才允许对最小失败题追加一次 Sol。这里的“一次风险复判”不包含条件式 Sol 升级，也不允许 Sol 后再串接第三个文本模型。
```

Preserve teacher per-question review, low-confidence blocking, and teacher-confirmed archive rules.

- [x] **Step 3: Run every focused automated suite**

```powershell
node --test scripts\skills-check.test.mjs scripts\miniprogram-sync-lib.test.mjs
$aiTests = Get-ChildItem packages\ai\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $aiTests
$serviceTests = Get-ChildItem packages\services\src -Filter *.test.mjs | Select-Object -ExpandProperty FullName
node --test $serviceTests
node --test apps\api\src\qa-response.test.mjs apps\api\src\student-growth-profile.test.mjs apps\api\src\student-term-report.test.mjs apps\api\src\assessment-print-export-gate.test.mjs apps\api\src\grading-review-gates.test.mjs
node --test scripts\gpt56-capability-check.test.mjs scripts\generation-quality-check.test.mjs scripts\sol-escalation-quality-check.test.mjs scripts\grading-quality-check.test.mjs
```

Expected: all suites pass with zero failures.

- [x] **Step 4: Run layered project validation**

```powershell
cmd /c npm.cmd run check:skills
cmd /c npm.cmd run check:miniprogram-sync
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:miniapp1
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:services
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
```

Expected: all commands exit `0`. If live miniprogram sync reports a real source difference, classify it separately; do not silently write it during verification.

- [x] **Step 5: Run only the cross-cutting E2E justified by this scope**

```powershell
cmd /c npm.cmd run check:content-context
```

Expected: the content-context, draft, review, and export boundary closes successfully. Do not substitute the full teaching-content E2E unless the implementation changed upload or formal export behavior beyond this plan.

- [x] **Step 6: Review repository integrity**

```powershell
git diff --check
cmd /c npm.cmd run workspace:guard
git status --short --branch
git log --oneline --decorate -12
```

Expected: no whitespace/encoding errors, no unrelated staged paths, and the planned commit sequence is visible.

- [x] **Step 7: Commit documentation and completion evidence**

```powershell
git add -- AGENTS.md SKILLS.md skills/ai-qa/SKILLS.md skills/student-profile/SKILLS.md skills/grading/SKILLS.md docs/14-api-contract.md docs/41-prompt-context-engineering-playbook.md docs/44-miniprogram-migration-runbook.md docs/superpowers/plans/2026-07-11-agent-skills-system-integration.md
git diff --cached --check
git commit -m "docs: close agent skills system integration"
```

## Execution Evidence

### Tasks 1-8

- Task 1: `14121e8` aligned root agent/Skill boundaries and project Grill routing.
- Task 2: `414a86d` is the non-fast-forward merge of `14121e8` and Sol HEAD `e52e9a6`; `git merge-base --is-ancestor e52e9a6 HEAD` exits `0`.
- Task 3: `1337a2e` closed Sol quality-budget findings. Preserved ignored logs under `tmp/task3a-sol-integration-verification/` record AI `58/58`, services `44/44`, scripts `30/30`, and API gate `7/7`, all with exit `0`; generation blueprint, API, Web typecheck, Mini Program JS, services, encoding, diff, and status checks also record exit `0`. Real capability and six-case Sol generation quality checks record exit `0`; a later first Sol quality attempt recorded exit `1` for one transient case and `02b-sol-generation-quality-retry` recorded exit `0` with overall `status=passed`. Gold data is absent, so production grading accuracy remains unverified.
- Task 4: `3747b6c` added nine repository Skill routes and `check:skills`.
- Task 5: `1baa53a` added read-only reverse-sync comparison and explicit protected writes; follow-up hardening commits `b10a646`, `26155a3`, `da09238`, `01f0daa`, `f866a73`, and source alignment `7b357cb` are present.
- Task 6: `6c4b40f` added the single-call structured Q&A contract; parser and sanitizer hardening commits through `3d92710` are present.
- Task 7: `6198568` added service/API actor, identity, eligibility, persistence, and learner-response filtering; follow-up security and normalization commits through `e4c9830` are present.
- Task 8: `42dd955` added eligible Q&A profile aggregation; follow-up validity, timeline, conflict, source-date, and evidence-priority commits `b4f58a3`, `945750c`, `354d961`, and `5fa2325` are present.

### Task 9

- Steps 1-2 documentation audit: required Q&A contract terms are present across the module Playbooks/contracts, and the exact grading sequence sentence is present in `skills/grading/SKILLS.md`, `docs/14-api-contract.md`, and `docs/41-prompt-context-engineering-playbook.md`; all focused text audits exited `0`.
- Step 3 focused suites: Skill/sync tests `74/74`, all AI tests `91/91`, all services tests `64/64`, listed API tests `58/58`, and generation/grading script tests `36/36`; total `323/323`, zero failures, every command exit `0`.
- Step 4 layered checks: `check:skills` found all nine routes; read-only `check:miniprogram-sync` reported `added=[]`, `changed=[]`, `deleted=[]`; Mini Program JS checked 28 files; `check:miniapp1` checked 103 files; generation blueprint passed all nine subject/kind cases; API check passed with database connected; service smoke passed QA/task/assessment/dictation in 62973 ms; Web typecheck exited `0`; encoding checked 527 files with zero issues. Every layered command exited `0`, and no reverse sync was written.
- Step 5 E2E: `check:content-context` exited `0`; all 16 reported checks passed, including teacher auth, protected/input-path guards, content-context injection, draft export, pre-review print block, teacher acceptance, two final PDF assets with HTTP 200, and content-index cleanup. Scope remained `link-guard`; it does not claim generation quality.
- Initial `workspace:guard` on `5fa2325` exited `1` only for the known local condition: 71 ignored Task 3 runtime-residue files and 57 approved ignored local PDF/PNG/helper assets. These files remain untouched and untracked; the branch has no upstream. Task 9 integrity evidence below must preserve this classification rather than deleting or staging the files.
- Step 6 clean integrity verification: `workspace:archive-residue` moved exactly 75 recognized runtime-residue files to `E:\UserData\86188\Documents\君航AI助教-local-archive\2026-07-12T15-18-12-run-residue`; the 57 approved local PDF/PNG/helper assets remained in place. The subsequent `workspace:guard` exited `0` with clean risk, ignored runtime residue `0`, and no staged, unstaged, or untracked paths; tracked status was clean. The Sol worktree remained present at `e52e9a6`, and `git merge-base --is-ancestor e52e9a6 HEAD` confirmed `ancestor=yes`. Task 10 remained unstarted.
- Step 7 commit: explicit staging contained exactly the nine owned documentation files; `git diff --cached --check` exited `0`; commit `59647d7` (`docs: close agent skills system integration`) succeeded.
- Final acceptance wording follow-up: commit `a8cfe8e` (`docs: align qa acceptance criteria`) aligned the exact schema, valid-date, unique-source, normalized aggregation, non-Q&A priority, and teacher conflict-note wording.

### Task 10

- Pre-removal verification showed a clean `codex/gpt56-sol-escalation` worktree, and `git merge-base --is-ancestor codex/gpt56-sol-escalation HEAD` exited `0`.
- `git worktree remove .worktrees/gpt56-sol-escalation` and `git worktree prune` exited `0`. After Git removal, only residual `node_modules/@junhang` directory links remained; inspection found no source or business files, their absolute target was inside the workspace, and that residual directory was removed. The branch was not deleted.
- Final verification showed only the integration worktree, retained branch `codex/gpt56-sol-escalation` still an ancestor of `HEAD`, no residual worktree directory, and clean Git status. `workspace:guard` exited `0` with ignored runtime residue `0` and 57 approved local assets; `git diff --check` exited `0`; `check:encoding` exited `0` after checking 275 current source files with zero issues.

### Integration Boundary Follow-up

- TDD RED on baseline `e7ccca2`: the focused profile, term-report, and Q&A response suites ran 60 tests with 55 passing and 5 expected failures covering the bounded profile lookup, raw formal-report interaction counts, inherited voice marker handling, and stale Web response types.
- GREEN after the focused fixes: the same suites passed `60/60`; all service tests passed `64/64`; `check:api`, Web typecheck, Mini Program JS, and `git diff --check` exited `0`.
- Live `check:services` exited `0` in 68109 ms with successful Q&A, task, assessment, and dictation results; assessment used no dynamic fallback. The follow-up commit SHA is intentionally recorded only by Git after commit creation.

### Final Quality Follow-up

- TDD RED on baseline `8ce7d33`: the focused profile, term-report, and Q&A response suites ran 64 tests with 60 passing and 4 expected failures covering `+08:00` period boundaries, neutral Q&A completion feedback, and the stale aggregate API contract.
- GREEN after the final fixes: the focused suites passed `64/64`; the profile suite also passed `38/38` with the process timezone forced to UTC; all service tests passed `64/64`; `check:api`, Web typecheck, Mini Program JS, and `git diff --check` exited `0`.
- Live `check:services` exited `0` in 60588 ms with successful Q&A, task, assessment, and dictation results; assessment used no dynamic fallback. The final quality-fix commit SHA is intentionally recorded only by Git after commit creation.

### Public Database Failure Follow-up

- TDD RED on baseline `5ff90f9`: the focused database-status suite ran 2 tests with 2 expected failures proving that no public payload helper existed and `requireDatabase` still exposed the raw internal status object.
- GREEN after the shared middleware fix: the focused DB/Q&A/profile/term suites passed `66/66`; all service tests passed `64/64`; `check:api`, Web typecheck, Mini Program JS, and `git diff --check` exited `0`.
- Live `check:services` exited `0` in 78512 ms with successful Q&A, task, assessment, and dictation results; assessment used no dynamic fallback. The database-failure fix commit SHA is intentionally recorded only by Git after commit creation.

## Task 10: Remove The Local Sol Worktree After Verification

**Files:**
- Remove local worktree registration and directory only.
- Keep branch `codex/gpt56-sol-escalation` through the final PR.

- [x] **Step 1: Prove the Sol worktree is clean and merged**

```powershell
git -C .worktrees/gpt56-sol-escalation status --short --branch
git merge-base --is-ancestor codex/gpt56-sol-escalation HEAD
```

Expected: Sol worktree has no local changes and ancestry exits `0`.

- [x] **Step 2: Remove only the verified local worktree**

```powershell
git worktree remove .worktrees/gpt56-sol-escalation
git worktree prune
```

Expected: the local worktree directory and registration are removed. Do not delete the branch.

- [x] **Step 3: Final state check**

```powershell
git worktree list --porcelain
git branch --list codex/gpt56-sol-escalation
git status --short --branch
cmd /c npm.cmd run workspace:guard
```

Expected: only intended worktrees remain, Sol branch still exists, and the integration worktree is clean.

## Final Acceptance Criteria

1. [x] `e52e9a6` is an ancestor of the integration branch through a non-fast-forward merge.
2. [x] Sol generation/grading tests, capability probe, and explicit generation quality gate pass; production grading accuracy is not claimed without teacher-confirmed gold data.
3. [x] Nine `.agents/skills` routes are discoverable, point to existing project Playbooks, and pass `check:skills`.
4. [x] No active project route contains `ai-video-production`; ordinary media assets and user-level video Skills remain untouched.
5. [x] `check:miniprogram-sync` is read-only; reverse writes are explicit, path-contained, config-excluding, and refused when `apps/miniprogram` is dirty.
6. [x] Student Q&A makes at most one Terra low-reasoning text call, makes zero provider calls when Terra is unavailable, never calls Sol, and returns a successful safe structured answer immediately without teacher pre-review.
7. [x] Only records with exact `schemaVersion=qa-learning-signal-v1`, a server-validated and normalized model `safetyStatus`, server-computed actor, identity confirmation, availability, structural validity, and `profileEligibility`, plus a valid source date, enter profile analysis.
8. [x] Teacher tests, anonymous/unconfirmed classroom, unavailable, unsafe, malformed, invalid-date, and legacy Q&A cannot enter public profile evidence.
9. [x] One unique-source Q&A cannot raise mastery, score, or form a strong conclusion. Repeated signals for the same normalized `subject + knowledgePoint` may become `supported` but remain auxiliary; confirmed non-Q&A evidence has priority, conflicts create teacher review notes, and formal outputs still require teacher confirmation.
10. [x] Student, parent, classroom, and public-screen responses expose no provider, model, internal prompt, raw output, learning signal, eligibility, blocked reason, or escalation metadata.
11. [x] All focused tests, layered checks, encoding check, diff check, and workspace guard passed before the Sol worktree was removed.
12. [x] The verified local Sol worktree registration and directory are removed; branch `codex/gpt56-sol-escalation` is retained and remains an ancestor of the integration branch.
