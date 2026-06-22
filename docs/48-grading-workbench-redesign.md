# 批改工作台重建方案

本文固定图片批改模块的内部链路和多端契约。Web 只作为联调入口，微信小程序、课堂平板和后续公共屏复用 API 与服务层，不在前端重复实现识别、批改、审查或归档逻辑。

## 目标

- 更快：上传后立即创建批改批次，后台并行处理多页图片。
- 更准：优先使用生成记录的题目、答案、分值和题目坐标；外部材料才走完整识别链路。
- 可复核：原图上显示逐题标注，教师可逐题查看、修改和确认。
- 可归档：只有教师确认后的分数、错题和薄弱点进入学生档案。

## 内部模型链路

1. 本地 Python/OpenCV：图片预处理、旋转矫正、裁边、清晰度检测和页序整理。
2. MiniMax M3 视觉：学生作答、印刷题干、逐题区域和已批改痕迹识别。
3. DeepSeek assessment v4：无答案键时生成参考答案；根据答案键或参考答案进行主批改。
4. MiniMax M3：第二模型审计，检查 OCR 证据、逐题判断、总分和风险。
5. GPT5.5：高级审查，拦截低置信、漏页、异常扣分、模型分歧和归档风险。
6. 教师确认：确认后才归档。

不接入腾讯云 OCR、PaddleOCR 或 Mathpix。学生、家长和课堂平板端只显示“AI生成”、处理状态和教师发布结果，不显示模型或供应商。

## 两条处理路径

### 已生成材料

生成试卷、小测或练习时同步保存：

- `assignmentId`
- `questionId`
- `questionNo`
- `answerKey`
- `analysisSteps`
- `score`
- `knowledgePoint`
- `bbox`
- `page`

批改时优先按 `assignmentId` 读取答案键和题目坐标，只识别学生作答区域。该路径应作为最高准确率路径。

### 外部材料

外部作业、试卷、小测或听写照片没有答案键时：

1. MiniMax 视觉识别题干、学生作答、题目区域和批改痕迹。
2. DeepSeek assessment v4 生成参考答案与评分点。
3. DeepSeek assessment v4 主批改。
4. MiniMax M3 二次审计。
5. GPT5.5 高级审查。
6. 教师逐题确认后归档。

## 建议实体

- `GradingBatch`：一次上传批改任务，记录学生、教师、类型、科目、状态和图片数量。
- `GradingPage`：每张图片或每一页，记录页序、旋转、清晰度、图片路径和缩略图。
- `GradingQuestion`：逐题识别和批改结果，记录题号、题型、坐标、学生作答、参考答案、得分、置信度和状态。
- `AnswerKey`：生成材料或教师提供的答案键，外部材料可由 AI 生成后待复核。
- `ReviewAction`：教师逐题修改、确认、驳回和备注。
- `ArchiveRecord`：教师确认后写入学生档案、错题记录和薄弱点分析的归档记录。

## 状态规则

- `uploaded`：图片已上传。
- `pages_confirming`：等待教师确认页序和图片质量。
- `recognizing`：混合 OCR 识别中。
- `grading`：参考答案准备和主批改中。
- `auditing`：MiniMax 二审和 GPT5.5 高级审查中。
- `reviewing`：等待教师逐题复核。
- `archived`：已归档。
- `failed`：识别或批改失败。

低置信、漏页、题目缺失、学生作答缺失、参考答案不可靠、模型审查不通过时，不生成最终分，不入档。

## API 方向

- `GET /api/grading/workbench`
- `GET /api/grading/workbench/:submissionId`
- `POST /api/grading/batches`
- `GET /api/grading/batches/:batchId`
- `POST /api/grading/batches/:batchId/pages/reorder`
- `POST /api/grading/batches/:batchId/recognize`
- `POST /api/grading/batches/:batchId/grade`
- `PATCH /api/grading/questions/:questionId/review`
- `POST /api/grading/batches/:batchId/archive`

当前已先用兼容方式落地 `GET /api/grading/workbench` 和 `GET /api/grading/workbench/:submissionId`，把现有 `Submission` 规范化为工作台数据。现有 `POST /api/submissions/grade` 保持兼容，内部逐步迁移到正式 `GradingBatch` 表结构。
