import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./seed-demo.js", import.meta.url), "utf8");

test("demo seed update paths reassign fixed student records to the primary fixture", () => {
  const expectedUpdates = [
    /learningTask\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*task\.studentId/,
    /vocabularyRecord\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*demoStudents\[0\]\.id/,
    /submission\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*assignment\.studentId/,
    /mistakeRecord\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*demoStudents\[0\]\.id/,
    /studentReport\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*demoStudents\[0\]\.id/,
    /behaviorEvent\.upsert[\s\S]*?update:\s*\{[\s\S]*?studentId:\s*demoStudents\[0\]\.id/
  ];

  for (const pattern of expectedUpdates) assert.match(source, pattern);
});
