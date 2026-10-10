# 批改工作台重建方案

本文固定图片批改模块的内部链路和多端契约。Web 只作为联调入口，微信小程序、课堂平板和后续公共屏复用 API 与服务层，不在前端重复实现识别、批改、审查或归档逻辑。

## 目标

- 更快：上传后立即创建批改批次，后台并行处理多页图片。
- 更准：优先使用生成记录的版本化结构化答案包、题目坐标和导出来源；外部材料才走完整识别链路。
- 可复核：原图上显示逐题标注，教师可逐题查看、修改和确认。
- 可归档：只有教师确认后的分数、错题和薄弱点进入学生档案。

## 内部模型链路

1. 本地 Python/OpenCV：图片预处理、旋转矫正、裁边、清晰度检测和页序整理。
2. MiniMax 视觉：最多 2 路并发识别学生作答、印刷题干、逐题区域和已批改痕迹，并保持页序稳定。
3. 服务层确定性比较：本平台新生成内容优先读取 `gradingSourcePackage`，历史记录兼容答案键和 `questionLayoutManifest`；单一明确答案的客观题优先本地比对。
4. GPT-5.6：外部材料缺少答案时生成参考答案；只批改本地无法安全判断的主观题、过程题和开放题。
5. 风险审查：`uncertain`、低置信、答案冲突、图形证据不足或总分不一致时，只调用一次 GPT-5.6 风险复判；失败时直接进入教师复核，不继续串行调用多个模型。
6. 教师确认：逐题确认后才归档。

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
2. GPT-5.6 生成参考答案与评分点，低置信答案直接标记教师复核。
3. 服务层先处理明确客观题，GPT-5.6 只接收未解决题目。
4. 风险命中时执行一次 GPT-5.6 复判。
5. 服务层按逐题得分计算总分，教师逐题确认后归档。

## 建议实体

- `GradingBatch`：一次上传批改任务，记录学生、教师、类型、科目、状态和图片数量。
- `GradingPage`：每张图片或每一页，记录页序、旋转、清晰度、图片路径和缩略图。
- `GradingQuestion`：逐题识别和批改结果，记录题号、题型、坐标、学生作答、参考答案、得分、置信度和状态。
- `AnswerKey`：生成材料或教师提供的答案键，外部材料可由 AI 生成后待复核。
- `ReviewAction`：教师逐题修改、确认、驳回和备注。
- `ArchiveRecord`：教师确认后写入学生档案、错题记录和薄弱点分析的归档记录。

## 教师持续工作台的解析展示

持续批改工作台上方分别用于核对原图、选择题目，以及修改与确认操作。下方依次使用两个独立整行区域：第一块展示题干、完整学生作答、识别核对提示和本题得分；第二块展示可信参考答案、评分依据、完整解析、考点、错因定位与后续练习。两块随当前题同步切换，选题区提供题干与作答直达链接，题目卡片提供解析直达链接。窄屏仍可阅读两个区域，不受上方原图/选题/操作切换的隐藏规则影响。

这是同一服务端逐题契约的展示调整，评分、教师确认及独立归档继续复用共享API。后续平板或小程序可用相同字段分别展示作答核对和长解析，前端不重组评分规则或生成解析。

## 状态规则

持续工作台分别读取处理状态与服务端教师复核/归档摘要：可复核内容已全部确认时显示“教师已确认”；所读版本存在经完整性校验的独立归档时显示“已归档”，刷新后保留归档提示并禁用重复归档按钮。历史版本仍标为历史、保持只读；恢复或修订形成新版本时不继承旧版本归档提示。摘要复用共享工作流API，不能以本地勾选、确认数或模型输出推定已归档。

- `uploaded`：图片已上传。
- `pages_confirming`：等待教师确认页序和图片质量。
- `recognizing`：混合 OCR 识别中。
- `grading`：参考答案准备和主批改中。
- `auditing`：低置信、异常得分或教师显式要求触发 GPT-5.6 风险审查中。
- `reviewing`：等待教师逐题复核。
- `archived`：已归档。
- `failed`：识别或批改失败。
- 外部练习册使用 `external-grading-recognition-v1` 包：保存上传页序、原图地址、页级质量、印刷题干、学生作答、识别置信度、原始值与教师当前修正值。
- 外部答案来源按 `teacher_confirmed`、`teacher_selected_reference`、`model_draft`、`missing` 分层；`model_draft` 和 `missing` 只能进入教师复核，必须经 `PATCH /api/grading/workbench/:submissionId/answer-source` 明确确认后才有资格继续归档门禁。

低置信、漏页、题目缺失、学生作答缺失、参考答案不可靠、风险审查不通过时，不生成最终分，不入档。没有教师确认金标评测前，不宣称批改正确率已达到生产标准。

## API 方向

- `GET /api/grading/workbench`
- `GET /api/grading/workbench/:submissionId`
- `POST /api/grading/batches`
- `GET /api/grading/batches/:batchId`
- `POST /api/grading/batches/:batchId/pages/reorder`
- `POST /api/grading/batches/:batchId/recognize`
- `POST /api/grading/batches/:batchId/grade`
- `PATCH /api/grading/questions/:questionId/review`
- `PATCH /api/grading/workbench/:submissionId/answer-source`
- `POST /api/grading/batches/:batchId/archive`

当前已先用兼容方式落地 `GET /api/grading/workbench` 和 `GET /api/grading/workbench/:submissionId`，把现有 `Submission` 规范化为工作台数据。现有 `POST /api/submissions/grade` 保持兼容，内部逐步迁移到正式 `GradingBatch` 表结构。

Web 的外部练习册入口支持 iPad 连续多页照片上传和答案来源选择，但 Web 不执行 OCR、评分或归档判断；小程序、课堂平板后续复用同一识别包和答案来源接口。没有教师确认金标数据前，不把 OCR 或模型输出宣传为生产级自动批改准确率。
