# Phase 1 启动模式与导入计划

## 启动模式

当前仓库采用 `web-phase1-demo`：

- Web 端先验证学生主页、今日任务、AI 问答、英语词汇助手。
- DeepSeek 作为第一阶段文本提供商，承接答疑、词汇解释、任务草稿、档案草稿。
- MiniMax 作为语音和化身提供商，当前已恢复可用。
- 小程序端暂不重写业务流，后续把 Web 的四个页面迁移成小程序 tab / page。
- Web 端按登录身份分流：学生/家长端只看学习内容和完成情况；教师端负责终端控制、任务生成、导入计划和服务状态。
- 教师端新增 `学生与权限`，由老师登记学生信息并生成六位学生专属码；学生码自动绑定登记老师，学生端/小程序后续必须通过学生姓名、家长电话和专属码校验。
- 新增 `课堂平板端` 作为第三端：设备绑定到年级/班级和负责老师，只接收教师端发布的课堂任务、听写/默写播报、课文跟读和课堂语音问答，不开放学生完整档案。

代码入口：

- 启动模式和 Demo 数据：`packages/core/src/`
- AI 提供商路由：`packages/ai/src/`
- Web MVP：`apps/web/src/main.tsx`
- 启动报告：`npm run startup:report`
- AI 状态检查：`npm run check:ai`

MiniMax 已恢复后只改运行状态，不改应用流程：

```env
MINIMAX_BALANCE_STATUS=restored
```

如需真实请求 DeepSeek / MiniMax，临时开启：

```bash
AI_SMOKE_TEST=1 npm run check:ai
```

## Codex 后端参与方式

Codex 在第一阶段承担服务层和后端编排角色，不直接替代老师做最终教学判断。后端侧负责把教师端输入、学生/家长端提交、AI 识别/批改草稿和最终确认结果串成可追踪记录：

- 任务生成：老师选择学生、学科和任务内容，Codex/AI 只在旁边提供建议，最终生成由老师触发。
- 学生权限：老师登记学生时生成学生专属码，写入 `StudentAccessCode` 并绑定 `createdByTeacherId`；学生退课时停用或删除当前码，但保留 Student、MistakeRecord、Submission 和 StudentReport 历史档案。
- 试卷/小测/练习生成：支持 `单个学生` 或 `整个年级` 的生成范围；年级生成只作为共用模板，后续提交和批改仍要落到具体学生。
- 批改写入：批改必须绑定 `studentId`，再写入 Submission、GradingResult、MistakeRecord 和 BehaviorEvent，避免完成情况和错题归档混到年级模板里。
- 课堂平板端：平板先绑定 ClassroomDevice，教师可按年级/班级解锁平板；未解锁时只显示本桌学生任务和求助状态。学生课堂问答前先语音报姓名，再点头像完成临时身份解锁，VoiceInteraction / ClassroomQaSession 归档到具体学生。
- 档案分析：只基于已经绑定学生的任务、提交、批改、更正记录和学习日志生成周/月/期中/期末反馈。

## 视觉方向

Web 和后续小程序共用“温和教务系统 + 适度未来感”的视觉语言，但按登录身份区分强度：

- 学生/家长端：浅色学习报告风格，使用温和桌面学习背景、白色半透明面板和低噪音青绿色状态色，减少后台感。
- 教师端：蓝色未来控制台风格，使用蓝色科技教务背景、深蓝侧栏和更明确的主控按钮，突出教师工作台和服务状态。
- 两端共用 8px 圆角、清晰状态色、稳定表单控件和同一信息层级，便于后续迁移到小程序。

## 提供商能力矩阵

| 能力 | 当前提供商 | 状态 | 应用入口 | 后续扩展 |
| --- | --- | --- | --- | --- |
| AI 问答 | DeepSeek | 可用 | AI 问答 | 加上下文检索和错题证据 |
| 英语词汇文本解释 | DeepSeek | 可用 | 英语词汇助手 | 接入教材词表和历史掌握度 |
| 今日任务草稿 | DeepSeek | 可用 | 今日任务 | 接入任务推荐和老师审核 |
| 学生档案草稿 | DeepSeek | 可用 | 学生主页 | 接入日/周/月报告生成 |
| 词汇发音/跟读 | MiniMax | 可用 | 英语词汇助手 | 仍保留降级入口 |
| 口语对话 | MiniMax | 可用 | 英语词汇助手 | 可继续扩展语音轮次 |
| 课堂语音输入 | MiniMax / 可替换 ASR | 可用占位 | 课堂平板端 | 接入真实录音、转写和身份确认 |
| 课堂语音播报 | MiniMax | 可用占位 | 课堂平板端 | 接入任务播报、听写间隔、课文跟读和重复播放 |
| 虚拟人物讲解 | MiniMax | 可用 | 教学实验室 | 后续独立开发，不进入 Web MVP 和小程序第一版 |

