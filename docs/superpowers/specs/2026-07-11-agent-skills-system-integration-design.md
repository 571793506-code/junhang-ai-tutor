# Agent/Skills 系统集成与 AI 问答回档设计

## 状态

- 日期：2026-07-11
- 状态：设计方向已确认，等待书面规范复核后进入实施计划
- 集成分支：`codex/agent-skills-system-integration`
- 基线分支：`codex/miniprogram-student-report-entry`
- 待集成分支：`codex/gpt56-sol-escalation`

## 背景

当前主工作区仍有 `AGENTS.md`、`SKILLS.md` 和 `skills/project-grill-review/SKILLS.md` 三组未收口规则改动。Sol worktree 已完成独立实现与验证，并更新生成类、批改类 Skill，但尚未合入当前工作区。

项目现有 `skills/*/SKILLS.md` 是仓库内模块 Playbook，不符合 Codex 仓库级自动发现所需的 `.agents/skills/<name>/SKILL.md` 结构。AI 问答已经持久化为 `QaSession`，学生档案也会读取问答记录，但目前主要使用问题、回答和次数，缺少可控的结构化学习信号和档案准入门槛。

## 已确认决策

1. 正式集成采用新集成分支，不直接合并到 `main`，也不长期保留两套分支规则。
2. Sol worktree 在集成分支完成合并与验证前继续保留；验证通过后移除本地 worktree，远端分支保留到 PR 完成。
3. AI 视频退出本项目 Skills 主流程，不创建 AI 视频仓库级 Skill，不删除普通宣传素材，也不卸载用户级视频 Skill。
4. 学生 AI 问答不需要教师逐条预审，经过服务层安全处理后立即返回。
5. 只有已绑定学生身份且通过安全检查的成功问答，才进入学生档案辅助分析。
6. 教师端测试问答、匿名问答、身份未确认的课堂问答、模型失败、敏感内容和低质量结果不进入学生档案分析。
7. 问答本身无需教师确认；周/月档案、阶段报告和家长可见内容仍须教师确认后发布。
8. 问答只作为辅助证据，不能凭一次问答独立形成掌握程度、能力下降或薄弱点等强结论。

## 目标

- 在统一代码基线上集成 Sol 受控升级链路和 Agent/Skills 系统调整。
- 让 Codex 能自动发现项目 Skills，同时保留现有 Playbook 路径，避免旧对话和文档失效。
- 消除根规则、模块 Skill 和实际运行时之间的问答复核冲突。
- 将问答转化为可校验、可过滤、可追踪的学生档案辅助信号。
- 保持 Web、小程序、课堂平板复用相同 API、服务层和数据契约。
- 增加轻量自动守卫，防止 Skill 路径、frontmatter、命令和阶段规则再次漂移。

## 非目标

- 不把 AI 视频生产重新引入项目主流程。
- 不卸载用户级 `video-generation`、`mmx-cli` 或其他全局能力。
- 不让 AI 问答进入 Sol 自动升级范围。
- 不为第一版问答学习信号新增独立数据库表。
- 不让单次问答直接生成家长结论、成绩判断或正式档案结论。
- 不在本轮扩大 PDF 排版、自动发布、自动归档或多模型串行审查。

## 正式集成顺序

1. 从当前基线创建 `codex/agent-skills-system-integration`，承接现有未提交规则文件。
2. 先提交本设计规范，不混入现有规则或业务代码。
3. 设计规范经用户复核后，生成详细实施计划。
4. 在集成分支修正并独立提交现有 `AGENTS.md`、`SKILLS.md` 和项目 Grill 规则：删除 AI 视频项目路由，修正问答复核边界，移除机器绝对路径和过时重启说明。
5. 使用非快进合并保留 Sol 分支边界：`git merge --no-ff codex/gpt56-sol-escalation`。
6. 运行 Sol 分支已有的单元、服务、生成质量、批改、API 可见性、编码和差异检查；真实模型质量命令只按计划明确运行。
7. 在合并后的统一基线上建立标准仓库级 Skills、兼容 Playbook 路由和 `check:skills`。
8. 实施 AI 问答结构化输出、档案准入和学生档案聚合调整。
9. 完成分层验证后移除本地 Sol worktree；远端 Sol 分支保留到最终 PR 完成。
10. 以一个完整 PR 将集成分支合入 `main`。

## Agent/Skills 架构

### 根级职责

- `AGENTS.md` 只保留每次任务都必须遵守的多端边界、角色可见性、Git/Windows/编码规则、AI 输出总边界和验证路由。
- `SKILLS.md` 继续作为人工可读的模块索引和兼容入口。
- 详细模块规则继续保存在 `skills/<module>/SKILLS.md`，作为项目 Playbook。

