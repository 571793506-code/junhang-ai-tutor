# Prompt Engineering 和 Context Engineering 使用手册

本文用于统一君航 AI 助教的提示词、上下文组装、模型修复和教师复核流程。目标不是让模型“多写一点”，而是让它在正确的教学场景里，更快生成可审核、可入库、可排版、可追踪的结果。

## 1. 核心概念

### 1.1 Prompt engineering 负责“怎么说”

每一次模型调用都必须明确：

- 角色：小学三到六年级课后辅导、教研出题、作业批改、学情分析等。
- 任务：问答、今日任务、小测、练习、试卷、批改、档案反馈。
- 输出格式：需要 JSON 的场景必须只返回 JSON，不混入解释性文本。
- 约束：题型、页数、学科结构、是否听力、是否附加题、是否需要图形。
- 审核边界：学生问答通过服务层安全和结构处理后即时返回；生成、批改、档案和正式导出仍是草稿或待确认结果，必须按任务进入教师复核。

### 1.2 Context engineering 负责“给它看什么”

服务端在调用模型前，应组装上下文包，而不是只转发教师的一句话。上下文包建议包含：

- 教师原始要求。
- 年级、学科、班级或学生范围。
- 教材版本、章节、知识点、教师确认的重点。
- 近期错题、薄弱点、任务历史、批改记录。
- 输出目标：A4 页数、题型结构、是否需要答案解析 PDF。
- 产品边界：学生/家长端不暴露供应商、模型名和内部链路。
- 修复标准：题量、解析、答案、图形、JSON schema、排版友好性。

模型返回必须由后端执行 parse、normalize、validate、repair、安全检查和角色过滤。学生问答只有通过这些处理才可即时返回；生成、批改、档案和正式导出继续按草稿与教师确认流程处理。任何不完整内容都不能直接进入学生端、家长端或 PDF。

## 2. 统一上下文包

建议所有生成类 API 先构造 `generationContext`：

```json
{
  "request": {
    "requestId": "client-or-server-id",
    "intent": "assessment-draft | task-draft | student-qa | grading | profile-draft",
    "teacherRequirement": "老师输入的自然语言要求",
    "createdByTeacherId": "teacher-id"
  },
  "target": {
    "scope": "student | class | grade",
    "studentId": null,
    "studentName": null,
    "grade": "五年级",
    "className": "五年级一班",
    "subject": "数学"
  },
  "teaching": {
    "textbook": {
      "assetId": "textbook-id",
      "title": "人教版五年级上册数学",
      "chapterId": "chapter-id",
      "chapterTitle": "小数乘法"
    },
    "contentContext": {
      "documents": [],
      "knowledgePoints": []
    },
    "knowledgePoints": ["小数乘整数", "积的小数位数"],
    "teacherFocus": ["列竖式时小数点位置", "估算检查结果"]
  },
  "studentSignals": {
    "recentMistakes": [],
    "recentTasks": [],
    "profileSummary": "计算过程基本完整，但审题和单位判断不稳定"
  },
  "output": {
    "paper": "A4",
    "kind": "小测",
    "pages": 2,
    "includeAnswerAnalysis": true,
    "teacherReviewRequired": true,
    "studentVisibleProviderLabel": "AI生成"
  },
  "rules": {
    "noDefaultBonusQuestions": true,
    "repairRequired": true,
    "hideProviderFromStudentAndParent": true
  }
}
```

## 3. 模型提示词模板

用于试卷、小测、练习生成：

```text
你是君航 AI 助教的教学内容生成与修复助手，服务对象是小学三到六年级课后辅导场景。

你必须遵守：
1. 教师要求优先，但不得破坏学科结构、年级适配、A4 排版和教师复核流程。
2. 学生/家长可见内容只能显示“AI生成”或可用状态，不得出现供应商、模型名或内部链路。
3. 试卷、小测、练习必须包含答案、解析步骤、知识点、常见错误。
4. 如果题干出现“如图”“图中”等需要图形的表达，必须提供 figure 元数据，不得只写文字占位。
5. 不得默认生成附加题、拔高题、竞赛题，除非教师明确要求。
6. 只输出请求指定的 JSON，不要输出 JSON 之外的解释。
```

