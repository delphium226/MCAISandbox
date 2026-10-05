"""Block colours averaged from the textures in the user's Minecraft client jar (V2.5, for render_design.py's renderer).
Read at run time from the local jar and kept in memory only: Mojang's textures, and any table made from them, never go
into the repo (a cache, if one is ever wanted, belongs under runs/ or outside the repo).

block_colours(names=None) -> {block name: (top RGB, side RGB)} for the named blocks (or every block in the jar), each
colour the average of the faces the block's model shows from above and from the sides: block name -> blockstate
(assets/minecraft/blockstates/NAME.json; a variant with its axis upright, or the multipart's unconditional parts) ->
model with its parents -> each element face's texture (cropped to its uv), averaged over its pixels weighted by alpha
(cutouts such as leaves count only drawn pixels; animated textures average every frame). Faces on one box drawn over
each other (grass_block's side overlay) are composited first. Faces with a tintindex are multiplied by the colour the
game's code gives that block (grass and foliage from the biome's colour maps, fixed spruce/birch/mangrove foliage,
the biome's water colour, lily pads); other tinted faces (cherry and pale oak leaves, whose textures are coloured) are
left as drawn. Blocks with no model elements (water, lava, chests, beds) use their particle texture, chests and beds
their entity texture. block_alpha(name) gives the mean coverage (0-255) for translucent blocks.

The jar: MC_CLIENT_JAR, or %APPDATA%\\.minecraft\\versions\\26.1.2\\26.1.2.jar (the server's version; Paper's jar has no
textures). Biome for the tints: MC_COLOUR_BIOME (default plains), read from the jar's worldgen data. Without the jar
block_colours returns {} and callers keep their own colours.

python scripts/vanilla_colours.py [DESIGN_DIR_OR_JSON ...] [--villages mc/server/villages.json] [--all]
prints, for every name render_design.hand_colour() knows and every name in the given designs, the hand colour against the
averaged one with a distance (CIE76 delta E: under ~10 close, over ~25 clearly different), then the names the hand table
does not know (they get a hashed colour today).
"""
import io, json, math, os, re, sys, zipfile
from functools import lru_cache
from PIL import Image

DEFAULT_JAR = os.path.join(os.environ.get('APPDATA', ''), '.minecraft', 'versions', '26.1.2', '26.1.2.jar')
JAR = os.environ.get('MC_CLIENT_JAR', DEFAULT_JAR)
BIOME = os.environ.get('MC_COLOUR_BIOME', 'plains')
A = 'assets/minecraft/'

# Tints come from the game's code (BlockColors), not from the jar's data: which colour source each tinted block uses.
GRASS = {'grass_block', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'potted_fern', 'sugar_cane', 'bush',
         'pink_petals', 'wildflowers', 'attached_pumpkin_stem', 'attached_melon_stem'}
FOLIAGE = {'oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine'}
FIXED = {'spruce_leaves': 0x619961, 'birch_leaves': 0x80A755, 'mangrove_leaves': 0x92C648, 'lily_pad': 0x208030,
         'pumpkin_stem': 0x9CB23F, 'melon_stem': 0x9CB23F, 'redstone_wire': 0x7A0000}  # stems and wire at mid age/power
WATER = {'water', 'water_cauldron', 'bubble_column'}
DRY_FOLIAGE = {'leaf_litter'}
ENTITY = {'chest': 'entity/chest/normal', 'trapped_chest': 'entity/chest/trapped', 'ender_chest': 'entity/chest/ender'}


@lru_cache(None)
def _zip():
    return zipfile.ZipFile(JAR) if os.path.isfile(JAR) else None


def has_jar(): return _zip() is not None


def _read(path):
    z = _zip()
    try: return z.read(path)
    except KeyError: return None


def _json(path):
    b = _read(path)
    return json.loads(b) if b else None


def _id(ref):  # "minecraft:block/oak_planks" or "block/oak_planks" -> "block/oak_planks"
    return ref.split(':', 1)[-1]


@lru_cache(None)
def _texture(ref):
    b = _read(A + 'textures/' + _id(ref) + '.png')
    return Image.open(io.BytesIO(b)).convert('RGBA') if b else None


def _hex(v): return int(v.lstrip('#'), 16) if isinstance(v, str) else v


