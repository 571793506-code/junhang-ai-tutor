function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function evaluateStudentProfilePublish(snapshot = {}) {
  const source = asRecord(snapshot);
  const review = asRecord(source.teacherReview);
  const pack = asRecord(source.profileEvidencePack);
  const blocked = Array.isArray(pack.blockedEvidence) ? pack.blockedEvidence : [];
  const submissions = Array.isArray(pack.submissions) ? pack.submissions : [];
  const excludedEvidenceRefs = [...new Set([
    ...blocked.map((item) => item?.sourceId || item?.id || item?.ref),
    ...submissions.filter((item) => item?.archiveEligible === false || item?.needsTeacherReview === true).map((item) => item?.sourceId || item?.id || item?.ref)
  ].filter(Boolean).map(String))];
  const blockers = [];
  if (review.status !== "confirmed" && (blocked.length || (Array.isArray(review.pendingConfirmations) && review.pendingConfirmations.length))) {
    blockers.push("TEACHER_CONFIRMATION_REQUIRED");
  }
  if (excludedEvidenceRefs.length && review.status !== "confirmed" && !blockers.includes("TEACHER_CONFIRMATION_REQUIRED")) {
    blockers.push("PROFILE_EVIDENCE_REVIEW_REQUIRED");
  }
  if (!source.publishedView || typeof source.publishedView !== "object") blockers.push("PUBLISHED_VIEW_REQUIRED");
  return { ok: blockers.length === 0, blockers, excludedEvidenceRefs };
}

export function markStudentProfileTeacherConfirmation(snapshot = {}, teacherId = "", now = new Date().toISOString()) {
  const source = asRecord(snapshot);
  const review = asRecord(source.teacherReview);
  return {
    ...source,
    teacherReview: {
      ...review,
      status: "confirmed",
      confirmedByTeacherId: String(teacherId || "").trim() || null,
      confirmedAt: now instanceof Date ? now.toISOString() : String(now)
    }
  };
}