## 拟议实体

| 实体 | 关键字段 | 关系 |
| --- | --- | --- |
| Student | `displayName`, `grade`, `school`, `textbookVersion`, `enrollmentStatus`, `notes` | 绑定 Guardian、TeacherStudentAssignment、StudentAccessCode、Class、LearningTask、TaskAttempt、MistakeRecord、BehaviorEvent、StudentProfile、StudentReport |
| Guardian | `name`, `phone`, `email`, `openId` | 通过 StudentGuardian 绑定学生；学生端登录时和 StudentAccessCode 一起校验 |
| Teacher | `name`, `phone`, `email`, `openId`, `role`, `status` | 通过 TeacherAccessCode 开通教师端；通过 TeacherStudentAssignment 绑定学生，可创建 LearningTask |
| StudentAccessCode | `studentId`, `codeHash`, `status`, `createdByTeacherId`, `disabledAt` | 由登记老师生成，绑定 Student、Teacher、LoginBinding；退课停用码但保留学生档案 |
| TeacherAccessCode | `teacherId`, `codeHash`, `roleScope`, `status` | 由终端控制开通教师端，防止未授权老师进入 |
| TeacherStudentAssignment | `teacherId`, `studentId`, `source`, `activeFrom`, `activeTo` | 记录学生由哪位老师登记、负责和后续交接 |
| ClassroomDevice | `label`, `bindingCode`, `grade`, `className`, `teacherId`, `status` | 公共平板绑定年级/班级和老师，连接 TaskBroadcast、DictationTask、VoiceInteraction |
| TaskBroadcast | `deviceId`, `teacherId`, `subject`, `title`, `voiceText`, `status` | 教师端发布到课堂平板端，播报后写入 BehaviorEvent |
| DictationTask / DictationItem | `deviceId`, `subject`, `title`, `items`, `difficulty`, `repeats`, `intervalSeconds`, `status` | 英语单词、语文词语和成语听写播报；听写中平板锁定且不显示词表，完成后自动解锁并展示列表，后续连接 Submission、GradingResult、MistakeRecord |
| VoiceInteraction / ClassroomQaSession | `deviceId`, `studentId`, `transcript`, `answerSummary`, `mode`, `occurredAt` | 课堂平板端语音问答记录；系统根据问题自动判断知识讲解或思路引导，学生不能手动选择直接回答 |
| ReadingTask | `deviceId`, `subject`, `title`, `passage`, `focusItems`, `supportNote`, `status` | 教师端选择语文/英语课文或教材片段，标注难字、新词和理解提示，课堂平板端协助学生跟读和预习理解 |
| Class | `name`, `term` | 通过 ClassStudent / ClassTeacher 连接学生和老师 |
| Subject | `code`, `name` | 拥有 KnowledgePoint、Assignment、LearningTask |
| KnowledgePoint | `subjectId`, `parentId`, `code`, `name`, `grade`, `metadata` | 形成知识点树，连接 MistakeRecord |
| TextbookAsset | `subject`, `edition`, `grade`, `volume`, `title`, `source`, `path`, `hash`, `metadata` | 后续连接章节、知识点和素材索引 |
| LearningTask | `studentId`, `teacherId`, `subjectId`, `title`, `status`, `dueAt`, `metadata` | 由老师或 AI 生成，拥有 TaskAttempt |
| TaskAttempt | `taskId`, `studentId`, `startedAt`, `completedAt`, `score`, `result` | 记录任务完成过程 |
| QaSession | `studentId`, `subject`, `question`, `answer`, `metadata` | 连接学生和模型运行摘要 |
| VocabularyRecord | `studentId`, `term`, `content` | 存词汇解释、造句反馈和掌握状态 |
| Assignment / Submission / GradingResult | 题目、提交、分数、批改结果、`needsReview` | 练习、小测、试卷生成与批改闭环 |
| CorrectionRecord / MistakeRecord | `studentId`, `subject`, `prompt`, `studentAnswer`, `correctAnswer`, `cause` | 旧系统更正记录导入到错题和批改结果 |
| BehaviorEvent | `studentId`, `actorType`, `feature`, `action`, `occurredAt`, `durationSeconds`, `metadata` | 形成学习日志和报告证据 |
| StudentProfile / StudentReport | `snapshot`, `type`, `periodKey`, `content`, `metadata` | 日/周/月/期中/期末档案 |
| ModelRun | `provider`, `model`, `skill`, `inputSummary`, `outputSummary`, `status`, `latencyMs`, `costEstimate` | 每次 AI 调用的可审计记录 |
| GeneratedAsset | `kind`, `title`, `path`, `url`, `metadata` | PPT、讲义、试卷、音频、3D 资产索引 |

