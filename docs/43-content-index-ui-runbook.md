# 内容索引与教师端资料上下文说明

本文记录资料导入、Markdown 索引、生成上下文和教师端 UI 入口，供后续 Codex 对话和开发人员快速接手。

## 1. 已完成链路

```text
普通教学资料
-> markitdown 转 Markdown
-> scripts/build-content-index.mjs 构建内容索引
-> exports/content-index/index.json
-> 同步到 KnowledgeSource / KnowledgeChunk
-> 教师复核：reviewStatus=APPROVED、allowedForGeneration=true 且 licenseStatus!=NOT_ALLOWED
-> 服务层只匹配已批准资料上下文
-> generationContext.teaching.contentContext
-> 模型生成草稿
-> 服务层修复
-> 教师复核
```

## 2. 命令

将普通文件或目录转 Markdown：

```bash
cmd /c npm.cmd run content:markdown -- <file-or-directory> --out exports/markdown-ingestion
```

构建内容索引：

```bash
cmd /c npm.cmd run content:index -- exports/markdown-ingestion --out exports/content-index
```

索引构建要求输入目录中至少有一个 Markdown 文件。缺失目录或空目录会以 `CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS` 失败，不会写入可被误认为可用的空 `index.json`。

用于本地验证的最小命令：

```bash
cmd /c npm.cmd run content:markdown -- docs\41-prompt-context-engineering-playbook.md --out exports\markdown-ingestion-test
cmd /c npm.cmd run content:index -- exports\markdown-ingestion-test --out exports\content-index
```

生成类规则或兜底模板的最小验证命令：

```bash
cmd /c npm.cmd run check:generation:blueprint
```

该命令只检查三科小测、练习、试卷的服务层蓝图、兜底题型、总分、题量和基础审查规则；不启动 API、不调用模型、不导出 PDF。修改生成模板、题型结构、默认页数、分值或审查规则时，应优先运行它，而不是直接跑完整 E2E。

## 3.1 批改质量样本采集

从本地数据库扫描教师确认的批改记录时，默认只输出脱敏统计和阻断原因，不写文件：

```bash
cmd /c npm.cmd run collect:grading:gold
```

对话中已经由教师确认并归档的生成批改，若逐题复核完整且存在完整 `gradingSourcePackage`，可以进入候选。外部图片批改还必须保留 OCR、答案来源、图片质量和逐题教师确认；缺少这些证据的记录只进入阻断报告。

确认候选范围后，显式写出本地临时 gold 文件：

```bash
cmd /c npm.cmd run collect:grading:gold -- --write tmp\quality\grading-gold-cases.json
```

采集文件保留脱敏的教学输入、识别/评分证据及教师确认后的状态、答案和评分字段；学生身份、联系方式、图片文件名、原始模型输出、供应商和业务内部标识不会写入。它是expected金标基线，不包含待评估模型的actual。先独立服务回放（persist:false，不重新归档），再评估回放文件；不得复制expected或手工填写actual冒充执行结果：

```bash
cmd /c npm.cmd run replay:grading:gold -- --gold tmp\quality\grading-gold-cases.json --output tmp\quality\grading-evaluation.json
cmd /c npm.cmd run check:grading:quality -- tmp\quality\grading-evaluation.json
```

回放产生evaluationRun绑定输入与结果哈希；缺失或无效执行证据的样本不计入任何指标。counts.cases为输入样本数，counts.evaluatedCases为有效评估样本数；全部无效时指标为null，混合批次仅报告有效子集且整批仍失败。采集数量和质量指标不等于生产准确率，正式结论必须由教师确认样本范围并复核报告后单独标记。

`ok`只表示独立执行证据有效，不表示教学评分质量达标。`questionAccuracy`只比较是否全对，`statusAgreement`比较状态标签，两者不能代替部分分核对。逐题分数另报`questionScoreCoverage`（已明确给出数值分的题数/具有数值金标分的题数）、`questionScoreAgreement`（分数完全一致的题数/具有数值金标分的题数）和`questionScoreMeanAbsoluteError`（仅数值可比题的平均绝对分差）。`uncertain`、null及非数值预测记为未定，保留在覆盖率和一致率分母；0分是有效分数，旧金标未记录分值则不补造。无可比项时误差为null，误差为0仍须同时看覆盖率；counts中的goldScoredQuestions、scoreComparableQuestions、scoreMatchedQuestions、scoreMismatchedQuestions、scoreUnresolvedQuestions用于核对分母及差异。

