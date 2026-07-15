export const TEACHER_REQUIREMENT_EMERGENCY = "teacher_requirement_emergency";

const TEXTBOOK_INPUT_FIELDS = [
  "textbookAssetId",
  "textbookTitle",
  "textbookEdition",
  "textbookEditionDisplay",
  "textbookSeries",
  "textbookVolume",
  "textbookRegion",
  "textbookChapterId",
  "textbookChapterTitle"
];

function hasText(value) {
  return typeof value === "string" ? Boolean(value.trim()) : value != null;
}

export function prepareTeacherRequirementEmergency(input = {}) {
  if (input.generationBasis !== TEACHER_REQUIREMENT_EMERGENCY) return null;

  const textbookField = TEXTBOOK_INPUT_FIELDS.find((field) => hasText(input[field]));
  if (textbookField) {
    return {
      ok: false,
      failure: {
        error: "EMERGENCY_DRAFT_TEXTBOOK_FIELDS_NOT_ALLOWED",
        message: "教师要求临时小测不能伪造或附带教材依据，请通过教材修复流程恢复教材小测。"
      }
    };
  }
  if (input.kind !== "小测") {
    return {
      ok: false,
      failure: {
        error: "EMERGENCY_DRAFT_QUIZ_ONLY",
        message: "教师要求临时生成仅适用于小测草稿。"
      }
    };
  }
  if (!hasText(input.subject) || !hasText(input.grade || input.targetGrade) || !hasText(input.requirement || input.specialRequirements)) {
    return {
      ok: false,
      failure: {
        error: "EMERGENCY_DRAFT_SCOPE_REQUIRED",
        message: "请填写年级、科目和明确的教师要求后，再创建临时小测草稿。"
      }
    };
  }

  return {
    ok: true,
    input: {
      ...input,
      generationBasis: TEACHER_REQUIREMENT_EMERGENCY,
      recoveryReason: String(input.recoveryReason || "TEACHER_CONFIRMED_SCOPE"),
      contentContext: {
        available: false,
        approvedOnly: false,
        approvedSourceCount: 0,
        matchedCount: 0,
        reason: "TEACHER_REQUIREMENT_EMERGENCY",
        matches: []
      }
    }
  };
}
