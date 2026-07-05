import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  extractImageBytes,
  reportTypesFromArgs,
  sanitizeForLog
} from "./generate-term-report-template-images.mjs";

test("buildPrompt creates parent-visible midterm and final template prompts", () => {
  const midtermPrompt = buildPrompt("midterm");
  const finalPrompt = buildPrompt("final");

  assert.ok(midtermPrompt.includes("期中阶段综合档案"));
  assert.ok(midtermPrompt.includes("阶段掌握"));
  assert.ok(midtermPrompt.includes("后续两到四周"));
  assert.ok(finalPrompt.includes("学期综合成长总结"));
  assert.ok(finalPrompt.includes("假期或下阶段"));

  for (const prompt of [midtermPrompt, finalPrompt]) {
    for (const heading of ["三科总览", "重点科目展开", "稳定表现", "下阶段辅导重点", "家长下一步"]) {
      assert.ok(prompt.includes(heading), `missing heading: ${heading}`);
    }
    for (const forbidden of ["排名", "预测分", "冲刺", "升学风险", "班级位置", "IMAGE2_", "API_KEY"]) {
      assert.equal(prompt.includes(forbidden), false, `prompt contains forbidden text: ${forbidden}`);
    }
  }
});

test("reportTypesFromArgs supports comma and repeated report values", () => {
  assert.deepEqual(reportTypesFromArgs(["midterm,final"]), ["midterm", "final"]);
  assert.deepEqual(reportTypesFromArgs(["final", "midterm"]), ["final", "midterm"]);
  assert.deepEqual(reportTypesFromArgs([]), ["midterm", "final"]);
});

test("extractImageBytes decodes image base64 response", async () => {
  const bytes = await extractImageBytes({
    data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }]
  });

  assert.equal(bytes.toString("utf8"), "png-bytes");
});

test("sanitizeForLog redacts API-like secrets", () => {
  const message = sanitizeForLog("failed with sk-1234567890abcdef and sk-short");

  assert.equal(message.includes("sk-1234567890abcdef"), false);
  assert.ok(message.includes("[redacted-key]"));
  assert.ok(message.includes("sk-short"));
});
