# API 权限收紧记录

## 已完成

以下接口已经要求服务端 session：

- `POST /api/teacher/tasks`：仅教师。
- `POST /api/assessments/draft`：仅教师。
- `POST /api/students`：仅教师。
- `POST /api/students/:studentId/reset-access-code`：仅教师。
- `PATCH /api/students/:studentId/access-status`：仅教师。
- `POST /api/classroom/broadcasts`：仅教师。
- `POST /api/classroom/dictation`：仅教师。
- `POST /api/classroom/reading`：仅教师。
- `POST /api/classroom/devices/:deviceId/unlock`：仅教师。
- `POST /api/classroom/devices/:deviceId/lock`：仅教师。
- `POST /api/submissions/batches`：学生或教师。
- `POST /api/submissions/grade`：学生或教师。

学生端范围校验：

- `POST /api/ai/qa` 如果使用学生 token，请求里的 `studentId` 必须等于 token 里的 `studentId`。
- `POST /api/submissions/batches` 如果使用学生 token，请求里的 `studentId` 必须等于 token 里的 `studentId`。
- `POST /api/submissions/grade` 如果使用学生 token，请求里的 `studentId` 必须等于 token 里的 `studentId`。

教师端归属写入：

- 教师端创建任务、生成试卷、学生登记、课堂播报、听写、跟读时，后端优先使用 session 中的 `teacherId`，降低前端传错或被篡改的风险。
- 教师端创建任务、批改上传、批改批次、重置学生码、停用/恢复学生登录时，会校验学生是否属于当前教师。
- 教师端课堂播报、听写、跟读、平板锁定/解锁时，会校验平板是否属于当前教师或暂未绑定教师。
- `GET /api/teachers/:teacherId/students` 现在要求教师 token，且只能查看自己的学生列表。

平板端范围校验：

- `POST /api/ai/qa` 如果使用平板 token，请求里的 `deviceId` 必须等于 token 中的 `deviceId`。

## 已验证

- 无 token 调用教师任务生成返回 `401 SESSION_REQUIRED`。
- 学生 token 试图替其他学生问答返回 `403 STUDENT_SCOPE_MISMATCH`。
- 学生 token 试图替其他学生创建上传批次返回 `403 STUDENT_SCOPE_MISMATCH`。
- 学生 token 给自己问答返回 `200`。
- 教师 token 创建任务返回 `200`。
- 教师 token 操作非绑定学生返回 `403 TEACHER_STUDENT_SCOPE_MISMATCH`。
- 平板 token 操作其他设备返回 `403 CLASSROOM_DEVICE_SCOPE_MISMATCH`。

## 下一步

- 对敏感操作增加审计日志，例如重置码、停用登录、删除绑定码。
- 教师与年级共用生成记录之间还需要更细的“年级/班级授权”规则。
