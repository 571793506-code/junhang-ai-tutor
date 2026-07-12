# 三端共享 API 契约

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
| 启动数据 | `GET /api/bootstrap` | Web、小程序、平板拉取同一套启动摘要 | 按角色展示任务、学生、设备、复核状态；不展示内部配置 | `check --workspace apps/api`、`check:miniprogram-js` |
| 学生登录 | `POST /api/student-login` | 学生 Web/小程序共用登录校验 | 只返回学生可见身份和学习状态 | `check --workspace apps/api` |
| 教师登录 | `POST /api/teacher-login` | 教师 Web/小程序共用登录校验 | 可返回教师工作台所需状态，不返回完整密钥或数据库配置 | `check --workspace apps/api` |
| 课堂设备登录 | `POST /api/classroom/device-login` | 课堂平板绑定设备后拉取课堂状态 | 只显示课堂任务、解锁状态和必要学生互动信息 | `check --workspace apps/api`、`check:miniprogram-js` |
| AI 问答 | `POST /api/ai/qa`、`POST /api/classroom/voice-qa` | 学生端、课堂平板复用同一服务端问答契约 | 最多一次 Terra 低推理调用，Terra 不可用时零调用且绝不调用 Sol；学习者响应不含学习信号或内部路由元数据 | `check --workspace apps/api`、`check:miniprogram-js` |
| 今日任务 | `POST /api/teacher/tasks`、`GET /api/bootstrap` | 教师创建，学生/平板从启动数据或任务接口读取 | 未发布或教师未确认内容不进入学生/平板可见区 | `check --workspace apps/api` |
| 组卷草稿 | `POST /api/assessments/draft` | 教师端提交要求，服务层生成并修复草稿 | 草稿只供教师复核，不直接展示给学生/家长 | `check:content-context`、`check:teaching-content` |
| 草稿审查导出 | `POST /api/assessments/:assignmentId/draft-export` | 教师端打开审查 PDF | 返回审查资产和 `pending_teacher_review` 状态 | `check:content-context` |
| 教师复核 | `POST /api/assessments/:assignmentId/draft-review` | 教师端确认或拒绝草稿 | `accept` 后才允许正式导出和学生侧发布 | `check:content-context` |
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

- `GET /api/teachers/:teacherId/students`
  - 教师端查看自己绑定的学生。

## 学生档案与长期成长档案

- `POST /api/students/:studentId/profile/draft`
  - 教师端生成待复核档案草稿。
  - 请求字段：`periodType`，可选值为 `weekly` 或 `monthly`；默认 `weekly`。
  - 周档案对应 `profileType=weekly_growth`，月度综合档案对应 `profileType=monthly_comprehensive_growth`。
  - 返回教师可见结构：`period`, `publishedView`, `teacherReview`, `profileEvidencePack`, `sourceCounts`, `timeline`, `narrative`。
  - 周/月档案统一使用综合成长档案模板，不提供单科独立模板入口。
  - 返回 `printView` 打印模板结构，用于教师端审查后打印、保存或后续生成 PDF。`printView.templateType=comprehensive_growth_archive`，`printView.renderingPolicy.pdfTextSource=html_template`，`printView.renderingPolicy.imagePreviewUsage=visual_reference_only`。
  - `profileEvidencePack` 由任务、已复核批改、错题、阶段报告、课堂行为、AI 问答和语音互动组成。问答只接受服务端计算合格且精确匹配 `qa-learning-signal-v1` 的记录；教师测试、匿名或身份未确认课堂、不可用、不安全、结构异常、日期无效和 legacy 问答排除在公开证据外，并仅以最小原因摘要进入教师侧 `blockedEvidence`。
  - 单条来源问答不能提高掌握度、分数或形成强结论；同知识点重复信号可形成 `supported` 但仍是辅助证据。教师确认的非问答证据优先，冲突进入教师复核备注。

- `POST /api/students/:studentId/profile/publish`
  - 教师确认并发布档案。
  - 请求字段：`text` 为教师最终确认正文，`snapshot` 可传入结构化草稿。
  - API 会把教师正文写入 `publishedText`，并保留结构化 `publishedView` 供学生端展示。
  - 发布仍必须经过教师确认；前端不得自动把 draft 直接发布给学生或家长。

