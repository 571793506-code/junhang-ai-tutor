# CLI 与服务重连清单

## 当前状态

- `node`：已安装。
- `npm` / `npx`：已安装。
- `git`：已安装。
- `gh`：已安装，版本可通过 `gh --version` 查看。
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
MINIMAX_TEXT_MODEL=MiniMax-M3
```

## GitHub

当前状态：

- GitHub CLI 已登录 `github.com`，当前账号为 `571793506-code`。
- Git 操作协议为 SSH。
- Git 远端为 `git@github.com:571793506-code/junhang-ai-tutor.git`。
- 远端默认分支为 `main`。
- `ssh -T git@github.com` 已返回认证成功。
- `git fetch origin` 已验证可用。

复查命令：

```bash
gh auth status --hostname github.com
gh repo view 571793506-code/junhang-ai-tutor --json name,owner,url,defaultBranchRef
ssh -T git@github.com
git ls-remote --heads origin
git fetch origin
```

注意：

- GitHub token 不写入项目文件；`gh` 登录态由系统凭据管理器保存。
- `GITHUB_TOKEN` 只用于非交互式自动化或 CI 场景，并且必须通过本地 `.env`、系统环境变量或密钥管理服务注入，不能提交到 Git。
