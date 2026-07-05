import {
  buildWorkspaceGuardianReport,
  formatWorkspaceGuardianReport
} from "./workspace-guardian-lib.mjs";

const json = process.argv.includes("--json");
const report = await buildWorkspaceGuardianReport();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  process.stdout.write(formatWorkspaceGuardianReport(report));
}

if (!report.clean) {
  process.exitCode = 1;
}
