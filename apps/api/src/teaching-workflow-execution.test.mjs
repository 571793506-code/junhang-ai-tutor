import assert from "node:assert/strict";
import test from "node:test";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive, draftAssessmentService } from "@junhang/services";
import { createTeachingWorkflowExecution } from "./teaching-workflow-execution.js";
import { workflowHttpFixture } from "../../../scripts/test-support/teaching-workflow-http.mjs";
import { createTeachingWorkflowClient } from "../../../scripts/teaching-workflow-client.mjs";

const actor = { teacherId: "t1" };
const request = { subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requirement: "只练进位加法", requestedItemCount: 1, requestedItemTypes: ["calculation"] };
const item = () => ({ itemType: "calculation", prompt: "24+18", answer: "42", score: 5, rubric: "计算结果正确得5分", analysisSteps: ["先算24+10", "再加8"], knowledgePoint: "加法", commonMistake: "注意进位" });
const resultFor = (q = item()) => ({ title: "加法专项", sections: [{ title: "计算", items: [q] }] });
function fixture(overrides = {}) {
  const calls = [];
  const input = (r) => ({ ...r, contentContext: { approvedOnly: true, matches: [] }, studentSignals: [] });
  const execution = createTeachingWorkflowExecution({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: input(request) }),
    teachingExecution: { call: async (route, messages) => { calls.push({ route, messages }); return { text: JSON.stringify(resultFor()), usage: { completion_tokens: 30 } }; } }, ...overrides });
  const create = (r = request) => execution.createDraft({ actor, input: { module: "generation", request: r }, workflow: { id: "w1", module: "generation", revision: 1 } });
  const validate = (snapshot, r = request) => execution.validateSnapshot(snapshot, { actor, module: "generation", request: r, workflow: { id: "w1" }, nextRevision: 2 });
  return { execution, calls, create, validate, input };
}

test("workflow creation calls the shared model pipeline and preserves rubric, rules and server context", async () => {
  const f = fixture();
  const prepared = await f.create({ ...request, model: "FORGED", generationContext: { raw: "FORGED" } });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].route.model, "gpt-6-astra");
  assert.match(f.calls[0].messages[0].content, /generation-v1/); assert.doesNotMatch(JSON.stringify(f.calls), /FORGED/);
  assert.equal(prepared.snapshot.questions[0].rubric, item().rubric);
  assert.equal(prepared.snapshot.questions[0].id, "q1");
  assert.equal((await f.validate(prepared.snapshot)).ok, true);
  assert.equal(prepared.snapshot.ruleVersions[0].module, "generation");
});

test("remediation validation and revision reject changed or withdrawn learning evidence before another call", async () => {
  const original = [{ type: "unresolved_mistake", ref: "mistake:m1", prompt: "24+18", studentAnswer: "32", correctAnswer: "42", cause: "漏进位" }];
  let signals = structuredClone(original);
  const f = fixture({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request,
    contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(signals) } }) });
  const prepared = await f.create();
  assert.equal((await f.validate(prepared.snapshot)).ok, true);
  for (const changed of [[], [{ ...original[0], studentAnswer: "33" }], [{ ...original[0], correctAnswer: "43" }], [{ ...original[0], cause: "更正后的原因" }]]) {
    signals = changed;
    const checked = await f.validate(prepared.snapshot);
    assert.equal(checked.ok, false);
    assert.equal(checked.issues[0].code, "WORKFLOW_EVIDENCE_CHANGED");
    await assert.rejects(f.execution.runner({ actor, workflow: { id: "w1", module: "generation", revision: 2 }, request,
      evidence: { generationContext: prepared.snapshot.generationContext }, questions: prepared.snapshot.questions,
      context: {}, instruction: "交换加数" }), { code: "WORKFLOW_EVIDENCE_CHANGED" });
  }
  assert.equal(f.calls.length, 1);
  assert.deepEqual(prepared.snapshot.generationContext.studentSignals, original);
});

test("missing legacy evidence does not prove equality with a verified empty signal list", async () => {
  const f = fixture(); const prepared = await f.create();
  const legacy = structuredClone(prepared.snapshot); delete legacy.generationContext.studentSignals;
  assert.equal((await f.validate(legacy)).ok, false);
});

