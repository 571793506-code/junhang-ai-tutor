import json
import os
import re
import sys

try:
    import fitz
except Exception:
    fitz = None

try:
    from pypdf import PdfReader
except Exception:
    PdfReader = None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


QUESTION_RE = re.compile(r"(?m)(?:^|\s)(\d{1,3})\.\s")


def extract_pdf(path):
    if fitz is not None:
        doc = fitz.open(path)
        return {
            "pages": doc.page_count,
            "text": "\n".join(page.get_text("text") or "" for page in doc),
        }
    if PdfReader is not None:
        reader = PdfReader(path)
        return {
            "pages": len(reader.pages),
            "text": "\n".join((page.extract_text() or "") for page in reader.pages),
        }
    raise RuntimeError("缺少 PDF 读取依赖，请使用 Codex bundled Python 或安装 PyMuPDF/pypdf。")


def normalize_prompt_line(line):
    line = re.sub(r"\s+", " ", line.strip())
    line = re.sub(r"^\d{1,3}\.\s*", "", line)
    line = re.sub(r"（\d+(?:\.\d+)?分）", "", line)
    line = re.sub(r"\d+(?:\.\d+)?", "#", line)
    return line[:80]


def question_numbers(text):
    numbers = [int(match.group(1)) for match in QUESTION_RE.finditer(text)]
    result = []
    for number in numbers:
        if not result or result[-1] != number:
            result.append(number)
    return result


def repeated_prompt_signals(text):
    lines = [
        normalize_prompt_line(line)
        for line in text.splitlines()
        if re.match(r"\s*\d{1,3}\.\s", line) and len(normalize_prompt_line(line)) >= 12
    ]
    counts = {}
    for line in lines:
        counts[line] = counts.get(line, 0) + 1
    return [line for line, count in counts.items() if count > 1][:8]


def english_word_count(text):
    return len(re.findall(r"\b[A-Za-z]+\b", text))


def chinese_char_count(text):
    return len(re.findall(r"[\u4e00-\u9fa5]", text))


def reading_quality_signals(text, basename, is_analysis):
    if is_analysis:
        return []
    signals = []
    if "英语" in basename:
        passage_count = text.count("Passage")
        word_count = english_word_count(text)
        is_exam = "试卷" in basename
        is_quiz = "小测" in basename
        is_practice = "练习" in basename
        if "试卷" in basename and passage_count < 2:
            signals.append("英语试卷阅读材料少于两篇。")
        if is_exam and word_count < 760:
            signals.append(f"英语试卷全文英文词量偏低：{word_count}。")
        if is_quiz and word_count < 180:
            signals.append(f"英语小测英文词量偏低：{word_count}。")
        if is_practice and word_count < 220:
            signals.append(f"英语练习英文词量偏低：{word_count}。")
        has_exam_vocab = any(key in text for key in ["文章选词填空", "完形填空", "词形变化", "短文语法填空"])
        if is_exam and "文章选词填空" not in text:
            signals.append("英语卷缺少文章选词填空信号。")
        if is_exam and not any(key in text for key in ["完形填空", "词形变化", "短文语法填空"]):
            signals.append("英语卷缺少完形填空或词形变化填空信号。")
        if (is_quiz or is_practice) and has_exam_vocab:
            signals.append("英语小测/练习不应出现试卷式文章选词填空、完形填空或短文语法填空。")
        if is_quiz:
            checks = [
                ("中英文互译", any(key in text for key in ["中英文互译", "中文译英文", "英文译中文"])),
                ("写单词", any(key in text for key in ["写单词", "根据中文写单词"])),
                ("造句", "造句" in text)
            ]
            missing = [label for label, ok in checks if not ok]
            if missing:
                signals.append(f"英语小测缺少单元小测题型信号：{missing}。")
    if "语文" in basename:
        char_count = chinese_char_count(text)
        if "试卷" in basename and char_count < 1500:
            signals.append(f"语文试卷全文中文量偏低：{char_count}。")
        if ("小测" in basename or "练习" in basename) and char_count < 1100:
            signals.append(f"语文小测/练习全文中文量偏低：{char_count}。")
        if "阅读（一）" not in text:
            signals.append("语文卷缺少现代文阅读材料标题。")
    return signals


def inspect_pdf(path):
    extracted = extract_pdf(path)
    text = extracted["text"]
    numbers = question_numbers(text)
    expected = list(range(1, max(numbers) + 1)) if numbers else []
    missing = [number for number in expected if number not in numbers]
    basename = os.path.basename(path)
    is_analysis = "解析" in basename or "analysis" in basename.lower()
    is_quiz_or_practice = "小测" in basename or "练习" in basename
    has_writing = "写作题" in text or "习作" in text or "Writing" in text or "书面表达" in text
    material_lines = [
        line.strip()
        for line in text.splitlines()
        if "Passage" in line or "阅读（一）" in line or "阅读（二）" in line or "完形填空" in line
    ]
    forbidden = [
        label
        for label in ["用时", "附加题", "备用作文", "方框词", "GPT", "DeepSeek", "MiniMax"]
        if label in text
    ]
    repeated = [] if is_analysis else repeated_prompt_signals(text)
    issue_signals = []
    if numbers and missing:
        issue_signals.append(f"题号不连续，缺少：{missing[:12]}")
    if is_quiz_or_practice and "语文" in basename and has_writing:
        issue_signals.append("语文小测/练习疑似出现作文或写作题。")
    if is_quiz_or_practice and not is_analysis and extracted["pages"] % 2 != 0:
        issue_signals.append(f"小测/练习题目 PDF 页数不是偶数：{extracted['pages']}。")
    if is_analysis and not any(key in text for key in ["步骤", "先", "再", "因此", "易错", "解析"]):
        issue_signals.append("解析 PDF 缺少步骤信号。")
    issue_signals.extend(reading_quality_signals(text, basename, is_analysis))
    if repeated:
        issue_signals.append(f"疑似重复题干：{repeated[:3]}")
    if forbidden:
        issue_signals.append(f"出现禁用文案：{forbidden}")
    return {
        "name": basename,
        "pages": extracted["pages"],
        "questionCount": len(numbers),
        "firstQuestionNo": numbers[0] if numbers else None,
        "lastQuestionNo": numbers[-1] if numbers else None,
        "missingQuestionNos": missing[:20],
        "forbiddenText": forbidden,
        "hasMathSectionText": "计算题" in text or "四、解答题" in text,
        "hasWritingText": has_writing,
        "hasTianzigeSignal": "田字格" in text or "看拼音" in text,
        "hasAnswerAnalysisSignal": any(key in text for key in ["步骤", "先", "再", "因此", "易错", "解析"]),
        "englishWordCount": english_word_count(text),
        "chineseCharCount": chinese_char_count(text),
        "materialLines": material_lines[:12],
        "repeatedPromptSignals": repeated,
        "issueSignals": issue_signals,
        "sample": text[:360],
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: inspect-generated-pdfs.py <base-dir> <pdf-name> [<pdf-name>...]")
    base_dir = sys.argv[1]
    result = [inspect_pdf(os.path.join(base_dir, name)) for name in sys.argv[2:]]
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
