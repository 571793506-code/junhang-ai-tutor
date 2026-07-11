import {
  answerStudentQuestion,
  buildDictationSpeechPlan,
  createMiniMaxSpeechTask,
  draftAssessment,
  draftTeacherTask,
  generateSubmissionReferenceAnswers,
  generateVocabularyCard,
  gradeSubmissionText,
  normalizeRuntimeConfig,
  reviewWithGpt55,
  reviewWithMiniMax,
  solEscalationEnabled
} from "@junhang/ai";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  createAssignmentDraft,
  createLearningTask,
  recordModelRun,
  recordQaSession,
  recordSubmissionGrading,
  recordVocabularyRecord,
  recordVoiceInteraction
} from "@junhang/db";

const workspaceRoot = findWorkspaceRoot();

function findWorkspaceRoot(startDir = process.cwd()) {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "scripts", "build-content-index.mjs"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(startDir);
}

function normalizeAssessmentKind(kind) {
  const text = String(kind || "");
  if (text.includes("试") || text.toLowerCase().includes("exam")) return "试卷";
  if (text.includes("测") || text.toLowerCase().includes("quiz")) return "小测";
  return "练习";
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function isPersonalizedAssessmentRequest(input = {}) {
  const text = [
    input.requirement,
    input.specialRequirements,
    input.targetScope,
    input.studentId,
    ...(Array.isArray(input.studentSignals) ? input.studentSignals : []),
    ...(Array.isArray(input.weaknesses) ? input.weaknesses : []),
    ...(Array.isArray(input.mistakePoints) ? input.mistakePoints : [])
  ].filter(Boolean).join(" ");
  return Boolean(input.studentId) || /个性化|错题|薄弱|弱点|补弱|针对|学情|近期/.test(text);
}

function resolveAssessmentGenerationBudget(input = {}, config = {}) {
  const kind = normalizeAssessmentKind(input.kind);
  const explicitProfile = typeof input.generationProfile === "string" && input.generationProfile.trim()
    ? input.generationProfile.trim()
    : null;
  const profile = explicitProfile ||
    (kind === "试卷" || (kind === "练习" && isPersonalizedAssessmentRequest(input))
      ? "formal-full"
      : kind === "小测"
        ? "quiz-standard"
        : "practice-standard");
  const profileDefaults = {
    "e2e-fast": { assessmentTotalTimeoutMs: 105000, assessmentMaxTokens: 16000 },
    "fast-check": { assessmentTotalTimeoutMs: 105000, assessmentMaxTokens: 16000 },
    "quiz-standard": { assessmentTotalTimeoutMs: 120000, assessmentMaxTokens: 16000 },
    "practice-standard": { assessmentTotalTimeoutMs: 150000, assessmentMaxTokens: 16000 },
    "formal-full": {
      assessmentTotalTimeoutMs: 240000,
      assessmentMaxTokens: 24000
    }
  };
  const defaults = profileDefaults[profile] || profileDefaults["practice-standard"];
  const explicitTimeoutMs = firstPositiveNumber(
    input.assessmentTotalTimeoutMs,
    input.generationTimeoutMs
  );
  const configTimeoutMs = firstPositiveNumber(
    config.ASSESSMENT_DRAFT_TOTAL_TIMEOUT_MS,
    config.assessmentDraftTotalTimeoutMs
  );
  const explicitMaxTokens = firstPositiveNumber(
    input.assessmentMaxTokens,
    input.generationMaxTokens
  );
  const configMaxTokens = firstPositiveNumber(
    config.ASSESSMENT_DRAFT_MAX_TOKENS,
    config.assessmentDraftMaxTokens
  );
  const assessmentTotalTimeoutMs = explicitTimeoutMs || configTimeoutMs || defaults.assessmentTotalTimeoutMs;
  const assessmentMaxTokens = explicitMaxTokens || configMaxTokens || defaults.assessmentMaxTokens;
  return {
    profile,
    kind,
    assessmentTotalTimeoutMs,
    generationTimeoutMs: input.generationTimeoutMs || null,
    assessmentMaxTokens,
    source: {
      profile: explicitProfile ? "input" : "service-default",
      timeoutMs: explicitTimeoutMs ? "input" : configTimeoutMs ? "config" : "profile-default",
      maxTokens: explicitMaxTokens ? "input" : configMaxTokens ? "config" : "profile-default"
    }
  };
}

function normalizeSubject(subject) {
  const text = String(subject || "").toLowerCase();
  if (text.includes("英语") || text.includes("英") || text.includes("english")) return "英语";
  if (text.includes("语文") || text.includes("chinese")) return "语文";
  if (text.includes("数学") || text.includes("数") || text.includes("math")) return "数学";
  return subject || "英语";
}

const recentAssessmentPromptFingerprints = new Map();
const RECENT_ASSESSMENT_PROMPT_LIMIT = 420;

function normalizedSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function readContentIndex(indexPath = "exports/content-index/index.json") {
  const absolutePath = resolve(workspaceRoot, indexPath);
  if (!existsSync(absolutePath)) {
    return {
      available: false,
      path: absolutePath,
      documents: [],
      reason: "CONTENT_INDEX_NOT_FOUND"
    };
  }
  try {
    const index = JSON.parse(readFileSync(absolutePath, "utf8"));
    return {
      available: true,
      path: absolutePath,
      generatedAt: index.generatedAt || null,
      documents: Array.isArray(index.documents) ? index.documents : [],
      documentCount: index.documentCount || 0
    };
  } catch (error) {
    return {
      available: false,
      path: absolutePath,
      documents: [],
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function matchContentContext(input = {}, indexPath) {
  const index = readContentIndex(indexPath || input.contentIndexPath);
  const subject = normalizedSearchText(input.subject);
  const grade = normalizedSearchText(input.grade || input.targetGrade);
  const requirement = normalizedSearchText(`${input.requirement || ""} ${input.specialRequirements || ""}`);
  const knowledgePoints = Array.isArray(input.knowledgePoints) ? input.knowledgePoints.map(normalizedSearchText) : [];
  const textbookText = normalizedSearchText(`${input.textbookTitle || ""} ${input.textbookChapterTitle || ""}`);
  const scored = index.documents.map((document) => {
    const haystack = normalizedSearchText([
      document.title,
      document.summary,
      ...(document.subjects || []),
      ...(document.grades || []),
      ...(document.knowledgePoints || []),
      ...(document.chunks || []).map((chunk) => chunk.preview)
    ].join(" "));
    let score = 0;
    if (subject && haystack.includes(subject)) score += 4;
    if (grade && haystack.includes(grade)) score += 3;
    if (textbookText && haystack.includes(textbookText)) score += 3;
    for (const point of knowledgePoints) {
      if (point && haystack.includes(point)) score += 3;
    }
    for (const token of requirement.split(/[，。；、,.;:：\s]+/).filter((item) => item.length >= 2).slice(0, 16)) {
      if (haystack.includes(token)) score += 1;
    }
    return { document, score };
  }).filter((item) => item.score > 0);
  const matches = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ document, score }) => ({
      id: document.id,
      title: document.title,
      score,
      sourceType: document.sourceType,
      markdownPath: document.relativeMarkdownPath || document.markdownPath,
      summary: document.summary,
      subjects: document.subjects || [],
      grades: document.grades || [],
      knowledgePoints: document.knowledgePoints || [],
      chunks: (document.chunks || []).slice(0, 2).map((chunk) => ({
        id: chunk.id,
        preview: chunk.preview
      }))
    }));
  return {
    available: index.available,
    indexPath: index.path,
    generatedAt: index.generatedAt || null,
    reason: index.reason || null,
    matchedCount: matches.length,
    matches
  };
}

function gradeLevelNumber(input = {}) {
  const text = String(input.grade || input.targetGrade || "");
  const match = text.match(/[三四五六3456]/);
  const map = { 三: 3, 四: 4, 五: 5, 六: 6 };
  return match ? Number(map[match[0]] || match[0]) : 6;
}

function wantsListening(input = {}) {
  const text = `${input.requirement || ""} ${input.specialRequirements || ""} ${input.title || ""}`;
  if (/不需要听力|无需听力|不要听力|不含听力|无听力|不用听力|no listening|without listening/i.test(text)) return false;
  return /听力|听音|listening|audio|录音/i.test(text);
}

function wantsEnglishWordBank(input = {}) {
  const text = `${input.requirement || ""} ${input.specialRequirements || ""} ${input.title || ""}`;
  return /方框词|词库|word bank/i.test(text);
}

function wantsBonusQuestions(input = {}) {
  const text = compactText(`${input.requirement || ""} ${input.specialRequirements || ""} ${input.title || ""}`);
  if (/不要附加题|不需要附加题|无需附加题|不含附加题|不要附加|不需要附加|无需附加|不要拓展题|不需要拓展题|无需拓展题|不要挑战题|不需要挑战题|无需挑战题|no bonus|without bonus/i.test(text)) {
    return false;
  }
  return /附加题|附加|拓展题|挑战题|bonus/i.test(text);
}

function buildAssessmentBlueprint(input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const grade = gradeLevelNumber(input);
  const includeListening = subject === "英语" && wantsListening(input);
  const classical = subject === "语文" && grade >= 5;
  const blueprints = {
    数学: {
      试卷: { pages: 4, minItems: 30, maxItems: 36, sections: [
        { title: "一、填空题", type: "fill", target: 12 },
        { title: "二、选择题", type: "choice", target: 8 },
        { title: "三、计算题", type: "calculation", target: 8 },
        { title: "四、解答题", type: "solution", target: 6 }
      ] },
      小测: { pages: 2, minItems: 16, maxItems: 20, sections: [
        { title: "一、填空题", type: "fill", target: 6 },
        { title: "二、选择题", type: "choice", target: 4 },
        { title: "三、计算题", type: "calculation", target: 4 },
        { title: "四、解答题", type: "solution", target: 4 }
      ] },
      练习: { pages: 2, minItems: 16, maxItems: 20, sections: [
        { title: "一、基础巩固", type: "fill", target: 4 },
        { title: "二、易错辨析", type: "choice", target: 4 },
        { title: "三、计算题", type: "calculation", target: 4 },
        { title: "四、解决问题", type: "solution", target: 4 }
      ] }
    },
    语文: {
      试卷: { pages: 4, minItems: 25, maxItems: 30, sections: [
        { title: "一、基础知识", type: "fill", target: 10 },
        { title: "二、积累与应用", type: "solution", target: 8 },
        { title: classical ? "三、阅读理解（含文言文）" : "三、阅读理解", type: "reading", target: 10 },
        { title: "四、写作题", type: "writing", target: 1 }
      ] },
      小测: { pages: 2, minItems: 18, maxItems: 22, sections: [
        { title: "一、基础知识", type: "fill", target: 8 },
        { title: "二、积累与应用", type: "solution", target: 6 },
        { title: "三、阅读理解", type: "reading", target: 6 }
      ] },
      练习: { pages: 2, minItems: 16, maxItems: 22, sections: [
        { title: "一、薄弱点巩固", type: "fill", target: 6 },
        { title: "二、表达与应用", type: "solution", target: 6 },
        { title: "三、阅读提升", type: "reading", target: 6 }
      ] }
    },
    英语: {
      试卷: { pages: 4, minItems: includeListening ? 38 : 34, maxItems: includeListening ? 44 : 40, sections: [
        ...(includeListening ? [{ title: "一、听力", type: "listening", target: 8 }] : []),
        { title: includeListening ? "二、单项选择题" : "一、单项选择题", type: "choice", target: includeListening ? 12 : 14 },
        { title: includeListening ? "三、词汇运用" : "二、词汇运用", type: "fill", target: includeListening ? 12 : 14 },
        { title: includeListening ? "四、阅读理解" : "三、阅读理解", type: "reading", target: 10 },
        { title: includeListening ? "五、写作" : "四、写作", type: "writing", target: 1 }
      ] },
      小测: { pages: 2, minItems: 16, maxItems: 20, sections: [
        { title: "一、词汇与短语", type: "fill", target: 8 },
        { title: "二、句子运用", type: "solution", target: 2 },
        { title: "三、单项选择题", type: "choice", target: 4 },
        { title: "四、阅读理解", type: "reading", target: 6 }
      ] },
      练习: { pages: 2, minItems: 16, maxItems: 16, sections: [
        { title: "一、针对性词汇巩固", type: "fill", target: 4 },
        { title: "二、句型表达练习", type: "solution", target: 4 },
        { title: "三、易错选择题", type: "choice", target: 4 },
        { title: "四、短阅读巩固", type: "reading", target: 4 }
      ] }
    }
  };
  return blueprints[subject]?.[kind] || blueprints[subject]?.练习 || blueprints.英语.练习;
}

function buildPrintProfile(input = {}) {
  const kind = normalizeAssessmentKind(input.kind);
  const subject = normalizeSubject(input.subject);
  const blueprint = buildAssessmentBlueprint(input);
  const pages = Number(input.pages || input.pageCount) || blueprint.pages;
  const difficulty = input.difficulty || "基础";
  const columns = 1;
  const subjectProfiles = {
    语文: {
      answerSpace: kind === "试卷"
        ? "基础题使用括号、田字格或短作答区，阅读题保留简短分点作答区，写作题按页面空间显示题目或方格。"
        : "基础题使用括号、田字格或短作答区，阅读题保留简短分点作答区，小测和练习不设置作文题。",
      sections: blueprint.sections.map((item) => item.title.replace(/^.+?、/, "")),
      answerStyle: "language-compact"
    },
    数学: {
      answerSpace: difficulty === "基础" ? "计算题保留竖式和草稿空间，应用题保留分步作答区。" : "综合题保留画图、列式、分步推理空间。",
      sections: blueprint.sections.map((item) => item.title.replace(/^.+?、/, "")),
      answerStyle: "adaptive-math"
    },
    英语: {
      answerSpace: kind === "试卷"
        ? "试卷使用完整考试结构，包含文章选词填空、短文语法填空或完形填空、正式阅读和写作；写作只给题目与提示，不预留整篇写作空间。"
        : kind === "小测"
          ? "小测围绕教材单元或指定范围生成，包含中英文互译、单词书写、造句、少量选择和短阅读，不套用完整试卷结构。"
          : "练习围绕学生需求或教师指定薄弱点生成，包含词汇巩固、句型表达、易错选择和短阅读；不默认使用试卷式文章选词填空、完形填空、短文语法填空或写作。",
      sections: blueprint.sections.map((item) => item.title.replace(/^.+?、/, "")),
      answerStyle: "english-compact"
    }
  };
  const subjectProfile = subjectProfiles[subject] || subjectProfiles.英语;
  return {
    paper: "A4",
    subject,
    pages,
    columns,
    answerSpace: subjectProfile.answerSpace,
    answerStyle: subjectProfile.answerStyle,
    recommendedSections: subjectProfile.sections,
    blueprint,
    headerFields: ["姓名", "日期", "得分"],
    optimizationNotes: [
      kind === "试卷"
        ? `${kind}默认${pages}页A4，特殊要求只调整页数和题量，不改变完整测评结构。`
        : `${kind}默认${pages}页A4，按学生需求、教材单元或教师指定范围组织题型，不套用试卷模板。`,
      `${subject}模板优先使用：${subjectProfile.sections.join("、")}。`,
      input.textbookChapterTitle ? `本次内容绑定教材位置：${input.textbookTitle || "教材"} / ${input.textbookChapterTitle}。` : "",
      "题干、作答区和分值信息分层排版，优先保证学生看题与书写空间。",
      "导出内容需标记AI生成，教师打印前保留人工复核。"
    ].filter(Boolean)
  };
}

function buildLayoutTemplate(input = {}) {
  const kind = normalizeAssessmentKind(input.kind);
  const subject = normalizeSubject(input.subject);
  const profile = buildPrintProfile(input);
  return `${subject}${kind}A4打印模板-${profile.pages}页-${profile.columns}栏-${profile.answerStyle}`;
}

export function buildAssessmentBlueprintCheck(input = {}) {
  const modelInput = {
    ...input,
    requestId: input.requestId || "generation-blueprint-check"
  };
  const blueprint = buildAssessmentBlueprint(modelInput);
  const printProfile = buildPrintProfile(modelInput);
  const layoutTemplate = buildLayoutTemplate(modelInput);
  const fallbackItems = buildFallbackAssessmentItems(modelInput);
  const review = reviewAndRepairAssessmentItems(fallbackItems, modelInput);
  const audit = auditAssessmentDraft(review.items, modelInput, review.notes);
  return {
    subject: normalizeSubject(modelInput.subject),
    kind: normalizeAssessmentKind(modelInput.kind),
    grade: modelInput.grade || modelInput.targetGrade || null,
    blueprint,
    printProfile,
    layoutTemplate,
    itemCount: review.items.length,
    totalScore: review.totalScore,
    itemTypes: Array.from(new Set(review.items.map((item) => printableType(item)))),
    sectionCounts: audit.sectionCounts,
    audit
  };
}

async function persistRun(modelRun, options = {}) {
  if (!modelRun || options.persist === false) return null;
  return recordModelRun(modelRun, options);
}

function optionalText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildSubmissionOcr(input = {}) {
  const ocrText = optionalText(input.ocrText || input.note);
  const manualText = optionalText(input.manualText || input.correctedText);
  const studentAnswerText = optionalText(input.studentAnswerText || input.ocrStudentAnswerText);
  const printedText = optionalText(input.printedText);
  const status =
    input.ocrStatus ||
    (manualText ? "MANUAL_CORRECTED" : ocrText || studentAnswerText ? "USER_PROVIDED" : "PENDING");
  return {
    status,
    text: ocrText,
    studentAnswerText,
    printedText,
    manualText,
    confidence: optionalNumber(input.ocrConfidence) ?? (manualText ? 1 : ocrText || studentAnswerText || printedText ? 0.92 : null),
    pageNumber: optionalNumber(input.pageNumber),
    questionRange: optionalText(input.questionRange),
    imageIndex: optionalNumber(input.imageIndex),
    imageTotal: optionalNumber(input.imageTotal),
    questions: Array.isArray(input.ocrQuestions) ? input.ocrQuestions : [],
    imageQuality: input.imageQuality || null,
    source: input.uploadedBy === "student" ? "student_upload" : "teacher_upload",
    engine: input.ocrEngine || null,
    reviewed: false
  };
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

function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.text || item?.summary || item?.point || ""))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/\n|；|;|、/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberedTextSegments(value) {
  const source = String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/^\s*(?:答案|参考答案)\s*[:：]\s*/i, "")
    .trim();
  if (!source) return [];
  const entries = [];
  const pattern = /(?:^|[\s;；,，])(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、:=：）)]\s*([\s\S]*?)(?=(?:[\s;；,，]+(?:第\s*)?\d{1,3}\s*(?:题)?\s*[.、:=：）)])|$)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const text = String(match[2] || "").replace(/[;；,，]\s*$/, "").trim();
    if (match[1] && text) entries.push({ questionNo: String(Number(match[1])), text });
  }
  if (entries.length) return entries;
  return source
    .split(/[;；,\n\r]+/)
    .map((part) => part.trim())
    .map((part) => part.match(/^(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、:=：）)]?\s*(.+)$/))
    .filter(Boolean)
    .map((item) => ({ questionNo: String(Number(item[1])), text: item[2].trim() }))
    .filter((item) => item.text);
}

function parseAnswerKeyReferenceAnswers(answerKey) {
  return parseNumberedTextSegments(answerKey).map((item, index) => normalizeReferenceAnswerItem({
    questionNo: item.questionNo,
    correctAnswer: item.text,
    confidence: 1
  }, index));
}

