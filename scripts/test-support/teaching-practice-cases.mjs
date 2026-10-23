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
    teacherContext: "合成诊断：第4题已核对原作答，确认只写了结果，没有计算过程。其他题按可见过程评分。",
    assignmentItems: cases.map((q) => ({ questionNo: q.questionNo, itemType: "calculation", prompt: "57×4－128", answer: "100", score: 5, rubric: q.rubric || rubric })),
    ocrQuestions: cases.map((q) => ({ questionNo: q.questionNo, itemType: "calculation", printedPrompt: "57×4－128", studentAnswer: q.answer, observedWork: q.work, confidence: 1 }))
  } };
}

// Expected judgments are diagnostic assertions, never supplied to the model or teacher gold.
export function buildGradingEvidenceBoundaryCase() {
  const rubric = "满分5分：乘法20×3=60正确得2分；以正确积完成60-8=52得2分；最终结果52得1分。只写结果且确实未写过程时，结果正确得1分、错误得0分；有过程按上述项目评分，不叠加结果特例，不允许错误传递。";
  const orderPrompt = "计算720÷[15×(14-8)]时，应先算（ ），再算（ ），最后算（ ），结果是（ ）。";
  const cases = [
    { questionNo: "1", answer: "42", expectedScore: null, reason: "错误结果，过程未采集" },
    { questionNo: "2", answer: "42", work: null, expectedScore: null, reason: "null不证明过程为空" },
    { questionNo: "3", answer: "42", work: "", expectedScore: null, reason: "空字符串不证明原卷无过程" },
    { questionNo: "4", answer: "42", expectedScore: 0, reason: "教师确认实际未写过程，错误结果按规则零分" },
    { questionNo: "5", answer: "52", expectedScore: 1, reason: "教师确认实际未写过程，正确结果按规则给1分" },
    { questionNo: "6", answer: "52", work: "20×3-8=60-8=52", expectedScore: 5, reason: "完整可见过程正确" },
    { questionNo: "7", answer: "52", work: "20×3-8=50-8=52", expectedScore: 1, reason: "可见两处计算错，结果正确仅得结果1分" },
    { questionNo: "8", answer: "52", expectedScore: null, reason: "正确结果仍不能证明缺失的过程满足步骤分" },
    { questionNo: "9", answer: "小括号；中括号；除法；80", itemType: "fill_blank", prompt: orderPrompt,
      reference: ["14-8", "15×6", "720÷90", "8"], score: 2,
      rubric: "每空0.5分。按题意判断运算顺序和结果。", expectedScore: 1.5, reason: "前三空语义符合题意，结果空错误" },
    { questionNo: "10", answer: "小括号；中括号；除法；80", itemType: "fill_blank", prompt: orderPrompt,
      reference: ["14-8", "15×6", "720÷90", "8"], score: 2,
      rubric: "先小括号，再中括号，最后除法，结果8。", expectedScore: null, reason: "前三空符合题意但逐空分值未提供" }
  ];
  return { cases, input: { subject: "数学", grade: "四年级", kind: "练习",
    teacherContext: "合成诊断：教师已核对第4、5题的完整原作答，确认这两题实际只写了结果，没有过程。第1、2、3、8题仅采集了最终答案，原作答是否写有过程未知。此说明不确认得分。",
    assignmentItems: cases.map(q => ({ questionNo: q.questionNo, itemType: q.itemType || "calculation",
      prompt: q.prompt || "20×3-8", answer: q.reference || "52", score: q.score || 5, rubric: q.rubric || rubric })),
    ocrQuestions: cases.map(q => ({ questionNo: q.questionNo, itemType: q.itemType || "calculation",
      printedPrompt: q.prompt || "20×3-8", studentAnswer: q.answer, confidence: 1,
      ...(Object.hasOwn(q, "work") ? { observedWork: q.work } : {}) }))
  } };
}
