import test from "node:test";
import assert from "node:assert/strict";
import { buildAssessmentPromptProfile, buildGradingPromptProfile } from "./runtime.js";

test("uses middle-school math generation rules for grade seven", () => {
  const profile = buildAssessmentPromptProfile({ subject: "数学", grade: "初一", kind: "小测" });
  assert.equal(profile.stage, "middle");
  assert.match(profile.role, /初中七年级数学/);
  assert.match(profile.subjectRule, /有理数|整式|一元一次方程/);
  assert.doesNotMatch(profile.subjectRule, /分数小数百分数/);
});

test("lists the teacher-confirmed twelve grade seven math chapters in the generation rule", () => {
  const profile = buildAssessmentPromptProfile({ subject: "数学", grade: "七年级", kind: "试卷" });
  for (const chapter of [
    "有理数", "有理数的运算", "代数式", "整式的加减", "一元一次方程", "几何图形初步",
    "相交线与平行线", "实数", "平面直角坐标系", "二元一次方程组", "不等式与不等式组", "数据的收集、整理与描述"
  ]) {
    assert.match(profile.subjectRule, new RegExp(chapter));
  }
});

test("keeps primary math grading profile separate from grade seven", () => {
  const primary = buildGradingPromptProfile({ subject: "数学", grade: "六年级" });
  const middle = buildGradingPromptProfile({ subject: "数学", grade: "七年级" });
  assert.match(primary.role, /小学/);
  assert.match(middle.role, /初中七年级数学/);
  assert.match(middle.guardrails, /根式|分式|几何证明/);
});