## 3. API

查看内容索引：

```http
GET /api/content/index
```

教师上传普通资料并转 Markdown：

```http
POST /api/content/markdown-ingestion
Content-Type: multipart/form-data
```

表单字段：

- `files`：一个或多个普通教学资料文件。
- `outDir`：可选，默认 `exports/markdown-ingestion`。

接口说明：

- 仅教师端可用。
- 支持普通 PDF、Office、表格、HTML、文本、Markdown 和常见图片。
- `.edupdf` 受保护教材会被拒绝，不转换、不改写。
- 上传后原文件保留在 `storage/uploads`，转换后的 Markdown 写入 `exports/markdown-ingestion`。
- `outDir` 必须留在项目工作区内，不能使用 `..` 写到工作区外。

重建内容索引：

```http
POST /api/content/index/rebuild
```

请求体：

```json
{
  "inputs": ["exports/markdown-ingestion"],
  "outDir": "exports/content-index"
}
```

接口说明：

- 仅教师端可用。
- 重建时调用 `scripts/build-content-index.mjs`。
- `inputs` 和 `outDir` 必须留在项目工作区内。
- 返回索引摘要，不返回完整 Markdown chunk 原文。
- 写入审计日志 `content-index / rebuild`。

将索引同步到资料库：

```http
POST /api/knowledge/sources/sync-content-index
```

该接口把索引文档和 chunk 写入 `KnowledgeSource` / `KnowledgeChunk`，新来源默认是 `PENDING`、`allowedForGeneration=false`。同步完成不等于可以生成，必须由教师复核来源：

```http
PATCH /api/knowledge/sources/:sourceId/review
Content-Type: application/json
```

```json
{
  "status": "APPROVED",
  "licenseStatus": "ALLOWED",
  "allowedForGeneration": true,
  "note": "教师确认资料可用于生成"
}
```

只有同时满足 `reviewStatus=APPROVED`、`allowedForGeneration=true` 和 `licenseStatus!=NOT_ALLOWED` 的来源才会进入生成上下文。

教材绑定生成还要遵守贵州遵义基准：语文统编版 / 人教体系、数学人教版、英语人教版 PEP。内容索引 front matter 和 `KnowledgeSource` 会保留 `edition`, `volume`, `curriculumSeries`, `curriculumRegion`；需要区分教材修订版本时，同时保留 `curriculumStandard`。当前教师确认的七年级数学目录基准为“2022 年课程标准修订、人教版”。匹配时排除明确冲突的版本、系列和册次。未声明这些字段的普通教师资料仍需教师审批，不能用来覆盖服务端教材资产元数据。

## 4. Web 教师端

位置：

```text
教师端 -> 教材资料 -> 上传资料上下文
```

面板显示：

- 当前资料索引是否可用。
- 资料上传入口和“导入并重建索引”按钮。
- `.edupdf` 前端选择时会过滤并提示；后端仍会拒绝该类型作为最终保护边界。
- 资料数量。
- 学科覆盖数量。
- 知识点数量。
- “已进入生成上下文”的资料、科目和知识点摘要。
- 最近 4 条资料摘要。
- “重建资料索引”按钮。

## 5. 多端迁移约束

当前 Web 教师端面板只用于前端联调、原型验证和自动化检查。资料导入、Markdown 转换、索引重建、生成上下文注入和教师复核必须继续以 API、服务层和脚本契约为准，不能依赖 Web 页面本地状态作为唯一实现。

后续迁移到微信小程序、课堂平板或公共屏时，应复用同一组后端能力：

- 教师端或管理端上传普通教学资料时，调用 `POST /api/content/markdown-ingestion`。
- 教师端触发资料索引刷新时，调用 `POST /api/content/index/rebuild`。
- 索引刷新后调用 `POST /api/knowledge/sources/sync-content-index`，再由教师端通过 `PATCH /api/knowledge/sources/:sourceId/review` 完成审批。
- 各端展示资料索引状态时，调用 `GET /api/content/index`，只展示摘要和可见状态，不展示完整 Markdown chunk、模型信息或内部调试字段。
- 组卷、练习、复核和导出继续从服务层读取 `generationContext.teaching.contentContext`，小程序端只提交教师意图和必要参数。
- `.edupdf` 保护、工作区路径保护、乱码保护和教师复核拦截必须留在后端边界，前端过滤只作为体验优化。

任何新增 Web 上传控件或资料上下文展示，都应在本文件或小程序迁移 runbook 中记录对应的小程序/平板复用方式。

