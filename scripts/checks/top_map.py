"""Top-ground map from the saved world, no server needed (written 2026-10-02 to find F95's pits in a prepared plot).
Usage: python scripts/checks/top_map.py WORLD X1 Z1 X2 Z2 [YHI YLO]
Prints one digit per column (the last digit of the top solid block's y, plants and leaves skipped; '.' none found
between YHI and YLO, default 110 and 80), north up, then up to 60 columns whose top is not grass or dirt. WORLD is a
world folder or a server folder (as region_blocks.py --world). Only saved chunks: run `save-all flush` over RCON first
(MC_SERVER_DIR=mc/testserver python mc/rcon.py "save-all flush" for the test world). Compare a run's world with the
snapshot (mc/testworld/world) to tell dug pits from unfilled ones.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R

if len(sys.argv) < 6:
    raise SystemExit(__doc__)
w = R.World(sys.argv[1])
x1, z1, x2, z2 = map(int, sys.argv[2:6])
yhi, ylo = (int(sys.argv[6]), int(sys.argv[7])) if len(sys.argv) > 7 else (110, 80)
AIR = {'air', 'cave_air', 'air?'}
SOFT = ('leaves', 'short_grass', 'tall_grass', 'fern', 'flower', 'bush', 'wildflowers', 'leaf_litter', 'dandelion', 'poppy', 'mushroom', 'torch')
print('      ' + ''.join(str(abs(x) % 10) for x in range(x1, x2 + 1)))
odd = []
for z in range(z1, z2 + 1):
    row = ''
    for x in range(x1, x2 + 1):
        t = None
        for y in range(yhi, ylo, -1):
            n = w.block(x, y, z)
            if n is None: break
            if n in AIR or any(s in n for s in SOFT): continue
            t = (y, n); break
        row += '.' if not t else str(t[0] % 10)
        if t and t[1] not in ('grass_block', 'dirt'): odd.append((x, z, t))
    print(f'{z:6d}' + row)
for o in odd[:60]: print(o)
