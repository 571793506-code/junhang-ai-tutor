import fs from "node:fs";
import { mapWithConcurrency } from "./assessment-partitions.js";
import {
  buildAiStartupSnapshot,
  callOpenAiCompatibleChat,
  extractChatText,
  normalizeRuntimeConfig
} from "./runtime.js";

async function timedCall(run) {
  const started = Date.now();
  try {
    const body = await run();
    return { body, latencyMs: Date.now() - started, status: "SUCCESS" };
  } catch (error) {
    return {
      body: null,
      latencyMs: Date.now() - started,
      status: "ERROR",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function imageToDataUrl(image = {}) {
  if (image.dataUrl) return image.dataUrl;
  if (image.base64 && image.mimeType) return `data:${image.mimeType};base64,${image.base64}`;
  if (!image.path) return null;
  const mimeType = image.mimeType || (String(image.path).toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  return `data:${mimeType};base64,${fs.readFileSync(image.path).toString("base64")}`;
}

function normalizeOcrImages(input = {}) {
  return (input.imageFiles || input.images || [])
    .map((image) => {
      if (typeof image === "string") return { path: image };
      return image || null;
    })
    .filter(Boolean);
}

function parseJsonObjectText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = fenced || (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeRegion(region = null) {
  if (!region || typeof region !== "object") return null;
  return {
    page: Math.max(1, Math.round(Number(region.page || region.pageNumber || 1) || 1)),
    x: clampUnit(region.x ?? region.left, 0.08),
    y: clampUnit(region.y ?? region.top, 0.12),
    w: Math.max(0.04, clampUnit(region.w ?? region.width, 0.18)),
    h: Math.max(0.035, clampUnit(region.h ?? region.height, 0.08))
  };
}

function normalizeOcrQuestion(question = {}, pageNumber = 1, index = 0) {
  const source = typeof question === "string" ? { text: question } : question || {};
  const region = normalizeRegion(source.pageRegion || source.region || source.bbox || source.box || source.position);
  return {
    id: String(source.id || `ocr-question-${pageNumber}-${index + 1}`),
    page: Math.max(1, Math.round(Number(source.page || source.pageNumber || pageNumber) || pageNumber)),
    questionNo: String(source.questionNo || source.no || source.index || index + 1),
    printedPrompt: String(source.printedPrompt || source.prompt || source.question || source.text || "").trim(),
    studentAnswer: String(source.studentAnswer || source.answer || source.handwriting || source.filledAnswer || "").trim(),
    observedWork: String(source.observedWork || source.studentProcess || source.process || source.work || "").trim(),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
    bbox: region ? { ...region, page: Math.max(1, Math.round(Number(region.page || pageNumber) || pageNumber)) } : null,
    warnings: Array.isArray(source.warnings) ? source.warnings.map((item) => String(item || "").trim()).filter(Boolean) : []
  };
}

function collectOcrQuestions(pages = [], fallbackQuestions = []) {
  const collected = [];
  for (const [pageIndex, page] of pages.entries()) {
    const pageNumber = Number(page?.page || page?.pageNumber || pageIndex + 1);
    const questions = Array.isArray(page?.questions) ? page.questions : [];
    for (const [index, question] of questions.entries()) {
      collected.push(normalizeOcrQuestion(question, pageNumber, index));
    }
  }
  if (!collected.length && Array.isArray(fallbackQuestions)) {
    for (const [index, question] of fallbackQuestions.entries()) {
      collected.push(normalizeOcrQuestion(question, 1, index));
    }
  }
  return collected.filter((item) => item.printedPrompt || item.studentAnswer || item.observedWork);
}

function resolveVisionProvider(runtime) {
  const provider = String(runtime.ocrVisionProvider || "minimax").toLowerCase();
  if (provider === "custom" || provider === "vision" || provider === "http-compatible") {
    return {
      provider,
      baseUrl: runtime.ocrVisionBaseUrl,
      apiKey: runtime.ocrVisionApiKey,
      model: runtime.ocrVisionModel
    };
  }
  if (provider === "minimax") {
    return {
      provider,
      baseUrl: runtime.ocrVisionBaseUrl || runtime.minimaxBaseUrl,
      apiKey: runtime.ocrVisionApiKey || runtime.minimaxApiKey,
      model: runtime.ocrVisionModel || runtime.minimaxModel
    };
  }
  if (provider === "deepseek") {
    return {
      provider,
      baseUrl: runtime.ocrVisionBaseUrl || runtime.deepseekBaseUrl,
      apiKey: runtime.ocrVisionApiKey || runtime.deepseekApiKey,
      model: runtime.ocrVisionModel || runtime.deepseekModel
    };
  }
  if (provider === "openai") {
    return {
      provider,
      baseUrl: runtime.ocrVisionBaseUrl || "https://api.openai.com/v1",
      apiKey: runtime.ocrVisionApiKey,
      model: runtime.ocrVisionModel
    };
  }
  return {
    provider,
    baseUrl: runtime.ocrVisionBaseUrl,
    apiKey: runtime.ocrVisionApiKey,
    model: runtime.ocrVisionModel
  };
}

function normalizeVisionOcrOutput(body, fallbackText = "") {
  const text = extractChatText(body);
  const parsed = parseJsonObjectText(text) || {};
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const questions = collectOcrQuestions(pages, parsed.questions);
  const pageText = pages
    .map((page, index) => {
      if (typeof page === "string") return `第 ${index + 1} 页\n${page}`.trim();
      return `第 ${page.page || index + 1} 页\n${page.text || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
  return {
    text: String(parsed.text || parsed.ocrText || pageText || fallbackText || text || "").trim(),
    studentAnswerText: String(parsed.studentAnswerText || parsed.handwritingText || parsed.answersText || "").trim(),
    printedText: String(parsed.printedText || parsed.questionText || "").trim(),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
    questions,
    pages,
    rawText: text
  };
}

async function callMiniMaxCodingPlanVlm({ baseUrl, apiKey, prompt, image }) {
  const root = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const response = await fetch(`${root}/v1/coding_plan/vlm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      image_url: imageToDataUrl(image)
    })
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || (body.base_resp?.status_code && body.base_resp.status_code !== 0)) {
    throw new Error(body.base_resp?.status_msg || body.error?.message || body.message || response.statusText);
  }
  return body;
}

export async function recognizeImages(config, input = {}) {
  const runtime = normalizeRuntimeConfig(config);
  const engine = String(input.engine || runtime.ocrEngine || "manual").toLowerCase();
  const images = normalizeOcrImages(input);

  if (!runtime.ocrEnabled || engine === "manual") {
    return {
      available: false,
      status: "FAILED",
      engine,
      text: null,
      confidence: null,
      reason: "OCR 引擎暂未配置，请在复核页人工校正或稍后接入真实识别服务。"
    };
  }

  if (engine === "mock") {
    return {
      available: true,
      status: "READY",
      engine,
      text: input.fallbackText || `模拟识别：共 ${images.length || input.imageNames?.length || 0} 张图片，等待教师核对题号与答案。`,
      confidence: 0.72,
      reason: "本地模拟 OCR 已完成。"
    };
  }

  if (engine === "tesseract") {
    if (!images.length) {
      return {
        available: false,
        status: "FAILED",
        engine,
        text: null,
        confidence: null,
        reason: "没有可识别的图片文件。"
      };
    }
    const result = await timedCall(async () => {
      const tesseract = await import("tesseract.js");
      const recognize = tesseract.recognize || tesseract.default?.recognize;
      if (typeof recognize !== "function") throw new Error("Tesseract recognize API unavailable.");
      const pages = [];
      const confidences = [];
      for (const [index, image] of images.entries()) {
        const page = await recognize(image.path, runtime.ocrTesseractLang);
        pages.push(`第 ${index + 1} 页\n${page.data?.text || ""}`.trim());
        if (Number.isFinite(page.data?.confidence)) confidences.push(page.data.confidence / 100);
      }
      return {
        text: pages.filter(Boolean).join("\n\n"),
        confidence: confidences.length
          ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
          : null
      };
    });
    return {
      available: result.status === "SUCCESS",
      status: result.status === "SUCCESS" ? "READY" : "FAILED",
      engine,
      text: result.body?.text || null,
      confidence: result.body?.confidence ?? null,
      reason: result.status === "SUCCESS" ? "本地 OCR 已完成，请教师复核。" : result.error || "本地 OCR 识别失败。"
    };
  }

  if (engine === "http") {
    if (!runtime.ocrHttpUrl) {
      return {
        available: false,
        status: "FAILED",
        engine,
        text: null,
        confidence: null,
        reason: "OCR_HTTP_URL 未配置。"
      };
    }
    const result = await timedCall(async () => {
      const response = await fetch(runtime.ocrHttpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(runtime.ocrHttpApiKey ? { Authorization: `Bearer ${runtime.ocrHttpApiKey}` } : {})
        },
        body: JSON.stringify({
          images: images.map((image) => ({
            name: image.fileName || image.originalName || image.path || null,
            mimeType: image.mimeType || null,
            dataUrl: imageToDataUrl(image)
          })),
          imageNames: input.imageNames || [],
          context: input.context || null
        })
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.message || body.error || response.statusText);
      return body;
    });
    const body = result.body || {};
    return {
      available: result.status === "SUCCESS",
      status: result.status === "SUCCESS" ? "READY" : "FAILED",
      engine,
      text: body.text || body.ocrText || null,
      confidence: body.confidence ?? null,
      reason: result.status === "SUCCESS" ? body.reason || "外部 OCR 已完成，请教师复核。" : result.error || "外部 OCR 识别失败。",
      raw: body
    };
  }

  if (engine === "vision") {
    if (!images.length) {
      return {
        available: false,
        status: "FAILED",
        engine,
        text: null,
        confidence: null,
        reason: "没有可识别的图片文件。"
      };
    }
    const vision = resolveVisionProvider(runtime);
    if (!vision.baseUrl || !vision.apiKey || !vision.model) {
      return {
        available: false,
        status: "FAILED",
        engine,
        text: null,
        confidence: null,
        reason: "视觉 OCR 模型未配置完整，请配置 OCR_VISION_PROVIDER / OCR_VISION_BASE_URL / OCR_VISION_API_KEY / OCR_VISION_MODEL。"
      };
    }
    if (vision.provider === "minimax" && String(vision.model).toLowerCase() === "coding_plan/vlm") {
      const result = await timedCall(async () => {
        const pages = await mapWithConcurrency(images, 2, async (image, index) => {
          const body = await callMiniMaxCodingPlanVlm({
            baseUrl: vision.baseUrl,
            apiKey: vision.apiKey,
            image,
            prompt:
              "请识别这张学生作业/试卷/小测/听写图片中的文字内容。只做OCR和版面提取，不要批改、不要给分。必须重点区分印刷题目和学生手写/填写作答，不允许把印刷题干、示例、题目自带答案当成学生作答。返回严格 json：{text, studentAnswerText, printedText, questions, confidence, warnings}。questions为逐题数组，每项包含questionNo, printedPrompt, studentAnswer, observedWork, pageRegion, confidence。pageRegion 使用相对坐标 {page,x,y,w,h}，范围 0-1，覆盖学生主要作答区域；无法定位时可以为空。尽量保留题号、学生答案、计算过程、选择答案、填空内容、分数、单位、英文单词和老师已批改痕迹。若看不清，写入warnings并降低confidence。"
          });
          const content = String(body.content || body.output_text || body.text || "").trim();
          const parsed = parseJsonObjectText(content) || {};
          return {
            page: index + 1,
            text: String(parsed.text || content || "").trim(),
            studentAnswerText: String(parsed.studentAnswerText || parsed.handwritingText || parsed.answersText || "").trim(),
            printedText: String(parsed.printedText || parsed.questionText || "").trim(),
            questions: Array.isArray(parsed.questions) ? parsed.questions : [],
            confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
          };
        });
        const textPages = [];
        const studentAnswerPages = [];
        const printedTextPages = [];
        const confidences = [];
        for (const [index, page] of pages.entries()) {
          textPages.push(`第 ${index + 1} 页\n${page.text}`.trim());
          if (page.studentAnswerText) studentAnswerPages.push(`第 ${index + 1} 页学生作答\n${page.studentAnswerText}`.trim());
          if (page.printedText) printedTextPages.push(`第 ${index + 1} 页印刷题干\n${page.printedText}`.trim());
          if (Number.isFinite(page.confidence)) confidences.push(page.confidence);
        }
        const questions = collectOcrQuestions(pages);
        return {
          text: textPages.filter(Boolean).join("\n\n"),
          studentAnswerText: studentAnswerPages.filter(Boolean).join("\n\n"),
          printedText: printedTextPages.filter(Boolean).join("\n\n"),
          confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
          questions,
          pages
        };
      });
      return {
        available: result.status === "SUCCESS" && Boolean(result.body?.text),
        status: result.status === "SUCCESS" && result.body?.text ? "READY" : "FAILED",
        engine,
        provider: vision.provider,
        model: "coding_plan/vlm",
        text: result.body?.text || null,
        studentAnswerText: result.body?.studentAnswerText || null,
        printedText: result.body?.printedText || null,
        questions: result.body?.questions || [],
        confidence: result.body?.confidence ?? (result.status === "SUCCESS" ? 0.82 : null),
        reason: result.status === "SUCCESS" ? "MiniMax 视觉 OCR 已完成，请教师复核。" : result.error || "MiniMax 视觉 OCR 识别失败。",
        raw: {
          pages: result.body?.pages || [],
          questions: result.body?.questions || [],
          provider: vision.provider,
          model: "coding_plan/vlm"
        }
      };
    }

    const result = await timedCall(async () => callOpenAiCompatibleChat({
      baseUrl: vision.baseUrl,
      apiKey: vision.apiKey,
      model: vision.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "你是小学作业、试卷、小测、听写照片的OCR识别助手。请只做图片内容识别，不要批改。必须重点提取学生手写/填写的作答内容，并和印刷题目分开。返回JSON字段：text为完整可读文本，studentAnswerText为学生作答/填空/选择/批改痕迹汇总，printedText为印刷题干和材料，pages为每页文本数组，confidence为0到1之间的估计值，warnings为需要教师复核的原因。"
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                instruction: "识别这些学生作业/试卷图片中的文字，输出可用于后续批改的OCR文本。",
                priority: "优先识别学生写在空格、括号、横线、选择题旁、计算区和作文/解答区的内容；印刷题干可作为上下文，但不要把印刷答案误当作学生作答。",
                imageCount: images.length,
                imageNames: input.imageNames || [],
                context: input.context || null
              })
            },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: imageToDataUrl(image) }
            }))
          ]
        }
      ]
    }));
    const normalized = normalizeVisionOcrOutput(result.body, input.fallbackText || "");
    return {
      available: result.status === "SUCCESS" && Boolean(normalized.text),
      status: result.status === "SUCCESS" && normalized.text ? "READY" : "FAILED",
      engine,
      provider: vision.provider,
      model: vision.model,
      text: normalized.text || null,
      studentAnswerText: normalized.studentAnswerText || null,
      printedText: normalized.printedText || null,
      questions: normalized.questions || [],
      confidence: normalized.confidence,
      reason: result.status === "SUCCESS" ? "视觉 OCR 已完成，请教师复核。" : result.error || "视觉 OCR 识别失败。",
      raw: {
        pages: normalized.pages,
        questions: normalized.questions || [],
        rawText: normalized.rawText,
        provider: vision.provider,
        model: vision.model
      }
    };

    const provider = runtime.ocrVisionProvider === "minimax"
      ? buildAiStartupSnapshot(config).providers.find((item) => item.id === "minimax")
      : buildAiStartupSnapshot(config).providers.find((item) => item.id === "deepseek");
    return {
      available: false,
      status: "FAILED",
      engine,
      text: null,
      confidence: null,
      reason: provider?.status === "ready"
        ? "视觉 OCR 需要接入专用图像理解模型或网关，当前文本模型不直接读取图片。"
        : provider?.reason || "视觉 OCR 提供商暂不可用。"
    };
  }

  return {
    available: false,
    status: "FAILED",
    engine,
    text: null,
    confidence: null,
    reason: `OCR 引擎 ${engine} 尚未接入适配器。`
  };
}
