# 生成与批改日常工作台 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` in the current checkout, task by task. Use subagents or a separate worktree only when explicitly authorized. Steps use checkbox syntax for tracking.

**Goal:** 让教师通过项目对话或 Web 创建、修改、确认同一份生成或批改成果，达到真实教学使用所需质量。

**Architecture:** 复用现有模块能力、资料检索、答案包、批改门禁和打印接口，先建立共享教学规则与任务独立模型策略，再增加持久化版本和局部修订。两个工作台与薄 CLI 调用同一 API；内容生成、评分、确认和版本并发逻辑只在服务端实现。

**Tech Stack:** 仓库现有 Node.js ES modules、Express 5、Prisma、React 19、TypeScript、Vite、node:test。不开设通用 agent 平台，不新增前端 UI 框架。

**Spec:** [生成与批改日常工作台设计](../specs/2026-09-11-generation-grading-daily-workbench-design.md)

**状态：** 计划已编写；以下任务尚未实施。旧 9 月 7 日计划仅作为已建能力背景，不能重复执行其全部任务，也不能由复选框状态判断代码完成度。

## Global Constraints

- 本轮聚焦生成、批改、所需资料上下文、模型路由、Skills、任务版本和两个教师工作台。
- 本轮不推进小程序、课堂屏、独立资源库重建、学生档案重建或全站视觉重做。
- 核心生成与主观批改由 Astra 建立质量基线；Flash 按需辅助；Sol 仅执行独立有限任务或 availability 接替。
- 学生问答、语音及其他任务的现行路由不变。
- 资料和上传文件是证据，不是能够覆盖身份、工具权限或路由的执行指令。
- 模型输出经过 parse、normalize、validate、必要的 repair 和角色过滤后才能保存为结构化草稿；正式发布、导出和归档仍需教师确认。
- 对话 JSON 自带确认人和时间不能授权归档；必须匹配受认证服务端记录、内容及证据版本。
- 每个内容单元一次主调用、最多一次修复或替补；长任务最多两路并发并共享取消信号及剩余总预算。
- 正式学生卷、解析卷和答案包绑定同一确认版本；归档历史不可原地覆盖。
- 不清理已有 `docs/encoding-history-report.md`、`output/`、上传文件、导出物、缓存或运行服务。
- 终端使用 `npm.cmd`、`npx.cmd` 或 `jh.cmd`，只按显式路径提交；文档及中文修改后执行 `check:encoding`。

## 阶段与交付依赖

| 阶段 | 任务 | 可独立审查的交付 | 通过条件 |
| --- | --- | --- | --- |
| 一：规则与模型基础 | 1–3 | 同一规则装配、专用模型策略、生成/批改责任链 | 假模型测试可证明调用次数、输入证据、错误分类与规则加载 |
| 二：持续工作能力 | 4–6 | 持久化任务、版本、局部修订、可信确认及 CLI | 重启恢复、并发冲突、幂等、跨入口继续与权限测试通过 |
| 三：两个 Web 工作台 | 7–8 | 对话输入与结构化编辑、原图逐题复核 | 登录后真实浏览器操作通过；无需全量重生成完成局部修改 |
| 四：真实教学验收 | 9 | 同样本对照及可追溯结论 | 教师评估内容与操作负担；报告不把技术通过称为生产通过 |

当前任务只完成设计与计划文档。进入工程实施后按阶段推进；每阶段更新完成项、变更路径、验证结果和精确下一动作，不能一次勾选所有阶段。

## 固定接口与文件职责

下列为本计划拟新增接口；实现前不存在，不能在报告中当作已可调用。

