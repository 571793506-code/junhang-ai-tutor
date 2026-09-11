import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTeachingRulePack } from "./teaching-rules.js";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "teaching-rules-"));
  const file = path.join(root, "skills/generation/references/runtime-rules.md");
  await mkdir(path.dirname(file), { recursive: true });
  try { await run(root, file); } finally { await rm(root, { recursive: true, force: true }); }
}

test("rules reload actual UTF-8 content and content hash without a stale cache", async () => {
  await fixture(async (root, file) => {
    await writeFile(file, "# generation-v1\n综合测评。\n", "utf8");
    const first = await loadTeachingRulePack("generation", { root });
    const text = "# generation-v1\n专项练习只生成指定题型。\n";
    await writeFile(file, text, "utf8");
    const next = await loadTeachingRulePack("generation", { root });
    assert.equal(next.module, "generation");
    assert.equal(next.version, "generation-v1");
    assert.equal(next.text, text);
    assert.equal(next.hash, createHash("sha256").update(text).digest("hex"));
    assert.notEqual(next.hash, first.hash);
    await rm(file);
    await assert.rejects(loadTeachingRulePack("generation", { root }), { code: "TEACHING_RULES_INVALID" });
  });
});

test("unknown modules and path traversal cannot select a rule file", async () => {
  for (const module of ["../grading", "generation/../../secret", "qa", "__proto__", "toString", null]) {
    await assert.rejects(loadTeachingRulePack(module), { code: "TEACHING_RULES_INVALID" });
  }
});

test("missing, empty, malformed version and invalid UTF-8 rules fail closed", async () => {
  await fixture(async (root, file) => {
    await assert.rejects(loadTeachingRulePack("generation", { root }), { code: "TEACHING_RULES_INVALID" });
    for (const content of ["", " \n", "# generation-v1\n", "# grading-v1\nwrong module", Buffer.from([0xff])]) {
      await writeFile(file, content);
      await assert.rejects(loadTeachingRulePack("generation", { root }), { code: "TEACHING_RULES_INVALID" });
    }
  });
});

test("repository ships usable rule packs for both teaching modules", async () => {
  for (const module of ["generation", "grading"]) {
    const pack = await loadTeachingRulePack(module);
    assert.match(pack.text, /教师/);
    assert.match(pack.hash, /^[a-f0-9]{64}$/);
  }
});