## 6. 服务层接入

文件：

```text
packages/services/src/index.js
```

生成 API 不把原始 `index.json` 当作已批准资料直接使用。教师登录后，`POST /api/assessments/draft` 通过资料库查询并匹配：

```text
KnowledgeSource (APPROVED + allowedForGeneration + licenseStatus != NOT_ALLOWED)
  -> KnowledgeChunk
```

同步来源 ID 使用完整 Markdown 路径的哈希，避免相同目录前缀截断造成来源覆盖；如果该 `markdownPath` 已存在，重扫会复用原来源 ID，从而保留教师复核历史。

请求带有 `textbookAssetId` 时，服务端先从 `TextbookAsset` 读取教材标题、学科、年级和教师维护的章节元数据，再进行资料匹配；客户端提交的教材标题和章节仅作为请求意图，不能覆盖服务端教材记录。

并按以下字段匹配资料：

- 学科。
- 年级。
- 知识点。
- 教师要求。
- 教材标题。
- 教材章节标题。

匹配结果写入：

- 模型输入 `generationContext.teaching.contentContext`。
- Assignment metadata 的 `generationContext`。
- Assignment metadata 的 `contentContext`。

如果请求绑定了 `textbookAssetId` 或 `textbookChapterId`，却没有符合学科、年级、章节或知识点的已批准来源，接口返回 HTTP `422` 和 `ASSESSMENT_CONTENT_CONTEXT_REQUIRED`，不会回退到未复核索引或客户端传入的 `contentContext`。不依赖教材的通用组卷可以使用明确的空上下文继续生成，但仍须走普通草稿和教师复核门。

## 7. 边界

- `.edupdf` 受保护教材不转换、不改写。
- 空或缺失 Markdown 输入不能构建可用索引；资料同步和生成上下文必须 fail-closed。
- 只有 `APPROVED + allowedForGeneration=true + licenseStatus!=NOT_ALLOWED` 的来源可用于生成；教材请求无命中时返回 `422 ASSESSMENT_CONTENT_CONTEXT_REQUIRED`。
- 转换结果只用于教师端和后端生成上下文。
- 学生/家长端不显示资料索引、插件、模型、供应商或内部上下文。
- 生成结果仍必须经过服务层修复和教师复核后再发布或打印。
- Web 端不是最终交付边界；学生、家长、教师、课堂平板和公共屏的实际可见内容必须按多端角色契约重新确认。

## 8. 已验证命令

```bash
cmd /c npm.cmd run content:index -- exports\markdown-ingestion-test --out exports\content-index
cmd /c npm.cmd run check:teaching-content
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check --workspace apps/api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
```

验证入口按范围选择：

- `check:generation:blueprint`：生成模板、兜底内容、题型蓝图、分值和基础审查规则的轻量验证。
- `check:generation:quality:quiz`：中预算真实模型小测质量样本，覆盖数学、语文、英语各 1 个小测；要求 `modelAvailable=true` 且 `usedDynamicFallback=false`，只评估结构化草稿内容质量，不导出 PDF。
- `check:generation:quality:formal`：正式预算真实模型质量样本，覆盖小升初数学试卷、英语个性化练习和语文阅读表达练习；要求真实模型生成和服务层审查通过，不导出 PDF。
- `check:grading:quality -- <evaluation.json>`：先校验教师确认金标契约及独立执行证据，仅对合格回放样本计算是否全对的二分一致率、状态一致率、逐题分数覆盖率/一致率/误差、总分误差、低置信召回率、高置信错误率和教师修改率。`fixtures/quality/grading-gold-cases.example.json` 不含actual；直接检查应退出1、有效样本数0、指标null、productionAccuracyClaim=false，不能当成质量通过。
- 金标契约要求 `caseId`、`sourceType`、`input`、`expected`、教师确认身份和时间；缺少教师确认、重复 case、非法状态、uncertain 缺原因或题目缺答案时，命令以 `GOLD_CASES_INVALID` 失败。
- `check:content-upload-ui`：教师端上传面板、文件输入、导入按钮、`.edupdf` 前端过滤、生成上下文摘要和 Web API multipart 上传封装。
- `check:content-context`：资料上下文链路守卫，包含资料转 Markdown、教师上传、`.edupdf` 拒绝、路径拒绝、教师登录、内容索引重建、索引同步到 `KnowledgeSource/KnowledgeChunk`、仅批准 E2E fixture、来源/chunk 命中断言、编码守卫、组卷草稿、上下文注入、草稿导出和复核/排版门禁。低预算草稿若通过 `layoutValidation`，链路继续验证教师确认和正式资产导出；若未通过，则验证 `ASSESSMENT_LAYOUT_INVALID` 正确阻断确认与正式导出。该命令允许低预算触发动态兜底，只证明链路能收口，不评估题目原创性、贴合教师要求、个性化程度、解析质量或 PDF 视觉质量。
- `check:teaching-content` / `check:teaching-content:full`：会先执行 `api:start-if-needed`，再顺序执行上传 UI 合约和内容上下文 E2E，只适合大改、发布前或需要完整链路证明时使用。

