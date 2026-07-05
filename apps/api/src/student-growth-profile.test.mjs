import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfileEvidencePack,
  buildStudentGrowthSnapshot,
  filterStudentProfileSnapshot
} from "./student-growth-profile.js";

const now = new Date("2026-07-05T12:00:00.000Z");

function studentFixture() {
  return {
    id: "stu_1",
    displayName: "张思源",
    grade: "五年级",
    className: "周六上午班",
    textbookVersion: "人教版",
    tasks: [
      {
        id: "task_1",
        title: "数学两步应用题",
        status: "COMPLETED",
        createdAt: new Date("2026-07-03T09:00:00.000Z"),
        subject: { name: "数学" },
        description: "圈条件再列式"
      }
    ],
    submissions: [
      {
        id: "sub_ok",
        status: "REVIEWED",
        submittedAt: new Date("2026-07-04T09:00:00.000Z"),
        assignment: { title: "应用题练习", subject: { name: "数学" }, metadata: {} },
        grading: {
          score: 82,
          result: {
            summary: "应用题审题仍需关注。",
            archiveEligible: true,
            needsTeacherReview: false,
            confidence: "high",
            questionResults: [
              {
                knowledgePoint: "两步应用题",
                errorStep: "漏看条件",
                suggestedPractice: "先圈条件，再列式。"
              }
            ]
          }
        }
      },
      {
        id: "sub_blocked",
        status: "SUBMITTED",
        submittedAt: new Date("2026-07-04T10:00:00.000Z"),
        assignment: { title: "低置信识别", subject: { name: "语文" }, metadata: {} },
        grading: {
          score: null,
          result: {
            summary: "低置信 OCR。",
            archiveEligible: false,
            needsTeacherReview: true,
            provisionalScore: 70,
            confidence: "low"
          }
        }
      }
    ],
    mistakes: [
      {
        id: "mistake_1",
        subject: "数学",
        prompt: "应用题条件遗漏",
        cause: "审题时漏掉单位",
        masteryResolved: false,
        createdAt: new Date("2026-07-04T11:00:00.000Z"),
        knowledgePoint: { name: "两步应用题" },
        metadata: { nextPractice: "复述题意后再计算。" }
      }
    ],
    reports: [],
    behaviorEvents: [],
    qaSessions: [
      {
        id: "qa_1",
        createdAt: new Date("2026-07-05T08:00:00.000Z"),
        subject: "数学",
        question: "为什么要先圈条件？",
        answer: "可以避免漏掉已知信息。",
        metadata: { confirmed: true }
      }
    ],
    voiceInteractions: []
  };
}

test("buildProfileEvidencePack includes reviewed evidence and blocks provisional grading", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.period.type, "weekly");
  assert.equal(pack.gradingEvidence.length, 1);
  assert.equal(pack.gradingEvidence[0].id, "sub_ok");
  assert.equal(pack.blockedEvidence.length, 1);
  assert.equal(pack.blockedEvidence[0].id, "sub_blocked");
  assert.equal(pack.sourceQuality.hasBlockedEvidence, true);
});

test("buildStudentGrowthSnapshot creates structured weekly published view with confidence", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });

  assert.equal(snapshot.profileType, "weekly_growth");
  assert.equal(snapshot.publishedView.periodType, "weekly");
  assert.ok(snapshot.publishedView.overview.text.includes("本周"));
  assert.ok(snapshot.publishedView.focusSubjects.length <= 1);
  assert.ok(snapshot.publishedView.focusSubjects[0].evidenceRefs.length > 0);
  assert.equal(snapshot.teacherReview.pendingConfirmations.length, 1);
});

test("filterStudentProfileSnapshot hides teacher review from student role", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "monthly", now });
  const filtered = filterStudentProfileSnapshot(snapshot, "student");

  assert.equal(filtered.profileType, "monthly_comprehensive_growth");
  assert.equal(filtered.teacherReview, undefined);
  assert.equal(filtered.profileEvidencePack, undefined);
  assert.ok(filtered.publishedView);
});

