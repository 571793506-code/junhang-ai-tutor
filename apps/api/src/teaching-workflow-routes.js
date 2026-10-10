import express from "express";
import { teachingExplanationContent } from "@junhang/core";

const REQUEST_FIELDS = ["title", "requirement", "subject", "grade", "kind", "purpose", "studentId", "assignmentId", "submissionId", "targetScope", "targetGrade", "difficulty", "contentScope", "knowledgePoints", "requestedItemCount", "requestedItemTypes", "textbookAssetId", "textbookChapterId", "dayPlan"];
const QUESTION_FIELDS = ["id", "questionNo", "orderIndex", "dayId", "sharedMaterialId", "itemType", "prompt", "printedPrompt", "studentAnswer", "answer", "correctAnswer", "options", "score", "maxScore", "status", "rubric", "analysisSteps", "explanation", "knowledgePoint", "commonMistake", "errorStep", "teacherNote", "suggestedPractice", "figure", "answerFormat", "bbox", "reviewedByTeacher", "reviewedAt"];
const INTERNAL_FIELDS = /^(?:raw(?:Output|Payload)?|debug|provider(?:Id)?|model(?:Run|Id)?|apiKey|authorization|sessionToken|databaseUrl|ownerTeacherId|teacherId|confirmedBy|confirmedAt|teacherConfirmation|archiveEligible|archivePublishedAt|finalScore|promptConfig|systemPrompt|generationContext)$/i;
const ERRORS = {
  WORKFLOW_INPUT_INVALID: 400, WORKFLOW_COMMAND_INVALID: 400, WORKFLOW_REVISION_INVALID: 400,
  WORKFLOW_PATCH_REQUIRED: 400, WORKFLOW_PATCH_INVALID: 400, WORKFLOW_QUESTION_PATCH_INVALID: 400,
  WORKFLOW_MATERIAL_PATCH_INVALID: 400, WORKFLOW_DAY_PATCH_INVALID: 400,
  WORKFLOW_EXPLANATION_PATCH_INVALID: 400,
  WORKFLOW_CONFIRM_TARGET_REQUIRED: 400, WORKFLOW_CONFIRM_TARGET_INVALID: 422,
  WORKFLOW_TARGET_SCOPE_INVALID: 422, WORKFLOW_SNAPSHOT_INVALID: 422,
  WORKFLOW_QUESTION_NOT_FOUND: 404, WORKFLOW_MATERIAL_NOT_FOUND: 404, WORKFLOW_DAY_NOT_FOUND: 404,
  WORKFLOW_NOT_FOUND: 404, WORKFLOW_REVISION_NOT_FOUND: 404, WORKFLOW_FORBIDDEN: 403,
  WORKFLOW_VERSION_CONFLICT: 409, WORKFLOW_REQUEST_KEY_REUSED: 409, WORKFLOW_OPERATION_KEY_REUSED: 409,
  WORKFLOW_OPERATION_ACTIVE_OR_REUSED: 409, WORKFLOW_CANCELLED: 409,
  WORKFLOW_CREATION_INCOMPLETE: 409,
  WORKFLOW_ARCHIVE_INVALID: 422, WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED: 422, WORKFLOW_ARCHIVE_UNAVAILABLE: 503,
  WORKFLOW_REQUEST_INCOMPLETE: 422, WORKFLOW_CONTEXT_REQUIRED: 422, WORKFLOW_EVIDENCE_CHANGED: 409,
  WORKFLOW_EXECUTION_FAILED: 503,
  WORKFLOW_ASSIGNMENT_UNAVAILABLE: 503, WORKFLOW_ASSIGNMENT_INVALID: 422, WORKFLOW_CONFIRMATION_REQUIRED: 422,
  WORKFLOW_EXECUTION_UNAVAILABLE: 503, WORKFLOW_VALIDATION_UNAVAILABLE: 503, WORKFLOW_UNAVAILABLE: 503
};

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid() { throw Object.assign(new Error("WORKFLOW_INPUT_INVALID"), { code: "WORKFLOW_INPUT_INVALID" }); }
function pick(value, fields) {
  return Object.fromEntries(fields.filter((key) => object(value) && Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => !INTERNAL_FIELDS.test(key) && !["__proto__", "constructor", "prototype"].includes(key)).map(([key, item]) => [key, clean(item)]));
  return value;
}
function requestInput(value = {}) {
  if (!object(value)) invalid();
  const request = clean(pick(value, REQUEST_FIELDS));
  if (request.dayPlan !== undefined) {
    if (!Array.isArray(request.dayPlan)) invalid();
    request.dayPlan = request.dayPlan.map((day) => pick(day, ["dayId", "goal", "questionCount", "requestedItemCount", "requestedItemTypes", "knowledgePoints"]));
  }
  return request;
}
function workflowView(result) {
  const content = clean(pick(result.snapshot, ["title", "kind", "subject", "grade", "purpose", "targetLabel", "assignmentId", "totalScore"]));
  const questions = Array.isArray(result.snapshot?.questions) ? result.snapshot.questions : Array.isArray(result.snapshot?.items) ? result.snapshot.items : [];
  content.questions = questions.map((q) => ({ ...clean(pick(q, [...QUESTION_FIELDS, "confidence", "page", "sourceImageRef", "cropRef"])),
    ...(result.module === "grading" ? { recognitionCorrectedByTeacher: Boolean(q.studentAnswerReview?.actorTeacherId) && q.studentAnswerReview.studentAnswer === q.studentAnswer } : {}) }));
  if (result.module === "grading") {
    content.pages = (result.snapshot?.pages || []).map((page) => clean(pick(page, ["pageNumber", "imageUrl", "fileName", "imageRefs", "cropRef", "qualityStatus"])));
    content.gradingSummary = { score: result.snapshot?.score ?? null, confirmedScore: result.snapshot?.finalScore ?? null,
      totalScore: result.snapshot?.gradingSourcePackage?.totalScore ?? null,
      unresolvedCount: questions.filter((q) => q.status === "uncertain").length, confirmedCount: questions.filter((q) => q.reviewedByTeacher === true).length };
  }
  content.sharedMaterials = (Array.isArray(result.snapshot?.sharedMaterials) ? result.snapshot.sharedMaterials : []).map((m) => clean(pick(m, ["id", "title", "text"])));
  content.days = (Array.isArray(result.snapshot?.days) ? result.snapshot.days : []).map((day) => clean(pick(day, ["dayId", "goal", "questionCount"])));
  if (result.module === "generation" && result.snapshot?.purpose === "explanation" && object(result.snapshot.explanation)) {
    content.explanation = clean({ ...teachingExplanationContent(result.snapshot.explanation),
      ...pick(result.snapshot.explanation, ["reviewedByTeacher"]) });
  }
  const issues = result.snapshot?.creationPending === true
    ? [{ code: "WORKFLOW_CREATION_INCOMPLETE", message: result.status === "needs_input" ? "任务条件、来源证据或草稿结构尚不完整，请补齐后重新发起。" : "任务已登记，尚无可复核内容。请查看任务状态。" }] : [];
  return { ...workflowSummary(result), content, issues };
}
function workflowSummary(result) {
  return { id: result.workflowId, module: result.module, revision: result.revision, status: result.status, request: requestInput(result.request || {}),
    ...(result.module === "grading" ? { reviewStatus: result.reviewStatus === "teacher_confirmed" ? "teacher_confirmed" : "review_required",
      archive: result.archive?.workflowId === result.workflowId && result.archive.revision === result.revision && result.archive.status === "archived"
        ? pick(result.archive, ["id", "workflowId", "revision", "status"]) : null } : {}) };
}
function commandInput(body) {
  if (!object(body)) invalid();
  const command = pick(body, ["action", "operationKey", "expectedRevision", "targetQuestionIds", "targetExplanation", "instruction"]);
  if (typeof command.operationKey !== "string" || !command.operationKey.trim() || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) invalid();
  if (command.instruction !== undefined && typeof command.instruction !== "string") invalid();
  if (command.targetExplanation !== undefined && (command.targetExplanation !== true || command.targetQuestionIds !== undefined || !["revise", "confirm"].includes(command.action))) invalid();
  if (command.targetQuestionIds !== undefined && (!Array.isArray(command.targetQuestionIds) || !command.targetQuestionIds.length || command.targetQuestionIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(command.targetQuestionIds).size !== command.targetQuestionIds.length)) invalid();
  if (body.restoreRevision !== undefined) command.revision = body.restoreRevision;
  if (body.patch !== undefined) {
    if (!object(body.patch) || !object(body.patch.value)) invalid();
    command.patch = pick(body.patch, ["type", "questionId", "materialId", "dayId"]);
    const fields = body.patch.type === "correct_recognition" ? ["studentAnswer"] : body.patch.type === "replace_question" ? QUESTION_FIELDS.filter((key) => !["reviewedByTeacher", "reviewedAt"].includes(key))
      : body.patch.type === "replace_shared_material" ? ["id", "title", "text"] : ["dayId", "goal", "questionCount"];
    command.patch.value = clean(body.patch.type === "replace_explanation" ? teachingExplanationContent(body.patch.value) : pick(body.patch.value, fields));
  }
  return command;
}

