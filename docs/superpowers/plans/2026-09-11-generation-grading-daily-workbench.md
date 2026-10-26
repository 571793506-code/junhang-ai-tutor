# 生成与批改日常工作台 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` in the current checkout, task by task. Use subagents or a separate worktree only when explicitly authorized. Steps use checkbox syntax for tracking.

**Goal:** 让教师通过项目对话或 Web 创建、修改、确认同一份生成或批改成果，达到真实教学使用所需质量。

**Architecture:** 复用现有模块能力、资料检索、答案包、批改门禁和打印接口，先建立共享教学规则与任务独立模型策略，再增加持久化版本和局部修订。两个工作台与薄 CLI 调用同一 API；内容生成、评分、确认和版本并发逻辑只在服务端实现。

**Tech Stack:** 仓库现有 Node.js ES modules、Express 5、Prisma、React 19、TypeScript、Vite、node:test。不开设通用 agent 平台，不新增前端 UI 框架。

**Spec:** [生成与批改日常工作台设计](../specs/2026-09-11-generation-grading-daily-workbench-design.md)

**状态（2026-10-10）：** Task 1–8的共享规则、模型策略、持久化版本、局部修订、HTTP/CLI及两个Web工作台已接入。本机已完成业务迁移、持久化启用及真实生成正式双卷闭环；16题真实批改已按教师最终评分确认、独立归档，数据库幂等与档案证据准入通过。按约定范围Task 9验收完成，第5项“当前学生/教材/教师留出任务”继续暂缓。以 `docs/teaching-workflow-acceptance.md` 最新记录为准；下方失败及未启用记录保留为历史证据，不由旧复选框推断当前运行状态。下一阶段已由教师选定为日常质量闭环，先复用已有采集、独立回放和评测工具补齐误导指标与Skills状态，不重复旧计划已有的质量工具。

## 后续阶段：日常质量闭环（2026-10-10教师已选择）

复用旧模块计划已有的gold采集、独立回放和质量评测工具。金标为教师最终决定，actual为独立服务执行结果；回放persist:false，问题追踪与教师业务评分、确认、归档分离。

- [x] 档案教师确认与资料真实章节的工程修正收口（2026-10-26，提交b3c318d）：发布及打印要求当前教师显式确认，服务端保护复核元数据；不存在的章节名与ID均拦截。上一轮72项回归、API/Web/Skills、真实HTTP负向门禁及资料上下文E2E已有记录，业务评分与归档不变。这里只收口工程修正，不代表新周/月档案已获教师内容评价或发布；详见验收记录“四模块收口”节。
- [x] 本轮Git可追踪性收口（2026-10-26）：核对剩余文件并提交计划、验收记录及刷新后的历史编码报告；原第九阶段约定验收、已完成候选回放和已验证工程修正按各自证据收口。两份未跟踪教学Word产物继续本地保留，既有上传、导出和临时验收证据不清理；本项不代表所有教学质量待办完成或工作区守护全绿。
- [x] 最新修正（2026-10-22）：共享grading-v3补齐逐行证据核对及错误传递说明，区分合法拆分、改数、独立符号/乘积/合计错误及可确定计算项保留。同份16题一次真实回放130.7秒返回，原第8/12题解释偏差及第11题保留分说明缺口本次未再出现。11题数值建议分与金标一致，8/9/11/12/14共5题仍待定，第14题答语措辞出现新裁量差异；教师原满分与整卷37.5分不改。32项回归、Skills及API检查通过，规则hash与执行记录一致、数据库不变；不是完整评分或稳定时延验收。证据前缀grading-step-evidence-live-20261022；更广候选卷、分值待定及措辞裁量继续追踪。
- [x] 首批衔接：修正无有效执行证据仍计算准确率的问题，补充有效样本覆盖数，并同步生成/批改Skills当前部署及验收状态。
- [x] 采集脱敏候选快照并校验教师评分保留，记录未准入原因；本批11份240题、阻断31份。
- [x] 对最新16题做一次受控回放并验证失败门禁，保存失败分类、执行预算、规则hash和报告；本次60秒超时，不作为评分准确率通过。
- [x] 对照原归档与回放输入，核查题型和来源上下文缺失，区分原证据缺失与采集/重建丢失；2026-10-12确认采集遗漏可信补充题型，11份240题已恢复，教师金标与识别证据不变。共享材料/原打印布局无现存结构化证据，不补造；题型缺口不是已证实的超时根因。
- [x] 对补齐题型的最新16题按现行180秒总预算独立回放，保存主调用/替补耗时及失败分类，核验质量CLI正确拒绝失败样本；2026-10-12两次调用均超时，有效评估0，16题差异未知，教师金标及归档不变。
- [x] 按服务现行预算及停止条件补齐剩余批次独立执行（2026-10-23）：8份179题全部完成，persist:false、expected/teacherReview不进模型；单份56.2–172.7秒，最终执行失败0/8，其中一份触发现有单次质量修复，无替补或额外审查。70题同分、7题分差、102题待定，分数覆盖43.02%、一致39.11%、可比题MAE0.1429分；各卷总分仍未知。原评分、源gold及业务数据库哈希不变，28项回归及API检查通过。证据前缀daily-followup-20261023；2份45题仍因原作答缺失阻断。此次勾选仅指受控候选批次执行及问题记录完成，不表示评分质量、OCR或稳定时延通过。此前2026-10-22首份16题180.1秒失败、剩余8份未调用的记录仍保留在验收历史。
- [x] 按新增证据做最小修正与针对验收（2026-10-23）：修正本地组合/多空答案整题字面判错，完善过程未采集、等价表达、逐空分值及独立结果分边界。42项回归通过，10题合成真实诊断10/10符合预期；原35题一次真实回放157.0秒，17同分、17待定、1分差。第1题前三空获认可，第22/25/27/28/31/32/33/34题缺过程不再直接清零。源输入、教师评分和归档及业务数据库哈希不变；证据前缀grading-evidence-20261023，详情见验收记录。仅本次最小修正及定向验证完成，不表示其他卷、Web运行实例或整个质量闭环已验收。
- [x] 核验运行API载入共享服务修改并验证实际批改入口（2026-10-23）：旧API早于源码修改，由现有守护重载；恢复5173 Web。真实UI登录、选原任务、刷新及第14题核对通过，另修正StrictMode重复挂载导致刷新重新登录后无法恢复任务的问题。先复现失败再修正，2/2合成浏览器回归、Web类型检查及真实桌面/390窄屏只读验收通过；历史版本5、37.5/60、第14题5/5、16题确认及独立归档完整对象哈希和42/42/114/272/10业务数量不变。本次真实Web不调用模型或修改业务记录，不替代评分质量/时延验收；证据与失败中间结果见验收记录最新节。
- [x] 补齐新版规则剩余候选回放（2026-10-26）：7份144题全部完成，57同分、87待定、0数值分差、0缺题，分数覆盖39.58%，各卷总分仍未知；7次单主调用、无修复或替补，68.7–179.9秒。规则hash、原gold及业务数据库完整对象核验不变，24项回归及质量CLI通过；详见验收最新记录及daily-followup-20261026证据。本项只表示独立执行与记录完成，不表示评分质量或稳定耗时验收通过。
- [ ] 补齐评分证据与裁量验收：待定题须可信原过程、逐空分值、完整选项及明确题型，不能从历史得分反推rubric；2份45题因只有教师确认摘要、缺少原作答继续阻断。第5题教师原1分保留；2026-10-26已查到历史扣分说明为要求计数单位表达、未接受分数形式，但模型输入中的来源rubric没有明确禁止等价分数。教师要求先看原卷再答复，已核查本地项目、归档及附件缓存，只有4张原照片文件名登记，未找到图片文件；等待原卷核对，不将金标侧扣分解释直接注入模型。
- [x] 补齐整卷耗时及渠道计量的内部诊断（2026-10-26）：记录最多三个请求/响应阶段、实际上限字段、返回终止原因及白名单推理/缓存用量；保留未知费用及未知用量，诊断不进入教学候选或产品响应。92项回归及API检查通过；29题一次真实回放首次调用151.1秒、finish_reason=length、6000输出量中渠道报告3624推理用量，截断JSON触发现有单次修复并耗尽剩余28.9秒，最终180016ms失败。原gold及业务库完整对象哈希不变，详见最新验收记录。本项仅收口诊断实现与失败机制取证，不代表超时修复。
- [x] 完成长卷首次输出/修复分配的最小工程调整（2026-10-26）：单模型批改默认9000首次、3000修复预留，按渠道实际用量结算原共享池，其他任务及不同型号替补分配不变。先复现失败再修正，104项定向回归及9项服务回归通过，API检查通过；同一29题一次真实对照实际请求9000，180027ms仍失败，截止前无响应头、usage未知，无追加调用。29题待定，源gold及业务完整对象哈希不变；本项只收口分配实现与验证，不宣称稳定耗时通过，详见最新验收记录。
- [ ] 完成整卷稳定耗时与渠道计量验收：保持Sol 6.1 high、180秒及12000输出总预算，不增加审查或盲目重试。原35题157.0秒、29题179.9秒成功不能抵消后续同份29题两次180秒失败；6000额度曾输出截断、剩余时间不足修复，改为9000后本次截止前无响应头，不能从该观测进一步归因上游排队或推理。下一步评估现有完整题目分组执行契约，保留原操作总预算、完整题号、跨题材料绑定、教师裁量及失败不评分门禁，再决定实施及受控真实对照；不能仅提高单次额度就认定时延达标。本轮未重启API，不宣称Web运行实例加载最新分配。历史两份渠道报告超过6000的计量含义仍待核实，旧179题指标不能当作新版规则总体质量。
- [x] 近期新生成稿实际打印版式验收（2026-10-26）：复用已认可内容与评分点，实际生成四题计算学生卷1页/解析卷2页、六年级一般过去时20题学生卷2页/解析卷3页，均为A4；数学每题净空白102mm，英语前10题保留题干下四线格。教师明确确认“两份版式均可用于日常教学”。修正按题型固定编号造成的英语大题序号乱序，49项打印/来源/门禁/布局回归、蓝图、布局及API检查通过。生产函数离线渲染，0模型调用、0业务写入，不代表本轮重新发布或正式Web导出；证据目录tmp/quality/daily-generation-print-20261026-final，详情见验收记录。
- [ ] 当前学生/教材/教师留出任务：按教师决定暂缓，待磨合后恢复；工作区清理继续后置，不视作本轮功能实现阻碍。
- [x] 核对模型调用连接及响应阶段，补齐内部安全阶段记录与本地HTTP回归；当前合成小请求两模型成功，整份16题仍在响应头前超时，尚未证明根因或生产可用性恢复。
- [x] 对生成模块建立已教师认可四题的离线基线与共享服务回归，保留本份1/1/1/1结果分及独立的旧补弱2/2/1/1口径，不固定未来题量。
- [x] 处理历史综合卷缺分兼容：只有旧接口全无分值且无rubric才沿用蓝图分配兜底分值，明确兜底和待复核；保留任一已有分值或rubric，不调整受限模型链路输出。两个mock的100分原断言及兜底标记通过。
- [x] 补齐阅读生成的服务端数值要求，英语调用与服务复核共用阅读检查；2026-10-19真实六年级英语小测约71秒生成20题60分、无兜底，现有生成质量评测通过，内容仍待教师评价。
- [x] 独立回放恢复可信不可变归档的原始教师评分要求，核对11份240题expected及原作答未变；模型输入仅投影已验证来源并保留过程证据，不修改归档或模型职责。
- [x] 按2026-10-19渠道可用清单升级Sol 6.1、MiniMax M3.1 Flash，保留当前Astra主模型与最新版DeepSeek Flash；OCR接入受限执行器并修正空题、未知置信度及输出模板，批改规则升至grading-v2，按教师最终裁定保留部分分歧义。新模型整卷仍超时，分组执行尚未实施。
- [x] 随后按教师指定切换Sol 6.1高推理主调用并独立真实重验：16题146.4秒返回、10题给分与金标一致、6题待裁定；四题计算57.4秒与英语20题62.3秒生成均无兜底且过内容服务门禁。教师归档及数据库前后哈希不变，证据见2026-10-19最新验收记录；部分分细分、历史OCR及旧指令衔接仍待修正，不宣称完整评分或稳定时延验收。
- [x] 补齐服务端已核验转写在局部重批、脱敏采集和独立回放中的衔接，保留原评分要求及OCR证据；grading-v3明确部分分确定项与待裁定项。第16题单题真实回放28.1秒得2.5分，与金标一致；第8题38.7秒保留null并明确缺少细分口径。两次persist:false及业务全对象哈希不变；不是整卷评分或稳定耗时验收。见最新验收记录。
- [x] 完成本轮两份新生成稿的教师内容评价：2026-10-22教师分别确认四年级四题计算稿（本稿仅正确结果各1分）与六年级一般过去时20题英语稿的内容及评分点可用。对应sol-primary-live-calculation-20261019.review.md、sol-primary-live-english-20261019.review.md；本项仅为这两份内容验收，不替代打印版式、整卷批改时延或更广样本验收，不据此自动发布或归档。
- [x] 精简批改输出中的来源复写：学生答案、已核验标准答案和原始坐标由共享AI层按题号恢复，模型保留评分、依据和必要关键步骤。2026-10-22最新16题一次真实回放44.2秒返回，12题建议分与金标一致，8/9/11/12仍为null；原归档及业务全对象哈希不变。此单次结果不证明稳定提速；第8、12题解释有事实表述偏差，第11题对已明确错误传递口径说明不足，均列入后续语义质量追踪，不标为完整教学通过。见grading-compact-response-live-20261022证据及最新验收记录。