function mergeReferenceAnswerGroups(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const normalized = normalizeReferenceAnswerItem(item, merged.length);
      const key = String(normalized.questionNo || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

function normalizeReferenceAnswerItem(item, index) {
  const source = typeof item === "string" ? { correctAnswer: item } : item || {};
  const questionNo = String(source.questionNo ?? source.no ?? source.orderIndex ?? source.index ?? index + 1);
  const analysisSteps = toStringArray(source.analysisSteps || source.steps || source.analysis || source.explanation);
  return {
    questionNo,
    prompt: String(source.prompt ?? source.question ?? source.printedPrompt ?? "").trim(),
    correctAnswer: String(source.correctAnswer ?? source.answer ?? source.standardAnswer ?? source.expectedAnswer ?? "").trim(),
    analysisSteps,
    knowledgePoint: String(source.knowledgePoint || source.point || source.skill || "").trim(),
    score: optionalNumber(source.score),
    confidence: clampUnit(source.confidence, 0.72)
  };
}

function assignmentAnswerReferences(input = {}) {
  const items = Array.isArray(input.assignmentItems) ? input.assignmentItems : [];
  const manifestQuestions = Array.isArray(input.questionLayoutManifest?.questions)
    ? input.questionLayoutManifest.questions
    : [];
  const manifestByQuestion = new Map(manifestQuestions.map((item) => [String(item.questionNo || item.orderIndex || ""), item]));
  const itemReferences = items
    .filter((item) => item?.answer || item?.rubric || item?.metadata?.answer)
    .map((item, index) => normalizeReferenceAnswerItem({
      questionNo: item.questionNo || item.orderIndex || index + 1,
      prompt: item.prompt,
      correctAnswer: item.answer || item.metadata?.answer || "",
      analysisSteps: item.rubric || item.metadata?.analysisSteps || item.metadata?.analysis || [],
      knowledgePoint: item.metadata?.knowledgePoint || item.knowledgePoint || "",
      score: item.score || item.metadata?.score,
      confidence: 1
    }, index));
  const existing = new Set(itemReferences.map((item) => String(item.questionNo || "")));
  const manifestReferences = manifestQuestions
    .filter((item) => (item.answer || item.analysisSteps?.length) && !existing.has(String(item.questionNo || item.orderIndex || "")))
    .map((item, index) => normalizeReferenceAnswerItem({
      questionNo: item.questionNo || item.orderIndex || index + 1,
      prompt: item.prompt,
      correctAnswer: item.answer || "",
      analysisSteps: item.analysisSteps || [],
      knowledgePoint: item.knowledgePoint || "",
      score: item.score,
      confidence: 1
    }, index));
  return itemReferences.map((item) => {
    const manifest = manifestByQuestion.get(String(item.questionNo || ""));
    if (!manifest) return item;
    return {
      ...item,
      prompt: item.prompt || manifest.prompt || "",
      analysisSteps: item.analysisSteps?.length ? item.analysisSteps : manifest.analysisSteps || [],
      knowledgePoint: item.knowledgePoint || manifest.knowledgePoint || "",
      score: item.score ?? optionalNumber(manifest.score)
    };
  }).concat(manifestReferences);
}

function hasReferenceAnswerEvidence(input = {}) {
  return Boolean(input.answerKey) ||
    assignmentAnswerReferences(input).length > 0 ||
    (Array.isArray(input.referenceAnswers) && input.referenceAnswers.length > 0);
}

async function prepareSubmissionReferenceAnswers(config, input = {}, ocr = {}, options = {}) {
  const assignmentReferences = assignmentAnswerReferences(input);
  const explicitReferences = Array.isArray(input.referenceAnswers) ? input.referenceAnswers.map(normalizeReferenceAnswerItem) : [];
  const answerKeyReferences = parseAnswerKeyReferenceAnswers(input.answerKey);
  const keyedReferenceAnswers = mergeReferenceAnswerGroups(assignmentReferences, explicitReferences, answerKeyReferences);
  if (input.answerKey || keyedReferenceAnswers.length) {
    return {
      mode: "answer_key",
      available: true,
      source: "teacher_or_generated_assignment",
      answerKey: input.answerKey || null,
      referenceAnswers: keyedReferenceAnswers,
      confidence: 1,
      needsTeacherReview: false,
      modelRunId: null,
      summary: "已使用老师答案键或生成记录答案。"
    };
  }

  const questionEvidence = optionalText(input.printedText || ocr.printedText || input.ocrText || ocr.text);
  if (!questionEvidence) {
    return {
      mode: "missing_question_evidence",
      available: false,
      source: "none",
      referenceAnswers: [],
      confidence: 0,
      needsTeacherReview: true,
      modelRunId: null,
      summary: "未识别到足够题干，无法生成可靠参考答案。"
    };
  }

  const referenceAnswerRunner = options.referenceAnswerRunner || generateSubmissionReferenceAnswers;
  const runnerInput = {
    ...input,
    ocrText: input.ocrText || ocr.text || "",
    studentAnswerText: input.studentAnswerText || ocr.studentAnswerText || "",
    printedText: input.printedText || ocr.printedText || "",
    ocrQuestions: Array.isArray(input.ocrQuestions) ? input.ocrQuestions : ocr.questions || []
  };
  let result = await referenceAnswerRunner(config, runnerInput);
  let modelRun = await persistRun(result.modelRun, options);
  let escalationModelRun = null;
  let escalationPersistenceError = null;
  let solAttempted = result.modelRun?.metadata?.solAttempted === true;
  let usedModelEscalation = result.modelRun?.metadata?.usedModelEscalation === true;
  if (usedModelEscalation) escalationModelRun = modelRun;
  let parsed = parseJsonObjectText(result.referenceText) || {};
  let rawAnswers = Array.isArray(parsed.referenceAnswers)
    ? parsed.referenceAnswers
    : Array.isArray(parsed.answers)
      ? parsed.answers
      : [];
  let normalizedAnswers = rawAnswers
    .map(normalizeReferenceAnswerItem)
    .filter((item) => item.correctAnswer || item.prompt);
  let averageConfidence = normalizedAnswers.length
    ? normalizedAnswers.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / normalizedAnswers.length
    : optionalNumber(parsed.confidence) ?? 0;
  const runtime = normalizeRuntimeConfig(config);
  const solEnabled = solEscalationEnabled(runtime);
  const alreadyEscalated = result.modelRun?.metadata?.usedModelEscalation === true;
  const clearPrintedEvidence = Boolean(
    runnerInput.printedText ||
    runnerInput.ocrQuestions.some((item) => String(item?.printedText || item?.printedPrompt || "").trim())
  );
  if (solEnabled && clearPrintedEvidence && !alreadyEscalated && result.available && normalizedAnswers.length && averageConfidence < 0.72) {
    const solResult = await referenceAnswerRunner(config, runnerInput, {
      model: runtime.gpt56SolModel,
      timeoutMs: runtime.gpt56SolFallbackTimeoutMs,
      reasoningEffort: "high",
      role: "sol-reference-escalation",
      disableSolEscalation: true
    });
    const solParsed = parseJsonObjectText(solResult.referenceText) || {};
    const solRawAnswers = Array.isArray(solParsed.referenceAnswers)
      ? solParsed.referenceAnswers
      : Array.isArray(solParsed.answers)
        ? solParsed.answers
        : [];
    const solAnswers = solRawAnswers
      .map(normalizeReferenceAnswerItem)
      .filter((item) => item.correctAnswer || item.prompt);
    solAttempted = true;
    let solModelRun = null;
    let solPersistenceAvailable = true;
    try {
      solModelRun = await persistRun(solResult.modelRun, options);
      escalationModelRun = solModelRun;
    } catch (error) {
      solPersistenceAvailable = false;
      escalationPersistenceError = String(error?.message || error || "Sol escalation persistence failed");
    }
    if (solPersistenceAvailable && solResult.available && solAnswers.length) {
      result = solResult;
      parsed = solParsed;
      rawAnswers = solRawAnswers;
      normalizedAnswers = solAnswers;
      averageConfidence = solAnswers.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / solAnswers.length;
      modelRun = solModelRun;
      usedModelEscalation = true;
    }
  }
  const referenceAnswers = normalizedAnswers;
  return {
    mode: "ai_generated_reference",
    available: Boolean(result.available && referenceAnswers.length),
    source: "gpt56_reference_answer",
    answerKey: null,
    referenceAnswers,
    confidence: Number(averageConfidence.toFixed(3)),
    needsTeacherReview: Boolean(parsed.needsTeacherReview ?? averageConfidence < 0.72),
    modelRunId: modelRun?.id || null,
    escalationModelRunId: escalationModelRun?.id || null,
    escalationPersistenceError,
    solAttempted,
    usedModelEscalation,
    summary: String(parsed.summary || result.error || "AI已尝试生成参考答案。").trim(),
    rawText: result.referenceText || "",
    error: result.error || null
  };
}

function parseGradingAuditResult(auditResult = null) {
  if (!auditResult) {
    return {
      required: true,
      available: false,
      status: "needs_review",
      riskLevel: "high",
      scoreReliable: false,
      archiveAllowed: false,
      issues: ["第二模型审计未执行。"],
      suggestions: []
    };
  }
  if (auditResult.merged === true) {
    return {
      required: auditResult.required !== false,
      available: Boolean(auditResult.available),
      status: auditResult.status || "needs_review",
      riskLevel: auditResult.riskLevel || "high",
      scoreReliable: auditResult.scoreReliable === true,
      archiveAllowed: auditResult.archiveAllowed === true,
      issues: toStringArray(auditResult.issues),
      suggestions: toStringArray(auditResult.suggestions),
      raw: auditResult.raw || {},
      error: auditResult.error || null,
      modelRun: auditResult.modelRun || null
    };
  }
  const parsed = parseJsonObjectText(auditResult.reviewText) || {};
  const issues = [
    ...toStringArray(parsed.issues),
    ...toStringArray(parsed.blockedReasons),
    ...toStringArray(parsed.questionFlags)
  ];
  const status = String(parsed.status || (auditResult.available ? "needs_review" : "unavailable")).toLowerCase();
  const riskLevel = String(parsed.riskLevel || "medium").toLowerCase();
  const unavailable = !auditResult.available || /unavailable|error|fail|失败/.test(status);
  const scoreReliable = !unavailable && parsed.scoreReliable !== false && !/needs|review|fail|block|不通过|复核/.test(status) && !/high|高/.test(riskLevel);
  const archiveAllowed = parsed.archiveAllowed === true && scoreReliable;
  const suggestions = toStringArray(parsed.suggestions);
  if (!scoreReliable && !issues.length) {
    issues.push(unavailable ? "模型审查未完成。" : "模型审查要求教师复核。");
  }
  return {
    required: true,
    available: Boolean(auditResult.available),
    status,
    riskLevel,
    scoreReliable,
    archiveAllowed,
    issues,
    suggestions,
    raw: parsed,
    error: auditResult.error || null,
    modelRun: auditResult.modelRun || null
  };
}

function parseAssessmentQualityReview(auditResult = null, label = "模型审查") {
  if (!auditResult) {
    return {
      label,
      available: false,
      status: "needs_review",
      riskLevel: "high",
      exportReady: false,
      qualityScore: null,
      issues: [`${label}未执行。`],
      suggestions: []
    };
  }
  const parsed = parseJsonObjectText(auditResult.reviewText) || {};
  const unavailable = !auditResult.available;
  const issues = [
    ...toStringArray(parsed.issues),
    ...toStringArray(parsed.blockedReasons)
  ];
  if (unavailable) issues.push(`${label}未完成：${auditResult.error || "模型不可用或超时。"}`);
  const status = String(parsed.status || (unavailable ? "needs_review" : "pass")).toLowerCase();
  const riskLevel = String(parsed.riskLevel || (unavailable ? "high" : "medium")).toLowerCase();
  const exportReady = !unavailable &&
    parsed.exportReady !== false &&
    !/needs|review|fail|block|不通过|复核/.test(status) &&
    !/high|高/.test(riskLevel);
  if (!exportReady && !issues.length) issues.push(`${label}要求教师重点复核。`);
  return {
    label,
    available: Boolean(auditResult.available),
    status,
    riskLevel,
    exportReady,
    qualityScore: optionalNumber(parsed.qualityScore),
    issues,
    suggestions: toStringArray(parsed.suggestions),
    raw: parsed,
    error: auditResult.error || null,
    modelRun: auditResult.modelRun || null
  };
}

function compactAssessmentQualityReview(auditResult = null, label = "模型审查", modelRunId = null) {
  const { modelRun, ...review } = parseAssessmentQualityReview(auditResult, label);
  return {
    ...review,
    modelRunId: modelRunId || null,
    modelRunStatus: modelRun?.status || null
  };
}

function strongestRiskLevel(values = []) {
  const order = { low: 1, medium: 2, high: 3 };
  return values.reduce((current, value) => {
    const normalized = String(value || "medium").toLowerCase();
    return order[normalized] > order[current] ? normalized : current;
  }, "low");
}

function mergeGradingAudits(audits = [], config = {}) {
  const requireSecondModelAudit = String(config.GRADING_REQUIRE_SECOND_MODEL_AUDIT ?? config.gradingRequireSecondModelAudit ?? "true").toLowerCase() !== "false";
  const requirePremiumJudge = String(config.GRADING_REQUIRE_PREMIUM_JUDGE ?? config.gradingRequirePremiumJudge ?? "true").toLowerCase() !== "false";
  const normalized = audits.map((entry) => ({
    role: entry.role,
    required: entry.role === "premium" ? requirePremiumJudge : requireSecondModelAudit,
    label: entry.label,
    audit: parseGradingAuditResult(entry.result)
  }));
  const requiredAudits = normalized.filter((entry) => entry.required);
  const blocking = requiredAudits.filter((entry) => !entry.audit.available || !entry.audit.scoreReliable || !entry.audit.archiveAllowed);
  const issues = normalized.flatMap((entry) => {
    const prefix = entry.label ? `${entry.label}：` : "";
    const ownIssues = entry.audit.issues.length ? entry.audit.issues : entry.audit.error ? [entry.audit.error] : [];
    if (!entry.audit.available && entry.required) {
      ownIssues.push(`${entry.label || entry.role}未完成，不能生成最终分。`);
    }
    return ownIssues.map((issue) => `${prefix}${issue}`);
  });
  const suggestions = normalized.flatMap((entry) => {
    const prefix = entry.label ? `${entry.label}：` : "";
    return entry.audit.suggestions.map((suggestion) => `${prefix}${suggestion}`);
  });
  const available = requiredAudits.length > 0 && requiredAudits.every((entry) => entry.audit.available);
  const scoreReliable = blocking.length === 0 && requiredAudits.every((entry) => entry.audit.scoreReliable);
  const archiveAllowed = scoreReliable && requiredAudits.every((entry) => entry.audit.archiveAllowed);
  return {
    merged: true,
    available,
    status: archiveAllowed ? "pass" : "needs_review",
    riskLevel: blocking.length ? "high" : strongestRiskLevel(normalized.map((entry) => entry.audit.riskLevel)),
    scoreReliable,
    archiveAllowed,
    issues,
    suggestions,
    raw: {
      audits: normalized.map((entry) => ({
        role: entry.role,
        label: entry.label,
        required: entry.required,
        ...entry.audit
      }))
    }
  };
}

function shouldRunDeepGradingAudit(config = {}, input = {}, options = {}) {
  if (options.runDeepGradingAudit != null) return options.runDeepGradingAudit === true;
  if (input.runDeepGradingAudit != null) return input.runDeepGradingAudit === true;
  const configFlag = config.GRADING_RUN_DEEP_AUDIT ?? config.gradingRunDeepAudit ?? config.GRADING_ENABLE_DEEP_AUDIT ?? config.gradingEnableDeepAudit;
  if (configFlag != null) return String(configFlag).toLowerCase() === "true";
  return false;
}

function skippedGradingAudit() {
  return {
    merged: true,
    required: false,
    available: true,
    status: "skipped",
    riskLevel: "low",
    scoreReliable: null,
    archiveAllowed: false,
    issues: [],
    suggestions: ["深度批改审查未启用；归档仍需教师逐题复核确认。"],
    raw: { audits: [] },
    error: null
  };
}

function applyGradingAudit(structured = {}, auditResult = null, config = {}) {
  const audit = parseGradingAuditResult(auditResult);
  const configRequiresAudit =
    String(config.GRADING_REQUIRE_SECOND_MODEL_AUDIT ?? config.gradingRequireSecondModelAudit ?? "true").toLowerCase() !== "false" ||
    String(config.GRADING_REQUIRE_PREMIUM_JUDGE ?? config.gradingRequirePremiumJudge ?? "true").toLowerCase() !== "false";
  const requireAudit = audit.required !== false && configRequiresAudit;
  const shouldBlock = requireAudit && (!audit.available || !audit.scoreReliable || !audit.archiveAllowed);
  if (!shouldBlock) {
    return {
      ...structured,
      gradingAudit: audit,
      quality: {
        ...(structured.quality || {}),
        secondModelAudit: audit
      }
    };
  }
  const provisionalScore = structured.provisionalScore ?? structured.score ?? null;
  const auditReason = audit.available
    ? "模型审查认为本次批改证据仍需教师复核，暂不生成最终分数。"
    : "必需模型审查未完成，暂不生成最终分数。";
  return {
    ...structured,
    score: null,
    provisionalScore,
    summary: `${auditReason}${structured.summary ? ` ${structured.summary}` : ""}`,
    needsTeacherReview: true,
    reviewStatus: "model_audit_needs_review",
    archiveEligible: false,
    gradingAudit: audit,
    quality: {
      ...(structured.quality || {}),
      lowConfidence: true,
      auditBlocked: true,
      secondModelAudit: audit,
      reason: auditReason
    }
  };
}

function normalizeMistake(item, index, input = {}) {
  const source = typeof item === "string" ? { prompt: item } : item || {};
  const point = source.knowledgePoint || source.point || source.topic || source.skill || "";
  return {
    id: source.id || `mistake-${index + 1}`,
    subject: source.subject || input.subject || "",
    point,
    knowledgePoint: point,
    prompt: source.prompt || source.question || source.title || point || `Mistake ${index + 1}`,
    studentAnswer: source.studentAnswer || source.wrongAnswer || source.answer || "",
    correctAnswer: source.correctAnswer || source.expectedAnswer || "",
    cause: source.cause || source.reason || source.errorType || "",
    severity: source.severity || "normal",
    nextAction: source.nextAction || source.practice || ""
  };
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeQuestionStatus(value) {
  const text = String(value || "").toLowerCase();
  if (["correct", "right", "true"].includes(text) || text.includes("对") || text.includes("正确")) return "correct";
  if (["wrong", "incorrect", "false"].includes(text) || text.includes("错") || text.includes("错误")) return "wrong";
  if (["partial", "partly"].includes(text) || text.includes("部分")) return "partial";
  return "uncertain";
}

function fallbackBBox(index, total, imageTotal = 1) {
  const markerCount = Math.max(1, Math.min(total || 1, 10));
  const row = index % markerCount;
  const page = Math.min(Math.max(1, Math.floor(index / markerCount) + 1), Math.max(1, Number(imageTotal) || 1));
  return {
    page,
    x: 0.08,
    y: Math.min(0.88, 0.12 + row * (0.76 / markerCount)),
    w: 0.84,
    h: Math.max(0.05, Math.min(0.1, 0.76 / markerCount))
  };
}

function manifestQuestionFor(input = {}, questionNo = "") {
  const questions = Array.isArray(input.questionLayoutManifest?.questions) ? input.questionLayoutManifest.questions : [];
  const normalizedQuestionNo = String(questionNo || "");
  return questions.find((item, index) =>
    String(item.questionNo || item.orderIndex || index + 1) === normalizedQuestionNo
  ) || null;
}

function normalizeBBox(value, index, total, input = {}, questionNo = "") {
  const manifest = manifestQuestionFor(input, questionNo);
  const fallback = manifest?.bbox || fallbackBBox(index, total, input.imageNames?.length || input.uploadedFiles?.length || 1);
  const source = value && typeof value === "object" ? value : {};
  return {
    page: Math.max(1, Math.round(Number(source.page || source.imageIndex || fallback.page) || fallback.page)),
    x: clampUnit(source.x ?? source.left, fallback.x),
    y: clampUnit(source.y ?? source.top, fallback.y),
    w: Math.max(0.04, clampUnit(source.w ?? source.width, fallback.w)),
    h: Math.max(0.035, clampUnit(source.h ?? source.height, fallback.h))
  };
}

function normalizeSubmissionOcrQuestion(item, index, total, input = {}, referenceByQuestion = new Map()) {
  const source = item && typeof item === "object" ? item : {};
  const questionNo = String(source.questionNo || source.no || source.index || index + 1);
  const reference = referenceByQuestion.get(questionNo) || {};
  return {
    questionNo,
    printedText: String(source.printedText || source.prompt || source.question || reference.prompt || "").trim(),
    studentAnswer: String(source.studentAnswer || source.studentAnswerText || source.answer || source.studentWork || "").trim(),
    correctAnswer: String(source.correctAnswer || source.expectedAnswer || reference.correctAnswer || "").trim(),
    confidence: clampUnit(source.confidence, 0.92),
    bbox: normalizeBBox(source.bbox || source.box || source.position, index, total, input, questionNo)
  };
}

function compareObjectiveAnswers(reference = {}, question = {}) {
  const expected = String(reference.correctAnswer || question.correctAnswer || "").normalize("NFKC").trim();
  const actual = String(question.studentAnswer || "").normalize("NFKC").trim();
  const prompt = String(question.printedText || reference.prompt || "");
  if (!expected || !actual || Number(question.confidence ?? 0) < 0.85 || Number(reference.confidence ?? 0) < 0.9) return null;
  if (/言之有理|合理即可|答案不唯一|多种答案|任意|参考答案|示例|开放题|略|酌情|或/.test(expected)) return null;
  if (/说明|分析|理由|为什么|简答|作文|写作|解答|证明|过程|结合|谈谈|概括|赏析|造句|翻译/.test(prompt)) return null;

  const clean = (value) => value
    .toLowerCase()
    .replace(/^\s*[（(]?\s*/, "")
    .replace(/\s*[）)]?\s*[。.!！?？,，;；:：]*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const expectedClean = clean(expected);
  const actualClean = clean(actual);
  const numberPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
  if (numberPattern.test(expectedClean) && numberPattern.test(actualClean)) {
    return Number(expectedClean) === Number(actualClean);
  }
  if (/^[a-z]$/i.test(expectedClean) && /^[a-z]$/i.test(actualClean)) {
    return expectedClean === actualClean;
  }
  const shortExactAnswer = expectedClean.length <= 24 && !/[。！？!?；;]/.test(expectedClean);
  if (!shortExactAnswer) return null;
  return expectedClean === actualClean;
}

function buildDeterministicGradingPlan(input = {}, ocr = {}, referenceAnswers = []) {
  const references = Array.isArray(referenceAnswers) ? referenceAnswers : [];
  const questions = Array.isArray(ocr.questions) ? ocr.questions : [];
  const questionByNo = new Map(questions.map((item) => [String(item.questionNo || ""), item]));
  const deterministicResults = [];
  const unresolvedReferences = [];
  const unresolvedQuestions = [];

  for (const reference of references) {
    const questionNo = String(reference.questionNo || "");
    const question = questionByNo.get(questionNo) || normalizeSubmissionOcrQuestion({ questionNo }, 0, 1, input, new Map([[questionNo, reference]]));
    const comparison = compareObjectiveAnswers(reference, question);
    if (comparison == null) {
      unresolvedReferences.push(reference);
      unresolvedQuestions.push(question);
      continue;
    }
    deterministicResults.push(normalizeQuestionResult({
      questionNo,
      status: comparison ? "correct" : "wrong",
      studentAnswer: question.studentAnswer,
      correctAnswer: reference.correctAnswer,
      explanation: comparison ? "学生答案与明确答案一致。" : "学生答案与明确答案不一致。",
      knowledgePoint: reference.knowledgePoint || input.subject || "",
      maxScore: reference.score,
      confidence: Math.min(Number(question.confidence || 0.92), Number(reference.confidence || 1)),
      bbox: question.bbox
    }, deterministicResults.length, input, references.length));
  }

  for (const question of questions) {
    const questionNo = String(question.questionNo || "");
    if (references.some((item) => String(item.questionNo || "") === questionNo)) continue;
    unresolvedQuestions.push(question);
  }

  return {
    deterministicResults,
    unresolvedReferences,
    unresolvedQuestions,
    fullyResolved: references.length > 0 && deterministicResults.length === references.length && unresolvedQuestions.length === 0
  };
}

function filterQuestionLayoutManifest(manifest = null, questionNos = new Set()) {
  if (!manifest) return null;
  const questions = (manifest.questions || []).filter((item, index) => questionNos.has(String(item.questionNo || item.orderIndex || index + 1)));
  return { ...manifest, questionCount: questions.length, questions };
}

function buildUnresolvedGradingInput(input = {}, plan = {}) {
  const questionNos = new Set(plan.unresolvedQuestions.map((item) => String(item.questionNo || "")));
  const numberedText = (field) => plan.unresolvedQuestions
    .map((item) => `${item.questionNo}. ${String(item[field] || "").trim()}`.trim())
    .filter((item) => !/\.\s*$/.test(item))
    .join(" ");
  return {
    ...input,
    answerKey: null,
    referenceAnswers: plan.unresolvedReferences,
    ocrQuestions: plan.unresolvedQuestions,
    printedText: numberedText("printedText"),
    ocrText: numberedText("printedText"),
    studentAnswerText: numberedText("studentAnswer"),
    questionLayoutManifest: filterQuestionLayoutManifest(input.questionLayoutManifest, questionNos)
  };
}

function mergeDeterministicGradingResult(result = {}, deterministicResults = [], input = {}) {
  const parsed = parseJsonObjectText(result.gradingText) || {};
  const remoteQuestions = Array.isArray(parsed.questionResults) ? parsed.questionResults : Array.isArray(parsed.questions) ? parsed.questions : [];
  const referenceByNo = new Map((input.referenceAnswers || []).map((item) => [String(item.questionNo || ""), item]));
  const questionByNo = new Map((input.ocrQuestions || []).map((item) => [String(item.questionNo || ""), item]));
  const resultByNo = new Map([
    ...deterministicResults.map((item) => [String(item.questionNo || ""), item]),
    ...remoteQuestions.map((item, index) => [String(item.questionNo || item.no || index + 1), item])
  ]);
  const order = Array.from(new Set([
    ...(input.referenceAnswers || []).map((item) => String(item.questionNo || "")),
    ...(input.ocrQuestions || []).map((item) => String(item.questionNo || "")),
    ...resultByNo.keys()
  ])).filter(Boolean);
  return {
    ...result,
    gradingText: JSON.stringify({
      ...parsed,
      questionResults: order.map((questionNo) => {
        const resolved = resultByNo.get(questionNo);
        if (resolved) return resolved;
        const reference = referenceByNo.get(questionNo) || {};
        const question = questionByNo.get(questionNo) || {};
        return {
          questionNo,
          status: "uncertain",
          studentAnswer: question.studentAnswer || "",
          correctAnswer: reference.correctAnswer || question.correctAnswer || "",
          explanation: "模型未返回该题的批改结果，需要教师复核。",
          knowledgePoint: reference.knowledgePoint || input.subject || "",
          maxScore: reference.score,
          confidence: 0,
          bbox: question.bbox
        };
      })
    })
  };
}

function buildStructuredSubmissionOcrQuestions(input = {}, ocr = {}, referenceAnswers = []) {
  const referenceByQuestion = new Map(
    (Array.isArray(referenceAnswers) ? referenceAnswers : []).map((item) => [String(item.questionNo || ""), item])
  );
  const existingQuestions = Array.isArray(ocr.questions) ? ocr.questions : [];
  const existingByQuestion = new Map(existingQuestions.map((item, index) => [
    String(item?.questionNo || item?.no || item?.index || index + 1),
    item
  ]));
  const printedByQuestion = new Map(parseNumberedTextSegments(input.printedText || ocr.printedText || input.ocrText || ocr.text)
    .map((item) => [item.questionNo, item.text]));
  const studentByQuestion = new Map(parseNumberedTextSegments(input.studentAnswerText || ocr.studentAnswerText || input.ocrStudentAnswerText)
    .map((item) => [item.questionNo, item.text]));
  const questionNos = Array.from(new Set([
    ...referenceByQuestion.keys(),
    ...printedByQuestion.keys(),
    ...studentByQuestion.keys(),
    ...existingByQuestion.keys()
  ])).filter(Boolean);

  return questionNos.map((questionNo, index) => {
    const existing = existingByQuestion.get(questionNo) || {};
    return normalizeSubmissionOcrQuestion({
      ...existing,
      questionNo,
      printedText: existing.printedText || existing.prompt || printedByQuestion.get(questionNo) || "",
      studentAnswer: existing.studentAnswer || existing.studentAnswerText || existing.answer || studentByQuestion.get(questionNo) || "",
      correctAnswer: existing.correctAnswer || referenceByQuestion.get(questionNo)?.correctAnswer || ""
    }, index, questionNos.length, input, referenceByQuestion);
  });
}

function enrichSubmissionOcr(input = {}, ocr = {}, referenceAnswers = []) {
  const questions = Array.isArray(ocr.questions) && ocr.questions.length
    ? ocr.questions.map((item, index) => normalizeSubmissionOcrQuestion(
        item,
        index,
        ocr.questions.length,
        input,
        new Map((referenceAnswers || []).map((reference) => [String(reference.questionNo || ""), reference]))
      ))
    : buildStructuredSubmissionOcrQuestions(input, ocr, referenceAnswers);
  return {
    ...ocr,
    confidence: ocr.confidence ?? (questions.length ? 0.92 : null),
    questions
  };
}

function buildSubmissionQuestionLayoutManifest(input = {}, ocr = {}, referenceAnswers = []) {
  if (input.questionLayoutManifest?.questions?.length) return input.questionLayoutManifest;
  const questions = Array.isArray(ocr.questions) && ocr.questions.length
    ? ocr.questions
    : buildStructuredSubmissionOcrQuestions(input, ocr, referenceAnswers);
  if (!questions.length) return null;
  const referenceByQuestion = new Map((referenceAnswers || []).map((item) => [String(item.questionNo || ""), item]));
  return {
    version: "submission-layout-manifest-v1",
    source: "typed-text-estimate",
    questionCount: questions.length,
    generatedAt: new Date().toISOString(),
    questions: questions.map((question, index) => {
      const questionNo = String(question.questionNo || index + 1);
      const reference = referenceByQuestion.get(questionNo) || {};
      return {
        questionNo,
        orderIndex: index + 1,
        prompt: question.printedText || reference.prompt || "",
        answer: question.correctAnswer || reference.correctAnswer || "",
        score: optionalNumber(reference.score),
        page: question.bbox?.page || 1,
        bbox: question.bbox || fallbackBBox(index, questions.length, 1),
        bboxSource: "typed-text-estimate"
      };
    })
  };
}

function summarizeQuestionLayoutManifestForAudit(manifest = null) {
  if (!manifest) return null;
  return {
    version: manifest.version || null,
    source: manifest.source || null,
    questionCount: manifest.questionCount || manifest.questions?.length || 0,
    questions: (manifest.questions || []).slice(0, 80)
  };
}

function normalizeQuestionResult(item, index, input = {}, total = 1) {
  const source = typeof item === "string" ? { explanation: item } : item || {};
  const status = normalizeQuestionStatus(source.status || source.result || source.correctness);
  const questionNo = String(source.questionNo ?? source.no ?? source.orderIndex ?? source.index ?? index + 1);
  const manifest = manifestQuestionFor(input, questionNo);
  const process = toStringArray(source.studentProcess || source.process || source.steps || source.reasoning);
  const explanation = String(source.explanation || source.analysis || source.correctProcess || source.reason || "").trim();
  const errorStep = String(source.errorStep || source.wrongStep || source.errorReason || source.cause || "").trim();
  const maxScore = optionalNumber(source.maxScore ?? source.fullScore ?? source.points ?? source.score ?? manifest?.score);
  const earnedScore = optionalNumber(
    source.earnedScore ??
    source.studentScore ??
    source.awardedScore ??
    (source.maxScore != null || source.fullScore != null || source.points != null ? source.score : null)
  );
  return {
    id: source.id || `question-${questionNo}`,
    questionNo,
    status,
    studentAnswer: String(source.studentAnswer || source.answer || source.studentWork || "").trim(),
    correctAnswer: String(source.correctAnswer ?? source.expectedAnswer ?? source.standardAnswer ?? manifest?.answer ?? "").trim(),
    studentProcess: process,
    errorStep,
    explanation: explanation || (Array.isArray(manifest?.analysisSteps) ? manifest.analysisSteps.join("；") : ""),
    knowledgePoint: String(source.knowledgePoint || source.point || source.skill || manifest?.knowledgePoint || input.subject || "").trim(),
    suggestedPractice: String(source.suggestedPractice || source.nextAction || source.practice || "").trim(),
    maxScore,
    score: earnedScore,
    confidence: clampUnit(source.confidence, status === "uncertain" ? 0.45 : 0.72),
    bbox: normalizeBBox(source.bbox || source.box || source.position, index, total, input, questionNo),
    modelEscalated: source.modelEscalated === true ? true : undefined
  };
}

function defaultSubmissionTotalScore(input = {}) {
  const explicit = optionalNumber(input.totalScore ?? input.fullScore ?? input.maxScore);
  if (explicit != null) return explicit;
  const kind = String(input.kind || input.assignmentKind || "").trim();
  if (/小测|练习/.test(kind)) return 60;
  if (/试卷|考试|期中|期末/.test(kind)) return 100;
  return 100;
}

function inferScoreFromQuestionResults(questionResults = [], input = {}) {
  if (!questionResults.length) return null;
  if (questionResults.some((item) => item.status === "uncertain")) return null;
  const explicitScores = questionResults.map((item) => optionalNumber(item.score));
  if (explicitScores.every((score) => score != null)) {
    return Number(explicitScores.reduce((sum, score) => sum + Number(score), 0).toFixed(2));
  }
  const totalScore = defaultSubmissionTotalScore(input);
  const perQuestion = totalScore / questionResults.length;
  const earned = questionResults.reduce((sum, item) => {
    if (item.status === "correct") return sum + perQuestion;
    if (item.status === "partial") return sum + perQuestion * 0.5;
    return sum;
  }, 0);
  return Number(earned.toFixed(2));
}

function applyQuestionScoreTrace(questionResults = [], input = {}, earnedScore = null) {
  if (!questionResults.length) return questionResults;
  const references = Array.isArray(input.referenceAnswers) ? input.referenceAnswers : [];
  const referenceByQuestion = new Map(references.map((item) => [String(item.questionNo || ""), item]));
  const allCorrect = questionResults.every((item) => item.status === "correct");
  const fallbackTotal = allCorrect && earnedScore != null
    ? Number(earnedScore)
    : defaultSubmissionTotalScore(input);
  const fallbackMaxScore = fallbackTotal / questionResults.length;
  return questionResults.map((item) => {
    const reference = referenceByQuestion.get(String(item.questionNo || ""));
    const maxScore = optionalNumber(item.maxScore ?? reference?.score) ?? fallbackMaxScore;
    const score = optionalNumber(item.score) ?? (
      item.status === "correct"
        ? maxScore
        : item.status === "partial"
          ? maxScore * 0.5
          : 0
    );
    return {
      ...item,
      maxScore: Number(Number(maxScore).toFixed(2)),
      score: Number(Number(score).toFixed(2))
    };
  });
}

function fallbackQuestionResults(parsed = {}, mistakes = [], input = {}) {
  if (mistakes.length) {
    return mistakes.map((mistake, index) => normalizeQuestionResult({
      questionNo: index + 1,
      status: "wrong",
      studentAnswer: mistake.studentAnswer,
      correctAnswer: mistake.correctAnswer,
      errorStep: mistake.cause,
      explanation: mistake.prompt,
      knowledgePoint: mistake.knowledgePoint || mistake.point,
      suggestedPractice: mistake.nextAction
    }, index, input, mistakes.length));
  }
  const score = Number(parsed.score ?? input.score);
  if (Number.isFinite(score) && score >= 95) {
    return [normalizeQuestionResult({
      questionNo: "总览",
      status: "correct",
      explanation: parsed.summary || "本次图片批改未发现明显错误，建议教师快速抽查后归档。",
      knowledgePoint: input.subject || ""
    }, 0, input, 1)];
  }
  return [normalizeQuestionResult({
    questionNo: "待复核",
    status: "uncertain",
    explanation: parsed.summary || "当前图片或 OCR 未提取到足够清晰的题干与学生作答，需要教师点开原图复核关键题目。",
    knowledgePoint: input.subject || ""
  }, 0, input, 1)];
}

function buildAnnotationMarkers(questionResults = []) {
  return questionResults.map((item, index) => ({
    id: item.id || `marker-${index + 1}`,
    questionNo: item.questionNo || String(index + 1),
    status: item.status || "uncertain",
    page: item.bbox?.page || 1,
    x: item.bbox?.x ?? 0.08,
    y: item.bbox?.y ?? 0.12,
    w: item.bbox?.w ?? 0.18,
    h: item.bbox?.h ?? 0.06,
    label: item.status === "correct" ? "对" : item.status === "wrong" ? "错" : item.status === "partial" ? "半" : "疑"
  }));
}

function evaluateGradingQuality({ questionResults = [], score = null, summary = "", input = {}, ocr = {}, parsed = {} }) {
  const total = questionResults.length;
  const uncertainCount = questionResults.filter((item) => item.status === "uncertain").length;
  const lowConfidenceCount = questionResults.filter((item) => Number(item.confidence ?? 1) < 0.62).length;
  const averageConfidence = total
    ? questionResults.reduce((sum, item) => sum + Number(item.confidence ?? 0.72), 0) / total
    : 0;
  const uncertainRatio = total ? uncertainCount / total : 1;
  const hasAnswerKey = Boolean(input.answerKey || input.assignmentItems?.some((item) => item.answer || item.rubric));
  const hasLayoutAnswerKey = Boolean(input.questionLayoutManifest?.questions?.some((item) => item.answer || item.analysisSteps?.length));
  const hasGeneratedReference = Array.isArray(input.referenceAnswers) && input.referenceAnswers.length > 0;
  const hasReferenceEvidence = hasAnswerKey || hasLayoutAnswerKey || hasGeneratedReference;
  const hasRecognitionEvidence = Boolean(
    ocr.manualText ||
    ocr.studentAnswerText ||
    ocr.text ||
    input.ocrText ||
    input.printedText ||
    ocr.questions?.some((item) => String(item?.studentAnswer || "").trim())
  );
  const imageQuality = ocr.imageQuality || input.imageQuality || null;
  const imageQualityStatus = String(imageQuality?.status || "").toLowerCase();
  const imageQualityBlocked = ["poor", "needs_review"].includes(imageQualityStatus);
  const text = `${summary}\n${resultText(parsed)}`.toLowerCase();
  const riskText = /缺少标准答案|标准答案.*无法|无原图|缺少试卷原图|无法确认|无法判定|ocr.*不足|识别信息不足|未提取到清晰|图形.*无法/i.test(text);
  const lowConfidence = !hasRecognitionEvidence ||
    !hasReferenceEvidence ||
    imageQualityBlocked ||
    total === 0 ||
    uncertainRatio >= 0.25 ||
    lowConfidenceCount >= Math.max(2, Math.ceil(total * 0.25)) ||
    averageConfidence < 0.62 ||
    riskText;
  const referenceAnswerMode = input.referenceAnswerMode || (hasAnswerKey ? "answer_key" : hasLayoutAnswerKey ? "layout_manifest" : hasGeneratedReference ? "ai_generated_reference" : "missing_question_evidence");
  return {
    lowConfidence,
    archiveEligible: false,
    referenceAnswerMode,
    hasAnswerKey,
    hasLayoutAnswerKey,
    hasGeneratedReference,
    hasReferenceEvidence,
    hasRecognitionEvidence,
    imageQuality,
    imageQualityBlocked,
    provisionalScore: score,
    finalScore: lowConfidence ? null : score,
    uncertainCount,
    totalQuestions: total,
    uncertainRatio: Number(uncertainRatio.toFixed(3)),
    averageConfidence: Number(averageConfidence.toFixed(3)),
    reason: lowConfidence
      ? imageQualityBlocked
        ? "图片质量需要教师复核，暂不生成最终可信分数。"
        : "AI初判置信不足，需教师复核后才能生成最终分数并写入档案。"
      : "AI初判可用于教师复核，确认后才写入学生档案。"
  };
}

function resultText(value) {
  if (!value || typeof value !== "object") return "";
  return Object.values(value).slice(0, 8).map((item) => {
    if (item == null) return "";
    if (typeof item === "string") return item;
    if (Array.isArray(item)) return item.slice(0, 4).join(" ");
    return "";
  }).join(" ");
}

function normalizeGradingResult(result = {}, input = {}, ocr = {}) {
  const parsed = parseJsonObjectText(result.gradingText) || {};
  const scoreValue = parsed.score ?? result.score ?? input.score;
  const scoreLimit = defaultSubmissionTotalScore(input);
  const score = Number.isFinite(Number(scoreValue)) ? Math.max(0, Math.min(scoreLimit, Number(scoreValue))) : null;
  const mistakes = (Array.isArray(parsed.mistakes) ? parsed.mistakes : toStringArray(parsed.mistakes))
    .map((item, index) => normalizeMistake(item, index, input))
    .filter((item) => item.prompt || item.point || item.cause);
  const nextPractice = Array.isArray(parsed.nextPractice)
    ? parsed.nextPractice.join("；")
    : String(parsed.nextPractice || parsed.nextActions || (mistakes[0] ? "根据错题补 2-3 道同类练习。" : "保持当前练习节奏。"));
  const summary = String(parsed.summary || result.gradingText || (result.available ? "已生成批改初稿，等待教师复核。" : "AI生成暂不可用，等待教师人工复核。")).trim();
  const needsTeacherReview = parsed.needsTeacherReview ?? parsed.needsReview ?? true;
  const hasRecognitionEvidence = Boolean(ocr.manualText || ocr.studentAnswerText || ocr.text || input.ocrText || input.printedText);
  const rawQuestionResults = Array.isArray(parsed.questionResults)
    ? parsed.questionResults
    : Array.isArray(parsed.questions)
      ? parsed.questions
      : [];
  const normalizedQuestions = rawQuestionResults.length
    ? rawQuestionResults.map((item, index) => normalizeQuestionResult(item, index, input, rawQuestionResults.length))
    : hasRecognitionEvidence
      ? fallbackQuestionResults(parsed, mistakes, input)
      : [normalizeQuestionResult({
          questionNo: "待复核",
          status: "uncertain",
          explanation: "图片或 OCR 未提取到清晰的题干与学生作答，当前只能保留为待教师复核。",
          knowledgePoint: input.subject || ""
        }, 0, input, 1)];
  const questionResults = applyQuestionScoreTrace(normalizedQuestions, input, score);
  const annotationMarkers = buildAnnotationMarkers(questionResults);
  const questionScore = inferScoreFromQuestionResults(questionResults, input);
  const inferredScore = questionScore ?? score;
  const quality = {
    ...evaluateGradingQuality({ questionResults, score: inferredScore, summary, input, ocr, parsed }),
    modelScore: score,
    scoreMismatch: score != null && questionScore != null && Math.abs(Number(score) - Number(questionScore)) > 0.01
  };
  const displaySummary = quality.lowConfidence
    ? `${quality.reason}${summary ? ` 原始AI初判：${summary}` : ""}`
    : summary;
  return {
    score: quality.finalScore,
    provisionalScore: quality.lowConfidence ? quality.provisionalScore : null,
    summary: displaySummary,
    strengths: toStringArray(parsed.strengths),
    mistakes,
    questionResults,
    annotationMarkers,
    nextPractice,
    needsTeacherReview: true,
    reviewStatus: quality.lowConfidence ? "low_confidence_needs_review" : "pending_teacher_review",
    archiveEligible: false,
    referenceAnswerMode: quality.referenceAnswerMode,
    quality,
    aiGenerated: Boolean(result.available),
    providerId: result.providerId || null,
    available: Boolean(result.available),
    gradingText: result.gradingText || "",
    evidence: {
      ocrStatus: ocr.status,
      ocrTextPreview: String(ocr.manualText || ocr.text || "").slice(0, 180),
      studentAnswerTextPreview: String(ocr.studentAnswerText || "").slice(0, 180),
      imageCount: input.imageNames?.length || input.uploadedFiles?.length || 0,
      uploadedBy: input.uploadedBy || "teacher",
      pageNumber: ocr.pageNumber,
      questionRange: ocr.questionRange,
      imageQuality: ocr.imageQuality || null
    }
  };
}

function shouldRunGradingRiskReview(structured = {}) {
  const questions = Array.isArray(structured.questionResults) ? structured.questionResults : [];
  return structured.quality?.lowConfidence === true ||
    structured.quality?.scoreMismatch === true ||
    questions.some((item) => item.status === "uncertain" || Number(item.confidence ?? 1) < 0.62);
}

function hasSufficientSolGradingEvidence(input = {}, ocr = {}, reference = {}) {
  const imageQualityStatus = String(ocr.imageQuality?.status || input.imageQuality?.status || "").toLowerCase();
  const imageBlocked = ["poor", "needs_review"].includes(imageQualityStatus);
  const ocrStatus = String(ocr.status || input.ocrStatus || "").toLowerCase();
  const unseparatedOcr = /unseparated|separation[_-]?failed|无法分离/.test(ocrStatus);
  const questions = Array.isArray(ocr.questions) ? ocr.questions : [];
  const hasStudentWork = Boolean(
    input.studentAnswerText ||
    ocr.studentAnswerText ||
    questions.some((item) => String(item?.studentAnswer || "").trim())
  );
  const hasPrompt = Boolean(
    input.printedText ||
    ocr.printedText ||
    questions.some((item) => String(item?.printedText || item?.printedPrompt || "").trim())
  );
  return !imageBlocked && !unseparatedOcr && hasStudentWork && hasPrompt && reference.available === true;
}

function selectSolGradingQuestionNos(structured = {}, input = {}, ocr = {}, reference = {}) {
  if (!hasSufficientSolGradingEvidence(input, ocr, reference)) return [];
  const references = new Map((reference.referenceAnswers || []).map((item) => [String(item.questionNo || ""), item]));
  const normalizeAnswer = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim().toLowerCase();
  const questions = Array.isArray(structured.questionResults) ? structured.questionResults : [];
  const selected = questions.filter((item) => {
    const referenceItem = references.get(String(item.questionNo || ""));
    const reportedAnswer = normalizeAnswer(item.correctAnswer);
    const referenceAnswer = normalizeAnswer(referenceItem?.correctAnswer);
    const answerConflict = Boolean(reportedAnswer && referenceAnswer && reportedAnswer !== referenceAnswer);
    const score = optionalNumber(item.score);
    const maxScore = optionalNumber(item.maxScore);
    const localScoreMismatch = score != null && maxScore != null && (score < 0 || score > maxScore);
    return item.status === "uncertain" || Number(item.confidence ?? 1) < 0.62 || answerConflict || localScoreMismatch;
  });
  if (!selected.length && structured.quality?.scoreMismatch === true) return questions.map((item) => String(item.questionNo || "")).filter(Boolean);
  return selected.map((item) => String(item.questionNo || "")).filter(Boolean);
}

function buildSolGradingInput(input = {}, questionNos = []) {
  const selected = new Set(questionNos.map(String));
  const withQuestionNo = (items = []) => items.map((item, index) => ({
    ...item,
    questionNo: String(item.questionNo ?? item.no ?? item.orderIndex ?? item.index ?? index + 1)
  }));
  const questions = withQuestionNo(input.ocrQuestions || []).filter((item) => selected.has(item.questionNo));
  const references = withQuestionNo(input.referenceAnswers || []).filter((item) => selected.has(item.questionNo));
  const assignmentItems = withQuestionNo(input.assignmentItems || []).filter((item) => selected.has(item.questionNo));
  const questionLayoutManifest = input.questionLayoutManifest
    ? filterQuestionLayoutManifest({
        ...input.questionLayoutManifest,
        questions: withQuestionNo(input.questionLayoutManifest.questions || [])
      }, selected)
    : null;
  const answerKey = parseAnswerKeyReferenceAnswers(input.answerKey)
    .filter((item) => selected.has(String(item.questionNo || "")))
    .map((item) => `${item.questionNo}. ${item.correctAnswer}`)
    .join(" ") || null;
  const numberedText = (field) => questions
    .map((item) => `${item.questionNo}. ${String(item[field] || "").trim()}`)
    .join(" ");
  return {
    ...input,
    answerKey,
    ocrQuestions: questions,
    referenceAnswers: references,
    assignmentItems,
    printedText: numberedText("printedText"),
    ocrText: numberedText("printedText"),
    studentAnswerText: numberedText("studentAnswer"),
    manualText: numberedText("studentAnswer"),
    questionLayoutManifest
  };
}

function mergeSolGradingResult(initialStructured = {}, solResult = {}, input = {}, selectedQuestionNos = []) {
  const parsed = parseJsonObjectText(solResult.gradingText) || {};
  const solQuestions = Array.isArray(parsed.questionResults) ? parsed.questionResults : [];
  const selected = new Set(selectedQuestionNos.map(String));
  const solByQuestion = new Map(solQuestions
    .filter((item, index) => selected.has(String(item.questionNo || item.no || index + 1)))
    .map((item, index) => [String(item.questionNo || item.no || index + 1), { ...item, modelEscalated: true }]));
  const questionResults = (initialStructured.questionResults || []).map((item) => solByQuestion.get(String(item.questionNo || "")) || item);
  const explicitScores = questionResults.map((item) => optionalNumber(item.score));
  const score = explicitScores.every((item) => item != null)
    ? Number(explicitScores.reduce((sum, item) => sum + Number(item), 0).toFixed(2))
    : inferScoreFromQuestionResults(questionResults, input);
  return {
    ...solResult,
    gradingText: JSON.stringify({
      ...parsed,
      score,
      questionResults
    })
  };
}

function blockingSolGradingAudit() {
  return {
    merged: true,
    required: true,
    available: true,
    status: "needs_review",
    riskLevel: "high",
    scoreReliable: false,
    archiveAllowed: false,
    issues: ["Sol 复核后仍存在批改风险，需要教师逐题确认。"],
    suggestions: [],
    raw: { audits: [] },
    error: null
  };
}

function normalizeAssessmentItem(item, index) {
  if (typeof item === "string") {
    const prompt = stripLeadingQuestionNumber(item);
    return {
      itemType: inferAssessmentItemType({ prompt }),
      prompt,
      answer: undefined,
      rubric: undefined,
      metadata: buildAssessmentItemMetadata({ prompt }, index)
    };
  }
  const source = item || {};
  const prompt = stripLeadingQuestionNumber(source.prompt || source.question || source.title || source.text || "");
  const itemType = inferAssessmentItemType({ ...source, prompt });
  return {
    itemType,
    prompt: String(prompt || `第 ${index + 1} 题`).trim(),
    answer: source.answer || source.answerKey || source.correctAnswer || undefined,
    rubric: source.rubric || source.analysis || source.explanation || undefined,
    metadata: buildAssessmentItemMetadata({ ...source, prompt, itemType }, index)
  };
}

function normalizeAssessmentItemType(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("填") || text.includes("fill")) return "fill";
  if (text.includes("选") || text.includes("choice") || text.includes("multiple")) return "choice";
  if (text.includes("判断") || text.includes("judge") || text.includes("true")) return "judgment";
  if (text.includes("口算") || text.includes("计算") || text.includes("calc")) return "calculation";
  if (text.includes("解答") || text.includes("解决") || text.includes("应用") || text.includes("solution") || text.includes("word")) return "solution";
  if (text.includes("操作") || text.includes("画图") || text.includes("思维") || text.includes("operation")) return "operation";
  if (text.includes("作文") || text.includes("习作") || text.includes("书面表达") || text.includes("writing")) return "writing";
  if (text.includes("阅读") || text.includes("reading")) return "reading";
  if (text.includes("听力") || text.includes("listening")) return "listening";
  return "";
}

function inferAssessmentItemType(source = {}) {
  const explicit = normalizeAssessmentItemType(source.itemType || source.type || source.sectionType);
  if (explicit) return explicit;
  const prompt = String(source.prompt || source.question || "");
  const answer = String(source.answer || source.answerKey || source.correctAnswer || "");
  if (Array.isArray(source.options) && source.options.length) return "choice";
  if (/[_＿]{2,}|（\s*）|\(\s*\)/.test(prompt)) return "fill";
  if (/^[√×对错]$/.test(answer.trim()) || /判断|正确还是错误|对还是错/.test(prompt)) return "judgment";
  if (/画图|作图|如图|图中/.test(prompt)) return "operation";
  if (/求|计算|列式|解方程|竖式/.test(prompt)) return "calculation";
  if (/说明理由|解决|应用题|至少|为什么|想法/.test(prompt)) return "solution";
  if (/交际|对话|改写|扩写|仿写|概括|理解/.test(prompt)) return "solution";
  return "solution";
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => compactText(item)).filter(Boolean);
  return String(value).split(/\n|；|;/).map((item) => item.trim()).filter(Boolean);
}

function normalizePassageText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inferTriangleFigure(source = {}) {
  const prompt = String(source.prompt || "");
  if (!/如图|图中|画图/.test(prompt) || !/三角形|∠/.test(prompt)) return null;
  const angleLabels = {};
  for (const match of prompt.matchAll(/∠([ABC123])\s*=\s*(\d+)°/g)) {
    angleLabels[match[1]] = `${match[2]}°`;
  }
  return {
    type: "triangle",
    labels: ["A", "B", "C"],
    angleLabels,
    equalAngles: /∠B\s*=\s*∠C/.test(prompt) ? ["B", "C"] : []
  };
}

function inferCircleSquareFigure(source = {}) {
  const prompt = String(source.prompt || "");
  if (!/圆/.test(prompt) || !/正方形/.test(prompt)) return null;
  const radiusMatch = prompt.match(/半径(?:是|为)?\s*([0-9.]+)\s*(?:cm|厘米|m|米)?/i);
  const diameterMatch = prompt.match(/直径(?:是|为)?\s*([0-9.]+)\s*(?:cm|厘米|m|米)?/i);
  return {
    type: "circle-square",
    radiusLabel: radiusMatch ? `${radiusMatch[1]}cm` : "",
    diameterLabel: diameterMatch ? `${diameterMatch[1]}cm` : ""
  };
}

function inferAssessmentFigure(source = {}) {
  return inferTriangleFigure(source) || inferCircleSquareFigure(source);
}

function fallbackAnalysisSteps(source = {}) {
  const itemType = inferAssessmentItemType(source);
  const prompt = compactText(source.prompt || source.question, "本题");
  const answer = compactText(source.answer || source.answerKey || source.correctAnswer, "按题意完成作答");
  const knowledgePoint = compactText(source.knowledgePoint || source.point, "对应知识点");
  if (itemType === "fill" || itemType === "choice" || itemType === "judgment") {
    return [
      `先判断本题考查的是“${knowledgePoint}”。`,
      `根据题意核对关键条件：${prompt}`,
      `得到答案：${answer}。`
    ];
  }
  return [
    `读题并整理已知条件：${prompt}`,
    `调用“${knowledgePoint}”相关公式或数量关系，列出计算过程。`,
    `完成计算并写出结论：${answer}。`,
    "回看题目条件，检查单位、角度符号和结论是否完整。"
  ];
}

function defaultAnswerSpaceMm(itemType) {
  if (itemType === "listening") return 0;
  if (itemType === "fill" || itemType === "choice" || itemType === "judgment") return 0;
  if (itemType === "calculation") return 18;
  if (itemType === "writing") return 0;
  if (itemType === "reading") return 8;
  if (itemType === "operation") return 30;
  return 26;
}

function shouldUseEnglishFourLineForPrompt(source = {}, itemType = "") {
  const answerFormat = String(source.answerFormat || source.renderStyle || "");
  if (/english-four-line|english-writing/i.test(answerFormat)) return true;
  const prompt = String(source.prompt || "");
  if (/\u82f1\u6587\u8bd1\u4e2d\u6587|\u82f1\u8bd1\u4e2d/.test(prompt)) return false;
  if (itemType === "fill") {
    return /\u4e2d\u6587\u8bd1\u82f1\u6587|\u4e2d\u8bd1\u82f1|\u6839\u636e\u4e2d\u6587\u5199(?:\u5355\u8bcd|\u77ed\u8bed)|\u5199\u51fa\u82f1\u6587|\u586b\u5199\u82f1\u6587|\u82f1\u8bed(?:\u5355\u8bcd|\u77ed\u8bed)/.test(prompt);
  }
  if (itemType === "solution") {
    return /\u9020\u53e5|\u4e2d\u8bd1\u82f1|\u8bd1\u6210\u82f1\u6587|\u7ffb\u8bd1\u6210\u82f1\u6587|\u6839\u636e\u4e2d\u6587[\s\S]{0,16}\u5199[\s\S]{0,16}\u82f1\u6587|\u7528[\s\S]{0,20}\u5199\u53e5\u5b50/.test(prompt);
  }
  return false;
}

function buildAssessmentItemMetadata(source = {}, index) {
  const itemType = inferAssessmentItemType(source);
  const rawAnswerFormat = source.answerFormat || source.renderStyle || null;
  const answerFormat = shouldUseEnglishFourLineForPrompt(source, itemType) ? "english-four-line" : rawAnswerFormat;
  const configuredSpace = Number(source.answerSpaceMm || source.spaceMm) || defaultAnswerSpaceMm(itemType);
  const needsEnglishFourLine = /english-four-line|english-writing/i.test(String(answerFormat || ""));
  const fillNeedsPrintedSpace = itemType === "fill" && /tianzige|ruled|english-four-line|english-writing/i.test(String(answerFormat || ""));
  const writingNeedsPrintedSpace = itemType === "writing" && /four-line|english-writing|chinese-square-grid|square-grid/i.test(String(answerFormat || ""));
  const solutionNeedsPrintedSpace = itemType === "solution" && needsEnglishFourLine;
  const answerSpaceMm =
    (itemType === "fill" && !fillNeedsPrintedSpace) || itemType === "choice" || itemType === "judgment" || (itemType === "writing" && !writingNeedsPrintedSpace) || itemType === "listening"
      ? 0
      : needsEnglishFourLine && itemType === "fill"
        ? Math.max(10, Math.min(configuredSpace || 12, 16))
      : solutionNeedsPrintedSpace
        ? Math.max(22, Math.min(configuredSpace || 24, 36))
      : fillNeedsPrintedSpace
        ? Math.max(4, Math.min(configuredSpace, 12))
      : writingNeedsPrintedSpace
        ? Math.max(48, Math.min(configuredSpace, 140))
      : itemType === "calculation"
        ? Math.max(16, Math.min(configuredSpace, 28))
      : itemType === "solution" || itemType === "operation"
          ? Math.max(20, Math.min(configuredSpace, 42))
          : itemType === "reading"
            ? Math.max(6, Math.min(configuredSpace, 18))
            : Math.max(4, Math.min(configuredSpace, 24));
  const sourceFigure = source.figure || source.diagram || null;
  const inferredFigure = inferAssessmentFigure(source);
  const figure = inferredFigure && sourceFigure?.type === "circle" && /正方形/.test(String(source.prompt || ""))
    ? inferredFigure
    : sourceFigure || inferredFigure;
  const analysisSteps = normalizeStringList(source.analysisSteps || source.solutionSteps || source.steps);
  const passageText = normalizePassageText(source.passageText || source.passage || source.materialText || source.material?.text || "");
  const passageTitle = compactText(source.passageTitle || source.materialTitle || source.material?.title || "");
  const passageQuestionIndex = Number(source.passageQuestionIndex || source.questionInPassage || source.groupQuestionIndex) || null;
  return {
    sourceIndex: index + 1,
    score: source.score ?? source.points ?? null,
    difficulty: source.difficulty || null,
    knowledgePoint: source.knowledgePoint || source.point || null,
    sectionTitle: source.sectionTitle || source.section || null,
    options: normalizeStringList(source.options || source.choices),
    figure: figure || null,
    answerFormat,
    pinyinWords: Array.isArray(source.pinyinWords) ? source.pinyinWords : [],
    subQuestions: Array.isArray(source.subQuestions) ? source.subQuestions : [],
    passageTitle: passageTitle || null,
    passageText: passageText || null,
    passageGroupId: source.passageGroupId || source.groupId || source.materialId || null,
    passageQuestionIndex,
    showPassage: passageText ? (source.showPassage ?? source.renderPassage ?? (passageQuestionIndex === 1 || passageQuestionIndex == null)) : false,
    answerSpaceMm,
    analysisSteps: analysisSteps.length ? analysisSteps : fallbackAnalysisSteps(source),
    commonMistake: source.commonMistake || source.mistakeTip || source.errorTip || "注意完整写出关键依据，避免只写结果。"
  };
}

function selectPrintableAssessmentItems(items = [], input = {}) {
  return reviewAndRepairAssessmentItems(items, input).items;
}

function reviewAndRepairAssessmentItems(items = [], input = {}) {
  const kind = normalizeAssessmentKind(input.kind);
  const blueprint = buildAssessmentBlueprint(input);
  const subject = normalizeSubject(input.subject);
  const fallbackItems = buildFallbackAssessmentItems(input);
  const notes = [];
  const sanitized = items
    .filter((item) => item?.prompt)
    .filter((item) => wantsListening(input) || printableType(item) !== "listening")
    .filter((item) => isAllowedAssessmentItem(item, input))
    .filter((item) => !isForbiddenEnglishShortAssessmentItem(item, input))
    .filter((item) => !isUnrequestedBonusItem(item, input));

  if (!wantsListening(input) && items.some((item) => printableType(item) === "listening")) {
    notes.push("已按老师要求移除未明确要求的听力题。");
  }
  if (items.some((item) => isUnrequestedBonusItem(item, input))) {
    notes.push("已移除未明确要求的附加题或拓展题。");
  }
  if (items.some((item) => !isAllowedAssessmentItem(item, input))) {
    notes.push("已移除不符合当前类型的题目，例如语文小测/练习中的作文题。");
  }
  if (items.some((item) => isForbiddenEnglishShortAssessmentItem(item, input))) {
    notes.push("已移除英语小测/练习中的试卷式题组，并按单元小测/练习结构补足。");
  }

  const shouldReplaceReading = shouldReplaceReadingSection(sanitized, input, blueprint);
  if (shouldReplaceReading) {
    notes.push(`${subject}阅读理解材料不足或题目缺少上下文，已由服务层替换为带完整材料的阅读题组。`);
  }

  const usedPrompts = new Set();
  const usedFingerprints = new Set();
  const recentFingerprints = recentAssessmentFingerprints(input);
  let recentReuseCount = 0;
  const repaired = [];
  const takeForSection = (sourceItems, fallbackSourceItems, section) => {
    const candidates = shouldReplaceReading && section.type === "reading" ? [] : sourceItems;
    const preferFallback =
      (subject === "英语" && section.type === "fill") ||
      (subject === "英语" && section.type === "reading") ||
      (subject === "数学" && (section.type === "calculation" || section.type === "solution")) ||
      (subject === "语文" && (section.type === "fill" || section.type === "solution"));
    const rawTarget = Math.max(1, section.target || 1);
    const shouldKeepSectionEven = section.type !== "writing";
    const target = shouldKeepSectionEven && rawTarget % 2 === 1 ? rawTarget + 1 : rawTarget;
    const picked = [];
    const orderedCandidates = [...(preferFallback ? fallbackSourceItems : candidates), ...(preferFallback ? candidates : fallbackSourceItems)];
    for (const allowRecentReuse of [false, true]) {
      for (const item of orderedCandidates) {
        if (picked.length >= target) break;
        if (printableType(item) !== section.type) continue;
        const key = assessmentUniquePromptKey(item);
        const fingerprint = assessmentPromptFingerprint(item);
        if (!key || usedPrompts.has(key) || usedFingerprints.has(fingerprint)) continue;
        if (!allowRecentReuse && recentFingerprints.has(fingerprint)) continue;
        if (allowRecentReuse && recentFingerprints.has(fingerprint)) recentReuseCount += 1;
        usedPrompts.add(key);
        if (fingerprint) usedFingerprints.add(fingerprint);
        picked.push(withAssessmentSection(item, section.title, section.type, input));
      }
      if (picked.length >= target) break;
    }
    if (shouldKeepSectionEven && picked.length % 2 === 1) {
      for (const allowRecentReuse of [false, true]) {
        for (const item of orderedCandidates) {
          if (printableType(item) !== section.type) continue;
          const key = assessmentUniquePromptKey(item);
          const fingerprint = assessmentPromptFingerprint(item);
          if (!key || usedPrompts.has(key) || usedFingerprints.has(fingerprint)) continue;
          if (!allowRecentReuse && recentFingerprints.has(fingerprint)) continue;
          if (allowRecentReuse && recentFingerprints.has(fingerprint)) recentReuseCount += 1;
          usedPrompts.add(key);
          if (fingerprint) usedFingerprints.add(fingerprint);
          picked.push(withAssessmentSection(item, section.title, section.type, input));
          break;
        }
        if (picked.length % 2 === 0) break;
      }
    }
    if (recentReuseCount > 0) {
      notes.push("近期题目池已尽量避开重复题干；少量复用只在题量不足时触发，需后续扩充题库。");
      recentReuseCount = 0;
    }
    if (shouldKeepSectionEven && picked.length % 2 === 1 && picked.length > 1) {
      picked.pop();
      notes.push(`${section.title}题量已调整为偶数，便于排版和作答。`);
    }
    if (picked.length < target) {
      notes.push(`${section.title}题量不足，已按动态兜底题池补足到 ${target} 题。`);
    }
    return picked;
  };

  for (const section of blueprint.sections) {
    const sectionItems = sanitized.filter((item) => printableType(item) === section.type);
    const sectionFallback = fallbackItems.filter((item) => printableType(item) === section.type);
    repaired.push(...takeForSection(sectionItems, sectionFallback, section));
  }

  const maxItemCount = Math.max(2, blueprint.maxItems % 2 === 0 ? blueprint.maxItems : blueprint.maxItems - 1);
  const evenRepaired = repaired.slice(0, maxItemCount);
  if (evenRepaired.length % 2 === 1) {
    const lastItem = evenRepaired[evenRepaired.length - 1];
    if (printableType(lastItem) === "writing") {
      notes.push("写作题按老师要求保留 1 题，因此总题量不强制调整为偶数。");
    } else {
      evenRepaired.pop();
      notes.push("已将生成类题目数量调整为偶数，便于排版和作答。");
    }
  }
  if (ensureRequestedMathBonusItem(evenRepaired, input)) {
    notes.push("老师明确要求附加题，已将最后一道数学解答题标记为附加题。");
  }
  const limitedRaw = evenRepaired.map((item, index) => ({
    ...item,
    metadata: {
      ...(item.metadata || {}),
      sourceIndex: index + 1,
      score: item.metadata?.score ?? defaultScoreForAssessmentItem(item, input),
      analysisSteps: ensureAnalysisSteps(item, input)
    }
  }));
  const scored = assignAssessmentScores(limitedRaw, input);
  const limited = scored.items;
  rememberAssessmentPrompts(limited, input);

  if (limited.length < blueprint.minItems) {
    notes.push(`${kind}题量仍低于最低要求，请教师重点复核。`);
  }

  return { items: limited, notes, totalScore: scored.totalScore };
}

function printableType(item) {
  return normalizeAssessmentItemType(item?.itemType) || "solution";
}

function assessmentUniquePromptKey(item = {}) {
  const metadata = item.metadata || {};
  return compactText([
    printableType(item),
    metadata.sectionTitle,
    metadata.passageGroupId,
    metadata.passageTitle,
    item.prompt
  ].filter(Boolean).join("|")).toLowerCase();
}

function isAllowedAssessmentItem(item = {}, input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const type = printableType(item);
  if (subject === "语文" && kind !== "试卷" && type === "writing") return false;
  if (subject === "英语" && kind !== "试卷" && type === "writing") return false;
  return buildAssessmentBlueprint(input).sections.some((section) => section.type === type);
}

function defaultScoreForAssessmentItem(item = {}, input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const type = printableType(item);
  if (subject === "数学") {
    if (type === "fill" || type === "choice") return kind === "试卷" ? 2 : 3;
    if (type === "calculation") return kind === "试卷" ? 5 : 6;
    return kind === "试卷" ? 6 : 8;
  }
  if (subject === "语文") {
    if (type === "fill") return 3;
    if (type === "reading") return 4;
    if (type === "writing") return 30;
    return 4;
  }
  if (subject === "英语") {
    if (type === "choice" || type === "fill" || type === "reading") return 2;
    if (type === "writing") return 10;
    return 2;
  }
  return 3;
}

function targetAssessmentTotalScore(input = {}) {
  const kind = normalizeAssessmentKind(input.kind);
  return kind === "试卷" ? 100 : 60;
}

function scoreSeedForAssessmentItem(item = {}, input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const type = printableType(item);
  if (subject === "英语" && kind === "试卷") return type === "writing" ? 20 : 2;
  if (subject === "数学") {
    if (type === "fill" || type === "choice") return kind === "试卷" ? 2 : 3;
    if (type === "calculation") return kind === "试卷" ? 5 : 6;
    return kind === "试卷" ? 6 : 8;
  }
  if (subject === "语文") {
    if (type === "fill") return 3;
    if (type === "reading") return kind === "试卷" ? 4 : 5;
    if (type === "writing") return 30;
    return 4;
  }
  return defaultScoreForAssessmentItem(item, input);
}

function assignAssessmentScores(items = [], input = {}) {
  const totalScore = targetAssessmentTotalScore(input);
  const scored = items.map((item) => ({
    ...item,
    metadata: {
      ...(item.metadata || {}),
      score: scoreSeedForAssessmentItem(item, input)
    }
  }));
  const adjustableIndexes = scored
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => printableType(item) !== "writing")
    .map(({ index }) => index);
  const indexes = adjustableIndexes.length ? adjustableIndexes : scored.map((_, index) => index);
  let diff = totalScore - scored.reduce((sum, item) => sum + Number(item.metadata?.score || 0), 0);
  let cursor = indexes.length - 1;
  let guard = 0;
  while (diff !== 0 && indexes.length && guard < 500) {
    const index = indexes[cursor];
    const current = Number(scored[index].metadata.score || 0);
    if (diff > 0) {
      scored[index].metadata.score = current + 1;
      diff -= 1;
    } else if (current > 1) {
      scored[index].metadata.score = current - 1;
      diff += 1;
    }
    cursor = cursor > 0 ? cursor - 1 : indexes.length - 1;
    guard += 1;
  }
  return { items: scored, totalScore };
}

function withAssessmentSection(item, sectionTitle, itemType, input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const type = itemType || item.itemType;
  const metadata = { ...(item.metadata || {}) };
  const configuredSpace = Number(metadata.answerSpaceMm || 0);
  if (subject === "数学" && type === "calculation") {
    metadata.answerSpaceMm = Math.max(configuredSpace, kind === "试卷" ? 24 : 22);
  }
  if (subject === "数学" && (type === "solution" || type === "operation")) {
    metadata.answerSpaceMm = Math.max(configuredSpace, kind === "试卷" ? 36 : 32);
  }
  if (subject === "语文" && type === "writing") {
    metadata.answerFormat = "chinese-square-grid";
    metadata.answerSpaceMm = Math.max(configuredSpace, 132);
  }
  return {
    ...item,
    itemType: type,
    metadata: {
      ...metadata,
      sectionTitle: sectionTitle || item.metadata?.sectionTitle || null
    }
  };
}

function stripLeadingQuestionNumber(value) {
  return String(value || "")
    .replace(/^\s*(?:第\s*)?\d+\s*[.、．)]\s*/, "")
    .replace(/^\s*[（(]\s*\d+\s*[）)]\s*/, "")
    .trim();
}

