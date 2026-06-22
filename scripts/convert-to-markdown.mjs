import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, relative, basename } from "node:path";
import { homedir } from "node:os";

const supportedExtensions = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xls",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp"
]);
const directTextExtensions = new Set([".md", ".txt", ".csv", ".tsv"]);

function parseArgs(argv) {
  const args = {
    input: "",
    outDir: "exports/markdown-ingestion",
    recursive: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--out") {
      args.outDir = argv[index + 1] || args.outDir;
      index += 1;
    } else if (value === "--flat") {
      args.recursive = false;
    } else if (!args.input) {
      args.input = value;
    }
  }

  return args;
}

function collectFiles(inputPath, recursive) {
  const absolute = resolve(inputPath);
  if (!existsSync(absolute)) {
    throw new Error(`Input not found: ${absolute}`);
  }

  const stats = statSync(absolute);
  if (stats.isFile()) return [absolute];

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const current = join(dir, entry);
      const currentStats = statSync(current);
      if (currentStats.isDirectory()) {
        if (recursive) walk(current);
        continue;
      }
      files.push(current);
    }
  };
  walk(absolute);
  return files;
}

function sanitizeName(filePath) {
  return basename(filePath)
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function pythonCandidates() {
  const bundledPython = join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe"
  );
  return [
    process.env.MARKITDOWN_PYTHON,
    process.env.PYTHON,
    bundledPython,
    "python",
    "py"
  ].filter(Boolean);
}

function findMarkitdownPython() {
  const probe = "import markitdown; print('ok')";
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate, ["-c", probe], {
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

function convertFile(python, filePath, ext) {
  if (directTextExtensions.has(ext)) {
    return readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  }

  const code = [
    "import sys",
    "from markitdown import MarkItDown",
    "md = MarkItDown()",
    "result = md.convert(sys.argv[1])",
    "sys.stdout.write(result.text_content or '')"
  ].join("\n");

  const result = spawnSync(python, ["-c", code, filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "markitdown conversion failed").trim());
  }

  return result.stdout || "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("Usage: node scripts/convert-to-markdown.mjs <file-or-directory> [--out exports/markdown-ingestion] [--flat]");
    process.exit(1);
  }

  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });

  const files = collectFiles(args.input, args.recursive).filter((filePath) => {
    const ext = extname(filePath).toLowerCase();
    return supportedExtensions.has(ext);
  });
  const needsMarkitdown = files.some((filePath) => !directTextExtensions.has(extname(filePath).toLowerCase()));
  const python = needsMarkitdown ? findMarkitdownPython() : null;
  if (needsMarkitdown && !python) {
    console.error("markitdown is not installed in an available Python environment.");
    console.error("Install it with one of these commands:");
    console.error("  python -m pip install 'markitdown[all]'");
    console.error("  set MARKITDOWN_PYTHON=C:\\path\\to\\python.exe");
    process.exit(2);
  }

  const records = [];
  files.forEach((filePath, index) => {
    const ext = extname(filePath).toLowerCase();
    const outputName = `${String(index + 1).padStart(3, "0")}-${sanitizeName(filePath) || "document"}.md`;
    const outputPath = join(outDir, outputName);
    const converter = directTextExtensions.has(ext) ? "utf8-direct" : "markitdown";
    const markdown = convertFile(python, filePath, ext);
    const header = [
      "---",
      `sourcePath: ${JSON.stringify(filePath)}`,
      `sourceType: ${JSON.stringify(ext.slice(1))}`,
      `convertedAt: ${JSON.stringify(new Date().toISOString())}`,
      `converter: ${converter}`,
      "---",
      ""
    ].join("\n");

    writeFileSync(outputPath, `${header}${markdown.trim()}\n`, "utf8");
    records.push({
      sourcePath: filePath,
      outputPath,
      relativeOutputPath: relative(process.cwd(), outputPath),
      sourceType: ext.slice(1),
      converter,
      bytes: Buffer.byteLength(markdown, "utf8")
    });
  });

  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        input: resolve(args.input),
        outDir,
        converter: "markitdown",
        fileCount: records.length,
        records
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ ok: true, fileCount: records.length, outDir, manifestPath }, null, 2));
}

main();
