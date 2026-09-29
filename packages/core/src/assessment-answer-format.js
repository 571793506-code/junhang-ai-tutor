// Convert explicit equivalent English grid descriptors to the renderer contract.
// Geometry and prefilled text are not model-controlled; the renderer supplies a
// blank grid. Leave unrelated formats intact rather than guessing their meaning.
export function normalizeAssessmentAnswerFormat(value) {
  const type = typeof value === "string" ? value : value && !Array.isArray(value) ? value.type : null;
  return ["english-four-line", "english-writing", "english_four_line_grid"].includes(type) ? "english-four-line" : value;
}
