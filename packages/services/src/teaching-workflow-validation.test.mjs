import assert from "node:assert/strict";
import test from "node:test";
import { createTeachingWorkflowValidator } from "./teaching-workflow-validation.js";
import { buildGradingSourcePackage, validateGradingSourcePackage } from "@junhang/core";
import { createTeachingWorkflowService } from "./teaching-workflow-service.js";
import { createTeachingWorkflowRepository } from "../../db/src/teaching-workflow-repository.js";
import { fakeWorkflowPrisma } from "../../../scripts/test-support/teaching-workflow-prisma.mjs";

const question = (id = "q1") => ({ id, questionNo: id === "q1" ? "1" : "2", prompt: "1+1", answer: "2", score: 5,
  analysisSteps: ["Add one to one to get two."], rubric: "Correct addition earns 5 points.", knowledgePoint: "addition", commonMistake: "Do not multiply." });
const draft = () => ({ title: "Addition", subject: "math", grade: "4", kind: "quiz", purpose: "focused", totalScore: 10, questions: [question(), question("q2")] });
const context = (module = "generation", revision = 2) => ({ module, workflow: { id: "w1", module, currentRevision: revision - 1 }, nextRevision: revision });
const validate = createTeachingWorkflowValidator();

test("generation builds a current answer package from visible questions instead of stale metadata", async () => {
  const input = draft();
  input.gradingSourcePackage = { fingerprint: "stale" };
  input.metadata = { answerKey: ["99", "99"] };
  input.questions[0].metadata = { answer: "99", score: 99 };
  const result = await validate(input, context());
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.snapshot.gradingSourcePackage.sourceId, "w1");
  assert.equal(result.snapshot.gradingSourcePackage.version, 2);
  assert.equal(result.snapshot.gradingSourcePackage.questions[0].correctAnswer, "2");
  assert.equal(result.snapshot.gradingSourcePackage.questions[0].maxScore, 5);
  assert.equal(validateGradingSourcePackage(result.snapshot.gradingSourcePackage).ok, true);
  assert.equal(result.snapshot.metadata?.answerKey, undefined);
  assert.equal(input.gradingSourcePackage.fingerprint, "stale");
});

test("missing analyses, duplicate IDs, detached materials and bad totals reject generation", async () => {
  for (const mutate of [
    (d) => { d.questions[0].analysisSteps = []; },
    (d) => { d.questions[0].answer = ""; },
    (d) => { d.questions[1].id = "q1"; },
    (d) => { d.questions[0].sharedMaterialId = "missing"; },
    (d) => { d.totalScore = 99; },
    (d) => { d.questions[0].score = null; },
    (d) => { d.questions[0].prompt += "（99分）"; },
    (d) => { d.questions[0].rubric = "本题满分99分。"; },
    (d) => { d.questions[0].rubric = { points: [null, ""] }; }
  ]) {
    const input = draft(); mutate(input);
    const result = await validate(input, context());
    assert.equal(result.ok, false);
    assert.ok(result.issues.length); assert.equal(result.snapshot, undefined);
  }
});

test("stringified objects cannot become valid choice options in a restored or edited snapshot", async () => {
  const input = draft();
  input.questions[0].itemType = "choice";
  input.questions[0].options = ["[object Object]", "[object Object]"];
  const result = await validate(input, context());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "GENERATION_OPTIONS_REQUIRED"));
});

test("edited objective process rubrics cannot enter the generation answer package", async () => {
  const input = draft();
  Object.assign(input.questions[0], { itemType: "choice", options: ["A.2", "B.3"], answer: "A", rubric: "按结构、过程与结果综合判分。" });
  const result = await validate(input, context());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "GENERATION_SCORE_CONFLICT"));
  assert.equal(result.snapshot, undefined);
});

