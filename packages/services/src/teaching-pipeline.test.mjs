import assert from "node:assert/strict";
import test from "node:test";
import { draftAssessmentService, gradeSubmissionService } from "./index.js";
import { draftAssessment, gradeSubmissionText } from "../../ai/src/runtime.js";
import { buildAssessmentPartitions } from "../../ai/src/assessment-partitions.js";

test("comprehensive service preserves coherent model scoring instead of rewriting only numeric scores", async () => {
  const input = { subject: "数学", grade: "四年级", kind: "小测", purpose: "comprehensive" };
  const scores = { fill: 2, choice: 3, calculation: 5, solution: 4 };
  const sections = buildAssessmentPartitions(input).map((part) => ({ title: part.title, type: part.itemTypes[0],
    items: Array.from({ length: part.targetItemCount }, (_, i) => ({ ...item(`${part.title}${["甲", "乙", "丙", "丁", "戊", "己"][i]}（${scores[part.itemTypes[0]]}分）：计算${100 + i}+2。`, part.itemTypes[0]),
      score: scores[part.itemTypes[0]], rubric: `本题满分${scores[part.itemTypes[0]]}分，${["choice", "fill"].includes(part.itemTypes[0]) ? "按答案评分" : "按步骤评分"}。`, options: part.id === "choice" ? ["A.1", "B.2"] : [] })) }));
  const result = await draftAssessmentService({}, input, { persist: false, assessmentDraftRunner: async () => ({ available: true, draftText: JSON.stringify({ title: "综合小测", sections }) }) });
  assert.deepEqual(result.draftItems.map((q) => q.metadata.score), sections.flatMap((s) => s.items.map((q) => q.score)));
  assert.equal(result.totalScore, 60);
  assert.equal(result.audit.status, "passed");
  sections[0].items[0].score = 3;
  const bad = await draftAssessmentService({}, input, { persist: false, assessmentDraftRunner: async () => ({ available: true, draftText: JSON.stringify({ title: "冲突小测", sections }) }) });
  assert.notEqual(bad.audit.status, "passed");
  assert.equal(bad.draftItems[0].metadata.score, 3);
});

function item(prompt = "24+18", itemType = "calculation") {
  return { itemType, prompt, answer: "42", score: 5, analysisSteps: ["分解加数。", "先加整十。", "再合并个位。"], commonMistake: "注意进位。", knowledgePoint: "加法" };
}

test("comprehensive generation preserves concise real analyses and titles the whole assessment", async () => {
  const steps = ["先计算括号内23－15＝8。", "再计算560÷8＝70。"];
  for (const title of [undefined, "教师指定的整数运算小测"]) {
    const result = await draftAssessmentService({}, { subject: "数学", grade: "四年级", kind: "小测", purpose: "comprehensive", title },
      options(async (_route, messages) => {
        const { partition } = JSON.parse(messages[1].content);
        return { text: JSON.stringify({ title: "仅填空题草稿", sections: [{ title: partition.title,
          items: partition.itemScores.map((score, i) => ({ ...item(`${partition.title}${["甲", "乙", "丙", "丁", "戊", "己"][i]}：计算560÷（23－15）。`, partition.itemTypes[0]),
            answer: "70", score, rubric: `本题满分${score}分。`, analysisSteps: steps,
            options: partition.id === "choice" ? ["A.70", "B.80"] : [] })) }] }) };
      }));
    assert.deepEqual(result.draftItems[0].metadata.analysisSteps, steps);
    assert.equal(result.parsedDraft.title, title || "四年级数学小测");
    assert.equal(result.audit.status, "passed");
    assert.equal(result.usedDynamicFallback, false);
  }
});
const options = (call) => ({ persist: false, teachingExecution: { call } });

