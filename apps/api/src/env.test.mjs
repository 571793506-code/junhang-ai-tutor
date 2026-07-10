import assert from "node:assert/strict";
import test from "node:test";
import { publicConfigSummary } from "./env.js";

test("publicConfigSummary reports GPT-5.6 readiness with legacy key aliases", () => {
  const direct = publicConfigSummary({ GPT56_API_KEY: "new-key" });
  const migrated = publicConfigSummary({ GPT55_API_KEY: "legacy-key" });

  assert.equal(direct.providers.gpt56, true);
  assert.equal(migrated.providers.gpt56, true);
  assert.equal("gpt55" in direct.providers, false);
});
