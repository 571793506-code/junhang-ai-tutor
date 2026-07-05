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
  const stageConclusions = stageConclusionDetails(reportType, template, focus, habits, progress);
  const evidenceSummary = evidenceSummaryDetails(student);
  const subjectAbilityMap = subjectAbilityDetails(subjects);
  const commonCauseAnalysis = commonCauseDetails(focusSubjects);
  const growthTrajectory = growthTrajectoryDetails(reportType, focus, habits, progress, student);
  const evidenceCoverage = evidenceCoverageDetails(student, subjects);
  const learningProcess = learningProcessDetails(student, focus, habits);
  const actionPlan = actionPlanDetails(template, focusSubjects, actions);
  const homeSchoolCollaboration = homeSchoolCollaborationDetails(template, focus, suggestions);
  const teacherReviewChecklist = teacherReviewChecklistDetails();
  const parentCommunicationSummary = parentCommunicationDetails(focus, suggestions);
  const sections = {
    overview: {
      text: `${student.displayName}${periodLabel}学习记录已完成汇总，本报告重点呈现${template.overviewFocus}，建议优先关注${focus.subject}的持续巩固和订正闭环。`
    },
    stageConclusions,
    growthTrajectory,
    evidenceSummary,
    evidenceCoverage,
    subjects,
    subjectOverview: subjects,
    subjectAbilityMap,
    focusSubjects,
    stableGrowth,
    commonCauseAnalysis,
    correctionLoop: correctionLoop(student),
    learningProcess,
    learningHabits: habits,
    progress,
    nextActions: actions,
    parentSuggestions: suggestions,
    tutoringFocus: [
      `${template.tutoringPrefix}优先安排：${actions[0] || "继续保持错题订正和基础巩固。"}`,
      `${template.focusLabel}：每周复盘一次错题订正，确认是否能独立复述解题思路。`
    ],
    actionPlan,
    homeSchoolCollaboration,
    teacherReviewChecklist,
    parentCommunicationSummary,
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
  const stageConclusions = Array.isArray(sections.stageConclusions) ? sections.stageConclusions : [];
  const growthTrajectory = Array.isArray(sections.growthTrajectory) ? sections.growthTrajectory : [];
  const evidenceSummary = Array.isArray(sections.evidenceSummary) ? sections.evidenceSummary : [];
  const evidenceCoverage = Array.isArray(sections.evidenceCoverage) ? sections.evidenceCoverage : [];
  const subjectAbilityMap = Array.isArray(sections.subjectAbilityMap) ? sections.subjectAbilityMap : [];
  const commonCauseAnalysis = Array.isArray(sections.commonCauseAnalysis) ? sections.commonCauseAnalysis : [];
  const learningProcess = Array.isArray(sections.learningProcess) ? sections.learningProcess : [];
  const actionPlan = Array.isArray(sections.actionPlan) ? sections.actionPlan : [];
  const homeSchoolCollaboration = Array.isArray(sections.homeSchoolCollaboration) ? sections.homeSchoolCollaboration : [];
  const parentCommunicationSummary = safeObject(sections.parentCommunicationSummary);

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
  <h2>二、阶段关键结论</h2>
  ${detailCards(stageConclusions)}
  <h2>三、成长轨迹</h2>
  ${detailCards(growthTrajectory)}
  <h2>四、证据摘要</h2>
  ${detailCards(evidenceSummary)}
  <h2>五、证据覆盖说明</h2>
  ${detailCards(evidenceCoverage)}
  <h2>六、三科总览</h2>
  ${subjects.map((item) => `<div class="section card"><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.observation || item.summary || "")}</p>${list("优势", item.highlights)}${list("关注点", item.concerns)}</div>`).join("")}
  <h2>七、学科能力拆解</h2>
  ${abilityCards(subjectAbilityMap)}
  <h2>八、重点科目展开</h2>
  ${focusSubjects.map(focusSubjectBlock).join("")}
  <h2>九、共性错因分析</h2>
  ${detailCards(commonCauseAnalysis)}
  <h2>十、错题与订正闭环</h2>
  ${listBlock(sections.correctionLoop)}
  <h2>十一、课堂与作业过程</h2>
  ${detailCards(learningProcess)}
  <h2>十二、稳定表现</h2>
  ${listBlock(stableGrowth)}
  <h2>十三、下阶段辅导重点</h2>
  ${listBlock(tutoringFocus)}
  <h2>十四、跟进计划</h2>
  ${detailCards(actionPlan)}
  <h2>十五、家校协同建议</h2>
  ${detailCards(homeSchoolCollaboration)}
  <h2>十六、家长下一步</h2>
  ${listBlock(parentNextStep)}
  <h2>十七、家长沟通摘要</h2>
  <div class="card">${paragraphs(parentCommunicationSummary.text || "")}</div>
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
      ? `${subject}已有 ${reviewed.length} 次教师确认批改记录，可用于观察本阶段学习变化。`
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

function stageConclusionDetails(reportType, template, focus, habits, progress) {
  return [
    {
      title: reportType === "midterm" ? "阶段掌握" : "学期成长",
      text: `${template.overviewFocus}已整理为教师可复核草稿，优先围绕${focus.subject}形成后续辅导安排。`,
      evidence: "来自教师确认批改、错题记录和学习任务记录。"
    },
    {
      title: "学习过程",
      text: habits[0] || "学习任务完成记录仍需继续积累。",
      evidence: "来自学习任务完成状态。"
    },
    {
      title: "复盘依据",
      text: progress[0] || "阶段进步需要更多教师确认记录支撑。",
      evidence: "来自教师确认批改记录。"
    }
  ];
}

function evidenceSummaryDetails(student) {
  const tasks = student.tasks || [];
  const reviewed = (student.submissions || []).filter((item) => item.status === "REVIEWED" && item.grading);
  const mistakes = student.mistakes || [];
  const interactions = (student.qaSessions || []).length + (student.voiceInteractions || []).length;
  return [
    { title: "学习任务", text: `${tasks.length} 项任务记录，其中 ${(tasks.filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED")).length} 项已完成或已复核。`, evidence: "任务状态记录" },
    { title: "教师确认批改", text: `${reviewed.length} 条教师确认批改记录用于阶段观察。`, evidence: "REVIEWED 批改记录" },
    { title: "错题与订正", text: `${mistakes.length} 条错题记录用于定位共性错因和复练动作。`, evidence: "错题本记录" },
    { title: "问答互动", text: interactions ? `${interactions} 次问答或语音互动作为辅助观察。` : "本阶段问答互动记录较少，暂作为继续观察项。", evidence: "问答与语音互动记录" }
  ];
}

function growthTrajectoryDetails(reportType, focus, habits, progress, student) {
  const mistakes = student.mistakes || [];
  const resolved = mistakes.filter((item) => item.masteryResolved).length;
  return [
    {
      title: reportType === "midterm" ? "前半阶段变化" : "本学期变化",
      text: progress[0] || "阶段变化仍需继续通过教师确认记录观察。",
      evidence: "教师确认批改记录"
    },
    {
      title: "学习节奏",
      text: habits[0] || "学习任务完成记录仍需继续积累。",
      evidence: "学习任务完成状态"
    },
    {
      title: "订正迁移",
      text: resolved ? `已有 ${resolved} 条错题完成订正，后续用同类题确认迁移是否稳定。` : `${focus.subject}订正后迁移仍需继续用同类题确认。`,
      evidence: mistakes.length ? "错题订正记录" : "后续错题订正记录"
    }
  ];
}

function evidenceCoverageDetails(student, subjects) {
  const tasks = student.tasks || [];
  const reviewed = (student.submissions || []).filter((item) => item.status === "REVIEWED" && item.grading);
  const mistakes = student.mistakes || [];
  const interactions = (student.qaSessions || []).length + (student.voiceInteractions || []).length;
  const coveredSubjects = subjects.filter((item) => item.evidence && !item.evidence.includes("较少")).map((item) => item.subject);
  return [
    {
      title: "任务覆盖",
      text: `${tasks.length} 项任务记录用于观察学习节奏和完成情况。`,
      evidence: "学习任务记录"
    },
    {
      title: "批改覆盖",
      text: `${reviewed.length} 条教师确认批改记录用于观察阶段掌握。`,
      evidence: "教师确认批改"
    },
    {
      title: "错题覆盖",
      text: `${mistakes.length} 条错题记录用于定位共性错因和订正动作。`,
      evidence: "错题记录"
    },
    {
      title: "科目覆盖",
      text: coveredSubjects.length ? `当前已有 ${coveredSubjects.join("、")} 的有效观察，其余科目继续积累记录。` : "三科均需要继续积累教师确认记录。",
      evidence: "三科记录汇总"
    },
    {
      title: "互动覆盖",
      text: interactions ? `${interactions} 次问答或语音互动用于辅助观察表达和问题意识。` : "问答互动记录较少，暂不单独形成强结论。",
      evidence: "问答与语音互动"
    }
  ];
}

function subjectAbilityDetails(subjects) {
  return subjects.map((item) => ({
    subject: item.subject,
    currentLevel: item.concerns.length ? "需要持续巩固" : "继续观察",
    keyAbility: keyAbilityName(item.subject),
    evidence: item.evidence,
    nextStep: item.priorityAction
  }));
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

function commonCauseDetails(focusSubjects) {
  const focus = focusSubjects[0];
  return [
    {
      title: "审题与复述",
      text: focus ? `${focus.subject}中需要继续确认孩子能否先说清题意、条件和关键步骤。` : "后续继续观察孩子是否能先复述题意再作答。",
      evidence: focus?.evidence || "阶段记录"
    },
    {
      title: "订正闭环",
      text: "订正后需要确认能否独立复述错因，并在同类题中迁移。",
      evidence: "错题记录和教师确认批改"
    },
    {
      title: "表达完整度",
      text: "后续辅导中继续观察孩子是否能把思路、依据和答案步骤说完整。",
      evidence: "课堂表达和作业过程观察"
    }
  ];
}

function learningProcessDetails(student, focus, habits) {
  const completed = (student.tasks || []).filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED").length;
  const reviewed = (student.submissions || []).filter((item) => item.status === "REVIEWED" && item.grading).length;
  const mistakes = student.mistakes || [];
  return [
    {
      title: "课后任务完成",
      text: completed ? `已完成或已复核 ${completed} 项学习任务，可继续保持固定复盘节奏。` : "课后任务完成记录仍需继续积累。",
      evidence: habits[0] || "学习任务记录"
    },
    {
      title: "批改反馈吸收",
      text: reviewed ? `已有 ${reviewed} 条教师确认批改记录，下一步重点看孩子能否说出修改依据。` : "批改反馈记录较少，后续先积累教师确认记录。",
      evidence: "教师确认批改"
    },
    {
      title: "错题复盘过程",
      text: mistakes.length ? `${focus.subject}可围绕${focus.concerns[0] || "本阶段重点"}复述错因，再做同类题确认。` : "错题复盘过程暂无足够记录，后续继续观察。",
      evidence: mistakes.length ? "错题记录" : "后续错题记录"
    }
  ];
}

function stableGrowthDetails(habits, progress) {
  const sources = [...progress, ...habits].filter(Boolean);
  const visible = sources.length ? sources.slice(0, 2) : ["本阶段保持稳定学习节奏，后续继续积累教师确认记录。"];
  return visible.map((text) => ({ text, evidence: "来自任务完成、教师确认批改或课堂互动记录。" }));
}

function actionPlanDetails(template, focusSubjects, actions) {
  const focus = focusSubjects[0];
  return [
    {
      title: "第一步",
      text: focus?.priorityAction || actions[0] || "先复盘本阶段教师确认记录中的关键问题。",
      evidence: focus?.evidence || "阶段记录"
    },
    {
      title: "第二步",
      text: `${template.focusLabel}，保留每周一次短复盘。`,
      evidence: "教师辅导安排"
    },
    {
      title: "第三步",
      text: "用同类题或短口头复述确认订正是否稳定，不只看最终答案。",
      evidence: "订正闭环记录"
    }
  ];
}

function homeSchoolCollaborationDetails(template, focus, suggestions) {
  return [
    {
      title: "家庭观察重点",
      text: `家长可优先观察孩子在${focus.subject}中是否先说清题意、依据或关键步骤。`,
      evidence: focus.evidence || "阶段记录"
    },
    {
      title: "短时配合动作",
      text: suggestions[0] || "每天安排 5 到 10 分钟短复述，重点看过程是否说清楚。",
      evidence: "家长下一步建议"
    },
    {
      title: "沟通节奏",
      text: `${template.focusLabel}，建议家长每周只抓 1 个小问题反馈给老师，避免一次性要求过多。`,
      evidence: "下阶段辅导安排"
    }
  ];
}

function teacherReviewChecklistDetails() {
  return [
    { text: "确认阶段报告正文已由老师复核，未把草稿直接发给家长。" },
    { text: "确认 PDF 或 HTML 资产只在教师端保存和下载，不进入学生端正文。" },
    { text: "确认微信私聊人工发送完成后，再标记人工发送状态。" },
    { text: "确认学生端只显示“老师已发送阶段报告给家长”的状态文案。" }
  ];
}

function parentCommunicationDetails(focus, suggestions) {
  return {
    text: `建议家长重点配合${focus.subject}的过程观察：${suggestions.join("；")}。家庭配合以短时间复述和查看订正过程为主，不需要替代老师讲新内容。`,
    evidence: "家长沟通建议"
  };
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

function keyAbilityName(subject) {
  if (subject === "数学") return "审题、条件整理、列式表达";
  if (subject === "语文") return "阅读定位、概括表达、复述质量";
  if (subject === "英语") return "词汇拼写、句型使用、阅读关键词";
  return "学习过程和订正质量";
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

function detailCards(items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return (visible.length ? visible : [{ title: "继续观察", text: "暂无记录，继续观察。", evidence: "阶段记录" }])
    .map((item) => `<div class="section card"><h3>${escapeHtml(item.title || "")}</h3><p>${escapeHtml(item.text || "")}</p>${item.evidence ? `<p><strong>依据</strong>：${escapeHtml(item.evidence)}</p>` : ""}</div>`)
    .join("");
}

function abilityCards(items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  return (visible.length ? visible : []).map((item) => `<div class="section card"><h3>${escapeHtml(item.subject || "")}</h3><p><strong>当前观察</strong>：${escapeHtml(item.currentLevel || "")}</p><p><strong>能力点</strong>：${escapeHtml(item.keyAbility || "")}</p><p><strong>依据</strong>：${escapeHtml(item.evidence || "")}</p><p><strong>下一步</strong>：${escapeHtml(item.nextStep || "")}</p></div>`).join("");
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