2026-10-19模型切换前记录：首批11份在第3份原作答不足时按停止条件收口，前两份返回可用但均有待裁定题，余8份未回放。请求精简从32501降为25422字节，补回原始教师要求后26240字节；后两次最新16题回放仍在响应头前超时，当时停止重复模型调用。随后教师指定Sol 6.1主模型，本轮最新16题146.4秒返回；剩余问题转为部分分细分及历史已确认识别修正/旧指令衔接，仍需更广样本验证稳定性，不能用原已确认成绩填补actual。新教师评价稿为tmp/quality/sol-primary-live-calculation-20261019.review.md及sol-primary-live-english-20261019.review.md，先前生成稿保留。详情与证据见验收记录最新节。

教师已明确工作区清理后置到全部阶段完成；阶段内只核对范围、保留证据并显式提交已验证代码，不移动或删除既有产物。

首批证据与问题状态见 `docs/teaching-workflow-acceptance.md` 的“日常质量闭环首批”记录。本阶段不自动恢复第5项留出任务、不重建小程序或全站UI、不以样本数宣称生产准确率。

## Global Constraints

- 本轮聚焦生成、批改、所需资料上下文、模型路由、Skills、任务版本和两个教师工作台。
- 本轮不推进小程序、课堂屏、独立资源库重建、学生档案重建或全站视觉重做。
- 当前模型职责（2026-10-19教师最新决定）：生成、参考答案及主观批改使用GPT-6.1 Sol高推理；Flash按需辅助。同型号替补禁用，质量校验失败最多一次原模型修复，总预算不增加。下文Task 2的Astra主调用及替补测试记录为历史设计，当前以model-policy.js及最新验收记录为准。
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

工程实施已开始，按阶段更新完成项、变更路径、验证结果和精确下一动作，不能一次勾选所有阶段。

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

- [x] 写规则加载失败测试：未知 module、路径穿越、缺文件、空正文不能返回旧规则。
- [x] 写临时测试目录用例证明“修改正文会改变实际加载内容与 hash”，不是仅测试文档存在：

```js
const first = await loadTeachingRulePack('generation', { root: fixtureRoot });
await writeFile(ruleFile, '# generation-v1\n专项练习只生成指定题型。\n', 'utf8');
const next = await loadTeachingRulePack('generation', { root: fixtureRoot });
assert.notEqual(next.hash, first.hash);
assert.match(next.text, /专项练习/);
await assert.rejects(loadTeachingRulePack('../grading', { root: fixtureRoot }));
```

- [x] 运行 `node --test packages/ai/src/teaching-rules.test.mjs`，确认先因入口缺失或行为缺失失败。
- [x] 实现仅 generation/grading 的路径映射与 hash；明确重载策略，不让永久缓存导致修改文档后运行时不更新。
- [x] 把教学细则写入两个 references：专项/综合/多日/讲解分流、合理异解、证据不足、逐题得分和确认边界；把调用流程留在 Playbook，删除重复矛盾说明。
- [x] 更新 Skills 校验：引用目标必须存在；规则不能为空；模型调用预算只引用权威策略，不在多个 Playbook 重复硬编码。
- [x] 验证 `node --test packages/ai/src/teaching-rules.test.mjs scripts/skills-check.test.mjs`、`cmd /c npm.cmd run check:skills`、`cmd /c npm.cmd run check:encoding`。
- [x] 显式 stage 本任务文件，提交 `feat: share generation and grading teaching rules`。

Task 1 验证记录（2026-09-11）：新增用例先因缺少入口和校验规则失败，补齐实现后 46/46 通过；check:skills 通过全部 9 个路由，check:encoding 无问题。校验 CLI 改为等待异步规则加载。尚未接入旧模型请求，不以此宣称 Web/对话内容一致或新模型上线。

### Task 2：任务独立模型策略与有界调用

**Files:**
- Modify: `packages/ai/src/model-policy.js`、`packages/ai/src/model-policy.test.mjs`
- Create: `packages/ai/src/teaching-model-runner.js`、`packages/ai/src/teaching-model-runner.test.mjs`
- Modify: `packages/ai/src/runtime.js`、`packages/ai/src/index.js`、`packages/ai/src/index.d.ts`、`.env.example`
- Modify: `packages/core/src/module-capability-registry.js`、对应测试及 `packages/services/src/module-capability-status.js`

**Interfaces:** `resolveTeachingTaskPolicy` 返回 `{primary:{providerId,model,reasoningEffort}, replacement, maxAdditionalAttempts:1}`。generation/grading/reference 主路由使用 Astra；extract/recognize 使用 Flash；rewrite-feedback 使用 Sol。只有 Astra 内容任务有 Sol availability 替补。

新增配置键为 `TEACHING_PRIMARY_MODEL`（默认 `gpt-6-astra`）、`TEACHING_REPLACEMENT_MODEL`（默认 `gpt-5.6-sol`）、`TEACHING_ASSIST_MODEL`（默认 `deepseek-flash`）。适配器沿用现有受保护的供应商凭据与地址配置；发现端点不支持时报告配置错误，不能修改全局 `GPT56_MODEL` 把学生问答一起切换。

- [x] 增加路由隔离测试：

```js
assert.equal(resolveTeachingTaskPolicy('generation', {}).primary.model, 'gpt-6-astra');
assert.equal(resolveTeachingTaskPolicy('grading', {}).primary.reasoningEffort, 'high');
assert.equal(resolveTeachingTaskPolicy('extract-material', {}).primary.model, 'deepseek-flash');
assert.equal(resolveTaskModelPolicy('qa', {}).primary.model, 'gpt-5.6-terra');
assert.equal(resolveTaskModelPolicy('qa', {}).escalation.enabled, false);
```

- [x] 使用注入的 `call` 和假时钟测试调用序列：正常 `[Astra]`；503 `[Astra,Sol]`；401/OCR缺证 `[Astra]` 或预检零调用；质量问题 `[Astra,Astra修复]`；追加失败不出现第三次调用。
- [x] 运行 `node --test packages/ai/src/model-policy.test.mjs packages/ai/src/teaching-model-runner.test.mjs` 确认新增用例失败。
- [x] 按统一预算实现调用：

```js
const remaining = budget.deadlineAt - now();
if (signal.aborted || remaining <= 0) return interruptedOrFailed();
const primary = await call(policy.primary, input, { timeoutMs: remaining, signal });
// classify primary; evidence/configuration stop; availability may replace;
// quality may repair with primary; both spend one shared additional-attempt slot.
```

`now` 为 runner 注入的时钟函数；`interruptedOrFailed` 是 runner 内部构造规范化失败结果的辅助函数，不调用模型。预算包含 deadlineAt、remainingTokens、additionalAttemptsUsed；有供应商 usage 才记录实际费用，未知费率保持 unknown。

- [x] 输出按 role 过滤；attempts、模型名和错误原文只保留内部，不添加到学生/家长或普通工作台响应。
- [x] 验证本任务测试及既有 `packages/ai/src/gpt56-runtime.test.mjs`、`packages/ai/src/qa-learning-signal.test.mjs`；编码检查后按本任务路径提交 `feat: route teaching tasks with bounded model calls`。

Task 2 验证记录（2026-09-11）：规则、模型、执行器、HTTP 假网关、旧问答及 Skills 合计 118/118 通过；check:api 成功（只证明服务启动检查和数据库连接，不证明真实模型可用）。新增 `runTeachingTask` 服务端装配入口，捕获请求证明规则修改即时改变正文/hash。教学 HTTP 禁止底层隐式重发，Astra/Sol 使用推理参数及 max_completion_tokens，不发送 temperature；旧调用兼容参数保持原状。官方依据：`https://developers.openai.com/api/docs/models/gpt-6-astra` 及其 model guide。

预算口径：remainingTokens 是整项共享的输出 token 额度（包括供应商计入 completion 的推理 token），调用前预留，存在 usage 时结算；没有 usage 保守扣除预留额度，费用保持 unknown。输入 token 仅在供应商 usage 返回后记录，不把该额度当作货币费用上限。additionalAttemptsUsed 按内容单元保存；Task 3 必须共享 deadline/token pool 并限制并发，不能复用同一追加计数阻塞其他单元。

实施顺序调整：模块能力注册表与状态展示和 Task 3 业务入口迁移同步修改，避免仅有新基础代码时就向 Web 宣称新链路已生效。下一动作：接入 generation/grading/reference，移除这些入口的重复追加调用，补 purpose 分流与逐题评分证据测试。

### Task 3：生成分流与批改证据链（已实现）

**Files:**
- Modify: `packages/ai/src/assessment-partitions.js`、`packages/ai/src/assessment-partitions.test.mjs`
- Modify: `packages/ai/src/runtime.js`、`packages/ai/src/runtime-prompt.test.mjs`
- Modify: `packages/services/src/context-engineering.js`、`packages/services/src/context-engineering.test.mjs`、`packages/services/src/index.js`
- Create: `packages/services/src/teaching-pipeline.test.mjs`
- Modify: `packages/ai/src/ocr-node.js`、对应 OCR 测试；`apps/api/src/external-grading-recognition.js`

**Interfaces:** 新增业务字段 purpose、dayPlan、requestedItemTypes，服务端归一化后进入 generationContext；返回草稿继续兼容现有答案包。新 runner 接入现有 `draftAssessmentService`、`gradeSubmissionService`，保留可注入假 runner。

- [x] 写并运行分流、模型输入、批改证据和 OCR 引用用例。
- [x] 捕获测试确认真实 rulePack/hash、原始要求和资料片段进入服务端请求，客户端 rulePack/model/预算不能覆盖服务端值。
- [x] 批改用例确认仅未解决题目发送、逐题 score/maxScore、uncertain=null、总分按逐题汇总。
- [x] 运行生成、批改、OCR、目的校验和旧运行时兼容测试；专项回归 106/106 通过。
- [x] 实现分流：

```js
const purpose = normalized.purpose || 'comprehensive';
// focused: use validated requestedItemTypes and scope;
// multi_day: one shared plan, bounded day/group units;
// explanation: structured explanation and worked examples;
// comprehensive: keep existing kind/subject blueprint.
```

- [x] 增加配置选择的 Flash 识别适配器，保留 page、bbox、原图及裁剪引用，不替换 MiniMax 默认路线。
- [x] 对 figure、sourcePackage、分值和资料审批继续执行校验，不通过时保留教师待复核草稿。
- [x] 验证本任务测试、生成蓝图、编码、API、Web 类型和 `check:content-context`。`check:content-context` 报告为 link-guard，只证明资料—复核—导出闭环，不证明真实模型内容质量。
- [x] 按范围提交 `feat: align teaching generation and grading pipelines`；记录阶段一结果及下一项 Task 4。

Task 3 实现提交：`5d07673`。新增与迁移回归 106/106 通过，收尾追加的用途校验、多题型专项、讲解草稿与模型探针兼容用例通过。Skills、生成蓝图、编码、API 启动与 Web typecheck 通过。运行时测试使用合成输入和本地 HTTP 假网关，证明实际调用序列、共享规则、deadline/token pool 和评分契约。

`check:content-context` 连接已有 `127.0.0.1:8787` 实例，完整通过上传、审批、上下文注入、教师复核、正式导出拦截和清理；没有重启该实例，不能据此证明它已加载此次新代码，也不能证明内容原创性或批改准确率。Flash 仍为配置选择的识别候选，默认 OCR 未切换。阶段一服务层实现收口，下一项为 Task 4：持久化版本、并发与检查点；Web 新交互、局部修订、确认复用及真实样本验收继续按后续任务推进。

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

2026-09-11 续作记录（接口层阶段完成，Task 4–6 整体未验收）：

- 已增加四个教师工作流 HTTP 路由和薄 CLI/client，共用服务层；输入/输出白名单、教师 session、跨教师 404、历史工作流 ID、旧版 409 与内部错误脱敏已有本地 HTTP 运行证据。
- CLI 通过实际子进程读取指定私有会话文件，并在临时 HTTP server 上完成创建、读取、命令及历史查询测试；不直写 DB、不携带会话跟随重定向、不自动重试写操作。测试创建器和 repository 使用合成数据与内存实现，不代表真实生成或 PostgreSQL 已通过。
- 服务层新增 create/get 边界；历史查询固定返回工作流 ID；确认继承先移除新输入凭据；校验器必须明确返回 ok=true。取消增加 expectedRevision 条件并检查实际写入数量，不能在 count=0 时宣称已取消。
- 新 HTTP 路由在持久化关闭时返回认证后的 503。当前生产没有装配 createDraft、局部 runner 和模块校验器：创建返回 WORKFLOW_EXECUTION_UNAVAILABLE，内容写操作返回 WORKFLOW_VALIDATION_UNAVAILABLE；不能靠开启数据库开关宣称生成或批改已接通。
- 本轮聚焦测试 57/57 通过；API、Web typecheck、Skills、生成蓝图、编码和 diff 检查通过。未重启已有 API/Node 服务，未执行数据库迁移或 Prisma Client 生成，未创建 commit；已有 output/ 与编码历史报告继续保留。

本记录时的下一步：回到 Task 5 补齐局部 runner 的 begin/end/cancel 执行生命周期、命令级幂等重放、模块输出校验及答案包同步、受认证归档版本的确认复用。后续进展及当前下一步见下方最新续作记录。数据库迁移、隔离 Prisma Client 和真实事务验收继续按用户安排后置。

2026-09-11 续作记录（Task 5 生命周期局部补齐，仍未整体验收）：