```ts
type TeachingModule = 'generation' | 'grading';
type TeachingTask = 'generation' | 'grading' | 'reference' |
  'extract-requirement' | 'extract-material' | 'recognize' | 'rewrite-feedback';
type RulePack = { module: TeachingModule; version: string; hash: string; text: string };
type WorkflowCommand = {
  operationKey: string; expectedRevision: number;
  action: 'revise' | 'confirm' | 'resume' | 'cancel' | 'restore';
  targetQuestionIds?: string[]; targetDayIds?: string[];
  instruction?: string; patch?: Record<string, unknown>; restoreRevision?: number;
};
type WorkflowView = {
  id: string; module: TeachingModule; revision: number; status: string;
  request: Record<string, unknown>; content: Record<string, unknown>;
  issues: Array<{ code: string; questionId?: string; message: string }>;
};
```

- `packages/ai/src/teaching-rules.js`：`loadTeachingRulePack(module, { root } = {}) -> Promise<RulePack>`；root 仅用于服务端配置或测试，不能来自 HTTP。
- `packages/ai/src/model-policy.js`：新增 `resolveTeachingTaskPolicy(task, config)`；不改变旧问答调用的 `resolveTaskModelPolicy`。
- `packages/ai/src/teaching-model-runner.js`：`runTeachingUnit({ task, input, rulePack, budget, signal }, { call, repairIssues })`；返回规范化候选及内部 attempts，不写正式资产。
- `packages/core/src/teaching-workflow.js`：版本合并、影响范围及确认继承的纯函数。
- `packages/db/src/teaching-workflow-repository.js`：`createTeachingWorkflowRepository(prisma)`，暴露 `create`、`get`、`getRevision`、`commitRevision`、`saveCheckpoint`、`markInterrupted`。
- `packages/services/src/teaching-workflow-service.js`：`createTeachingWorkflowService({ repository, runners, authorize })`，暴露 `create(actor,input)`、`get(actor,id)`、`execute(actor,id,command)`。
- `apps/api/src/teaching-workflow-routes.js`：`createTeachingWorkflowRouter({ service, requireTeacher })`。
- `scripts/teaching-workflow-client.mjs`：`createTeachingWorkflowClient({ baseUrl, session, fetchImpl })`，暴露 `create(input)`、`get(id)`、`execute(id,command)`。
- `scripts/teaching-workflow.mjs`：CLI 参数解析与本地会话读取，不包含第二套 prompt 或数据库写入。

## 阶段一：规则与模型基础

### Task 1：可加载的教学规则与 Skills 同源

**Files:**
- Create: `skills/generation/references/runtime-rules.md`、`skills/grading/references/runtime-rules.md`
- Create: `packages/ai/src/teaching-rules.js`、`packages/ai/src/teaching-rules.test.mjs`
- Modify: 两模块 `SKILLS.md`、两模块 `.agents/skills/.../SKILL.md`、`SKILLS.md`
- Modify: `scripts/skills-check-lib.mjs`、`scripts/skills-check.test.mjs`、`docs/41-prompt-context-engineering-playbook.md`

**Interfaces:** 产出 RulePack，供 Task 3 使用；规则以 UTF-8 固定白名单路径读取，SHA-256 标识实际内容。

- [ ] 写规则加载失败测试：未知 module、路径穿越、缺文件、空正文不能返回旧规则。
- [ ] 写临时测试目录用例证明“修改正文会改变实际加载内容与 hash”，不是仅测试文档存在：

```js
const first = await loadTeachingRulePack('generation', { root: fixtureRoot });
await writeFile(ruleFile, '# generation-v1\n专项练习只生成指定题型。\n', 'utf8');
const next = await loadTeachingRulePack('generation', { root: fixtureRoot });
assert.notEqual(next.hash, first.hash);
assert.match(next.text, /专项练习/);
await assert.rejects(loadTeachingRulePack('../grading', { root: fixtureRoot }));
```

