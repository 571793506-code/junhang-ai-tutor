# 教材资料类 Skill

用于修改、迁移或复用普通教学资料入库、Markdown 转换、内容索引、教材上下文注入和资料来源管理经验。

## 适用场景

- 老师上传讲义、普通 PDF、Word、PPT、图片、表格、网页或 Markdown，需要转成可检索资料。
- 生成、问答或档案需要读取教材章节、知识点和教师资料上下文。
- 检查资料链路是否误改写受保护教材或泄露完整 Markdown chunk。

## 核心原则

- 普通教学资料可以转 Markdown、建索引、生成摘要和知识点。
- `.edupdf` 受保护教材不转换、不改写；前端过滤只是体验，后端拒绝才是最终边界。
- 资料进入生成或问答前必须有来源记录、用途范围和可见性边界。
- 多端只展示资料摘要、数量、科目、知识点和入库状态，不展示完整 chunk、模型信息或内部调试字段。
- 内容索引是服务层上下文来源，不能只存在 Web 页面状态里。

## 外部工具与 Skill 参考

- MarkItDown：作为本项目普通教学资料转 Markdown 的默认路线，优先服务 `scripts/convert-to-markdown.mjs` 和资料索引链路。
- Docling：作为复杂 PDF、表格、图片、版式材料解析增强候选；只有 MarkItDown 结果不足以支持教师复核或知识点抽取时再评估接入。
- Marker：只作为能力候选；接入前必须审查 license、依赖体积、OCR 质量、公式/表格可靠性和本地运行成本。
- book-to-skill：只参考“资料集合变成可查询知识”的组织方式；不要把教材全文直接做成学生可见 skill。
- education-agent-skills：只吸收课程结构、测评、学习反馈和教师复核规则；不直接复制外部实现。

外部资料处理工具进入项目时，必须先满足本项目边界：`.edupdf` 不转换、不改写；资料只进入教师端和服务端 `generationContext.teaching.contentContext`；学生、家长、课堂平板和公共屏不展示完整资料内容。

## 当前项目可参考位置

- `scripts/convert-to-markdown.mjs`：普通资料转 Markdown。
- `scripts/build-content-index.mjs`：资料索引构建。
- `apps/api/src/server.js`：`GET /api/content/index`、`POST /api/content/markdown-ingestion`、`POST /api/content/index/rebuild`。
- `packages/services/src/index.js`：`generationContext.teaching.contentContext` 注入。
- `docs/43-content-index-ui-runbook.md`：资料链路、验证命令和 E2E 边界。
- `docs/42-github-tools-and-codex-plugin-integration.md`：资料 Markdown 化工具边界。

## 推荐输出形态

教师端资料操作应整理为明确动作：

```text
资料入库
资料搜索：分数除法
资料摘要：五年级数学第四单元
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
- 不把上传文件、导出 Markdown、索引 JSON 或大体积资料默认复制到其他项目。

## 验证

- 修改资料转换或索引脚本时运行 `cmd /c npm.cmd run check:content-context`。
- 修改教师上传 UI 或 API 封装时运行 `cmd /c npm.cmd run check:content-upload-ui`。
- 同时涉及资料上传和生成上下文时运行 `cmd /c npm.cmd run check:teaching-content`。
- 修改中文资料规则或文案时运行 `cmd /c npm.cmd run check:encoding`。
