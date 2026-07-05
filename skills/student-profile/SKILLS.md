# 学生档案类 Skill

用于修改、迁移或复用学生档案、学习记录聚合、阶段反馈草稿、教师发布和家长可见摘要经验。

## 适用场景

- 生成学生档案草稿、周反馈、月反馈、阶段反馈或家长可读摘要。
- 把任务、批改、问答、课堂观察等学习证据汇总为教师复核材料。
- 检查学生档案是否误用了未复核 AI 结果或低置信批改结果。

## 核心原则

- 学生档案草稿只给教师编辑和复核，教师确认前不对学生或家长发布。
- 当前核心展示方向是周档案和月度综合长期成长档案；周/月内容经教师复核后发布到学生端，期中/期末只在教师端生成 PDF 并由老师微信私聊人工发送给家长。
- 档案必须保留来源意识：任务、批改、问答、课堂记录、老师备注要能区分。
- 低置信 OCR、未确认分数、未复核错题和 provisional 结果不能写入最终档案。
- 家长可见内容要温和、具体、可行动，避免内部术语和模型信息。
- 退课或停用登录码不删除学生档案，避免学习记录丢失。
- Web 只作为联调和原型入口；档案证据聚合、角色过滤、发布状态和阻断来源判断必须在 API/helper 或共享契约中完成。

## 当前项目可参考位置

- `apps/api/src/student-growth-profile.js`：`profileEvidencePack`、周/月 `publishedView`、`teacherReview` 和角色过滤。
- `apps/api/src/student-term-report.js`：期中/期末阶段报告草稿、教师专用 PDF HTML 渲染和角色过滤。
- `apps/api/src/server.js`：`/api/students/:studentId/profile/draft`、`/publish`、`/aggregate` 和 `/profile`。
- `apps/api/src/server.js`：`/api/students/:studentId/term-report/draft`、`/pdf`、`/mark-sent` 和 `/term-reports`。
- `packages/ai/src/runtime.js`：学生档案草稿 JSON 输出字段。
- `apps/web/src/main.tsx`：教师端草稿编辑和发布交互，仅作为原型参考。
- `docs/14-api-contract.md`：学生档案发布和归档前置条件。
- `docs/14-api-contract.md` 和 `docs/40-miniprogram-migration-readiness-checklist.md`：教师确认后学生端才可见的边界。

## 结构化契约

档案草稿和已发布快照应优先使用结构化 JSON，而不是只保存一段长文本。

- `periodType`：`weekly` 或 `monthly`。
- `profileType`：`weekly_growth` 或 `monthly_comprehensive_growth`。
- `period`：周期类型、展示标签、开始日期和结束日期。
- `publishedView`：学生/家长可见摘要，包含 `overview`、`subjectOverview`、`focusSubjects`、`correctionLoop`、`stableGrowth`、`tutoringFocus`、`parentNextSteps`、`timelinePreview`。
- `teacherReview`：教师复核材料，包含样本不足说明、待确认来源、内部风险和发布清单。
- `profileEvidencePack`：证据包，包含任务、已复核批改、错题、问答、课堂互动、阶段报告、行为记录和 `blockedEvidence`。

期中/期末阶段报告复用 `StudentReport.metadata.termReport`：

- `reportType`：`midterm` 或 `final`。
- `visibility`：固定为 `teacher_pdf_only`，PDF 或 HTML 资产只供教师端下载保存。
- `status`：`draft`、`pdf_ready` 或 `sent_manually`。
- `periodLabel`：教师填写的阶段名称。
- `teacherEditedText`：教师确认后的报告正文。
- `pdfUrl`, `pdfTitle`, `pdfAssetId`：教师端保存资产信息。
- `wechatMessage`：教师复制后微信私聊发送给家长的话术。
- `sentManuallyAt`, `sentByTeacherId`：老师人工发送后的状态记录。
- `renderingPolicy`：正式交付边界，`pdfTextSource` 固定为 `html_template`，`imagePreviewUsage` 固定为 `visual_reference_only`，避免把 image 2 位图文字当作正式 PDF 正文。

期中/期末 `draft.sections` 使用综合成长报告结构：

