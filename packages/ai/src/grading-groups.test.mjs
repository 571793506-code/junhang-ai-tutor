import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildGradingSourcePackage } from "@junhang/core";
import { gradeSubmissionText, generateSubmissionReferenceAnswers } from "./runtime.js";

function fixture(count = 29) {
  const source = buildGradingSourcePackage({ id: "group-source", items: Array.from({ length: count }, (_, i) => ({
    orderIndex: i + 1, prompt: `计算 ${i + 1}+1`, answer: String(i + 2), score: 5,
    rubric: "方法2分、计算2分、结果1分。", analysisSteps: ["按题目计算。"],
    sourceContext: { itemType: "calculation", sharedMaterial: { id: "shared", text: "完整的跨题材料" } }
  })) }).package;
  return { gradingSourcePackage: source, teacherContext: "允许正确的其他方法。", manualText: "保留全卷补充证据。",
    questionLayoutManifest: { questionCount: count, questions: source.questions.map(q => ({ questionNo: q.questionNo, page: 1 })) },
    referenceAnswers: source.questions.map(q => ({ questionNo: q.questionNo, prompt: q.prompt, correctAnswer: q.correctAnswer, score: q.maxScore })),
    ocrQuestions: source.questions.map(q => ({ questionNo: q.questionNo, printedText: q.prompt,
      studentAnswer: q.correctAnswer, observedWork: `${q.prompt}=${q.correctAnswer}`, confidence: 1, bbox: { page: 1, x: 0, y: 0, w: 1, h: 1 } })) };
}

const response = (input, uncertain = false) => ({ text: JSON.stringify({
  summary: "本组待教师复核。", strengths: ["方法正确。"], nextPractice: "核对计算。",
  questionResults: (input.gradingQuestionNos || input.ocrQuestions.map(q => q.questionNo)).toReversed().map(questionNo => ({
    questionNo, status: uncertain ? "uncertain" : "correct", score: uncertain ? null : 5, maxScore: 5,
    explanation: uncertain ? "评分细则待确认。" : "方法及计算正确。"
  }))
}) });

test("completed grading groups survive a failed peer and recovery calls only the missing group", async () => {
  const input = fixture(); const units = {}; const saved = [];
  const checkpoint = { units, binding: { evidence: "original" }, save: async (id, value) => { units[id] = structuredClone(value); saved.push(id); } };
  const first = await gradeSubmissionText({}, input, { checkpoint, call: async (_route, messages) => {
    const sent = JSON.parse(messages[1].content);
    if (!sent.gradingQuestionNos.includes("1")) throw Object.assign(new Error("unavailable"), { status: 403 });
    return response(sent);
  } });
  assert.equal(first.available, false); assert.equal(first.gradingText, "");
  assert.deepEqual(saved, ["grading-1"]);
  const before = structuredClone(units); const calls = [];
  const recovered = await gradeSubmissionText({}, input, { checkpoint, call: async (_route, messages) => {
    const sent = JSON.parse(messages[1].content); calls.push(sent.gradingQuestionNos); return response(sent);
  } });
  assert.equal(recovered.available, true);
  assert.deepEqual(calls, [input.ocrQuestions.slice(15).map(q => q.questionNo)]);
  assert.equal(JSON.parse(recovered.gradingText).questionResults.length, 29);
  assert.equal(JSON.parse(recovered.gradingText).needsTeacherReview, true);
  assert.deepEqual(units["grading-1"], before["grading-1"]);
  assert.deepEqual(recovered.modelRun.metadata.checkpointReusedUnits, ["grading-1"]);
});

