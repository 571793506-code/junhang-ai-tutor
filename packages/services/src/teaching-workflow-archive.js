import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createTeachingWorkflowValidator } from "./teaching-workflow-validation.js";

const SCHEMA = "teaching-workflow-archive-v1";
const CONFIRMATION = new Set(["reviewedByTeacher", "confirmedBy", "confirmedAt", "teacherConfirmation", "reviewedAt"]);
const text = (value) => typeof value === "string" && Boolean(value.trim());
const revision = (value) => Number.isSafeInteger(value) && value > 0;
const clone = (value) => structuredClone(value);
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(record) {
  const { fingerprint: ignored, ...payload } = record;
  return `sha256:${createHash("sha256").update(stable(payload)).digest("hex")}`;
}
function content(question) {
  return Object.fromEntries(Object.entries(question).filter(([key]) => !CONFIRMATION.has(key)));
}
function confirmed(question, teacherId) {
  return question?.reviewedByTeacher === true && question.confirmedBy === teacherId &&
    ["correct", "wrong", "partial"].includes(question.status) && typeof question.score === "number" && Number.isFinite(question.score) &&
    typeof question.maxScore === "number" && Number.isFinite(question.maxScore) && question.maxScore > 0 && question.score >= 0 && question.score <= question.maxScore;
}
function valid(record) {
  return record?.schemaVersion === SCHEMA && [record.id, record.workflowId, record.studentId, record.teacherId, record.sourceFingerprint].every(text) &&
    revision(record.revision) && text(record.confirmedAt) && Number.isFinite(Date.parse(record.confirmedAt)) &&
    Array.isArray(record.supersedesArchiveIds) && record.supersedesArchiveIds.every(text) && !record.supersedesArchiveIds.includes(record.id) &&
    new Set(record.supersedesArchiveIds).size === record.supersedesArchiveIds.length &&
    record.snapshot?.gradingSourcePackage?.fingerprint === record.sourceFingerprint &&
    Array.isArray(record.snapshot?.questions) && record.snapshot.questions.length > 0 && record.snapshot.questions.every((q) => confirmed(q, record.teacherId)) &&
    record.fingerprint === fingerprint(record);
}
function sameScope(a, b) {
  return a.workflowId === b.workflowId && a.studentId === b.studentId && a.teacherId === b.teacherId;
}
function evidence(snapshot) {
  // Compare every top-level evidence field, including future image/OCR fields.
  // Only server bookkeeping and per-question/derived review fields are excluded.
  const derived = new Set(["questions", "score", "finalScore", "needsTeacherReview", "archiveEligible", "resolvedRequest", "workflowArchive", "creationPending",
    "provisionalScore", "reviewStatus", "reviewedByTeacherId", "reviewedAt", "archivePublishedAt"]);
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => !derived.has(key)));
}
function invalid() { throw Object.assign(new Error("WORKFLOW_ARCHIVE_INVALID"), { code: "WORKFLOW_ARCHIVE_INVALID" }); }

// Prepare an immutable record from an authorized server snapshot. Persistence and
// publication gates belong to the caller's transaction; a hash is not authorization.
export async function buildTeachingWorkflowArchive({ actor, workflow, snapshot, submissionId, confirmedAt, previousArchive = null, resolveGradingSource = null }) {
  if (!text(actor?.teacherId) || workflow?.module !== "grading" || workflow.ownerTeacherId !== actor.teacherId ||
    !text(workflow.id) || !revision(workflow.currentRevision) || !text(workflow.request?.studentId) || !text(submissionId) ||
    !text(confirmedAt) || !Number.isFinite(Date.parse(confirmedAt)) || typeof resolveGradingSource !== "function" ||
    !Array.isArray(snapshot?.questions) || !snapshot.questions.length || !snapshot.questions.every((q) => confirmed(q, actor.teacherId))) invalid();
  const validated = await createTeachingWorkflowValidator({ resolveGradingSource })(snapshot, {
    actor, workflow, request: workflow.request, module: "grading", nextRevision: workflow.currentRevision
  });
  if (!validated.ok) invalid();
  const record = { schemaVersion: SCHEMA, id: submissionId, workflowId: workflow.id, revision: workflow.currentRevision,
    studentId: workflow.request.studentId, teacherId: actor.teacherId, sourceFingerprint: validated.snapshot.gradingSourcePackage.fingerprint,
    confirmedAt, supersedesArchiveIds: [], snapshot: validated.snapshot };
  if (previousArchive) {
    if (!valid(previousArchive) || !sameScope(record, previousArchive) || record.id === previousArchive.id || record.revision <= previousArchive.revision) invalid();
    record.supersedesArchiveIds = [...previousArchive.supersedesArchiveIds, previousArchive.id];
  }
  delete record.snapshot.workflowArchive;
  record.fingerprint = fingerprint(record);
  return clone(record);
}

