"""Find fresh land for a village test from the shared atlas: places with logs (and sand for glass) near them, dry and
flat, far enough from every existing village. Reads mc/server/atlas.json and mc/server/villages.json (no server needed).

Usage: python scripts/checks/fresh_land.py [MIN_DISTANCE] [COUNT]
  MIN_DISTANCE  blocks from the nearest village's plots, buildings or storage (default 110; 160 found almost nothing
                near the explored land on 2026-09-29)
  COUNT         how many to list (default 12)
Each line: x z (chunk centre), log blocks / sand / water cells within 5x5 chunks (~80 blocks), the chunk's flat count
(of 256 columns), distance to the nearest village, the chunk's highest ground. Sorted by logs (capped at 400) plus 3x
sand (capped at 60). The watch and stage scripts search for a site near the point themselves.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
min_dist = float(sys.argv[1]) if len(sys.argv) > 1 else 110
count = int(sys.argv[2]) if len(sys.argv) > 2 else 12

chunks = json.load(open(os.path.join(ROOT, 'mc', 'server', 'atlas.json'), encoding='utf-8'))['chunks']
villages = json.load(open(os.path.join(ROOT, 'mc', 'server', 'villages.json'), encoding='utf-8'))['villages']
taken = []
for v in villages:
    for p in v.get('plots', []) + v.get('layouts', []) + v.get('structures', []):
        taken.append(((p['x1'] + p['x2']) / 2, (p['z1'] + p['z2']) / 2))
    for c in (v.get('storage') or {}).get('chests', []):
        taken.append((c['x'], c['z']))
by = {(c['cx'], c['cz']): c for c in chunks}
found = []
for (cx, cz), c in by.items():
    logs = sand = water = n = 0
    for dx in range(-2, 3):
        for dz in range(-2, 3):
            d = by.get((cx + dx, cz + dz))
            if not d:
                continue
            n += 1
            logs += sum(d['logs'].values()) if isinstance(d['logs'], dict) else 0
            sand += d['surface'].get('sand', 0) + d['surface'].get('red_sand', 0)
            water += d['water']
    # Most of the neighbourhood seen; the chunk itself dry and mostly flat
    if n < 20 or c['water'] > 20 or c['flat'] < 150:
        continue
    x, z = cx * 16 + 8, cz * 16 + 8
    near = min((math.hypot(x - px, z - pz) for px, pz in taken), default=999)
    if near < min_dist:
        continue
    found.append((logs, sand, water, c['flat'], x, z, int(near), max(c['y'])))
found.sort(key=lambda r: -(min(r[0], 400) + 3 * min(r[1], 60)))
print(f'{len(found)} places at least {min_dist:g} blocks from every village; best {min(count, len(found))}:')
for logs, sand, water, flat, x, z, near, top in found[:count]:
    print(f'  {x:6} {z:6}  logs {logs:5}  sand {sand:5}  water {water:5}  flat {flat:3}  village {near:4} blocks away  ground up to y {top}')
