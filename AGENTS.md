# 项目协作与防护规则

本仓库是“君航 AI 助教”的多端教育系统，包含网页端、接口服务、微信小程序、课堂平板和后续公共屏相关能力。后续任何 Codex/AI 对话进入本项目时，都必须优先遵守本文件。

开始任何后续开发、迁移或审查前，先阅读 `docs/51-project-pitfall-review.md` 的开工前检查和踩坑清单，并按 `docs/52-workspace-guardian.md` 执行工作区守护检查，确认是否命中已知风险。

## 多端优先规则

- 当前阶段已恢复微信小程序继续搭建；新增或修改小程序页面、路由、样式和端侧交互时，必须优先复用 API、服务层和共享契约，避免只在小程序端堆逻辑。
- 当前阶段不推进外部新项目迁移；AI 问答类、学生档案类、教材资料类、生成类和批改类经验只作为本仓库模块规范沉淀。
- 生成类和批改类当前重点是收敛规则、结构化草稿、教师复核和质量边界，不继续堆叠不稳定 PDF 排版、自动审查堆叠、自动批改归档和复杂端侧实现。
- 网页端只作为前端联调、原型验证和自动化测试入口，不是最终交付边界。
- 新增教学工作流、资料上下文、组卷、复核、导出、课堂互动等能力时，核心逻辑必须沉淀在接口、服务层、脚本、共享工具或明确的数据契约中，不能只写在网页页面状态里。
- 网页端新增的教师控件、学生控件或课堂控件，必须能说明微信小程序、课堂平板或公共屏后续如何复用同一接口和数据结构。
- 面向学生、家长、教师和平板的权限、可见字段和错误信息必须按多端角色设计；不要因为网页原型方便而暴露模型名、供应商、内部路由、调试字段或未复核内容。
- 修改网页原型后，如该能力最终需要迁移到小程序或平板端，应同步更新相关运行手册或说明，避免后续对话误判为网页专属功能。

## 外部 Skills 本地化规则

- 不要直接安装或照搬社区 skill 到本仓库主流程；先把外部经验改写成符合本项目 API、服务层、多端可见性和教师复核边界的项目内规则。
- 小程序开发可参考 `wechat-miniprogram/ai-mode-skills`、CloudBase 小程序开发 skill 和微信官方生态，但落地时必须读取 `skills/miniprogram/SKILLS.md`，只复用生成、校验、评测和开发者工具流程，不复制不明安全边界或上传发布逻辑。
- 小程序 UI 调整可参考 TencentCloudBase `ui-design`、Anthropic `frontend-design`、TDesign Miniprogram Skill 和 `tdesign-miniprogram`，但落地时必须读取 `skills/miniprogram-ui/SKILLS.md`，先确定学生端、教师端、课堂平板端的信息层级和状态，再决定组件或样式。
- 教材资料处理可参考 MarkItDown、Docling、Marker、book-to-skill 和 education-agent-skills，但落地时必须读取 `skills/teaching-materials/SKILLS.md`；MarkItDown 作为默认普通资料转 Markdown 路线，Docling 只作为复杂 PDF、表格、图片增强候选，Marker 必须先审 license 和依赖风险。
- 教育规则可参考 education-agent-skills 等教学设计经验，但只能吸收测评、学习反馈、课程结构和教师复核规则，不直接复制外部实现，不绕过本项目生成类和批改类 skill。

## Git 可追踪性规则

- 当前工作区可能包含大量未跟踪源码、文档、生成物和临时文件。操作前先运行 `git status --short` 判断范围。
- 不要使用 `git add .` 或全量通配一次性 stage 全部文件。
- 除数据库、上传资料、运行导出物、缓存、日志、大体积模型数据等数据/产物文件外，源码、配置、脚本、文档、迁移和项目规则等非数据文件原则上都要纳入 Git 管理；阶段性目标完成并验证后，应按功能或模块分组 stage，并在适当时机提交 commit，保持后续对话和回滚可追踪。
- 按 `docs/45-git-traceability-runbook.md` 分组纳入：文档规则、脚本依赖、接口/服务层、网页原型、经确认的资产或测试夹具。
- 根目录截图、临时日志、上传文件、`exports/` 运行产物、大体积模型数据和疑似误生成文件，必须先确认用途后再决定是否纳入或清理。

