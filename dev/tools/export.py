"""Turn one run folder's report into the readable files for reviewers: report.xlsx and report.pdf.

    python dev/tools/export.py <run-folder> [--chrome PATH]

Reads only report.csv and report.md, which the report stage (space) or treport stage (terrestrial)
already wrote. Adds nothing to the results: the workbook holds the same rows as report.csv, and the
PDF is report.md printed. Needs openpyxl and markdown; the PDF needs a Chrome or Edge browser.
"""
import argparse, csv, shutil, subprocess, sys, tempfile
from pathlib import Path

CHROMES = [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
           r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "google-chrome", "chromium", "chromium-browser"]

CSS = """body{font:10.5pt/1.45 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1b22;margin:0}
h1{font-size:17pt;margin:0 0 6pt}h2{font-size:13pt;margin:16pt 0 6pt;border-bottom:1px solid #ddd;padding-bottom:3pt}
table{border-collapse:collapse;margin:6pt 0 10pt}td,th{border:1px solid #ccc;padding:3pt 7pt;text-align:left}
th{background:#efeaf7}li{margin:0 0 7pt}strong{color:#3b2a63}@page{size:A4;margin:16mm 14mm}"""


def number(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in v else f
    except ValueError:
        return v


def xlsx(folder, out):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
    rows = list(csv.reader(open(folder / "report.csv", encoding="utf-8", newline="")))
    head, body = rows[0], rows[1:]
    lvl = head.index("Level")
    order = {"crit": 0, "warn": 1}
    wb = Workbook()
    for title, data in (("Needs attention", sorted((r for r in body if r[lvl] in order), key=lambda r: order[r[lvl]])),
                        ("All rows", body)):
        ws = wb.active if title == "Needs attention" else wb.create_sheet(title)
        ws.title = title
        ws.append(head)
        for r in data:
            ws.append([number(v) if v else None for v in r])
        for c in ws[1]:
            c.font = Font(bold=True)
            c.fill = PatternFill("solid", fgColor="EFEAF7")
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions
        for i, h in enumerate(head, 1):
            width = max([len(h)] + [len(r[i - 1]) for r in data[:300]])
            ws.column_dimensions[get_column_letter(i)].width = min(max(width, 8), 48) + 2
    wb.save(out)
    return len(body)


def pdf(folder, out, chrome):
    import markdown
    md = (folder / "report.md").read_text(encoding="utf-8")
    html = f"<!doctype html><meta charset=utf-8><style>{CSS}</style>" + markdown.markdown(md, extensions=["tables"])
    exe = chrome or next((c for c in CHROMES if Path(c).exists() or shutil.which(c)), None)
    if not exe:
        sys.exit("No Chrome or Edge found for the PDF; pass --chrome PATH")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "report.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--user-data-dir={tmp}/profile", f"--print-to-pdf={out}", page.as_uri()],
                       check=True, capture_output=True, timeout=120)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("folder"); a.add_argument("--chrome")
    x = a.parse_args()
    folder = Path(x.folder).resolve()
    n = xlsx(folder, folder / "report.xlsx")
    pdf(folder, folder / "report.pdf", x.chrome)
    print(f"{folder.name}: report.xlsx ({n} rows), report.pdf")


if __name__ == "__main__":
    main()
