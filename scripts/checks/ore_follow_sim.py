"""A rough offline estimate for MC_ORE_MINE (G8, 10-23): raw iron per 1,000 tunnel cells for the iron level's fixed
pattern against the ore-following one, simulated on a saved world's blocks (region_blocks.World, read-only).

The model, for both patterns: a level at y L is dug as two-high tunnel cells; a cell gives the iron in it, in its walls,
its floor and the ceiling over it, and on along each vein within a column of the cell (keepOres); a cell beside water or
lava, on no floor, under no solid ceiling or in a cave ends its branch or tunnel. The fixed pattern is the iron level's
(a main tunnel with 12-cell branches every 3 cells, turns off ended tunnels, 9 tunnels and 320 cells a level). The
ore-following pattern digs the same, but notes iron within 4 blocks of each cell dug (y L-1..L+2, the ores a tunnel at L
can take) and, before each next cell, digs a short drift (up to 12 cells, straight, from a cell already dug) to the
nearest one its cells take (in line at L-1..L+2, beside at L or L+1). Levels: the fixed four (28, 16, 4, -8), then for
the supply estimate MC_ORE_MINE's levels 6 apart down to -8, 1,150 cells each, until 8,000 cells.
Usage: python scripts/checks/ore_follow_sim.py [WORLD] [X Z] [--rate CELLS_PER_MIN]
       (default mc/testworld, the IM1 mine at -1620,0; 42 cells a minute: IM1's four levels, 1,919 cells in 46 minutes)
"""
import math, random, sys
import numpy as np
sys.path.insert(0, 'scripts/checks')
import region_blocks as RB

args = [a for a in sys.argv[1:] if not a.startswith('--')]
RATE = 42.0
if '--rate' in sys.argv:
    RATE = float(sys.argv[sys.argv.index('--rate') + 1])
    args = [a for a in args if a != sys.argv[sys.argv.index('--rate') + 1]]
WORLD = args[0] if args else 'mc/testworld'
CX, CZ = (int(args[1]), int(args[2])) if len(args) > 2 else (-1620, 0)
R, Y0, Y1 = 90, -12, 36
SOLID, IRON, AIR, WET, OTHER, FALL = 0, 1, 2, 3, 4, 5
DIG = {'stone', 'deepslate', 'tuff', 'granite', 'diorite', 'andesite', 'calcite', 'dirt', 'coarse_dirt', 'clay',
       'dripstone_block', 'moss_block', 'smooth_basalt'}


def code(name):
    if name in ('iron_ore', 'deepslate_iron_ore'): return IRON
    if name in ('air', 'cave_air', 'air?'): return AIR
    if name in ('water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'): return WET
    if name in ('sand', 'gravel', 'red_sand', 'pointed_dripstone'): return FALL
    if name in DIG or name.endswith('_ore'): return SOLID
    return OTHER