- `POST /api/students/:studentId/profile/print`
  - 教师端基于周/月综合成长档案草稿生成打印版资产。
  - 请求字段：`snapshot` 为教师当前审查的结构化草稿；`text` 为教师编辑后的公开正文；`periodType` 可作为无草稿时的兜底周期。
  - API 使用 `renderStudentGrowthProfilePrintHtml` 生成 HTML，并优先渲染 PDF。
  - 返回 `asset` 和教师可见 `snapshot`；`asset.kind` 为 `student-profile-print-pdf` 或 `student-profile-print-html`。
  - `asset.metadata.visibility=teacher_profile_print`，`metadata.templateType=comprehensive_growth_archive`，`metadata.htmlUrl` 保留同内容 HTML 资产。
  - 该接口不自动发布到学生端，也不自动发送微信；老师下载后人工发送或打印。

- `POST /api/students/:studentId/profile/aggregate`
  - 兼容型聚合接口，默认按 `periodType=monthly` 生成月度综合档案。
  - 学生或教师会话都可调用，但响应按当前角色过滤。

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
    "publishChecklist": []
  },
  "profileEvidencePack": {
    "period": {},
    "taskEvidence": [],
    "gradingEvidence": [],
    "mistakeEvidence": [],
    "qaEvidence": [],
    "classroomEvidence": [],
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

- `POST /api/assessments/draft`
  - 生成小测、练习、试卷草稿。
  - 关键字段：`kind`, `grade`, `subject`, `difficulty`, `requirement`。
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
- `POST /api/assessments/:assignmentId/draft-export`
  - 将已生成内容导出为“内容审查 PDF 草稿”，只供教师打开 PDF 审查，不在 Web/小程序内展示完整题面。
  - 返回 `asset.url`、`reviewStatus=pending_teacher_review` 和更新后的 `generationPipeline`。
- `POST /api/assessments/:assignmentId/draft-review`
  - 教师提交 `{ decision: "accept" | "reject" }`。
  - `accept` 后才允许正式导出；`reject` 后前端按原要求重新生成新草稿；返回更新后的 `generationPipeline`。
- `POST /api/assessments/:assignmentId/print-export`
  - 教师确认草稿后导出正式题目 PDF 和解析 PDF。
  - 正式题目资产 `metadata.questionLayoutManifest` 会记录每道题的 `assignmentItemId`, `questionNo`, `page`, `bbox`, `bboxSource`, `score`, `answer`, `analysisSteps`, `knowledgePoint`，并同步写回作业元数据，供后续拍照批改对齐题号、答案和页内标注区域。
  - `coordinateSource=browser-dom` 表示已通过本地浏览器渲染后的真实 DOM 坐标测量；浏览器不可用时才降级为 `estimated`。
  - 正式导出会把学生卷、解析卷、`questionLayoutManifest` 来源和导出时间写回 `generationPipeline.assets` 与 `generationPipeline.print`。

- `POST /api/submissions/grade`
  - 支持 `multipart/form-data`，图片字段名为 `images`，不限制上传张数。
  - 关键字段：`assignmentId`, `studentId`, `subject`, `kind`, `title`, `uploadedBy`。
  - 上传后先返回 `queued=true`，后台执行混合 OCR、参考答案准备、客观题确定性比较和 GPT-5.6 主观题批改。
  - 默认 OCR 链路为 `OCR_ENGINE=vision`：MiniMax 视觉最多 2 路并发识别学生作答、印刷题干、题目区域和批改痕迹，并保持页序稳定。
  - 有 `assignmentId` 时优先使用生成记录里的题目和答案；没有答案键时先生成 `referenceAnswers` 再批改。
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
  - 返回 `workbenches[]`，每条包含 `pages`, `questions`, `markers`, `quality`, `summary`, `score`, `provisionalScore`, `needsTeacherReview`；有关联生成卷时可包含 `questionLayoutManifest`，仅供教师复核和图片标注对齐使用。
  - Web、小程序只负责展示和教师操作；识别、批改、审查和归档仍在 API/服务层完成。

- `GET /api/grading/workbench/:submissionId`
  - 教师端打开单个批改工作台详情。
  - 关键字段：`pages[].imageUrl`, `pages[].markers`, `pages[].qualityStatus`, `pages[].qualityScore`, `pages[].qualityIssues`, `questions[].bbox`, `questions[].studentAnswer`, `questions[].correctAnswer`, `questions[].errorStep`, `questions[].confidence`。
  - 低置信或待复核题不进入学生端和家长端。

- `PATCH /api/grading/workbench/:submissionId/questions/:questionId`
  - 教师端逐题修正批改结果，小程序和 Web 共用。
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

AI 类接口不会因为数据库暂时不可用而失败，会返回：

```json
{
  "persistence": {
    "requested": true,
    "active": false,
    "reason": "..."
  }
}
```

必须落库的接口会返回 `503 DATABASE_UNAVAILABLE`。


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
  - 正式打印前必须经过 `draft-export` 生成 PDF 草稿，以及 `draft-review` 教师确认，避免未复核内容直接进入打印。
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
