"""Fresh land next to a drop, from the atlas (no server needed): flat chunks with logs near them, far from every village,
whose neighbours within 2 chunks have ground at least DROP below them: a hillside for a village mine's tunnels to meet
(plan step V.5b; for choosing test-world sites, T.2). Written 2026-10-01; StageM6-M8 used its picks, but the site search
moves a village to the flattest ground near the point, so a drop near the point is no promise of one at the mine.
Usage: python scripts/checks/hilly_land.py [DROP [MIN_DISTANCE]]   (defaults 6 and 110)
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DROP = int(sys.argv[1]) if len(sys.argv) > 1 else 6
MIN_DIST = float(sys.argv[2]) if len(sys.argv) > 2 else 110
chunks = json.load(open(os.path.join(ROOT, 'mc', 'server', 'atlas.json'), encoding='utf-8'))['chunks']
villages = json.load(open(os.path.join(ROOT, 'mc', 'server', 'villages.json'), encoding='utf-8'))['villages']
taken = []
for v in villages:
    for p in v.get('plots', []) + v.get('layouts', []) + v.get('structures', []):
        taken.append(((p['x1'] + p['x2']) / 2, (p['z1'] + p['z2']) / 2))
by = {(c['cx'], c['cz']): c for c in chunks}
out = []
for (cx, cz), c in by.items():
    if c['water'] > 10 or c['flat'] < 180:
        continue
    x, z = cx * 16 + 8, cz * 16 + 8
    d = min((math.hypot(x - a, z - b) for a, b in taken), default=1e9)
    if d < MIN_DIST:
        continue
    logs = n = 0
    lows = []
    for dx in range(-2, 3):
        for dz in range(-2, 3):
            e = by.get((cx + dx, cz + dz))
            if not e:
                continue
            n += 1
            logs += sum(e['logs'].values()) if isinstance(e['logs'], dict) else 0
            if e['water'] < 30:
                lows.append(e['y'][0])
    if n < 20 or logs < 300:
        continue
    drop = c['y'][1] - min(lows)
    if drop >= DROP:
        out.append((drop, logs, x, z, c['y'], round(d)))
out.sort(key=lambda t: (-min(t[1], 600), -t[0]))
for t in out[:15]:
    print(f'{t[2]:6} {t[3]:6}  drop {t[0]:3}  logs {t[1]:5}  y {t[4]}  village {t[5]} away')