- 仓储 revision 增加可选 `commandFingerprint`，提供 owner-scoped `getOperation`；重复完成命令可在服务层直接重放已记录版本，指纹不一致返回 `WORKFLOW_OPERATION_KEY_REUSED`。
- 局部修订、确认和恢复在存在仓储生命周期实现时经过 `beginOperation` 后再调用 runner，异常通过 `endOperation` 结束；仓储允许从待复核/已确认头版本启动新的操作，并继续使用 active operation key 把取消和迟到提交隔离开。
- 新增服务测试覆盖模型执行期间取消后的迟到结果拒绝，以及完成操作重放不调用 runner；本轮工作流相关测试 20/20 通过。数据库迁移文件只更新待执行结构，未执行迁移或 Prisma 生成。
- 尚未完成：创建 requestKey 复用前置去重（当前仍会先调用 createDraft）、真实并发操作的数据库验证、答案包同步、归档版本替代关系及学生档案/错题聚合接入。

2026-09-14 续作记录（修正上轮生命周期验证不足，Task 5 仍未整体验收）：

- 已用实际仓储实现连接服务、HTTP 和 CLI 测试；共享内存 Prisma 适配器只模拟数据访问，明确不模拟 PostgreSQL 锁或事务回滚。新增测试先复现旧代码的重放、取消、输入预检、额外模型调用和检查点串用问题，再修正实现。
- 命令指纹改为 SHA-256，绑定原 expectedRevision、动作和内容；缺失指纹或同 key 改命令均拒绝，历史重放返回历史状态。服务不再因仓储接口缺失而跳过 begin/end。已完成命令可跨服务实例重放；失败操作完整账本尚未实现。
- 直接手改题目、确认和恢复不调用模型；只有带非空 instruction 的修订使用 runner。非法输入和执行器缺失在占用操作前拒绝。新的语义操作清空检查点，旧队列恢复仍保留已完成单元。
- 同一实例取消会发送 AbortSignal，忽略信号或另一实例取消均由仓储阻止迟到提交；执行器遵循信号抛出的 AbortError 映射为 WORKFLOW_CANCELLED。原已完成、已确认版本保留。尚未验证真实供应商收到信号后的终止与计费行为。
- 题目、共享材料、日期替换必须保留身份；runner 不可改变题号、日期和材料引用。答案包重算仍待接入，不能据此宣称生成内容已经完整可用。
- 下一步：创建 requestKey 前置去重及生成前持久化占位、模块输出校验与答案包同步；随后处理受认证的确认复用、归档替代关系和实际聚合。最后装配生产执行器与 Web 工作台；数据库迁移、Prisma 生成和真实 PostgreSQL 验收继续后置。
- 验证：工作流服务/生命周期、实际仓储契约、核心 patch、HTTP/CLI、生成队列、批改复核/归档和来源包共 71/71 通过；check:api（含现有数据库连接）、Web typecheck、check:skills、check:generation:blueprint、check:encoding 通过。未启动真实模型调用，未运行全服务模型 smoke 或完整内容 E2E；未执行新增表迁移、Prisma 生成或 PostgreSQL 事务测试，未重启已有服务，未改变生产开关。代码仍随 Task 4–6 未完成工作保留在当前分支，未创建 commit。

2026-09-14 创建链路续作（前置去重与占位实现，生产未启用）：

- 仓储新增 getCreation / reserveCreation，复用现有 ownerTeacherId + requestKey 唯一索引和两个工作流表。模型执行前持久化版本 1 占位，插入获胜者才执行 createDraft；并发冲突读取获胜任务。版本 2 才存入通过校验的教学内容，保留原始 request，解析后的 resolvedRequest 存入内部内容快照，subjectRef 随版本事务更新。
- 同 key 同请求跨服务实例/重启后复用已有状态，改请求或模块拒绝。缺少执行器/校验器时不新建占位；既有任务仍可只读重放。失败、needs_input、取消和中断后不隐式重生成，resume 仍待实现。
- createDraft 接收 workflow 和 AbortSignal，取消与中断均阻断迟到提交；预先取消甚至不会进入执行器。占位不能确认、修订或恢复成正式内容。失败不暴露模型错误原文，只返回任务状态和公共提示。
- API/CLI 同步新版本语义：首次可复核草稿为版本 2，首次完成 201，运行中的重复创建 202，已完成或失败状态读取 200。2xx/ok/CLI 退出码不能单独作为生成成功证据；必须检查 status、content 和 issues。相应 HTTP/CLI 测试已经采用返回版本继续操作。
- 内存 Prisma 测试适配器模拟唯一约束以覆盖 P2002 的竞争分支；没有模拟 PostgreSQL 锁和事务回滚。已补写实际 PostgreSQL 并发占位用例，仍按约定不运行、不迁移。
- 准确下一步：模块输出校验与答案包同步，然后受认证确认复用、归档替代及实际聚合。Task 5–6、生产装配、Web 工作台和真实教学验收仍未完成；本轮不改变生产开关或运行服务。
- 验证：创建/修订生命周期、仓储契约、HTTP/CLI、生成队列、来源包和批改门禁共 84/84 通过；check:api、Web typecheck、check:skills、check:generation:blueprint、check:encoding 通过。新增 PostgreSQL 用例仅通过语法检查，没有执行数据库集成测试；本轮没有执行迁移、Prisma 生成、真实模型调用或正式归档，也没有重启已有服务。

2026-09-14 模块校验续作（Task 5 结构校验与答案包同步，生产未装配）：

- 新增 teaching-workflow-validation.js，生成/批改使用不同校验规则；服务将 actor、workflow、原请求及 nextRevision 交给校验器，并持久化校验器返回的规范化快照。生成校验用途、答案解析、评分依据和依赖引用，讲解保持独立结构；模型用途不能覆盖教师明确请求。创建先统一 items/questionResults 题目字段并去除模型自带确认，避免兼容输入丢题或绕过复核。
- 测评快照每次生成新版本都重建答案包；共享材料、日期、选项、图形及题目身份纳入来源指纹。已验证人工修改、模拟模型修改、确认、恢复均对应新版本答案包；共享材料变化撤销所有依赖题目确认，未影响题目保持确认；无效模型结果不覆盖原有快照。
- 批改通过注入的服务端来源解析器绑定可信答案；检查有效指纹、整数版本、来源总分、逐题分数/状态及覆盖范围，拒绝空缺作答证据。uncertain 不出最终分、不能确认，缺来源不能携带猜测的答案或分值；来源变化拒绝旧确认，修改得分后重新计算合计。全部工作流题目确认仍不自动归档。
- 聚焦回归 99/99 通过（含新增 15 项模块校验与实际 service/repository 组合测试）；check:api、Web typecheck、生成蓝图、check:skills、check:encoding、git diff --check 通过。测试使用合成数据、内存 Prisma 适配器与模拟 runner，不能证明 PostgreSQL 事务、真实模型教学质量或生产流程已切换。check:services 会触发真实模型与语音调用，本轮未执行；本轮模块校验由上述定向测试验证。
- 当前准确下一步：受认证归档版本的确认复用、归档替代关系及实际错题/档案聚合；随后完成 Task 6 来源解析器权限/版本锁定、旧导入/导出 context 适配、生产 createDraft/runner/validator 装配及用途专项检查，再接入两个 Web 工作台。讲解 HTTP 视图及编辑/确认也未接入。Task 5–6 尚未整体验收；数据库迁移、隔离 Prisma Client 与 PostgreSQL 事务继续后置。本轮未改变运行开关、启动/重启服务或调用真实模型。

2026-09-14 确认复用与归档聚合续作（Task 5，归档写入尚未装配）：

- 新增 teaching-workflow-archive.js，准备包含完整快照和显式祖先 ID 的版本归档；验证教师归属、逐题确认及可信来源，不修改旧快照，不执行写库或发布。相同输入得到相同记录只证明准备函数确定性，不等于数据库幂等写入通过。
- 创建服务可注入 resolveConfirmedArchive，在已校验批改草稿上复用服务端记录中的确认；核对当前教师、学生、原提交 ID、来源、顶层证据及逐题内容，随后重新校验并汇总分数。模型携带的归档记录被移除；没有该解析器仍不复用导入确认。生产来源解析器和旧对话档案适配未接通。
- 版本选择器已进入周/月档案、阶段报告和共用源读取路径；先做替代筛选，再做日期窗口，覆盖旧错题被新版全对结果替代，以及最近 80 条外的版本补读。选择器拒绝版本分叉、篡改记录、跨学生和来源不一致的错题；没有新标记的历史记录不自动推定替代关系。
- 真实归档事务仍未实现/启用：需要原子校验工作流当前版本、固定归档幂等键、写入独立 Submission/GradingResult 和错题，并保留旧快照。新记录不得绕过外部图片/参考答案复核、教师学生权限或角色过滤。此项与生产解析器装配是下一步，不把准备函数称为正式归档完成。
- 本轮继续保留数据库迁移、Prisma 生成和 PostgreSQL 事务验收后置；没有新表变更、真实模型调用、正式归档写入、历史资产改写或已有服务重启。
- 验证：工作流、仓储契约、HTTP/CLI、生成队列、来源包、归档门禁、周/月档案及阶段报告回归 159/159 通过；API、Web typecheck、Skills、编码和 diff 检查通过。归档准备及窗口外读取使用合成数据/内存适配器；不视为 PostgreSQL 查询、并发事务或生产可用性验收。异常归档另以最小原因摘要进入教师 blockedEvidence，不静默当作零错题；知识点提取兼容工作流 questions 与历史 questionResults。

2026-09-14 归档事务续作（Task 5 写入路径实现，生产未装配）：

- 新增 teaching-workflow-archive-repository.js 和 teaching-workflow-publication.js。事务先锁教师工作流行，再读取真实版本和当前状态；固定归档 ID 由工作流/版本派生。服务只接受 actor、workflowId、expectedRevision，原始快照与分数来自锁定版本。
- 同事务保存独立 Submission/GradingResult、逐题错题和归档祖先关系。新归档不修改工作流版本或旧归档；新版零错题仍替代旧证据。已提交版本重放仍检查当前教师学生权限和记录完整性，返回原归档版本与当前工作流版本；失败无隐式重试。
- 权限和来源检查是必需依赖，缺失即 unavailable。真实 authorizeStudent/resolveArchiveEvidence 必须在 tx 内读取权限、来源和外部证据；本轮仅使用测试实现，未装配生产解析器，也未开放 HTTP/CLI 发布命令。
- 新增版本归档防改写守卫：旧答案导入、题目/来源/OCR 编辑、重识别和旧归档端点拒绝直接修改，后台失败处理也不会覆盖版本归档。归档重放还核对顶层图片/来源证据，不能只比较题目分数。
- 测试覆盖事务中途/提交失败后的回滚、主动重试、并发请求去重、重启重放、旧版重放、权限变化、证据不足、客户端伪造字段、新版零错题替代及 HTTP 防改写。事务模拟器采用串行写时复制，不等同于 PostgreSQL 行锁或真实并发测试；没有数据库迁移、Prisma 生成、真实模型调用或正式归档写入。
- 准确下一步：Task 6 生产来源/权限解析器、旧业务与发布路由装配、角色字段过滤及 context 导入/导出适配，再推进两个 Web 工作台。数据库实测继续按用户安排后置；Task 5–6 尚未整体验收。
- 验证：工作流、归档写入、仓储契约、HTTP/CLI、批改门禁、档案聚合和防改写守卫回归 169/169 通过；check:api、Web typecheck、check:skills、check:encoding 与 git diff --check 通过。新归档没有在真实数据库执行；默认生产服务仍未装配发布器及其必需解析器。

2026-09-14 归档 API/CLI 与来源解析续作（Task 6，开关后装配，生产未启用）：

- 新增 teaching-workflow-archive-resolvers.js，以当前教师学生关系查询原提交、作业和可信来源包；在发布事务内依次锁定 Assignment、Submission、GradingResult 后重读并生成证据绑定。未登记的外部答案来源不能使用学生作答补造。Submission 使用 FOR UPDATE 约束无既有批改行时的并发首次插入；实际 PostgreSQL 行锁仍待后置验收。
- 外部材料逐题确认复用工作流中可信教师身份与版本，不要求重复确认旧识别包；仍必须通过图片质量、有效页/题目覆盖和独立参考答案门禁。新增测试先复现空题目异常及归档包装后证据绑定改变，再修复；不可变归档保留原始证据绑定和外部识别包，资料或 OCR 变化不能沿用旧绑定。photo-upload 来源缺少 materialType 也不能跳过外部门禁。
- 新增 POST /api/teaching/workflows/:id/archive 及 CLI archive 命令，输入仅 expectedRevision，身份来自教师会话；首次写入 201，同版本重放 200。响应仅白名单归档摘要；非法版本、伪造字段、越权、证据不足和异常成功体均有测试，P2034 返回版本冲突且不重试。HTTP 测试包含实际发布服务和仓储接入事务模拟器；CLI 测试实际启动子进程调用临时 HTTP 服务。
- server.js 已在既有 TEACHING_WORKFLOW_PERSISTENCE_ENABLED 开关后装配权限/证据解析器、可信归档解析器和发布器；没有开启开关或重启既有服务。createDraft/runner/模块校验器仍未接通，后续 createDraft 必须用 resolveGradingContext 的 archiveEvidence 覆盖模型字段并随版本保存；当前无绑定快照不能归档。
- 验证：工作流、权限/证据解析、发布路由、CLI、归档事务编排、批改门禁及档案聚合回归 180/180 通过；check:api（含既有数据库连接）、Web typecheck、check:skills、check:encoding 与 git diff --check 通过。测试中的 SQL 查询替身和串行事务模拟器不证明 PostgreSQL 隔离、锁等待或回滚；没有新增表迁移、Prisma 生成、真实模型调用或正式归档写入。
- 准确下一步：Task 6 服务端 createDraft/runner/validator 与请求完整性/证据绑定装配，补旧导入/导出 context 适配和讲解视图，然后接两个 Web 工作台。数据库验收继续后置；Task 5–6 尚未整体验收，不能宣称对话/Web 已达到日常一致性标准。本轮未 stage 或 commit，既有源码改动与本地生成物继续保留。