W = RB.World(WORLD)
NX = NZ = 2 * R + 1
NY = Y1 - Y0 + 1
G = np.full((NX, NY, NZ), OTHER, dtype=np.int8)
for cx in range((CX - R) >> 4, ((CX + R) >> 4) + 1):
    for cz in range((CZ - R) >> 4, ((CZ + R) >> 4) + 1):
        secs = W.chunk(cx, cz)
        if not secs: continue
        for sy, (pal, data) in secs.items():
            if sy * 16 > Y1 or sy * 16 + 15 < Y0: continue
            codes = np.array([code(p) for p in pal], dtype=np.int8)
            if not data or len(pal) == 1:
                blk = np.full(4096, codes[0], dtype=np.int8)
            else:
                bits = max(4, math.ceil(math.log2(len(pal))))
                per = 64 // bits
                words = np.array([d & ((1 << 64) - 1) for d in data], dtype=np.uint64)
                idx = np.arange(4096)
                v = (words[idx // per] >> ((idx % per) * bits).astype(np.uint64)) & np.uint64((1 << bits) - 1)
                blk = codes[v.astype(np.int64)]
            blk = blk.reshape(16, 16, 16)  # y, z, x
            for ly in range(16):
                y = sy * 16 + ly
                if y < Y0 or y > Y1: continue
                for lz in range(16):
                    z = cz * 16 + lz
                    if abs(z - CZ) > R: continue
                    x0 = cx * 16
                    xs = [x for x in range(x0, x0 + 16) if abs(x - CX) <= R]
                    if not xs: continue
                    G[xs[0] - CX + R:xs[-1] - CX + R + 1, y - Y0, z - CZ + R] = blk[ly, lz, xs[0] - x0:xs[-1] - x0 + 1]
print(f'world {WORLD}, within {R} of {CX},{CZ}, y {Y0}..{Y1}: iron blocks {int((G == IRON).sum())}')


class Sim:
    def __init__(self, follow):
        self.g = G.copy()
        self.follow = follow
        self.iron = self.cells = self.drift_cells = 0
        self.seen = set()

    def at(self, x, y, z):
        i, j, k = x - CX + R, y - Y0, z - CZ + R
        if not (0 <= i < NX and 0 <= j < NY and 0 <= k < NZ): return OTHER
        return self.g[i, j, k]

    def take(self, x, y, z):
        if self.at(x, y, z) == IRON: self.iron += 1
        self.g[x - CX + R, y - Y0, z - CZ + R] = AIR
        self.seen.discard((x, y, z))

    def safe(self, x, L, z):
        if (x - CX) ** 2 + (z - CZ) ** 2 > 86 ** 2: return False
        for y in (L, L + 1):
            c = self.at(x, y, z)
            if c in (WET, OTHER, FALL) or c == AIR and (x, z, L) not in self.open: return False
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)):
                if self.at(x + dx, y + dy, z + dz) == WET: return False
        return self.at(x, L - 1, z) in (SOLID, IRON, OTHER) and self.at(x, L + 2, z) in (SOLID, IRON, OTHER)

    def dig(self, x, L, z, drift=False):
        """One tunnel cell: False when it may not be dug (its branch ends); True when dug or found open."""
        if (x, z, L) in self.open: return True
        if not self.safe(x, L, z): return False
        self.take(x, L, z); self.take(x, L + 1, z)
        self.open.add((x, z, L))
        self.cells += 1
        if drift: self.drift_cells += 1
        n = 0
        for (wx, wy, wz) in [(x + 1, L, z), (x - 1, L, z), (x, L, z + 1), (x, L, z - 1), (x + 1, L + 1, z), (x - 1, L + 1, z),
                             (x, L + 1, z + 1), (x, L + 1, z - 1), (x, L + 2, z), (x, L - 1, z)]:
            if self.at(wx, wy, wz) != IRON or n >= 24: continue
            self.take(wx, wy, wz); n += 1
            if wy == L - 1: continue
            stack = [(wx, wy, wz)]
            while stack and n < 24:
                p = stack.pop()
                for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)):
                    q = (p[0] + dx, p[1] + dy, p[2] + dz)
                    if q[1] >= L and abs(q[0] - x) <= 1 and abs(q[2] - z) <= 1 and self.at(*q) == IRON:
                        self.take(*q); n += 1; stack.append(q)
        if self.follow:
            for dx in range(-4, 5):
                for dz in range(-4, 5):
                    for y in range(L - 1, L + 3):
                        if self.at(x + dx, y, z + dz) == IRON: self.seen.add((x + dx, y, z + dz))
        return True

    def drift(self, L):
        """The nearest iron noted that a straight drift from a dug cell passes within a column of: dug."""
        best = None
        cols = [(x, z) for (x, z, l) in self.open if l == L]
        for (sx, sy, sz) in self.seen:
            if not (L - 1 <= sy <= L + 2): continue
            for (x, z) in cols:
                for ax in (0, 1):
                    d = (sx - x) if ax == 0 else (sz - z)
                    off = (sz - z) if ax == 0 else (sx - x)
                    # (what the drift's cells take, as mcMine's oreDrift: in line at L-1..L+2, beside at L or L+1)
                    takes = (off == 0 and L - 1 <= sy <= L + 2) or (abs(off) == 1 and L <= sy <= L + 1)
                    if takes and 1 <= abs(d) <= 12 and (best is None or abs(d) < best[0]):
                        best = (abs(d), x, z, ax, 1 if d > 0 else -1)
        if not best: return False
        n, x, z, ax, s = best
        for k in range(1, n + 1):
            if not self.dig(x + (s * k if ax == 0 else 0), L, z + (s * k if ax == 1 else 0), True): break
        # (whatever happened, that target is not tried again)
        self.seen = {p for p in self.seen if not (abs((p[0] if ax == 0 else p[2]) - ((x if ax == 0 else z) + s * n)) <= 0
                                                   and abs((p[2] if ax == 0 else p[0]) - (z if ax == 0 else x)) <= 1)}
        return True

    def level(self, L, sx, sz, d0, cap=320):
        """One level from a start column: legs of the iron level's pattern (main 3 + branches 12 + 12 a stretch)."""
        self.open = getattr(self, 'open', set())
        self.open.add((sx, sz, L))
        start = self.cells
        legs = [{'x': sx, 'z': sz, 'dir': d0, 'k': 0, 'ended': set(), 'end': False, 'turned': 0, 'full': set()}]
        while self.cells - start < cap:
            if self.follow and self.drift(L): continue
            leg = next((l for l in legs if not l['end']), None)
            if not leg:
                if len(legs) >= 9: break
                t = None
                for n, l in enumerate(legs):
                    for side in (1, 2):
                        if l['turned'] & side: continue
                        l['turned'] |= side
                        dx, dz = l['dir']
                        nd = (dz, -dx) if side == 1 else (-dz, dx)
                        js = sorted((j for j in l['full'] if j % 3 == side), reverse=True)
                        if js:
                            s = js[0] // 3 + 1
                            t = {'x': l['x'] + dx * 3 * s, 'z': l['z'] + dz * 3 * s, 'dir': nd}
                        elif n == 0:
                            t = {'x': l['x'], 'z': l['z'], 'dir': nd}
                        if t: break
                    if t: break
                if not t: break
                legs.append({**t, 'k': 0, 'ended': set(), 'end': False, 'turned': 0, 'full': set()})
                continue
            k = leg['k']; leg['k'] += 1
            seg, r = divmod(k, 27)
            dx, dz = leg['dir']
            if r < 3:
                i = 3 * seg + r + 1
                c, br = (leg['x'] + dx * i, leg['z'] + dz * i), 3 * seg
            else:
                left = r < 15
                j = r - 3 + 1 if left else r - 15 + 1
                bx, bz = (dz, -dx) if left else (-dz, dx)
                base = (leg['x'] + dx * 3 * (seg + 1), leg['z'] + dz * 3 * (seg + 1))
                c, br = (base[0] + bx * j, base[1] + bz * j), 3 * seg + (1 if left else 2)
                if j == 12 and br not in leg['ended']: leg['full'].add(br)
            if br in leg['ended']: continue
            if not self.dig(c[0], L, c[1]):
                if br % 3 == 0: leg['end'] = True
                else: leg['ended'].add(br)
        return self.cells - start