function isUnrequestedBonusItem(item = {}, input = {}) {
  if (wantsBonusQuestions(input)) return false;
  return hasBonusMarker(item);
}

function hasBonusMarker(item = {}) {
  const text = compactText(`${item.prompt || ""} ${item.metadata?.sectionTitle || ""}`);
  return /附加题|拓展题|挑战题|Bonus/i.test(text);
}

function ensureRequestedMathBonusItem(items = [], input = {}) {
  if (normalizeSubject(input.subject) !== "数学") return false;
  if (normalizeAssessmentKind(input.kind) !== "试卷") return false;
  if (!wantsBonusQuestions(input)) return false;
  if (items.some(hasBonusMarker)) return false;
  const targetIndex = items.reduce((lastIndex, item, index) => (
    printableType(item) === "solution" ? index : lastIndex
  ), -1);
  if (targetIndex < 0) return false;
  const item = items[targetIndex];
  items[targetIndex] = {
    ...item,
    prompt: `附加题：${stripLeadingQuestionNumber(item.prompt || "综合应用题")}`,
    metadata: {
      ...(item.metadata || {}),
      isBonus: true
    }
  };
  return true;
}

function isForbiddenEnglishShortAssessmentItem(item = {}, input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  if (subject !== "英语" || kind === "试卷") return false;
  const text = compactText([
    item.prompt,
    item.metadata?.sectionTitle,
    item.metadata?.passageTitle,
    item.metadata?.answerFormat,
    item.metadata?.knowledgePoint,
    item.knowledgePoint
  ].filter(Boolean).join(" "));
  return /文章选词填空|完形填空|短文语法填空|词形变化/.test(text);
}