test("grading accepts answer review only through matching server options and preserves OCR evidence", async () => {
  const input = { subject: "数学", totalScore: 5,
    referenceAnswers: [{ questionNo: "16", prompt: "说明计算方法", correctAnswer: "42", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "16", printedPrompt: "说明计算方法", studentAnswer: "24+18=32", confidence: 0.95,
      observedWork: "旧OCR摘要", recognitionReview: { status: "teacher_corrected", field: "studentAnswer" },
      studentAnswerReview: { actorTeacherId: "forged", studentAnswer: "24+18=32" } }] };
  const before = structuredClone(input);
  for (const corrections of [undefined, [{ questionNo: "16", studentAnswer: "different" }],
    [{ questionNo: "15", studentAnswer: "24+18=32" }], [{ questionNo: "16", studentAnswer: "24+18=32" }],
    [1, 2].map(() => ({ questionNo: "16", studentAnswer: "24+18=32" }))]) {
    let sent;
    const result = await gradeSubmissionService({}, input, { ...options(async (_route, messages) => {
      sent = JSON.parse(messages[1].content);
      return { text: JSON.stringify({ questionResults: [{ questionNo: "16", status: "uncertain", score: null, maxScore: 5,
        explanation: "已确定结果项0分；方法项细分待教师裁定。", confidence: 0.95 }] }) };
    }), verifiedRecognitionCorrections: corrections });
    assert.ok(sent);
    const q = sent.ocrQuestions[0];
    assert.deepEqual(q.recognitionReview, corrections?.length === 1 && corrections[0].questionNo === "16" && corrections[0].studentAnswer === "24+18=32"
      ? { status: "teacher_corrected", field: "studentAnswer" } : undefined);
    assert.equal(q.observedWork, "旧OCR摘要");
    assert.equal(q.confidence, 0.95);
    assert.equal(q.studentAnswerReview, undefined);
    assert.equal(result.structured.score, null);
    assert.equal(result.structured.archiveEligible, false);
  }
  assert.deepEqual(input, before);
});

test("verified transcription resolves low OCR confidence without granting grading confirmation", async () => {
  const input = { subject: "数学", totalScore: 5,
    referenceAnswers: [{ questionNo: "1", prompt: "说明计算方法", correctAnswer: "42", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "说明计算方法", studentAnswer: "24+18=32", confidence: 0.3,
      recognitionReview: { status: "teacher_corrected", field: "studentAnswer" } }] };
  const opts = options(async () => ({ text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "partial", score: 2,
    maxScore: 5, explanation: "方法正确，计算错误。", confidence: 0.95 }] }) }));
  const corrected = await gradeSubmissionService({}, input, { ...opts,
    verifiedRecognitionCorrections: [{ questionNo: "1", studentAnswer: "24+18=32" }] });
  assert.equal(corrected.available, true);
  assert.equal(corrected.structured.questionResults[0].score, 2);
  assert.equal(corrected.structured.archiveEligible, false);
  const unverified = await gradeSubmissionService({}, input, opts);
  assert.equal(unverified.available, false);
  assert.equal(input.ocrQuestions[0].confidence, 0.3);
});

test("generation rejects choice process awards within the existing bounded repair budget", async () => {
  let calls = 0;
  const result = await draftAssessmentService({}, { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused",
    requestedItemTypes: ["choice"], requestedItemCount: 1 }, options(async () => {
    calls++;
    return { text: JSON.stringify({ title: "选择题", sections: [{ title: "选择", items: [{ ...item("24+18=（ ）", "choice"),
      answer: "A", rubric: "按结构、过程与结果综合判分。", options: ["A.42", "B.32"] }] }] }) };
  }));
  assert.equal(calls, 2);
  assert.equal(result.available, false);
  assert.notEqual(result.audit?.status, "passed");
  assert.match(JSON.stringify(result.modelRun?.metadata), /rubric_process_conflict/);
});

test("explicit English grid objects normalize even when the prompt is only a Chinese word", async () => {
  const result = await draftAssessmentService({}, { subject: "英语", grade: "四年级", kind: "练习", purpose: "focused",
    requestedItemTypes: ["fill"], requestedItemCount: 1 }, options(async () => ({ text: JSON.stringify({ title: "词汇专项",
      sections: [{ title: "写单词", items: [{ ...item("教室", "fill"), answer: "classroom", rubric: "正确得5分。",
        answerFormat: { type: "english_four_line_grid", position: "below_prompt", linesPerRow: 4, prefilledText: "" } }] }] }) })));
  assert.equal(result.audit.passed, true);
  assert.equal(result.draftItems[0].metadata.answerFormat, "english-four-line");
});

