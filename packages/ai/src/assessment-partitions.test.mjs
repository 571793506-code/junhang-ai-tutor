import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssessmentPartitions,
  mapWithConcurrency
} from "./assessment-partitions.js";

test("quiz and practice plans use two concurrent project-aware partitions", () => {
  const mathQuiz = buildAssessmentPartitions({ subject: "数学", kind: "小测" });
  const englishPractice = buildAssessmentPartitions({ subject: "英语", kind: "练习" });

  assert.equal(mathQuiz.length, 2);
  assert.deepEqual(mathQuiz.map((item) => item.id), ["foundation-calculation", "application"]);
  assert.equal(mathQuiz.flatMap((item) => item.itemTypes).includes("writing"), false);
  assert.equal(englishPractice.length, 2);
  assert.deepEqual(englishPractice.map((item) => item.id), ["language", "reading"]);
  assert.equal(englishPractice.flatMap((item) => item.itemTypes).includes("writing"), false);
});

test("formal exams use four subject-specific partitions", () => {
  const chinese = buildAssessmentPartitions({ subject: "语文", kind: "试卷" });
  const english = buildAssessmentPartitions({ subject: "英语", kind: "试卷" });

  assert.equal(chinese.length, 4);
  assert.deepEqual(chinese.map((item) => item.id), ["foundation", "application", "reading", "writing"]);
  assert.equal(english.length, 4);
  assert.deepEqual(english.map((item) => item.id), ["language", "vocabulary", "reading", "writing"]);
});

test("mapWithConcurrency limits active work and preserves result order", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await mapWithConcurrency([40, 10, 30, 5], 2, async (delay, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `item-${index}`;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(result, ["item-0", "item-1", "item-2", "item-3"]);
});
