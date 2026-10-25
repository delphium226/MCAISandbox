"""Animals and flowers the land holds round each test site (#139, #140; lesson 99: count what the land holds before
building for it). Reads a saved world offline (default the pristine test world, mc/testworld): the entity region files
for animals by kind, and the block sections for flowers by kind (only sections whose palette names a flower are
decoded). Counts within each site's radius (default 160) of its site (else its probe) in scripts/test_sites.json.
Usage: python scripts/checks/land_life.py [--world WORLD] [--radius R] [SITE ...]
Prints one block a site: animals by kind (nearest distance), flowers by kind (nearest distance).
"""
import os, sys, json, math, struct, zlib, gzip
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import region_blocks as R  # noqa: E402

ROOT = R.ROOT
ANIMALS = {'chicken', 'cow', 'sheep', 'pig', 'rabbit', 'goat', 'horse', 'donkey', 'llama', 'mooshroom', 'fox', 'wolf', 'cat',
           'turtle', 'bee', 'frog', 'armadillo', 'camel', 'panda', 'parrot', 'ocelot', 'polar_bear', 'mule', 'sniffer', 'axolotl'}
FLOWERS = {'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
           'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'sunflower', 'lilac', 'rose_bush', 'peony',
           'pink_petals', 'wildflowers', 'open_eyeblossom', 'closed_eyeblossom', 'cactus_flower'}


def raw_chunk(data, cx, cz):
    i = (cx & 31) + (cz & 31) * 32
    off = int.from_bytes(data[i * 4:i * 4 + 3], 'big') if data else 0
    if off == 0: return None
    p = off * 4096
    ln = struct.unpack('>i', data[p:p + 4])[0]
    comp = data[p + 4]
    raw = data[p + 5:p + 4 + ln]
    raw = zlib.decompress(raw) if comp == 2 else gzip.decompress(raw) if comp == 1 else raw
    return R.read_nbt(raw)


def read_file(path):
    return open(path, 'rb').read() if os.path.exists(path) else None


def scan(world, cx0, cz0, radius):
    reg = R.region_dir(world)
    ent = os.path.join(os.path.dirname(reg), 'entities')
    animals, flowers = Counter(), Counter()
    near_a, near_f = {}, {}
    files = {}
    for cx in range((cx0 - radius) >> 4, ((cx0 + radius) >> 4) + 1):
        for cz in range((cz0 - radius) >> 4, ((cz0 + radius) >> 4) + 1):
            mx, mz = cx * 16 + 8 - cx0, cz * 16 + 8 - cz0
            if math.hypot(mx, mz) > radius + 12: continue
            rk = (cx >> 5, cz >> 5)
            for kind, d in (('e', ent), ('r', reg)):
                if (kind, rk) not in files: files[(kind, rk)] = read_file(f'{d}/r.{rk[0]}.{rk[1]}.mca')
            e = raw_chunk(files[('e', rk)], cx, cz)
            for en in (e or {}).get('Entities', []):
                name = str(en.get('id', '')).replace('minecraft:', '')
                if name not in ANIMALS: continue
                pos = en.get('Pos') or [0, 0, 0]
                dist = math.hypot(pos[0] - cx0, pos[2] - cz0)
                if dist > radius: continue
                animals[name] += 1
                near_a[name] = min(near_a.get(name, 1e9), dist)
            c = raw_chunk(files[('r', rk)], cx, cz)
            for s in (c or {}).get('sections', []):
                bs = s.get('block_states')
                if not bs: continue
                pal = [p['Name'].replace('minecraft:', '') for p in bs['palette']]
                want = [i for i, n in enumerate(pal) if n in FLOWERS]
                if not want: continue
                data = bs.get('data')
                bits = max(4, math.ceil(math.log2(len(pal)))) if len(pal) > 1 else 0
                per = 64 // bits if bits else 0
                for idx in range(4096):
                    if not data: v = 0
                    else:
                        word = data[idx // per] & ((1 << 64) - 1)
                        v = (word >> ((idx % per) * bits)) & ((1 << bits) - 1)
                    if v not in want: continue
                    x, z = cx * 16 + (idx & 15), cz * 16 + ((idx >> 4) & 15)
                    dist = math.hypot(x - cx0, z - cz0)
                    if dist > radius: continue
                    flowers[pal[v]] += 1
                    near_f[pal[v]] = min(near_f.get(pal[v], 1e9), dist)
    return animals, near_a, flowers, near_f


def main():
    args = sys.argv[1:]
    world, radius = os.path.join(ROOT, 'mc', 'testworld', 'world'), None
    if '--world' in args:
        i = args.index('--world'); world = args[i + 1]; del args[i:i + 2]
    if '--radius' in args:
        i = args.index('--radius'); radius = int(args[i + 1]); del args[i:i + 2]
    sites = json.load(open(os.path.join(ROOT, 'scripts', 'test_sites.json')))['sites']
    for s in sites:
        if args and s['name'] not in args: continue
        c = s.get('site') or s['probe']
        r = radius or s.get('radius', 160)
        animals, na, flowers, nf = scan(world, c['x'], c['z'], r)
        print(f"{s['name']} ({c['x']},{c['z']}, r {r}):")
        print('  animals: ' + (', '.join(f'{k} {n} ({round(na[k])})' for k, n in animals.most_common()) or 'none'))
        print('  flowers: ' + (', '.join(f'{k} {n} ({round(nf[k])})' for k, n in flowers.most_common()) or 'none'))


if __name__ == '__main__':
    main()
