import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const defaultInputRoots = ["exports/markdown-ingestion", "exports/markdown-ingestion-test"];
const defaultOutDir = "exports/content-index";
const subjectSignals = {
  数学: ["数学", "计算", "解答", "填空", "选择", "应用题", "小数", "分数", "几何", "面积", "周长", "方程"],
  语文: ["语文", "阅读", "作文", "习作", "文言", "拼音", "词语", "句子", "段落", "课文"],
  英语: ["英语", "English", "word", "sentence", "reading", "listening", "grammar", "vocabulary"]
};
const gradeSignals = {
  三年级: ["三年级", "3年级", "Grade 3", "third grade"],
  四年级: ["四年级", "4年级", "Grade 4", "fourth grade"],
  五年级: ["五年级", "5年级", "Grade 5", "fifth grade"],
  六年级: ["六年级", "6年级", "Grade 6", "sixth grade"]
};
const knowledgeSignals = [
  "小数乘法",
  "小数除法",
  "分数乘法",
  "分数除法",
  "单位换算",
  "应用题",
  "竖式计算",
  "面积",
  "周长",
  "图形",
  "阅读理解",
  "概括",
  "修辞",
  "文言文",
  "看拼音写词语",
  "词汇运用",
  "单项选择",
  "写作",
  "听力",
  "grammar",
  "vocabulary",
  "reading"
];

function parseArgs(argv) {
  const args = { inputs: [], outDir: defaultOutDir, maxChunksPerFile: 12 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--out") {
      args.outDir = argv[index + 1] || args.outDir;
      index += 1;
    } else if (value === "--max-chunks") {
      args.maxChunksPerFile = Math.max(1, Number(argv[index + 1]) || args.maxChunksPerFile);
      index += 1;
    } else {
      args.inputs.push(value);
    }
  }
  if (!args.inputs.length) args.inputs = defaultInputRoots;
  return args;
}

function walk(dir, predicate, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, predicate, files);
    else if (predicate(full)) files.push(full);
  }
  return files;
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { metadata: {}, body: markdown };
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try {
      metadata[key] = JSON.parse(raw);
    } catch {
      metadata[key] = raw;
    }
  }
  return { metadata, body: markdown.slice(match[0].length) };
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scoreSignals(text, signals) {
  const lower = text.toLowerCase();
  return Object.fromEntries(
    Object.entries(signals).map(([label, words]) => [
      label,
      words.reduce((score, word) => score + (lower.includes(String(word).toLowerCase()) ? 1 : 0), 0)
    ])
  );
}

function topLabels(scores) {
  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
}

function extractKnowledgePoints(text) {
  const lower = text.toLowerCase();
  return Array.from(new Set(knowledgeSignals.filter((item) => lower.includes(item.toLowerCase())))).slice(0, 12);
}

function splitChunks(text, maxChunks) {
  const paragraphs = cleanText(text)
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > 1200 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, maxChunks).map((chunk, index) => ({
    id: `chunk-${index + 1}`,
    text: chunk,
    preview: chunk.slice(0, 240)
  }));
}

function summarize(text) {
  const clean = cleanText(text);
  const firstHeading = clean.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const firstSentence = clean
    .replace(/^---[\s\S]*?---/, "")
    .split(/(?<=[。！？；?])\s|\n/)
    .map((item) => item.trim())
    .find((item) => item.length >= 20);
  return (firstHeading || firstSentence || clean.slice(0, 160)).slice(0, 240);
}

function normalizeDisplayText(text) {
  return String(text || "")
    .replace(/Prompt Engineering/gi, "提示词工程")
    .replace(/Context Engineering/gi, "上下文工程")
    .replace(/playbook/gi, "使用手册")
    .replace(/reading/gi, "阅读")
    .replace(/grammar/gi, "语法")
    .replace(/vocabulary/gi, "词汇")
    .trim();
}

function documentTitle(sourcePath, summary) {
  const fileTitle = basename(sourcePath).replace(/\.[^.]+$/, "");
  if (/^[\w\s._-]+$/.test(fileTitle) && summary) return normalizeDisplayText(summary);
  return normalizeDisplayText(fileTitle);
}

function loadManifestRecords(inputRoots) {
  const manifestPaths = inputRoots.flatMap((root) =>
    walk(resolve(root), (file) => basename(file).toLowerCase() === "manifest.json")
  );
  return manifestPaths.flatMap((manifestPath) => {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return (manifest.records || []).map((record) => ({
        ...record,
        manifestPath,
        markdownPath: record.outputPath || resolve(dirname(manifestPath), record.relativeOutputPath || "")
      }));
    } catch {
      return [];
    }
  });
}

function collectMarkdownFiles(inputRoots, manifestRecords) {
  const fromManifest = manifestRecords.map((record) => record.markdownPath).filter(Boolean);
  const discovered = inputRoots.flatMap((root) => walk(resolve(root), (file) => extname(file).toLowerCase() === ".md"));
  return Array.from(new Set([...fromManifest, ...discovered])).filter((file) => existsSync(file));
}

function buildDocument(filePath, index, manifestRecords, maxChunksPerFile) {
  const markdown = readFileSync(filePath, "utf8");
  const { metadata, body } = parseFrontMatter(markdown);
  const text = cleanText(body);
  const subjectScores = scoreSignals(text, subjectSignals);
  const gradeScores = scoreSignals(text, gradeSignals);
  const manifestRecord = manifestRecords.find((record) => resolve(record.markdownPath) === resolve(filePath));
  const chunks = splitChunks(text, maxChunksPerFile);
  const sourcePath = metadata.sourcePath || manifestRecord?.sourcePath || filePath;
  const summary = summarize(text);
  return {
    id: `doc-${String(index + 1).padStart(4, "0")}`,
    title: documentTitle(sourcePath, summary),
    sourcePath,
    markdownPath: filePath,
    relativeMarkdownPath: relative(process.cwd(), filePath),
    sourceType: metadata.sourceType || manifestRecord?.sourceType || extname(sourcePath).slice(1) || "markdown",
    summary: normalizeDisplayText(summary),
    subjects: topLabels(subjectScores),
    grades: topLabels(gradeScores),
    knowledgePoints: extractKnowledgePoints(text),
    chunkCount: chunks.length,
    textLength: text.length,
    chunks
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputRoots = args.inputs.map((item) => resolve(item)).filter((item) => existsSync(item));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });

  const manifestRecords = loadManifestRecords(inputRoots);
  const markdownFiles = collectMarkdownFiles(inputRoots, manifestRecords);
  const documents = markdownFiles.map((file, index) => buildDocument(file, index, manifestRecords, args.maxChunksPerFile));
  const subjectCounts = {};
  const gradeCounts = {};
  const knowledgePointCounts = {};
  for (const document of documents) {
    for (const subject of document.subjects) subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
    for (const grade of document.grades) gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
    for (const point of document.knowledgePoints) knowledgePointCounts[point] = (knowledgePointCounts[point] || 0) + 1;
  }

  const index = {
    generatedAt: new Date().toISOString(),
    inputRoots,
    documentCount: documents.length,
    subjectCounts,
    gradeCounts,
    knowledgePointCounts,
    documents
  };
  const outputPath = join(outDir, "index.json");
  writeFileSync(outputPath, JSON.stringify(index, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, documentCount: documents.length, outputPath }, null, 2));
}

main();