- [ ] 运行 `node --test packages/ai/src/teaching-rules.test.mjs`，确认先因入口缺失或行为缺失失败。
- [ ] 实现仅 generation/grading 的路径映射与 hash；明确重载策略，不让永久缓存导致修改文档后运行时不更新。
- [ ] 把教学细则写入两个 references：专项/综合/多日/讲解分流、合理异解、证据不足、逐题得分和确认边界；把调用流程留在 Playbook，删除重复矛盾说明。
- [ ] 更新 Skills 校验：引用目标必须存在；规则不能为空；模型调用预算只引用权威策略，不在多个 Playbook 重复硬编码。
- [ ] 验证 `node --test packages/ai/src/teaching-rules.test.mjs scripts/skills-check.test.mjs`、`cmd /c npm.cmd run check:skills`、`cmd /c npm.cmd run check:encoding`。
- [ ] 显式 stage 本任务文件，提交 `feat: share generation and grading teaching rules`。

### Task 2：任务独立模型策略与有界调用

**Files:**
- Modify: `packages/ai/src/model-policy.js`、`packages/ai/src/model-policy.test.mjs`
- Create: `packages/ai/src/teaching-model-runner.js`、`packages/ai/src/teaching-model-runner.test.mjs`
- Modify: `packages/ai/src/runtime.js`、`packages/ai/src/index.js`、`packages/ai/src/index.d.ts`、`.env.example`
- Modify: `packages/core/src/module-capability-registry.js`、对应测试及 `packages/services/src/module-capability-status.js`

**Interfaces:** `resolveTeachingTaskPolicy` 返回 `{primary:{providerId,model,reasoningEffort}, replacement, maxAdditionalAttempts:1}`。generation/grading/reference 主路由使用 Astra；extract/recognize 使用 Flash；rewrite-feedback 使用 Sol。只有 Astra 内容任务有 Sol availability 替补。

新增配置键为 `TEACHING_PRIMARY_MODEL`（默认 `gpt-6-astra`）、`TEACHING_REPLACEMENT_MODEL`（默认 `gpt-5.6-sol`）、`TEACHING_ASSIST_MODEL`（默认 `deepseek-flash`）。适配器沿用现有受保护的供应商凭据与地址配置；发现端点不支持时报告配置错误，不能修改全局 `GPT56_MODEL` 把学生问答一起切换。

- [ ] 增加路由隔离测试：

```js
assert.equal(resolveTeachingTaskPolicy('generation', {}).primary.model, 'gpt-6-astra');
assert.equal(resolveTeachingTaskPolicy('grading', {}).primary.reasoningEffort, 'high');
assert.equal(resolveTeachingTaskPolicy('extract-material', {}).primary.model, 'deepseek-flash');
assert.equal(resolveTaskModelPolicy('qa', {}).primary.model, 'gpt-5.6-terra');
assert.equal(resolveTaskModelPolicy('qa', {}).escalation.enabled, false);
```

- [ ] 使用注入的 `call` 和假时钟测试调用序列：正常 `[Astra]`；503 `[Astra,Sol]`；401/OCR缺证 `[Astra]` 或预检零调用；质量问题 `[Astra,Astra修复]`；追加失败不出现第三次调用。
- [ ] 运行 `node --test packages/ai/src/model-policy.test.mjs packages/ai/src/teaching-model-runner.test.mjs` 确认新增用例失败。
- [ ] 按统一预算实现调用：

```js
const remaining = budget.deadlineAt - now();
if (signal.aborted || remaining <= 0) return interruptedOrFailed();
const primary = await call(policy.primary, input, { timeoutMs: remaining, signal });
// classify primary; evidence/configuration stop; availability may replace;
// quality may repair with primary; both spend one shared additional-attempt slot.
```

`now` 为 runner 注入的时钟函数；`interruptedOrFailed` 是 runner 内部构造规范化失败结果的辅助函数，不调用模型。预算包含 deadlineAt、remainingTokens、additionalAttemptsUsed；有供应商 usage 才记录实际费用，未知费率保持 unknown。