test("HTTP keeps historical confirmation readable while blocking new commands after evidence changes", async (t) => {
  let signals = [{ type: "unresolved_mistake", ref: "mistake:m1", prompt: "24+18", studentAnswer: "32", correctAnswer: "42" }];
  const f = fixture({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request,
    contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(signals) } }) });
  const http = await workflowHttpFixture(t, f.execution);
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  const first = await client.create({ module: "generation", requestKey: "evidence-history", request });
  const confirmation = { action: "confirm", operationKey: "original-confirmation", expectedRevision: 2, targetQuestionIds: ["q1"] };
  const confirmed = await client.execute(first.id, confirmation);
  const before = await http.repo.get(first.id, "t1");
  signals = [];
  for (const command of [
    { action: "confirm", targetQuestionIds: ["q1"] },
    { action: "restore", restoreRevision: 2 },
    { action: "revise", targetQuestionIds: ["q1"], patch: { type: "replace_question", questionId: "q1", value: { ...first.content.questions[0], prompt: "18+24" } } },
    { action: "revise", targetQuestionIds: ["q1"], instruction: "交换加数" }
  ]) {
    const response = await http.request(`/workflows/${first.id}/commands`, { body: { ...command, expectedRevision: 3, operationKey: `changed-${JSON.stringify(command)}` } });
    const body = await response.json();
    assert.equal(response.status, 409, `${command.action}: ${JSON.stringify(body)}`);
    assert.equal(body.error, "WORKFLOW_EVIDENCE_CHANGED");
  }
  const after = await http.repo.get(first.id, "t1");
  assert.equal(after.currentRevision, 3); assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal((await client.getRevision(first.id, 3)).content.questions[0].reviewedByTeacher, true);
  assert.deepEqual((await client.execute(first.id, confirmation)).content, confirmed.content);
  assert.equal(f.calls.length, 1);
});

test("learning evidence changed during generation cannot be committed as a new draft", async (t) => {
  let signals = [{ type: "unresolved_mistake", ref: "mistake:m1", studentAnswer: "32", correctAnswer: "42" }];
  let calls = 0;
  const f = fixture({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request,
    contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(signals) } }),
    teachingExecution: { call: async () => { calls++; signals = []; return { text: JSON.stringify(resultFor()), usage: { completion_tokens: 20 } }; } } });
  const http = await workflowHttpFixture(t, f.execution);
  const response = await http.request("/workflows", { body: { module: "generation", requestKey: "changed-during-create", request } });
  const { workflow } = await response.json();
  assert.equal(workflow.status, "needs_input"); assert.equal(workflow.revision, 1);
  assert.deepEqual(workflow.content.questions, []); assert.equal(calls, 1);
});

test("learning evidence changed during revision cannot replace the saved draft", async (t) => {
  let signals = [{ type: "unresolved_mistake", ref: "mistake:m1", studentAnswer: "32", correctAnswer: "42" }];
  let revisions = 0;
  const f = fixture({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request,
    contentContext: { approvedOnly: true, matches: [] }, studentSignals: structuredClone(signals) } }),
    revise: async (_config, _module, input) => {
      revisions++; signals = [];
      return { status: "success", candidate: { questions: input.questions.map((q) => ({ ...q, prompt: "18+24" })) } };
    } });
  const http = await workflowHttpFixture(t, f.execution);
  const created = await http.request("/workflows", { body: { module: "generation", requestKey: "changed-during-revise", request } });
  const { workflow } = await created.json();
  const before = await http.repo.get(workflow.id, "t1");
  const response = await http.request(`/workflows/${workflow.id}/commands`, { body: {
    action: "revise", operationKey: "late-evidence-change", expectedRevision: 2, targetQuestionIds: ["q1"], instruction: "交换加数"
  } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "WORKFLOW_EVIDENCE_CHANGED");
  const after = await http.repo.get(workflow.id, "t1");
  assert.equal(after.currentRevision, 2); assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal(revisions, 1);
});

test("missing generation conditions, unapproved context, unavailable and fallback output cannot create a valid draft", async () => {
  const f = fixture();
  for (const r of [{ ...request, requirement: "" }, { ...request, grade: "" }, { ...request, subject: "" }, { ...request, targetScope: "student" }, { ...request, requestedItemCount: 0 }]) await assert.rejects(f.create(r));
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ resolveGenerationInput: async () => ({ ok: false }) }).create(), { code: "WORKFLOW_CONTEXT_REQUIRED" });
  for (const result of [{ modelAvailable: false }, { modelAvailable: true, usedDynamicFallback: true, audit: { passed: true } }, { modelAvailable: true, audit: { passed: false } }]) {
    await assert.rejects(fixture({ generate: async (_config, _input, options) => { assert.equal(options.persist, false); return result; } }).create(), { code: "WORKFLOW_SNAPSHOT_INVALID" });
  }
});