生成结构必须先按 `kind` 分流，不能把同一套试卷模板缩放给小测和练习：

- 小测：围绕教材单元、章节或当周目标，默认 2 页 A4、60 分，题量短而集中。英语小测默认使用中英文互译、写单词、造句、少量选择题和阅读；不得默认使用文章选词填空、完形填空、短文语法填空或写作。中译英、根据中文写英文单词或短语、造句和中译英句子补全必须用题干在上、英语四线格在下的上下结构作答，不得用普通横线替代。
- 练习：围绕学生近期错题、薄弱点或教师指定补弱目标，默认 2 页 A4、60 分。英语练习默认使用词汇巩固、句型表达、易错选择和阅读巩固；涉及写英文的填空、短语、造句和句子补全必须使用英语四线格；语文练习不得出现作文题；数学练习要优先保障计算题、解答题作答空间。
- 试卷：面向单元考、月考、期中、期末、小升初或综合测评，默认 4 页 A4、100 分。英语试卷才默认使用文章选词填空、短文语法填空或完形填空、正式阅读和写作。

生成类内部链路默认使用 GPT-5.6，但模型只负责按服务层蓝图生成当前分区，不重新规划整套小测、练习或试卷。小测和练习使用 2 个项目分区并行生成，试卷使用 4 个项目分区、最多 2 路并发；失败分区最多重试一次。服务层合并后继续执行 parse、normalize、validate、repair 和本地审查。部分分区失败或使用动态修复时，`generationPipeline.audit.status` 必须为 `needs_teacher_review`。默认草稿不等待深度模型审查；显式开启时正常路径只调用一次 GPT-5.6 风险审查。MiniMax 只保留视觉 OCR 和语音，DeepSeek 只作为受控紧急回滚候选。

默认总预算为：小测 120 秒 / 16000 tokens，练习 150 秒 / 16000 tokens，试卷和个性化练习 240 秒 / 24000 tokens。timeout 与 token 必须分开控制，分区请求共享同一个总预算；小测/练习的 2 个紧凑分区单区最多 8000 tokens，试卷的 4 个分区按默认预算各 6000 tokens。

### 3.1 学生问答的单次调用契约

- 每次学生/课堂问答最多执行一次 `gpt-5.6-terra` 低推理文本调用；Terra 不可用时调用数为 0，且问答绝不调用 Sol，也不在失败后串接第三个文本模型。实际调用成功时，由同一次调用输出严格 JSON `studentAnswer + learningSignal`。
- 安全、结构有效且可用的 `studentAnswer` 经服务层白名单过滤后立即返回，不等待教师逐条预审。
- 模型在 `learningSignal` 中输出结构化 `safetyStatus`；服务端校验和规范化该信号，并根据会话计算最终 actor、身份确认、可用性、结构完整性和 `profileEligibility`。客户端和模型都不能决定最终准入；只有精确符合 `schemaVersion=qa-learning-signal-v1` 的合格学生或已确认课堂记录进入档案辅助分析。
- 教师测试、匿名或身份未确认课堂、不可用、不安全、结构异常、日期无效和 legacy 记录不得进入公开证据，只能以最小原因摘要进入教师侧 `blockedEvidence`。
- 学习者响应不得包含 `learningSignal`、供应商、模型、路由、raw、prompt、debug、准入或阻断元数据；课堂语音响应只能额外包含白名单 `transcript` 和 `voice` 状态。
- 单条来源问答不能提高掌握度、分数或形成强结论；同知识点重复信号可形成 `supported` 但仍是辅助证据。教师确认的批改、错题、任务或课堂证据优先，冲突只生成教师复核备注。
- 周/月档案、期中/期末报告、家长摘要和正式打印/PDF 仍须教师确认。

### 3.2 Terra 到 Sol 的受控升级