// archive must come from a separate, authorized server lookup, never imported JSON.
export function reuseArchivedQuestionConfirmations({ actor, request = {}, snapshot, archive }) {
  const next = clone(snapshot);
  next.questions = (next.questions || []).map(content);
  if (!valid(archive) || archive.teacherId !== actor?.teacherId || archive.studentId !== request.studentId || archive.id !== request.submissionId ||
    archive.sourceFingerprint !== next.gradingSourcePackage?.fingerprint || !isDeepStrictEqual(evidence(archive.snapshot), evidence(next))) return next;
  const byId = new Map(archive.snapshot.questions.map((q) => [q.id, q]));
  next.questions = next.questions.map((q) => {
    const saved = byId.get(q.id);
    if (!saved || !isDeepStrictEqual(content(saved), q)) return q;
    return { ...q, reviewedByTeacher: true, confirmedBy: archive.teacherId, confirmedAt: archive.confirmedAt,
      teacherConfirmation: { actorTeacherId: archive.teacherId, archiveId: archive.id, archiveRevision: archive.revision } };
  });
  return next;
}

// Use all available archive versions before applying period windows. Legacy records
// stay unchanged. Missing or conflicting versioned evidence fails closed.
export function isTeachingWorkflowArchiveSubmission(submission, studentId) {
  const record = submission?.content?.workflowArchive;
  const result = submission?.grading?.result;
  return Boolean(valid(record) && record.id === submission.id && record.studentId === studentId &&
    (!submission.studentId || submission.studentId === studentId) && ["GRADED", "REVIEWED"].includes(submission.status) &&
    result?.archiveEligible === true && result.needsTeacherReview !== true && result.provisionalScore == null &&
    String(result.confidence || "").toLowerCase() !== "low" && submission.grading.score === record.snapshot.finalScore &&
    isDeepStrictEqual(result.questions, record.snapshot.questions) && isDeepStrictEqual(evidence(result), evidence(record.snapshot)) &&
    result.gradingSourcePackage?.fingerprint === record.sourceFingerprint);
}

export function selectCurrentTeachingEvidence(student) {
  const submissions = student.submissions || [];
  const groups = new Map();
  const known = new Set();
  const issues = new Map((student.teachingArchiveIssues || []).map((item) => [item.id, { id: item.id, code: item.code }]));
  const block = (id, code) => issues.set(id, { id, code });
  for (const submission of submissions) {
    const record = submission.content?.workflowArchive;
    if (!record) continue;
    known.add(submission.id);
    if (!isTeachingWorkflowArchiveSubmission(submission, student.id)) {
      block(submission.id, "WORKFLOW_ARCHIVE_EVIDENCE_INVALID");
      continue;
    }
    const key = JSON.stringify([record.teacherId, record.studentId, record.workflowId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const allArchives = new Map([...groups.values()].flat().map((record) => [record.id, record]));
  const current = new Set(); const superseded = new Set();
  for (const records of groups.values()) {
    records.sort((a, b) => b.revision - a.revision);
    const latest = records[0];
    if (latest.supersedesArchiveIds.some((id) => {
      const previous = allArchives.get(id);
      return !previous || !sameScope(latest, previous) || previous.revision >= latest.revision;
    })) {
      records.forEach((r) => block(r.id, "WORKFLOW_ARCHIVE_ANCESTRY_INVALID"));
      continue;
    }
    // A fork or duplicate revision cannot silently replace another archive.
    if (records.slice(1).some((r) => r.revision >= latest.revision || !latest.supersedesArchiveIds.includes(r.id))) {
      records.forEach((r) => block(r.id, "WORKFLOW_ARCHIVE_VERSION_CONFLICT"));
      continue;
    }
    current.add(latest.id);
    latest.supersedesArchiveIds.forEach((id) => superseded.add(id));
  }
  return { ...student,
    teachingArchiveIssues: [...issues.values()],
    submissions: submissions.filter((s) => !superseded.has(s.id) && (!known.has(s.id) || current.has(s.id))),
    mistakes: (student.mistakes || []).filter((m) => {
      if (m.studentId && m.studentId !== student.id) return false;
      const meta = m.metadata || {};
      if (meta.workflowArchiveId && meta.sourceSubmissionId && meta.workflowArchiveId !== meta.sourceSubmissionId) return false;
      const id = meta.workflowArchiveId || meta.sourceSubmissionId || meta.submissionId;
      if (superseded.has(id)) return false;
      if (meta.workflowArchiveId || known.has(id)) return current.has(id);
      return true;
    })
  };
}
