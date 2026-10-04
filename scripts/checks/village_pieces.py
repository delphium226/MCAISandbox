"""Offline survey of the vanilla village pieces in the Paper jar (phase D, vanilla villages): for each piece its size
(x by z by height), block count, commonest blocks and jigsaw count, and every block kind over all the kinds named.
Usage: python scripts/checks/village_pieces.py [KIND ...]   e.g. plains/houses plains/town_centers savanna/houses
No server; the pieces are read from mc/server's Paper jar and never copied out."""
import gzip, io, struct, sys, zipfile, collections

JAR = 'mc/server/versions/26.1.2/paper-26.1.2.jar'


def read_nbt(data):
    f = io.BytesIO(gzip.decompress(data))

    def rd(n): return f.read(n)

    def payload(t):
        if t == 1: return struct.unpack('>b', rd(1))[0]
        if t == 2: return struct.unpack('>h', rd(2))[0]
        if t == 3: return struct.unpack('>i', rd(4))[0]
        if t == 4: return struct.unpack('>q', rd(8))[0]
        if t == 5: return struct.unpack('>f', rd(4))[0]
        if t == 6: return struct.unpack('>d', rd(8))[0]
        if t == 7: n = struct.unpack('>i', rd(4))[0]; return rd(n)
        if t == 8: n = struct.unpack('>H', rd(2))[0]; return rd(n).decode('utf-8', 'replace')
        if t == 9:
            et = rd(1)[0]; n = struct.unpack('>i', rd(4))[0]
            return [payload(et) for _ in range(n)]
        if t == 10:
            out = {}
            while True:
                tt = rd(1)[0]
                if tt == 0: return out
                nl = struct.unpack('>H', rd(2))[0]; name = rd(nl).decode('utf-8', 'replace')
                out[name] = payload(tt)
        if t == 11: n = struct.unpack('>i', rd(4))[0]; return list(struct.unpack(f'>{n}i', rd(4 * n)))
        if t == 12: n = struct.unpack('>i', rd(4))[0]; return list(struct.unpack(f'>{n}q', rd(8 * n)))
        raise ValueError(t)
    t = rd(1)[0]; nl = struct.unpack('>H', rd(2))[0]; rd(nl)
    return payload(t)


z = zipfile.ZipFile(JAR)
kinds = sys.argv[1:] or ['plains/houses', 'plains/town_centers', 'plains/streets', 'savanna/houses', 'taiga/houses']
allblocks = collections.Counter()
for kind in kinds:
    names = sorted(n for n in z.namelist() if n.startswith(f'data/minecraft/structure/village/{kind}/') and n.endswith('.nbt'))
    print(f'== {kind}: {len(names)}')
    for n in names:
        t = read_nbt(z.read(n))
        pal = t['palette'] if 'palette' in t else t['palettes'][0]
        bl = collections.Counter()
        jig = 0
        for b in t['blocks']:
            name = pal[b['state']]['Name'].replace('minecraft:', '')
            if name == 'jigsaw': jig += 1
            if name in ('air', 'structure_void', 'jigsaw'): continue
            bl[name] += 1
        allblocks.update(bl)
        sx, sy, sz = t['size']
        top = ', '.join(f'{k} {v}' for k, v in bl.most_common(5))
        print(f'  {n.split("/")[-1][:-4]:34} {sx}x{sz}x{sy}  {sum(bl.values()):4} blocks, {jig} jigsaw  | {top}')
print('\nall kinds of block, by count:')
print(', '.join(f'{k} {v}' for k, v in allblocks.most_common(60)))
