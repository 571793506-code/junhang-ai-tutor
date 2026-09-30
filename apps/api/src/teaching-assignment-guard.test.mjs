import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { requireTeachingAssignmentAccess, checkTeachingAssignmentAccess, teachingAssignmentPreviewReview, rejectPublishedAssignmentSourceMutation } from "./teaching-assignment-guard.js";

test("publication markers require server verification and guard failures expose only safe errors", async () => {
  const assignment = { id: "a1", metadata: { workflowPublication: { teacherId: "t1" } } };
  assert.equal(await requireTeachingAssignmentAccess({ assignment: { metadata: {} } }), false);
  await assert.rejects(requireTeachingAssignmentAccess({ assignment }), { code: "WORKFLOW_ASSIGNMENT_UNAVAILABLE" });
  let status; let body; let verified = 0;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  const req = { session: { teacherId: "t1" } };
  assert.equal(await checkTeachingAssignmentAccess(req, res, assignment, { verify: async ({ actor, assignment: received }) => {
    verified++; assert.deepEqual(actor, { teacherId: "t1" }); assert.equal(received, assignment);
  } }), true);
  assert.equal(verified, 1);
  assert.equal(await checkTeachingAssignmentAccess(req, res, assignment, { verify: async () => { throw Object.assign(new Error("PRIVATE"), { code: "WORKFLOW_FORBIDDEN" }); } }), false);
  assert.equal(status, 403); assert.doesNotMatch(JSON.stringify(body), /PRIVATE/);
  assert.equal(rejectPublishedAssignmentSourceMutation(res, assignment), true); assert.equal(status, 409);
  assert.equal(rejectPublishedAssignmentSourceMutation(res, { metadata: {} }), false);
});

test("the actual preview exporter preserves content confirmation and requires successful layout", async () => {
  const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("async function exportAssessmentDraftForReview(");
  const end = source.indexOf("\n}\n", start);
  assert.ok(start > 0 && end > start);
  let layout = { ok: false }; let saved; let failRender = false;
  const exportDraft = vm.runInNewContext(`${source.slice(start, end + 2)}\nexportAssessmentDraftForReview`, {
    safeJson: (v, fallback) => v && typeof v === "object" ? v : fallback,
    exportAssessmentPaperAsset: async () => { if (failRender) throw new Error("RENDER_FAILED"); return { layoutValidation: layout, asset: { id: "asset", url: "/preview.pdf" } }; },
    throwIfAssessmentGenerationCancelled: () => {}, teachingAssignmentPreviewReview,
    mergeGenerationPipeline: (metadata, patch) => ({ ...metadata.generationPipeline, ...patch }),
    prisma: { assignment: { update: async ({ data }) => { saved = data; } } }
  });
  const assignment = { id: "a1", metadata: { draftReviewStatus: "accepted", workflowPublication: { revision: 3 }, gradingSourcePackage: { fingerprint: "stable" } } };
  await exportDraft({}, assignment, { trustedWorkflow: true });
  assert.equal(saved.metadata.draftReviewStatus, "accepted");
  assert.equal(saved.metadata.generationPipeline.gates.finalExportAllowed, false);
  layout = { ok: true };
  await exportDraft({}, assignment, { trustedWorkflow: true });
  assert.equal(saved.metadata.draftReviewStatus, "accepted");
  assert.equal(saved.metadata.generationPipeline.gates.finalExportAllowed, true);
  assert.equal(saved.metadata.gradingSourcePackage.fingerprint, "stable");
  await exportDraft({}, assignment);
  assert.equal(saved.metadata.draftReviewStatus, "pending_teacher_review");
  const rejected = { ...assignment, metadata: { ...assignment.metadata, draftReviewStatus: "rejected" } };
  await exportDraft({}, rejected, { trustedWorkflow: true });
  assert.equal(saved.metadata.draftReviewStatus, "rejected");
  saved = null; failRender = true;
  await assert.rejects(exportDraft({}, assignment, { trustedWorkflow: true }), /RENDER_FAILED/);
  assert.equal(saved, null); assert.equal(assignment.metadata.draftReviewStatus, "accepted");
});

function routeFromServer(url, globals) {
  const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(`app.post("${url}",`);
  const end = source.indexOf("\n}));", start);
  assert.ok(start > 0 && end > start);
  let route;
  vm.runInNewContext(source.slice(start, end + 5), {
    app: { post: (...args) => { route = args.at(-1); } }, requireDatabase: () => {}, requireSession: () => () => {}, config: {},
    asyncRoute: (fn) => fn, safeJson: (v, fallback) => v && typeof v === "object" ? v : fallback,
    checkTeachingAssignmentAccess, assertTeacherStudentScope: async () => true, ...globals
  });
  return route;
}

test("formal export route checks publication ownership, layout and rejection before rendering", async () => {
  const assignment = { id: "a1", metadata: { workflowPublication: { teacherId: "t1" }, draftReviewStatus: "accepted" } };
  let allowed = false; let status; let body;
  const route = routeFromServer("/api/assessments/:assignmentId/print-export", {
    prisma: { assignment: { findUnique: async () => assignment } },
    teachingWorkflowAssignmentService: { verify: async () => { if (!allowed) throw Object.assign(new Error("PRIVATE"), { code: "WORKFLOW_FORBIDDEN" }); } }
  });
  const req = { session: { teacherId: "t1" }, params: { assignmentId: "a1" } };
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await route(req, res); assert.equal(status, 403);
  allowed = true;
  await route(req, res); assert.equal(body.error, "ASSESSMENT_LAYOUT_INVALID");
  assignment.metadata.layoutValidation = { ok: true }; assignment.metadata.draftReviewStatus = "rejected";
  await route(req, res); assert.equal(body.error, "DRAFT_REVIEW_REQUIRED");
});

