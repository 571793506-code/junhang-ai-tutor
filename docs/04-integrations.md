# 外部服务接入计划

## 接入原则

- API Key 只放在 `.env` 或密钥管理服务。
- 每次模型调用写入 `model_runs`，记录用途、状态、耗时和成本。
- 外部服务失败时要有降级提示，不让学生卡在空白页面。
- 飞书通知与机器人消息必须可开关，避免重复轰炸群聊。

## 飞书

用途：

- 老师/家长通知。
- 作业、报告、批改摘要推送。
- 多维表格作为早期运营台账或备份视图。

待确认：

- 新应用的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`。
- 是否继续使用群机器人 webhook。
- 是否需要多维表格同步，还是数据库为主、飞书只做通知。

## DeepSeek

用途：

- 学科讲解。
- 题目生成。
- 批改分析。
- 学生档案总结。

待确认：

- `DEEPSEEK_API_KEY`。
- 使用模型、限额、并发和成本预算。

## MiniMax

用途：

- 英语口语对话。
- 语音合成/识别。
- 虚拟人物对话。
- 后续视频或多媒体生成。

待确认：

- `MINIMAX_API_KEY`、`MINIMAX_GROUP_ID`。
- 虚拟人物和语音能力的具体接口。

## GitHub

用途：

- 代码托管。
- 分支管理。
- PR 审查。
- 版本发布记录。

当前连接：

- Git 远端：`git@github.com:571793506-code/junhang-ai-tutor.git`。
- 仓库地址：`https://github.com/571793506-code/junhang-ai-tutor`。
- 默认分支：`main`。
- GitHub CLI：已安装并通过 `gh auth status --hostname github.com` 验证，当前账号为 `571793506-code`。
- Git 操作协议：SSH。
- GitHub token 不写入项目文件；`gh` 登录态由系统凭据管理器保存。只有自动化环境确实需要时，才通过环境变量注入 `GITHUB_TOKEN`。