### 自动发现层

新增 `.agents/skills/<module>/SKILL.md`，每个文件包含标准 `name` 和 `description` frontmatter，并只承担：

- 定义触发场景；
- 指向对应项目 Playbook；
- 说明需要同时读取的跨模块规则；
- 给出最小验证入口。

第一阶段不复制整份 Playbook 到 `.agents/skills`，避免双份正文漂移。

计划提供的仓库级 Skills：

- `ai-qa`
- `student-profile`
- `teaching-materials`
- `generation`
- `grading`
- `miniprogram`
- `miniprogram-ui`
- `project-grill-review`
- `prompt-context-engineering`

不提供 `ai-video-production`。

### 规则优先级

1. 当前用户明确指令；
2. 根 `AGENTS.md`；
3. 对应 `.agents/skills/<module>/SKILL.md`；
4. 对应 `skills/<module>/SKILLS.md` Playbook；
5. 相关设计文档和运行手册；
6. 外部 Skill 和第三方资料。

### Skill 守卫

新增 `check:skills`，至少检查：

- `.agents/skills/*/SKILL.md` 是否存在；
- frontmatter、名称和目录是否匹配；
- Playbook 引用是否存在；
- 根 `SKILLS.md` 路由是否完整；
- 项目 Skill 是否含用户目录绝对路径；
- 文档中的 npm 验证命令是否存在；
- 已删除的 AI 视频模块是否重新进入项目路由；
- 明确阶段规则是否互相冲突。

## AI 问答链路

### 请求上下文

API 只向服务层提交必要字段。服务层组装问答上下文，优先包含：

- 已确认的学生 ID、年级、学科；
- 问题正文和问答模式；
- 教材章节、知识点和经过检索的简短 `contentContext`；
- 近期必要的错题或任务摘要，不传完整学生档案；
- 学生端可见性、安全和年龄约束。

教师端测试问答必须标记调用角色，不得伪装成学生问答进入档案。

### 单次模型输出

继续使用 GPT-5.6 Terra 的低推理档位，一次调用返回严格结构：

```json
{
  "studentAnswer": "面向学生的回答",
  "learningSignal": {
    "knowledgePoints": [],
    "questionIntent": "concept|method|error_reasoning|expression|other",
    "difficultySignal": "none|possible|clear",
    "misconceptionHypotheses": [],
    "followUpNeeded": false,
    "confidence": "low|medium|high",
    "safetyStatus": "pass|blocked",
    "profileEligibility": true,
    "blockedReason": null
  }
}
```

服务层必须执行 parse、normalize、字段白名单、长度限制、安全检查和供应商字段清理。解析失败时可以返回经过清理的文本兜底，但该次记录 `profileEligibility=false`。

### 即时返回边界

- `studentAnswer` 通过安全检查后立即返回学生，不等待教师确认。
- 学生端、课堂平板端不接收模型名、供应商、内部 prompt、原始响应、学习信号或档案判断。
- 模型不可用、安全拦截或结构不可修复时返回统一可读提示，不进入档案分析。
- AI 问答不使用 Sol 自动升级；失败时快速降级，避免拉长学生等待时间。

## 问答学习信号持久化

第一版复用 `QaSession.metadata`，写入：

- `actorRole`
- `identityConfirmed`
- `available`
- `mode`
- `learningSignal`
- `profileEligibility`
- `blockedReason`
- `schemaVersion: "qa-learning-signal-v1"`

`QaSession.question` 和 `QaSession.answer` 继续作为内部问答记录。课堂语音问答仍写入 `VoiceInteraction`，并通过 `qaSessionId` 引用同一份学习信号，避免重复分析。

旧 `QaSession` 没有 `qa-learning-signal-v1` 时只计为历史弱证据，不自动回填，也不能形成强结论。

## 学生档案准入

问答进入 `profileEvidencePack.qaEvidence` 必须同时满足：

- `actorRole` 为 `student`，或已确认学生身份的 `classroom`；
- 存在有效 `studentId`；
- `identityConfirmed=true`；
- `available=true`；
- `safetyStatus=pass`；
- `profileEligibility=true`；
- 学习信号结构有效且不是测试记录。

不满足条件的记录留在内部审计范围，不进入学生/家长可见档案；必要时以不含正文的原因摘要进入教师侧 `blockedEvidence`。

档案聚合优先使用 `learningSignal`，不直接把完整问题和回答发送给档案模型。允许使用知识点、问题意图、困难信号、后续跟进和置信度等摘要字段。

