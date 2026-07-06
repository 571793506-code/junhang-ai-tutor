const SUBJECTS = ["语文", "数学", "英语"];

export function buildProfileEvidencePack(student, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const periodType = options.periodType === "weekly" ? "weekly" : "monthly";
  const period = buildPeriod(periodType, now);
  const tasks = filterByPeriod(student.tasks || [], period, (item) => item.createdAt);
  const submissions = filterByPeriod(student.submissions || [], period, (item) => item.submittedAt);
  const mistakes = filterByPeriod(student.mistakes || [], period, (item) => item.createdAt);
  const reports = filterByPeriod(student.reports || [], period, (item) => item.createdAt);
  const behaviorEvents = filterByPeriod(student.behaviorEvents || [], period, (item) => item.occurredAt);
  const qaSessions = filterByPeriod(student.qaSessions || [], period, (item) => item.createdAt);
  const voiceInteractions = filterByPeriod(student.voiceInteractions || [], period, (item) => item.occurredAt);
  const gradingEvidence = [];
  const blockedEvidence = [];

  submissions.forEach((submission) => {
    const result = safeObject(submission.grading?.result);
    const blocked = submission.status !== "REVIEWED"
      || result.needsTeacherReview === true
      || result.archiveEligible === false
      || result.provisionalScore != null
      || String(result.confidence || "").toLowerCase() === "low";
    const item = {
      id: submission.id,
      type: "grading",
      subject: subjectFromValue(submission.assignment?.subject?.name || submission.assignment?.metadata?.subject),
      title: submission.assignment?.title || "批改记录",
      at: isoDate(submission.submittedAt),
      score: submission.grading?.score ?? result.score ?? null,
      summary: result.summary || result.gradingText || "",
      knowledgePoints: extractKnowledgePoints(result),
      confidence: blocked ? "blocked" : "confirmed"
    };
    if (blocked) blockedEvidence.push({ ...item, reason: "批改结果未完成教师确认或置信不足。" });
    else gradingEvidence.push(item);
  });

  const taskEvidence = tasks.map((task) => ({
    id: task.id,
    type: "task",
    subject: subjectFromValue(task.subject?.name || task.metadata?.subject),
    title: task.title || "学习任务",
    at: isoDate(task.createdAt),
    status: task.status || "",
    summary: task.description || task.metadata?.draftText || "",
    confidence: task.status === "COMPLETED" || task.status === "REVIEWED" ? "supported" : "weak"
  }));
  const mistakeEvidence = mistakes.map((mistake) => ({
    id: mistake.id,
    type: "mistake",
    subject: subjectFromValue(mistake.subject),
    title: mistake.knowledgePoint?.name || mistake.metadata?.point || mistake.prompt || "错题记录",
    at: isoDate(mistake.createdAt),
    cause: mistake.cause || "",
    resolved: Boolean(mistake.masteryResolved),
    nextPractice: mistake.metadata?.nextPractice || mistake.metadata?.suggestedPractice || "",
    confidence: "confirmed"
  }));
  const qaEvidence = qaSessions.map((session) => ({
    id: session.id,
    type: "qa",
    subject: subjectFromValue(session.subject || session.metadata?.subject),
    title: session.question || "AI问答",
    at: isoDate(session.createdAt),
    summary: session.answer || session.metadata?.answerPreview || "",
    confidence: session.metadata?.confirmed === false ? "weak" : "supported"
  }));
  const classroomEvidence = voiceInteractions.map((item) => ({
    id: item.id,
    type: "classroom",
    subject: subjectFromValue(item.subject || item.metadata?.subject),
    title: item.question || item.action || "课堂互动",
    at: isoDate(item.occurredAt),
    summary: item.answer || item.result || "",
    confidence: "supported"
  }));

  return {
    period,
    student: {
      id: student.id,
      displayName: student.displayName,
      grade: student.grade,
      className: student.className || "",
      textbookVersion: student.textbookVersion || ""
    },
    taskEvidence,
    gradingEvidence,
    mistakeEvidence,
    qaEvidence,
    classroomEvidence,
    reportEvidence: reports.map((report) => ({
      id: report.id,
      type: "report",
      title: report.title || "阶段报告",
      at: isoDate(report.createdAt),
      summary: report.content || "",
      confidence: "confirmed"
    })),
    behaviorEvidence: behaviorEvents.map((event) => ({
      id: event.id,
      type: "behavior",
      title: event.action || event.feature || "学习行为",
      at: isoDate(event.occurredAt),
      summary: event.result || "",
      confidence: "supported"
    })),
    blockedEvidence,
    sourceQuality: {
      taskCount: taskEvidence.length,
      gradingCount: gradingEvidence.length,
      mistakeCount: mistakeEvidence.length,
      qaCount: qaEvidence.length,
      classroomCount: classroomEvidence.length,
      hasBlockedEvidence: blockedEvidence.length > 0,
      hasSparseEvidence: taskEvidence.length + gradingEvidence.length + mistakeEvidence.length + qaEvidence.length + classroomEvidence.length < 3,
      missingSubjects: SUBJECTS.filter((subject) => !hasSubjectEvidence(subject, { taskEvidence, gradingEvidence, mistakeEvidence, qaEvidence, classroomEvidence }))
    }
  };
}

