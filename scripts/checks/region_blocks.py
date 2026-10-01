"""Read blocks from the saved world, without any server (written by a log-analysis subagent on 2026-10-01 to check
Minevale2's tunnels while the agent server was down). It copies each region file it needs to the temp directory first
(Paper may hold the originals) and decodes the 1.18+ Anvil format: sections, block-state palettes, packed indices.
It sees only what was saved: chunks are written when they unload or on a clean stop (`python mc/rcon.py stop`), so
blocks changed in still-loaded chunks are missing. Useful for offline log analysis and for checking a test-world snapshot
(plan step T.2).
Usage: python scripts/checks/region_blocks.py [--world WORLD] X Y Z           (one block)
       python scripts/checks/region_blocks.py [--world WORLD] X1 Y1 Z1 X2 Y2 Z2  (counts of each block in the box)
       python scripts/checks/region_blocks.py [--world WORLD] --compare OTHER X1 Y1 Z1 X2 Y2 Z2
                                             (blocks that differ between two worlds in the box, with up to 20 examples:
                                             e.g. a restored test site against its snapshot, --world mc/testserver/world
                                             --compare mc/testworld/world)
WORLD and OTHER are world folders (the one holding level.dat) or server folders holding world/, absolute or relative to
the repository. The default is MC_SERVER_DIR's world when that is set, else mc/server/world.
As a module: `import region_blocks as R; R.block(x, y, z)` gives the block name ('air?' for a section never saved, None
for a chunk never saved); `R.World(path).block(x, y, z)` reads another world.
"""
import struct, zlib, gzip, io, shutil, sys, os, math, tempfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix='mcai-region-')


def region_dir(path):
    """The overworld region folder of a world folder, or of a server folder's world/."""
    if not os.path.isabs(path) and not os.path.exists(path):
        path = os.path.join(ROOT, path)
    for world in (path, os.path.join(path, 'world')):
        d = os.path.join(world, 'dimensions', 'minecraft', 'overworld', 'region')
        if os.path.isdir(d):
            return d
    sys.exit(f'no world at {path} (no dimensions/minecraft/overworld/region in it or in its world/)')


def read_nbt(buf):
    f = io.BytesIO(buf)

    def rd(n):
        return f.read(n)

    def payload(t):
        if t == 1: return struct.unpack('>b', rd(1))[0]
        if t == 2: return struct.unpack('>h', rd(2))[0]
        if t == 3: return struct.unpack('>i', rd(4))[0]
        if t == 4: return struct.unpack('>q', rd(8))[0]
        if t == 5: return struct.unpack('>f', rd(4))[0]
        if t == 6: return struct.unpack('>d', rd(8))[0]
        if t == 7:
            n = struct.unpack('>i', rd(4))[0]; return rd(n)
        if t == 8:
            n = struct.unpack('>H', rd(2))[0]; return rd(n).decode('utf-8', 'replace')
        if t == 9:
            et = rd(1)[0]; n = struct.unpack('>i', rd(4))[0]
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = rd(1)[0]
                if tt == 0: return d
                nl = struct.unpack('>H', rd(2))[0]; name = rd(nl).decode('utf-8', 'replace')
                d[name] = payload(tt)
        if t == 11:
            n = struct.unpack('>i', rd(4))[0]; return list(struct.unpack('>%di' % n, rd(4 * n)))
        if t == 12:
            n = struct.unpack('>i', rd(4))[0]; return list(struct.unpack('>%dq' % n, rd(8 * n)))
        raise ValueError(t)

    t = rd(1)[0]
    nl = struct.unpack('>H', rd(2))[0]; rd(nl)
    return payload(t)