## 终端与 Windows 命令规则

- Windows 下不要直接使用 `npm run ...`，PowerShell 可能会拦截 `npm.ps1`。
- 优先使用项目入口：

```powershell
.\jh.cmd check:api
.\jh.cmd dev:api
.\jh.cmd check:encoding
```

- 或显式使用：

```powershell
npm.cmd run check:api
```

- 如果终端中文输出异常，先执行：

```powershell
.\scripts\windows-terminal-setup.cmd
```

- 复杂命令优先用 Node 脚本、`cmd /c`、`npm.cmd` 或 `.\jh.cmd`。避免在 PowerShell 中写含中文、反引号、管道符、复杂正则或多层引号的一行命令。
- Windows 下 `cmd /c` 会把未转义的 `|`、`&`、`>` 当作 shell 控制符；搜索多个关键词时优先拆成多条 `rg`，或使用 PowerShell 单参数调用，避免临时命令被截断、改义或误执行。
- 不要依赖超长 `git diff`、测试日志或生成日志的一次性完整输出；长输出会在工具侧被截断。需要理解大范围改动时，先用 `git diff --stat`、`git diff --name-status`、分文件 `git diff -- <path>`、`rg` 定位，再打开具体片段。

## 编码与乱码防护规则

- 所有新文件必须使用 UTF-8。
- 修改中文界面文案、接口输出、提示词、生成内容、文档后，必须运行：

```powershell
.\jh.cmd check:encoding
```

- 修改生成 HTML/PDF、导出物、历史包或备份文件后，运行：

```powershell
.\jh.cmd check:encoding:history
```

- 不允许把乱码文案作为“已有内容”继续传递给前端、PDF、小程序或模型提示词。
- 自动修复只允许处理确定映射；含替换字符、连续问号或无法可靠还原的文本，必须从当前干净源文件、git 历史、备份源或人工重写恢复。
- 项目已提供统一守卫：
  - `packages/core/src/encoding-guard.js`
  - `apps/api/src/encoding-guard-middleware.js`
  - `apps/miniprogram/utils/encodingGuard.js`
  - `scripts/encoding-guard-check.mjs`

## AI 生成与修复职责

不要把模型输出直接传给学生、家长、教师或 PDF。服务层必须负责结构化、校验和修复。

使用 `docs/41-prompt-context-engineering-playbook.md` 作为提示词、上下文工程、模型修复和教师复核流程的基准。

## Prompt Engineering 与 Context Engineering 规则

后续任何涉及 AI 问答、任务生成、小测、练习、试卷、批改、学生档案、资料上下文或模型修复的改动，都必须同时考虑 prompt engineering 和 context engineering，不能只改一句自然语言提示词。

Prompt engineering 负责“怎么说”，每次模型调用至少明确：

- 模型角色：小学三到六年级课后辅导、教研出题、作业批改、学情分析等。
- 任务类型：问答、今日任务、小测、练习、试卷、批改、档案反馈或资料摘要。
- 输出格式：需要结构化结果时必须要求严格 JSON，不混入解释性文本。
- 教学约束：学科、年级、题型、页数、是否听力、是否附加题、是否需要图形或四线格/田字格。
- 审核边界：AI 只产出草稿，教师确认后才能发布、打印、归档或同步给学生/家长。
- 可见性约束：学生、家长、课堂平板和公共屏不得看到供应商、模型名、内部 prompt、调试字段或未复核内容。

Context engineering 负责“给模型看什么”，服务端调用模型前应组装结构化上下文包，而不是只转发教师的一句话。生成类、批改类和档案类优先使用 `generationContext`，至少包含：

- `request`：教师原始要求、意图、请求 ID、教师身份。
- `target`：学生、班级、年级、学科和作用范围。
- `teaching`：教材、章节、知识点、教师重点、资料索引和 `contentContext`。
- `studentSignals`：近期错题、学习任务、批改记录、档案摘要和薄弱点。
- `output`：A4 页数、题型结构、答案解析、教师复核要求和学生可见标签。
- `rules`：结构修复、乱码防护、供应商隐藏、未复核拦截和导出规则。

禁止模式：

