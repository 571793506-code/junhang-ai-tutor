# CLI 与服务重连清单

## 当前状态

- `node`：已安装。
- `npm` / `npx`：已安装。
- `git`：已安装。
- `gh`：未发现。
- `lark-cli`：已通过 `@larksuite/cli` 安装到项目开发依赖，版本 `1.0.36`。
- `deepseek`：未发现本地 CLI，第一版优先走 HTTP API。
- `minimax`：未发现本地 CLI，第一版优先走 OpenAI 兼容 HTTP API。
- DeepSeek API Key：已由用户提供，只允许写入本地 `.env`，不得提交到 Git。
- MiniMax API Key：已由用户提供，只允许写入本地 `.env`，不得提交到 Git。

## 飞书

优先方案：

1. 使用新的飞书开放平台应用和新群机器人，不沿用旧项目连接。
2. 获取新的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`。
3. 新群机器人创建后，写入 `FEISHU_BOT_WEBHOOK` 和 `FEISHU_BOT_SIGN_SECRET`。
4. 使用 `npx lark-cli auth login --json --no-wait` 发起重新登录。
5. 业务代码优先走飞书 HTTP API；CLI 用于诊断、配置和必要的运营操作。

需要的 `.env`：

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BOT_WEBHOOK=
FEISHU_BOT_SIGN_SECRET=
```

可用本地检查命令：

```bash
npm run check:feishu
```

## DeepSeek

优先走 HTTP API，不强依赖本地 CLI。

需要的 `.env`：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

可用本地检查命令：

```bash
npm run check:ai
```

## MiniMax

优先走 OpenAI 兼容 HTTP API，不强依赖本地 CLI。当前用户密钥适配中国区基础地址 `https://api.minimaxi.com/v1`。

需要的 `.env`：

```env
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_TEXT_MODEL=MiniMax-M2.7-highspeed
```

## GitHub

当前未发现 `gh`。可以选择：

- 安装 GitHub CLI，然后登录。
- 继续用 Git 命令和远程仓库 URL。
- 安装 Codex 的 GitHub 插件。

待确认：

- 仓库名称。
- 私有或公开。
- 是否由我创建远程仓库。
- 用户提供的 `SHA256:...` 看起来更像 SSH key fingerprint，不是 GitHub API token。若要自动创建仓库、PR 或 issue，还需要 GitHub 登录或 Personal Access Token。
- 已确认本机 `id_ed25519.pub` 指纹与用户提供的 fingerprint 一致。
- 当前 `ssh -T git@github.com` 返回 publickey denied，需要把本机公钥添加到 GitHub 账号后才能通过 SSH 推送。
