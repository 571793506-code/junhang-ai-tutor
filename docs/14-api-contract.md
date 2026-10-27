# 三端共享 API 契约

## 2026-09-11 生成用途契约

`POST /api/assessments/draft` 和 `POST /api/assessments/generation-jobs` 接收以下业务字段，现有教师权限、学生可用性、教材审批与正式导出门禁继续适用：

- `purpose`：省略为 `comprehensive`，按现有小测/练习/试卷蓝图生成；`focused` 为专项；`multi_day` 为多日计划；`explanation` 为结构化讲解。
- `requestedItemTypes`：专项必填，允许 `fill/choice/judgment/calculation/solution/operation/reading/writing/listening`；`requestedItemCount` 为 1–100 的整数，至少覆盖指定题型数。
- `dayPlan`：多日用途必填，1–30 项。每项包含 `dayId`、`goal`、`requestedItemCount`、`requestedItemTypes`；省略 dayId 时按顺序生成 `day-N`，题型可继承外层。dayId 必须唯一，目标不得为空。

用途、题型、数量或 dayId 无效时，在入队和调用模型前返回 HTTP 422 / `GENERATION_PURPOSE_INVALID`。模型、规则、prompt 与内部预算不属于客户端契约。

讲解草稿保存在 `parsedDraft.explanation`，包含 `concept`、`steps`、`workedExamples`（prompt、answer、analysisSteps）和 `commonMistakes`。此用途不创建可批改答案包，不自动套用试卷 PDF；异步任务的 `draftAsset`、`layoutValidation` 可以为 null。工作台用途选择和讲解复核界面属于后续 UI 任务。所有结果仍是教师待复核草稿。

本阶段新增 `apps/api`，默认本地地址：

```bash
http://127.0.0.1:8787
```

启动：

```bash
npm run dev:api
```

自检：

```bash
npm run check:api
```

## 多端契约原则

Web 端只用于联调、原型验证和自动化测试。微信小程序、课堂平板和后续公共屏复用同一组 API、服务层逻辑和数据契约，不在前端页面脚本中复制组卷、资料上下文、生成修复、复核、导出或权限判断等核心逻辑。

多端接口设计必须同时确认：

- 请求字段：前端只提交角色、身份、教师意图、学生范围、文件或必要参数。
- 响应字段：学生/家长/课堂平板/公共屏只接收可见状态和已发布内容；教师端可接收审核状态、运维摘要和资料索引摘要。
- 权限边界：教师、学生、课堂设备和公共屏使用不同登录或设备绑定状态。
- 可见性规则：不向学生、家长、课堂平板或公共屏暴露模型名、供应商、API 地址、内部 prompt、完整 Markdown chunk、调试字段或未复核内容。
- 验证命令：改动接口后按范围运行 `cmd /c npm.cmd run check --workspace apps/api`、`cmd /c npm.cmd run check:content-context`、`cmd /c npm.cmd run check:teaching-content`、`cmd /c npm.cmd run check:miniprogram-js` 和 `cmd /c npm.cmd run check:encoding`。

## 多端能力清单

| 能力 | 主要接口 | 多端复用方式 | 角色与可见性 | 重点验证 |
| --- | --- | --- | --- | --- |
| 启动数据 | `GET /api/bootstrap` | Web、小程序、平板拉取同一套启动摘要 | `students[].canReceiveNewWork` 是新任务、生成和批改的唯一可选标记；历史档案仍可见，不展示内部配置 | `check --workspace apps/api`、`check:miniprogram-js` |
| 学生登录 | `POST /api/student-login` | 学生 Web/小程序共用登录校验 | 只返回学生可见身份和学习状态 | `check --workspace apps/api` |
| 教师登录 | `POST /api/teacher-login` | 教师 Web/小程序共用登录校验 | 可返回教师工作台所需状态，不返回完整密钥或数据库配置 | `check --workspace apps/api` |
| 课堂设备登录 | `POST /api/classroom/device-login` | 课堂平板绑定设备后拉取课堂状态 | 只显示课堂任务、解锁状态和必要学生互动信息 | `check --workspace apps/api`、`check:miniprogram-js` |
| AI 问答 | `POST /api/ai/qa`、`POST /api/classroom/voice-qa` | 学生端、课堂平板复用同一服务端问答契约 | 最多一次 Terra 低推理调用，Terra 不可用时零调用且绝不调用 Sol；学习者响应不含学习信号或内部路由元数据 | `check --workspace apps/api`、`check:miniprogram-js` |
| 今日任务 | `POST /api/teacher/tasks`、`GET /api/bootstrap` | 教师创建，学生/平板从启动数据或任务接口读取 | 学生可见任务统一返回 `summary`（紧凑目标）和 `description`（完整目标、步骤及家长查看说明）；未发布或教师未确认内容不进入学生/平板可见区 | `check --workspace apps/api`、`check:miniprogram-js` |
| 组卷草稿 | `POST /api/assessments/draft` | 教师端提交要求、结构化题量和章节，服务层生成并修复草稿 | 草稿只供教师复核，不直接展示给学生/家长 | `check:content-context`、`check:teaching-content` |
| 组卷任务队列 | `POST/GET /api/assessments/generation-jobs`、`POST /api/assessments/generation-jobs/:jobId/cancel` | Web、小程序和教师工作台复用同一任务状态、取消和草稿链接 | 队列最多并行运行 5 个独立任务；取消只清理未完成草稿，不影响其他任务 | `check:content-context`、`check --workspace apps/api` |
| 教材修复与临时小测 | `POST /api/assessments/generation-recovery`、`POST /api/assessments/draft` | 各端先复用教材重扫和重新校验；教师可在证据仍不足时创建临时小测草稿 | 修复不自动批准资料；临时草稿只能由教师要求生成，且不声称教材依据 | `check:content-context`、`check:encoding` |
| 草稿审查导出 | `POST /api/assessments/:assignmentId/draft-export` | 教师端打开审查 PDF | 返回审查资产、`pending_teacher_review` 和统一 `layoutValidation` | `check:content-context` |
| 教师复核 | `POST /api/assessments/:assignmentId/draft-review` | 教师端确认或拒绝草稿 | 只有 `layoutValidation.ok=true` 的草稿才允许 `accept` | `check:content-context` |
| 正式导出 | `POST /api/assessments/:assignmentId/print-export` | 教师确认后导出学生卷和解析卷 | 学生卷不包含答案；解析卷只给教师或授权场景 | `check:content-context`、`check:teaching-content` |
| 图片提交批改 | `POST /api/submissions/grade` | 学生端、教师端批量上传复用同一接口 | 不确定 OCR 或批改结果进入教师复核，不向学生发布未确认结论 | `check --workspace apps/api` |
| 批改工作台 | `GET /api/grading/workbench`、`GET /api/grading/workbench/:submissionId`、`PATCH /api/grading/workbench/:submissionId/questions/:questionId` | 教师 Web/小程序读取同一套页面、逐题、标注、置信度和复核状态，并可逐题修正 | 只给教师端使用；学生/家长端不展示未确认逐题批改；逐题修正后仍需教师确认归档 | `check --workspace apps/api`、`typecheck --workspace apps/web` |
| 批改复核归档 | `POST /api/review/submissions/:submissionId/mark-reviewed`、`POST /api/grading/workbench/:submissionId/archive` | 教师 Web/小程序确认分数、备注后归档 | 低置信、需教师复核或仅有 provisionalScore 的结果，必须提交教师确认分数；否则不入档、不创建错题记录 | `check --workspace apps/api`、`typecheck --workspace apps/web`、`check:miniprogram-js` |
| 学生长期成长档案 | `POST /api/students/:studentId/profile/draft`、`POST /api/students/:studentId/profile/publish`、`POST /api/students/:studentId/profile/aggregate`、`GET /api/students/:studentId/profile` | 教师端生成周档案或月度综合档案草稿；学生/家长端只读取教师发布后的结构化摘要；Web 仅作联调原型，小程序复用同一契约 | 教师可见 `teacherReview` 和 `profileEvidencePack`；学生/家长不可见证据包、复核提示、供应商、模型、prompt、debug 或未复核来源 | `check --workspace apps/api`、`typecheck --workspace apps/web`、`check:encoding` |
| 周/月档案打印版 | `POST /api/students/:studentId/profile/print` | 教师端基于周/月综合档案草稿生成打印版 HTML，并优先渲染 PDF；用于当前小程序未正式使用时人工发送给家长 | 仅教师端保存和下载；资产 `metadata.visibility=teacher_profile_print`；正式正文来自 HTML/PDF 模板，不来自 image 2 图片文字 | `node --test apps/api/src/student-growth-profile.test.mjs`、`check --workspace apps/api`、`typecheck --workspace apps/web`、`check:encoding` |
| 期中/期末阶段报告 PDF | `POST /api/students/:studentId/term-report/draft`、`POST /api/students/:studentId/term-report/:reportId/pdf`、`POST /api/students/:studentId/term-report/:reportId/mark-sent`、`GET /api/students/:studentId/term-reports` | 教师端生成报告草稿、编辑正文、保存 PDF 或 HTML 资产，下载后通过微信私聊人工发送给家长；不接入微信自动外发 | 教师可见 PDF 链接、微信话术和草稿；学生/家长端不显示报告正文、PDF 链接或草稿，只有老师标记已人工发送后显示“老师已发送阶段报告给家长” | `node --test apps/api/src/student-term-report.test.mjs`、`check --workspace apps/api`、`typecheck --workspace apps/web`、`check:encoding` |
| 资料索引摘要 | `GET /api/content/index` | 教师 Web/小程序查看资料上下文状态 | 只展示摘要、资料数、科目、知识点，不返回完整 Markdown chunk | `check:content-context`、`check:teaching-content` |
| 资料上传转 Markdown | `POST /api/content/markdown-ingestion` | 教师端上传普通教学资料 | 仅教师端可用；拒绝 `.edupdf`；上传路径限制在工作区内 | `check:content-upload-ui`、`check:teaching-content` |
| 资料索引重建 | `POST /api/content/index/rebuild` | 教师端触发重建，组卷服务读取结果 | 仅教师端可用；返回索引摘要，不泄露内部上下文 | `check:content-context`、`check:teaching-content` |
| 资料库来源 | `GET /api/knowledge/sources`、`POST /api/knowledge/sources` | 教师 Web/小程序查看和登记资料来源 | 网络参考默认待复核，不直接进入学生端或生成流程 | `check:api`、`check:miniapp1`、`check:encoding` |
| 资料库同步与复核 | `POST /api/knowledge/sources/sync-content-index`、`PATCH /api/knowledge/sources/:sourceId/review` | 教师端把内容索引同步为资料来源，并决定是否可用于生成 | 只有教师复核通过且允许生成的来源，才可作为结构参考 | `check:api`、`check:teaching-content` |