2026-09-14 工作流执行器续作（Task 6，创建/修订/校验已装配，生产未启用）：

- 新增 apps/api/src/teaching-workflow-execution.js 与 teaching-workflow-generation-resolver.js。server.js 在既有关闭开关后接入 createDraft/runner/validateSnapshot；域服务固定 persist:false，只有工作流服务追加已校验内容版本，不提前写 Assignment、Submission、模型运行或正式资产。未执行新增表迁移、Prisma 生成或已有服务重启。
- 生成先检查教师学生权限、学生可接收新工作状态、年级和教材审批，复用 prepareAssessmentDraftInput，仅取已确认批改/错题信号。HTTP 白名单补 requestedItemCount、difficulty、contentScope 及每日 requestedItemCount/requestedItemTypes；缺教学条件/证据保留 needs_input 且不调用模型，模型不可用或动态兜底不能伪装成成功草稿。当前由调用方根据已确认需求填结构化条件，不宣称任意自然语言已自动解析。
- 生成通过 draftAssessmentService 的共享模型链，rubric 加入模型契约，缺失时仅使用现有受限修复槽。题目评分元数据、dayId 和共享阅读材料映射为稳定 questions/days/sharedMaterials，再校验并重建来源包。模块校验同时拒绝选择题缺选项、依图题缺图形，防止局部修订移除必要结构。
- 批改依据原提交 OCR/外部识别包与服务端来源包，强制绑定 archiveEvidence；已存在可信不可变归档时直接读取快照，服务层核验后复用逐题确认，不再调用模型。缺 OCR 题目或未登记外部参考答案仍需旧工作台补齐，本入口没有新增图片识别或猜造答案路径。
- 自然语言修订可只带 targetQuestionIds 和 instruction；手工修正仍用显式 patch。生成模型只接收目标题和关联材料/日期；批改重判复用 gradeSubmissionService，明确客观题本地比较、主观题携带 teacherContext 走共享模型。验证来源/上下文变化、取消、越界题号和不完整输出，保留未选中题与不可变历史；确认不调用模型，也不自动归档。
- 验证：工作流执行/来源解析、HTTP/CLI、创建修订生命周期、事务编排、批改门禁、档案聚合和既有教学 pipeline/prompt/分区回归共 213/213 通过；check:api、Web typecheck、check:skills、check:generation:blueprint、源码/历史编码与 diff 检查通过。历史编码检查按脚本行为刷新了原有扫描报告的时间和文件数，未发现或修复乱码。模型请求测试采用注入网关和合成内容，仓储仍使用内存替身，不证明真实 PostgreSQL 或模型质量。
- check:content-context 连接既有 8787 实例，资料审批、上下文匹配、草稿导出、教师复核/正式导出拦截及测试数据恢复清理通过。该实例没有重启，不能据此证明新执行器已加载。本次样本生成约 122 秒、草稿导出约 40.5 秒，PDF 目标 2 页、实际 3 页；门禁正确返回 ASSESSMENT_LAYOUT_INVALID，正式导出未通过。此项只通过 link-guard，排版与耗时保留为后续真实教学整改证据，不在本轮扩展 PDF 修复。
- Skills 入口与 Playbook 已同步结构化请求、局部修订、可信确认复用及开关状态。准确下一步：旧业务导入/导出 context 与新工作流到 Assignment/图片工作台适配，讲解 HTTP 视图及编辑/确认，再接两个 Web 工作台。数据库及真实 OCR/模型/教学质量验收继续后置；Task 6 尚未整体验收。本轮未 stage/commit，已有源码与本地生成物均保留。

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

2026-09-15 来源上下文兼容续作（Task 6，旧导入/图片批改/导出结构）：

- 先复现答案包 JSON 导入和局部重批丢失 context；修复后同身份的标准包往返保持版本、阅读材料、选项、图形、每日标识与指纹。生成来源包增加题型 context，逐题上下文继续参与指纹。
- 共享 Assignment 投影保留 sourceQuestionNo/sourceContext，映射现有打印所需字段。新登记 Assignment 仍建立版本 1，接口与审计改为返回实际保存指纹，原来源保留为导入证据。修复数字 0、布尔 false 答案被保存逻辑丢弃的问题；不从导入扩展取得教师确认。
- 旧图片批改之前读取了来源包但未完整传给服务层；现在通过独立 submission-grade-input 适配器传递权威包及上下文。集成测试实际经过 gradeSubmissionService 与共享模型调用适配层，模型响应为合成桩，不是真实模型质量证据。
- 学生 HTML、解析 HTML 与布局清单保持来源题号，标签经过 HTML 转义，布局清单保留来源 context。导出测试执行实际纯渲染函数（依赖替身），未启动 API 或渲染真实 PDF，不据此声明排版合格。
- 聚焦测试共 68/68 通过（来源包、导入、Assignment 仓储、旧图片输入、工作流执行、校验、归档与发布、教学链路、导出结构）；check:api 和生成蓝图通过。仓储测试使用替身，API check 仅证明代码加载和现有数据库连接，不是新增表事务验收。
- Web typecheck、源码编码检查（459 文件）、历史编码检查（463 文件）与 diff 检查通过，编码问题均为 0；历史报告仅更新本轮扫描结果。check:content-context 连接未重启的既有 8787 实例，资料审批、上下文、复核/导出门禁和测试数据清理通过；样本 usedDynamicFallback=true，生成约 120.5 秒、草稿导出约 13.5 秒，目标 2 页而 PDF 实际 3 页，正式导出仍被 ASSESSMENT_LAYOUT_INVALID 拦截。此结果只证明 link-guard，不证明本轮新代码运行、模型质量或 PDF 质量。
- 准确下一步：新工作流已确认版本到 Assignment/导出的直接衔接，讲解 HTTP 视图及编辑/确认，再接两个 Web 工作台。Task 6 尚未整体验收；数据库迁移、隔离 Prisma Client、真实 PostgreSQL 和新持久化开关按用户安排后置。既有运行服务未重启，本轮未 stage/commit，既有未收口源码和本地生成物均保留。

2026-09-17 已确认生成版本衔接（Task 6，作业发布与既有导出，开关后实现）：

- 新增 Assignment 发布仓储/服务、POST /api/teaching/workflows/:id/assignment 和 CLI assignment 命令。仅提交 expectedRevision，教师与内容来自服务器；发布前核对逐题确认、版本、当前目标权限和来源包一致性。Assignment 按工作流/版本确定 ID，重放不重复创建，新版本不覆盖旧作业或旧 PDF。首次发布校验学生可接收新任务；停用后的历史重放仍检查教师学生关系。
- 来源包绑定发布后的 Assignment ID，保留工作流版本、原始/发布指纹和题号。共享投影保留选项、图形、材料、每日上下文与 answerFormat；生成执行器保存 printProfile，供后续预览复用。学生专属作业按学生 ID 过滤，不能通过同年级条件泄露给其他学生。
- 发布仅复用服务端存储的内容确认，不伪造排版通过。既有预览与正式导出验证不可变版本；预览不清除已有确认，排版失败仍拦截正式导出。解析 PDF 失败不标记正式导出完成。旧 draft-review 的接受/拒绝与旧答案来源导入不能改写发布版，修改须回到工作流修订并重新确认。
- 发布服务、仓储、HTTP/CLI、目标权限、来源包、执行器、校验及导出守卫聚焦回归 102/102 通过；随后补充实际旧 draft-review 路由的接受/拒绝防改写测试，导出守卫文件 6/6 通过（新增 1 项）。事务使用内存串行写时复制适配器，导出使用实际函数/路由与渲染替身，不证明真实 PostgreSQL 隔离或 PDF 质量。
- check:api、check:generation:blueprint、check:skills、Web typecheck 与 diff 检查通过；源码编码检查 462 文件、历史编码检查 466 文件均为 0 问题，历史报告仅更新扫描结果。API 检查仅证明代码可加载及既有数据库连接。API 契约、generation 入口 Skill 和 Playbook 已同步发布/预览/正式导出顺序及失败边界；没有改变模型策略或增加调用。
- check:content-context 连接未重启的既有 8787 实例，资料审批与注入、复核/导出拦截和测试资料/数据库/文件清理均通过。样本 usedDynamicFallback=true，草稿生成 120380ms、导出 8854ms，目标 2 页但实际 PDF 3 页；正式导出被 ASSESSMENT_LAYOUT_INVALID 拦截。此结果只证明旧运行实例的 link-guard，不证明新发布路径已运行，也不能作为生成质量或排版合格证据。
- 准确下一步：补齐讲解 HTTP 视图及编辑/确认，再进入两个 Web 工作台。Task 6 尚未整体验收；数据库迁移、隔离 Prisma Client、真实 PostgreSQL 与生产启用继续按用户安排后置。TEACHING_WORKFLOW_PERSISTENCE_ENABLED 保持关闭，既有服务未重启；未 stage/commit，既有源码及本地生成物均保留。

2026-09-17 讲解查看、编辑与确认续作（Task 6，开关后实现）：

- 先用 5 项失败测试复现讲解正文被 HTTP 丢弃、确认只识别题目 ID 和讲解保留测评字段等缺口，再补齐共享契约。content.explanation 返回概念、步骤、例题/解析、易错点与确认状态；保留教师身份过滤，不向调用方暴露内部确认凭据。讲解清除 questions/sharedMaterials/days、总分、旧答案包及 parsed 副本。
- 既有 command 新增显式 targetExplanation=true；自然语言 revise 带 instruction，手工 revise 用完整 replace_explanation patch，confirm 表示教师确认整份讲解。讲解目标与题目目标不能混用，测评/批改不能伪装成讲解动作。创建、编辑与模型返回均剥离伪造确认；修订撤销旧确认，历史恢复追加版本并通过当前校验后复用服务端确认，不改写历史。
- 自然语言修订复用共享 generation 规则、Astra 路由及既有一次受限修复，传递讲解正文与服务器教学上下文；手工编辑、确认及恢复不调用模型。通过实际执行器/服务/仓储和本地 HTTP 测试验证一次修复、修复失败保留旧版、来源变化先拦截、取消后的迟到输出不能提交。
- 讲解专项 7/7 通过；关联回归 114 项通过、0 失败，9 项真实 PostgreSQL 测试未启用而跳过。随后增加实际 CLI 子进程的讲解创建/编辑/确认/重读测试，该 CLI 文件 8/8 通过。模型响应是合成桩、事务为内存适配器，不据此声明模型教学质量或真实数据库验收。
- check:api、生成蓝图、Web typecheck 通过；API 仅验证代码加载及既有数据库连接。API 契约与 generation Skill 已同步具体命令和确认边界；既有生产服务未重启，持久化开关仍关闭，未执行迁移或 Prisma 生成。
- check:skills、源码编码（462 文件、0 问题）及 diff 检查通过。check:content-context 在既有 8787 实例通过，样本 usedDynamicFallback=true，生成 120203ms、预览导出 9939ms；本次目标与实际 PDF 均为 2 页，未确认时正确返回 DRAFT_REVIEW_REQUIRED，脚本模拟教师确认后两份正式 PDF 均返回 200，随后资料/索引/文件/数据库测试记录清理通过。这是旧运行实例的 link-guard 证据，不是本轮讲解部署、真实教师质量认可或稳定排版验收。
- 准确下一步：Task 7 生成 Web 工作台，随后 Task 8 批改 Web 工作台；外部来源登记与真实质量验收仍需后续补齐。讲解确认不发布 Assignment、不建立测评答案包、不导出正式讲解 PDF；本轮不能声称 Web 与对话已达到日常使用一致性。工作区既有改动与产物保留，未 stage/commit。

### Task 7：生成工作台

**Files:**
- Create: `apps/web/src/components/GenerationWorkbench.tsx`
- Modify: `apps/web/src/api.ts`、`apps/web/src/main.tsx`、`apps/web/src/styles.css`
- Modify: `scripts/web-generation-workbench-ui.test.mjs`

**Interfaces:** api.ts 增加与 Task 6 相同的 create/get/execute 包装；组件接收 WorkflowView 与操作回调，模型策略与 prompt 不进入组件。

- [ ] 先记录当前登录后路径与“局部修改会创建整项新任务”的现象；避免以静态源码字符串断言证明真实可用。
- [x] 实现组件三部分：任务要求/条件、题目与解析成果、局部对话与版本；继续使用现有样式和基础控件。
- [x] 局部动作提交明确 IDs 与 expectedRevision：

```ts
await executeTeachingWorkflow(view.id, {
  operationKey: crypto.randomUUID(), expectedRevision: view.revision,
  action: 'revise', targetQuestionIds: [selectedQuestionId], instruction: feedback
});
```

`executeTeachingWorkflow(id, command)` 在 api.ts 定义为 POST Task 6 commands 路由并返回 WorkflowView。一次用户操作的重试必须复用同一个 operationKey，不能在每次 fetch 重试时重新生成。

