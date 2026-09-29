import assert from "node:assert/strict";
import test from "node:test";
import { recognizeImages } from "./ocr-node.js";
import { buildExternalGradingRecognitionPacket } from "../../../apps/api/src/external-grading-recognition.js";

test("Flash OCR is opt-in and retains source, crop and authoritative page coordinates", async () => {
  const calls = [];
  const result = await recognizeImages({ OCR_ENABLED: "true", OCR_ENGINE: "vision", OCR_VISION_PROVIDER: "deepseek-flash" }, {
    imageFiles: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj", sourceImageRef: "upload-1", cropRef: "crop-1" }]
  }, { call: async (route, messages) => {
    calls.push({ route, messages });
    return { text: JSON.stringify({ text: "计算题", printedText: "2+2=?", studentAnswerText: "4", confidence: 0.9, questions: [{ questionNo: "1", printedPrompt: "2+2=?", studentAnswer: "4", confidence: 0.9, bbox: { page: 99, x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }] }), usage: { completion_tokens: 50 } };
  } });
  assert.equal(result.available, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route.model, "deepseek-flash");
  assert.equal(calls[0].messages[1].content[1].type, "image_url");
  assert.equal(result.questions[0].bbox.page, 1);
  assert.equal(result.questions[0].sourceImageRef, "upload-1");
  assert.equal(result.questions[0].cropRef, "crop-1");
  const packet = buildExternalGradingRecognitionPacket({ pages: [{ pageNumber: 1, questions: result.questions }] });
  assert.equal(packet.pages[0].questions[0].sourceImageRef, "upload-1");
  assert.equal(packet.pages[0].questions[0].cropRef, "crop-1");
  assert.equal(packet.pages[0].questions[0].score, null);
  assert.equal(packet.archiveEligible, false);
});

test("Flash OCR gives each concurrent page a complete first JSON budget", async () => {
  const budgets = [];
  const page = (no) => ({ dataUrl: `data:image/png;base64,cGFnZS0${no}` });
  const result = await recognizeImages({ OCR_ENABLED: "true", OCR_ENGINE: "vision", OCR_VISION_PROVIDER: "deepseek-flash" }, {
    images: [page(1), page(2)]
  }, { call: async (_route, _messages, options) => {
    budgets.push(options.maxTokens);
    assert.match(_messages[0].content, /不要重复整页全文/);
    return { text: JSON.stringify({ text: "题目", printedText: "1+1=?", studentAnswerText: "2", confidence: 0.9,
      questions: [{ questionNo: "1", printedPrompt: "1+1=?", studentAnswer: "2", confidence: 0.9 }] }), usage: { completion_tokens: 40 } };
  } });
  assert.equal(result.available, true);
  assert.deepEqual(budgets, [12000, 12000]);
});

test("Flash OCR normalizes common vision field aliases before structural validation", async () => {
  const result = await recognizeImages({ OCR_ENABLED: "true", OCR_ENGINE: "vision", OCR_VISION_PROVIDER: "deepseek-flash" }, {
    images: [{ dataUrl: "data:image/png;base64,c2luZ2xl" }]
  }, { call: async () => ({ text: JSON.stringify({ text: "题目", printedText: "1+1=?", studentAnswerText: "2", confidence: 0.9,
    questions: [{ questionNo: 1, prompt: "1+1=?", answer: "2", confidence: "0.9", pageRegion: { x: 0.1, y: 0.2, w: 0.5, h: 0.2 } }] }), usage: { completion_tokens: 40 } }) });
  assert.equal(result.available, true);
  assert.equal(result.questions[0].questionNo, "1");
  assert.equal(result.questions[0].studentAnswer, "2");
  assert.equal(result.questions[0].bbox.page, 1);
});