`check:teaching-content` 已加入步骤级进度输出和超时；如果运行时停在某一步，应优先看 stderr 中的 `start/done/fail` 阶段，而不是判断为“终端卡死”。每个子步骤会在最终 JSON 汇总中记录成功状态、耗时、stdout 和 stderr。

`check:content-context` 内部 API 请求和导出请求已设置超时，并输出 `content-context-e2e` 阶段进度；生成草稿和 PDF 导出仍是重步骤，不应作为小范围模板修改的默认验证。它的 JSON 顶层 `verification.verificationScope` 固定为 `link-guard`，`assessesGenerationQuality=false`，因此不能作为中预算或正式预算生成质量样本。

生成质量、资料链路和批改准确率是三类独立证据：生成质量检查要求真实模型、非动态兜底和正确 profile；资料上下文检查只证明链路能收口；批改生产准确率只能由单独的教师确认 gold 文件评估。Sol 可用、生成质量通过或 link-guard 通过都不能替代该 gold 证据。

E2E 会清理并使用专用目录 `exports/markdown-ingestion-e2e`，避免把反复测试生成的 Markdown 混入教师真实资料目录 `exports/markdown-ingestion`。脚本还会清理旧版 E2E 留在默认 Markdown 目录和 API 上传目录中的 `content-context-upload-fixture` / `protected-textbook.edupdf` 测试产物，不清理其他教师资料。

E2E 运行过程中会临时重建 `exports/content-index/index.json`，再同步到资料库；只有带唯一测试标记的 fixture 来源会被临时批准，其他 E2E 来源保持不可用于生成。生成请求必须命中该来源及其包含测试标记的 chunk。脚本使用 `try/finally` 恢复运行前的索引，并清理测试来源、测试 assignment、生成资产记录、上传文件和临时 PDF/HTML，避免测试状态污染后续生成和工作区。

## 9. 八项完成状态

截至当前版本，本链路的 8 项收口均已完成：

1. Markdown ingestion 脚本和 API 接入已完成：普通资料可转换为 Markdown。
2. 教师端资料上传 UI 已完成：教材资料中提供“上传资料上下文”入口、文件选择和导入按钮。
3. 受保护教材防护已完成：前端过滤 `.edupdf`，后端返回 `PROTECTED_TEXTBOOK_NOT_ALLOWED`。
4. 路径边界防护已完成：上传 `outDir`、索引 `inputs/outDir` 均限制在项目工作区内。
5. 资料库审批门已完成：索引先同步到 `KnowledgeSource/KnowledgeChunk`，只有 `APPROVED + allowedForGeneration=true + licenseStatus!=NOT_ALLOWED` 的来源进入生成上下文；教材请求无命中时返回 `422`。
6. 生成链路接入已完成：已批准内容会进入 `generationContext.teaching.contentContext`，并参与教师复核和学生卷/解析卷导出。
7. 可复用验证命令已完成：`check:generation:blueprint`、`check:content-upload-ui`、`check:content-context`、`check:teaching-content` / `check:teaching-content:full` 均已记录在项目说明中。
8. E2E 清理和恢复已完成：测试 Markdown 隔离到 `exports/markdown-ingestion-e2e`，旧测试残留会清理，索引会在 E2E 结束后恢复，测试来源、assignment、生成资产和临时文件会删除。
9. 教材基准守卫已完成：重扫只收 `.edupdf`，一至六年级均可识别，英语保留 PEP、语文保留统编/人教体系；导入时只退役同一教材根目录下不在最新索引中的历史文件记录，教师章节索引继续保留。

当前未纳入完成项的是 Chrome extension 真实文件选择自动化；原因是 Codex Chrome Extension native host 当前无法通信。项目内已用 UI 合约检查和 API 真实上传 E2E 覆盖上传链路。
