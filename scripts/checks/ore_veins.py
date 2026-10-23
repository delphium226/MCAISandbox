"""Iron veins around a saved mine (#100, G8, 10-23): what a mine left of the iron it laid open, read from the region files.

Compares a checkpoint's world (the mine dug) with the test-world snapshot it was restored from (the land before), in a
box round the mine: cells solid before and open now are the mine's dug cells; iron ore (iron_ore, deepslate_iron_ore)
then and now says what was mined. It counts:
  - iron mined: ore in the snapshot that is not ore now (taken, or a floor ore's hole filled with cobblestone);
  - iron exposed and left: ore now with a face open to a dug cell (seen in a wall, floor or ceiling, never taken);
  - the veins: 26-connected groups of the snapshot's iron (diagonals included, as a player sees a vein) that the mine
    touched (a block mined or exposed), with their size, what was taken and what is left of each;
  - the same per level (y of the dug cells' floor).
Usage: python scripts/checks/ore_veins.py [CHECKPOINT_WORLD] [SNAPSHOT_WORLD] [X Z] [--r R] [--y1 Y]
       (defaults: mc/testcheckpoints/im2_mine/world, mc/testworld, the mine at -1618,34, r 90, dug cells below y 56)
As a module: `grid(world, cx, cz, r, y0, y1)` gives (ids, names) for the box: ids a numpy int32 array [x, y, z].
"""
import math, sys, os
from collections import Counter, deque
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as RB

IRON = ('iron_ore', 'deepslate_iron_ore')
AIRS = ('air', 'cave_air', 'air?', 'void_air')


def grid(world, CX, CZ, R, Y0, Y1):
    """The box's blocks as global ids (names[id]); a chunk never saved reads as 'missing'."""
    W = RB.World(world)
    names, index = ['missing'], {'missing': 0}

    def gid(n):
        if n not in index: index[n] = len(names); names.append(n)
        return index[n]
    NX = NZ = 2 * R + 1
    G = np.zeros((NX, Y1 - Y0 + 1, NZ), dtype=np.int32)
    for cx in range((CX - R) >> 4, ((CX + R) >> 4) + 1):
        for cz in range((CZ - R) >> 4, ((CZ + R) >> 4) + 1):
            secs = W.chunk(cx, cz)
            if not secs: continue
            for sy, (pal, data) in secs.items():
                if sy * 16 > Y1 or sy * 16 + 15 < Y0: continue
                codes = np.array([gid(p) for p in pal], dtype=np.int32)
                if not data or len(pal) == 1:
                    blk = np.full(4096, codes[0], dtype=np.int32)
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
    return G, names


def mask(G, names, want):
    ids = [i for i, n in enumerate(names) if n in want]
    return np.isin(G, ids)


N6 = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
N26 = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]


def shift_any(m, dirs):
    """Cells with a neighbour (in dirs) set in m."""
    out = np.zeros_like(m)
    for dx, dy, dz in dirs:
        s = np.roll(m, (dx, dy, dz), axis=(0, 1, 2))
        out |= s
    return out


def components(m):
    """26-connected groups of m's cells: a label array (0 none) and the count."""
    lab = np.zeros(m.shape, dtype=np.int32)
    n = 0
    for p in zip(*np.nonzero(m)):
        if lab[p]: continue
        n += 1
        lab[p] = n
        q = deque([p])
        while q:
            x, y, z = q.popleft()
            for dx, dy, dz in N26:
                r = (x + dx, y + dy, z + dz)
                if 0 <= r[0] < m.shape[0] and 0 <= r[1] < m.shape[1] and 0 <= r[2] < m.shape[2] and m[r] and not lab[r]:
                    lab[r] = n
                    q.append(r)
    return lab, n


