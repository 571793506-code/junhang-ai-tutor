import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const styleSource = fs.readFileSync(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../apps/web/index.html", import.meta.url), "utf8");

test("grading review workbench protects tablet width from horizontal overflow", () => {
  assert.match(styleSource, /\.grading-workbench\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%/);
  assert.match(styleSource, /\.grading-command-center\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%/);
  assert.match(styleSource, /\.grading-inspector\s*\{[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.grading-command-center\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.grading-command-metrics,[\s\S]*?\.grading-score-strip,[\s\S]*?\.question-review-status\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.grading-action-dock\s*\{[\s\S]*?grid-template-columns: 1fr/);
});

test("classroom tablet stage keeps the learning halo in the iPad first viewport", () => {
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.tablet-stage-v1\s*\{[\s\S]*?grid-template-columns: minmax\(180px, 0\.65fr\) minmax\(300px, 1fr\)/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.tablet-avatar-rail,[\s\S]*?\.tablet-avatar-rail\.right\s*\{[\s\S]*?grid-column: 1/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.learning-halo-drop\s*\{[\s\S]*?grid-column: 2[\s\S]*?grid-row: 2 \/ span 4/);
  assert.match(styleSource, /@media \(max-width: 640px\)[\s\S]*?\.learning-halo-drop,[\s\S]*?\.tablet-ai-flow\s*\{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: auto/);
});

test("web shell declares a served favicon instead of falling back to favicon.ico", () => {
  assert.match(htmlSource, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
});
