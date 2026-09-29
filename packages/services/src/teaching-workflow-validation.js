import { buildGradingSourcePackage, validateGradingSourcePackage, inspectEncodingPayload, teachingExplanationContent, assessmentScoreIssues, assessmentChoiceOptionsValid, normalizeAssessmentAnswerFormat } from "@junhang/core";
import { isDeepStrictEqual } from "node:util";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && Boolean(value.trim());
const meaningful = (value) => text(value) || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean" ||
  (Array.isArray(value) && value.some(meaningful)) || (object(value) && Object.values(value).some(meaningful));
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const texts = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const equal = isDeepStrictEqual;
const ownOr = (source, key, fallback) => Object.hasOwn(source, key) ? source[key] : fallback;
const PRIVATE = /^(raw(?:Output|Payload)?|debug|apiKey|authorization|sessionToken|databaseUrl|systemPrompt|promptConfig)$/i;
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE.test(key) && !["__proto__", "constructor", "prototype"].includes(key)).map(([key, entry]) => [key, clean(entry)]));
  return value;
}

function normalizeQuestions(snapshot, module) {
  const items = snapshot.questions ?? (module === "generation" ? snapshot.items : snapshot.questionResults);
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    if (!object(item)) return {};
    const metadata = object(item.metadata) ? item.metadata : {};
    const q = { ...item, id: String(item.id ?? item.questionNo ?? item.orderIndex ?? index + 1), questionNo: String(item.questionNo ?? item.orderIndex ?? index + 1) };
    delete q.metadata;
    if (module === "generation") {
      if (Object.hasOwn(item, "answerFormat") || Object.hasOwn(metadata, "answerFormat")) q.answerFormat = normalizeAssessmentAnswerFormat(ownOr(item, "answerFormat", metadata.answerFormat));
      q.answer = ownOr(item, "answer", item.correctAnswer ?? metadata.answer);
      q.score = ownOr(item, "score", item.maxScore ?? metadata.score);
      for (const key of ["analysisSteps", "rubric", "knowledgePoint", "commonMistake"]) q[key] = ownOr(item, key, metadata[key]);
    }
    return q;
  });
}

