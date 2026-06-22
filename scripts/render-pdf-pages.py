from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser(description="Render selected PDF pages to PNG for layout QA.")
    parser.add_argument("pdf", help="PDF path")
    parser.add_argument("out_dir", help="Output directory")
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--zoom", type=float, default=1.4)
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    matrix = fitz.Matrix(args.zoom, args.zoom)
    for index in range(min(args.max_pages, doc.page_count)):
        page = doc.load_page(index)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        target = out_dir / f"{pdf_path.stem}-p{index + 1}.png"
        pix.save(target)
        print(target)


if __name__ == "__main__":
    main()
