import assert from "node:assert/strict";
import test from "node:test";
import { gradeSubmissionService } from "./index.js";
import { buildGradingSourcePackage } from "@junhang/core";

test("verified source package choice type wins over conflicting OCR and legacy assignment types", async () => {
  const source = buildGradingSourcePackage({ id: "choice-source", items: [{ orderIndex: "6", prompt: "选择正确结果。",
    answer: "C", score: 2, rubric: "按结构、过程与结果综合判分。", sourceContext: { itemType: "choice" } }] }).package;
  let calls = 0;
  const result = await gradeSubmissionService({}, { subject: "数学", totalScore: 2, gradingSourcePackage: source,
    assignmentItems: [{ questionNo: "6", itemType: "calculation", prompt: "选择正确结果。", answer: "C", score: 2, rubric: "按步骤评分。" }],
    ocrQuestions: [{ questionNo: "6", itemType: "calculation", studentAnswer: "D", observedWork: "草稿计算", confidence: 1 }]
  }, { persist: false, gradingRunner: async () => { calls++; return { available: false, gradingText: "" }; } });
  assert.equal(calls, 0);
  assert.equal(result.structured.questionResults[0].score, 0);
  assert.equal(result.structured.questionResults[0].status, "wrong");
});

test("process grading keeps original recognition evidence through the service boundary", async () => {
  let received;
  const observedWork = "=30×20+2×4\n=768";
  const result = await gradeSubmissionService({}, {
    subject: "数学", totalScore: 5,
    referenceAnswers: [{ questionNo: "23", prompt: "32×24", correctAnswer: "768", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "23", printedPrompt: "32×24=(30+2)×(20+4)", studentAnswer: "768",
      observedWork, confidence: 0.96, itemType: "calculation", page: 2,
      sourceImageRef: "page-2", cropRef: "q23", bbox: { page: 2, x: 0.4, y: 0.5, w: 0.4, h: 0.3 } }]
  }, { persist: false, gradingRunner: async (_config, input) => {
    received = input;
    return { available: true, gradingText: JSON.stringify({ questionResults: [{ questionNo: "23", studentAnswer: "768",
      status: "partial", score: 2, maxScore: 5, confidence: 0.96, explanation: "展开漏项，最终结果不能代替过程。" }] }) };
  }});
  assert.ok(received, "A matching final answer must not skip process grading");
  const question = received.ocrQuestions[0];
  assert.equal(question.observedWork, observedWork);
  assert.equal(question.printedText, "32×24=(30+2)×(20+4)");
  assert.equal(question.sourceImageRef, "page-2");
  assert.equal(question.cropRef, "q23");
  assert.equal(question.page, 2);
  assert.equal(question.itemType, "calculation");
  assert.equal(result.structured.questionResults[0].status, "partial");
  assert.equal(result.structured.questionResults[0].score, 2);
});

test("explicit unknown recognition remains null and original work reaches the grader", async () => {
  let received;
  await gradeSubmissionService({}, {
    subject: "数学", totalScore: 5,
    referenceAnswers: [{ questionNo: "1", prompt: "说明计算方法。", correctAnswer: "10", score: 5, confidence: 1 }],
    ocrQuestions: [{ questionNo: "1", printedPrompt: "说明计算方法。", studentAnswer: null,
      answer: "must-not-fill-missing-recognition", observedWork: "840÷84", confidence: null, page: 3, sourceImageRef: "page-3" }]
  }, { persist: false, gradingRunner: async (_config, input) => {
    received = input;
    return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
  }});
  assert.equal(received.ocrQuestions[0].studentAnswer, null);
  assert.equal(received.ocrQuestions[0].confidence, null);
  assert.equal(received.ocrQuestions[0].observedWork, "840÷84");
  assert.equal(received.ocrQuestions[0].bbox, null, "No source coordinates must remain unknown");
});

