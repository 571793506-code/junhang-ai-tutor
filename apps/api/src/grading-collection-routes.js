import { confirmDialogueContentReview } from "./grading-collection.js";

export function registerGradingCollectionRoutes(app, { prisma, middleware, asyncRoute, mapAssignment, auditEvent, teacherCanAccessStudent }) {
  app.post("/api/grading/source-packages/dialogue/:assignmentId/review", ...middleware, asyncRoute(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.assignmentId },
      include: { subject: true, items: { orderBy: { orderIndex: "asc" } } } });
    if (!assignment) return res.status(404).json({ ok: false, error: "ASSIGNMENT_NOT_FOUND" });
    const body = req.body || {};
    const review = confirmDialogueContentReview(assignment, { teacherId: req.session.teacherId,
      decision: body.decision, fingerprint: body.fingerprint, note: String(body.note || "") });
    if (!review.ok) return res.status(review.reason === "DIALOGUE_SOURCE_TEACHER_MISMATCH" ? 403 : 409)
      .json({ ok: false, error: review.reason, message: "材料版本或审查状态已变化，请核对；需要修改时请登记新版本。" });
    if (!review.replayed) {
      if (!String(body.note || "").trim()) return res.status(400).json({ ok: false, error: "DIALOGUE_TEACHER_DECISION_REQUIRED", message: "请记录教师对本份材料的明确审查回复。" });
      const updated = await prisma.assignment.updateMany({ where: { id: assignment.id, metadata: { equals: assignment.metadata } }, data: { metadata: review.metadata } });
      if (updated.count !== 1) return res.status(409).json({ ok: false, error: "DIALOGUE_SOURCE_REVIEW_CONFLICT", message: "材料已变化，请刷新后核对。" });
      await auditEvent(req, { studentId: review.metadata.targetStudentId || null, feature: "grading-source-package", action: "review-dialogue-content",
        metadata: { assignmentId: assignment.id, decision: body.decision, fingerprint: body.fingerprint } });
    }
    res.json({ ok: true, replayed: Boolean(review.replayed), assignment: mapAssignment({ ...assignment, metadata: review.metadata, submissions: [] }) });
  }));

  app.get("/api/grading/collections", ...middleware, asyncRoute(async (req, res) => {
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";
    if (batchId.length > 120) return res.status(400).json({ ok: false, error: "COLLECTION_BATCH_INVALID" });
    const records = await prisma.submission.findMany({ where: { AND: [
      { content: { path: ["collectionTeacherId"], equals: req.session.teacherId } },
      ...(batchId ? [{ content: { path: ["collectionBatchId"], equals: batchId } }] : [])
    ] }, orderBy: { submittedAt: "desc" }, take: 201 });
    const allowed = new Set();
    for (const studentId of new Set(records.slice(0, 200).map(record => record.studentId))) {
      if (await teacherCanAccessStudent(req.session.teacherId, studentId)) allowed.add(studentId);
    }
    res.json({ ok: true, capped: records.length > 200, submissions: records.slice(0, 200)
      .filter(record => allowed.has(record.studentId) && record.content?.collectionBatchId).map(record => ({
        batchId: record.content.collectionBatchId, title: record.content.collectionTitle || "同卷采集",
        assignmentId: record.assignmentId, studentId: record.studentId, submissionId: record.id,
        imageCount: record.content.imageFiles?.length || record.content.imageTotal || 0,
        status: record.status, submittedAt: record.submittedAt
      })) });
  }));
}
