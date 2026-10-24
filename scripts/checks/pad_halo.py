"""MC_PAD_HALO's check (#136), offline: the edge of a prepared plot, read from a world's saved regions against the pristine
test world. Counts, in the ring from the plot's margin out to the halo's width + 1: neighbour pairs with a height step over
1 (walk hazards) and of 3 or more (cliffs), now and on the pristine ground; and cave air within 3 under every column cut
lower than it was (plot, margin and halo). Without the halo the ring keeps today's sheer edge; with it, no new step over 1
should be left except where the halo stops by rule (a drop, village ground, a built column).
Usage: python scripts/checks/pad_halo.py WORLD X1 Z1 X2 Z2 [--margin 2] [--halo 5] [--pristine mc/testworld]
       python scripts/checks/pad_halo.py WORLD --villages VILLAGES.json [--village NAME] [...]   (the village's first plot)
WORLD and the pristine world are world or server folders (region_blocks.World). Save the world first (`save-all flush`
over RCON with MC_SERVER_DIR set, or a clean stop). Exit code 1 when the ring has more steps over 1 than the pristine
ground had there, or when a cut column has cave air within 3 under it.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R

AIR = {'air', 'cave_air', 'void_air', 'air?'}
SOFT = ('leaves', '_log', '_wood', 'short_grass', 'tall_grass', 'fern', 'flower', 'bush', 'wildflowers', 'leaf_litter',
        'dandelion', 'poppy', 'mushroom', 'torch', 'sapling', 'tulip', 'orchid', 'allium', 'bluet', 'daisy', 'cornflower',
        'lily', 'rose', 'peony', 'lilac', 'petals', 'snow', 'sugar_cane', 'vine', 'cocoa', 'dead_bush', 'pumpkin', 'melon',
        'bee_nest', 'eyeblossom', 'moss_carpet', 'cactus', 'carpet', 'pale_hanging_moss')


NATURAL = {'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mud', 'clay', 'moss_block', 'dirt_path', 'stone',
           'andesite', 'diorite', 'granite', 'tuff', 'deepslate', 'calcite', 'sand', 'red_sand', 'gravel', 'sandstone',
           'red_sandstone', 'terracotta', 'snow_block', 'mycelium', 'water', 'coal_ore', 'iron_ore', 'copper_ore', 'cobblestone'}
built = set()


def top(w, x, z, hi=160, lo=-20):
    """The column's ground top (plants, leaves and logs skipped; water's top counts), or None for a chunk never saved.
    A column topped by anything not natural ground (a lamp, a sign, a field, a fence) is noted in `built` and passed over."""
    for y in range(hi, lo, -1):
        n = w.block(x, y, z)
        if n is None:
            return None
        if n in AIR or (n != 'grass_block' and any(s in n for s in SOFT)):
            continue
        if n not in NATURAL and not n.endswith('_terracotta'):
            built.add((x, z))
        return y
    return lo


def main():
    args = sys.argv[1:]
    opt = lambda k, d: (args.pop(args.index(k) + 1), args.remove(k))[0] if k in args else d
    margin, halo = int(opt('--margin', 2)), int(opt('--halo', 5))
    pristine, vfile, vname = opt('--pristine', 'mc/testworld'), opt('--villages', None), opt('--village', None)
    if not args:
        sys.exit(__doc__)
    world = args[0]
    skip = []
    if vfile:
        d = json.load(open(vfile))
        vs = d['villages'] if isinstance(d, dict) and 'villages' in d else d
        v = next(v for v in vs if not vname or v['name'] == vname)
        p = v['plots'][0]
        x1, z1, x2, z2 = p['x1'], p['z1'], p['x2'], p['z2']
        # (passed over: every structure and 1 round it, and the mine's hut and stairs, dug on purpose)
        for st in v.get('structures', []):
            skip.append((st['x1'] - 1, st['z1'] - 1, st['x2'] + 1, st['z2'] + 1))
        m = v.get('mine')
        if m and m.get('hut'):
            h, (dx, dz), n = m['hut'], m.get('dir', [0, 0]), m.get('steps', 0) + 2
            skip.append((min(h['x1'], h['x1'] + dx * n) - 1, min(h['z1'], h['z1'] + dz * n) - 1,
                         max(h['x2'], h['x2'] + dx * n) + 1, max(h['z2'], h['z2'] + dz * n) + 1))
    else:
        x1, z1, x2, z2 = map(int, args[1:5])
    W, P = R.World(world), R.World(pristine)
    ax1, az1, ax2, az2 = x1 - margin, z1 - margin, x2 + margin, z2 + margin
    k = halo + 1
    ring = [(x, z) for x in range(ax1 - k, ax2 + k + 1) for z in range(az1 - k, az2 + k + 1)
            if not (ax1 + 1 <= x <= ax2 - 1 and az1 + 1 <= z <= az2 - 1)]
    now, was = {}, {}
    for x, z in ring:
        now[(x, z)], was[(x, z)] = top(W, x, z), top(P, x, z)
    cells = set(ring)
    steps = {'now2': 0, 'was2': 0, 'now3': 0, 'was3': 0, 'max': 0}
    shown = []
    for (x, z) in ring:
        for n in ((x + 1, z), (x, z + 1)):
            if n not in cells or (x, z) in built or n in built or any(a <= q[0] <= c and b <= q[1] <= d for q in ((x, z), n) for a, b, c, d in skip) or None in (now[(x, z)], now[n], was[(x, z)], was[n]):
                continue
            a, b = abs(now[(x, z)] - now[n]), abs(was[(x, z)] - was[n])
            steps['now2'] += a > 1; steps['was2'] += b > 1; steps['now3'] += a > 2; steps['was3'] += b > 2
            steps['max'] = max(steps['max'], a)
            if a > 1 and b <= 1 and len(shown) < 12:
                shown.append(f'{x},{z}->{n[0]},{n[1]}: {now[(x, z)]} / {now[n]} (was {was[(x, z)]} / {was[n]})')
    # caves under cut columns: the whole plot, margin and ring
    caves, cut = [], 0
    for x in range(ax1 - halo, ax2 + halo + 1):
        for z in range(az1 - halo, az2 + halo + 1):
            t = now.get((x, z)) if (x, z) in now else top(W, x, z)
            g = was.get((x, z)) if (x, z) in was else top(P, x, z)
            if t is None or g is None or t >= g or any(a <= x <= c and b <= z <= d for a, b, c, d in skip):
                continue
            cut += 1
            for y in range(t - 3, t):
                if W.block(x, y, z) in AIR:
                    caves.append(f'{x},{y},{z}')
    print(f'plot {x1},{z1}..{x2},{z2} (margin {margin}, ring out to {k} beyond it)')
    print(f"steps over 1 in the ring: {steps['now2']} (pristine {steps['was2']}); 3 or more: {steps['now3']} (pristine {steps['was3']}); largest {steps['max']}")
    for s in shown:
        print(f'  new step: {s}')
    print(f'cut columns {cut}; cave cells within 3 under them: {len(caves)} {" ".join(caves[:10])}')
    bad = steps['now2'] > steps['was2'] or caves
    print('FAIL' if bad else 'PASS')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
