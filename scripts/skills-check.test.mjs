import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_SKILL_ROUTES,
  validateSkillsWorkspace,
} from "./skills-check-lib.mjs";

const EXPECTED_ROUTES = {
  "ai-qa": "skills/ai-qa/SKILLS.md",
  "student-profile": "skills/student-profile/SKILLS.md",
  "teaching-materials": "skills/teaching-materials/SKILLS.md",
  generation: "skills/generation/SKILLS.md",
  grading: "skills/grading/SKILLS.md",
  miniprogram: "skills/miniprogram/SKILLS.md",
  "miniprogram-ui": "skills/miniprogram-ui/SKILLS.md",
  "project-grill-review": "skills/project-grill-review/SKILLS.md",
  "prompt-context-engineering": "docs/41-prompt-context-engineering-playbook.md",
};

async function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function wrapper(name, route, command = "cmd /c npm.cmd run check:api") {
  return `---
name: ${name}
description: Use when changing ${name} behavior in Junhang AI Tutor.
---

# ${name}

AGENTS.md project rules take precedence.
Before editing, read the \`${route}\` Playbook.
For cross-module changes, read every affected module Playbook.
Minimum verification: \`${command}\`.
`;
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "skills-check-"));
  await write(
    root,
    "package.json",
    `${JSON.stringify(
      {
        private: true,
        scripts: { "check:api": "node --check index.js" },
        workspaces: ["apps/*"],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    "SKILLS.md",
    `${Object.values(EXPECTED_ROUTES).map((route) => `- \`${route}\``).join("\n")}\n`,
  );

  for (const [name, route] of Object.entries(EXPECTED_ROUTES)) {
    await write(root, route, `# ${name} Playbook\n`);
    await write(root, `.agents/skills/${name}/SKILL.md`, wrapper(name, route));
  }

  return root;
}

async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function failureCodes(result) {
  return result.failures.map((failure) => failure.code);
}

test("exports the fixed nine required skill routes", () => {
  assert.deepEqual(REQUIRED_SKILL_ROUTES, EXPECTED_ROUTES);
});

test("accepts a complete skills workspace", async () => {
  await withFixture(async (root) => {
    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
    assert.deepEqual(result.checkedSkills, Object.keys(EXPECTED_ROUTES));
    assert.deepEqual(result.failures, []);
  });
});

test("reports missing-skill when a required wrapper is absent", async () => {
  await withFixture(async (root) => {
    await unlink(path.join(root, ".agents", "skills", "grading", "SKILL.md"));

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, false);
    assert.ok(failureCodes(result).includes("missing-skill"));
  });
});

test("reports name-mismatch when frontmatter name differs from its directory", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(root, skillPath, content.replace("name: ai-qa", "name: other-name"));

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("name-mismatch"));
  });
});

test("reports invalid-frontmatter for unsupported keys or descriptions", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content
        .replace("description: Use when", "description: Change when")
        .replace("---\n\n# ai-qa", "owner: team\n---\n\n# ai-qa"),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("reports invalid-frontmatter for invalid YAML plain scalars", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "description: Use when changing ai-qa behavior in Junhang AI Tutor.",
        "description: Use when: changing AI QA",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("accepts quoted YAML string scalars in frontmatter", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content
        .replace("name: ai-qa", 'name: "ai-qa"')
        .replace(
          "description: Use when changing ai-qa behavior in Junhang AI Tutor.",
          'description: "Use when changing AI QA"',
        ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("reports invalid-frontmatter for duplicate YAML keys", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace("name: ai-qa", "name: ai-qa\nname: duplicate"),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("reports invalid-frontmatter for multiple YAML documents", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "---\n\n# ai-qa",
        "---\n---\nname: second-document\n---\n\n# ai-qa",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("reports invalid-frontmatter when a second document follows the first delimiter", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "---\n\n# ai-qa",
        "---\nname: second-document\ndescription: Use when duplicated\n---\n\n# ai-qa",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("accepts Markdown horizontal rules after normal Skill body content", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      `${content}\n---\n\nAdditional module notes.\n`,
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("reports invalid-frontmatter for object and array values", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/ai-qa/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "description: Use when changing ai-qa behavior in Junhang AI Tutor.",
        "description:\n  - Use when changing AI QA",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("invalid-frontmatter"));
  });
});

test("reports missing-route when the exact module Playbook is not referenced", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/generation/SKILL.md",
      wrapper("generation", "skills/grading/SKILLS.md"),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-route"));
  });
});

test("accepts an exact route reference without requiring Markdown backticks", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/generation/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "`skills/generation/SKILLS.md`",
        "skills/generation/SKILLS.md",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("rejects a route with a query-like suffix", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/generation/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "`skills/generation/SKILLS.md`",
        "`skills/generation/SKILLS.md?legacy`",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-route"));
  });
});

