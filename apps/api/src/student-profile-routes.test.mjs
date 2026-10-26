import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { mergeStudentProfileAiDraft } from "./student-growth-profile.js";
import { evaluateStudentProfilePublish, markStudentProfileTeacherConfirmation } from "./student-profile-publish-gate.js";

const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

// Execute the registered production handler with isolated IO; never start the live server.
async function runProfileRoute(action, body) {
  const start = server.indexOf(`app.post("/api/students/:studentId/profile/${action}"`);
  assert.ok(start >= 0);
  const end = server.indexOf('\napp.post(', start + 1);
  const effects = { profiles: [], assets: [], files: [], audits: [] };
  let handler;
  const scope = {
    app: { post: (_url, ...handlers) => { handler = handlers.at(-1); } },
    requireDatabase() {}, requireSession: () => () => {}, config: {}, asyncRoute: (fn) => fn,
    assertTeacherStudentScope: async () => true, getBody: (req) => req.body,
    loadStudentProfileSources: async () => ({ id: "student-test", displayName: "测试学生" }),
    safeJson: (value, fallback) => value ?? fallback,
    normalizeProfilePeriodType: (value, fallback) => value || fallback,
    buildStudentGrowthSnapshot: () => ({
      draftStatus: "draft", publishedView: { overview: { text: "待教师复核" } },
      teacherReview: { pendingConfirmations: [] }
    }),
    mergeStudentProfileAiDraft, evaluateStudentProfilePublish, markStudentProfileTeacherConfirmation,
    prisma: {
      studentProfile: { create: async ({ data }) => { effects.profiles.push(data); return data; } },
      generatedAsset: { create: async ({ data }) => { effects.assets.push(data); return { id: "asset-test", ...data }; } }
    },
    auditEvent: async (_req, event) => { effects.audits.push(event); },
    mapStudent: (student) => student, filterStudentProfileSnapshot: (snapshot) => snapshot,
    renderStudentGrowthProfilePrintHtml: () => "<html>test</html>",
    fs: { mkdirSync() {}, writeFileSync: (...args) => { effects.files.push(args); } },
    path, storageGeneratedRoot: () => "isolated-test-output",
    normalizeGeneratedHtml: (html) => html, renderPdfFromHtml: async () => ({ ok: true }),
    publicGeneratedUrl: (name) => `/generated/${name}`
  };
  new Function(...Object.keys(scope), server.slice(start, end < 0 ? undefined : end))(...Object.values(scope));
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body, params: { studentId: "student-test" }, session: { teacherId: "authenticated-teacher" } }, res);
  return { res, effects };
}

for (const action of ["publish", "print"]) {
  test(`${action} rejects absent or forged confirmation before any output writes`, async () => {
    for (const confirmTeacherReview of [undefined, false, "true"]) {
      const { res, effects } = await runProfileRoute(action, {
        confirmTeacherReview,
        snapshot: { teacherReview: { status: "confirmed", confirmedByTeacherId: "forged" } }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error, "PROFILE_TEACHER_CONFIRMATION_REQUIRED");
      assert.deepEqual(effects, { profiles: [], assets: [], files: [], audits: [] });
    }
  });

  test(`${action} records the acting teacher only after explicit confirmation`, async () => {
    const { res, effects } = await runProfileRoute(action, { confirmTeacherReview: true });
    assert.equal(res.statusCode, 200);
    const review = res.body.snapshot.teacherReview;
    assert.equal(review.status, "confirmed");
    assert.equal(review.confirmedByTeacherId, "authenticated-teacher");
    assert.ok(Number.isFinite(Date.parse(review.confirmedAt)));
    assert.equal(effects.audits.length, 1);
    if (action === "publish") {
      assert.equal(effects.profiles.length, 1);
      assert.deepEqual(effects.profiles[0].snapshot.teacherReview, review);
      assert.equal(effects.assets.length, 0);
    } else {
      assert.equal(effects.assets.length, 1);
      assert.equal(effects.profiles.length, 0, "printing must not publish a profile");
      assert.equal(res.body.snapshot.draftStatus, "draft");
      assert.equal(effects.assets[0].metadata.confirmedByTeacherId, "authenticated-teacher");
      assert.equal(effects.assets[0].metadata.confirmedAt, review.confirmedAt);
    }
  });
}
