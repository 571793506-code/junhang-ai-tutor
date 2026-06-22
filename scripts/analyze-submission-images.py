import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def analyze_image(path_text, index):
    path = Path(path_text)
    result = {
        "index": index,
        "path": str(path),
        "fileName": path.name,
        "exists": path.exists(),
        "qualityStatus": "needs_review",
        "score": 0,
        "issues": [],
        "warnings": [],
        "metrics": {}
    }
    if not path.exists():
        result["issues"].append("图片文件不存在。")
        return result

    file_size = path.stat().st_size
    result["metrics"]["fileSize"] = file_size
    if file_size < 50 * 1024:
        result["warnings"].append("图片文件较小，可能被压缩过度。")

    try:
        with Image.open(path) as image:
            image = image.convert("RGB")
            width, height = image.size
            megapixels = width * height / 1_000_000
            result["metrics"].update({
                "width": width,
                "height": height,
                "megapixels": round(megapixels, 3)
            })

            gray = image.convert("L")
            max_side = max(gray.size)
            if max_side > 1000:
                scale = 1000 / max_side
                gray = gray.resize((max(1, int(gray.width * scale)), max(1, int(gray.height * scale))))

            stat = ImageStat.Stat(gray)
            brightness = stat.mean[0]
            contrast = stat.stddev[0]
            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_stat = ImageStat.Stat(edges)
            sharpness = edge_stat.stddev[0]
            result["metrics"].update({
                "brightness": round(brightness, 2),
                "contrast": round(contrast, 2),
                "sharpness": round(sharpness, 2)
            })

            penalties = 0.0
            if min(width, height) < 900 or megapixels < 1:
                penalties += 0.28
                result["issues"].append("图片分辨率偏低，可能影响题干和手写内容识别。")
            if brightness < 55:
                penalties += 0.2
                result["issues"].append("图片偏暗，建议重新拍摄或补光。")
            elif brightness > 230:
                penalties += 0.16
                result["warnings"].append("图片偏亮，部分笔迹可能变浅。")
            if contrast < 22:
                penalties += 0.2
                result["issues"].append("图片对比度偏低，字迹和纸张区分不明显。")
            if sharpness < 8:
                penalties += 0.28
                result["issues"].append("图片清晰度偏低，可能存在虚焦或抖动。")
            elif sharpness < 13:
                penalties += 0.12
                result["warnings"].append("图片清晰度一般，建议教师重点复核。")
            if file_size < 50 * 1024:
                penalties += 0.08

            score = clamp(1 - penalties)
            result["score"] = round(score, 3)
            if result["issues"] or score < 0.65:
                result["qualityStatus"] = "needs_review" if score >= 0.35 else "poor"
            else:
                result["qualityStatus"] = "ready"
    except Exception as exc:
        result["qualityStatus"] = "poor"
        result["issues"].append(f"图片无法读取：{exc}")

    return result


def main():
    paths = sys.argv[1:]
    pages = [analyze_image(path, index + 1) for index, path in enumerate(paths)]
    scores = [page["score"] for page in pages if page.get("exists")]
    lowest = min(scores) if scores else 0
    has_poor = any(page["qualityStatus"] == "poor" for page in pages)
    has_review = any(page["qualityStatus"] == "needs_review" for page in pages)
    status = "poor" if has_poor else "needs_review" if has_review else "ready"
    print(json.dumps({
        "available": True,
        "status": status,
        "score": round(lowest, 3),
        "pageCount": len(pages),
        "pages": pages,
        "issues": [issue for page in pages for issue in page.get("issues", [])],
        "warnings": [warning for page in pages for warning in page.get("warnings", [])]
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
