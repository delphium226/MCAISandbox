"""Raw iron per cell for the iron mine's rules, offline (#100, G8, 10-23): today's ore-following mine against digging out
the whole vein when one block of it is laid open, and against wider strip-mine spacings, on a saved world's blocks.

The model follows scripts/checks/ore_follow_sim.py (MC_ORE_MINE's estimate): levels of two-high tunnel cells; a cell
beside water or lava, on no floor, under no solid ceiling or in a cave ends its branch or tunnel; levels 6 apart from
y 28 to -8, 1,150 cells a level, 8,000 in all; the pattern a main tunnel with branches every SPACING cells (BRANCH long,
both sides), turns off ended tunnels, at most 9 tunnels a level. Rules:
  today  keepOres: the iron in the cell, its walls, its floor and the ceiling over it, and on along the vein (6-connected)
         within a column of the cell, at most 24 a cell; plus MC_ORE_MINE's drifts toward iron seen within 4 blocks;
  vein   as today, then every iron block 26-connected (diagonals too) to one the cell laid open or took, flood-filled up
         to VEIN_CAP blocks a cell; a diagonal step breaks one stone between (a corner step two); ore beside water or lava
         is left, as mcMine's checks leave it.
Blocks broken = 2 a tunnel cell + every ore taken + the stone broken to reach vein ore; a member's time goes mostly to
blocks broken and the walks between cells.
Usage: python scripts/checks/vein_sim.py [WORLD] [X Z] [--seeds N]   (default mc/testworld round the IM2 mine, -1618,34)
"""
import random, sys, os
from collections import deque
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ore_veins import grid, N26

argv = sys.argv[1:]
SEEDS = int(argv[argv.index('--seeds') + 1]) if '--seeds' in argv else 6
pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or not argv[i - 1].startswith('--'))]
WORLD = pos[0] if pos else 'mc/testworld'
CX, CZ = (int(pos[1]), int(pos[2])) if len(pos) > 2 else (-1618, 34)
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


ids, names = grid(WORLD, CX, CZ, R, Y0, Y1)
G = np.array([code(n) if n != 'missing' else OTHER for n in names], dtype=np.int8)[ids]
NX, NY, NZ = G.shape
print(f'world {WORLD}, within {R} of {CX},{CZ}, y {Y0}..{Y1}: iron blocks {int((G == IRON).sum())}')
N6 = ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0))


