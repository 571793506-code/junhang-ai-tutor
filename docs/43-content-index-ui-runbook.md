# 内容索引与教师端资料上下文说明

本文记录资料导入、Markdown 索引、生成上下文和教师端 UI 入口，供后续 Codex 对话和开发人员快速接手。

## 1. 已完成链路

```text
普通教学资料
-> markitdown 转 Markdown
-> scripts/build-content-index.mjs 构建内容索引
-> exports/content-index/index.json
-> draftAssessmentService 匹配资料上下文
-> generationContext.teaching.contentContext
-> 模型生成草稿
-> 服务层修复
-> 教师复核
```

## 2. 命令

将普通文件或目录转 Markdown：

```bash
cmd /c npm.cmd run content:markdown -- <file-or-directory> --out exports/markdown-ingestion
```

构建内容索引：

```bash
cmd /c npm.cmd run content:index -- exports/markdown-ingestion --out exports/content-index
```

用于本地验证的最小命令：

```bash
cmd /c npm.cmd run content:markdown -- docs\41-prompt-context-engineering-playbook.md --out exports\markdown-ingestion-test
cmd /c npm.cmd run content:index -- exports\markdown-ingestion-test --out exports\content-index
```

## 3. API

查看内容索引：

```http
GET /api/content/index
```

教师上传普通资料并转 Markdown：

```http
POST /api/content/markdown-ingestion
Content-Type: multipart/form-data
```

表单字段：

- `files`：一个或多个普通教学资料文件。
- `outDir`：可选，默认 `exports/markdown-ingestion`。

接口说明：

- 仅教师端可用。
- 支持普通 PDF、Office、表格、HTML、文本、Markdown 和常见图片。
- `.edupdf` 受保护教材会被拒绝，不转换、不改写。
- 上传后原文件保留在 `storage/uploads`，转换后的 Markdown 写入 `exports/markdown-ingestion`。
- `outDir` 必须留在项目工作区内，不能使用 `..` 写到工作区外。

重建内容索引：

```http
POST /api/content/index/rebuild
```

请求体：

```json
{
  "inputs": ["exports/markdown-ingestion"],
  "outDir": "exports/content-index"
}
```

接口说明：

- 仅教师端可用。
- 重建时调用 `scripts/build-content-index.mjs`。
- `inputs` 和 `outDir` 必须留在项目工作区内。
- 返回索引摘要，不返回完整 Markdown chunk 原文。
- 写入审计日志 `content-index / rebuild`。

## 4. Web 教师端

位置：

```text
教师端 -> 教材资料 -> 上传资料上下文
```

面板显示：

- 当前资料索引是否可用。
- 资料上传入口和“导入并重建索引”按钮。
- `.edupdf` 前端选择时会过滤并提示；后端仍会拒绝该类型作为最终保护边界。
- 资料数量。
- 学科覆盖数量。
- 知识点数量。
- “已进入生成上下文”的资料、科目和知识点摘要。
- 最近 4 条资料摘要。
- “重建资料索引”按钮。

## 5. 多端迁移约束

当前 Web 教师端面板只用于前端联调、原型验证和自动化检查。资料导入、Markdown 转换、索引重建、生成上下文注入和教师复核必须继续以 API、服务层和脚本契约为准，不能依赖 Web 页面本地状态作为唯一实现。

后续迁移到微信小程序、课堂平板或公共屏时，应复用同一组后端能力：

- 教师端或管理端上传普通教学资料时，调用 `POST /api/content/markdown-ingestion`。
- 教师端触发资料索引刷新时，调用 `POST /api/content/index/rebuild`。
- 各端展示资料索引状态时，调用 `GET /api/content/index`，只展示摘要和可见状态，不展示完整 Markdown chunk、模型信息或内部调试字段。
- 组卷、练习、复核和导出继续从服务层读取 `generationContext.teaching.contentContext`，小程序端只提交教师意图和必要参数。
- `.edupdf` 保护、工作区路径保护、乱码保护和教师复核拦截必须留在后端边界，前端过滤只作为体验优化。