- `overview`：阶段综合摘要；期中强调阶段掌握、共性错因和后续两到四周重点，期末强调学期成长、稳定强项和假期或下阶段安排。
- `stageConclusions`：阶段关键结论，至少包含阶段掌握或学期成长、学习过程和复盘依据。
- `growthTrajectory`：成长轨迹，呈现阶段变化、学习节奏和订正迁移，不画虚构趋势线。
- `evidenceSummary`：证据摘要，区分学习任务、教师确认批改、错题订正和问答互动。
- `evidenceCoverage`：证据覆盖说明，说明任务、批改、错题、科目和互动覆盖情况；证据不足时只写继续观察。
- `subjectOverview`：语文、数学、英语三科总览，每科 1 条观察，证据不足时写继续观察。
- `subjectAbilityMap`：学科能力拆解，按语文、数学、英语分别写当前观察、能力点、依据和下一步。
- `focusSubjects`：重点科目展开，最多 1 到 2 个；每项包含 `evidence`, `abilityObservation`, `priorityAction`, `teacherNextStep`。
- `commonCauseAnalysis`：共性错因分析，优先覆盖审题复述、订正闭环和表达完整度。
- `learningProcess`：课堂与作业过程，呈现课后任务完成、批改反馈吸收和错题复盘过程。
- `stableGrowth`：稳定表现，每项包含 `text` 和 `evidence`。
- `tutoringFocus`：老师下阶段辅导动作。
- `actionPlan`：跟进计划，按第一步、第二步、第三步描述可执行动作。
- `homeSchoolCollaboration`：家校协同建议，说明家庭观察重点、短时配合动作和沟通节奏。
- `parentNextSteps`：家长在家可执行动作；`parentNextStep` 仅作为兼容字段保留。
- `parentCommunicationSummary`：教师给家长微信私聊发送前可参考的沟通摘要，强调过程观察，不要求家长替代老师讲课。
- `teacherReviewChecklist`：教师端保存前复核清单，只给教师端使用，不进入家长 PDF 正文和学生端状态卡。

`publishedView` 中每条观察尽量保留：

- `text` 或可读摘要；
- `evidenceRefs`，指向证据包中的来源；
- `confidence`，使用 `confirmed`、`supported`、`weak` 或 `blocked` 等状态。

## 证据与置信规则

- 周档案聚焦近一周，重点是本周表现、一个主要跟进科目、错题订正闭环和下次课动作。
- 月度综合档案聚焦当月长期成长，允许展示 1 到 2 个重点科目、稳定表现、趋势变化和家长配合建议。
- 样本少于 3 条有效学习事件时，只能生成轻量反馈，不能下强结论。
- 缺少某学科记录时，只写“记录不足，继续观察”，不要补编表现。
- `REVIEWED` 以外的批改、`needsTeacherReview=true`、`archiveEligible=false`、低置信 OCR、仅有 `provisionalScore` 的结果进入 `blockedEvidence`。
- `blockedEvidence` 可给教师看，用于复核提示；不得进入学生/家长端 `publishedView`。
- 问答和课堂互动属于辅助证据，除非教师确认或有多个来源互相支撑，不应单独形成强结论。

## 推荐输出形态

教师端生成档案草稿时应整理为明确范围，例如：

```text
张思源 近7天学习档案草稿
```

输出建议包含：

- 整体概览；
- 稳定表现；
- 重点科目或薄弱点；
- 错题与订正闭环；
- 老师下一步辅导动作；
- 家长配合建议；
- 需要老师补充或确认的信息；
- 使用到的证据范围和样本限制。

AI 输出必须是严格 JSON 草稿。可以额外生成教师可编辑的纯文本，但纯文本只是发布正文兜底，不替代结构化 `publishedView` 和 `teacherReview`。

期中/期末 PDF 阶段报告的教师端流程：

1. 教师选择学生、报告类型和阶段名称，生成阶段报告草稿。
2. 教师编辑或确认 `teacherEditedText`。
3. 教师点击保存并生成 PDF，下载保存报告。
4. 教师通过微信私聊人工发送给家长。
5. 教师在系统内标记“已人工发送”。
6. 学生端只显示状态文案“老师已发送阶段报告给家长”，不展示报告正文、PDF 链接或下载入口。

image 2 模板候选图只用于教师端 UI 视觉讨论，提示词应只包含模块标题、短标签和占位短句；正式报告长正文必须由结构化草稿和 HTML/PDF 模板渲染。

## 禁止项

- 不自动发布到学生或家长。
- 不把低置信批改结果、未确认分数或 AI 临时判断直接入档。
- 不迁移完整小程序档案页面作为首期目标。
- 不把学生隐私、家长电话、登录码或内部审计日志暴露到群聊。
- 不向学生/家长返回 `teacherReview`、`profileEvidencePack`、供应商、模型名、prompt、debug、raw 或内部路由。
- 不把期中/期末 PDF 交付规则混成周/月页面展示逻辑；期中/期末不能直接发布阶段报告正文到学生端。
- 不接入微信自动外发；当前只记录老师人工发送后的状态。

## 验证

- 修改档案 API 时运行 `cmd /c npm.cmd run check --workspace apps/api`。
- 修改阶段报告 API 时运行 `node --test apps/api/src/student-term-report.test.mjs`。
- 修改 Web 档案展示时运行 `cmd /c npm.cmd run typecheck --workspace apps/web`。
- 修改档案中文文案或提示词时运行 `cmd /c npm.cmd run check:encoding`。
- 涉及批改归档来源时确认 `needsTeacherReview`、`archiveEligible` 和教师确认分数逻辑未被绕过。
- 修改角色过滤时至少覆盖教师可见 `teacherReview/profileEvidencePack`、学生不可见这些字段的测试。