- [ ] 输出按 role 过滤；attempts、模型名和错误原文只保留内部，不添加到学生/家长或普通工作台响应。
- [ ] 验证本任务测试及既有 `packages/ai/src/gpt56-runtime.test.mjs`、`packages/ai/src/qa-learning-signal.test.mjs`；编码检查后按本任务路径提交 `feat: route teaching tasks with bounded model calls`。

### Task 3：生成分流与批改证据链

**Files:**
- Modify: `packages/ai/src/assessment-partitions.js`、`packages/ai/src/assessment-partitions.test.mjs`
- Modify: `packages/ai/src/runtime.js`、`packages/ai/src/runtime-prompt.test.mjs`
- Modify: `packages/services/src/context-engineering.js`、`packages/services/src/context-engineering.test.mjs`、`packages/services/src/index.js`
- Create: `packages/services/src/teaching-pipeline.test.mjs`
- Modify: `packages/ai/src/ocr-node.js`、对应 OCR 测试；`apps/api/src/external-grading-recognition.js`

**Interfaces:** 新增业务字段 purpose、dayPlan、requestedItemTypes，服务端归一化后进入 generationContext；返回草稿继续兼容现有答案包。新 runner 接入现有 `draftAssessmentService`、`gradeSubmissionService`，保留可注入假 runner。

- [ ] 写失败用例：数学 focused/calculation 不产生选择题；英语字母专项不强制阅读；缺省 purpose 保持综合蓝图；multi_day 各日分区有稳定 dayId；同一阅读材料不拆到无上下文的小题调用。
- [ ] 写模型输入捕获测试：真实 rulePack.text 和 hash 被使用；原始教师要求与有出处资料片段仍在；Flash 摘要不能覆盖原话；客户端不能注入 rulePack 或预算。
- [ ] 写批改用例：题干不能补学生答案；仅未解决题组进入内容模型；主观题有 score/maxScore；uncertain 为 null；错误顶层总分不会覆盖逐题合计。
- [ ] 运行 `node --test packages/services/src/teaching-pipeline.test.mjs packages/ai/src/assessment-partitions.test.mjs packages/ai/src/runtime-prompt.test.mjs`，确认新需求有失败证据。
- [ ] 实现分流：

```js
const purpose = normalized.purpose || 'comprehensive';
// focused: use validated requestedItemTypes and scope;
// multi_day: one shared plan, bounded day/group units;
// explanation: structured explanation and worked examples;
// comprehensive: keep existing kind/subject blueprint.
```

- [ ] 增加 Flash 识别适配器输出到既有 OCR 契约，保留 page、bbox、原图及裁剪引用；受配置选择，不在本任务自动替换现有真实 OCR 默认路线。
- [ ] 对 figure、sourcePackage、分值和资料审批继续运行既有校验；不通过时保留可修正草稿。
- [ ] 验证本任务测试、`node --test packages/services/src/deterministic-grading.test.mjs packages/services/src/grading-audit-gates.test.mjs`、`cmd /c npm.cmd run check:generation:blueprint`、`cmd /c npm.cmd run check:encoding`。涉及真实上下文变更时追加 `check:content-context`，不以其结果代替内容质量。
- [ ] 按范围提交 `feat: align teaching generation and grading pipelines`；记录阶段一结果及下一项 Task 4。

## 阶段二：持续工作能力

### Task 4：持久化版本、并发与检查点

**Files:**
- Create: `packages/core/src/teaching-workflow.js`、`packages/core/src/teaching-workflow.test.mjs`
- Modify: `packages/core/src/index.js`、`packages/core/src/index.d.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202609110001_teaching_workflows/migration.sql`
- Create: `packages/db/src/teaching-workflow-repository.js`、`packages/db/src/teaching-workflow-repository.test.mjs`
- Modify: `packages/db/src/index.js`、`packages/db/src/index.d.ts`
- Modify: `apps/api/src/assessment-generation-jobs.js`、`apps/api/src/assessment-generation-jobs.test.mjs`

