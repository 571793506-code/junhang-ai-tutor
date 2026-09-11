import { validateGradingSourcePackage, normalizeTeachingPurpose } from "@junhang/core";

const MAX_SIGNALS = 40;
const MAX_KNOWLEDGE_POINTS = 30;
const MAX_GRADING_QUESTIONS = 80;
const MAX_TEXT_PREVIEW = 1800;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 2400) {
  return String(value ?? "").trim().slice(0, max);
}

function list(value, max = 30) {
  return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean).slice(0, max);
}

function boundedRecord(value, fields, maxText = 1800) {
  const source = record(value);
  return Object.fromEntries(fields
    .map(([key, sourceKey = key]) => [key, source[sourceKey]])
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, typeof value === "string" ? text(value, maxText) : value]));
}

function summarizeContentContext(value) {
  const source = record(value);
  const matches = (Array.isArray(source.matches) ? source.matches : []).slice(0, 8).map((match) => {
    const item = record(match);
    const chunks = Array.isArray(item.chunks) ? item.chunks : [];
    const excerpt = text(item.excerpt || item.summary || chunks[0]?.preview || chunks[0]?.text, MAX_TEXT_PREVIEW);
    return {
      sourceId: text(item.sourceId || item.id, 180),
      title: text(item.title, 240),
      sourceType: text(item.sourceType, 120),
      subject: text(item.subject, 80),
      grade: text(item.grade, 80),
      edition: text(item.edition, 120),
      volume: text(item.volume, 80),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : undefined,
      knowledgePoints: list(item.knowledgePoints, MAX_KNOWLEDGE_POINTS),
      chunkCount: Number(item.chunkCount || chunks.length) || 0,
      excerpt
    };
  });
  const status = source.status || (source.approvedOnly === true && matches.length ? "approved" : source.reason ? "blocked" : "missing");
  return {
    status: text(status, 40),
    reason: text(source.reason, 120) || null,
    approvedOnly: source.approvedOnly === true,
    sourceCount: Number(source.sourceCount ?? source.matchedCount ?? matches.length) || 0,
    sourceIds: matches.map((match) => match.sourceId).filter(Boolean),
    matchedCount: Number(source.matchedCount ?? matches.length) || 0,
    textbookContext: boundedRecord(source.textbookContext, [
      ["resolved"], ["assetId"], ["title"], ["subject"], ["grade"], ["edition"],
      ["editionDisplay"], ["curriculumSeries"], ["curriculumRegion"], ["volume"],
      ["chapterId"], ["chapterTitle"], ["baselineMatched"]
    ], 240),
    matches
  };
}

function normalizeSignals(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_SIGNALS).map((item) => {
    const source = record(item);
    return boundedRecord(source, [
      ["type"], ["ref"], ["evidenceRef"], ["evidenceRefs"], ["sourceRefs"], ["subject"], ["title"], ["knowledgePoint"], ["prompt"] , ["cause"],
      ["summary"], ["reason"], ["score"], ["status"], ["description"]
    ], 600);
  }).filter((item) => Object.keys(item).length);
}