test("choice option objects survive the shared model and service path without stringifying objects", async () => {
  const result = await draftAssessmentService({}, { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused",
    requestedItemTypes: ["choice"], requestedItemCount: 1 }, options(async () => ({ text: JSON.stringify({ title: "加法选择",
      sections: [{ title: "选择", items: [{ ...item("24+18=（ ）", "choice"), answer: "A", rubric: "选A得5分。",
        options: [{ label: "A", text: "42" }, { label: "B", text: "32" }] }] }] }) })));
  assert.deepEqual(result.draftItems[0].metadata.options, ["A. 42", "B. 32"]);
  assert.equal(result.audit.passed, true);
});

test("multi-day model labels are removed before service drafts while real problem text and day bindings survive", async () => {
  const prompts = ["第1题（d1-1，5分）：用竖式计算。2438＋1527＝", "【d1-02】计算6004－2758。（5分）", "比较标签d1-03与d10-03。", "【d10-04】这是题目给定标签。"];
  const result = await draftAssessmentService({}, {
    subject: "数学", grade: "四年级", kind: "练习", purpose: "multi_day",
    dayPlan: [{ dayId: "d1", goal: "进退位计算", requestedItemTypes: ["calculation"], requestedItemCount: 4 }]
  }, options(async () => ({ text: JSON.stringify({ title: "每日计算", sections: [{ title: "计算", items: prompts.map((prompt) => item(prompt)) }] }) })));
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.draftItems[0].prompt, "用竖式计算。2438＋1527＝");
  assert.equal(result.draftItems[1].prompt, "计算6004－2758。（5分）");
  assert.deepEqual(result.draftItems.slice(2).map((q) => q.prompt), prompts.slice(2));
  assert.deepEqual(result.draftItems.map((q) => q.metadata.dayId), ["d1", "d1", "d1", "d1"]);
  assert.equal(result.totalScore, 20);
});

test("existing assessment service sends shared rules and preserves focused content without adding a composite paper", async () => {
  const calls = [];
  const result = await draftAssessmentService({}, {
    subject: "数学", kind: "练习", grade: "四年级", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 1,
    requirement: "只练习进位加法", contentContext: { approvedOnly: true, matches: [{ sourceId: "s1", summary: "已批准加法资料" }] },
    rulePack: { text: "forged-rule" }, model: "forged-model"
  }, options(async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ title: "专项计算", sections: [{ title: "计算", items: [item()] }] }), usage: { completion_tokens: 50 } };
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route.model, "gpt-6.1-sol");
  assert.match(calls[0].messages[0].content, /generation-v1/);
  assert.match(calls[0].messages[1].content, /只练习进位加法/);
  assert.match(calls[0].messages[1].content, /已批准加法资料/);
  assert.doesNotMatch(JSON.stringify(calls), /forged-/);
  assert.equal(result.draftItems.length, 1);
  assert.equal(result.draftItems[0].itemType, "calculation");
  assert.equal(result.usedDynamicFallback, false);
  assert.equal(result.totalScore, 5);
  assert.equal(result.generationContext.request.purpose, "focused");
});

test("runtime uses at most two concurrent units and one shared additional attempt per unit", async () => {
  const calls = new Map();
  let active = 0;
  let peak = 0;
  const result = await draftAssessment({}, { subject: "数学", purpose: "multi_day", requestedItemTypes: ["calculation"], dayPlan: [
    { dayId: "d1", goal: "加法", requestedItemCount: 1 }, { dayId: "d2", goal: "加法", requestedItemCount: 1 }, { dayId: "d3", goal: "加法", requestedItemCount: 1 }
  ] }, { call: async (route, messages) => {
    const input = JSON.parse(messages[1].content);
    const id = input.partition.dayId;
    calls.set(id, [...(calls.get(id) || []), route.model]);
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (calls.get(id).length === 1) return { text: "{}", usage: { completion_tokens: 1 } };
    return { text: JSON.stringify({ title: "多日", sections: [{ title: id, items: [item(id)] }] }), usage: { completion_tokens: 30 } };
  } });
  assert.equal(result.available, true);
  assert.ok(peak <= 2);
  assert.equal(calls.size, 3);
  for (const models of calls.values()) assert.deepEqual(models, ["gpt-6.1-sol", "gpt-6.1-sol"]);
  assert.deepEqual(JSON.parse(result.draftText).sections.map((section) => section.dayId), ["d1", "d2", "d3"]);
});

