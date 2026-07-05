const SUBJECTS = ["语文", "数学", "英语"];
const TERM_REPORT_TEMPLATES = {
  midterm: {
    id: "term-midterm-growth-report",
    reportTitle: "期中阶段综合档案",
    focusLabel: "接下来两到四周优先处理",
    overviewFocus: "阶段掌握、共性错因和后续两到四周辅导重点",
    tutoringPrefix: "接下来两到四周"
  },
  final: {
    id: "term-final-growth-report",
    reportTitle: "学期综合成长总结",
    focusLabel: "假期或下阶段可以这样配合",
    overviewFocus: "学期成长、稳定强项和假期或下阶段安排",
    tutoringPrefix: "假期或下阶段"
  }
};

export function normalizeTermReportType(value) {
  return value === "midterm" ? "midterm" : "final";
}

export function termReportTypeToDb(value) {
  return normalizeTermReportType(value) === "midterm" ? "MIDTERM" : "FINAL";
}

export function dbTermReportTypeToClient(value) {
  return value === "MIDTERM" ? "midterm" : "final";
}

export function termReportTypeLabel(value) {
  return normalizeTermReportType(value) === "midterm" ? "期中成长报告" : "期末成长报告";
}

export function buildTermReportDraft(student, options = {}) {
  const reportType = normalizeTermReportType(options.reportType);
  const template = TERM_REPORT_TEMPLATES[reportType];
  const now = options.now instanceof Date ? options.now : new Date();
  const periodLabel = String(options.periodLabel || defaultPeriodLabel(reportType, now)).trim();
  const subjects = SUBJECTS.map((subject) => subjectSection(student, subject));
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  const title = `${student.displayName} ${periodLabel}${termReportTypeLabel(reportType)}`;
  const habits = learningHabits(student);
  const progress = progressList(student);
  const actions = nextActions(subjects);
  const suggestions = parentSuggestions(subjects);
  const focusSubjects = focusSubjectDetails(subjects);
  const stableGrowth = stableGrowthDetails(habits, progress);
  const parentNextSteps = suggestions.map((text) => ({ text }));
  const sections = {
    overview: {
      text: `${student.displayName}${periodLabel}学习记录已完成汇总，本报告重点呈现${template.overviewFocus}，建议优先关注${focus.subject}的持续巩固和订正闭环。`
    },
    subjects,
    subjectOverview: subjects,
    focusSubjects,
    stableGrowth,
    correctionLoop: correctionLoop(student),
    learningHabits: habits,
    progress,
    nextActions: actions,
    parentSuggestions: suggestions,
    tutoringFocus: [
      `${template.tutoringPrefix}优先安排：${actions[0] || "继续保持错题订正和基础巩固。"}`,
      `${template.focusLabel}：每周复盘一次错题订正，确认是否能独立复述解题思路。`
    ],
    parentNextSteps,
    parentNextStep: parentNextSteps
  };

  return {
    reportType,
    template,
    status: "draft",
    visibility: "teacher_pdf_only",
    periodLabel,
    title,
    generatedAt: now.toISOString(),
    sections,
    wechatMessage: `您好，这是${student.displayName}同学${periodLabel}${termReportTypeLabel(reportType)}，请查收。`
  };
}

export function mapTermReportForRole(report, role = "student") {
  const metadata = safeObject(report.metadata);
  const termReport = safeObject(metadata.termReport);
  if (!termReport.reportType) return null;

  const sent = termReport.status === "sent_manually";
  const base = {
    id: report.id,
    studentId: report.studentId || "",
    studentName: report.student?.displayName || "",
    period: termReport.reportType === "midterm" ? "期中" : "期末",
    reportType: termReport.reportType,
    periodLabel: termReport.periodLabel || report.periodKey,
    title: report.title,
    summary: sent ? "老师已发送阶段报告给家长" : report.content,
    status: sent ? "已发送" : termReport.status === "pdf_ready" ? "PDF已生成" : "草稿",
    sentManuallyAt: termReport.sentManuallyAt || null,
    highlights: [],
    concerns: [],
    nextActions: []
  };

  if (role !== "teacher") return sent ? base : null;
  return {
    ...base,
    summary: report.content,
    teacherEditedText: termReport.teacherEditedText || report.content,
    pdfUrl: termReport.pdfUrl || null,
    pdfTitle: termReport.pdfTitle || null,
    pdfAssetId: termReport.pdfAssetId || null,
    wechatMessage: termReport.wechatMessage || "",
    statusRaw: termReport.status || "draft",
    draft: termReport.draft || termReport
  };
}