test("trusted process rubric prevents local full marks even when no work was recognized", async () => {
  let calls = 0;
  await gradeSubmissionService({}, {
    subject: "数学", totalScore: 5,
    assignmentItems: [{ questionNo: "1", prompt: "32×24", answer: "768", score: 5, rubric: "按结构、过程与结果综合判分。" }],
    ocrQuestions: [{ questionNo: "1", printedText: "32×24", studentAnswer: "768", confidence: 0.96 }]
  }, { persist: false, gradingRunner: async () => {
    calls++;
    return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
  }});
  assert.equal(calls, 1);
});

test("a confirmed choice is scored by option despite a legacy process rubric", async () => {
  for (const [studentAnswer, expectedScore] of [["D", 0], ["C", 2]]) {
    let calls = 0;
    const result = await gradeSubmissionService({}, {
      subject: "数学", totalScore: 2,
      assignmentItems: [{ questionNo: "6", itemType: "choice", prompt: "计算结果是（ ）。", answer: "C", score: 2,
        rubric: "按结构、过程与结果综合判分。" }],
      ocrQuestions: [{ questionNo: "6", printedPrompt: "计算结果是（ ）。", studentAnswer,
        itemType: "choice", confidence: 1 }]
    }, { persist: false, gradingRunner: async () => {
      calls++;
      return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    } });
    assert.equal(calls, 0);
    assert.equal(result.structured.questionResults[0].score, expectedScore);
    assert.equal(result.structured.questionResults[0].status, expectedScore ? "correct" : "wrong");
    assert.equal(result.structured.needsTeacherReview, true);
  }
});

test("trusted calculation and solution types retain process scoring without OCR type hints", async () => {
  for (const itemType of ["calculation", "solution"]) {
    let calls = 0;
    await gradeSubmissionService({}, {
      subject: "数学", totalScore: 5,
      assignmentItems: [{ questionNo: "1", itemType, prompt: "32×24", answer: "768", score: 5 }],
      ocrQuestions: [{ questionNo: "1", studentAnswer: "768", confidence: 1, itemType: "choice" }]
    }, { persist: false, gradingRunner: async () => {
      calls++;
      return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    } });
    assert.equal(calls, 1, "OCR type must not override the trusted process question type");
  }
});

test("choice scoring preserves uncertainty for missing, ambiguous or low-confidence recognition", async () => {
  for (const [studentAnswer, confidence] of [[null, 1], ["CD", 1], ["C", null], ["D", 0.4]]) {
    let calls = 0;
    const result = await gradeSubmissionService({}, {
      subject: "数学", totalScore: 2,
      assignmentItems: [{ questionNo: "6", itemType: "choice", prompt: "选出结果。", answer: "C", score: 2 }],
      ocrQuestions: [{ questionNo: "6", studentAnswer, confidence }]
    }, { persist: false, gradingRunner: async () => {
      calls++;
      return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    } });
    assert.equal(calls, 1);
    assert.equal(result.structured.questionResults[0].score, null);
  }
});

test("explicit fill and judgment questions do not acquire process points from legacy prose", async () => {
  for (const itemType of ["fill", "judgment"]) {
    let calls = 0;
    const result = await gradeSubmissionService({}, {
      subject: "数学", totalScore: 2,
      assignmentItems: [{ questionNo: "1", itemType, prompt: "填入结果。", answer: "4", score: 2, rubric: "按结构、过程与结果综合判分。" }],
      ocrQuestions: [{ questionNo: "1", studentAnswer: "4", observedWork: "2+2=4", confidence: 1 }]
    }, { persist: false, gradingRunner: async () => {
      calls++;
      return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    } });
    assert.equal(calls, 0);
    assert.equal(result.structured.questionResults[0].score, 2);
  }
});

