# 小程序开发类 Skill

用于修改、迁移或审查微信小程序页面、路由、API 封装、开发者工具流程和多端复用边界。可参考 `wechat-miniprogram/ai-mode-skills`、CloudBase 小程序开发 skill 和微信官方生态，但只能吸收生成、校验、评测和开发者工具流程，不直接复制外部实现。

## 适用场景

- 新增或修改微信小程序页面、路由、WXML、WXSS、JS、配置和工具函数。
- 把 Web 原型能力迁移到小程序教师端、学生端、课堂平板端或公共屏。
- 检查小程序是否复用 API、服务层和共享数据契约。
- 使用微信开发者工具进行编译、预览、真机或静态检查。

## 核心原则

- 小程序端只负责角色入口、表单采集、状态展示、教师确认和学生/课堂交互。
- 生成、批改、资料上下文、权限判断、教师复核、导出和结构修复必须留在 API、服务层、脚本或共享工具中。
- 不在小程序页面脚本中拼接核心 prompt、临时重建教材索引、直接修复模型输出或绕过教师复核。
- 学生端、家长端、课堂平板端和公共屏不展示模型名、供应商、API 地址、内部 prompt、调试字段或未复核内容。
- 新增页面前先确认接口、请求字段、响应字段、角色权限、失败态和可见字段。

## 当前项目边界

- 微信开发者工具运行目录：优先读取 `JH_MINIAPP_TARGET`，未设置时使用 `%USERPROFILE%\WeChatProjects\miniapp-1`。
- 仓库内可追踪源码目录：`apps/miniprogram`。
- 从仓库恢复或更新运行目录时，使用 `cmd /c npm.cmd run sync:miniapp1`，方向固定为 `apps/miniprogram -> miniapp-1`。
- 在 `miniapp-1` 修改页面、组件、`utils/`、`styles/`、`assets/` 等非配置源码后，先运行 `cmd /c npm.cmd run check:miniprogram-sync` 查看差异；人工确认后再显式运行 `cmd /c npm.cmd run sync:miniprogram-from-miniapp`，方向固定为 `miniapp-1 -> apps/miniprogram`。
- 不要用 `apps/miniprogram` 覆盖 `miniapp-1` 的 `project.config.json`、`project.private.config.json`、`project.miniapp.json`、`app.miniapp.json`。
- 普通验证命令只能检查，不得隐式调用 `sync:miniprogram-from-miniapp` 或 `--write`。

## 外部参考的本地化用法

- `wechat-miniprogram/ai-mode-skills`：参考生成、校验、评测三段流程；落地为本项目的小程序静态契约检查、开发者工具编译检查和页面可见性检查。
- CloudBase 小程序开发 skill：参考 WXML/WXSS、页面配置、路由、云开发和开发者工具流程；不要引入 CloudBase 专属部署假设，除非项目明确采用。
- 微信官方 demo、WeUI、API typings、simulate：作为 API 和组件写法参考；不要把官方 demo 的业务结构直接套进本项目。
- 自动上传、预览、发布类 skill：涉及密钥和发布权限，默认不启用；需要用户明确同意并审查安全边界后再接入。

## 当前项目可参考位置

- `docs/44-miniprogram-migration-runbook.md`：小程序迁移、运行目录、同步和检查规则。
- `docs/14-api-contract.md`：多端 API 契约。
- `apps/miniprogram/utils/api.js`：小程序 API 封装。
- `apps/miniprogram/utils/encodingGuard.js`：小程序乱码守卫。
- `scripts/check-miniprogram-js.mjs`：小程序 JS 静态检查。
- `scripts/check-miniapp1.mjs`：实际微信开发者工具项目目录检查。
- `scripts/sync-miniprogram-to-miniapp.mjs`：仓库与运行目录同步。

## 资料上下文接入规则

- 教师资料上下文页只展示资料索引摘要、资料来源、同步状态和教师复核状态。
- 复用 `GET /api/content/index`、`POST /api/content/markdown-ingestion`、`POST /api/content/index/rebuild` 或知识库同步接口，不在小程序端实现 Markdown 转换、索引构建、`.edupdf` 防护或路径防护。
- `.edupdf` 前端过滤只是体验优化，最终拒绝必须依赖后端。
- 学生端、家长端、课堂平板和公共屏不展示资料索引详情或完整 Markdown chunk。

## 验证

- 检查运行目录是否需要回写仓库时运行 `cmd /c npm.cmd run check:miniprogram-sync`；差异状态会返回非零退出码，但不会写文件。
- 修改小程序源码后运行 `cmd /c npm.cmd run check:miniprogram-js`。
- 修改 `miniapp-1` 运行目录后运行 `cmd.exe /c .\jh.cmd check:miniapp1`。
- 修改中文文案、提示词或可见状态后运行 `cmd /c npm.cmd run check:encoding`。
- 涉及 API、资料上下文、生成、批改或教师复核时，补充运行对应 API 或内容链路检查。