**Interfaces:** 仓库方法 `commitRevision({workflowId,ownerTeacherId,expectedRevision,operationKey,operation,snapshot})` 在事务中更新头版本并追加不可变快照；`saveCheckpoint` 必须校验当前执行 operationKey，拒绝取消或旧执行的迟到结果。

- [ ] 写影响范围测试；纯函数 `applyWorkflowPatch(snapshot, patch)` 返回 `{snapshot, affectedQuestionIds}`。初版支持 replace_question、replace_shared_material、replace_day 三种显式 patch，不解释任意脚本：

```js
const before = { questions: [
  { id: 'q1', dayId: 'd1', prompt: '2+3', answer: '5' },
  { id: 'q2', dayId: 'd2', prompt: '4+6', answer: '10' }
] };
const result = applyWorkflowPatch(before, {
  type: 'replace_question', questionId: 'q2',
  value: { id: 'q2', dayId: 'd2', prompt: '14+6', answer: '20' }
});
assert.deepEqual(result.snapshot.questions[0], before.questions[0]);
assert.deepEqual(result.affectedQuestionIds, ['q2']);
```

- [ ] 仓库测试两个并发 expectedRevision=1 的写入只有一个成功；重复 operationKey 返回同一版本；相同 key 不同请求拒绝；跨教师不可读写；保存旧版本后恢复形成新版本。
- [ ] 运行 `node --test packages/core/src/teaching-workflow.test.mjs packages/db/src/teaching-workflow-repository.test.mjs`。
- [ ] 按设计新增两个表及唯一索引，使用 Prisma 事务 `updateMany` 对 expectedRevision 做 CAS；失败 count=0 返回冲突并回滚，禁止“先读后无条件写”。不删除或清空已有 Assignment/Submission。
- [ ] 持久化已校验单元到 checkpoint；重启把 running 转 interrupted，不自动调用模型。保留现有队列作为单 worker 调度器，不再作为成果唯一存储。
- [ ] 使用隔离测试数据库执行迁移与事务测试；命令使用项目现有 Prisma 入口。真实数据库先评审迁移 SQL 和备份策略，禁止 reset 或覆盖数据。记录迁移实际结果与数据库环境，mock 不能代替事务验证。
- [ ] 编码检查，按本任务路径提交 `feat: persist teaching workflow revisions and checkpoints`。

### Task 5：局部修订、确认复用与归档版本

**Files:**
- Create: `packages/services/src/teaching-workflow-service.js`、`packages/services/src/teaching-workflow-service.test.mjs`
- Modify: `packages/services/src/index.js`、`packages/services/src/index.d.ts`
- Modify: `packages/core/src/dialogue-grading-import.js`、对应测试
- Modify: `apps/api/src/grading-review-gates.js`、`apps/api/src/grading-mistake-archive.js`、对应测试
- Modify: `packages/core/src/grading-source-package.js`、对应测试

**Interfaces:** service.execute 的 WorkflowCommand 与计划开头一致；actor 来自服务端会话。纯函数 `inheritQuestionConfirmations(previous,next,affectedQuestionIds)` 只继承内容、证据和 rubric 指纹均相同的服务端凭据，输出新 snapshot。

- [ ] 测试局部修订只发送目标与必要上下文、未经授权的额外修改被拒绝、修改题目同步更新答案解析、共享阅读修改影响所有相关题。
- [ ] 测试已确认 q1 不因 q2 修改失效；修改参考答案使相关确认失效；伪造 imported.confirmedBy 无法归档；匹配原归档版本且权限有效的确认可以复用。
- [ ] 测试归档幂等及修订替代关系：新归档不能覆盖旧快照，错题/档案聚合不能同时计算被替代版和新版。
- [ ] 运行 `node --test packages/services/src/teaching-workflow-service.test.mjs packages/core/src/dialogue-grading-import.test.mjs`，记录失败用例。
- [ ] 按以下顺序实现 service.execute：

