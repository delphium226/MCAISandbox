"""The ground below a village's mine, for the diamond rung (G8, #22; offline, from the saved world: region_blocks.py's
reader). Written for S.15's spec (runs/2026-10-30/diamond/spec.md) and kept for other sites.

Usage: python scripts/checks/deep_land.py [--world WORLD] X Z [RADIUS]
  X Z: the mine's top (villages.json `mine.top`); RADIUS: how far from it (90, the mine's range).
Prints, by y from -64 to 20: diamond ore, lava, water, cave air, deepslate; then for each candidate deep level y,
straight 2-high tunnels (24 cells, the iron level's) from starts on a 3-block grid in four directions, cut at the first
cell the mine's rule refuses (a liquid in it or beside it, no floor), with the diamonds their walls, floor and ceiling
lay open, per cell dug; then the stairs down from y -8 (and 18) to each level: straight stairs (1 down, 1 on, 3 cells a
step) that meet no liquid in or beside them, as a share of the starts tried.
"""
import math, os, sys, random
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R  # noqa: E402

args = sys.argv[1:]
world = None
if args and args[0] == '--world':
    world, args = args[1], args[2:]
X, Z = int(args[0]), int(args[1])
RAD = int(args[2]) if len(args) > 2 else 90
W = R.World(world) if world else R.default_world()
if not isinstance(W, R.World):
    W = R.World(os.environ.get('MC_SERVER_DIR', 'mc/server'))

# Whole sections decoded once: (cx, cz, sy) -> list of 4096 names
_sec = {}


def section(cx, cz, sy):
    k = (cx, cz, sy)
    if k in _sec: return _sec[k]
    secs = W.chunk(cx, cz)
    out = None
    if secs is not None and sy in secs:
        pal, data = secs[sy]
        if not data or len(pal) == 1:
            out = [pal[0]] * 4096
        else:
            bits = max(4, math.ceil(math.log2(len(pal))))
            per, mask = 64 // bits, (1 << bits) - 1
            out = []
            for word in data:
                word &= (1 << 64) - 1
                for j in range(per):
                    out.append(pal[(word >> (j * bits)) & mask])
            out = out[:4096]
    _sec[k] = out
    return out


def blk(x, y, z):
    s = section(x >> 4, z >> 4, y >> 4)
    if s is None: return None
    return s[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]


WET = {'water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'}
DIAMOND = {'diamond_ore', 'deepslate_diamond_ore'}
AIRS = {'air', 'cave_air'}
SOLIDISH = lambda n: n is not None and n not in AIRS and n not in WET and n != 'air?'


def inside(x, z):
    return (x - X) ** 2 + (z - Z) ** 2 <= RAD * RAD


# 1. By y
by = {y: Counter() for y in range(-64, 21)}
for x in range(X - RAD, X + RAD + 1):
    for z in range(Z - RAD, Z + RAD + 1):
        if not inside(x, z): continue
        for y in range(-64, 21):
            n = blk(x, y, z)
            if n is None: continue
            c = by[y]
            if n in DIAMOND: c['diamond'] += 1
            elif n == 'lava': c['lava'] += 1
            elif n in WET: c['water'] += 1
            elif n in AIRS: c['air'] += 1
            elif n in ('deepslate', 'tuff'): c['deep'] += 1
            elif n in ('redstone_ore', 'deepslate_redstone_ore'): c['redstone'] += 1
            elif n in ('lapis_ore', 'deepslate_lapis_ore'): c['lapis'] += 1
            elif n in ('iron_ore', 'deepslate_iron_ore'): c['iron'] += 1
            elif n == 'bedrock': c['bedrock'] += 1
            c['all'] += 1
print(f'Ground within {RAD} of {X},{Z} (world {W.src})')
print('   y  diamond  redstone  lapis  iron    lava   water    air   deepslate/tuff  bedrock  (of all)')
tot = Counter()
for y in range(-64, 21):
    c = by[y]
    tot.update(c)
    print(f'{y:4d}  {c["diamond"]:7d}  {c["redstone"]:8d}  {c["lapis"]:5d}  {c["iron"]:4d}  {c["lava"]:6d}  {c["water"]:6d}  {c["air"]:6d}  {c["deep"]:14d}  {c["bedrock"]:7d}  ({c["all"]})')