- Terra 默认档位遵循项目类型：小测、普通练习和个性化练习为 `medium`，正式试卷、参考答案和主批改为 `high`。
- 只允许两类触发：超时、524、短时限流、网络中断等可恢复 availability 故障；以及结构缺失、答案或解析缺失、批改冲突、证据充分但低置信等明确 quality 故障。
- configuration 故障（配置、鉴权、模型或参数不支持）不得升级；evidence 故障（资料上下文、OCR、题干、作答或参考证据不足）不得调用 Sol，直接标记教师复核。
- 生成按最小失败分区、批改按最小失败题升级，每个单元最多一次 `gpt-5.6-sol/high`。只有 Terra 完全没有可用生成分区时才整项重做。
- 正常批改先完成一次 Terra 主批改/风险复判；只有已分类为可恢复 availability 或证据充分的 quality 故障时，才允许对最小失败题追加一次 Sol。这里的“一次风险复判”不包含条件式 Sol 升级，也不允许 Sol 后再串接第三个文本模型。
- 局部生成升级使用独立 180 秒预算，token 继承原分区；局部参考答案和批改使用 180 秒 / 12000 tokens；整项生成重做继承小测 120 秒、普通练习 150 秒、试卷或个性化练习 240 秒的场景预算。
- Sol 成功时内部记录 `usedModelEscalation=true`，不得误记为 `usedDynamicFallback=true`。强制 Sol 质量命令以 Sol 作为主调用，因此不要求 `usedModelEscalation=true`。
- Sol 后不自动串接 DeepSeek 或第三个文本模型。Sol 输出仍须经过 parse、normalize、validate、repair、项目审查和教师复核；模型、档位、触发原因、预算和升级元数据不得进入学生、家长、课堂平板或公共屏。
- `check:generation:quality:sol` 使用六个项目样本证明强制 Sol 主调用的 availability 和合成生成质量门禁，不证明批改正确率；批改准确率只能通过教师确认的 gold 数据评估。

用于 `POST /api/assessments/draft` 的任务提示：

```text
请根据 generationContext 生成一份小学 {grade} {subject} {kind} 草稿。

输出必须是严格 JSON：
{
  "title": string,
  "layout": {
    "paper": "A4",
    "pages": number,
    "columns": number,
    "headerFields": string[],
    "answerSpacePolicy": string
  },
  "sections": [
    {
      "title": string,
      "type": "fill | choice | calculation | solution | reading | writing | listening | mixed",
      "items": [
        {
          "itemType": string,
          "prompt": string,
          "options": string[],
          "answer": string,
          "analysisSteps": string[],
          "commonMistake": string,
          "knowledgePoint": string,
          "score": number,
          "answerSpaceMm": number,
          "figure": null
        }
      ]
    }
  ],
  "printNotes": string[]
}
```

## 4. 服务端修复规则

生成结果进入持久化、导出或展示前至少检查：

- JSON 是否有效。
- 题目数量是否满足小测 2 页、练习 2 页、试卷 4 页的默认页数。
- 是否包含答案、解析步骤、考点、易错点。
- 是否缺少图形元数据。
- 是否暴露模型、供应商、API 地址或内部调试字段。
- 是否有乱码。
- 小测、练习、试卷是否使用了对应结构；例如英语小测/练习中不得默认出现文章选词填空、完形填空、短文语法填空或写作。
- 数学计算题和解答题是否有足够白色作答空间，图形题是否带 figure 元数据。
- 语文看拼音写词语是否带黑色标准田字格元数据，阅读材料是否有完整上下文和足够长度。

修复层只允许补齐结构、标准化字段、剔除内部信息、补充必要解析。涉及教学判断不确定时，必须标记为教师复核。

正式题目 PDF 与解析 PDF 导出前必须满足：

- 已生成 PDF 草稿供教师审查。
- `generationPipeline.gates.teacherReviewStatus=accepted`。
- 学生卷和解析卷分离；解析卷必须包含答案、步骤、考点和易错提醒。
- 如果模型审查指出会影响打印、作答或家长信任的问题，必须重新生成草稿或由教师修改确认后再导出。
