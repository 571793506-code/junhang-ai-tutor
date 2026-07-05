# Git 可追踪性运行手册

本文用于后续 Codex 对话和开发人员处理当前大量未跟踪文件时保持可审查、可回滚、可交接。

## 原则

- 不使用 `git add .` 一次性纳入全部文件。
- 先分组，再检查，再 stage，再提交。
- 每个提交只覆盖一个清晰主题，例如 API 服务、Web 原型、小程序迁移、内容上下文链路、编码守卫或文档规则。
- 生成物、截图、临时文件、上传文件、PDF 导出样例和本地环境文件默认不纳入。
- 当前工作区已有大量未跟踪文件，后续对话必须先看 `git status --short`，不要把未确认文件当作自己刚生成的内容直接删除或覆盖。

## 建议分组

### 1. 项目规则与文档

适合单独形成一个文档提交：

- `README.md`
- `AGENTS.md`
- `SKILLS.md`
- `docs/11-*.md` 到 `docs/45-*.md`
- `docs/encoding-history-report.md`

提交前运行：

```bat
cmd /c npm.cmd run check:encoding
```

### 2. 项目入口、脚本与依赖

适合单独形成工程入口提交：

- `package.json`
- `package-lock.json`
- `.npmrc`
- `.env.example`
- `.gitignore`
- `jh.cmd`
- `scripts/*.mjs`
- `scripts/*.cmd`
- `scripts/*.ps1`

提交前按改动范围运行：

```bat
cmd /c npm.cmd run check:encoding
cmd /c npm.cmd run check:teaching-content
```

### 3. API、服务层、数据库与共享包

适合按后端能力拆分提交：

- `apps/api/`
- `packages/services/`
- `packages/core/src/`
- `packages/ai/src/`
- `packages/db/src/`
- `packages/db/prisma/`

提交前运行：

```bat
cmd /c npm.cmd run check --workspace apps/api
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:encoding
```

### 4. Web 原型

Web 是联调和自动化测试入口，不是最终交付边界。适合单独形成 Web 原型提交：

- `apps/web/index.html`
- `apps/web/src/`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- `apps/web/package.json`

提交前运行：

```bat
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:encoding
```

### 5. 微信小程序与多端迁移

适合按小程序迁移阶段提交：

- `apps/miniprogram/app.*`
- `apps/miniprogram/pages/`
- `apps/miniprogram/utils/`
- `apps/miniprogram/styles/`
- `apps/miniprogram/assets/`
- `apps/miniprogram/project*.json`
- `apps/miniprogram/sitemap.json`

提交前运行：

```bat
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
```

如果同步到 `C:\Users\86188\WeChatProjects\miniapp-1`，还需按 `docs/44-miniprogram-migration-runbook.md` 执行微信开发者工具相关检查。

### 6. 生成物与资产

默认不要整体纳入：

- `exports/`
- `storage/`
- `apps/api/storage/uploads/`
- 临时截图和运行截图。
- 临时日志。

只在确认用途后选择性纳入：

- 明确作为小程序 UI 资产来源的图片。
- 明确作为项目说明或演示页面的静态预览。

## 当前需要人工确认的文件类型

以下类型不应自动 stage：

- 根目录临时截图，例如 `desktop-web.png`、`mobile-web.png`。
- 疑似误生成文件，例如 `console.log(e.message))`、`{console.error(e.message)`。
- 大体积模型或压缩包，例如 `chi_sim.traineddata`、`eng.traineddata`、`mmx-cli-1.0.15.tgz`，除非确认它们是项目必须离线资产。
- `exports/` 下的运行产物，尤其是 PDF 导出样例。

## 推荐提交顺序

1. 文档与协作规则。
2. 脚本、命令入口和依赖配置。
3. API、服务层、数据库和共享包。
4. Web 原型。
5. 小程序迁移。
6. 经确认需要保留的静态资产。

每一组提交前都应先执行：

```bat
git status --short
```

确认本组文件范围后，再使用显式路径 stage，不使用全量通配。
