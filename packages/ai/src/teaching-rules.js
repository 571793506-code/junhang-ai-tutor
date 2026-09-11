import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEACHING_RULE_PATHS = Object.freeze({
  generation: "skills/generation/references/runtime-rules.md",
  grading: "skills/grading/references/runtime-rules.md"
});

const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Read on each operation: edits must take effect without a process restart.
// root is trusted server/test configuration, never a request field.
export async function loadTeachingRulePack(module, { root = defaultRoot } = {}) {
  try {
    if (typeof module !== "string" || !Object.hasOwn(TEACHING_RULE_PATHS, module)) {
      throw new Error("Unknown teaching module");
    }
    const workspace = await realpath(root);
    const file = await realpath(path.resolve(workspace, TEACHING_RULE_PATHS[module]));
    const relative = path.relative(workspace, file);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Teaching rules must remain inside the configured root");
    }
    const bytes = await readFile(file);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const match = text.match(/^# ((generation|grading)-v[1-9]\d*)\r?\n([\s\S]*)$/);
    if (!match || match[2] !== module || !match[3].trim()) {
      throw new Error("Teaching rules require a matching version heading and nonempty body");
    }
    return { module, version: match[1], hash: createHash("sha256").update(bytes).digest("hex"), text };
  } catch (cause) {
    throw Object.assign(new Error("Teaching rules are unavailable or invalid", { cause }), {
      code: "TEACHING_RULES_INVALID"
    });
  }
}