class World:
    """One world's saved blocks, read from copies of its region files (a missing region file reads as chunks never saved)."""

    def __init__(self, path):
        self.src = region_dir(path)
        self.tmp = tempfile.mkdtemp(prefix='w', dir=TMP)
        self._regions, self._chunks = {}, {}

    def region(self, rx, rz):
        k = (rx, rz)
        if k not in self._regions:
            src = f'{self.src}/r.{rx}.{rz}.mca'
            dst = f'{self.tmp}/r.{rx}.{rz}.mca'
            if os.path.exists(src):
                shutil.copyfile(src, dst)
                self._regions[k] = open(dst, 'rb').read()
            else:
                self._regions[k] = None
        return self._regions[k]

    def chunk(self, cx, cz):
        k = (cx, cz)
        if k in self._chunks: return self._chunks[k]
        data = self.region(cx >> 5, cz >> 5)
        i = (cx & 31) + (cz & 31) * 32
        off = int.from_bytes(data[i * 4:i * 4 + 3], 'big') if data else 0
        if off == 0:
            self._chunks[k] = None; return None
        p = off * 4096
        ln = struct.unpack('>i', data[p:p + 4])[0]
        comp = data[p + 4]
        raw = data[p + 5:p + 4 + ln]
        raw = zlib.decompress(raw) if comp == 2 else gzip.decompress(raw) if comp == 1 else raw
        nbt = read_nbt(raw)
        secs = {}
        for s in nbt.get('sections', []):
            bs = s.get('block_states')
            if not bs: continue
            pal = [e['Name'].replace('minecraft:', '') for e in bs['palette']]
            secs[s['Y']] = (pal, bs.get('data'))
        self._chunks[k] = secs
        return secs

    def block(self, x, y, z):
        secs = self.chunk(x >> 4, z >> 4)
        if secs is None: return None
        sy = y >> 4
        if sy not in secs: return 'air?'
        pal, data = secs[sy]
        if not data or len(pal) == 1: return pal[0]
        bits = max(4, math.ceil(math.log2(len(pal))))
        per = 64 // bits
        idx = ((y & 15) * 16 + (z & 15)) * 16 + (x & 15)
        word = data[idx // per] & ((1 << 64) - 1)
        v = (word >> ((idx % per) * bits)) & ((1 << bits) - 1)
        return pal[v]


def default_world():
    server = os.environ.get('MC_SERVER_DIR')
    return os.path.join(server, 'world') if server else os.path.join(ROOT, 'mc', 'server', 'world')


_default = None


def block(x, y, z):
    """A block of the default world (MC_SERVER_DIR's, else mc/server's)."""
    global _default
    if _default is None:
        _default = World(default_world())
    return _default.block(x, y, z)


def compare(a, b, x1, y1, z1, x2, y2, z2, examples=20):
    """Blocks that differ between worlds a and b in the box: section by section, skipping sections saved identically."""
    same = lambda n: 'air' if n == 'air?' else n
    diff, pairs, shown, missing = 0, Counter(), [], []
    for cx in range(x1 >> 4, (x2 >> 4) + 1):
        for cz in range(z1 >> 4, (z2 >> 4) + 1):
            ca, cb = a.chunk(cx, cz), b.chunk(cx, cz)
            if ca is None or cb is None:
                if (ca is None) != (cb is None):
                    missing.append(f'chunk {cx},{cz} never saved in {"the first" if ca is None else "the other"} world')
                continue
            xs = range(max(x1, cx * 16), min(x2, cx * 16 + 15) + 1)
            zs = range(max(z1, cz * 16), min(z2, cz * 16 + 15) + 1)
            for sy in range(y1 >> 4, (y2 >> 4) + 1):
                if sy in ca and sy in cb and ca[sy] == cb[sy]:
                    continue
                for y in range(max(y1, sy * 16), min(y2, sy * 16 + 15) + 1):
                    for x in xs:
                        for z in zs:
                            na, nb = same(a.block(x, y, z)), same(b.block(x, y, z))
                            if na != nb:
                                diff += 1
                                pairs[(na, nb)] += 1
                                if len(shown) < examples:
                                    shown.append(f'{x} {y} {z}: {na} -> {nb}')
    return diff, pairs, shown, missing


if __name__ == '__main__':
    args = sys.argv[1:]
    world, other = default_world(), None
    if '--world' in args:
        i = args.index('--world'); world = args[i + 1]; del args[i:i + 2]
    if '--compare' in args:
        i = args.index('--compare'); other = args[i + 1]; del args[i:i + 2]
    try:
        a = list(map(int, args))
    except ValueError:
        sys.exit(__doc__)
    if other and len(a) == 6:
        x1, x2 = sorted((a[0], a[3])); y1, y2 = sorted((a[1], a[4])); z1, z2 = sorted((a[2], a[5]))
        diff, pairs, shown, missing = compare(World(world), World(other), x1, y1, z1, x2, y2, z2)
        total = (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1)
        print(f'{diff} of {total} blocks differ ({world} -> {other})')
        for (na, nb), n in pairs.most_common(20):
            print(f'{n:7} {na} -> {nb}')
        for line in shown:
            print(f'  {line}')
        for line in missing:
            print(f'  {line}')
    elif not other and len(a) == 3:
        print(World(world).block(*a))
    elif not other and len(a) == 6:
        w = World(world)
        x1, x2 = sorted((a[0], a[3])); y1, y2 = sorted((a[1], a[4])); z1, z2 = sorted((a[2], a[5]))
        c = Counter(w.block(x, y, z) for x in range(x1, x2 + 1) for y in range(y1, y2 + 1) for z in range(z1, z2 + 1))
        for name, n in c.most_common():
            print(f'{n:7} {name}')
    else:
        sys.exit(__doc__)
