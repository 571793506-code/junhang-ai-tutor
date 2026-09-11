const PURPOSES = new Set(["comprehensive", "focused", "multi_day", "explanation"]);
const ITEM_TYPES = new Set(["fill", "choice", "judgment", "calculation", "solution", "operation", "reading", "writing", "listening"]);

export function normalizeTeachingPurpose(input = {}) {
  const invalid = () => { throw Object.assign(new Error("GENERATION_PURPOSE_INVALID"), { code: "GENERATION_PURPOSE_INVALID", status: 422 }); };
  const purpose = input.purpose ?? "comprehensive";
  if (!PURPOSES.has(purpose)) invalid();
  const types = (value) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some((type) => !ITEM_TYPES.has(type))) invalid();
    return [...new Set(value)];
  };
  const requestedItemTypes = types(input.requestedItemTypes);
  if (purpose === "focused" && !requestedItemTypes.length) invalid();
  if (purpose === "focused" && input.requestedItemCount != null) {
    const count = Number(input.requestedItemCount);
    if (!Number.isInteger(count) || count < requestedItemTypes.length || count > 100) invalid();
  }
  const dayPlan = [];
  if (purpose === "multi_day") {
    if (!Array.isArray(input.dayPlan) || !input.dayPlan.length || input.dayPlan.length > 30) invalid();
    for (const [index, day] of input.dayPlan.entries()) {
      if (!day || typeof day !== "object") invalid();
      const dayId = day.dayId ?? `day-${index + 1}`;
      const goal = typeof day.goal === "string" ? day.goal.trim().slice(0, 600) : "";
      const count = Number(day.requestedItemCount);
      const itemTypes = types(day.requestedItemTypes ?? requestedItemTypes);
      if (typeof dayId !== "string" || !/^[a-zA-Z0-9_-]{1,60}$/.test(dayId) || dayPlan.some((item) => item.dayId === dayId) || !goal || !Number.isInteger(count) || count < itemTypes.length || count < 1 || count > 100 || !itemTypes.length) invalid();
      dayPlan.push({ dayId, goal, requestedItemTypes: itemTypes, requestedItemCount: count });
    }
  }
  return { purpose, requestedItemTypes, dayPlan };
}
