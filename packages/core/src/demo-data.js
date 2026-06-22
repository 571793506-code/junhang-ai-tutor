import { subjects } from "./domain.js";

export const demoTeachers = [
  {
    id: "teacher-jh-001",
    displayName: "君航老师",
    phone: "13800000001",
    role: "主讲老师",
    accessCode: "T8JH21",
    status: "已开通"
  },
  {
    id: "teacher-jh-002",
    displayName: "助教老师",
    phone: "13800000002",
    role: "助教",
    accessCode: "A6QK39",
    status: "待开通"
  }
];

export const demoClassroomDevices = [
  {
    id: "device-grade-6",
    label: "六年级课堂平板",
    bindingCode: "PAD6JH",
    grade: "六年级",
    className: "六年级 1 班",
    teacherId: "teacher-jh-001",
    teacherName: "君航老师",
    status: "已绑定"
  },
  {
    id: "device-grade-5",
    label: "五年级课堂平板",
    bindingCode: "PAD5JH",
    grade: "五年级",
    className: "五年级 2 班",
    teacherId: "teacher-jh-002",
    teacherName: "助教老师",
    status: "已绑定"
  }
];

export const demoStudents = [
  {
    id: "stu-wyx",
    displayName: "王瑜瑄",
    grade: "六年级",
    school: "君航课后辅导",
    className: "六年级 1 班",
    textbookVersion: "人教版",
    guardianName: "王女士",
    guardianPhone: "13900001234",
    responsibleTeacherId: "teacher-jh-001",
    responsibleTeacherName: "君航老师",
    accessCode: "WYX8K2",
    enrollmentStatus: "在读",
    loginEnabled: true,
    registeredAt: "2026-05-20",
    focus: "英语词汇与数学几何",
    weeklyScore: 86,
    streak: 5,
    mastery: { 语文: 78, 数学: 84, 英语: 72 },
    strengths: ["课堂跟进快", "错题订正及时"],
    risks: ["动词过去式迁移", "等腰三角形分类", "作文细节描写"],
    tone: "稳中有进"
  },
  {
    id: "stu-lzy",
    displayName: "李子越",
    grade: "六年级",
    school: "君航课后辅导",
    className: "六年级 1 班",
    textbookVersion: "人教版",
    guardianName: "李先生",
    guardianPhone: "13900005678",
    responsibleTeacherId: "teacher-jh-001",
    responsibleTeacherName: "君航老师",
    accessCode: "LZY6P9",
    enrollmentStatus: "在读",
    loginEnabled: true,
    registeredAt: "2026-05-18",
    focus: "数学应用题与英语阅读",
    weeklyScore: 81,
    streak: 3,
    mastery: { 语文: 82, 数学: 76, 英语: 79 },
    strengths: ["阅读速度快", "课堂参与稳定"],
    risks: ["应用题数量关系", "阅读细节定位"],
    tone: "需要稳住步骤"
  },
  {
    id: "stu-cxy",
    displayName: "陈星妍",
    grade: "五年级",
    school: "君航课后辅导",
    className: "五年级 2 班",
    textbookVersion: "人教版",
    guardianName: "陈女士",
    guardianPhone: "13900009876",
    responsibleTeacherId: "teacher-jh-002",
    responsibleTeacherName: "助教老师",
    accessCode: "CXY3M7",
    enrollmentStatus: "测试",
    loginEnabled: true,
    registeredAt: "2026-05-21",
    focus: "语文默写与英语基础词汇",
    weeklyScore: 88,
    streak: 6,
    mastery: { 语文: 84, 数学: 86, 英语: 82 },
    strengths: ["书写认真", "基础题正确率高"],
    risks: ["古诗易漏字", "英语单词复数变化"],
    tone: "基础扎实"
  }
];

export const demoClassroomBroadcasts = [
  {
    id: "broadcast-1",
    deviceId: "device-grade-6",
    grade: "六年级",
    className: "六年级 1 班",
    subject: "英语",
    title: "英语 Unit 4 词汇听写提醒",
    content: "请六年级同学准备英语 Unit 4 词汇听写，完成后把作答纸交给老师。",
    voiceText: "请六年级同学准备英语 Unit 4 词汇听写。",
    status: "待播报",
    createdByTeacherId: "teacher-jh-001"
  },
  {
    id: "broadcast-2",
    deviceId: "device-grade-6",
    grade: "六年级",
    className: "六年级 1 班",
    subject: "数学",
    title: "几何专项练习提醒",
    content: "请王瑜瑄和李子越完成等腰三角形分类讨论练习，先画图再写两种情况。",
    voiceText: "请完成等腰三角形分类讨论练习，先画图再写两种情况。",
    status: "已播报",
    createdByTeacherId: "teacher-jh-001"
  }
];