- [x] 输入完整时直接执行，明确冲突才提问；保存未提交编辑，版本冲突保留本地文本并提示刷新比较。
- [x] 内容 ready 后先展示编辑区，再独立请求预览；继续复用学生卷/解析卷导出门禁。
- [x] 浏览器验证：自然语言创建纯计算专项；只改一题且其他题不变；刷新保留成果；CLI 修改后 Web 能获取新版本；旧版保存返回冲突；取消和继续有可理解状态；学生预览无答案。（合成模型与内存仓储，非真实质量验收。）
- [x] 窄屏采用区域切换，保持当前题目选择，不要求三列强行挤在一屏。
- [ ] 运行 `npm.cmd run typecheck --workspace apps/web`、`node --test scripts/web-generation-workbench-ui.test.mjs`、编码检查；记录浏览器实际结果后提交 `feat: add editable generation workbench`。

Task 7 衔接记录（2026-09-17）：

- Web 已启动在 http://127.0.0.1:5173/，API 沿用 http://127.0.0.1:8787；登录页已真实渲染并检查浏览器异常。修复 core 总入口重新带入 node:crypto 导致的开发白屏，使用浏览器安全入口，保留 Node 指纹实现。
- 已增加 GenerationWorkbench 与教师导航切换，以及教师隔离、模块筛选、字段过滤的工作流列表 API。内容与确认从同一服务端读取；重试保留请求键/操作键，历史查看不降低列表当前版本，编辑提交期间锁定输入，冲突保留文本。
- 浏览器 3/3 通过：工作流创建/自然语言单题修改/手工修改、刷新恢复、CLI 并发确认后的 409、确认与历史追加恢复、取消后拒绝迟到结果与刷新保留、讲解确认后手工修改撤销确认、学生预览隐藏答案、390×844 窄屏切换。还验证实际教师页面在 404 HTML 与 503 JSON 下显示未启用，旧入口可切回；该登录为全 API 拦截的合成会话，无真实凭据提交。
- PDF UI 测试替身验证排版不通过时不发正式导出请求，通过后同时展示两卷；不代表本轮生成过真实 PDF。自然语言模型调用为 4 次合成输出，手工修改/确认/恢复不增调用；不代表真实模型质量。
- Web typecheck/build 通过，构建不再出现 node:crypto 外部化警告；路由/Assignment/服务/旧 UI 聚焦测试 66/66、check:api、check:generation:blueprint 通过。源码、skills 与 diff 检查见本轮终端结果。未补做旧界面的“整项重生成”历史基线观察，首项仍未勾选；既有混合改动未 stage/commit，末项保留未勾选。
- 收尾校验：源码编码 464 文件、0 问题，check:skills、generation 的 quick_validate 与 git diff --check 通过。check:services 退出 0，但不能将顶层 ok 视为质量通过：问答 6756ms、今日任务 10124ms 调用成功，生成 120032ms、20 题/60 分且 usedDynamicFallback=true；听写只检查计划结构。全程 persist:false；该旧服务样本并非新工作流真实模型验收，兜底与耗时仍需 Task 9 处理。
- 可复现入口：先启动 Web，再将 PLAYWRIGHT_MODULE_PATH 指向已有 Playwright 模块；本机使用 `C:/Users/86188/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`，设置 PLAYWRIGHT_CHANNEL=msedge，运行 `npm.cmd run check:web:teaching-generation`。可用 WEB_BASE_URL 指定实际 Web 地址。截图在系统临时目录 junhang-generation-web-qa，未加入仓库；没有安装浏览器。Browser 插件不可用，使用已有 Edge 无头模式。
- 准确边界：持久化开关保持关闭，既有 API 未重启，新表未迁移，隔离 Prisma 客户端和真实 PostgreSQL 事务问题仍后置。日常业务继续使用旧入口。下一实施任务为 Task 8 批改工作台；正式模型/OCR/教学质量与实际 PDF 验收在 Task 9。不得因本轮浏览器通过宣称生成与批改已全面达到对话/Web 日常一致性。

### Task 8：批改工作台

**Files:**
- Create: `apps/web/src/components/GradingWorkbench.tsx`
- Modify: `apps/web/src/api.ts`、`apps/web/src/main.tsx`、`apps/web/src/styles.css`
- Create: `scripts/web-teaching-grading-browser.test.mjs`、`scripts/test-support/grading-workflow.mjs`、`apps/api/src/teaching-workflow-grading-ui.test.mjs`
- Modify: `apps/api/src/teaching-workflow-execution.js`、`apps/api/src/teaching-workflow-routes.js`、`packages/services/src/teaching-workflow-service.js`、`packages/services/src/teaching-workflow-validation.js` 及对应测试、API/Skills 说明

**Interfaces:** 复用 Task 6 commands；直接编辑识别或评分产生 revise patch；选定已检查题目以 confirm 指定 targetQuestionIds，不由浏览器传 confirmedBy。

- [x] 保留既有批次筛选、上传、来源登记、原图查看与逐题复核入口；新增独立工作台组件，不重写其他模块。
- [x] 增加原图区域定位、识别文本/答案/评分点并列、疑点优先切换、当前题对话重判；核对坐标以对应图片为准，不能混用不同裁剪空间。
- [x] 直接修正识别使用如下 command 结构，由共享批改服务只重判本题（客观题仍优先本地比较）：

```ts
await executeGradingWorkflow(view.id, {
  operationKey, expectedRevision: view.revision, action: 'revise',
  targetQuestionIds: [question.id],
  patch: { type: 'correct_recognition', questionId: question.id, value: { studentAnswer: correctedAnswer } }
});
```

- [x] 确认操作只作用于明确选中且已检查的题；服务端继续拒绝无法评分或缺失证据的确认，不增加前端一键放行逻辑。
- [ ] 浏览器验证：上传清晰作业 → 定位题目 → 修正一处识别 → 只重批该题 → 查看逐题合计 → 确认归档；再验证模糊题不自动判零、合理异解说明、可信对话确认复用和伪造 JSON 确认拒绝。
- [ ] 运行 `npm.cmd run typecheck --workspace apps/web`、`node --test scripts/web-grading-workbench-ui.test.mjs`、编码检查；记录浏览器证据后提交 `feat: add evidence based grading workbench`。

Task 8 衔接记录（2026-09-17，工程实现与合成验证，未生产启用）：

- 新增 GradingWorkbench，原图、逐题核对、修改与归档三部分共享当前任务/题目；窄屏切换区域保留未保存编辑。旧批次筛选、上传、来源登记继续原入口；停用学生不进入新批改来源选择。404/503 明确显示暂未启用。
- 新增识别修正命令 correct_recognition；服务端保留原置信度、题干和图片坐标，建立教师修正凭据后只重批该题。旧完整题目 patch 改作答也不能绕过重判。纯评分/解析修改不增加调用；被修改题撤销确认，未变化题继续原确认。缺失作答是 null，教师核对的空白才是空字符串。
- 分开识别证据不足与评分待定：证据已核清时允许教师手工修正 uncertain 评分或要求重判；uncertain 本身仍不能确认或归档。浏览器先复现评分待定时编辑按钮被误禁用，再修复对应条件并回归。
- 原图标记核对页码、图片引用、裁剪空间及归一化坐标边界；不把裁剪坐标套到整页。逐题暂计和确认总分由服务端计算，不信任 Web 汇总分或上传的确认凭据。
- 浏览器入口 `npm.cmd run check:web:teaching-grading`，使用已有 Playwright 与 Edge；配置方式与 Task 7 相同。实际教师页在 127.0.0.1:5173 上验证两图 multipart 上传、停用学生筛选、来源入口与 404/503 回退，全部 API 拦截为合成数据；临时 127.0.0.1:5174/__grading 页面挂载真实组件，经 HTTP 服务/CLI 和内存事务验证完整版本动作。Browser 插件不可用，没有安装依赖。
- 合成工作流验证单题修正、合理异解说明、手工评分、CLI 修改导致 409 后保留文本、刷新恢复、逐题确认、独立归档和历史追加恢复。另从独立服务端归档读取已确认版本，Web 直接显示确认总分且模型调用数不增加。模型伪造确认、低置信和证据变更由 API/服务测试拒绝。
- 聚焦 API/服务/CLI/旧 UI 回归 122/122 通过；原评分校验测试因为修改作答必须重判而暴露缺少 runner，补入单题评分替身并新增断言，没有放宽业务门禁。执行器额外验证教师校正后的客观题走真实共享服务本地比较、不调用模型且保留原 0.2 识别置信度。
- 浏览器最终 2/2 通过，桌面 1500×1000、窄屏 390×844 无横向溢出，运行时无 pageerror 或 Vite 错误遮罩；截图在系统临时目录 junhang-grading-web-qa。该场景共 3 次合成批改服务调用，识别修正/自然语言重判各处理一题，纯评分、确认、归档和读取可信已确认归档不增加调用。Web typecheck/build、check:api、check:skills 和 grading Skill quick_validate 通过。
- check:content-context 连接未重启的既有 8787 实例，资料上下文、复核门禁、草稿和两卷正式导出及测试数据/文件清理通过。本次草稿 120214ms，usedDynamicFallback=true；草稿导出 9873ms，正式导出 18020ms；结构检查 PDF 为目标 2 页，双卷 HTTP 均 200。此项仅是旧实例 link-guard，未做本轮 PDF 视觉或内容质量验收，也不证明新持久化链路已经运行。
- Task 8 的真实清晰/模糊图片、OCR 与模型正确率验收仍未完成，第五项保持未勾选；合成图片与模型输出不能替代真实教学证据。源码仍与前序未收口改动共存，未 stage/commit，最后一项保持未勾选。
- 准确下一步为 Task 9 可追溯质量与跨入口验证。数据库迁移、隔离 Prisma Client 和 PostgreSQL 事务验收继续后置；TEACHING_WORKFLOW_PERSISTENCE_ENABLED 保持关闭，既有 API 未重启，没有新持久化生产启用或真实学生批改归档。

## 阶段四：真实教学验收

### Task 9：可追溯质量与跨入口验证

**Files:**
- Modify: `scripts/generation-quality-check.mjs`、`scripts/generation-quality-check.test.mjs`
- Modify: `scripts/replay-grading-gold.mjs`、`scripts/grading-quality-check.mjs` 及对应测试
- Create: `scripts/teaching-workflow-acceptance.mjs`、`scripts/teaching-workflow-acceptance.test.mjs`
- Create: `docs/teaching-workflow-acceptance.md`（实际执行后写入结果，不预填通过）

**Interfaces:** 评测使用现有教师 gold 契约；增加只含合成数据的 CLI/Web 一致性场景。真实报告输出到 `tmp/quality/`，只把脱敏结论与命令写入 docs。

- [x] 先测试评测器会拒绝这些假成功：模型 unavailable、动态兜底、实际结果缺失、没有教师标签、缺少独立执行来源记录、端到端图片任务只跑了文本而声称 OCR 通过。模型输入构造测试必须证明 expected/teacherReview 标签没有进入待评估请求；actual 来自 runner，禁止采集器直接复制 expected。正确结果可以与标准答案相同，不能仅因文本相同就判为标签泄漏。
- [x] 将相同源任务分别经 CLI 与 Web/API 运行，比较规则哈希、规范化上下文、内容修订、评分汇总和确认版本；独立生成不要求题目逐字相同。（合成模型/内存事务证据；真实持久化未启用。）
- [x] 合成能力探针先验证 Astra、Sol、Flash 的文本/JSON/图像输入、响应提取、usage 与超时；网关不支持时明确记录，不能声称本计划模型链已生效。（9项实际网关能力通过，配置30秒上限；超时退出依赖工程守卫测试，不声称此次触发了网关超时。）
- [ ] 使用同一原图分别比较现有 OCR 与 Flash；记录题号对齐、手写识别、过程保留及裁剪效果。在真实样本证据具备前保持原默认识别路线。
- [x] 复用已确认 gold 的独立评估副本，运行现有入口：（10份已回放，1份本地比较成功、9份不可用，整体未通过；不等于生产主观质量验收。）

```powershell
cmd /c npm.cmd run replay:grading:gold -- --gold tmp/quality/grading-gold-cases-20260909.json --output tmp/quality/grading-workbench-astra-evaluation.json --model gpt-6-astra
cmd /c npm.cmd run check:grading:quality -- tmp/quality/grading-workbench-astra-evaluation.json
```

上述源路径来自既有样本位置，执行前验证存在、确认记录与本次输入范围。真实费用调用只在实施已授权范围及已明确预算内执行。回放保持 `persist:false`，不得写正式档案，也不能把文本回放等同于完整图片测试。

- [ ] 生成使用真实教学要求覆盖 focused、multi_day、comprehensive、explanation；分别检查题目/答案/解析和打印，不能只依赖旧综合蓝图质量脚本。
- [ ] 记录每项教师修改题数、评分修改、要求遗漏、完成时间、模型调用次数、tokens/费用（未知保持 unknown）及最终是否可用于教学。调试用例与留出样本分开。
- [ ] PDF 检查学生卷无答案、解析完整、页数和作答空间；运行 `check:generation:layout` 并实际渲染抽查。生成输出变化后按范围运行历史编码检查，保护其已有报告改动。
- [ ] 大链路完成后执行 `check:api`、`check:content-context`、Web typecheck 和相关聚焦测试；只有发布前或确需全链路才执行 `check:teaching-content:full`。
- [x] 填写验收报告：工程结果、真实质量、样本覆盖、教师评价、局限和下一动作。未经用户确定的时长/成本/修改量阈值不得擅自标为达标。
- [ ] 按明确路径提交脚本与脱敏报告，真实素材/会话/导出物留本地；计划各项只有获得相应证据后才勾选。

Task 9 衔接记录（2026-09-17）：