test("accepts an exact route followed by sentence punctuation", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/generation/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(
      root,
      skillPath,
      content.replace(
        "`skills/generation/SKILLS.md` Playbook",
        "skills/generation/SKILLS.md. Playbook",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("reports missing-route-file when a routed Playbook is absent", async () => {
  await withFixture(async (root) => {
    await unlink(path.join(root, "skills", "grading", "SKILLS.md"));

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-route-file"));
  });
});

test("reports missing-route-file when a directory impersonates the route", async () => {
  await withFixture(async (root) => {
    const routePath = path.join(root, "skills", "grading", "SKILLS.md");
    await unlink(routePath);
    await mkdir(routePath);

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-route-file"));
  });
});

test("reports missing-root-route when root SKILLS.md omits a required route", async () => {
  await withFixture(async (root) => {
    const rootSkills = await readFile(path.join(root, "SKILLS.md"), "utf8");
    await write(root, "SKILLS.md", rootSkills.replace("- `skills/grading/SKILLS.md`\n", ""));

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-root-route"));
  });
});

test("reports absolute-user-path for drive-qualified Users paths", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/miniprogram/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(root, skillPath, `${content}\nRuntime: C:\\Users\\someone\\miniapp\n`);

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("absolute-user-path"));
  });
});

test("reports forbidden-video-route for ai-video-production routing", async () => {
  await withFixture(async (root) => {
    const skillPath = ".agents/skills/generation/SKILL.md";
    const content = await readFile(path.join(root, ...skillPath.split("/")), "utf8");
    await write(root, skillPath, `${content}\nSee skills/ai-video-production/SKILLS.md.\n`);

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("forbidden-video-route"));
  });
});

test("reports forbidden-video-route when a legacy video Skill directory exists", async () => {
  await withFixture(async (root) => {
    await write(root, "skills/ai-video-production/SKILLS.md", "# Forbidden\n");

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("forbidden-video-route"));
  });
});

test("reports missing-npm-script when a root npm command has no package script", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper("ai-qa", EXPECTED_ROUTES["ai-qa"], "npm.cmd run check:missing"),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-npm-script"));
  });
});

test("reports missing-npm-script for a quoted npm script name", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper("ai-qa", EXPECTED_ROUTES["ai-qa"], 'npm.cmd run "check:missing"'),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-npm-script"));
  });
});

test("supports npm workspace options before the script name", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/web/package.json",
      `${JSON.stringify(
        { name: "@junhang/web", scripts: { "check:there": "node check.mjs" } },
        null,
        2,
      )}\n`,
    );
    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd run --workspace apps/web check:there",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("supports npm workspace options before the run token", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/web/package.json",
      `${JSON.stringify({ name: "@junhang/web", scripts: {} }, null, 2)}\n`,
    );
    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd --workspace apps/web run check:missing",
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const missingScript = result.failures.find(
      (failure) => failure.code === "missing-npm-script",
    );

    assert.equal(missingScript?.path, "apps/web/package.json");
  });
});

test("validates a repeated npm script against every selected workspace", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/a/package.json",
      `${JSON.stringify(
        { name: "@junhang/a", scripts: { "check:shared": "node check.mjs" } },
        null,
        2,
      )}\n`,
    );
    await write(
      root,
      "apps/b/package.json",
      `${JSON.stringify({ name: "@junhang/b", scripts: {} }, null, 2)}\n`,
    );
    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd run check:shared --workspace apps/a --workspace=apps/b --workspace apps/a",
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const missingScripts = result.failures.filter(
      (failure) => failure.code === "missing-npm-script",
    );

    assert.equal(missingScripts.length, 1);
    assert.equal(missingScripts[0].path, "apps/b/package.json");
  });
});

test("validates --workspaces scripts against every workspace package", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/a/package.json",
      `${JSON.stringify(
        { name: "@junhang/a", scripts: { "check:shared": "node check.mjs" } },
        null,
        2,
      )}\n`,
    );
    await write(
      root,
      "apps/b/package.json",
      `${JSON.stringify({ name: "@junhang/b", scripts: {} }, null, 2)}\n`,
    );
    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd run check:shared --workspaces",
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const missingScripts = result.failures.filter(
      (failure) => failure.code === "missing-npm-script",
    );

    assert.equal(missingScripts.length, 1);
    assert.equal(missingScripts[0].path, "apps/b/package.json");
  });
});

