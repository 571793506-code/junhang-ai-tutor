# Prompt Engineering 和 Context Engineering 使用手册

本文用于统一君航 AI 助教的提示词、上下文组装、模型修复和教师复核流程。目标不是让模型“多写一点”，而是让它在正确的教学场景里，更快生成可审核、可入库、可排版、可追踪的结果。

## 1. 核心概念

### 1.1 Prompt engineering 负责“怎么说”

每一次模型调用都必须明确：

- 角色：小学三到六年级课后辅导、教研出题、作业批改、学情分析等。
- 任务：问答、今日任务、小测、练习、试卷、批改、档案反馈。
- 输出格式：需要 JSON 的场景必须只返回 JSON，不混入解释性文本。
- 约束：题型、页数、学科结构、是否听力、是否附加题、是否需要图形。
- 审核边界：AI 只给草稿，教师确认后才能发布、打印或同步给学生/家长。

### 1.2 Context engineering 负责“给它看什么”

服务端在调用模型前，应组装上下文包，而不是只转发教师的一句话。上下文包建议包含：

- 教师原始要求。
- 年级、学科、班级或学生范围。
- 教材版本、章节、知识点、教师确认的重点。
- 近期错题、薄弱点、任务历史、批改记录。
- 输出目标：A4 页数、题型结构、是否需要答案解析 PDF。
- 产品边界：学生/家长端不暴露供应商、模型名和内部链路。
- 修复标准：题量、解析、答案、图形、JSON schema、排版友好性。

模型返回只视为草稿。后端必须执行 normalize、validate、repair，再入库或导出。任何不完整内容都不能直接进入学生端、家长端或 PDF。

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

生成类内部链路必须优先使用当前最高级可用模型：DeepSeek assessment v4 先生成；超时或不可用时 GPT5.5 接管；MiniMax M3 作为备份生成。模型返回后由服务层做结构修复，再经过 MiniMax M3 生成质量审查和 GPT5.5 高级质量审查。审查结果写入 `generationPipeline`，前端只显示教师可理解的审查状态，不向学生/家长展示模型名。

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
