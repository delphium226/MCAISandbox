"""The land around a checkpoint's village for the simulator (s42, F262: real public works stopped at "no free 20x20 site
within 80 blocks (wet, steep, taken)", and the sim, which placed them by geometry alone, never ran out of room).
Reads the checkpoint's saved region files (scripts/checks/region_blocks.py) and writes CHECKPOINT/land.json: for every
column within R blocks of the village's home, the top ground's y (trees, leaves and plants passed over: the preparers fell
them) and whether water tops it. Each column's scan starts at the chunk's MOTION_BLOCKING_NO_LEAVES heightmap.
Usage: python scripts/sim/land.py CHECKPOINT_DIR [R]       (default R 120; about a minute)
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'checks'))
import region_blocks as R  # noqa: E402

if len(sys.argv) < 2:
    raise SystemExit(__doc__)
cp = sys.argv[1]
radius = int(sys.argv[2]) if len(sys.argv) > 2 else 120
data = json.load(open(os.path.join(cp, 'villages.json'), encoding='utf-8'))
v = next((x for x in data['villages'] if x.get('complete')), data['villages'][0])
chest = (v.get('storage') or {}).get('chests') or []
if chest:
    hx, hz = chest[0]['x'], chest[0]['z']
else:
    p = v['plots'][0]
    hx, hz = (p['x1'] + p['x2']) // 2, (p['z1'] + p['z2']) // 2
w = R.World(os.path.join(cp, 'world'))
SOFT = ('leaves', 'log', 'wood', 'grass', 'fern', 'flower', 'bush', 'vine', 'mushroom', 'sapling', 'torch', 'dandelion',
        'poppy', 'snow', 'litter', 'dead_bush', 'sugar_cane', 'bamboo', 'cactus', 'kelp', 'seagrass', 'lily_pad', 'pumpkin',
        'melon', 'berry')
AIR = ('air', 'cave_air', 'void_air', 'air?')
heights = {}


def heightmap(cx, cz):
    """The chunk's MOTION_BLOCKING_NO_LEAVES as 256 tops (x + 16 z), or None."""
    k = (cx, cz)
    if k in heights:
        return heights[k]
    raw = w.region(cx >> 5, cz >> 5)
    out = None
    if raw:
        import struct, zlib, gzip
        i = (cx & 31) + (cz & 31) * 32
        off = int.from_bytes(raw[i * 4:i * 4 + 3], 'big')
        if off:
            p = off * 4096
            ln = struct.unpack('>i', raw[p:p + 4])[0]
            comp = raw[p + 4]
            body = raw[p + 5:p + 4 + ln]
            body = zlib.decompress(body) if comp == 2 else gzip.decompress(body) if comp == 1 else body
            hm = (R.read_nbt(body).get('Heightmaps') or {}).get('MOTION_BLOCKING_NO_LEAVES')
            if hm:
                out = []
                for word in hm:
                    word &= (1 << 64) - 1
                    for j in range(7):
                        out.append((word >> (9 * j)) & 511)
                out = [h - 64 for h in out[:256]]
    heights[k] = out
    return out


x0, z0, n = hx - radius, hz - radius, 2 * radius + 1
ys, wet = [], []
for z in range(z0, z0 + n):
    for x in range(x0, x0 + n):
        hm = heightmap(x >> 4, z >> 4)
        top, water = None, False
        if hm:
            y = hm[(x & 15) + 16 * (z & 15)]
            for yy in range(y, y - 40, -1):
                b = w.block(x, yy, z)
                if b is None:
                    break
                if b in AIR or any(s in b for s in SOFT):
                    continue
                if 'water' in b or b == 'ice' or 'lava' in b:
                    water = True
                top = yy
                break
        ys.append(top if top is not None else -999)
        wet.append(1 if water else 0)
out = {'home': [hx, hz], 'x0': x0, 'z0': z0, 'n': n, 'y': ys, 'wet': wet}
json.dump(out, open(os.path.join(cp, 'land.json'), 'w'), separators=(',', ':'))
print(f'land.json: {n}x{n} columns around {hx},{hz}; wet {sum(wet)}, unread {sum(1 for y in ys if y == -999)}')
