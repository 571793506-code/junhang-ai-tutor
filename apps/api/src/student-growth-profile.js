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
  const merged = {
    ...base,
    publishedView: mergePublishedView(base.publishedView, draft.publishedView),
    teacherReview: mergeTeacherReview(base.teacherReview, draft.teacherReview),
    narrative: mergeNarrative(base, draft)
  };

  if (draft.profileType === base.profileType) merged.profileType = draft.profileType;
  if (isMatchingPeriod(base.period, draft.period)) merged.period = base.period;
  return removeInternalFields(merged);
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