def main():
    argv = sys.argv[1:]
    opt = lambda k, d: (float(argv[argv.index(k) + 1]) if k in argv else d)
    R, YTOP = int(opt('--r', 90)), int(opt('--y1', 56))
    pos = []
    skip = False
    for i, a in enumerate(argv):
        if skip: skip = False; continue
        if a.startswith('--'): skip = True; continue
        pos.append(a)
    now_w = pos[0] if pos else 'mc/testcheckpoints/im2_mine/world'
    snap_w = pos[1] if len(pos) > 1 else 'mc/testworld'
    CX, CZ = (int(pos[2]), int(pos[3])) if len(pos) > 3 else (-1618, 34)
    Y0, Y1 = -16, YTOP + 4
    now, nn = grid(now_w, CX, CZ, R, Y0, Y1)
    snap, sn = grid(snap_w, CX, CZ, R, Y0, Y1)
    missing = (now == 0) | (snap == 0)
    iron0 = mask(snap, sn, IRON) & ~missing
    iron1 = mask(now, nn, IRON) & ~missing
    air0 = mask(snap, sn, AIRS)
    air1 = mask(now, nn, AIRS)
    ys = np.arange(Y0, Y1 + 1)[None, :, None]
    dug = air1 & ~air0 & ~missing & (ys < YTOP)
    print(f'box {CX},{CZ} r {R}, y {Y0}..{Y1}; now {now_w}, before {snap_w}')
    print(f'dug blocks (solid before, open now, below y {YTOP}): {int(dug.sum())} ({int(dug.sum()) // 2} two-high cells about)')
    # (everything else that changed below YTOP, before -> after: holes filled, other ores taken, fluids)
    # (the two grids number their names apart: now's ids put in snap's numbering first)
    for n in nn:
        if n not in sn: sn.append(n)
    same = np.array([sn.index(n) for n in nn], dtype=np.int32)[now] == snap
    other = ~same & ~missing & ~dug & (ys < YTOP)
    if other.any():
        pairs = Counter(f'{sn[a]} -> {nn[b]}' for a, b in zip(snap[other].tolist(), now[other].tolist()))
        print(f'other changes below y {YTOP}: {int(other.sum())}: ' + ', '.join(f'{k} {n}' for k, n in pairs.most_common(12)))
    mined = iron0 & ~iron1 & (ys < YTOP + 2)
    exposed = iron1 & shift_any(dug, N6)
    print(f'iron ore before in the box: {int(iron0.sum())}; mined: {int(mined.sum())}; exposed (a face open to a dug cell) and left: {int(exposed.sum())}')
    # (what the open faces show: each exposed ore by the side of the dug cell it faces)
    side = Counter()
    for dx, dy, dz, name in [(0, -1, 0, 'floor'), (0, 1, 0, 'ceiling'), (1, 0, 0, 'wall'), (-1, 0, 0, 'wall'), (0, 0, 1, 'wall'), (0, 0, -1, 'wall')]:
        # (rolled by d, nb[p] = dug[p - d]: d=(0,-1,0) means the dug cell is above the ore, the ore in the floor)
        nb = np.roll(dug, (dx, dy, dz), axis=(0, 1, 2))
        side[name] += int((exposed & nb).sum())
    print(f'  faces that show them (an ore may show on several): {dict(side)}')
    if '--list' in argv:
        for p in zip(*np.nonzero(exposed)):
            x, y, z = p[0] + CX - R, p[1] + Y0, p[2] + CZ - R
            sides = [n for dx, dy, dz, n in [(0, 1, 0, 'above'), (0, -1, 0, 'below'), (1, 0, 0, 'x+'), (-1, 0, 0, 'x-'), (0, 0, 1, 'z+'), (0, 0, -1, 'z-')]
                     if 0 <= p[1] + dy < dug.shape[1] and dug[p[0] + dx, p[1] + dy, p[2] + dz]]
            print(f'    {nn[now[p]]} at {x},{y},{z}: dug {",".join(sides)}')
    # (ore one block in: not open to a dug cell, but 26-touching an exposed or mined ore)
    lab, n = components(iron0)
    touched = set(np.unique(lab[(mined | exposed) & (lab > 0)]).tolist()) - {0}
    sizes, rows = Counter(), []
    for k in touched:
        cells = lab == k
        size, took, left = int(cells.sum()), int((cells & mined).sum()), int((cells & iron1).sum())
        rows.append((size, took, left, int((cells & exposed).sum())))
    rows.sort(reverse=True)
    allsizes = np.bincount(lab[lab > 0])[1:]
    print(f'veins in the box (26-connected): {n}, mean size {allsizes.mean():.2f}, sizes {dict(sorted(Counter(allsizes.tolist()).items()))}')
    tot = [sum(r[i] for r in rows) for i in range(4)]
    print(f'veins the mine touched: {len(rows)}; their ore {tot[0]}, taken {tot[1]}, left {tot[2]} (of it exposed {tot[3]}, '
          f'one block or more in {tot[2] - tot[3]})')
    full = sum(1 for r in rows if r[2] == 0)
    part = sum(1 for r in rows if r[1] > 0 and r[2] > 0)
    none = sum(1 for r in rows if r[1] == 0)
    print(f'  wholly taken {full}, partly taken {part}, seen but none taken {none}')
    print(f'  touched vein sizes: {dict(sorted(Counter(r[0] for r in rows).items()))}')
    print('  largest: ' + ', '.join(f'{s} ({t} taken, {l} left)' for s, t, l, _ in rows[:12]))
    # Per level: dug blocks, mined, exposed, by the y of the dug cells (a level's cells are L and L+1)
    print('by y (dug blocks / iron mined / exposed and left at that y):')
    for j in range(dug.shape[1]):
        d, mi, ex = int(dug[:, j, :].sum()), int(mined[:, j, :].sum()), int(exposed[:, j, :].sum())
        if d or mi or ex: print(f'  y {Y0 + j:4d}: {d:5d} {mi:4d} {ex:4d}')


if __name__ == '__main__':
    main()