export function buildStudentGrowthSnapshot(student, options = {}) {
  const pack = buildProfileEvidencePack(student, options);
  const periodType = pack.period.type;
  const publishedView = buildPublishedView(pack);
  const teacherReview = buildTeacherReview(pack);
  const sourceCounts = {
    tasks: pack.taskEvidence.length,
    submissions: pack.gradingEvidence.length,
    mistakes: pack.mistakeEvidence.length,
    reports: pack.reportEvidence.length,
    behaviorEvents: pack.behaviorEvidence.length,
    qaSessions: pack.qaEvidence.length,
    voiceInteractions: pack.classroomEvidence.length
  };

  return {
    profileType: periodType === "weekly" ? "weekly_growth" : "monthly_comprehensive_growth",
    period: pack.period,
    publishedView,
    printView: buildPrintView(pack, publishedView),
    teacherReview,
    profileEvidencePack: pack,
    weeklyScore: computeScore(pack),
    streak: pack.taskEvidence.filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED").length,
    mastery: buildMastery(pack),
    strengths: publishedView.stableGrowth.map((item) => item.text),
    risks: publishedView.focusSubjects.map((item) => `${item.subject}：${item.whyFocus}`),
    tone: periodType === "weekly" ? "本周持续观察" : "月度成长复盘",
    generatedAt: new Date().toISOString(),
    sourceCounts,
    timeline: publishedView.timelinePreview.map((item) => ({
      type: item.type,
      at: item.at,
      title: item.title,
      subject: item.subject || "",
      status: item.confidence,
      summary: item.text
    })),
    narrative: {
      parentSummary: publishedView.overview.text,
      teacherSummary: teacherReview.publishChecklist.map((item) => item.text).join("；"),
      weeklyFeedback: periodType === "weekly" ? publishedView.overview.text : "",
      monthlyFeedback: periodType === "monthly" ? publishedView.overview.text : "",
      risks: publishedView.focusSubjects.map((item) => item.whyFocus),
      nextActions: publishedView.tutoringFocus.map((item) => item.text)
    }
  };
}

export function filterStudentProfileSnapshot(snapshot, role = "student") {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  if (role === "teacher") return removeInternalFields(snapshot);
  const { teacherReview, profileEvidencePack, ...publicSnapshot } = snapshot;
  return removeInternalFields(publicSnapshot);
}

export function mergeStudentProfileAiDraft(baseSnapshot, aiDraft) {
  const base = safeObject(baseSnapshot);
  const draft = safeObject(aiDraft);
  let merged = {
    ...base,
    publishedView: mergePublishedView(base.publishedView, draft.publishedView),
    teacherReview: mergeTeacherReview(base.teacherReview, draft.teacherReview),
    narrative: mergeNarrative(base, draft)
  };

  if (draft.profileType === base.profileType) merged.profileType = draft.profileType;
  if (isMatchingPeriod(base.period, draft.period)) merged.period = base.period;
  if (base.profileEvidencePack) merged = { ...merged, printView: buildPrintView(base.profileEvidencePack, merged.publishedView) };
  return removeInternalFields(merged);
}

