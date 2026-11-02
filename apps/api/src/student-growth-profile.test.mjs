import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGradingSourcePackage } from "@junhang/core";
import { buildTeachingWorkflowArchive } from "@junhang/services";
import { buildTermReportDraft } from "./student-term-report.js";
import * as profileModule from "./student-growth-profile.js";
import {
  buildProfileEvidencePack,
  buildStudentGrowthSnapshot,
  filterStudentProfileSnapshot,
  mergeStudentProfileAiDraft,
  renderStudentGrowthProfilePrintHtml
} from "./student-growth-profile.js";

const now = new Date("2026-07-05T12:00:00.000Z");

test("profile grading summary reflects final teacher reviews without reusing the AI draft", () => {
  const student = studentFixture();
  const result = student.submissions[0].grading.result;
  result.summary = "STALE_AI_Q8_WRONG_Q12_PENDING";
  result.questionResults = [
    { questionNo: "8", reviewedByTeacher: true, status: "correct", score: 2, maxScore: 2 },
    { questionNo: "12", reviewedByTeacher: true, status: "wrong", score: 0, maxScore: 2, knowledgePoint: "运算顺序", errorStep: "首次选项错误" },
    { questionNo: "1", reviewedByTeacher: true, status: "partial", score: 1, maxScore: 2, knowledgePoint: "运算顺序", explanation: "第一空正确" }
  ];
  const before = JSON.stringify(student);
  const pack = buildProfileEvidencePack(student, { now });
  const summary = pack.gradingEvidence.find(item => item.id === "sub_ok").summary;
  assert.match(summary, /教师已逐题复核3题/);
  assert.match(summary, /第12、1题/);
  assert.doesNotMatch(summary, /STALE_AI|第8题/);
  assert.equal(JSON.stringify(student), before);

  result.questionResults = [result.questionResults[0]];
  const allCorrect = buildProfileEvidencePack(student, { now }).gradingEvidence[0].summary;
  assert.match(allCorrect, /均为正确/);
  assert.doesNotMatch(allCorrect, /STALE_AI/);

  result.questionResults[0].reviewedByTeacher = false;
  assert.equal(buildProfileEvidencePack(student, { now }).gradingEvidence[0].summary, result.summary);
  result.questionResults[0].reviewedByTeacher = true;
  student.submissions[0].status = "SUBMITTED";
  const blocked = buildProfileEvidencePack(student, { now });
  assert.equal(blocked.gradingEvidence.length, 0);
  assert.equal(blocked.blockedEvidence.find(item => item.id === "sub_ok").summary, result.summary);
});

test("archive replacement is selected before the profile period, including a zero-mistake correction", async () => {
  const source = buildGradingSourcePackage({ id: "paper", items: [{ prompt: "1+1", answer: "2", score: 5 }] }).package;
  const q = { id: "q1", questionNo: "1", printedPrompt: "1+1", studentAnswer: "3", correctAnswer: "2", status: "wrong", score: 0, maxScore: 5, explanation: "Add one and one.", knowledgePoint: "addition", reviewedByTeacher: true, confirmedBy: "t1" };
  const args = { actor: { teacherId: "t1" }, workflow: { id: "w1", module: "grading", ownerTeacherId: "t1", currentRevision: 3, request: { studentId: "s1" } },
    snapshot: { questions: [q], gradingSourcePackage: source }, resolveGradingSource: async () => source, submissionId: "archive-old", confirmedAt: "2026-07-04T09:00:00.000Z" };
  const old = await buildTeachingWorkflowArchive(args);
  const next = await buildTeachingWorkflowArchive({ ...args, workflow: { ...args.workflow, currentRevision: 5 }, previousArchive: old,
    snapshot: { ...args.snapshot, questions: [{ ...q, studentAnswer: "2", status: "correct", score: 5 }] }, submissionId: "archive-new", confirmedAt: "2026-08-01T09:00:00.000Z" });
  const student = { id: "s1", displayName: "Test student", submissions: [old, next].map((a) => ({ id: a.id, studentId: "s1", status: "GRADED", submittedAt: a.confirmedAt,
    assignment: { title: "Addition", subject: { name: "数学" } }, content: { workflowArchive: a }, grading: { score: a.snapshot.finalScore, result: { ...a.snapshot, archiveEligible: true } } })),
    mistakes: [{ id: "old-mistake", studentId: "s1", subject: "数学", prompt: "OBSOLETE_MISTAKE", createdAt: "2026-07-04T09:00:00.000Z", metadata: { sourceSubmissionId: "archive-old", workflowArchiveId: "archive-old" } }] };
  const pack = buildProfileEvidencePack(student, { now, periodType: "monthly" });
  assert.equal(pack.gradingEvidence.length, 0); assert.equal(pack.mistakeEvidence.length, 0);
  const august = buildProfileEvidencePack(student, { now: new Date("2026-08-05T09:00:00.000Z"), periodType: "monthly" });
  assert.equal(august.gradingEvidence.length, 1); assert.equal(august.gradingEvidence[0].score, 5);
  assert.deepEqual(august.gradingEvidence[0].knowledgePoints, ["addition"]);
  assert.equal(august.mistakeEvidence.length, 0);
  const term = buildTermReportDraft(student, { reportType: "final" });
  assert.equal(JSON.stringify(term).includes("OBSOLETE_MISTAKE"), false);
  assert.equal(student.mistakes.length, 1);
  const invalid = structuredClone(student);
  invalid.submissions[1].content.workflowArchive.fingerprint = "tampered";
  const blocked = buildProfileEvidencePack(invalid, { now: new Date("2026-08-05T09:00:00.000Z"), periodType: "monthly" });
  assert.ok(blocked.blockedEvidence.some((item) => item.id === "archive-new" && item.confidence === "blocked"));
});

const qaLearningSignal = {
  knowledgePoints: ["小数意义"],
  questionIntent: "concept",
  difficultySignal: "possible",
  misconceptionHypotheses: ["需要继续观察小数位值理解"],
  followUpNeeded: true,
  confidence: "medium",
  safetyStatus: "pass"
};

function qaMetadata(overrides = {}) {
  return {
    schemaVersion: "qa-learning-signal-v1",
    actorRole: "student",
    identityConfirmed: true,
    available: true,
    mode: "KNOWLEDGE_EXPLANATION",
    profileEligibility: true,
    blockedReason: null,
    learningSignal: { ...qaLearningSignal },
    ...overrides
  };
}

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
        id: "qa_eligible_1",
        createdAt: new Date("2026-07-05T08:00:00.000Z"),
        subject: "数学",
        question: "完整问题不得进入档案：小数为什么有不同数位？",
        answer: "完整回答不得进入档案：这里是一段学生可见讲解。",
        metadata: qaMetadata({
          provider: "secret-provider",
          model: "secret-model",
          raw: "secret-raw",
          prompt: "secret-prompt",
          debug: "secret-debug",
          learningSignal: {
            ...qaLearningSignal,
            provider: "nested-secret-provider",
            raw: "nested-secret-raw"
          }
        })
      },
      {
        id: "qa_eligible_2",
        createdAt: new Date("2026-07-05T09:00:00.000Z"),
        subject: " 数学 ",
        question: "第二个完整问题不得进入档案。",
        answer: "第二个完整回答不得进入档案。",
        metadata: qaMetadata({
          mode: "GUIDED_THINKING",
          learningSignal: {
            ...qaLearningSignal,
            knowledgePoints: ["小数意义"]
          }
        })
      },
      {
        id: "qa_teacher_test",
        createdAt: new Date("2026-07-05T09:10:00.000Z"),
        subject: "数学",
        question: "教师测试问题不得进入档案。",
        answer: "教师测试回答不得进入档案。",
        metadata: qaMetadata({ actorRole: "teacher", profileEligibility: false, blockedReason: "teacher-test" })
      },
      {
        id: "qa_unconfirmed_classroom",
        createdAt: new Date("2026-07-05T09:20:00.000Z"),
        subject: "数学",
        question: "身份未确认课堂问题不得进入档案。",
        answer: "身份未确认课堂回答不得进入档案。",
        metadata: qaMetadata({
          actorRole: "classroom",
          identityConfirmed: false,
          profileEligibility: false,
          blockedReason: "identity-unconfirmed"
        })
      },
      {
        id: "qa_unavailable",
        createdAt: new Date("2026-07-05T09:30:00.000Z"),
        subject: "数学",
        question: "不可用问题不得进入档案。",
        answer: "不可用回答不得进入档案。",
        metadata: qaMetadata({ available: false, profileEligibility: false, blockedReason: "model-unavailable" })
      },
      {
        id: "qa_unsafe",
        createdAt: new Date("2026-07-05T09:40:00.000Z"),
        subject: "数学",
        question: "安全阻断问题不得进入档案。",
        answer: "安全阻断回答不得进入档案。",
        metadata: qaMetadata({
          profileEligibility: false,
          blockedReason: "unsafe-content",
          learningSignal: { ...qaLearningSignal, safetyStatus: "blocked" }
        })
      },
      {
        id: "qa_malformed",
        createdAt: new Date("2026-07-05T09:50:00.000Z"),
        subject: "数学",
        question: "结构异常问题不得进入档案。",
        answer: "结构异常回答不得进入档案。",
        metadata: qaMetadata({
          profileEligibility: false,
          blockedReason: "malformed-output",
          learningSignal: new Map(Object.entries(qaLearningSignal))
        })
      },
      {
        id: "qa_legacy",
        createdAt: new Date("2026-07-05T10:00:00.000Z"),
        subject: "数学",
        question: "旧版完整问题不得进入档案。",
        answer: "旧版完整回答不得进入档案。",
        metadata: { confirmed: true }
      }
    ],
    voiceInteractions: []
  };
}

