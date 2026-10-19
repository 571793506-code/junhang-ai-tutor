import assert from "node:assert/strict";
import test from "node:test";
import { recognizeImages } from "./ocr-node.js";

const config = { OCR_ENABLED: "true", OCR_ENGINE: "vision", OCR_VISION_PROVIDER: "minimax", OCR_VISION_MODEL: "MiniMax-M3.1-Flash" };
const candidate = { text: "计算题", printedText: "72+18×4", studentAnswerText: "144", confidence: 0.9,
  questions: [{ questionNo: "1", printedPrompt: "72+18×4", studentAnswer: "144", observedWork: "72+72=144", confidence: 0.9,
    bbox: { page: 99, x: 0.1, y: 0.2, w: 0.4, h: 0.3 } }] };

test("modern MiniMax OCR uses bounded shared calls, ordered pages and source bindings", async () => {
  const calls = [];
  const result = await recognizeImages(config, { images: [1, 2].map(page => ({ dataUrl: "data:image/png;base64,c3ludGhldGlj", sourceImageRef: `upload-${page}`, cropRef: `crop-${page}` })) }, {
    call: async (route, messages, options) => {
      calls.push({ route, messages, options });
      return { text: JSON.stringify(candidate), usage: { completion_tokens: 90 } };
    }
  });
  assert.equal(result.available, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.route.model === "MiniMax-M3.1-Flash" && call.route.providerId === "minimax" && call.route.reasoningEffort === "low"));
  assert.ok(calls.every(call => call.options.maxTokens === 12000 && call.options.timeoutMs <= 90000));
  assert.equal(calls[0].messages[1].content[1].type, "image_url");
  assert.deepEqual(result.questions.map(q => [q.page, q.bbox.page, q.sourceImageRef]), [[1, 1, "upload-1"], [2, 2, "upload-2"]]);
  assert.equal(result.questions[0].observedWork, "72+72=144");
});

test("modern OCR rejects missing question evidence and does not invent a successful empty page", async () => {
  const result = await recognizeImages(config, { images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }, {
    call: async () => ({ text: JSON.stringify({ ...candidate, questions: [] }) })
  });
  assert.equal(result.available, false);
  assert.equal(result.status, "FAILED");
});

test("modern OCR does not turn absent recognition confidence into a measured zero", async () => {
  for (const confidence of [null, undefined, ""]) {
    const result = await recognizeImages(config, { images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }, {
      call: async () => ({ text: JSON.stringify({ ...candidate, questions: [{ ...candidate.questions[0], confidence }] }) })
    });
    assert.equal(result.available, false);
  }
});

test("modern OCR stops at the shared deadline without calling a replacement", async () => {
  let calls = 0;
  const result = await recognizeImages(config, { images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }, {
    timeoutMs: 30,
    call: async () => { calls++; return new Promise(() => {}); }
  });
  assert.equal(calls, 1);
  assert.equal(result.available, false);
});

test("modern OCR cancellation aborts the active call and returns no usable late result", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await recognizeImages(config, { images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }, {
    signal: controller.signal,
    call: async (_route, _messages, options) => {
      calls++;
      controller.abort(new Error("teacher cancelled"));
      assert.equal(options.signal.aborted, true);
      return { text: JSON.stringify(candidate) };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.available, false);
  assert.deepEqual(result.questions, []);
});

test("modern OCR preserves uncertainty warnings and separates an unreadable answer from visible blank work", async () => {
  let prompt;
  const result = await recognizeImages(config, { images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }, {
    call: async (_route, messages) => {
      prompt = messages[0].content;
      return { text: JSON.stringify({ ...candidate, questions: [{ ...candidate.questions[0], studentAnswer: "", confidence: 0.1, warnings: ["答案被遮挡"] }] }) };
    }
  });
  assert.match(prompt, /不可辨认.*warnings/);
  assert.ok(!prompt.includes("}]}]}"));
  assert.deepEqual(result.questions[0].warnings, ["答案被遮挡"]);
  assert.equal(result.questions[0].confidence, 0.1);
});