```js
await authorize(actor, workflow);
// deduplicate operationKey; check expectedRevision;
// resolve target IDs and dependent material; validate source versions;
// call runner only for semantic change, preserve validated unaffected content;
// normalize and validate candidate; recompute fingerprints/confirmation inheritance;
// commitRevision atomically; on conflict preserve old head and report 409.
```

- [ ] confirm 不调用模型；resume 只消费 checkpoint 未完成单元；restore 读取旧快照并创建新版本；cancel 使旧 operation 不能提交后续结果。
- [ ] 运行本任务测试及 `apps/api/src/grading-review-gates.test.mjs`、`apps/api/src/grading-mistake-archive.test.mjs`、`packages/core/src/grading-source-package.test.mjs`，再执行编码检查并提交 `feat: revise and confirm teaching results by version`。

### Task 6：同一 API 与 Codex CLI 入口

**Files:**
- Create: `apps/api/src/teaching-workflow-routes.js`、`apps/api/src/teaching-workflow-routes.test.mjs`
- Modify: `apps/api/src/server.js`、`docs/14-api-contract.md`
- Create: `scripts/teaching-workflow-client.mjs`、`scripts/teaching-workflow.mjs`、`scripts/teaching-workflow-client.test.mjs`
- Modify: `.agents/skills/generation/SKILL.md`、`.agents/skills/grading/SKILL.md` 及两个模块 Playbook

**Interfaces:** 以下路由为新增，旧 generation/grading 路由作为兼容入口转入同一 service：

```text
POST /api/teaching/workflows                         create
GET  /api/teaching/workflows/:id                     get current view
GET  /api/teaching/workflows/:id/revisions/:revision  get historical view
POST /api/teaching/workflows/:id/commands            execute WorkflowCommand
```

CLI 命令：`node scripts/teaching-workflow.mjs create --input <json>`、`get --id <id>`、`command --id <id> --input <json>`。API base URL 由本地配置提供；会话从 `TEACHING_SESSION_FILE` 指向的用户私有本地 JSON 文件读取，文件不纳入 Git，不创建新绕过登录机制。

- [ ] 写路由权限、字段白名单、409 版本冲突和幂等请求测试；HTTP 传 model/provider/prompt/ownerTeacherId 不得影响实际调用与归属。
- [ ] 用同一个 fake HTTP server 测试 CLI client 与 Web 形状一致：create → get → execute → get revision；会话不出现在响应、错误或日志中。
- [ ] 运行 `node --test apps/api/src/teaching-workflow-routes.test.mjs scripts/teaching-workflow-client.test.mjs`。
- [ ] Router 验证 teacher session，调用 service.create/get/execute；只输出 WorkflowView。错误映射为 400/401/403/404/409 和可恢复任务状态，不向浏览器透传供应商错误。
- [ ] CLI 通过 client 请求同一 API，输入 JSON 文件不是脚本，绝不直接写 DB。没有登录会话时给出登录要求，不读取或暴露其他应用凭据。
- [ ] 更新 Skills：明确创建、继续、指定修订、教师确认的命令；说明在对话中发现的新资料应登记到任务上下文，不能只写在聊天里。
- [ ] 验证本任务测试、`cmd /c npm.cmd run check:api`、`cmd /c npm.cmd run check:skills`、`cmd /c npm.cmd run check:encoding`；提交 `feat: expose shared teaching workflow API and CLI`。

## 阶段三：两个 Web 工作台

### Task 7：生成工作台

**Files:**
- Create: `apps/web/src/components/GenerationWorkbench.tsx`
- Modify: `apps/web/src/api.ts`、`apps/web/src/main.tsx`、`apps/web/src/styles.css`
- Modify: `scripts/web-generation-workbench-ui.test.mjs`