test("legacy draft review cannot accept or reject an immutable workflow publication", async () => {
  let status; let body;
  const assignment = { id: "a1", metadata: { workflowPublication: { revision: 3 }, draftReviewStatus: "accepted", layoutValidation: { ok: true } } };
  const route = routeFromServer("/api/assessments/:assignmentId/draft-review", {
    optionalText: (value) => value,
    prisma: { assignment: { findUnique: async () => assignment, update: async () => { throw new Error("must not change published confirmation"); } } },
    teachingWorkflowAssignmentService: { verify: async () => true },
    rejectPublishedAssignmentSourceMutation
  });
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  for (const decision of ["accept", "reject"]) {
    await route({ session: { teacherId: "t1" }, params: { assignmentId: "a1" }, body: { decision } }, res);
    assert.equal(status, 409); assert.equal(body.error, "WORKFLOW_ASSIGNMENT_IMMUTABLE");
    assert.equal(assignment.metadata.draftReviewStatus, "accepted");
  }
});

test("formal workflow export cannot report completion when the answer PDF renderer fails", async () => {
  let status; let body;
  const assignment = { id: "a1", metadata: { workflowPublication: { teacherId: "t1" }, draftReviewStatus: "accepted", layoutValidation: { ok: true } } };
  const route = routeFromServer("/api/assessments/:assignmentId/print-export", {
    prisma: { assignment: { findUnique: async () => assignment, update: async () => { throw new Error("must not mark final_exported"); } } },
    teachingWorkflowAssignmentService: { verify: async () => true },
    normalizeGeneratedHtml: (x) => x, answerAnalysisHtml: () => "<html>analysis</html>", storageGeneratedRoot: () => "/fake",
    fs: { mkdirSync: () => {}, writeFileSync: () => {} }, path: { join: (...parts) => parts.join("/") },
    exportAssessmentPaperAsset: async () => ({ layoutValidation: { ok: true }, asset: { id: "paper" } }),
    renderPdfFromHtml: async () => ({ ok: false, reason: "PRIVATE" })
  });
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await route({ session: { teacherId: "t1" }, params: { assignmentId: "a1" } }, res);
  assert.equal(status, 503); assert.equal(body.error, "ASSESSMENT_ANALYSIS_PDF_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE/);
});

test("formal analysis export keeps adaptive pages and preserves comprehensive duplex padding", async () => {
  for (const purpose of ["focused", "multi_day", "comprehensive"]) {
    let body; let savedAnalysis; let paddingCalls = 0;
    const assignment = { id: "a1", title: "练习", metadata: { purpose, draftReviewStatus: "accepted", layoutValidation: { ok: true } } };
    const route = routeFromServer("/api/assessments/:assignmentId/print-export", {
      prisma: {
        assignment: { findUnique: async () => assignment, update: async () => assignment },
        generatedAsset: { create: async ({ data }) => { savedAnalysis = data; return { id: "analysis", ...data }; } }
      },
      teachingWorkflowAssignmentService: {},
      normalizeGeneratedHtml: (x) => x, answerAnalysisHtml: () => "<html>analysis</html>", storageGeneratedRoot: () => "/fake",
      fs: { mkdirSync: () => {}, writeFileSync: () => {} }, path: { join: (...parts) => parts.join("/") },
      exportAssessmentPaperAsset: async () => ({ layoutValidation: { ok: true }, asset: { id: "paper", url: "/paper.pdf", metadata: {} } }),
      renderPdfFromHtml: async () => ({ ok: true }),
      assessmentPrintPlan: (input) => ({ adaptive: ["focused", "multi_day"].includes(input.metadata.purpose) }),
      countPdfPages: () => 1,
      ensureEvenPdfPages: () => { paddingCalls++; return { pageCount: 2, addedBlankPage: true }; },
      gradingSourcePackageForAssignment: () => ({}), gradingSourceReference: () => ({}),
      publicGeneratedUrl: (name) => `/generated/${name}`, mergeGenerationPipeline: (_, patch) => patch,
      auditEvent: async () => {}
    });
    const res = { status(s) { throw new Error(`Unexpected HTTP ${s}`); }, json(b) { body = b; return this; } };
    await route({ session: { teacherId: "t1" }, params: { assignmentId: "a1" } }, res);
    const comprehensive = purpose === "comprehensive";
    assert.equal(body.ok, true);
    assert.equal(paddingCalls, comprehensive ? 1 : 0);
    assert.equal(savedAnalysis.metadata.pdfPageCount, comprehensive ? 2 : 1);
    assert.equal(savedAnalysis.metadata.pdfAddedBlankPage, comprehensive);
    assert.equal(body.generationPipeline.gates.finalExported, true);
  }
});

test("a student-specific published assignment is not listed for classmates of the same grade", () => {
  const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("  const visibleAssignments = assignments.filter(");
  const end = source.indexOf("\n  });", start);
  assert.ok(start > 0 && end > start);
  const assignment = { metadata: { workflowPublication: { revision: 3 }, teacherId: "t1", targetStudentId: "s1", targetGrade: "四年级", draftReviewStatus: "accepted" } };
  const visible = (studentId, review = "accepted") => vm.runInNewContext(`${source.slice(start, end + 6)}\nvisibleAssignments.length`, {
    assignments: [{ ...assignment, metadata: { ...assignment.metadata, draftReviewStatus: review } }],
    req: { session: { role: "student", studentId } }, safeJson: (v) => v, visibleStudentIds: new Set([studentId]), visibleStudents: [{ id: studentId, grade: "四年级" }]
  });
  assert.equal(visible("s1"), 1); assert.equal(visible("s2"), 0); assert.equal(visible("s1", "rejected"), 0);
});
