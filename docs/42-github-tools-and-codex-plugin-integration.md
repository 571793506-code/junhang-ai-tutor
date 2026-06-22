# GitHub 工具与 Codex 插件接入方案

本文记录君航 AI 助教对外部 GitHub 工具、Codex skills、插件和模型训练实验的接入方式，供后续对话和开发人员快速接手。

## 1. 已接入能力

### 1.1 markitdown 文件转 Markdown

用途：

- 将老师上传的 Word、PPT、PDF、Excel、HTML、文本、图片等普通教学资料转换为 Markdown。
- 为教材章节索引、知识点抽取、试卷生成上下文、批改答案键和学生档案证据提供统一文本入口。

项目命令：

```bash
cmd /c npm.cmd run content:markdown -- <file-or-directory> --out exports/markdown-ingestion
```

当前安装包：

```text
markitdown 0.1.6
```

注意：

- 不转换、不改写 `.edupdf` 受保护教材文件。
- 转换输出只是上下文素材，不直接作为学生/家长可见最终内容。
- 默认输出到 `exports/markdown-ingestion`，并生成 `manifest.json`。

### 1.2 本地 Codex skill

已创建：

```text
C:\Users\86188\.codex\skills\document-markdown-ingestion
```

用途：

- 当用户要求“把文件转 Markdown”“导入讲义”“把资料变成上下文”“处理老师上传 PDF/Office 文件”时，Codex 应使用项目转换命令。

### 1.3 本地 Codex 插件

已创建：

```text
C:\Users\86188\plugins\junhang-ai-toolkit
```

已写入个人 marketplace：

```text
C:\Users\86188\.agents\plugins\marketplace.json
```

插件包含：

- `junhang-ai-workflow` skill。
- 文件转 Markdown 工作流。
- prompt/context engineering 工作流。
- assessment repair 验收流程。
- imagegen 使用边界。
- model training 实验边界。
- 项目验证命令。

## 2. 推荐使用方式

### 2.1 老师资料导入

```text
老师上传讲义 / 试卷 / PPT / Word / 普通 PDF
-> markitdown 转 Markdown
-> scripts/build-content-index.mjs 构建内容索引
-> 写入 generationContext.teaching.contentContext
-> 模型生成草稿
-> 服务层修复
-> 教师复核
```

### 2.2 试卷生成增强

使用 Markdown 和内容索引后，试卷生成不再只依赖老师一句话，而是可以加入：

- 老师上传讲义。
- 教材章节摘要。
- 班级近期错题。
- 题型结构。
- A4 页数。
- 解析 PDF 标准。
- 教师复核状态。

### 2.3 图片生成

`imagegen` 适合：

- UI 背景。
- 单词卡片。
- 课堂活动图。
- 阅读材料插图。
- 教学海报。

不建议用于：

- 精确几何图。
- 考试题目中的可量测图形。
- 需要严格版权来源的教材原图。

精确图形优先使用 SVG、Canvas、几何数据或可审计的题图元数据。

### 2.4 训练模型实验

`train-llm-from-scratch` 只作为研究参考，不直接进入当前生产链路。当前项目优先级是：

1. 先把教学资料、错题、批改结果结构化。
2. 再做小规模评测集和生成质量基线。
3. 只在有足够数据、评测和算力预算后，再考虑训练或微调。

### 2.5 find-skills

`find-skills` 可用于用自然语言发现更多 Codex skills。接入原则：

- 先判断 skill 是否解决真实项目问题。
- 再记录安装位置、触发场景、验证命令。
- 不把未验证 skill 直接放入教学生成链路。

## 3. 验证要求

涉及中文文案、提示词、生成内容或文档后运行：

```bash
cmd /c npm.cmd run check:encoding
```

涉及 API 后运行：

```bash
cmd /c npm.cmd run check --workspace apps/api
```

涉及 Web 后运行：

```bash
cmd /c npm.cmd run typecheck --workspace apps/web
```