@lru_cache(None)
def _biome():
    j = _json(f'data/minecraft/worldgen/biome/{BIOME}.json') or {}
    return j.get('temperature', 0.8), j.get('downfall', 0.4), j.get('effects', {})


def _colormap(name, key):
    t, d, eff = _biome()
    if key in eff: return _hex(eff[key])
    b =_read(A + f'textures/colormap/{name}.png')
    if not b: return 0xFFFFFF
    img = Image.open(io.BytesIO(b)).convert('RGB')
    t, d = min(max(t, 0), 1), min(max(d, 0), 1) * min(max(t, 0), 1)  # vanilla: downfall *= temperature
    r, g, bb = img.getpixel((int((1 - t) * 255), int((1 - d) * 255)))
    return (r << 16) | (g << 8) | bb


@lru_cache(None)
def tint(name):
    """The multiplier for a block's tinted faces, as 0xRRGGBB (white when the game does not tint it)."""
    if name in FIXED: return FIXED[name]
    if name in GRASS: return _colormap('grass', 'grass_color')
    if name in FOLIAGE: return _colormap('foliage', 'foliage_color')
    if name in DRY_FOLIAGE: return _colormap('dry_foliage', 'dry_foliage_color')
    if name in WATER: return _hex(_biome()[2].get('water_color', '#3f76e4'))
    return 0xFFFFFF


@lru_cache(None)
def _model(ref):
    """A model's textures (merged down the parents) and elements (the nearest model's)."""
    j = _json(A + 'models/' + _id(ref) + '.json')
    if j is None: return {}, None
    tex, els = {}, j.get('elements')
    if 'parent' in j:
        ptex, pels = _model(j['parent'])
        tex.update(ptex)
        els = els if els is not None else pels
    tex.update(j.get('textures', {}))
    return tex, els


def _resolve(tex, ref, depth=0):
    """A texture reference followed through '#name' to its sprite; 26.x writes some as {sprite, force_translucent}."""
    while depth < 10:
        if isinstance(ref, dict):
            if ref.get('force_translucent'): _TRANSLUCENT.add(ref['sprite'])
            ref = ref.get('sprite')
        if not (ref and ref.startswith('#')): return ref
        ref, depth = tex.get(ref[1:]), depth + 1
    return None


_TRANSLUCENT = set()  # sprites the models mark force_translucent (glass, stained glass, ...)


def _models(name):
    """The models a block shows by default: an upright variant (or its first), or a multipart's unconditional parts."""
    bs = _json(A + f'blockstates/{name}.json')
    if bs is None: return []
    if 'variants' in bs:
        vs = bs['variants']
        def pick(v): return v[0] if isinstance(v, list) else v
        order = sorted(vs, key=lambda k: (('axis=' in k and 'axis=y' not in k), pick(vs[k]).get('x', 0) != 0))
        out = [pick(vs[order[0]])['model']]
        for k in vs:  # two-block-high blocks: the upper half too (doors, tall plants)
            if 'half=upper' in k and 'half=lower' in order[0] and k == order[0].replace('half=lower', 'half=upper'):
                out.append(pick(vs[k])['model'])
        return out
    parts = bs.get('multipart', [])
    def models(p): return [a['model'] for a in (p['apply'] if isinstance(p['apply'], list) else [p['apply']])][:1]
    fixed = [m for p in parts if 'when' not in p for m in models(p)]
    return fixed or (models(parts[0]) if parts else [])