test("recovered work reaches the real model HTTP payload without grading confirmation labels", async () => {
  const { createServer } = await import("node:http");
  const bodies = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questionResults: [{
      questionNo: "24", status: "correct", score: 5, maxScore: 5, studentAnswer: "112本", correctAnswer: "112本",
      explanation: "列式、计算、单位及答语完整。", confidence: 0.95
    }] }) } }], usage: { completion_tokens: 40 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const work = "16×25-6×48=400-288=112（本）\n答：还剩112本。";
  try {
    const result = await gradeSubmissionService({ GPT56_API_KEY: "synthetic", GPT56_BASE_URL: `http://127.0.0.1:${server.address().port}` }, {
      subject: "数学", totalScore: 5,
      assignmentItems: [{ questionNo: "24", prompt: "16包书，每包25本，借出6班各48本，还剩多少本？", answer: "112本", score: 5, rubric: "列式2分、计算2分、单位和答语1分。" }],
      ocrQuestions: [{ questionNo: "24", printedPrompt: "16包书，每包25本，借出6班各48本，还剩多少本？", studentAnswer: "112本", observedWork: work,
        confidence: null, page: 3, sourceImageRef: "page-3", cropRef: "q24", teacherReview: { confirmedBy: "must-not-send" } }]
    }, { persist: false });
    assert.equal(bodies.length, 1);
    const payload = JSON.parse(bodies[0].messages.find(message => message.role === "user").content);
    assert.equal(payload.ocrQuestions[0].observedWork, work);
    assert.equal(payload.ocrQuestions[0].confidence, null);
    assert.equal(payload.ocrQuestions[0].cropRef, "q24");
    assert.equal(payload.ocrQuestions[0].page, 3);
    assert.equal(payload.ocrQuestions[0].bbox, null);
    assert.equal(payload.questionLayoutManifest.questions[0].page, 3);
    assert.equal(payload.questionLayoutManifest.questions[0].bbox, null);
    assert.doesNotMatch(JSON.stringify(bodies), /must-not-send|teacherReview/);
    assert.equal(result.available, true);
    assert.equal(result.structured.needsTeacherReview, true);
    assert.equal(result.structured.questionResults[0].bbox, null);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("invalid recognition boxes never become estimated locations", async () => {
  for (const bbox of [{}, { page: 1, x: null, y: 0.2, w: 0.3, h: 0.1 }, { page: 1, x: 0.9, y: 0.2, w: 0.3, h: 0.1 }]) {
    let received;
    await gradeSubmissionService({}, {
      subject: "数学", totalScore: 5,
      referenceAnswers: [{ questionNo: "1", prompt: "说明计算方法。", correctAnswer: "10", score: 5, confidence: 1 }],
      ocrQuestions: [{ questionNo: "1", printedText: "说明计算方法。", studentAnswer: "10", confidence: 0.96, bbox }]
    }, { persist: false, gradingRunner: async (_config, input) => {
      received = input;
      return { available: false, gradingText: "", error: "TEACHING_EVIDENCE_MISSING" };
    }});
    assert.equal(received.ocrQuestions[0].bbox, null);
    assert.equal(received.questionLayoutManifest.questions[0].bbox, null);
  }
});

test("fully objective grading uses known answers without remote grading", async () => {
  let gradingCalls = 0;
  let solCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "数学",
      kind: "小测",
      totalScore: 10,
      answerKey: "1=A;2=42",
      studentAnswerText: "1. a。 2. 42.0",
      printedText: "1. 选择正确答案。 2. 6*7=?"
    },
    {
      persist: false,
      gradingRunner: async () => {
        gradingCalls += 1;
        throw new Error("remote grading should not run");
      },
      solGradingRunner: async () => {
        solCalls += 1;
        throw new Error("Sol grading should not run");
      }
    }
  );

  assert.equal(gradingCalls, 0);
  assert.equal(solCalls, 0);
  assert.equal(result.referenceAnswer.mode, "answer_key");
  assert.equal(result.persisted.referenceModelRunId, null);
  assert.equal(result.structured.score, 10);
  assert.deepEqual(result.structured.questionResults.map((item) => item.status), ["correct", "correct"]);
});

test("objective grading extracts the final numeric answer from calculation work", async () => {
  let gradingCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "数学",
      kind: "小测",
      totalScore: 2,
      referenceAnswers: [{ questionNo: "1", prompt: "360÷6+85 = ___", correctAnswer: "145", score: 2, confidence: 1 }],
      ocrQuestions: [{ questionNo: "1", printedText: "360÷6+85 = ___", studentAnswer: "360÷6=60；60+85=145", confidence: 0.95 }]
    },
    {
      persist: false,
      gradingRunner: async () => {
        gradingCalls += 1;
        throw new Error("remote grading should not run");
      }
    }
  );

  assert.equal(gradingCalls, 0);
  assert.equal(result.structured.questionResults[0].status, "correct");
  assert.equal(result.structured.questionResults[0].score, 2);
});