test("teacher-reviewed graded submissions are admitted to profile evidence", () => {
  const student = studentFixture();
  student.submissions = [student.submissions[0]];
  student.submissions[0].status = "GRADED";

  const evidence = buildProfileEvidencePack(student, { now });

  assert.equal(evidence.gradingEvidence.length, 1);
  assert.equal(evidence.blockedEvidence.filter((item) => item.type === "grading").length, 0);
  assert.equal(evidence.gradingEvidence[0].score, 82);
});

function periodBoundaryFixture(boundaries) {
  const fixture = studentFixture();
  fixture.tasks = boundaries.map(({ id, at }) => ({
    id: `task_${id}`,
    title: `边界任务 ${id}`,
    status: "COMPLETED",
    createdAt: new Date(at),
    subject: { name: "数学" }
  }));
  fixture.submissions = boundaries.map(({ id, at }) => ({
    id: `grading_${id}`,
    status: "REVIEWED",
    submittedAt: new Date(at),
    assignment: { title: `边界批改 ${id}`, subject: { name: "数学" }, metadata: {} },
    grading: { score: 90, result: { archiveEligible: true, needsTeacherReview: false, confidence: "high" } }
  }));
  fixture.mistakes = boundaries.map(({ id, at }) => ({
    id: `mistake_${id}`,
    subject: "数学",
    prompt: `边界错题 ${id}`,
    masteryResolved: false,
    createdAt: new Date(at),
    knowledgePoint: { name: "小数意义" },
    metadata: {}
  }));
  fixture.qaSessions = boundaries.map(({ id, at }) => ({
    id: `qa_${id}`,
    createdAt: new Date(at),
    subject: "数学",
    metadata: qaMetadata()
  }));
  fixture.voiceInteractions = boundaries.map(({ id, at }) => ({
    id: `voice_${id}`,
    occurredAt: new Date(at),
    subject: "数学",
    question: `边界课堂观察 ${id}`,
    metadata: { available: true }
  }));
  return fixture;
}

function assertPeriodEvidence(pack, expectedBoundaryIds) {
  assert.deepEqual(pack.taskEvidence.map((item) => item.id), expectedBoundaryIds.map((id) => `task_${id}`));
  assert.deepEqual(pack.gradingEvidence.map((item) => item.id), expectedBoundaryIds.map((id) => `grading_${id}`));
  assert.deepEqual(pack.mistakeEvidence.map((item) => item.id), expectedBoundaryIds.map((id) => `mistake_${id}`));
  assert.deepEqual(
    pack.qaEvidence.flatMap((item) => item.sourceRefs).sort(),
    expectedBoundaryIds.map((id) => `qa_${id}`).sort()
  );
  assert.deepEqual(pack.classroomEvidence.map((item) => item.id), expectedBoundaryIds.map((id) => `voice_${id}`));
}

test("buildProfileEvidencePack includes reviewed evidence and blocks provisional grading", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.period.type, "weekly");
  assert.equal(pack.gradingEvidence.length, 1);
  assert.equal(pack.gradingEvidence[0].id, "sub_ok");
  assert.ok(pack.blockedEvidence.some((item) => item.id === "sub_blocked"));
  assert.equal(pack.sourceQuality.hasBlockedEvidence, true);
});

test("teacher-confirmed daily observations enter the profile draft as subject evidence without changing scores", () => {
  const fixture = studentFixture();
  fixture.behaviorEvents = [
    {
      id: "teacher_observation_1",
      actorType: "TEACHER",
      feature: "student-profile",
      action: "teacher-daily-observation",
      occurredAt: new Date("2026-07-05T10:30:00.000Z"),
      metadata: {
        schemaVersion: "teacher-observation-v1",
        source: "teacher-conversation",
        reviewStatus: "teacher_confirmed",
        visibility: "teacher_only_pending_profile_review",
        subjectObservations: [
          {
            subject: "数学",
            observation: "分配律的深层应用仍需继续理解。",
            nextFocus: "用同类题复盘分配与合并过程。"
          },
          {
            subject: "英语",
            observation: "字母书写任务尚未完成。",
            nextFocus: "分段完成规范书写练习。"
          }
        ]
      }
    },
    {
      id: "ordinary_audit_1",
      actorType: "TEACHER",
      feature: "student-profile",
      action: "draft-profile",
      occurredAt: new Date("2026-07-05T10:35:00.000Z"),
      metadata: { source: "audit" }
    },
    {
      id: "student_audit_1",
      actorType: "STUDENT",
      feature: "ai-qa",
      action: "answer-question",
      occurredAt: new Date("2026-07-05T10:40:00.000Z"),
      metadata: { actorRole: "student", result: "学生会话审计结果" }
    }
  ];

  const withoutObservation = studentFixture();
  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });
  const baseline = buildStudentGrowthSnapshot(withoutObservation, { periodType: "weekly", now });
  const mathObservation = snapshot.profileEvidencePack.teacherObservationEvidence.find((item) => item.subject === "数学");
  const mathFocus = snapshot.publishedView.focusSubjects.find((item) => item.subject === "数学");

  assert.equal(snapshot.profileEvidencePack.teacherObservationEvidence.length, 2);
  assert.deepEqual(snapshot.profileEvidencePack.behaviorEvidence, []);
  assert.equal(mathObservation.id, "teacher_observation_1:0");
  assert.equal(mathObservation.summary, "分配律的深层应用仍需继续理解。");
  assert.equal(mathObservation.nextFocus, "用同类题复盘分配与合并过程。");
  assert.equal(snapshot.sourceCounts.teacherObservations, 1);
  assert.match(mathFocus.abilityObservation, /分配律/);
  assert.match(mathFocus.nextClassAction, /分配与合并/);
  assert.ok(snapshot.publishedView.timelinePreview.some((item) => item.id === "teacher_observation_1:0"));
  assert.ok(snapshot.teacherReview.evidenceItems.some((item) => item.id === "teacher_observation_1:0"));
  assert.ok(snapshot.printView.sections.evidenceCoverage.some((item) => item.title === "每日教师观察"));
  assert.equal(snapshot.weeklyScore, baseline.weeklyScore);
  assert.deepEqual(snapshot.mastery, baseline.mastery);
});

test("weekly profile period uses deterministic Asia Shanghai boundaries for every evidence type", () => {
  const fixture = periodBoundaryFixture([
    { id: "previous", at: "2026-07-05T15:59:59.999Z" },
    { id: "start", at: "2026-07-05T16:00:00.000Z" },
    { id: "end", at: "2026-07-12T15:59:59.999Z" },
    { id: "next", at: "2026-07-12T16:00:00.000Z" }
  ]);

  const pack = buildProfileEvidencePack(fixture, {
    periodType: "weekly",
    now: new Date("2026-07-05T16:00:00.000Z")
  });

  assert.equal(pack.period.start, "2026-07-06");
  assert.equal(pack.period.end, "2026-07-12");
  assertPeriodEvidence(pack, ["start", "end"]);
});

test("monthly profile period uses deterministic Asia Shanghai boundaries for every evidence type", () => {
  const fixture = periodBoundaryFixture([
    { id: "previous", at: "2026-06-30T15:59:59.999Z" },
    { id: "start", at: "2026-06-30T16:00:00.000Z" },
    { id: "end", at: "2026-07-31T15:59:59.999Z" },
    { id: "next", at: "2026-07-31T16:00:00.000Z" }
  ]);

  const pack = buildProfileEvidencePack(fixture, {
    periodType: "monthly",
    now: new Date("2026-06-30T16:00:00.000Z")
  });

  assert.equal(pack.period.start, "2026-07-01");
  assert.equal(pack.period.end, "2026-07-31");
  assertPeriodEvidence(pack, ["start", "end"]);
});

test("only eligible qa-learning-signal-v1 records enter qaEvidence", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.qaEvidence.length, 1);
  assert.equal(pack.qaEvidence[0].subject, "数学");
  assert.equal(pack.qaEvidence[0].knowledgePoint, "小数意义");
  assert.equal(pack.qaEvidence[0].sessionCount, 2);
  assert.deepEqual(pack.qaEvidence[0].sourceRefs, ["qa_eligible_1", "qa_eligible_2"]);
});

