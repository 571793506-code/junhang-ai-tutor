# 学生档案类 Skill

用于修改、迁移或复用学生档案、学习记录聚合、阶段反馈草稿、教师发布和家长可见摘要经验。

## 适用场景

- 生成学生档案草稿、周反馈、月反馈、阶段反馈或家长可读摘要。
- 把任务、批改、问答、课堂观察等学习证据汇总为教师复核材料。
- 检查学生档案是否误用了未复核 AI 结果或低置信批改结果。

## 核心原则

- 学生档案草稿只给教师编辑和复核，教师确认前不对学生或家长发布。
- 当前核心展示方向是周档案和月度综合长期成长档案；期中、期末总结后续按教师确认 PDF 发送给家长，不作为首期页面 Tab 扩展。
- 档案必须保留来源意识：任务、批改、问答、课堂记录、老师备注要能区分。
- 低置信 OCR、未确认分数、未复核错题和 provisional 结果不能写入最终档案。
- 家长可见内容要温和、具体、可行动，避免内部术语和模型信息。
- 退课或停用登录码不删除学生档案，避免学习记录丢失。
- Web 只作为联调和原型入口；档案证据聚合、角色过滤、发布状态和阻断来源判断必须在 API/helper 或共享契约中完成。

## 当前项目可参考位置

- `apps/api/src/student-growth-profile.js`：`profileEvidencePack`、周/月 `publishedView`、`teacherReview` 和角色过滤。
- `apps/api/src/server.js`：`/api/students/:studentId/profile/draft`、`/publish`、`/aggregate` 和 `/profile`。
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

## 禁止项

- 不自动发布到学生或家长。
- 不把低置信批改结果、未确认分数或 AI 临时判断直接入档。
- 不迁移完整小程序档案页面作为首期目标。
- 不把学生隐私、家长电话、登录码或内部审计日志暴露到群聊。
- 不向学生/家长返回 `teacherReview`、`profileEvidencePack`、供应商、模型名、prompt、debug、raw 或内部路由。
- 不把期中/期末 PDF 交付规则混成周/月页面展示逻辑。

## 验证

- 修改档案 API 时运行 `cmd /c npm.cmd run check --workspace apps/api`。
- 修改 Web 档案展示时运行 `cmd /c npm.cmd run typecheck --workspace apps/web`。
- 修改档案中文文案或提示词时运行 `cmd /c npm.cmd run check:encoding`。
- 涉及批改归档来源时确认 `needsTeacherReview`、`archiveEligible` 和教师确认分数逻辑未被绕过。
- 修改角色过滤时至少覆盖教师可见 `teacherReview/profileEvidencePack`、学生不可见这些字段的测试。
