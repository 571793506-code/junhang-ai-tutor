# 小程序第一阶段启动说明

## 当前状态

`apps/miniprogram` 已从说明占位推进为原生微信小程序骨架，和 Web、平板共用 `apps/api` 的 HTTP 接口。

当前已具备：

- 学生 / 家长端：专属码登录、学生主页、今日任务、AI 问答红绿灯、拍照提交批改。
- 学生 / 家长端补充：英语词汇助手、学生档案。
- 教师端：教师专属码登录、服务状态、学生权限列表、学生登记、重置专属码、停用登录、今日任务生成、生成类 A4 模板、拍照批改。
- 课堂平板端：平板绑定码入口、课堂主页、本桌学生头像解锁、课堂任务、听写 / 跟读任务展示、课堂问答文本入口。

## 接口复用

小程序端复用以下 API：

- `POST /api/student-login`
- `POST /api/teacher-login`
- `GET /api/session/verify`
- `GET /api/bootstrap`
- `GET /api/status`
- `POST /api/ai/qa`
- `POST /api/teacher/tasks`
- `POST /api/assessments/draft`
- `POST /api/submissions/batches`
- `POST /api/submissions/grade`
- `POST /api/classroom/device-login`

这意味着 Web、小程序和平板端现在已经使用同一组学生、任务、批改、问答和权限数据。

## 仍需补齐

- 当前登录态存在微信本地缓存中，后续需要服务端签发 session token。
- 登录接口现在会返回服务端签名 `sessionToken`，小程序端会自动保存并通过 `Authorization: Bearer ...` 带到后续请求。
- `GET /api/session/verify` 可用于恢复登录态或判断登录是否过期。
- 小程序上传图片现在会先创建 `batchId` 和共享 `assignmentId`，再逐张上传图片归档到同一次批改。
- 图片批改目前依赖用户备注或后续 OCR 文本；还没有接入真正 OCR。
- 平板端语音输入 / 输出还没有接入微信录音、语音识别和 MiniMax 语音合成。
- 教师端学生新增、重置专属码、退课停用已经有小程序轻量入口；后续需要补权限审计和二次确认。

## 本地打开

1. 启动 API：

```bash
npm run dev:api
```

2. 微信开发者工具打开：

```text
E:\UserData\86188\Documents\君航AI助教\apps\miniprogram
```

3. 开发工具中勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

真机调试时，把 `apps/miniprogram/app.js` 里的 `apiBaseUrl` 从 `127.0.0.1` 改为电脑局域网 IP。
