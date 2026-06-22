# 批改复核队列与审计日志

## 批改复核队列

教师端新增复核队列接口：

- `GET /api/review/submissions`
  - 仅教师 token 可访问。
  - 只返回当前教师绑定学生的待复核提交。
  - 数据来源是 `Submission` + `GradingResult.needsReview=true`。

- `POST /api/review/submissions/:submissionId/mark-reviewed`
  - 仅教师 token 可访问。
  - 校验该提交对应学生是否属于当前教师。
  - 将 `GradingResult.needsReview` 改为 `false`。
  - `Submission.status` 保持为 `GRADED`，表示已有批改结果且已完成教师复核。

小程序教师端已增加“批改复核”入口，可查看待复核记录并标记已复核。

## 审计日志

复用现有 `BehaviorEvent` 表记录敏感操作。当前已写入：

- 学生登记：`student-access / create-student`
- 学生专属码重置：`student-access / reset-access-code`
- 学生登录停用：`student-access / disable-access`
- 学生权限状态更新：`student-access / update-access-status`
- 今日任务生成：`teacher-task / draft-task`
- 生成类模板：`assessment / draft-assessment`
- 创建上传批次：`submission / create-upload-batch`
- 图片批改上传：`submission / grade-upload`
- 听写发布：`classroom / publish-dictation`
- 跟读发布：`classroom / publish-reading`
- 课堂播报发布：`classroom / publish-broadcast`
- 平板解锁：`classroom / unlock-device`
- 平板锁定：`classroom / lock-device`
- 批改复核完成：`review / mark-submission-reviewed`

## 已验证

- 学生创建上传批次后，批改记录进入教师复核队列。
- 教师标记已复核后，该记录从待复核队列消失。
- 审计日志会通过 `GET /api/bootstrap` 的 `logs` 返回到前端启动包。

## 下一步

- 给 Web 教师端增加复核队列 UI。
- 审计日志按教师端筛选展示。
- OCR 接入后，将识别状态、识别文本、置信度写入复核队列。