## 导入计划

| 来源 | 目标 | 第一阶段动作 | 校验 |
| --- | --- | --- | --- |
| `D:\君航AI助教\students` 学生档案 | Student、StudentGuardian、TeacherStudentAssignment、StudentAccessCode、ClassStudent、StudentProfile | 建立学生 ID 映射，抽取年级、教材版本、家长绑定、负责老师、档案快照；正式上线时由教师端生成新码，不导入明文旧码 | 同名去重、关键字段非空、快照数量一致、学生码唯一且可停用 |
| `D:\君航AI助教\students` 批改/订正记录 | MistakeRecord、GradingResult、TaskAttempt | 抽取题目、学生答案、正确答案、错因、知识点，低置信度进入复核 | 题目去重、错因覆盖率、待复核可追踪 |
| `D:\君航AI助教\textbooks` 教材 | TextbookAsset、KnowledgePoint | 先建索引和章节元数据，后续再做 OCR、切片、知识点树 | hash 不变、章节索引可回跳、版权边界确认 |
| `D:\君航AI助教\logs` 学习和服务日志 | BehaviorEvent、ModelRun | 按时间、模块、动作、结果拆成事件流和模型运行摘要 | 时间线排序、模块名标准化、失败事件可定位 |

旧目录保持只读参考。正式导入前先生成 staging manifest，人工确认字段、隐私边界和样本质量，再写入数据库。

## Web MVP 页面映射

| Web 页面 | 第一阶段数据 | 小程序迁移方式 |
| --- | --- | --- |
| 学生主页 | Student、StudentProfile、MistakeRecord、BehaviorEvent、TextbookAsset | 小程序首页 + 我的档案 |
| 今日任务 | LearningTask、TaskAttempt、BehaviorEvent | 今日 tab |
| AI 问答 | QaSession、ModelRun、BehaviorEvent | AI 问答 page |
| 英语词汇助手 | VocabularyRecord、ModelRun、BehaviorEvent | 英语词汇 page，语音按钮默认可用 |
| 试卷练习 | Assignment、AssignmentItem、Submission、GradingResult、MistakeRecord | 学生查看练习与批改反馈；教师端分为排版生成、独立拍照上传批改，二者写入同一份共享练习数据 |
| 教师端学生与权限 | Student、Guardian、Teacher、TeacherStudentAssignment、StudentAccessCode、TeacherAccessCode | 小程序不开放自由注册；学生用姓名、家长电话和学生码登录，教师用教师信息和教师码登录 |
| 课堂平板端 | ClassroomDevice、TaskBroadcast、DictationTask、ReadingTask、VoiceInteraction、BehaviorEvent | 作为小程序第三端或平板模式；只显示课堂任务、听写播报、课文跟读和临时问答，不展示完整学生档案 |

教师端批改入口独立于生成入口。生成侧只保留 `练习 / 小测 / 试卷`，用于选择三科、A4 排版模板、难度和特殊要求；生成范围可选 `单个学生` 或 `整个年级`。默认排版规则为小测/练习两页 A4、试卷四页 A4，特殊要求可覆盖页数。批改侧额外提供 `作业批改` 和 `听写批改`，默认写入 `学生 + 学科 + 今日作业/听写批改`，并强制选择具体学生。学生/家长端提供 `提交作答图片` 通道，可提交作业、听写、练习、小测、试卷照片，状态先进入 `已提交`，教师端再批改。上传图片按数组保存到 `Submission.submissionImageNames`，支持 jpg/jpeg/heic/heif，不限制页数；批改结果再绑定 `studentId` 写入个人完成情况、错题和档案分析。

课堂平板端听写规则由教师端控制：基础难度正常语速播报 2 遍、间隔 10 秒；提高难度播报 3 遍、间隔 15 秒；困难难度播报 3 遍、间隔 20 秒。听写期间平板保持课堂主页并锁屏，不展示单词、词语或成语列表；听写完成后自动解锁并跳转到听写结果列表。课堂问答规则由系统判断，常识类、概念类和知识类问题直接讲解；作业题、具体题目、计算/证明/填空类问题只做思路引导。

课堂平板端解锁控制放在教师端 `终端控制` 顶部，老师可按年级/班级选择平板并解锁或锁定。课文跟读由教师端发布：选择语文或英语，输入明天要学的课文/教材片段，标注难字、新词或重点表达，并给出理解辅助；平板端只展示跟读任务、重点项和理解提示，后续接入 MiniMax 语音后用于标准朗读、逐句跟读和重点解释。