## 状态接口

- `GET /health`：API、数据库、配置摘要。
- `GET /api/status`：API + 数据库 + AI provider 状态。
- `GET /api/ai/status`：GPT-5.6、MiniMax 和可选紧急回滚提供商的教师运维状态。

## 学生与权限

- `POST /api/students`
  - 教师端登记学生，生成六位学生专属码。
  - 关键字段：`displayName`, `grade`, `className`, `guardianPhone`, `responsibleTeacherId`, `createdByTeacherId`。

- `POST /api/student-login`
  - 学生端/小程序登录校验。
  - 关键字段：`displayName`, `guardianPhone`, `accessCode`。

- `POST /api/students/:studentId/disable-access`
  - 退课或停用时禁用学生登录码，不删除学生档案。

- `PATCH /api/students/:studentId/profile`
  - 教师端更新学生当前年级，当前允许三至七年级（可传中文年级、数字或“初一”等可解析形式）。
  - 只更新学生资料中的 `grade`，不修改登录状态，也不改写历史任务、批改、错题或成长档案；返回 `historyRetained=true` 并写入教师审计记录。
  - 必须通过教师学生范围校验；年级不在可服务范围时返回 `STUDENT_GRADE_INVALID`。

- `DELETE /api/students/:studentId/access`
  - 教师端移除学生权限，必须提交完全匹配的 `confirmationName`。
  - 这是软删除：关闭登录、移除新任务/生成/批改资格并保留历史任务、批改、错题和成长档案；操作按教师学生范围校验并写入审计记录。

- `GET /api/teachers/:teacherId/students`
  - 教师端查看自己绑定的学生。

## 学生档案与长期成长档案

- `POST /api/students/:studentId/profile/draft`
  - 教师端生成待复核档案草稿。
  - 请求字段：`periodType`，可选值为 `weekly` 或 `monthly`；默认 `weekly`。
  - 周档案对应 `profileType=weekly_growth`，月度综合档案对应 `profileType=monthly_comprehensive_growth`。
  - 返回教师可见结构：`period`, `publishedView`, `teacherReview`, `profileEvidencePack`, `sourceCounts`, `timeline`, `narrative`。月度 `publishedView.learningTrends` 由服务端按教师确认批改计算近期提升、下降或基本稳定，不能由 AI 草稿覆盖。
  - `learningTrends` 优先按相同 `subject + knowledgePoint` 比较；若知识点没有形成可比趋势，但同一学科前后周期各有至少 2 份独立的教师确认批改，则返回 `scope=subject`、`knowledgePoint=学科整体` 的学科整体兜底。每项包含 `current`、`previous`、`deltaPercentagePoints`、`status`、`comparisonText`、`parentAssist`、`evidenceRefs`；样本不足时 `status=insufficient`、变化值为 `null`，展示层使用“暂无/待定”，不得拼接为 `null%`。
  - `current/previous` 包含 `periodLabel/earnedScore/maxScore/scoreRate/questionCount/submissionCount/evidenceRefs`；得分率按有效题目总得分/总满分计算，本月与前月各至少 2 份独立批改才判断变化，差值大于 5 个百分点为 `improving`、小于 -5 为 `declining`，其余为 `stable`。仅纳入 `REVIEWED/GRADED`、`archiveEligible=true`、无待复核/暂定分且非低置信的批改，以及教师逐题确认的有效评分；缺失、越界评分和重复提交不计入。
  - 趋势说明必须保留样本范围/难度限制，不等同于长期能力变化。`teacherReview.learningTrends` 额外包含仅教师可见的 `teacherNextCheck`；月度 `printView.sections.learningTrends` 复用公开趋势。本期没有可用批改时不安排具体家长任务；周档案的公开趋势为空、打印不含该节。AI合并不能覆盖服务端趋势，发布和正式打印仍须教师确认。
  - 周/月档案统一使用综合成长档案模板，不提供单科独立模板入口。
  - 返回 `printView` 打印模板结构，用于教师端审查后打印、保存或后续生成 PDF。`printView.templateType=comprehensive_growth_archive`，`printView.renderingPolicy.pdfTextSource=html_template`，`printView.renderingPolicy.imagePreviewUsage=visual_reference_only`。
  - `profileEvidencePack` 由任务、已复核批改、错题、阶段报告、课堂互动、AI 问答、语音互动和 `teacherObservationEvidence` 组成。通用 `BehaviorEvent` 仅作为审计与原始日志，不直接进入档案；课堂互动以受控的 `VoiceInteraction` 链路进入。`teacherObservationEvidence` 只接收 `teacher-observation-v1` 的教师确认每日观察，保留分科表现与下次辅导动作；它进入教师侧草稿、重点科目、时间线及周/月打印证据覆盖，但单条观察不得提高掌握度或分数，也不自动发布给学生或家长。问答只接受服务端计算合格且精确匹配 `qa-learning-signal-v1` 的记录；教师测试、匿名或身份未确认课堂、不可用、不安全、结构异常、日期无效和 legacy 问答排除在公开证据外，并仅以最小原因摘要进入教师侧 `blockedEvidence`。
  - 单条来源问答不能提高掌握度、分数或形成强结论；同知识点重复信号可形成 `supported` 但仍是辅助证据。教师确认的非问答证据优先，冲突进入教师复核备注。

- `POST /api/students/:studentId/profile/publish`
  - 教师确认并发布档案。
  - 请求字段：`text` 为教师最终确认正文，`snapshot` 可传入结构化草稿；教师确认当前内容后须提交布尔值 `confirmTeacherReview: true`。
  - API 会把教师正文写入 `publishedText`，并保留结构化 `publishedView` 供学生端展示。
  - 未显式确认时返回 `409 PROFILE_TEACHER_CONFIRMATION_REQUIRED`，即使证据无待办或客户端快照声称已确认也不例外。确认身份及时间来自当前教师会话；草稿不能覆盖服务端证据、待确认项或确认元数据。前端不得自动把 draft 直接发布给学生或家长。

- `POST /api/students/:studentId/profile/print`
  - 教师端基于周/月综合成长档案草稿生成打印版资产。
  - 请求字段：`snapshot` 为教师当前审查的结构化草稿；`text` 为教师编辑后的公开正文；`periodType` 可作为无草稿时的兜底周期；教师确认当前内容后须提交布尔值 `confirmTeacherReview: true`。
  - 与发布共用教师确认门禁；缺省、false 或字符串确认均返回 `409 PROFILE_TEACHER_CONFIRMATION_REQUIRED`，在任何文件和资产写入前拦截。
  - API 使用 `renderStudentGrowthProfilePrintHtml` 生成 HTML，并优先渲染 PDF。
  - 返回 `asset` 和教师可见 `snapshot`；`asset.kind` 为 `student-profile-print-pdf` 或 `student-profile-print-html`。
  - `asset.metadata.visibility=teacher_profile_print`，`metadata.templateType=comprehensive_growth_archive`，`metadata.htmlUrl` 保留同内容 HTML 资产。
  - 资产及审计元数据记录服务端生成的 `confirmedByTeacherId`、`confirmedAt`。
  - 该接口不自动发布到学生端，也不自动发送微信；老师下载后人工发送或打印。

- `POST /api/students/:studentId/profile/aggregate`
  - 兼容型教师草稿聚合接口，默认按 `periodType=monthly` 生成月度综合档案。
  - 仅教师会话可调用；学生不能调用。
  - 聚合结果持久化为 `draftStatus=draft`，仍需教师通过发布接口确认后才能成为学生可见内容。
  - 学生仅通过 `GET /api/students/:studentId/profile` 读取教师已发布内容，不得读取未发布草稿。

- `GET /api/students/:studentId/profile`
  - 读取已保存档案。
  - 教师角色可见 `teacherReview` 和 `profileEvidencePack`，用于复核来源、样本不足说明和发布清单。
  - 学生角色只返回已过滤快照：保留 `profileType`, `period`, `publishedView`, `weeklyScore`, `mastery`, `strengths`, `risks`, `tone`, `timeline`, `narrative` 等可见字段；移除 `teacherReview`, `profileEvidencePack`, `provider`, `model`, `prompt`, `debug`, `raw` 等内部字段。

### 期中/期末阶段报告 PDF

- `POST /api/students/:studentId/term-report/draft`
  - 教师端生成期中或期末阶段报告草稿。
  - 请求字段：`reportType` 可选 `midterm` 或 `final`；`periodLabel` 为教师填写的阶段名称，例如 `2026春季期中`。
  - 报告复用 `StudentReport`，阶段交付状态写入 `metadata.termReport`，不新增首期数据库表。
  - 初始状态为 `draft`，可见性为 `teacher_pdf_only`，只返回给教师。
  - 草稿模板字段：`template`, `sections.overview`, `sections.stageConclusions`, `sections.growthTrajectory`, `sections.evidenceSummary`, `sections.evidenceCoverage`, `sections.subjectOverview`, `sections.subjectAbilityMap`, `sections.focusSubjects`, `sections.commonCauseAnalysis`, `sections.learningProcess`, `sections.stableGrowth`, `sections.tutoringFocus`, `sections.actionPlan`, `sections.homeSchoolCollaboration`, `sections.parentNextSteps`, `sections.parentCommunicationSummary`, `sections.teacherReviewChecklist`；其中重点科目最多 1 到 2 个，包含证据、能力观察、优先动作和老师下一步。
  - `renderingPolicy.pdfTextSource=html_template`，正式 PDF 正文必须由服务端 HTML/PDF 模板渲染；`renderingPolicy.imagePreviewUsage=visual_reference_only`，image 2 候选图只用于教师端视觉和信息层级讨论。
  - `teacherReviewChecklist` 只供教师端保存前复核，不进入家长 PDF 正文或学生端状态卡。
  - 期中模板强调阶段掌握、共性错因和后续两到四周重点；期末模板强调学期成长、稳定强项和假期或下阶段建议。

- `POST /api/students/:studentId/term-report/:reportId/pdf`
  - 教师端提交最终确认正文 `teacherText`，服务端生成阶段报告 HTML，并优先渲染 PDF。
  - 返回 `report` 和 `asset`；`asset.metadata.visibility=teacher_pdf_only`，用于教师下载保存。
  - 若 PDF 运行时不可用，保留同内容 HTML 资产，状态仍按教师端保存流程返回，便于后续补跑或人工处理。
  - PDF/HTML 资产不进入学生端正文展示，不作为小程序平台自动外发内容。