- 本轮实际证据见 `docs/teaching-workflow-acceptance.md`。新增独立模型能力/四类生成采样和同原图 OCR 对照入口，保持 `persist:false`，未切换默认模型或识别路线。
- 评测器先复现假成功/非法结构问题再修复；回放隔离教师标签，补齐执行关联、未知修改量、程序接口模型覆盖、逐份检查点和连续失败停止。成功文本回放不能作为 OCR 或主观模型准确率证明。
- CLI/HTTP聚焦测试32/32、真实浏览器合成工作台生成3/3与批改2/2通过，API检查、蓝图、Web typecheck、Skills检查通过。浏览器沿用已有Playwright/Edge，无安装；模型与事务替身只验证契约。
- 真实生成：专项54.7秒、每日51.9秒、讲解46.5秒，形成有效草稿；综合小测120秒后分区失败、动态兜底被拒绝。前两份为执行器校验与内容抽查，报告保留采样时质量字段尚未接入的差异。
- OCR：同两页原图，原路线18.8秒返回20题；Flash两次均失败。诊断发现四次响应都达到单次2000-token上限且JSON无效，需定位输出截断/预算策略。没有教师转写与裁剪对照，OCR验收项保持未勾选。
- 完整数学gold回放10份/224题，1份20题本地比较成功、5份约180秒预算耗尽、4份响应后质量校验失败；脚本和评测器均正确退出1。9次Astra调用，已知50766 tokens且5次usage未知。单模型诊断关闭额外尝试，旧采集输入缺少context/独立过程字段，不据此宣布生产链路或模型优劣。
- 新检查点用20题本地比较实测，最终文件与逐份记录一致，0模型调用、persist:false。源码最后复查与历史编码检查分别480/483文件、均0问题；历史报告按现有命令刷新，无自动修复。
- 内容抽查发现每日题干内部编号和作答区域信息不足；尚无教师对本轮生成结果的评价、三科留出样本或正式双卷PDF视觉验收。这些项目不因单测通过而勾选。
- 未重复 Task 8 的旧实例 `check:content-context`，它不能证明本轮新工作流生产可用。继续保留数据库迁移、隔离Prisma Client、新表PostgreSQL事务验收的后置安排和关闭的持久化开关。
- 后续先处理报告中的生成分区、批改响应和OCR输出完整性问题，再做教师质量及打印验收。混合工作区未stage/commit、未清理历史素材。

2026-09-18 续作记录（Task 9 工程复测继续）：

- 修复 `apps/api/src/teaching-workflow-execution.js` 对 `audit.status="passed"` 的判断，并保留旧 `auditPassed` 字段兼容。真实综合生成四个分区均成功，耗时71396ms，无动态兜底，内容质量校验通过；报告为 `engineeringPassed=true`，但 `productionReady=false`，仍未教师确认、持久化或正式导出。
- 修复 Flash OCR 在结构校验前的字段规范化，覆盖数字题号、`prompt/answer`、字符串置信度和 `pageRegion`，并将双页共享预算从16000提高到24000。真实同原图复测返回20题、有效JSON 2/2、耗时51477ms、未超时。输出为 `tmp/quality/teaching-ocr-flash-20260918-after-24000.json`；默认 MiniMax OCR 未切换。
- 新增规范化和预算回归后，Flash OCR 3/3、AI runtime/model policy 22/22、教学工作流执行15/15通过。最新生成和 OCR 报告均保持 `persist:false`，未写真实学生数据。
- Flash 的题号、手写答案、过程和 bbox 仍没有教师逐题 gold，OCR 准确率保持未知；综合样本也不是教师选定留出任务，生成和正式 PDF 视觉验收仍未完成。
- 当前准确下一步：补齐批改回放的 context、类型、独立过程字段及安全失败原因；由教师提供 OCR 转写/裁剪对照和生成留出样本评价；随后再做正式双卷 PDF、持久化迁移、隔离 Prisma Client 和 PostgreSQL 事务验收。

## 执行与恢复说明

2026-09-18 续作记录（Task 9 批改证据与诊断）：

- 已修复 collect/replay 的上下文、题型、图形及独立识别过程/坐标字段丢失，保留脱敏与评估标签隔离；缺字段只记录覆盖，不伪造补全、不撤销教师确认。
- 真实回放4/10后连续3份约180秒失败而停止，随后2份最小复测仍一份本地成功、一份约180秒失败。原失败报告保留 model_unavailable；修复 runner deadline 提前返回导致的诊断缺失后，以受控 transport 验证超时码穿过 pipeline/replay/评测器，未再次重复付费超时验证。
- 重新只读采集40份，10份/224题 gold仍有效；补回首份20个坐标，独立上下文/题型/过程源字段仍为空。发现2份共25题仅保存教师确认摘要而非原始作答，新增回放前置拦截，不用答案键补造学生作答。
- 新采集前两份真实服务回放：16ms本地比较20题、3ms拒绝24题含确认摘要的整份输入，0模型调用，退出1为预期。证据见验收记录及 tmp/quality/grading-20260918-evidence-guard-v2.json。
- 下一步恢复摘要题的原始作答证据，按实际依赖补材料/过程，再运行有完整输入的小批主观题对照；Task 9仍未达到日常使用验收标准。所有提交、清理等工作区收口操作延后到计划完成，遵循用户本轮明确安排。

2026-09-18 续作记录（Task 9 原始图片补采）：

- 只读定位两份摘要记录的6个附件名，从同项目原对话用户消息恢复6张嵌入JPEG，并核对数据库附件集合及图像哈希。25题全部定位，23题形成明确转写候选，综合卷第4题的数字、第25题的手写单位仍需核对；未知作答保留null。
- 独立候选包补入11题可辨过程和6题印刷选项，25张裁剪以图像来源、页码、旋转与坐标绑定。对照页和来源清单位于 `tmp/quality/grading-evidence-recovered-20260918/`，未覆盖原gold或教师确认记录。
- 当前准确下一步：核对两处字迹及新转写，再生成新的评估副本并做有完整输入的小批主观题回放。此次没有模型调用或数据库写入，Task 9教学质量验收仍未完成；提交、清理、迁移和持久化启用安排不变。

2026-09-18 续作记录（Task 9 清晰候选小批诊断）：

- 未确认新转写前，仅使用第23、24题做独立诊断，不将候选包改为教师gold。先复现并修复服务层丢失过程/图片引用、匹配最终答案跳过过程评分的问题；保留显式null识别，客观题既有本地比对回归仍通过。
- 首次真实Astra调用35.616秒完成2题，暴露服务层自动补造第1页题框的问题；修复缺失/非法坐标保持null后，同题24.363秒再次完成。两次各调用1次，预算60秒/6000输出tokens，不追加Sol，均待教师复核、不可归档、未写库。详见验收记录和`tmp/quality/grading-recovered-subjective-probe-20260918-location-fix.json`。
- check:services烟测执行完成，其中英语生成使用动态兜底，只证明链路可运行；不升级为生成质量通过。Task 9仍需新转写核对、错误/部分正确题的完整证据及正式金标对照。数据库迁移、持久化开关、提交和清理均保持后置。
- 聚焦回归74/74通过，覆盖服务层过程证据、空值与题框、真实HTTP载荷、既有客观比对、归档门禁及API来源优先级；旧API静态位置断言已升级为共享模块的运行行为验证，保留拒绝篡改包和PDF来源关联边界。check:api及git diff --check通过。

2026-09-20 续作记录（Task 9 错误及部分正确样本）：

- 从恢复原图补入综合卷第28、29题的真实错误过程，用Astra单次44.765秒得到partial、各3分，与历史教师评分一致；反馈定位抄数错误和乘法首错，保留正确数量关系与后续计算。
- 分配律小测第6题单次22.152秒返回uncertain、分数null：识别选项错误，但历史答案包的过程评分说明与题型存在冲突。已提出是否仅按选项2/0分的具体核对，尚未修改规则或历史归档。两处既有字迹疑点也继续待核对。
- 新产物为 `tmp/quality/grading-error-evidence-20260920/review.md`、3题候选转写、逐份诊断及哈希核验；旧文件未覆盖。2次调用总计6072输入/2049输出tokens，未追加模型调用、未写库。
- 30项相关回归及check:api通过。当前准确下一步是取得该选择题评分规则及候选转写核对，按确认范围建立独立评估副本；另行推进生成内容与打印验收。Task 9不勾选为完成，数据库迁移、持久化开关、提交和清理仍后置。

2026-09-22 续作记录（Task 9 生成与草稿打印）：

- 修复共享生成pipeline将本分区dayId题首编号带入题干的问题；结构化每日绑定及正文保留，模型输出契约要求正文不重复编号或分值。修复质量验收器未读取metadata.score的误报，缺分和错误总分仍阻断。两项回归均先复现失败再修复。
- 复用三份已保存真实生成样本，在隔离进程执行实际API纯打印函数和无头Edge，生成学生/解析共6份PDF、12页A4，并完成文本、DOM作答区及逐页图片检查。无模型调用、数据库写入或教师确认；不是HTTP正式导出验收。完整证据在`tmp/quality/generation-print-20260922-v3/`，旧模型样本未变。
- 综合学生卷版式通过；专项/多日卷出现几乎空白的第二页，版式检查失败。多日目标未显示，标题仍取第一天；计算作答区约18mm。综合第11—14题还存在结构化4分与题干/rubric 5分冲突，因此三份样本均不能标记教学质量验收通过。
- 52项相关回归和生成蓝图检查通过。准确下一步：先统一分值/题干/rubric，再修按用途分页、每日目标与标题和书写空间，使用同样本重验；批改教师核对项并行保留。Task 9仍未完成，数据库迁移、持久化启用、提交和清理继续后置。

2026-09-22 续作记录（Task 9 已实施分值和打印修正）：

- 综合分值计划前移到模型调用之前，生成后保留原分值；明确题面/rubric冲突会被pipeline、服务审查、工作流及质量验收拦截，不再靠重分配数字凑总分。已同步共享runtime-rules。原综合样本的选择题4题和计算题4题均被当前校验识别为冲突，新独立候选逐题重写评分点，不修改旧报告或教师确认。
- 统一按purpose计算打印计划；学生/解析/坐标清单共享每日目标，专项和多日按实际内容分页，取消这两类自动双面留白；数学计算/验算空间分别32/48mm。导出适配器仍拦截真实页数与计划不符，未绕过教师确认。
- 三份保存样本经当前服务和工作流校验回放，生成6份PDF、11页A4。专项/多日学生卷各1页，综合2页，三份均通过PDF版式检查及图片检查。证据为`tmp/quality/generation-print-corrected-20260922-v2/`；0真实模型调用、0数据库写入，修订草稿未获教师确认。详细校验与限制见验收记录。
- 下一步是教师评价修订评分点、内容与书写空间，随后补新规则真实生成及留出任务；批改字迹和评分规则核对项继续保留。Task 9不标为完成；全量E2E、迁移、新表事务、正式双卷发布、提交及工作区清理仍后置。

2026-09-22 续作记录（Task 9 新规则真实生成未通过）：

- 新真实综合小测102.928秒未通过，诊断修复后单次复测71.372秒仍未通过。两次均为填空/选择/计算成功、应用题分区拒绝；第二次已记录rubric_score_conflict。失败正文未保存，尚不能确定为模型给分错误还是自然语言校验误判；不放宽规则或伪造通过。
- 修复内部错误码被统一隐藏的问题，白名单保留生成类具体错误，任意文本仍过滤；验收增加快照创建前的失败门禁摘要。两项回归先失败后修复，贯穿实际服务的第三项回归确认评分分区失败及兜底始终被工作流阻断。相关46项测试、check:api通过。
- 证据为`tmp/quality/teaching-comprehensive-20260922-live-scoring.json`与`tmp/quality/teaching-comprehensive-20260922-diagnostic.json`。旧补题路径将缺失应用题补成8分题，最终18题/68分被审查和快照门禁拦截，未生成PDF、未写库、无教师确认。两次共8个分区调用，无Sol追加；不再盲目付费重跑。
- 准确下一步：为隔离诊断保留安全筛选后的最小逐题评分证据，定位应用题评分冲突，验证必要的局部修复后再验真实草稿与打印。批改教师核对项继续保留。Task 9仍未完成，提交、清理、新表迁移与持久化启用继续后置。

2026-09-22 续作记录（Task 9 评分误判根因已修复）：

- 单独4道应用题真实诊断63.997秒，取得最小评分证据：每个分号分句可能包含多个给分点，旧校验只取末项，将实际6分误算3分。已在共享函数累计全部明确给分点；先失败后通过的回归同时保持7分/score6冲突拦截，同证据4题重检通过。
- 新整卷71.702秒生成18题60分，4个分区成功，无兜底。原快照打印学生2页/解析4页A4，学生版式检查通过，实际PDF文本与图片检查未见明显裁切。完整证据在`tmp/quality/generation-live-print-20260922/`，没有教师确认或正式发布。
- 审查又发现短解析被服务层覆盖为通用三句、整卷沿用首个分区标题。已保留已有具体推理，取消靠机械三句判断完整性的要求，与现有pipeline非空结构契约对齐；整卷使用年级/学科/kind标题，保留教师标题优先。共享规则与回归同步，原样本与PDF不回写。
- 最新真实复测68.234秒：应用题已通过，计算题评分冲突导致整卷被拦截。该次没有正文证据，不能猜测根因或宣称稳定可用；本轮停止付费重跑。常用验收脚本已接入安全筛选后的最小逐题评分证据，并用本地模拟HTTP网关验证不会增加调用。
- 本轮84项相关回归、生成蓝图、check:skills通过；共9个真实分区调用、无Sol追加、未写库。准确下一步为计算题单分区证据诊断，再做最新代码下整卷内容和打印检验。Task 9仍未完成，教师批改核对、数据库迁移/新表事务、提交和清理继续后置。详见验收文档最新记录。