// Content checks do not replace server authorization, source resolution or archive gates.
export function createTeachingWorkflowValidator({ resolveGradingSource = null } = {}) {
  return async function validateTeachingWorkflowSnapshot(input, context = {}) {
    const issues = [];
    const issue = (code, questionId) => issues.push({ code, ...(questionId ? { questionId } : {}) });
    const module = context.module || context.workflow?.module;
    const workflowId = context.workflow?.id;
    const revision = context.nextRevision;
    if (!object(input) || !["generation", "grading"].includes(module) || !text(workflowId) || !Number.isSafeInteger(revision) || revision < 1) return { ok: false, issues: [{ code: "WORKFLOW_VALIDATION_CONTEXT_INVALID" }] };
    const snapshot = clean(structuredClone(input));
    if (snapshot.creationPending) return { ok: false, issues: [{ code: "WORKFLOW_CREATION_INCOMPLETE" }] };
    snapshot.questions = normalizeQuestions(snapshot, module);
    delete snapshot.items;
    delete snapshot.questionResults;
    delete snapshot.answerKey;
    if (object(snapshot.metadata)) { delete snapshot.metadata.answerKey; delete snapshot.metadata.gradingSourcePackage; }
    const request = context.request || context.workflow?.request || {};
    if (module === "generation") {
      snapshot.subject = snapshot.subject || request.subject;
      snapshot.grade = snapshot.grade || request.grade;
      snapshot.purpose = snapshot.purpose || request.purpose || "comprehensive";
      if (!["focused", "multi_day", "comprehensive", "explanation"].includes(snapshot.purpose) ||
        (request.purpose !== undefined && request.purpose !== snapshot.purpose)) issue("GENERATION_PURPOSE_INVALID");
      if (!text(snapshot.title) || !text(snapshot.subject) || !text(String(snapshot.grade ?? ""))) issue("GENERATION_HEADER_INCOMPLETE");
      delete snapshot.gradingSourcePackage;
      delete snapshot.gradingSource;
      if (snapshot.purpose === "explanation") {
        const e = snapshot.explanation || snapshot.parsed?.explanation;
        if (!object(e) || !text(e.concept) || !texts(e.steps) || !texts(e.commonMistakes) || !Array.isArray(e.workedExamples) || !e.workedExamples.length ||
          e.workedExamples.some((example) => !text(example?.prompt) || !meaningful(example.answer) || !texts(example.analysisSteps))) issue("GENERATION_EXPLANATION_INCOMPLETE");
        snapshot.explanation = teachingExplanationContent(e);
        if (snapshot.explanation && e.reviewedByTeacher === true && e.confirmedBy === context.actor?.teacherId && e.teacherConfirmation?.actorTeacherId === context.actor?.teacherId && text(context.actor?.teacherId)) {
          Object.assign(snapshot.explanation, { reviewedByTeacher: true, confirmedBy: e.confirmedBy, teacherConfirmation: { actorTeacherId: e.confirmedBy } });
        }
        snapshot.questions = [];
        snapshot.sharedMaterials = [];
        snapshot.days = [];
        snapshot.needsTeacherReview = snapshot.explanation?.reviewedByTeacher !== true;
        delete snapshot.parsed;
        snapshot.gradingSourcePackageRequired = false;
        delete snapshot.totalScore;
      } else {
        const materials = new Map(); const days = new Map();
        for (const [field, key, target] of [["sharedMaterials", "id", materials], ["days", "dayId", days]]) {
          if (snapshot[field] !== undefined && !Array.isArray(snapshot[field])) issue("GENERATION_DEPENDENCY_INVALID");
          for (const entry of Array.isArray(snapshot[field]) ? snapshot[field] : []) {
            if (!text(entry?.[key]) || target.has(entry[key])) issue("GENERATION_DEPENDENCY_INVALID");
            else target.set(entry[key], entry);
          }
        }
        const ids = new Set(); const numbers = new Set();
        if (!snapshot.questions.length) issue("GENERATION_QUESTIONS_REQUIRED");
        for (const q of snapshot.questions) {
          if (!text(q.id) || ids.has(q.id) || !text(q.questionNo) || numbers.has(q.questionNo)) issue("WORKFLOW_QUESTION_ID_INVALID", q.id);
          ids.add(q.id); numbers.add(q.questionNo);
          if (!text(q.prompt) || !meaningful(q.answer) || !positive(q.score) || !texts(q.analysisSteps) || !meaningful(q.rubric) || !text(q.knowledgePoint) || !text(q.commonMistake)) issue("GENERATION_QUESTION_INCOMPLETE", q.id);
          if (assessmentScoreIssues(q).some((code) => code !== "item_score_missing")) issue("GENERATION_SCORE_CONFLICT", q.id);
          if (q.itemType === "choice" && !assessmentChoiceOptionsValid(q.options)) issue("GENERATION_OPTIONS_REQUIRED", q.id);
          if (/如图|图中|画图/.test(q.prompt || "") && !object(q.figure)) issue("GENERATION_FIGURE_REQUIRED", q.id);
          if ((q.correctAnswer !== undefined && !equal(q.answer, q.correctAnswer)) || (q.maxScore !== undefined && q.maxScore !== q.score)) issue("GENERATION_QUESTION_FIELDS_CONFLICT", q.id);
          if (q.sharedMaterialId && (!materials.has(q.sharedMaterialId) || !text(materials.get(q.sharedMaterialId).text))) issue("GENERATION_MATERIAL_MISSING", q.id);
          if (q.dayId && !days.has(q.dayId)) issue("GENERATION_DAY_MISSING", q.id);
        }
        const total = snapshot.questions.reduce((sum, q) => sum + (positive(q.score) ? q.score : 0), 0);
        if (!positive(total) || (snapshot.totalScore !== undefined && (!positive(snapshot.totalScore) || Math.abs(snapshot.totalScore - total) > 0.001))) issue("GENERATION_TOTAL_SCORE_INVALID");
        if (!issues.length) {
          const built = buildGradingSourcePackage({ id: workflowId, title: snapshot.title, subject: { name: snapshot.subject }, grade: snapshot.grade,
            metadata: { kind: snapshot.kind || request.kind, totalScore: total }, items: snapshot.questions.map((q) => ({
              ...q, metadata: {}, orderIndex: q.questionNo,
              sourceContext: { questionId: q.id, commonMistake: q.commonMistake, ...(q.answerFormat ? { answerFormat: q.answerFormat } : {}), ...(q.itemType ? { itemType: q.itemType } : {}), ...(q.options ? { options: q.options } : {}), ...(q.figure ? { figure: q.figure } : {}),
                ...(q.sharedMaterialId ? { sharedMaterial: materials.get(q.sharedMaterialId) } : {}), ...(q.dayId ? { day: days.get(q.dayId) } : {}) }
            })) }, { version: revision });
          if (!built.ok) issue("GENERATION_SOURCE_INVALID");
          else { snapshot.gradingSourcePackage = built.package; snapshot.totalScore = total; snapshot.gradingSourcePackageRequired = true; }
        }
      }
    } else {
      const source = resolveGradingSource ? await resolveGradingSource(context) : null;
      if (source != null && (!validateGradingSourcePackage(source).ok || !Number.isSafeInteger(source.version) || source.version < 1 || !positive(source.totalScore) ||
        !Array.isArray(source.questions) || source.questions.some((q) => !object(q) || !text(q.questionNo) || !text(q.prompt) || !positive(q.maxScore) || !meaningful(q.correctAnswer)) ||
        new Set(source.questions.map((q) => q.questionNo)).size !== source.questions.length ||
        Math.abs(source.questions.reduce((sum, q) => sum + q.maxScore, 0) - source.totalScore) > 0.001)) {
        return { ok: false, issues: [{ code: "GRADING_SOURCE_INVALID" }] };
      }
      if (snapshot.gradingSourcePackage && (!source || snapshot.gradingSourcePackage.fingerprint !== source.fingerprint)) issue("GRADING_SOURCE_CHANGED");
      const byNo = new Map((source?.questions || []).map((q) => [q.questionNo, q]));
      const ids = new Set(); const numbers = new Set();
      if (!snapshot.questions.length) issue("GRADING_QUESTIONS_REQUIRED");
      for (const q of snapshot.questions) {
        if (!text(q.id) || ids.has(q.id) || !text(q.questionNo) || numbers.has(q.questionNo)) issue("WORKFLOW_QUESTION_ID_INVALID", q.id);
        ids.add(q.id); numbers.add(q.questionNo);
        const reference = byNo.get(q.questionNo);
        if (!["correct", "wrong", "partial", "uncertain"].includes(q.status) || !text(q.explanation)) issue("GRADING_RESULT_INCOMPLETE", q.id);
        if (q.status === "uncertain") {
          if (q.score !== null || q.reviewedByTeacher === true || (context.command?.action === "confirm" && context.command.targetQuestionIds?.includes(q.id))) issue("GRADING_UNCERTAIN_NOT_CONFIRMABLE", q.id);
          if (!reference && (q.correctAnswer != null || q.maxScore != null)) issue("GRADING_EVIDENCE_REQUIRED", q.id);
        } else {
          // An intentional blank string is an observed blank answer; null is missing evidence.
          if (!reference || !(typeof q.studentAnswer === "string" || meaningful(q.studentAnswer)) || !text(q.printedPrompt || q.prompt) || !text(q.knowledgePoint)) issue("GRADING_EVIDENCE_REQUIRED", q.id);
          const recognitionCorrected = q.studentAnswerReview?.actorTeacherId === context.actor?.teacherId && text(context.actor?.teacherId)
            && equal(q.studentAnswerReview?.studentAnswer, q.studentAnswer);
          const prior = context.workflow?.snapshot?.questions?.find((old) => old.id === q.id);
          const inheritedReview = prior?.reviewedByTeacher === true && q.reviewedByTeacher === true && prior.confirmedBy === context.actor?.teacherId && equal(prior.studentAnswer, q.studentAnswer);
          if (context.command && q.confidence != null && (!Number.isFinite(q.confidence) || q.confidence < 0.62) && !recognitionCorrected && !inheritedReview) issue("GRADING_RECOGNITION_REVIEW_REQUIRED", q.id);
          if (!positive(q.maxScore) || typeof q.score !== "number" || !Number.isFinite(q.score) || q.score < 0 || q.score > q.maxScore ||
            (q.status === "correct" && q.score !== q.maxScore) || (q.status === "wrong" && q.score !== 0) || (q.status === "partial" && !(q.score > 0 && q.score < q.maxScore))) issue("GRADING_SCORE_INVALID", q.id);
        }
        if (reference && (q.maxScore !== reference.maxScore || (q.correctAnswer !== undefined && !equal(q.correctAnswer, reference.correctAnswer)))) issue("GRADING_REFERENCE_CONFLICT", q.id);
      }
      if (source && (source.questions.length !== snapshot.questions.length || source.questions.some((q) => !numbers.has(q.questionNo)))) issue("GRADING_QUESTION_COVERAGE_INVALID");
      const resolved = snapshot.questions.length > 0 && snapshot.questions.every((q) => q.status !== "uncertain");
      snapshot.score = resolved ? Number(snapshot.questions.reduce((sum, q) => sum + q.score, 0).toFixed(6)) : null;
      snapshot.finalScore = resolved && snapshot.questions.every((q) => q.reviewedByTeacher === true) ? snapshot.score : null;
      snapshot.needsTeacherReview = !resolved || snapshot.questions.some((q) => q.reviewedByTeacher !== true);
      snapshot.archiveEligible = false;
      if (source) snapshot.gradingSourcePackage = structuredClone(source);
      else delete snapshot.gradingSourcePackage;
    }
    if (!inspectEncodingPayload(snapshot, { maxIssues: 1 }).ok) issue("WORKFLOW_ENCODING_INVALID");
    return issues.length ? { ok: false, issues } : { ok: true, issues: [], snapshot };
  };
}
