export const importPlan = {
  studentProfiles: {
    sourceRoot: "D:\\君航AI助教\\students",
    targetTables: ["Student", "StudentGuardian", "ClassStudent", "StudentProfile"],
    steps: [
      "先按学生目录建立唯一 ID 和姓名映射。",
      "把基本信息、年级、教材版本、家长绑定关系抽成结构化记录。",
      "把日/周/月/期中/期末档案合并成 StudentProfile 快照。",
      "保留原始文件路径和 hash，方便回溯。"
    ],
    checks: ["同名学生去重", "关键字段非空", "快照数量与来源目录一致"]
  },
  correctionRecords: {
    sourceRoot: "D:\\君航AI助教\\students",
    targetTables: ["MistakeRecord", "GradingResult", "TaskAttempt"],
    steps: [
      "从批改记录、错题本和订正材料中抽取题目、答案、错因和知识点。",
      "把可判定内容写入 MistakeRecord，低置信度批改写入 GradingResult.needsReview。",
      "同类题和后续练习挂到 TaskAttempt 或 metadata 中。"
    ],
    checks: ["题目去重", "错因分类覆盖率", "待复核记录可追踪"]
  },
  textbooks: {
    sourceRoot: "D:\\君航AI助教\\textbooks",
    targetTables: ["TextbookAsset", "KnowledgePoint"],
    steps: [
      "扫描教材、课文和单元目录，先只做索引层。",
      "把年级、版本、册次、章节、页码范围写进 TextbookAsset。",
      "后续再补 OCR、章节切片和知识点树。"
    ],
    checks: ["文件 hash 不变", "教材条目与目录页数一致", "章节索引可回跳"]
  },
  learningLogs: {
    sourceRoot: "D:\\君航AI助教\\logs",
    targetTables: ["BehaviorEvent", "ModelRun"],
    steps: [
      "先把旧日志按时间、动作、模块拆成统一事件流。",
      "学习行为写入 BehaviorEvent，模型调用摘要写入 ModelRun。",
      "保留原始来源、执行结果和耗时，方便做质量分析。"
    ],
    checks: ["时间线排序正确", "模块名标准化", "失败事件可定位到原文件"]
  }
};
