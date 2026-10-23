"""Raw iron per cell for runs saved as checkpoints from one start (#100): each run's iron level record against the start's
(cells dug, raw iron, ores kept by the walls and by MC_ORE_VEIN's vein dig), then scripts/checks/ore_veins.py on each
run's world against the start's (what the run mined, left exposed, and what else it changed below y 56).
Usage: python scripts/checks/vein_runs.py START RUN [RUN ...]   (checkpoint names, e.g. im2_mine ov_v1 ov_v0)
"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CP = os.path.join(ROOT, 'mc', 'testcheckpoints')


def iron(cp, village='B25x2'):
    vs = json.load(open(os.path.join(CP, cp, 'villages.json'), encoding='utf-8'))
    vs = vs if isinstance(vs, list) else vs.get('villages', vs)
    vs = vs if isinstance(vs, list) else list(vs.values())
    m = next(v for v in vs if v['name'] == village)['mine']
    got = {}
    for i in [*m.get('ironPast', []), m['iron']]:
        for k, n in i.get('got', {}).items(): got[k] = got.get(k, 0) + n
    return m['iron']['dug'], got


start, runs = sys.argv[1], sys.argv[2:]
d0, g0 = iron(start)
for r in runs:
    d, g = iron(r)
    diff = {k: g.get(k, 0) - g0.get(k, 0) for k in set(g) | set(g0) if g.get(k, 0) != g0.get(k, 0)}
    cells, raw = d - d0, diff.get('raw_iron', 0)
    walls = sum(n for k, n in diff.items() if k.startswith('kept ') and 'iron' in k)
    vein = sum(n for k, n in diff.items() if k.startswith('vein ') and 'iron' in k)
    print(f'{r}: {cells} cells, {raw} raw iron ({1000 * raw / max(1, cells):.1f} a 1,000 cells); iron ore by the walls {walls}, by the vein dig {vein}, '
          f'coal by the vein dig {sum(n for k, n in diff.items() if k.startswith("vein ") and "coal" in k)}')
    sys.stdout.flush()
    subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'checks', 'ore_veins.py'), os.path.join(CP, r, 'world'), os.path.join(CP, start, 'world')], cwd=ROOT)
