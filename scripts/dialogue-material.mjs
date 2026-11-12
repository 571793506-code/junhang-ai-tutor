import { readFile, writeFile, copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { contentHash, prepareDialogueMaterial, registerDialogueMaterial } from "./dialogue-material-source.mjs";

const readJson = async file => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" },
    student: { type: "string" }, scope: { type: "string" }, "deliver-to": { type: "string" }, sync: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) return console.log("node scripts/dialogue-material.mjs --input <source.json> [--output <canonical.json>] [--deliver-to <folder>] [--sync] --scope <student|grade> [--student <id-or-name>]\n--scope student requires one unique --student; --scope grade registers the material for the recognized grade and does not invent a student. Registration is pending teacher review until dialogue-material-review.mjs records an explicit accept/reject decision. Sync uses TEACHING_API_BASE_URL, TEACHING_SESSION_FILE and optional TEACHING_WEB_BASE_URL. Session file is private and contains sessionToken. No scoring or archive is performed.");
  if (!values.input) throw new Error("DIALOGUE_INPUT_REQUIRED");
  const input = path.resolve(values.input);
  const source = await readJson(input);
  const folder = path.dirname(input);
  const output = path.resolve(values.output || path.join(folder, "批改答案包.json"));
  if (output === input) throw new Error("DIALOGUE_ORIGINAL_MUST_BE_PRESERVED");
  const entries = await readdir(folder);
  const files = [];
  for (const [role, ending] of [["student-paper", "_学生卷.pdf"], ["answer-analysis", "_答案解析.pdf"]]) {
    const matches = entries.filter(name => name.endsWith(ending));
    if (matches.length !== 1) throw new Error("DIALOGUE_PDF_PAIR_REQUIRED");
    const file = path.join(folder, matches[0]);
    files.push({ role, name: matches[0], sha256: contentHash(await readFile(file)), path: file });
  }
  let answerPackage = prepareDialogueMaterial(source);
  let receipt = { ok: true, syncStatus: "not_synced", teacherReviewRequired: true };
  // Save a usable package even when registration fails. Failure never claims sync.
  await writeFile(output, JSON.stringify(answerPackage, null, 2) + "\n", "utf8");
  try {
    if (values.sync) {
      const session = await readJson(process.env.TEACHING_SESSION_FILE);
      const identity = values.student || (values.scope !== "grade" && source.targetStudents?.length === 1 ? source.targetStudents[0] : "");
      const result = await registerDialogueMaterial({ baseUrl: process.env.TEACHING_API_BASE_URL,
        sessionToken: session.sessionToken, source, studentIdentity: identity, scope: values.scope || "student" });
      answerPackage = result.answerPackage;
      const web = new URL(process.env.TEACHING_WEB_BASE_URL || "http://127.0.0.1:5173/");
      web.searchParams.set("gradingAssignment", result.assignment.id);
      receipt = { ...receipt, syncStatus: "registered", assignmentId: result.assignment.id,
        gradingSource: result.assignment.gradingSource, replayed: result.replayed, student: result.student, scope: result.scope, grade: result.grade,
        gradingEligible: result.assignment.gradingEligible === true, reviewStatus: result.assignment.draftReviewStatus, webUrl: web.href };
    }
  } catch (error) {
    receipt = { ...receipt, ok: false, error: /^DIALOGUE_|^SESSION_/.test(error.code || error.message) ? (error.code || error.message) : "DIALOGUE_SYNC_FAILED" };
    process.exitCode = 1;
  }
  await writeFile(output, JSON.stringify(answerPackage, null, 2) + "\n", "utf8");
  files.push({ role: "grading-source", name: path.basename(output), sha256: contentHash(await readFile(output)), path: output });
  receipt = { ...receipt, title: answerPackage.title, questionCount: answerPackage.questions.length,
    totalScore: answerPackage.totalScore, baseScore: answerPackage.baseScore, bonusScore: answerPackage.bonusScore,
    originalSourceSha256: contentHash(await readFile(input)), files, checkedAt: new Date().toISOString() };
  const receiptFile = path.join(path.dirname(output), "材料登记回执.json");
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  if (values["deliver-to"]) {
    const destination = path.resolve(values["deliver-to"]);
    await mkdir(destination, { recursive: true });
    for (const file of [...files, { path: receiptFile, name: path.basename(receiptFile) }]) {
      const target = path.join(destination, file.name);
      if (target !== file.path) await copyFile(file.path, target);
      if (contentHash(await readFile(target)) !== contentHash(await readFile(file.path))) throw new Error("DIALOGUE_DELIVERY_HASH_MISMATCH");
    }
  }
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch(() => { console.error(JSON.stringify({ ok: false, error: "DIALOGUE_MATERIAL_FAILED" })); process.exitCode = 1; });
