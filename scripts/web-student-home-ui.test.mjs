import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");

test("student home uses summary cards instead of compressed realtime columns", () => {
  assert.match(mainSource, /function StudentRealtimeSummary\(\{ corrections, logs, onModuleOpen, tasks \}/);
  assert.match(mainSource, /className="student-summary-stack"/);
  assert.match(mainSource, /className="student-summary-section"/);
  assert.match(mainSource, /className="student-summary-card"/);
  assert.match(mainSource, /studentSummaryPreview/);
  assert.match(mainSource, /onModuleOpen\("今日任务"\)/);
  assert.match(mainSource, /onModuleOpen\("学生档案"\)/);
});

test("student home summary layout protects iPad and mobile widths", () => {
  assert.match(styleSource, /\.student-summary-stack/);
  assert.match(styleSource, /\.student-summary-card/);
  assert.match(styleSource, /\.student-summary-card-detail/);
  assert.match(styleSource, /-webkit-line-clamp: 2/);
  assert.match(styleSource, /@media \(max-width: 920px\)[\s\S]*\.student-summary-card[\s\S]*grid-template-columns: 1fr/);
});