test("shared material and figure changes are covered by the grading source fingerprint", async () => {
  const first = draft(); first.sharedMaterials = [{ id: "m1", text: "Alice has one apple." }];
  first.questions[0].sharedMaterialId = "m1";
  const a = await validate(first, context());
  const second = structuredClone(first); second.sharedMaterials[0].text = "Alice has two apples.";
  const b = await validate(second, context());
  assert.notEqual(a.snapshot.gradingSourcePackage.fingerprint, b.snapshot.gradingSourcePackage.fingerprint);
  second.questions[0].figure = { type: "triangle", labels: ["A", "B", "C"] };
  const c = await validate(second, context());
  assert.notEqual(c.snapshot.gradingSourcePackage.fingerprint, b.snapshot.gradingSourcePackage.fingerprint);
});

test("explanations keep their teaching structure and never inherit an exam answer package", async () => {
  const input = { title: "Addition", subject: "math", grade: "4", purpose: "explanation", explanation: {
    concept: "Addition combines quantities.", steps: ["Count both groups."], workedExamples: [{ prompt: "1+1", answer: "2", analysisSteps: ["Combine one and one."] }], commonMistakes: ["Do not multiply."]
  }, gradingSourcePackage: { fingerprint: "old-exam" } };
  const result = await validate(input, context());
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.gradingSourcePackage, undefined);
  assert.equal(result.snapshot.gradingSourcePackageRequired, false);
  assert.equal((await validate({ ...input, explanation: {} }, context())).ok, false);
});

test("grading scores use a trusted source and reject invalid status-score combinations", async () => {
  const source = (await validate(draft(), context())).snapshot.gradingSourcePackage;
  const grading = createTeachingWorkflowValidator({ resolveGradingSource: async () => source });
  const input = { questions: source.questions.map((q, i) => ({ id: `q${i + 1}`, questionNo: q.questionNo, printedPrompt: q.prompt,
    studentAnswer: "2", correctAnswer: "2", status: "correct", score: 5, maxScore: 5, explanation: "Correct calculation.", knowledgePoint: "addition" })), finalScore: 999 };
  const result = await grading(input, context("grading"));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.snapshot.score, 10); assert.equal(result.snapshot.finalScore, null);
  assert.equal(result.snapshot.archiveEligible, false);
  for (const change of [{ score: 6 }, { status: "wrong", score: 5 }, { status: "uncertain", score: 0 }, { maxScore: 20 }, { correctAnswer: "99" }]) {
    const changed = structuredClone(input); Object.assign(changed.questions[0], change);
    assert.equal((await grading(changed, context("grading"))).ok, false);
  }
  assert.equal((await validate(input, context("grading"))).ok, false);
});

test("uncertain grading remains a draft with no final score and cannot be confirmed", async () => {
  const input = { questions: [{ id: "q1", questionNo: "1", printedPrompt: "unclear", status: "uncertain", score: null, maxScore: null, explanation: "Image is blurred." }] };
  const result = await validate(input, context("grading"));
  assert.equal(result.ok, true); assert.equal(result.snapshot.score, null); assert.equal(result.snapshot.finalScore, null);
  assert.equal((await validate(input, { ...context("grading"), command: { action: "confirm", targetQuestionIds: ["q1"] } })).ok, false);
});

test("create, edit, confirm and restore persist the validated package for their new version", async () => {
  const repository = createTeachingWorkflowRepository(fakeWorkflowPrisma());
  const service = createTeachingWorkflowService({ repository, validateSnapshot: validate, createDraft: async () => ({ request: {}, snapshot: draft() }) });
  const actor = { teacherId: "teacher-1" };
  const created = await service.create({ actor, input: { module: "generation", requestKey: "r1", request: {} } });
  assert.equal(created.status, "ready_for_review");
  assert.equal(created.snapshot.gradingSourcePackage.version, 2);
  const execute = (command) => service.execute({ actor, workflowId: created.workflowId, command });
  const confirmed = await execute({ action: "confirm", operationKey: "confirm", expectedRevision: 2, targetQuestionIds: ["q1"] });
  assert.equal(confirmed.snapshot.gradingSourcePackage.version, 3);
  const edited = await execute({ action: "revise", operationKey: "edit", expectedRevision: 3, targetQuestionIds: ["q2"],
    patch: { type: "replace_question", questionId: "q2", value: { ...question("q2"), prompt: "1+2", answer: "3", analysisSteps: ["Add one to two."], rubric: "Correct result earns 5 points." } } });
  assert.equal(edited.snapshot.gradingSourcePackage.version, 4);
  assert.equal(edited.snapshot.gradingSourcePackage.questions[1].correctAnswer, "3");
  assert.equal(edited.snapshot.questions[0].reviewedByTeacher, true);
  const restored = await execute({ action: "restore", operationKey: "restore", expectedRevision: 4, revision: 3 });
  assert.equal(restored.snapshot.gradingSourcePackage.version, 5);
  assert.equal(restored.snapshot.gradingSourcePackage.questions[1].correctAnswer, "2");
  assert.equal((await repository.getRevision(created.workflowId, 3, actor.teacherId)).snapshot.gradingSourcePackage.version, 3);
});