test("qa-backed voice for unavailable unsafe or unconfirmed qa enters neither evidence group", () => {
  const fixture = studentFixture();
  fixture.qaSessions = fixture.qaSessions.filter((session) => [
    "qa_unconfirmed_classroom",
    "qa_unavailable",
    "qa_unsafe"
  ].includes(session.id));
  fixture.voiceInteractions = [
    {
      id: "voice_unconfirmed",
      occurredAt: new Date("2026-07-05T09:21:00.000Z"),
      subject: "数学",
      metadata: { qaSessionId: "qa_unconfirmed_classroom", available: true, mode: "GUIDED_THINKING" }
    },
    {
      id: "voice_unavailable",
      occurredAt: new Date("2026-07-05T09:31:00.000Z"),
      subject: "数学",
      metadata: { qaSessionId: "qa_unavailable", available: false, mode: "KNOWLEDGE_EXPLANATION" }
    },
    {
      id: "voice_unsafe",
      occurredAt: new Date("2026-07-05T09:41:00.000Z"),
      subject: "数学",
      metadata: { qaSessionId: "qa_unsafe", available: true, mode: "KNOWLEDGE_EXPLANATION" }
    },
    {
      id: "voice_unmatched",
      occurredAt: new Date("2026-07-05T09:42:00.000Z"),
      subject: "数学",
      metadata: { qaSessionId: "qa_missing", available: true, mode: "KNOWLEDGE_EXPLANATION" }
    }
  ];

  const pack = buildProfileEvidencePack(fixture, { periodType: "weekly", now });

  assert.equal(pack.qaEvidence.length, 0);
  assert.equal(pack.classroomEvidence.length, 0);
  assert.equal(pack.sourceQuality.qaCount, 0);
  assert.equal(pack.sourceQuality.classroomCount, 0);
});

test("eligible qa-backed voice appears once through qaEvidence", () => {
  const fixture = studentFixture();
  fixture.qaSessions = [fixture.qaSessions[0]];
  fixture.voiceInteractions = [{
    id: "voice_eligible",
    occurredAt: new Date("2026-07-05T08:01:00.000Z"),
    subject: "数学",
    question: "课堂问题不得重复计数",
    answer: "课堂回答不得重复计数",
    metadata: { qaSessionId: "qa_eligible_1", available: true, mode: "KNOWLEDGE_EXPLANATION" }
  }];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.deepEqual(snapshot.profileEvidencePack.qaEvidence[0].sourceRefs, ["qa_eligible_1"]);
  assert.equal(snapshot.profileEvidencePack.classroomEvidence.length, 0);
  assert.equal(snapshot.sourceCounts.qaSessions, 1);
  assert.equal(snapshot.sourceCounts.voiceInteractions, 0);
  assert.equal(snapshot.publishedView.timelinePreview.filter((item) => item.id === "qa_eligible_1").length, 1);
});

test("standalone non-qa voice remains classroom evidence", () => {
  const fixture = studentFixture();
  fixture.qaSessions = [];
  fixture.voiceInteractions = [{
    id: "voice_standalone",
    occurredAt: new Date("2026-07-05T11:00:00.000Z"),
    subject: "语文",
    question: "朗读后主动复述",
    answer: "能概括主要内容",
    metadata: { available: true, mode: "CLASSROOM_OBSERVATION" }
  }];

  const pack = buildProfileEvidencePack(fixture, { periodType: "weekly", now });

  assert.equal(pack.qaEvidence.length, 0);
  assert.equal(pack.classroomEvidence.length, 1);
  assert.equal(pack.classroomEvidence[0].id, "voice_standalone");
  assert.equal(pack.sourceQuality.classroomCount, 1);
});

test("only a plain own qaSessionId marker excludes standalone classroom evidence", () => {
  const fixture = studentFixture();
  fixture.qaSessions = [];
  const inheritedMetadata = Object.create({ qaSessionId: "qa_inherited" });
  inheritedMetadata.available = true;
  fixture.voiceInteractions = [
    {
      id: "voice_own_empty_marker",
      occurredAt: new Date("2026-07-05T11:10:00.000Z"),
      subject: "语文",
      question: "空关联标记不得绕回课堂证据",
      metadata: { qaSessionId: "", available: true }
    },
    {
      id: "voice_inherited_marker",
      occurredAt: new Date("2026-07-05T11:20:00.000Z"),
      subject: "语文",
      question: "继承属性不构成 QA 关联标记",
      metadata: inheritedMetadata
    }
  ];

  const pack = buildProfileEvidencePack(fixture, { periodType: "weekly", now });

  assert.deepEqual(pack.classroomEvidence.map((item) => item.id), ["voice_inherited_marker"]);
});

