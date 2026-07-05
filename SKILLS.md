# 项目 Skills 总入口

本文是君航 AI 助教项目内的 skills 路由表。它们是仓库专属工作规则和模块经验沉淀，不是外部依赖包。后续 Codex 进入本项目时，先读 `AGENTS.md`、`docs/51-project-pitfall-review.md`、`docs/52-workspace-guardian.md`，再按任务类型读取对应模块的 `SKILLS.md`。

## 当前阶段边界

- 已恢复微信小程序继续搭建；小程序改动必须复用 API、服务层和共享契约，不把核心教学逻辑写死在端侧页面中。
- 当前重点是在本仓库内沉淀模块规范和质量边界，不推进外部新项目迁移，也不复制外部新项目实现。
- Web 只作为联调、原型验证和自动化测试入口，不是最终交付边界。
- 生成类和批改类只保留创作草稿、结构化数据、教师复核和流程经验，不继续扩大当前不稳定 PDF 排版、自动审查堆叠、自动批改归档和复杂端侧实现。
- 模型输出不能直接给学生、家长、教师或 PDF；必须结构化、校验、修复，并经过教师复核。

## 模块 Skills

| 模块 | 文件 | 使用场景 |
| --- | --- | --- |
| AI 问答类 | `skills/ai-qa/SKILLS.md` | 教学问答、题目讲解、课堂语音问答 |
| 学生档案类 | `skills/student-profile/SKILLS.md` | 档案草稿、学习记录聚合、阶段反馈 |
| 教材资料类 | `skills/teaching-materials/SKILLS.md` | 资料入库、Markdown 转换、内容索引 |
| 生成类 | `skills/generation/SKILLS.md` | 小测、练习、试卷、任务、讲解 |
| 批改类 | `skills/grading/SKILLS.md` | 图片批改、答案键对齐、教师复核 |
| 小程序开发类 | `skills/miniprogram/SKILLS.md` | 微信小程序页面、路由、API 封装、开发者工具和迁移 |
| 小程序 UI 类 | `skills/miniprogram-ui/SKILLS.md` | 学生端、教师端、课堂平板端的小程序界面设计和组件落地 |

## 全局规则

- 核心逻辑必须沉淀到 API、服务层、脚本、共享工具或数据契约，不能只写在 Web 页面状态里。
- 外部 skills 只作为参考来源；进入项目时必须改写为本仓库模块规则，不直接安装、不照搬、不绕过教师复核和多端可见性边界。
- 学生、家长、课堂平板和公共屏不展示模型名、供应商、API 地址、内部 prompt、密钥、调试字段或未复核内容。
- 教师端可以展示复核状态、服务状态和运维摘要，但不能暴露密钥、数据库连接或完整内部配置。
- 资料、生成、批改、档案和问答进入持久化或对外展示前必须检查乱码、字段完整性、权限可见性和教师复核状态。
- 非数据源码、配置、脚本、文档和项目规则原则上纳入 Git；运行产物、上传资料、缓存、日志、大体积数据和临时文件默认不提交。

## 终端与 Git

- Windows 下优先使用 `cmd /c npm.cmd run ...`、`.\jh.cmd ...` 或短 PowerShell 命令。
- 避免复杂中文、多层引号、管道符和长一行命令；多关键词搜索拆成多条 `rg`。
- 不依赖超长输出；先用 `git diff --stat`、`git diff --name-status`、分文件 diff 和 `rg` 定位。
- 不使用 `git add .`；只 stage 明确路径，并按模块或规则分组提交。
- 修改中文文档、提示词、界面文案或生成规则后运行编码检查。

## 常用验证

```bat
cmd /c npm.cmd run check:encoding
cmd /c npm.cmd run check --workspace apps/api
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:teaching-content
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:miniprogram-js
```

验证命令按改动范围选择，不要为了文档改动启动不相关的大型生成链路。当前已知生成服务完整检查可能因草稿生成超时，不能把单次 `check:services` 失败简单等同于所有模块不可用。