- `POST /api/students/:studentId/term-report/:reportId/mark-sent`
  - 教师下载并通过微信私聊人工发送给家长后，手动记录发送状态。
  - 只有已生成 `pdfUrl` 的报告允许标记；否则返回 `PDF_REQUIRED`。
  - API 写入 `status=sent_manually`, `sentManuallyAt`, `sentByTeacherId`。

- `GET /api/students/:studentId/term-reports`
  - 教师角色返回草稿、PDF 状态、PDF 链接、微信话术和教师编辑正文。
  - 学生角色只返回 `sent_manually` 的阶段报告状态卡；`summary` 固定为“老师已发送阶段报告给家长”，不返回 `teacherEditedText`, `pdfUrl`, `draft`, `wechatMessage`。
  - 周档案和月度综合长期成长档案仍通过 `profile/draft` 与 `profile/publish` 审核后发布至学生端；期中、期末仅走教师端 PDF 保存和人工微信发送。

结构化快照核心形态：

```json
{
  "profileType": "weekly_growth",
  "period": { "type": "weekly", "label": "2026-06-29 至 2026-07-05", "start": "2026-06-29", "end": "2026-07-05" },
  "publishedView": {
    "periodType": "weekly",
    "periodLabel": "2026-06-29 至 2026-07-05",
    "overview": { "text": "本周成长摘要", "evidenceRefs": ["task_1"], "confidence": "supported" },
    "subjectOverview": [],
    "focusSubjects": [],
    "correctionLoop": [],
    "stableGrowth": [],
    "tutoringFocus": [],
    "parentNextSteps": [],
    "learningTrends": [],
    "timelinePreview": []
  },
  "printView": {
    "templateType": "comprehensive_growth_archive",
    "periodType": "weekly",
    "periodLabel": "2026-06-29 至 2026-07-05",
    "title": "周综合成长档案",
    "pageHint": "1-2页",
    "renderingPolicy": {
      "pdfTextSource": "html_template",
      "imagePreviewUsage": "visual_reference_only",
      "requiresTeacherReview": true
    },
    "sections": {
      "comprehensiveSummary": { "text": "本周综合成长摘要", "evidenceRefs": ["task_1"], "confidence": "supported" },
      "subjectOverview": [],
      "focusDirections": [],
      "correctionLoop": [],
      "stableGrowth": [],
      "tutoringPlan": [],
      "parentNextSteps": []
    }
  },
  "teacherReview": {
    "evidenceItems": [],
    "sampleLimitNotes": [],
    "pendingConfirmations": [],
    "internalRisks": [],
    "learningTrends": [],
    "publishChecklist": []
  },
  "profileEvidencePack": {
    "period": {},
    "taskEvidence": [],
    "gradingEvidence": [],
    "mistakeEvidence": [],
    "qaEvidence": [],
    "classroomEvidence": [],
    "teacherObservationEvidence": [],
    "blockedEvidence": [],
    "sourceQuality": {}
  }
}
```

期中、期末或更正式的阶段总结不作为学生端页面正文扩展；按教师确认后的 PDF 交付给家长查看，仍复用同一证据包和教师复核边界。学生端只展示发送状态，不展示阶段报告全文、PDF 链接或下载入口。

## AI 问答与任务

- `POST /api/ai/qa`
  - 学生端问答入口，与课堂语音问答复用同一服务端契约。
  - 会自动判断 `GUIDED_THINKING` 或 `KNOWLEDGE_EXPLANATION`。
  - 关键字段：`studentId`, `studentName`, `deviceId`, `subject`, `question`。
  - 服务端最多执行一次 `gpt-5.6-terra` 低推理文本调用；Terra 不可用时调用数为 0，且问答绝不调用 Sol。实际调用成功时，由同一次调用生成严格结构化的 `studentAnswer + learningSignal`。
  - 模型在 `learningSignal` 中输出结构化 `safetyStatus`；服务端校验和规范化该信号，并计算最终 actor、身份确认、可用性、结构有效性、准入和阻断原因。合格回答立即返回，不需要教师预审。
  - 只有 `schemaVersion=qa-learning-signal-v1` 且服务端判定合格的学生/已确认课堂记录进入档案辅助分析；教师测试、匿名或身份未确认课堂、不可用、不安全、结构异常、日期无效和 legacy 记录均排除。
  - 学生响应只返回 `available`, `mode`, `answer`；不得包含 `learningSignal`, provider/model/routing, raw, prompt, debug, `profileEligibility`, `blockedReason` 或其他准入/阻断元数据。

- `POST /api/classroom/voice-qa`
  - 先由服务端确认课堂设备范围和当前学生身份，再复用同一问答契约；未确认身份的课堂问答不进入档案公开证据。
  - 响应可在学生问答白名单字段外增加 `transcript` 和 `voice: { available, status, audioUrl, reason }`，不得返回学习信号或内部模型/准入元数据。

- `POST /api/teacher/tasks`
  - 教师端输入要求，生成今日任务草稿；`createTask=true` 且数据库可用时落库。

## 生成与批改

- `POST /api/assessments/generation-recovery`
  - 仅教师且数据库可用时调用。服务端依次重扫教材资产、重建普通教学资料索引、同步资料库，再重新执行教材与已复核来源校验。
  - 返回 `recovery.status`（`ready` 或 `review_required`）、各修复步骤、失败摘要和 `temporaryDraftAllowed`。没有重新选择真实 `textbookAssetId` 或资料仍未审核时，不能把修复结果视为可按教材生成。
  - 此接口不会创建资料来源、自动设置 `allowedForGeneration` 或绕过版本、系列、册次、年级和学科匹配；需要教师在资料审核流程中确认后，教材小测才能恢复。

- `POST /api/assessments/generation-jobs`、`GET /api/assessments/generation-jobs`、`POST /api/assessments/generation-jobs/:jobId/cancel`
  - 教师端异步创建、查询和取消组卷任务；队列最多并行运行 5 个独立任务。每个任务保留自己的教材上下文、草稿导出、复核状态和最终导出记录。
  - 创建任务与同步草稿共用同一请求校验和教师复核门禁。取消只作用于当前教师自己的未完成任务，并在取消后清理该任务尚未完成的草稿资产。

- `POST /api/assessments/draft`
  - 生成小测、练习、试卷草稿。
  - 关键字段：`kind`, `grade`, `subject`, `difficulty`, `requirement`。
  - 小测和练习可传整数 `requestedItemCount`；服务层按学科蓝图缩放各题型并守住最终总题量，模型分区也接收同一题量目标。试卷仍按正式结构和页数规划，不使用该字段缩成小测结构。
  - 贵州遵义教材基准固定为：语文统编版 / 人教体系、数学人教版、英语人教版 PEP。教材小测或任何带教材标题、章节 ID、章节标题的请求必须提交真实 `textbookAssetId`；不能只传 `textbookChapterTitle` 让模型猜教材。
  - 当前初中数学第一阶段支持七年级（初一）人教版的练习、小测和外部材料批改；八、九年级请求必须等待对应教材资产和规则接入，不得回退为小学六年级。
  - 服务端以 `TextbookAsset` 为权威，派生 `textbookEdition`, `textbookSeries`, `textbookVolume`, `textbookRegion` 并写入 `generationContext.teaching.textbook`。客户端同名字段不能覆盖服务端教材记录。
  - 未绑定任何教材字段的综合测评仍可作为通用生成请求；一旦声明教材或章节，若教材不符合遵义基准，返回 `422 ASSESSMENT_TEXTBOOK_BASELINE_MISMATCH`；若没有已复核且允许生成的同学科、年级且不与版本、系列和册次冲突的资料，返回 `422 ASSESSMENT_CONTENT_CONTEXT_REQUIRED`，且不调用模型。
  - 教材证据暂未恢复时，教师可显式传 `generationBasis=teacher_requirement_emergency` 创建临时草稿。它只允许 `kind=小测`，并且必须包含年级、科目和明确 `requirement`；请求不得携带任何 `textbook*` 字段，否则返回 `422 EMERGENCY_DRAFT_TEXTBOOK_FIELDS_NOT_ALLOWED`。
  - 临时草稿的 `generationContext` 会标记 `teacherRequirementEmergency=true`，模型只能依据教师范围出题，不得声称引用教材原文、版本、册次或章节。它仍须走异步任务、PDF 草稿审查和教师确认后正式导出，不能替代教材资料审核。
  - 可选字段：`generationProfile`, `assessmentTotalTimeoutMs` / `generationTimeoutMs`, `assessmentMaxTokens` / `generationMaxTokens`。其中 timeout 控制最多等待多久，maxTokens 控制模型最大输出长度；预算耗尽后服务层返回可复核动态兜底草稿，不继续等待后续模型 fallback。
  - 默认生成预算由服务层按场景推导：E2E/联调可显式传短预算；小测使用 `quiz-standard`，默认 120s / 16000 tokens；普通练习使用 `practice-standard`，默认 150s / 16000 tokens；试卷和个性化练习使用 `formal-full`，默认 240s / 24000 tokens。小测/练习的 2 个紧凑分区单区最多 8000 tokens，试卷的 4 个分区按默认预算各 6000 tokens。
  - `check:content-context` 中的低预算 E2E 已降级为 `link-guard`，只验证资料上下文、预算退出、教师复核和 PDF 导出链路，不作为生成内容质量验收。
  - 默认规则：小测/练习两页 A4，试卷四页 A4。
  - 服务层模型链路：GPT-5.6 按三科和 `kind` 蓝图分区生成，小测/练习为 2 个并行分区、试卷为 4 个分区且最多 2 路并发；失败分区最多重试一次。MiniMax 不承担文本组卷，DeepSeek 不进入默认路由。
  - 默认主模型为 `gpt-5.6-terra`：小测、普通练习和个性化练习使用 `medium`，正式试卷使用 `high`。只有可恢复 availability 故障或明确 quality 故障允许把最小失败分区升级到一次 `gpt-5.6-sol/high`；configuration 故障和教学证据不足的 evidence 故障不升级，后者直接进入教师复核。
  - 局部 Sol 生成使用独立 180 秒预算，token 继承原分区；Terra 完全没有可用分区时才允许整项 Sol 重做，并继承小测 120 秒、普通练习 150 秒、试卷或个性化练习 240 秒的场景预算。Sol 后不串接第三个文本模型。
  - 部分分区失败或使用动态修复时必须写入 `usedDynamicFallback=true`，本地审查状态为 `needs_teacher_review`。默认不执行深度模型审查；显式传入 `runModelReview=true` 或服务端配置开启时，正常路径只调用一次 GPT-5.6 风险审查。