function shouldReplaceReadingSection(items = [], input = {}, blueprint = buildAssessmentBlueprint(input)) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const readingTarget = blueprint.sections.find((section) => section.type === "reading")?.target || 0;
  if (!readingTarget) return false;
  const readingItems = items.filter((item) => printableType(item) === "reading");
  if (readingItems.length < Math.max(3, Math.ceil(readingTarget * 0.7))) return true;
  const passageTexts = readingItems
    .map((item) => compactText(item.metadata?.passageText || ""))
    .filter(Boolean);
  const uniquePassageTexts = Array.from(new Set(passageTexts));
  const promptLongText = readingItems
    .map((item) => compactText(item.prompt || ""))
    .filter((text) => text.length >= 180);
  const uniquePassages = new Set(uniquePassageTexts.map((text) => text.slice(0, 80)));
  const totalEnglishWords = uniquePassageTexts.join(" ").match(/[A-Za-z]+/g)?.length || 0;
  const totalChineseChars = uniquePassageTexts.join("").replace(/[^\u4e00-\u9fa5]/g, "").length;
  const contextualQuestionCount = readingItems.filter((item) => {
    const text = compactText(item.prompt || "");
    return /according|passage|infer|main idea|best title|why|because|learn from|根据|短文|联系上下文|推断|主要内容|原因|作者/i.test(text);
  }).length;
  if (subject === "英语") {
    const minWords = kind === "试卷" ? 560 : kind === "练习" ? 150 : 120;
    return uniquePassages.size < (kind === "试卷" ? 2 : 1) || totalEnglishWords < minWords || contextualQuestionCount < 6;
  }
  if (subject === "语文") {
    const minChars = kind === "试卷" ? 950 : 700;
    const longestPassageChars = uniquePassageTexts.reduce((max, text) => {
      const count = text.replace(/[^\u4e00-\u9fa5]/g, "").length;
      return Math.max(max, count);
    }, 0);
    const minModernChars = kind === "试卷" ? 850 : 700;
    return uniquePassages.size < 1 || totalChineseChars < minChars || longestPassageChars < minModernChars || contextualQuestionCount < 4;
  }
  return false;
}

function ensureAnalysisSteps(item = {}, input = {}) {
  const existing = Array.isArray(item.metadata?.analysisSteps) ? item.metadata.analysisSteps.filter(Boolean) : [];
  if (existing.length >= 3) return existing;
  const subject = normalizeSubject(input.subject);
  const type = printableType(item);
  const answer = compactText(item.answer, "见参考答案");
  if (type === "reading") {
    return [
      "先通读阅读材料，抓住人物、时间、地点和事件变化。",
      "再回到题干定位关键词，联系上下文判断依据。",
      `最后核对选项或作答句，答案为：${answer}。`
    ];
  }
  if (subject === "英语") {
    return [
      "先判断句子语境和考查点，如时态、搭配、词性或句型。",
      "再把选项或所给词代入原句，检查主谓一致和语义是否通顺。",
      `因此答案为：${answer}。`
    ];
  }
  return fallbackAnalysisSteps(item);
}

function auditAssessmentDraft(items = [], input = {}, notes = []) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const blueprint = buildAssessmentBlueprint(input);
  const sectionCounts = Object.fromEntries(blueprint.sections.map((section) => [section.title, 0]));
  const issues = [];
  for (const item of items) {
    const sectionTitle = item.metadata?.sectionTitle || "";
    if (sectionTitle && sectionCounts[sectionTitle] != null) sectionCounts[sectionTitle] += 1;
    if (item.metadata?.score == null) issues.push(`第 ${item.metadata?.sourceIndex || "?"} 题缺少分值。`);
    if (!Array.isArray(item.metadata?.analysisSteps) || item.metadata.analysisSteps.length < 3) {
      issues.push(`第 ${item.metadata?.sourceIndex || "?"} 题解析步骤不足。`);
    }
    if (/如图|图中|画图/.test(item.prompt || "") && !item.metadata?.figure) {
      issues.push(`第 ${item.metadata?.sourceIndex || "?"} 题提到图形但缺少 figure 元数据。`);
    }
  }
  for (const section of blueprint.sections) {
    if ((sectionCounts[section.title] || 0) < Math.max(1, Math.floor(section.target * 0.8))) {
      issues.push(`${section.title}题量偏少，当前 ${sectionCounts[section.title] || 0} 题，目标 ${section.target} 题。`);
    }
  }
  if (subject === "语文" && kind !== "试卷" && items.some((item) => printableType(item) === "writing")) {
    issues.push("语文小测/练习中仍存在作文题。");
  }
  const readingItems = items.filter((item) => printableType(item) === "reading");
  if (readingItems.length && !readingItems.some((item) => compactText(item.metadata?.passageText))) {
    issues.push("阅读理解缺少完整阅读材料。");
  }
  if (subject === "语文") {
    const modernReadingChars = readingItems
      .filter((item) => /阅读（一）|现代文|短文/.test(String(item.metadata?.passageTitle || "")) || item.metadata?.passageGroupId === "chinese-modern-reading")
      .map((item) => String(item.metadata?.passageText || "").replace(/[^\u4e00-\u9fa5]/g, "").length)
      .reduce((max, count) => Math.max(max, count), 0);
    const minModernChars = kind === "试卷" ? 850 : 700;
    if (modernReadingChars > 0 && modernReadingChars < minModernChars) {
      issues.push(`语文现代文阅读材料偏短，当前约 ${modernReadingChars} 字，最低要求 ${minModernChars} 字。`);
    }
    const brokenTianzige = items.some((item) =>
      (item.metadata?.answerFormat === "tianzige" || /看拼音|田字格|拼音写词/.test(item.prompt || "")) &&
      (!Array.isArray(item.metadata?.pinyinWords) || item.metadata.pinyinWords.length === 0)
    );
    if (brokenTianzige) issues.push("看拼音写词语缺少 pinyinWords 田字格元数据。");
  }
  if (subject === "英语") {
    if (kind === "试卷" && !items.some((item) => printableType(item) === "writing")) {
      issues.push("英语卷缺少写作题。");
    }
    if (kind !== "试卷" && items.some((item) => printableType(item) === "writing")) {
      issues.push("英语小测/练习中仍存在写作题。");
    }
    const hasExamVocabularyBlock = items.some((item) => /文章选词填空|完形填空|短文语法填空|词形变化/.test(String(item.metadata?.passageTitle || item.metadata?.answerFormat || item.prompt || "")));
    if (kind !== "试卷" && hasExamVocabularyBlock) {
      issues.push("英语小测/练习不得默认使用试卷式文章选词填空、完形填空或短文语法填空。");
    }
    if (kind === "试卷" && !items.some((item) => /文章选词填空/.test(String(item.metadata?.passageTitle || item.prompt || "")))) {
      issues.push("英语试卷词汇运用缺少文章选词填空题组。");
    }
    if (kind === "试卷" && !items.some((item) => /完形填空|短文语法填空|词形变化/.test(String(item.metadata?.passageTitle || item.metadata?.answerFormat || item.prompt || "")))) {
      issues.push("英语试卷词汇运用缺少括号提示词变形类完形填空题组。");
    }
    if (kind === "小测") {
      const sectionTitles = items.map((item) => String(item.metadata?.sectionTitle || "")).join(" ");
      if (!/词汇|短语/.test(sectionTitles)) issues.push("英语小测缺少单元词汇或短语题。 ");
      if (!/句子|造句|运用/.test(sectionTitles)) issues.push("英语小测缺少句子运用或造句题。 ");
      if (!items.some((item) => printableType(item) === "reading" && item.metadata?.passageText)) {
        issues.push("英语小测缺少短阅读材料。");
      }
    }
    const englishWordBankText = items.map((item) => [
      item.prompt,
      item.metadata?.passageTitle,
      item.metadata?.passageText
    ].filter(Boolean).join(" ")).join(" ");
    if (!wantsEnglishWordBank(input) && /方框词|word bank/i.test(englishWordBankText)) {
      issues.push("英语词汇运用默认不得使用方框词；只有教师特殊要求明确方框词时才允许。");
    }
    const fillGroups = new Map();
    for (const item of items.filter((entry) => printableType(entry) === "fill" && entry.metadata?.passageGroupId)) {
      const groupId = item.metadata.passageGroupId;
      if (!fillGroups.has(groupId)) fillGroups.set(groupId, []);
      fillGroups.get(groupId).push(item);
    }
    for (const groupItems of fillGroups.values()) {
      const visiblePassage = groupItems.find((item) => item.metadata?.showPassage)?.metadata?.passageText || "";
      const blankCount = (String(visiblePassage).match(/[①②③④⑤⑥⑦⑧⑨⑩][_＿]{2,}/g) || []).length;
      if (blankCount && blankCount !== groupItems.length) {
        issues.push(`英语词汇短文空号与小题数量不一致，短文显示 ${blankCount} 空，实际 ${groupItems.length} 题。`);
      }
    }
  }
  return {
    reviewer: "Codex主脑审查",
    status: issues.length ? "needs_teacher_review" : "passed",
    checkedAt: new Date().toISOString(),
    subject,
    kind,
    itemCount: items.length,
    sectionCounts,
    issues,
    repairNotes: notes,
    teacherMessage: issues.length
      ? "已完成自动审查并保留待复核项，请教师查看 PDF 草稿后决定是否重生成。"
      : "已完成自动审查，结构、题量、分值、解析和排版元数据通过基础检查。"
  };
}

function compactText(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function assessmentHistoryScope(input = {}) {
  return [
    normalizeSubject(input.subject),
    gradeLevelNumber(input),
    input.teacherId || input.targetGrade || ""
  ].join("|");
}

function normalizePromptFingerprintText(value = "") {
  return compactText(value)
    .toLowerCase()
    .replace(/[0-9０-９]+(?:\.[0-9０-９]+)?/g, "#")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "#")
    .replace(/[一二三四五六七八九十百千万]+(?=本|个|米|厘米|千米|分钟|小时|度|分|页|题|%|％)/g, "#")
    .replace(/\s+/g, "");
}

function assessmentPromptFingerprint(item = {}) {
  const metadata = item.metadata || {};
  const pinyinText = Array.isArray(metadata.pinyinWords)
    ? metadata.pinyinWords.map((word) => `${word.pinyin || ""}:${word.cells || ""}`).join("|")
    : "";
  const passageQuestionOrdinal = Number(metadata.passageQuestionIndex) > 0
    ? String.fromCharCode(96 + Math.min(Number(metadata.passageQuestionIndex), 26))
    : "";
  const passageQuestionKey = metadata.passageGroupId && passageQuestionOrdinal
    ? `passage-question-${String(metadata.passageGroupId).toLowerCase()}-${passageQuestionOrdinal}`
    : "";
  const materialText = [
    item.itemType,
    item.prompt,
    metadata.passageTitle,
    metadata.passageText,
    passageQuestionKey,
    metadata.answerFormat,
    pinyinText,
    item.answer
  ].filter(Boolean).join("|");
  return normalizePromptFingerprintText(materialText);
}

function recentAssessmentFingerprints(input = {}) {
  return recentAssessmentPromptFingerprints.get(assessmentHistoryScope(input)) || new Set();
}

function rememberAssessmentPrompts(items = [], input = {}) {
  const scope = assessmentHistoryScope(input);
  const existing = recentAssessmentPromptFingerprints.get(scope) || new Set();
  for (const item of items) {
    const fingerprint = assessmentPromptFingerprint(item);
    if (fingerprint) existing.add(fingerprint);
  }
  const limited = Array.from(existing).slice(-RECENT_ASSESSMENT_PROMPT_LIMIT);
  recentAssessmentPromptFingerprints.set(scope, new Set(limited));
}