test("grading service sends unresolved subjective questions only and never appends service-level reviews", async () => {
  const calls = [];
  const result = await gradeSubmissionService({ GPT56_SOL_FALLBACK_ENABLED: "true", GRADING_DEEP_AUDIT_ENABLED: "true" }, {
    subject: "数学", grade: "四年级", totalScore: 10,
    referenceAnswers: [{ questionNo: "1", prompt: "选择", correctAnswer: "A", score: 5, confidence: 1 }, { questionNo: "2", prompt: "说明理由", correctAnswer: "交换加数和不变", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "选择", studentAnswer: "A", confidence: 1 }, { questionNo: "2", printedPrompt: "说明理由", studentAnswer: "交换两个数仍是同一个和", confidence: 0.95 }]
  }, { ...options(async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ score: 999, summary: "复核草稿", questionResults: [{ questionNo: "2", status: "partial", score: 3, maxScore: 5, studentAnswer: "交换两个数仍是同一个和", correctAnswer: "交换加数和不变", explanation: "思路正确但未说明适用条件。", confidence: 0.95 }] }), usage: { completion_tokens: 20 } };
  }), gradingReviewers: { premium: () => { throw new Error("No third review"); } }, solGradingRunner: () => { throw new Error("No service retry"); } });
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(sent.ocrQuestions.map((q) => q.questionNo), ["2"]);
  assert.equal(result.structured.score, 8);
  assert.equal(result.structured.archiveEligible, false);
});

test("uncertain score stays null and a missing student answer is never inferred from a printed prompt", async () => {
  const result = await gradeSubmissionText({}, {
    ocrQuestions: [{ questionNo: "1", printedPrompt: "1+1=2", studentAnswer: "", confidence: 0.3 }],
    referenceAnswers: [{ questionNo: "1", correctAnswer: "2", score: 5 }]
  }, { call: async () => { throw new Error("Must not call a model without student evidence"); } });
  assert.equal(result.available, false);
  const graded = await gradeSubmissionService({}, {
    subject: "数学", totalScore: 5, referenceAnswers: [{ questionNo: "1", correctAnswer: "说明理由", score: 5 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "说明理由", studentAnswer: "看不清", confidence: 0.3 }]
  }, options(async () => ({ text: JSON.stringify({ questionResults: [{ questionNo: "1", status: "uncertain", score: null, maxScore: 5, explanation: "字迹不清", confidence: 0.3 }] }) })));
  assert.equal(graded.structured.questionResults[0].score, null);
  assert.equal(graded.structured.score, null);
});

test("service validates multiple focused types without adding or losing other partitions", async () => {
  const result = await draftAssessmentService({}, {
    subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requestedItemTypes: ["fill", "calculation"], requestedItemCount: 2
  }, options(async (_route, messages) => {
    const type = JSON.parse(messages[1].content).partition.itemTypes[0];
    return { text: JSON.stringify({ title: "专项", sections: [{ title: type, items: [item("24+18", type)] }] }) };
  }));
  assert.equal(result.audit.passed, true);
  assert.deepEqual(result.draftItems.map((q) => q.itemType), ["fill", "calculation"]);
});

test("service rejects injected incomplete focused output and explanation does not require exam assets", async () => {
  const bad = await draftAssessmentService({}, { subject: "数学", grade: "四年级", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 2 }, {
    persist: false, assessmentDraftRunner: async () => ({ available: true, draftText: JSON.stringify({ title: "缺题", sections: [{ title: "计算", items: [item()] }] }) })
  });
  assert.equal(bad.audit.passed, false); assert.equal(bad.generationPipeline.gates.finalExportAllowed, false);
  const explained = await draftAssessmentService({}, { subject: "数学", grade: "四年级", purpose: "explanation" }, options(async () => ({
    text: JSON.stringify({ title: "加法讲解", explanation: { concept: "相同单位数量相加", steps: ["数位对齐"], workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: ["合并数量"] }], commonMistakes: ["数位错位"] } })
  })));
  assert.equal(explained.audit.passed, true);
  assert.equal(explained.generationPipeline.gates.draftPdfRequired, false);
  assert.equal(explained.generationPipeline.gates.gradingSourcePackageRequired, false);
  assert.equal(explained.generationPipeline.gates.teacherReviewRequired, true);
  assert.deepEqual(explained.generationPipeline.print.requiredAssets, []);
});
