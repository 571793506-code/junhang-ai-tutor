import test from "node:test";
import assert from "node:assert/strict";
import { prepareDialogueMaterial, registerDialogueMaterial, resolveDialogueStudent, reviewDialogueMaterial } from "./dialogue-material-source.mjs";
import { buildGradingSourcePackage, gradingSourcePackageToAssignmentItems, normalizeImportedGradingSourcePackage, validateGradingSourcePackage } from "../packages/core/src/grading-source-package.js";

const fixture = () => ({ schemaVersion: "local-exam-source-v1", version: 1, title: "合成试卷", subject: "数学", grade: "三年级上册",
  baseQuestionCount: 1, bonusQuestionCount: 1, baseScore: 2, bonusScore: 3,
  questions: [{ number: 5, kind: "choice", prompt: "1+1", answer: "B", score: 2, analysisSteps: ["两个一是二"],
    knowledgePoint: "加法", rubric: "选B得2分，否则0分", options: ["A.1", "B.2"] },
  { number: 9, kind: "bonus", prompt: "2+2", answer: "4", score: 3, analysisSteps: ["二加二得四"],
    knowledgePoint: "加法", rubric: "按原评分口径", numericChecks: [["2+2", 4]] }] });
test("legacy conversion preserves nonsequential numbers, options, bonus partition and immutable original", () => {
  const source = fixture(), before = structuredClone(source);
  const p = prepareDialogueMaterial(source, { sourceId: "paper", grade: "三年级" });
  assert.deepEqual(source, before);
  assert.equal(validateGradingSourcePackage(p).ok, true);
  assert.equal(p.baseScore, 2); assert.equal(p.bonusScore, 3); assert.equal(p.totalScore, 5);
  assert.deepEqual(p.questions.map(q => q.questionNo), ["5", "9"]);
  assert.deepEqual(p.questions[0].context.options, source.questions[0].options);
  assert.equal(p.questions[1].context.scoreGroup, "bonus");
  const persisted = buildGradingSourcePackage({ id: "paper", title: p.title, grade: p.grade,
    metadata: { kind: p.kind, subject: p.subject, totalScore: p.totalScore }, items: gradingSourcePackageToAssignmentItems(p) }).package;
  assert.equal(persisted.fingerprint, p.fingerprint);
  assert.deepEqual(persisted.questions, p.questions);
});
test("malformed partitions, unknown formats and missing choice options fail closed", () => {
  const wrong = fixture(); wrong.baseScore = 100;
  assert.throws(() => prepareDialogueMaterial(wrong), /SCORE_PARTITION/);
  const absent = fixture(); absent.questions[0].options = [];
  assert.throws(() => prepareDialogueMaterial(absent), /OPTIONS_MISSING/);
  assert.throws(() => prepareDialogueMaterial({ schemaVersion: "unknown" }), /SCHEMA_UNSUPPORTED/);
  const bad = fixture(); bad.questions[0].kind = "guessed";
  assert.throws(() => prepareDialogueMaterial(bad), /LOCAL_QUESTION/);
});
test("student matching rejects duplicate names and inactive targets", () => {
  assert.throws(() => resolveDialogueStudent([{ displayName: "同名" }, { displayName: "同名" }], "同名"), /AMBIGUOUS/);
  assert.throws(() => resolveDialogueStudent([{ id: "s", canReceiveNewWork: false }], "s"), /INACTIVE/);
});
test("authenticated registration replays unchanged material and creates a new identity for content changes", async () => {
  const assignments = [], packages = new Map(); let writes = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer private-test-token");
    if (url.pathname.endsWith("bootstrap")) return Response.json({ ok: true, teachers: [{ id: "t" }],
      students: [{ id: "s", displayName: "学生", grade: "三年级", canReceiveNewWork: true }], assignments });
    const body = JSON.parse(init.body), p = body.answerPackage;
    assert.equal(p.teacherReviewRequired, true);
    assert.equal(body.confirmedBy, undefined);
    const prior = assignments.find(a => a.id === body.assignmentId);
    if (prior) return Response.json({ ok: true, replayed: true, assignment: prior, gradingSourcePackage: packages.get(body.assignmentId) });
    writes++;
    const assignment = { id: body.assignmentId, studentId: body.studentId,
      gradingSource: { sourceId: p.sourceId, version: p.version, fingerprint: p.fingerprint }, gradingSourceQuestionCount: p.questions.length };
    assignments.push(assignment);
    packages.set(body.assignmentId, p);
    return Response.json({ ok: true, assignment, gradingSourcePackage: p }, { status: 201 });
  };
  const options = { baseUrl: "http://127.0.0.1:8787", sessionToken: "private-test-token", source: fixture(), studentIdentity: "学生", fetchImpl };
  const first = await registerDialogueMaterial(options);
  const second = await registerDialogueMaterial({ ...options, source: first.answerPackage });
  assert.equal(first.replayed, false); assert.equal(second.replayed, true); assert.equal(writes, 1);
  assert.equal(first.assignment.id, second.assignment.id);
  const unordered = normalizeImportedGradingSourcePackage({ ...first.answerPackage, questions: first.answerPackage.questions.toReversed() }).package;
  const third = await registerDialogueMaterial({ ...options, source: unordered });
  assert.equal(third.assignment.id, first.assignment.id);
  assert.equal(writes, 1);
  options.source.questions[0].prompt = "改后的题干";
  const revision = await registerDialogueMaterial(options);
  assert.notEqual(revision.assignment.id, first.assignment.id); assert.equal(writes, 2);
  assignments[1].gradingSource.fingerprint = "changed";
  await assert.rejects(registerDialogueMaterial(options), /REGISTERED_SOURCE_MISMATCH/);
});

