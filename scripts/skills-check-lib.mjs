import fs from "node:fs";
import path from "node:path";
import { parseAllDocuments } from "yaml";

export const REQUIRED_SKILL_ROUTES = {
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

function toSystemPath(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function toPortablePath(value) {
  return value.replaceAll("\\", "/");
}

function readTextFile(filePath) {
  try {
    return { status: "ok", content: fs.readFileSync(filePath, "utf8") };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing" };
    return { status: "error", error };
  }
}

function readJsonFile(filePath) {
  const result = readTextFile(filePath);
  if (result.status !== "ok") return result;
  try {
    return { status: "ok", value: JSON.parse(result.content) };
  } catch (error) {
    return { status: "invalid", error };
  }
}

function inspectRegularFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return { status: "ok", isFile: stats.isFile() };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing", isFile: false };
    return { status: "error", isFile: false, error };
  }
}

function realPath(filePath) {
  try {
    return { status: "ok", path: fs.realpathSync.native(filePath) };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing" };
    return { status: "error", error };
  }
}

function isInside(root, target, allowRoot = false) {
  const relative = path.relative(root, target);
  if (relative === "") return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") return { valid: false, values: {} };

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) return { valid: false, values: {} };

  const yamlSource = lines.slice(1, closingIndex).join("\n");
  const adjacentBody = [];
  for (let index = closingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") break;
    adjacentBody.push(lines[index]);
  }
  const adjacentDelimiter = adjacentBody.indexOf("---");
  if (
    adjacentDelimiter === 0 ||
    (adjacentDelimiter > 0 &&
      adjacentBody
        .slice(0, adjacentDelimiter)
        .every((line) => /^[a-zA-Z0-9_-]+\s*:/.test(line)))
  ) {
    return { valid: false, values: {} };
  }

  let documents;
  try {
    documents = parseAllDocuments(yamlSource, { uniqueKeys: true });
  } catch {
    return { valid: false, values: {} };
  }
  if (documents.length !== 1 || documents[0].errors.length > 0) {
    return { valid: false, values: {} };
  }

  let values;
  try {
    values = documents[0].toJS();
  } catch {
    return { valid: false, values: {} };
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { valid: false, values: {} };
  }

  const keys = Object.keys(values);
  const valid =
    keys.length === 2 &&
    keys.includes("name") &&
    keys.includes("description") &&
    typeof values.name === "string" &&
    typeof values.description === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.name) &&
    values.description.startsWith("Use when");

  return { valid, values };
}

