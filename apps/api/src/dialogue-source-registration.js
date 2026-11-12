import { normalizeImportedGradingSourcePackage, validateGradingSourcePackage } from "@junhang/core/grading-source-package";

// Compare by explicit question number, without rewriting historical packages.
export function canReplayDialogueSource({ metadata = {}, stored, requested, teacherId, studentId, targetGrade }) {
  if (metadata.source !== "dialogue-import" || metadata.teacherId !== teacherId ||
      (metadata.targetStudentId || null) !== (studentId || null) || !stored ||
      stored.sourceId !== requested.sourceId || !validateGradingSourcePackage(stored).ok ||
      stored.questions.length !== requested.questions.length ||
      (targetGrade || metadata.targetGrade || null) !== (metadata.targetGrade || null)) return false;
  const byNo = new Map(stored.questions.map(question => [question.questionNo, question]));
  const aligned = normalizeImportedGradingSourcePackage({ ...stored,
    questions: requested.questions.map(question => byNo.get(question.questionNo)) }, { sourceId: requested.sourceId });
  return aligned.ok && aligned.package.fingerprint === requested.fingerprint;
}
