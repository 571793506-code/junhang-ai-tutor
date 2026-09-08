# 生成类 Skill

用于修改、复用或审查小测、练习、试卷、任务、讲解和教学内容生成经验。当前阶段只沉淀创作模块、结构化草稿、教师复核和流程经验，不把现有不稳定 PDF 排版与自动审查堆叠作为推荐实现继续扩大。

## 适用场景

- 需要生成小测、练习、试卷、讲解材料、今日任务或家长反馈草稿。
- 需要区分小测、练习和试卷的结构、题型、页数和作答空间。
- 需要审查生成内容是否原创、是否含答案解析、是否适合教师复核。

## 何时加载

当意图是生成小测、普通练习、个性化练习、试卷、教学任务或讲解草稿时加载。若请求声明教材、章节或资料，先加载 `teaching-materials`；若结果需要批改，保留 `gradingSourcePackage` 并让 `grading` 读取。

## 前置依赖

服务端必须先确认教师权限、学生或范围、`kind`、教材资产、章节范围、已审批资料和可用学生证据。教材请求没有真实资产或 `contentContext` 证据时，在模型调用前阻断。

## 输入契约

Web 只提交学科、年级、`kind`、目标范围、难度、题量、教师要求、知识点和教材标识。服务端组装 `generationContext`、`studentSignals`、`contentContext` 和生成预算；客户端不得提交 prompt、provider、model、raw 或内部预算。

## 输出契约

服务层返回结构化草稿、`generationPipeline`、审查结果、`gradingSourcePackage` 引用和 `teacher_review` 状态。学生卷与解析卷从答案包派生，未经过 parse、normalize、validate、repair 和教师复核的内容不得发布、归档或导出。

## 执行顺序

先按 `kind` 选择小测、练习或试卷蓝图，再组装上下文并分区生成；随后合并、结构修复、确定性审查、答案包校验、布局检查和教师复核。失败只重试失败分区，不能用页面状态重建第二套 prompt。

## 模型与复核

Terra 对小测、普通练习和个性化练习使用 `medium`，正式试卷使用 `high`；Sol 只对 availability 或证据充分的 quality 故障按失败分区升级一次。evidence/configuration 故障直接 `teacher_review`，DeepSeek 不进入默认文本链路，MiniMax 只承担 OCR/语音。

## 核心原则