function isTerminalSentencePunctuation(content, index) {
  const next = content[index + 1];
  return next === undefined || /[\s`"')\]}>|]/.test(next);
}

function hasExactPathToken(content, expectedPath) {
  let start = 0;
  while (start < content.length) {
    const index = content.indexOf(expectedPath, start);
    if (index === -1) return false;

    const before = content[index - 1];
    const afterIndex = index + expectedPath.length;
    const after = content[afterIndex];
    const validBefore = before === undefined || /[\s`"'([{<|:]/.test(before);
    const validAfter =
      after === undefined ||
      /[\s`"')\]}>|,;:]/.test(after) ||
      (/[.!?]/.test(after) && isTerminalSentencePunctuation(content, afterIndex));

    if (validBefore && validAfter) return true;
    start = index + expectedPath.length;
  }
  return false;
}

function workspacePatterns(packageJson) {
  if (Array.isArray(packageJson?.workspaces)) return packageJson.workspaces;
  if (Array.isArray(packageJson?.workspaces?.packages)) return packageJson.workspaces.packages;
  return [];
}

function resolveContainedWorkspacePath({
  workspaceRoot,
  workspaceRootReal,
  candidate,
  displayPath,
  addFailure,
  allowRoot = false,
}) {
  const resolved = path.resolve(candidate);
  if (!isInside(workspaceRoot, resolved, allowRoot)) {
    addFailure("workspace-path-outside-root", {
      path: displayPath,
      dedupeTarget: resolved,
      message: `Workspace path ${displayPath} resolves outside the repository root.`,
    });
    return null;
  }

  const actual = realPath(resolved);
  if (actual.status === "missing") return null;
  if (actual.status === "error") {
    addFailure("workspace-read-error", {
      path: displayPath,
      errorCode: actual.error.code,
      message: `Cannot resolve workspace path ${displayPath}.`,
    });
    return null;
  }
  if (!isInside(workspaceRootReal, actual.path, allowRoot)) {
    addFailure("workspace-path-outside-root", {
      path: displayPath,
      dedupeTarget: actual.path,
      message: `Workspace path ${displayPath} points outside the repository root.`,
    });
    return null;
  }
  return actual.path;
}

function listWorkspaceDirectories({
  workspaceRoot,
  workspaceRootReal,
  packageJson,
  addFailure,
}) {
  const directories = new Map();
  const patterns = workspacePatterns(packageJson).map(String).sort();

  for (const rawPattern of patterns) {
    const pattern = toPortablePath(rawPattern).replace(/^\.\//, "").replace(/\/$/, "");
    const hasParentSegment = pattern.split("/").includes("..");
    const hasGlobSyntax = /[*?[\]{}]/.test(pattern);
    const isSupportedWildcard = /^[^/*?[\]{}]+\/\*$/.test(pattern);
    if (hasParentSegment || (hasGlobSyntax && !isSupportedWildcard)) {
      addFailure("unsupported-workspace-pattern", {
        path: pattern,
        message: `Workspace pattern ${pattern} is not a supported literal or single-segment wildcard.`,
      });
      if (hasParentSegment) {
        resolveContainedWorkspacePath({
          workspaceRoot,
          workspaceRootReal,
          candidate: path.resolve(workspaceRoot, ...pattern.split("/")),
          displayPath: pattern,
          addFailure,
        });
      }
      continue;
    }

    if (!isSupportedWildcard) {
      const resolved = path.resolve(workspaceRoot, ...pattern.split("/"));
      const actual = resolveContainedWorkspacePath({
        workspaceRoot,
        workspaceRootReal,
        candidate: resolved,
        displayPath: pattern,
        addFailure,
      });
      if (actual) directories.set(pattern, actual);
      continue;
    }

    const wildcard = pattern.indexOf("*");
    const base = pattern.slice(0, wildcard).replace(/\/$/, "");
    const suffix = pattern.slice(wildcard + 1).replace(/^\//, "");
    const baseCandidate = path.resolve(workspaceRoot, ...base.split("/").filter(Boolean));
    const baseActual = resolveContainedWorkspacePath({
      workspaceRoot,
      workspaceRootReal,
      candidate: baseCandidate,
      displayPath: base || ".",
      addFailure,
      allowRoot: true,
    });
    if (!baseActual) continue;

    let entries;
    try {
      entries = fs.readdirSync(baseActual, { withFileTypes: true });
    } catch (error) {
      addFailure("workspace-read-error", {
        path: base || ".",
        errorCode: error.code,
        message: `Cannot read workspace base ${base || "."}.`,
      });
      continue;
    }

    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = [base, entry.name, suffix].filter(Boolean).join("/");
      const candidate = path.resolve(baseActual, entry.name, ...suffix.split("/").filter(Boolean));
      const actual = resolveContainedWorkspacePath({
        workspaceRoot,
        workspaceRootReal,
        candidate,
        displayPath: relativePath,
        addFailure,
      });
      if (actual) directories.set(relativePath, actual);
    }
  }

  return [...directories.entries()].map(([relativePath, actualPath]) => ({
    relativePath,
    actualPath,
  }));
}

function loadWorkspaces(context, rootPackage) {
  const workspaces = [];
  for (const directory of listWorkspaceDirectories({ ...context, packageJson: rootPackage })) {
    const packageDisplayPath = `${directory.relativePath}/package.json`;
    const packagePath = resolveContainedWorkspacePath({
      ...context,
      candidate: path.join(directory.actualPath, "package.json"),
      displayPath: packageDisplayPath,
    });
    if (!packagePath) continue;

    const parsed = readJsonFile(packagePath);
    if (parsed.status === "error") {
      context.addFailure("workspace-package-read-error", {
        path: packageDisplayPath,
        errorCode: parsed.error.code,
        message: `Cannot read workspace package file ${packageDisplayPath}.`,
      });
      continue;
    }
    if (parsed.status === "invalid") {
      context.addFailure("invalid-package-json", {
        path: packageDisplayPath,
        message: `Cannot parse workspace package file ${packageDisplayPath}.`,
      });
      continue;
    }
    if (parsed.status === "ok") {
      workspaces.push({ ...directory, packageJson: parsed.value });
    }
  }
  return workspaces;
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;

  const pushCurrent = () => {
    if (current) tokens.push(current);
    current = "";
  };

  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }
    if (character === "`" || character === ";" || character === "&" || character === "|") {
      break;
    }
    current += character;
  }
  pushCurrent();
  return tokens;
}