- 不要只把教师自由文本直接传给 DeepSeek、MiniMax 或其他模型。
- 不要把模型原始输出直接落库、导出 PDF 或展示给学生/家长。
- 不要在前端页面中拼接核心 prompt 或临时上下文，核心组装逻辑必须放在接口、服务层、脚本或共享工具中。
- 不要为了 Web 原型方便绕过教师复核、结构校验、乱码检查或多端可见性规则。

模型输出进入持久化、导出或展示前，必须经过 parse、normalize、validate、repair 和 review-state handling。涉及资料上下文时，必须优先复用内容索引链路，把匹配结果写入 `generationContext.teaching.contentContext`，并保留教师复核状态。

模型输出进入持久化、导出或展示前，至少检查：

- JSON 是否有效；
- 题目数量是否满足试卷/小测/练习页数；
- 是否包含答案、解析步骤、考点、易错点；
- 是否缺少图形元数据；
- 是否暴露模型、供应商、内部路由或调试字段；
- 是否有乱码。

## 产品可见性规则

- 学生/家长界面只显示“AI生成”或可用状态，不展示 DeepSeek、MiniMax、模型名、接口地址或内部错误细节。
- 教师端可以展示服务状态、审核状态和运维摘要，但不能把内部密钥、完整模型配置、数据库连接等暴露给前端。
- 教师端、学生端、课堂平板端权限必须分离。

## 试卷与打印导出规则

生成类内容必须导出两类文件：

- 学生作答 PDF；
- 答案解析 PDF。

默认页数：

- 小测：2 页 A4；
- 练习：2 页 A4；
- 试卷：4 页 A4。

学生卷不能靠大量空白区域凑页数。解析卷不能只有答案，必须包含解析步骤和易错提醒。

小测、练习、试卷必须使用不同生成结构：

- 小测：围绕教材单元、章节或当周教学目标，短而集中；英语小测默认包含中英文互译、写单词、造句、少量选择题和一篇阅读，不默认使用文章选词填空、完形填空、短文语法填空或写作。中译英、根据中文写英文单词或短语、造句和中译英句子补全必须用题干在上、英语四线格在下的上下结构作答，不得用普通横线替代。
- 练习：围绕学生近期错题、薄弱点或教师指定目标，服务于巩固和补弱；英语练习默认包含词汇巩固、句型表达、易错选择和短阅读，不套用完整试卷结构。
- 试卷：面向单元考、月考、期中、期末、小升初或综合测评，使用完整考试结构；英语试卷才默认包含文章选词填空、短文语法填空或完形填空、正式阅读和写作。

## 验证规则

根据改动范围执行验证：

```powershell
.\jh.cmd check:encoding
.\jh.cmd check:api
.\jh.cmd check:miniprogram-js
.\jh.cmd check:services
```

涉及生成、资料上下文、教师复核或导出时，按改动范围分层验证，不要把完整 E2E 作为每个小改动的默认命令：

```powershell
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:generation:layout
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:teaching-content:full
```

- 只改生成模板、题型蓝图、兜底内容或审查规则时，优先运行 `check:generation:blueprint`；它不启动 API、不调用模型、不导出 PDF。
- 检查已生成学生卷 PDF 页数、页眉页码、异常留白或小测/练习套用试卷题型时，运行 `check:generation:layout`；它只读取本地 PDF，不调用模型，也不证明内容原创性。
- 只改资料上传 UI 或 API multipart 封装时，运行 `check:content-upload-ui`。
- 改资料索引、`generationContext.teaching.contentContext` 注入、教师复核或导出边界时，运行 `check:content-context`。
- 大改、发布前或需要覆盖教师登录、资料索引、生成草稿、草稿导出、复核拦截、教师确认和正式 PDF 导出时，才运行 `check:teaching-content:full`。

旧的兼容入口仍可用：

```powershell
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:teaching-content
```

`check:teaching-content` / `check:teaching-content:full` 会覆盖教师登录、资料索引重建、乱码守卫、`generationContext.teaching.contentContext` 注入、草稿审查导出、未复核拦截、教师确认以及正式学生卷/解析卷导出；该链路较重，必须依赖脚本进度输出和超时，不应用来替代小范围验证。

网页端代码变更后运行：

```powershell
npm.cmd run typecheck --workspace apps/web
```

涉及历史导出、备份、生成文件时运行：

```powershell
.\jh.cmd check:encoding:history
```
