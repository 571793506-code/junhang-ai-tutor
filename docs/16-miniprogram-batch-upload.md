# 小程序多图批改批次

微信小程序端选择多张图片时，上传仍按单张图片执行，但业务上必须归为同一次作业、小测、试卷或听写批改。

## 接口顺序

1. 小程序先调用 `POST /api/submissions/batches`。
2. API 返回 `assignmentId` 和 `batchId`。
3. 小程序逐张调用 `POST /api/submissions/grade`，每张都带同一个 `assignmentId` 和 `batchId`，并带上 `imageIndex`、`imageTotal`。

## 批次创建字段

```json
{
  "studentId": "stu-xxx",
  "studentName": "李子越",
  "teacherId": "teacher-xxx",
  "subject": "英语",
  "kind": "作业批改",
  "title": "作业批改-李子越",
  "grade": "五年级",
  "uploadedBy": "student",
  "imageTotal": 4,
  "note": "第 3 页需要重点看应用题"
}
```

## 单图上传字段

```json
{
  "assignmentId": "assignment-xxx",
  "batchId": "batch-xxx",
  "studentId": "stu-xxx",
  "subject": "英语",
  "kind": "作业批改",
  "uploadedBy": "student",
  "imageIndex": 1,
  "imageTotal": 4
}
```

## 归档规则

- `Assignment` 代表这一次批改批次。
- `Submission` 代表该批次下的一次图片提交。
- `GradingResult` 保存 AI 初批结果，默认仍需要老师复核。
- 后续 OCR 接入后，`ocrText` 应按图片或整批次写入，避免只看文件名批改。