test("multi-blank and nonliteral text answers reach semantic grading while single objective answers stay local", async () => {
  const orderPrompt = "计算720÷[15×(14-8)]时，先算（ ），再算（ ），最后算（ ），结果是（ ）。";
  const inputs = [
    { questionNo: "1", prompt: orderPrompt, answer: ["14-8", "15×6", "720÷90", "8"], studentAnswer: "小括号；中括号；除法；80" },
    { questionNo: "2", prompt: orderPrompt, answer: "14-8,15×6,720÷90,8", studentAnswer: "14-8,15×6,720÷90,8" },
    { questionNo: "3", prompt: orderPrompt, answer: "14-8；15×6；720÷90；8", studentAnswer: "小括号；中括号；除法；80" },
    { questionNo: "4", prompt: "先算（ ）。", answer: "小括号内", studentAnswer: "小括号" },
    { questionNo: "5", prompt: "填数（ ）和（ ）。", answer: "8", studentAnswer: "8" },
    { questionNo: "6", prompt: "6×7=（ ）", answer: "42", studentAnswer: "41" },
    { questionNo: "7", itemType: "choice", prompt: "选择正确选项。", answer: "D", studentAnswer: "D" }
  ];
  let received;
  let calls = 0;
  const result = await gradeSubmissionService({}, {
    subject: "数学", totalScore: 14,
    assignmentItems: inputs.map(q => ({ questionNo: q.questionNo, prompt: q.prompt, answer: q.answer, score: 2, itemType: q.itemType || "fill" })),
    ocrQuestions: inputs.map(q => ({ questionNo: q.questionNo, printedText: q.prompt, studentAnswer: q.studentAnswer, confidence: 1 }))
  }, { persist: false, gradingRunner: async (_config, input) => {
    calls++;
    received = input;
    return { available: true, gradingText: JSON.stringify({ questionResults: input.ocrQuestions.map(q => ({
      questionNo: q.questionNo, status: q.questionNo === "1" ? "partial" : "uncertain",
      score: q.questionNo === "1" ? 1.5 : null, maxScore: 2, confidence: 1,
      explanation: "路由契约测试：保留语义批改结果及待裁定状态。"
    })) }) };
  }});
  assert.equal(calls, 1);
  assert.deepEqual(received.ocrQuestions.map(q => q.questionNo), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(received.ocrQuestions.map(q => q.studentAnswer), inputs.slice(0, 5).map(q => q.studentAnswer));
  assert.deepEqual(received.referenceAnswers.map(q => q.correctAnswer), inputs.slice(0, 5).map(q => String(q.answer)));
  assert.deepEqual(result.structured.questionResults.map(q => [q.questionNo, q.status, q.score]), [
    ["1", "partial", 1.5], ["2", "uncertain", null], ["3", "uncertain", null],
    ["4", "uncertain", null], ["5", "uncertain", null], ["6", "wrong", 0], ["7", "correct", 2]
  ]);
});

test("low-confidence references remain teacher-review drafts without a service retry", async () => {
  const executions = [];
  const referenceAnswerRunner = async (_config, _input, execution) => {
    executions.push(execution || null);
    const isSol = execution?.role === "sol-reference-escalation";
    return {
      available: true,
      providerId: "gpt56",
      referenceText: JSON.stringify({
        referenceAnswers: [{ questionNo: "1", prompt: "1+1=?", correctAnswer: "2", confidence: isSol ? 0.99 : 0.5 }],
        confidence: isSol ? 0.99 : 0.5,
        needsTeacherReview: !isSol
      }),
      modelRun: { provider: "gpt56", model: isSol ? "gpt-5.6-sol" : "gpt-5.6", status: "SUCCESS" }
    };
  };
  const commonOptions = {
    persist: false,
    referenceAnswerRunner,
    gradingRunner: async () => ({
      available: true,
      providerId: "gpt56",
      gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
    })
  };

  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol", GPT56_SOL_FALLBACK_TIMEOUT_MS: "180000" },
    { subject: "数学", totalScore: 5, printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    commonOptions
  );
  assert.equal(executions.length, 1);
  assert.ok(executions[0].operationBudget);
  assert.equal(result.referenceAnswer.confidence, 0.5);
  assert.equal(result.referenceAnswer.needsTeacherReview, true);

  executions.length = 0;
  await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { subject: "数学", ocrText: "混合OCR内容", studentAnswerText: "1. 2" },
    commonOptions
  );
  assert.equal(executions.length, 1);
});