function hashTextSeed(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackSeed(input = {}, scope = "") {
  const source = [
    scope,
    input.seed || input.fallbackSeed || input.requestId || "",
    input.grade || input.targetGrade || "",
    input.subject || "",
    input.kind || "",
    input.difficulty || "",
    input.textbookTitle || "",
    input.textbookChapterTitle || "",
    input.requirement || input.specialRequirements || "",
    input.regenerationIndex || input.retryIndex || "",
    Math.floor(Date.now() / 60000)
  ].join("|");
  return hashTextSeed(source);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
}

function rotateBySeed(items = [], seed = 0) {
  if (!items.length) return [];
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function shuffleBySeed(items = [], seed = 0) {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

const ENGLISH_BLANK_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function englishOptionAnswerText(options = [], answer = "") {
  const answerText = String(answer || "").trim().toUpperCase();
  const index = /^[A-Z]$/.test(answerText) ? answerText.charCodeAt(0) - 65 : -1;
  const raw = index >= 0 ? options[index] : "";
  return compactText(raw || answer)
    .replace(/^[A-Z][.、．]\s*/i, "")
    .trim();
}

function syncVisibleEnglishBlanks(text = "", selectedCount = 0, allItems = [], answerResolver = null) {
  const selected = Math.max(0, selectedCount);
  return String(text || "").replace(/([①②③④⑤⑥⑦⑧⑨⑩])[_＿]{2,}(?:\s*\([^)]*\))?/g, (match, mark) => {
    const index = ENGLISH_BLANK_MARKS.indexOf(mark);
    if (index < 0 || index < selected) return match;
    const item = allItems[index];
    const answer = answerResolver
      ? answerResolver(item, index)
      : item?.answer || "";
    return answer ? String(answer) : match;
  });
}

function ensureLongEnglishPassage(id, text, targetWords = 260) {
  const words = String(text || "").match(/[A-Za-z]+/g)?.length || 0;
  if (words >= targetWords) return text;
  const extras = {
    "grade5-unit4-special-days": "Before each special day, Amy's group checks the class calendar and writes a short plan. On Monday, they choose what to prepare. On Tuesday, they ask classmates who can help. Before the art show, Amy and Chen Jie put pictures into different boxes, so younger students could find their work quickly. Before the sports meet, Zhang Peng made a small running chart and wrote every practice day on it. Their teacher said a special day is not only a date on the wall. It is also a chance to plan, practise, share and thank the people who help. After the singing contest, the class wrote thank-you cards to the music teacher because she helped them listen carefully and sing together.",
    "english-practice-short": "After two weeks, Mia did not stop practising. She made a new table with three columns: new words, difficult sounds and useful sentences. Every Friday, she checked the table with her partner. Sometimes she still made mistakes, but now she could find the reason. Her partner wrote one friendly suggestion after each practice. Mia also listened to two short recordings from her teacher and copied the best sentence into her notebook. At the end of the month, she gave a one-minute talk about her reading plan. She was nervous, but she spoke more slowly and clearly than before. Her teacher said the best practice was not doing many exercises once, but using a small method again and again.",
    "english-reading-a": "The next week, Jack's group did not stop at the blue box. They counted the paper again and asked two younger classes why they sometimes forgot to use the other side. One child said the notice was too high to see, so the group moved it lower and added a small picture. Another child said there was no place to put clean half-used paper, so Jack divided the box into two parts. These small changes made the plan easier to follow. When the class wrote their final report, they included numbers, photos and short interviews instead of only saying the project was useful. The report also showed a problem they had not expected. Some students used the saved paper for quick notes and then threw it away again. Jack's group decided to make a second notice: Good paper deserves a second job, not only a second touch. After that, art teachers began to keep small paper baskets on every table. The project became part of the school's Green Week display, and younger students used the notebooks to record plant changes in science class.",
    "english-reading-b": "Anna later changed the way she used Book Helper. She first wrote down her own question, then used the screen to find possible books. After that, she compared the contents pages and checked whether each book really answered her question. Sometimes the screen gave a quick direction, but a real answer still came from careful reading. Mr Brown asked Anna to share this method with younger children. She told them, 'A screen can open a door, but your own question decides which room you enter.' The children laughed, but they remembered the idea when they started their reports. Two weeks later, Anna returned to the library with three classmates. They wanted to learn why some whales travel so far every year. Book Helper showed many shelves, but Anna asked everyone to choose only books that gave reasons, examples and maps. Their report was not the fastest one, but it was the clearest. Mr Brown put it near the screen to remind children that tools are useful only when readers think for themselves.",
    "english-reading-c": "The project did not end with the old map. Ms Lee divided the class into three groups. One group looked for old photos, one group interviewed teachers, and the third group drew a new map of the school. They found that many names in the school had stories behind them. The Reading Steps were once the place where students read aloud every Friday. The quiet path behind the music room used to be a vegetable garden. When the students put the old and new maps together, they understood that a school is not only made of buildings. It is also made of memories and shared work. At first, some students wanted to make the display colourful and finish it quickly. Ms Lee asked them to add evidence for every sentence. The class then wrote dates under old photos, marked changed places with blue stars, and added short interview notes. Parents stopped at the display during Open Day because it looked like a real history report, not just a pretty poster.",
    "english-reading-d": "After the survey, David's group wanted to know whether their class could waste less food. They made a simple plan. On Monday, every student wrote one food he or she often left. On Wednesday, the group shared three ways to make lunch better: take a smaller amount first, try food with another dish, and talk politely if something is too much. David chose the second way. He mixed carrots with rice and found the taste easier to accept. By Friday, the class waste bucket was much lighter. The group learned that a habit changes more easily when people have a clear and friendly plan. They did the same survey one month later. This time, only six students said they often left vegetables, and more students wrote that they were willing to try a smaller bite before saying no. David still did not call carrots his favourite food, but he no longer pushed them aside. His notebook said, A good change may begin with one small bite."
  };
  let combined = `${text} ${extras[id] || ""}`.trim();
  if ((combined.match(/[A-Za-z]+/g)?.length || 0) < targetWords) {
    combined = `${combined} The teacher did not ask the group to make the story sound perfect. Instead, she asked them to explain what changed, what evidence they had, and what they would still improve next time. This made the work more like real learning, because the students had to connect facts, feelings and actions before giving an answer.`;
  }
  return combined;
}

function ensureLongChinesePassage(title, text, targetChars = 550) {
  const chineseCharCount = (value) => String(value || "").replace(/[^\u4e00-\u9fa5]/g, "").length;
  const charCount = chineseCharCount(text);
  if (charCount >= targetChars) return text;
  const extras = {
    "阅读（一）一张借书卡": "  这件事以后，图书角多了一块小小的提示牌：借书先登记，还书请归位。小林主动承担了一周的图书管理员工作。他发现，有同学不是故意不守规则，而是不知道怎样填写借书卡；也有同学看完书随手一放，下一位同学就要花很久寻找。于是他把借书流程画成三步贴在书架旁，还把容易放错的位置做了标记。几天后，图书角变得整齐多了。小林在班会记录里写道：规则如果只写在纸上，可能让人觉得麻烦；如果每个人都愿意照着做，它就会变成方便大家的好办法。  月末整理图书角时，老师让同学们统计最受欢迎的书。小林发现，登记完整的书更容易被同学推荐，因为大家能看到谁读过、什么时候归还，还能顺着借书卡上的短评找到自己感兴趣的内容。那张小小的卡片不再只是管理工具，也成了同学之间交流阅读感受的桥梁。小林想起自己最初的慌张，认真在新借的书后写下第一条短评：这本书让我知道，昆虫世界也有严格的秩序。",
    "阅读（一）小菜园里的发现": "  后来，孩子们又把这个发现用在别的植物上。他们不再一看到叶子发黄就急着浇水，而是先观察土壤、阳光和温度，再查资料讨论原因。有人发现靠墙的一排幼苗晒不到足够的太阳，有人发现记录表里少了阴雨天的数据。小组重新设计表格，把浇水时间、天气、叶片变化都写进去。一个月后，他们的展示板上不仅有照片，还有折线图和失败记录。参观的同学说，这不像一次简单种菜，更像一场真正的研究。  最让孩子们难忘的是一次失败的展示。第一次汇报时，他们只说“我们很努力”，却答不上番茄为什么长得慢。科学老师提醒他们，努力如果没有证据，就很难让别人相信。于是小组重新翻看记录，发现连续阴雨后温度下降，叶片变化也更明显。第二次汇报时，他们把失败原因、改进办法和新的观察结果放在一起讲，台下的掌声比第一次更热烈。小组长在日记里写道：原来失败不是一堵墙，只要愿意记录和分析，它也能变成一扇门。",
    "阅读（一）雨后的尺子": "  总务老师看到表格后，没有马上给出结论，而是邀请社团同学一起到现场复查。大家发现，低洼地旁边的砖缝里积着泥沙，雨水来不及流走。小哲这才明白，最初那句“排水沟太浅”虽然听起来有道理，却没有找到真正原因。后来学校重新铺平地面，又清理了排水口。再下雨时，操场边没有形成水洼。社团把这次经历写进建议书结尾：好的建议不是声音最大的一句，而是有事实、有数据、也愿意修正的一句。  建议书贴到公告栏后，低年级同学也围着看。有人问：“量水深这么麻烦，直接告诉老师不就行了吗？”小哲想了想，说：“如果我们只说有水，老师只能知道现象；如果我们说哪里最深、多久退去、原因可能是什么，老师就能更快解决问题。”从那以后，科学社团多了一个习惯：每次提出建议，都要先写观察记录。那把普通的尺子被放进工具箱最显眼的位置，提醒大家用事实说话。",
    "阅读（一）旧照片里的校门": "  展板完成后，小雨又在旁边贴上一张采访记录。记录里有门卫爷爷讲的雨天故事，也有低年级同学现在从宽阔人行道进校的感受。有人问：校门变漂亮，为什么还要写这些细节？小雨说，如果只看照片，我们只能看到外形变化；听了故事，才知道变化背后有许多人反复观察、讨论和改进。展出结束时，老师让大家写一句留言。小雨写道：真正的变化，不只是把旧的换成新的，而是让每一个走进校门的人都更安心。  第二天，展板前又多了一张小纸条，是一位毕业多年的学姐写的。她说自己小时候也在雨天被老师牵着手走进校门，如今看到宽阔的人行道，才明白学校的变化藏着许多人的细心。小雨把这张纸条读给同学们听，大家忽然觉得，照片并不是过去的终点，而是连接过去和现在的一条线。后来，班级决定继续收集老操场、旧图书室和第一棵桂花树的故事，让更多变化被认真看见。"
  };
  const depthExtras = {
    "阅读（一）一张借书卡": "  过了一段时间，小林发现借书卡上的短评越来越多。有的同学写下最喜欢的章节，有的同学提醒后来者先看目录，还有人把同一本书里的问题贴在卡片背面。原来，一张卡片不只记录借还时间，也能留下阅读的脚印。小林把这些变化整理成一张小表，交给老师时，他已经不再只是为自己的疏忽道歉，而是在认真思考怎样让图书角更好地服务每个人。",
    "阅读（一）小菜园里的发现": "  期末展示前，小组又回到菜园做了一次对比观察。他们发现，同样是浇水，早晨浇和中午浇的效果并不一样；同样是施肥，少量多次比一次放很多更稳妥。孩子们把这些新发现写进报告，还在旁边附上两张失败照片。有人问为什么要展示失败，组长说：“因为失败能告诉后来的人，哪些路我们已经试过，哪些地方还要更小心。”",
    "阅读（一）雨后的尺子": "  这次调查后，小哲再写建议时变得更谨慎。看到自行车棚旁边的路灯不亮，他没有立刻写“灯坏了”，而是先记录哪几盏灯不亮、持续了几天、放学时经过的同学是否受影响。组员们还采访了值日老师，确认问题出在定时开关。新的建议书比以前更长，却也更清楚。小哲明白，真正有用的建议不是把问题说得夸张，而是把事实说得准确。",
    "阅读（一）旧照片里的校门": "  资料越收越多，小雨发现同一张照片在不同人眼里有不同意义。保洁阿姨看到的是台阶旁曾经难清理的积水，体育老师记得学生排队进校的路线，毕业生想起第一次戴红领巾走进校门的早晨。小雨把这些讲述按时间顺序排好，展板从“新旧对比”变成了“校门故事”。同学们也懂得，观察变化不能只看表面，还要听见变化中的人。"
  };
  const genericExtras = [
    "  老师在讲评时提醒大家，阅读这样的材料，不能只抓住一两个词就下结论。要先弄清事情的发展顺序，再联系人物的语言、动作和心理变化，最后把文章表达的意思说完整。答题时还要写出依据，例如人物为什么这样做、事情后来发生了什么变化、作者想通过细节说明什么。只有把原文信息和自己的理解连起来，答案才会完整、有说服力。",
    "  复盘时，小组把材料重新整理成“现象、证据、原因、改进”四栏。这样一来，读者能看清事情怎样一步步发展，也能判断人物的做法为什么发生变化。后来大家发现，越是看起来平常的小事，越需要把细节写具体。因为细节一旦清楚，文章表达的主题就不再只是空话，而会落到一次选择、一次观察、一次改正之中。",
    "  分享结束后，旁听的同学还提出了新的问题。有人关注结果是否真的有效，有人追问当时为什么没有想到别的办法，还有人建议把经验写成提醒贴在班级角落。主人公没有急着回答所有问题，而是把问题记下来，准备继续查证。这个细节说明，学习和实践不是一次完成的任务，而是在不断追问和修正中慢慢深入的过程。"
  ];
  let combined = `${text}${extras[title] || ""}`.trim();
  const additions = [depthExtras[title], ...genericExtras].filter(Boolean);
  for (const addition of additions) {
    if (chineseCharCount(combined) >= targetChars) break;
    combined = `${combined}${addition}`;
  }
  return combined;
}

function markDynamicFallback(items = [], input = {}, scope = "") {
  const seed = fallbackSeed(input, scope);
  return items.map((item, index) => ({
    ...item,
    metadata: {
      ...(item.metadata || {}),
      fallbackMode: "dynamic-repair",
      fallbackSeed: seed,
      fallbackVariantIndex: index + 1
    }
  }));
}

function dynamicContext(input = {}, fallback = "近期学习内容") {
  return compactText(input.textbookChapterTitle || input.textbookTitle || input.requirement || input.specialRequirements, fallback);
}

function buildAssessmentTitle(input = {}, parsed = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const grade = input.targetScope === "grade"
    ? input.targetGrade || input.grade
    : input.grade || input.targetGrade;
  return compactText(parsed.title || input.title, `${grade ? `${grade}` : ""}${subject}${kind}排版稿`);
}

function buildFallbackAssessmentItems(input = {}) {
  const subject = normalizeSubject(input.subject);
  const kind = normalizeAssessmentKind(input.kind);
  const difficulty = input.difficulty || "基础";
  const requirement = compactText(input.requirement || input.specialRequirements, "围绕近期易错点进行巩固");
  const textbook = compactText(input.textbookChapterTitle || input.textbookTitle, "");
  const basePoint = textbook || requirement;
  const blueprint = buildAssessmentBlueprint(input);
  const count = blueprint.maxItems;
  if (subject === "英语") return buildEnglishFallbackAssessmentItems(input).map(normalizeAssessmentItem);
  if (subject === "语文") return buildChineseFallbackAssessmentItems(input).map(normalizeAssessmentItem);
  if (subject === "数学") return buildMathFallbackAssessmentItems(input).map(normalizeAssessmentItem);
  const triangleMathItems = [
    { itemType: "fill", sectionTitle: "一、填空题", prompt: "三角形的三个内角之和是______度。", answer: "180", knowledgePoint: "三角形内角和", analysisSteps: ["三角形内角和是固定结论。", "三个内角相加等于 180°。", "填入 180。"], commonMistake: "不要把三角形内角和误写成 360°。" },
    { itemType: "fill", sectionTitle: "一、填空题", prompt: "一个三角形中，两个角分别是 45° 和 70°，第三个角是______度。", answer: "65", knowledgePoint: "三角形内角和", analysisSteps: ["先写出三角形内角和 180°。", "用 180°-45°-70°=65°。", "第三个角是 65°。"], commonMistake: "连续减法时不要漏减其中一个已知角。" },
    { itemType: "choice", sectionTitle: "二、选择题", prompt: "下面哪一组角可以组成一个三角形？", options: ["A. 30°、60°、90°", "B. 80°、90°、20°", "C. 100°、50°、40°", "D. 90°、90°、10°"], answer: "A", knowledgePoint: "三角形内角和", analysisSteps: ["分别计算每组选项三个角的和。", "A 项：30°+60°+90°=180°。", "其他选项的和都不是 180°。", "因此选择 A。"], commonMistake: "要把三个角全部相加后再判断。" },
    { itemType: "choice", sectionTitle: "二、选择题", prompt: "一个等腰三角形的顶角是 80°，它的一个底角是（ ）。", options: ["A. 40°", "B. 50°", "C. 80°", "D. 100°"], answer: "B", knowledgePoint: "等腰三角形底角相等", analysisSteps: ["两个底角相等。", "先求两个底角的和：180°-80°=100°。", "再平均分成两份：100°÷2=50°。", "因此选择 B。"], commonMistake: "顶角只减一次，剩余角度还要除以 2。" },
    { itemType: "calculation", sectionTitle: "三、计算题", prompt: "在三角形 ABC 中，∠A=38°，∠B=72°，求 ∠C 的度数。", answer: "∠C=70°", knowledgePoint: "三角形内角和", analysisSteps: ["三角形三个内角的和是 180°。", "列式：∠C=180°-38°-72°。", "计算：∠C=70°。"], commonMistake: "结果要带角度符号。" },
    { itemType: "calculation", sectionTitle: "三、计算题", prompt: "一个直角三角形中，一个锐角是 36°，求另一个锐角的度数。", answer: "54°", knowledgePoint: "直角三角形", analysisSteps: ["直角三角形中两个锐角的和是 90°。", "列式：90°-36°=54°。", "另一个锐角是 54°。"], commonMistake: "直角已经占 90°，可以直接用 90° 减去已知锐角。" },
    { itemType: "solution", sectionTitle: "四、解答题", prompt: "如图，三角形 ABC 中，∠A=50°，∠B=∠C。求 ∠B 的度数。", answer: "65°", knowledgePoint: "三角形内角和与等腰三角形", figure: { type: "triangle", labels: ["A", "B", "C"], angleLabels: { A: "50°" }, equalAngles: ["B", "C"] }, analysisSteps: ["因为 ∠B=∠C，所以两个底角相等。", "先求两个底角的和：180°-50°=130°。", "再求一个底角：130°÷2=65°。", "因此 ∠B=65°。"], commonMistake: "求出 130° 后还要除以 2。" },
    { itemType: "solution", sectionTitle: "四、解答题", prompt: "一个三角形的三个内角之比是 1:2:3。求三个角的度数，并判断它是什么三角形。", answer: "30°、60°、90°；直角三角形", knowledgePoint: "按比例分配三角形内角和", analysisSteps: ["三个角一共占 1+2+3=6 份。", "每份是 180°÷6=30°。", "三个角分别是 30°、60°、90°。", "其中有一个角是 90°，所以它是直角三角形。"], commonMistake: "先求每一份的角度，再按比例分别计算。" }
  ];
  const subjectSeeds = {
    语文: [
      ["字词积累", `请围绕“${basePoint}”写出 4 个需要掌握的词语，并各造一个通顺的句子。`, "词语书写正确，造句语义完整。", "检查字形、词义和语境是否匹配。"],
      ["句段理解", `阅读与“${basePoint}”相关的短句，概括句子表达的主要意思。`, "能抓住关键词并写出完整句意。", "先找关键词，再用自己的话概括。"],
      ["阅读训练", "根据短文内容回答问题，答案中至少写出一个依据句。", "答案贴合文本，并能引用依据。", "注意从原文中找证据句。"],
      ["表达运用", `围绕“${basePoint}”写一段 80 字左右的小练笔。`, "语句通顺，重点明确。", "先确定中心，再补充细节。"]
    ],
    数学: [
      ["基础计算", `完成 4 道与“${basePoint}”相关的计算或填空题。`, "计算过程正确，结果准确。", "注意单位、进位和验算。"],
      ["概念判断", `判断 3 个关于“${basePoint}”的说法是否正确，并说明理由。`, "判断正确，理由清楚。", "先回忆概念，再判断关键词。"],
      ["解决问题", `根据“${basePoint}”设计一道两步应用题并解答。`, "列式合理，步骤完整。", "先找数量关系，再分步列式。"],
      ["思维提升", "用画图、列表或列式的方法解决一道综合题。", "方法清晰，结论正确。", "把复杂条件拆成几个小关系。"]
    ],
    英语: [
      ["词汇运用", `写出与“${basePoint}”相关的 5 个单词或短语，并补全句子。`, "拼写正确，句子符合语法。", "注意词性和固定搭配。"],
      ["语法句型", `用“${basePoint}”相关句型完成 4 个句子转换。`, "句型转换正确，时态一致。", "先判断主语和时态，再改写。"],
      ["阅读理解", "阅读短文后完成选择和简答题。", "能根据原文定位答案。", "先看题目关键词，再回到文章定位。"],
      ["书面表达", `围绕“${basePoint}”写 5 句话的小短文。`, "语句连贯，词汇使用准确。", "注意大小写、标点和动词形式。"]
    ]
  };
  if (subject === "数学" && /三角形|内角|角度/.test(basePoint)) {
    const repeated = Array.from({ length: count }).map((_, index) => triangleMathItems[index % triangleMathItems.length]);
    return repeated.map((item, index) => normalizeAssessmentItem({ ...item, prompt: index < triangleMathItems.length ? item.prompt : `${item.prompt}（变式 ${index + 1 - triangleMathItems.length}）` }, index));
  }
  const seeds = subjectSeeds[subject] || subjectSeeds.英语;
  return Array.from({ length: count }).map((_, index) => {
    const seed = seeds[index % seeds.length];
    return normalizeAssessmentItem({
      itemType: seed[0],
      prompt: `${seed[1]}（${difficulty}，第 ${index + 1} 题）`,
      answer: seed[2],
      rubric: seed[3],
      knowledgePoint: basePoint
    }, index);
  });
}

function sectionTitleByType(input, type) {
  return buildAssessmentBlueprint(input).sections.find((section) => section.type === type)?.title || "";
}

function buildEnglishUnitQuizItems(input = {}) {
  const seed = fallbackSeed(input, "english-unit-quiz");
  const fillSection = sectionTitleByType(input, "fill") || "一、词汇与短语";
  const sentenceSection = sectionTitleByType(input, "solution") || "二、句子运用";
  const choiceSection = sectionTitleByType(input, "choice") || "三、单项选择题";
  const readingSection = sectionTitleByType(input, "reading") || "四、阅读理解";
  const point = compactText(input.textbookChapterTitle || input.requirement || input.specialRequirements, "五年级下册第四单元");
  const wordBanks = rotateBySeed([
    [
      ["中文译英文：艺术展览 ______。", "art show", "单元核心短语"],
      ["中文译英文：运动会 ______。", "sports meet", "单元核心短语"],
      ["英文译中文：special ______。", "特殊的", "单元词汇"],
      ["英文译中文：still ______。", "仍然；还", "单元词汇"],
      ["根据中文写单词：第三 ______。", "third", "序数词"],
      ["根据中文写单词：第四 ______。", "fourth", "序数词"],
      ["根据中文写单词：第五 ______。", "fifth", "序数词"],
      ["根据中文写单词：四月 ______。", "April", "月份词汇"]
    ],
    [
      ["中文译英文：学校旅行 ______。", "school trip", "单元活动短语"],
      ["中文译英文：歌唱比赛 ______。", "singing contest", "单元活动短语"],
      ["英文译中文：festival ______。", "节日", "单元词汇"],
      ["英文译中文：birthday ______。", "生日", "单元词汇"],
      ["根据中文写单词：第一 ______。", "first", "序数词"],
      ["根据中文写单词：第二 ______。", "second", "序数词"],
      ["根据中文写单词：第十二 ______。", "twelfth", "序数词"],
      ["根据中文写单词：五月 ______。", "May", "月份词汇"]
    ]
  ], seed)[0];
  const fillItems = wordBanks.map(([prompt, answer, knowledgePoint]) => ({
    itemType: "fill",
    sectionTitle: fillSection,
    prompt,
    answer,
    knowledgePoint,
    analysisSteps: ["先判断题目要求是中译英、英译中还是单词拼写。", "注意月份和序数词的首字母、拼写和固定搭配。", `参考答案：${answer}。`],
    commonMistake: "序数词拼写要完整，月份首字母大写。"
  }));
  const sentenceItems = [
    {
      prompt: "用 When is ...? 和 It is on ... 造句，写出一个关于学校活动日期的问答。",
      answer: "示例：When is the art show? It is on April 4th.",
      point: "日期问答句型"
    },
    {
      prompt: "用 There will be ... on ... 造句，写出一个关于本单元活动安排的句子。",
      answer: "示例：There will be a singing contest on May 5th.",
      point: "活动安排表达"
    }
  ].map((item) => ({
    itemType: "solution",
    sectionTitle: sentenceSection,
    prompt: item.prompt,
    answer: item.answer,
    knowledgePoint: item.point,
    answerFormat: "english-four-line",
    answerSpaceMm: 24,
    analysisSteps: ["先确定活动名称和日期。", "再套用本单元日期问答或活动安排句型。", "检查月份首字母、序数词和标点。"],
    commonMistake: "日期前用 on，月份首字母大写，序数词不要写成基数词。"
  }));
  const choiceItems = [
    ["When is the school trip? It is ______ May 8th.", ["A. in", "B. on", "C. at", "D. to"], "B", "日期介词"],
    ["April 5th is the ______ day of April.", ["A. five", "B. fifth", "C. fifteen", "D. fifty"], "B", "序数词"],
    ["- When is the art show? - ______", ["A. It is beautiful.", "B. It is on April 4th.", "C. I like art.", "D. It is red."], "B", "日期问答"],
    ["There ______ a sports meet next Friday.", ["A. is", "B. are", "C. will be", "D. will have"], "C", "there be 将来表达"]
  ].map(([prompt, options, answer, knowledgePoint]) => ({
    itemType: "choice",
    sectionTitle: choiceSection,
    prompt,
    options,
    answer,
    knowledgePoint,
    analysisSteps: ["先读懂句意并定位日期、活动或句型。", "再根据介词、序数词或固定句型排除错误选项。", `正确答案是 ${answer}。`],
    commonMistake: "不要把日期介词 on 和月份介词 in 混用。"
  }));
  const passage = ensureLongEnglishPassage(
    "grade5-unit4-special-days",
    "Hello, I am Amy. Our school has many special days in April and May. The art show is on April 4th. I will draw a picture of our garden for it. The sports meet is on April 18th. Zhang Peng likes running, so he is happy and practises after class. The reading festival is on April 25th. We will share our favourite books in the library. The singing contest is on May 5th, and Chen Jie wants to sing an English song with her friends. My birthday is on May 12th, too. I like these special days because we can study, play, help each other and share our work with friends. When a special day comes, our teacher asks us to write it on the class calendar, so everyone can remember the date and get ready.",
    240
  );
  const readingItems = [
    ["When is the art show?", ["A. April 4th", "B. April 18th", "C. May 5th", "D. May 12th"], "A", "细节定位"],
    ["What will Amy do for the art show?", ["A. Run", "B. Draw a picture", "C. Sing a song", "D. Play football"], "B", "信息提取"],
    ["Who likes running?", ["A. Amy", "B. Zhang Peng", "C. Mike", "D. Sarah"], "B", "人物信息"],
    ["Why does Amy like these special days?", ["A. Because she can sleep at school.", "B. Because she can study, play and share work with friends.", "C. Because she has no homework.", "D. Because she likes rain."], "B", "原因理解"],
    ["What does Amy's group do on Tuesday?", ["A. They ask who can help.", "B. They clean the classroom.", "C. They buy sports shoes.", "D. They change the school trip."], "A", "计划细节"],
    ["What does the teacher think a special day can help students do?", ["A. Forget their homework.", "B. Plan, practise, share and thank others.", "C. Stay at home.", "D. Only remember dates."], "B", "主旨理解"]
  ].map(([prompt, options, answer, knowledgePoint], index) => ({
    itemType: "reading",
    sectionTitle: readingSection,
    prompt,
    options,
    answer,
    knowledgePoint,
    passageGroupId: "grade5-unit4-special-days",
    passageTitle: "A Short Passage: Special Days",
    passageText: passage,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    analysisSteps: ["先通读短文，圈出活动和日期。", "再回到原文定位题干中的关键词。", `本题答案为 ${answer}。`],
    commonMistake: "阅读题要回原文找日期和人物，不能只凭印象选择。"
  }));
  return markDynamicFallback([
    ...fillItems,
    ...sentenceItems,
    ...choiceItems,
    ...readingItems
  ], input, "english-unit-quiz");
}

function buildEnglishPracticeItems(input = {}) {
  const seed = fallbackSeed(input, "english-practice");
  const fillSection = sectionTitleByType(input, "fill") || "一、针对性词汇巩固";
  const sentenceSection = sectionTitleByType(input, "solution") || "二、句型表达练习";
  const choiceSection = sectionTitleByType(input, "choice") || "三、易错选择题";
  const readingSection = sectionTitleByType(input, "reading") || "四、短阅读巩固";
  const focus = compactText(input.textbookChapterTitle || input.requirement || input.specialRequirements, "近期易错句型");
  const wordBanks = rotateBySeed([
    [
      ["根据中文写短语：做调查 ______。", "do a survey", "学习活动短语"],
      ["根据中文写短语：做计划 ______。", "make a plan", "学习活动短语"],
      ["英文译中文：carefully ______。", "仔细地", "副词运用"],
      ["用所给词适当形式填空：She ______ (visit) the library yesterday.", "visited", "一般过去时"]
    ],
    [
      ["根据中文写短语：参加比赛 ______。", "join a contest", "校园活动短语"],
      ["根据中文写短语：写报告 ______。", "write a report", "学习活动短语"],
      ["英文译中文：better ______。", "更好的；更好地", "比较级"],
      ["用所给词适当形式填空：Tom is ______ (read) a story now.", "reading", "现在进行时"]
    ]
  ], seed)[0];
  const fillItems = wordBanks.map(([prompt, answer, knowledgePoint]) => ({
    itemType: "fill",
    sectionTitle: fillSection,
    prompt,
    answer,
    knowledgePoint,
    analysisSteps: ["先判断题目考查词汇、短语还是词形。", "再结合句子时态和搭配确定答案。", `参考答案：${answer}。`],
    commonMistake: "练习题要围绕易错点巩固，不要机械套用试卷短文填空。"
  }));
  const sentenceItems = [
    ["用 because 连接两个句子：I like the reading room. It is quiet.", "I like the reading room because it is quiet.", "原因表达"],
    ["用一般过去时写一句你昨天完成的学习任务。", "示例：I finished my English homework yesterday.", "一般过去时表达"],
    ["用 What did you ...? 写一个问句，并给出回答。", "示例：What did you do after school? I read a story.", "过去时问答"],
    ["把句子改为否定句：She played basketball last Sunday.", "She did not play basketball last Sunday.", "过去时否定句"]
  ].map(([prompt, answer, knowledgePoint]) => ({
    itemType: "solution",
    sectionTitle: sentenceSection,
    prompt,
    answer,
    knowledgePoint,
    answerFormat: "english-four-line",
    answerSpaceMm: 24,
    analysisSteps: ["先判断句型目标和时态。", "再写出完整句子，注意助动词和动词形式。", "最后检查大小写、标点和语义。"],
    commonMistake: "改写句子时不要只改动一个单词，要检查全句结构。"
  }));
  const choiceItems = [
    ["I ______ my room yesterday afternoon.", ["A. clean", "B. cleaned", "C. cleaning", "D. cleans"], "B", "一般过去时"],
    ["The children are talking ______ their weekend plan.", ["A. about", "B. with", "C. from", "D. by"], "A", "固定搭配"],
    ["Please write the answer ______ the line.", ["A. in", "B. on", "C. at", "D. to"], "B", "介词搭配"],
    ["She studies hard, so she is getting ______ at English.", ["A. good", "B. well", "C. better", "D. best"], "C", "比较级"]
  ].map(([prompt, options, answer, knowledgePoint]) => ({
    itemType: "choice",
    sectionTitle: choiceSection,
    prompt,
    options,
    answer,
    knowledgePoint,
    analysisSteps: ["先读完整句子，判断语境和考点。", "再比较选项的时态、词性或固定搭配。", `正确答案是 ${answer}。`],
    commonMistake: "选择题不要只看中文意思，要看句子结构。"
  }));
  const passage = ensureLongEnglishPassage(
    "english-practice-short",
    "Mia wanted to improve her English speaking. At first, she only read new words from the book. Her teacher asked her to make a small plan: read one short dialogue, record her voice, and listen again. Mia found that she often forgot the ending sounds of words. She practised with her partner every Tuesday and Thursday. Two weeks later, she could ask and answer questions more clearly. She learned that a small plan is useful when she follows it every day.",
    220
  );
  const readingItems = [
    ["What did Mia want to improve?", ["A. English speaking", "B. Maths writing", "C. Art drawing", "D. Running"], "A", "细节定位"],
    ["What did Mia learn from the practice?", ["A. A small plan is useful when she follows it.", "B. She should stop recording.", "C. Dialogues are not helpful.", "D. Ending sounds are never important."], "A", "主旨理解"],
    ["What did Mia write in her new table?", ["A. New words, difficult sounds and useful sentences.", "B. Sports scores and lunch plans.", "C. Art colours and songs.", "D. Bus times and weather."], "A", "信息提取"],
    ["Why did the teacher like Mia's practice method?", ["A. Because she used a small method again and again.", "B. Because she never made mistakes.", "C. Because she stopped speaking.", "D. Because she finished only one exercise."], "A", "推理理解"]
  ].map(([prompt, options, answer, knowledgePoint], index) => ({
    itemType: "reading",
    sectionTitle: readingSection,
    prompt,
    options,
    answer,
    knowledgePoint,
    passageGroupId: "english-practice-reading",
    passageTitle: "A Short Practice Story",
    passageText: passage,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    answerSpaceMm: 8,
    analysisSteps: ["先通读短文，找到人物目标和练习方法。", "再回到原文定位题干关键词。", `本题答案为 ${answer}。`],
    commonMistake: "短阅读练习要回原文找依据，不要凭印象选。"
  }));
  return markDynamicFallback([
    ...fillItems,
    ...sentenceItems,
    ...choiceItems,
    ...readingItems
  ].map((item) => ({
    ...item,
    difficulty: input.difficulty || "综合",
    knowledgePoint: item.knowledgePoint || focus
  })), input, "english-practice");
}

function buildEnglishFallbackAssessmentItems(input = {}) {
  const grade = gradeLevelNumber(input);
  const kind = normalizeAssessmentKind(input.kind);
  const basePoint = compactText(input.textbookChapterTitle || input.requirement || input.specialRequirements, "六年级综合复习");
  const seed = fallbackSeed(input, "english");
  if (kind === "小测") return buildEnglishUnitQuizItems(input);
  if (kind === "练习") return buildEnglishPracticeItems(input);
  const choiceSection = sectionTitleByType(input, "choice") || "一、单项选择题";
  const fillSection = sectionTitleByType(input, "fill") || "二、词汇运用";
  const readingSection = sectionTitleByType(input, "reading") || "三、阅读理解";
  const writingSection = sectionTitleByType(input, "writing") || "四、写作";
  const choices = [
    ["When I got to school, the bell ______ already rung.", ["has", "had", "is", "was"], "B", "过去完成时", ["根据 got 可知主句发生在过去。", "铃声响发生在到校之前，是过去的过去。", "因此用 had rung。"]],
    ["Neither Tom nor his parents ______ going to the museum this Sunday.", ["is", "are", "was", "be"], "B", "就近原则", ["neither...nor 连接主语时谓语看靠近的主语。", "靠近谓语的是 his parents，复数。", "因此选择 are。"]],
    ["The story is ______ interesting that I want to read it again.", ["too", "so", "very", "such"], "B", "so...that 句型", ["interesting 是形容词。", "so + 形容词 + that 表示“如此……以至于”。", "因此选择 so。"]],
    ["We should turn off the lights ______ we leave the classroom.", ["after", "before", "because", "until"], "B", "连词语义", ["句意是离开教室前关灯。", "before 表示“在……之前”。", "因此选择 before。"]],
    ["My sister practices ______ the piano for thirty minutes every day.", ["play", "plays", "playing", "to play"], "C", "固定搭配", ["practice 后接动名词。", "play 的动名词形式是 playing。", "因此选择 playing。"]],
    ["There ______ a sports meeting in our school next Friday.", ["is going to have", "will have", "is going to be", "are going to be"], "C", "there be 将来时", ["there be 句型不能和 have 混用。", "a sports meeting 是单数。", "因此用 is going to be。"]],
    ["The red book can't be Lily's. ______ is on the teacher's desk.", ["She", "Her", "Hers", "It"], "C", "名词性物主代词", ["空格作主语，表示“她的书”。", "名词性物主代词 hers 相当于 her book。", "因此选择 Hers。"]],
    ["The question is a little difficult, but I can work it out ______.", ["myself", "me", "mine", "I"], "A", "反身代词", ["句意是“我自己能算出来”。", "主语是 I，对应反身代词 myself。", "因此选择 myself。"]],
    ["Please speak more slowly, ______ I can't follow you.", ["and", "or", "but", "so"], "B", "并列连词", ["前句提出要求，后句说明否则听不懂。", "or 可表示“否则”。", "因此选择 or。"]],
    ["The students are talking about the book ______ they read last week.", ["who", "which", "where", "when"], "B", "定语从句", ["先行词 the book 指物。", "关系词在从句中作 read 的宾语。", "因此用 which。"]],
    ["The soup smells ______. May I have some?", ["well", "good", "badly", "carefully"], "B", "感官动词", ["smell 是感官系动词。", "后面接形容词作表语。", "good 符合语义。"]],
    ["If it ______ tomorrow, we will stay at home and read books.", ["rains", "rained", "will rain", "is raining"], "A", "条件状语从句", ["if 引导条件状语从句遵循主将从现。", "主句 will stay 是将来，从句用一般现在时。", "因此选择 rains。"]],
    ["The teacher asked us ______ noise in the library.", ["not make", "not to make", "don't make", "not making"], "B", "ask sb. not to do", ["固定结构是 ask sb. not to do sth.。", "否定放在 to do 前面。", "因此选择 not to make。"]],
    ["This is the most useful dictionary ______ I have ever bought.", ["that", "who", "where", "what"], "A", "定语从句 that", ["先行词有最高级修饰时常用 that。", "dictionary 指物，that 在从句中作宾语。", "因此选择 that。"]],
    ["The little boy saved his pocket money ______ he could buy a birthday gift for his mother.", ["so that", "as soon as", "even though", "as if"], "A", "目的状语从句", ["后句表示攒钱的目的。", "so that 表示“以便”。", "因此选择 so that。"]],
    ["Linda has lived in this town ______ she was five years old.", ["since", "for", "until", "before"], "A", "since 引导时间状语", ["句中 has lived 是现在完成时。", "she was five years old 是过去时间点。", "因此用 since。"]],
    ["The classroom must ______ clean before the parents' meeting.", ["keep", "be kept", "kept", "keeping"], "B", "被动语态", ["classroom 与 keep clean 是被动关系。", "must 后用动词原形。", "因此用 be kept。"]],
    ["I don't know ______ he will join the football practice this afternoon.", ["whether", "where", "what", "whose"], "A", "宾语从句", ["句意是不知道他是否参加训练。", "whether 表示“是否”。", "因此选择 whether。"]],
    ["The girl ______ won the reading prize is my deskmate.", ["who", "which", "where", "when"], "A", "定语从句 who", ["先行词 the girl 指人。", "关系词在从句中作主语。", "因此选择 who。"]],
    ["Tom was writing a report while his sister ______ a model plane.", ["made", "was making", "makes", "has made"], "B", "过去进行时", ["while 表示两个动作同时进行。", "主句 was writing 是过去进行时。", "从句也用 was making。"]],
    ["We will have a picnic if the weather ______ fine this weekend.", ["is", "was", "will be", "has been"], "A", "主将从现", ["if 条件从句用一般现在时表示将来。", "weather 是单数。", "因此用 is。"]],
    ["The book is not mine. It may belong to ______.", ["he", "his", "him", "himself"], "C", "介词后人称代词", ["belong to 后接宾语。", "he 的宾格是 him。", "因此选择 him。"]],
    ["The river is becoming cleaner because people throw ______ rubbish into it.", ["fewer", "less", "more", "most"], "B", "不可数名词比较级", ["rubbish 是不可数名词。", "表示更少用 less。", "因此选择 less。"]],
    ["Could you tell me ______ the school bus arrives every morning?", ["when", "what", "whose", "why"], "A", "宾语从句疑问词", ["句意询问校车到达时间。", "when 表示“什么时候”。", "因此选择 when。"]],
    ["The coat looks nice, but it is ______ expensive for me to buy.", ["too", "enough", "such", "so that"], "A", "too...to 结构", ["too + 形容词 + to do 表示“太……而不能”。", "expensive 是形容词。", "因此选择 too。"]],
    ["More trees ______ in our school next spring.", ["plant", "planted", "will be planted", "will plant"], "C", "一般将来时被动语态", ["trees 与 plant 是被动关系。", "next spring 表示将来。", "因此用 will be planted。"]],
    ["My cousin is old enough ______ the bus by himself.", ["take", "taking", "to take", "took"], "C", "enough to do", ["old enough to do 表示“足够大可以做”。", "因此用 to take。"]],
    ["Although the problem was hard, the group didn't ______.", ["give up", "put up", "get up", "look up"], "A", "动词短语辨析", ["句意是问题困难但小组没有放弃。", "give up 表示“放弃”。", "因此选择 give up。"]]
  ].map(([prompt, options, answer, point, steps]) => ({
    itemType: "choice",
    sectionTitle: choiceSection,
    prompt,
    options,
    answer,
    knowledgePoint: point,
    analysisSteps: steps,
    commonMistake: "不要只看中文意思，要结合句型、时态和固定搭配判断。"
  }));
  const articleChoiceBank = rotateBySeed([
    {
      articleText: "Our class reading club ①______ a new project yesterday afternoon. At first, some students thought it was ②______ to finish a poster in one lesson, so the classroom became much ③______. Miss Green stopped us and reminded us that good work needs a clear plan and a ④______ body. This was our ⑤______ time to work in groups this term, and we did not want to waste it. After a short ⑥______, we decided to make a poster about crossing the street ⑦______. We also ⑧______ two parents to share how they read notices in their jobs. Before the bell rang, each group member wrote one useful sentence for the poster. The project was not finished, but everyone knew what to do next and why teamwork mattered.",
      items: [
        ["①（      ）", ["A. began", "B. built", "C. borrowed"], "A", "动词语境"],
        ["②（      ）", ["A. impossible", "B. important", "C. interesting"], "A", "语境判断"],
        ["③（      ）", ["A. quieter", "B. noisier", "C. cleaner"], "B", "形容词比较级"],
        ["④（      ）", ["A. healthy", "B. heavy", "C. hungry"], "A", "形容词辨析"],
        ["⑤（      ）", ["A. five", "B. fifth", "C. fifteen"], "B", "序数词"],
        ["⑥（      ）", ["A. discussion", "B. decision", "C. direction"], "A", "名词辨析"],
        ["⑦（      ）", ["A. safely", "B. slowly", "C. suddenly"], "A", "副词语境"],
        ["⑧（      ）", ["A. invited", "B. invented", "C. visited"], "A", "动词辨析"]
      ]
    },
    {
      articleText: "Last Sunday, my family visited the city science museum. Many children ①______ there with their parents because a robot show was open. My father ②______ us to the museum because it rained heavily in the morning. At the gate, a guide asked everyone to listen ③______ and follow the signs. In one room, a small robot showed children how to brush their ④______ and explained why clean habits were important. In another room, a model leaf was much ⑤______ than the one in our textbook, so we could see the inside clearly. The guide also explained why people should protect the ⑥______ around the city. Before leaving, we finished a short activity by ⑦______. My little sister felt very ⑧______ when the robot waved goodbye to her, and she wrote about the visit in her diary that night.",
      items: [
        ["①（      ）", ["A. arrived", "B. invited", "C. invented"], "A", "动词语境"],
        ["②（      ）", ["A. drove", "B. drew", "C. dropped"], "A", "动词辨析"],
        ["③（      ）", ["A. carefully", "B. carelessly", "C. differently"], "A", "副词语境"],
        ["④（      ）", ["A. teeth", "B. tooth", "C. tongue"], "A", "名词复数"],
        ["⑤（      ）", ["A. thinner", "B. smaller", "C. stronger"], "A", "比较级语境"],
        ["⑥（      ）", ["A. environment", "B. experiment", "C. equipment"], "A", "名词辨析"],
        ["⑦（      ）", ["A. ourselves", "B. themselves", "C. yourselves"], "A", "反身代词"],
        ["⑧（      ）", ["A. excited", "B. exciting", "C. excitedly"], "A", "形容词辨析"]
      ]
    },
    {
      articleText: "The science group needed to make a report before Friday. They walked around the school garden and found many yellow ①______ under the old tree. Mary took notes ②______ than before because she had prepared a table with dates and weather signs. Soon the sky became ③______, so the group moved back to the classroom. The twins had ④______ ideas about how to show their results, but both ideas were useful. In the end, the leader ⑤______ a picture report. It was ⑥______ than a long speech, but it still showed the key points clearly. My brother was a ⑦______ careless with spelling, so he checked every word twice. When the report was finished, the teacher said their ⑧______ was useful because it came from real observation, not from guessing.",
      items: [
        ["①（      ）", ["A. leaves", "B. lives", "C. letters"], "A", "名词辨析"],
        ["②（      ）", ["A. more quickly", "B. more quietly", "C. more heavily"], "A", "副词比较级"],
        ["③（      ）", ["A. cloudy", "B. crowded", "C. clear"], "A", "形容词语境"],
        ["④（      ）", ["A. different", "B. difficult", "C. delicious"], "A", "形容词辨析"],
        ["⑤（      ）", ["A. chose", "B. checked", "C. changed"], "A", "动词语境"],
        ["⑥（      ）", ["A. less helpful", "B. more helpful", "C. more helpless"], "B", "比较级语境"],
        ["⑦（      ）", ["A. little", "B. few", "C. many"], "A", "固定搭配"],
        ["⑧（      ）", ["A. decision", "B. discussion", "C. direction"], "A", "名词语境"]
      ]
    }
  ], seed + 19)[0];
  const articleChoiceFills = articleChoiceBank.items.map(([prompt, options, answer, point], index) => ({
    itemType: "fill",
    sectionTitle: fillSection,
    prompt,
    options,
    answer,
    knowledgePoint: point,
    passageGroupId: "english-article-choice",
    passageTitle: "文章选词填空",
    passageText: articleChoiceBank.articleText,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    analysisSteps: [
      "先通读全文，判断空格前后句子的意思和上下文关系。",
      "再比较 A、B、C 三个意思相近或形式相近的选项，选择最符合语境的一项。",
      `本题应选：${answer}。`
    ],
    commonMistake: "文章选词填空不能只看单词中文意思，要联系上下文和句子结构。"
  }));
  const clozeBanks = grade >= 6
    ? [
      {
        text: "Our class is preparing a reading project. At first, some students thought it was enough to find answers on the ①________________ (Internet). Then our teacher asked us to ②________________ (choose) one book, read the chapter ③________________ (careful) and write our own questions. I worked with two classmates. We read a story about a boy who kept trying after many ④________________ (mistake). When we discussed the story, I found that good reading is not ⑤________________ (copy) sentences. It is about understanding the writer's ⑥________________ (idea) and connecting it with our own life.",
        prompts: [
        ["① ______________________________", "Internet", "上下文词汇"],
        ["② ______________________________", "choose", "动词语境"],
        ["③ ______________________________", "carefully", "副词语境"],
        ["④ ______________________________", "mistakes", "名词复数"],
        ["⑤ ______________________________", "copying", "动名词"],
        ["⑥ ______________________________", "idea", "主旨词"]
        ]
      },
      {
        text: "Before the school art show, our group wanted to make a poster about saving water. We first ①________________ (collect) pictures from old magazines. Then we interviewed the cleaner and learned that many students forgot to turn off the tap after washing brushes. Li Ming wrote a short ②________________ (sentence) under the poster: Every drop matters. On Friday, we ③________________ (put) the poster near the art room. A week later, the cleaner told us that the floor was much ④________________ (dry) than before. We were happy because our work did not just look ⑤________________ (beauty); it helped people build a better ⑥________________ (habit).",
        prompts: [
          ["① ______________________________", "collected", "动词语境"],
          ["② ______________________________", "sentence", "名词语境"],
          ["③ ______________________________", "put", "动词过去式"],
          ["④ ______________________________", "drier", "比较级"],
          ["⑤ ______________________________", "beautiful", "形容词语境"],
          ["⑥ ______________________________", "habit", "主旨词"]
        ]
      },
      {
        text: "During the winter holiday, our class started an online reading diary. Every student ①________________ (choose) a book and wrote three notes each week. At first, I only wrote short answers because I wanted to finish ②________________ (quick). Later, my partner asked me why the main character changed his plan. I went back to the chapter and found two important ③________________ (sentence). From then on, my diary became ④________________ (useful) than before. I learned that reading is not about writing more words, but about thinking ⑤________________ (deep) and asking ⑥________________ (good) questions.",
        prompts: [
          ["① ______________________________", "chose", "一般过去时"],
          ["② ______________________________", "quickly", "副词转换"],
          ["③ ______________________________", "sentences", "名词复数"],
          ["④ ______________________________", "more useful", "形容词比较级"],
          ["⑤ ______________________________", "deeply", "副词转换"],
          ["⑥ ______________________________", "better", "形容词比较级"]
        ]
      },
      {
        text: "Our school held a small science fair last Friday. My group wanted to explain why bread becomes ①________________ (soft) in warm water. We did not know the answer at first, so we ②________________ (search) for information and asked the science teacher. Then we prepared two cups with ③________________ (difference) temperatures. The warm cup changed the bread ④________________ (fast), but the hot cup broke it into pieces. When we shared the result, many students were ⑤________________ (surprise). The teacher said a fair test must be planned ⑥________________ (careful).",
        prompts: [
          ["① ______________________________", "softer", "形容词比较级"],
          ["② ______________________________", "searched", "一般过去时"],
          ["③ ______________________________", "different", "形容词转换"],
          ["④ ______________________________", "faster", "副词比较级"],
          ["⑤ ______________________________", "surprised", "形容词辨析"],
          ["⑥ ______________________________", "carefully", "副词转换"]
        ]
      }
    ]
    : [
      {
        text: "This week our class made a small ①________________ (garden) near the classroom. We ②________________ (water) the plants, wrote notes and watched the leaves every day. We learned that plants need sunshine, water and ③________________ (time).",
        prompts: [
          ["① ______________________________", "garden", "上下文词汇"],
          ["② ______________________________", "watered", "一般过去时"],
          ["③ ______________________________", "time", "语篇理解"]
        ]
      }
    ];
  const orderedArticleChoiceFills = articleChoiceFills.map((item, index) => ({
    ...item,
    showPassage: index === 0,
    passageQuestionIndex: index + 1
  }));
  const clozeBank = rotateBySeed(clozeBanks, seed)[0];
  const clozeText = clozeBank.text;
  const clozePrompts = clozeBank.prompts;
  const clozeFills = clozePrompts.map(([prompt, answer, point], index) => ({
    itemType: "fill",
    sectionTitle: fillSection,
    prompt,
    answer,
    knowledgePoint: point,
    passageGroupId: "english-cloze-a",
    passageTitle: "完形填空",
    passageText: clozeText,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    answerFormat: "cloze",
    analysisSteps: [
      "先通读短文，明确上下文主题和句子关系。",
      "再定位对应空格前后的关键词，判断需要的词性或形式。",
      `结合语境，本空应填：${answer}。`
    ],
    commonMistake: "短文填空不能只看单句，要先读完整语段。"
  }));
  const vocabularyTarget = buildAssessmentBlueprint(input).sections.find((section) => section.type === "fill")?.target || 6;
  const articleChoiceTake = vocabularyTarget <= 4
    ? 2
    : vocabularyTarget <= 8
      ? 4
      : orderedArticleChoiceFills.length;
  const clozeTake = Math.max(0, vocabularyTarget - articleChoiceTake);
  const articleChoicePassageText = syncVisibleEnglishBlanks(
    articleChoiceBank.articleText,
    articleChoiceTake,
    orderedArticleChoiceFills,
    (item) => englishOptionAnswerText(item?.options || [], item?.answer)
  );
  const clozePassageText = syncVisibleEnglishBlanks(
    clozeText,
    clozeTake,
    clozeFills,
    (item) => item?.answer || ""
  );
  const selectedArticleChoiceFills = orderedArticleChoiceFills.slice(0, articleChoiceTake).map((item, index) => ({
    ...item,
    passageText: articleChoicePassageText,
    showPassage: index === 0,
    passageQuestionIndex: index + 1
  }));
  const selectedClozeFills = clozeFills.slice(0, clozeTake).map((item, index) => ({
    ...item,
    passageText: clozePassageText,
    showPassage: index === 0,
    passageQuestionIndex: index + 1
  }));
  const vocabularyFills = [
    ...selectedArticleChoiceFills,
    ...selectedClozeFills
  ];
  const passages = [
    {
      id: "english-reading-a",
      title: "Passage A: A Different Science Homework",
      text: "Last month, Ms Green gave her class a different kind of science homework. Each group had to choose one small problem in the school and find a way to improve it. Jack's group noticed that many students threw away half-used paper after art lessons. They put a blue box beside the art room and wrote a short notice: \"Use the other side before you throw it away.\" At first, only a few students remembered it. Then Jack made a two-minute speech at the Monday meeting and showed how much paper they had saved in one week. By the end of the month, the group had collected enough paper to make seventy notebooks for younger students. Ms Green said the best science homework was not always the one with the highest marks, but the one that changed a real habit.",
      questions: [
        ["What problem did Jack's group try to solve according to the passage?", ["Students wasted half-used paper.", "Students were late for art lessons.", "The art room was too small.", "Younger students had no teachers."], "A", "细节定位"],
        ["Why did Jack make a speech at the Monday meeting?", ["To ask for higher marks.", "To help more students remember the paper box.", "To sell notebooks to younger students.", "To introduce a new art teacher."], "B", "原因推断"],
        ["The word \"habit\" in the last sentence means ______.", ["a way of doing things often", "a kind of school subject", "a difficult science test", "a special notebook"], "A", "语境猜词"],
        ["What does Jack's project show us about solving school problems?", ["Small actions can make a real change.", "Science homework must be done alone.", "Art lessons always waste paper.", "Meetings are more important than homework."], "A", "主旨理解"],
        ["Put the events in the right order: a. Jack gave a speech. b. The group put a blue box beside the art room. c. They made notebooks for younger students.", ["a-b-c", "b-a-c", "c-b-a", "b-c-a"], "B", "事件排序"]
      ]
    },
    {
      id: "english-reading-b",
      title: "Passage B: The Quiet Helper in the Library",
      text: "The new city library opened a reading room for children this spring. It is not very large, but many children like staying there after school. Near the window there is a small screen called Book Helper. Children can type the name of a topic, and the screen will show three shelves where they may find useful books. However, the librarian, Mr Brown, always reminds children that the screen is only a guide. \"A good reader still needs to open the book, compare information and think carefully,\" he says. One Friday, Anna wanted to write about whales. The screen showed her three books, but two of them were picture books for Grade Two. Anna looked at the contents page, chose the third book, and found a chapter about how whales communicate. Later she added her own question: Why do whales sing for such a long time? Mr Brown smiled and said, \"Now your report has a real beginning.\"",
      questions: [
        ["What does Book Helper do in the reading room?", ["It writes reports for children.", "It tells children where useful books may be.", "It reads every book aloud.", "It stops children from asking questions."], "B", "细节定位"],
        ["Why did Anna not choose the first two books?", ["They were too difficult.", "They were about dolphins.", "They were picture books for younger children.", "They were not in the library."], "C", "信息筛选"],
        ["What does Mr Brown want children to do after using the screen?", ["Stop reading paper books.", "Compare information and think carefully.", "Copy the first answer they see.", "Only read books near the window."], "B", "观点理解"],
        ["Why did Mr Brown say Anna's report had a real beginning?", ["Because she finished writing it quickly.", "Because she asked her own question after reading.", "Because she used the biggest book.", "Because she typed very fast."], "B", "推理判断"],
        ["Which title best fits the passage?", ["A Screen That Helps, Not Thinks", "The Largest Library in the City", "How to Draw a Whale", "Anna's First Day at School"], "A", "标题概括"]
      ]
    },
    {
      id: "english-reading-c",
      title: "Passage C: The Map Under the Desk",
      text: "On Tuesday morning, Class Six found an old hand-drawn map under the teacher's desk. It showed the school garden, the music room and a small star beside the back gate. Some students guessed it was part of a game. Their teacher, Ms Lee, asked them not to rush to the answer. The class first compared the map with today's school plan. They found that the back gate had moved ten metres to the east two years ago. Then they interviewed the school cleaner, who remembered that the star marked a place where students planted a friendship tree. The tree was no longer there, but the story helped the class understand why older students still called that corner Friendship Corner. In the end, the map became the first page of their school history project.",
      questions: [
        ["Where did the students find the old map?", ["Under the teacher's desk.", "Beside the back gate.", "In the music room.", "Near Friendship Corner."], "A", "细节定位"],
        ["What did Ms Lee ask the students to do?", ["Draw a new map at once.", "Not rush to the answer.", "Move the back gate.", "Plant another tree."], "B", "细节定位"],
        ["Why did the class compare the old map with today's school plan?", ["To find changes in the school.", "To clean the classroom.", "To choose a music room.", "To make a shopping list."], "A", "原因推断"],
        ["What did the star on the map mark?", ["The music room.", "The teacher's desk.", "A place for a friendship tree.", "A new sports field."], "C", "信息筛选"],
        ["What is the best title for the passage?", ["A Map Tells a School Story", "How to Move a Gate", "The Best Way to Clean Desks", "A Difficult Music Lesson"], "A", "标题概括"]
      ]
    },
    {
      id: "english-reading-d",
      title: "Passage D: A Lunch Box Experiment",
      text: "David often left vegetables in his lunch box because he thought they were boring. His group decided to do a class survey about lunch habits. They made a simple table and asked thirty students what food they left most often. Fifteen students said vegetables, eight said rice, and seven said meat. David was surprised because he was not the only one. The group then invited the school nurse to explain why different foods help the body in different ways. After the talk, David tried cutting carrots into small pieces and eating them with rice. It was still not his favourite food, but he stopped throwing them away. A month later, the class wasted much less food than before.",
      questions: [
        ["Why did David often leave vegetables in his lunch box?", ["He thought they were boring.", "He had no lunch box.", "The nurse told him to.", "He liked rice best."], "A", "细节定位"],
        ["How many students said they often left vegetables?", ["Seven.", "Eight.", "Fifteen.", "Thirty."], "C", "数字信息"],
        ["What did the school nurse explain?", ["How to cook meat.", "Why different foods help the body.", "Where to buy lunch boxes.", "How to make a survey table."], "B", "细节定位"],
        ["What change did David make after the talk?", ["He stopped eating rice.", "He tried eating carrots with rice.", "He threw away more food.", "He asked for two lunch boxes."], "B", "事件发展"],
        ["What lesson did David's group learn from the lunch survey?", ["A small survey can help people change habits.", "Students should never eat vegetables.", "Lunch boxes are hard to clean.", "Nurses only talk about carrots."], "A", "主旨理解"]
      ]
    }
  ];
  const readingWordTarget = grade >= 5
    ? kind === "试卷" ? 285 : kind === "练习" ? 185 : 225
    : kind === "试卷" ? 210 : 170;
  const orderedPassages = rotateBySeed(passages, seed + 61)
    .slice(0, kind === "试卷" ? 2 : 1)
    .map((passage) => ({ ...passage, text: ensureLongEnglishPassage(passage.id, passage.text, readingWordTarget) }));
  const reading = orderedPassages.flatMap((passage) => passage.questions.map(([prompt, options, answer, point], index) => ({
    itemType: "reading",
    sectionTitle: readingSection,
    prompt,
    options,
    answer,
    knowledgePoint: point,
    passageGroupId: passage.id,
    passageTitle: passage.title,
    passageText: passage.text,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    answerSpaceMm: 8,
    analysisSteps: [
      "先阅读完整材料，找到题干中的关键词。",
      "回到短文中定位对应句或前后句，不能只凭单句猜测。",
      `结合上下文判断，本题答案为 ${answer}。`
    ],
    commonMistake: "阅读题要回到原文找依据，尤其是原因、排序、主旨题。"
  })));
  const writingPrompt = grade >= 5
    ? rotateBySeed([
        `假如你参加了班级项目展示，请以 “My Project Experience” 为题写一篇不少于 6 句话的短文。内容包括：1. 项目主题；2. 你做了什么；3. 你的收获。`,
        `请以 “A Change I Made This Term” 为题写一篇不少于 6 句话的短文。内容包括：1. 你改变了什么习惯；2. 为什么改变；3. 结果怎样。`,
        `假如你要向校报投稿，请以 “Learning from a Small Problem” 为题写一篇不少于 6 句话的短文。内容包括：1. 遇到的问题；2. 解决过程；3. 得到的启发。`
      ], seed + 73)[0]
    : rotateBySeed([
        `请以 “My Helpful Friend” 为题写 5 句话，介绍一位帮助过你的朋友。`,
        `请以 “A Happy School Day” 为题写 5 句话，介绍一天校园生活。`
      ], seed + 73)[0];
  const writing = [{
    itemType: "writing",
    sectionTitle: writingSection,
    prompt: `${writingPrompt} 注意时态、大小写和句子连接。`,
    answer: "参考方向：内容完整，句子连贯，语法基本正确，能表达合作或帮助带来的收获。",
    knowledgePoint: "英语书面表达",
    answerFormat: kind === "试卷" ? "english-four-line" : "none",
    answerSpaceMm: kind === "试卷" ? 52 : 0,
    analysisSteps: [
      "先确定主题和人称，列出三点内容。",
      "再用一般过去时或一般现在时写清事件过程。",
      "最后检查大小写、标点、动词形式和句子连接。"
    ],
    commonMistake: "不要只写零散单句，要围绕主题形成完整短文。"
  }];
  return markDynamicFallback([
    ...shuffleBySeed(choices, seed + 11),
    ...vocabularyFills,
    ...reading,
    ...(kind === "试卷" ? writing : [])
  ].map((item) => ({
    ...item,
    difficulty: input.difficulty || "综合",
    knowledgePoint: item.knowledgePoint || basePoint
  })), input, "english");
}

function buildMathFallbackAssessmentItems(input = {}) {
  const seed = fallbackSeed(input, "math");
  const random = seededRandom(seed);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const fillSection = sectionTitleByType(input, "fill") || "一、填空题";
  const choiceSection = sectionTitleByType(input, "choice") || "二、选择题";
  const calcSection = sectionTitleByType(input, "calculation") || "三、计算题";
  const solutionSection = sectionTitleByType(input, "solution") || "四、解答题";
  const focusText = compactText(`${input.requirement || ""} ${input.specialRequirements || ""} ${input.title || ""} ${input.textbookChapterTitle || ""}`);
  const wantsFractionFocus = /分数/.test(focusText);
  const percent = pick([20, 25, 40, 60, 75]);
  const percentAnswer = pick([28, 36, 45, 54, 72]);
  const percentWhole = Number((percentAnswer / (percent / 100)).toFixed(2));
  const radius = pick([3, 4, 5, 6, 8]);
  const ratioA = pick([2, 3, 4, 5]);
  const ratioB = ratioA + pick([2, 3, 4]);
  const ratioAdd = ratioA * pick([2, 3]);
  const ratioScale = (ratioA + ratioAdd) / ratioA;
  const dynamicFills = [
    [`${(radius / 10).toFixed(1)} 公顷 = ______ 平方米。`, String(radius * 1000), "面积单位换算", [`1 公顷 = 10000 平方米。`, `${(radius / 10).toFixed(1)}×10000=${radius * 1000}。`, `填 ${radius * 1000}。`]],
    [`一个数的 ${percent}% 是 ${percentAnswer}，这个数是______。`, String(percentWhole), "百分数应用", [`把这个数看作单位“1”。`, `列式 ${percentAnswer}÷${percent}%=${percentWhole}。`, `这个数是 ${percentWhole}。`]],
    [`一个圆的半径是 ${radius} cm，周长是______ cm。（π取3.14）`, String(Number((2 * 3.14 * radius).toFixed(2))), "圆的周长", ["圆周长 C=2πr。", `2×3.14×${radius}=${Number((2 * 3.14 * radius).toFixed(2))}。`, "结果要带单位。"]],
    [`把 ${ratioA}:${ratioB} 的前项增加 ${ratioAdd}，要使比值不变，后项应增加______。`, String(ratioB * ratioScale - ratioB), "比的基本性质", [`前项从 ${ratioA} 变为 ${ratioA + ratioAdd}，相当于乘 ${ratioScale}。`, `后项也乘 ${ratioScale}，变为 ${ratioB * ratioScale}。`, `应增加 ${ratioB * ratioScale}-${ratioB}=${ratioB * ratioScale - ratioB}。`]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "fill", sectionTitle: fillSection, prompt, answer, knowledgePoint: point, analysisSteps: steps }));
  const fills = [
    ["3.6 公顷 = ______ 平方米。", "36000", "面积单位换算", ["1 公顷 = 10000 平方米。", "3.6×10000=36000。", "填 36000。"]],
    ["一个数的 40% 是 28，这个数是______。", "70", "百分数应用", ["把这个数看作单位“1”。", "列式 28÷40%=70。", "这个数是 70。"]],
    ["7 和 9 的最小公倍数是______。", "63", "最小公倍数", ["7 和 9 互质。", "互质数的最小公倍数是两数乘积。", "7×9=63。"]],
    ["一个圆的半径是 4 cm，周长是______ cm。（π取3.14）", "25.12", "圆的周长", ["圆周长 C=2πr。", "2×3.14×4=25.12。", "周长是 25.12 cm。"]],
    ["把 5:8 的前项增加 10，要使比值不变，后项应增加______。", "16", "比的基本性质", ["前项 5 增加 10 变为 15，相当于乘 3。", "后项也乘 3：8×3=24。", "应增加 24-8=16。"]],
    ["一个三角形三个内角的比是 2:3:4，最大的角是______度。", "80", "按比例分配", ["总份数 2+3+4=9。", "每份 180°÷9=20°。", "最大角 4 份，是 80°。"]],
    ["把 0.375 化成最简分数是______。", "3/8", "小数与分数互化", ["0.375=375/1000。", "分子分母同时除以 125。", "得到 3/8。"]],
    ["一个长方体长 8 cm、宽 5 cm、高 3 cm，体积是______ cm³。", "120", "长方体体积", ["长方体体积=长×宽×高。", "8×5×3=120。", "体积是 120 cm³。"]],
    ["一件商品原价 160 元，打八折后便宜了______元。", "32", "折扣问题", ["八折表示现价是原价的 80%。", "便宜 20%。", "160×20%=32。"]],
    ["在比例 6:9 = 10:______ 中，缺少的数是______。", "15", "比例基本性质", ["6:9 可化为 2:3。", "10 对应 2 份，1 份是 5。", "3 份是 15。"]],
    ["一个数除以 0.25 等于 48，这个数是______。", "12", "小数除法逆运算", ["被除数=商×除数。", "48×0.25=12。", "这个数是 12。"]],
    ["在 1、2、3、5、8、13 中，奇数有______个。", "4", "奇偶数", ["奇数不能被 2 整除。", "1、3、5、13 是奇数。", "共有 4 个。"]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "fill", sectionTitle: fillSection, prompt, answer, knowledgePoint: point, analysisSteps: steps }));
  const choices = [
    ["下面各数中，最接近 0.8 的是（ ）。", ["0.78", "0.71", "0.89", "0.65"], "A", "小数大小"],
    ["一个圆柱的底面积不变，高扩大到原来的 3 倍，体积（ ）。", ["扩大到原来的3倍", "缩小到原来的1/3", "不变", "扩大到原来的9倍"], "A", "圆柱体积"],
    ["如果 a:b=3:5，那么 (a×4):(b×4)=（ ）。", ["3:5", "12:5", "3:20", "4:5"], "A", "比的基本性质"],
    ["把一根绳子平均剪成 7 段，每段占全长的（ ）。", ["1/7", "1/6", "7/1", "6/7"], "A", "分数意义"],
    ["下列图形中，对称轴最多的是（ ）。", ["圆", "长方形", "等腰三角形", "平行四边形"], "A", "轴对称"],
    ["一个三角形中，已知两个角是 35° 和 65°，第三个角是（ ）。", ["80°", "90°", "100°", "110°"], "A", "三角形内角和"],
    ["买 4 支同样的笔用 12 元，买 9 支需要（ ）元。", ["27", "21", "36", "24"], "A", "归一问题"],
    ["下面算式中，结果最大的是（ ）。", ["3.2÷0.4", "3.2×0.4", "3.2-0.4", "3.2+0.4"], "A", "小数运算"]
  ].map(([prompt, options, answer, point]) => ({
    itemType: "choice",
    sectionTitle: choiceSection,
    prompt,
    options,
    answer,
    knowledgePoint: point,
    analysisSteps: ["先判断题目考查的概念或数量关系。", "逐项计算或比较，排除不符合条件的选项。", `正确答案是 ${answer}。`]
  }));
  const dynamicCalculations = [
    [`计算：${(radius + 6) / 2} × 0.${ratioA}${ratioB} × ${ratioB}。`, String(Number((((radius + 6) / 2) * Number(`0.${ratioA}${ratioB}`) * ratioB).toFixed(2))), "小数乘法", ["先按从左到右或结合律计算。", "注意小数点位置。", "最后检查结果是否合理。"]],
    [`解方程：${ratioA}x - ${ratioB * 3} = ${ratioA * 20 + ratioB * 3}。`, "x=20", "方程", [`等式两边同时加 ${ratioB * 3}。`, `得到 ${ratioA}x=${ratioA * 20}。`, "两边同时除以系数，x=20。"]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "calculation", sectionTitle: calcSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, answerSpaceMm: 18 }));
  const calculations = [
    ["计算：12.5×0.32×8。", "32", "小数乘法简算", ["利用乘法交换律和结合律。", "12.5×8=100。", "100×0.32=32。"]],
    ["计算：7/12 + 5/18 - 1/6。", "25/36", "异分母分数加减", ["通分，12、18、6 的最小公倍数是 36。", "7/12=21/36，5/18=10/36，1/6=6/36。", "21/36+10/36-6/36=25/36。"]],
    ["解方程：3x - 18 = 42。", "x=20", "一元一次方程", ["等式两边同时加 18，得 3x=60。", "两边同时除以 3。", "x=20。"]],
    ["计算：4.8÷0.6 + 2.5×4。", "18", "混合运算", ["先算乘除：4.8÷0.6=8。", "2.5×4=10。", "8+10=18。"]],
    ["求比值：2.4:0.6。", "4", "求比值", ["比值=前项÷后项。", "2.4÷0.6=4。", "比值是 4。"]],
    ["计算：36×(5/9 - 1/6)。", "14", "分配律与分数运算", ["先通分：5/9=10/18，1/6=3/18。", "括号内为 7/18。", "36×7/18=14。"]],
    ["解方程：x÷1.5 = 6.4。", "x=9.6", "小数方程", ["被除数=商×除数。", "x=6.4×1.5。", "x=9.6。"]],
    ["计算：3.14×6²。", "113.04", "圆面积", ["6²=36。", "3.14×36=113.04。", "结果是 113.04。"]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "calculation", sectionTitle: calcSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, answerSpaceMm: 18 }));
  const dynamicSolutions = [
    [`学校图书角有故事书 ${percentAnswer * 5} 本，科技书比故事书少 ${percent}%。科技书有多少本？`, `${percentAnswer * 5 * (100 - percent) / 100} 本`, "百分数应用题", [`科技书是故事书的 ${100 - percent}%。`, `列式：${percentAnswer * 5}×${100 - percent}%=${percentAnswer * 5 * (100 - percent) / 100}。`, "答题时要写清单位。"]],
    [`一个圆形花坛半径 ${radius} m，沿花坛外侧修一圈宽 1 m 的小路。小路面积是多少平方米？（π取3.14）`, `${Number((3.14 * ((radius + 1) ** 2 - radius ** 2)).toFixed(2))} 平方米`, "圆环面积", [`外圆半径是 ${radius}+1=${radius + 1} m。`, `圆环面积=3.14×(${radius + 1}²-${radius}²)。`, `面积是 ${Number((3.14 * ((radius + 1) ** 2 - radius ** 2)).toFixed(2))} 平方米。`], { type: "circle-square", radiusLabel: `${radius}m` }],
    [`如图，三角形 ABC 中，∠A=${40 + ratioA * 3}°，∠B=∠C。求 ∠B 的度数。`, `${(180 - (40 + ratioA * 3)) / 2}°`, "三角形内角和", [`两个底角相等。`, `两个底角的和是 180°-${40 + ratioA * 3}°=${180 - (40 + ratioA * 3)}°。`, `每个底角是 ${180 - (40 + ratioA * 3)}°÷2=${(180 - (40 + ratioA * 3)) / 2}°。`], { type: "triangle", labels: ["A", "B", "C"], angleLabels: { A: `${40 + ratioA * 3}°` }, equalAngles: ["B", "C"] }],
    [`一个长方体收纳盒长 ${radius + 6} cm，宽 ${ratioB + 3} cm，高 ${ratioA + 2} cm。做 4 个这样的收纳盒，至少需要多少立方厘米空间来存放？`, `${(radius + 6) * (ratioB + 3) * (ratioA + 2) * 4} 立方厘米`, "长方体体积", [`先求一个收纳盒体积：${radius + 6}×${ratioB + 3}×${ratioA + 2}。`, `再乘 4。`, `结果是 ${(radius + 6) * (ratioB + 3) * (ratioA + 2) * 4} 立方厘米。`]]
  ].map(([prompt, answer, point, steps, figure]) => ({ itemType: "solution", sectionTitle: solutionSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, figure, answerSpaceMm: 20 }));
  const solutions = [
    ["学校图书角有故事书 180 本，科技书比故事书少 25%。科技书有多少本？", "135 本", "百分数应用题", ["科技书比故事书少 25%，就是故事书的 75%。", "列式：180×(1-25%)=180×75%。", "计算得 135 本。"]],
    ["一个圆形花坛半径 5 m，沿花坛外侧修一圈宽 1 m 的小路。小路面积是多少平方米？（π取3.14）", "34.54 平方米", "圆环面积", ["外圆半径是 5+1=6 m，内圆半径是 5 m。", "圆环面积=π×(6²-5²)。", "3.14×(36-25)=34.54 平方米。"]],
    ["甲、乙两人合作完成一项任务，甲单独做要 6 小时，乙单独做要 9 小时。两人合作 2 小时完成了这项任务的几分之几？", "5/9", "工程问题", ["甲每小时完成 1/6，乙每小时完成 1/9。", "合作每小时完成 1/6+1/9=5/18。", "2 小时完成 5/18×2=5/9。"]],
    ["如图，三角形 ABC 中，∠A=46°，∠B=∠C。求 ∠B 的度数。", "67°", "三角形内角和", ["因为 ∠B=∠C。", "两个底角的和是 180°-46°=134°。", "∠B=134°÷2=67°。"], { type: "triangle", labels: ["A", "B", "C"], angleLabels: { A: "46°" }, equalAngles: ["B", "C"] }],
    ["一辆汽车从甲地到乙地，前 2 小时每小时行 65 千米，剩下的路程每小时行 70 千米，又行了 3 小时到达。甲乙两地相距多少千米？", "340 千米", "分段行程", ["先求前 2 小时路程：65×2=130 千米。", "再求后 3 小时路程：70×3=210 千米。", "总路程 130+210=340 千米。"]],
    ["如图，一个圆内接正方形，圆的半径是 6 cm。请先求圆的面积，再说明正方形面积为什么小于圆面积。（π取3.14）", "圆面积 113.04 cm²；正方形在圆内，所以面积小于圆。", "圆面积与图形关系", ["圆面积公式 S=πr²。", "3.14×6²=113.04。", "正方形完全在圆内，因此面积小于圆。"], { type: "circle-square", radiusLabel: "6cm" }],
    ["学校买来 24 盒粉笔，白粉笔盒数与彩色粉笔盒数的比是 5:3。白粉笔和彩色粉笔各有多少盒？", "白粉笔 15 盒，彩色粉笔 9 盒。", "按比例分配", ["总份数 5+3=8。", "每份 24÷8=3 盒。", "白粉笔 5×3=15 盒，彩色粉笔 3×3=9 盒。"]]
  ].map(([prompt, answer, point, steps, figure]) => ({ itemType: "solution", sectionTitle: solutionSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, figure, answerSpaceMm: 20 }));
  const fractionFills = [
    ["3/4 的分数单位是______，再添上______个这样的分数单位就是 1。", "1/4；1", "分数单位", ["分母是 4，分数单位是 1/4。", "3/4 到 4/4 还差 1/4。", "所以再添 1 个。"]],
    ["把 18/24 化成最简分数是______。", "3/4", "约分", ["18 和 24 的最大公因数是 6。", "分子分母同时除以 6。", "18/24=3/4。"]],
    ["5/6 与 7/9 比较，较大的分数是______。", "5/6", "通分比较", ["6 和 9 的最小公倍数是 18。", "5/6=15/18，7/9=14/18。", "15/18 大于 14/18。"]],
    ["一根绳子长 3 米，平均剪成 8 段，每段长______米。", "3/8", "分数意义", ["总长 3 米平均分成 8 份。", "每份是 3÷8。", "每段长 3/8 米。"]],
    ["把 0.625 化成最简分数是______。", "5/8", "小数与分数互化", ["0.625=625/1000。", "分子分母同时除以 125。", "得到 5/8。"]],
    ["比 2/3 多 1/6 的数是______。", "5/6", "异分母分数加法", ["先通分：2/3=4/6。", "4/6+1/6=5/6。", "结果是 5/6。"]],
    ["一个数的 3/5 是 24，这个数是______。", "40", "分数除法应用", ["把这个数看作单位“1”。", "已知 3/5 是 24。", "列式 24÷3/5=40。"]],
    ["甲数是乙数的 4/7，乙数是 35，甲数是______。", "20", "求一个数的几分之几", ["求 35 的 4/7。", "35×4/7=20。", "甲数是 20。"]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "fill", sectionTitle: fillSection, prompt, answer, knowledgePoint: point, analysisSteps: steps }));
  const fractionChoices = [
    ["下面与 6/8 相等的分数是（ ）。", ["3/4", "2/3", "4/6", "5/8"], "A", "分数基本性质"],
    ["计算 2/5 + 1/10 时，正确的通分结果是（ ）。", ["4/10+1/10", "2/10+1/10", "4/5+1/10", "3/10+1/10"], "A", "异分母通分"],
    ["一袋米吃了 3/8，还剩（ ）。", ["5/8", "3/8", "1/8", "8/5"], "A", "分数减法"],
    ["下面算式结果小于 1 的是（ ）。", ["3/4+1/5", "5/6+1/3", "7/8+1/4", "2/3+1/2"], "A", "分数估算"],
    ["把 4 米长的彩带平均分给 5 人，每人分到（ ）米。", ["4/5", "5/4", "1/5", "1/4"], "A", "分数除法意义"],
    ["一个数乘 2/3 得 18，这个数是（ ）。", ["27", "12", "20", "30"], "A", "已知一个数的几分之几"]
  ].map(([prompt, options, answer, point]) => ({
    itemType: "choice",
    sectionTitle: choiceSection,
    prompt,
    options,
    answer,
    knowledgePoint: point,
    analysisSteps: ["先判断题目中的单位“1”或通分关系。", "再逐项计算或比较。", `正确答案是 ${answer}。`]
  }));
  const fractionCalculations = [
    ["计算：5/12 + 7/18 - 1/6。", "23/36", "异分母分数加减", ["12、18、6 的最小公倍数是 36。", "5/12=15/36，7/18=14/36，1/6=6/36。", "15/36+14/36-6/36=23/36。"]],
    ["计算：3/4 × 8/9 ÷ 2/3。", "1", "分数乘除混合", ["先把除以 2/3 变成乘 3/2。", "3/4×8/9×3/2。", "约分后结果是 1。"]],
    ["解方程：x - 2/5 = 7/10。", "x=11/10", "分数方程", ["等式两边同时加 2/5。", "2/5=4/10。", "x=7/10+4/10=11/10。"]],
    ["计算：24 × (5/6 - 3/8)。", "11", "分数混合运算", ["先通分：5/6=20/24，3/8=9/24。", "括号内为 11/24。", "24×11/24=11。"]]
  ].map(([prompt, answer, point, steps]) => ({ itemType: "calculation", sectionTitle: calcSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, answerSpaceMm: 16 }));
  const fractionSolutions = [
    ["一本书有 180 页，小航第一天读了全书的 1/5，第二天读了剩下的 1/4。两天一共读了多少页？", "72 页", "分数应用题", ["第一天读 180×1/5=36 页。", "剩下 180-36=144 页。", "第二天读 144×1/4=36 页，两天共 72 页。"]],
    ["一桶油用去 2/7 后还剩 25 千克。这桶油原来有多少千克？", "35 千克", "已知剩余求单位“1”", ["用去 2/7，还剩 5/7。", "5/7 对应 25 千克。", "25÷5/7=35 千克。"]],
    ["学校合唱队有 48 人，其中女生占 5/8。后来又加入 6 名女生，现在女生有多少人？", "36 人", "求一个数的几分之几", ["原来女生 48×5/8=30 人。", "后来加入 6 名女生。", "现在女生 30+6=36 人。"]],
    ["一块长方形菜地，长 12 米，宽是长的 3/4。菜地面积是多少平方米？", "108 平方米", "分数与面积", ["宽是 12×3/4=9 米。", "长方形面积=长×宽。", "12×9=108 平方米。"], { type: "rectangle", widthLabel: "12m", heightLabel: "宽为长的3/4" }],
    ["工程队修一条路，第一周修了全长的 2/9，第二周修了全长的 1/3，还剩 160 米。这条路全长多少米？", "360 米", "分数应用题", ["已修 2/9+1/3=5/9。", "还剩 4/9，对应 160 米。", "全长 160÷4/9=360 米。"]],
    ["一个班有学生 45 人，参加数学兴趣小组的人数占 2/5，参加英语兴趣小组的人数占 1/3。两个兴趣小组共有多少人？", "33 人", "分数乘法应用", ["数学兴趣小组 45×2/5=18 人。", "英语兴趣小组 45×1/3=15 人。", "共有 18+15=33 人。"]]
  ].map(([prompt, answer, point, steps, figure]) => ({ itemType: "solution", sectionTitle: solutionSection, prompt, answer, knowledgePoint: point, analysisSteps: steps, figure, answerSpaceMm: 18 }));
  if (wantsFractionFocus) {
    return markDynamicFallback([
      ...shuffleBySeed(fractionFills, seed + 5),
      ...shuffleBySeed(fractionChoices, seed + 13),
      ...shuffleBySeed(fractionCalculations, seed + 29),
      ...shuffleBySeed(fractionSolutions, seed + 41)
    ], input, "math-fraction");
  }
  return markDynamicFallback([
    ...shuffleBySeed([...dynamicFills, ...fills], seed + 5),
    ...shuffleBySeed(choices, seed + 13),
    ...shuffleBySeed([...dynamicCalculations, ...calculations], seed + 29),
    ...shuffleBySeed([...dynamicSolutions, ...solutions], seed + 41)
  ], input, "math");
}

