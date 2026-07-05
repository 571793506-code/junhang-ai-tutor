# 小程序导入迁移运行手册

## 多端优先原则

本项目最终交付目标是微信小程序、课堂平板和后续公共屏等多端应用。Web 端只作为前端联调、原型验证和自动化测试入口；任何 Web 已验证能力在进入正式教学工作流前，都必须确认小程序或平板端如何复用同一 API、服务层逻辑和数据契约。

后续迁移时遵守以下规则：

- 不把组卷、资料上下文、复核、导出、AI 问答、课堂互动等核心逻辑复制到小程序页面脚本中。
- 小程序端只负责角色入口、表单采集、状态展示、教师确认和学生/平板交互；业务判断、生成修复、权限边界和导出仍在 API 或服务层完成。
- Web 原型新增功能后，迁移到小程序前必须先确认接口、请求字段、响应字段、可见性规则和失败态。
- 学生/家长端只展示 `AI生成` 或可用状态；教师端可展示审核状态和运维摘要；课堂平板和公共屏只展示课堂必要信息。
- 涉及中文文案、生成内容或导出文件的迁移，必须继续执行编码守卫。

## 小程序 Skills 使用入口

后续小程序开发和 UI 调整先读项目内模块规则，不直接安装社区 skill：

- 小程序页面、路由、API 封装、开发者工具和迁移：`skills/miniprogram/SKILLS.md`。
- 小程序 UI、信息层级、组件库评估和视觉状态：`skills/miniprogram-ui/SKILLS.md`。
- 教材资料、Markdown 转换、内容索引和资料上下文：`skills/teaching-materials/SKILLS.md`。
- 小测、练习、试卷、任务和讲解生成：`skills/generation/SKILLS.md`。

外部参考来源只作为经验输入：`wechat-miniprogram/ai-mode-skills` 用于生成、校验、评测流程；TencentCloudBase `ui-design` 和 Anthropic `frontend-design` 用于视觉设计思路；TDesign Miniprogram Skill 和 `tdesign-miniprogram` 用于组件落地评估；MarkItDown/Docling 用于资料处理候选。所有外部规则进入项目时必须遵守本仓库 API、服务层、教师复核和多端可见性边界。

## 当前迁移状态

本轮开始进入小程序导入准备，不再沿用旧文档中的“只做方案、不修改小程序页面”停止线。当前目标是把 Web/API 原型沉淀为可导入微信开发者工具的第一版小程序结构。

2026-06-05 已完成第一批导入：

- 统一登录入口已改为两阶段交互，可在 `pages/role/index` 选择学生端、教师端、平板端并直接登录。
- 三类兼容登录页已统一到新视觉体系，并移除演示账号入口。
- 学生端首页已迁移为模块化结构，保留今日任务、AI问答、英语词汇、拍照提交、学生档案和低强调互动扩展入口。
- 课堂平板端已迁移为公共屏结构，包含中心学习光环、四周头像确认、插件状态、教师发布内容和解锁后的 AI问答。
- 教师工作台已补展示与平板控制入口、电视动态屏地址复制和平板插件状态。
- 已通过 `.\jh.cmd check:encoding` 和 `.\jh.cmd check:miniprogram-js`。

2026-06-05 已同步微信开发者工具导入：

- 小程序 AppID：`wxfffcd1d4636b8bc7`。
- `apps/miniprogram/project.config.json` 已配置该 AppID。
- 当前微信开发者工具运行项目是 `C:\Users\86188\WeChatProjects\miniapp-1`，该项目是 `multiPlatform` 多端项目。
- 2026-06-05 已按最新要求切换为单一小程序工作项目：后续小程序开发、测试和修复都直接在 `C:\Users\86188\WeChatProjects\miniapp-1` 中进行。
- `apps/miniprogram` 只作为本次源代码转入来源，不再作为后续小程序开发入口。
- 同步时必须保留 `miniapp-1` 自己的 `project.config.json`、`project.private.config.json`、`project.miniapp.json` 和 `app.miniapp.json`，不能用普通导出包覆盖。

### Git 可追踪边界

`C:\Users\86188\WeChatProjects\miniapp-1` 是微信开发者工具的实际运行目录，但当前不是 Git 仓库。后续在 `miniapp-1` 中修改非配置源码后，必须把同路径源码同步回 `apps/miniprogram`，让小程序页面、样式、工具函数和共享文案进入本仓库 Git 管理。

同步规则：

- `miniapp-1` 的 `project.config.json`、`project.private.config.json`、`project.miniapp.json`、`app.miniapp.json` 只保留在运行目录，不从 `apps/miniprogram` 覆盖。
- 页面、组件、`utils/`、`styles/`、`assets/` 等非配置源码改动，完成验证后同步到 `apps/miniprogram` 同路径。
- 如果 `miniapp-1` 与 `apps/miniprogram` 路由不同，先用人工 diff 判断差异来源，不直接全量覆盖。
- 每次同步后至少运行 `cmd.exe /c .\jh.cmd check:miniapp1`、`cmd.exe /c .\jh.cmd check:miniprogram-js` 和 `cmd.exe /c .\jh.cmd check:encoding`。

已收口差异：

- `miniapp-1/utils/api.js` 与 `apps/miniprogram/utils/api.js` 已合并课堂、词汇、学生档案和批改工作台 wrapper。后续新增 wrapper 时仍需两边同步，并由 `check:miniapp1` 守卫。

## 第一轮迁移范围

