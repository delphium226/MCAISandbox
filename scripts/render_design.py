"""Draw a building design (or a box of world blocks) as an isometric PNG, offline (phase D, D.8's renderer).
Usage: python scripts/render_design.py SOURCE [--village V] [--design NAME] [--out PNG] [--scale N]
SOURCE is one of:
  - a villages.json (mc/server/villages.json or mc/testserver/villages.json): --design NAME from the design library,
    --village V to choose among villages that hold it (without --design the village's designs are listed);
  - a JSON file holding one design ({name, palette, layers, width, depth, height}; layers bottom-up, rows north to
    south, symbols west to east, '.' air, '_' left as is and not drawn);
  - a JSON file saved from the agent server's GET /api/blocks (with states=1 for stairs, slabs and logs to show).
Draws two views side by side, from the south-east and from the north-west (a compass under each), on the design's
footprint grid, with the name and size (width x depth x height) on top. Flat colours per block (a table of common
blocks, dye colours, wood kinds; other names get a colour hashed from the name), top faces light, left mid, right dark,
painted back to front. Shapes: full cubes, slabs, stairs (straight, inner and outer corners as quarter blocks, top or
bottom half), fences, walls and panes as posts with arms to their neighbours, thin doors (two high in designs),
trapdoors (open or closed), gates, carpets, lanterns, torches, plants and chests; log ends in their wood's plank colour.
Glass, water and ice are translucent. Everything else is a full cube. Default scale 16 px per half block.
"""
import argparse, hashlib, json, os, re, sys
from PIL import Image, ImageDraw, ImageFont

WOODS = ['dark_oak', 'pale_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped']
PLANK = dict(zip(WOODS, [(67, 43, 20), (227, 217, 215), (162, 131, 79), (115, 85, 49), (192, 175, 121), (160, 115, 81),
                         (168, 90, 50), (118, 54, 49), (227, 179, 173), (194, 173, 80), (101, 49, 71), (43, 105, 99)]))
BARK = dict(zip(WOODS, [(60, 47, 26), (88, 77, 73), (109, 85, 51), (59, 38, 17), (217, 215, 210), (85, 68, 25),
                        (103, 97, 87), (84, 67, 41), (55, 33, 44), (120, 140, 40), (93, 26, 30), (58, 58, 77)]))
DYES = {'light_blue': (58, 175, 217), 'light_gray': (142, 142, 135), 'white': (234, 236, 237), 'orange': (241, 118, 20),
        'magenta': (190, 69, 180), 'yellow': (249, 198, 40), 'lime': (112, 185, 26), 'pink': (238, 141, 172),
        'gray': (63, 68, 72), 'cyan': (21, 138, 145), 'purple': (122, 42, 173), 'blue': (53, 57, 157),
        'brown': (114, 72, 41), 'green': (85, 110, 28), 'red': (161, 39, 35), 'black': (21, 21, 26)}
BLOCKS = {'cobblestone': (128, 127, 128), 'mossy_cobblestone': (110, 118, 95), 'stone': (126, 126, 126),
          'stone_bricks': (122, 122, 122), 'mossy_stone_bricks': (115, 121, 105), 'cracked_stone_bricks': (118, 117, 118),
          'smooth_stone': (159, 159, 159), 'bricks': (151, 98, 83), 'sandstone': (216, 203, 155),
          'smooth_sandstone': (224, 214, 170), 'cut_sandstone': (218, 206, 160), 'red_sandstone': (181, 98, 31),
          'terracotta': (152, 94, 68), 'dirt': (134, 96, 67), 'coarse_dirt': (119, 85, 59), 'dirt_path': (148, 122, 65),
          'grass_block': (124, 168, 70), 'gravel': (132, 127, 127), 'sand': (219, 207, 163), 'red_sand': (191, 103, 33),
          'glass': (200, 228, 240, 105), 'water': (63, 118, 228, 150), 'ice': (146, 184, 254, 180),
          'glowstone': (172, 131, 84), 'lantern': (90, 80, 70), 'torch': (255, 200, 90), 'bookshelf': (117, 94, 59),
          'crafting_table': (120, 73, 42), 'furnace': (110, 109, 109), 'chest': (162, 117, 47), 'barrel': (135, 101, 58),
          'deepslate': (80, 80, 83), 'cobbled_deepslate': (77, 77, 81), 'andesite': (136, 136, 137),
          'diorite': (189, 188, 189), 'granite': (149, 103, 86), 'calcite': (223, 224, 221), 'tuff': (108, 109, 102),
          'mud_bricks': (137, 104, 79), 'packed_mud': (142, 107, 80), 'clay': (160, 166, 179), 'snow_block': (249, 254, 254),
          'quartz_block': (236, 230, 223), 'hay_block': (166, 139, 12), 'iron_block': (220, 220, 220), 'iron_door': (194, 193, 193),
          'obsidian': (15, 10, 24), 'nether_bricks': (44, 21, 26), 'blackstone': (42, 36, 41), 'bedrock': (85, 85, 85)}
