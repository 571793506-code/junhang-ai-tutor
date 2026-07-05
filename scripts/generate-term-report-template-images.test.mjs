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
  assert.ok(finalPrompt.includes("本学期变化"));
  assert.equal(finalPrompt.includes("前半阶段变化"), false);

  for (const prompt of [midtermPrompt, finalPrompt]) {
    assert.ok(prompt.includes("图片只展示模块标题、短标签和占位短句"));
    assert.ok(prompt.includes("正式报告正文由 HTML/PDF 模板渲染"));
    assert.equal(prompt.includes("每天 5 到 10 分钟，请孩子口头复述最容易出错的一步"), false);
    assert.equal(prompt.includes("家庭配合以短时间复述和查看订正过程为主"), false);
    assert.ok(prompt.split("\n").filter((line) => line.trim().startsWith("\"")).length <= 32);
    for (const heading of ["阶段关键结论", "证据摘要", "三科总览", "学科能力拆解", "重点科目展开", "共性错因分析", "跟进计划", "家长沟通摘要"]) {
      assert.ok(prompt.includes(heading), `missing heading: ${heading}`);
    }
    for (const heading of ["成长轨迹", "证据覆盖说明", "课堂与作业过程", "家校协同建议"]) {
      assert.ok(prompt.includes(heading), `missing deeper heading: ${heading}`);
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