def _face_image(img, el, face, d):
    """The texture region a face shows (its uv, or the element's own extent on that face)."""
    f, t = el['from'], el['to']
    uv = face.get('uv') or {'up': (f[0], f[2], t[0], t[2]), 'down': (f[0], f[2], t[0], t[2]),
                            'north': (16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]), 'south': (f[0], 16 - t[1], t[0], 16 - f[1]),
                            'west': (f[2], 16 - t[1], t[2], 16 - f[1]), 'east': (16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1])}[d]
    w = img.width
    frames = max(1, img.height // w)
    x0, x1 = sorted((uv[0], uv[2])); y0, y1 = sorted((uv[1], uv[3]))
    box = [int(x0 * w / 16), int(y0 * w / 16), max(int(x0 * w / 16) + 1, int(math.ceil(x1 * w / 16))),
           max(int(y0 * w / 16) + 1, int(math.ceil(y1 * w / 16)))]
    crops = [img.crop((box[0], box[1] + i * w, box[2], box[3] + i * w)) for i in range(frames)]
    return crops


def _tinted(img, rgb):
    if rgb == 0xFFFFFF: return img
    r, g, b, a = img.split()
    m = ((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
    return Image.merge('RGBA', [c.point(lambda v, k=k: v * k // 255) for c, k in zip((r, g, b), m)] + [a])


def _mean(imgs):
    """Alpha-weighted mean colour and mean alpha over a list of images."""
    tot, n, s = [0, 0, 0], 0, 0
    for img in imgs:
        for r, g, b, a in img.getdata():
            tot[0] += r * a; tot[1] += g * a; tot[2] += b * a; s += a; n += 1
    if not s: return None, 0
    return tuple(round(v / s) for v in tot), s / max(n, 1)


@lru_cache(None)
def _block(name):
    """((top RGB, side RGB), mean alpha) or None when the jar has no model for the name."""
    if not has_jar() or name.endswith('_banner'): return None  # banners: a planks particle, the cloth is entity-drawn
    tints = tint(name)
    if name in ENTITY or name.endswith('_bed'):
        img = _texture(ENTITY.get(name) or 'entity/bed/' + name[:-4])
        if img is not None:
            c, a = _mean([img])
            return ((c, c), a) if c else None
    faces = {'up': [], 'side': []}  # (area, [images composited])
    particle = None
    for m in _models(name):
        tex, els = _model(m)
        particle = particle or _resolve(tex, tex.get('particle'))
        for el in els or []:
            f, t = el['from'], el['to']
            for d, face in el.get('faces', {}).items():
                if d == 'down': continue
                ref = _resolve(tex, face.get('texture'))
                _SPRITES.setdefault(name, set()).add(ref)
                img =_texture(ref) if ref and not ref.startswith('#') else None
                if img is None: continue
                crops = [_tinted(c, tints) if 'tintindex' in face else c for c in _face_image(img, el, face, d)]
                area = ((t[0] - f[0]) * (t[2] - f[2]) if d == 'up' else
                        (t[0] - f[0] if d in ('north', 'south') else t[2] - f[2]) * (t[1] - f[1]))
                if area <= 0: area = 1  # flat cross planes still show
                key = (tuple(f), tuple(t), d)
                bucket = faces['up' if d == 'up' else 'side']
                same = next((b for b in bucket if b[0] == key and b[2][0].size == crops[0].size), None)
                if same:  # an overlay on the same face: composite it
                    same[2][:] = [Image.alpha_composite(b, c) for b, c in zip(same[2], crops)] if len(crops) == len(same[2]) else same[2]
                else: bucket.append((key, area, crops))
    out, alpha = {}, []
    for k, bucket in faces.items():
        tot, wsum = [0.0, 0.0, 0.0], 0.0
        for _, area, crops in bucket:
            c, a = _mean(crops)
            if c is None: continue
            w = area * a
            tot = [s + v * w for s, v in zip(tot, c)]; wsum += w; alpha.append(a)
        out[k] = tuple(round(v / wsum) for v in tot) if wsum else None
    if out['up'] is None and out['side'] is None:
        img = _texture(particle) if particle else None
        if img is None: return None
        c, a = _mean([_tinted(img, tints)])
        return ((c, c), a) if c else None
    top, side = out['up'] or out['side'], out['side'] or out['up']
    return (top, side), (sum(alpha) / len(alpha) if alpha else 255)


def block_names():
    z = _zip()
    if not z: return []
    p = A + 'blockstates/'
    return sorted(n[len(p):-5] for n in z.namelist() if n.startswith(p) and n.endswith('.json'))


def block_colours(names=None):
    """{name: (top RGB, side RGB)} for the names the jar has a model for ({} without the jar)."""
    out = {}
    for n in (block_names() if names is None else names):
        b = _block(n)
        if b: out[n] = b[0]
    return out


def block_alpha(name):
    """Mean coverage of the block's faces, 0-255 (glass ~ a third: an opaque frame round clear panes)."""
    b = _block(name)
    return b[1] if b else None


_SPRITES = {}  # name -> the sprites its faces use


def block_translucent(name):
    """Whether the game draws the block see-through: a sprite its model marks force_translucent, water, ice."""
    if _block(name) is None: return None
    return name in WATER or name in ('ice', 'frosted_ice') or bool(_SPRITES.get(name, set()) & _TRANSLUCENT)


# ---- comparison with render_design.py's hand colours ----

def _lab(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in c[:3])
    x, y, z = (r * .4124 + g * .3576 + b * .1805) / .95047, r * .2126 + g * .7152 + b * .0722, (r * .0193 + g * .1192 + b * .9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def delta_e(a, b): return math.dist(_lab(a), _lab(b))


def _hand_names(rd):
    names = set(rd.BLOCKS)
    for w in rd.WOODS:
        log = {'bamboo': 'bamboo_block', 'crimson': 'crimson_stem', 'warped': 'warped_stem'}.get(w, w + '_log')
        names |= {w + '_planks', log, 'stripped_' + log, w + '_stairs', w + '_slab', w + '_fence', w + '_door',
                  w + '_trapdoor', w + '_leaves'}
    for d in rd.DYES: names |= {d + s for s in ('_wool', '_terracotta', '_stained_glass', '_concrete')}
    return names


def _design_names(paths, villages):
    rd_parse = lambda s: re.match(r'(?:minecraft:)?([^\[]+)', s.strip()).group(1)
    names = set()
    def add(design):
        for v in design.get('palette', {}).values(): names.add(rd_parse(v))
    for p in paths:
        files = [os.path.join(p, f) for f in os.listdir(p) if f.endswith('.json') and f != 'index.json'] if os.path.isdir(p) else [p]
        for f in files:
            d = json.load(open(f, encoding='utf-8'))
            if 'cells' in d: names |= {rd_parse(n) for n in d['names']}
            elif 'palette' in d: add(d)
    if villages:
        for v in json.load(open(villages, encoding='utf-8')).get('villages', []):
            for d in v.get('designs', {}).values(): add(d)
    return names - {'air', 'cave_air', 'void_air'}


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import render_design as rd, hashlib
    args = sys.argv[1:]
    villages = None
    if '--villages' in args: i = args.index('--villages'); villages = args[i + 1]; del args[i:i + 2]
    every = '--all' in args; args = [a for a in args if a != '--all']
    if not has_jar(): sys.exit(f'no client jar at {JAR} (set MC_CLIENT_JAR); render_design keeps its hand colours')
    hand = _hand_names(rd)
    used = _design_names(args, villages)
    names = sorted(hand | used | (set(block_names()) if every else set()))
    hashed = lambda n: rd.hand_colour(n)[:3] == (lambda h: (60 + h[0] % 150, 60 + h[1] % 150, 60 + h[2] % 150))(hashlib.md5(n.encode()).digest())
    rows, missing = [], []
    for n in names:
        b = _block(n)
        if b is None: missing.append(n); continue
        (top, side), a = b
        f = rd.hand_faces(n, {})
        ht, hs = f['u'][:3], f['s'][:3]
        src = 'hash' if hashed(n) else ('table' if n in rd.BLOCKS else 'rule')
        rows.append((max(delta_e(ht, top), delta_e(hs, side)), n, src, ht, hs, top, side, a, n in used))
    rows.sort(reverse=True)
    print(f'jar {JAR}, tints for biome {BIOME}: grass #{tint("grass_block"):06x}, foliage #{tint("oak_leaves"):06x}, '
          f'water #{tint("water"):06x}')
    print(f'{"dE":>5}  {"block":32} {"hand":5}  {"hand top":>15} {"hand side":>15}  {"tex top":>15} {"tex side":>15}  alpha  in designs')
    for d, n, src, ht, hs, top, side, a, u in rows:
        print(f'{d:5.1f}  {n:32} {src:5}  {str(ht):>15} {str(hs):>15}  {str(top):>15} {str(side):>15}  {a:5.0f}  {"yes" if u else ""}')
    print(f'\n{len(rows)} names compared; {sum(r[0] > 25 for r in rows)} over dE 25, {sum(r[0] < 10 for r in rows)} under 10')
    h = sorted(r[1] for r in rows if r[2] == 'hash')
    print(f'hashed by the hand table today ({len(h)}): ' + ', '.join(h))
    if missing: print(f'no model in the jar ({len(missing)}): ' + ', '.join(missing))


if __name__ == '__main__':
    main()
