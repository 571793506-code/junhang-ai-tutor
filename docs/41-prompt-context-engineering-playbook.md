# Prompt Engineering 和 Context Engineering 使用手册

本文用于统一君航 AI 助教的提示词、上下文组装、模型修复和教师复核流程。目标不是让模型“多写一点”，而是让它在正确的教学场景里，更快生成可审核、可入库、可排版、可追踪的结果。

## 1. 核心概念

### 生成与批改规则同源

生成教学细则读取 `skills/generation/references/runtime-rules.md`，批改读取 `skills/grading/references/runtime-rules.md`；Codex 模块 Playbook 和服务端使用同一正文。`packages/ai/src/teaching-rules.js` 按固定 module 白名单加载 UTF-8 正文、版本和 SHA-256，每次操作重新读取，缺失或格式错误时在模型调用前失败关闭。

规则 root 只允许服务端配置与测试使用，HTTP 输入、上传文件和资料文本不能指定规则路径或替换规则。版本/hash 只属于内部可追踪元数据，不向学生或家长输出正文或内部配置。模型策略及数值预算归 `packages/ai/src/model-policy.js` 管理；Playbook 不复制第二套预算表。规则装配接入状态按 9 月 11 日实施计划记录，规则文件存在不等于所有旧入口已完成迁移。

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
      "edition": "人教版",
      "series": "人教版",
      "volume": "上册",
      "region": "贵州遵义",
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