test("the requested teaching purpose cannot be bypassed by model output", async () => {
  const input = { ...draft(), purpose: "explanation", explanation: { concept: "c", steps: ["s"], workedExamples: [{ prompt: "p", answer: "a", analysisSteps: ["s"] }], commonMistakes: ["m"] } };
  assert.equal((await validate(input, { ...context(), request: { purpose: "focused" } })).ok, false);
  assert.equal((await validate({ ...draft(), purpose: "unknown" }, context())).ok, false);
});

test("malformed trusted sources and null student answers are rejected as structured issues", async () => {
  const validSource = (await validate(draft(), context())).snapshot.gradingSourcePackage;
  const input = { questions: validSource.questions.map((q, i) => ({ id: `q${i + 1}`, questionNo: q.questionNo, printedPrompt: q.prompt, studentAnswer: "2", score: 5, maxScore: 5, status: "correct", explanation: "correct", knowledgePoint: "addition" })) };
  const invalidTotal = buildGradingSourcePackage({ id: "bad-total", items: draft().questions, metadata: { totalScore: 999 } }).package;
  const invalidVersion = buildGradingSourcePackage({ id: "bad-version", items: draft().questions }, { version: 1.5 }).package;
  assert.equal(validateGradingSourcePackage(invalidTotal).ok, true);
  assert.equal(validateGradingSourcePackage(invalidVersion).ok, true);
  for (const source of [{ questions: {} }, { ...validSource, questions: [null] }, invalidTotal, invalidVersion, { ...validSource, version: 0 }]) {
    const checker = createTeachingWorkflowValidator({ resolveGradingSource: () => source });
    const result = await checker(input, context("grading"));
    assert.equal(result.ok, false); assert.ok(result.issues.some((issue) => issue.code === "GRADING_SOURCE_INVALID"));
  }
  const checker = createTeachingWorkflowValidator({ resolveGradingSource: () => validSource });
  assert.equal((await checker(input, context("grading"))).ok, true);
  input.questions[0].studentAnswer = null;
  const result = await checker(input, context("grading"));
  assert.ok(result.issues.some((issue) => issue.code === "GRADING_EVIDENCE_REQUIRED"));
  input.questions[0].studentAnswer = "";
  input.questions[0].score = 0; input.questions[0].status = "wrong";
  assert.equal((await checker(input, context("grading"))).ok, true);
});

test("AI revision rebuilds the answer package and an invalid result leaves the previous content intact", async () => {
  const repository = createTeachingWorkflowRepository(fakeWorkflowPrisma());
  let invalid = false;
  const service = createTeachingWorkflowService({ repository, validateSnapshot: validate, createDraft: async () => ({ snapshot: draft() }),
    runner: async ({ questions }) => ({ questions: questions.map((q) => ({ ...q, prompt: "2+2", answer: "4", analysisSteps: invalid ? [] : ["Add two and two."] })) }) });
  const actor = { teacherId: "teacher-1" };
  const created = await service.create({ actor, input: { module: "generation", requestKey: "ai", request: {} } });
  const revised = await service.execute({ actor, workflowId: created.workflowId, command: { action: "revise", operationKey: "ai-edit", expectedRevision: 2, targetQuestionIds: ["q1"], instruction: "Change to 2+2.",
    patch: { type: "replace_question", questionId: "q1", value: created.snapshot.questions[0] } } });
  assert.equal(revised.snapshot.gradingSourcePackage.version, 3);
  assert.equal(revised.snapshot.gradingSourcePackage.questions[0].correctAnswer, "4");
  assert.deepEqual(revised.snapshot.questions[1], created.snapshot.questions[1]);
  invalid = true;
  await assert.rejects(service.execute({ actor, workflowId: created.workflowId, command: { action: "revise", operationKey: "invalid", expectedRevision: 3, targetQuestionIds: ["q1"], instruction: "Remove analysis.",
    patch: { type: "replace_question", questionId: "q1", value: revised.snapshot.questions[0] } } }), { code: "WORKFLOW_SNAPSHOT_INVALID" });
  const current = await repository.get(created.workflowId, actor.teacherId);
  assert.equal(current.currentRevision, 3);
  assert.deepEqual(current.snapshot, revised.snapshot);
});

