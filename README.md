# 君航 AI 助教

这是一个面向课后辅导场景的多端 AI 助教系统，包含 Web 原型、API 服务、微信小程序、课堂平板和后续公共屏能力。

## 多端交付边界

本项目最终交付以微信小程序、课堂平板和后续公共屏为主。Web 端只作为前端联调、原型验证和自动化测试入口，不作为最终功能边界。

新增教学工作流时，核心逻辑应优先沉淀到 API、服务层、脚本、共享工具或明确的数据契约中。Web 已验证能力进入正式教学链路前，需要确认小程序、课堂平板或公共屏如何复用同一接口、权限规则和可见字段。

多端 API 契约见 `docs/14-api-contract.md`，小程序迁移规则见 `docs/44-miniprogram-migration-runbook.md`。

项目踩坑审查与后续防护清单见 `docs/51-project-pitfall-review.md`。继续开发前先按其中“开工前检查”确认范围、风险和验证命令。

当前工作区包含较多未跟踪文件。纳入版本控制前按 `docs/45-git-traceability-runbook.md` 分组检查和提交，不要直接使用 `git add .`。

## Windows 快速命令

PowerShell 下不要直接使用 `npm run ...`。优先使用项目入口：

```powershell
.\jh.cmd check:api
.\jh.cmd dev:api
.\jh.cmd dev
.\jh.cmd check:encoding
```

如果终端中文输出异常：

```powershell
.\scripts\windows-terminal-setup.cmd
```

## 常用启动

```powershell
.\jh.cmd db:up
.\jh.cmd dev:api
.\jh.cmd dev
```

Web 默认地址：

```text
http://127.0.0.1:5173/
```

API 默认地址：

```text
http://127.0.0.1:8787/
```

## 常用检查

```powershell
.\jh.cmd check:encoding
.\jh.cmd check:api
.\jh.cmd check:miniprogram-js
.\jh.cmd check:services
.\jh.cmd check:encoding:history
```

## 目录

- `apps/web/`：Web 原型和教师端/学生端/课堂端模拟界面。
- `apps/api/`：本地 API 服务。
- `apps/miniprogram/`：微信小程序端。
- `packages/core/`：通用领域模型、演示数据和编码守卫。
- `packages/ai/`：AI 服务接入、OCR、演示响应。
- `packages/db/`：Prisma schema、数据库客户端、迁移与 seed。
- `packages/services/`：业务服务层。
- `scripts/`：本地检查、导出、编码扫描、环境包装脚本。
- `docs/`：产品、技术、生成规则、迁移与运维文档。

## 编码防护

项目已接入乱码检查与输入输出守卫。修改中文文案、提示词、API 输出、生成内容或历史导出后，必须运行：

```powershell
.\jh.cmd check:encoding
```

涉及历史导出或备份：

```powershell
.\jh.cmd check:encoding:history
```

更多项目级规则见 `AGENTS.md`。