**Interfaces:** api.ts 增加与 Task 6 相同的 create/get/execute 包装；组件接收 WorkflowView 与操作回调，模型策略与 prompt 不进入组件。

- [ ] 先记录当前登录后路径与“局部修改会创建整项新任务”的现象；避免以静态源码字符串断言证明真实可用。
- [ ] 实现组件三部分：任务要求/条件、题目与解析成果、局部对话与版本；继续使用现有样式和基础控件。
- [ ] 局部动作提交明确 IDs 与 expectedRevision：

```ts
await executeTeachingWorkflow(view.id, {
  operationKey: crypto.randomUUID(), expectedRevision: view.revision,
  action: 'revise', targetQuestionIds: [selectedQuestionId], instruction: feedback
});
```

`executeTeachingWorkflow(id, command)` 在 api.ts 定义为 POST Task 6 commands 路由并返回 WorkflowView。一次用户操作的重试必须复用同一个 operationKey，不能在每次 fetch 重试时重新生成。

- [ ] 输入完整时直接执行，明确冲突才提问；保存未提交编辑，版本冲突保留本地文本并提示刷新比较。
- [ ] 内容 ready 后先展示编辑区，再独立请求预览；继续复用学生卷/解析卷导出门禁。
- [ ] 浏览器验证：自然语言创建纯计算专项；只改一题且其他题不变；刷新保留成果；CLI 修改后 Web 能获取新版本；旧版保存返回冲突；取消和继续有可理解状态；学生预览无答案。
- [ ] 窄屏采用区域切换，保持当前题目选择，不要求三列强行挤在一屏。
- [ ] 运行 `npm.cmd run typecheck --workspace apps/web`、`node --test scripts/web-generation-workbench-ui.test.mjs`、编码检查；记录浏览器实际结果后提交 `feat: add editable generation workbench`。

### Task 8：批改工作台

**Files:**
- Create: `apps/web/src/components/GradingWorkbench.tsx`
- Modify: `apps/web/src/api.ts`、`apps/web/src/main.tsx`、`apps/web/src/styles.css`
- Modify: `scripts/web-grading-workbench-ui.test.mjs`

**Interfaces:** 复用 Task 6 commands；直接编辑识别或评分产生 revise patch；选定已检查题目以 confirm 指定 targetQuestionIds，不由浏览器传 confirmedBy。

- [ ] 保留既有批次筛选、上传、来源登记、原图查看与逐题复核入口；提取相关组件，不重写其他模块。
- [ ] 增加原图区域定位、识别文本/答案/评分点并列、疑点优先切换、当前题对话重判；核对坐标以对应图片为准，不能混用不同裁剪空间。
- [ ] 直接修正识别使用如下 command 结构，服务层决定是否需要重判：

```ts
await executeTeachingWorkflow(view.id, {
  operationKey, expectedRevision: view.revision, action: 'revise',
  targetQuestionIds: [question.id],
  patch: { studentAnswer: correctedAnswer }
});
```

- [ ] 确认操作只作用于明确选中且已检查的题；服务端继续拒绝无法评分或缺失证据的确认，不增加前端一键放行逻辑。
- [ ] 浏览器验证：上传清晰作业 → 定位题目 → 修正一处识别 → 只重批该题 → 查看逐题合计 → 确认归档；再验证模糊题不自动判零、合理异解说明、可信对话确认复用和伪造 JSON 确认拒绝。
- [ ] 运行 `npm.cmd run typecheck --workspace apps/web`、`node --test scripts/web-grading-workbench-ui.test.mjs`、编码检查；记录浏览器证据后提交 `feat: add evidence based grading workbench`。

## 阶段四：真实教学验收

### Task 9：可追溯质量与跨入口验证