- 返回和落库 `generationPipeline`，记录当前阶段、模型尝试、修复状态、模型审查是否执行、打印闸门和导出资产。Web、小程序、课堂平板只读取该结构，不自行重建生成链路。
- `model`、`reasoningEffort`、`usedModelEscalation`、触发原因和预算均为服务端内部诊断字段；前端请求不得提交模型或档位，学生、家长、课堂平板和公共屏响应不得暴露这些字段。任何 Sol 结果仍是结构化草稿，必须通过服务层校验和教师复核。
- 新生成的小测、练习和试卷在 `Assignment.metadata.gradingSourcePackage` 中保存内部 `junhang-grading-source-v1`：包含稳定 `sourceId`、版本、题号、题干、标准答案、分值、解析步骤、考点、评分依据和完整性指纹。它是后续批改的权威来源，不作为学生或家长响应字段；学生卷与解析卷均为该来源的派生产物。
  - 答案包与作业题目在同一数据库事务内建立；校验或指纹生成失败时整笔写入回滚，不能留下可被后续批改引用的孤立作业。
- `POST /api/assessments/:assignmentId/draft-export`
  - 将已生成内容导出为“内容审查 PDF 草稿”，只供教师打开 PDF 审查，不在 Web/小程序内展示完整题面。
  - 返回 `asset.url`、`reviewStatus=pending_teacher_review`、`layoutValidation` 和更新后的 `generationPipeline`。
  - `layoutValidation` 比较目标页数、HTML 预分页、浏览器测量页数和 PDF 实际页数；页数不一致时 `ok=false`，题目坐标清单同时标记为不可用，但仍保留草稿 PDF 供教师查看问题。
  - 专项（focused）与多日（multi_day）按同一服务端打印计划计算实际目标页数，学生卷、解析卷和题目坐标清单读取同一答案包的每日目标；不自动补双面空白页。综合测评仍沿用既定2/4页目标。实际PDF页数与计算出的目标不同仍阻断正式导出，不能用实际页数反向覆盖目标来通过校验。
- `POST /api/assessments/:assignmentId/draft-review`
  - 教师提交 `{ decision: "accept" | "reject" }`。
  - 只有 Assignment 中的 `layoutValidation.ok=true` 才允许 `accept`；否则返回 `409 ASSESSMENT_LAYOUT_INVALID`。`reject` 后前端按原要求重新生成新草稿；返回更新后的 `generationPipeline`。
- `POST /api/assessments/:assignmentId/print-export`
  - 教师确认草稿后导出正式题目 PDF 和解析 PDF。
  - 正式导出前再次检查草稿 `layoutValidation`，正式题目渲染后再次比较实际页数；任何失败均返回 `409 ASSESSMENT_LAYOUT_INVALID`，不把错误布局写成已完成正式导出。
- 正式题目资产 `metadata.questionLayoutManifest` 会记录每道题的 `assignmentItemId`, `questionNo`, `page`, `bbox`, `bboxSource`, `score`, `answer`, `analysisSteps`, `knowledgePoint`，并同步写回作业元数据，供后续拍照批改对齐题号、答案和页内标注区域。
- 学生卷和解析卷资产 `metadata.gradingSource` 仅记录该答案包的 `sourceId`、版本和指纹；布局清单与解析内容优先从同一答案包取题干、答案、分值和解析，不能让 PDF 或 OCR 结果反向成为标准答案来源。
  - `coordinateSource=browser-dom` 表示已通过本地浏览器渲染后的真实 DOM 坐标测量；浏览器不可用时才降级为 `estimated`。
  - 正式导出会把学生卷、解析卷、`questionLayoutManifest` 来源和导出时间写回 `generationPipeline.assets` 与 `generationPipeline.print`。

- `POST /api/submissions/grade`
  - 支持 `multipart/form-data`，图片字段名为 `images`，不限制上传张数。
  - 未传 `assignmentId` 时按 `materialType=external_workbook` 初始化外部练习册识别包；教师端可同时传 `answerSourceMode`、`answerKeyText` 和 `referenceSourceId`。上传后的 `externalGradingRecognition` 使用 `external-grading-recognition-v1`，保留页序、原图地址、页质量和逐题识别证据。
  - 外部答案来源分为 `teacher_confirmed`、`teacher_selected_reference`、`model_draft`、`missing`；后两者在教师显式确认前只能作为草稿，不能正式计分、归档或写入错题/学生档案。
  - 关键字段：`assignmentId`, `studentId`, `subject`, `kind`, `title`, `uploadedBy`。
  - 上传后先返回 `queued=true`，后台执行混合 OCR、参考答案准备、客观题确定性比较和 GPT-5.6 主观题批改。
  - 默认 OCR 链路为 `OCR_ENGINE=vision`：MiniMax 视觉最多 2 路并发识别学生作答、印刷题干、题目区域和批改痕迹，并保持页序稳定。
- 有 `assignmentId` 时优先使用生成记录的 `gradingSourcePackage` 逐题题干、答案、分值和解析；历史记录没有该包时才兼容读取题目、答案键和布局清单。没有可用来源时先生成 `referenceAnswers` 再批改。
  - 新任务、生成和批改上传均由服务端复核目标学生是否可接收新工作；不可用目标返回 `403 STUDENT_TARGET_UNAVAILABLE`，不能仅依赖 Web 或小程序选择器过滤。
  - 若关联作业含 `questionLayoutManifest`，服务层必须优先使用该清单进行逐题参考答案、分值、解析和近似图片标注位置对齐，避免把整页 OCR 文本重新猜分题。
  - 单一明确答案的选择、短填空和数值题优先在服务层保守比较；混合题只把未解决题目发送给 GPT-5.6。外部材料没有答案键时由 GPT-5.6 生成参考答案和评分点。
  - 正常批改先完成一次 Terra 主批改/风险复判；只有已分类为可恢复 availability 或证据充分的 quality 故障时，才允许对最小失败题追加一次 Sol。这里的“一次风险复判”不包含条件式 Sol 升级，也不允许 Sol 后再串接第三个文本模型。
  - configuration 故障不升级；OCR、题干、作答或参考证据不足属于 evidence 故障，不调用 Sol，直接进入教师复核。局部 Sol 参考答案或批改预算为 180 秒 / 12000 tokens，每个失败题最多一次。
  - 内部升级元数据不得进入普通端，所有结果仍须教师逐题确认。Sol availability 或合成质量检查不构成批改正确率证明，正确率必须由教师确认的 gold 数据评估。
  - 总分由服务层按逐题得分计算，模型顶层 `score` 不得覆盖逐题结果。
  - API 在 OCR 前执行本地图片质量检查，记录 `imageQuality`；分辨率、亮度、对比度或清晰度不达标时进入教师复核。
  - 视觉 OCR 会尽量生成 `ocrQuestions[]`，每项包含 `questionNo`, `printedPrompt`, `studentAnswer`, `observedWork`, `bbox`, `confidence`，用于逐题批改和图片标注。
  - 低置信、图片质量需复核、风险审查未通过时只保留 `provisionalScore`，不生成最终分、不写入学生档案；所有结果仍必须由教师逐题确认后归档。

- `GET /api/grading/workbench`
  - 教师端批改工作台列表。
  - 返回 `workbenches[]`，每条包含 `pages`, `questions`, `markers`, `quality`, `summary`, `score`, `provisionalScore`, `needsTeacherReview`；外部材料额外返回 `materialType=external_workbook`、`answerSource`、`recognitionPacket` 和 `archiveBlockers`。有关联生成卷时可包含 `questionLayoutManifest`，仅供教师复核和图片标注对齐使用。
  - Web、小程序只负责展示和教师操作；识别、批改、审查和归档仍在 API/服务层完成。

- `GET /api/grading/workbench/:submissionId`
  - 教师端打开单个批改工作台详情。
  - 关键字段：`pages[].imageUrl`, `pages[].markers`, `pages[].qualityStatus`, `pages[].qualityScore`, `pages[].qualityIssues`, `questions[].bbox`, `questions[].prompt`, `questions[].studentAnswer`, `questions[].correctAnswer`, `questions[].errorStep`, `questions[].confidence`。
  - 参考答案、主批改或风险审查暂不可用时，接口仍必须保留 OCR 的题号、题干、学生作答、坐标和置信度，供教师逐题补充正确答案、判定、得分和错因；该状态不生成最终分，也不能跳过逐题确认归档。
- `PATCH /api/grading/workbench/:submissionId/dialogue-answer-package`
  - 教师端将对话中随试卷、小测或练习生成的结构化答案包，或对话重新识别后得到的结构化批改结果，导入当前批改记录并重新进入批改复核。
  - 服务端只使用 `junhang-grading-source-v1` 的标准字段建立新的仓库指纹，同时保留对话原始 payload、原始 `sourceId`、原始指纹及 `commonMistake`、`coverage` 等扩展字段到审计元数据；原始内容不被覆盖或丢弃。
  - 导入结果仍为教师待复核草稿，不能绕过逐题确认、低置信门禁或归档规则。
  - 低置信或待复核题不进入学生端和家长端。

- `POST /api/grading/source-packages/dialogue`
  - 教师端将对话生成的结构化答案包登记为数据库中的统一 `Assignment` 来源；服务端按 `junhang-grading-source-v1` 规范化并重新生成仓库指纹。
  - 返回 `assignment.id`、`gradingSource`（来源 ID、版本、指纹）和导入摘要。后续 Web、小程序和课堂平板批改只提交该 `assignmentId`，统一从 `Assignment.metadata.gradingSourcePackage` 读取题干、答案、分值和解析。
  - 对话原始 `sourceId`、指纹和 payload 仅保存在来源审计元数据中；该接口不会创建学生提交，也不会绕过教师逐题复核和归档门禁。

- `PATCH /api/grading/workbench/:submissionId/questions/:questionId`
  - 教师端逐题修正批改结果，小程序和 Web 共用。
  - 外部材料的题干和学生作答修正写入当前字段，原始 OCR 值保存在 `recognition.originalPrintedPrompt` / `recognition.originalStudentAnswer`，不会被覆盖。

- `PATCH /api/grading/workbench/:submissionId/answer-source`
  - 教师显式确认外部练习册答案来源，`mode` 只能是 `teacher_confirmed` 或 `teacher_selected_reference`；可同时补充 `answerKeyText`、`referenceSourceId`。
  - 确认答案来源不会替代逐题复核；页质量、识别置信度、题目状态和分值仍须通过归档门禁。
  - 可提交字段：`status`, `score`, `maxScore`, `studentAnswer`, `correctAnswer`, `studentProcess`, `errorStep`, `explanation`, `knowledgePoint`, `suggestedPractice`, `teacherNote`, `bbox`。
  - API 会同步 `questionResults` 和 `annotationMarkers`，并把结果转回 `teacher_question_reviewing`，等待教师最终归档。

