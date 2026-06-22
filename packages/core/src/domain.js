export const subjects = ["语文", "数学", "英语"];

export const entityBlueprints = [
  {
    name: "Student",
    keyFields: ["id", "displayName", "grade", "school", "textbookVersion", "enrollmentStatus"],
    relations: [
      "StudentGuardian",
      "TeacherStudentAssignment",
      "StudentAccessCode",
      "ClassStudent",
      "LearningTask",
      "TaskAttempt",
      "DictationSession",
      "QaSession",
      "VocabularyRecord",
      "MistakeRecord",
      "BehaviorEvent",
      "StudentProfile",
      "StudentReport"
    ],
    notes: "学生主档，不把登录态和学习画像混在一起。"
  },
  {
    name: "Teacher",
    keyFields: ["id", "displayName", "phone", "role", "status"],
    relations: ["TeacherAccessCode", "TeacherStudentAssignment", "ClassTeacher", "LearningTask"],
    notes: "教师端权限由管理员或终端控制开通，学生登记时直接绑定负责老师。"
  },
  {
    name: "StudentAccessCode",
    keyFields: ["studentId", "codeHash", "status", "createdByTeacherId", "disabledAt"],
    relations: ["Student", "Teacher", "LoginBinding"],
    notes: "六位字母数字码只做登录校验和绑定，不作为公开邀请码；退课后停用码但保留学生档案。"
  },
  {
    name: "ClassroomDevice",
    keyFields: ["id", "label", "bindingCode", "grade", "className", "teacherId", "status"],
    relations: ["Teacher", "TaskBroadcast", "DictationTask", "ClassroomSession", "VoiceInteraction"],
    notes: "放在每个年级桌上的公共平板，只接收课堂任务和临时问答，不展示完整学生档案。"
  },
  {
    name: "TaskBroadcast",
    keyFields: ["deviceId", "teacherId", "subject", "title", "voiceText", "status"],
    relations: ["ClassroomDevice", "Teacher", "LearningTask", "BehaviorEvent"],
    notes: "教师端发布到课堂平板端的任务提醒，可语音播报并写入课堂日志。"
  },
  {
    name: "DictationTask",
    keyFields: ["deviceId", "teacherId", "subject", "title", "items", "difficulty", "repeats", "intervalSeconds", "status"],
    relations: ["ClassroomDevice", "Submission", "GradingResult", "MistakeRecord"],
    notes: "英语单词、语文词语或成语听写，由教师端输入；播报中锁定平板并隐藏列表，完成后自动展示。"
  },
  {
    name: "VoiceInteraction",
    keyFields: ["deviceId", "studentId", "transcript", "answerSummary", "mode", "occurredAt"],
    relations: ["ClassroomDevice", "Student", "QaSession", "BehaviorEvent", "ModelRun"],
    notes: "课堂公共平板的语音问答记录，先识别学生身份，再由系统判断知识讲解或思路引导并归档。"
  },
  {
    name: "ReadingTask",
    keyFields: ["deviceId", "teacherId", "subject", "title", "passage", "focusItems", "status"],
    relations: ["ClassroomDevice", "Teacher", "BehaviorEvent", "VocabularyRecord"],
    notes: "语文或英语课文跟读任务，由教师端选择课文并标注难字、新词和理解提示，平板端协助预习。"
  },
  {
    name: "CorrectionRecord",
    keyFields: ["studentId", "subject", "prompt", "studentAnswer", "correctAnswer", "cause"],
    relations: ["Student", "KnowledgePoint", "GradingResult"],
    notes: "旧系统里的更正记录统一落到错题和批改结果两张表。"
  },
  {
    name: "TextbookAsset",
    keyFields: ["subject", "grade", "edition", "volume", "title", "source"],
    relations: ["KnowledgePoint"],
    notes: "先存索引、章节和来源，不把全文塞进业务表。"
  },
  {
    name: "LearningLog",
    keyFields: ["studentId", "actorType", "feature", "action", "occurredAt"],
    relations: ["Student", "ModelRun"],
    notes: "行为日志和模型调用都要保留来源与摘要。"
  }
];

export const miniProgramSurface = [
  "学生主页",
  "今日任务",
  "AI 问答",
  "英语词汇助手",
  "错题本",
  "学生档案",
  "学生登录校验",
  "课堂平板端"
];
