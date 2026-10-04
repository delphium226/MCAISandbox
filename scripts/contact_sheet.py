"""A contact sheet of designs: one isometric view each (render_design.py's, from the south-east), tiled with a caption
(name, size, gather units, passed or why not), one PNG per group (phase D, vanilla villages: V2.1's pieces by biome).
Usage: python scripts/contact_sheet.py DIR [--scale N] [--cols N]
DIR holds index.json, a list of {"file": design JSON in DIR, "group": "plains", "caption": ["line", ...], "ok": bool},
as scripts/checks/vanilla_pieces.mts writes it with OUT=DIR; the sheets are written as DIR/sheet_<group>.png.
Renders of vanilla pieces stay private (never committed or shared).
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_design as rd  # noqa: E402


def render(path, scale):
    args = argparse.Namespace(source=path, village=None, design=None, out=None, scale=scale)
    grid, W, D, H, _ = rd.load(args)
    return rd.view(rd.boxes(grid), W, D, scale, False), (W, D, H)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('dir'); ap.add_argument('--scale', type=int, default=7); ap.add_argument('--cols', type=int, default=6)
    a = ap.parse_args()
    index = json.load(open(os.path.join(a.dir, 'index.json'), encoding='utf-8'))
    groups = {}
    for e in index: groups.setdefault(e['group'], []).append(e)
    f1, f2 = rd.font(14, True), rd.font(12)
    for group, entries in groups.items():
        tiles = []
        for e in entries:
            img, size = render(os.path.join(a.dir, e['file']), a.scale)
            tiles.append((img, e))
        cw = max(max(t.width for t, _ in tiles), 230) + 16
        lines = max(len(e['caption']) for _, e in tiles) + 1
        ch = max(t.height for t, _ in tiles) + 18 * lines + 16
        rows = (len(tiles) + a.cols - 1) // a.cols
        passed = sum(1 for _, e in tiles if e['ok'])
        sheet = Image.new('RGB', (cw * min(a.cols, len(tiles)), 40 + ch * rows), 'white')
        dr = ImageDraw.Draw(sheet)
        dr.text((10, 10), f'{group}: {len(tiles)} pieces, {passed} pass', fill=(20, 20, 20), font=rd.font(18, True))
        for k, (img, e) in enumerate(tiles):
            x, y = (k % a.cols) * cw, 40 + (k // a.cols) * ch
            dr.rectangle([x + 2, y + 2, x + cw - 3, y + ch - 3], outline=(60, 150, 60) if e['ok'] else (200, 90, 90), width=2)
            sheet.paste(img, (x + (cw - img.width) // 2, y + 8))
            ty = y + 8 + img.height + 4
            dr.text((x + 8, ty), e['name'], fill=(20, 20, 20), font=f1)
            for i, line in enumerate(e['caption']):
                dr.text((x + 8, ty + 18 * (i + 1)), line[:40], fill=(60, 60, 60), font=f2)
        out = os.path.join(a.dir, f'sheet_{group}.png')
        sheet.save(out)
        print(f'{out}: {sheet.width}x{sheet.height}, {len(tiles)} pieces, {passed} pass')


if __name__ == '__main__':
    main()
