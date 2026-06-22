# 小程序会话与平板绑定

## 会话 token

学生、教师、课堂平板登录后，API 会返回 `sessionToken`。小程序端保存到本地缓存，并在后续请求中自动加入：

```http
Authorization: Bearer <sessionToken>
```

当前 token 是服务端 HMAC 签名的轻量会话，不依赖数据库表。默认有效期为 14 天。

## 已接入接口

- `POST /api/student-login`
  - 返回 `sessionToken`
  - token payload 包含 `role=student`、`studentId`
- `POST /api/teacher-login`
  - 返回 `sessionToken`
  - token payload 包含 `role=teacher`、`teacherId`
- `POST /api/classroom/device-login`
  - 支持 `bindingCode` 或 `deviceId`
  - 返回 `sessionToken`
  - token payload 包含 `role=classroom`、`deviceId`
- `GET /api/session/verify`
  - 校验 `Authorization` 中的 token 是否仍有效

## 平板绑定流程

1. 教师端给每台平板分配绑定码。
2. 平板端进入“课堂平板端”后输入绑定码。
3. API 校验 `ClassroomDevice.bindingCodeHash`。
4. 校验通过后，小程序保存 `device` 和 `sessionToken`。
5. 课堂主页优先读取已绑定设备，再加载该设备的播报、听写和课文跟读任务。

## 后续加固

- 生产环境必须单独配置 `SESSION_SECRET`，不要复用开发默认值。
- 教师端学生新增、重置码、停用登录、任务生成、生成类模板、平板播报/听写/跟读、平板锁定/解锁已经要求 `role=teacher`。
- 学生端问答和上传批改已经校验 token 中的 `studentId` 与请求里的 `studentId` 一致，避免学生端替别人写入记录。
- 批改上传允许 `role=student` 或 `role=teacher`，但学生端只能提交自己的记录。
- 平板端课堂问答下一步应校验 `role=classroom`，并限制只能写入当前 `deviceId`。
