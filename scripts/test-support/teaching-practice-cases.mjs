// Synthetic diagnostic tasks, never teacher-confirmed student evidence.
export function buildPracticeStageCases() {
  const base = { subject: "数学", grade: "四年级", kind: "练习", targetScope: "grade", purpose: "focused",
    requestedItemTypes: ["calculation"], requestedItemCount: 4, knowledgePoints: ["乘法进位", "四则混合运算"],
    generationProfile: "formal-full", assessmentTotalTimeoutMs: 240000, assessmentMaxTokens: 24000 };
  return [
    ["initial", "首次补弱", "本次重点是两位数乘一位数的进位，以及乘减混合运算；不要求一次覆盖历史全部错题。"],
    ["consolidation", "巩固练习", "本次练习先乘后减、括号内加法再乘减、括号内除加再乘减、两部分计算后相减。"],
    ["reassessment", "复测", "本次检查先乘后减、括号内加法再乘减、括号内除加再乘减、两部分计算后相减。"]
  ].map(([id, stage, scope]) => ({ id, request: { ...base,
    requirement: `训练阶段：${stage}。四年级数学，只出4道计算题，每题5分。${scope}参考已确认历史错题，使用新数字，不重复原题或本次上下文中的旧练习；不推断学生当前掌握程度。题量包含全部热身或拆解题，不另加题。学生只看到算式与作答空间，独立解析保留计算步骤、考点、易错点和评分依据；评分要明确连带计算错误的处理，不增加模型调用或评分之外的说明。`
  } }));
}

export function buildCarryForwardCase() {
  const rubric = "满分5分：首步乘法计算正确得2分；按原式的减法关系对所用中间结果正确完成减法得2分；保持先乘后减且完整记录对应脱式关系得1分。允许错误传递：首步乘法算错只失该步2分，后续正确沿用错误积相减仍得减法2分和关系1分；后续独立减法错误另失减法2分。改变原式运算顺序得0分。没有独立最终答案分，不能另扣结果分。只写正确结果而没有过程得2分；有过程时仅按步骤计分，不叠加结果特例。";
  const cases = [
    { questionNo: "1", answer: "90", work: "57×4－128＝218－128＝90", expectedScore: 3, reason: "乘法根源错误，减法与运算关系正确" },
    { questionNo: "2", answer: "80", work: "57×4－128＝218－128＝80", expectedScore: 1, reason: "乘法与减法为两个独立计算错误" },
    { questionNo: "3", answer: "-7068", work: "57×4－128＝57×（4－128）＝57×（－124）＝－7068", expectedScore: 0, reason: "改变原式运算关系" },
    { questionNo: "4", answer: "100", work: "", expectedScore: 2, reason: "已知只有结果，无过程" },
    { questionNo: "5", answer: "100", work: "57×4－128＝228－128＝100", expectedScore: 5, reason: "全部正确" },
    { questionNo: "6", answer: "90", work: "57×4－128＝218－128＝90", expectedScore: null, reason: "旧评分规则不足以确定连带错误分数", rubric: "满分5分，按计算过程及结果综合评分。" },
    { questionNo: "7", answer: "100", work: "57×4－128＝218－128＝100", expectedScore: 1, reason: "最终答案碰巧正确，但两个计算步骤均错" }
  ];
  return { cases, input: { subject: "数学", grade: "四年级", kind: "练习", totalScore: 35,
    assignmentItems: cases.map((q) => ({ questionNo: q.questionNo, itemType: "calculation", prompt: "57×4－128", answer: "100", score: 5, rubric: q.rubric || rubric })),
    ocrQuestions: cases.map((q) => ({ questionNo: q.questionNo, itemType: "calculation", printedPrompt: "57×4－128", studentAnswer: q.answer, observedWork: q.work, confidence: 1 }))
  } };
}
