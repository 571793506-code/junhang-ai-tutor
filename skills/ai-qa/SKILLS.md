# AI 问答类 Skill

用于修改、迁移或复用君航 AI 助教里的教学问答、课堂语音问答、题目讲解和学生提问处理经验。

## 适用场景

- 老师或学生提出学科问题，需要生成适合小学三到六年级的讲解。
- 需要检查问答结果是否暴露模型、供应商、内部接口或调试字段。
- 需要把 Web、小程序或课堂平板问答能力收敛到服务层和共享契约。

## 核心原则

- AI 问答只做讲解、启发和补充说明，不替老师下最终教学判断。
- 学生或课堂端只显示 `AI生成`、讲解正文和必要提示，不显示模型名、供应商、API 地址、内部 prompt 或错误栈。
- 问答上下文要包含年级、学科、学生或班级范围、题目文本、教材章节和已知学习信号；不要只转发一句自由文本。
- 无法可靠回答时要提示教师补充材料或人工确认，不编造来源、教材页码或学生情况。

## 当前项目可参考位置

- `packages/services/src/index.js`：`answerStudentQuestionService` 的服务层封装方式。
- `packages/ai/src/runtime.js`：AI runtime、提示词边界和 provider 可用性处理。
- `apps/api/src/server.js`：`POST /api/ai/qa` 与 `POST /api/classroom/voice-qa` 的接口边界。
- `docs/14-api-contract.md`：多端问答契约与可见字段规则。
- `docs/41-prompt-context-engineering-playbook.md`：上下文工程和输出修复规则。

## 推荐输出形态

老师侧或学生侧问答请求应被整理成结构化输入，例如：

```text
五年级 数学：分数除法为什么要乘倒数？
```

输出建议包含：

- 简短结论；
- 分步骤讲解；
- 适合该年级的例子；
- 常见误区；
- 是否需要老师补充教材或学生情况。

## 禁止项

- 不做学生端沉浸式自由聊天迁移。
- 不把 Web 页面状态作为问答主逻辑。
- 不在普通端展示 DeepSeek、MiniMax、GPT、接口地址、密钥、内部路由或调试字段。
- 不把不确定内容包装成确定结论。

## 验证

- 修改 API 或服务层时运行 `cmd /c npm.cmd run check --workspace apps/api`。
- 修改中文提示词、文案或输出规则时运行 `cmd /c npm.cmd run check:encoding`。
- 涉及多端可见字段时对照 `docs/14-api-contract.md` 检查学生、教师、课堂端字段差异。