test("changed teacher requirements, OCR, evidence binding or model policy invalidate grading checkpoints", async () => {
  const input = fixture(); const units = {};
  await gradeSubmissionText({}, input, { checkpoint: { units, binding: "original", save: async (id, value) => { units[id] = value; } },
    call: async (_route, messages) => response(JSON.parse(messages[1].content)) });
  assert.equal(Object.keys(units).length, 2);
  for (const change of [
    { input: { ...input, teacherContext: "教师改为只评分首次作答。" } },
    { input: { ...input, ocrQuestions: input.ocrQuestions.map((q, i) => i ? q : { ...q, observedWork: "不同的学生过程" }) } },
    { input: { ...input, questionLayoutManifest: { ...input.questionLayoutManifest, questionCount: 30 } } },
    { binding: "different-original-image" },
    { config: { teachingPrimaryModel: "different-test-model" } },
    { corrupt: true }
  ]) {
    const cached = structuredClone(units); let calls = 0;
    if (change.corrupt) cached["grading-1"].candidate.questionResults = [];
    const result = await gradeSubmissionText(change.config || {}, change.input || input, {
      checkpoint: { units: cached, binding: change.binding || "original", save: async () => {} },
      call: async (_route, messages) => { calls++; return response(JSON.parse(messages[1].content)); }
    });
    assert.equal(result.available, true); assert.equal(calls, change.corrupt ? 1 : 2);
  }
});

test("checkpoint identity ignores only the derived layout creation time on short and grouped grading", async () => {
  for (const count of [4, 29]) {
    const input = fixture(count); const units = {};
    input.questionLayoutManifest.generatedAt = "2026-11-03T01:00:00Z";
    const checkpoint = { units, save: async (id, value) => { units[id] = structuredClone(value); } };
    await gradeSubmissionText({}, input, { checkpoint, call: async (_route, messages) => response(JSON.parse(messages[1].content)) });
    input.questionLayoutManifest.generatedAt = "2026-11-03T01:01:00Z";
    let calls = 0;
    const recovered = await gradeSubmissionText({}, input, { checkpoint, call: async (_route, messages) => { calls++; return response(JSON.parse(messages[1].content)); } });
    assert.equal(recovered.available, true); assert.equal(calls, 0);
    assert.equal(recovered.modelRun.metadata.checkpointReusedUnits.length, count === 4 ? 1 : 2);
  }
});

test("checkpoint persistence failure stops grading instead of reporting a complete draft", async () => {
  await assert.rejects(gradeSubmissionText({}, fixture(), {
    checkpoint: { units: {}, save: async () => { throw Object.assign(new Error("stale"), { code: "WORKFLOW_CHECKPOINT_STALE" }); } },
    call: async (_route, messages) => response(JSON.parse(messages[1].content))
  }), { code: "WORKFLOW_CHECKPOINT_STALE" });
});

test("a changed runtime rule hash invalidates completed grading groups", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "junhang-grading-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "skills/grading/references");
  await mkdir(directory, { recursive: true });
  const rules = path.join(directory, "runtime-rules.md");
  await writeFile(rules, "# grading-v1\nRequire teacher review.\n", "utf8");
  const units = {}; const input = fixture();
  const checkpoint = { units, save: async (id, value) => { units[id] = structuredClone(value); } };
  await gradeSubmissionText({}, input, { ruleRoot: root, checkpoint,
    call: async (_route, messages) => response(JSON.parse(messages[1].content)) });
  assert.equal(Object.keys(units).length, 2);
  await writeFile(rules, "# grading-v1\nRequire teacher review and inspect original work.\n", "utf8");
  let calls = 0;
  const result = await gradeSubmissionText({}, input, { ruleRoot: root, checkpoint,
    call: async (_route, messages) => { calls++; return response(JSON.parse(messages[1].content)); } });
  assert.equal(result.available, true); assert.equal(calls, 2);
  assert.deepEqual(result.modelRun.metadata.checkpointReusedUnits, []);
});