test("a passed audit status remains acceptable when the legacy boolean is absent or false", async () => {
  const f = fixture({ generate: async () => ({
    modelAvailable: true,
    usedDynamicFallback: false,
    audit: { status: "passed", passed: false },
    draftItems: [item()],
    totalScore: 5,
    generationContext: { teaching: fContext().teaching, target: fContext().target },
    modelRun: { metadata: { rules: [] } }
  }) });
  const prepared = await f.create();
  assert.equal(prepared.snapshot.questions.length, 1);
});

function fContext() {
  return {
    teaching: { contentContext: { approvedOnly: true, matches: [] } },
    target: { subject: "数学", grade: "四年级", kind: "练习", scope: "grade", studentId: null }
  };
}

test("missing rubric spends only the existing repair slot and reaches the workflow validator", async () => {
  let calls = 0;
  const f = fixture({ teachingExecution: { call: async () => { const q = item(); if (++calls === 1) delete q.rubric; return { text: JSON.stringify(resultFor(q)), usage: { completion_tokens: 20 } }; } } });
  const prepared = await f.create();
  assert.equal(calls, 2); assert.equal((await f.validate(prepared.snapshot)).ok, true);
});

test("multi-day and shared passage metadata become stable workflow dependencies", async () => {
  const f = fixture({ generate: async (...args) => { const result = await draftAssessmentService(...args); assert.deepEqual(result.audit.issues, []); return result; }, teachingExecution: { call: async () => {
    const q = { ...item(), prompt: "根据短文，原有24个苹果，又得到18个，共有几个？", itemType: "reading", passageGroupId: "passage", passageTitle: "阅读", passageText: "这是用于验证材料关联的合成阅读内容，不能作为教学质量样本。".repeat(24) };
    return { text: JSON.stringify(resultFor(q)), usage: { completion_tokens: 20 } };
  } } });
  const r = { ...request, purpose: "multi_day", dayPlan: [1, 2].map((n) => ({ dayId: `d${n}`, goal: "阅读加法", requestedItemCount: 1, requestedItemTypes: ["reading"] })) };
  const prepared = await f.create(r);
  assert.deepEqual(prepared.snapshot.questions.map((q) => q.dayId), ["d1", "d2"]);
  assert.equal(prepared.snapshot.sharedMaterials.length, 2);
  assert.equal((await f.validate(prepared.snapshot, r)).ok, true);
});

test("grading uses registered answers and original student evidence and rejects a later OCR change", async () => {
  const sourcePackage = buildGradingSourcePackage({ id: "a1", grade: "四年级", subject: { name: "数学" }, items: [{ ...item(), prompt: "选择", answer: "A" }] }).package;
  const context = { ok: true, assignmentId: "a1", studentId: "s1", subject: "数学", sourcePackage,
    archiveEvidence: { sourceFingerprint: sourcePackage.fingerprint, fingerprint: "original", externalGradingRecognition: null },
    submission: { content: { ocr: { questions: [{ questionNo: "1", printedPrompt: "选择", studentAnswer: "A", confidence: 1 }] } } } };
  const r = { studentId: "s1", submissionId: "original", snapshot: { score: 100 } };
  const f = fixture({ resolveGradingContext: async () => structuredClone(context) });
  const prepared = await f.execution.createDraft({ actor, input: { module: "grading", request: r }, workflow: { id: "w1" } });
  assert.equal(prepared.snapshot.questions[0].studentAnswer, "A");
  assert.equal(prepared.snapshot.questions[0].score, 5);
  assert.deepEqual(prepared.snapshot.archiveEvidence, context.archiveEvidence);
  assert.equal(f.calls.length, 0);
  const validation = () => f.execution.validateSnapshot(prepared.snapshot, { actor, module: "grading", request: r, workflow: { id: "w1" }, nextRevision: 2 });
  assert.equal((await validation()).ok, true);
  context.archiveEvidence.fingerprint = "changed";
  assert.equal((await validation()).ok, false);
});

