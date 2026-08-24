# 外部练习册批改设计

**日期：** 2026-08-24  
**状态：** 待用户审阅  
**范围：** Web 首期，服务层/API 契约同步收敛；不改变微信小程序页面

## 目标

让教师可以把 iPad 拍摄的学校练习册图片上传到 Web，得到“可追溯、可逐题修正、不会把不确定结果伪装成最终分数”的批改草稿，并在教师确认后进入错题、学生档案和后续练习链路。

首期成功标准：

1. 图片上传后，每一页都有页序、识别状态、题目区域和学生作答识别结果。
2. 每一道题都能区分“识别结果”和“批改结果”，保留题干、作答、参考答案、置信度和原图坐标。
3. 外部材料没有可靠答案时，只生成“待教师确认的参考答案草稿”，不得直接给正式分数或归档。
4. 教师可在同一工作台查看原图与逐题内容，修正题干、作答、答案、得分、错因和备注。
5. 只有所有题满足复核门禁并由教师确认后，才允许汇总正式分数、写入错题和学生档案。

## 非目标

- 不承诺手写过程题、开放题和低清晰图片的全自动正确批改。
- 不把 iPad 拍照视为绝对可靠；仍保留缺页、裁切、模糊、页序和识别置信度检查。
- 不新建一套与现有 `Submission`/批改工作台并行的数据模型。
- 不在 Web 页面中实现 OCR、答案生成或评分规则；核心判断继续在 API/服务层。
- 不自动向学生或家长发布外部材料批改结果。
- 不在首期扩大批量班级上传、答案库自动抓取或新的模型供应商接入。

## 两条批改路径

### 外部练习册路径

`iPad 多页照片 -> 图片/页序检查 -> OCR 预结构 -> 答案来源确认 -> 逐题批改草稿 -> 教师逐题确认 -> 归档`

外部材料默认 `materialType=external_workbook`。系统必须保存题目来源为外部图片，不能声称使用了平台生成答案包。

答案来源按可靠性排序：

1. 教师上传或粘贴的标准答案（`teacher_confirmed`）。
2. 教师选择的已知教材/练习册答案来源（`teacher_selected_reference`）。
3. 服务层生成的参考答案草稿（`model_draft`），必须带 `needs_teacher_review=true`。
4. 没有答案来源（`missing`），只能识别和整理作答，不能进入正式评分。

### 系统生成材料路径

保留现有 `assignmentId -> gradingSourcePackage -> questionLayoutManifest` 路径。系统生成的试卷、小测和练习优先按题号、答案包和版面坐标识别学生作答，不重新猜测印刷题干。外部材料的新增字段不能削弱这条高可靠路径。

## 统一识别中间层

每次批改上传都在 `Submission.content` 中保存版本化识别包，首期版本为 `external-grading-recognition-v1`：

```json
{
  "schemaVersion": "external-grading-recognition-v1",
  "materialType": "external_workbook",
  "pages": [
    {
      "pageNumber": 1,
      "fileName": "page-01.jpg",
      "imageUrl": "...",
      "quality": {
        "status": "usable | needs_review | unusable",
        "score": 0.96,
        "issues": [],
        "warnings": []
      },
      "questions": [
        {
          "questionNo": "1",
          "questionType": "choice | fill | calculation | solution | reading | writing | unknown",
          "bbox": { "page": 1, "x": 0, "y": 0, "w": 0, "h": 0 },
          "printedPrompt": "",
          "studentAnswer": "",
          "recognitionConfidence": 0.0,
          "recognitionStatus": "confirmed | needs_teacher_review | unreadable"
        }
      ]
    }
  ],
  "answerSource": {
    "mode": "teacher_confirmed | teacher_selected_reference | model_draft | missing",
    "status": "confirmed | needs_teacher_review | missing",
    "answers": {}
  },
  "gradingStatus": "not_started | provisional | needs_teacher_review | teacher_confirmed",
  "archiveEligible": false
}
```

`recognitionStatus` 只描述“看清楚没有”；`gradingStatus` 只描述“判定能否作为批改结果”。两者不能混用。

## API 变化方向