export const demoDictationTasks = [
  {
    id: "dictation-1",
    deviceId: "device-grade-6",
    grade: "六年级",
    className: "六年级 1 班",
    subject: "英语",
    title: "Unit 4 重点词听写",
    items: ["carry", "bright", "careful", "went", "brought"],
    currentIndex: 0,
    difficulty: "基础",
    repeats: 2,
    intervalSeconds: 10,
    status: "待开始",
    createdByTeacherId: "teacher-jh-001"
  },
  {
    id: "dictation-2",
    deviceId: "device-grade-5",
    grade: "五年级",
    className: "五年级 2 班",
    subject: "语文",
    title: "语文词语默写",
    items: ["徘徊", "惊惶", "截然不同", "司空见惯"],
    currentIndex: 0,
    difficulty: "提高",
    repeats: 3,
    intervalSeconds: 15,
    status: "待开始",
    createdByTeacherId: "teacher-jh-002"
  }
];

export const demoReadingTasks = [
  {
    id: "reading-1",
    deviceId: "device-grade-6",
    grade: "六年级",
    className: "六年级 1 班",
    subject: "英语",
    title: "Unit 4 课文预习跟读",
    passage: "I carried my bag to school yesterday. The classroom was bright and clean.",
    focusItems: ["carried", "bright", "yesterday"],
    supportNote: "重点理解一般过去时 carried，以及 bright 在句子里的意思。",
    status: "待跟读",
    createdByTeacherId: "teacher-jh-001"
  },
  {
    id: "reading-2",
    deviceId: "device-grade-5",
    grade: "五年级",
    className: "五年级 2 班",
    subject: "语文",
    title: "语文课文片段跟读",
    passage: "燕子去了，有再来的时候；杨柳枯了，有再青的时候。",
    focusItems: ["燕子", "杨柳", "再青"],
    supportNote: "注意停顿和语气，理解排比句表达的时间流逝。",
    status: "待跟读",
    createdByTeacherId: "teacher-jh-002"
  }
];

export const demoTasks = [
  {
    id: "task-1",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    title: "英语 Unit 4 词汇听写",
    subject: "英语",
    status: "待完成",
    minutes: 12,
    dueLabel: "今日",
    source: "教材词表",
    knowledgePoints: ["词义", "拼写", "搭配"]
  },
  {
    id: "task-2",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    title: "等腰三角形专项 6 题",
    subject: "数学",
    status: "进行中",
    minutes: 18,
    dueLabel: "今日",
    source: "错题同类题",
    knowledgePoints: ["角度", "分类讨论"]
  },
  {
    id: "task-3",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    title: "语文作文片段润色",
    subject: "语文",
    status: "需复核",
    minutes: 15,
    dueLabel: "明日",
    source: "老师批注",
    knowledgePoints: ["细节描写", "语句连贯"]
  },
  {
    id: "task-4",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    title: "一般过去时造句复练",
    subject: "英语",
    status: "已完成",
    minutes: 10,
    dueLabel: "今日",
    source: "AI 复练",
    knowledgePoints: ["时态", "句型"]
  }
];

