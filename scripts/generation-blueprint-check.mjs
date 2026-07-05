import { buildAssessmentBlueprintCheck } from "@junhang/services";

const cases = [
  { subject: "数学", kind: "小测", grade: "五年级", difficulty: "基础", requirement: "小数乘法与图形" },
  { subject: "数学", kind: "练习", grade: "五年级", difficulty: "中等", requirement: "近期错题巩固" },
  { subject: "数学", kind: "试卷", grade: "六年级", difficulty: "偏高", requirement: "小升初综合测评" },
  { subject: "语文", kind: "小测", grade: "五年级", difficulty: "基础", requirement: "单元基础与阅读" },
  { subject: "语文", kind: "练习", grade: "五年级", difficulty: "中等", requirement: "阅读和表达薄弱点" },
  { subject: "语文", kind: "试卷", grade: "六年级", difficulty: "中等", requirement: "小升初综合测评" },
  { subject: "英语", kind: "小测", grade: "五年级", difficulty: "基础", requirement: "Unit 4 单元词汇、句型和阅读" },
  { subject: "英语", kind: "练习", grade: "五年级", difficulty: "中等", requirement: "一般过去时和词汇巩固" },
  { subject: "英语", kind: "试卷", grade: "六年级", difficulty: "中等", requirement: "小升初英语综合测评" }
];

const checks = cases.map((input) => {
  const snapshot = buildAssessmentBlueprintCheck(input);
  const expectedPages = input.kind === "试卷" ? 4 : 2;
  const expectedScore = input.kind === "试卷" ? 100 : 60;
  const itemTypes = new Set(snapshot.itemTypes);
  const issues = [];

  if (snapshot.blueprint.pages !== expectedPages) {
    issues.push(`${input.kind}页数应为 ${expectedPages} 页`);
  }
  if (snapshot.totalScore !== expectedScore) {
    issues.push(`${input.kind}总分应为 ${expectedScore}`);
  }
  if (snapshot.itemCount < snapshot.blueprint.minItems || snapshot.itemCount > snapshot.blueprint.maxItems) {
    issues.push(`题量 ${snapshot.itemCount} 不在蓝图范围 ${snapshot.blueprint.minItems}-${snapshot.blueprint.maxItems}`);
  }
  if (input.subject === "英语" && input.kind !== "试卷" && itemTypes.has("writing")) {
    issues.push("英语小测/练习不得包含写作题");
  }
  if (input.subject === "英语" && input.kind === "小测") {
    for (const requiredType of ["fill", "solution", "choice", "reading"]) {
      if (!itemTypes.has(requiredType)) issues.push(`英语小测缺少 ${requiredType} 题型`);
    }
  }
  if (input.subject === "语文" && input.kind !== "试卷" && itemTypes.has("writing")) {
    issues.push("语文小测/练习不得包含作文题");
  }
  if (input.subject === "数学") {
    if (!itemTypes.has("calculation")) issues.push("数学生成缺少计算题");
    if (!itemTypes.has("solution")) issues.push("数学生成缺少解答题");
  }
  if (snapshot.audit.status !== "passed") {
    issues.push(...snapshot.audit.issues);
  }

  return {
    name: `${input.subject}-${input.kind}`,
    ok: issues.length === 0,
    detail: {
      subject: input.subject,
      kind: input.kind,
      pages: snapshot.blueprint.pages,
      itemCount: snapshot.itemCount,
      totalScore: snapshot.totalScore,
      sections: snapshot.blueprint.sections.map((section) => section.title),
      itemTypes: snapshot.itemTypes,
      issues
    }
  };
});

const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  checks
}, null, 2));

if (failed.length) process.exit(1);
