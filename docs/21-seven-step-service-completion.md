# 七步服务完善记录

## 1. 图片识别与复核

- 教师端批改队列支持图片预览、识别触发、人工校正、页码与题号范围保存。
- API：`POST /api/review/submissions/:submissionId/recognize`、`PATCH /api/review/submissions/:submissionId/ocr`。
- 当前未配置真实 OCR 引擎时返回明确不可用状态，人工复核流程仍可正常完成。

## 2. 学生档案聚合

- API：`POST /api/students/:studentId/profile/aggregate`、`GET /api/students/:studentId/profile`。
- 聚合来源：今日任务、批改提交、错题、阶段报告、问答与课堂语音记录、行为事件。
- 每次刷新写入 `StudentProfile.snapshot`，供 Web、小程序和平板后续共享。

## 3. 登录与数据权限

- `GET /api/bootstrap` 与 `POST /api/ai/qa` 现在必须携带有效会话。
- 教师仅看到绑定学生与所属设备；学生仅看到自己的数据。
- 课堂平板仅接收本班最小学生身份信息，不返回家长电话、专属码、错题或报告。
- 平板登录仅接受绑定码，不接受仅凭设备 ID 进入。

## 4. 平板语音问答

- API：`POST /api/classroom/voice-qa`。
- 输入语音识别文本后，服务端自动判定知识讲解或思路引导，写入 `QaSession` 与 `VoiceInteraction`。
- MiniMax 可用时同步生成语音输出任务；页面对用户统一显示 `AI生成`。

## 5. A4 打印导出

- 生成类默认规则：练习/小测 2 页 A4，试卷 4 页 A4；特殊要求允许调整页数与题量。
- 输出采用固定试卷式 HTML 模板，保留作答空白、页眉字段、分页和教师复核标记。
- 先走 `POST /api/assessments/:assignmentId/draft-export` 生成内容审查 PDF 草稿，Web/小程序只展示 PDF 链接和“是/否”反馈。
- 教师通过 `POST /api/assessments/:assignmentId/draft-review` 确认后，才允许 `POST /api/assessments/:assignmentId/print-export` 导出正式题目 PDF 与解析 PDF；无法渲染时回退为可打印 HTML。

## 6. 运维审计

- API：`GET /api/admin/audit`，仅教师端可访问。
- 教师 Web 端“运维审计”展示操作事件、AI 服务运行与打印资产。
- OCR 校正、学生档案刷新、课堂语音问答、打印导出均写入审计记录。

## 7. 验证结果

- 无登录访问启动数据与问答返回 `401`。
- 教师档案聚合、A4 草稿审查 PDF、正式题目/解析 PDF 导出、图片预览与人工 OCR 校正均通过 HTTP 联调。
- 平板绑定码登录与语音问答通过联调；平板启动数据未包含家长电话或学生专属码。