test("a prior runtime Sol reference attempt is never repeated by the quality gate", async () => {
  let referenceCalls = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { subject: "数学", printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    {
      persist: false,
      referenceAnswerRunner: async () => {
        referenceCalls += 1;
        return {
          available: true,
          providerId: "gpt56",
          referenceText: JSON.stringify({ referenceAnswers: [{ questionNo: "1", correctAnswer: "2", confidence: 0.5 }] }),
          modelRun: {
            provider: "gpt56",
            model: "gpt-5.6",
            status: "SUCCESS",
            metadata: { solAttempted: true, usedModelEscalation: false }
          }
        };
      },
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
      })
    }
  );

  assert.equal(referenceCalls, 1);
  assert.equal(result.referenceAnswer.solAttempted, true);
  assert.equal(result.referenceAnswer.usedModelEscalation, false);
});

test("reference service persists only the bounded runtime result", async () => {
  let callCount = 0;
  let runId = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { assignmentId: "existing-assignment", subject: "数学", printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    {
      prisma: { modelRun: { create: async ({ data }) => ({ id: `run-${++runId}`, ...data }) } },
      referenceAnswerRunner: async (_config, _input, execution) => {
        callCount += 1;
        if (execution?.role === "sol-reference-escalation") {
          return {
            available: false,
            providerId: "gpt56",
            referenceText: "",
            error: "MODEL_TIMEOUT",
            modelRun: { provider: "gpt56", model: "gpt-5.6-sol", skill: "submission-reference-answer", status: "ERROR" }
          };
        }
        return {
          available: true,
          providerId: "gpt56",
          referenceText: JSON.stringify({ referenceAnswers: [{ questionNo: "1", prompt: "1+1=?", correctAnswer: "2", confidence: 0.5 }] }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-reference-answer", status: "SUCCESS" }
        };
      },
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
      })
    }
  );

  assert.equal(callCount, 1);
  assert.equal(result.referenceAnswer.referenceAnswers[0].correctAnswer, "2");
  assert.equal(result.referenceAnswer.modelRunId, "run-1");
  assert.equal(result.referenceAnswer.escalationModelRunId, null);
  assert.equal(result.referenceAnswer.solAttempted, false);
  assert.equal(result.referenceAnswer.usedModelEscalation, false);
});

test("successful runtime reference escalation uses one consistent persisted Sol run", async () => {
  let runId = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { assignmentId: "existing-assignment", subject: "数学", printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    {
      prisma: { modelRun: { create: async ({ data }) => ({ id: `run-${++runId}`, ...data }) } },
      referenceAnswerRunner: async () => ({
        available: true,
        providerId: "gpt56",
        referenceText: JSON.stringify({ referenceAnswers: [{ questionNo: "1", correctAnswer: "2", confidence: 0.99 }] }),
        modelRun: {
          provider: "gpt56",
          model: "gpt-5.6-sol",
          skill: "submission-reference-answer",
          status: "SUCCESS",
          metadata: { solAttempted: true, usedModelEscalation: true }
        }
      }),
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
      })
    }
  );

  assert.equal(result.referenceAnswer.modelRunId, "run-1");
  assert.equal(result.referenceAnswer.escalationModelRunId, "run-1");
  assert.equal(result.referenceAnswer.solAttempted, true);
  assert.equal(result.referenceAnswer.usedModelEscalation, true);
});