### 证据强度

- 单次合格问答：`weak` 或 `supported` 辅助证据，只能说明发生过提问或需要继续观察。
- 同一知识点出现多次相近信号：可提升为 `supported`，仍不能单独形成最终掌握结论。
- 问答信号与已复核批改、错题、任务记录一致：可以参与形成档案结论。
- 问答与已确认记录冲突：降低置信度并进入教师复核提示，不自动选择一方。

## 可见性与教师复核

教师无需逐条审核学生问答，问答成功后立即可用。教师复核保留在下游正式输出：

- 周档案草稿；
- 月度综合档案；
- 期中/期末报告；
- 家长可见摘要；
- 正式打印或 PDF。

`profileEvidencePack`、完整问答正文、`learningSignal`、模型运行信息和内部阻断原因只对教师或内部服务可见，不进入学生/家长公开视图。

## AI 视频退出边界

- 删除项目 Grill 规则中的 AI 视频专属触发和生成工作流，不再把视频制作视为项目 Skill 模块。
- 根 `AGENTS.md`、`SKILLS.md` 和 `.agents/skills` 不包含 AI 视频模块。
- `check:skills` 阻止 `ai-video-production` 重新进入活动路由。
- 普通宣传视频、音频、脚本、图片和活动素材继续按材料资产处理，保留通用的 Git、隐私、发布和人工确认边界，不因 Skill 退出而删除。
- 用户级视频 Skill 保持安装状态，但不作为本项目默认工作流。

## 错误与降级

- 模型失败：返回统一提示，保留内部运行记录，问答不进入档案。
- JSON 解析失败：尝试有限结构修复；只能恢复学生回答时，允许即时返回但不生成档案信号。
- 身份缺失：允许按产品现有规则返回问答，但不进入任何学生档案。
- 安全拦截：不持久化可传播的敏感分析，只记录最小阻断类型。
- 学习信号低置信：保留为弱证据，不形成强结论。
- 档案聚合失败：不影响即时问答，等待下次档案聚合重试。

## 测试策略

### Skill 与规则

- 所有 `.agents/skills/*/SKILL.md` 通过标准校验。
- `check:skills` 覆盖缺失 Playbook、错误 frontmatter、绝对用户路径、无效 npm 命令和 AI 视频路由回归。
- 使用触发场景验证 AI 问答、学生档案、生成、批改、小程序和 Grill 能加载正确 Playbook。

### AI 问答

- 学生端成功问答无需教师状态即可返回。
- 教师端测试问答不具备档案资格。
- 身份未确认的课堂问答不具备档案资格。
- 模型不可用、解析失败、安全阻断和低质量结果按规则降级。
- 客户端响应不暴露模型、供应商、原始响应和学习信号。

### 学生档案

- 合格 `qa-learning-signal-v1` 进入 `qaEvidence`。
- 不合格问答不进入公开证据；教师侧仅看到最小阻断摘要。
- 单次问答不能独立形成强结论。
- 多次同类信号或与已复核证据一致时可以提升证据强度。
- 学生/家长响应不包含完整问答、`learningSignal`、`profileEvidencePack` 或内部字段。

### 集成验证

- Sol 分支单元和能力边界检查；
- `check:skills`；
- `check:encoding`；
- `check:api`；
- `check:services`；
- `check:miniprogram-js` 与 `check:miniapp1`；
- AI 问答和学生档案定向测试；
- 资料上下文或正式生成边界被修改时再运行对应内容链路检查。

## 提交边界

建议保持以下提交组：

1. 设计规范；
2. 根规则与项目 Grill 规则收口；
3. Sol 分支合并提交；
4. `.agents/skills` 和 `check:skills`；
5. AI 问答结构化学习信号；
6. 学生档案准入和聚合；
7. 文档、兼容路由和最终验证收口。

每组只显式 stage 对应路径，不使用 `git add .`。

## 成功标准

- 集成分支包含 Sol 已验证实现，原 Sol worktree 可安全移除。
- Codex 能自动发现项目 Skills，旧 Playbook 路径继续有效。
- 项目活动 Skills 中没有 AI 视频模块或路由。
- 学生成功问答无需教师预审即可返回。
- 只有身份确认、安全通过且结构有效的成功问答进入学生档案辅助分析。
- 问答信号不会单独形成强档案结论，家长可见档案仍经过教师确认。
- 多端响应不暴露供应商、模型、内部 prompt、原始响应或学习信号。
- 所有约定的轻量和集成验证通过，工作区仅保留明确的本地资产。
