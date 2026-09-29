// Isolated read-only evaluation process. Its fetch deadline also bounds legacy OCR adapters.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { recognizeImages } from "@junhang/ai/ocr-node";
import { normalizeRuntimeConfig, callTeachingModel, classifyTaskFailure } from "@junhang/ai";
import { prisma } from "@junhang/db";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const output = arg("output"); const route = arg("route");
if (!output || !["current", "flash"].includes(route) || fs.existsSync(output)) throw new Error("Use --route current|flash --output <new local JSON>");
try {
  const rows = await prisma.submission.findMany({ orderBy: { submittedAt: "desc" }, select: { id: true, content: true } });
  const sample = rows.find((r) => r.content?.materialType === "external_workbook" && r.content.imageFiles?.length);
  if (!sample) throw new Error("No registered external images available");
  const root = path.resolve("apps/api/storage/uploads");
  const images = sample.content.imageFiles.map((file) => {
    const full = fs.realpathSync(file.path); const relative = path.relative(root, full);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Image is outside registered upload storage");
    return { path: full, fileName: file.fileName, mimeType: file.mimeType };
  });
  const hashes = images.map((file) => createHash("sha256").update(fs.readFileSync(file.path)).digest("hex"));
  const config = { ...process.env, ...(route === "flash" ? { OCR_VISION_PROVIDER: "deepseek-flash" } : {}) };
  const runtime = normalizeRuntimeConfig(config); const started = Date.now();
  const deadline = AbortSignal.timeout(90000); const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => originalFetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  console.log(JSON.stringify({ phase: "start", route, provider: runtime.ocrVisionProvider, pages: images.length, timeoutMs: 90000 }));
  let result;
  const attempts = [];
  const call = async (modelRoute, messages, options) => {
    const attempt = { model: modelRoute.model, timeoutMs: options.timeoutMs, maxTokens: options.maxTokens, elapsedMs: null, usage: null, cost: null };
    attempts.push(attempt); const callStarted = Date.now();
    try {
      const response = await callTeachingModel(config, modelRoute, messages, options);
      attempt.usage = response.usage ? Object.fromEntries(Object.entries(response.usage).filter(([k, v]) => ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"].includes(k) && Number.isFinite(v))) : null;
      let parsed;
      try { parsed = JSON.parse(response.text); attempt.validJson = true; }
      catch { attempt.validJson = false; }
      if (parsed) {
        attempt.printedTextPresent = typeof parsed.printedText === "string";
        attempt.studentAnswerTextPresent = typeof parsed.studentAnswerText === "string";
        attempt.questionCount = Array.isArray(parsed.questions) ? parsed.questions.length : null;
        if (Array.isArray(parsed.questions)) {
          const invalid = parsed.questions.filter((q) => !q || typeof q.printedPrompt !== "string" || typeof q.studentAnswer !== "string" || typeof q.questionNo !== "string" || !q.questionNo.trim() || !Number.isFinite(q.confidence) || q.confidence < 0 || q.confidence > 1);
          attempt.invalidQuestionCount = invalid.length;
          attempt.questionFieldIssues = {
            missingPrintedPrompt: invalid.filter((q) => !q || typeof q.printedPrompt !== "string").length,
            missingStudentAnswer: invalid.filter((q) => !q || typeof q.studentAnswer !== "string").length,
            invalidQuestionNo: invalid.filter((q) => !q || typeof q.questionNo !== "string" || !q.questionNo.trim()).length,
            invalidConfidence: invalid.filter((q) => !q || !Number.isFinite(q.confidence) || q.confidence < 0 || q.confidence > 1).length
          };
        }
      }
      return response;
    } catch (error) { attempt.failureClass = classifyTaskFailure(error, { evidenceSufficient: true }).triggerClass; throw error; }
    finally { attempt.elapsedMs = Date.now() - callStarted; }
  };
  try { result = await recognizeImages(config, { imageFiles: images }, { timeoutMs: 90000, ...(route === "flash" ? { call } : {}) }); }
  finally { globalThis.fetch = originalFetch; }
  const questions = (result.questions || []).map((q) => Object.fromEntries(["questionNo", "printedPrompt", "printedText", "studentAnswer", "observedWork", "confidence", "bbox", "page", "sourceImageRef", "cropRef"].filter((key) => q[key] !== undefined).map((key) => [key, q[key]])));
  const report = { schemaVersion: "teaching-ocr-comparison-v1", generatedAt: new Date().toISOString(), route, provider: runtime.ocrVisionProvider,
    imageHashes: hashes, imageCount: images.length, persist: false, available: result.available === true, status: result.status,
    elapsedMs: Date.now() - started, deadlineExceeded: deadline.aborted, questionCount: questions.length, questions, attempts: route === "flash" ? attempts : null,
    teacherTranscription: null, accuracy: null, originalImageCompared: true, cropCompared: false, cost: null,
    note: "Same registered images, unconfirmed OCR labels; no accuracy or production claim." };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ phase: "done", route, available: report.available, questions: questions.length, elapsedMs: report.elapsedMs, output }));
  if (!report.available) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
