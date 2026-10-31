"""Draw the civic tier's 40 buildings on one sheet (scripts/checks/civic_gen.mts writes their designs as JSON).
Usage: python scripts/checks/civic_render.py DESIGN_DIR [--out PNG]
Each design is drawn by scripts/render_design.py (from the south-east and the north-west), shrunk to a cell of the
sheet, five to a row, with its name; the sheet goes to DESIGN_DIR/civic_sheet.png unless --out says otherwise.
"""
import argparse, glob, os, subprocess, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap = argparse.ArgumentParser()
ap.add_argument('dir')
ap.add_argument('--out')
ap.add_argument('--cols', type=int, default=5)
a = ap.parse_args()
files = sorted(glob.glob(os.path.join(a.dir, '*.json')))
pngs = []
for f in files:
    png = f[:-5] + '.png'
    subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'render_design.py'), f, '--out', png, '--scale', '5'], check=True, capture_output=True)
    pngs.append(png)
CW, CH = 520, 300
rows = (len(pngs) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (CW * a.cols, CH * rows), 'white')
for i, p in enumerate(pngs):
    im = Image.open(p).convert('RGB')
    im.thumbnail((CW - 8, CH - 8))
    x, y = (i % a.cols) * CW + 4, (i // a.cols) * CH + 4
    sheet.paste(im, (x, y))
out = a.out or os.path.join(a.dir, 'civic_sheet.png')
sheet.save(out)
print(f'{out}: {len(pngs)} buildings')
