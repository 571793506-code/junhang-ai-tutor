import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateStudentProfilePublish,
  markStudentProfileTeacherConfirmation
} from "./student-profile-publish-gate.js";

test("unreviewed grading and low-confidence evidence block public profile publishing", () => {
  const result = evaluateStudentProfilePublish({
    draftStatus: "draft",
    teacherReview: { status: "pending", pendingConfirmations: [{ title: "第2题", reason: "低置信" }] },
    profileEvidencePack: {
      submissions: [{ id: "sub_1", archiveEligible: false, needsTeacherReview: true }],
      blockedEvidence: [{ sourceId: "sub_1", reason: "low_confidence" }]
    },
    publishedView: { overview: { text: "不可直接发布" } }
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("TEACHER_CONFIRMATION_REQUIRED"));
  assert.deepEqual(result.excludedEvidenceRefs, ["sub_1"]);
});

test("teacher confirmation records identity and time without exposing evidence to students", () => {
  const snapshot = { teacherReview: { status: "pending" }, profileEvidencePack: { blockedEvidence: [] } };
  const confirmed = markStudentProfileTeacherConfirmation(snapshot, "teacher_1", "2026-09-07T10:00:00.000Z");
  assert.equal(confirmed.teacherReview.status, "confirmed");
  assert.equal(confirmed.teacherReview.confirmedByTeacherId, "teacher_1");
  assert.equal(confirmed.teacherReview.confirmedAt, "2026-09-07T10:00:00.000Z");
});

test("confirmed teacher review can publish while excluding blocked evidence", () => {
  const result = evaluateStudentProfilePublish({
    teacherReview: { status: "confirmed" },
    profileEvidencePack: { blockedEvidence: [{ id: "qa_1", reason: "identity-unconfirmed" }] },
    publishedView: { overview: { text: "继续观察" } }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.excludedEvidenceRefs, ["qa_1"]);
});
