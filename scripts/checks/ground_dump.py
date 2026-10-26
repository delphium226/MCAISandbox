"""The ground of a box of a saved world as JSON, no server (written 2026-10-26 for #163's lodge search on a checkpoint's
ground): for each column its top solid block's y (plants, leaves and logs skipped, as the agents' surfaceAt reads it),
whether that top is a liquid, and whether a tree stands on it. Only saved chunks (see region_blocks.py).
Usage: python scripts/checks/ground_dump.py WORLD X1 Z1 X2 Z2 OUT.json [YHI YLO]
OUT.json: {"x1":..,"z1":..,"x2":..,"z2":.., "cols": [[y, liquid, trees] or null, ...]} row by row (z outer, x inner).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R

if len(sys.argv) < 7:
    raise SystemExit(__doc__)
w = R.World(sys.argv[1])
x1, z1, x2, z2 = map(int, sys.argv[2:6])
out = sys.argv[6]
yhi, ylo = (int(sys.argv[7]), int(sys.argv[8])) if len(sys.argv) > 8 else (120, 40)
AIR = {'air', 'cave_air', 'air?'}
SOFT = ('short_grass', 'tall_grass', 'fern', 'flower', 'bush', 'wildflowers', 'leaf_litter', 'dandelion', 'poppy',
        'mushroom', 'torch', 'vine', 'snow', 'moss_carpet', 'sapling', 'tulip', 'orchid', 'allium', 'bluet', 'daisy',
        'cornflower', 'lily', 'rose', 'peony', 'lilac', 'sunflower', 'sugar_cane', 'kelp', 'seagrass')
cols = []
for z in range(z1, z2 + 1):
    for x in range(x1, x2 + 1):
        top, trees = None, 0
        for y in range(yhi, ylo, -1):
            n = w.block(x, y, z)
            if n is None:
                break
            if n in AIR or any(s in n for s in SOFT):
                continue
            if n.endswith('_leaves') or n.endswith('_log'):
                if n.endswith('_log'):
                    trees = 1
                continue
            top = [y, n in ('water', 'lava', 'bubble_column'), trees]
            break
        cols.append(top)
json.dump({'x1': x1, 'z1': z1, 'x2': x2, 'z2': z2, 'cols': cols}, open(out, 'w'))
print(f'{len(cols)} columns, {sum(1 for c in cols if c)} read, to {out}')