function npmCommands(content) {
  const commands = [];
  for (const line of content.split(/\r?\n/)) {
    const pattern = /\bnpm\.cmd\b/gi;
    for (const match of line.matchAll(pattern)) {
      commands.push(tokenizeCommand(line.slice(match.index)));
    }
  }
  return commands;
}

function parseNpmRun(tokens) {
  if (tokens[0]?.toLowerCase() !== "npm.cmd") return null;

  let scriptName = null;
  let scriptTokenIndex = -1;
  let runSeen = false;
  let allWorkspaces = false;
  const workspaceSelectors = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") break;
    if (token === "--workspace" || token === "-w") {
      if (!tokens[index + 1]) return { unsupportedOption: token };
      workspaceSelectors.push(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--workspace=")) {
      const selector = token.slice("--workspace=".length);
      if (!selector) return { unsupportedOption: token };
      workspaceSelectors.push(selector);
      continue;
    }
    if (token === "--workspaces") {
      allWorkspaces = true;
      continue;
    }
    if (token.startsWith("-")) return { unsupportedOption: token };
    if (!runSeen) {
      if (token.toLowerCase() === "run") runSeen = true;
      else return null;
      continue;
    }
    if (!scriptName) {
      scriptName = token;
      scriptTokenIndex = index;
    }
  }
  return {
    scriptName,
    scriptIsFinalToken: scriptTokenIndex === tokens.length - 1,
    workspaceSelectors,
    allWorkspaces,
  };
}

