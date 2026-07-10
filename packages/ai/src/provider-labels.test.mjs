import assert from "node:assert/strict";
import test from "node:test";
import { composeDemoQaAnswer } from "./demo-responses.js";
import { startupMode } from "../../core/src/startup-mode.js";

test("demo and startup text provider labels use GPT-5.6", () => {
  assert.equal(composeDemoQaAnswer("go 的过去式是什么").providerId, "gpt56");
  assert.equal(startupMode.providerPolicy.textProvider, "GPT-5.6");
  assert.match(startupMode.description, /GPT-5\.6/);
});