def run(follow, levels, cap_total, seed, cap_level=None):
    rnd = random.Random(seed)
    s = Sim(follow)
    per = []
    for L in levels:
        if s.cells >= cap_total: break
        sx, sz = CX + rnd.randint(-12, 12), CZ + rnd.randint(-12, 12)
        d0 = rnd.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        before = s.iron
        n = s.level(L, sx, sz, d0, min(cap_level or (320 if not follow else 800), cap_total - s.cells))
        per.append((L, n, s.iron - before))
    return s, per


FIXED = [28, 16, 4, -8]
DEEP = [28, 22, 16, 10, 4, -2, -8]
print(f'{"pattern":<40} {"cells":>6} {"iron":>5} {"per 1k":>7}  {"drift":>5}  levels (y: cells/iron)')
rows = {}
for name, follow, levels, cap, lc in [('fixed, 4 levels (IM1)', False, FIXED, 8000, 320), ('fixed, 4 levels, 800 a level', False, FIXED, 8000, 800),
                                      ('ore-following, same 4 levels', True, FIXED, 8000, 800),
                                      ('fixed, 7 levels 6 apart, 1,150 each', False, DEEP, 8000, 1150), ('ore-following, 7 levels (MC_ORE_MINE)', True, DEEP, 8000, 1150)]:
    tot = [0, 0, 0]
    for seed in range(6):
        s, per = run(follow, levels, cap, seed, lc)
        tot[0] += s.cells; tot[1] += s.iron; tot[2] += s.drift_cells
    c, i, d = (t / 6 for t in tot)
    rows[name] = (c, i)
    print(f'{name:<40} {c:6.0f} {i:5.0f} {1000 * i / max(1, c):7.1f}  {d:5.0f}  ' + ' '.join(f'{L}:{n}/{g}' for L, n, g in per))
for name, (c, i) in rows.items():
    print(f'supply at {RATE:.0f} cells a minute: {name}: {c / RATE / 60:.1f} h, {60 * RATE * i / max(1, c):.0f} raw iron an hour')