function buildChineseFallbackAssessmentItems(input = {}) {
  const grade = gradeLevelNumber(input);
  const kind = normalizeAssessmentKind(input.kind);
  const seed = fallbackSeed(input, "chinese");
  const fillSection = sectionTitleByType(input, "fill") || "一、基础知识";
  const useSection = sectionTitleByType(input, "solution") || "二、积累与应用";
  const readingSection = sectionTitleByType(input, "reading") || "三、阅读理解";
  const writingSection = sectionTitleByType(input, "writing") || "四、写作题";
  const pinyinBank = rotateBySeed([
    {
      answer: "勤勉；阻挠；慷慨",
      words: [{ pinyin: "qín miǎn", cells: 2 }, { pinyin: "zǔ náo", cells: 2 }, { pinyin: "kāng kǎi", cells: 2 }]
    },
    {
      answer: "眺望；徘徊；严峻",
      words: [{ pinyin: "tiào wàng", cells: 2 }, { pinyin: "pái huái", cells: 2 }, { pinyin: "yán jùn", cells: 2 }]
    },
    {
      answer: "稚嫩；敏捷；笨拙",
      words: [{ pinyin: "zhì nèn", cells: 2 }, { pinyin: "mǐn jié", cells: 2 }, { pinyin: "bèn zhuō", cells: 2 }]
    },
    {
      answer: "酝酿；澄澈；崎岖",
      words: [{ pinyin: "yùn niàng", cells: 2 }, { pinyin: "chéng chè", cells: 2 }, { pinyin: "qí qū", cells: 2 }]
    },
    {
      answer: "浏览；斟酌；馈赠",
      words: [{ pinyin: "liú lǎn", cells: 2 }, { pinyin: "zhēn zhuó", cells: 2 }, { pinyin: "kuì zèng", cells: 2 }]
    },
    {
      answer: "沸腾；谨慎；坚韧",
      words: [{ pinyin: "fèi téng", cells: 2 }, { pinyin: "jǐn shèn", cells: 2 }, { pinyin: "jiān rèn", cells: 2 }]
    },
    {
      answer: "憧憬；蜿蜒；璀璨",
      words: [{ pinyin: "chōng jǐng", cells: 2 }, { pinyin: "wān yán", cells: 2 }, { pinyin: "cuǐ càn", cells: 2 }]
    },
    {
      answer: "苍穹；沉淀；缝隙",
      words: [{ pinyin: "cāng qióng", cells: 2 }, { pinyin: "chén diàn", cells: 2 }, { pinyin: "fèng xì", cells: 2 }]
    },
    {
      answer: "迸发；端详；秘诀",
      words: [{ pinyin: "bèng fā", cells: 2 }, { pinyin: "duān xiáng", cells: 2 }, { pinyin: "mì jué", cells: 2 }]
    }
  ], seed)[0];
  const fills = [
    {
      prompt: "看拼音，在田字格中规范书写词语。",
      answer: pinyinBank.answer,
      point: "字词书写",
      answerFormat: "tianzige",
      pinyinWords: pinyinBank.words
    },
    { prompt: "给加点字选择正确读音：勉强（qiáng / qiǎng）答案：______；供应（gōng / gòng）答案：______。", answer: "qiǎng；gōng", point: "多音字" },
    { prompt: "把词语补充完整：全神（  ）注    见微知（  ）    司空见（  ）。", answer: "贯；著；惯", point: "成语积累" },
    { prompt: "写出“清晰”的近义词______，写出“陌生”的反义词______。", answer: "清楚；熟悉", point: "近反义词" },
    { prompt: "下列词语中有错别字的一项请改正：锻炼、辨论、严峻、贡献。应改为______。", answer: "辨论应为辩论", point: "易错字" },
    { prompt: "给句子加上合适的关联词：______遇到困难，______不能轻易放弃。", answer: "即使；也", point: "关联词" },
    { prompt: "写出一句珍惜时间的名言或诗句。", answer: "少壮不努力，老大徒伤悲。", point: "日积月累", answerFormat: "ruled", answerSpaceMm: 5 },
    { prompt: "判断修辞：小河唱着歌向远方跑去。（  ）", answer: "拟人", point: "修辞手法" },
    { prompt: "根据语境填写词语：面对困难，他没有退缩，而是______地想办法解决。", answer: "沉着/冷静/坚持不懈", point: "语境运用" },
    { prompt: "给加点字选择正确读音：薄雾（bó / báo）答案：______；记载（zǎi / zài）答案：______。", answer: "bó；zǎi", point: "多音字" },
    { prompt: "把词语补充完整：别出心（  ）    语重心（  ）    （  ）然大悟。", answer: "裁；长；恍", point: "成语积累" },
    { prompt: "写出“镇定”的近义词______，写出“粗糙”的反义词______。", answer: "沉着；光滑", point: "近反义词" },
    { prompt: "下列词语中有错别字的一项请改正：书籍、惆怅、拨弄、迫不急待。应改为______。", answer: "迫不急待应为迫不及待", point: "易错字" },
    { prompt: "给句子加上合适的关联词：______认真观察，______能发现问题的关键。", answer: "只有；才", point: "关联词" },
    { prompt: "判断修辞：阳光把操场铺成了一块金色的毯子。（  ）", answer: "比喻", point: "修辞手法" },
    { prompt: "根据语境填写词语：听到这个消息，同学们______，纷纷围了过来。", answer: "兴致勃勃/惊喜不已", point: "语境运用" },
    { prompt: "请写出一句表现坚持不懈的名言或诗句。", answer: "锲而不舍，金石可镂。", point: "日积月累", answerFormat: "ruled", answerSpaceMm: 5 },
    { prompt: "选择恰当词语填空：这份调查报告内容______（详细 / 详尽），数据也很清楚。", answer: "详尽", point: "词语辨析" },
    { prompt: "给加点字选择正确读音：单薄（bó / báo）答案：______；号召（zhāo / zhào）答案：______。", answer: "bó；zhào", point: "多音字" },
    { prompt: "把词语补充完整：心悦（  ）服    （  ）然有序    不可思（  ）。", answer: "诚；井；议", point: "成语积累" },
    { prompt: "根据语境填写词语：他先查资料，再做实验，最后得出了______的结论。", answer: "可靠/准确/有依据", point: "语境运用" }
  ].map((source) => ({
    itemType: "fill",
    sectionTitle: fillSection,
    prompt: source.prompt,
    answer: source.answer,
    knowledgePoint: source.point,
    answerFormat: source.answerFormat || null,
    answerSpaceMm: source.answerSpaceMm || 0,
    pinyinWords: source.pinyinWords || [],
    analysisSteps: ["先审清题目要求。", "再结合字音、字形、语境或句式规则判断。", `参考答案：${source.answer}。`]
  }));
  const chineseUseSpaceMm = (prompt) => {
    const text = String(prompt || "");
    if (/判断/.test(text)) return 0;
    if (/通知|补充完整|时间、地点和事件/.test(text)) return 4;
    if (/扩写|仿写|写一句|理解|启示|概括|改写|修改病句|陈述句|描写/.test(text)) return 4;
    return 4;
  };
  const uses = [
    ["把下面句子扩写得更具体：同学们观察植物。", "示例：同学们在阳光明媚的下午认真观察校园角落里的植物。", "句子扩写"],
    ["请用“既……又……”写一句表现人物特点的话。", "示例：这位老师既耐心又细心，总能发现我们的进步。", "关联词造句"],
    ["概括下面句子的主要意思：为了完成班级调查报告，小组成员分工采访、整理数据并制作图表。", "小组成员合作完成班级调查报告。", "压缩句意"],
    ["请把下面通知补充完整：明天下午三点，六年级同学到报告厅参加阅读分享会，请写出通知中的时间、地点和事件。", "时间：明天下午三点；地点：报告厅；事件：参加阅读分享会。", "应用文信息提取"],
    ["仿写句子：书籍像一盏灯，照亮前行的路。", "示例：老师像一把钥匙，打开知识的大门。", "仿写"],
    ["按要求改写句子：把“同学们完成了实践报告。”改为“把”字句。", "同学们把实践报告完成了。", "句式转换"],
    ["按要求修改病句：通过这次活动，使我明白了合作的重要。", "删去“通过”或“使”。", "病句修改"],
    ["把反问句改为陈述句：难道我们不应该保护环境吗？", "我们应该保护环境。", "句式转换"],
    ["请写出一句描写人物动作和神态的句子。", "示例：他皱着眉头，紧紧握着铅笔，在草稿纸上反复演算。", "描写方法"],
    ["判断说明方法：这座桥长约 120 米，宽 8 米。说明方法：______。", "列数字", "说明方法"],
    ["请用一句话写出你对“实践出真知”的理解。", "只有亲自尝试和验证，才能获得真正可靠的认识。", "句意理解"],
    ["把下面句子改成转述句：老师说：“明天我们要检查读书笔记。”", "老师说明天他们要检查读书笔记。", "句式转换"],
    ["请用“不是……而是……”写一句说明学习方法的话。", "示例：学习不是只记答案，而是要理解方法。", "关联词造句"],
    ["给下面句子补充恰当的标点：小明问 这本书是谁的", "小明问：“这本书是谁的？”", "标点运用"],
    ["请把“校园里的桂花开了。”扩写成一句有颜色或气味描写的话。", "示例：校园里的金桂悄悄开了，淡淡的香气飘满走廊。", "句子扩写"]
  ].map(([prompt, answer, point]) => {
    const answerSpaceMm = chineseUseSpaceMm(prompt);
    return {
      itemType: "solution",
      sectionTitle: useSection,
      prompt,
      answer,
      knowledgePoint: point,
      analysisSteps: ["先明确题目要求和表达对象。", "再抓住关键词组织语言。", "答案要完整、通顺、有依据。"],
      answerFormat: answerSpaceMm > 0 ? "ruled" : "none",
      answerSpaceMm
    };
  });
  const modernBank = rotateBySeed([
    {
      title: "阅读（一）小菜园里的发现",
      text: "傍晚，校园里的小菜园安静下来。白天还吵着要给番茄多浇水的几个孩子，此刻围在记录本前认真讨论。第一次种植时，他们总觉得只要勤快就能让植物长得更好，于是每天都浇很多水。几天后，叶子反而发黄了。科学老师没有直接批评，而是让他们查资料、量土壤湿度，并把不同浇水量的植株放在一起观察。两个星期后，孩子们发现，合适比过量更重要。展示会上，小组长说：“我们学到的不只是怎样种番茄，还学到做事不能只凭热情，要有观察、记录和判断。”台下响起掌声，那掌声像一粒粒种子，落进每个人心里。",
      questions: [
        ["短文主要写了一件什么事？", "学生通过种植实践明白做事要观察、记录和判断。", "内容概括"],
        ["孩子们第一次种植时出现了什么问题？原因是什么？", "叶子发黄；原因是他们以为越勤快越好，每天浇太多水。", "原因分析"],
        ["“合适比过量更重要”在文中指什么？请结合短文说明。", "浇水不能越多越好，要根据植物需要和土壤湿度来决定。", "句意理解"],
        ["科学老师为什么没有直接批评孩子们？", "老师希望孩子们通过查资料、测量和对比观察自己发现问题。", "人物做法推断"],
        ["文末画线句“掌声像一粒粒种子”有什么表达效果？", "运用比喻，写出大家受到启发，这次实践的收获会在心里继续生长。", "修辞赏析"],
        ["你从这个小组的经历中得到什么启示？", "示例：做事要有热情，也要讲方法，遇到问题要观察证据再判断。", "拓展表达"],
        ["请从文中找出表现孩子们认真研究的两个词语或短语。", "查资料、量土壤湿度、放在一起观察等。", "信息筛选"],
        ["如果给短文拟一个题目，最合适的是哪一个？请说明理由。", "示例：《合适比过量更重要》，因为它概括了实践中得到的核心道理。", "标题概括"]
      ]
    },
    {
      title: "阅读（一）一张借书卡",
      text: "周三下午，图书角新到了一批书。班长把借书卡整齐地放在桌上，提醒大家借书前先写姓名和日期。小林急着去操场，只随手拿走了一本《昆虫记》，没有登记。第二天，语文老师查找这本书时，大家都说没有看见。小林脸红了，他想把书悄悄放回去，可又觉得这样不能解决问题。下课后，他主动向老师说明情况，并在借书卡上补写了信息。老师没有批评他，只让他给同学们讲一讲为什么小小的借书卡也很重要。小林说：“规则不是为了麻烦我们，而是为了让每个人都能方便地找到书。”",
      questions: [
        ["短文围绕哪件事展开？", "小林借书没有登记，后来主动说明并认识到规则的重要。", "内容概括"],
        ["小林一开始为什么没有登记？", "他急着去操场，随手拿走书，没有按要求填写借书卡。", "原因分析"],
        ["老师为什么让小林给同学们讲借书卡的重要？", "老师希望他通过说明自己的经历，让大家理解规则的意义。", "人物做法推断"],
        ["“规则不是为了麻烦我们”这句话说明了什么？", "规则能帮助大家有序使用公共物品，方便每个人。", "句意理解"],
        ["你从小林的做法中得到什么启示？", "示例：犯错后要主动承担，遵守规则也是对他人负责。", "拓展表达"],
        ["给短文拟一个合适的题目，并说明理由。", "示例：《一张借书卡》，因为借书卡贯穿事件并体现规则主题。", "标题概括"],
        ["小林后来为什么主动承担图书管理员工作？", "他想弥补自己的疏忽，也希望帮助同学们更好地遵守借书规则。", "人物心理"],
        ["借书卡后来除了登记，还有什么新的作用？", "能记录短评，帮助同学交流阅读感受、推荐图书。", "信息整合"]
      ]
    },
    {
      title: "阅读（一）雨后的尺子",
      text: "连续下了两天雨，操场边的排水沟积了不少水。科学社团的同学准备写一份校园安全建议书。小哲一开始只想写“排水沟太浅”，可组长提醒他：“没有证据，建议就站不住。”于是他们找来尺子，在不同位置测量积水深度，又记录了水退去所用的时间。结果发现，最深的地方并不是排水沟，而是靠近跑道转弯处的一小块低洼地。大家把数据画成表格，交给总务老师。几天后，那块低洼地被重新铺平。小哲在记录本上写道：一把尺子量出的不只是深浅，也量出了我们做事是否认真。",
      questions: [
        ["短文主要写了一件什么事？", "科学社团通过测量和记录，发现操场积水原因并提出有效建议。", "内容概括"],
        ["小哲一开始的想法有什么问题？", "他只凭感觉认为排水沟太浅，没有证据支持。", "原因分析"],
        ["同学们为什么要测量不同位置的积水深度？", "为了找到真正积水严重的位置，让建议有依据。", "做法推断"],
        ["“一把尺子量出的不只是深浅”这句话有什么含义？", "表面写测量水深，实际说明做事要认真、讲证据。", "句意理解"],
        ["如果你给学校提建议，会从这件事中学到什么？", "示例：提出建议前要调查事实，用数据说明问题。", "拓展表达"],
        ["请给短文拟一个合适题目，并说明理由。", "示例：《雨后的尺子》，因为尺子贯穿调查过程，也象征讲证据。", "标题概括"],
        ["低年级同学的问题在文中有什么作用？", "引出小哲对调查意义的解释，使文章主题更清楚。", "表达作用"],
        ["科学社团后来形成了什么习惯？这个习惯有什么价值？", "每次提出建议前先写观察记录；这样能让建议更有事实依据。", "信息整合"]
      ]
    },
    {
      title: "阅读（一）旧照片里的校门",
      text: "班级准备制作校园变化展板。小雨带来一张十年前的旧照片，照片里的校门低低的，旁边只有一棵小树。现在的校门宽敞明亮，小树也长成了能遮阴的大树。起初，同学们只想把新旧照片贴在一起，可语文老师建议他们采访门卫爷爷，听听照片背后的故事。门卫爷爷说，过去下雨天，校门口常有积水，老师们会撑着伞接低年级学生进校；后来学校修了排水渠，又加宽了人行道。小雨把这些内容写在展板旁边。展出那天，许多同学停下脚步，他们看到的不只是校门的变化，也看到了许多人默默做出的努力。",
      questions: [
        ["同学们准备制作什么内容？", "制作校园变化展板。", "信息提取"],
        ["旧照片和现在的校门有什么不同？", "旧校门低，旁边小树小；现在校门宽敞明亮，小树长大能遮阴。", "对比概括"],
        ["老师为什么建议采访门卫爷爷？", "为了了解照片背后的故事，使展板内容更丰富、有温度。", "原因推断"],
        ["校门口后来做了哪些改善？", "修了排水渠，加宽了人行道。", "信息筛选"],
        ["“看到的不只是校门的变化”还看到了什么？", "看到了老师、学校工作人员等许多人默默付出的努力。", "句意理解"],
        ["你认为展板旁边的文字有什么作用？", "能补充照片无法呈现的故事，让读者理解变化背后的原因。", "表达作用"],
        ["毕业学姐的纸条为什么让同学们有新的感受？", "纸条把个人经历和学校变化联系起来，让大家感到变化真实而有温度。", "原因分析"],
        ["班级后来决定继续收集故事，说明他们对“变化”有了怎样的理解？", "他们明白变化不只是外观不同，还包含人的经历、努力和记忆。", "主题理解"]
      ]
    }
  ], seed)[0];
  const modernCharTarget = kind === "试卷" ? 950 : 700;
  const modernText = ensureLongChinesePassage(modernBank.title, modernBank.text, modernCharTarget);
  const modernQuestionTake = grade >= 5 && kind === "试卷" ? 6 : modernBank.questions.length;
  const readings = modernBank.questions.slice(0, modernQuestionTake).map(([prompt, answer, point], index) => ({
    itemType: "reading",
    sectionTitle: readingSection,
    prompt,
    answer,
    knowledgePoint: point,
    passageGroupId: "chinese-modern-reading",
    passageTitle: modernBank.title,
    passageText: modernText,
    passageQuestionIndex: index + 1,
    showPassage: index === 0,
    answerFormat: "reading-lines",
    answerSpaceMm: 8,
    analysisSteps: ["先阅读全文，抓住事件的起因、经过和结果。", "再回到相关段落找依据。", "组织答案时要写清原因或启示。"]
  }));
  if (grade >= 5 && (kind === "试卷" || /文言文|古文/.test(compactText(input.requirement || input.specialRequirements || "")))) {
    const classicalBank = rotateBySeed([
      {
        title: "阅读（二）王戎识李",
        text: "王戎七岁，尝与诸小儿游。看道边李树多子折枝，诸儿竞走取之，唯戎不动。人问之，答曰：“树在道边而多子，此必苦李。”取之，信然。\n注释：尝，曾经。诸，众多。竞走，争着跑过去。信然，果然如此。阅读时要注意王戎没有直接摘李子，而是先观察“道边”和“多子”这两个现象，再作出判断。",
        questions: [
          ["解释词语：“尝”______；“竞走”______。", "曾经；争着跑过去", "文言词语"],
          ["为什么王戎判断道边李子是苦的？", "因为李树在路边却还有很多果子，说明路人不愿摘，推断李子是苦的。", "推理判断"],
          ["这个故事表现了王戎怎样的特点？", "善于观察，能够根据现象进行推理判断。", "人物形象"],
          ["把“取之，信然”用现代汉语写出来。", "摘来一尝，果然是这样。", "句意翻译"]
        ]
      },
      {
        title: "阅读（二）守株待兔",
        text: "宋人有耕者。田中有株，兔走触株，折颈而死。因释其耒而守株，冀复得兔。兔不可复得，而身为宋国笑。\n注释：耕者，种田的人。株，露出地面的树桩。释，放下。耒，古代耕田用的农具。冀，希望。阅读时要抓住“偶然得到兔子”和“放下农具一直等待”之间的变化，思考农夫错在哪里。",
        questions: [
          ["解释词语：“释”______；“冀”______。", "放下；希望", "文言词语"],
          ["农夫为什么守在树桩旁？", "因为他偶然得到一只撞死的兔子，希望再次得到兔子。", "原因理解"],
          ["这个故事告诉我们什么道理？", "不能把偶然当成必然，做事不能不劳而获。", "寓意概括"],
          ["把“兔不可复得”用现代汉语写出来。", "兔子不可能再得到了。", "句意翻译"]
        ]
      },
      {
        title: "阅读（二）刻舟求剑",
        text: "楚人有涉江者，其剑自舟中坠于水。遽契其舟，曰：“是吾剑之所从坠。”舟止，从其所契者入水求之。\n注释：涉，渡过。遽，立刻。契，刻。求，寻找。阅读时要联系船在移动、剑落在水中这两个事实，理解楚人为什么找不到剑。",
        questions: [
          ["解释词语：“涉”______；“遽”______。", "渡过；立刻", "文言词语"],
          ["楚人为什么在船上刻记号？", "他以为剑从船上掉下去，就能从刻记号的地方找到剑。", "原因理解"],
          ["这个人错在哪里？", "他没有想到船会移动，位置已经变化。", "推理判断"],
          ["这个故事给你什么启示？", "做事要根据实际情况变化，不能死板。", "寓意概括"]
        ]
      }
    ], seed + 91)[0];
    const classicalQuestions = classicalBank.questions.map(([prompt, answer, point], index) => ({
      itemType: "reading",
      sectionTitle: readingSection,
      prompt,
      answer,
      knowledgePoint: point,
      passageGroupId: "chinese-classical-reading",
      passageTitle: classicalBank.title,
      passageText: classicalBank.text,
      passageQuestionIndex: index + 1,
      showPassage: index === 0,
      answerFormat: "reading-lines",
      answerSpaceMm: 8,
      analysisSteps: ["先借助注释理解文意。", "再结合人物行为和语言判断原因。", "答案要写出现象和推理过程。"]
    }));
    readings.push(...classicalQuestions);
  }
  const writingPrompt = rotateBySeed([
    ["请以“这次，我没有只凭感觉”为题写一篇作文。要求围绕一件具体事情，写清楚你怎样发现问题、寻找依据并解决问题；不少于 400 字。", "参考方向：事件具体，过程清楚，能体现从凭感觉到讲依据的变化，语句通顺。"],
    ["请以“藏在细节里的发现”为题写一篇作文。要求写清发现的过程、细节和自己的思考；不少于 400 字。", "参考方向：细节描写具体，能写出从观察到思考的过程。"],
    ["请以“那一次，我学会了认真听建议”为题写一篇作文。要求写清事情经过、人物语言和自己的变化；不少于 400 字。", "参考方向：事件完整，语言和心理描写能体现变化。"]
  ], seed + 109)[0];
  const writing = [{
    itemType: "writing",
    sectionTitle: writingSection,
    prompt: writingPrompt[0],
    answer: writingPrompt[1],
    knowledgePoint: "习作表达",
    answerFormat: "chinese-square-grid",
    answerSpaceMm: 132,
    analysisSteps: ["先确定一件具体事情。", "再写清起因、经过、结果和自己的思考。", "结尾点明题目中的成长或发现。"]
  }];
  return markDynamicFallback([
    fills[0],
    ...shuffleBySeed(fills.slice(1), seed + 7),
    ...shuffleBySeed(uses, seed + 17),
    ...readings,
    ...(kind === "试卷" ? writing : [])
  ], input, "chinese");
}