export function buildGenerationContext(input = {}, options = {}) {
  const source = record(input);
  const budget = record(options.generationBudget);
  const contentContext = summarizeContentContext(options.contentContext);
  const generationBasis = text(source.generationBasis || (source.textbookAssetId ? "textbook_reviewed" : "teacher_requirement"), 80);
  const requestId = text(source.requestId, 120);
  const kind = text(source.kind, 40);
  const textbook = {
    assetId: text(source.textbookAssetId, 180) || null,
    title: text(source.textbookTitle, 240) || null,
    edition: text(source.textbookEdition, 120) || null,
    series: text(source.textbookSeries, 120) || null,
    volume: text(source.textbookVolume, 80) || null,
    region: text(source.textbookRegion, 120) || null,
    chapterId: text(source.textbookChapterId, 180) || null,
    chapterTitle: text(source.textbookChapterTitle, 240) || null
  };
  const knowledgePoints = list(source.knowledgePoints, MAX_KNOWLEDGE_POINTS);
  const generationContext = {
    request: {
      ...normalizeTeachingPurpose(source),
      requestId: requestId || null,
      requirement: text(source.requirement || source.specialRequirements, MAX_TEXT_PREVIEW),
      kind: kind || null,
      difficulty: text(source.difficulty, 80) || null,
      generationBasis,
      recoveryReason: text(source.recoveryReason, 180) || null
    },
    target: {
      subject: text(source.subject, 80) || null,
      grade: text(source.grade || source.targetGrade, 80) || null,
      scope: text(source.targetScope, 40) || null,
      studentId: text(source.studentId, 180) || null
    },
    teaching: {
      textbook,
      textbookAssetId: textbook.assetId,
      textbookTitle: textbook.title,
      textbookEdition: textbook.edition,
      textbookSeries: textbook.series,
      textbookVolume: textbook.volume,
      textbookRegion: textbook.region,
      textbookChapterId: textbook.chapterId,
      textbookChapterTitle: textbook.chapterTitle,
      knowledgePoints,
      contentContext,
      evidence: {
        basis: generationBasis,
        recoveryReason: text(source.recoveryReason, 180) || null
      }
    },
    studentSignals: normalizeSignals(options.studentSignals),
    output: {
      paper: "A4",
      kind: kind || null,
      requestedItemCount: Number(source.requestedItemCount) > 0 ? Number(source.requestedItemCount) : null,
      generationProfile: text(budget.profile, 80) || null,
      assessmentTotalTimeoutMs: Number(budget.assessmentTotalTimeoutMs) || null,
      assessmentMaxTokens: Number(budget.assessmentMaxTokens) || null,
      teacherReviewRequired: true,
      includeAnswerAnalysis: true,
      includeStructuredAnswerPackage: true
    },
    rules: {
      repairRequired: true,
      hideProviderFromStudentAndParent: true,
      noDefaultBonusQuestions: true,
      teacherRequirementEmergency: generationBasis === "teacher_requirement_emergency"
    }
  };
  return { generationContext, generationBudget: budget };
}

function usableSourcePackage(value) {
  const source = record(value);
  return source.schemaVersion === "junhang-grading-source-v1"
    && Array.isArray(source.questions)
    && source.questions.length > 0
    && (!String(source.fingerprint || "").startsWith("sha256:") || validateGradingSourcePackage(source).ok);
}

export function buildSubmissionGradingContext(input = {}, options = {}) {
  const source = record(input);
  const packageValue = usableSourcePackage(source.gradingSourcePackage) ? source.gradingSourcePackage : null;
  const ocrQuestions = (Array.isArray(source.ocrQuestions) ? source.ocrQuestions : []).slice(0, MAX_GRADING_QUESTIONS);
  const references = (Array.isArray(source.referenceAnswers) ? source.referenceAnswers : []).slice(0, MAX_GRADING_QUESTIONS);
  const answerSource = packageValue ? "gradingSourcePackage" : references.length ? "referenceAnswers" : "missing";
  const referenceByNo = new Map((packageValue?.questions || references).map((item) => [String(item.questionNo || ""), item]));
  const unresolvedQuestionNos = ocrQuestions.filter((question) => {
    const questionNo = String(question.questionNo || question.no || "");
    return !questionNo || Number(question.confidence ?? 1) < 0.62 || !text(question.studentAnswer || question.studentAnswerText) || !text(question.printedText || question.printedPrompt);
  }).map((question) => String(question.questionNo || question.no || "")).filter(Boolean);
  if (packageValue) {
    for (const question of packageValue.questions) {
      const questionNo = String(question.questionNo || "");
      if (!ocrQuestions.some((item) => String(item.questionNo || item.no || "") === questionNo)) unresolvedQuestionNos.push(questionNo);
    }
  }
  const unresolved = [...new Set(unresolvedQuestionNos)].slice(0, MAX_GRADING_QUESTIONS);
  const questionLayoutManifest = options.questionLayoutManifest || source.questionLayoutManifest || null;
  const workflowState = answerSource === "missing" || unresolved.length ? "review_required" : "draft";
  return {
    gradingInput: {
      ...source,
      gradingSourcePackage: packageValue,
      referenceAnswers: references,
      referenceAnswerMode: packageValue ? "gradingSourcePackage" : references.length ? "reference" : "missing",
      ocrQuestions,
      questionLayoutManifest,
      remoteQuestionNos: unresolved,
      remoteQuestionPreviews: unresolved.map((questionNo) => {
        const question = ocrQuestions.find((item) => String(item.questionNo || item.no || "") === questionNo) || {};
        const reference = referenceByNo.get(questionNo) || {};
        return {
          questionNo,
          printedText: text(question.printedText || question.printedPrompt || reference.prompt, MAX_TEXT_PREVIEW),
          studentAnswerText: text(question.studentAnswer || question.studentAnswerText, MAX_TEXT_PREVIEW),
          correctAnswer: text(reference.correctAnswer, MAX_TEXT_PREVIEW)
        };
      })
    },
    unresolvedQuestionNos: unresolved,
    evidence: {
      answerSource,
      questionCount: packageValue?.questions.length || references.length || ocrQuestions.length,
      ocrQuestionCount: ocrQuestions.length,
      questionLayoutManifestPresent: Boolean(questionLayoutManifest)
    },
    policy: {
      teacherConfirmBeforeArchive: true,
      lowConfidenceNoFinalScore: true,
      deepAuditRequired: options.deepAuditRequired === true
    },
    workflowState
  };
}

