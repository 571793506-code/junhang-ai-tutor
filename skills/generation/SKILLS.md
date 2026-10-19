# 生成类 Skill

用于修改、复用或审查小测、练习、试卷、任务、讲解和教学内容生成经验。当前阶段只沉淀创作模块、结构化草稿、教师复核和流程经验，不把现有不稳定 PDF 排版与自动审查堆叠作为推荐实现继续扩大。

## 适用场景

- 需要生成小测、练习、试卷、讲解材料、今日任务或家长反馈草稿。
- 需要区分小测、练习和试卷的结构、题型、页数和作答空间。
- 需要审查生成内容是否原创、是否含答案解析、是否适合教师复核。

## 何时加载

当意图是生成小测、普通练习、个性化练习、试卷、教学任务或讲解草稿时加载。若请求声明教材、章节或资料，先加载 `teaching-materials`；若结果需要批改，保留 `gradingSourcePackage` 并让 `grading` 读取。

必须同时读取 `skills/generation/references/runtime-rules.md`。教学细则只在该文件维护；本 Playbook 负责上下文、调用、校验和教师复核的执行顺序。

## 前置依赖

服务端必须先确认教师权限、学生或范围、`kind`、教材资产、章节范围、已审批资料和可用学生证据。教材请求没有真实资产或 `contentContext` 证据时，在模型调用前阻断。

## 输入契约

持续工作流入口见 `docs/14-api-contract.md` 的 Shared workflow API and CLI。薄 CLI 为 `node scripts/teaching-workflow.mjs`，只使用指定的教师本地会话调用同一 API。当前本机部署已于2026-09-29完成业务迁移、Prisma Client更新及持久化启用；两个Web工作台已接入共享契约，教师确认的测评于2026-09-30完成真实Web发布、预览及正式双卷导出。实际验收范围见 `docs/teaching-workflow-acceptance.md`，其他环境须核查当前服务状态，resume仍不可用。503 不能视为生成成功，needs_input 代表条件或内容未齐，也不能绕过接口直接写库。根据已确认对话填入结构化学科、年级或学生、用途、kind 和 requirement；专项与每日题量使用 requestedItemCount。自然语言局部修订提交 targetQuestionIds 与 instruction，手工修改使用显式 patch；两者均保留 expectedRevision 和 operationKey。Web 仅缓存按教师隔离的最后任务 ID，内容以服务端版本为准；冲突保留本地未保存编辑，不能自动换成最新 revision 覆盖。取消后的任务只读，继续须明确新建；未启用时保留“原有生成与打印”入口。

Web 只提交学科、年级、`kind`、`purpose`、`requestedItemTypes`、`dayPlan`、目标范围、难度、题量、教师要求、知识点和教材标识。服务端组装 `generationContext`、`studentSignals`、`contentContext` 和生成预算；客户端不得提交 prompt、provider、model、raw 或内部预算。

持续工作流会核对保存的教学、目标和规范化 studentSignals 是否仍与服务端证据一致。原错题答案、错误描述或可用学习记录变化后，新修订、确认和恢复返回 `409 WORKFLOW_EVIDENCE_CHANGED`；修订调用前及结果提交前均检查，生成期间变化则保留 needs_input 占位。此时读取并保留旧版本，说明来源变化，由教师决定按当前证据新建任务并重新复核；不得自动刷新快照、修改 expectedRevision 或换 requestKey 重试。历史教师确认、版本读取和原成功命令的同键重放仍有效，不追溯撤销旧记录；旧版缺失 studentSignals 字段不能当成已验证的空证据。

## 输出契约

服务层返回结构化草稿、`generationPipeline`、审查结果、`gradingSourcePackage` 引用和 `teacher_review` 状态。学生卷与解析卷从答案包派生，未经过 parse、normalize、validate、repair 和教师复核的内容不得发布、归档或导出。

已确认测评版本可通过独立 `assignment` API/CLI 衔接既有作业与导出：先 GET 确认版本，再提交仅含 expectedRevision 的请求。该能力已在上述本机部署启用并完成真实测评发布验收，不据此假定其他环境可用。服务端验证保存的逐题教师确认、当前权限与来源一致性；同版本重放返回原 Assignment，新版本另建作业，不能覆盖旧题目或旧 PDF。来源包将 sourceId 绑定新 Assignment，保留工作流版本，并记录原来源和发布来源指纹。题号、选项、图形、共享材料、每日标识和 answerFormat 随权威来源保存。

assignment 返回作业 ID，不调用模型或导出 PDF。对该 ID 调用既有 draft-export 后，服务端已有内容确认不会被预览清除；排版未通过仍不能 print-export，解析 PDF 失败不能标记正式导出完成。发布版不接受旧 draft-review 或答案来源导入改写；需要修改时回到工作流修订并重新确认。不得从上传 JSON 的确认人或哈希继承权限，也不得为绕过 503 直接写库或开启未验收开关。讲解尚无该发布路径；HTTP和Web编辑/确认已接入本机持久化服务，但不代表讲解正式打印验收通过。完整契约、错误和重放规则见 docs/14-api-contract.md。