test("grading confirmation recalculates totals and source version changes cannot reuse a confirmation", async () => {
  let source = (await validate(draft(), context())).snapshot.gradingSourcePackage;
  const repository = createTeachingWorkflowRepository(fakeWorkflowPrisma());
  const seen = [];
  const regraded = [];
  const validator = createTeachingWorkflowValidator({ resolveGradingSource: async (ctx) => { seen.push(ctx); return source; } });
  const service = createTeachingWorkflowService({ repository, validateSnapshot: validator,
    runner: async ({ questions }) => {
      regraded.push(structuredClone(questions));
      return { questions: questions.map((q) => ({ ...q, status: "wrong", score: 0, explanation: "The corrected answer does not match the trusted reference." })) };
    }, createDraft: async () => ({ snapshot: {
    questions: source.questions.map((q, i) => ({ id: `q${i + 1}`, questionNo: q.questionNo, printedPrompt: q.prompt, studentAnswer: "2", status: "correct", score: 5, maxScore: 5, explanation: "Correct.", knowledgePoint: "addition" }))
  } }) });
  const actor = { teacherId: "teacher-1" };
  const created = await service.create({ actor, input: { module: "grading", requestKey: "scores", request: {} } });
  const confirmed = await service.execute({ actor, workflowId: created.workflowId, command: { action: "confirm", operationKey: "confirm", expectedRevision: 2, targetQuestionIds: ["q1", "q2"] } });
  assert.equal(confirmed.snapshot.finalScore, 10);
  assert.equal(confirmed.snapshot.archiveEligible, false);
  assert.ok(seen.every((ctx) => ctx.actor.teacherId === actor.teacherId));
  assert.equal(seen[1].nextRevision, 3);
  const edited = await service.execute({ actor, workflowId: created.workflowId, command: { action: "revise", operationKey: "score-edit", expectedRevision: 3,
    patch: { type: "replace_question", questionId: "q1", value: { ...confirmed.snapshot.questions[0], studentAnswer: "3", status: "wrong", score: 0 } } } });
  assert.equal(edited.snapshot.score, 5); assert.equal(edited.snapshot.finalScore, null);
  assert.equal(regraded.length, 1);
  assert.deepEqual(regraded[0].map((q) => q.id), ["q1"]);
  assert.equal(regraded[0][0].studentAnswer, "3");
  assert.equal(regraded[0][0].score, null);
  assert.equal(regraded[0][0].reviewedByTeacher, undefined);
  assert.equal(edited.snapshot.questions[1].reviewedByTeacher, true);
  source = (await validate(draft(), context("generation", 3))).snapshot.gradingSourcePackage;
  await assert.rejects(service.execute({ actor, workflowId: created.workflowId, command: { action: "confirm", operationKey: "stale-source", expectedRevision: 4, targetQuestionIds: ["q1"] } }), { code: "WORKFLOW_SNAPSHOT_INVALID" });
  assert.equal((await repository.get(created.workflowId, actor.teacherId)).currentRevision, 4);
});

