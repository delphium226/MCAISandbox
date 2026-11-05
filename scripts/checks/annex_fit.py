"""#229: how many annex rectangles fit beside a village plot, the 25x13 (#139) against the 25x18 the doubled pens take
(MC_PENS_BIG), read from the saved world (no server). It follows annexSpot's rules (mcBuild.ts) on the region files: the
annexCandidates of each size (3 out from the plot on every side, sliding by 1 along it), each with a 2-block claim around
it that touches no structure or other plot (each padded 2), no water at the top, and every column within -4..+5 of the
level (the plot's y; on a plot of pads, the middle of the rectangle's own column heights). Trees and plants are passed
over to the ground under them, as surveyGround's.
Usage: python scripts/checks/annex_fit.py WORLD VILLAGES_JSON VILLAGE [--core] (a village's plot, e.g. a checkpoint's;
                                             --core: as when the annex is chosen, before growth: only the village's
                                             structures on its plot and other villages' work count as taken)
       python scripts/checks/annex_fit.py WORLD --site X Z [SIZE [Y]]       (a fresh site's plot, SIZE 32, centred, at
                                             level Y, else the middle of its ground's heights)
e.g.   python scripts/checks/annex_fit.py mc/testcheckpoints/w203_n9/world mc/testcheckpoints/w203_n9/villages.json P1 --core
       python scripts/checks/annex_fit.py mc/testworld/world --site -1563 -36 32 64
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R

SKIP = ('air', 'leaves', 'log', 'wood', 'grass', 'fern', 'flower', 'bush', 'petals', 'litter', 'dandelion', 'poppy', 'tulip',
        'mushroom', 'torch', 'snow', 'vine', 'sapling', 'sugar_cane', 'pumpkin', 'melon', 'lily', 'dead_bush', 'cactus')


def main():
    a = sys.argv[1:]
    if len(a) < 3:
        raise SystemExit(__doc__)
    w = R.World(a[0])
    taken = []
    if a[1] == '--site':
        x, z = int(a[2]), int(a[3])
        size = int(a[4]) if len(a) > 4 else 32
        plot = {'x1': x - size // 2, 'z1': z - size // 2, 'x2': x - size // 2 + size - 1, 'z2': z - size // 2 + size - 1, 'y': int(a[5]) if len(a) > 5 else None, 'pads': False}
        name = f'site {x},{z}'
    else:
        data = json.load(open(a[1], encoding='utf-8'))
        vs = data['villages'] if isinstance(data, dict) else data
        v = next(q for q in vs if q['name'].lower() == a[2].lower())
        lay = (v.get('layouts') or [{}])[0]
        plot = next(p for p in v['plots'] if not p.get('annex'))
        name = v['name'] + (' (core)' if '--core' in a else '')
        core = '--core' in a
        pad = lambda q, n: {'x1': q['x1'] - n, 'z1': q['z1'] - n, 'x2': q['x2'] + n, 'z2': q['z2'] + n}
        inplot = lambda q: q['x1'] >= plot['x1'] and q['x2'] <= plot['x2'] and q['z1'] >= plot['z1'] and q['z2'] <= plot['z2']
        for o in vs:
            taken += [pad(s, 2) for s in o.get('structures', []) if not (core and o is v and not inplot(s))]
            if o is not v:
                taken += [pad(q, 2) for q in (o.get('layouts') or []) + o.get('plots', []) if 'x1' in q]
        # (its own other side plots: the works and the storage yard; the annex itself is what is being placed)
        if not core:
            taken += [pad(lay[k], 2) for k in ('works', 'store') if lay.get(k) and lay[k].get('x2', -1) >= lay[k].get('x1', 0)]
            taken += [pad(p, 2) for p in v['plots'] if p is not plot and not p.get('annex')]
            taken += [pad(q, 5) for q in (v.get('layouts') or [])[1:] if 'x1' in q]
    hmap, wet = {}, set()

    def top(x, z):
        k = (x, z)
        if k not in hmap:
            y0 = None
            for y in range(110, 40, -1):
                n = w.block(x, y, z)
                if n is None:
                    break
                if n == 'air?' or any(s in n for s in SKIP):
                    continue
                if n in ('water', 'lava', 'ice'):
                    wet.add(k)
                y0 = y
                break
            hmap[k] = y0
        return hmap[k]

    if plot['y'] is None:
        ys = sorted(t for t in (top(x, z) for x in range(plot['x1'], plot['x2'] + 1, 4) for z in range(plot['z1'], plot['z2'] + 1, 4)) if t is not None)
        plot['y'] = ys[len(ys) // 2]
    over = lambda p, q: p['x1'] <= q['x2'] and q['x1'] <= p['x2'] and p['z1'] <= q['z2'] and q['z1'] <= p['z2']
    out = {}
    for L, D in ((25, 13), (25, 18)):
        cands = []
        for x in range(plot['x1'], plot['x2'] - L + 2):
            cands.append({'x1': x, 'x2': x + L - 1, 'z1': plot['z1'] - 3 - D + 1, 'z2': plot['z1'] - 3, 'side': 'n'})
            cands.append({'x1': x, 'x2': x + L - 1, 'z1': plot['z2'] + 3, 'z2': plot['z2'] + 3 + D - 1, 'side': 's'})
        for z in range(plot['z1'], plot['z2'] - L + 2):
            cands.append({'z1': z, 'z2': z + L - 1, 'x1': plot['x1'] - 3 - D + 1, 'x2': plot['x1'] - 3, 'side': 'w'})
            cands.append({'z1': z, 'z2': z + L - 1, 'x1': plot['x2'] + 3, 'x2': plot['x2'] + 3 + D - 1, 'side': 'e'})
        fit, why = [], {'taken': 0, 'wet': 0, 'steep': 0, 'unsaved': 0}
        for c in cands:
            claim = {'x1': c['x1'] - 2, 'z1': c['z1'] - 2, 'x2': c['x2'] + 2, 'z2': c['z2'] + 2}
            if any(over(c, t) for t in taken):
                why['taken'] += 1
                continue
            cols = [(x, z) for x in range(claim['x1'], claim['x2'] + 1) for z in range(claim['z1'], claim['z2'] + 1)]
            tops = [top(x, z) for x, z in cols]
            if any(t is None for t in tops):
                why['unsaved'] += 1
                continue
            if any(k in wet for k in cols):
                why['wet'] += 1
                continue
            level = plot['y']
            if plot.get('pads'):
                inner = sorted(top(x, z) for x in range(c['x1'], c['x2'] + 1) for z in range(c['z1'], c['z2'] + 1))
                level = inner[len(inner) // 2]
            if any(t - level < -4 or t - level > 5 for t in tops):
                why['steep'] += 1
                continue
            fit.append(c)
        sides = {s: sum(1 for c in fit if c['side'] == s) for s in 'nsew'}
        out[f'{L}x{D}'] = len(fit)
        print(f"{name} {L}x{D}: {len(fit)} of {len(cands)} rectangles fit (by side {sides}; passed over: {why})")
    print(f"RESULT {name}: 25x13 {out['25x13']}, 25x18 {out['25x18']}")


main()
