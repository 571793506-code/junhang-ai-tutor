# Real Service Foundation

本阶段继续保持 Web/小程序/课堂平板共用同一套 `apps/api` HTTP 接口，重点补齐真实服务接入前的底层契约。

## OCR 接入

`POST /api/review/submissions/:submissionId/recognize` 已改为调用统一 OCR 适配器：

- `OCR_ENGINE=manual`：默认不可用，返回明确失败状态，教师可在复核页人工校正。
- `OCR_ENGINE=mock`：演示识别，用于 UI 和流程验证。
- `OCR_ENGINE=tesseract`：本地 OCR，依赖 `tesseract.js`，适合先跑图片文字识别闭环。
- `OCR_ENGINE=http`：调用 `OCR_HTTP_URL`，用于接入第三方 OCR 或内部图像理解网关。
- `OCR_ENGINE=vision`：预留图像理解模型入口。当前文本模型不直接读图片，会返回明确阻塞说明。

接口返回仍保持 `status/text/confidence/engine/reason`，所以 Web、小程序和平板端不需要因为更换 OCR 供应商而改业务流。

## 学生档案 AI 摘要

`POST /api/students/:studentId/profile/aggregate` 现在先做规则聚合，再尝试生成家长可读的 `narrative`：

- `parentSummary`：家长端摘要。
- `teacherSummary`：教师端复盘。
- `weeklyFeedback/monthlyFeedback/midtermFeedback/finalFeedback`：周、月、期中、期末反馈。
- `risks/nextActions`：薄弱点与下一步建议。
- `generatedBy` 固定为 `AI生成`，不暴露具体模型。
- AI 不可用时自动落回规则摘要。

## 三科打印模板

生成类内容继续导出 A4：

- 练习/小测默认 2 页。
- 试卷默认 4 页。
- 语文：横线/作文式书写区，偏阅读和表达。
- 数学：格线演算区，偏计算、画图和分步推理。
- 英语：词汇、句型、阅读、书面表达混合作答区。

导出页眉保留 `AI生成 · 教师复核后打印`，满足小程序/家长端不显示供应商、教师端保留复核责任的要求。

## 小程序 HTTP 联调

新增脚本：

```bash
npm run check:miniprogram-http
```

检查项包括：

- 公共状态不泄露 DeepSeek/MiniMax。
- 教师登录后可查看服务运维状态。
- 学生端不泄露模型供应商。
- 平板端不返回家长电话和学生专属码。
- 学生档案聚合包含 `AI生成` 摘要字段。

脚本默认使用 `.env` 中的 `API_PORT`，或 `API_BASE_URL`。
