// A publication marker is a lookup key, never an authorization credential.
export async function requireTeachingAssignmentAccess({ service, actor, assignment }) {
  if (assignment?.metadata?.workflowPublication == null) return false;
  if (typeof service?.verify !== "function") throw Object.assign(new Error("WORKFLOW_ASSIGNMENT_UNAVAILABLE"), { code: "WORKFLOW_ASSIGNMENT_UNAVAILABLE", status: 503 });
  await service.verify({ actor, assignment });
  return true;
}

export function teachingAssignmentPreviewReview(metadata, layoutValidation, trusted) {
  const accepted = trusted && metadata.draftReviewStatus === "accepted";
  return { reviewStatus: accepted ? "accepted" : trusted && metadata.draftReviewStatus === "rejected" ? "rejected" : "pending_teacher_review", finalExportAllowed: accepted && layoutValidation?.ok === true };
}

export async function checkTeachingAssignmentAccess(req, res, assignment, service) {
  if (assignment?.metadata?.source === "dialogue-import" &&
      (req.session?.role !== "teacher" || assignment.metadata.teacherId !== req.session.teacherId)) {
    res.status(403).json({ ok: false, error: "ASSIGNMENT_TEACHER_SCOPE_MISMATCH", message: "此材料仅供登记教师使用。" });
    return false;
  }
  try {
    await requireTeachingAssignmentAccess({ service, actor: { teacherId: req.session?.teacherId }, assignment });
    return true;
  } catch (error) {
    const statuses = { WORKFLOW_ASSIGNMENT_UNAVAILABLE: 503, WORKFLOW_FORBIDDEN: 403, WORKFLOW_NOT_FOUND: 404,
      WORKFLOW_ASSIGNMENT_INVALID: 422, WORKFLOW_CONFIRMATION_REQUIRED: 422, WORKFLOW_SNAPSHOT_INVALID: 422, WORKFLOW_VERSION_CONFLICT: 409 };
    const code = Object.hasOwn(statuses, error?.code || "") ? error.code : "WORKFLOW_ASSIGNMENT_INVALID";
    res.status(statuses[code]).json({ ok: false, error: code, message: "当前作业的已确认版本不可用，请核对教师权限和来源记录。" });
    return false;
  }
}

export function rejectPublishedAssignmentSourceMutation(res, assignment) {
  if (assignment?.metadata?.workflowPublication == null) return false;
  res.status(409).json({ ok: false, error: "WORKFLOW_ASSIGNMENT_IMMUTABLE", message: "此作业绑定已确认版本，请在生成工作流中修订并重新确认。" });
  return true;
}