test("reference service never attempts an optional second model persistence", async () => {
  let persistCalls = 0;
  const result = await gradeSubmissionService(
    { GPT56_SOL_FALLBACK_ENABLED: "true", GPT56_REASONING_EFFORT_ENABLED: "true", GPT56_SOL_MODEL: "gpt-5.6-sol" },
    { assignmentId: "existing-assignment", subject: "数学", printedText: "1. 1+1=?", studentAnswerText: "1. 2" },
    {
      prisma: {
        modelRun: {
          create: async ({ data }) => {
            persistCalls += 1;
            if (persistCalls === 2) throw new Error("optional Sol persistence failed");
            return { id: "terra-run", ...data };
          }
        }
      },
      referenceAnswerRunner: async (_config, _input, execution) => ({
        available: true,
        providerId: "gpt56",
        referenceText: JSON.stringify({
          referenceAnswers: [{ questionNo: "1", correctAnswer: execution?.role === "sol-reference-escalation" ? "Sol answer" : "Terra answer", confidence: execution?.role === "sol-reference-escalation" ? 0.99 : 0.5 }]
        }),
        modelRun: { provider: "gpt56", model: execution?.role === "sol-reference-escalation" ? "gpt-5.6-sol" : "gpt-5.6", skill: "submission-reference-answer", status: "SUCCESS" }
      }),
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({ score: 5, questionResults: [{ questionNo: "1", status: "correct", score: 5, maxScore: 5, confidence: 0.95 }] })
      })
    }
  );

  assert.equal(result.referenceAnswer.referenceAnswers[0].correctAnswer, "Terra answer");
  assert.equal(result.referenceAnswer.modelRunId, "terra-run");
  assert.equal(result.referenceAnswer.escalationModelRunId, null);
  assert.equal(persistCalls, 1);
  assert.equal(result.referenceAnswer.escalationPersistenceError, null);
  assert.equal(result.referenceAnswer.solAttempted, false);
  assert.equal(result.referenceAnswer.usedModelEscalation, false);
});

test("reference normalization preserves numeric and boolean prompt or answer values", async () => {
  const result = await gradeSubmissionService(
    {},
    {
      subject: "数学",
      referenceAnswers: [{ questionNo: "1", prompt: false, correctAnswer: 0, score: 5, confidence: 1 }],
      ocrQuestions: [{ questionNo: "1", printedText: "判断结果", studentAnswer: "0", confidence: 0.99 }]
    },
    { persist: false }
  );

  assert.equal(result.referenceAnswer.referenceAnswers[0].prompt, "false");
  assert.equal(result.referenceAnswer.referenceAnswers[0].correctAnswer, "0");
});