- `POST /api/review/submissions/:submissionId/mark-reviewed`
  - 关键字段：`score`, `reviewNote`。
  - 低置信、`needsTeacherReview=true`、`archiveEligible=false` 或仅有 `provisionalScore` 的批改结果，必须提交有效 `score`。
  - API 在校验通过后才更新最终分、创建错题记录，并写入学生档案相关时间线。
  - 只有教师确认复核后，才允许把分数、错题和薄弱点写入归档。

- `POST /api/grading/workbench/:submissionId/archive`
  - 批改工作台专用归档入口，与 `mark-reviewed` 复用同一套校验和归档逻辑。
  - 返回 `workbench` 和 `submission`，方便小程序归档后直接刷新教师工作台。
  - 外部材料命中 `ANSWER_SOURCE_NOT_CONFIRMED`、`PAGE_QUALITY_REVIEW_REQUIRED`、`QUESTION_RECOGNITION_REVIEW_REQUIRED` 或其他 `archiveBlockers` 时返回 `EXTERNAL_RECOGNITION_REVIEW_REQUIRED`，不会写入错题和学生档案。

## 课堂平板

- `POST /api/classroom/dictation`
  - 教师端发布听写/默写。
  - 关键字段：`deviceId`, `teacherId`, `grade`, `className`, `subject`, `title`, `items`, `difficulty`。
  - `synthesize=true` 时尝试创建 MiniMax 语音任务。

- `POST /api/classroom/speech`
  - 单独创建 MiniMax 语音任务。

- `POST /api/classroom/reading`
  - 发布课文跟读任务。

- `POST /api/classroom/broadcasts`
  - 发布课堂任务播报。

- `POST /api/classroom/devices/:deviceId/unlock`
  - 教师端解锁某个年级平板。

- `POST /api/classroom/devices/:deviceId/lock`
  - 教师端锁定平板。

- `GET /api/classroom/devices/:deviceId`
  - 平板端拉取当前任务、听写、课文跟读状态。

## 数据库缺席时的行为

部分教师端或生成类 AI 接口仍会显式返回 `persistence` 状态；这类接口在数据库暂时不可用但任务仍可继续时，可以返回：

```json
{
  "ok": true,
  "persistence": {
    "requested": true,
    "active": false,
    "reason": "..."
  },
  "result": {}
}
```

该示例只适用于明确声明 `persistence` 字段的接口，不是所有 AI 接口的统一响应结构。

学生 `POST /api/ai/qa` 和课堂平板 `POST /api/classroom/voice-qa` 的成功响应只包含 `ok` 与经过服务端清理的 `result`，不返回数据库状态、`persistence` 或内部失败原因。对允许在不落库时继续执行的安全问答链路，数据库不可用可能使内部持久化停用，但回答仍按 AI 可用性返回；学生和课堂平板不会看到持久化诊断或数据库内部原因。

必须落库的接口会返回稳定的公共 `503 DATABASE_UNAVAILABLE` 响应：

```json
{
  "ok": false,
  "error": "DATABASE_UNAVAILABLE",
  "message": "数据库当前不可用，请稍后再试。"
}
```

所有使用 `requireDatabase` 的接口都遵守该公共失败结构，包括学生端和课堂平板端接口。响应不得包含 `database`、`checkedAt`、`checkedAtMs`、内部 `reason`、原始数据库错误、连接 URL 或配置详情。


## 2026-05-26 真实数据联通范围

- `GET /api/bootstrap`
  - Web、小程序、课堂平板端共享同一套启动数据。
  - 返回教师、学生、任务、生成记录、批改记录、课堂平板设备、广播、听写、课文跟读、学习日志和阶段报告。
  - 当前 Web 端打开后会稳定读取该接口；接口不可用时才保留演示数据作为降级展示。
- `POST /api/teacher/tasks`
  - 任务默认写入 `LearningTask`，模型调用只保留运行记录。
  - 前端传入 `id` 时按同一任务 ID 去重，避免刷新后重复生成同一任务。
- `POST /api/assessments/draft`
  - 生成默认写入 `Assignment`，生成和后续批改共享同一个 `assignmentId`。
- 前端传入 `items`、`layoutTemplate`、`printProfile`、`targetScope`、`targetGrade`、`studentId` 时会保存到 `metadata`，作为 A4 排版、年级/学生归档和后续批改的数据结构。
- 服务端对新生成的小测、练习和试卷在持久化题目后建立版本化内部答案包；题目、答案、逐题分值或解析不完整，或分值合计与总分不一致时，拒绝把该草稿作为可批改来源。
  - 小测/练习前端选择的题量使用 `requestedItemCount` 传入；教材小测的章节下拉必须和真实 `textbookAssetId` 一起提交。服务端解析教材后把版本、系列、册次、地区和章节写入统一 `generationContext`，不能只留在 Web 页面状态或自由文本中。
  - 正式打印前必须经过 `draft-export` 生成 PDF 草稿，以及 `draft-review` 教师确认，避免未复核内容直接进入打印。
  - `draft-export` 会把 `layoutValidation` 写入 Assignment 元数据；页数或坐标校验失败的草稿保持待审查，不能确认或正式导出。
  - `metadata.modelReviews` 只在显式 GPT-5.6 风险审查执行时保存结论、风险、建议和 `modelRunId`；默认草稿生成只保存服务层本地审查结果，完整模型运行记录只通过 `ModelRun` 查询，避免把内部运行对象直接暴露给多端前端。
- `POST /api/submissions/grade`
  - 如果没有传 `assignmentId`，API 会自动创建一个用于图片提交和批改的 `Assignment`，并写入 `Submission` 与 `GradingResult`。
  - 教师端和学生端都可以走图片上传批改；选择关联生成记录时优先复用该记录的答案键。
  - 图片批改结果必须进入教师复核队列，复核完成前不能写入 `MistakeRecord` 或学生档案最终分析。

## 2026-05-26 权限码迁移策略

- `TeacherAccessCode` 增加 `codePreview` 字段，只保存并展示脱敏预览码，例如 `T8****`。
- 旧的单字段教师登录码迁移为 `DISABLED`，后续登录统一使用独立的教师访问码。
- `GET /api/bootstrap` 现在按 `createdAt desc` 选择最新 ACTIVE 教师码预览。
- 教师完整访问码只在创建或重置时返回；Web 和小程序日常展示只显示预览码。

## 2026-05-26 Web 登录门禁

- Web 学生端默认显示登录校验页，通过 `POST /api/student-login` 后才能进入学生主页、今日任务、AI 问答、词汇和档案模块。
- Web 教师端默认显示登录校验页，通过 `POST /api/teacher-login` 后才能进入终端控制、学生权限、任务生成、试卷批改和档案计划。
- 课堂平板端保留设备绑定入口，根据设备绑定码进入对应平板状态。
- 为了方便演示，页面可以保留“示例账号进入”按钮；该按钮也必须调用真实登录接口，不能绕过权限校验。

## Shared workflow API and CLI

2026-09-11 接口层已实现，所有路由要求教师 Bearer 会话。`TEACHING_WORKFLOW_PERSISTENCE_ENABLED` 默认关闭，关闭或 Prisma Client 不具备新表模型时返回 `503 WORKFLOW_UNAVAILABLE`（归档路由为 `WORKFLOW_ARCHIVE_UNAVAILABLE`，作业发布路由为 `WORKFLOW_ASSIGNMENT_UNAVAILABLE`），不访问新增表。开启开关不能代替迁移验收。

- `POST /api/teaching/workflows`：接收 `{requestKey,module,request}`，module 为 generation 或 grading；教师归属取 session，客户端 snapshot、ownerTeacherId、model、provider、prompt 和内部上下文字段不会进入创建器。createDraft 已在关闭的持久化开关后装配；缺少执行器的部署仍返回 `503 WORKFLOW_EXECUTION_UNAVAILABLE`，不创建空任务。持久化可用时，同 requestKey 的既有任务可只读重放。
- `GET /api/teaching/workflows?module=generation|grading`：读取当前教师该模块最近至多 100 项任务，返回 `{ok:true,workflows:[{id,module,revision,status,request}]}`。不返回快照、内容、内部上下文或凭据；模块必须明确指定。未登录/非教师拒绝，服务未启用返回 503。Web 用它恢复对话已创建的任务，不能根据列表状态自动确认内容。
- `GET /api/teaching/workflows/:id`：读取本教师当前版本。
- `GET /api/teaching/workflows/:id/revisions/:revision`：读取正整数历史版本，返回原工作流 ID；历史内容不覆盖当前版本。
- `POST /api/teaching/workflows/:id/commands`：接收 `{action,operationKey,expectedRevision,targetQuestionIds?,targetExplanation?,instruction?,patch?,restoreRevision?}`。支持接口动作 revise、confirm、restore、cancel；resume 尚未接通。restoreRevision 映射为服务层 revision。人工 patch 的 type 为 replace_question、replace_shared_material、replace_day 或 replace_explanation。
- `POST /api/teaching/workflows/:id/archive`：单独提交 `{expectedRevision}`，只归档已确认且证据有效的批改版本。教师身份取 session，版本快照、学生、答案来源和分数由服务端读取；请求中的额外字段不能授权发布。首次成功返回 201，已成功版本重放返回 200，响应为 `{ok:true,archive:{id,workflowId,revision,currentRevision,status:"archived",replayed}}`，不返回内部快照或来源包。
- `POST /api/teaching/workflows/:id/assignment`：单独提交 `{expectedRevision}`，把已确认生成版本发布为独立 Assignment。教师、题目、范围和来源取服务端版本；额外输入不能覆盖。首次返回 201，同版本重放返回 200，响应为 `{ok:true,assignment:{id,workflowId,revision,currentRevision,status:"assignment_ready",replayed}}`。不调用模型、不导出 PDF；讲解暂不支持。

除列表、独立归档及作业发布路由外，响应格式为 `{ok:true,workflow:{id,module,revision,status,request,content,issues}}`；ok 表示成功取得任务状态，不表示内容已生成或已确认。content 使用题目及共享材料白名单，模型原始输出、内部配置和教师凭据不返回。request 仅保留教学业务字段；不会把完整 generationContext 作为客户端可写字段。409 表示版本或请求键冲突，客户端必须保留尚未提交的编辑内容；不能替换 expectedRevision 后自动覆盖新版本。

创建契约（2026-09-14）：调用模型前以教师身份和 requestKey 的唯一索引登记任务。版本 1 为不可变请求占位，状态从 queued 进入 running；只有插入占位的请求可取得执行权。另一请求即使来自其他服务实例，也只读取同一个任务；同 key 改模块或原始请求返回 409，失败、取消和中断后的重试也不会自动重新调用模型。服务保留原始 request；服务器解析的 resolvedRequest 随校验通过的内容存入内部快照，subjectRef 随版本提交更新。

