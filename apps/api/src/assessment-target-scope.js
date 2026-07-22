function readableText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : fallback;
}

export function normalizeAssessmentTargetScope(input = {}) {
  if (input.targetScope !== "grade") return input;

  const grade = readableText(input.targetGrade || input.grade);
  const subject = readableText(input.subject, "综合");
  const kind = readableText(input.kind, "小测");
  const contentScope = readableText(input.contentScope || input.textbookChapterTitle);

  return {
    ...input,
    targetScope: "grade",
    grade: grade || undefined,
    targetGrade: grade || undefined,
    studentId: undefined,
    studentName: undefined,
    title: `${grade}${subject}${contentScope}${kind}`
  };
}
