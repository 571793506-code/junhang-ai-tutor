import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

test("generation workbench keeps selectable options for preview-matched fields", () => {
  assert.match(source, /const quizChapterOptions = \[/);
  assert.match(source, /const practiceTrainingTargetOptions = \[/);
  assert.match(source, /const questionCountOptionsByMode: Record<GenerationMode, string\[]> = /);
  assert.match(source, /const examTypeOptions = \[/);
  assert.match(source, /const examTotalScoreOptions = \[/);
  assert.doesNotMatch(source, /训练目标" : "章节 \/ 单元"}<input/);
  assert.doesNotMatch(source, /"总分" : "题量目标"}<input/);
});