export function renderTermReportHtml(student, report) {
  const metadata = safeObject(report.metadata);
  const termReport = safeObject(metadata.termReport);
  const draft = safeObject(termReport.draft || termReport);
  const sections = safeObject(draft.sections);
  const subjects = Array.isArray(sections.subjectOverview) ? sections.subjectOverview : Array.isArray(sections.subjects) ? sections.subjects : [];
  const focusSubjects = Array.isArray(sections.focusSubjects) ? sections.focusSubjects : subjects.filter((item) => item.concerns?.length);
  const stableGrowth = Array.isArray(sections.stableGrowth) ? sections.stableGrowth : [...(sections.learningHabits || []), ...(sections.progress || [])];
  const tutoringFocus = Array.isArray(sections.tutoringFocus) ? sections.tutoringFocus : sections.nextActions;
  const parentNextStep = Array.isArray(sections.parentNextSteps) ? sections.parentNextSteps : Array.isArray(sections.parentNextStep) ? sections.parentNextStep : sections.parentSuggestions;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title)}</title>
<style>
@page { size: A4; margin: 16mm 15mm; }
body { margin: 0; color: #1f2a36; font-family: "SimSun", "Microsoft YaHei", Arial, sans-serif; font-size: 10.5pt; line-height: 1.58; }
.cover { min-height: 210mm; display: grid; align-content: center; gap: 16px; border-bottom: 4px solid #226b8f; }
.badge { color: #226b8f; font-weight: 700; letter-spacing: 0; }
h1 { margin: 0; font-size: 24pt; font-family: "SimHei", "Microsoft YaHei", sans-serif; }
h2 { margin: 14px 0 6px; font-size: 15pt; color: #164b65; border-bottom: 1px solid #c8d8e3; padding-bottom: 4px; }
h3 { margin: 8px 0 4px; font-size: 12pt; color: #1f2a36; }
.meta { display: grid; gap: 5px; color: #526575; }
.section { break-inside: avoid; margin: 0 0 8px; }
.card { border: 1px solid #d8e2ea; border-radius: 6px; padding: 10px 12px; margin: 7px 0; background: #fbfdff; }
ul { margin: 5px 0 0 18px; padding: 0; }
li { margin: 2px 0; }
.foot { margin-top: 12px; color: #6b7a86; font-size: 9pt; }
</style>
</head>
<body>
<section class="cover">
  <div class="badge">君航 AI 助教 · 教师确认版</div>
  <h1>${escapeHtml(report.title)}</h1>
  <div class="meta">
    <span>报告类型：${escapeHtml(termReportTypeLabel(termReport.reportType))}</span>
    <span>学生：${escapeHtml(student.displayName || "")}</span>
    <span>年级：${escapeHtml(student.grade || "")}</span>
    <span>班级：${escapeHtml(student.className || "")}</span>
    <span>周期：${escapeHtml(termReport.periodLabel || report.periodKey || "")}</span>
  </div>
</section>
<section>
  <h2>一、综合成长摘要</h2>
  <div class="card">${paragraphs(termReport.teacherEditedText || report.content || sections.overview?.text)}</div>
  <h2>二、三科总览</h2>
  ${subjects.map((item) => `<div class="section card"><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.observation || item.summary || "")}</p>${list("优势", item.highlights)}${list("关注点", item.concerns)}</div>`).join("")}
  <h2>三、重点科目展开</h2>
  ${focusSubjects.map(focusSubjectBlock).join("")}
  <h2>四、错题与订正闭环</h2>
  ${listBlock(sections.correctionLoop)}
  <h2>五、稳定表现</h2>
  ${listBlock(stableGrowth)}
  <h2>六、下阶段辅导重点</h2>
  ${listBlock(tutoringFocus)}
  <h2>七、家长下一步</h2>
  ${listBlock(parentNextStep)}
  <div class="foot">本报告由教师确认后生成，供家长通过微信私聊查收。</div>
</section>
</body>
</html>`;
}

function defaultPeriodLabel(reportType, nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date();
  const year = now.getFullYear();
  const term = now.getMonth() + 1 >= 9 || now.getMonth() + 1 <= 1 ? "秋季" : "春季";
  return `${year}${term}${reportType === "midterm" ? "期中" : "期末"}`;
}

function subjectSection(student, subject) {
  const tasks = (student.tasks || []).filter((item) => subjectFromValue(item.subject?.name || item.metadata?.subject) === subject);
  const submissions = (student.submissions || []).filter((item) => subjectFromValue(item.assignment?.subject?.name || item.assignment?.metadata?.subject) === subject);
  const mistakes = (student.mistakes || []).filter((item) => subjectFromValue(item.subject) === subject);
  const reviewed = submissions.filter((item) => item.status === "REVIEWED" && item.grading);
  const avg = reviewed.length
    ? Math.round(reviewed.reduce((sum, item) => sum + Number(item.grading?.score || 0), 0) / reviewed.length)
    : null;

  return {
    subject,
    summary: reviewed.length
      ? `${subject}已有 ${reviewed.length} 次教师确认批改记录，平均表现约 ${avg} 分。`
      : `${subject}本阶段记录较少，建议继续观察课堂和作业表现。`,
    observation: reviewed.length
      ? `${subject}已有 ${reviewed.length} 次教师确认批改记录，可围绕${mistakes[0]?.knowledgePoint?.name || mistakes[0]?.prompt || "本阶段重点"}继续巩固。`
      : `${subject}本阶段记录较少，后续以课堂表现、作业订正和教师确认记录继续观察。`,
    evidence: reviewed.length
      ? `${reviewed.length} 次教师确认批改记录${mistakes.length ? `，${mistakes.length} 条错题记录` : ""}`
      : "本阶段教师确认记录较少",
    abilityObservation: abilityObservation(subject, mistakes),
    priorityAction: priorityAction(subject, mistakes),
    teacherNextStep: teacherNextStep(subject, mistakes),
    highlights: tasks.some((item) => item.status === "COMPLETED" || item.status === "REVIEWED")
      ? ["能按要求完成部分学习任务。"]
      : ["继续积累学习任务记录。"],
    concerns: mistakes.slice(0, 2).map((item) => item.knowledgePoint?.name || item.prompt || "待巩固知识点")
  };
}

function correctionLoop(student) {
  const mistakes = student.mistakes || [];
  return mistakes.length
    ? mistakes.slice(0, 5).map((item) => `${item.subject}：${item.knowledgePoint?.name || item.prompt || "错题"}，${item.masteryResolved ? "已订正，可用同类题确认稳定。" : item.cause || "需继续订正复盘。"}`)
    : ["本阶段暂无可发布的错题订正闭环，建议继续积累批改记录。"];
}

function learningHabits(student) {
  const qaCount = (student.qaSessions || []).length + (student.voiceInteractions || []).length;
  const completed = (student.tasks || []).filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED").length;
  return [
    completed ? `已完成 ${completed} 项学习任务，学习节奏有记录可追踪。` : "学习任务完成记录仍需继续积累。",
    qaCount ? `主动提问或课堂互动 ${qaCount} 次，问题意识正在形成。` : "主动提问和课堂互动记录较少，后续继续观察。"
  ];
}

function progressList(student) {
  const reviewed = (student.submissions || []).filter((item) => item.status === "REVIEWED" && item.grading);
  return reviewed.length ? ["已形成教师确认的批改记录，可作为后续补弱依据。"] : ["阶段进步需要更多教师确认记录支撑。"];
}

function focusSubjectDetails(subjects) {
  const focus = subjects.filter((item) => item.concerns.length).slice(0, 2);
  const visible = focus.length ? focus : subjects.slice(0, 1);
  return visible.map((item) => ({
    subject: item.subject,
    evidence: item.evidence,
    abilityObservation: item.abilityObservation,
    priorityAction: item.priorityAction,
    teacherNextStep: item.teacherNextStep,
    highlights: item.highlights,
    concerns: item.concerns
  }));
}

function stableGrowthDetails(habits, progress) {
  const sources = [...progress, ...habits].filter(Boolean);
  const visible = sources.length ? sources.slice(0, 2) : ["本阶段保持稳定学习节奏，后续继续积累教师确认记录。"];
  return visible.map((text) => ({ text, evidence: "来自任务完成、教师确认批改或课堂互动记录。" }));
}

function nextActions(subjects) {
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  return [
    `${focus.subject}：围绕${focus.concerns[0] || "基础知识和订正质量"}安排下一阶段巩固。`,
    "每周复盘一次错题订正，确认是否能独立复述解题思路。"
  ];
}

function parentSuggestions(subjects) {
  const focus = subjects.find((item) => item.concerns.length) || subjects[0];
  return [
    `每天 5 到 10 分钟，请孩子口头复述${focus.subject}中最容易出错的一步。`,
    "关注订正过程，不只关注分数。"
  ];
}

function abilityObservation(subject, mistakes) {
  const point = mistakes[0]?.knowledgePoint?.name || mistakes[0]?.prompt || "本阶段重点";
  if (subject === "数学") return `围绕${point}继续观察审题、条件整理和列式表达。`;
  if (subject === "语文") return `围绕${point}继续观察阅读定位、概括表达和复述质量。`;
  if (subject === "英语") return `围绕${point}继续观察词汇拼读、句型使用和阅读关键词。`;
  return `围绕${point}继续观察学习过程和订正质量。`;
}

function priorityAction(subject, mistakes) {
  const point = mistakes[0]?.knowledgePoint?.name || mistakes[0]?.prompt || "基础知识和订正质量";
  if (subject === "数学") return `下次课先让孩子圈出已知条件和问题，再处理${point}。`;
  if (subject === "语文") return `下次课先回到原文找依据，再完成${point}相关表达。`;
  if (subject === "英语") return `下次课先复习核心词句，再完成${point}相关练习。`;
  return `下次课先复盘错因，再处理${point}。`;
}

function teacherNextStep(subject, mistakes) {
  const point = mistakes[0]?.knowledgePoint?.name || mistakes[0]?.prompt || "本阶段重点";
  return `${subject}围绕${point}安排同类题复练，并记录订正后是否能独立复述。`;
}

function subjectFromValue(value) {
  const text = String(value || "");
  if (text.includes("语文") || text.toLowerCase().includes("chinese")) return "语文";
  if (text.includes("数学") || text.toLowerCase().includes("math")) return "数学";
  if (text.includes("英语") || text.toLowerCase().includes("english")) return "英语";
  return "";
}

function focusSubjectBlock(item) {
  const details = [
    item.evidence ? `本周期证据：${item.evidence}` : "",
    item.abilityObservation ? `能力观察：${item.abilityObservation}` : "",
    item.priorityAction ? `优先处理：${item.priorityAction}` : "",
    item.teacherNextStep ? `老师下一步：${item.teacherNextStep}` : ""
  ].filter(Boolean);
  return `<div class="section card"><h3>${escapeHtml(item.subject)}</h3>${listBlock(details)}${list("需要关注", item.concerns)}${list("可以保持", item.highlights)}</div>`;
}

function list(label, items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return visible.length
    ? `<strong>${escapeHtml(label)}</strong><ul>${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
}

function listBlock(items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return `<div class="card"><ul>${(visible.length ? visible : ["暂无记录，继续观察。"]).map((item) => `<li>${escapeHtml(readableItem(item))}</li>`).join("")}</ul></div>`;
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function readableItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.text && item.evidence) return `${item.text}（${item.evidence}）`;
  return item.text || item.summary || item.observation || item.evidence || "";
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