SUFFIXES = ('_stairs', '_slab', '_fence_gate', '_fence', '_wall', '_trapdoor', '_door', '_pressure_plate', '_button', '_pane', '_carpet')
PLANT = re.compile(r'(grass$|fern$|flower|sapling|bush$|poppy|dandelion|orchid|allium|tulip|daisy|cornflower|lily_of|rose|'
                   r'peony|lilac|kelp|seagrass|vine|mushroom$|leaf_litter|wheat|carrots|potatoes|sugar_cane|dripleaf)')
AIR = {'air', 'cave_air', 'void_air'}
DIRS = {'n': (0, 0, -1), 's': (0, 0, 1), 'e': (1, 0, 0), 'w': (-1, 0, 0), 'u': (0, 1, 0)}
LEFT = {'north': 'west', 'west': 'south', 'south': 'east', 'east': 'north'}
RIGHT = {v: k for k, v in LEFT.items()}


def parse(name):
    m = re.match(r'([^\[]+)(?:\[(.*)\])?$', name.strip().replace('minecraft:', ''))
    return m.group(1), dict(p.split('=', 1) for p in (m.group(2) or '').split(',') if '=' in p)


def colour(base):
    if base in BLOCKS: return BLOCKS[base]
    if base.endswith('_leaves'): return (70, 125, 45)
    wood = next((w for w in WOODS if base.startswith((w + '_', 'stripped_' + w + '_'))), None)
    if wood: return BARK[wood] if re.search(r'_(log|wood|stem|hyphae)$', base) and not base.startswith('stripped_') else PLANK[wood]
    dye = next((d for d in DYES if base.startswith(d + '_')), None)
    if dye:
        c = DYES[dye]
        if 'glass' in base: return c + (120,)
        return tuple((a + b) // 2 for a, b in zip(c, BLOCKS['terracotta'])) if 'terracotta' in base else c
    for suf in SUFFIXES:
        if base.endswith(suf):
            words = base[:-len(suf)].split('_')
            for i in range(len(words), 0, -1):
                m = '_'.join(words[:i])
                for cand in (m, m + 's', m + '_block'):
                    if cand in BLOCKS: return BLOCKS[cand]
    if 'glass' in base: return BLOCKS['glass']
    if PLANT.search(base): return (96, 150, 60)
    h = hashlib.md5(base.encode()).digest()
    return (60 + h[0] % 150, 60 + h[1] % 150, 60 + h[2] % 150)


def kind(base, props):
    if base.endswith('_stairs'): return 'stairs'
    if base.endswith('_slab'): return 'full' if props.get('type') == 'double' else 'slab'
    for k, sufs in (('gate', ('_fence_gate',)), ('fence', ('_fence',)), ('wall', ('_wall',)), ('pane', ('_pane', 'iron_bars')),
                    ('trapdoor', ('_trapdoor',)), ('door', ('_door',)), ('flat', ('_carpet', '_pressure_plate'))):
        if base.endswith(sufs): return k
    if 'lantern' in base: return 'lantern'
    if 'torch' in base: return 'torch'
    if base in ('chest', 'trapped_chest', 'ender_chest'): return 'chest'
    return 'plant' if PLANT.search(base) else 'full'


def faces(base, props):
    c = colour(base)
    c = c if len(c) == 4 else c + (255,)
    f = {d: c for d in DIRS}
    if base == 'grass_block': f.update(n=BLOCKS['dirt'] + (255,), s=BLOCKS['dirt'] + (255,), e=BLOCKS['dirt'] + (255,), w=BLOCKS['dirt'] + (255,))
    wood = next((w for w in WOODS if w in base), None)
    if wood and re.search(r'_(log|stem)$', base):  # end grain on the axis faces
        for d in {'y': 'u', 'x': 'ew', 'z': 'ns'}[props.get('axis', 'y')]: f[d] = PLANK[wood] + (255,)
    return f


def shapes(base, props, k, nb):
    """The block's boxes (x0, y0, z0, x1, y1, z1) inside its cell; nb(d) is the neighbour's (base, props) or None."""
    def joins(d, kinds):
        n = nb(d)
        return n is not None and (kind(*n) in kinds or (kind(*n) == 'full' and len(colour(n[0])) == 3))
    if k == 'slab': return [(0, .5, 0, 1, 1, 1)] if props.get('type') == 'top' else [(0, 0, 0, 1, .5, 1)]
    if k == 'stairs':
        top = props.get('half') == 'top'
        f, shape = props.get('facing', 'north'), props.get('shape', 'straight')
        side = {'north': lambda q: q[1] == 0, 'south': lambda q: q[1] == 1, 'east': lambda q: q[0] == 1, 'west': lambda q: q[0] == 0}
        quads = {(a, b) for a in (0, 1) for b in (0, 1)}
        x_side = (LEFT if shape.endswith('left') else RIGHT)[f]
        if shape.startswith('outer'): q = {p for p in quads if side[f](p) and side[x_side](p)}
        elif shape.startswith('inner'): q = {p for p in quads if side[f](p) or side[x_side](p)}
        else: q = {p for p in quads if side[f](p)}
        ya, yb = (0, .5) if top else (.5, 1)
        out = [(0, .5, 0, 1, 1, 1) if top else (0, 0, 0, 1, .5, 1)]
        for d in ('north', 'south', 'east', 'west'):  # merge two quarters on one side into a half
            pair = {p for p in quads if side[d](p)}
            if pair <= q:
                q -= pair
                x0, z0 = (.5 if d == 'east' else 0), (.5 if d == 'south' else 0)
                x1, z1 = (.5 if d == 'west' else 1), (.5 if d == 'north' else 1)
                out.append((x0, ya, z0, x1, yb, z1))
        return out + [(a * .5, ya, b * .5, a * .5 + .5, yb, b * .5 + .5) for a, b in q]
    if k in ('fence', 'wall', 'pane'):
        p, a, ys = {'fence': (.375, .4375, [(.375, .5625), (.75, .9375)]), 'wall': (.25, .3125, [(0, .875)]),
                    'pane': (.4375, .4375, [(0, 1)])}[k]
        out = [(p, 0, p, 1 - p, 1, 1 - p)]
        for d in ('n', 's', 'e', 'w'):
            if not joins(d, {'fence', 'gate'} if k == 'fence' else {k}): continue
            x0, x1 = {'e': (1 - p, 1), 'w': (0, p)}.get(d, (a, 1 - a))
            z0, z1 = {'s': (1 - p, 1), 'n': (0, p)}.get(d, (a, 1 - a))
            out += [(x0, y0, z0, x1, y1, z1) for y0, y1 in ys]
        return out
    if k in ('door', 'trapdoor', 'gate'):
        t, f = (.0625 if k == 'gate' else .1875), props.get('facing')
        if k == 'trapdoor' and props.get('open') != 'true':
            return [(0, 1 - t, 0, 1, 1, 1)] if props.get('half') == 'top' else [(0, 0, 0, 1, t, 1)]
        if f is None:  # a design's door: in the wall its neighbours make
            along_x = joins('e', {'full'}) or joins('w', {'full'}) or not (joins('n', {'full'}) or joins('s', {'full'}))
            return [(0, 0, .5 - t / 2, 1, 1, .5 + t / 2)] if along_x else [(.5 - t / 2, 0, 0, .5 + t / 2, 1, 1)]
        if k == 'gate':
            return [(0, .3125, .4375, 1, .9375, .5625)] if f in ('north', 'south') else [(.4375, .3125, 0, .5625, .9375, 1)]
        return [{'north': (0, 0, 1 - t, 1, 1, 1), 'south': (0, 0, 0, 1, 1, t), 'east': (0, 0, 0, t, 1, 1), 'west': (1 - t, 0, 0, 1, 1, 1)}[f]]
    return [{'flat': (0, 0, 0, 1, .0625, 1), 'lantern': (.3125, 0, .3125, .6875, .5, .6875),
             'torch': (.4375, 0, .4375, .5625, .625, .5625), 'chest': (.0625, 0, .0625, .9375, .875, .9375),
             'plant': (.25, 0, .25, .75, .7, .75)}.get(k, (0, 0, 0, 1, 1, 1))]


def load(args):
    data = json.load(open(args.source, encoding='utf-8'))
    grid, label = {}, ''
    if isinstance(data, dict) and 'villages' in data:
        found = [v for v in data['villages'] if args.design in v.get('designs', {}) and args.village in (None, v['name'])]
        if not args.design or not found:
            for v in data['villages']:
                if args.village in (None, v['name']) and v.get('designs'):
                    print(v['name'] + ': ' + ', '.join(f"{n} {d['width']}x{d['depth']}x{d['height']}" for n, d in v['designs'].items()))
            sys.exit(f'design {args.design!r} not found' if args.design else 'name a design with --design')
        if len(found) > 1: print(f"{args.design} is in {len(found)} villages; drawing {found[-1]['name']}'s (choose with --village)")
        data, label = found[-1]['designs'][args.design], found[-1]['name'] + ': '
    if 'cells' in data:  # GET /api/blocks: names by index, x fastest, then z, then y; -1 unloaded
        W, H, D = (data[a + '2'] - data[a + '1'] + 1 for a in 'xyz')
        for i, n in enumerate(data['cells']):
            if n >= 0 and parse(data['names'][n])[0] not in AIR:
                grid[(i % W, i // (W * D), i // W % D)] = parse(data['names'][n])
        return grid, W, D, H, f"blocks {data['x1']},{data['y1']},{data['z1']} to {data['x2']},{data['y2']},{data['z2']}"
    pal, layers = data['palette'], data['layers']
    W, D = data.get('width', 0), data.get('depth', 0)
    for y, layer in enumerate(layers):
        for z, row in enumerate(layer):
            row = row.replace(' ', '') if len(row) != W else row
            for x, ch in enumerate(row):
                if ch in '._': continue
                if ch not in pal: print(f'unknown symbol {ch!r} at layer {y}, row {z}, column {x}'); continue
                if parse(pal[ch])[0] not in AIR: grid[(x, y, z)] = parse(pal[ch])
    for (x, y, z), (b, p) in list(grid.items()):  # a design's door is one symbol; the builder sets both halves
        if kind(b, p) == 'door' and p.get('half') != 'upper' and (x, y + 1, z) not in grid:
            grid[(x, y + 1, z)] = (b, {**p, 'half': 'upper'})
    sizes = [max([len(l) for l in layers] + [0]), max([len(r.replace(' ', '')) for l in layers for r in l] + [0])]
    if (W, D) != (sizes[1], sizes[0]) or data.get('height', len(layers)) != len(layers):
        print(f"declared size {W}x{D}x{data.get('height')} but the layers are {sizes[1]}x{sizes[0]}x{len(layers)}")
    W, D = max(W, sizes[1]), max(D, sizes[0])
    return grid, W, D, len(layers), f"{label}{data.get('name', '?')}"


def boxes(grid):
    """Every box in world cells: (cell, (x0, y0, z0, x1, y1, z1), faces by direction or None where hidden)."""
    def opaque(c):
        n = grid.get(c)
        return n is not None and kind(*n) == 'full' and len(colour(n[0])) == 3
    out = []
    for (x, y, z), (b, p) in grid.items():
        k, f = kind(b, p), faces(b, p)
        nb = lambda d: grid.get((x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2]))
        for bx in shapes(b, p, k, nb):
            ff = dict(f)
            if k == 'full':  # hide faces against opaque cubes (and glass against the same glass)
                for d, (dx, dy, dz) in DIRS.items():
                    c = (x + dx, y + dy, z + dz)
                    if opaque(c) or (f['u'][3] < 255 and grid.get(c, (None,))[0] == b): ff[d] = None
            out.append(((x, y, z), (x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]), ff))
    return out


def shade(c, k): return tuple(int(v * k) for v in c[:3]) + (c[3],)


def view(items, W, D, s, nw):
    """One isometric view: from the south-east (top, south and east faces) or the north-west (turned 180 degrees)."""
    P = lambda x, y, z: ((x - z) * s, (x + z) * s / 2 - y * s)
    polys = []
    for i in range(W + 1): polys.append(('line', [P(i, 0, 0), P(i, 0, D)]))
    for j in range(D + 1): polys.append(('line', [P(0, 0, j), P(W, 0, j)]))
    order = []
    for (cx, cy, cz), (x0, y0, z0, x1, y1, z1), f in items:
        if nw: cx, cz, x0, x1, z0, z1 = W - 1 - cx, D - 1 - cz, W - x1, W - x0, D - z1, D - z0
        order.append(((cx + cy + cz, x0 + x1 + y0 + y1 + z0 + z1), (x0, y0, z0, x1, y1, z1), f))
    for _, (x0, y0, z0, x1, y1, z1), f in sorted(order, key=lambda o: o[0]):
        for d, k, pts in (('u', 1.0, [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]),
                          ('n' if nw else 's', .8, [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
                          ('w' if nw else 'e', .62, [(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)])):
            if f[d] is not None: polys.append((shade(f[d], k), [P(*p) for p in pts]))
    xs = [p[0] for _, pts in polys for p in pts]; ys = [p[1] for _, pts in polys for p in pts]
    img = Image.new('RGBA', (int(max(xs) - min(xs)) + 21, int(max(ys) - min(ys)) + 21), (255, 255, 255, 255))
    dr, ox, oy = ImageDraw.Draw(img, 'RGBA'), 10 - min(xs), 10 - min(ys)
    for fill, pts in polys:
        pts = [(x + ox, y + oy) for x, y in pts]
        if fill == 'line': dr.line(pts, fill=(205, 205, 205), width=1)
        else: dr.polygon(pts, fill=fill, outline=shade(fill, .7)[:3] + (max(fill[3], 140),))
    return img


def font(size, bold=False):
    try: return ImageFont.truetype('arialbd.ttf' if bold else 'arial.ttf', size)
    except OSError: return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('source'); ap.add_argument('--village'); ap.add_argument('--design')
    ap.add_argument('--out'); ap.add_argument('--scale', type=int, default=16)
    args = ap.parse_args()
    grid, W, D, H, title = load(args)
    items = boxes(grid)
    views = [view(items, W, D, args.scale, nw) for nw in (False, True)]
    pad, head, foot = 16, 36, 60
    f1, f2 = font(18, True), font(13)
    text = f'{title}   {W} x {D} x {H} (width x depth x height), {len(grid)} blocks'
    width = max(sum(v.width for v in views) + pad * 3, int(ImageDraw.Draw(views[0]).textlength(text, font=f1)) + pad * 2)
    img = Image.new('RGB', (width, head + max(v.height for v in views) + foot), 'white')
    dr = ImageDraw.Draw(img)
    dr.text((pad, 9), text, fill=(20, 20, 20), font=f1)
    x = pad
    for v, nw in zip(views, (False, True)):
        img.paste(v, (x, head))
        cx, cy = x + 34, head + v.height + foot // 2
        for lab, (dx, dy) in (('N', (.894, -.447)), ('E', (.894, .447))):  # map directions as the view draws them
            dx, dy = (-dx, -dy) if nw else (dx, dy)
            tx, ty, col = cx + dx * 20, cy + dy * 20, (180, 30, 30) if lab == 'N' else (60, 60, 60)
            dr.line([(cx, cy), (tx, ty)], fill=col, width=2)
            dr.polygon([(tx + dx * 6, ty + dy * 6), (tx - dy * 4, ty + dx * 4), (tx + dy * 4, ty - dx * 4)], fill=col)
            dr.text((cx + dx * 33 - 4, cy + dy * 33 - 7), lab, fill=col, font=f2)
        dr.text((x + 80, cy - 8), 'from the north-west' if nw else 'from the south-east', fill=(60, 60, 60), font=f2)
        x += v.width + pad
    out = args.out or re.sub(r'\W+', '_', title.split(': ')[-1]) + '.png'
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    print(f'{out}: {img.width}x{img.height}, {len(grid)} blocks, {len(items)} boxes')


if __name__ == '__main__':
    main()