模型结果经校验后追加版本 2，进入 ready_for_review，首次完成返回 HTTP 201。重复请求读到 queued/running 返回 202；读到完成、failed、needs_input、interrupted 或 cancelled 返回 200 和真实状态。没有内容的占位会返回 `issues[].code=WORKFLOW_CREATION_INCOMPLETE`，不能因 2xx、ok=true 或 CLI 退出码为 0 把它称为生成成功。客户端继续操作时读取返回的 revision，不假定首个草稿是版本 1。占位不能确认、修订或恢复成内容版本；未接通 resume 前，处理失败原因后须由教师主动用新 requestKey 发起新任务，不能自动换 key 重试。

原始请求占位只证明任务已登记，不表示目标学生/资料范围已获授权。createDraft 仍须在模型调用前校验教学目标、资料权限及证据，接收服务端 workflow 和 AbortSignal；validateSnapshot 必须明确通过。执行失败保留 failed；结构不合格保留 needs_input；取消或进程中断后的迟到结果不能追加版本。登记任务及草稿仍不代表正式发布或归档。

2026-09-14 创建器、局部修订器与模块校验适配器已在持久化开关后装配；开关仍关闭，尚未通过新增表与真实事务验收。缺少模块校验器的部署继续返回 `503 WORKFLOW_VALIDATION_UNAVAILABLE`，没有 runner 的自然语言修订不得宣称成功。cancel 按当前版本校验实际取消结果。现有生成/批改业务接口仍承担日常操作，尚未全部转入此工作流。创建与版本命令不直接发布答案、归档错题或导出正式 PDF；归档只能走独立发布路由及其门禁。

模块快照校验（2026-09-14，开关后装配）：`createTeachingWorkflowValidator({resolveGradingSource})` 返回异步校验器。服务传入 actor、module、workflow、request、nextRevision，命令执行时还传 command 与 affectedQuestionIds。校验结果为 `{ok,issues,snapshot?}`；只有 ok=true 才采用返回的规范化 snapshot 并追加版本，兼容仅返回 ok=true 的既有测试校验器。生产执行适配器在此前增加实时权限、来源绑定和用途校验；不改变持久化开关或归档门禁。

2026-09-24 补齐生成证据一致性：保存快照的 `generationContext.teaching`、`target`、`studentSignals` 与服务端重新解析后的规范化证据一同比对。错题答案、错误描述、学习信号增删等变更会阻止新修订、确认或恢复，命令返回 `409 WORKFLOW_EVIDENCE_CHANGED`。自然语言修订在模型调用前及结果提交前均核验；创建期间变化保留版本1和 needs_input，不保存迟到草稿。缺失历史 studentSignals 字段不等于服务端已验证的空列表。读取历史版本、重放原成功命令仍保留原确认；这不是撤销历史教师确认。客户端保留编辑和旧版本，说明来源变化，等待教师决定按新证据新建任务，不静默刷新快照或自动换键重试。此验证仍在关闭的持久化开关后，合成 HTTP/CLI 回归不代表真实数据库事务验收。

- 生成草稿校验教学用途、题号/ID、答案、分值、解析、评分依据、考点、易错点及资料/日期引用；不得用模型返回的 explanation 绕过请求中明确的用途。测评内容每次创建、修订、确认和恢复均按新版本重建 gradingSourcePackage，清除旧答案键，题目 context 将选项、图形、共享材料及日期内容纳入指纹。讲解草稿单独检查概念、步骤、例题及易错点，不建立试卷答案包。
- 批改来源只由服务端 resolveGradingSource 解析，不能用上传快照作为权威答案。除指纹外校验来源版本、题目完整性及总分；逐题分数必须符合可信满分和结果状态，覆盖题号必须一致，合计由服务端重算。null 作答代表缺失证据；明确识别出的空字符串可以表示未作答。uncertain 不能确认或形成最终分，缺来源时也不能保留猜测的标准答案或满分值。来源指纹变化后拒绝沿用旧版本确认，工作流内全题确认仍保持 archiveEligible=false。
- 创建时先清除模型携带的题目确认字段，包括 items/questionResults 兼容输入；确认人由命令服务写入。内容和依赖变化撤销受影响题目的确认，其他已确认题目保持原状态。归档发布仍需独立验证可信教师确认、资料授权和证据版本。

上述校验只证明结构、数值和版本一致性，不证明答案语义正确、图片识别质量或教师要求已全部满足。归档权限/来源锁定、可信确认解析、执行器证据绑定与聚合替代已实现，外部参考答案登记仍需补齐；旧导入/导出 context 兼容见 9 月 15 日记录。讲解 HTTP 视图和编辑/确认已于 9 月 17 日实现，工作台界面仍未接入；不能将服务层校验通过视为 Web 可用性验收。

归档准备与确认复用（2026-09-14，尚未启用生产归档写入）：

- `buildTeachingWorkflowArchive` 从已授权、逐题确认的服务端工作流快照准备 `teaching-workflow-archive-v1` 记录，要求注入可信答案来源解析器，再次校验评分。记录绑定归档 submission ID、工作流 ID/版本、学生、教师、来源指纹、确认时间和完整快照指纹；新版本保存 supersedesArchiveIds，旧记录不修改。返回的是待持久化记录，哈希不是授权，函数不写库、不发布。
- 创建批改工作流时可装配 `resolveConfirmedArchive`，使用原请求的 submissionId、studentId 和当前教师身份另行查库。服务只从该可信返回值复用确认，模型/上传快照中的 workflowArchive 会移除。教师、学生、归档 ID、来源或顶层证据不匹配均不复用；相同证据下逐题比较内容，修改题目不继承确认。复用后再跑模块校验、重算分数，archiveEligible 仍为 false。解析器和草稿执行器已在持久化开关后装配；旧对话 JSON 导入仍保持逐题待复核，不能把上传 JSON 的哈希或确认人作为可信存档。
- 持久化适配约定：每个归档版本使用独立 Submission；`content.workflowArchive` 存内部版本记录，`grading.result` 保留相同的规范化 questions/来源包，并且只有归档事务成功后才能标记 archiveEligible；错题 metadata.workflowArchiveId 与 sourceSubmissionId 指向该版本。现有 archiveSubmissionReview 尚未生成这种记录，不允许仅添加标记冒充完整发布。
- `selectCurrentTeachingEvidence` 已接入周/月档案及阶段报告，在周期过滤前选择当前版本并排除被替代的批改和错题。新版零错题也能替代旧错题。不同学生、记录篡改、版本分叉、缺失祖先或不一致的错题来源不进入当前证据；未确认新版不能取代既有确认版。未带新版本记录的历史数据保持原语义，不猜测其替代关系。
- 档案源读取在最近 80 条提交之外，额外按 studentId 和 JSON schema 标记读取该学生所有版本归档，避免旧版本因窗口截断重新被计入。此查询使用既有 Submission JSON 字段；代码已接入，实际 PostgreSQL 查询及规模性能仍待数据库阶段验收。这里只更新未来生成的档案证据，不改写历史已发布档案。

归档事务实现（2026-09-14，API/CLI 与开关后的服务端装配已实现，生产尚未启用）：`createTeachingWorkflowArchiveService` 提供内部 `publish({actor,workflowId,expectedRevision})`，不接收客户端快照、分数、学生或来源覆盖。服务必须装配 `authorizeStudent` 和 `resolveArchiveEvidence`，缺失时返回 WORKFLOW_ARCHIVE_UNAVAILABLE；HTTP archive 路由与 CLI archive 命令共用该服务。

- 仓储 `createTeachingWorkflowArchiveRepository` 在单个 Prisma 事务中用同值 UPDATE 锁定本教师工作流行，再读取头状态和不可变版本。新归档必须匹配 expectedRevision、没有在途操作并处于 ready_for_review/confirmed。锁与现有修订、取消共用工作流行；不增加内容版本、不改写旧快照。
- 归档 ID 由工作流 ID 和内容版本确定。已成功版本先核对当前教师学生权限及保存记录的身份/完整性，再重放原归档；不重新解析来源、不重复写错题。较旧版本重放返回原 revision 和 currentRevision，不声称它仍是当前版本。不存在成功归档的旧版请求返回冲突。
- 新归档同时创建独立 Submission、嵌套 GradingResult，以及从校验后的 wrong/partial 题目派生的错题。各错题有固定 ID，绑定同一个 workflowArchiveId/sourceSubmissionId。任意一步或事务提交失败均不返回 archived；仓储不自动重试。新版零错题仍写入版本归档和祖先关系，旧错题由聚合器排除，旧数据不删除。
- `authorizeStudent({actor,studentId,workflow,tx})` 必须检查实时教师学生权限。`resolveArchiveEvidence({actor,workflow,snapshot,tx})` 必须通过事务客户端读取并锁定/绑定可信来源版本、原提交与 assignment 关系，完成外部图片/参考答案复核，再返回 `{ok:true,studentId,assignmentId,subject,sourcePackage}`。该回调不得调用模型或产生外部副作用；字段来自服务端查询，不能将上传 JSON 的 ok=true 当作证据。来源包仍须通过模块校验。
- 版本归档使用保留 ID 前缀 teaching-archive-，旧导入答案、逐题编辑、答案来源修改、OCR 修改/重识别、mark-reviewed 和归档入口会返回 `409 WORKFLOW_ARCHIVE_IMMUTABLE`，提示在工作流修订后另建版本。后台识别和失败处理也不能覆盖版本归档。标记损坏但保留 ID 的记录仍受保护；普通历史提交保持原流程。

`createTeachingWorkflowArchiveResolvers({prisma})` 已提供生产权限与来源查询实现：

- 教师必须为学生负责人或仍有效的任课教师。原提交必须属于该学生并匹配请求 assignmentId；生成来源包从服务端 Assignment.metadata 读取并校验指纹及 sourceId，缺少登记的外部答案包不能用学生作答补造。
- 同发布事务按 Assignment、Submission、GradingResult 顺序锁定证据后重读。Assignment/GradingResult 使用 FOR SHARE，Submission 使用 FOR UPDATE，避免尚无 GradingResult 时并发首次插入改变证据。真实 PostgreSQL 锁行为尚未验收。
- `resolveGradingContext` 返回 `archiveEvidence`，包含原提交、学生、作业、来源指纹、原始证据哈希及外部材料类型/识别包；后续服务端草稿执行器必须把它绑定到快照，不能采用模型或上传 JSON 自带的授权字段。归档时重新比较，图片、OCR、批改来源或答案变化均拒绝旧绑定。
- 外部材料要求非空有效页与题目、可用图片质量、教师确认或选择的参考答案及全题覆盖。可信工作流逐题确认可替代旧识别包中重复的逐题确认，但不能跳过图片质量和独立答案来源校验。photo-upload/photo-upload-batch 来源即使缺少 materialType 仍按外部材料处理。
- 从有效不可变归档继续操作时保留原始证据绑定及外部识别包，避免包装成新提交后丢失图片门禁；缺少完整绑定的旧版本不自动获得发布资格。`resolveConfirmedArchive` 仅返回当前教师的可信归档，确认复用还需服务层逐题与证据比较。
- 归档响应采用独立字段白名单并验证状态、版本和重放标记；证据不足/记录无效返回 422，Prisma P2034 映射为 409 WORKFLOW_VERSION_CONFLICT，不自动重试；未知异常仅返回通用错误。