export function buildStudentProfileContext(input = {}) {
  const source = record(input);
  const studentSource = record(source.student);
  const snapshotSource = record(source.snapshot);
  const evidence = record(source.profileEvidencePack);
  const confirmedEvidence = [
    ...boundedEvidenceList(evidence.confirmedEvidence, 80),
    ...boundedEvidenceList(evidence.taskEvidence, 40),
    ...boundedEvidenceList(evidence.gradingEvidence, 40),
    ...boundedEvidenceList(evidence.mistakeEvidence, 40),
    ...boundedEvidenceList(evidence.reportEvidence, 20),
    ...boundedEvidenceList(evidence.classroomEvidence, 20),
    ...boundedEvidenceList(evidence.teacherObservationEvidence, 20),
    ...boundedEvidenceList(evidence.qaEvidence, 20)
  ];
  const teacherReview = record(snapshotSource.teacherReview);
  return {
    student: boundedRecord(studentSource, [["id"], ["displayName"], ["grade"], ["className"], ["school"]], 180),
    period: boundedRecord(snapshotSource.period, [["type", "periodType"], ["label"], ["start"], ["end"]], 120),
    profileType: text(snapshotSource.profileType, 80) || null,
    snapshot: boundedRecord(snapshotSource, [["periodType"], ["sourceCounts"], ["strengths"], ["risks"], ["tone"]], 600),
    publishedView: boundedRecord(snapshotSource.publishedView, [
      ["overview"], ["subjectOverview"], ["focusSubjects"], ["correctionLoop"],
      ["stableGrowth"], ["tutoringFocus"], ["parentNextSteps"], ["timelinePreview"]
    ], 900),
    profileEvidencePack: {
      confirmedEvidence: normalizeSignals(confirmedEvidence).slice(0, 80),
      blockedEvidence: normalizeSignals(evidence.blockedEvidence).slice(0, 40),
      sourceQuality: boundedRecord(evidence.sourceQuality, [
        ["taskCount"], ["gradingCount"], ["mistakeCount"], ["qaCount"],
        ["classroomCount"], ["teacherObservationCount"], ["hasBlockedEvidence"],
        ["hasSparseEvidence"], ["missingSubjects"]
      ], 300)
    },
    teacherReview: boundedRecord(teacherReview, [
      ["sampleLimitNotes"], ["conflictNotes"], ["pendingConfirmations"], ["publishChecklist"]
    ], 700),
    output: {
      teacherConfirmationRequired: true,
      visibleConclusionFields: ["text", "evidenceRefs", "confidence"],
      confidenceLevels: ["confirmed", "supported", "weak", "blocked"]
    },
    rules: {
      teacherConfirmationRequired: true,
      rawBehaviorEventsExcluded: true,
      unconfirmedGradingExcluded: true,
      guardianFieldsExcluded: true
    }
  };
}

function boundedEvidenceList(value, max = 40) {
  return (Array.isArray(value) ? value : []).slice(0, max).map((item) => {
    const source = record(item);
    return {
      ...source,
      ref: text(source.ref || source.id || source.sourceEventId, 180) || null,
      evidenceRefs: Array.isArray(source.evidenceRefs)
        ? source.evidenceRefs.slice(0, 4).map((ref) => text(ref, 180)).filter(Boolean)
        : undefined,
      sourceRefs: Array.isArray(source.sourceRefs)
        ? source.sourceRefs.slice(0, 4).map((ref) => text(ref, 180)).filter(Boolean)
        : undefined
    };
  });
}
