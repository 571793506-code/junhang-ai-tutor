import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { normalizeTeachingPurpose, normalizeGradeLevel } from "@junhang/core";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const declaration = name => {
  const marker = source.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
};
test("legacy and workflow preparation both exclude unconfirmed grading and retain traceable mistake answers", async () => {
  const student = {
    mistakes: [
      { id: "m1", prompt: "48×6－137", studentAnswer: "191", correctAnswer: "151", metadata: { reviewStatus: "teacher_reviewed" } },
      { id: "pending", prompt: "UNREVIEWED", metadata: {} },
      { id: "resolved", prompt: "RESOLVED", masteryResolved: true, metadata: { reviewStatus: "teacher_reviewed" } }
    ],
    submissions: [
      { id: "s1", grading: { needsReview: false, result: { archiveEligible: true, summary: "CONFIRMED" } } },
      { id: "s2", grading: { needsReview: true, result: { archiveEligible: true, summary: "UNREVIEWED" } } },
      { id: "s3", grading: { needsReview: false, result: { archiveEligible: false, summary: "INELIGIBLE" } } }
    ], tasks: []
  };
  const run = vm.runInNewContext(`${declaration("buildAssessmentStudentSignals")}\n${declaration("prepareAssessmentDraftInput")}\nprepareAssessmentDraftInput`, {
    structuredClone, normalizeTeachingPurpose, normalizeGradeLevel,
    safeJson: (value, fallback) => value && typeof value === "object" ? value : fallback,
    assessmentDraftInputFromRequest: req => structuredClone(req.body), prepareTeacherRequirementEmergency: () => null,
    checkDatabaseStatus: async () => ({ ok: true }), loadStudentProfileSources: async () => structuredClone(student),
    resolveApprovedAssessmentContentContext: async () => ({ approvedOnly: true, matches: [] }),
    validateAssessmentContentContext: () => ({ ok: true }), normalizeAssessmentTargetScope: value => value, prisma: {}
  });
  const req = { body: { studentId: "student-local", subject: "数学", grade: "四年级", kind: "练习", purpose: "focused", requestedItemTypes: ["calculation"], requestedItemCount: 4 } };
  const legacy = await run(req), workflow = await run(req, { confirmedSignalsOnly: true });
  assert.equal(legacy.ok, true);
  assert.doesNotMatch(JSON.stringify(legacy.input.studentSignals), /UNREVIEWED|INELIGIBLE|RESOLVED/);
  assert.deepEqual(legacy.input.studentSignals, workflow.input.studentSignals);
  assert.equal(legacy.input.studentSignals[0].ref, "mistake:m1");
  assert.equal(legacy.input.studentSignals[0].studentAnswer, "191");
  assert.equal(legacy.input.studentSignals[0].correctAnswer, "151");
  assert.equal(legacy.input.studentSignals[1].ref, "submission:s1");
});