server.js 已在现有持久化开关后装配解析器、发布器、创建/修订执行器与校验器；仍须完成旧业务适配，再验证数据库迁移、实际行锁、并发重放、事务回滚和 JSON 来源查询。归档事务测试使用串行、写时复制的内存适配器，解析器测试使用查询替身，本地 HTTP/CLI 测试不证明 PostgreSQL 的实际隔离行为。没有开启持久化开关、真实发布或修改历史正式资产。

工作流执行适配（2026-09-14）：

- 生成请求由调用方根据已确认需求填入 subject、grade/targetGrade 或 studentId、kind、requirement；purpose 默认 comprehensive，focused 必须带 requestedItemTypes，可带 requestedItemCount，multi_day 的每个 dayPlan 元素使用 requestedItemCount/requestedItemTypes。题量不再被 HTTP 白名单丢弃；days 视图中的 questionCount 是展示字段，不代替请求契约。执行器不猜测缺少的教学条件，也不将客户端模型配置或上下文当作可信输入。
- 生成目标解析器先检查教师学生权限、可接收新工作状态及学生年级，再复用 prepareAssessmentDraftInput 的教材审批链；本入口仅采纳确认过的批改/错题信号。调用 draftAssessmentService 时固定 persist:false，不直接写 Assignment、模型运行表或正式资产。模型不可用、动态兜底或审查不通过不能成为 ready_for_review 的内容版本。
- 模型生成 schema 明确 rubric；工作流调用缺少评分依据时使用现有受限修复槽，不追加独立审查。适配器把评分元数据、dayId 和阅读材料转为稳定 questions/days/sharedMaterials，最终由模块校验重建来源包。
- 批改从可信原提交的 OCR 题目或外部识别包提取作答，标准答案来自登记的来源包；源记录缺题目时要求补齐，不在本入口重跑图片 OCR 或猜造答案。gradeSubmissionService 固定 persist:false，服务器绑定 archiveEvidence；有效版本归档继续操作时直接读取原快照，再由服务层验证并复用确认，不再次调用模型。
- 历史来源包未保存 context.itemType 时，服务端读取并共享锁定 AssignmentItem；仅在题号唯一且规范题干、正确答案、满分均与来源包一致时，绑定补充类型到 archiveEvidence.assignmentQuestionTypes 及证据指纹。来源包类型优先，缺失或冲突保持未知，不采用客户端/OCR类型或按题号猜测。创建、单题重判及快照使用同一绑定；注册题型变化使旧证据失效，已归档版本沿用原证据。此兼容不修改原来源包指纹，也不授予教师确认或归档权限。
- 自然语言 revise 可以只提交 targetQuestionIds 与 instruction，不必同时提交一个无变化 patch。生成只发送选中题目及关联材料/日期，使用共享 runTeachingTask；批改只把选中题目及对应参考答案送入 gradeSubmissionService，明确客观题本地比对、主观题走共享模型，teacherContext 携带本次修改要求。手工修正仍提交完整显式 patch；修改任何版本均需 expectedRevision/operationKey。
- 生成上下文和批改证据在修订前及最终校验时再次读取；来源变化、取消、错误题号或不完整输出不能提交新版本。请求/上下文缺失在创建占位保留 needs_input，不调用模型；执行故障保留 failed。运行中的证据复查不等于真实数据库提交时的隔离验证，正式归档仍由独立事务重新校验。
- 仍未完成：图片工作台接入、外部答案来源登记补齐、两个 Web 工作台，以及真实 PostgreSQL/OCR/模型/教学质量验收。已确认版本到 Assignment/导出、讲解 HTTP 视图及编辑/确认已于 2026-09-17 在关闭的开关后实现，尚未启用；新增入口暂不能代替日常所有旧业务入口。

旧来源导入与批改上下文衔接（2026-09-15）：

- `normalizeImportedGradingSourcePackage` 保留每题 `context`，标准答案包在不更换来源身份时经 JSON 往返保持版本、材料和指纹。context 的内容变化参与完整性校验；导入仍是重新规范化内容，不能凭原文件指纹或确认字段取得服务器授权。
- `gradingSourcePackageToAssignmentItems` 把来源题号存入 item.metadata.sourceQuestionNo，上下文存入 sourceContext；选项、图形、阅读材料、每日标识与题型映射到已有打印字段，不混入导入的复核扩展。Assignment.orderIndex 仍表示列表顺序，学生卷、解析卷和布局清单使用来源题号。布局清单同步 context；本轮验证 HTML/JSON 结构，不代表 PDF 页数或视觉验收通过。
- `POST /api/grading/source-packages/dialogue` 登记为新的 Assignment，重新建立来源 ID 和版本 1；原文件身份、版本与指纹仍保留在导入来源记录中。响应 gradingSource 和 imported.fingerprint、审计记录均使用实际保存的答案包指纹。新登记不是原工作流版本的直接发布，也不继承文件里的教师确认。
- 旧图片批改输入经 `submission-grade-input.js` 组装，向共享批改服务传递完整权威答案包和上下文；Assignment 来源优先于提交内的旧副本。局部重批重建选中题目来源包时保留其 context，不带入无关题目的材料。数字 0、布尔 false 标准答案在 Assignment 保存时不再被当作空值丢弃。
- 此批次补齐既有入口的上下文兼容基础；版本直接发布为 Assignment、讲解视图的后续实现见下节。Web 工作台仍待后续实现，迁移、新持久化开关与真实 PostgreSQL 验收继续后置。

已确认生成版本衔接（2026-09-17，持久化开关仍关闭）：

- `createTeachingWorkflowAssignmentService` 使用存储的不可变版本，核对逐题教师确认、重建来源包一致性；首次发布还执行生产快照校验并重读教学上下文。上传 JSON 中的确认标记不构成授权。未确认返回 `422 WORKFLOW_CONFIRMATION_REQUIRED`，记录或来源不一致返回 `422 WORKFLOW_ASSIGNMENT_INVALID` / `WORKFLOW_SNAPSHOT_INVALID`，服务未装配返回 `503 WORKFLOW_ASSIGNMENT_UNAVAILABLE`。
- 仓储在同一 Prisma 事务中锁定工作流行，要求首次发布版本为当前头、无在途操作且状态可发布；不满足返回 `409 WORKFLOW_VERSION_CONFLICT`。Assignment ID 由工作流和版本确定，同版本并发、重启或主动重放不重复创建；旧版已发布记录可在当前权限核验后重放，未发布旧版不能越过当前头。Prisma P2034 映射为 409，不自动重试。真实 PostgreSQL 行锁及回滚仍待验收。
- 发布时重新绑定来源包 sourceId 为 Assignment ID，保留版本和题号；内部 workflowPublication 保存原始/发布来源指纹，题目投影保留 context 和 answerFormat。新版本生成独立作业，旧题目和旧导出文件不覆盖。首次发布检查学生可接收新任务及年级；重放仍检查当前教师学生权限，学生停用不抹去已发布历史。学生专属作业不能因同年级而出现在同学列表。
- 发布仅表示内容已由教师确认，初始 finalExportAllowed=false 且不伪造 layoutValidation。`POST /api/assessments/:assignmentId/draft-export` 先核对存储的工作流绑定与内容，预览保留已有内容确认；`print-export` 仍要求排版通过，且再次检查实际学生卷排版。解析 PDF 生成失败返回 `503 ASSESSMENT_ANALYSIS_PDF_UNAVAILABLE`，不能标记正式导出完成。
- 这些导出检查只读取既有发布版本，不得创建或重新发布作业。旧 draft-review 的 accept/reject 和旧 dialogue-answer-package 的答案来源导入对发布版返回 `409 WORKFLOW_ASSIGNMENT_IMMUTABLE`，应在工作流中修订并确认新版本；批改结果导入不因此被禁用。未绑定新工作流的历史作业继续原流程。
- 本批验证使用实际仓储/服务配合内存事务适配器、本地 HTTP/CLI 和抽取的实际导出路由配合渲染替身。现有运行实例未重启；其 link-guard 结果不证明新适配器已运行，不替代新表事务、真实模型或 PDF 视觉验收。

讲解视图与命令（2026-09-17，开关后实现，Web 未接入）：

- purpose=explanation 返回 `content.explanation={concept,steps,workedExamples:[{prompt,answer,analysisSteps}],commonMistakes,reviewedByTeacher?}`；仅教师会话可读。正文与例题使用字段白名单，确认身份、模型/调试字段不出现在响应。讲解规范化后 questions/sharedMaterials/days 为空，不保留总分、旧答案包或 parsed 副本。
- 使用既有 commands 路由与 CLI command，显式指定 `targetExplanation:true`，不能混用 targetQuestionIds，测评/批改任务不能提交讲解动作。自然语言修订例：`{"action":"revise","operationKey":"explanation-edit-1","expectedRevision":2,"targetExplanation":true,"instruction":"用小棒说明进位，保留原有例题"}`。
- 手工修订提交 `patch:{type:"replace_explanation",value:{concept,steps,workedExamples,commonMistakes}}`，value 为完整讲解内容；仍须 targetExplanation=true、版本与操作键。缺概念、步骤、例题解析或易错点不提交新版本。确认例：`{"action":"confirm","operationKey":"explanation-confirm-1","expectedRevision":3,"targetExplanation":true}`，仅在教师明确确认整份讲解后使用。
- 创建与修订清除模型/客户端自带确认，即使伪造当前教师 ID 也不继承。确认身份仅由服务端会话写入；每次修订撤销整份讲解确认。restore 复用既有 restoreRevision 契约，追加新版本，并在实时权限及教学证据校验通过后保留原服务端确认；不改写历史。顶层 ready_for_review 是工作流状态，内容是否确认读取 explanation.reviewedByTeacher。
- 自然语言修订只走共享 generation 管线，发送讲解正文、教师要求和服务器上下文，最多一次受限修复；手工修改/确认/恢复不调用模型。失败、来源变化或取消保留原内容版本，不自动重试；旧 expectedRevision 和同 key 改内容返回 409。非法目标返回 WORKFLOW_TARGET_SCOPE_INVALID / WORKFLOW_COMMAND_INVALID，非法讲解 patch 返回 WORKFLOW_EXPLANATION_PATCH_INVALID；内容不完整返回 WORKFLOW_SNAPSHOT_INVALID。
- 讲解确认不调用 assignment/archive，不建立测评答案包或正式 PDF；讲解发布/打印仍未实现。HTTP/CLI 与合成模型测试不证明真实模型教学质量或 PostgreSQL 隔离。

