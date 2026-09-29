const WORKFLOW_TYPES = new Set(["generation", "grading"]);
const PATCH_TYPES = new Set(["replace_question", "replace_shared_material", "replace_day", "replace_explanation"]);

const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
const replacement = (value, field, expected) => value && typeof value === "object" && !Array.isArray(value)
  && value[field] != null && String(value[field]) === String(expected);

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 422 });
}

// Teaching content only. Confirmation belongs to the authenticated workflow service.
export function teachingExplanationContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source && Object.hasOwn(source, key)).map((key) => [key, clone(source[key])]));
  const content = pick(value, ["concept", "steps", "workedExamples", "commonMistakes"]);
  if (Array.isArray(content.workedExamples)) content.workedExamples = content.workedExamples.map((example) => pick(example, ["prompt", "answer", "analysisSteps"]));
  return content;
}

export function applyWorkflowPatch(snapshot = {}, patch = {}) {
  if (!PATCH_TYPES.has(patch.type)) fail("WORKFLOW_PATCH_INVALID");
  const next = clone(snapshot);
  const affectedQuestionIds = new Set();
  if (patch.type === "replace_explanation") {
    if (snapshot.purpose !== "explanation" || !teachingExplanationContent(snapshot.explanation) || !teachingExplanationContent(patch.value)) fail("WORKFLOW_EXPLANATION_PATCH_INVALID");
    next.explanation = teachingExplanationContent(patch.value);
    return { snapshot: next, affectedQuestionIds: [], affectedExplanation: true };
  }
  if (patch.type === "replace_question") {
    if (!patch.questionId || !replacement(patch.value, "id", patch.questionId)) fail("WORKFLOW_QUESTION_PATCH_INVALID");
    const questions = Array.isArray(next.questions) ? next.questions : [];
    const index = questions.findIndex((question) => String(question.id) === String(patch.questionId));
    if (index < 0) fail("WORKFLOW_QUESTION_NOT_FOUND");
    next.questions[index] = clone(patch.value);
    affectedQuestionIds.add(String(patch.questionId));
  } else if (patch.type === "replace_shared_material") {
    if (!patch.materialId || !replacement(patch.value, "id", patch.materialId)) fail("WORKFLOW_MATERIAL_PATCH_INVALID");
    const materials = Array.isArray(next.sharedMaterials) ? next.sharedMaterials : [];
    const index = materials.findIndex((material) => String(material.id) === String(patch.materialId));
    if (index < 0) fail("WORKFLOW_MATERIAL_NOT_FOUND");
    materials[index] = clone(patch.value);
    next.sharedMaterials = materials;
    for (const question of next.questions || []) {
      if (String(question.sharedMaterialId) === String(patch.materialId)) affectedQuestionIds.add(String(question.id));
    }
  } else {
    if (!patch.dayId || !replacement(patch.value, "dayId", patch.dayId)) fail("WORKFLOW_DAY_PATCH_INVALID");
    const days = Array.isArray(next.days) ? next.days : [];
    const index = days.findIndex((day) => String(day.dayId) === String(patch.dayId));
    if (index < 0) fail("WORKFLOW_DAY_NOT_FOUND");
    days[index] = clone(patch.value);
    next.days = days;
    for (const question of next.questions || []) {
      if (String(question.dayId) === String(patch.dayId)) affectedQuestionIds.add(String(question.id));
    }
  }
  return { snapshot: next, affectedQuestionIds: [...affectedQuestionIds] };
}

export function normalizeTeachingWorkflow(input = {}) {
  if (!input.workflowId || !input.ownerTeacherId || !WORKFLOW_TYPES.has(input.type)) fail("WORKFLOW_INPUT_INVALID");
  const revision = Number(input.revision ?? 1);
  if (!Number.isInteger(revision) || revision < 1) fail("WORKFLOW_REVISION_INVALID");
  return {
    workflowId: String(input.workflowId), ownerTeacherId: String(input.ownerTeacherId), type: input.type,
    revision, operationKey: String(input.operationKey || ""), snapshot: clone(input.snapshot)
  };
}
