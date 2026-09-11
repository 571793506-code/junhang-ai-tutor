import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTeachingPurpose } from "./teaching-purpose.js";

test("purpose defaults to comprehensive and preserves only validated day fields", () => {
  assert.equal(normalizeTeachingPurpose({}).purpose, "comprehensive");
  const result = normalizeTeachingPurpose({ purpose: "multi_day", requestedItemTypes: ["calculation"], dayPlan: [{ goal: "加法", requestedItemCount: 2, model: "forged" }] });
  assert.deepEqual(result.dayPlan, [{ dayId: "day-1", goal: "加法", requestedItemTypes: ["calculation"], requestedItemCount: 2 }]);
});
test("invalid purpose, type, count, and duplicate days consistently return 422", () => {
  const invalid = [
    { purpose: "unknown" }, { purpose: "focused" },
    { purpose: "focused", requestedItemTypes: ["script"] },
    { purpose: "focused", requestedItemTypes: ["fill", "calculation"], requestedItemCount: 1 },
    { purpose: "focused", requestedItemTypes: ["fill"], requestedItemCount: 0 },
    { purpose: "multi_day", requestedItemTypes: ["fill"], dayPlan: [] },
    { purpose: "multi_day", requestedItemTypes: ["fill"], dayPlan: [1, 2].map(() => ({ dayId: "same", goal: "复习", requestedItemCount: 2 })) }
  ];
  for (const input of invalid) assert.throws(() => normalizeTeachingPurpose(input), (error) => error.status === 422 && error.code === "GENERATION_PURPOSE_INVALID");
});