继续复用现有接口，不改变现有客户端必需字段：

- `POST /api/submissions/grade`
  - 接受可选 `materialType`，外部练习册默认 `external_workbook`。
  - 接受可选 `answerSourceMode`、`answerKeyText`、`referenceSourceId`。
  - 返回 202 后，后台识别结果写入 `external-grading-recognition-v1`。
- `POST /api/review/submissions/:submissionId/recognize`
  - 返回页级质量、题目区域、识别置信度和答案来源状态。
- `PATCH /api/grading/workbench/:submissionId/questions/:questionId`
  - 支持教师修正题干、学生作答、正确答案、题型、得分、错因和备注。
  - 每次修正写入教师复核审计，不覆盖原始识别值。
- `POST /api/grading/workbench/:submissionId/archive`
  - 继续执行所有题确认、答案来源可靠、低置信项已处理和学生仍可接收新工作的门禁。

API 返回给学生、家长和平板端时，只允许处理状态和教师已发布结果；供应商、模型、raw OCR、完整识别包和内部阻断原因继续留在教师端/服务端。

## Web 工作台流程

外部材料上传区明确提示“iPad 拍照上传，多页按顺序选择”。上传后教师按以下顺序操作：

1. 查看页缩略图、页序和图片质量状态。
2. 查看系统识别出的题号、题干、学生作答和置信度。
3. 选择或补充答案来源；没有答案时，系统只能建立参考答案草稿。
4. 在逐题复核区对照原图修改识别结果和得分。
5. 所有题确认后，查看总分和待归档摘要。
6. 点击“确认归档”，将已确认错题和学习信号写入后续档案链路。

系统生成材料在同一工作台中显示“平台答案包”来源，并隐藏不必要的 OCR 印刷题干识别步骤。

## 状态与门禁

- 图片质量为 `needs_review` 或 `unusable`：可以继续人工查看，但不能自动归档。
- 题目或学生作答为 `needs_teacher_review`/`unreadable`：该题不能作为已确认题。
- 答案来源为 `model_draft` 或 `missing`：没有教师确认前，不生成正式总分、不入错题、不入学生档案。
- 任何题存在 `uncertain`、答案冲突、分值不一致或题目缺失：批次保持 `needs_teacher_review`。
- 教师确认只改变复核状态，不删除原始识别结果；原始值、教师修正值和操作者/时间均可追踪。

## 错误处理

- 上传失败：保留明确的文件级失败信息，可重试，不创建可归档批次。
- 图片页序异常：提供重新排序后重新识别入口。
- OCR 不可用：保留图片和手工录入入口，不自动调用第三个模型补写。
- 参考答案生成失败：保留识别包，标记“待教师提供答案”，不阻塞教师手工批改，但阻止自动归档。
- 部分题识别成功：逐题显示成功/待确认，不用批次级“成功”覆盖低置信题。

## 验证计划

服务层/API：

- 外部材料识别包 schema 和状态分离测试。
- 缺少答案、模型答案未确认、低置信题、图片质量需复核均不能归档。
- 教师修正保留原始识别值并更新教师值。
- 系统生成材料继续优先使用 `gradingSourcePackage`。

Web：

- iPad 多图上传入口和页序展示。
- 答案来源选择和缺失答案提示。
- 原图/逐题复核字段可编辑。
- 低置信批次无法点击归档。

验证命令按范围执行：

```bat
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
node --test apps/api/src/assessment-generation-job-routes.test.mjs
node --test apps/api/src/student-growth-profile.test.mjs
cmd /c npm.cmd run check:encoding
```

涉及真实生成/导出链路时，再补跑 `cmd /c npm.cmd run check:content-context`。本设计不把低预算 E2E 当作批改准确率证明；批改质量需要教师确认的 gold 数据单独评估。

## 首期交付边界

首期只实现：

- 外部练习册识别包的结构化保存和返回。
- 答案来源状态。
- Web 页级/逐题复核显示与编辑。
- 归档门禁与测试。

首期暂不实现：

- 自动识别整本练习册的教材版本。
- 自动抓取网络答案。
- 批量班级导入。
- 自动发布家长端。
- 新增模型供应商。

