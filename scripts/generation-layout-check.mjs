import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function directRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(path.resolve(argvPath)).href;
}

function normalizeText(value) {
  return String(value || "");
}

function inferKind(name, text = "") {
  if (name.includes("试卷")) return "试卷";
  if (name.includes("小测")) return "小测";
  if (name.includes("练习")) return "练习";
  const source = normalizeText(text);
  if (source.includes("试卷")) return "试卷";
  if (source.includes("小测")) return "小测";
  if (source.includes("练习")) return "练习";
  return "";
}

function inferSubject(name, text = "") {
  if (/英语|English/i.test(name)) return "英语";
  if (name.includes("语文")) return "语文";
  if (name.includes("数学")) return "数学";
  const source = normalizeText(text);
  if (/英语|English/i.test(source)) return "英语";
  if (source.includes("语文")) return "语文";
  if (source.includes("数学")) return "数学";
  return "";
}

function expectedStudentPages(kind) {
  if (kind === "试卷") return 4;
  if (kind === "小测" || kind === "练习") return 2;
  return null;
}

function parseHeaderPageTotals(text) {
  const labels = [];
  const pattern = /第\s*(\d+)\s*\/\s*(\d+)\s*页/g;
  let match;
  while ((match = pattern.exec(text))) {
    labels.push({
      current: Number(match[1]),
      total: Number(match[2])
    });
  }
  return labels;
}

function hasEnglishQuizStructureSignals(text) {
  return {
    translation: /中英文互译|中文译英文|英文译中文|中译英|英译中/.test(text),
    wordWriting: /写单词|根据中文写单词|单词书写|词汇与短语/.test(text),
    sentenceUse: /造句|句子运用|句型表达/.test(text)
  };
}

function stripTemplateGuidanceText(text) {
  const lines = normalizeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstQuestionLine = lines.findIndex((line) => /^(?:[一二三四五六七八九十]+[、.．]|第?\s*\d+[.、．])/.test(line));
  const contentLines = firstQuestionLine >= 0 ? lines.slice(firstQuestionLine) : lines;
  return contentLines
    .filter((line) => {
      const mentionsForbiddenPattern = /文章选词填空|完形填空|短文语法填空|词形变化/.test(line);
      const isGuidance = /不得|不默认|避免|不要|禁止|必须|结构|围绕/.test(line);
      return !(mentionsForbiddenPattern && isGuidance);
    })
    .join("\n");
}

function pageMetricText(metric = {}) {
  return normalizeText(metric.text || metric.textSnippet || "");
}

function hasIntentionalMathWorkSpace(metric = {}, subject = "") {
  if (!normalizeText(subject).includes("数学")) return false;
  const text = pageMetricText(metric);
  const drawingCount = Number(metric.drawingCount || 0);
  const hasWorkSection = /计算题|解答题|解决问题|操作与思考题/.test(text);
  const hasWorkPrompt = /解方程|计算[:：]|求比值|列式|如图|求.{0,12}(面积|体积|度数|角度)|应用题/.test(text);
  return drawingCount >= 4 && (hasWorkSection || hasWorkPrompt);
}

export function evaluateGenerationLayoutPdf(pdf = {}) {
  const name = normalizeText(pdf.name);
  const text = normalizeText(pdf.text);
  const questionText = stripTemplateGuidanceText(text);
  const pages = Number(pdf.pages || 0);
  const kind = inferKind(name, text);
  const subject = inferSubject(name, text);
  const targetPages = expectedStudentPages(kind);
  const pageMetrics = Array.isArray(pdf.pageMetrics) ? pdf.pageMetrics : [];
  const issues = [];

  if (!name.includes("题目")) {
    return {
      name,
      ok: true,
      detail: { subject, kind, pages, targetPages, skipped: true },
      issues
    };
  }

  if (!pages) {
    issues.push("题目 PDF 无法读取真实页数。");
  }

  if (targetPages && pages && pages !== targetPages) {
    issues.push(`题目 PDF 实际页数 ${pages} 与目标 ${targetPages} 不一致。`);
  }

  const headerLabels = parseHeaderPageTotals(text);
  const staleHeaderTotals = [...new Set(headerLabels.map((item) => item.total).filter((total) => total && total !== pages))];
  for (const total of staleHeaderTotals) {
    issues.push(`页眉总页数 ${total} 与真实页数 ${pages} 不一致。`);
  }

  for (let index = 0; index < Math.max(0, pageMetrics.length - 1); index += 1) {
    const metric = pageMetrics[index] || {};
    const blankMm = Number(metric.bottomBlankMm || 0);
    const intentionalMathWorkSpace = hasIntentionalMathWorkSpace(metric, subject);
    const allowedBlankMm = intentionalMathWorkSpace
      ? kind === "试卷" ? 170 : 145
      : subject === "语文" && kind === "试卷"
        ? 240
        : subject === "语文" && kind === "练习"
          ? 150
        : 120;
    if (blankMm >= allowedBlankMm) {
      issues.push(`第 ${index + 1} 页后续仍有内容，但本页底部留白 ${blankMm.toFixed(1)}mm，疑似预分页和真实分页脱节。`);
    }
  }

  const finalMetric = pageMetrics[pageMetrics.length - 1] || {};
  const finalBlankMm = Number(finalMetric.bottomBlankMm || 0);
  const finalDrawingCount = Number(finalMetric.drawingCount || 0);
  const hasWriting = /写作题|习作|书面表达|Writing/i.test(questionText);
  const hasIntentionalMathWorkArea = hasIntentionalMathWorkSpace(finalMetric, subject);
  const finalBlankLimit = hasIntentionalMathWorkArea ? (kind === "试卷" ? 180 : 145) : kind === "试卷" ? 180 : 125;
  const hasIntentionalWritingArea = hasWriting && finalDrawingCount >= 16;

  if (finalBlankMm >= finalBlankLimit && !hasIntentionalWritingArea) {
    if (hasWriting) {
      issues.push(`写作页底部留白 ${finalBlankMm.toFixed(1)}mm，且缺少足够写作线/方格信号。`);
    } else {
      issues.push(`末页底部留白 ${finalBlankMm.toFixed(1)}mm，疑似题量或作答区分配不足。`);
    }
  }

  if (subject === "英语" && (kind === "小测" || kind === "练习")) {
    if (/文章选词填空|完形填空|短文语法填空|词形变化/.test(questionText)) {
      issues.push("英语小测/练习不得出现试卷式文章选词填空、完形填空或短文语法填空。");
    }

    if (kind === "小测") {
      const signals = hasEnglishQuizStructureSignals(text);
      if (!signals.translation || !signals.wordWriting || !signals.sentenceUse) {
        issues.push("英语小测缺少中英文互译、写单词、造句题型信号。");
      }
    }
  }

  return {
    name,
    ok: issues.length === 0,
    detail: {
      subject,
      kind,
      pages,
      targetPages,
      headerLabels,
      pageMetrics
    },
    issues
  };
}