test("objective comparison keeps unsafe multi-answer text unresolved", async () => {
  let runnerInput = null;
  await gradeSubmissionService(
    {},
    {
      subject: "英语",
      answerKey: "1=A或B",
      studentAnswerText: "1. A"
    },
    {
      persist: false,
      gradingRunner: async (_config, input) => {
        runnerInput = input;
        return {
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: 100,
            summary: "存在多答案规则，交由教师复核。",
            questionResults: [
              { questionNo: "1", status: "uncertain", studentAnswer: "A", correctAnswer: "A或B", confidence: 0.5 }
            ]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
        };
      },
      gradingReviewers: {
        premium: async () => ({
          available: true,
          reviewText: JSON.stringify({
            status: "pass",
            riskLevel: "low",
            scoreReliable: true,
            archiveAllowed: true,
            issues: [],
            suggestions: []
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
        })
      }
    }
  );

  assert.equal(runnerInput.ocrQuestions.length, 1);
});

test("mixed grading sends only unresolved questions and derives score from question results", async () => {
  let runnerInput = null;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "小测",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
        { questionNo: "2", prompt: "说明人物品质并结合文章分析。", correctAnswer: "言之有理即可", score: 6, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "选择题", studentAnswer: "c", confidence: 0.99 },
        { questionNo: "2", printedText: "说明人物品质并结合文章分析。", studentAnswer: "人物很勇敢，因为他主动帮助同伴。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async (_config, input) => {
        runnerInput = input;
        return {
          available: true,
          providerId: "gpt56",
          gradingText: JSON.stringify({
            score: 100,
            summary: "主观题基本合理。",
            questionResults: [
              { questionNo: "2", status: "partial", score: 3, maxScore: 6, studentAnswer: input.ocrQuestions[0].studentAnswer, correctAnswer: "言之有理即可", confidence: 0.8 }
            ]
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
        };
      },
      gradingReviewers: {
        premium: async () => ({
          available: true,
          reviewText: JSON.stringify({
            status: "pass",
            riskLevel: "low",
            scoreReliable: true,
            archiveAllowed: true,
            issues: [],
            suggestions: []
          }),
          modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
        })
      }
    }
  );

  assert.deepEqual(runnerInput.ocrQuestions.map((item) => item.questionNo), ["2"]);
  assert.deepEqual(runnerInput.referenceAnswers.map((item) => item.questionNo), ["2"]);
  assert.doesNotMatch(runnerInput.studentAnswerText, /\bc\b/i);
  assert.equal(result.structured.score, 7);
  assert.deepEqual(
    result.structured.questionResults.map((item) => [item.questionNo, item.status, item.score]),
    [["1", "correct", 4], ["2", "partial", 3]]
  );
});

test("mixed grading keeps unresolved questions uncertain when remote grading fails", async () => {
  let reviewCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "小测",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "选择题", correctAnswer: "C", score: 4, confidence: 1 },
        { questionNo: "2", prompt: "结合文章说明人物品质。", correctAnswer: "言之有理即可", score: 6, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "选择题", studentAnswer: "C", confidence: 0.99 },
        { questionNo: "2", printedText: "结合文章说明人物品质。", studentAnswer: "人物很勇敢。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: false,
        providerId: "gpt56",
        gradingText: "",
        error: "MODEL_TIMEOUT",
        modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "ERROR" }
      }),
      gradingReviewers: {
        premium: async () => {
          reviewCalls += 1;
          return {
            available: false,
            reviewText: "",
            error: "MODEL_TIMEOUT",
            modelRun: { provider: "gpt56", model: "gpt-5.6", status: "ERROR" }
          };
        }
      }
    }
  );

  assert.deepEqual(result.structured.questionResults.map((item) => item.questionNo), ["1", "2"]);
  assert.equal(result.structured.questionResults[1].status, "uncertain");
  assert.equal(result.structured.score, null);
  assert.equal(result.structured.needsTeacherReview, true);
  assert.equal(reviewCalls, 0);
});

