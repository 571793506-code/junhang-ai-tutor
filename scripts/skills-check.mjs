import { validateSkillsWorkspace } from "./skills-check-lib.mjs";

const result = validateSkillsWorkspace(process.cwd());
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