test("long grading runs two bounded primary groups with complete shared evidence and ordered merge", async () => {
  const input = fixture();
  const before = structuredClone(input);
  let active = 0, peak = 0;
  const calls = [];
  let release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(release, 2000);
  const result = await gradeSubmissionText({}, input, { now: () => 0, call: async (route, messages, options) => {
    const sent = JSON.parse(messages[1].content);
    calls.push({ sent, options, contract: messages[0].content, route });
    peak = Math.max(peak, ++active);
    if (calls.length === 2) { clearTimeout(timer); release(); }
    await bothStarted;
    active--;
    return response(sent);
  } });
  clearTimeout(timer);
  calls.sort((a, b) => Number(a.sent.gradingQuestionNos[0]) - Number(b.sent.gradingQuestionNos[0]));
  assert.equal(calls.length, 2);
  assert.equal(peak, 2);
  assert.deepEqual(calls.map(c => c.sent.gradingQuestionNos.length), [15, 14]);
  assert.deepEqual(calls.flatMap(c => c.sent.gradingQuestionNos), input.ocrQuestions.map(q => q.questionNo));
  for (const call of calls) {
    assert.equal(call.options.maxTokens, 4500);
    assert.equal(call.options.timeoutMs, 180000);
    assert.equal(call.route.model, "gpt-6.1-sol");
    assert.match(call.contract, /gradingQuestionNos/);
    assert.deepEqual(call.sent.ocrQuestions, input.ocrQuestions);
    assert.equal(call.sent.referenceAnswers.length, 29);
    assert.equal(call.sent.referenceAnswers[0].context.sharedMaterial.text, "完整的跨题材料");
    assert.equal(call.sent.manualText, input.manualText);
    assert.equal(call.sent.teacherContext, input.teacherContext);
    assert.deepEqual(call.sent.questionLayoutManifest, input.questionLayoutManifest);
    assert.equal(call.sent.gradingSourcePackage, undefined);
  }
  assert.equal(result.available, true);
  const parsed = JSON.parse(result.gradingText);
  assert.equal(parsed.score, 145);
  assert.equal(parsed.needsTeacherReview, true);
  assert.deepEqual(parsed.questionResults.map(q => q.questionNo), input.ocrQuestions.map(q => q.questionNo));
  assert.deepEqual(parsed.questionResults.map(q => q.studentAnswer), input.ocrQuestions.map(q => q.studentAnswer));
  assert.equal(new Set(result.modelRun.metadata.attempts.map(a => a.partitionId)).size, 2);
  assert.deepEqual(input, before);
});

test("two invalid groups share exactly one repair and cannot publish a partial paper", async () => {
  const calls = [];
  const result = await gradeSubmissionText({}, fixture(), { call: async (_route, messages, options) => {
    calls.push({ sent: JSON.parse(messages[1].content), options });
    await new Promise(resolve => setImmediate(resolve));
    return { text: "{" };
  } });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.options.maxTokens).sort((a,b) => a-b), [3000, 4500, 4500]);
  assert.equal(result.modelRun.metadata.attempts.filter(a => a.role === "quality-repair").length, 1);
  assert.equal(result.available, false);
  assert.equal(result.gradingText, "");
});

test("one invalid group repairs only its targets within the original reduced operation pool", async () => {
  const calls = [], seen = new Set();
  const operationBudget = { deadlineAt: 90000, remainingTokens: 8000 };
  const result = await gradeSubmissionText({}, fixture(), { now: () => 1000, operationBudget,
    call: async (_route, messages, options) => {
      const input = JSON.parse(messages[1].content);
      calls.push(options);
      const key = input.gradingQuestionNos?.join(",");
      const invalid = input.gradingQuestionNos?.includes("1") && !seen.has(key);
      seen.add(key);
      await new Promise(resolve => setImmediate(resolve));
      return invalid ? { text: "{" } : response(input);
    }
  });
  assert.equal(result.available, true);
  assert.deepEqual(calls.map(c => c.maxTokens).sort((a,b) => a-b), [2000, 3000, 3000]);
  assert.ok(calls.every(c => c.timeoutMs === 89000));
  assert.equal(operationBudget.remainingTokens, 0);
});