test("grade-scope dialogue registration never assigns a student and remains pending review", async () => {
  let registration;
  const fetchImpl = async (url, init) => {
    if (url.pathname.endsWith("bootstrap")) return Response.json({ ok: true, teachers: [{ id: "t1" }],
      students: [{ id: "s1", displayName: "学生", grade: "三年级", canReceiveNewWork: true }] });
    registration = JSON.parse(init.body);
    return Response.json({ ok: true, assignment: { id: registration.assignmentId, studentId: null, targetScope: "grade",
      targetGrade: "三年级", draftReviewStatus: "pending_teacher_review", gradingEligible: false,
      gradingSource: { fingerprint: registration.answerPackage.fingerprint }, gradingSourceQuestionCount: registration.answerPackage.questions.length },
      gradingSourcePackage: registration.answerPackage });
  };
  const result = await registerDialogueMaterial({ baseUrl: "http://127.0.0.1:8787", sessionToken: "token",
    source: fixture(), scope: "grade", fetchImpl });
  assert.equal(registration.studentId, undefined);
  assert.equal(registration.targetGrade, "三年级上册");
  assert.equal(result.assignment.gradingEligible, false);
  assert.equal(result.scope, "grade");
});

test("conversation review client records only a fingerprint-bound explicit teacher decision", async () => {
  const receipt = { syncStatus: "registered", assignmentId: "paper", gradingSource: { fingerprint: "fingerprint-1" } };
  let request;
  const result = await reviewDialogueMaterial({ baseUrl: "http://127.0.0.1:8787", sessionToken: "token", receipt,
    decision: "accept", note: "教师已审查，内容可用于批改。", fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return Response.json({ ok: true, replayed: false, assignment: { id: "paper", draftReviewStatus: "accepted",
        gradingEligible: true, gradingSource: { fingerprint: "fingerprint-1" } } });
    } });
  assert.equal(request.url.pathname, "/api/grading/source-packages/dialogue/paper/review");
  assert.deepEqual(request.body, { decision: "accept", fingerprint: "fingerprint-1", note: "教师已审查，内容可用于批改。" });
  assert.equal(result.gradingEligible, true);
  assert.equal(result.replayed, false);
});