**Files:**
- Modify: `scripts/generation-quality-check.mjs`、`scripts/generation-quality-check.test.mjs`
- Modify: `scripts/replay-grading-gold.mjs`、`scripts/grading-quality-check.mjs` 及对应测试
- Create: `scripts/teaching-workflow-acceptance.mjs`、`scripts/teaching-workflow-acceptance.test.mjs`
- Create: `docs/teaching-workflow-acceptance.md`（实际执行后写入结果，不预填通过）

**Interfaces:** 评测使用现有教师 gold 契约；增加只含合成数据的 CLI/Web 一致性场景。真实报告输出到 `tmp/quality/`，只把脱敏结论与命令写入 docs。

- [ ] 先测试评测器会拒绝这些假成功：模型 unavailable、动态兜底、实际结果缺失、没有教师标签、缺少独立执行来源记录、端到端图片任务只跑了文本而声称 OCR 通过。模型输入构造测试必须证明 expected/teacherReview 标签没有进入待评估请求；actual 来自 runner，禁止采集器直接复制 expected。正确结果可以与标准答案相同，不能仅因文本相同就判为标签泄漏。
- [ ] 将相同源任务分别经 CLI 与 Web/API 运行，比较规则哈希、规范化上下文、内容修订、评分汇总和确认版本；独立生成不要求题目逐字相同。
- [ ] 合成能力探针先验证 Astra、Sol、Flash 的文本/JSON/图像输入、响应提取、usage 与超时；网关不支持时明确记录，不能声称本计划模型链已生效。
- [ ] 使用同一原图分别比较现有 OCR 与 Flash；记录题号对齐、手写识别、过程保留及裁剪效果。在真实样本证据具备前保持原默认识别路线。
- [ ] 复用已确认 gold 的独立评估副本，运行现有入口：

```powershell
cmd /c npm.cmd run replay:grading:gold -- --gold tmp/quality/grading-gold-cases-20260909.json --output tmp/quality/grading-workbench-astra-evaluation.json --model gpt-6-astra
cmd /c npm.cmd run check:grading:quality -- tmp/quality/grading-workbench-astra-evaluation.json
```

上述源路径来自既有样本位置，执行前验证存在、确认记录与本次输入范围。真实费用调用只在实施已授权范围及已明确预算内执行。回放保持 `persist:false`，不得写正式档案，也不能把文本回放等同于完整图片测试。

- [ ] 生成使用真实教学要求覆盖 focused、multi_day、comprehensive、explanation；分别检查题目/答案/解析和打印，不能只依赖旧综合蓝图质量脚本。
- [ ] 记录每项教师修改题数、评分修改、要求遗漏、完成时间、模型调用次数、tokens/费用（未知保持 unknown）及最终是否可用于教学。调试用例与留出样本分开。
- [ ] PDF 检查学生卷无答案、解析完整、页数和作答空间；运行 `check:generation:layout` 并实际渲染抽查。生成输出变化后按范围运行历史编码检查，保护其已有报告改动。
- [ ] 大链路完成后执行 `check:api`、`check:content-context`、Web typecheck 和相关聚焦测试；只有发布前或确需全链路才执行 `check:teaching-content:full`。
- [ ] 填写验收报告：工程结果、真实质量、样本覆盖、教师评价、局限和下一动作。未经用户确定的时长/成本/修改量阈值不得擅自标为达标。
- [ ] 按明确路径提交脚本与脱敏报告，真实素材/会话/导出物留本地；计划各项只有获得相应证据后才勾选。

## 执行与恢复说明

- 默认在当前任务顺序实施，不新建 Codex 任务、不自动创建 worktree、不自动启动其他 agent。
- 每阶段完成后记录提交与通过的命令，保留真实失败，不通过时先定位原因，不增加无关重构。
- 暂停恢复时先检查 Git 和本计划进度，只读取下一任务依赖，不重复运行已通过的大型验收。
- 模型路由回退仅回退本轮教学策略；新版本数据保持可读，不删除历史快照来“回滚”。
- 本文编写时所有工程任务保持未勾选。下一工程任务为 Task 1。