test("local revision sends selected content and shared rules without confirmation or evidence credentials", async () => {
  const f = fixture(); const prepared = await f.create();
  const old = prepared.snapshot.questions[0];
  const calls = [];
  const revision = fixture({ teachingExecution: { call: async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ questions: [{ ...old, prompt: "18+24", reviewedByTeacher: true, confirmedBy: "FORGED" }] }), usage: { completion_tokens: 20 } };
  } } });
  const result = await revision.execution.runner({ actor, workflow: { id: "w1", module: "generation", revision: 2 }, request,
    evidence: { generationContext: prepared.snapshot.generationContext }, questions: [old], context: { sharedMaterials: [], days: [] }, instruction: "交换加数顺序" });
  assert.equal(result.questions[0].prompt, "18+24"); assert.equal(result.questions[0].confirmedBy, undefined);
  assert.equal(calls.length, 1); assert.match(calls[0].messages[0].content, /generation-v1/);
  assert.match(calls[0].messages[1].content, /交换加数顺序/);
  assert.equal(JSON.parse(calls[0].messages[1].content).questions.length, 1);
});

test("HTTP and CLI create, revise a selected question, confirm and reload the same validated history", async (t) => {
  let calls = 0;
  const f = fixture({ teachingExecution: { call: async (_route, messages) => {
    calls++;
    const sent = JSON.parse(messages[1].content);
    const result = sent.instruction ? { questions: sent.questions.map((q) => ({ ...q, prompt: "18+24" })) }
      : { title: "加法专项", sections: [{ title: "计算", items: [item(), { ...item(), prompt: "20+22" }] }] };
    return { text: JSON.stringify(result), usage: { completion_tokens: 25 } };
  } } });
  const http = await workflowHttpFixture(t, f.execution);
  const client = createTeachingWorkflowClient({ baseUrl: http.baseUrl, session: { sessionToken: http.tokens.teacher } });
  const first = await client.create({ module: "generation", requestKey: "actual-adapter", request: { ...request, requestedItemCount: 2 } });
  assert.equal(first.status, "ready_for_review"); assert.equal(first.revision, 2); assert.equal(first.content.questions.length, 2);
  const next = await client.execute(first.id, { action: "revise", operationKey: "edit-one", expectedRevision: 2, targetQuestionIds: ["q1"], instruction: "交换第一题的加数顺序" });
  assert.equal(next.content.questions[0].prompt, "18+24");
  assert.deepEqual(next.content.questions[1], first.content.questions[1]);
  const confirmed = await client.execute(first.id, { action: "confirm", operationKey: "confirm-one", expectedRevision: 3, targetQuestionIds: ["q1"] });
  assert.equal(confirmed.content.questions[0].reviewedByTeacher, true); assert.equal(calls, 2);
  assert.equal((await client.getRevision(first.id, 2)).content.questions[0].prompt, "24+18");
  assert.deepEqual(await client.get(first.id), (await (await http.request(`/workflows/${first.id}`)).json()).workflow);
});

test("an incomplete HTTP request persists needs_input without making a model call", async (t) => {
  const f = fixture(); const http = await workflowHttpFixture(t, f.execution);
  const response = await http.request("/workflows", { body: { module: "generation", requestKey: "incomplete", request: { requirement: "生成练习" } } });
  assert.equal(response.status, 200);
  const { workflow } = await response.json();
  assert.equal(workflow.status, "needs_input"); assert.equal(workflow.revision, 1); assert.deepEqual(workflow.content.questions, []);
  assert.equal(f.calls.length, 0);
});

test("HTTP preserves per-day item counts and types through actual generation execution", async (t) => {
  const f = fixture(); const http = await workflowHttpFixture(t, f.execution);
  const dayPlan = [{ dayId: "d1", goal: "加法", requestedItemCount: 1, requestedItemTypes: ["calculation"] }];
  const response = await http.request("/workflows", { body: { module: "generation", requestKey: "day-plan", request: { ...request, purpose: "multi_day", dayPlan } } });
  const { workflow } = await response.json();
  assert.equal(workflow.status, "ready_for_review"); assert.deepEqual(workflow.request.dayPlan, dayPlan);
  assert.equal(workflow.content.questions[0].dayId, "d1");
});