function normalizeAssessmentDraft(result = {}, input = {}) {
  const parsed = parseJsonObjectText(result.draftText) || {};
  const sectionItems = Array.isArray(parsed.sections)
    ? parsed.sections.flatMap((section) => {
        const items = Array.isArray(section?.items) ? section.items : Array.isArray(section?.questions) ? section.questions : [];
        return items.map((item) => ({
          ...(typeof item === "string" ? { prompt: item } : item),
          itemType: item?.itemType || item?.type || section?.type,
          sectionTitle: item?.sectionTitle || section?.title
        }));
      })
    : [];
  const rawItems = Array.isArray(input.items) && input.items.length
    ? input.items
    : Array.isArray(parsed.items) && parsed.items.length
      ? parsed.items
      : sectionItems;
  const items = rawItems.map(normalizeAssessmentItem).filter((item) => item.prompt);
  const usedModelEscalation = result.modelRun?.metadata?.usedModelEscalation === true;
  const usedDynamicFallback = !result.available || !items.length || result.modelRun?.metadata?.partialGeneration === true;
  const review = reviewAndRepairAssessmentItems(items.length ? items : buildFallbackAssessmentItems(input), input);
  const safeItems = review.items;
  const printNotes = [
    ...(Array.isArray(parsed.printNotes) ? parsed.printNotes : Array.isArray(parsed.notes) ? parsed.notes : []),
    ...review.notes,
    ...(usedDynamicFallback ? ["模型超时、部分分区不可用或返回内容未形成完整标准题目结构，系统已按动态兜底题池和 A4 排版规则修复草稿，教师需复核后使用。"] : [])
  ];
  const audit = auditAssessmentDraft(safeItems, input, printNotes);
  if (usedDynamicFallback) {
    const fallbackIssue = "模型输出不完整，草稿包含动态修复内容，必须由教师复核。";
    audit.status = "needs_teacher_review";
    audit.passed = false;
    audit.issues = [...new Set([...(audit.issues || []), fallbackIssue])];
    audit.teacherMessage = "草稿包含动态修复内容，请教师检查题目、答案和解析后再使用。";
  }
  audit.fallbackMode = usedDynamicFallback ? "dynamic-repair" : "provider-reviewed";
  audit.providerStatus = result.modelRun?.status || (result.available ? "SUCCESS" : "ERROR");
  return {
    parsed,
    title: buildAssessmentTitle(input, parsed),
    items: safeItems,
    answerKey: parsed.answerKey || parsed.answers || null,
    totalScore: review.totalScore,
    usedModelEscalation,
    usedDynamicFallback,
    printNotes,
    audit,
    sections: parsed.sections || [],
    layout: parsed.layout || null
  };
}