export const demoAssignments = [
  {
    id: "assign-1",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    targetScope: "student",
    targetGrade: null,
    kind: "小测",
    title: "一般过去时 5 题小测",
    subject: "英语",
    status: "已批改",
    difficulty: "基础",
    minutes: 10,
    layoutTemplate: "A4 小测模板",
    printProfile: {
      paper: "A4",
      pages: 2,
      columns: 1,
      answerSpace: "每题 2 行答题区",
      headerFields: ["姓名", "日期", "用时"],
      optimizationNotes: ["题目间距适合小测快速作答", "保留短答题区，避免一页过密"]
    },
    specialRequirements: "默认两页 A4，适合 10 分钟小测。",
    submissionImageNames: ["past-tense-quiz-photo.jpg"],
    score: 82,
    totalScore: 100,
    items: [
      "Yesterday I ____ to school by bus.",
      "She ____ her grandparents last Sunday.",
      "把 carry 改成过去式并造句。"
    ],
    grading: {
      summary: "基础句型理解较好，动词变化还需要稳定。",
      strengths: ["能识别 yesterday / last Sunday 等过去时间标志", "简单句结构清楚"],
      mistakes: ["go -> went 易错", "carry -> carried 拼写变化需要再练"],
      nextPractice: "明天安排 5 分钟不规则动词复盘。"
    }
  },
  {
    id: "assign-2",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    targetScope: "student",
    targetGrade: null,
    kind: "练习",
    title: "等腰三角形分类讨论练习",
    subject: "数学",
    status: "待完成",
    difficulty: "提高",
    minutes: 18,
    layoutTemplate: "A4 练习模板",
    printProfile: {
      paper: "A4",
      pages: 2,
      columns: 1,
      answerSpace: "每题保留完整演算区",
      headerFields: ["姓名", "日期", "订正情况"],
      optimizationNotes: ["每题保留演算区", "几何题避免跨页断题"]
    },
    specialRequirements: "默认两页 A4，适合专项练习。",
    submissionImageNames: [],
    score: null,
    totalScore: 100,
    items: [
      "等腰三角形一个角为 40°，求其他角。",
      "等腰三角形一个角为 50°，讨论所有可能情况。"
    ],
    grading: null
  },
  {
    id: "assign-3",
    studentId: "stu-wyx",
    studentName: "王瑜瑄",
    targetScope: "student",
    targetGrade: null,
    kind: "试卷",
    title: "六年级英语词汇阶段卷",
    subject: "英语",
    status: "需复核",
    difficulty: "综合",
    minutes: 30,
    layoutTemplate: "A4 阶段试卷模板",
    printProfile: {
      paper: "A4",
      pages: 4,
      columns: 2,
      answerSpace: "客观题表格 + 主观题横线",
      headerFields: ["姓名", "班级", "得分", "老师复核"],
      optimizationNotes: ["四页 A4 阶段卷", "选择题双栏，主观题保留整块作答区"]
    },
    specialRequirements: "默认四页 A4，适合阶段检测。",
    submissionImageNames: ["english-stage-paper-1.jpg", "english-stage-paper-2.jpg"],
    score: 76,
    totalScore: 100,
    items: [
      "词形变化选择题 10 题",
      "短文填空 1 篇",
      "用 carry / bright 各造一句。"
    ],
    grading: {
      summary: "词汇记忆有进步，但综合语境下的词形变化仍需老师复核。",
      strengths: ["核心词义掌握较好", "造句完整度提升"],
      mistakes: ["三单和过去式混用", "部分句子时态不一致"],
      nextPractice: "复核后加入错题本，并补 6 道词形变化题。"
    }
  }
];

export const demoCorrectionRecords = [
  {
    id: "corr-1",
    subject: "数学",
    point: "等腰三角形角度",
    prompt: "已知等腰三角形一个角为 40°，求其他角。",
    studentAnswer: "80° 和 60°。",
    correctAnswer: "要先判断 40° 是顶角还是底角。",
    cause: "漏掉顶角/底角两种情况",
    state: "待订正",
    knowledgePoint: "几何分类讨论"
  },
  {
    id: "corr-2",
    subject: "英语",
    point: "动词过去式",
    prompt: "Yesterday I ____ to school by bus.",
    studentAnswer: "go",
    correctAnswer: "went",
    cause: "只记中文意思，句中时态变化不稳",
    state: "复习中",
    knowledgePoint: "一般过去时"
  },
  {
    id: "corr-3",
    subject: "语文",
    point: "作文细节描写",
    prompt: "描写雨中校园的一处场景。",
    studentAnswer: "下雨了，校园很漂亮。",
    correctAnswer: "补上动作、声音、光线和人物反应。",
    cause: "画面感不足，动作和声音细节少",
    state: "已掌握",
    knowledgePoint: "场景描写"
  }
];

export const demoSubjectInsights = {
  语文: {
    summary: "阅读理解整体稳定，作文表达还需要更多细节支撑。",
    weakPoints: [
      { point: "作文细节描写", status: "掌握不稳", evidence: "场景描写容易停留在概括句，缺少动作、声音和人物反应。" },
      { point: "阅读概括", status: "需巩固", evidence: "能找到关键词，但归纳时偶尔遗漏原因或结果。" }
    ],
    mastered: ["课文背诵准确率较高", "基础字词订正及时"],
    nextActions: ["每周 2 次 150 字片段训练", "阅读题先圈关键词再写答案"]
  },
  数学: {
    summary: "计算基础较稳，几何分类讨论是近期最需要跟进的点。",
    weakPoints: [
      { point: "等腰三角形角度", status: "未掌握", evidence: "遇到一个已知角时，容易只按一种位置计算。" },
      { point: "几何条件整理", status: "掌握不稳", evidence: "题目条件较多时，图上标注不完整。" }
    ],
    mastered: ["分数百分数互化", "基础方程求解"],
    nextActions: ["做 6 道同类分类讨论题", "每题先写“顶角/底角两种情况”"]
  },
  英语: {
    summary: "词义记忆有进步，但动词变化和句中使用还不够稳定。",
    weakPoints: [
      { point: "动词过去式", status: "未掌握", evidence: "看到 yesterday 仍可能直接填动词原形。" },
      { point: "第三人称单数", status: "需巩固", evidence: "carry -> carries 这类 y 结尾变化容易漏。" }
    ],
    mastered: ["常见校园词汇", "简单陈述句结构"],
    nextActions: ["每天 5 个动词变化小卡", "每个新词写 1 句自己的例句"]
  }
};