function archiveView(result, req) {
  if (result?.status !== "archived" || typeof result.archiveId !== "string" || !result.archiveId.trim() ||
    result.workflowId !== req.params.id || result.revision !== req.body.expectedRevision ||
    !Number.isSafeInteger(result.revision) || result.revision < 1 ||
    !Number.isSafeInteger(result.currentRevision) || result.currentRevision < result.revision || typeof result.replayed !== "boolean") {
    throw new Error("WORKFLOW_ARCHIVE_RESPONSE_INVALID");
  }
  return { id: result.archiveId, workflowId: result.workflowId, revision: result.revision,
    currentRevision: result.currentRevision, status: "archived", replayed: result.replayed };
}

export function createTeachingWorkflowRouter({ service, archiveService, assignmentService, requireTeacher }) {
  if (typeof requireTeacher !== "function") throw new Error("WORKFLOW_ROUTER_DEPENDENCIES_REQUIRED");
  const router = express.Router();
  router.use(requireTeacher);
  const handle = (run, status = 200, archive = false) => async (req, res) => {
    try {
      if (!req.session?.teacherId || req.session.role !== "teacher") return res.status(403).json({ ok: false, error: "SESSION_FORBIDDEN", message: "当前账号无权执行该操作。" });
      if (archive ? typeof archiveService?.publish !== "function" : !service) return res.status(503).json({ ok: false, error: archive ? "WORKFLOW_ARCHIVE_UNAVAILABLE" : "WORKFLOW_UNAVAILABLE", message: "教学工作流尚未启用。" });
      const result = await run(req, { teacherId: req.session.teacherId });
      const view = archive ? { archive: archiveView(result, req) } : Array.isArray(result)
        ? { workflows: result.map(workflowSummary) }
        : { workflow: workflowView(result) };
      return res.status(typeof status === "function" ? status(result) : status).json({ ok: true, ...view });
    } catch (error) {
      const code = error?.code === "P2034" ? "WORKFLOW_VERSION_CONFLICT" : error?.code;
      const known = Object.hasOwn(ERRORS, code || "");
      return res.status(known ? ERRORS[code] : 500).json({ ok: false, error: known ? code : "WORKFLOW_INTERNAL_ERROR", message: "教学工作流操作未完成。" });
    }
  };
  router.post("/workflows", handle((req, actor) => {
    if (!object(req.body) || typeof req.body.requestKey !== "string" || !req.body.requestKey.trim() || !["generation", "grading"].includes(req.body.module)) invalid();
    return service.create({ actor, input: { requestKey: req.body.requestKey, module: req.body.module, request: requestInput(req.body.request) } });
  }, (result) => ["queued", "running"].includes(result.status) ? 202 : result.status === "ready_for_review" && !result.replayed ? 201 : 200));
  router.get("/workflows", handle((req, actor) => {
    if (!["generation", "grading"].includes(req.query.module)) invalid();
    return service.list({ actor, module: req.query.module });
  }));
  router.get("/workflows/:id", handle((req, actor) => service.get({ actor, workflowId: req.params.id })));
  router.get("/workflows/:id/revisions/:revision", handle((req, actor) => {
    const revision = Number(req.params.revision);
    if (!/^[1-9]\d*$/.test(req.params.revision) || !Number.isSafeInteger(revision)) invalid();
    return service.get({ actor, workflowId: req.params.id, revision });
  }));
  router.post("/workflows/:id/commands", handle((req, actor) => service.execute({ actor, workflowId: req.params.id, command: commandInput(req.body) })));
  router.post("/workflows/:id/archive", handle((req, actor) => {
    if (!object(req.body) || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) invalid();
    return archiveService.publish({ actor, workflowId: req.params.id, expectedRevision: req.body.expectedRevision });
  }, (result) => result.replayed ? 200 : 201, true));
  router.post("/workflows/:id/assignment", async (req, res) => {
    try {
      if (req.session?.role !== "teacher" || !req.session.teacherId) return res.status(403).json({ ok: false, error: "SESSION_FORBIDDEN" });
      if (typeof assignmentService?.publish !== "function") return res.status(503).json({ ok: false, error: "WORKFLOW_ASSIGNMENT_UNAVAILABLE" });
      if (!object(req.body) || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) invalid();
      const result = await assignmentService.publish({ actor: { teacherId: req.session.teacherId }, workflowId: req.params.id, expectedRevision: req.body.expectedRevision });
      if (result?.status !== "assignment_ready" || typeof result.assignmentId !== "string" || !result.assignmentId.trim() || result.workflowId !== req.params.id ||
        result.revision !== req.body.expectedRevision || !Number.isSafeInteger(result.currentRevision) || result.currentRevision < result.revision || typeof result.replayed !== "boolean") throw new Error("WORKFLOW_ASSIGNMENT_RESPONSE_INVALID");
      return res.status(result.replayed ? 200 : 201).json({ ok: true, assignment: { id: result.assignmentId, workflowId: result.workflowId,
        revision: result.revision, currentRevision: result.currentRevision, status: result.status, replayed: result.replayed } });
    } catch (error) {
      const code = error?.code === "P2034" ? "WORKFLOW_VERSION_CONFLICT" : error?.code;
      const known = Object.hasOwn(ERRORS, code || "");
      return res.status(known ? ERRORS[code] : 500).json({ ok: false, error: known ? code : "WORKFLOW_INTERNAL_ERROR", message: "生成版本衔接未完成。" });
    }
  });
  return router;
}