export function renderStudentGrowthProfilePrintHtml(student, snapshot) {
  const view = safeObject(snapshot?.printView);
  const sections = safeObject(view.sections);
  const title = view.title || (snapshot?.period?.type === "weekly" ? "周综合成长档案" : "月度综合成长档案");
  const periodLabel = view.periodLabel || snapshot?.period?.label || "";
  const subjectOverview = Array.isArray(sections.subjectOverview) ? sections.subjectOverview : [];
  const focusDirections = Array.isArray(sections.focusDirections) ? sections.focusDirections : [];
  const correctionLoop = Array.isArray(sections.correctionLoop) ? sections.correctionLoop : [];
  const stableGrowth = Array.isArray(sections.stableGrowth) ? sections.stableGrowth : [];
  const tutoringPlan = Array.isArray(sections.tutoringPlan) ? sections.tutoringPlan : [];
  const parentNextSteps = Array.isArray(sections.parentNextSteps) ? sections.parentNextSteps : [];
  const evidenceCoverage = Array.isArray(sections.evidenceCoverage) ? sections.evidenceCoverage : [];
  const subjectAbilityMap = Array.isArray(sections.subjectAbilityMap) ? sections.subjectAbilityMap : [];
  const commonCauseAnalysis = Array.isArray(sections.commonCauseAnalysis) ? sections.commonCauseAnalysis : [];
  const learningProcess = Array.isArray(sections.learningProcess) ? sections.learningProcess : [];
  const homeSchoolCollaboration = Array.isArray(sections.homeSchoolCollaboration) ? sections.homeSchoolCollaboration : [];

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 15mm 14mm; }
body { margin: 0; color: #1f2a36; font-family: "SimSun", "Microsoft YaHei", Arial, sans-serif; font-size: 10.5pt; line-height: 1.58; }
.cover { padding: 12mm 0 8mm; border-bottom: 4px solid #256b61; margin-bottom: 8mm; }
.badge { color: #256b61; font-weight: 700; letter-spacing: 0; }
h1 { margin: 5mm 0 4mm; font-size: 23pt; font-family: "SimHei", "Microsoft YaHei", sans-serif; }
h2 { break-after: avoid; margin: 14px 0 6px; font-size: 14pt; color: #174f48; border-bottom: 1px solid #cddedb; padding-bottom: 4px; }
h3 { margin: 7px 0 4px; font-size: 11.5pt; color: #1f2a36; }
.meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 14px; color: #526575; }
.section { break-inside: avoid; margin: 0 0 8px; }
.card { border: 1px solid #d8e4e1; border-radius: 6px; padding: 9px 11px; margin: 7px 0; background: #fbfdfc; }
ul { margin: 5px 0 0 18px; padding: 0; }
li { margin: 2px 0; }
.foot { margin-top: 12px; color: #6b7a86; font-size: 9pt; }
</style>
</head>
<body>
<section class="cover">
  <div class="badge">君航 AI 助教 · 教师确认打印版</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <span>学生：${escapeHtml(student?.displayName || snapshot?.profileEvidencePack?.student?.displayName || "")}</span>
    <span>年级：${escapeHtml(student?.grade || snapshot?.profileEvidencePack?.student?.grade || "")}</span>
    <span>班级：${escapeHtml(student?.className || snapshot?.profileEvidencePack?.student?.className || "")}</span>
    <span>周期：${escapeHtml(periodLabel)}</span>
    <span>模板：综合成长档案</span>
    <span>建议页数：${escapeHtml(view.pageHint || "")}</span>
  </div>
</section>
<section>
  <h2>一、综合成长摘要</h2>
  ${detailCard(sections.comprehensiveSummary)}
  ${sectionList("二、证据覆盖摘要", evidenceCoverage)}
  <h2>${evidenceCoverage.length ? "三" : "二"}、三科总览</h2>
  ${subjectOverview.map((item) => `<div class="section card"><h3>${escapeHtml(item.subject || "")}</h3><p>${escapeHtml(item.text || item.observation || "")}</p></div>`).join("")}
  ${sectionList(evidenceCoverage.length ? "四、学科能力拆解" : "三、学科能力拆解", subjectAbilityMap)}
  ${sectionList(evidenceCoverage.length ? "五、重点方向展开" : "四、重点方向展开", focusDirections)}
  ${sectionList(evidenceCoverage.length ? "六、共性错因分析" : "五、共性错因分析", commonCauseAnalysis)}
  ${sectionList(evidenceCoverage.length ? "七、错题与订正闭环" : "六、错题与订正闭环", correctionLoop)}
  ${sectionList(evidenceCoverage.length ? "八、课堂与作业过程" : "七、课堂与作业过程", learningProcess)}
  ${sectionList(evidenceCoverage.length ? "九、稳定表现" : "八、稳定表现", stableGrowth)}
  ${sectionList(evidenceCoverage.length ? "十、下阶段辅导重点" : "九、下阶段辅导重点", tutoringPlan)}
  ${sectionList(evidenceCoverage.length ? "十一、家校协同建议" : "十、家校协同建议", homeSchoolCollaboration)}
  ${sectionList(evidenceCoverage.length ? "十二、家长下一步" : "十一、家长下一步", parentNextSteps)}
  <h2>${evidenceCoverage.length ? "十三" : "十二"}、家长沟通摘要</h2>
  ${detailCard(sections.parentCommunicationSummary)}
  <div class="foot">本档案由教师确认后生成，可打印、保存或由老师人工发送给家长。</div>
</section>
</body>
</html>`;
}

function buildPublishedView(pack) {
  const periodName = pack.period.type === "weekly" ? "本周" : "本月";
  const focusSubjects = buildFocusSubjects(pack);
  const evidenceTotal = pack.taskEvidence.length + pack.gradingEvidence.length + pack.mistakeEvidence.length + pack.qaEvidence.length + pack.classroomEvidence.length;
  const sparse = evidenceTotal < 3;
  return {
    periodType: pack.period.type,
    periodLabel: pack.period.label,
    overview: withEvidence(
      sparse
        ? `${periodName}记录还在积累，先观察完成情况、订正过程和主动提问。`
        : `${periodName}已形成 ${evidenceTotal} 条可追踪学习记录，重点关注${focusSubjects[0]?.subject || "学习节奏"}的后续巩固。`,
      collectRefs(pack).slice(0, 3),
      sparse ? "weak" : "supported"
    ),
    subjectOverview: SUBJECTS.map((subject) => {
      const refs = subjectRefs(pack, subject);
      return withSubjectEvidence(
        subject,
        refs.length ? `${subject}已有 ${refs.length} 条记录，可结合订正和课堂表现继续观察。` : `本周期${subject}记录不足，继续观察。`,
        refs,
        refs.length ? "supported" : "weak"
      );
    }),
    focusSubjects,
    correctionLoop: buildCorrectionLoop(pack),
    stableGrowth: buildStableGrowth(pack),
    tutoringFocus: buildTutoringFocus(pack, focusSubjects),
    parentNextSteps: buildParentNextSteps(pack, focusSubjects),
    timelinePreview: buildTimelinePreview(pack)
  };
}

function buildPrintView(pack, publishedView) {
  const weekly = pack.period.type === "weekly";
  const title = weekly ? "周综合成长档案" : "月度综合成长档案";
  const focusDirections = (publishedView.focusSubjects || []).map((item) => ({
    title: item.subject ? `${item.subject}重点方向` : "重点方向",
    text: `${item.whyFocus || "本周期重点"}：${item.abilityObservation || item.evidenceSummary || "继续观察学习过程和订正质量。"}`,
    evidence: item.evidenceSummary || "来自本周期学习记录。",
    nextStep: item.nextClassAction || "下次课继续复盘关键问题。",
    evidenceRefs: item.evidenceRefs || [],
    confidence: item.confidence || "weak"
  }));
  const sections = {
    archiveInfo: {
      studentName: pack.student.displayName,
      grade: pack.student.grade,
      className: pack.student.className,
      periodLabel: pack.period.label,
      reviewStatus: "教师确认后可打印"
    },
    comprehensiveSummary: withEvidence(
      buildPrintSummaryText(pack, publishedView),
      publishedView.overview?.evidenceRefs || [],
      publishedView.overview?.confidence || "weak"
    ),
    subjectOverview: publishedView.subjectOverview || [],
    focusDirections,
    correctionLoop: publishedView.correctionLoop || [],
    stableGrowth: publishedView.stableGrowth || [],
    tutoringPlan: publishedView.tutoringFocus || [],
    parentNextSteps: publishedView.parentNextSteps || [],
    parentCommunicationSummary: {
      text: buildParentCommunicationSummary(pack, publishedView),
      evidence: "综合成长档案公开正文"
    }
  };

  if (!weekly) {
    sections.evidenceCoverage = buildEvidenceCoverageForPrint(pack);
    sections.subjectAbilityMap = buildSubjectAbilityMapForPrint(pack, publishedView);
    sections.commonCauseAnalysis = buildCommonCauseAnalysisForPrint(publishedView);
    sections.learningProcess = buildLearningProcessForPrint(pack, publishedView);
    sections.homeSchoolCollaboration = buildHomeSchoolCollaborationForPrint(publishedView);
  }

  return {
    templateType: "comprehensive_growth_archive",
    periodType: pack.period.type,
    periodLabel: pack.period.label,
    title,
    pageHint: weekly ? "1-2页" : "2-4页",
    renderingPolicy: {
      pdfTextSource: "html_template",
      imagePreviewUsage: "visual_reference_only",
      requiresTeacherReview: true
    },
    sections
  };
}

function buildTeacherReview(pack) {
  return {
    evidenceItems: [
      ...pack.taskEvidence,
      ...pack.gradingEvidence,
      ...pack.mistakeEvidence,
      ...pack.qaEvidence,
      ...pack.classroomEvidence
    ],
    sampleLimitNotes: buildSampleLimitNotes(pack),
    pendingConfirmations: pack.blockedEvidence,
    internalRisks: pack.blockedEvidence.map((item) => `${item.title}：${item.reason}`),
    publishChecklist: [
      withEvidence("已剔除低置信或未复核来源。", pack.blockedEvidence.map((item) => item.id), pack.blockedEvidence.length ? "supported" : "confirmed"),
      withEvidence("发布前请确认周/月档案措辞适合学生和家长查看。", [], "supported")
    ]
  };
}

function buildPrintSummaryText(pack, publishedView) {
  const periodName = pack.period.type === "weekly" ? "本周" : "本月";
  const overview = publishedView.overview?.text || `${periodName}学习记录仍需继续积累。`;
  const focus = publishedView.focusSubjects?.[0];
  const focusText = focus ? `当前可优先围绕${focus.subject || "重点方向"}的${focus.whyFocus || "学习过程"}继续观察。` : "当前先以学习任务完成、订正过程和课堂表达继续观察。";
  return `${overview}${focusText}本档案以教师确认后的任务、批改、错题和互动记录为依据，帮助家长了解孩子近期真实学习过程。`;
}

function buildParentCommunicationSummary(pack, publishedView) {
  const periodName = pack.period.type === "weekly" ? "本周" : "本月";
  const focus = publishedView.focusSubjects?.[0];
  const parentStep = publishedView.parentNextSteps?.[0]?.text || "在家短时间复述错因和订正步骤。";
  return `${periodName}建议家长重点看孩子是否能说清学习过程，而不是只看最终答案。${focus ? `可先关注${focus.subject}中的${focus.whyFocus}，` : ""}${parentStep}家庭配合以短时观察和鼓励复述为主，不需要替代老师讲新内容。`;
}

function buildEvidenceCoverageForPrint(pack) {
  return [
    {
      title: "学习任务",
      text: `${pack.taskEvidence.length} 条任务记录用于观察完成节奏和课后跟进情况。`,
      evidence: "任务记录"
    },
    {
      title: "教师确认批改",
      text: `${pack.gradingEvidence.length} 条教师确认批改记录用于观察掌握情况。`,
      evidence: "REVIEWED 批改记录"
    },
    {
      title: "错题与订正",
      text: `${pack.mistakeEvidence.length} 条错题记录用于定位错因和后续复练方向。`,
      evidence: "错题记录"
    },
    {
      title: "问答与课堂互动",
      text: `${pack.qaEvidence.length + pack.classroomEvidence.length} 条互动记录作为问题意识和课堂表达的辅助观察。`,
      evidence: "问答和课堂互动记录"
    }
  ];
}

function buildSubjectAbilityMapForPrint(pack, publishedView) {
  return SUBJECTS.map((subject) => {
    const overview = (publishedView.subjectOverview || []).find((item) => item.subject === subject);
    const focus = (publishedView.focusSubjects || []).find((item) => item.subject === subject);
    return {
      title: subject,
      text: focus?.abilityObservation || overview?.text || `${subject}记录不足，继续观察。`,
      evidence: focus?.evidenceSummary || `${subjectRefs(pack, subject).length} 条本周期记录。`,
      nextStep: focus?.nextClassAction || "继续积累课堂、作业和订正记录。"
    };
  });
}

function buildCommonCauseAnalysisForPrint(publishedView) {
  const focus = publishedView.focusSubjects?.[0];
  return [
    {
      title: "审题与复述",
      text: focus ? `${focus.subject}中需要继续看孩子能否先说清题意、条件或依据。` : "后续继续观察孩子是否能先复述题意再作答。",
      evidence: focus?.evidenceSummary || "综合学习记录"
    },
    {
      title: "订正闭环",
      text: "订正后要确认孩子能否独立说出错因，并在同类题中迁移。",
      evidence: "错题与批改记录"
    },
    {
      title: "表达完整度",
      text: "后续辅导继续观察孩子是否能把思路、依据和答案步骤说完整。",
      evidence: "课堂表达和作业过程"
    }
  ];
}

function buildLearningProcessForPrint(pack, publishedView) {
  const completed = pack.taskEvidence.filter((item) => item.status === "COMPLETED" || item.status === "REVIEWED").length;
  const focus = publishedView.focusSubjects?.[0];
  return [
    {
      title: "课后任务完成",
      text: completed ? `已有 ${completed} 条任务完成记录，后续继续保持固定复盘节奏。` : "课后任务完成记录仍需继续积累。",
      evidence: "任务完成状态"
    },
    {
      title: "批改反馈吸收",
      text: pack.gradingEvidence.length ? `已有 ${pack.gradingEvidence.length} 条教师确认批改记录，下一步看孩子能否说出修改依据。` : "批改反馈记录较少，后续先积累教师确认记录。",
      evidence: "教师确认批改记录"
    },
    {
      title: "错题复盘过程",
      text: focus ? `${focus.subject}可围绕${focus.whyFocus}复述错因，再用同类题确认是否稳定。` : "错题复盘过程暂无足够记录，后续继续观察。",
      evidence: "错题订正记录"
    }
  ];
}

function buildHomeSchoolCollaborationForPrint(publishedView) {
  const focus = publishedView.focusSubjects?.[0];
  const parentStep = publishedView.parentNextSteps?.[0]?.text || "每周看一次订正记录，只问错在哪里、下次怎么避免。";
  return [
    {
      title: "家庭观察重点",
      text: focus ? `家长可优先观察孩子在${focus.subject}中是否先说清题意、依据或关键步骤。` : "家长可优先观察孩子是否能说清作答过程。",
      evidence: "重点方向观察"
    },
    {
      title: "短时配合动作",
      text: parentStep,
      evidence: "家长下一步建议"
    },
    {
      title: "沟通节奏",
      text: "建议家长每周只抓 1 个小问题反馈给老师，避免一次性要求过多。",
      evidence: "下阶段辅导安排"
    }
  ];
}

function buildPeriod(periodType, now) {
  if (periodType === "weekly") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { type: "weekly", label: `${formatDate(start)} 至 ${formatDate(end)}`, start: formatDate(start), end: formatDate(end) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { type: "monthly", label: `${now.getFullYear()}年${now.getMonth() + 1}月`, start: formatDate(start), end: formatDate(end) };
}

function filterByPeriod(items, period, getDate) {
  const start = new Date(`${period.start}T00:00:00.000Z`);
  const end = new Date(`${period.end}T23:59:59.999Z`);
  return items.filter((item) => {
    const date = toDate(getDate(item));
    return !date || (date >= start && date <= end);
  });
}

function buildFocusSubjects(pack) {
  const counts = new Map();
  [...pack.gradingEvidence, ...pack.mistakeEvidence, ...pack.qaEvidence, ...pack.taskEvidence].forEach((item) => {
    counts.set(item.subject, (counts.get(item.subject) || 0) + 1);
  });
  const subjects = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([subject]) => subject).filter(Boolean);
  const selected = (subjects.length ? subjects : ["数学"]).slice(0, pack.period.type === "weekly" ? 1 : 2);
  return selected.map((subject) => {
    const refs = subjectRefs(pack, subject);
    const mistake = pack.mistakeEvidence.find((item) => item.subject === subject);
    const grading = pack.gradingEvidence.find((item) => item.subject === subject);
    return {
      subject,
      whyFocus: mistake?.title || grading?.knowledgePoints?.[0] || `${subject}学习记录需要继续跟进`,
      evidenceSummary: grading?.summary || mistake?.cause || "结合本周期学习记录继续观察。",
      abilityObservation: mistake?.cause || grading?.summary || "先看完成过程和订正质量。",
      nextClassAction: mistake?.nextPractice || "下次课先复盘本周期记录中的关键问题。",
      evidenceRefs: refs,
      confidence: refs.length >= 2 ? "supported" : "weak"
    };
  });
}

function buildCorrectionLoop(pack) {
  if (!pack.gradingEvidence.length && !pack.mistakeEvidence.length) {
    return [withEvidence("本周期暂无可发布的订正闭环记录。", [], "weak")];
  }
  return pack.mistakeEvidence.slice(0, 3).map((item) => withEvidence(
    `${item.title}：${item.resolved ? "已订正，建议用同类题确认稳定。" : "待继续订正和复盘。"}`,
    [item.id],
    "confirmed"
  ));
}

function buildStableGrowth(pack) {
  const items = [];
  if (pack.taskEvidence.some((item) => item.status === "COMPLETED" || item.status === "REVIEWED")) {
    items.push(withEvidence("能按要求完成部分学习任务。", pack.taskEvidence.map((item) => item.id).slice(0, 2), "supported"));
  }
  if (pack.qaEvidence.length) {
    items.push(withEvidence("遇到问题愿意提问，问题意识正在积累。", pack.qaEvidence.map((item) => item.id).slice(0, 2), "supported"));
  }
  return items.length ? items : [withEvidence("本周期先积累更多完成和订正记录。", [], "weak")];
}

function buildTutoringFocus(pack, focusSubjects) {
  return focusSubjects.map((item) => withEvidence(
    `${item.subject}：${item.nextClassAction}`,
    item.evidenceRefs,
    item.confidence
  ));
}

function buildParentNextSteps(pack, focusSubjects) {
  const focus = focusSubjects[0];
  if (!focus) return [withEvidence("每周看一次订正记录，只问错在哪里、下次怎么避免。", [], "weak")];
  return [withEvidence(
    `每天 5 到 10 分钟，让孩子口头复述${focus.subject}中最容易漏掉的一步。`,
    focus.evidenceRefs,
    focus.confidence
  )];
}

function buildTimelinePreview(pack) {
  return [
    ...pack.taskEvidence,
    ...pack.gradingEvidence,
    ...pack.mistakeEvidence,
    ...pack.qaEvidence,
    ...pack.classroomEvidence
  ]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subject: item.subject,
      at: item.at,
      text: item.summary || item.cause || item.title,
      evidenceRefs: [item.id],
      confidence: item.confidence || "supported"
    }));
}

function buildSampleLimitNotes(pack) {
  const notes = [];
  if (pack.sourceQuality.hasSparseEvidence) notes.push("本周期有效学习事件少于 3 条，建议按轻量反馈发布。");
  if (pack.sourceQuality.missingSubjects.length) notes.push(`缺少${pack.sourceQuality.missingSubjects.join("、")}记录，不建议生成强结论。`);
  if (pack.blockedEvidence.length) notes.push("存在未复核或低置信来源，已阻断进入学生/家长端。");
  return notes;
}

function buildMastery(pack) {
  return Object.fromEntries(SUBJECTS.map((subject) => {
    const refs = subjectRefs(pack, subject);
    return [subject, Math.min(95, 62 + refs.length * 8)];
  }));
}

function computeScore(pack) {
  const total = pack.taskEvidence.length + pack.gradingEvidence.length + pack.mistakeEvidence.length + pack.qaEvidence.length;
  return Math.min(95, 65 + total * 4);
}

function collectRefs(pack) {
  return [...pack.taskEvidence, ...pack.gradingEvidence, ...pack.mistakeEvidence, ...pack.qaEvidence, ...pack.classroomEvidence].map((item) => item.id);
}

function subjectRefs(pack, subject) {
  return [...pack.taskEvidence, ...pack.gradingEvidence, ...pack.mistakeEvidence, ...pack.qaEvidence, ...pack.classroomEvidence]
    .filter((item) => item.subject === subject)
    .map((item) => item.id);
}

function hasSubjectEvidence(subject, groups) {
  return Object.values(groups).some((items) => items.some((item) => item.subject === subject));
}

function withEvidence(text, evidenceRefs, confidence) {
  return { text, evidenceRefs, confidence };
}

function withSubjectEvidence(subject, text, evidenceRefs, confidence) {
  return { subject, text, evidenceRefs, confidence };
}

function subjectFromValue(value) {
  const text = String(value || "");
  if (text.includes("语文") || text.toLowerCase().includes("chinese")) return "语文";
  if (text.includes("数学") || text.toLowerCase().includes("math")) return "数学";
  if (text.includes("英语") || text.toLowerCase().includes("english")) return "英语";
  return "";
}

function extractKnowledgePoints(result) {
  const questions = Array.isArray(result.questionResults) ? result.questionResults : [];
  return questions.map((item) => item.knowledgePoint || item.point).filter(Boolean).slice(0, 5);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mergePublishedView(baseView, draftView) {
  const base = safeObject(baseView);
  const draft = safeObject(draftView);
  if (!Object.keys(draft).length) return base;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(draft).filter(([, value]) => value != null)
    )
  };
}

function mergeTeacherReview(baseReview, draftReview) {
  const base = safeObject(baseReview);
  const draft = safeObject(draftReview);
  if (!Object.keys(draft).length) return base;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(draft).filter(([, value]) => value != null)
    )
  };
}

function mergeNarrative(baseSnapshot, draft) {
  const baseNarrative = safeObject(baseSnapshot.narrative);
  if (!draft.publishedView && !draft.teacherReview) return baseNarrative;
  const overview = safeObject(draft.publishedView?.overview);
  const teacherChecklist = Array.isArray(draft.teacherReview?.publishChecklist) ? draft.teacherReview.publishChecklist : [];
  return {
    ...baseNarrative,
    ...(overview.text ? { parentSummary: overview.text } : {}),
    ...(teacherChecklist.length ? { teacherSummary: teacherChecklist.map((item) => safeObject(item).text).filter(Boolean).join("；") } : {})
  };
}

function isMatchingPeriod(basePeriod, draftPeriod) {
  const base = safeObject(basePeriod);
  const draft = safeObject(draftPeriod);
  return Boolean(base.type && draft.type === base.type && draft.start === base.start && draft.end === base.end);
}

function removeInternalFields(value) {
  if (Array.isArray(value)) return value.map((item) => removeInternalFields(item));
  if (!value || typeof value !== "object") return value;
  const hiddenKeys = new Set(["provider", "providerId", "model", "modelRunId", "baseUrl", "raw", "debug", "prompt"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !hiddenKeys.has(key))
      .map(([key, item]) => [key, removeInternalFields(item)])
  );
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value) {
  const date = toDate(value);
  return date ? date.toISOString() : new Date().toISOString();
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sectionList(title, items = []) {
  const visible = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!visible.length) return "";
  return `<h2>${escapeHtml(title)}</h2>${visible.map((item) => detailCard(item)).join("")}`;
}

function detailCard(item) {
  const value = safeObject(item);
  const title = value.title || value.subject || "";
  const text = value.text || value.observation || value.summary || "";
  const evidence = value.evidence || value.evidenceSummary || "";
  const nextStep = value.nextStep || value.nextClassAction || "";
  return `<div class="section card">${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${text ? `<p>${escapeHtml(text)}</p>` : ""}${evidence ? `<p><strong>依据</strong>：${escapeHtml(evidence)}</p>` : ""}${nextStep ? `<p><strong>下一步</strong>：${escapeHtml(nextStep)}</p>` : ""}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