讲解使用独立的 content.explanation，包含 concept、steps、workedExamples（prompt、answer、analysisSteps）和 commonMistakes；不把例题当成测评分数或批改答案包。通过同一 command API/CLI 提交 targetExplanation=true；自然语言 revise 带 instruction，手工 revise 使用 replace_explanation 的完整 value，不能混入 targetQuestionIds。confirm 表示教师明确确认整份讲解，确认身份只由会话写入。创建及修订剥离模型/客户端确认，修订后撤销整份讲解确认；历史恢复追加版本并重查当前权限/教学证据，历史版本不覆盖。保留 expectedRevision 与 operationKey 处理冲突和重放。自然语言修订复用共享 generation 规则、上下文和一次受限修复，手工修改、确认、恢复不调用模型；取消或失败不得提交迟到内容。确认讲解不意味着已发布、已正式导出或各科讲解质量已获教师验收。

## 执行顺序

先用 `normalizeTeachingPurpose` 校验用途。默认 comprehensive 按 `kind` 选择蓝图；focused 只包含指定题型；multi_day 保留每日 dayId、目标和题量；explanation 产出概念、步骤、例题和易错点，不生成试卷答案包或自动审查 PDF。随后通过 `draftAssessmentService -> draftAssessment -> runAssessmentPipeline -> runTeachingTask` 装配共享规则、上下文和校验器。额外调用仅发生在执行器中，不能用页面状态重建第二套 prompt。

## 模型与复核

首次补弱、巩固练习和复测按runtime-rules中的“补弱、巩固与复测”处理。把教师明确阶段原样保留在requirement或每日goal中，继续使用既有purpose与requestedItemCount，不新增前端私有prompt或把参考样例题量设成默认。验收要分别查看阶段结构、错题证据关联、题量和评分口径；实际发送的generationContext与原要求均应保留。来源记录只能支持历史错误，不自动证明当前掌握。明确的过程分与仅结果满分冲突由共享assessmentScoreIssues拦截，语义不明确的细则仍需教师复核。

调用前读取 `packages/ai/src/model-policy.js` 的任务策略；本文件不另行硬编码模型参数或数值预算。2026-10-19教师指定生成主模型为GPT-6.1 Sol，Flash按需提取。同型号替补被禁用；可用性故障不重复调用同一型号，结构或内容校验失败仍最多由主模型修复一次，共享原有操作预算。evidence/configuration故障直接 `teacher_review`；模型结果均需结构校验和教师复核。不要沿用9月11日的Astra主模型设计判断当前路由。

## 核心原则

- 模型输出只是草稿，必须经过结构化、校验、修复和教师复核。
- Web 只做联调入口；生成逻辑必须在 API、服务层、脚本或共享契约中。
- 教学目的、题型和作答区执行共享 runtime-rules；改变教学细则后必须验证实际加载正文与 hash，不能只修改提示词标签。
- 新生成的小测、练习和试卷必须同时建立内部版本化结构化答案包；答案包包含题号、题干、标准答案、逐题分值、解析步骤、考点、评分依据和完整性指纹，是后续批改的权威来源。学生卷与解析卷都是派生产物，不能反向作为标准答案来源。
- 建立答案包前必须验证题干、答案和逐题分值完整，且逐题分值合计与总分一致；不满足时只保留待修复草稿，不进入可批改来源。
- 教材绑定生成以贵州遵义基准为准：语文统编版 / 人教体系、数学人教版、英语人教版 PEP。带教材或章节的请求必须由服务端解析真实 `TextbookAsset`，没有已审批同版本资料时失败关闭，不使用模型先验猜测。
- 教师确认前不发布、不打印正式卷、不进入学生端或家长端。
- 按最小内容单元生成，程序执行结构修复、本地审查与教师复核门禁；不默认叠加多模型深度审查。失败类型、额外调用次数和并发由代码策略约束。
- `usedModelEscalation`、模型名、档位、触发原因和预算只保留为内部元数据，不进入学生、家长、课堂平板或公共屏。
- E2E、联调或低延迟入口可以传 `assessmentTotalTimeoutMs` / `generationTimeoutMs` 给服务层；预算耗尽后必须走结构化动态兜底草稿和教师复核，不能让接口长时间等待模型。
- timeout 预算和 token 上限必须分开处理：timeout 防止生成长时间不收口，`assessmentMaxTokens` / `generationMaxTokens` 给真实模型保留输出空间，不能用提高 token 上限替代超时边界。
- 部分分区失败或动态兜底必须写入 `usedDynamicFallback=true`，本地审查状态强制为 `needs_teacher_review`。预算不足不能宣称生成成功。
- `check:content-context` 低预算 E2E 只作为 `link-guard` 链路守卫，证明资料上下文、预算退出、动态兜底、教师复核和导出链路能收口；不得用它判断题目原创性、教师要求贴合度、个性化程度、解析质量或 PDF 视觉质量。
- `check:generation:quality:quiz` 和 `check:generation:quality:formal` 才用于真实模型生成内容质量样本；质量样本必须 `modelAvailable=true`、`usedDynamicFallback=false`，否则不能通过。
- 生成由当前主模型执行；只有显式配置不同型号替补时，才允许可用性故障单次接替，与一次质量修复共享追加名额，不再追加服务层深度审查。
- 生成质量样本必须同时带有预期的 `generationProfile`；缺少 profile、动态兜底或模型不可用时，质量检查失败。生成质量检查只评估结构化内容，不替代 `check:generation:layout` 的 PDF 版式检查，也不替代 `check:content-context` 的资料链路守卫。
- 批改准确率使用 `cmd /c npm.cmd run check:grading:quality -- <gold-cases.json>` 评估；`fixtures/quality/grading-gold-cases.example.json` 只用于验证契约和指标路径，不能作为生产准确率证据。

