# 乱码检查与输入输出守卫

本项目已接入统一编码守卫，用于小程序、Web 端和 API 服务之间持续检查生成内容、请求体和响应体，降低中文内容在 AI 生成、OCR、上传批改、PDF 导出和前端展示链路中出现乱码的概率。

## 已接入位置

- `packages/core/src/encoding-guard.js`：统一的乱码检测、文本修复和 payload 递归净化函数。
- `apps/api/src/encoding-guard-middleware.js`：API 中间件，会检查并净化 `POST`、`PUT`、`PATCH` 请求体和 JSON 响应。
- `POST /api/encoding/check`：教师登录后可提交任意 JSON 文本做在线检查，返回问题路径、原文片段和建议修复文本。
- `apps/web/src/api.ts`：Web 端读取 API 响应后做一次兜底净化。
- `apps/miniprogram/utils/encodingGuard.js`：小程序端读取 `wx.request`、`wx.uploadFile` 响应后做一次兜底净化。

## 本地扫描

```bash
npm run check:encoding
```

扫描会检查源码、文档和小程序文件中的常见中文乱码、替换字符和连续问号。发现问题时返回非零退出码，适合放进发布前检查。

默认扫描不进入 `storage`、`generated`、`uploads`、`exports` 等目录，避免历史导出物、上传文件和备份文件拖慢日常检查。因此，如果乱码出现在昨天测试生成的 HTML/PDF 草稿、打印稿或解析稿里，需要额外扫描生成产物：

```bash
npm run check:encoding:generated
```

这会把 `apps/api/storage/generated` 里的 HTML 等文本产物也纳入检查。PDF 是二进制文件，守卫不会直接改 PDF；应检查生成 PDF 前的 HTML 源文件，并确保 API 在写入 HTML 前已经净化文本。

```bash
npm run fix:encoding
```

自动修复已知可确定的乱码映射。对于历史文档中无法可靠还原的内容，建议人工重写原文后再运行扫描。

## 运行策略

- 默认启用 API 守卫。
- 如需临时关闭，可设置 `ENCODING_GUARD_ENABLED=false`。
- 守卫只处理 JSON 输入输出和字符串字段，不改图片、PDF、音频等二进制内容。
- 试卷/小测/练习导出现在会在 HTML 写入前做一次文本净化，降低历史数据库内容或模型返回内容把乱码带入 PDF 的概率。