2026-09-22 续作记录（Task 9 计算题与选择项验收）：

- 计算题单分区51.805秒通过4题，本次未复现历史评分冲突。整卷68.243秒得到18题60分，标题及短解析保留，但逐题检查发现选择项为[object Object]；该样本和打印稿保留为失败证据，旧engineeringPassed不等于教学质量通过。
- 已复现并修复服务层对象选项字符串化：共享规范化只接受已有字符串或明确label/text对象，不删坏项/重排/猜字母。pipeline、服务审查、工作流及质量评估同步拒绝占位符。旧快照现在准确拦截q7—q10，原哈希不变；89项聚焦回归及蓝图、Skills、API、Web typecheck通过。
- 修复后最后一次真实整卷51.348秒，填空/选择通过，计算/应用题在可校验内容返回前失败，记录configuration且无usage，缺少具体上游状态；不能称为评分冲突或超时。准确下一步是安全失败诊断，再验最新代码下真实整卷和打印，停止盲目付费重复。详见验收记录及`tmp/quality/teaching-comprehensive-20260922-options-fix.json`。
- Task 9不勾选完成；教师批改核对项、新表事务/迁移、持久化启用、提交与清理继续后置。

2026-09-22 续作记录（Task 9 最新综合/专项验收与上游503）：

- 补齐runner脱敏HTTP状态/白名单错误码，未知文本不保留；先复现缺字段，再验证模拟HTTP失败贯穿真实transport、服务及验收报告。30项聚焦回归、蓝图、API现有连接、Web typecheck通过；预算、路由和重试次数未调整。
- 新综合114.367秒完成18题60分，新专项101.775秒完成4题20分。答案、选项、过程与评分点已复算，原样生成4份共7页A4草稿PDF，学生卷版式及全部PDF图片检查通过；教师复核入口`tmp/quality/task9-review-20260922/review.md`。综合存在两题彩笔平均分情境重复，教师需评价；不能称为已教师验收或稳定生产可用。
- 新多日32.713秒失败，两个分区的Astra主调用和Sol各一次替补均HTTP 503，usage未知，无有效快照。已停止追加真实调用，保留故障证据；讲解仅用9月17日旧样本通过当前共享validator零调用重检，正式讲解打印仍缺。旧configuration失败未复现，原因仍未知。
- 本轮9次真实调用，已知18421输入/8511输出tokens，4次usage未知，费用未知；全部persist:false。教师第6题评分规则、新转写/OCR gold及教学评价仍待核对，“继续操作”不代替具体确认。原样本、历史评分未改。
- 下一步在上游恢复后补多日/讲解新样本，并取得具体教师评价后扩展留出覆盖；Task 9仍不勾选完成。重型内容E2E、迁移、新表真实事务、持久化启用、提交和清理继续后置。

2026-09-23 续作记录（Task 9 网关失败可追踪信息）：

- 用户要求补齐503定位，已在transport和runner新增有限请求编号/来源、固定上游原因提示、Retry-After及每次调用UTC开始时间/耗时；未知保持unknown/null，敏感原文和任意响应头不入记录，业务projection不新增内部字段。没有调整路由、并发、预算、重试次数或默认OCR。
- 本地HTTP模拟先失败后通过，50项聚焦测试及API检查通过。真实付费调用0次、业务写入0次；9月22日旧503报告不回写，不能声称已恢复或查明历史根因。具体字段、证据及下一次有界采样方法见`docs/teaching-workflow-acceptance.md`的9月23日记录。
- Task 9仍需上游恢复后的多日/讲解样本、教师评价和批改/OCR候选核对。迁移、新表事务、持久化启用、提交和清理继续后置。

2026-09-23 续作记录（Task 9 多日/讲解最新样本）：

- 沿用原预算，新多日51.482秒完成两天各2题、共20分；两个Astra分区首次成功，无503、Sol或兜底。逐题复算及每日归属通过，原样打印学生/解析各1页A4，layout和实际图片检查通过。第4题层级评分末句可能歧义，留给教师评价；未修改原文。
- 新讲解41.821秒、一次Astra成功，概念/6步推导/2例题/5项易错辨析完整，数学复算通过。没有临时将讲解套成试卷，正式讲解打印仍缺。一次成功不意味着历史503根因已消除。
- 本轮3次真实调用，10811输入/4237输出tokens、费用未知，persist:false，无数据库写入或教师确认。新入口`tmp/quality/task9-review-20260923/review.md`及证据摘要保存来源哈希和待评价项，旧报告未变。20项相关回归及蓝图检查通过。
- 四类数学用途已有实际生成样本，但教师评价、批改转写/第6题规则、OCR教师gold、三科/教材/留出覆盖、真实持久化跨入口及正式发布仍未完成。Task 9继续保留未勾选，迁移、提交和清理后置。

2026-09-23 续作记录（Task 9 语文/英语专项初验）：

- 验收脚本新增受限学科选择，语文/英语各真实生成一次4题20分专项，用时66.407/60.627秒；两次Astra成功，合计7447输入/4052输出tokens，无替补或兜底、费用未知、persist:false。样本为脚本构造，不是教师留出任务或教材覆盖。
- 真实英语PDF暴露四线格丢失：模型对象格式未规范化为打印器使用的字符串。已在共享核心、服务及工作流校验补齐明确同义格式转换，并同步runtime-rules。原输出零调用重检只改变4题作答格式，原报告及失败PDF保留；修正英语及语文共4份单页A4草稿完成图片/文本检查。
- 版式检查区分单页短专项和完整试卷，不用凑空白满页证明合格；仍拒绝实际空白页、错误页码与多页异常留白。72项相关回归、生成蓝图、Web typecheck、API及Skills检查通过；没有运行会操作既有数据库/导出目录的重型内容E2E。
- 教师入口`tmp/quality/task9-language-review-20260923/review.md`保留8题及给分点、双卷和哈希。语文实际单行作答区未落实模型两行描述，专项页头仍有通用题型说明，准确下一步是这两处修正及教师实用性评价；拼写部分给分/合理改句政策未擅自确认。三科专项仅初步覆盖，Task 9不勾选完成；批改/OCR gold、真实持久化及正式发布仍缺，迁移、提交和清理继续后置。

2026-09-23 续作记录（Task 9 作答行数和页头已修正）：

- 共享打印模板支持语文短答题writingLines的受限行数，分页估算同步计入空间；保留其他格式行为，不渲染模型预填答案或样式。专项/每日页头以实际总题数替代综合题型说明。runtime-rules同步格式契约，3项新增回归先失败后通过。
- 使用原保存样本零调用重印，语文4题各2条7mm横线、英语4组四线格保留；4份PDF共4页A4，学生卷layout及全部页面图片检查通过。来源哈希、答案包指纹和解析全文与前次一致，没有改题或教师评分，旧证据保留。
- 本轮44项回归、蓝图、Skills和API检查通过；新入口`tmp/quality/task9-print-refinement-review-20260923/review.md`。0真实模型调用、0业务写入，未修改Web UI、导出权限或持久化边界，未运行完整内容E2E。下一步仍需教师实际书写/内容/给分点评价与教材/薄弱点/留出覆盖；批改/OCR gold和真实持久化验收未完成。Task 9不勾选完成，迁移、提交和清理继续后置。

2026-09-23 续作记录（Task 9 教师选定错题补弱场景）：

- 教师选择“针对近期错题生成补弱练习”。选取既有9月3日确认记录的4道四年级数学错题，避开涂改题，历史确认及原gold均保留；不推断当前掌握状态、不冒充当前学生数据库查询。
- 发现旧入口默认未筛选未确认批改、统一上下文丢失学生/正确答案且顶层信号未规范化。3项回归先失败后修复：旧/新入口默认同一确认过滤，来源ref贯穿，两处模型信号同一白名单且答案限长。客户端不能注入确认字段。
- 一次真实生成73.999秒，4题20分、4947输入/2363输出tokens，无替补/兜底。答案100/120/382/337已独立复算，两份单页A4草稿layout及图片检查通过。新入口`tmp/quality/task9-remediation-review-20260923/review.md`；同类变式的贴合度、单步过渡及给分政策仍待教师评价。
- 67项相关回归、蓝图、Skills、API、Web类型检查通过；0业务写入。完整内容E2E操作既有数据库及导出目录，继续后置，不称为通过。补弱runtime-rules在真实调用启动后更新，本次模型规则hash以报告为准。Task 9仍缺教师评价、批改/OCR gold、当前学生/教材/留出覆盖与持久化验收；迁移、提交和清理不执行。

2026-09-24 续作记录（Task 9 错题证据变化拦截）：

- 补齐生成持续工作流对规范化studentSignals的比较，与teaching/target共同验证。错题答案、错误描述或可用信号变化后，新修订/确认/恢复返回409；生成期间变化保留needs_input，修订期间变化不提交迟到结果。旧版本和历史确认不追溯修改，同键成功命令仍可重放。
- 4项回归先失败后修复，另补修订期间撤回与独立CLI/HTTP同源验收。105项相关回归、蓝图、Skills和API检查通过。使用合成模型和内存仓库，0真实模型调用、0业务写入；不能称为生产Web一致性或真实数据库事务验收。
- 生成Playbook及API契约已说明来源变化需教师决定按新证据新建任务，不自动换键重试。教师质量评价、OCR/批改gold及真实持久化仍待完成；重型内容E2E、迁移、提交和清理继续后置。准确证据见docs/teaching-workflow-acceptance.md的9月24日记录。

2026-09-24 续作记录（Task 9 来源依据变化的 Web 交互）：

- 已先复现并修复Web将WORKFLOW_EVIDENCE_CHANGED误提示为普通版本冲突。共享API按错误码说明来源变化、编辑保留及另建任务的复核路径；刷新不更新旧草稿依据，不自动重试、不改服务端快照或历史确认。普通409提示保持不变。
- 生成浏览器3项、批改浏览器2项全部通过，Web typecheck、生成蓝图、编码及diff检查通过。合成模型、真实本地HTTP和内存仓库验证错题变化后保存失败、刷新仍保留编辑/版本/确认、旧版可读且仅发送一次保存请求；桌面及390px窄屏截图已查看。0真实模型调用、0业务写入，不冒充生产持久化验收。
- 本地Web已恢复到127.0.0.1:5173，实际登录页面可渲染；教师工作台交互使用隔离测试数据。证据位置和测试调试记录见docs/teaching-workflow-acceptance.md对应9月24日条目。准确下一步仍为错题补弱内容的教师评价、批改字迹/评分规则及OCR gold核对，再扩展当前学生/教材/留出任务；真实数据库事务、持久化启用及正式发布按既有顺序后置。Task 9不标为全部完成，提交和清理仍不执行。

2026-09-24 续作记录（Task 9 同原图 OCR 纸面裁剪对照）：

- 新增本地 `tmp/quality/task9-ocr-review-20260924/`：20题按原图纸面位置裁剪、两路线原始识别字段并排、来源/裁剪哈希清单和桌面/手机浏览器核验。保留所有原报告、原图与教师结论 null；0 模型调用、0 业务写入。
- 已定位现有路线第二页 bbox 页码冲突，以及第7、17题遮挡却有完整计算转写、第19题可见数字与现有过程不符等风险；不自动修正作答或分数。该材料方便教师核对，不能替代教师逐题金标或宣布 OCR 路线准确率通过。Task 9 其他真实质量、持久化和正式发布待办保持不变；不提交、不清理。
- 桌面/手机页面核验、来源与裁剪哈希核验、编码与API连接检查通过；证据详见验收文档对应日期记录。下一步优先核对第7、12、14、17、19、20题，再形成教师确认转写；坐标空间及真实OCR准确率仍不标为通过。

2026-09-24 续作记录（Task 9 批改三项待决核对）：

- 已复核综合卷第4、25题及小测第6题原裁剪和来源哈希，集中核对入口为`tmp/quality/task9-grading-decision-20260924/review.md`。第4题首字、第25题两处单位仍待教师辨认；第6题选D为未确认的新转写，是否仅按选项2/0分供独立诊断使用仍待教师决定。
- 历史评分和归档不变，不据此生成新gold或调整来源包。其余候选转写及OCR纸面裁剪仍待逐题教师确认；第九阶段、持久化、新表事务和正式导出继续保持未验收状态。本轮不提交、不清理。

2026-09-24 续作记录（Task 9 教师确认局部转写）：

- 教师在当前对话确认综合卷第4题第二个表示式首字为4、第25题两处手写单位为千米、小测第6题手写选项为D。仅将这三项记录于`tmp/quality/task9-grading-decision-20260924/teacher-transcription-confirmation.json`并更新核对页；不回写历史候选包、原gold或归档。
- 第6题独立诊断是否仅按选项2/0分仍待决定；其余候选转写、OCR金标、教师内容评价及真实持久化仍未完成。Task 9不勾选完成，迁移、提交和清理继续后置。

### 2026-09-26 第6题评分规则确认与共享服务修正

- 教师已确认选择题不计过程分，数学仅计算题和应用题计过程分。同步生成/批改runtime-rules；共享服务以可信题型优先，客观题不因旧通用过程rubric获得过程分或被迫转交模型，计算/应用题继续检查过程。生成共享评分检查阻断客观题明确过程给分冲突，现有受限修复和工作流校验共同复用。
- 独立第6题诊断D得0分、合成对照C得2分，0模型调用、0业务写入；教师转写的有效可信度只用于诊断，原OCR置信度、原gold、候选包、旧诊断和历史教师归档均保留。报告`tmp/quality/task9-grading-rule-20260926/choice-rule-diagnostic.json`，核对入口仍为`tmp/quality/task9-grading-decision-20260924/review.md`。
- 92项聚焦回归、Skills、生成蓝图与API检查通过。当前源码独立进程验证，没有重启运行服务；数据库新表事务、完整教学质量及真实跨入口持久化仍未验收。下一步核对其余转写及OCR gold，并取得错题补弱内容/评分点/书写空间的教师评价。Task 9继续未完成，持久化开关关闭，迁移、提交和清理继续后置。