test("qaEvidence contains only bounded summaries and refs, never full qa or internal fields", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });
  const item = pack.qaEvidence[0];
  const serialized = JSON.stringify(pack.qaEvidence);

  assert.deepEqual(Object.keys(item).sort(), [
    "confidence",
    "date",
    "difficultySignal",
    "followUpNeeded",
    "id",
    "knowledgePoint",
    "questionIntent",
    "sessionCount",
    "sourceDates",
    "sourceRefs",
    "subject",
    "summary",
    "title",
    "type"
  ]);
  assert.match(item.summary, /辅助观察/);
  for (const forbidden of [
    "完整问题",
    "完整回答",
    "secret-provider",
    "secret-model",
    "secret-raw",
    "secret-prompt",
    "secret-debug",
    "nested-secret-provider",
    "nested-secret-raw",
    "learningSignal"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("one eligible qa signal remains weak and cannot raise mastery or weeklyScore", () => {
  const withOneQa = studentFixture();
  withOneQa.qaSessions = withOneQa.qaSessions.slice(0, 1);
  const withoutQa = studentFixture();
  withoutQa.qaSessions = [];

  const oneQaSnapshot = buildStudentGrowthSnapshot(withOneQa, { periodType: "weekly", now });
  const noQaSnapshot = buildStudentGrowthSnapshot(withoutQa, { periodType: "weekly", now });
  const qaGrowth = oneQaSnapshot.publishedView.stableGrowth.find((item) => item.evidenceRefs.includes("qa_eligible_1"));

  assert.equal(oneQaSnapshot.profileEvidencePack.qaEvidence[0].confidence, "weak");
  assert.equal(qaGrowth.confidence, "weak");
  assert.equal(oneQaSnapshot.weeklyScore, noQaSnapshot.weeklyScore);
  assert.deepEqual(oneQaSnapshot.mastery, noQaSnapshot.mastery);
});

function monthlyProfileWithOneGradingAndLinkedMistakes() {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [{
    id: "grading_shared",
    status: "REVIEWED",
    submittedAt: now,
    assignment: { title: "乘法分配律专项练习", subject: { name: "数学" }, metadata: {} },
    grading: {
      score: 88,
      result: { archiveEligible: true, needsTeacherReview: false, confidence: "high", summary: "" }
    }
  }];
  fixture.qaSessions = [];
  fixture.voiceInteractions = [];
  fixture.behaviorEvents = [];
  fixture.mistakes = [
    { id: "mistake_generic_1", title: "填空结果", cause: "填空结果" },
    { id: "mistake_application", title: "多步应用题", cause: "合并算式结果需逐步验算。", nextPractice: "先验算各项和，再检查减法。" },
    { id: "mistake_factor", title: "乘法分配律综合运算", cause: "将398×5+196×25改写为196×5+398×25。" },
    { id: "mistake_expand", title: "乘法分配律（含减法）", cause: "展开时漏掉60×4，并多写了+2×30。" },
    { id: "mistake_sign", title: "乘法分配律综合计算", cause: "负号未分配到200×25。" },
    { id: "mistake_answer", title: "乘法分配律与凑整", cause: "学生答案与明确答案不一致。" },
    { id: "mistake_generic_2", title: "两个填空结果", cause: "两个填空结果" },
    { id: "mistake_inverse", title: "乘法分配律逆用", cause: "提取公因数后还需核对括号内各项。" }
  ].map((item, index) => ({
    id: item.id,
    subject: "数学",
    prompt: item.title,
    cause: item.cause,
    masteryResolved: false,
    createdAt: now,
    knowledgePoint: { name: item.title },
    metadata: {
      sourceSubmissionId: "grading_shared",
      nextPractice: item.nextPractice || "核对算式改写与运算步骤。"
    }
  }));
  return fixture;
}

test("monthly activity totals count a reviewed submission and its linked mistakes as one source", () => {
  const fixture = monthlyProfileWithOneGradingAndLinkedMistakes();
  const oneActivity = buildStudentGrowthSnapshot(fixture, { periodType: "monthly", now });

  assert.equal(oneActivity.profileEvidencePack.gradingEvidence.length, 1);
  assert.equal(oneActivity.profileEvidencePack.mistakeEvidence.length, 8);
  assert.equal(oneActivity.sourceCounts.mistakes, 8);
  assert.equal(oneActivity.profileEvidencePack.mistakeEvidence[0].sourceSubmissionId, "grading_shared");
  assert.equal(oneActivity.weeklyScore, 69);
  assert.equal(oneActivity.mastery.数学, 70);
  assert.equal(oneActivity.profileEvidencePack.sourceQuality.hasSparseEvidence, true);
  assert.match(oneActivity.publishedView.overview.text, /1 条可追踪学习记录/);
  assert.match(
    oneActivity.publishedView.subjectOverview.find((item) => item.subject === "数学").text,
    /数学已有 1 条记录/
  );

  fixture.tasks = [{
    id: "task_independent",
    title: "独立完成的数学练习",
    status: "COMPLETED",
    createdAt: now,
    subject: { name: "数学" }
  }];
  fixture.submissions.push({
    id: "grading_independent",
    status: "REVIEWED",
    submittedAt: now,
    assignment: { title: "另一份练习", subject: { name: "数学" }, metadata: {} },
    grading: {
      score: 90,
      result: { archiveEligible: true, needsTeacherReview: false, confidence: "high", summary: "" }
    }
  });
  const threeActivities = buildStudentGrowthSnapshot(fixture, { periodType: "monthly", now });

  assert.equal(threeActivities.weeklyScore, 77);
  assert.equal(threeActivities.mastery.数学, 86);
  assert.equal(threeActivities.profileEvidencePack.sourceQuality.hasSparseEvidence, false);
  assert.match(threeActivities.publishedView.overview.text, /3 条可追踪学习记录/);
  assert.match(
    threeActivities.publishedView.subjectOverview.find((item) => item.subject === "数学").text,
    /数学已有 3 条记录/
  );
});

function trendSubmission({ id, submittedAt, score, maxScore = 5, reviewedByTeacher = true, status = "REVIEWED" }) {
  return {
    id,
    status,
    submittedAt: new Date(submittedAt),
    assignment: { title: "小数专项练习", subject: { name: "数学" }, metadata: {} },
    grading: {
      score,
      result: {
        score,
        archiveEligible: status === "REVIEWED" || status === "GRADED",
        needsTeacherReview: false,
        confidence: "high",
        questionResults: [{
          id: `${id}-question`,
          questionNo: "1",
          knowledgePoint: "小数意义",
          score,
          maxScore,
          reviewedByTeacher
        }]
      }
    }
  };
}

test("monthly profile compares teacher-confirmed score rates for the same knowledge point and retains parent guidance", () => {
  const student = {
    id: "trend-student",
    displayName: "趋势学生",
    submissions: [
      trendSubmission({ id: "june-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 3 }),
      trendSubmission({ id: "june-2", submittedAt: "2026-06-17T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  };

  const snapshot = buildStudentGrowthSnapshot(student, { periodType: "monthly", now });
  const trend = snapshot.publishedView.learningTrends[0];

  assert.equal(trend.subject, "数学");
  assert.equal(trend.knowledgePoint, "小数意义");
  assert.equal(trend.current.scoreRate, 90);
  assert.equal(trend.current.questionCount, 2);
  assert.equal(trend.current.submissionCount, 2);
  assert.equal(trend.previous.scoreRate, 70);
  assert.equal(trend.previous.questionCount, 2);
  assert.equal(trend.previous.submissionCount, 2);
  assert.equal(trend.deltaPercentagePoints, 20);
  assert.equal(trend.status, "improving");
  assert.deepEqual(trend.evidenceRefs, ["july-1", "july-2", "june-1", "june-2"]);
  assert.match(trend.comparisonText, /90%.*70%.*20 个百分点/);
  assert.ok(trend.parentAssist);
  assert.equal(trend.teacherNextCheck, undefined);
  assert.ok(snapshot.teacherReview.learningTrends[0].teacherNextCheck);
  assert.ok(snapshot.teacherReview.evidenceItems.some((item) => item.id === "june-1"));
  assert.ok(snapshot.printView.sections.learningTrends.some((item) => item.evidenceRefs.includes("june-1")));
  assert.match(renderStudentGrowthProfilePrintHtml(student, snapshot), /近期表现变化/);
});

test("AI profile drafts cannot replace server-calculated learning trends", () => {
  const student = {
    id: "protected-trend-student",
    displayName: "趋势保护学生",
    submissions: [
      trendSubmission({ id: "protected-june-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 3 }),
      trendSubmission({ id: "protected-june-2", submittedAt: "2026-06-17T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "protected-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "protected-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  };
  const base = buildStudentGrowthSnapshot(student, { periodType: "monthly", now });
  assert.ok(base.publishedView.learningTrends.length);
  const merged = mergeStudentProfileAiDraft(base, {
    publishedView: {
      learningTrends: [{ subject: "数学", knowledgePoint: "小数意义", status: "improving", deltaPercentagePoints: 99, evidenceRefs: base.publishedView.learningTrends[0].evidenceRefs }]
    }
  });

  assert.deepEqual(merged.publishedView.learningTrends, base.publishedView.learningTrends);
  assert.match(merged.teacherReview.internalRisks.join("；"), /趋势.*服务端|服务端.*趋势/);
});

test("AI monthly prose cannot reuse previous-month trend sources as current evidence", () => {
  const base = buildStudentGrowthSnapshot({
    id: "period-boundary-student",
    submissions: [
      trendSubmission({ id: "boundary-june", submittedAt: "2026-06-17T09:00:00+08:00", score: 3 }),
      trendSubmission({ id: "boundary-july", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  }, { periodType: "monthly", now });
  const invalid = mergeStudentProfileAiDraft(base, { publishedView: { overview: {
    text: "本月依据前月记录得出结论。", evidenceRefs: ["boundary-june"], confidence: "supported"
  } } });
  assert.deepEqual(invalid.publishedView.overview, base.publishedView.overview);
  assert.match(invalid.teacherReview.internalRisks.join("；"), /来源引用.*未准入/);

  const valid = mergeStudentProfileAiDraft(base, { publishedView: {
    ...base.publishedView,
    overview: { text: "本月仅根据当前已确认样本继续观察。", evidenceRefs: ["boundary-july"], confidence: "supported" }
  } });
  assert.equal(valid.publishedView.overview.text, "本月仅根据当前已确认样本继续观察。");
  assert.deepEqual(valid.publishedView.learningTrends, base.publishedView.learningTrends);
});

test("previous-month-only trends do not assign parent tasks for an empty current month", () => {
  const snapshot = buildStudentGrowthSnapshot({
    id: "empty-current-month-student",
    submissions: [trendSubmission({ id: "previous-only", submittedAt: "2026-06-17T09:00:00+08:00", score: 4 })]
  }, { periodType: "monthly", now });
  const trend = snapshot.publishedView.learningTrends[0];
  assert.equal(trend.current.submissionCount, 0);
  assert.equal(trend.current.scoreRate, null);
  assert.equal(trend.status, "insufficient");
  assert.match(trend.parentAssist, /暂不安排具体家长任务/);
  assert.deepEqual(snapshot.publishedView.parentNextSteps, []);
  assert.doesNotMatch(renderStudentGrowthProfilePrintHtml({}, snapshot), /null%/);
});

test("monthly profile marks a ten-point decline and treats an exact five-point change as stable", () => {
  const decline = buildStudentGrowthSnapshot({
    id: "decline-student",
    displayName: "近期变化学生",
    submissions: [
      trendSubmission({ id: "decline-june-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 16, maxScore: 20 }),
      trendSubmission({ id: "decline-june-2", submittedAt: "2026-06-17T09:00:00+08:00", score: 16, maxScore: 20 }),
      trendSubmission({ id: "decline-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 14, maxScore: 20 }),
      trendSubmission({ id: "decline-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 14, maxScore: 20 })
    ]
  }, { periodType: "monthly", now });
  const stable = buildStudentGrowthSnapshot({
    id: "stable-student",
    displayName: "基本稳定学生",
    submissions: [
      trendSubmission({ id: "stable-june-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 16, maxScore: 20 }),
      trendSubmission({ id: "stable-june-2", submittedAt: "2026-06-17T09:00:00+08:00", score: 16, maxScore: 20 }),
      trendSubmission({ id: "stable-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 15, maxScore: 20 }),
      trendSubmission({ id: "stable-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 15, maxScore: 20 })
    ]
  }, { periodType: "monthly", now });

  assert.equal(decline.publishedView.learningTrends[0].status, "declining");
  assert.equal(decline.publishedView.learningTrends[0].deltaPercentagePoints, -10);
  assert.equal(stable.publishedView.learningTrends[0].status, "stable");
  assert.equal(stable.publishedView.learningTrends[0].deltaPercentagePoints, -5);
});

test("monthly profile does not infer a trend from only one independent grading in either period", () => {
  const student = {
    id: "thin-trend-student",
    displayName: "样本不足学生",
    submissions: [
      trendSubmission({ id: "june-only", submittedAt: "2026-06-17T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "july-only", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  };

  const snapshot = buildStudentGrowthSnapshot(student, { periodType: "monthly", now });
  const trend = snapshot.publishedView.learningTrends[0];

  assert.equal(trend.status, "insufficient");
  assert.equal(trend.deltaPercentagePoints, null);
  assert.match(trend.comparisonText, /至少需要每期 2 份独立批改/);
  assert.match(snapshot.printView.sections.learningTrends[0].text, /暂不能判断/);
});

test("monthly trend aggregation excludes question results that were not teacher-reviewed", () => {
  const student = {
    id: "unreviewed-trend-student",
    displayName: "待复核趋势学生",
    submissions: [
      trendSubmission({ id: "june-reviewed-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 3 }),
      trendSubmission({ id: "june-unreviewed", submittedAt: "2026-06-17T09:00:00+08:00", score: 5, reviewedByTeacher: false }),
      trendSubmission({ id: "july-reviewed-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "july-reviewed-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  };

  const snapshot = buildStudentGrowthSnapshot(student, { periodType: "monthly", now });
  const trend = snapshot.publishedView.learningTrends[0];

  assert.equal(trend.status, "insufficient");
  assert.equal(trend.previous.submissionCount, 1);
  assert.equal(trend.evidenceRefs.includes("june-unreviewed"), false);
  assert.equal(snapshot.teacherReview.evidenceItems.some((item) => item.id === "june-unreviewed" && item.type === "grading_trend"), false);
});

test("monthly trend falls back to subject-level comparison when knowledge points are not repeated", () => {
  const submissionWithPoint = ({ id, submittedAt, score, knowledgePoint }) => {
    const submission = trendSubmission({ id, submittedAt, score });
    submission.grading.result.questionResults[0].knowledgePoint = knowledgePoint;
    return submission;
  };
  const snapshot = buildStudentGrowthSnapshot({
    id: "subject-fallback-student",
    displayName: "学科趋势兜底学生",
    submissions: [
      submissionWithPoint({ id: "fallback-june-1", submittedAt: "2026-06-03T09:00:00+08:00", score: 3, knowledgePoint: "小数意义" }),
      submissionWithPoint({ id: "fallback-june-2", submittedAt: "2026-06-17T09:00:00+08:00", score: 3, knowledgePoint: "小数比较" }),
      submissionWithPoint({ id: "fallback-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 5, knowledgePoint: "小数加法" }),
      submissionWithPoint({ id: "fallback-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5, knowledgePoint: "小数减法" })
    ]
  }, { periodType: "monthly", now });

  assert.equal(snapshot.publishedView.learningTrends.length, 1);
  const trend = snapshot.publishedView.learningTrends[0];
  assert.equal(trend.scope, "subject");
  assert.equal(trend.knowledgePoint, "学科整体");
  assert.equal(trend.previous.scoreRate, 60);
  assert.equal(trend.current.scoreRate, 100);
  assert.equal(trend.status, "improving");
  assert.deepEqual(trend.evidenceRefs, ["fallback-july-1", "fallback-july-2", "fallback-june-1", "fallback-june-2"]);
  assert.match(snapshot.printView.sections.learningTrends[0].evidence, /60%.*100%/);
  assert.match(trend.comparisonText, /范围.*难度.*不.*能力/);
  assert.doesNotMatch(trend.parentAssist, /学科整体.*步骤/);
  assert.match(snapshot.teacherReview.learningTrends[0].teacherNextCheck, /范围.*难度/);
});

test("monthly trends exclude missing malformed and out-of-range question scores", () => {
  for (const score of [null, undefined, "", "  ", false, [], {}, -1, 6, Infinity]) {
    const snapshot = buildStudentGrowthSnapshot({
      id: "invalid-score-student",
      submissions: [
        trendSubmission({ id: "valid-june", submittedAt: "2026-06-03T09:00:00+08:00", score: 3 }),
        trendSubmission({ id: "invalid-june", submittedAt: "2026-06-17T09:00:00+08:00", score }),
        trendSubmission({ id: "valid-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 4 }),
        trendSubmission({ id: "valid-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
      ]
    }, { periodType: "monthly", now });
    const trend = snapshot.publishedView.learningTrends[0];
    assert.equal(trend.previous.submissionCount, 1, `invalid score: ${String(score)}`);
    assert.equal(trend.previous.scoreRate, 60);
    assert.equal(trend.status, "insufficient");
  }
});

test("duplicate submission IDs cannot inflate monthly trend scores or counts", () => {
  const previous = trendSubmission({ id: "duplicate-june", submittedAt: "2026-06-03T09:00:00+08:00", score: 3 });
  const snapshot = buildStudentGrowthSnapshot({
    id: "duplicate-trend-student",
    submissions: [previous, structuredClone(previous),
      trendSubmission({ id: "other-june", submittedAt: "2026-06-17T09:00:00+08:00", score: 5 }),
      trendSubmission({ id: "duplicate-july-1", submittedAt: "2026-07-02T09:00:00+08:00", score: 4 }),
      trendSubmission({ id: "duplicate-july-2", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })
    ]
  }, { periodType: "monthly", now });
  const trend = snapshot.publishedView.learningTrends[0];
  assert.equal(trend.previous.earnedScore, 8);
  assert.equal(trend.previous.maxScore, 10);
  assert.equal(trend.previous.questionCount, 2);
  assert.equal(trend.previous.submissionCount, 2);
  assert.equal(trend.previous.scoreRate, 80);
});

test("insufficient trend print evidence uses text instead of null percent", () => {
  const snapshot = buildStudentGrowthSnapshot({
    id: "null-rate-student",
    displayName: "无比例趋势学生",
    submissions: [trendSubmission({ id: "null-rate-current", submittedAt: "2026-07-04T09:00:00+08:00", score: 5 })]
  }, { periodType: "monthly", now });

  assert.equal(snapshot.publishedView.learningTrends.length, 1);
  assert.match(snapshot.printView.sections.learningTrends[0].evidence, /前期 暂无.*本期 100%/);
  assert.doesNotMatch(renderStudentGrowthProfilePrintHtml({}, snapshot), /null%/);
});

test("weekly profiles omit monthly score trends", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });

  assert.deepEqual(snapshot.publishedView.learningTrends, []);
  assert.equal(snapshot.printView.sections.learningTrends, undefined);
});

test("monthly focus summarizes multiple linked mistake causes and retains each mistake reference", () => {
  const snapshot = buildStudentGrowthSnapshot(
    monthlyProfileWithOneGradingAndLinkedMistakes(),
    { periodType: "monthly", now }
  );
  const focus = snapshot.publishedView.focusSubjects.find((item) => item.subject === "数学");
  const mistakeIds = snapshot.profileEvidencePack.mistakeEvidence.map((item) => item.id);

  assert.match(focus.whyFocus, /乘法分配律/);
  assert.ok(focus.whyFocus.length <= 180);
  assert.match(focus.evidenceSummary, /改写/);
  assert.match(focus.evidenceSummary, /漏项/);
  assert.match(focus.evidenceSummary, /负号/);
  assert.match(focus.evidenceSummary, /结果核对/);
  assert.ok(focus.evidenceSummary.length <= 220);
  assert.doesNotMatch(focus.evidenceSummary, /398×5\+196×25/);
  assert.doesNotMatch(focus.evidenceSummary, /展开时漏掉60×4/);
  assert.ok(focus.nextClassAction.length <= 220);
  assert.match(focus.nextClassAction, /逐项核对/);
  assert.doesNotMatch(focus.nextClassAction, /核对算式改写与运算步骤/);
  assert.match(focus.abilityObservation, /掌握情况.*继续观察/);
  assert.equal(snapshot.profileEvidencePack.mistakeEvidence.length, 8);
  assert.match(snapshot.profileEvidencePack.mistakeEvidence[2].cause, /398×5\+196×25/);
  assert.doesNotMatch(JSON.stringify(snapshot.publishedView), /398×5\+196×25|展开时漏掉60×4/);
  assert.deepEqual(
    mistakeIds.filter((id) => focus.evidenceRefs.includes(id)).sort(),
    mistakeIds.slice().sort()
  );
});

test("single long mistake details remain in teacher evidence but public summaries stay concise", () => {
  const fixture = monthlyProfileWithOneGradingAndLinkedMistakes();
  fixture.mistakes = fixture.mistakes.filter((item) => item.id === "mistake_factor");
  fixture.mistakes[0].cause = "本题学生把398×5+196×25改写成196×5+398×25，导致两个乘数和对应因数交换错位。";
  fixture.mistakes[0].metadata.nextPractice = "请将原式逐项拆开，再逐一对应因数计算并核对最终结果是否一致。";
  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "monthly", now });
  const focus = snapshot.publishedView.focusSubjects.find((item) => item.subject === "数学");

  assert.match(snapshot.profileEvidencePack.mistakeEvidence[0].cause, /导致两个乘数和对应因数交换错位/);
  assert.ok(focus.evidenceRefs.includes("mistake_factor"));
  assert.doesNotMatch(JSON.stringify(snapshot.publishedView), /导致两个乘数和对应因数交换错位|请将原式逐项拆开/);
  assert.ok(focus.evidenceSummary.length <= 220);
  assert.ok(focus.nextClassAction.length <= 220);
  assert.match(focus.nextClassAction, /算式改写/);
});

test("non-qa subjects outrank qa-only subjects in weekly and monthly focus", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.qaSessions = Array.from({ length: 3 }, (_, index) => ({
    ...fixture.qaSessions[0],
    id: `qa_english_${index + 1}`,
    subject: "英语",
    metadata: qaMetadata({
      learningSignal: {
        ...qaLearningSignal,
        knowledgePoints: ["一般现在时"]
      }
    })
  }));

  const weekly = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });
  const monthly = buildStudentGrowthSnapshot(fixture, { periodType: "monthly", now });

  assert.equal(weekly.publishedView.focusSubjects[0].subject, "数学");
  assert.deepEqual(monthly.publishedView.focusSubjects.map((item) => item.subject), ["数学", "英语"]);
  assert.match(monthly.publishedView.focusSubjects[1].whyFocus, /继续观察/);
});

test("qa-only focus remains an auxiliary continue-observing subject", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.mistakes = [];
  fixture.qaSessions = [{ ...fixture.qaSessions[0], subject: "英语" }];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(snapshot.publishedView.focusSubjects[0].subject, "英语");
  assert.match(snapshot.publishedView.focusSubjects[0].whyFocus, /继续观察/);
  assert.equal(snapshot.publishedView.focusSubjects[0].confidence, "weak");
});

test("monthly qa-only focus ranks subjects by distinct source count", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.mistakes = [];
  fixture.voiceInteractions = [];
  fixture.behaviorEvents = [];
  fixture.qaSessions = [
    ["语文", 1],
    ["英语", 3],
    ["数学", 2]
  ].flatMap(([subject, count]) => Array.from({ length: count }, (_, index) => ({
    id: `qa_${subject}_${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 6, 5, 8 + index)),
    subject,
    metadata: qaMetadata({
      learningSignal: {
        ...qaLearningSignal,
        knowledgePoints: [`${subject}知识点`]
      }
    })
  })));

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "monthly", now });

  assert.deepEqual(snapshot.publishedView.focusSubjects.map((item) => item.subject), ["英语", "数学"]);
});

test("two normalized subject and knowledge point records aggregate to one supported signal", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.qaEvidence.length, 1);
  assert.equal(pack.qaEvidence[0].sessionCount, 2);
  assert.equal(pack.qaEvidence[0].confidence, "supported");
});

test("two supported same-point qa sessions each receive one source timeline entry", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });
  const qaTimeline = snapshot.publishedView.timelinePreview.filter((item) => item.type === "qa");

  assert.equal(qaTimeline.length, 2);
  assert.deepEqual(qaTimeline.map((item) => item.id).sort(), ["qa_eligible_1", "qa_eligible_2"]);
  assert.deepEqual(Object.fromEntries(qaTimeline.map((item) => [item.id, item.at])), {
    qa_eligible_1: "2026-07-05T08:00:00.000Z",
    qa_eligible_2: "2026-07-05T09:00:00.000Z"
  });
  assert.equal(qaTimeline.every((item) => item.confidence === "supported"), true);
  assert.equal(qaTimeline.every((item) => JSON.stringify(item.evidenceRefs) === JSON.stringify([item.id])), true);
});

test("qa metadata requires a valid producer mode", () => {
  for (const mode of [undefined, "INVALID_MODE"]) {
    const fixture = studentFixture();
    const metadata = qaMetadata();
    if (mode === undefined) delete metadata.mode;
    else metadata.mode = mode;
    fixture.qaSessions = [{ ...fixture.qaSessions[0], metadata }];

    const pack = buildProfileEvidencePack(fixture, { periodType: "weekly", now });

    assert.equal(pack.qaEvidence.length, 0);
    assert.deepEqual(pack.blockedEvidence.find((item) => item.type === "qa"), {
      id: "qa_eligible_1",
      type: "qa",
      date: "2026-07-05T08:00:00.000Z",
      reason: "malformed-output"
    });
  }
});

test("qa eligibility requires a valid deterministic session date", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.mistakes = [];
  fixture.qaSessions = [
    { ...fixture.qaSessions[0], id: "qa_invalid_date", createdAt: "not-a-valid-date" },
    { ...fixture.qaSessions[0], id: "qa_missing_date", createdAt: undefined }
  ];

  const first = buildProfileEvidencePack(fixture, { periodType: "weekly", now });
  const second = buildProfileEvidencePack(fixture, { periodType: "weekly", now });
  const expected = [
    { id: "qa_invalid_date", type: "qa", date: "", reason: "malformed-output" },
    { id: "qa_missing_date", type: "qa", date: "", reason: "malformed-output" }
  ];

  assert.equal(first.qaEvidence.length, 0);
  assert.deepEqual(first.blockedEvidence, expected);
  assert.deepEqual(second.blockedEvidence, expected);
});

test("forged eligible qa must satisfy exact Task 7 signal validity", () => {
  const sparseKnowledgePoints = ["小数意义"];
  sparseKnowledgePoints.length = 2;
  const invalidKnowledgePoints = [
    Array.from({ length: 9 }, (_, index) => `知识点${index}`),
    sparseKnowledgePoints,
    [" 小数意义 "],
    ["知识\u0000点"],
    ["知识\uD800点"],
    ["知".repeat(81)],
    ["provider: secret-provider"],
    ["Generated by Terra."],
    ["Response from the Sol provider"],
    ["Powered by MiniMax"],
    ["DeepSeek response"],
    ["OpenAI generated this"],
    ["前缀 {\"raw\":\"secret-raw\"} 后缀"],
    ["[\"secret-array\"]"]
  ];

  for (const knowledgePoints of invalidKnowledgePoints) {
    const fixture = studentFixture();
    fixture.tasks = [];
    fixture.submissions = [];
    fixture.mistakes = [];
    fixture.qaSessions = [{
      ...fixture.qaSessions[0],
      metadata: qaMetadata({
        learningSignal: { ...qaLearningSignal, knowledgePoints }
      })
    }];

    const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });
    const serializedPublic = JSON.stringify(snapshot.publishedView);

    assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 0, JSON.stringify(knowledgePoints));
    assert.equal(snapshot.profileEvidencePack.blockedEvidence[0].reason, "malformed-output");
    for (const forbidden of ["secret-provider", "Terra", "Sol", "MiniMax", "DeepSeek", "OpenAI", "secret-raw", "secret-array"]) {
      assert.equal(serializedPublic.includes(forbidden), false, forbidden);
    }
  }

  const sparseHypotheses = ["继续观察"];
  sparseHypotheses.length = 2;
  for (const misconceptionHypotheses of [
    Array.from({ length: 6 }, (_, index) => `假设${index}`),
    sparseHypotheses,
    [" prompt: secret-prompt "],
    ["误".repeat(161)]
  ]) {
    const fixture = studentFixture();
    fixture.tasks = [];
    fixture.submissions = [];
    fixture.mistakes = [];
    fixture.qaSessions = [{
      ...fixture.qaSessions[0],
      metadata: qaMetadata({
        learningSignal: { ...qaLearningSignal, misconceptionHypotheses }
      })
    }];

    const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

    assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 0, JSON.stringify(misconceptionHypotheses));
    assert.equal(snapshot.profileEvidencePack.blockedEvidence[0].reason, "malformed-output");
    assert.equal(JSON.stringify(snapshot.publishedView).includes("secret-prompt"), false);
  }
});

test("one qa session with multiple knowledge points stays one weak source", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.mistakes = [];
  fixture.qaSessions = [{
    ...fixture.qaSessions[0],
    metadata: qaMetadata({
      learningSignal: {
        ...qaLearningSignal,
        knowledgePoints: ["小数意义", "小数位值", "小数读写"]
      }
    })
  }];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 3);
  assert.equal(snapshot.profileEvidencePack.qaEvidence.every((item) => item.sessionCount === 1 && item.confidence === "weak"), true);
  assert.equal(snapshot.profileEvidencePack.sourceQuality.qaCount, 1);
  assert.equal(snapshot.profileEvidencePack.sourceQuality.hasSparseEvidence, true);
  assert.equal(snapshot.sourceCounts.qaSessions, 1);
  assert.equal(snapshot.publishedView.overview.confidence, "weak");
  assert.equal(snapshot.publishedView.subjectOverview.find((item) => item.subject === "数学").confidence, "weak");
  const qaTimeline = snapshot.publishedView.timelinePreview.filter((item) => item.type === "qa");
  assert.equal(qaTimeline.length, 1);
  assert.equal(qaTimeline[0].id, "qa_eligible_1");
  assert.equal(qaTimeline[0].at, "2026-07-05T08:00:00.000Z");
  assert.deepEqual(qaTimeline[0].evidenceRefs, ["qa_eligible_1"]);
  assert.equal(qaTimeline[0].confidence, "weak");
  assert.match(qaTimeline[0].title, /问答辅助观察/);
  assert.match(qaTimeline[0].text, /辅助观察/);
  assert.equal(JSON.stringify(qaTimeline).includes(fixture.qaSessions[0].question), false);
  assert.equal(JSON.stringify(qaTimeline).includes(fixture.qaSessions[0].answer), false);
  assert.equal(snapshot.publishedView.timelinePreview.length <= 6, true);
  assert.deepEqual(
    snapshot.publishedView.timelinePreview.map((item) => item.at),
    [...snapshot.publishedView.timelinePreview.map((item) => item.at)].sort().reverse()
  );
});

test("duplicate qa session ids cannot inflate aggregate or source strength", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.mistakes = [];
  fixture.qaSessions = [
    fixture.qaSessions[0],
    {
      ...fixture.qaSessions[1],
      id: "qa_eligible_1"
    },
    {
      ...fixture.qaSessions[1],
      id: "qa_eligible_1",
      createdAt: "not-a-valid-date"
    }
  ];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 1);
  assert.equal(snapshot.profileEvidencePack.qaEvidence[0].sessionCount, 1);
  assert.equal(snapshot.profileEvidencePack.qaEvidence[0].confidence, "weak");
  assert.equal(snapshot.sourceCounts.qaSessions, 1);
  assert.equal(snapshot.publishedView.overview.confidence, "weak");
  assert.equal(
    snapshot.publishedView.timelinePreview.find((item) => item.type === "qa").at,
    "2026-07-05T09:00:00.000Z"
  );
});

test("ineligible and legacy qa stay out of public evidence", () => {
  const fixture = studentFixture();
  const blockedIds = fixture.qaSessions.slice(2).map((item) => item.id).sort();
  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });
  const publicEvidence = JSON.stringify(snapshot.publishedView);
  const qaBlockedIds = snapshot.profileEvidencePack.blockedEvidence
    .filter((item) => item.type === "qa")
    .map((item) => item.id)
    .sort();

  assert.deepEqual(qaBlockedIds, blockedIds);
  for (const session of fixture.qaSessions.slice(2)) {
    assert.equal(publicEvidence.includes(session.id), false, session.id);
    assert.equal(publicEvidence.includes(session.question), false, session.id);
    assert.equal(publicEvidence.includes(session.answer), false, session.id);
  }
});

test("qa blockedEvidence is minimal while grading blockers retain teacher context", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });
  const qaBlocked = pack.blockedEvidence.filter((item) => item.type === "qa");
  const gradingBlocked = pack.blockedEvidence.find((item) => item.type === "grading");

  assert.equal(qaBlocked.every((item) => (
    JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["date", "id", "reason", "type"])
  )), true);
  assert.deepEqual(qaBlocked.map((item) => item.reason).sort(), [
    "identity-unconfirmed",
    "legacy-qa-record",
    "malformed-output",
    "model-unavailable",
    "teacher-test",
    "unsafe-content"
  ]);
  assert.deepEqual(gradingBlocked, {
    id: "sub_blocked",
    type: "grading",
    subject: "语文",
    title: "低置信识别",
    at: "2026-07-04T10:00:00.000Z",
    score: null,
    summary: "低置信 OCR。",
    knowledgePoints: [],
    confidence: "blocked",
    reason: "批改结果未完成教师确认或置信不足。"
  });
  assert.equal(JSON.stringify(qaBlocked).includes("不得进入档案"), false);

  for (const role of ["student", "parent"]) {
    const publicView = JSON.stringify(filterStudentProfileSnapshot(
      buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now }),
      role
    ));
    assert.equal(publicView.includes("低置信 OCR"), false);
    assert.equal(publicView.includes("批改结果未完成教师确认或置信不足"), false);
  }
});

test("student and parent views hide learningSignal, profileEvidencePack, blocked reasons, and full qa text", () => {
  const fixture = studentFixture();
  const snapshot = {
    ...buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now }),
    learningSignal: { knowledgePoints: ["leaked-signal"] },
    blockedReason: "leaked-blocked-reason",
    question: "leaked-full-question",
    answer: "leaked-full-answer"
  };

  for (const role of ["student", "learner", "parent"]) {
    const filtered = filterStudentProfileSnapshot(snapshot, role);
    const serialized = JSON.stringify(filtered);
    assert.equal(filtered.teacherReview, undefined);
    assert.equal(filtered.profileEvidencePack, undefined);
    assert.equal(filtered.learningSignal, undefined);
    assert.equal(filtered.blockedReason, undefined);
    assert.equal(filtered.question, undefined);
    assert.equal(filtered.answer, undefined);
    for (const forbidden of ["leaked-signal", "leaked-blocked-reason", "leaked-full-question", "leaked-full-answer", "完整问题", "完整回答"]) {
      assert.equal(serialized.includes(forbidden), false, `${role}/${forbidden}`);
    }
  }
});

test("qa conflicts with confirmed grading or mistake evidence add a teacher review note", () => {
  const fixture = studentFixture();
  fixture.qaSessions = [
    {
      ...fixture.qaSessions[0],
      metadata: qaMetadata({
        learningSignal: {
          ...qaLearningSignal,
          knowledgePoints: ["两步应用题"],
          difficultySignal: "none",
          followUpNeeded: false
        }
      })
    }
  ];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(snapshot.teacherReview.conflictNotes.length, 1);
  assert.match(snapshot.teacherReview.conflictNotes[0], /数学/);
  assert.match(snapshot.teacherReview.conflictNotes[0], /两步应用题/);
  assert.match(snapshot.teacherReview.conflictNotes[0], /人工复核/);
});

test("qa conflict matching accepts only controlled pedagogical aliases", () => {
  const fixture = studentFixture();
  fixture.tasks = [];
  fixture.submissions = [];
  fixture.qaSessions = [{
    ...fixture.qaSessions[0],
    metadata: qaMetadata({
      learningSignal: {
        ...qaLearningSignal,
        knowledgePoints: ["小数意义"],
        difficultySignal: "none",
        followUpNeeded: false
      }
    })
  }];
  fixture.mistakes = [{
    ...fixture.mistakes[0],
    knowledgePoint: { name: "小数的意义" },
    masteryResolved: false
  }];

  const aliasSnapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });
  fixture.mistakes[0].knowledgePoint.name = "小数的应用";
  const nearbySnapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(aliasSnapshot.teacherReview.conflictNotes.length, 1);
  assert.match(aliasSnapshot.teacherReview.conflictNotes[0], /小数意义/);
  assert.deepEqual(nearbySnapshot.teacherReview.conflictNotes, []);
});

test("malformed confirmed knowledge points are skipped during qa conflict checks", () => {
  const fixture = studentFixture();
  fixture.qaSessions = [{
    ...fixture.qaSessions[0],
    metadata: qaMetadata({
      learningSignal: {
        ...qaLearningSignal,
        difficultySignal: "none",
        followUpNeeded: false
      }
    })
  }];
  fixture.mistakes = [
    {
      ...fixture.mistakes[0],
      id: "mistake_numeric_point",
      knowledgePoint: { name: 42 },
      prompt: null,
      metadata: { point: null }
    },
    {
      ...fixture.mistakes[0],
      id: "mistake_object_point",
      knowledgePoint: null,
      prompt: null,
      metadata: { point: { internal: "not-comparable" } }
    }
  ];
  fixture.submissions[0].grading.result.questionResults = [
    { knowledgePoint: 42 },
    { knowledgePoint: null, point: { internal: "not-comparable" } },
    { knowledgePoint: null }
  ];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.deepEqual(snapshot.teacherReview.conflictNotes, []);
  assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 1);
  assert.ok(snapshot.publishedView.timelinePreview.length > 0);
});

test("buildStudentGrowthSnapshot creates structured weekly published view with confidence", () => {
  const snapshot = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });

  assert.equal(snapshot.profileType, "weekly_growth");
  assert.equal(snapshot.publishedView.periodType, "weekly");
  assert.ok(snapshot.publishedView.overview.text.includes("本周"));
  assert.ok(snapshot.publishedView.focusSubjects.length <= 1);
  assert.ok(snapshot.publishedView.focusSubjects[0].evidenceRefs.length > 0);
  assert.ok(snapshot.teacherReview.pendingConfirmations.some((item) => item.id === "sub_blocked"));
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

test("selectProfileSnapshotForRole keeps newest teacher snapshot and newest exact published student snapshot", () => {
  assert.equal(typeof profileModule.selectProfileSnapshotForRole, "function");
  const { selectProfileSnapshotForRole } = profileModule;
  const newestDraft = { draftStatus: "draft", marker: "newest-draft" };
  const newestPublished = { draftStatus: "published", marker: "newest-published" };
  const olderPublished = { draftStatus: "published", marker: "older-published" };
  const profiles = [
    { snapshot: newestDraft },
    { snapshot: { draftStatus: "PUBLISHED", marker: "wrong-case" } },
    { snapshot: newestPublished },
    { snapshot: olderPublished }
  ];

  assert.equal(selectProfileSnapshotForRole(profiles, "teacher"), newestDraft);
  assert.equal(selectProfileSnapshotForRole(profiles, "student"), newestPublished);
  assert.equal(selectProfileSnapshotForRole([{ snapshot: newestDraft }], "student"), null);
  assert.equal(selectProfileSnapshotForRole([], "teacher"), null);
});

test("student profile routes enforce teacher drafts and role-based published selection", () => {
  const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const profileQueryHelper = server.slice(
    server.indexOf("function profileRecordsQueryForRole"),
    server.indexOf("function mapStudent")
  );
  const aggregateRoute = server.slice(
    server.indexOf('app.post("/api/students/:studentId/profile/aggregate"'),
    server.indexOf('app.get("/api/students/:studentId/profile"')
  );
  const draftRoute = server.slice(
    server.indexOf('app.post("/api/students/:studentId/profile/draft"'),
    server.indexOf('app.post("/api/students/:studentId/profile/publish"')
  );
  const getRoute = server.slice(
    server.indexOf('app.get("/api/students/:studentId/profile"'),
    server.indexOf('app.post("/api/students/:studentId/term-report/draft"')
  );
  const bootstrapRoute = server.slice(
    server.indexOf('app.get("/api/bootstrap"'),
    server.indexOf('app.post("/api/ai/qa"')
  );

  assert.match(aggregateRoute, /requireSession\(config, \["teacher"\]\)/);
  assert.match(aggregateRoute, /draftStatus: "draft"/);
  assert.match(aggregateRoute, /draftGeneratedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(aggregateRoute, /narrative: \{\s*\.\.\.safeJson\(mergedSnapshot\.narrative, \{\}\),\s*generatedBy: narrativeResult\.generatedBy,/);
  assert.match(aggregateRoute, /narrative: \{\s*\.\.\.safeJson\(mergedSnapshot\.narrative, \{\}\),[\s\S]*aiGenerated: narrativeResult\.aiGenerated,/);
  assert.match(draftRoute, /narrative: \{\s*\.\.\.safeJson\(mergedSnapshot\.narrative, \{\}\),\s*generatedBy: narrativeResult\.generatedBy,/);
  assert.match(draftRoute, /narrative: \{\s*\.\.\.safeJson\(mergedSnapshot\.narrative, \{\}\),[\s\S]*aiGenerated: narrativeResult\.aiGenerated,/);
  assert.match(aggregateRoute, /filterStudentProfileSnapshot\(snapshot, "teacher"\)/);
  assert.match(profileQueryHelper, /role === "teacher"/);
  assert.match(profileQueryHelper, /path: \["draftStatus"\]/);
  assert.match(profileQueryHelper, /equals: "published"/);
  assert.match(profileQueryHelper, /orderBy: \{ createdAt: "desc" \}/);
  assert.match(profileQueryHelper, /take: 1/);
  assert.doesNotMatch(profileQueryHelper, /take: 20/);
  assert.match(getRoute, /profiles: profileRecordsQueryForRole\(req\.session\.role\)/);
  assert.match(getRoute, /selectProfileSnapshotForRole\(student\.profiles, req\.session\.role\)/);
  assert.match(getRoute, /mapStudent\(student, req\.session\.role\)/);
  assert.match(bootstrapRoute, /profiles: profileRecordsQueryForRole\(req\.session\.role\)/);
});

test("profile aggregate contract documents teacher-only draft persistence and published student reads", () => {
  const contract = fs.readFileSync(new URL("../../../docs/14-api-contract.md", import.meta.url), "utf8");
  const aggregateSection = contract.slice(
    contract.indexOf("- `POST /api/students/:studentId/profile/aggregate`"),
    contract.indexOf("- `GET /api/students/:studentId/profile`")
  );

  assert.match(aggregateSection, /仅教师会话可调用/);
  assert.match(aggregateSection, /`draftStatus=draft`/);
  assert.match(aggregateSection, /学生不能调用/);
  assert.match(aggregateSection, /通过 `GET \/api\/students\/:studentId\/profile` 读取教师已发布内容/);
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
  assert.equal(merged.publishedView.parentNextSteps[0].text, "每天 5 分钟复述题意。");
  assert.equal(merged.teacherReview.internalRisks[0], "仅教师可见");
  assert.equal(studentView.teacherReview, undefined);
  assert.equal(studentView.profileEvidencePack, undefined);
  assert.equal(studentView.providerId, undefined);
  assert.equal(studentView.modelRunId, undefined);
  assert.equal(studentView.publishedView.overview.provider, undefined);
  assert.equal(studentView.publishedView.focusSubjects[0].modelRunId, undefined);
});

test("profile draft rejects the entire AI public narrative when any nested claim uses inadmissible evidence", () => {
  const base = buildStudentGrowthSnapshot(studentFixture(), { periodType: "weekly", now });
  for (const claim of [
    { text: "UNSAFE_PENDING_CLAIM", evidenceRefs: ["sub_blocked"], confidence: "supported" },
    { text: "UNSAFE_UNKNOWN_CLAIM", evidenceRefs: ["invented-source"], confidence: "confirmed" },
    { text: "UNSAFE_BLOCKED_CLAIM", evidenceRefs: ["sub_ok"], confidence: "blocked" },
    { text: "UNSAFE_MALFORMED_REFS", evidenceRefs: "sub_ok", confidence: "confirmed" }
  ]) {
    const input = structuredClone(base);
    const merged = mergeStudentProfileAiDraft(input, {
      publishedView: {
        overview: { text: "UNSAFE_OVERVIEW_PENDING", evidenceRefs: ["sub_ok"], confidence: "supported" },
        tutoringFocus: [claim]
      },
      teacherReview: { internalRisks: ["Teacher-only model suggestion"] }
    });
    assert.deepEqual(merged.publishedView, base.publishedView);
    assert.deepEqual(merged.narrative, base.narrative);
    assert.deepEqual(merged.printView, base.printView);
    assert.ok(merged.teacherReview.internalRisks.some((item) => typeof item === "string" && item.includes("来源引用")));
    assert.equal(JSON.stringify(filterStudentProfileSnapshot(merged, "parent")).includes("UNSAFE_"), false);
    assert.deepEqual(input, base);
  }
});

test("profile draft preserves admitted evidence IDs and grouped source references", () => {
  const student = studentFixture();
  student.reports = [{ id: "report_ok", title: "Teacher report", content: "Reviewed report", createdAt: now }];
  const base = buildStudentGrowthSnapshot(student, { periodType: "weekly", now });
  const pack = base.profileEvidencePack;
  const refs = [
    ...pack.taskEvidence, ...pack.gradingEvidence, ...pack.mistakeEvidence,
    ...pack.qaEvidence, ...pack.classroomEvidence, ...pack.teacherObservationEvidence,
    ...pack.reportEvidence
  ].flatMap((item) => [item.id, ...(item.sourceRefs || [])]).filter(Boolean);
  assert.ok(refs.includes("report_ok"));
  assert.ok(refs.includes("qa_eligible_1"));
  for (const ref of refs) {
    const merged = mergeStudentProfileAiDraft(base, {
      publishedView: { overview: { text: "Admitted source summary", evidenceRefs: [ref], confidence: "supported" } }
    });
    assert.equal(merged.publishedView.overview.text, "Admitted source summary", ref);
    assert.equal(merged.teacherReview.internalRisks.some((item) => typeof item === "string" && item.includes("来源引用")), false);
  }
});

test("empty-period profiles keep light feedback without parent tasks in public or print content", () => {
  for (const periodType of ["weekly", "monthly"]) {
    const student = { id: "empty", displayName: "Test student", submissions: studentFixture().submissions.slice(1) };
    const base = buildStudentGrowthSnapshot(student, { periodType, now });
    assert.equal(base.profileEvidencePack.blockedEvidence.length, 1);
    assert.deepEqual(base.publishedView.parentNextSteps, []);
    const merged = mergeStudentProfileAiDraft(base, {
      publishedView: {
        overview: { text: "本周期记录不足，继续观察。", evidenceRefs: [], confidence: "weak" },
        parentNextSteps: [{ text: "每天5分钟复述数学解题步骤。", evidenceRefs: [], confidence: "weak" }]
      }
    });
    assert.equal(merged.publishedView.overview.text, "本周期记录不足，继续观察。");
    assert.deepEqual(merged.publishedView.parentNextSteps, []);
    for (const snapshot of [base, merged]) {
      assert.deepEqual(snapshot.printView.sections.parentNextSteps, []);
      assert.deepEqual(snapshot.printView.sections.homeSchoolCollaboration || [], []);
      assert.equal(snapshot.printView.sections.parentCommunicationSummary.text, "本周期可用学习记录不足，暂无具体家庭配合任务，待教师补充记录后再沟通。");
      const html = renderStudentGrowthProfilePrintHtml(student, snapshot);
      assert.equal(html.includes("在家短时间复述"), false);
      assert.equal(html.includes("每天5分钟"), false);
    }
  }
});

test("student profile AI prompt requires structured growth archive JSON", () => {
  const runtime = fs.readFileSync(new URL("../../../packages/ai/src/runtime.js", import.meta.url), "utf8");

  assert.match(runtime, /profileType/);
  assert.match(runtime, /publishedView/);
  assert.match(runtime, /teacherReview/);
  assert.match(runtime, /evidenceRefs/);
  assert.match(runtime, /confidence/);
  assert.match(runtime, /不要提及任何模型或供应商/);
  assert.match(runtime, /无可准入学习记录时.*parentNextSteps.*空数组/);
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

test("student profile print workflow is wired through API and teacher UI", () => {
  const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const webApi = fs.readFileSync(new URL("../../../apps/web/src/api.ts", import.meta.url), "utf8");
  const webMain = fs.readFileSync(new URL("../../../apps/web/src/main.tsx", import.meta.url), "utf8");

  assert.match(server, /renderStudentGrowthProfilePrintHtml/);
  assert.match(server, /\/api\/students\/:studentId\/profile\/print/);
  assert.match(server, /student-profile-print-/);
  assert.match(webApi, /generateStudentProfilePrint/);
  assert.match(webMain, /生成打印版/);
  assert.match(webMain, /profilePrintAsset/);
});