任何新增 Web 上传控件或资料上下文展示，都应在本文件或小程序迁移 runbook 中记录对应的小程序/平板复用方式。

## 6. 服务层接入

文件：

```text
packages/services/src/index.js
```

`draftAssessmentService` 自动读取：

```text
exports/content-index/index.json
```

并按以下字段匹配资料：

- 学科。
- 年级。
- 知识点。
- 教师要求。
- 教材标题。
- 教材章节标题。

匹配结果写入：

- 模型输入 `generationContext.teaching.contentContext`。
- Assignment metadata 的 `generationContext`。
- Assignment metadata 的 `contentContext`。

## 7. 边界

- `.edupdf` 受保护教材不转换、不改写。
- 转换结果只用于教师端和后端生成上下文。
- 学生/家长端不显示资料索引、插件、模型、供应商或内部上下文。
- 生成结果仍必须经过服务层修复和教师复核后再发布或打印。
- Web 端不是最终交付边界；学生、家长、教师、课堂平板和公共屏的实际可见内容必须按多端角色契约重新确认。

## 8. 已验证命令

```bash
cmd /c npm.cmd run content:index -- exports\markdown-ingestion-test --out exports\content-index
cmd /c npm.cmd run check:teaching-content
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check --workspace apps/api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
```

`check:teaching-content` 会先执行 `api:start-if-needed`，再顺序执行 `check:content-upload-ui` 和 `check:content-context`，适合在改动教师端资料上传、Markdown ingestion、内容索引、组卷上下文或导出链路后作为首选验证入口。

`check:content-upload-ui` 会验证教师端上传面板、文件输入、导入按钮、`.edupdf` 前端过滤、生成上下文摘要和 Web API multipart 上传封装。

`check:content-context` 会执行端到端验证：资料转 Markdown、教师上传资料转 Markdown、`.edupdf` 上传拒绝、工作区外路径拒绝、教师登录、内容索引重建、编码守卫检测、组卷草稿生成、`generationContext.teaching.contentContext` 注入、草稿审查导出、未复核拦截、教师确认、正式题目与解析资产导出。

E2E 会清理并使用专用目录 `exports/markdown-ingestion-e2e`，避免把反复测试生成的 Markdown 混入教师真实资料目录 `exports/markdown-ingestion`。脚本还会清理旧版 E2E 留在默认 Markdown 目录和 API 上传目录中的 `content-context-upload-fixture` / `protected-textbook.edupdf` 测试产物，不清理其他教师资料。

E2E 运行过程中会临时重建 `exports/content-index/index.json` 以验证组卷上下文注入；脚本结束时会恢复运行前的索引文件，避免测试后教师端停留在 E2E 索引。

## 9. 七项完成状态

截至当前版本，本链路的 7 项收口均已完成：

1. Markdown ingestion 脚本和 API 接入已完成：普通资料可转换为 Markdown。
2. 教师端资料上传 UI 已完成：教材资料中提供“上传资料上下文”入口、文件选择和导入按钮。
3. 受保护教材防护已完成：前端过滤 `.edupdf`，后端返回 `PROTECTED_TEXTBOOK_NOT_ALLOWED`。
4. 路径边界防护已完成：上传 `outDir`、索引 `inputs/outDir` 均限制在项目工作区内。
5. 生成链路接入已完成：内容索引会进入 `generationContext.teaching.contentContext`，并参与教师复核和学生卷/解析卷导出。
6. 可复用验证命令已完成：`check:content-upload-ui`、`check:content-context`、`check:teaching-content` 均已记录在项目说明中。
7. E2E 清理和恢复已完成：测试 Markdown 隔离到 `exports/markdown-ingestion-e2e`，旧测试残留会清理，`exports/content-index/index.json` 会在 E2E 结束后恢复。

当前未纳入完成项的是 Chrome extension 真实文件选择自动化；原因是 Codex Chrome Extension native host 当前无法通信。项目内已用 UI 合约检查和 API 真实上传 E2E 覆盖上传链路。