function pythonExtractorSource() {
  return String.raw`
import json
import sys
from pathlib import Path

try:
    import fitz
except Exception as exc:
    raise SystemExit(f"PyMuPDF import failed: {exc}")

pdf_dir = Path(sys.argv[1])
if not pdf_dir.exists():
    raise SystemExit(f"PDF directory does not exist: {pdf_dir}")

student_marker = "\u9898\u76ee"
items = []
for pdf_path in sorted(pdf_dir.glob("*.pdf"), key=lambda item: item.name):
    if student_marker not in pdf_path.name:
        continue
    doc = fitz.open(str(pdf_path))
    texts = []
    page_metrics = []
    for page_number, page in enumerate(doc, 1):
        text = page.get_text("text") or ""
        texts.append(text)
        bottoms = []
        for block in page.get_text("blocks") or []:
            x0, y0, x1, y1, block_text, *_ = block
            if str(block_text or "").strip():
                bottoms.append(float(y1))
        text_bottom = max(bottoms) if bottoms else 0.0
        bottom_blank_mm = max(0.0, (float(page.rect.height) - text_bottom) * 25.4 / 72.0)
        page_metrics.append({
            "page": page_number,
            "bottomBlankMm": round(bottom_blank_mm, 1),
            "textBlockCount": len(bottoms),
            "drawingCount": len(page.get_drawings() or []),
            "text": text.strip()[:2000],
        })
    items.append({
        "name": pdf_path.name,
        "pages": doc.page_count,
        "text": "\n".join(texts),
        "pageMetrics": page_metrics,
    })

print(json.dumps(items, ensure_ascii=False))
`;
}

export function buildPythonExtractorEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };
}

function runPythonExtractor(pdfDir) {
  const commands = [
    { command: "py", args: ["-3.14", "-", pdfDir] },
    { command: "python", args: ["-", pdfDir] }
  ];
  const script = pythonExtractorSource();
  const errors = [];

  for (const candidate of commands) {
    const result = spawnSync(candidate.command, candidate.args, {
      input: script,
      encoding: "utf8",
      env: buildPythonExtractorEnv(),
      maxBuffer: 1024 * 1024 * 64
    });
    if (result.status === 0) {
      return JSON.parse(result.stdout || "[]");
    }
    errors.push(`${candidate.command} ${candidate.args.join(" ")}: ${(result.stderr || result.error?.message || "").trim()}`);
  }

  throw new Error(`无法读取 PDF 版式指标。${errors.join(" | ")}`);
}

function defaultPdfDir() {
  const desktopSampleDir = path.join(os.homedir(), "Desktop", "测试的试卷小测");
  if (fs.existsSync(desktopSampleDir)) return desktopSampleDir;
  return path.resolve("exports");
}

export function resolvePdfDir(argv = process.argv.slice(2), env = process.env) {
  const explicitArg = argv.find((arg) => !arg.startsWith("--"));
  return path.resolve(explicitArg || env.GENERATION_LAYOUT_PDF_DIR || defaultPdfDir());
}

export function buildGenerationLayoutReport(pdfDir) {
  const pdfs = runPythonExtractor(pdfDir);
  const checks = pdfs.map(evaluateGenerationLayoutPdf);
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    pdfDir,
    generatedAt: new Date().toISOString(),
    verification: {
      verificationScope: "generation-pdf-layout",
      assessesGenerationQuality: false,
      assessesPdfLayout: true,
      source: "rendered-pdf"
    },
    checks
  };
}

if (directRun(import.meta.url)) {
  try {
    const pdfDir = resolvePdfDir();
    const report = buildGenerationLayoutReport(pdfDir);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
