import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as dbStatus from "./db-status.js";

test("public database unavailable payload has an exact stable safe shape", () => {
  assert.equal(typeof dbStatus.publicDatabaseUnavailablePayload, "function");
  const payload = dbStatus.publicDatabaseUnavailablePayload({
    checkedAt: "2026-07-12T00:00:00.000Z",
    checkedAtMs: 123,
    reason: "postgres://user:secret@internal-host/db raw connection error"
  });

  assert.deepEqual(payload, {
    ok: false,
    error: "DATABASE_UNAVAILABLE",
    message: "数据库当前不可用，请稍后再试。"
  });
  assert.deepEqual(Object.keys(payload), ["ok", "error", "message"]);

  const serialized = JSON.stringify(payload);
  for (const hidden of ["database", "checkedAt", "checkedAtMs", "reason", "postgres://", "secret", "internal-host"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("requireDatabase uses only the public unavailable payload", () => {
  const source = readFileSync(new URL("./db-status.js", import.meta.url), "utf8");
  const middleware = source.slice(
    source.indexOf("export async function requireDatabase"),
    source.indexOf("export async function persistenceOptions")
  );

  assert.match(middleware, /res\.status\(503\)\.json\(publicDatabaseUnavailablePayload\(\)\)/);
  assert.doesNotMatch(middleware, /database:\s*status/);
  assert.doesNotMatch(middleware, /checkedAt|checkedAtMs|reason/);
});