## 教育规则 Skill 参考

- 可参考 education-agent-skills 等外部教育类 skill 的课程目标、测评设计、学习反馈和分层练习思路。
- 外部教育规则只能转化为本项目的题型结构、教师复核清单、学生信号字段和生成约束。
- 不直接复制外部题目、课程文本、评分标准或实现代码。
- 涉及教材资料时，必须通过 `generationContext.teaching.contentContext` 读取摘要和知识点，不直接把上传文件或完整 Markdown chunk 拼进 prompt。
- 涉及学生薄弱点时，优先使用 `studentSignals`，不在前端临时拼接学生画像。

## 类型规则

小测、练习、试卷与专项/多日/讲解的教学细则统一维护在 `skills/generation/references/runtime-rules.md`。服务端已接入purpose分流，Web用途选择与讲解编辑/复核界面已接入同一契约；合成浏览器检查、真实测评样本及未覆盖用途须按工作台验收记录分别判断，不能把服务层单测当作UI或真实内容质量验收。

## 当前项目可参考位置

- `packages/services/src/index.js`：`draftAssessmentService`、生成上下文、结构修复和 fallback 思想。
- `docs/41-prompt-context-engineering-playbook.md`：提示词、上下文包和修复规则。
- `docs/14-api-contract.md`：草稿、复核和正式导出 API 契约。

## 推荐输出形态

教师端生成请求应整理为明确范围：

```text
小测：五年级英语第四单元，难度中等
```

输出建议包含：

- 标题；
- 教学目标；
- 分区和题目；
- 答案；
- 解析；
- 易错点；
- 教师复核清单。

## 禁止项

- 不继续扩大当前复杂 PDF 自动排版主流程。
- 不把多模型自动审查堆叠作为默认主链路。
- 不让 `POST /api/assessments/draft` 追加服务层多模型质量审查；模型层最多执行一次受限修复。
- 不把模型输出直接导出给学生。
- 不用大量空白凑页数。
- 不仅修英语小测，三科和小测/练习/试卷模板都必须遵守类型规则。

## 验证

- 修改生成模板、三科题型蓝图、兜底题池、默认页数、总分或基础审查规则时，优先运行 `cmd /c npm.cmd run check:generation:blueprint`。
- 验证小测真实模型内容质量时运行 `cmd /c npm.cmd run check:generation:quality:quiz`；该命令使用中预算样本，不导出 PDF。
- 验证试卷或个性化练习真实模型内容质量时运行 `cmd /c npm.cmd run check:generation:quality:formal`；该命令使用正式预算样本，不导出 PDF，耗时高于 quiz。
- 验证 Sol 强制主调用和项目生成门禁时运行 `cmd /c npm.cmd run check:generation:quality:sol`；该命令会真实调用模型，日常单测不得运行，且结果不能替代教师 gold 批改评测。
- 修改生成服务并涉及资料上下文、教师复核或导出边界时，运行 `cmd /c npm.cmd run check:content-context`。
- 修改 GPT-5.6 中转配置或请求参数时，先运行 `cmd /c npm.cmd run check:gpt56`；该检查只使用合成输入，不得发送学生数据。
- 同时涉及资料上传、生成草稿、草稿导出、教师确认和正式学生卷/解析卷导出时，才运行 `cmd /c npm.cmd run check:teaching-content:full`。
- 修改服务层结构时运行 `cmd /c npm.cmd run check --workspace apps/api`。
- 修改中文提示词、题型规则或文案时运行 `cmd /c npm.cmd run check:encoding`。
- 当前已知 `check:services` 可能因生成草稿耗时超时，不能把它作为生成完全健康的唯一结论。
- 低预算 `check:content-context` 只验证链路守卫；完整 E2E 只作为大改或发布前门禁；日常修生成规则时不要用 E2E 代替分层验证或中/正式预算质量样本。
