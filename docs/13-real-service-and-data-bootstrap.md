# 底层数据与真实服务启动说明

## 当前落地范围

第一阶段把 Web 演示背后的底层能力拆成三层：

- `@junhang/db`：Prisma Client、登录专属码、学生/教师/课堂平板/任务/批改/模型调用记录的读写入口。
- `@junhang/ai`：DeepSeek 文本问答、任务草稿、试卷练习草稿、批改草稿；MiniMax 文本与异步语音任务入口。
- `@junhang/services`：应用服务层。Web、小程序、课堂平板以后都从这里调用，不直接把 AI 与数据库流程写在页面里。

## 本地数据库启动

`.env.example` 已给出本地 PostgreSQL 默认值：

```bash
DATABASE_URL=postgresql://junhang:junhang@localhost:5432/junhang_ai_tutor
```

启动本地库：

```bash
npm run db:up
```

迁移和生成 Prisma Client：

```bash
npm run db:migrate
npm run db:generate
```

写入演示学生、老师、课堂平板、任务、试卷批改和学习档案：

```bash
npm run db:seed
```

当前 Windows 本机已通过 `winget` 安装 PostgreSQL 16：

- 服务名：`postgresql-x64-16`
- 管理员用户：`postgres`
- 应用用户：`junhang`
- 应用数据库：`junhang_ai_tutor`

常用检查命令：

```bash
npm run check:api
```

## 真实 AI 服务

DeepSeek 已作为文本主服务：

- 学生/课堂 AI 问答：`answerStudentQuestionService`
- 教师今日任务草稿：`draftTeacherTaskService`
- 试卷、小测、练习生成草稿：`draftAssessmentService`
- 作业、试卷、小测、听写批改草稿：`gradeSubmissionService`

MiniMax 已作为语音服务预留并接入异步 TTS 任务：

- 听写播报计划：`dictationSpeechService`
- 真实语音任务创建：`createMiniMaxSpeechTask`

服务层烟测：

```bash
npm run check:services
```

当前 live smoke test 结果：

- DeepSeek 文本请求成功。
- MiniMax 配置与余额状态为 ready，但本次实测返回 429 usage limit，提示 2026-05-25 20:00:00+08:00 后重置。代码不会把它当成页面流程错误，而是返回明确的 provider error，教师端可显示给内部使用者。

## 数据关系要点

- `Student` 只保存学生档案与学习归档，不因退课删除。
- `StudentAccessCode` 保存 hash 和 preview。退课时禁用 code，并保留学生历史数据。
- `TeacherStudentAssignment` 记录学生与负责老师绑定，后续推广时可用老师码、机构码或校区码继续扩展。
- `ClassroomDevice` 代表每个年级桌上的平板，接收任务、听写、课文跟读和课堂问答。
- `ModelRun` 记录每次 AI 调用，并能关联 `QaSession`、`VoiceInteraction`、`GradingResult`。
- `Submission` 与 `GradingResult` 共享生成/批改数据，图片上传、OCR 文本和批改结果都落到同一条批改链路。

## 下一步接 Web/API

HTTP 服务已新增在 `apps/api`，接口契约见 `docs/14-api-contract.md`。

- `POST /api/students`：教师端登记学生，生成六位专属码。
- `POST /api/student-login`：姓名、家长电话、学生码校验。
- `POST /api/teacher/tasks`：教师生成并发布今日任务。
- `POST /api/ai/qa`：学生端/课堂平板问答并归档。
- `POST /api/submissions/grade`：上传图片 OCR 后批改，并写入错题和档案。
- `POST /api/classroom/dictation`：教师端发布听写，MiniMax 生成语音任务。
