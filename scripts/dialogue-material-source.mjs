import { createHash } from "node:crypto";
import { normalizeImportedGradingSourcePackage, validateGradingSourcePackage } from "../packages/core/src/grading-source-package.js";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
export const contentHash = (value) => createHash("sha256").update(value).digest("hex");

// Explicit adapter for the historical local writer. Unknown formats fail closed.
export function prepareDialogueMaterial(source, { sourceId, grade, kind } = {}) {
  let input = structuredClone(source);
  if (input.schemaVersion === "local-exam-source-v1") {
    const types = new Set(["fill", "choice", "calculation", "solution", "bonus"]);
    if (!input.questions?.length || input.questions.some(q => !types.has(q.kind) || q.number == null)) fail("DIALOGUE_LOCAL_QUESTION_INVALID");
    const base = input.questions.filter(q => q.kind !== "bonus");
    const bonus = input.questions.filter(q => q.kind === "bonus");
    if (base.length !== input.baseQuestionCount || bonus.length !== input.bonusQuestionCount ||
        base.reduce((n, q) => n + q.score, 0) !== input.baseScore ||
        bonus.reduce((n, q) => n + q.score, 0) !== input.bonusScore) fail("DIALOGUE_SCORE_PARTITION_INVALID");
    input = { ...input, schemaVersion: "junhang-grading-source-v1", kind: kind || "试卷",
      totalScore: input.baseScore + input.bonusScore,
      questions: input.questions.map(q => ({
        ...q, questionNo: String(q.number),
        // Keep the original kind, including bonus; do not invent process rubrics.
        context: { itemType: q.kind, options: q.options || [], commonMistake: q.commonMistake,
          scoreGroup: q.kind === "bonus" ? "bonus" : "base", numericChecks: q.numericChecks || [] }
      })) };
  } else if (input.schemaVersion !== "junhang-grading-source-v1") fail("DIALOGUE_SCHEMA_UNSUPPORTED");
  // Registration creates a new immutable source (v1); changes get a new source ID.
  if ((input.version || 1) !== 1) fail("DIALOGUE_VERSION_UNSUPPORTED");
  const normalized = normalizeImportedGradingSourcePackage({ ...input,
    grade: grade || input.grade, kind: kind || input.kind }, { sourceId: sourceId || input.sourceId || "dialogue-preview" });
  if (!normalized.ok) fail("DIALOGUE_SOURCE_INVALID");
  for (const q of normalized.package.questions) {
    if (!q.analysisSteps.length || !q.knowledgePoint || !q.rubric) fail("DIALOGUE_REVIEW_FIELDS_MISSING");
    if (q.context?.itemType === "choice" && !q.context.options?.length) fail("DIALOGUE_OPTIONS_MISSING");
  }
  return { ...normalized.package,
    ...(input.baseScore != null ? { baseScore: input.baseScore, bonusScore: input.bonusScore } : {}),
    teacherReviewRequired: true,
    provenance: { schemaVersion: source.schemaVersion, originalFingerprint: source.contentFingerprint || source.fingerprint || null,
      originalGrade: source.grade, generationContext: source.generationContext || null } };
}

export function resolveDialogueStudent(students, identity) {
  const matches = students.filter(s => s.id === identity || s.displayName === identity);
  if (matches.length !== 1) fail("DIALOGUE_STUDENT_AMBIGUOUS_OR_MISSING");
  if (!matches[0].canReceiveNewWork) fail("DIALOGUE_STUDENT_INACTIVE");
  return matches[0];
}

export async function registerDialogueMaterial({ baseUrl, sessionToken, source, studentIdentity, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) fail("DIALOGUE_API_URL_INVALID");
  if (!sessionToken) fail("SESSION_REQUIRED");
  const request = async (route, body) => {
    const response = await fetchImpl(new URL(route, base), { method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok || data.ok !== true) fail(`DIALOGUE_API_${response.status}`);
    return data;
  };
  const bootstrap = await request("/api/bootstrap");
  if (bootstrap.teachers?.length !== 1) fail("DIALOGUE_TEACHER_SESSION_REQUIRED");
  const student = resolveDialogueStudent(bootstrap.students || [], studentIdentity);
  const prepared = prepareDialogueMaterial(source, { sourceId: "dialogue-preview", grade: student.grade });
  // Database relation order is not part of material identity; explicit question numbers are.
  const preview = normalizeImportedGradingSourcePackage({ ...prepared,
    questions: [...prepared.questions].sort((a, b) => a.questionNo.localeCompare(b.questionNo, "en", { numeric: true })) },
    { sourceId: "dialogue-preview" }).package;
  const assignmentId = `dialogue-${contentHash(JSON.stringify([bootstrap.teachers[0].id, student.id, preview.fingerprint])).slice(0, 40)}`;
  let answerPackage = prepareDialogueMaterial(source, { sourceId: assignmentId, grade: student.grade });
  const verify = (assignment) => {
    if (!assignment || assignment.studentId !== student.id || assignment.gradingSource?.fingerprint !== answerPackage.fingerprint ||
        assignment.gradingSourceQuestionCount !== answerPackage.questions.length) fail("DIALOGUE_REGISTERED_SOURCE_MISMATCH");
    return assignment;
  };
  const registered = await request("/api/grading/source-packages/dialogue", { assignmentId, studentId: student.id, answerPackage });
  const stored = registered.gradingSourcePackage;
  if (!stored || !validateGradingSourcePackage(stored).ok || stored.sourceId !== assignmentId || stored.questions.length !== answerPackage.questions.length) fail("DIALOGUE_REGISTERED_SOURCE_MISMATCH");
  const byNo = new Map(stored.questions.map(q => [q.questionNo, q]));
  const aligned = normalizeImportedGradingSourcePackage({ ...stored,
    questions: answerPackage.questions.map(q => byNo.get(q.questionNo)) }, { sourceId: assignmentId });
  if (!aligned.ok || aligned.package.fingerprint !== answerPackage.fingerprint) fail("DIALOGUE_REGISTERED_SOURCE_MISMATCH");
  answerPackage = { ...answerPackage, ...stored };
  const assignment = registered.assignment;
  const replayed = registered.replayed === true;
  verify(assignment);
  return { assignment, answerPackage, replayed, student: { id: student.id, displayName: student.displayName, grade: student.grade } };
}
