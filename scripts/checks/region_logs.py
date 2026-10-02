"""Logs (with their axis) and leaves in a box of the saved world, each with the block under it; no server needed
(written 2026-10-02 for F94: a fallen tree is a row of logs lying along x or z, its stump one upright log).
Usage: python scripts/checks/region_logs.py WORLD X1 Y1 Z1 X2 Y2 Z2 (e.g. mc/testworld/world -1712 64 -246 -1698 72 -232)
WORLD as region_blocks.py --world. Only saved chunks.
"""
import sys, os, math, struct, zlib, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R


class W(R.World):
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
        nbt = R.read_nbt(raw)
        secs = {}
        for s in nbt.get('sections', []):
            bs = s.get('block_states')
            if not bs: continue
            pal = []
            for e in bs['palette']:
                n = e['Name'].replace('minecraft:', '')
                ax = (e.get('Properties') or {}).get('axis')
                pal.append(n + (f'[{ax}]' if ax else ''))
            secs[s['Y']] = (pal, bs.get('data'))
        self._chunks[k] = secs
        return secs


w = W(sys.argv[1])
x1, y1, z1, x2, y2, z2 = map(int, sys.argv[2:8])
for y in range(min(y1, y2), max(y1, y2) + 1):
    for z in range(min(z1, z2), max(z1, z2) + 1):
        for x in range(min(x1, x2), max(x1, x2) + 1):
            b = w.block(x, y, z)
            if b and ('_log' in b or 'leaves' in b):
                print(x, y, z, b, 'on', w.block(x, y - 1, z))