test("grading rejudges only the selected question with local comparison and stops on changed or unreadable evidence", async () => {
  const sourcePackage = buildGradingSourcePackage({ id: "a1", grade: "四年级", subject: { name: "数学" }, items: [1, 2].map(() => ({ ...item(), prompt: "选择", answer: "A" })) }).package;
  const archiveEvidence = { fingerprint: "original", sourceFingerprint: sourcePackage.fingerprint };
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, sourcePackage, archiveEvidence, subject: "数学" }) });
  const q = { id: "q2", questionNo: "2", printedPrompt: "选择", studentAnswer: "A", correctAnswer: "A", score: 0, maxScore: 5, status: "wrong", explanation: "旧判断", knowledgePoint: "加法", confidence: 1 };
  const input = { actor, workflow: { id: "w1", module: "grading", revision: 2 }, request: { studentId: "s1", submissionId: "original" },
    evidence: { archiveEvidence: structuredClone(archiveEvidence) }, questions: [q], context: {}, instruction: "重新核对答案" };
  const result = await f.execution.runner(input);
  assert.equal(result.questions.length, 1); assert.equal(result.questions[0].id, "q2"); assert.equal(result.questions[0].score, 5); assert.equal(f.calls.length, 0);
  await assert.rejects(f.execution.runner({ ...input, questions: [{ ...q, confidence: 0.2 }] }), { code: "WORKFLOW_REQUEST_INCOMPLETE" });
  const corrected = await f.execution.runner({ ...input, questions: [{ ...q, confidence: 0.2,
    studentAnswerReview: { actorTeacherId: actor.teacherId, studentAnswer: "A" } }] });
  assert.equal(corrected.questions[0].score, 5);
  assert.equal(corrected.questions[0].confidence, 0.2);
  assert.equal(f.calls.length, 0); // teacher-corrected objective answer still uses the shared local comparator
  archiveEvidence.fingerprint = "changed";
  await assert.rejects(f.execution.runner(input), { code: "WORKFLOW_EVIDENCE_CHANGED" });
  assert.equal(f.calls.length, 0);
});

test("legacy server-bound types keep objective work local and process work remote on create and regrade", async () => {
  const sourcePackage = buildGradingSourcePackage({ id: "legacy-paper", items: [
    { prompt: "选择正确结果。", answer: "A", score: 2 },
    { prompt: "计算24+18。", answer: "42", score: 5, rubric: "方法2分、计算2分、结果1分。" }
  ] }).package;
  const archiveEvidence = { fingerprint: "legacy-evidence", sourceFingerprint: sourcePackage.fingerprint,
    assignmentQuestionTypes: [{ questionNo: "1", itemType: "choice" }, { questionNo: "2", itemType: "calculation" }] };
  const sent = [];
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, subject: "数学", sourcePackage, archiveEvidence,
    submission: { content: { ocr: { questions: [
      { questionNo: "1", studentAnswer: "A", observedWork: "圈选A", confidence: 0.97 },
      { questionNo: "2", studentAnswer: "42", observedWork: "24+10+8=42", confidence: 0.96 }
    ] } } } }), teachingExecution: { call: async (_route, messages) => {
      sent.push(JSON.parse(messages[1].content));
      return { text: JSON.stringify({ questionResults: [{ questionNo: "2", status: "correct", score: 5, maxScore: 5,
        confidence: 0.96, explanation: "逐步计算正确。" }] }) };
    } } });
  const r = { studentId: "s1", submissionId: "legacy-submission", itemType: "choice" };
  const prepared = await f.execution.createDraft({ actor, input: { module: "grading", request: r }, workflow: { id: "w1" } });
  assert.deepEqual(sent[0].ocrQuestions.map(q => q.questionNo), ["2"]);
  assert.deepEqual(prepared.snapshot.questions.map(q => q.itemType), ["choice", "calculation"]);
  assert.equal(prepared.snapshot.questions[0].score, 2);
  assert.equal(prepared.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.equal(prepared.snapshot.gradingSourcePackage.fingerprint, sourcePackage.fingerprint);
  const args = { actor, workflow: { id: "w1", module: "grading" }, request: r, evidence: { archiveEvidence }, context: {}, instruction: "重新核对" };
  await f.execution.runner({ ...args, questions: [prepared.snapshot.questions[0]] });
  assert.equal(sent.length, 1);
  await f.execution.runner({ ...args, questions: [prepared.snapshot.questions[1]] });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].ocrQuestions.map(q => q.questionNo), ["2"]);
});

