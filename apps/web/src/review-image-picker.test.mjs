import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const pickerSource = source.match(/function ReviewImagePicker[\s\S]*?\n}\n\nfunction assessmentDraftRefFromAssignment/)?.[0] || "";

test("review image picker keeps library multi-select separate from camera capture", () => {
  assert.match(pickerSource, /function ReviewImagePicker/);
  assert.match(pickerSource, /multiple type="file" accept="image\/\*"/);
  assert.match(pickerSource, /type="file" accept="image\/\*" capture="environment"/);
  assert.doesNotMatch(pickerSource, /multiple type="file" accept="image\/\*" capture="environment"/);
});

test("review image picker appends repeated camera selections to the current batch", () => {
  assert.match(pickerSource, /setFiles\(\(current\) => \[\.\.\.current, \.\.\.selected\]\)/);
  assert.match(pickerSource, /event\.currentTarget\.value = ""/);
});