class Sim:
    def __init__(self, follow, vein, cap=32, spacing=3, branch=12):
        self.g = G.copy()
        self.follow, self.vein, self.cap, self.spacing, self.branch = follow, vein, cap, spacing, branch
        self.iron = self.cells = self.drift_cells = self.vein_iron = self.path = self.below = 0
        self.far = []
        self.seen = set()
        self.open = set()

    def at(self, x, y, z):
        i, j, k = x - CX + R, y - Y0, z - CZ + R
        if not (0 <= i < NX and 0 <= j < NY and 0 <= k < NZ): return OTHER
        return self.g[i, j, k]

    def take(self, x, y, z):
        got = self.at(x, y, z) == IRON
        if got: self.iron += 1
        i, j, k = x - CX + R, y - Y0, z - CZ + R
        if 0 <= i < NX and 0 <= j < NY and 0 <= k < NZ: self.g[i, j, k] = AIR
        self.seen.discard((x, y, z))
        return got

    def wet(self, x, y, z):
        return any(self.at(x + dx, y + dy, z + dz) == WET for dx, dy, dz in N6)

    def safe(self, x, L, z):
        if (x - CX) ** 2 + (z - CZ) ** 2 > 86 ** 2: return False
        for y in (L, L + 1):
            c = self.at(x, y, z)
            if c in (WET, OTHER, FALL) or c == AIR and (x, z, L) not in self.open: return False
            if self.wet(x, y, z): return False
        return self.at(x, L - 1, z) in (SOLID, IRON, OTHER) and self.at(x, L + 2, z) in (SOLID, IRON, OTHER)

    def dig(self, x, L, z, drift=False):
        """One tunnel cell: False when it may not be dug (its branch ends); True when dug or found open."""
        if (x, z, L) in self.open: return True
        if not self.safe(x, L, z): return False
        self.take(x, L, z); self.take(x, L + 1, z)
        self.open.add((x, z, L))
        self.cells += 1
        if drift: self.drift_cells += 1
        n, taken = 0, []
        for (wx, wy, wz) in [(x + 1, L, z), (x - 1, L, z), (x, L, z + 1), (x, L, z - 1), (x + 1, L + 1, z), (x - 1, L + 1, z),
                             (x, L + 1, z + 1), (x, L + 1, z - 1), (x, L + 2, z), (x, L - 1, z)]:
            if self.at(wx, wy, wz) != IRON or n >= 24: continue
            self.take(wx, wy, wz); n += 1; taken.append((wx, wy, wz))
            if wy == L - 1: continue
            stack = [(wx, wy, wz)]
            while stack and n < 24:
                p = stack.pop()
                for dx, dy, dz in N6:
                    q = (p[0] + dx, p[1] + dy, p[2] + dz)
                    if q[1] >= L and abs(q[0] - x) <= 1 and abs(q[2] - z) <= 1 and self.at(*q) == IRON:
                        self.take(*q); n += 1; stack.append(q); taken.append(q)
        if self.vein:
            # The whole vein: from every ore taken (and the cells themselves), 26-connected iron, up to cap a cell
            q = deque(taken + [(x, L, z), (x, L + 1, z)])
            m = 0
            while q and m < self.cap:
                p = q.popleft()
                for d in N26:
                    r = (p[0] + d[0], p[1] + d[1], p[2] + d[2])
                    if self.at(*r) != IRON or self.wet(*r): continue
                    self.take(*r); m += 1; self.vein_iron += 1
                    self.path += sum(1 for c in d if c) - 1
                    if r[1] < L - 1: self.below += 1
                    self.far.append(max(abs(r[0] - x), abs(r[2] - z), r[1] - (L + 1), (L - 1) - r[1], 0))
                    q.append(r)
                    if m >= self.cap: break
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
                    takes = (off == 0 and L - 1 <= sy <= L + 2) or (abs(off) == 1 and L <= sy <= L + 1)
                    if takes and 1 <= abs(d) <= 12 and (best is None or abs(d) < best[0]):
                        best = (abs(d), x, z, ax, 1 if d > 0 else -1)
        if not best: return False
        n, x, z, ax, s = best
        for k in range(1, n + 1):
            if not self.dig(x + (s * k if ax == 0 else 0), L, z + (s * k if ax == 1 else 0), True): break
        self.seen = {p for p in self.seen if not (abs((p[0] if ax == 0 else p[2]) - ((x if ax == 0 else z) + s * n)) <= 0
                                                   and abs((p[2] if ax == 0 else p[0]) - (z if ax == 0 else x)) <= 1)}
        return True

    def level(self, L, sx, sz, d0, cap):
        """One level from a start column: a main tunnel, branches every `spacing` cells both sides, turns off ended ones."""
        self.open.add((sx, sz, L))
        start = self.cells
        S, B = self.spacing, self.branch
        per = S + 2 * B
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
                            t = {'x': l['x'] + dx * S * s, 'z': l['z'] + dz * S * s, 'dir': nd}
                        elif n == 0:
                            t = {'x': l['x'], 'z': l['z'], 'dir': nd}
                        if t: break
                    if t: break
                if not t: break
                legs.append({**t, 'k': 0, 'ended': set(), 'end': False, 'turned': 0, 'full': set()})
                continue
            k = leg['k']; leg['k'] += 1
            seg, r = divmod(k, per)
            dx, dz = leg['dir']
            if r < S:
                i = S * seg + r + 1
                c, br = (leg['x'] + dx * i, leg['z'] + dz * i), 3 * seg
            else:
                left = r < S + B
                j = r - S + 1 if left else r - S - B + 1
                bx, bz = (dz, -dx) if left else (-dz, dx)
                base = (leg['x'] + dx * S * (seg + 1), leg['z'] + dz * S * (seg + 1))
                c, br = (base[0] + bx * j, base[1] + bz * j), 3 * seg + (1 if left else 2)
                if j == B and br not in leg['ended']: leg['full'].add(br)
            if br in leg['ended']: continue
            if not self.dig(c[0], L, c[1]):
                if br % 3 == 0: leg['end'] = True
                else: leg['ended'].add(br)
        return self.cells - start


DEEP = [28, 22, 16, 10, 4, -2, -8]


def run(seed, **kw):
    rnd = random.Random(seed)
    s = Sim(**kw)
    for L in DEEP:
        if s.cells >= 8000: break
        sx, sz = CX + rnd.randint(-12, 12), CZ + rnd.randint(-12, 12)
        d0 = rnd.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        s.level(L, sx, sz, d0, min(1150, 8000 - s.cells))
    return s


RULES = [
    ('today (MC_ORE_MINE: keepOres + drifts)', dict(follow=True, vein=False)),
    ('vein fill on exposure, with drifts', dict(follow=True, vein=True)),
    ('vein fill, cap 12 a cell, with drifts', dict(follow=True, vein=True, cap=12)),
    ('vein fill, no drifts', dict(follow=False, vein=False)),
    ('keepOres only, no drifts', dict(follow=False, vein=False)),
    ('vein fill, no drifts, branches 4 apart', dict(follow=False, vein=True, spacing=4)),
    ('vein fill, no drifts, branches 5 apart', dict(follow=False, vein=True, spacing=5)),
    ('vein fill, drifts, branches 4 apart', dict(follow=True, vein=True, spacing=4)),
    ('vein fill, drifts, branches 5 apart', dict(follow=True, vein=True, spacing=5)),
]
RULES[3] = ('vein fill, no drifts', dict(follow=False, vein=True))
print(f'{"rule":<42} {"cells":>6} {"iron":>5} {"/1k cells":>9} {"blocks":>6} {"/1k blocks":>10} {"vein":>5} {"path":>5} {"below":>5} {"far p90":>7}')
for name, kw in RULES:
    t = np.zeros(7)
    far = []
    for seed in range(SEEDS):
        s = run(seed, **kw)
        blocks = 2 * s.cells + s.iron - 0 + s.path
        t += [s.cells, s.iron, blocks, s.vein_iron, s.path, s.below, s.drift_cells]
        far += s.far
    c, i, b, v, p, bl, d = t / SEEDS
    f90 = float(np.percentile(far, 90)) if far else 0
    print(f'{name:<42} {c:6.0f} {i:5.0f} {1000 * i / c:9.1f} {b:6.0f} {1000 * i / b:10.1f} {v:5.0f} {p:5.0f} {bl:5.0f} {f90:7.0f}')