test("process evidence survives workflow creation and selected regrading without model rewrites", async (t) => {
  const observedWork = "32×24=30×20+2×4=768";
  const rubric = "列式得2分；计算得2分；结果得1分。";
  const sourcePackage = buildGradingSourcePackage({ id: "process-paper", grade: "四年级", subject: { name: "数学" },
    items: [{ orderIndex: 1, prompt: "计算32×24。", answer: "768", score: 5, rubric, analysisSteps: ["逐项展开后相加。"],
      knowledgePoint: "乘法分配律", sourceContext: { itemType: "calculation" } }] }).package;
  const archiveEvidence = { fingerprint: "process-evidence", sourceFingerprint: sourcePackage.fingerprint };
  const resolved = { ok: true, sourcePackage, archiveEvidence, subject: "数学", submission: { content: { ocr: { questions: [
    { questionNo: "1", printedPrompt: "计算32×24。", studentAnswer: "768", observedWork, confidence: 0.96,
      page: 2, sourceImageRef: "page-2.png", cropRef: "q1-crop", bbox: { page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.2 } }
  ] } } } };
  const calls = [];
  const f = fixture({ resolveGradingContext: async () => structuredClone(resolved), teachingExecution: { call: async (_route, messages) => {
    calls.push(JSON.parse(messages[1].content));
    return { text: JSON.stringify({ questionResults: [{ questionNo: "1", studentAnswer: "768", correctAnswer: "768",
      status: "partial", score: 1, maxScore: 5, confidence: 0.96, explanation: "展开漏项，正确结果不能代替过程。", observedWork: "MODEL-FORGED" }] }) };
  } } });
  const r = { studentId: "s1", submissionId: "process-submission" };
  const prepared = await f.execution.createDraft({ actor, input: { module: "grading", request: r }, workflow: { id: "w1" } });
  assert.equal(prepared.snapshot.questions[0].observedWork, observedWork);
  assert.equal(prepared.snapshot.questions[0].itemType, "calculation");
  const result = await f.execution.runner({ actor, workflow: { id: "w1", module: "grading" }, request: r,
    evidence: { archiveEvidence }, questions: prepared.snapshot.questions, context: {}, instruction: "核对过程分" });
  assert.equal(calls.length, 2);
  for (const sent of calls) {
    assert.equal(sent.ocrQuestions[0].observedWork, observedWork);
    assert.equal(sent.ocrQuestions[0].page, 2);
    assert.equal(sent.ocrQuestions[0].sourceImageRef, "page-2.png");
    assert.equal(sent.ocrQuestions[0].cropRef, "q1-crop");
    assert.equal(sent.gradingSourcePackage.questions[0].rubric, rubric);
    assert.deepEqual(sent.referenceAnswers[0].analysisSteps, ["逐项展开后相加。"]);
  }
  assert.equal(result.questions[0].observedWork, observedWork);
  assert.equal(result.questions[0].score, 1);
  const http = await workflowHttpFixture(t, f.execution);
  const created = await http.request("/workflows", { body: { module: "grading", requestKey: "process-http", request: r } });
  assert.equal(created.status, 201);
  const { workflow } = await created.json();
  const saved = workflow.content.questions[0];
  const edited = await http.request(`/workflows/${workflow.id}/commands`, { body: { action: "revise", operationKey: "process-edit",
    expectedRevision: workflow.revision, targetQuestionIds: [saved.id], patch: { type: "replace_question", questionId: saved.id,
      value: { ...saved, observedWork: "CLIENT-FORGED", page: 99, score: 2, explanation: "教师调整评分" } } } });
  assert.equal(edited.status, 200, JSON.stringify(await edited.clone().json()));
  const head = await http.repo.get(workflow.id, actor.teacherId);
  assert.equal(head.snapshot.questions[0].observedWork, observedWork);
  assert.equal(head.snapshot.questions[0].page, 2);
  assert.equal(head.snapshot.questions[0].score, 2);
  assert.equal(calls.length, 3, "score-only edits must not call the model");
});

test("unknown OCR confidence is not promoted by creation or regrading without a teacher correction", async () => {
  const sourcePackage = buildGradingSourcePackage({ id: "confidence-paper", items: [{ orderIndex: 1, prompt: "选择。", answer: "C", score: 2,
    sourceContext: { itemType: "choice" } }] }).package;
  const archiveEvidence = { fingerprint: "confidence-evidence", sourceFingerprint: sourcePackage.fingerprint };
  const seen = [];
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, subject: "数学", sourcePackage, archiveEvidence,
    submission: { content: { ocr: { questions: [{ questionNo: "1", studentAnswer: "D", confidence: null }] } } } }),
    grade: async (_config, input) => { seen.push(structuredClone(input)); return { available: true, structured: { questionResults: [
      { questionNo: "1", status: "uncertain", score: null, maxScore: 2, explanation: "待复核" }
    ] } }; } });
  const r = { studentId: "s1", submissionId: "confidence-submission" };
  const prepared = await f.execution.createDraft({ actor, input: { module: "grading", request: r }, workflow: { id: "w1" } });
  const q = prepared.snapshot.questions[0];
  assert.equal(q.confidence, null);
  const args = { actor, workflow: { id: "w1", module: "grading" }, request: r, evidence: { archiveEvidence }, questions: [q], context: {}, instruction: "核对" };
  await f.execution.runner(args);
  assert.deepEqual(seen.map((input) => input.ocrQuestions[0].confidence), [null, null]);
  const corrected = await f.execution.runner({ ...args, questions: [{ ...q, studentAnswerReview: { actorTeacherId: actor.teacherId, studentAnswer: "D" } }] });
  assert.equal(seen[2].ocrQuestions[0].confidence, 1);
  assert.equal(corrected.questions[0].confidence, null);
});