test("creation normalizes AI question aliases without accepting model-supplied confirmations", async () => {
  for (const module of ["generation", "grading"]) {
    const source = (await validate(draft(), context())).snapshot.gradingSourcePackage;
    const input = module === "generation" ? draft() : { questions: source.questions.map((q, i) => ({ id: `q${i + 1}`, questionNo: q.questionNo, printedPrompt: q.prompt, studentAnswer: "2", status: "correct", score: 5, maxScore: 5, explanation: "Correct.", knowledgePoint: "addition" })) };
    input[module === "generation" ? "items" : "questionResults"] = input.questions.map((q) => ({ ...q, reviewedByTeacher: true, confirmedBy: "forged" }));
    delete input.questions;
    const service = createTeachingWorkflowService({ repository: createTeachingWorkflowRepository(fakeWorkflowPrisma()),
      validateSnapshot: createTeachingWorkflowValidator({ resolveGradingSource: async () => source }), createDraft: async () => ({ snapshot: input }) });
    const result = await service.create({ actor: { teacherId: "teacher-1" }, input: { module, requestKey: module, request: {} } });
    assert.equal(result.status, "ready_for_review");
    assert.equal(result.snapshot.questions.length, 2);
    assert.ok(result.snapshot.questions.every((q) => !q.reviewedByTeacher && !q.confirmedBy));
    if (module === "grading") { assert.equal(result.snapshot.finalScore, null); assert.equal(result.snapshot.needsTeacherReview, true); }
  }
});

test("uncertain results without a source cannot retain guessed answer or score standards", async () => {
  const q = { id: "q1", questionNo: "1", status: "uncertain", score: null, explanation: "Source is missing." };
  for (const fields of [{ correctAnswer: "2" }, { maxScore: 5 }]) {
    assert.equal((await validate({ questions: [{ ...q, ...fields }] }, context("grading"))).ok, false);
  }
});

test("shared material edits invalidate all dependent confirmations and leave unrelated ones intact", async () => {
  const original = draft();
  original.questions.push({ ...question("q3"), questionNo: "3" }); original.totalScore = 15;
  original.sharedMaterials = [{ id: "m1", text: "Read this passage." }];
  original.questions[0].sharedMaterialId = "m1"; original.questions[1].sharedMaterialId = "m1";
  const repository = createTeachingWorkflowRepository(fakeWorkflowPrisma());
  const service = createTeachingWorkflowService({ repository, validateSnapshot: validate, createDraft: async () => ({ request: {}, snapshot: original }) });
  const actor = { teacherId: "teacher-1" };
  const created = await service.create({ actor, input: { module: "generation", requestKey: "material", request: {} } });
  const execute = (command) => service.execute({ actor, workflowId: created.workflowId, command });
  await execute({ action: "confirm", operationKey: "confirm", expectedRevision: 2, targetQuestionIds: ["q1", "q2", "q3"] });
  const changed = await execute({ action: "revise", operationKey: "material-edit", expectedRevision: 3, patch: { type: "replace_shared_material", materialId: "m1", value: { id: "m1", text: "Read the changed passage." } } });
  assert.equal(changed.snapshot.questions[0].reviewedByTeacher, undefined);
  assert.equal(changed.snapshot.questions[1].reviewedByTeacher, undefined);
  assert.equal(changed.snapshot.questions[2].reviewedByTeacher, true);
  const source = changed.snapshot.gradingSourcePackage;
  assert.equal(source.questions[0].context.sharedMaterial.text, "Read the changed passage.");
  const tampered = structuredClone(source); tampered.questions[0].context.sharedMaterial.text = "forged";
  assert.equal(validateGradingSourcePackage(tampered).ok, false);
});

test("normalized teaching content strips raw payloads and checks Chinese teaching text", async () => {
  const input = draft(); input.rawOutput = "PRIVATE";
  input.questions[0].debug = { apiKey: "PRIVATE" };
  input.questions[0].prompt = "计算：1＋1＝多少？";
  input.questions[0].analysisSteps = ["先取一个，再加一个，一共有两个。"];
  input.questions[0].commonMistake = "不要把加法当作乘法。";
  const result = await validate(input, context());
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(JSON.stringify(result.snapshot).includes("PRIVATE"), false);
});