CLI 使用已有教师登录返回的 sessionToken，本地 JSON 为 `{ "sessionToken": "..." }`。会话文件放在用户私有目录，设置 `TEACHING_SESSION_FILE` 指向该文件，不纳入 Git。设置 `TEACHING_API_BASE_URL` 为 API origin，例如 `http://127.0.0.1:8787`；不能包含用户名、密码、路径或查询参数。CLI 不自动登录、不读取其他应用凭据、不打印会话、不跟随重定向，也不自动重试写操作。

```powershell
node scripts/teaching-workflow.mjs create --input request.json
node scripts/teaching-workflow.mjs get --id WORKFLOW_ID
node scripts/teaching-workflow.mjs get --id WORKFLOW_ID --revision 1
node scripts/teaching-workflow.mjs command --id WORKFLOW_ID --input command.json
node scripts/teaching-workflow.mjs archive --id WORKFLOW_ID --input archive.json
node scripts/teaching-workflow.mjs assignment --id WORKFLOW_ID --input assignment.json
```

仅在教师已明确确认所选题目时使用确认命令，例如 `{ "action":"confirm", "operationKey":"teacher-confirm-unique-id", "expectedRevision":2, "targetQuestionIds":["q1"] }`。同次操作保留 operationKey，新的操作使用新 key。对话新增的资料需先登记并审批，后续由服务端接入任务上下文，不得只写在聊天文本中作为已入库证据。

教师明确要求归档后，先 GET 确认可归档的当前版本，再以 `archive.json` 的 `{ "expectedRevision": 3 }` 提交独立 archive 命令。工作流 confirm 不自动触发 archive。归档幂等键由工作流/版本派生，不使用 operationKey；主动重放同次归档应保留原 expectedRevision。409 后先查看当前版本和未提交修改，不能自动改用新版本重发。CLI 只输出已校验的归档摘要，不打印来源证据、会话或内部错误。

发布已确认生成内容时，先 GET 当前版本，再以 `assignment.json` 的 `{ "expectedRevision": 3 }` 调用 assignment；返回 ID 用于既有 draft-export / print-export，不能把 assignment_ready 说成 PDF 已完成。已发布同版本重放保留原 expectedRevision；修改内容需修订、重新确认并发布新版本，不用旧 draft-review 重写确认。该命令沿用同一教师会话与安全摘要输出，不自动重试。

版本命令重放必须同时保留原 `expectedRevision`、动作和内容。服务端持久化 SHA-256 命令指纹；同 key 不同命令或缺少可信指纹的旧记录返回 409，不会重新调用模型。已完成修订/确认/恢复可以重放原版本；原版本已不是当前头时返回 `historical`，继续修改前须重新 GET 当前版本。运行中的重复请求返回 409。失败操作不会自动重试，处理失败原因后使用新 key；当前不提供完整失败操作历史账本，也不将 cancel 当作新增内容版本。

`revise` 包含非空 `instruction` 时调用对应执行器；批改识别修正也调用共享批改服务，仅处理目标题，客观题本地比较、未解决题按既有策略调用模型。纯评分/解析或生成内容的完整 patch、确认和恢复不调用模型。题目、材料和日期 patch 的 value 必须保留目标 `id` 或 `dayId`；讲解 patch 使用完整讲解结构，不虚构题号。题目模型修订不得改变题号、所属日期和共享材料引用。输入或执行器缺失会在启动操作前拒绝，不把已有草稿改成失败状态。

修订服务必须装配仓储的操作查询、begin/end 和版本提交能力。新修订使用空检查点；既有队列恢复仍保留已完成单元。cancel 成功后，同一服务实例把 AbortSignal 传给执行器；跨进程取消及忽略 signal 的执行器由持久化状态和 operationKey 拒绝迟到提交。信号传递不等于已验证真实供应商终止计费；生产 runner 接通后仍需验收。上述契约目前通过内存 Prisma 适配器上的实际仓储/服务及本地 HTTP/CLI 验证，不能替代 PostgreSQL 事务或模型质量验收。

接口和 CLI 使用本地临时 HTTP server、合成教师会话及内存 repository 验证。这证明接口契约与权限路径，不证明 PostgreSQL 事务、真实模型质量或现有运行实例已加载新代码。

生成 Web 衔接（2026-09-17，本节更新此前“两个工作台未接入”的阶段状态）：教师端“生成打印 → 持续编辑工作台”已接入上述列表、创建、读取、命令与 Assignment 发布契约；旧“原有生成与打印”入口保留。组件仅组装教学请求与动作，不选择模型、不拼接核心 prompt。前端缓存仅包含按教师区分的最后任务 ID，不缓存题目或确认状态。

- 可查看题目/解析/共享材料/每日目标或独立讲解，提交单题自然语言修改和完整手工 patch，明确确认所选题/全部题/整份讲解。服务端撤销受影响内容的确认；手工分值保持不变，图形仍需在 PDF 预览核对。
- expectedRevision 冲突保留本地文本；刷新不自动覆盖编辑，也不自动用新版本提交。历史只读，恢复追加版本。取消仍受服务端限制：保留内容可读，不能恢复或 resume 已取消任务，继续须主动新建。
- 内容确认、PDF 预览与正式两卷导出分开；排版失败不能正式导出，讲解不显示正式导出能力。后端未加载列表路由或返回 WORKFLOW_UNAVAILABLE 时，显示暂未启用并提供旧入口。
- `check:web:teaching-generation` 验证实际浏览器、HTTP 工作流和 CLI 客户端；工作流使用合成模型输出与内存 Prisma 适配器。PDF 响应使用测试替身，仅证明 UI 门禁，不能证明实际排版。真实 Web 登录页已渲染验证，教师页面切换采用拦截 API 的合成登录，不提交真实凭据或写入正式数据。

本轮未重启既有 API，未执行新表迁移，未启用 TEACHING_WORKFLOW_PERSISTENCE_ENABLED。Web 启动成功不等于新持久化链路可用于日常业务；批改工作台接入进度见下节，真实数据库/模型质量验收仍待完成。浏览器包通过 core 的 browser 入口复用安全契约，source package 哈希仍在 Node 入口计算，不为前端添加密码学替代实现。

批改 Web 衔接（2026-09-17，Task 8，开关保持关闭）：

- 教师端“批改复核 → 持续批改与版本”接入相同 list/create/get/commands/archive API；保留原上传、来源登记、批次筛选和逐题复核入口。服务未启用的 404/503 显示可返回旧入口的提示，不伪装成功。
- 批改 WorkflowView 增加 `content.pages`，仅包含 pageNumber/imageUrl/fileName/imageRefs/cropRef/qualityStatus；题目返回置信度、图片/裁剪引用、bbox 和服务端派生的 recognitionCorrectedByTeacher。原始识别修正凭据不返回浏览器。仅在图片、页码、裁剪空间和单位坐标范围匹配时绘制题目区域。
- `content.gradingSummary={score,confirmedScore,totalScore,unresolvedCount,confirmedCount}` 由服务端逐题汇总。未可靠识别作答保持 null，页面显示待核对；不会用空字符串或零分补齐。
- 批改工作流GET、历史读取、列表及命令响应增加 `reviewStatus="teacher_confirmed"|"review_required"` 与 `archive={id,workflowId,revision,status:"archived"}|null`。确认摘要由所读快照派生；归档摘要只来自该版本实际持久化记录，经共享完整性及教师、学生、工作流、版本校验。历史状态仍为 `historical` 且只读；新版本不继承旧归档摘要。底层处理状态不改，读取不触发确认、发布或归档，也不返回内部归档快照及证据。
- 识别修正命令为 `{action:"revise",operationKey,expectedRevision,targetQuestionIds:[id],patch:{type:"correct_recognition",questionId:id,value:{studentAnswer}}}`。studentAnswer 必须为字符串，空字符串表示教师核对确为空白。服务端固定题干、原置信度、图片和裁剪坐标，建立内部修正凭据，仅重批目标，再重新校验证据绑定。HTTP 不接受客户端伪造置信度或凭据；replace_question 改变学生作答也强制重批。
- 新建批改草稿和逐题重判保留内部 observedWork、页码、图片/裁剪引用及可信题型；模型只接收目标题的过程与来源。评分修改不删除或接受客户端覆盖原过程证据。未知置信度保持 null；教师修正凭据可为本次判分提供有效可信度1，但不能改写保存的OCR置信度，也不自动完成评分确认。此修正复用同一API供Web与对话使用，持久化开关状态不变。
- 手工评分仅改变当前题结果与解析；自然语言重判仅携带当前题 ID 和要求。受影响题取消确认，其他题保持未变化的可信确认。确认只作用于明确检查的当前题；归档另发 expectedRevision，由事务门禁判断。可信服务端归档的确认可复用，无需重复模型调用。
- 未保存编辑阻止切换任务或题目；409 后保留文本并要求刷新比较，窄屏区域切换保留编辑。历史只读，恢复追加版本，不修改已归档记录。浏览器只缓存按教师隔离的任务 ID，不把本地文本或勾选状态当成服务器确认。
- `npm.cmd run check:web:teaching-grading` 使用现有 Playwright/Edge，实际教师页面验证 multipart 上传与 404/503 回退，临时工作台经真实 HTTP/CLI 服务验证单题修正、重判、评分、确认和归档。图片/OCR/模型均为合成样本，事务为内存适配器；不证明真实 OCR、模型质量或 PostgreSQL 事务通过。

## 2026-07-16 学生共享英语词典

- `POST /api/student/dictionary/query`
  - 仅接受已登录学生会话，请求为 `{ "word": "carried" }`。
  - 查询不接收或保存 `studentId`、学生姓名、年级、个人历史或个人笔记。
  - 缓存命中直接返回共享词条；未命中时生成、校验并写入共享缓存。
  - 成功响应为 `{ "ok": true, "result": { "entry": student-dictionary-entry-v1 } }`。
  - 非英文输入返回 `400 DICTIONARY_WORD_INVALID`。
  - 模型失败、结构不完整或共享缓存不可用返回通用 `503 DICTIONARY_QUERY_UNAVAILABLE`。
  - 响应不得包含供应商、模型名、prompt、raw、模型运行 ID、数据库 ID 或缓存状态。
