import test from "node:test";
import assert from "node:assert/strict";
import { buildGradingSourcePackage, normalizeImportedGradingSourcePackage } from "@junhang/core/grading-source-package";
import { canReplayDialogueSource } from "./dialogue-source-registration.js";
test("replay accepts unordered historical sources while refusing ownership, target and content changes", () => {
  const requested = buildGradingSourcePackage({ id: "paper", title: "合成复测", items: [1, 2].map(n => ({
    orderIndex: n, prompt: `${n}+1`, answer: n + 1, score: 2 })) }).package;
  const stored = normalizeImportedGradingSourcePackage({ ...requested, questions: requested.questions.toReversed() }).package;
  const input = { metadata: { source: "dialogue-import", teacherId: "t", targetStudentId: "s" }, teacherId: "t", studentId: "s", stored, requested };
  assert.notEqual(stored.fingerprint, requested.fingerprint);
  assert.equal(canReplayDialogueSource(input), true);
  assert.equal(canReplayDialogueSource({ ...input, teacherId: "another" }), false);
  assert.equal(canReplayDialogueSource({ ...input, studentId: "another" }), false);
  const otherSource = normalizeImportedGradingSourcePackage(stored, { sourceId: "another" }).package;
  assert.equal(canReplayDialogueSource({ ...input, stored: otherSource }), false);
  const changed = structuredClone(requested); changed.questions[0].correctAnswer = "changed";
  assert.equal(canReplayDialogueSource({ ...input, requested: normalizeImportedGradingSourcePackage(changed).package }), false);
  const tampered = structuredClone(stored); tampered.questions[0].prompt = "tampered";
  assert.equal(canReplayDialogueSource({ ...input, stored: tampered }), false);
  const missing = normalizeImportedGradingSourcePackage({ ...stored, questions: stored.questions.slice(1) }).package;
  assert.equal(canReplayDialogueSource({ ...input, stored: missing }), false);
});