test("missing, duplicate or cross-group question IDs never merge into a complete grading result", async () => {
  for (const mode of ["missing", "duplicate", "cross-group"]) {
    let calls = 0;
    const result = await gradeSubmissionText({}, fixture(), { call: async (_route, messages) => {
      calls++;
      const input = JSON.parse(messages[1].content);
      const result = JSON.parse(response(input).text);
      if (input.gradingQuestionNos?.includes("1")) {
        if (mode === "missing") result.questionResults.pop();
        else result.questionResults[0].questionNo = mode === "duplicate" ? "1" : "29";
      }
      return { text: JSON.stringify(result) };
    } });
    assert.equal(result.available, false, mode);
    assert.equal(result.gradingText, "", mode);
    assert.equal(calls, 3, mode);
  }
});

test("a complete grouped draft still has null total when any judgment is uncertain", async () => {
  const result = await gradeSubmissionText({}, fixture(), { call: async (_route, messages) => response(JSON.parse(messages[1].content), true) });
  assert.equal(result.available, true);
  assert.equal(JSON.parse(result.gradingText).score, null);
});

test("group replies after the shared deadline cannot return scores or start repair", async () => {
  let time = 0, calls = 0, release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  const result = await gradeSubmissionText({}, fixture(), { now: () => time, call: async (_route, messages) => {
    const input = JSON.parse(messages[1].content);
    if (++calls === 2) release();
    await bothStarted;
    time = 180001;
    return response(input);
  } });
  assert.equal(calls, 2);
  assert.equal(result.available, false);
  assert.equal(result.gradingText, "");
  assert.equal(result.modelRun.metadata.attempts.filter(a => a.role !== "primary").length, 0);
});

test("short grading, unverified sources and reference generation keep their single-unit path", async () => {
  for (const mode of ["short", "invalid-source", "conflicting-reference", "reference"]) {
    const input = fixture(mode === "short" ? 4 : 29);
    if (mode === "invalid-source") input.gradingSourcePackage.fingerprint = "invalid";
    if (mode === "conflicting-reference") input.referenceAnswers[0].correctAnswer = "conflict";
    let calls = 0;
    const result = await (mode === "reference" ? generateSubmissionReferenceAnswers : gradeSubmissionText)({}, input, {
      call: async (_route, messages) => {
        calls++;
        const sent = JSON.parse(messages[1].content);
        assert.equal(sent.gradingQuestionNos, undefined);
        return mode === "reference" ? { text: JSON.stringify({ referenceAnswers: input.referenceAnswers.map(q => ({...q, analysisSteps:["计算。"]})) }) } : response(sent);
      }
    });
    assert.equal(result.available, true, mode);
    assert.equal(calls, 1, mode);
  }
});

test("cancelling grouped grading aborts both calls and late replies cannot produce a draft", async () => {
  const controller = new AbortController();
  const pending = [], signals = [];
  let started;
  const bothStarted = new Promise(resolve => { started = resolve; });
  const run = gradeSubmissionText({}, fixture(), { signal: controller.signal, call: (_route, messages, options) => {
    signals.push(options.signal);
    const input = JSON.parse(messages[1].content);
    return new Promise(resolve => {
      pending.push(() => resolve(response(input)));
      if (pending.length === 2) started();
    });
  } });
  // A timeout is a failure guard, not simulated successful cancellation.
  const ready = await Promise.race([bothStarted.then(() => true), new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 2000);
    bothStarted.finally(() => clearTimeout(timer));
  })]);
  controller.abort(new Error("teacher cancelled"));
  await assert.rejects(run, /teacher cancelled/);
  assert.equal(ready, true, "both groups must start before cancellation");
  assert.ok(signals.every(signal => signal.aborted));
  pending.forEach(resolve => resolve());
});