test("external worksheet keeps OCR question drafts when reference and grading models fail", async () => {
  const result = await gradeSubmissionService(
    {},
    {
      subject: "数学",
      kind: "作业",
      printedText: "1. 6*7=? 2. 9*8=?",
      studentAnswerText: "1. 42 2. 72",
      ocrQuestions: [
        {
          questionNo: "1",
          printedPrompt: "6*7=?",
          studentAnswer: "42",
          observedWork: "口算得出42",
          confidence: 0.96,
          bbox: { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
        },
        {
          questionNo: "2",
          printedPrompt: "9*8=?",
          studentAnswer: "72",
          observedWork: "口算得出72",
          confidence: 0.94,
          bbox: { page: 1, x: 0.1, y: 0.35, w: 0.3, h: 0.1 }
        }
      ]
    },
    {
      persist: false,
      referenceAnswerRunner: async () => ({
        available: false,
        providerId: "gpt56",
        referenceText: "",
        error: "502 openai_error"
      }),
      gradingRunner: async () => ({
        available: false,
        providerId: "gpt56",
        gradingText: "",
        error: "502 openai_error"
      }),
      gradingReviewers: {
        premium: async () => ({
          available: false,
          reviewText: "",
          error: "502 openai_error"
        })
      }
    }
  );

  assert.deepEqual(
    result.structured.questionResults.map((item) => ({
      questionNo: item.questionNo,
      prompt: item.prompt,
      studentAnswer: item.studentAnswer,
      confidence: item.confidence,
      bbox: item.bbox
    })),
    [
      {
        questionNo: "1",
        prompt: "6*7=?",
        studentAnswer: "42",
        confidence: 0.96,
        bbox: { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
      },
      {
        questionNo: "2",
        prompt: "9*8=?",
        studentAnswer: "72",
        confidence: 0.94,
        bbox: { page: 1, x: 0.1, y: 0.35, w: 0.3, h: 0.1 }
      }
    ]
  );
  assert.equal(result.structured.score, null);
  assert.equal(result.structured.questionResults.every((item) => item.status === "uncertain"), true);
});

test("remote grading results retain OCR evidence when the model omits it", async () => {
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      totalScore: 5,
      referenceAnswers: [{
        questionNo: "1",
        prompt: "概括这段话的主要意思。",
        correctAnswer: "意思合理即可",
        score: 5,
        confidence: 1
      }],
      ocrQuestions: [{
        questionNo: "1",
        printedText: "概括这段话的主要意思。",
        studentAnswer: "春天来了，花草都醒了。",
        confidence: 0.93,
        bbox: { page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.12 }
      }]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({
          questionResults: [{ questionNo: "1", status: "partial", score: 3, maxScore: 5, confidence: 0.8 }]
        })
      }),
      gradingReviewers: {
        premium: async () => ({
          available: true,
          reviewText: JSON.stringify({ status: "pass", riskLevel: "low", scoreReliable: true, archiveAllowed: true, issues: [], suggestions: [] })
        })
      }
    }
  );

  assert.deepEqual(result.structured.questionResults[0], {
    id: "question-1",
    questionNo: "1",
    status: "partial",
    prompt: "概括这段话的主要意思。",
    studentAnswer: "春天来了，花草都醒了。",
    correctAnswer: "意思合理即可",
    studentProcess: [],
    errorStep: "",
    explanation: "",
    knowledgePoint: "语文",
    suggestedPractice: "",
    maxScore: 5,
    score: 3,
    confidence: 0.8,
    bbox: { page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.12 },
    modelEscalated: undefined
  });
});

test("subjective grading keeps questions omitted by the remote model uncertain", async () => {
  let reviewCalls = 0;
  const result = await gradeSubmissionService(
    {},
    {
      subject: "语文",
      kind: "练习",
      totalScore: 10,
      referenceAnswers: [
        { questionNo: "1", prompt: "概括段意。", correctAnswer: "意思合理即可", score: 5, confidence: 1 },
        { questionNo: "2", prompt: "分析人物品质。", correctAnswer: "言之有理即可", score: 5, confidence: 1 }
      ],
      ocrQuestions: [
        { questionNo: "1", printedText: "概括段意。", studentAnswer: "写了春天的景色。", confidence: 0.95 },
        { questionNo: "2", printedText: "分析人物品质。", studentAnswer: "人物很勇敢。", confidence: 0.95 }
      ]
    },
    {
      persist: false,
      gradingRunner: async () => ({
        available: true,
        providerId: "gpt56",
        gradingText: JSON.stringify({
          summary: "仅返回了一道题。",
          questionResults: [
            { questionNo: "1", status: "partial", score: 3, maxScore: 5, confidence: 0.8 }
          ]
        }),
        modelRun: { provider: "gpt56", model: "gpt-5.6", skill: "submission-grading", status: "SUCCESS" }
      }),
      gradingReviewers: {
        premium: async () => {
          reviewCalls += 1;
          return {
            available: true,
            reviewText: JSON.stringify({ status: "pass", riskLevel: "low", scoreReliable: true, archiveAllowed: true, issues: [], suggestions: [] }),
            modelRun: { provider: "gpt56", model: "gpt-5.6", status: "SUCCESS" }
          };
        }
      }
    }
  );

  assert.deepEqual(result.structured.questionResults.map((item) => item.questionNo), ["1", "2"]);
  assert.equal(result.structured.questionResults[1].status, "uncertain");
  assert.equal(result.structured.score, null);
  assert.equal(reviewCalls, 0);
});
