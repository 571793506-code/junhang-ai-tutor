import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("scripts/run-api-autostart.cmd", "utf8");

test("api autostart logs outside the git workspace by default", () => {
  assert.match(source, /%LOCALAPPDATA%\\JunhangAITutor\\logs/);
  assert.match(source, /JUNHANG_API_AUTOSTART_LOG_DIR/);
  assert.doesNotMatch(source, /storage\\logs/);
});
