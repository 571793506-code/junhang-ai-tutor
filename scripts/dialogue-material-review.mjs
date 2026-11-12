import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { reviewDialogueMaterial } from "./dialogue-material-source.mjs";

const readJson = async file => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
async function main() {
  const { values } = parseArgs({ options: { receipt: { type: "string" }, decision: { type: "string" }, note: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) return console.log("node scripts/dialogue-material-review.mjs --receipt <材料登记回执.json> --decision <accept|reject> --note <教师明确回复原文>\nUse after the teacher has reviewed the exact material and explicitly replied. This records material eligibility only; it does not confirm scores, grade students, publish to students, or archive submissions. Uses TEACHING_API_BASE_URL and TEACHING_SESSION_FILE.");
  const receiptFile = path.resolve(values.receipt || "材料登记回执.json");
  const receipt = await readJson(receiptFile);
  const session = await readJson(process.env.TEACHING_SESSION_FILE);
  const result = await reviewDialogueMaterial({ baseUrl: process.env.TEACHING_API_BASE_URL, sessionToken: session.sessionToken,
    receipt, decision: values.decision, note: values.note });
  await writeFile(path.join(path.dirname(receiptFile), "材料审查回执.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: /^DIALOGUE_|^SESSION_/.test(error.code || "") ? error.code : "DIALOGUE_REVIEW_FAILED" })); process.exitCode = 1; });