贵州遵义教材基准为：语文统编版 / 人教体系、数学人教版、英语人教版 PEP。`generationContext.teaching.textbook` 只能由服务端根据真实 `TextbookAsset` 解析，客户端标题、版本、系列、册次和地区不能覆盖服务端记录。带教材或章节的生成请求如果没有真实教材资产和已审批资料证据，必须在模型调用前失败关闭。

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
6. 学生卷的计算题、解答题和图形题只保留空白作答区，不要写“解：”“解题过程：”“答题区：”，也不要放公式、步骤提示或示例答案；这些内容只进入答案解析卷。
7. 只输出请求指定的 JSON，不要输出 JSON 之外的解释。
```

生成结构必须先按 `kind` 分流，不能把同一套试卷模板缩放给小测和练习：

- 小测：围绕教材单元、章节或当周目标，默认 2 页 A4、60 分，题量短而集中。英语小测默认使用中英文互译、写单词、造句、少量选择题和阅读；不得默认使用文章选词填空、完形填空、短文语法填空或写作。中译英、根据中文写英文单词或短语、造句和中译英句子补全必须用题干在上、英语四线格在下的上下结构作答，不得用普通横线替代。
- 练习：围绕学生近期错题、薄弱点或教师指定补弱目标，默认 2 页 A4、60 分。英语练习默认使用词汇巩固、句型表达、易错选择和阅读巩固；涉及写英文的填空、短语、造句和句子补全必须使用英语四线格；语文练习不得出现作文题；数学练习要优先保障计算题、解答题作答空间。
- 试卷：面向单元考、月考、期中、期末、小升初或综合测评，默认 4 页 A4、100 分。英语试卷才默认使用文章选词填空、短文语法填空或完形填空、正式阅读和写作。

生成、参考答案和批改已通过 `teaching-pipeline.js` 接入共享规则与有界执行器。生成按 purpose 选择综合、专项、多日或讲解结构，单元最多两路并发，共享 deadline 和输出 token pool。模型只生成当前分区，服务层合并后继续校验与教师复核。综合草稿的动态修复必须标记 `needs_teacher_review`；专项和讲解不补成综合卷。服务层不再追加模型审查。MiniMax新默认视觉OCR与配置选用的Flash OCR复用受限执行器，按页保留来源、过程和坐标；旧视觉路由仅作显式兼容。DeepSeek辅助调用显式关闭默认思考，MiniMax视觉调用显式使用其支持的低推理档位；具体型号与预算以模型策略为准，不能由客户端覆盖。

默认总预算为：小测 120 秒 / 16000 tokens，练习 150 秒 / 16000 tokens，试卷和个性化练习 240 秒 / 24000 tokens。timeout 与 token 必须分开控制，分区请求共享同一个总预算；小测/练习的 2 个紧凑分区单区最多 8000 tokens，试卷的 4 个分区按默认预算各 6000 tokens。

### 3.1 学生问答的单次调用契约

- 每次学生/课堂问答最多执行一次 `gpt-5.6-terra` 低推理文本调用；Terra 不可用时调用数为 0，且问答绝不调用 Sol，也不在失败后串接第三个文本模型。实际调用成功时，由同一次调用输出严格 JSON `studentAnswer + learningSignal`。
- 安全、结构有效且可用的 `studentAnswer` 经服务层白名单过滤后立即返回，不等待教师逐条预审。
- 模型在 `learningSignal` 中输出结构化 `safetyStatus`；服务端校验和规范化该信号，并根据会话计算最终 actor、身份确认、可用性、结构完整性和 `profileEligibility`。客户端和模型都不能决定最终准入；只有精确符合 `schemaVersion=qa-learning-signal-v1` 的合格学生或已确认课堂记录进入档案辅助分析。
- 教师测试、匿名或身份未确认课堂、不可用、不安全、结构异常、日期无效和 legacy 记录不得进入公开证据，只能以最小原因摘要进入教师侧 `blockedEvidence`。
- 学习者响应不得包含 `learningSignal`、供应商、模型、路由、raw、prompt、debug、准入或阻断元数据；课堂语音响应只能额外包含白名单 `transcript` 和 `voice` 状态。
- 单条来源问答不能提高掌握度、分数或形成强结论；同知识点重复信号可形成 `supported` 但仍是辅助证据。教师确认的批改、错题、任务或课堂证据优先，冲突只生成教师复核备注。
- 周/月档案、期中/期末报告、家长摘要和正式打印/PDF 仍须教师确认。

### 3.2 教学任务的有界调用

- 2026-10-19教师指定生成、参考答案和主观批改由GPT-6.1 Sol高推理承担，取代此前Astra主调用；实际模型、档位和预算读取 `resolveTeachingTaskPolicy`，不在 Playbook 另列数值表。
- 主模型与替补同型号时禁用availability追加调用，主调用使用原操作剩余预算；显式配置不同型号替补时才允许单次接替。结构或内容校验失败仍最多由主模型修复一次，接替与修复共享同一个追加调用名额及原操作预算。
- configuration 故障（配置、鉴权、模型或参数不支持）不得升级；evidence 故障（资料上下文、OCR、题干、作答或参考证据不足）不得追加模型调用，直接标记教师复核。
- 生成按完整分区或每日单元执行，阅读材料与问题保留在同一单元；批改先保守比较客观题，只把未解决题目及其证据发送模型。
- 批改模型输出聚焦逐题状态、分数、得失分证据和必要的关键步骤；不要求模型复制已有的学生答案、标准答案或图片坐标。服务端通过已校验题号回填studentAnswer、可核验参考答案的correctAnswer及原始bbox，保留结构化多空答案、数字0和未知坐标null。来源包未通过投影核验时不把冲突参考当成权威答案回填。score/maxScore仍必须由模型明确输出并校验，低置信、漏题、超界分数和待定项的检查不变；此优化不改变模型、总预算或教师确认要求，也不证明稳定时延或语义评分准确率。
- 正常批改不追加风险复判或深度审查；遗留开关不能绕过执行器上限。不确定分数保持 null，模型顶层总分不能覆盖逐题合计。
- 同一生成操作共享 deadline/token pool，各单元保留独立追加计数；参考答案与随后主观批改也共享操作预算，替补不重新获得一整份时间。
- 只有替补实际成功时内部记录 `usedModelEscalation=true`，不得误记为 `usedDynamicFallback=true`。默认Sol主调用及强制Sol质量命令均不因使用Sol就标记升级。
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
- 学生卷计算题、解答题和图形题是否只保留空白作答区，且没有“解：”“解题过程：”“答题区：”等提示、公式、步骤或示例答案；答案解析卷是否保留完整解析。
- 语文看拼音写词语是否带黑色标准田字格元数据，阅读材料是否有完整上下文和足够长度。

修复层只允许补齐结构、标准化字段、剔除内部信息、补充必要解析。涉及教学判断不确定时，必须标记为教师复核。

正式题目 PDF 与解析 PDF 导出前必须满足：

- 已生成 PDF 草稿供教师审查。
- `generationPipeline.gates.teacherReviewStatus=accepted`。
- 学生卷和解析卷分离；解析卷必须包含答案、步骤、考点和易错提醒。
- 如果模型审查指出会影响打印、作答或家长信任的问题，必须重新生成草稿或由教师修改确认后再导出。