test("reports unsupported-npm-command for unknown options before run", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper(
        "ai-qa",
        EXPECTED_ROUTES["ai-qa"],
        "npm.cmd --script-shell cmd.exe run check:api",
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const unsupported = result.failures.find(
      (failure) => failure.code === "unsupported-npm-command",
    );

    assert.equal(unsupported?.option, "--script-shell");
  });
});

test("accepts a known npm script followed by sentence punctuation", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper("ai-qa", EXPECTED_ROUTES["ai-qa"], "npm.cmd run check:api."),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("scans Windows npm command tokens case-insensitively", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper("ai-qa", EXPECTED_ROUTES["ai-qa"], "NPM.CMD RuN check:missing"),
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("missing-npm-script"));
  });
});

test("ignores script arguments after the npm double-dash separator", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper(
        "ai-qa",
        EXPECTED_ROUTES["ai-qa"],
        "npm.cmd run check:api -- --workspace outside",
      ),
    );

    const result = await validateSkillsWorkspace(root);

    assert.equal(result.ok, true);
  });
});

test("resolves workspace names and paths before checking npm scripts", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/web/package.json",
      `${JSON.stringify({ name: "@junhang/web", scripts: {} }, null, 2)}\n`,
    );
    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd run typecheck --workspace @junhang/web",
      ),
    );

    const byName = await validateSkillsWorkspace(root);
    assert.ok(failureCodes(byName).includes("missing-npm-script"));

    await write(
      root,
      ".agents/skills/miniprogram-ui/SKILL.md",
      wrapper(
        "miniprogram-ui",
        EXPECTED_ROUTES["miniprogram-ui"],
        "npm.cmd run typecheck --workspace apps/web",
      ),
    );
    const byPath = await validateSkillsWorkspace(root);
    assert.ok(failureCodes(byPath).includes("missing-npm-script"));
  });
});

test("reports workspace-path-outside-root before reading an external package", async () => {
  await withFixture(async (root) => {
    const outside = `${root}-outside`;
    try {
      await write(
        outside,
        "package.json",
        `${JSON.stringify(
          { name: "outside-workspace", scripts: { "check:outside": "node check.mjs" } },
          null,
          2,
        )}\n`,
      );
      await write(
        root,
        "package.json",
        `${JSON.stringify(
          {
            private: true,
            scripts: { "check:api": "node --check index.js" },
            workspaces: [`../${path.basename(outside)}`],
          },
          null,
          2,
        )}\n`,
      );
      await write(
        root,
        ".agents/skills/ai-qa/SKILL.md",
        wrapper(
          "ai-qa",
          EXPECTED_ROUTES["ai-qa"],
          "npm.cmd run check:outside --workspace outside-workspace",
        ),
      );

      const result = await validateSkillsWorkspace(root);

      assert.ok(failureCodes(result).includes("workspace-path-outside-root"));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("reports unsupported-workspace-pattern for partial-segment wildcards", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "package.json",
      `${JSON.stringify(
        {
          private: true,
          scripts: { "check:api": "node --check index.js" },
          workspaces: ["apps/w*"],
        },
        null,
        2,
      )}\n`,
    );

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("unsupported-workspace-pattern"));
  });
});

test("returns a structured failure when package.json is a directory", async () => {
  await withFixture(async (root) => {
    const packagePath = path.join(root, "package.json");
    await unlink(packagePath);
    await mkdir(packagePath);

    const result = await validateSkillsWorkspace(root);

    assert.ok(failureCodes(result).includes("package-read-error"));
  });
});

test("deduplicates containment failures for the same external workspace", async () => {
  await withFixture(async (root) => {
    const outsideSelector = `../${path.basename(root)}-outside`;
    await write(
      root,
      "package.json",
      `${JSON.stringify(
        {
          private: true,
          scripts: { "check:api": "node --check index.js" },
          workspaces: [outsideSelector],
        },
        null,
        2,
      )}\n`,
    );
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper(
        "ai-qa",
        EXPECTED_ROUTES["ai-qa"],
        `npm.cmd run check:outside --workspace ${outsideSelector}`,
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const containmentFailures = result.failures.filter(
      (failure) => failure.code === "workspace-path-outside-root",
    );

    assert.equal(containmentFailures.length, 1);
  });
});

test("deduplicates containment failures by normalized resolved target", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      ".agents/skills/ai-qa/SKILL.md",
      wrapper(
        "ai-qa",
        EXPECTED_ROUTES["ai-qa"],
        "npm.cmd run check:outside --workspace ../outside --workspace apps/../../outside",
      ),
    );

    const result = await validateSkillsWorkspace(root);
    const containmentFailures = result.failures.filter(
      (failure) => failure.code === "workspace-path-outside-root",
    );

    assert.equal(containmentFailures.length, 1);
  });
});
