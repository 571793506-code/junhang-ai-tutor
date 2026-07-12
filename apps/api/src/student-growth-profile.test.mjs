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

test("buildProfileEvidencePack includes reviewed evidence and blocks provisional grading", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.period.type, "weekly");
  assert.equal(pack.gradingEvidence.length, 1);
  assert.equal(pack.gradingEvidence[0].id, "sub_ok");
  assert.ok(pack.blockedEvidence.some((item) => item.id === "sub_blocked"));
  assert.equal(pack.sourceQuality.hasBlockedEvidence, true);
});

test("only eligible qa-learning-signal-v1 records enter qaEvidence", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });

  assert.equal(pack.qaEvidence.length, 1);
  assert.equal(pack.qaEvidence[0].subject, "数学");
  assert.equal(pack.qaEvidence[0].knowledgePoint, "小数意义");
  assert.equal(pack.qaEvidence[0].sessionCount, 2);
  assert.deepEqual(pack.qaEvidence[0].sourceRefs, ["qa_eligible_1", "qa_eligible_2"]);
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
    }
  ];

  const snapshot = buildStudentGrowthSnapshot(fixture, { periodType: "weekly", now });

  assert.equal(snapshot.profileEvidencePack.qaEvidence.length, 1);
  assert.equal(snapshot.profileEvidencePack.qaEvidence[0].sessionCount, 1);
  assert.equal(snapshot.profileEvidencePack.qaEvidence[0].confidence, "weak");
  assert.equal(snapshot.sourceCounts.qaSessions, 1);
  assert.equal(snapshot.publishedView.overview.confidence, "weak");
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

test("teacher blockedEvidence contains only minimal fixed fields", () => {
  const pack = buildProfileEvidencePack(studentFixture(), { periodType: "weekly", now });
  const qaBlocked = pack.blockedEvidence.filter((item) => item.type === "qa");

  assert.equal(pack.blockedEvidence.every((item) => (
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
  assert.equal(JSON.stringify(pack.blockedEvidence).includes("不得进入档案"), false);
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
