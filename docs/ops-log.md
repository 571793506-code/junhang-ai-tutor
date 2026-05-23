# 操作记录

## 2026-05-21

- 新仓库确认从空目录开始，仅保留 `.git`。
- 参考目录 `D:\君航AI助教` 可读取，包含旧学生档案、批改记录、教材库和历史数据。
- 尝试读取 Node/飞书/机器人相关进程命令行，但系统返回权限不足；申请升级权限未得到有效返回，因此没有停止任何进程。
- 通过普通进程列表确认：当前可见相关进程为飞书桌面客户端和 Codex 自身 `node_repl`，未发现明确旧机器人、localtunnel 或项目 Node 服务，因此没有停止进程。
- 检查本机命令：可用 `node`、`npm`、`npx`、`git`；当时未发现 `gh`、`lark-cli`、`deepseek`、`minimax`。
- 审计旧目录关键词，确认旧系统曾使用飞书长连接、飞书云文档、DeepSeek 出题、MiniMax TTS、PDF 试卷生成和学生档案生成。
- 尝试执行 `npx lark-cli doctor`，普通沙箱 30 秒超时；随后两次申请升级权限检查/拉取飞书 CLI，但权限审核未返回结果，因此飞书 CLI 尚未重连。
- 用户提供 MiniMax 与 DeepSeek API Key，要求重新接入；密钥只允许进入本地 `.env`，不得写入文档或提交。
- 安装 `@larksuite/cli@1.0.36` 作为项目开发依赖，移除旧 `lark-cli` 与存在 axios 审计问题的飞书 Node SDK；`npm audit --audit-level=high` 通过。
- `npx lark-cli doctor` 通过，飞书开放平台和 MCP 端点可达；当前 bot identity 可用，user identity 因旧 refresh token 过期需要重新登录。
- DeepSeek 健康检查通过，返回可用模型 `deepseek-v4-flash`、`deepseek-v4-pro`。
- MiniMax 使用国际站地址时认证失败，改用中国区 `https://api.minimaxi.com/v1` 后认证通过，但返回余额不足，需要充值或开通额度。
- 飞书 device flow 授权成功，当前 CLI 的 bot identity 与 user identity 均 ready，用户 token 有效。
- 检查 GitHub SSH：本机 `id_ed25519.pub` 指纹与用户提供的 `SHA256:...` 一致，但 `ssh -T git@github.com` 返回 publickey denied，说明该公钥尚未添加到目标 GitHub 账号或账号未授权。

## 2026-05-23

- 用户提供新的 MiniMax API Key，已替换到本地 `.env`。
- 本地 `npm run check:ai` 在沙箱内返回 `fetch failed`；两次申请联网健康检查未获得有效审批结果，因此新 MiniMax Key 尚未完成在线验证。
- 使用已批准的 Node 执行前缀重新运行健康检查：DeepSeek 通过；MiniMax 已连到中国区接口并完成认证阶段，但返回 `429 insufficient balance (1008)`，说明新 Key 可被接口识别，当前仍受账户余额/额度限制。
- 用户再次提供新的 MiniMax API Key，已替换到本地 `.env`。健康检查显示接口可识别该 Key，但返回 `429 usage limit exceeded`，提示 `Token Plan Max` 的 5 小时额度达到限制，预计 2026-05-23 15:00:00 +08:00 重置。
- 安装 GitHub CLI 到本机，但 `gh auth login` 因 GitHub API 连接超时未完成。
- 原有 `id_ed25519` 公钥被 GitHub 添加为身份验证密钥，不能用于 Git over SSH 认证；随后生成专用 GitHub 认证 key `id_ed25519_github_codex` 并添加到 GitHub。
- 写入 `~/.ssh/config`，为 `github.com` 指定 `id_ed25519_github_codex`。`ssh -T git@github.com` 已返回认证成功。
- 用户提供新的飞书 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，已写入本地 `.env`；新增 `scripts/check-feishu-app.mjs` 用于验证应用凭证，不输出密钥或 token。
- 飞书应用凭证健康检查通过，已成功获取 tenant access token，有效期 7200 秒。
