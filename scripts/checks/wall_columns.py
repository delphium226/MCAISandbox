"""Ground and water under a list of columns, read from a saved world (#217 step 0; wall_measure.mts calls it).
Usage: python scripts/checks/wall_columns.py WORLD CELLS.json [YHI YLO]
CELLS.json is a list of [x, z]. Prints one JSON object: "x,z" -> {"g": ground y (the top solid block: plants, leaves,
logs, fences, torches and gates skipped; under water, the bed), "w": water surface y or null, "lava": bool,
"top": the block name at g, or null when nothing was found between YHI and YLO (default 120 and 30)}.
WORLD as region_blocks.py (a world folder or a server folder).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R

if len(sys.argv) < 3:
    raise SystemExit(__doc__)
w = R.World(sys.argv[1])
cells = json.load(open(sys.argv[2], encoding='utf-8'))
yhi, ylo = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (120, 30)
AIR = {'air', 'cave_air', 'air?', 'void_air'}
SOFT = ('leaves', 'grass', 'fern', 'flower', 'bush', 'wildflowers', 'leaf_litter', 'dandelion', 'poppy', 'mushroom',
        'torch', '_log', '_wood', 'fence', 'vine', 'sugar_cane', 'snow', 'kelp', 'seagrass', 'lily_pad', 'carpet', 'button',
        'sapling', 'tulip', 'orchid', 'allium', 'bluet', 'daisy', 'cornflower', 'lily_of_the_valley', 'rose', 'lilac',
        'peony', 'sunflower', 'petals', 'dripleaf', 'sign', 'lantern', 'pumpkin', 'melon', 'bamboo', 'cactus', 'bubble')
WET = ('water', 'kelp', 'seagrass', 'bubble_column')
out = {}
for x, z in cells:
    g, wat, lava, top = None, None, False, None
    for y in range(yhi, ylo, -1):
        n = w.block(x, y, z)
        if n is None:
            break
        if n == 'water' or n in ('kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column'):
            if wat is None:
                wat = y
            continue
        if n == 'lava':
            lava = True
            if wat is None:
                wat = y
            continue
        if n in AIR or (wat is None and any(s in n for s in SOFT)):
            continue
        g, top = y, n
        break
    out[f'{x},{z}'] = {'g': g, 'w': wat, 'lava': lava, 'top': top}
print(json.dumps(out))
