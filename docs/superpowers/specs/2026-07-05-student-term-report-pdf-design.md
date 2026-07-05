# 学生期中期末 PDF 报告设计

## 背景

学生档案模块已经支持周档案和月度综合长期成长档案。周/月档案是线上成长档案：教师生成草稿、审查后发布到学生端，学生和家长可以在学生端查看完整内容。

期中、期末报告的产品边界不同。它们是正式阶段交付物，只在教师端生成、保存和下载 PDF，由教师通过微信私聊人工发送给家长。学生端不展示 PDF、不展示正文、不提供下载入口，只在教师标记已发送后显示状态：`老师已发送阶段报告给家长`。

## 目标

- 在教师端学生档案模块中增加期中/期末 PDF 报告工作区。
- 支持教师生成期中/期末报告草稿、编辑确认、保存并生成 PDF。
- 支持教师下载 PDF、复制微信发送话术、标记已人工发送。
- 学生端只显示已人工发送状态，不展示 PDF 内容和下载链接。
- 保持周/月档案现有发布链路不变。

## 非目标

- 不接入微信接口，不自动发送微信消息。
- 不在小程序或学生端展示期中/期末 PDF 正文。
- 不做家长阅读回执。
- 第一版不新增数据库迁移。

## 数据与状态

第一版复用现有表：

- `StudentReport`：保存期中/期末报告草稿、教师正文、发送状态。
- `GeneratedAsset`：保存生成出的 PDF 或 HTML 资产。

`StudentReport.type` 使用已有枚举：

- `MIDTERM`：期中报告。
- `FINAL`：期末报告。

`StudentReport.metadata.termReport` 保存：

- `reportType`：`midterm` 或 `final`。
- `status`：`draft`、`pdf_ready`、`sent_manually`。
- `periodLabel`：例如 `2026春季期末`。
- `draft`：结构化报告草稿。
- `teacherEditedText`：教师确认后的正文。
- `pdfAssetId`、`pdfUrl`、`pdfTitle`。
- `wechatMessage`：建议复制给家长的微信话术。
- `sentManuallyAt`、`sentByTeacherId`。
- `visibility`：固定为 `teacher_pdf_only`。

学生端只接收 `status=sent_manually` 的期中/期末报告摘要，且字段只包含标题、周期和状态文案。

## 教师端信息架构

学生档案模块拆成三块：

1. 周/月成长档案
   - 选择学生。
   - 选择周档案或月度综合。
   - 生成草稿。
   - 教师审查后发布至学生端。

2. 期中/期末 PDF 报告
   - 选择期中或期末。
   - 填写或确认周期标签。
   - 生成阶段报告草稿。
   - 教师编辑确认。
   - 保存并生成 PDF。
   - 下载 PDF。
   - 复制微信话术。
   - 标记已人工发送。

3. 历史归档
   - 周/月发布记录继续在已有档案区域展示。
   - 期中/期末报告显示 `草稿`、`PDF已生成`、`已人工发送`。

## API 设计

- `POST /api/students/:studentId/term-report/draft`
  - 教师端生成并保存期中/期末报告草稿。
  - 请求：`reportType`, `periodLabel`。
  - 返回：教师可见报告记录和结构化草稿。

- `POST /api/students/:studentId/term-report/:reportId/pdf`
  - 教师确认正文后生成正式 PDF。
  - 请求：`teacherText`。
  - 返回：报告记录和 PDF 资产。

- `POST /api/students/:studentId/term-report/:reportId/mark-sent`
  - 教师下载并微信私聊发送后，手动标记已发送。
  - 返回：报告记录。

- `GET /api/students/:studentId/term-reports`
  - 教师端返回该学生所有期中/期末报告。
  - 学生端只返回 `sent_manually` 状态报告，且不含 PDF 链接和正文。

## PDF 内容结构

PDF 使用 A4 纵向布局，内容包含：

- 封面标题：学生姓名、年级、报告类型、周期。
- 综合成长摘要。
- 语文、数学、英语学科表现。
- 错题与订正闭环。
- 学习习惯与课堂表现。
- 阶段进步。
- 下阶段建议。
- 家长配合建议。

PDF 生成前必须有教师确认正文。PDF 生成后保存到后台生成资产目录，并通过教师端下载。

## 权限与可见性

- 教师端可见草稿、PDF 下载链接、微信话术、发送状态。
- 学生端只在 `sent_manually` 后显示：`老师已发送阶段报告给家长`。
- 学生端不接收 `pdfUrl`、`teacherEditedText`、`draft`、`profileEvidencePack`、`teacherReview`、模型供应商、prompt、debug、raw。
- 小程序不承载期中/期末 PDF 内容。

## 验证

- API helper 测试覆盖报告草稿、PDF HTML 内容、角色过滤。
- API 检查：`.\jh.cmd check:api`。
- Web 类型检查：`npm.cmd run typecheck --workspace apps/web`。
- 中文与 PDF HTML 源检查：`.\jh.cmd check:encoding`。
- 若生成 PDF 逻辑改动较大，补充渲染后文件大小和页数检查。