function normalizeWorkspaceSelector(selector) {
  return toPortablePath(selector).replace(/^\.\//, "").replace(/\/$/, "");
}

function resolveNpmScriptName(packageJson, command) {
  const scripts = packageJson?.scripts || {};
  if (Object.hasOwn(scripts, command.scriptName)) return command.scriptName;
  if (command.scriptIsFinalToken && command.scriptName.endsWith(".")) {
    const withoutPeriod = command.scriptName.slice(0, -1);
    if (withoutPeriod && Object.hasOwn(scripts, withoutPeriod)) return withoutPeriod;
  }
  return null;
}

function validateNpmCommands({
  content,
  skill,
  rootPackage,
  workspaces,
  workspaceRoot,
  addFailure,
}) {
  for (const tokens of npmCommands(content)) {
    const command = parseNpmRun(tokens);
    if (command?.unsupportedOption) {
      addFailure("unsupported-npm-command", {
        skill,
        option: command.unsupportedOption,
        message: `Skill ${skill} uses unsupported npm option ${command.unsupportedOption}.`,
      });
      continue;
    }
    if (!command?.scriptName) continue;

    const selectors = [
      ...new Set(command.workspaceSelectors.map(normalizeWorkspaceSelector)),
    ];
    if (command.allWorkspaces && selectors.length > 0) {
      addFailure("unsupported-npm-command", {
        skill,
        option: "--workspaces",
        message: `Skill ${skill} cannot combine --workspaces with workspace selectors.`,
      });
      continue;
    }

    const packageTargets = [];
    if (command.allWorkspaces) {
      for (const workspace of workspaces) {
        packageTargets.push({
          packageJson: workspace.packageJson,
          packagePath: `${workspace.relativePath}/package.json`,
        });
      }
      if (packageTargets.length === 0) {
        addFailure("missing-workspace", {
          skill,
          workspace: "--workspaces",
          message: `Skill ${skill} uses --workspaces but no workspace packages were found.`,
        });
      }
    } else if (selectors.length === 0) {
      packageTargets.push({ packageJson: rootPackage, packagePath: "package.json" });
    }

    for (const selector of selectors) {
      if (selector) {
        const workspace = workspaces.find(
          (item) => item.relativePath === selector || item.packageJson?.name === selector,
        );
        if (!workspace) {
          if (!selector.startsWith("@") && (selector.includes("/") || selector.startsWith(".."))) {
            const target = path.resolve(workspaceRoot, ...selector.split("/"));
            if (!isInside(workspaceRoot, target)) {
              addFailure("workspace-path-outside-root", {
                skill,
                path: selector,
                dedupeTarget: target,
                message: `Workspace selector ${selector} resolves outside the repository root.`,
              });
              continue;
            }
          }
          addFailure("missing-workspace", {
            skill,
            workspace: selector,
            message: `Skill ${skill} references unknown workspace ${selector}.`,
          });
          continue;
        }
        packageTargets.push({
          packageJson: workspace.packageJson,
          packagePath: `${workspace.relativePath}/package.json`,
        });
      }
    }

    for (const { packageJson, packagePath } of packageTargets) {
      if (!resolveNpmScriptName(packageJson, command)) {
        addFailure("missing-npm-script", {
          skill,
          script: command.scriptName,
          path: packagePath,
          message: `Skill ${skill} references missing npm script ${command.scriptName} in ${packagePath}.`,
        });
      }
    }
  }
}

export function validateSkillsWorkspace(root, options = {}) {
  const workspaceRoot = path.resolve(root);
  const failures = [];
  const containmentFailureKeys = new Set();
  const checkedSkills = [];
  const addFailure = (type, details = {}) => {
    const { dedupeTarget, ...failureDetails } = details;
    if (type === "workspace-path-outside-root") {
      const normalizedTarget = path.normalize(dedupeTarget || details.path);
      const keyTarget = process.platform === "win32"
        ? normalizedTarget.toLowerCase()
        : normalizedTarget;
      const key = `${type}:${keyTarget}`;
      if (containmentFailureKeys.has(key)) return;
      containmentFailureKeys.add(key);
    }
    failures.push({ type, code: type, ...failureDetails });
  };
  const requiredSkills = options.requiredRoutes || Object.keys(REQUIRED_SKILL_ROUTES);
  const rootRealResult = realPath(workspaceRoot);
  if (rootRealResult.status !== "ok") {
    addFailure("workspace-root-read-error", {
      path: workspaceRoot,
      errorCode: rootRealResult.error?.code,
      message: "Cannot resolve the repository root.",
    });
    return { ok: false, checkedSkills, failures };
  }

  const context = {
    workspaceRoot,
    workspaceRootReal: rootRealResult.path,
    addFailure,
  };
  const packageResult = readJsonFile(path.join(workspaceRoot, "package.json"));
  if (packageResult.status === "missing") {
    addFailure("missing-package-json", { path: "package.json", message: "Root package.json is missing." });
  } else if (packageResult.status === "error") {
    addFailure("package-read-error", {
      path: "package.json",
      errorCode: packageResult.error.code,
      message: "Root package.json cannot be read.",
    });
  } else if (packageResult.status === "invalid") {
    addFailure("invalid-package-json", { path: "package.json", message: "Root package.json is invalid." });
  }
  const rootPackage = packageResult.status === "ok" ? packageResult.value : {};
  const workspaces = loadWorkspaces(context, rootPackage);

  const rootSkillsResult = readTextFile(path.join(workspaceRoot, "SKILLS.md"));
  if (rootSkillsResult.status === "missing") {
    addFailure("missing-root-skills", { path: "SKILLS.md", message: "Root SKILLS.md is missing." });
  } else if (rootSkillsResult.status === "error") {
    addFailure("root-skills-read-error", {
      path: "SKILLS.md",
      errorCode: rootSkillsResult.error.code,
      message: "Root SKILLS.md cannot be read.",
    });
  }
  const rootSkills = rootSkillsResult.status === "ok" ? rootSkillsResult.content : null;

  if (rootSkills?.includes("ai-video-production")) {
    addFailure("forbidden-video-route", {
      path: "SKILLS.md",
      message: "Root SKILLS.md contains the forbidden ai-video-production route.",
    });
  }

  for (const forbiddenPath of [
    "skills/ai-video-production",
    ".agents/skills/ai-video-production",
  ]) {
    const inspected = inspectRegularFile(toSystemPath(workspaceRoot, forbiddenPath));
    if (inspected.status !== "missing") {
      addFailure("forbidden-video-route", {
        path: forbiddenPath,
        message: `The ${forbiddenPath} route is forbidden.`,
      });
    }
  }

  for (const skill of requiredSkills) {
    const route = REQUIRED_SKILL_ROUTES[skill];
    if (!route) {
      addFailure("unknown-required-skill", { skill, message: `Unknown required Skill ${skill}.` });
      continue;
    }

    const skillPath = `.agents/skills/${skill}/SKILL.md`;
    const skillResult = readTextFile(toSystemPath(workspaceRoot, skillPath));
    if (skillResult.status === "missing") {
      addFailure("missing-skill", {
        skill,
        path: skillPath,
        message: `Required repository Skill ${skill} is missing.`,
      });
      continue;
    }
    if (skillResult.status === "error") {
      addFailure("skill-read-error", {
        skill,
        path: skillPath,
        errorCode: skillResult.error.code,
        message: `Required repository Skill ${skill} cannot be read.`,
      });
      continue;
    }
    checkedSkills.push(skill);
    const content = skillResult.content;

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter.valid) {
      addFailure("invalid-frontmatter", {
        skill,
        path: skillPath,
        message: `Skill ${skill} must have only valid name and description frontmatter.`,
      });
    }
    if (typeof frontmatter.values.name === "string" && frontmatter.values.name !== skill) {
      addFailure("name-mismatch", {
        skill,
        path: skillPath,
        actual: frontmatter.values.name,
        message: `Skill ${skill} has frontmatter name ${frontmatter.values.name}.`,
      });
    }

    if (!hasExactPathToken(content, route)) {
      addFailure("missing-route", {
        skill,
        path: skillPath,
        route,
        message: `Skill ${skill} does not reference its exact route ${route}.`,
      });
    }
    const routeResult = inspectRegularFile(toSystemPath(workspaceRoot, route));
    if (routeResult.status === "error") {
      addFailure("route-read-error", {
        skill,
        path: route,
        errorCode: routeResult.error.code,
        message: `Skill ${skill} route ${route} cannot be inspected.`,
      });
    } else if (routeResult.status === "missing" || !routeResult.isFile) {
      addFailure("missing-route-file", {
        skill,
        path: route,
        message: `Skill ${skill} route ${route} is not a file.`,
      });
    }
    if (rootSkills !== null && !hasExactPathToken(rootSkills, route)) {
      addFailure("missing-root-route", {
        skill,
        path: "SKILLS.md",
        route,
        message: `Root SKILLS.md does not reference ${route}.`,
      });
    }
    if (/\b[A-Za-z]:[\\/]+Users[\\/]+/i.test(content)) {
      addFailure("absolute-user-path", {
        skill,
        path: skillPath,
        message: `Skill ${skill} contains a drive-qualified Users path.`,
      });
    }
    if (content.includes("ai-video-production")) {
      addFailure("forbidden-video-route", {
        skill,
        path: skillPath,
        message: `Skill ${skill} contains the forbidden ai-video-production route.`,
      });
    }

    validateNpmCommands({
      content,
      skill,
      rootPackage,
      workspaces,
      workspaceRoot,
      addFailure,
    });
  }

  return { ok: failures.length === 0, checkedSkills, failures };
}
