import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildProfileEvidencePack,
  buildStudentGrowthSnapshot,
  filterStudentProfileSnapshot,
  mergeStudentProfileAiDraft,
  renderStudentGrowthProfilePrintHtml
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

test("filterStudentProfileSnapshot keeps teacher review for teacher role", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });
  const filtered = filterStudentProfileSnapshot(snapshot, "teacher");

  assert.ok(filtered.teacherReview);
  assert.ok(filtered.profileEvidencePack);
});

test("mergeStudentProfileAiDraft only merges safe structured AI fields", () => {
  const base = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });
  const merged = mergeStudentProfileAiDraft(base, {
    profileType: "weekly_growth",
    period: base.period,
    publishedView: {
      overview: { text: "本周能主动复述题意。", evidenceRefs: ["task_1"], confidence: "supported", provider: "DeepSeek" },
      focusSubjects: [
        {
          subject: "数学",
          whyFocus: "两步应用题",
          evidenceSummary: "能说清第一步，但第二步容易漏条件。",
          abilityObservation: "审题过程需要继续稳定。",
          nextClassAction: "先圈条件再列式。",
          evidenceRefs: ["sub_ok"],
          confidence: "supported",
          modelRunId: "run_1"
        }
      ],
      parentNextSteps: [{ text: "每天 5 分钟复述题意。", evidenceRefs: ["task_1"], confidence: "supported" }]
    },
    teacherReview: {
      sampleLimitNotes: ["数学证据较充分。"],
      internalRisks: ["仅教师可见"],
      publishChecklist: [{ text: "确认公开措辞。", evidenceRefs: [], confidence: "supported" }]
    },
    modelRunId: "run_top",
    providerId: "deepseek"
  });
  const studentView = filterStudentProfileSnapshot(merged, "student");

  assert.equal(merged.publishedView.overview.text, "本周能主动复述题意。");
  assert.equal(merged.teacherReview.internalRisks[0], "仅教师可见");
  assert.equal(studentView.teacherReview, undefined);
  assert.equal(studentView.profileEvidencePack, undefined);
  assert.equal(studentView.providerId, undefined);
  assert.equal(studentView.modelRunId, undefined);
  assert.equal(studentView.publishedView.overview.provider, undefined);
  assert.equal(studentView.publishedView.focusSubjects[0].modelRunId, undefined);
});

test("student profile AI prompt requires structured growth archive JSON", () => {
  const runtime = fs.readFileSync(new URL("../../../packages/ai/src/runtime.js", import.meta.url), "utf8");

  assert.match(runtime, /profileType/);
  assert.match(runtime, /publishedView/);
  assert.match(runtime, /teacherReview/);
  assert.match(runtime, /evidenceRefs/);
  assert.match(runtime, /confidence/);
  assert.match(runtime, /不要提及任何模型或供应商/);
});

test("weekly snapshot includes comprehensive-only print template", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });

  assert.equal(snapshot.printView.templateType, "comprehensive_growth_archive");
  assert.equal(snapshot.printView.title, "周综合成长档案");
  assert.equal(snapshot.printView.periodType, "weekly");
  assert.equal(snapshot.printView.renderingPolicy.pdfTextSource, "html_template");
  assert.equal(snapshot.printView.renderingPolicy.imagePreviewUsage, "visual_reference_only");
  assert.equal(snapshot.printView.singleSubjectTemplate, undefined);
  assert.ok(snapshot.printView.sections.comprehensiveSummary.text.includes("本周"));
  assert.ok(snapshot.printView.sections.subjectOverview.length === 3);
  assert.ok(snapshot.printView.sections.focusDirections.length <= 1);
});

test("monthly snapshot deepens comprehensive print sections", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "monthly", now });
  const sections = snapshot.printView.sections;

  assert.equal(snapshot.printView.templateType, "comprehensive_growth_archive");
  assert.equal(snapshot.printView.title, "月度综合成长档案");
  assert.equal(snapshot.printView.periodType, "monthly");
  assert.ok(Array.isArray(sections.evidenceCoverage));
  assert.ok(Array.isArray(sections.subjectAbilityMap));
  assert.ok(Array.isArray(sections.commonCauseAnalysis));
  assert.ok(Array.isArray(sections.learningProcess));
  assert.ok(Array.isArray(sections.homeSchoolCollaboration));
  assert.ok(sections.parentCommunicationSummary.text.includes("家长"));
});

test("student print view keeps public template and hides teacher-only evidence", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "monthly", now });
  const studentView = filterStudentProfileSnapshot(snapshot, "student");

  assert.ok(studentView.printView);
  assert.equal(studentView.printView.templateType, "comprehensive_growth_archive");
  assert.equal(studentView.teacherReview, undefined);
  assert.equal(studentView.profileEvidencePack, undefined);
  assert.equal(studentView.printView.teacherReviewChecklist, undefined);
  assert.equal(studentView.printView.profileEvidencePack, undefined);
});

test("renderStudentGrowthProfilePrintHtml renders official Chinese template text", () => {
  const student = studentFixture();
  const snapshot = buildStudentGrowthSnapshot(student, { periodType: "monthly", now });
  const html = renderStudentGrowthProfilePrintHtml(student, {
    ...snapshot,
    provider: "DeepSeek",
    model: "debug-model",
    prompt: "internal prompt"
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /月度综合成长档案/);
  assert.match(html, /综合成长摘要/);
  assert.match(html, /证据覆盖摘要/);
  assert.match(html, /三科总览/);
  assert.match(html, /家校协同建议/);
  assert.doesNotMatch(html, /DeepSeek/);
  assert.doesNotMatch(html, /debug-model/);
  assert.doesNotMatch(html, /internal prompt/);
});
