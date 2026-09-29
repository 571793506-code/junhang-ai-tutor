export function isImmutableTeachingArchive(submission) {
  return Boolean(String(submission?.id || "").startsWith("teaching-archive-") || submission?.content?.workflowArchive != null);
}

export function rejectArchivedSubmissionMutation(res, submission) {
  if (!isImmutableTeachingArchive(submission)) return false;
  res.status(409).json({ ok: false, error: "WORKFLOW_ARCHIVE_IMMUTABLE", message: "已归档版本不能直接修改，请在原工作流中修订并重新确认后生成新归档。" });
  return true;
}