- 模型输出只是草稿，必须经过结构化、校验、修复和教师复核。
- Web 只做联调入口；生成逻辑必须在 API、服务层、脚本或共享契约中。
- 小测、练习、试卷必须先按 `kind` 分流，不能共用同一套试卷模板缩放。
- 学生卷和解析卷必须分离；解析必须包含答案、步骤、考点和易错提醒。
- 学生卷作答区规范：计算题、解答题和图形题只保留适度的空白作答区，不显示“解：”“解题过程：”“答题区：”等提示性文字、公式、步骤或示例答案；答案解析卷可以保留完整答案、步骤、考点和易错提醒。
- 新生成的小测、练习和试卷必须同时建立内部版本化结构化答案包；答案包包含题号、题干、标准答案、逐题分值、解析步骤、考点、评分依据和完整性指纹，是后续批改的权威来源。学生卷与解析卷都是派生产物，不能反向作为标准答案来源。
- 建立答案包前必须验证题干、答案和逐题分值完整，且逐题分值合计与总分一致；不满足时只保留待修复草稿，不进入可批改来源。
- 题目必须原创，优先使用新的材料、数字、情境、词库和表达，不能直接套旧题。
- 教材绑定生成以贵州遵义基准为准：语文统编版 / 人教体系、数学人教版、英语人教版 PEP。带教材或章节的请求必须由服务端解析真实 `TextbookAsset`，没有已审批同版本资料时失败关闭，不使用模型先验猜测。
- 教师确认前不发布、不打印正式卷、不进入学生端或家长端。
- 默认草稿生成链路使用 GPT-5.6 按项目蓝图分区生成，最多 2 路并发；随后执行服务层结构修复、本地审查和教师复核门禁。深度模型审查必须显式开启，正常路径只调用一次 GPT-5.6，不能阻塞默认草稿返回。
- `gpt-5.6-terra` 推理档位按任务固定：小测、普通练习和个性化练习使用 `medium`，正式试卷使用 `high`；问答、今日任务和档案草稿继续使用 `low`，词汇卡继续使用 `none`。
- 只有两类失败允许把最小失败分区升级到 `gpt-5.6-sol` 的 `high`：可恢复的 availability 故障（超时、524、短时限流、网络中断等），以及结构、答案、解析或项目质量门禁明确不合格的 quality 故障。配置、鉴权、模型不支持等 configuration 故障不能升级；`generationContext` 或教学证据不足属于 evidence 故障，直接进入教师复核。
- 每个失败分区最多尝试一次 Sol；Terra 完全没有可用分区时才允许整项 Sol 重做。局部生成升级独立预算为 180 秒，token 继承原分区上限；整项重做仍受原场景总预算约束：小测 120 秒、普通练习 150 秒、试卷或个性化练习 240 秒。
- Sol 结果仍必须经过 parse、normalize、validate、repair、本地审查和教师复核。Sol 失败后不得再串接 DeepSeek 或第三个文本模型；`usedModelEscalation`、模型名、档位、触发原因和预算只保留为内部元数据，不进入学生、家长、课堂平板或公共屏。
- E2E、联调或低延迟入口可以传 `assessmentTotalTimeoutMs` / `generationTimeoutMs` 给服务层；预算耗尽后必须走结构化动态兜底草稿和教师复核，不能让接口长时间等待模型。
- timeout 预算和 token 上限必须分开处理：timeout 防止生成长时间不收口，`assessmentMaxTokens` / `generationMaxTokens` 给真实模型保留输出空间，不能用提高 token 上限替代超时边界。
- 生成预算默认由服务层推导：E2E/联调可用短预算；小测走 `quiz-standard`，默认 120s / 16000 tokens；普通练习走 `practice-standard`，默认 150s / 16000 tokens；试卷和个性化练习走 `formal-full`，默认 240s / 24000 tokens。小测/练习的 2 个紧凑分区单区最多 8000 tokens，试卷的 4 个分区按默认预算各 6000 tokens。
- 分区失败只重试该分区一次；部分分区失败或动态修复必须写入 `usedDynamicFallback=true`，本地审查状态强制为 `needs_teacher_review`。
- DeepSeek 不进入默认生成链路，只作为受控紧急回滚候选；MiniMax 不承担文本组卷，只保留视觉 OCR 和语音能力。
- `check:content-context` 低预算 E2E 只作为 `link-guard` 链路守卫，证明资料上下文、预算退出、动态兜底、教师复核和导出链路能收口；不得用它判断题目原创性、教师要求贴合度、个性化程度、解析质量或 PDF 视觉质量。
- `check:generation:quality:quiz` 和 `check:generation:quality:formal` 才用于真实模型生成内容质量样本；质量样本必须 `modelAvailable=true`、`usedDynamicFallback=false`，否则不能通过。
- `check:generation:quality:sol` 强制以 Sol `high` 作为主调用运行同一组六个项目质量样本，并禁止内部再次升级；它证明 Sol 可用且能通过当前合成生成门禁，不代表真实批改正确率，批改准确率只能由教师确认的 gold 数据评估。
- 生成质量样本必须同时带有预期的 `generationProfile`；缺少 profile、动态兜底或模型不可用时，质量检查失败。生成质量检查只评估结构化内容，不替代 `check:generation:layout` 的 PDF 版式检查，也不替代 `check:content-context` 的资料链路守卫。
- 批改准确率使用 `cmd /c npm.cmd run check:grading:quality -- <gold-cases.json>` 评估；`fixtures/quality/grading-gold-cases.example.json` 只用于验证契约和指标路径，不能作为生产准确率证据。

## 教育规则 Skill 参考

- 可参考 education-agent-skills 等外部教育类 skill 的课程目标、测评设计、学习反馈和分层练习思路。
- 外部教育规则只能转化为本项目的题型结构、教师复核清单、学生信号字段和生成约束。
- 不直接复制外部题目、课程文本、评分标准或实现代码。
- 涉及教材资料时，必须通过 `generationContext.teaching.contentContext` 读取摘要和知识点，不直接把上传文件或完整 Markdown chunk 拼进 prompt。
- 涉及学生薄弱点时，优先使用 `studentSignals`，不在前端临时拼接学生画像。

## 类型规则

- 小测：围绕教材单元、章节或当周目标，短而集中，默认 2 页 A4、60 分。
- 练习：围绕近期错题、薄弱点或教师指定目标，服务巩固补弱，默认 2 页 A4、60 分。
- 试卷：面向单元考、月考、期中、期末、小升初或综合测评，默认 4 页 A4、100 分。

英语规则：

- 英语小测默认包含中英文互译、写单词、造句、少量选择题和阅读。
- 英语练习默认包含词汇巩固、句型表达、易错选择和阅读巩固。
- 英语试卷才默认包含文章选词填空、短文语法填空或完形填空、正式阅读和写作。
- 中译英、根据中文写英文单词或短语、造句、中译英句子补全必须使用题干在上、英语四线格在下的上下结构作答，不得用普通横线替代。

语文规则：

- 小测和练习不得默认出现作文题。
- 阅读材料必须有完整上下文，五六年级现代文阅读要有足够长度。
- 文言文只在试卷或教师明确要求时加入。
- 看拼音写词语等书写题应使用黑色标准田字格元数据。

数学规则：

- 小测和练习减少无效题量堆叠，优先保障计算题、解答题和图形题作答空间。
- 图形题必须有 figure 元数据，并和对应题块绑定。
- 难度偏高或附加题必须来自教师明确要求，不默认添加。

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
- 不让 `POST /api/assessments/draft` 默认等待多模型质量审查；深度审查只在 `runModelReview=true` 或服务端配置开启时执行，正常路径只使用 GPT-5.6。
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
