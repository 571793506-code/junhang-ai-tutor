import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createTeachingWorkflowClient } from "./teaching-workflow-client.mjs";

async function readJson(file, code) {
  try { return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")); }
  catch { throw Object.assign(new Error(code), { code }); }
}

async function main() {
  const { values, positionals } = parseArgs({ options: { input: { type: "string" }, id: { type: "string" }, revision: { type: "string" }, help: { type: "boolean" } }, allowPositionals: true });
  if (values.help) {
    console.log("create --input <json> | get --id <id> [--revision <n>] | command --id <id> --input <json> | recover --id <id> --input <json> | archive --id <id> --input <json> | assignment --id <id> --input <json>\nTEACHING_API_BASE_URL and TEACHING_SESSION_FILE are required. The session file contains sessionToken from teacher login. Recovery input contains expectedRevision and operationKey; it creates an independent draft from the original server-stored request. Archive and assignment input contain expectedRevision and require server-stored teacher confirmation. Assignment does not export PDFs.");
    return;
  }
  const [action] = positionals;
  if (positionals.length !== 1 || !["create", "get", "command", "recover", "archive", "assignment"].includes(action) || (action !== "get" && !values.input) || (action !== "create" && !values.id) || (action !== "get" && values.revision)) throw Object.assign(new Error("WORKFLOW_CLI_ARGUMENTS_INVALID"), { code: "WORKFLOW_CLI_ARGUMENTS_INVALID" });
  if (!process.env.TEACHING_SESSION_FILE) throw Object.assign(new Error("SESSION_REQUIRED"), { code: "SESSION_REQUIRED" });
  const session = await readJson(process.env.TEACHING_SESSION_FILE, "SESSION_FILE_INVALID");
  const client = createTeachingWorkflowClient({ baseUrl: process.env.TEACHING_API_BASE_URL, session });
  const body = values.input ? await readJson(values.input, "WORKFLOW_INPUT_FILE_INVALID") : undefined;
  const result = action === "create" ? await client.create(body)
    : action === "recover" ? await client.recover(values.id, body)
    : action === "assignment" ? await client.assignment(values.id, body)
    : action === "archive" ? await client.archive(values.id, body)
    : action === "command" ? await client.execute(values.id, body)
      : values.revision ? await client.getRevision(values.id, Number(values.revision)) : await client.get(values.id);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const code = /^(?:WORKFLOW_[A-Z_]+|SESSION_REQUIRED|SESSION_FILE_INVALID|SESSION_FORBIDDEN)$/.test(error?.code || "") ? error.code : "WORKFLOW_CLI_FAILED";
  console.error(JSON.stringify({ ok: false, error: code }));
  process.exitCode = 1;
});