test("HTTP teacher correction resolves the legacy choice rubric without a second model call", async (t) => {
  const sourcePackage = buildGradingSourcePackage({ id: "choice-paper", grade: "四年级", subject: { name: "数学" }, items: [
    { orderIndex: 6, prompt: "27×64+73×36+27×36+73×64的结果是（ ）。", answer: "C", score: 2,
      rubric: "按结构、过程与结果综合判分。", knowledgePoint: "乘法分配律", sourceContext: { itemType: "choice", options: ["A.6400", "B.9000", "C.10000", "D.10100"] } }
  ] }).package;
  let calls = 0;
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, sourcePackage, subject: "数学",
    archiveEvidence: { fingerprint: "choice-evidence", sourceFingerprint: sourcePackage.fingerprint },
    submission: { content: { ocr: { questions: [{ questionNo: "6", studentAnswer: "D", confidence: null, bbox: null, observedWork: null }] } } } }),
    teachingExecution: { call: async () => { calls++; return { text: JSON.stringify({ questionResults: [
      { questionNo: "6", status: "uncertain", score: null, maxScore: 2, studentAnswer: "D", correctAnswer: "C", confidence: 0.4, explanation: "识别待教师核对。" }
    ] }) }; } } });
  const http = await workflowHttpFixture(t, f.execution);
  const created = await http.request("/workflows", { body: { module: "grading", requestKey: "choice-http",
    request: { studentId: "s1", submissionId: "choice-submission" } } });
  assert.equal(created.status, 201);
  const { workflow } = await created.json();
  assert.equal(workflow.content.questions[0].score, null);
  assert.equal(calls, 1);
  const corrected = await http.request(`/workflows/${workflow.id}/commands`, { body: { action: "revise", operationKey: "teacher-choice",
    expectedRevision: workflow.revision, targetQuestionIds: ["q1"], patch: { type: "correct_recognition", questionId: "q1", value: { studentAnswer: "D" } } } });
  assert.equal(corrected.status, 200);
  const { workflow: next } = await corrected.json();
  assert.equal(next.content.questions[0].status, "wrong");
  assert.equal(next.content.questions[0].score, 0);
  assert.equal(next.content.questions[0].confidence, null);
  assert.equal(next.content.questions[0].bbox, null);
  const head = await http.repo.get(workflow.id, actor.teacherId);
  assert.equal(head.snapshot.questions[0].observedWork, null);
  assert.equal(next.content.questions[0].reviewedByTeacher, undefined);
  assert.equal(next.content.gradingSummary.confirmedScore, null);
  assert.equal(calls, 1);
});

test("a trusted archived grading version reuses teacher confirmation through the actual creation adapter", async (t) => {
  const sourcePackage = buildGradingSourcePackage({ id: "paper1", grade: "四年级", subject: { name: "数学" }, items: [item()] }).package;
  const archiveEvidence = { fingerprint: "original", sourceFingerprint: sourcePackage.fingerprint };
  const snapshot = { subject: "数学", grade: "四年级", archiveEvidence, gradingSourcePackage: sourcePackage,
    questions: [{ id: "q1", questionNo: "1", printedPrompt: "24+18", studentAnswer: "42", correctAnswer: "42", score: 5, maxScore: 5, status: "correct", explanation: "进位计算正确", knowledgePoint: "加法", reviewedByTeacher: true, confirmedBy: "t1" }] };
  const archive = await buildTeachingWorkflowArchive({ actor, workflow: { id: "old", module: "grading", ownerTeacherId: "t1", currentRevision: 3, request: { studentId: "s1" } },
    snapshot, submissionId: "archived", confirmedAt: "2026-09-14T13:00:00Z", resolveGradingSource: async () => sourcePackage });
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, sourcePackage, archiveEvidence, submission: { content: { workflowArchive: archive } } }) });
  const http = await workflowHttpFixture(t, { ...f.execution, resolveConfirmedArchive: async () => archive });
  const response = await http.request("/workflows", { body: { module: "grading", requestKey: "reuse-archive", request: { studentId: "s1", submissionId: "archived" } } });
  const { workflow } = await response.json();
  assert.equal(workflow.status, "ready_for_review"); assert.equal(workflow.content.questions[0].reviewedByTeacher, true);
  assert.equal(f.calls.length, 0);
});

