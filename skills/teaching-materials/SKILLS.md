# 教材资料类 Skill

用于修改、迁移或复用普通教学资料入库、Markdown 转换、内容索引、教材上下文注入和资料来源管理经验。

## 适用场景

- 老师上传讲义、普通 PDF、Word、PPT、图片、表格、网页或 Markdown，需要转成可检索资料。
- 生成、问答或档案需要读取教材章节、知识点和教师资料上下文。
- 飞书机器人需要支持 `/资料 入库`、`/资料 搜索 关键词`、`/资料 摘要`。
- 检查资料链路是否误改写受保护教材或泄露完整 Markdown chunk。

## 核心原则

- 普通教学资料可以转 Markdown、建索引、生成摘要和知识点。
- `.edupdf` 受保护教材不转换、不改写；前端过滤只是体验，后端拒绝才是最终边界。
- 资料进入生成或问答前必须有来源记录、用途范围和可见性边界。
- 多端只展示资料摘要、数量、科目、知识点和入库状态，不展示完整 chunk、模型信息或内部调试字段。
- 内容索引是服务层上下文来源，不能只存在 Web 页面状态里。

## 当前项目可参考位置

- `scripts/convert-to-markdown.mjs`：普通资料转 Markdown。
- `scripts/build-content-index.mjs`：资料索引构建。
- `apps/api/src/server.js`：`GET /api/content/index`、`POST /api/content/markdown-ingestion`、`POST /api/content/index/rebuild`。
- `packages/services/src/index.js`：`generationContext.teaching.contentContext` 注入。
- `docs/43-content-index-ui-runbook.md`：资料链路、验证命令和 E2E 边界。
- `docs/42-github-tools-and-codex-plugin-integration.md`：资料 Markdown 化工具边界。

## 推荐迁移形态

飞书机器人首期以老师侧文件和命令为入口：

```text
/资料 入库
/资料 搜索 分数除法
/资料 摘要 五年级数学第四单元
```

输出建议包含：

- 文件名和来源；
- 转换状态；
- 摘要；
- 识别出的年级、学科、章节和知识点；
- 是否可用于生成或问答；
- 需要老师确认的点。

## 禁止项

- 不改写 `.edupdf` 受保护教材。
- 不把上传文件、导出 Markdown、索引 JSON 或大体积资料默认纳入 Git。
- 不向学生、家长或公开群展示完整资料 chunk。
- 不从旧项目全量复制资料库到新项目。

## 验证

- 修改资料转换或索引脚本时运行 `cmd /c npm.cmd run check:content-context`。
- 修改教师上传 UI 或 API 封装时运行 `cmd /c npm.cmd run check:content-upload-ui`。
- 同时涉及资料上传和生成上下文时运行 `cmd /c npm.cmd run check:teaching-content`。
- 修改中文资料规则或文案时运行 `cmd /c npm.cmd run check:encoding`。