### 2026-09-26 工作流过程证据与置信度补齐

- 已修复创建快照遗漏observedWork、局部重判丢失原过程和图片定位字段、未知置信度被补成1的问题；HTTP评分修改保留原过程，识别修正复制字段不再把null改为空对象。题型取可信来源，教师修正只提升当前调用的有效可信度，原置信度保持不变。
- 83项聚焦回归通过，包含实际本地HTTP、共享服务和内存仓库的第6题式样修正0分、计算过程部分给分、模型及客户端不能覆盖原证据。日志`tmp/quality/task9-process-evidence-regression-final-20260926.txt`。使用合成模型，不是新增真实OCR/模型质量样本；0业务写入、未重启运行API。
- 继续待办为其余转写/OCR gold与教师教学评价、留出覆盖及后置真实持久化验收。Task 9未整体完成，未迁移、提交、清理或启用持久化。

- 默认在当前任务顺序实施，不新建 Codex 任务、不自动创建 worktree、不自动启动其他 agent。
- 每阶段完成后记录提交与通过的命令，保留真实失败，不通过时先定位原因，不增加无关重构。
- 暂停恢复时先检查 Git 和本计划进度，只读取下一任务依赖，不重复运行已通过的大型验收。
- 模型路由回退仅回退本轮教学策略；新版本数据保持可读，不删除历史快照来“回滚”。
- 本文最初以 Task 1 为起点；恢复工作应按最新续作记录推进，当前处于 Task 9 真实质量验收，不能因历史未勾选项从 Task 1 重做，也不能将工程验证视为教学质量完成。

### 2026-09-26 订正稿转写、教学评价与隔离PostgreSQL验收

- 教师明确选择按当前可见订正稿评分。20题独立目视转写中，第7、12、17、20题被遮挡，保持未知，不按空白计零；第10题漏写前半式、第14题局部涂改和第19题简写过程均照实保留。教师进一步确认第9题作答为72、誊写答案时写成76；新副本保留两处字迹，只确认最终作答，不代替过程分或整份金标确认。与此前综合卷/小测25题是不同样本，不混用题号。
- 四题补弱样本复算100、120、382、337，当前共享校验通过，已检查学生卷/解析卷既有渲染。助教评价为适合综合复测，首次补弱宜先拆基础步骤并强化完整等号链；教师明确允许依步骤数保留结果分2、2、1、1。此确认仅限本份评分点，不等于书写空间、完整教学质量或学生当前掌握度通过。原生成样本、PDF、OCR报告/原图/裁剪及旧候选哈希未变，0新增模型调用、0业务数据写入。
- 最新核对入口：`tmp/quality/task9-evidence-20260926/review.md`。教师原话记录`teacher-decisions.json`；确认后新副本为`ocr-visible-reviewed.json`、`teaching-sample-reviewed.json`，原候选和评价保留。
- 复现隔离Prisma生成缺少`runtime/library.d.ts`，核对prisma与@prisma/client均为6.19.3。获取同版本npm包并核验SHA512完整性，仅补回本地安装缺失的54个文件，未覆盖既有文件、升级版本、改锁文件或重新生成业务客户端。包差异及来源见`tmp/quality/task9-prisma-package-20260926/`；已有library.mjs.map差异保留，未宣称整个安装与官方包完全一致。
- 原9项真实PostgreSQL事务测试通过后，新增2项HTTP/对话客户端持久化测试，共11/11通过、0跳过：覆盖并发唯一创建、CAS无孤儿版本、幂等重放、教师隔离、历史不可变、失败回滚、检查点并发、中断恢复/取消迟到写，以及生成修订重读/确认和批改未知OCR经教师修正后的证据保留。模型输出、身份与学生解析为合成fixture，不是生产教学验收。日志`tmp/quality/task9-postgres-http-20260926.txt`。
- 数据库测试仅在现有PostgreSQL服务器的随机独立schema执行新增两表迁移，测试schema已回收；并非独立数据库服务器。独立只读核验`database-boundary.json`确认业务默认schema工作流表数量0、两次测试schema均消失、持久化开关仍关闭；没有迁移业务schema或读写业务行。Assignment/Submission正式发布和归档的真实跨表事务尚未覆盖。
- 共享HTTP测试工具新增显式repository注入，默认仍为内存仓库；64项相关HTTP、执行器与CLI回归通过，日志`tmp/quality/task9-http-fixture-regression-20260926.txt`。未重启运行API，未提交或清理工作区，Task 9仍待教学质量/金标、留出样本及生产落地验收。
- 本轮收尾：check:skills、check:api、check:generation:blueprint通过，20题副本、29处核对链接及原证据哈希核验通过。源码/历史编码检查各保留1项未通过：同版官方Prisma解包文件runtime/binary.js第126行的DOMException字符串含连续三个问号，触发乱码规则；与已安装依赖SHA-256一致，非本轮中文内容损坏。未修改供应商代码、删除核验文件或放宽守卫，故不能报告编码检查全通过。定位脚本tmp/quality/task9-evidence-20260926/inspect-vendor-encoding.mjs，完整检查日志task9-encoding-final-20260926.txt和task9-encoding-history-final-20260926.txt。


### 2026-09-26 真实跨表事务与教学计划计算练习参考

- 新增 packages/db/src/teaching-workflow-publication.postgres.test.mjs，真实 PostgreSQL 独立随机schema、当前完整datamodel生成独立客户端并db push；使用真实HTTP/发布归档服务/仓储、学生权限及证据解析器，身份、题目和模型输出为合成fixture。11/11通过、0跳过：并发发布/归档唯一性、确认/版本/教师/退课/取消门禁、来源篡改与证据变化拒绝、零错题新版本替代当前证据而保留历史，以及真实SQL行锁阻塞并发修订。数据库触发器证实AssignmentItem失败回滚Assignment、Mistake失败回滚此前已插入的Submission和GradingResult，重试成功。日志 tmp/quality/task9-cross-table-expanded-20260926.txt。
- 测试schema已回收，只读复查 tmp/quality/task9-cross-table-boundary-20260926.json 确认业务schema工作流表仍0、持久化仍关闭、两个新测试schema均消失。此测试不是业务迁移升级验证、生产启用或真实学生教学验收；未重启API、未读写业务行。
- 教师否决旧四题学生卷，要求“一个标题＋题目内容＋作答空间”；简化单列版仅获“方向正确，题目或作答空间还需调整”。随后指定参考“教学计划”计算专项。已查阅同名对话及四年级20260914第1天学生卷：参考为20题/两页、每页两列五行大框。教师进一步说明按教学需求，生成时由老师明确题量、内容、年级和知识点，因此不把20题/2页硬设为默认。
- 共享API打印器现为纯数学focused计算题提供两列白底浅边框作答区，保留方法要求、取消冗余页头与分值；按成对行高度分页，较大作答区减少每页题量。批改位置清单同步两列顺序和估算框，真实导出仍用DOM测量校验；综合卷、多日目标和英语/语文结构保留。解析卷保留评分依据、完整步骤和易错点，源题与答案包不变。
- 原四题零模型调用重印双卷：tmp/quality/generation-remediation-reference-20260926/，学生/解析各1页A4，实际渲染与layout通过。答案100/120/382/337、教师已确认的结果分2/2/1/1保持；此确认不等于整份教学验收。20题重复合成内容仅用于分页压力检查，目录 tmp/quality/task9-reference-20item-layout-fixture-20260926，不作教学交付或原创内容样本。4题新布局仍待教师实用性评价，不标记通过。
- 31项打印/来源导出/布局回归通过（task9-reference-print-green-20260926.txt）。本轮未新增真实模型调用、未做业务迁移、正式导出、提交或清理。第九阶段仍待教学质量/OCR gold/留出任务及生产落地验收。

- 后续教师反馈“作答框需要加大”：每题净空白书写高度由32mm增至48mm，白底两列保留；分页随空间变化，不以参考样例20题/2页为硬要求。新四题双卷位于 tmp/quality/generation-remediation-reference-large-20260926，学生/解析各1页A4，实物渲染和layout通过，尚未获教师最终认可。旧版均保留。
- 放大后20题合成分页检查发现尾页偏空，已在保留题序及左右成对关系下平衡相邻页；最终8/6/6题共3页，目录 tmp/quality/task9-reference-large-layout-fixture-20260926-v2，layout通过。前述原20题fixture曾因隐藏指令被计入高度分为三页，修正后v2两页通过；这些中间样本只记录工程排版变化，不是新增教学内容。
- 蓝图、Skills和API检查通过。源码/历史编码各仍仅有1项官方Prisma解包文件runtime/binary.js告警，未改vendor、删除证据或放宽规则；不能称为全通过。日志 task9-reference-{blueprint,skills,api,encoding,history}-20260926.txt。最新31项打印/来源导出/布局回归及git diff --check通过，日志task9-reference-large-regression-20260926.txt；未执行提交或清理。


### 2026-09-26 训练阶段、连带错误评分与实际模型复测

- 教师要求补齐本轮评价中的缺口。generation/grading runtime-rules、模块入口及Playbook已明确首次补弱/巩固/复测结构，保持教师题量、年级和知识点。阶段沿用requirement或每日goal，不增加第二套前端prompt、stage枚举或推断当前掌握；共享服务测试验证原要求与历史信号同时进入模型上下文。
- 连带错误按本题权威rubric区分根源错误、后续保留项、独立新错及最终答案分；后续计算分只有明确允许错误传递时才可保留，规则不足且影响分数时uncertain/null。碰巧正确的答案不能抹掉可见错误过程。原四题结果分2/2/1/1及历史评分不改，新的评分建议待教师复核。
- 首次真实生成暴露“有过程分但仅正确结果得满分”矛盾。共享assessmentScoreIssues新增对明确措辞的冲突拦截，复现失败后修正，并验证服务层只走既有一次受限修复。该检查不能穷尽所有自然语言矛盾，语义复核仍保留。首次诊断脚本另错误预期quiz-standard，实际服务按正式练习使用formal-full；后续仅修正受控验收样例的预期预算，未改模型、路由、服务端预算或重试次数。首份不计教学通过且原报告保留。
- 修正后3份实际生成各4题20分，均一次Astra成功，无替补/兜底。12题通过独立精确算术复算，与本次提供的8道参考及本轮其他完整算式无重复。首次补弱为1道单步进位、2道短链乘减、1道括号综合；巩固/复测覆盖指定四结构。复测部分基本运算与巩固重合，只证明近迁移样本可用，不证明跨情境迁移、当前掌握或整个资源库去重。新样本仅结果1分与原四题评分是不同版本，不擅自视为教师已确认政策。
- 一次真实模型批改7份合成过程，实际得分3/1/0/2/5/null/1全部符合显式诊断细则，含规则模糊待复核与错误过程碰巧得到正确答案。此为语义诊断，不是7份真实学生作业、OCR金标或生产准确率。输入、解释、尝试和规则hash保留于tmp/quality/task9-carry-forward-live-20260926/grading.json。
- 本轮共5次真实模型调用，已知输入34491/输出10901 tokens，费用未知，未写业务数据库。原题零调用重印：tmp/quality/generation-remediation-readable-20260926，学生字号12磅、48mm作答空间，脱式解析逐行显示；学生1页/解析2页A4，渲染目视及学生卷layout通过。新解析独立分两页，未删解释以凑一页。
- 助教评价与12题/7场景汇总：tmp/quality/task9-practice-review-20260926/review.md。当前第九阶段仍待真实书写/教学及新评分草稿的教师确认、OCR完整gold、当前学生/教材/教师留出任务、业务迁移升级与生产正式双卷闭环。已完成的隔离跨表11项事务不再列为阻碍；持久化仍关闭，未重启API、提交或清理。

- 收尾验证：111项评分/共享服务/运行规则/工作流校验/打印回归通过，日志task9-stage-scoring-final-20260926.txt；Skills检查通过。12磅字号的20题合成分页为8/6/6题共3页，实物layout通过；失败中间样本均保留。蓝图/API及源码/历史编码完整结果分别见task9-stage-final-{blueprint,api,encoding,history}-20260926.txt，历史vendor告警未删除或放宽规则。

### 2026-09-28 补记旧结构升级演练

- 9月26日新增并执行 `packages/db/src/teaching-workflow-migration.postgres.test.mjs`：从固定Git旧版datamodel生成合成baseline，在随机PostgreSQL schema中写入八类旧业务合成数据，再部署仓库真实工作流迁移。5/5通过、0跳过，覆盖旧数据保留、schema无drift、迁移checksum、重复部署幂等、新工作流版本读写/过期写拒绝及旧作业/批改继续写入。
- 日志 `tmp/quality/task9-migration-rehearsal-20260926.txt`；边界报告 `tmp/jh_migration_test_d14d07ade1d94a24bd061846b8fbf4a9/boundary.json`。本次恢复核对现有证据后补记，测试schema已回收，没有重复执行通过的数据库测试。
- 完成的是隔离旧结构升级演练，不是完整历史迁移链或生产迁移。实际业务结构/迁移历史核对、生产迁移和正式双卷发布/归档仍后置；教学评价、OCR完整gold、留出任务继续待验。0模型调用，未读写业务行、启用持久化、重启API、提交或清理。
