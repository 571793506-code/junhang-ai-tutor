# 七年级人教版数学第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏小学流程的前提下，增加七年级人教版数学的生成、教材上下文和外部批改边界。

**Architecture:** 以 `@junhang/core` 的共享年级规范化为单一入口，服务层按 `stage=middle` 分流教材匹配、数学蓝图和批改提示，Web/小程序只复用同一显示选项。未知年级拒绝处理，生成和批改继续经过结构化校验与教师复核。

**Tech Stack:** Node.js ESM、Node test runner、Prisma metadata、React/TypeScript Web、小程序原生 JS。

**Spec:** `docs/superpowers/specs/2026-08-30-middle-school-math-grade7-design.md`

## Global Constraints

- 第一阶段只覆盖七年级人教版数学、练习/小测和外部材料批改。
- 模型输出必须经过 parse、normalize、validate、repair 和教师复核。
- Web 只做联调入口，核心逻辑必须在共享包、API 或服务层。
- 未知年级不得回退到六年级；教材证据不足时失败关闭。
- 不自动归档低置信批改，不扩展八九年级或重写 PDF 主流程。

---

### Task 1: 共享年级规范化

**Files:**
- Create: `packages/core/src/grade-level.js`
- Test: `packages/core/src/grade-level.test.mjs`
- Modify: `packages/core/src/index.js`
- Modify: `packages/core/src/index.d.ts`

- [ ] 写测试：覆盖七年级别名、六年级小学阶段、未知年级返回 null。
- [ ] 运行 `node --test packages/core/src/grade-level.test.mjs`，确认新增导入失败。
- [ ] 实现 `normalizeGradeLevel(value)` 和 `gradeLevelLabel(value)`，返回 `{level, stage, label}` 或 `null`。
- [ ] 重新运行测试并确认通过。

### Task 2: 服务层年级与七年级数学蓝图

**Files:**
- Modify: `packages/services/src/index.js`
- Test: `packages/services/src/assessment-draft-review.test.mjs`

- [ ] 写测试：七年级数学蓝图使用初中知识主题，且七年级不回退小学六年级；未知年级的教材绑定请求返回明确错误。
- [ ] 运行对应 Node 测试确认失败。
- [ ] 接入共享年级规范化，扩展内容年级匹配到七年级，并在生成前拒绝未知年级。
- [ ] 增加七年级数学练习/小测蓝图和最小兜底题池，保留现有题型结构但使用有理数、整式、方程和初中几何内容。
- [ ] 重新运行服务测试和 `cmd /c npm.cmd run check:generation:blueprint`。

### Task 3: AI 生成与批改提示边界

**Files:**
- Modify: `packages/ai/src/runtime.js`
- Test: `packages/services/src/assessment-draft-review.test.mjs`

- [ ] 写测试：七年级请求的生成输入包含初中数学角色和规则，外部数学批改输入要求步骤/公式/几何低置信复核。
- [ ] 运行测试确认失败。
- [ ] 按年级生成初中数学提示，不改动小学提示；批改提示按学段分流并保留原有教师复核门禁。
- [ ] 运行测试、`cmd /c npm.cmd run check:api` 和 `cmd /c npm.cmd run check:encoding`。

### Task 4: Web 与小程序年级入口

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/miniprogram/pages/teacher/students/index.js`
- Modify: `apps/miniprogram/pages/teacher/content/index.js`

- [ ] 写最小静态契约测试，确认两端包含七年级且不改变已有小学选项。
- [ ] 运行测试确认失败。
- [ ] 把两端年级选项扩展为七年级，并让初始选择在已有学生年级不匹配时保持有效值。
- [ ] 运行 `npm.cmd run typecheck --workspace apps/web`、`cmd /c npm.cmd run check:miniprogram-js` 和 `cmd /c npm.cmd run check:encoding`。

### Task 5: 收口验证

**Files:**
- No new production files.

- [ ] 运行 `cmd /c npm.cmd run check:api`。
- [ ] 运行 `cmd /c npm.cmd run check:generation:blueprint`。
- [ ] 运行 `cmd /c npm.cmd run typecheck --workspace apps/web`。
- [ ] 运行 `cmd /c npm.cmd run check:miniprogram-js`。
- [ ] 运行 `cmd /c npm.cmd run check:encoding`。
- [ ] 用 `git diff --name-status` 核对只包含本阶段文件，保留用户已有 dirty 文件。