function buildAssessmentGenerationPipeline({ result = {}, draft = {}, input = {}, printProfile = null, layoutTemplate = null, modelRun = null, modelReviews = {}, modelReviewRequired = false }) {
  const audit = draft.audit || {};
  const attempts = Array.isArray(result.modelRun?.metadata?.attempts) ? result.modelRun.metadata.attempts : [];
  const draftReady = Boolean(draft.items?.length);
  const auditPassed = audit.status === "passed";
  const reviewEntries = Object.values(modelReviews).filter(Boolean);
  const modelReviewPassed = reviewEntries.length
    ? reviewEntries.every((review) => review.exportReady === true)
    : false;
  const modelReviewIssues = reviewEntries.flatMap((review) => review.issues || []);
  const modelReviewStatus = modelReviewRequired
    ? modelReviewPassed ? "passed" : "needs_teacher_review"
    : "skipped";
  const modelStatus = result.modelRun?.status || (result.available ? "SUCCESS" : "ERROR");
  const modelAvailable = Boolean(result.available);
  const usedModelEscalation = result.modelRun?.metadata?.usedModelEscalation === true;
  const usedDynamicFallback = Boolean(draft.usedDynamicFallback);
  return {
    version: "assessment-generation-pipeline-v1",
    stage: draftReady ? "draft_ready" : "draft_blocked",
    requestId: input.requestId || null,
    target: {
      subject: input.subject || null,
      grade: input.grade || input.targetGrade || null,
      kind: input.kind || null,
      difficulty: input.difficulty || null,
      scope: input.targetScope || null,
      studentId: input.studentId || null
    },
    model: {
      providerId: result.providerId || null,
      model: result.modelRun?.model || null,
      modelRunId: modelRun?.id || null,
      status: modelStatus,
      available: modelAvailable,
      generationProfile: input.generationProfile || result.modelRun?.metadata?.generationProfile || null,
      assessmentTotalTimeoutMs: input.assessmentTotalTimeoutMs || result.modelRun?.metadata?.assessmentTotalTimeoutMs || null,
      assessmentMaxTokens: input.assessmentMaxTokens || result.modelRun?.metadata?.assessmentMaxTokens || null,
      primaryModel: result.modelRun?.metadata?.primaryModel || null,
      escalationModel: result.modelRun?.metadata?.escalationModel || null,
      escalationTriggered: result.modelRun?.metadata?.escalationTriggered === true,
      usedModelEscalation,
      escalationScopes: Array.isArray(result.modelRun?.metadata?.escalationScopes) ? result.modelRun.metadata.escalationScopes : [],
      fallbackProvider: result.modelRun?.metadata?.fallbackProvider || null,
      primaryError: result.modelRun?.metadata?.primaryError || null,
      secondaryError: result.modelRun?.metadata?.secondaryError || null,
      attempts
    },
    repair: {
      required: true,
      usedDynamicFallback,
      itemCount: audit.itemCount || draft.items?.length || 0,
      totalScore: draft.totalScore || null,
      repairNotes: audit.repairNotes || draft.printNotes || []
    },
    audit: {
      reviewer: audit.reviewer || "Codex主脑审查",
      status: audit.status || "needs_teacher_review",
      passed: auditPassed,
      checkedAt: audit.checkedAt || null,
      issues: audit.issues || [],
      teacherMessage: audit.teacherMessage || ""
    },
    modelReview: {
      required: modelReviewRequired,
      status: modelReviewStatus,
      passed: modelReviewRequired ? modelReviewPassed : null,
      issues: modelReviewIssues,
      reviews: modelReviews
    },
    gates: {
      draftPdfRequired: true,
      draftPdfExported: false,
      modelReviewRequired,
      modelReviewPassed: modelReviewRequired ? modelReviewPassed : null,
      teacherReviewRequired: true,
      teacherReviewStatus: "not_exported",
      finalExportAllowed: false,
      finalExported: false,
      answerAnalysisRequired: true
    },
    print: {
      paper: "A4",
      layoutTemplate,
      printProfile,
      requiredAssets: ["student-paper", "answer-analysis"]
    },
    summary: draftReady
      ? modelAvailable
        ? "模型已生成结构化草稿，服务层已完成修复与主脑审查，等待导出 PDF 草稿给教师确认。"
        : "模型未成功返回结构化草稿，服务层已生成动态兜底草稿，必须经教师 PDF 草稿复核。"
      : "未形成可用生成草稿，需要重新生成。"
  };
}

function shouldRunAssessmentModelReview(config = {}, input = {}, options = {}) {
  if (options.runModelReview != null) return options.runModelReview === true;
  if (input.runModelReview != null) return input.runModelReview === true;
  const configured = config.ASSESSMENT_DRAFT_MODEL_REVIEW_ENABLED ?? config.assessmentDraftModelReviewEnabled;
  return String(configured || "false").toLowerCase() === "true";
}

export async function answerStudentQuestionService(config, input = {}, options = {}) {
  const result = await answerStudentQuestion(config, input);
  const modelRun = await persistRun(result.modelRun, options);

  const qaSession =
    options.persist === false
      ? null
      : await recordQaSession(
          {
            studentId: input.studentId || null,
            modelRunId: modelRun?.id || null,
            subject: input.subject || null,
            question: input.question,
            answer: result.answer,
            metadata: {
              mode: result.mode,
              providerId: result.providerId,
              available: result.available
            }
          },
          options
        );

  const voiceInteraction =
    input.deviceId && options.persist !== false
      ? await recordVoiceInteraction(
          {
            deviceId: input.deviceId,
            studentId: input.studentId || null,
            modelRunId: modelRun?.id || null,
            mode: result.mode,
            transcript: input.question,
            answerSummary: result.answer,
            metadata: {
              qaSessionId: qaSession?.id || null,
              providerId: result.providerId,
              available: result.available
            }
          },
          options
        )
      : null;

  return {
    ...result,
    persisted: {
      modelRunId: modelRun?.id || null,
      qaSessionId: qaSession?.id || null,
      voiceInteractionId: voiceInteraction?.id || null
    }
  };
}

export async function generateVocabularyCardService(config, input = {}, options = {}) {
  const result = await generateVocabularyCard(config, input);
  const modelRun = await persistRun(result.modelRun, options);
  const vocabularyRecord =
    options.persist === false || !input.studentId
      ? null
      : await recordVocabularyRecord(
          {
            studentId: input.studentId,
            term: result.card?.word || input.word,
            content: {
              card: result.card,
              available: result.available,
              modelRunId: modelRun?.id || null
            }
          },
          options
        );
  return {
    ...result,
    persisted: {
      modelRunId: modelRun?.id || null,
      vocabularyRecordId: vocabularyRecord?.id || null
    }
  };
}

export async function draftTeacherTaskService(config, input = {}, options = {}) {
  const result = await draftTeacherTask(config, input);
  const modelRun = await persistRun(result.modelRun, options);

  const task =
    options.persist === false || input.createTask === false
      ? null
      : await createLearningTask(
          {
            id: input.id || undefined,
            studentId: input.studentId || null,
            teacherId: input.teacherId || null,
            subjectId: input.subjectId || null,
            subject: input.subject || null,
            title: input.title || input.requirement || "今日任务",
            description: result.draftText || input.requirement || null,
            status: "ASSIGNED",
            dueAt: input.dueAt || null,
            metadata: {
              source: "ai-draft",
              providerId: result.providerId,
              modelRunId: modelRun?.id || null,
              draftText: result.draftText || null,
              minutes: input.minutes || null,
              knowledgePoints: input.knowledgePoints || []
            }
          },
          options
        );

  return {
    ...result,
    persisted: {
      modelRunId: modelRun?.id || null,
      learningTaskId: task?.id || null
    }
  };
}

export async function draftAssessmentService(config, input = {}, options = {}) {
  const contentContext = input.contentContext || matchContentContext(input);
  const generationBudget = resolveAssessmentGenerationBudget(input, config);
  const generationContext = {
    ...(input.generationContext && typeof input.generationContext === "object" ? input.generationContext : {}),
    request: {
      requirement: input.requirement || input.specialRequirements || "",
      kind: input.kind || null,
      difficulty: input.difficulty || null
    },
    target: {
      subject: input.subject || null,
      grade: input.grade || input.targetGrade || null,
      scope: input.targetScope || null,
      studentId: input.studentId || null
    },
    teaching: {
      textbookAssetId: input.textbookAssetId || null,
      textbookTitle: input.textbookTitle || null,
      textbookChapterId: input.textbookChapterId || null,
      textbookChapterTitle: input.textbookChapterTitle || null,
      knowledgePoints: input.knowledgePoints || [],
      contentContext
    },
    output: {
      paper: "A4",
      kind: input.kind || null,
      generationProfile: generationBudget.profile,
      assessmentTotalTimeoutMs: generationBudget.assessmentTotalTimeoutMs,
      assessmentMaxTokens: generationBudget.assessmentMaxTokens,
      teacherReviewRequired: true,
      includeAnswerAnalysis: true
    },
    rules: {
      repairRequired: true,
      hideProviderFromStudentAndParent: true,
      noDefaultBonusQuestions: true
    }
  };
  const modelInput = {
    ...input,
    requestId: input.requestId || randomUUID(),
    generationProfile: generationBudget.profile,
    assessmentTotalTimeoutMs: generationBudget.assessmentTotalTimeoutMs,
    assessmentMaxTokens: generationBudget.assessmentMaxTokens,
    generationBudget,
    generationContext,
    contentContext
  };
  if (input.generationTimeoutMs != null) {
    modelInput.generationTimeoutMs = input.generationTimeoutMs;
  }
  if (input.generationMaxTokens != null) {
    modelInput.generationMaxTokens = input.generationMaxTokens;
  }
  const assessmentDraftRunner = options.assessmentDraftRunner || draftAssessment;
  const result = await assessmentDraftRunner(config, modelInput);
  const modelRun = await persistRun(result.modelRun, options);
  const printProfile = input.printProfile || buildPrintProfile(modelInput);
  const layoutTemplate = input.layoutTemplate || buildLayoutTemplate(modelInput);
  const draft = normalizeAssessmentDraft(result, modelInput);
  const modelReviewRequired = shouldRunAssessmentModelReview(config, input, options);
  const reviewPayload = {
    reviewTask: "assessment-draft-quality-audit",
    title: draft.title,
    subject: modelInput.subject || "",
    kind: modelInput.kind || "",
    grade: modelInput.grade || modelInput.targetGrade || "",
    difficulty: modelInput.difficulty || "",
    requirement: modelInput.requirement || modelInput.specialRequirements || "",
    totalScore: draft.totalScore,
    printProfile,
    layoutTemplate,
    localAudit: draft.audit,
    usedDynamicFallback: draft.usedDynamicFallback,
    sections: draft.sections || [],
    items: (draft.items || []).slice(0, 80).map((item, index) => ({
      questionNo: index + 1,
      itemType: item.itemType,
      prompt: item.prompt,
      answer: item.answer,
      rubric: item.rubric,
      metadata: {
        sectionTitle: item.metadata?.sectionTitle || null,
        score: item.metadata?.score ?? null,
        answerSpaceMm: item.metadata?.answerSpaceMm ?? null,
        answerFormat: item.metadata?.answerFormat || null,
        hasFigure: Boolean(item.metadata?.figure),
        hasPassage: Boolean(item.metadata?.passageText),
        analysisSteps: item.metadata?.analysisSteps || [],
        knowledgePoint: item.metadata?.knowledgePoint || null,
        commonMistake: item.metadata?.commonMistake || null
      }
    }))
  };
  const modelReviews = {};
  const reviewModelRunIds = {};
  if (modelReviewRequired) {
    const reviewers = options.assessmentModelReviewers || {};
    const legacyDoubleReview = typeof reviewers.minimax === "function" && typeof reviewers.premium === "function";
    const premiumReviewer = reviewers.premium || reviewWithGpt55;
    if (legacyDoubleReview) {
      const miniMaxDraftReview = await reviewers.minimax(config, reviewPayload);
      const miniMaxDraftReviewRun = await persistRun(miniMaxDraftReview.modelRun, options);
      const gptDraftReview = await premiumReviewer(config, {
        ...reviewPayload,
        secondModelAudit: parseAssessmentQualityReview(miniMaxDraftReview, "MiniMax M3 生成审查")
      });
      const gptDraftReviewRun = await persistRun(gptDraftReview.modelRun, options);
      modelReviews.minimax = compactAssessmentQualityReview(miniMaxDraftReview, "MiniMax M3 生成审查", miniMaxDraftReviewRun?.id || null);
      modelReviews.premium = compactAssessmentQualityReview(gptDraftReview, "GPT-5.6 生成高级审查", gptDraftReviewRun?.id || null);
      reviewModelRunIds.minimax = miniMaxDraftReviewRun?.id || null;
      reviewModelRunIds.premium = gptDraftReviewRun?.id || null;
    } else {
      const gptDraftReview = await premiumReviewer(config, reviewPayload);
      const gptDraftReviewRun = await persistRun(gptDraftReview.modelRun, options);
      modelReviews.premium = compactAssessmentQualityReview(gptDraftReview, "GPT-5.6 生成风险审查", gptDraftReviewRun?.id || null);
      reviewModelRunIds.premium = gptDraftReviewRun?.id || null;
    }
  }
  const generationPipeline = buildAssessmentGenerationPipeline({
    result,
    draft,
    input: modelInput,
    printProfile,
    layoutTemplate,
    modelRun,
    modelReviews,
    modelReviewRequired
  });
  const assignment =
    options.persist === false || input.createAssignment === false
      ? null
      : await createAssignmentDraft(
          {
            id: input.id || undefined,
            subjectId: input.subjectId || null,
            subject: input.subject || null,
            title: draft.title,
            grade: input.grade || input.targetGrade || null,
            difficulty: input.difficulty || null,
            items: draft.items,
            metadata: {
              kind: input.kind || null,
              targetScope: input.targetScope || null,
              targetStudentId: input.studentId || null,
              targetGrade: input.targetGrade || input.grade || null,
              teacherId: input.teacherId || null,
              layoutTemplate,
              printProfile,
              specialRequirements: input.requirement || input.specialRequirements || null,
              draftText: result.draftText || null,
              parsedDraft: draft.parsed,
              answerKey: draft.answerKey,
              totalScore: draft.totalScore,
              usedDynamicFallback: draft.usedDynamicFallback,
              printNotes: draft.printNotes,
              audit: draft.audit,
              modelReviews,
              generationPipeline,
              sections: draft.sections,
              layout: draft.layout,
              difficulty: input.difficulty || null,
              textbookAssetId: input.textbookAssetId || null,
              textbookTitle: input.textbookTitle || null,
              textbookChapterId: input.textbookChapterId || null,
              textbookChapterTitle: input.textbookChapterTitle || null,
              generationContext,
              contentContext,
              providerId: result.providerId,
              modelRunId: modelRun?.id || null,
              reviewModelRunIds
            }
          },
          options
        );
  return {
    ...result,
    available: Boolean(result.available || draft.items?.length),
    modelAvailable: Boolean(result.available),
    draftAvailable: Boolean(draft.items?.length),
    parsedDraft: draft.parsed,
    draftItems: draft.items,
    audit: draft.audit,
    totalScore: draft.totalScore,
    usedModelEscalation: draft.usedModelEscalation,
    usedDynamicFallback: draft.usedDynamicFallback,
    layoutTemplate,
    printProfile,
    modelReviews,
    generationPipeline,
    generationContext,
    contentContext,
    persisted: {
      modelRunId: modelRun?.id || null,
      draftReviewModelRunIds: reviewModelRunIds,
      assignmentId: assignment?.id || null
    }
  };
}

export async function gradeSubmissionService(config, input = {}, options = {}) {
  const baseOcr = buildSubmissionOcr(input);
  const reference = await prepareSubmissionReferenceAnswers(config, input, baseOcr, options);
  const ocr = enrichSubmissionOcr(input, baseOcr, reference.referenceAnswers || []);
  const questionLayoutManifest = buildSubmissionQuestionLayoutManifest(input, ocr, reference.referenceAnswers || []);
  const deepAuditRequired = shouldRunDeepGradingAudit(config, input, options);
  const gradingInput = {
    ...input,
    ocrText: input.ocrText || ocr.text || "",
    studentAnswerText: input.studentAnswerText || ocr.studentAnswerText || "",
    printedText: input.printedText || ocr.printedText || "",
    ocrQuestions: Array.isArray(input.ocrQuestions) ? input.ocrQuestions : ocr.questions || [],
    questionLayoutManifest,
    answerKey: input.answerKey || reference.answerKey || null,
    referenceAnswers: reference.referenceAnswers || [],
    referenceAnswerMode: reference.mode,
    referenceAnswerSummary: reference.summary,
    referenceAnswerConfidence: reference.confidence,
    gradingPolicy: {
      answerKeyFirst: true,
      generateReferenceBeforeGrading: true,
      lowConfidenceNoFinalScore: true,
      teacherConfirmBeforeArchive: true,
      deepModelAuditRequired: deepAuditRequired,
      secondModelAuditRequired: deepAuditRequired && String(config.GRADING_REQUIRE_SECOND_MODEL_AUDIT ?? "true").toLowerCase() !== "false"
    }
  };
  const deterministicPlan = buildDeterministicGradingPlan(gradingInput, ocr, reference.referenceAnswers || []);
  const gradingRunner = options.gradingRunner || gradeSubmissionText;
  const remoteGradingInput = buildUnresolvedGradingInput(gradingInput, deterministicPlan);
  const remoteResult = deterministicPlan.fullyResolved
    ? {
        available: true,
        providerId: "local",
        gradingText: JSON.stringify({
          score: inferScoreFromQuestionResults(deterministicPlan.deterministicResults, gradingInput),
          summary: "明确答案题已完成本地保守比对，等待教师复核。",
          strengths: [],
          mistakes: [],
          nextPractice: "教师确认后再生成针对性练习。",
          needsTeacherReview: true,
          questionResults: deterministicPlan.deterministicResults
        }),
        modelRun: null
      }
    : await gradingRunner(config, remoteGradingInput);
  const result = mergeDeterministicGradingResult(remoteResult, deterministicPlan.deterministicResults, gradingInput);
  const primaryModelRun = await persistRun(result.modelRun, options);
  let effectiveResult = result;
  let effectiveModelRun = primaryModelRun;
  let escalationModelRun = result.modelRun?.metadata?.usedModelEscalation === true ? primaryModelRun : null;
  let initialStructured = normalizeGradingResult(result, gradingInput, ocr);
  let auditModelRun = null;
  let premiumAuditModelRun = null;
  let combinedAudit = skippedGradingAudit();
  const reviewers = options.gradingReviewers || {};
  const runtime = normalizeRuntimeConfig(config);
  const solEnabled = solEscalationEnabled(runtime);
  const selectedSolQuestionNos = solEnabled
    ? selectSolGradingQuestionNos(initialStructured, gradingInput, ocr, reference)
    : [];
  let actualSolAttempt = result.modelRun?.metadata?.solAttempted === true || result.modelRun?.metadata?.usedModelEscalation === true;
  if (!actualSolAttempt && selectedSolQuestionNos.length) {
    actualSolAttempt = true;
    const solGradingRunner = options.solGradingRunner || gradeSubmissionText;
    const solResult = await solGradingRunner(
      config,
      buildSolGradingInput(gradingInput, selectedSolQuestionNos),
      {
        model: runtime.gpt56SolModel,
        timeoutMs: runtime.gpt56SolFallbackTimeoutMs,
        reasoningEffort: "high",
        role: "sol-grading-escalation",
        disableSolEscalation: true
      }
    );
    const solModelRun = await persistRun(solResult.modelRun, options);
    escalationModelRun = solModelRun;
    if (solResult.available) {
      const mergedSolResult = mergeSolGradingResult(initialStructured, solResult, gradingInput, selectedSolQuestionNos);
      effectiveResult = mergedSolResult;
      effectiveModelRun = solModelRun;
      initialStructured = normalizeGradingResult(mergedSolResult, gradingInput, ocr);
    }
  }
  const riskReviewRequired = shouldRunGradingRiskReview(initialStructured);
  const legacyDoubleReview = !actualSolAttempt && deepAuditRequired && typeof reviewers.minimax === "function" && typeof reviewers.premium === "function";
  if (legacyDoubleReview) {
    const miniMaxReviewer = reviewers.minimax;
    const premiumReviewer = reviewers.premium;
    const auditResult = await miniMaxReviewer(config, {
      reviewTask: "submission-grading-audit",
      title: input.title || "",
      subject: input.subject || "",
      kind: input.kind || "",
      referenceAnswerMode: reference.mode,
      referenceAnswerConfidence: reference.confidence,
      referenceAnswers: reference.referenceAnswers || [],
      questionLayoutManifest: summarizeQuestionLayoutManifestForAudit(questionLayoutManifest),
      ocr: {
        status: ocr.status,
        confidence: ocr.confidence,
        textPreview: String(ocr.text || "").slice(0, 1200),
        studentAnswerTextPreview: String(ocr.studentAnswerText || "").slice(0, 1200),
        printedTextPreview: String(ocr.printedText || "").slice(0, 1200),
        questions: (ocr.questions || []).slice(0, 80)
      },
      grading: {
        score: initialStructured.score ?? initialStructured.provisionalScore,
        summary: initialStructured.summary,
        questionResults: initialStructured.questionResults
      }
    });
    auditModelRun = await persistRun(auditResult.modelRun, options);
    const premiumAuditResult = await premiumReviewer(config, {
      reviewTask: "submission-premium-grading-review",
      title: input.title || "",
      subject: input.subject || "",
      kind: input.kind || "",
      referenceAnswerMode: reference.mode,
      referenceAnswerConfidence: reference.confidence,
      referenceAnswers: reference.referenceAnswers || [],
      questionLayoutManifest: summarizeQuestionLayoutManifestForAudit(questionLayoutManifest),
      ocr: {
        status: ocr.status,
        confidence: ocr.confidence,
        engine: ocr.engine,
        reason: ocr.reason,
        textPreview: String(ocr.text || "").slice(0, 1800),
        studentAnswerTextPreview: String(ocr.studentAnswerText || "").slice(0, 1800),
        printedTextPreview: String(ocr.printedText || "").slice(0, 1800),
        questions: (ocr.questions || []).slice(0, 80)
      },
      grading: {
        score: initialStructured.score ?? initialStructured.provisionalScore,
        summary: initialStructured.summary,
        questionResults: initialStructured.questionResults,
        annotationMarkers: initialStructured.annotationMarkers,
        quality: initialStructured.quality
      },
      secondModelAudit: parseGradingAuditResult(auditResult)
    });
    premiumAuditModelRun = await persistRun(premiumAuditResult.modelRun, options);
    combinedAudit = mergeGradingAudits([
      { role: "second-model", label: "MiniMax二次审计", result: auditResult },
      { role: "premium", label: "GPT-5.6高级审查", result: premiumAuditResult }
    ], config);
    combinedAudit.required = true;
  } else if (!actualSolAttempt && (deepAuditRequired || riskReviewRequired)) {
    const premiumReviewer = reviewers.premium || reviewWithGpt55;
    const premiumAuditResult = await premiumReviewer(config, {
      reviewTask: "submission-premium-grading-review",
      title: input.title || "",
      subject: input.subject || "",
      kind: input.kind || "",
      referenceAnswerMode: reference.mode,
      referenceAnswerConfidence: reference.confidence,
      referenceAnswers: reference.referenceAnswers || [],
      questionLayoutManifest: summarizeQuestionLayoutManifestForAudit(questionLayoutManifest),
      ocr: {
        status: ocr.status,
        confidence: ocr.confidence,
        engine: ocr.engine,
        reason: ocr.reason,
        textPreview: String(ocr.text || "").slice(0, 1800),
        studentAnswerTextPreview: String(ocr.studentAnswerText || "").slice(0, 1800),
        printedTextPreview: String(ocr.printedText || "").slice(0, 1800),
        questions: (ocr.questions || []).slice(0, 80)
      },
      grading: {
        score: initialStructured.score ?? initialStructured.provisionalScore,
        summary: initialStructured.summary,
        questionResults: initialStructured.questionResults,
        annotationMarkers: initialStructured.annotationMarkers,
        quality: initialStructured.quality
      }
    });
    premiumAuditModelRun = await persistRun(premiumAuditResult.modelRun, options);
    combinedAudit = mergeGradingAudits([
      { role: "premium", label: "GPT-5.6风险审查", result: premiumAuditResult }
    ], {
      ...config,
      GRADING_REQUIRE_SECOND_MODEL_AUDIT: "false",
      GRADING_REQUIRE_PREMIUM_JUDGE: "true"
    });
    combinedAudit.required = true;
  }
  if (actualSolAttempt && riskReviewRequired) {
    combinedAudit = blockingSolGradingAudit();
  }
  const structured = applyGradingAudit({
    ...initialStructured,
    referenceAnswer: reference,
    questionLayoutManifest
  }, combinedAudit, config);
  const assignment =
    options.persist === false
      ? null
      : input.assignmentId
        ? { id: input.assignmentId }
        : await createAssignmentDraft(
            {
              subject: input.subject || null,
              title: input.title || "图片提交批改记录",
              grade: input.grade || null,
              difficulty: input.difficulty || null,
              metadata: {
                kind: input.kind || "图片批改",
                source: "photo-upload",
                uploadedBy: input.uploadedBy || "teacher",
                imageNames: input.imageNames || []
              }
            },
            options
          );

  const submission =
    options.persist === false || !assignment?.id || !input.studentId
      ? null
      : await recordSubmissionGrading(
          {
            assignmentId: assignment.id,
            studentId: input.studentId,
            subject: input.subject,
            modelRunId: effectiveModelRun?.id || primaryModelRun?.id || null,
            content: {
              ocrText: input.ocrText || null,
              studentAnswerText: input.studentAnswerText || null,
              printedText: input.printedText || null,
              ocrQuestions: ocr.questions || [],
              questionLayoutManifest,
              ocrStatus: ocr.status,
              ocr,
              imageNames: input.imageNames || [],
              imageFiles: input.uploadedFiles || [],
              uploadedBy: input.uploadedBy || "teacher",
              uploadBatchId: input.batchId || null,
              imageIndex: input.imageIndex ? Number(input.imageIndex) : null,
              imageTotal: input.imageTotal ? Number(input.imageTotal) : null,
              pageNumber: ocr.pageNumber,
              questionRange: ocr.questionRange,
              manualText: ocr.manualText
            },
            result: {
              ...structured,
              rawText: effectiveResult.gradingText,
              providerId: effectiveResult.providerId,
              available: effectiveResult.available,
              referenceAnswer: reference,
              questionLayoutManifest,
              gradingAuditModelRunId: auditModelRun?.id || null,
              premiumAuditModelRunId: premiumAuditModelRun?.id || null
            },
            score: structured.score,
            needsReview: true,
            mistakes: []
          },
          options
        );

  return {
    ...effectiveResult,
    referenceAnswer: reference,
    gradingAudit: structured.gradingAudit,
    structured,
    persisted: {
      modelRunId: effectiveModelRun?.id || primaryModelRun?.id || null,
      primaryModelRunId: primaryModelRun?.id || null,
      escalationModelRunId: escalationModelRun?.id || null,
      referenceModelRunId: reference.modelRunId || null,
      gradingAuditModelRunId: auditModelRun?.id || null,
      premiumAuditModelRunId: premiumAuditModelRun?.id || null,
      submissionId: submission?.id || null,
      gradingResultId: submission?.grading?.id || null
    }
  };
}

export async function dictationSpeechService(config, input = {}, options = {}) {
  const plan = buildDictationSpeechPlan(input);
  if (!input.synthesize) {
    return {
      available: true,
      providerId: "minimax",
      plan,
      speechTasks: [],
      persisted: {}
    };
  }

  const speechTasks = [];
  for (const item of plan.items) {
    const speech = await createMiniMaxSpeechTask(config, {
      text: item.voiceText,
      speed: input.speed || 1,
      voiceId: input.voiceId
    });
    const modelRun = await persistRun(speech.modelRun, options);
    speechTasks.push({
      orderIndex: item.orderIndex,
      text: item.text,
      available: speech.available,
      task: speech.task,
      error: speech.error,
      modelRunId: modelRun?.id || null
    });
  }

  return {
    available: speechTasks.every((task) => task.available),
    providerId: "minimax",
    plan,
    speechTasks
  };
}