print(f'all: {tot["diamond"]} diamond ore, {tot["lava"]} lava, {tot["water"]} water, {tot["air"]} cave air')

# 2. Tunnels at a deep level
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]


def refused(x, y, z):
    """The mine's rule for a tunnel cell (unsafe(): a liquid in it or beside it; unloaded)."""
    n = blk(x, y, z)
    if n is None or n == 'air?': return 'unloaded'
    if n in WET or n == 'bedrock': return n
    for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)):
        q = blk(x + dx, y + dy, z + dz)
        if q in WET: return f'{q} beside'
    return None


def tunnel(x0, L, z0, d, n=24):
    """Cells dug, diamonds laid open, why it stopped."""
    seen, cells = set(), 0
    for k in range(1, n + 1):
        x, z = x0 + d[0] * k, z0 + d[1] * k
        if not inside(x, z): return cells, len(seen), 'range'
        floor = blk(x, L - 1, z)
        if not SOLIDISH(floor): return cells, len(seen), 'no floor'
        why = refused(x, L, z) or refused(x, L + 1, z)
        if why: return cells, len(seen), why
        cells += 1
        for y in (L, L + 1):
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)):
                q = (x + dx, y + dy, z + dz)
                if blk(*q) in DIAMOND: seen.add(q)
            if blk(x, y, z) in DIAMOND: seen.add((x, y, z))
    return cells, len(seen), 'full'


print('\nTunnels (24 cells, 2 high) from starts on a 3-grid within 60 of the mine, four directions:')
print('   L   tunnels  full  cells/tunnel  diamonds  per 100 cells  stopped by lava  by water  (why)')
random.seed(1)
for L in (-59, -58, -57, -56, -55, -54, -52, -50, -44):
    stats, whys = Counter(), Counter()
    for x0 in range(X - 60, X + 61, 3):
        for z0 in range(Z - 60, Z + 61, 3):
            if not inside(x0, z0): continue
            if refused(x0, L, z0) or refused(x0, L + 1, z0) or not SOLIDISH(blk(x0, L - 1, z0)): continue
            for d in DIRS:
                c, dmd, why = tunnel(x0, L, z0, d)
                stats['t'] += 1; stats['c'] += c; stats['d'] += dmd
                if why == 'full': stats['full'] += 1
                whys[why.split()[0]] += 1
    t = max(1, stats['t'])
    print(f'{L:4d}  {stats["t"]:8d}  {stats["full"] / t:4.0%}  {stats["c"] / t:12.1f}  {stats["d"]:8d}  {100 * stats["d"] / max(1, stats["c"]):13.2f}  {whys["lava"] / t:15.0%}  {whys["water"] / t:8.0%}  {dict(whys.most_common(4))}')


# 3. Stairs down
def stair_ok(x0, y0, z0, d, y1):
    """A straight stair from (x0, y0, z0) going d, one down a step, to level y1: every step's 3 cells (feet, head, the
    head room over) dry, nothing wet beside them, ground under each step."""
    steps = y0 - y1
    for k in range(1, steps + 1):
        x, z, y = x0 + d[0] * k, z0 + d[1] * k, y0 - k
        if not inside(x, z): return False, 'range'
        for yy in (y, y + 1, y + 2):
            why = refused(x, yy, z)
            if why: return False, why.split()[0]
        if not SOLIDISH(blk(x, y - 1, z)): return False, 'no ground'
    return True, ''


print('\nStraight stairs down (starts on a 4-grid within 40 of the mine, four directions):')
for y0 in (18, -8):
    for y1 in (-59, -58, -56, -54, -50, -40, -30):
        ok, n, whys = 0, 0, Counter()
        for x0 in range(X - 40, X + 41, 4):
            for z0 in range(Z - 40, Z + 41, 4):
                if not inside(x0, z0): continue
                for d in DIRS:
                    n += 1
                    good, why = stair_ok(x0, y0, z0, d, y1)
                    ok += good
                    if not good: whys[why] += 1
        print(f'  from y {y0:3d} to {y1:4d} ({y0 - y1} steps): {ok} of {n} clear ({ok / max(1, n):.0%}); stopped by {dict(whys.most_common(4))}')
