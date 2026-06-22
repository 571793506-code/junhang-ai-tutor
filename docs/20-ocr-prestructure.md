# OCR 预结构与批改图片元数据

当前阶段图片批改已经绑定到统一的视觉识别与 AI 批改链路：上传后先进入后台队列，API 使用 MiniMax 视觉识别学生作答、印刷题干和逐题位置，再进入参考答案生成、AI 批改、第二模型审计、GPT5.5 高级审查和教师复核。Web、小程序和课堂平板都复用同一组字段，不在前端单独实现识别或批改逻辑。

## 写入位置

- `Submission.content.ocr`
- `Submission.content.imageFiles`
- `Submission.content.pageNumber`
- `Submission.content.questionRange`

保留旧字段 `content.ocrText`、`content.imageIndex`、`content.imageTotal`，用于兼容现有 Web 和小程序调用。

## OCR 字段

```json
{
  "status": "PENDING",
  "text": null,
  "studentAnswerText": null,
  "printedText": null,
  "manualText": null,
  "confidence": null,
  "pageNumber": 1,
  "questionRange": "1-6",
  "imageIndex": 1,
  "imageTotal": 3,
  "source": "student_upload",
  "engine": null,
  "reviewed": false
}
```

`status` 约定：

- `PENDING`: 已有图片，等待识别队列处理。
- `RUNNING`: 后台正在进行视觉识别和批改。
- `USER_PROVIDED`: 上传时老师或学生填写了文字备注，可作为临时识别文本。
- `MANUAL_CORRECTED`: 老师后续补了人工校正文本。
- `READY`: 真实 OCR 已完成。
- `FAILED`: OCR 失败，仍需人工查看图片。

批改质量约束：

- 有生成记录或老师答案键时，优先使用 `answerKey` / `assignmentItems`。
- 关联本系统生成 PDF 时，优先使用 `questionLayoutManifest` 对齐题号、答案、解析、分值和图片标注区域；`coordinateSource=browser-dom` 表示题目 bbox 来自浏览器真实渲染坐标，`estimated` 只作为浏览器不可用时的降级。
- 没有答案键时，先由 DeepSeek assessment v4 根据题干生成 `referenceAnswers`，再进行逐题批改。
- MiniMax 视觉负责图片内容、学生作答、印刷题干和题目区域提取。
- DeepSeek assessment v4 负责参考答案生成和主批改。
- MiniMax M3 负责第二模型审计；GPT5.5 负责高级审查、异常分数拦截和归档门禁。
- MiniMax 或 GPT5.5 任一必需审查未通过时不给最终分。
- 低置信、OCR 证据不足、参考答案不足、逐题结果与分数不一致时，只保留 `provisionalScore`，不写入学生档案。
- 只有教师在复核页确认后，才允许把分数、错题和薄弱点归档。

## 复核队列返回

`GET /api/review/submissions` 现在会额外返回：

- `ocr`
- `ocrStatusLabel`
- `ocrTextPreview`
- `imageFiles`
- `pageNumber`
- `questionRange`

教师端小程序复核页已显示识别状态、页码、题号范围和文字预览。这样图片批改、作业批改、小测批改、试卷批改和听写批改都能先共享同一条数据链路。

## 视觉识别链路

上传批改接口当前采用队列式流程：

1. `POST /api/submissions/grade` 保存图片、学生、类型、科目和标题，立即返回 `queued=true`。
2. 后台根据 `Submission.content.imageFiles` 拉取图片，默认走 `OCR_ENGINE=vision`。
3. MiniMax 视觉识别学生作答、印刷题干、题目区域和批改痕迹。
4. 若提交关联生成卷，服务层先读取作业元数据或生成资产中的 `questionLayoutManifest`，避免重新按整页 OCR 猜题。
5. 识别后写入 `text`、`studentAnswerText`、`printedText`、`confidence`、`engine`。
6. 服务层准备参考答案：有答案键或布局清单优先，无答案键先生成参考答案。
7. DeepSeek assessment v4 进行逐题批改，MiniMax M3 做第二模型审计。
8. GPT5.5 对 OCR 证据、参考答案、逐题批改、异常分数和 MiniMax 审计结果做高级审查。
9. 结果进入教师复核队列；低置信不出最终分、不入档。
10. 教师确认后，才写入 `MistakeRecord` 和学生档案分析。