### 统一入口

- 启动页：`apps/miniprogram/pages/role/index.*`
- 学生登录：`apps/miniprogram/pages/student/login/index.*`
- 教师登录：`apps/miniprogram/pages/teacher/login/index.*`
- 平板登录：`apps/miniprogram/pages/classroom/login/index.*`

登录后不在业务页展示其他身份入口、示例账号或登录说明。

### 学生端

- 首页：今日任务、AI问答、英语词汇、拍照提交、学生档案、互动扩展。
- AI问答只展示“AI生成”和可用状态，不展示模型或供应商。
- 档案页只展示教师复核并发布后的内容。

### 教师端

- 工作台保留学生权限、今日任务、生成类、拍照批改、复核。
- 增加展示与平板控制入口。
- 电视动态屏第一版继续使用 Web 地址，不迁移为小程序页面。

### 课堂平板端

- 进入公共课堂主页。
- 点击头像确认本次互动身份，完整拖拽吸附放到第二轮。
- 平板端 AI问答由学生提问，系统根据问题类型直接回答或引导思路。
- 今日任务、听写播报、课文跟读接收教师端发布内容。

## UI 资产迁移

已落位资产：

- `apps/miniprogram/assets/junhang-ai-avatar-center.png`

来源：

- `exports/miniprogram-migration-assets/junhang-ai-avatar-center.png`

后续 UI 方案迁移时继续参考：

- `exports/ui-theme-preview/theme-preview.html`
- `exports/ui-theme-preview/*.png`
- `exports/scheme-design-preview/index.html`

## API 对接边界

第一轮继续复用现有接口：

- `/api/bootstrap`
- `/api/student-login`
- `/api/teacher-login`
- `/api/classroom/device-login`
- `/api/ai/qa`
- `/api/teacher/tasks`
- `/api/assessments/draft`
- `/api/submissions/batches`
- `/api/submissions/grade`
- `/api/review/submissions`
- `/api/classroom/voice-qa`

资料上传和生成上下文链路继续复用：

- `GET /api/content/index`
- `POST /api/content/markdown-ingestion`
- `POST /api/content/index/rebuild`

小程序端后续可以增加教师资料上传或索引状态页，但只能调用上述接口，不重新实现 Markdown 转换、索引构建、`.edupdf` 防护或路径防护。

## 资料上下文入口待办

2026-06-07 已完成第一版迁移准备：

- `C:\Users\86188\WeChatProjects\miniapp-1\pages\teacher\content\index.*` 已新增教师端“资料上下文”页面。
- 教师工作台已新增“资料上下文”入口。
- 小程序 API 工具已接入 `GET /api/content/index`、`GET /api/knowledge/sources`、`POST /api/knowledge/sources/sync-content-index`、`POST /api/knowledge/sources`、`PATCH /api/knowledge/sources/:sourceId/review`。
- 小程序端只展示资料索引摘要、资料来源、同步和教师复核状态，不展示完整 Markdown chunk，不重新实现 Markdown 转换、索引构建或路径守卫。

后续迁移教师端资料上下文时，优先补以下小程序入口：

1. 教师工作台增加“资料上下文”入口，展示资料索引是否可用、资料数量、科目数量和知识点数量。
2. 资料上下文页调用 `GET /api/content/index`，只展示摘要、最近资料和“已进入生成上下文”状态，不展示完整 Markdown chunk、模型、供应商或内部调试字段。
3. 如微信端文件选择和上传体验可用，再接入 `POST /api/content/markdown-ingestion`；上传后调用 `POST /api/content/index/rebuild` 刷新索引。
4. 小程序前端可以过滤 `.edupdf` 作为体验优化，但最终拒绝必须依赖 API 返回的 `PROTECTED_TEXTBOOK_NOT_ALLOWED`。
5. 资料上下文只服务教师组卷、练习、小测和复核流程；学生端、家长端、课堂平板和公共屏不展示资料索引详情。
6. 迁移完成后运行 `cmd.exe /c .\jh.cmd check:miniapp1`、`cmd.exe /c .\jh.cmd check:encoding`，涉及 API 时补充 `cmd /c npm.cmd run check:teaching-content`。

## 导入微信开发者工具前检查

每次修改 `miniapp-1` 小程序或中文文案后运行：

```bat
cmd.exe /c .\jh.cmd check:miniapp1
cmd.exe /c .\jh.cmd check:encoding
```

涉及 API 或 Web 联调时补充运行：

```bat
cmd.exe /c .\jh.cmd check:api
cmd.exe /c npm.cmd run typecheck --workspace apps/web
```

## 后续迁移顺序

1. 直接在 `C:\Users\86188\WeChatProjects\miniapp-1` 修改小程序源码。
2. 在微信开发者工具打开 `miniapp-1`，不要重新导入普通导出项目。
3. 检查统一入口和三类登录页。
4. 检查学生端五个真实模块和互动扩展入口。
5. 检查教师端展示与平板控制入口。
6. 检查课堂平板公共主页、头像确认、AI问答和任务列表。
7. 再迁移新的 UI 方案和小程序端组件化样式。

## 打开当前多端项目

```bat
cmd.exe /c call "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open --project "C:\Users\86188\WeChatProjects\miniapp-1" --port 51197 --lang zh
```

如果微信开发者工具仍显示旧界面，优先在开发者工具中点击“编译/刷新”。不要改用 `exports/.../wechat-importable-project`，否则会再次形成两个项目。