test("subjective regrading sends only the selected evidence and teacher instruction to the shared grading model", async () => {
  const sourcePackage = buildGradingSourcePackage({ id: "a1", grade: "四年级", subject: { name: "数学" }, items: [1, 2].map((n) => ({ ...item(), prompt: "说明交换加数为何不改变和", answer: "交换两个加数的位置，和不变",
    sourceContext: { sharedMaterial: { id: `material-${n}`, text: `第${n}题的分组材料` }, options: ["两组数量", "总量"], day: { dayId: `d${n}` } } })) }).package;
  const archiveEvidence = { fingerprint: "ORIGINAL-SECRET", sourceFingerprint: sourcePackage.fingerprint };
  const calls = [];
  const f = fixture({ resolveGradingContext: async () => ({ ok: true, sourcePackage, archiveEvidence, subject: "数学" }),
    teachingExecution: { call: async (route, messages) => {
      calls.push({ route, messages });
      return { text: JSON.stringify({ questionResults: [{ questionNo: "2", studentAnswer: "交换两组数量，总量一样", correctAnswer: "交换两个加数的位置，和不变", status: "partial", score: 3, maxScore: 5, confidence: 0.95, explanation: "思路正确，还需要完整表述规律。" }] }), usage: { completion_tokens: 20 } };
    } } });
  const result = await f.execution.runner({ actor, workflow: { id: "w1", module: "grading", revision: 2 }, request: { studentId: "s1", submissionId: "original" },
    evidence: { archiveEvidence }, questions: [{ id: "q2", questionNo: "2", printedPrompt: "说明交换加数为何不改变和", studentAnswer: "交换两组数量，总量一样", knowledgePoint: "加法交换律", maxScore: 5, score: 0, confidence: 0.95 }], context: {}, instruction: "检查是否属于合理异解" });
  assert.equal(result.questions[0].score, 3); assert.equal(result.questions[0].id, "q2"); assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(sent.ocrQuestions.map((q) => q.questionNo), ["2"]);
  assert.deepEqual(sent.referenceAnswers.map((q) => q.questionNo), ["2"]);
  assert.deepEqual(sent.gradingSourcePackage.questions.map((q) => q.context), [sourcePackage.questions[1].context]);
  assert.doesNotMatch(JSON.stringify(sent), /第1题的分组材料/);
  assert.equal(sent.teacherContext, "检查是否属于合理异解");
  assert.match(calls[0].messages[0].content, /grading-v1/); assert.doesNotMatch(JSON.stringify(calls), /ORIGINAL-SECRET/);
});

test("changed generation context and cancellation block late draft or revision results", async () => {
  let matches = [];
  const f = fixture({ resolveGenerationInput: async ({ request }) => ({ ok: true, input: { ...request, contentContext: { approvedOnly: true, matches } } }) });
  const prepared = await f.create();
  matches = [{ sourceId: "new", summary: "来源已更新" }];
  assert.equal((await f.validate(prepared.snapshot)).ok, false);
  await assert.rejects(f.execution.runner({ actor, workflow: { id: "w1", module: "generation", revision: 2 }, request,
    evidence: { generationContext: prepared.snapshot.generationContext }, questions: prepared.snapshot.questions, context: {}, instruction: "改一题" }), { code: "WORKFLOW_EVIDENCE_CHANGED" });
  assert.equal(f.calls.length, 1);
  const controller = new AbortController();
  const cancelled = fixture({ generate: async (_config, _input, options) => { assert.equal(options.signal, controller.signal); assert.equal(options.persist, false); controller.abort(); return {}; } });
  await assert.rejects(cancelled.execution.createDraft({ actor, input: { module: "generation", request }, workflow: { id: "w2" }, signal: controller.signal }), { code: "WORKFLOW_CANCELLED" });
});

test("local generation edits cannot drop required figures or choice options", async () => {
  const f = fixture(); const prepared = await f.create();
  const missingFigure = structuredClone(prepared.snapshot); missingFigure.questions[0].prompt = "如图计算面积";
  assert.equal((await f.validate(missingFigure)).ok, false);
  const r = { ...request, requestedItemTypes: ["choice"] };
  const choice = { ...prepared.snapshot, questions: [{ ...prepared.snapshot.questions[0], itemType: "choice", options: [] }] };
  assert.equal((await f.validate(choice, r)).ok, false);
});
