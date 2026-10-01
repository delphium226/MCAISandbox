"""Read blocks from the saved world, without any server (written by a log-analysis subagent on 2026-10-01 to check
Minevale2's tunnels while the agent server was down). It copies each region file it needs to the temp directory first
(Paper may hold the originals) and decodes the 1.18+ Anvil format: sections, block-state palettes, packed indices.
It sees only what was saved: chunks are written when they unload or on a clean stop (`python mc/rcon.py stop`), so
blocks changed in still-loaded chunks are missing. Useful for offline log analysis and for checking a test-world snapshot
(plan step T.2).
Usage: python scripts/checks/region_blocks.py X Y Z           (one block)
       python scripts/checks/region_blocks.py X1 Y1 Z1 X2 Y2 Z2  (counts of each block in the box)
As a module: `import region_blocks as R; R.block(x, y, z)` gives the block name ('air?' for a section never saved, None
for a chunk never saved).
"""
import struct, zlib, gzip, io, shutil, sys, os, math, tempfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'mc', 'server', 'world', 'dimensions', 'minecraft', 'overworld', 'region')
TMP = tempfile.mkdtemp(prefix='mcai-region-')


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


_regions, _chunks = {}, {}


def region(rx, rz):
    k = (rx, rz)
    if k not in _regions:
        src = f'{SRC}/r.{rx}.{rz}.mca'
        dst = f'{TMP}/r.{rx}.{rz}.mca'
        shutil.copyfile(src, dst)
        _regions[k] = open(dst, 'rb').read()
    return _regions[k]


def chunk(cx, cz):
    k = (cx, cz)
    if k in _chunks: return _chunks[k]
    data = region(cx >> 5, cz >> 5)
    i = (cx & 31) + (cz & 31) * 32
    off = int.from_bytes(data[i * 4:i * 4 + 3], 'big')
    if off == 0:
        _chunks[k] = None; return None
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
    _chunks[k] = secs
    return secs


def block(x, y, z):
    secs = chunk(x >> 4, z >> 4)
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


if __name__ == '__main__':
    a = list(map(int, sys.argv[1:]))
    if len(a) == 3:
        print(block(*a))
    elif len(a) == 6:
        x1, x2 = sorted((a[0], a[3])); y1, y2 = sorted((a[1], a[4])); z1, z2 = sorted((a[2], a[5]))
        c = Counter(block(x, y, z) for x in range(x1, x2 + 1) for y in range(y1, y2 + 1) for z in range(z1, z2 + 1))
        for name, n in c.most_common():
            print(f'{n:7} {name}')
    else:
        sys.exit(__doc__)