export const demoStudentReports = [
  {
    id: "report-week",
    period: "本周",
    title: "本周学习反馈",
    summary: "本周能保持连续学习，英语词汇和数学几何是主要跟进方向。",
    highlights: ["完成 3 次英语词汇复习", "数学专项题完成率提高", "错题订正更及时"],
    concerns: ["动词过去式仍有迁移错误", "几何分类讨论容易漏情况"],
    nextActions: ["下周安排 3 次短时复盘", "错题订正后立刻做 1 道同类题"]
  },
  {
    id: "report-month",
    period: "本月",
    title: "本月成长档案",
    summary: "整体学习节奏稳定，能按时完成多数任务，表达类任务需要增加输出练习。",
    highlights: ["连续学习习惯初步形成", "基础计算正确率较稳定", "词汇查询后会主动保存搭配"],
    concerns: ["作文细节描写偏概括", "英语词形变化需要反复练"],
    nextActions: ["每周固定一次作文片段修改", "建立动词变化专项清单"]
  },
  {
    id: "report-midterm",
    period: "期中",
    title: "期中阶段分析",
    summary: "期中阶段基础题表现较好，综合题在条件整理和表达完整度上还需要训练。",
    highlights: ["语文基础字词较稳", "数学基础计算保持良好", "英语常见词汇识记增加"],
    concerns: ["数学几何题缺少分类意识", "阅读概括答案不够完整"],
    nextActions: ["建立几何题步骤模板", "阅读题训练“原因 + 结果”完整表达"]
  },
  {
    id: "report-final",
    period: "期末",
    title: "期末目标建议",
    summary: "期末前建议把复习重点放在高频错因和可快速提分的表达规范上。",
    highlights: ["学习配合度较好", "错题复盘意愿提升"],
    concerns: ["同一错因可能反复出现", "部分知识点会但表达不完整"],
    nextActions: ["每两天回看错题清单", "期末前完成 2 轮词形变化复习"]
  }
];

export const demoTextbooks = [
  {
    id: "tb-1",
    subject: "英语",
    grade: "六年级",
    edition: "人教版",
    volume: "下册",
    title: "小学英语六年级下册",
    source: "D:\\君航AI助教\\textbooks",
    chapterCount: 8,
    importState: "已建索引"
  },
  {
    id: "tb-2",
    subject: "数学",
    grade: "六年级",
    edition: "人教版",
    volume: "下册",
    title: "小学数学六年级下册",
    source: "D:\\君航AI助教\\textbooks",
    chapterCount: 7,
    importState: "待切片"
  },
  {
    id: "tb-3",
    subject: "语文",
    grade: "六年级",
    edition: "人教版",
    volume: "下册",
    title: "小学语文六年级下册",
    source: "D:\\君航AI助教\\textbooks",
    chapterCount: 9,
    importState: "待 OCR"
  }
];

export const demoLearningLogs = [
  {
    id: "log-1",
    time: "19:12",
    feature: "英语词汇",
    action: "查询 carry",
    result: "保存搭配 3 条",
    actorType: "student"
  },
  {
    id: "log-2",
    time: "19:29",
    feature: "错题本",
    action: "复习几何错题",
    result: "仍需分类讨论",
    actorType: "system"
  },
  {
    id: "log-3",
    time: "20:05",
    feature: "AI 问答",
    action: "询问过去式",
    result: "生成同类题 1 道",
    actorType: "student"
  }
];

export const demoVocabularyEntries = [
  {
    term: "carry",
    phonetic: "/ˈkæri/",
    partOfSpeech: "v.",
    meaning: "携带；运送；承载",
    collocations: ["carry out", "carry on", "carry a bag"],
    examples: [
      "I carry my lunch box to school.",
      "The bridge can carry heavy cars."
    ],
    pitfalls: ["易和 bring 混淆", "第三人称单数是 carries"]
  },
  {
    term: "bright",
    phonetic: "/braɪt/",
    partOfSpeech: "adj.",
    meaning: "明亮的；聪明的",
    collocations: ["bright day", "bright idea", "bright smile"],
    examples: [
      "The room is bright in the morning.",
      "She is a bright student."
    ],
    pitfalls: ["形近词可能混淆", "比较级更 bright"]
  }
];

export const subjectLabels = subjects;
