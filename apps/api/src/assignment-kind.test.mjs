import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
const start = source.indexOf("function readableKind(");
const end = source.indexOf("\nfunction sanitizeLearnerPayload", start);
assert.ok(start >= 0 && end > start);
const readableKind = new Function("readableText", `${source.slice(start, end)}; return readableKind;`)(
  (value, fallback) => typeof value === "string" && value.trim() ? value.trim() : fallback
);

test("persisted assessment kind codes remain selectable as the same Web grading source", () => {
  for (const [code, label] of [["quiz", "小测"], ["practice", "练习"], ["exam", "试卷"]]) {
    assert.equal(readableKind(code, "图片批改"), label, code);
    assert.equal(readableKind(` ${code.toUpperCase()} `), label);
  }
});

test("Chinese kinds and unknown-kind fallbacks retain their existing behavior", () => {
  for (const kind of ["小测", "练习", "试卷", "听写", "作业", "图片批改"]) {
    assert.equal(readableKind(kind), kind);
  }
  assert.equal(readableKind("unknown", "图片批改"), "图片批改");
  assert.equal(readableKind(null), "练习");
});
