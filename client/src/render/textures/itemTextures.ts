/**
 * Procedurally drawn 16x16 item icons in a classic Minecraft style: dark 1px outline, bevel shading
 * (light top-left edges, dark bottom-right edges) and diagonal tools (handle bottom-left, head top-right).
 *
 * Shapes are authored as fill masks (char maps); outline and shading are computed automatically.
 * Row 0 of the returned array is the TOP of the icon. Background is fully transparent.
 */
import { Tex, Rng, RGB, hex, hashStr } from './pixel';

// =================================================================================================
// Sprite builder
// =================================================================================================

interface Mat {
  hi: RGB; // highlight (top-left corner pixels)
  lt: RGB; // light edge
  md: RGB; // body
  dk: RGB; // shadow edge
  ol: RGB | null; // outline (null = no outline)
  /** Chance of a random light/dark speckle inside the body. */
  grain?: number;
}
const mat = (hi: number, lt: number, md: number, dk: number, ol: number | null, grain = 0): Mat => ({
  hi: hex(hi), lt: hex(lt), md: hex(md), dk: hex(dk), ol: ol === null ? null : hex(ol), grain,
});

class Sprite {
  private lab = new Int16Array(256).fill(-1);
  private fixed: Array<RGB | null> = new Array(256).fill(null);
  private mats: Mat[] = [];
  constructor(private r: Rng) {}
  private idx(m: Mat): number {
    let i = this.mats.indexOf(m);
    if (i < 0) { this.mats.push(m); i = this.mats.length - 1; }
    return i;
  }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < 16 && y < 16; }
  filled(x: number, y: number) { return this.in(x, y) && (this.lab[y * 16 + x] >= 0 || this.fixed[y * 16 + x] !== null); }
  labelAt(x: number, y: number) { return this.in(x, y) ? this.lab[y * 16 + x] : -1; }
  p(x: number, y: number, m: Mat) {
    if (!this.in(x, y)) return;
    this.lab[y * 16 + x] = this.idx(m);
    this.fixed[y * 16 + x] = null;
  }
  /** Fixed colour pixel (still counts as filled for outlining). Keeps an existing label for outline colour. */
  fix(x: number, y: number, c: RGB | number, m?: Mat) {
    if (!this.in(x, y)) return;
    this.fixed[y * 16 + x] = typeof c === 'number' ? hex(c) : c;
    if (m) this.lab[y * 16 + x] = this.idx(m);
  }
  erase(x: number, y: number) {
    if (!this.in(x, y)) return;
    this.lab[y * 16 + x] = -1;
    this.fixed[y * 16 + x] = null;
  }
  /** Draw a char map: legend values are materials (auto shaded) or fixed colours. */
  map(rows: string[], legend: Record<string, Mat | number>, ox = 0, oy = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const v = legend[row[x]];
        if (v === undefined) continue;
        if (typeof v === 'number') this.fix(ox + x, oy + y, v);
        else this.p(ox + x, oy + y, v);
      }
    });
  }
  render(): Uint8ClampedArray {
    const t = new Tex();
    t.clear();
    const same = (x: number, y: number, l: number) => this.labelAt(x, y) === l;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const i = y * 16 + x;
        const f = this.fixed[i];
        if (f) { t.set(x, y, f); continue; }
        const l = this.lab[i];
        if (l < 0) continue;
        const m = this.mats[l];
        const openL = !same(x - 1, y, l), openU = !same(x, y - 1, l);
        const openR = !same(x + 1, y, l), openD = !same(x, y + 1, l);
        const tl = openL || openU, br = openR || openD;
        let c = m.md;
        if (openL && openU && !br) c = m.hi;
        else if (tl && !br) c = m.lt;
        else if (br && !tl) c = m.dk;
        else if (tl && br) c = openU && openR && !openL && !openD ? m.lt : openD && openL && !openU && !openR ? m.dk : m.md;
        if (m.grain && c === m.md && this.r.chance(m.grain)) c = this.r.chance(0.5) ? m.lt : m.dk;
        t.set(x, y, c);
      }
    // outline: empty pixels 4-adjacent to a filled pixel
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (this.filled(x, y)) continue;
        let ol: RGB | null = null;
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as Array<[number, number]>) {
          const l = this.labelAt(x + dx, y + dy);
          if (l >= 0 && this.mats[l].ol) { ol = this.mats[l].ol; break; }
        }
        if (ol) t.set(x, y, ol);
      }
    return t.data;
  }
}

// =================================================================================================
// Materials
// =================================================================================================

const WOOD = mat(0xb08c52, 0x9a7843, 0x896a3c, 0x68502c, 0x2b1d0e);
const WOOD_DARK = mat(0x7a5a33, 0x6b4f2c, 0x563f22, 0x3e2d18, 0x1e140a);

const TOOL_MATS: Record<string, Mat> = {
  wooden: mat(0xc9a36a, 0xb08c55, 0x987548, 0x735732, 0x2b1d0e),
  stone: mat(0xadadad, 0x959595, 0x7d7d7d, 0x5c5c5c, 0x262626),
  iron: mat(0xffffff, 0xe6e6e6, 0xc6c6c6, 0x929292, 0x363636),
  golden: mat(0xffffc2, 0xfdf05a, 0xebbd1f, 0xb8840c, 0x4d3304),
  diamond: mat(0xe0fffb, 0x8cf4e2, 0x3fdfcb, 0x1a9f94, 0x0b3a36),
};
const ARMOR_MATS: Record<string, Mat> = {
  leather: mat(0xc98d62, 0xb4784e, 0xa06540, 0x76452a, 0x301a0c),
  iron: TOOL_MATS.iron,
  golden: TOOL_MATS.golden,
  diamond: TOOL_MATS.diamond,
};

// =================================================================================================
// Shapes
// =================================================================================================

const HANDLE_ROWS = (from: number, to: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = from; y >= to; y--) { out.push([15 - y, y]); out.push([16 - y, y]); }
  return out;
};

const TOOL_SHAPES: Record<string, { head: string[]; handleTo: number }> = {
  pickaxe: {
    handleTo: 4,
    head: [
      '................',
      '................',
      '...mmmmmmmmmm...',
      '......mmmmmmmm..',
      '............mm..',
      '............mm..',
      '............mm..',
      '............mm..',
      '............mm..',
      '............mm..',
      '.............m..',
      '.............m..',
      '.............m..',
    ],
  },
  axe: {
    handleTo: 3,
    head: [
      '................',
      '......mmmm......',
      '.....mmmmmmm....',
      '....mmmmmmmmmm..',
      '....mmmmmmm.....',
      '....mmmmmm......',
      '.....mmmm.......',
      '......mm........',
    ],
  },
  shovel: {
    handleTo: 7,
    head: [
      '................',
      '...........mm...',
      '..........mmmm..',
      '.........mmmmm..',
      '........mmmmmm..',
      '........mmmmm...',
      '.........mmm....',
    ],
  },
  hoe: {
    handleTo: 3,
    head: [
      '................',
      '................',
      '.......mmmmmmm..',
      '.......mm.......',
      '.......m........',
    ],
  },
};

function drawTool(s: Sprite, kind: string, m: Mat) {
  if (kind === 'sword') {
    s.map([
      '................',
      '.............mm.',
      '............mmm.',
      '...........mmm..',
      '..........mmm...',
      '.........mmm....',
      '........mmm.....',
      '...g...mmm......',
      '....g.mmm.......',
      '.....gg.........',
      '....hhgg........',
      '...hh...g.......',
      '..hh............',
      '.pp.............',
    ], { m, g: WOOD_DARK, h: WOOD, p: WOOD_DARK });
    // fuller (centre line) highlight along the blade
    for (let k = 0; k < 6; k++) s.fix(8 + k, 7 - k, m.lt, m);
    s.fix(13, 1, m.hi, m);
    s.fix(4, 7, WOOD_DARK.lt, WOOD_DARK); s.fix(5, 8, WOOD_DARK.lt, WOOD_DARK);
    return;
  }
  const sh = TOOL_SHAPES[kind];
  for (const [x, y] of HANDLE_ROWS(14, sh.handleTo)) s.p(x, y, WOOD);
  s.map(sh.head, { m });
  if (kind === 'axe') {
    // bright cutting edge on the left, darker socket next to the handle
    for (let y = 3; y <= 5; y++) s.fix(4, y, m.hi, m);
    s.fix(5, 2, m.hi, m); s.fix(6, 1, m.hi, m);
    s.fix(10, 4, m.dk, m); s.fix(9, 5, m.dk, m); s.fix(11, 3, m.dk, m);
  }
}

const ARMOR_SHAPES: Record<string, string[]> = {
  helmet: [
    '................',
    '................',
    '................',
    '....mmmmmmmm....',
    '...mmmmmmmmmm...',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmm......mmm..',
    '..mmm......mmm..',
    '..mm........mm..',
  ],
  chestplate: [
    '................',
    '..mmm......mmm..',
    '.mmmmm....mmmmm.',
    '.mmmmmm..mmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '.mm.mmmmmmmm.mm.',
    '.mm.mmmmmmmm.mm.',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
  ],
  leggings: [
    '................',
    '................',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
    '...mmmm..mmmm...',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...mmm....mmm...',
    '...mmm....mmm...',
    '...mmm....mmm...',
    '...mmm....mmm...',
    '..mmmm....mmmm..',
    '.mmmmm....mmmmm.',
    '.mmmmm....mmmmm.',
  ],
};

function drawArmor(s: Sprite, piece: string, m: Mat, leather: boolean) {
  s.map(ARMOR_SHAPES[piece], { m });
  const d = m.dk, l = m.hi;
  // piece-specific detailing
  if (piece === 'chestplate') {
    for (let y = 8; y <= 13; y++) s.fix(7, y, y === 8 ? m.md : d, m);
    for (let x = 4; x <= 11; x++) s.fix(x, 4, x === 7 || x === 8 ? m.md : l, m);
    if (leather) { s.fix(6, 9, d, m); s.fix(9, 9, d, m); }
  } else if (piece === 'leggings') {
    for (let x = 3; x <= 12; x++) s.fix(x, 3, d, m);
    s.fix(7, 2, l, m); s.fix(8, 2, l, m);
  } else if (piece === 'helmet') {
    for (let x = 4; x <= 11; x++) s.fix(x, 6, d, m);
    if (!leather) { s.fix(7, 3, m.hi, m); s.fix(8, 3, m.hi, m); }
  } else if (piece === 'boots') {
    for (const bx of [3, 10]) { s.fix(bx, 5, l, m); s.fix(bx + 1, 5, l, m); s.fix(bx + 2, 5, l, m); }
    for (let x = 1; x <= 5; x++) s.fix(x, 11, d, m);
    for (let x = 10; x <= 14; x++) s.fix(x, 11, d, m);
  }
}

// ---- misc item helpers ------------------------------------------------------------------------------

type Draw = (s: Sprite, r: Rng) => void;
const ITEMS = new Map<string, Draw>();
const item = (names: string | string[], d: Draw) => {
  for (const n of Array.isArray(names) ? names : [names]) ITEMS.set(n, d);
};

for (const [tier, m] of Object.entries(TOOL_MATS))
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) item(`${tier}_${kind}`, (s) => drawTool(s, kind, m));
for (const [tier, m] of Object.entries(ARMOR_MATS))
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) item(`${tier}_${piece}`, (s) => drawArmor(s, piece, m, tier === 'leather'));

item('stick', (s) => {
  for (let y = 2; y <= 13; y++) { s.p(15 - y, y, WOOD); s.p(16 - y, y, WOOD); }
});

const LUMP = [
  '................',
  '................',
  '................',
  '......mmm.......',
  '....mmmmmmm.....',
  '...mmmmmmmmm....',
  '...mmmmmmmmmm...',
  '..mmmmmmmmmmm...',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '...mmmmmmmmmmm..',
  '...mmmmmmmmmm...',
  '....mmmmmmmm....',
  '......mmmm......',
];
function lump(s: Sprite, r: Rng, m: Mat, sparkle: RGB[], n = 6) {
  s.map(LUMP, { m });
  for (let k = 0; k < n; k++) {
    const x = r.irange(4, 11), y = r.irange(5, 11);
    s.fix(x, y, r.pick(sparkle), m);
  }
}
item('coal', (s, r) => lump(s, r, mat(0x4a4a4a, 0x363636, 0x262626, 0x161616, 0x080808, 0.15), [hex(0x5c5c5c), hex(0x111111)]));
item('charcoal', (s, r) => lump(s, r, mat(0x5e5040, 0x463a2c, 0x33291f, 0x211a13, 0x0c0906, 0.15), [hex(0x6e5e4a), hex(0x1a140e)]));
item('lapis_lazuli', (s, r) => {
  s.map([
    '................',
    '................',
    '................',
    '.......mm.......',
    '.....mmmmm......',
    '....mmmmmmmm....',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '....mmmmmmmm....',
    '.....mmmmm......',
  ], { m: mat(0x5b8cf0, 0x2f63d8, 0x1d47ad, 0x12307c, 0x081640, 0.2) });
  for (let k = 0; k < 5; k++) s.fix(r.irange(4, 11), r.irange(5, 10), r.pick([0x8fb3ff, 0x2552c4, 0x0e2566]));
});

function ingot(s: Sprite, top: Mat, front: Mat) {
  s.map([
    '................',
    '................',
    '................',
    '................',
    '................',
    '......tttttttt..',
    '.....tttttttttf.',
    '....ttttttttttf.',
    '...ffffffffffff.',
    '..fffffffffffff.',
    '..ffffffffffff..',
    '..fffffffffff...',
  ], { t: top, f: front });
  for (let x = 6; x <= 12; x++) s.fix(x, 5, top.hi, top);
}
item('iron_ingot', (s) => ingot(s, mat(0xffffff, 0xf0f0f0, 0xdedede, 0xc4c4c4, 0x363636), mat(0xc8c8c8, 0xbababa, 0xa8a8a8, 0x7e7e7e, 0x363636)));
item('gold_ingot', (s) => ingot(s, mat(0xffffc2, 0xfff38a, 0xfde24a, 0xefc12a, 0x4d3304), mat(0xf4c42c, 0xe9b31c, 0xd49a12, 0xa46e08, 0x4d3304)));
item('brick', (s) => ingot(s, mat(0xd08a6c, 0xc07a5c, 0xb06a4c, 0x965840, 0x3a1a10), mat(0xa05a40, 0x925036, 0x82462e, 0x683622, 0x3a1a10)));

item('diamond', (s) => {
  const m = mat(0xe0fffb, 0x9df8ea, 0x4ae3d0, 0x1c9d92, 0x0b3a36);
  s.map([
    '................',
    '................',
    '................',
    '.....mmmmmm.....',
    '....mmmmmmmm....',
    '...mmmmmmmmmm...',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '...mmmmmmmmmm...',
    '....mmmmmmmm....',
    '.....mmmmmm.....',
    '......mmmm......',
    '.......mm.......',
  ], { m });
  // facets
  for (let x = 3; x <= 12; x++) s.fix(x, 6, x < 6 ? 0xe0fffb : 0x9df8ea, m);
  for (const [x, y] of [[5, 4], [6, 4], [4, 5], [8, 3], [9, 3]] as Array<[number, number]>) s.fix(x, y, 0xffffff, m);
  for (const [x, y] of [[9, 8], [8, 9], [10, 7], [7, 10]] as Array<[number, number]>) s.fix(x, y, 0x2cc0b2, m);
});
item('emerald', (s) => {
  const m = mat(0xc4ffd8, 0x5ef08e, 0x17c85a, 0x0a8a3a, 0x04301a);
  s.map([
    '................',
    '................',
    '......mmmm......',
    '.....mmmmmm.....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '.....mmmmmm.....',
    '......mmmm......',
  ], { m });
  for (let y = 4; y <= 9; y++) s.fix(6, y, 0x8dffb4, m);
  s.fix(6, 3, 0xffffff, m); s.fix(5, 4, 0xffffff, m);
  for (let y = 5; y <= 10; y++) s.fix(9, y, 0x0fa84a, m);
});

function dust(s: Sprite, r: Rng, pal: number[], ol: number | null) {
  const m = mat(pal[3], pal[2], pal[1], pal[0], ol);
  const mound = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......mm.......',
    '.....mmmmm......',
    '....mmmmmmmm....',
    '...mmmmmmmmmm...',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '...mmmmmmmmmm...',
    '....mmmmmmmm....',
  ];
  s.map(mound, { m });
  mound.forEach((row, y) => {
    for (let x = 0; x < 16; x++) if (row[x] === 'm') s.fix(x, y, hex(r.weighted(pal, [2, 4, 3, 1.4])), m);
  });
  for (let k = 0; k < 6; k++) {
    const x = r.irange(2, 13), y = r.irange(3, 13);
    if (!s.filled(x, y)) s.fix(x, y, hex(pal[r.irange(1, 3)]));
  }
}
item('redstone', (s, r) => dust(s, r, [0x6a0000, 0x9e0000, 0xd40000, 0xff3a3a], 0x2a0000));
item('glowstone_dust', (s, r) => dust(s, r, [0x9a6a1c, 0xd49a2a, 0xf5cc4a, 0xfff2a0], 0x4a3208));
item('sugar', (s, r) => dust(s, r, [0xb8b8c4, 0xd6d6e0, 0xeeeef4, 0xffffff], 0x5a5a66));
item('gunpowder', (s, r) => dust(s, r, [0x2e2e2e, 0x484848, 0x666666, 0x8a8a8a], 0x121212));
item('bone_meal', (s, r) => dust(s, r, [0xa8a89a, 0xcacabc, 0xe4e4d8, 0xfcfcf2], 0x4a4a40));

item('flint', (s) => {
  s.map([
    '................',
    '................',
    '................',
    '.......mm.......',
    '......mmmm......',
    '.....mmmmmm.....',
    '....mmmmmmmm....',
    '....mmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '..mmmmmmmmmmm...',
    '...mmmmmmmmm....',
    '.....mmmmmm.....',
  ], { m: mat(0x8a8a8a, 0x5e5e5e, 0x3e3e3e, 0x262626, 0x0e0e0e, 0.12) });
});

function roundBlob(s: Sprite, m: Mat, cx: number, cy: number, rx: number, ry: number) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) s.p(x, y, m);
    }
}
item('clay_ball', (s) => {
  const m = mat(0xd2d6e2, 0xb4bac8, 0xa0a6b4, 0x7e8494, 0x3a3e48, 0.1);
  roundBlob(s, m, 8, 8.5, 5.2, 4.6);
});
item('snowball', (s) => {
  const m = mat(0xffffff, 0xf4fafa, 0xe2eef0, 0xb8c8d0, 0x5a6a74, 0.08);
  roundBlob(s, m, 8, 8, 5, 5);
  s.fix(6, 5, 0xffffff, m);
});
item('egg', (s) => {
  const m = mat(0xfff8e8, 0xf0e2c4, 0xe2cfaa, 0xc0a880, 0x5a4a32);
  roundBlob(s, m, 8, 8.5, 4.3, 5.6);
  s.fix(9, 7, 0xc4ae86, m); s.fix(7, 10, 0xc4ae86, m); s.fix(10, 11, 0xc4ae86, m);
});

item('book', (s) => {
  const cover = mat(0x8e4e2a, 0x7a3f1f, 0x6a3418, 0x4e240e, 0x1e0e04);
  const pages = mat(0xffffff, 0xf2f2ea, 0xe4e4d8, 0xc4c4b4, 0x3a3a30);
  s.map([
    '................',
    '................',
    '....cccccccccc..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '...ccccccccccp..',
    '....pppppppppp..',
  ], { c: cover, p: pages });
  for (let y = 3; y <= 12; y++) s.fix(4, y, 0x4e240e, cover);
  for (let x = 6; x <= 11; x++) { s.fix(x, 5, 0xd8b048, cover); s.fix(x, 7, 0xd8b048, cover); }
});
item('paper', (s) => {
  const m = mat(0xffffff, 0xf8f8f0, 0xecece0, 0xcacab8, 0x5a5a4a);
  s.map([
    '................',
    '................',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '..mmmmmmmmmm....',
    '..mmmmmmmmmm....',
    '..mmmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '..mmmmmmmmmmm...',
    '..mmmmmmmmmm....',
  ], { m });
  for (const y of [4, 6, 8, 10]) for (let x = 4; x <= 10; x++) if ((x + y) % 5) s.fix(x, y, 0xdcdcd0, m);
});

item('bone', (s) => {
  const m = mat(0xffffff, 0xf2f2e6, 0xe0e0d0, 0xb8b8a4, 0x4a4a3c);
  for (let y = 4; y <= 11; y++) { s.p(15 - y, y, m); s.p(16 - y, y, m); }
  s.map([
    '................',
    '..........m.m...',
    '..........mmmm..',
    '...........mmm..',
    '..........m.mm..',
  ], { m });
  s.map([
    '..m.m...........',
    '.mmm............',
    '.mmmm...........',
    '...m............',
  ], { m }, 0, 11);
});

item('string', (s) => {
  const pts: Array<[number, number]> = [[2, 13], [3, 13], [4, 12], [5, 12], [6, 11], [6, 10], [5, 9], [5, 8], [6, 7], [7, 7], [8, 8], [9, 8], [10, 7], [10, 6], [9, 5], [9, 4], [10, 3], [11, 3], [12, 2], [13, 2]];
  pts.forEach(([x, y], i) => s.fix(x, y, i % 3 === 0 ? 0xc8c8c8 : 0xf0f0f0));
});

item('feather', (s) => {
  const vane = mat(0xffffff, 0xf4f4f4, 0xe2e2e2, 0xbdbdbd, 0x5a5a5a);
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const cx = 3.5 + t * 9, cy = 12.5 - t * 9;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 2.1 + 0.3;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.abs((x + 0.5 - cx) + (y + 0.5 - cy)) / Math.SQRT2;
      const along = ((x + 0.5 - cx) - (y + 0.5 - cy)) / Math.SQRT2;
      if (Math.abs(along) < 0.75 && d < w && t > 0.12) s.p(x, y, vane);
    }
  }
  for (let k = 0; k < 10; k++) s.fix(3 + k, 12 - k, k < 2 ? 0x6a6a6a : 0xa0a0a0, vane);
  s.fix(2, 13, 0x5a5a5a);
});

item('leather', (s) => {
  s.map([
    '................',
    '................',
    '...mm.....mm....',
    '...mmmmmmmmmm...',
    '....mmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '...mmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '....mmmmmmmmm...',
    '...mm......mm...',
  ], { m: mat(0xcf8a58, 0xb8703e, 0xa05f32, 0x7c4622, 0x2e160a, 0.12) });
});

item('arrow', (s) => {
  const head = mat(0xe6e6e6, 0xc4c4c4, 0x9a9a9a, 0x6a6a6a, 0x262626);
  const fl = mat(0xffffff, 0xf0f0f0, 0xdedede, 0xb0b0b0, 0x4a4a4a);
  for (let k = 0; k < 8; k++) s.p(4 + k, 11 - k, WOOD);
  s.map([
    '..........hhh...',
    '...........hh...',
    '............h...',
  ], { h: head }, 0, 1);
  s.p(11, 2, head); s.p(12, 2, head); s.p(12, 3, head); s.p(13, 1, head); s.p(12, 1, head); s.p(13, 2, head); s.p(13, 3, head);
  s.map([
    '..f.............',
    '.ff.f...........',
    '..ffff..........',
    '...ff...........',
  ], { f: fl }, 0, 10);
  s.map(['.f..', 'ff..'], { f: fl }, 3, 13);
});

item('bow', (s) => {
  const m = mat(0xb08c52, 0x9a7843, 0x7a5a30, 0x5a4020, 0x241608);
  const arc: Array<[number, number]> = [[13, 1], [12, 1], [11, 1], [10, 1], [9, 2], [8, 2], [7, 2], [6, 3], [5, 3], [4, 4], [3, 5], [3, 6], [2, 7], [2, 8], [2, 9], [1, 10], [1, 11], [1, 12], [1, 13]];
  for (const [x, y] of arc) s.p(x, y, m);
  s.p(12, 2, m); s.p(13, 2, m); s.p(2, 12, m); s.p(2, 13, m);
  for (let k = 0; k < 10; k++) s.fix(3 + k, 12 - k, k % 2 ? 0xdcdcdc : 0xb8b8b8);
  // grip
  s.fix(5, 4, 0x6a4a2a, m); s.fix(4, 5, 0x6a4a2a, m);
});

function bowl(s: Sprite, fill?: RGB[]) {
  const m = mat(0xa8844e, 0x94703e, 0x7c5c32, 0x5a4022, 0x241608);
  s.map([
    '.mmmmmmmmmmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '..mmmmmmmmmmmm..',
    '...mmmmmmmmmm...',
    '.....mmmmmm.....',
  ], { m }, 0, 8);
  for (let x = 2; x <= 13; x++) s.fix(x, 8, fill ? fill[x % 3 === 0 ? 1 : 0] : hex(0x3a2814), m);
  if (fill) for (let x = 3; x <= 12; x++) s.fix(x, 7, fill[x % 4 === 1 ? 2 : 0], m);
  for (let x = 2; x <= 13; x++) s.fix(x, 9, 0xc0a068, m);
}
item('bowl', (s) => bowl(s));
item('mushroom_stew', (s) => bowl(s, [hex(0xb07a50), hex(0x8c5a38), hex(0xcc9a6a)]));

function bucket(s: Sprite, inner?: [number, number]) {
  const m = mat(0xffffff, 0xd8d8d8, 0xb4b4b4, 0x7e7e7e, 0x2e2e2e);
  s.map([
    '...mmmmmmmmmm...',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '....mmmmmmmm....',
    '.....mmmmmm.....',
  ], { m }, 0, 4);
  // opening
  for (let x = 4; x <= 11; x++) { s.fix(x, 5, inner ? inner[0] : 0x3a3a3a, m); s.fix(x, 6, inner ? inner[1] : 0x555555, m); }
  s.fix(3, 5, 0xe8e8e8, m); s.fix(12, 5, 0x9a9a9a, m); s.fix(3, 6, 0xe8e8e8, m); s.fix(12, 6, 0x9a9a9a, m);
  if (inner) { s.fix(5, 5, 0xffffff, m); s.fix(6, 5, inner[1], m); }
  // handle
  for (const [x, y] of [[3, 3], [4, 2], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 2], [12, 3]] as Array<[number, number]>) s.fix(x, y, 0x5a5a5a);
}
item('bucket', (s) => bucket(s));
item('water_bucket', (s) => bucket(s, [0x2e5ed8, 0x4a7cf0]));
item('lava_bucket', (s) => bucket(s, [0xe8641a, 0xffb830]));

item('flint_and_steel', (s) => {
  const steel = mat(0xffffff, 0xd4d4d4, 0xa8a8a8, 0x707070, 0x262626);
  const fl = mat(0x7a7a7a, 0x555555, 0x3a3a3a, 0x222222, 0x0a0a0a);
  s.map([
    '................',
    '..sssss.........',
    '.ss...ss........',
    '.s.....s........',
    '.s.....s........',
    '.ss....s........',
    '..s.............',
  ], { s: steel }, 0, 1);
  s.map([
    '....fff..',
    '...fffff.',
    '..ffffff.',
    '..fffffff',
    '...fffff.',
    '....fff..',
  ], { f: fl }, 6, 8);
});

/** Bresenham points from (x0,y0) to (x1,y1). */
function linePts(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

item('shears', (s) => {
  const blade = mat(0xffffff, 0xe4e4e4, 0xc4c4c4, 0x8e8e8e, 0x2e2e2e);
  const grip = mat(0x8a8a8a, 0x6e6e6e, 0x585858, 0x3a3a3a, 0x141414);
  for (const [x, y] of linePts(6, 9, 11, 1)) { s.p(x, y, blade); s.p(x + 1, y, blade); }
  for (const [x, y] of linePts(7, 10, 14, 6)) { s.p(x, y, blade); s.p(x, y + 1, blade); }
  s.fix(11, 1, 0xffffff, blade); s.fix(14, 6, 0xffffff, blade);
  // ring handles
  s.map([
    '.ggg....',
    'gg.g....',
    'g.gg.ggg',
    'ggg.gg.g',
    '....g.gg',
    '....ggg.',
  ], { g: grip }, 1, 9);
  s.fix(7, 9, 0x3a3a3a, blade);
});

item('wheat_seeds', (s) => {
  const m = mat(0x9ad86a, 0x6fbd3f, 0x4f9a2a, 0x356e1c, 0x13280a);
  for (const [x, y] of [[4, 5], [9, 4], [6, 8], [11, 8], [3, 10], [8, 11], [12, 12]] as Array<[number, number]>) {
    s.p(x, y, m); s.p(x + 1, y + 1, m);
  }
});
item('wheat', (s) => {
  const stem = mat(0xd8c060, 0xbca040, 0x9a8230, 0x76621e, 0x2a220a);
  const grain = mat(0xfff0a0, 0xecd070, 0xd4aa40, 0xa47c22, 0x3a2a0a);
  const tips: Array<[number, number]> = [[8, 1], [12, 3], [14, 7]];
  for (const [tx, ty] of tips) {
    const pts = linePts(2, 13, tx, ty);
    pts.forEach(([x, y], i) => {
      const fromTip = pts.length - 1 - i;
      if (fromTip < 5) {
        s.p(x, y, grain);
        if (fromTip > 0) s.p(x + 1, y, grain);
      } else s.p(x, y, stem);
    });
  }
  // twine around the bundle
  s.fix(4, 10, 0x6a4a1a, stem); s.fix(5, 11, 0x6a4a1a, stem); s.fix(4, 11, 0x8a6a2a, stem);
});
item('bread', (s) => {
  const m = mat(0xe0a860, 0xc8883e, 0xa86a2a, 0x7c4a1a, 0x2e1606);
  s.map([
    '..........mmm...',
    '........mmmmmm..',
    '......mmmmmmmmm.',
    '....mmmmmmmmmmm.',
    '...mmmmmmmmmmmm.',
    '..mmmmmmmmmmmm..',
    '.mmmmmmmmmmmm...',
    '.mmmmmmmmmmm....',
    '.mmmmmmmmmm.....',
    '..mmmmmmm.......',
    '...mmmm.........',
  ], { m }, 0, 3);
  for (const [x, y] of [[4, 8], [5, 7], [7, 6], [8, 5], [10, 4], [11, 3]] as Array<[number, number]>) s.fix(x, y, 0xf2cc86, m);
});

function apple(s: Sprite, m: Mat, leaf: boolean) {
  s.map([
    '................',
    '................',
    '....mmm.mmm.....',
    '...mmmmmmmmmm...',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '...mmmmmmmmmm...',
    '...mmmmmmmmmm...',
    '....mmm..mmm....',
  ], { m }, 0, 2);
  s.fix(7, 2, 0x5a3a1a); s.fix(8, 1, 0x5a3a1a); s.fix(7, 3, 0x3a2410, m);
  if (leaf) { s.fix(9, 1, 0x4aa02a); s.fix(10, 1, 0x3a8a1e); s.fix(10, 0, 0x6ac040); }
  s.fix(4, 6, 0xffffff, m); s.fix(4, 7, m.hi, m); s.fix(5, 6, m.hi, m);
}
item('apple', (s) => apple(s, mat(0xff8a7a, 0xf23a2a, 0xd21c14, 0x9a0e0a, 0x3a0404), true));
item('golden_apple', (s) => apple(s, mat(0xffffc8, 0xfff06a, 0xf2c62a, 0xc08a10, 0x4d3304), true));

item('melon_slice', (s) => {
  const rind = mat(0x9ad84a, 0x6fb42a, 0x4a8a1c, 0x2e6010, 0x0e2404);
  const flesh = mat(0xff8a7a, 0xf05a4a, 0xe03a2e, 0xb42a22, 0x3a0a06);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 3.5);
    if (y >= 4 && d < 8.6) s.p(x, y, d > 7.2 ? rind : flesh);
  }
  for (const [x, y] of [[5, 6], [9, 6], [7, 8], [11, 8], [4, 8], [8, 10]] as Array<[number, number]>) s.fix(x, y, 0x1a1a1a, flesh);
  for (let x = 1; x <= 14; x++) if (s.filled(x, 4)) s.fix(x, 4, 0xff9a8a, flesh);
});

function meat(s: Sprite, m: Mat, fat: RGB, marble: RGB | null, r: Rng) {
  const shape = [
    '................',
    '................',
    '................',
    '......mmmmm.....',
    '....mmmmmmmmm...',
    '...mmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmmm.',
    '..mmmmmmmmmmmmm.',
    '...mmmmmmmmmmmm.',
    '....mmmmmmmmmm..',
    '.....mmmmmmmm...',
    '.......mmmmm....',
  ];
  s.map(shape, { m });
  // fat rim along the upper-left edge
  shape.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      if (row[x] !== 'm') continue;
      const edgeTL = (shape[y - 1]?.[x] ?? '.') !== 'm' || row[x - 1] !== 'm';
      if (edgeTL && x + y < 17) s.fix(x, y, fat, m);
    }
  });
  if (marble) for (let k = 0; k < 4; k++) {
    const x = r.irange(5, 10), y = r.irange(6, 10);
    s.fix(x, y, marble, m); s.fix(x + 1, y, marble, m);
  }
}
item('porkchop', (s, r) => meat(s, mat(0xffb4b4, 0xf49a9a, 0xe68080, 0xbc5a5a, 0x4a1a1a), hex(0xfff0ea), null, r));
item('cooked_porkchop', (s, r) => meat(s, mat(0xe8b88a, 0xc8905e, 0xae7446, 0x7e4c28, 0x2a1406), hex(0xf2dcb4), hex(0x8a5a32), r));
item('beef', (s, r) => meat(s, mat(0xf06a5a, 0xd6453a, 0xbc2e28, 0x8a1a16, 0x360606), hex(0xffe2d8), hex(0xf2b2a8), r));
item('cooked_beef', (s, r) => meat(s, mat(0xa87858, 0x8a5a3a, 0x70442a, 0x4e2c18, 0x1e0e04), hex(0xc8a078), hex(0x5a3420), r));
item('mutton', (s, r) => meat(s, mat(0xf2847a, 0xde5e56, 0xc84642, 0x982e2c, 0x3a0c0a), hex(0xfff6ee), hex(0xf6c2b8), r));
item('cooked_mutton', (s, r) => meat(s, mat(0xc8906a, 0xa86e48, 0x8e5634, 0x643a20, 0x241006), hex(0xe8c8a0), hex(0x6a4428), r));
item('rotten_flesh', (s, r) => {
  meat(s, mat(0xb0885a, 0x94703e, 0x7c5a30, 0x5a3e1e, 0x241606, 0.25), hex(0x8a9a4a), null, r);
  for (let k = 0; k < 6; k++) s.fix(r.irange(4, 12), r.irange(5, 11), r.pick([0x5a7a2a, 0x3e2a14, 0x8aa050]));
});

function drumstick(s: Sprite, m: Mat, bone: Mat) {
  s.map([
    '................',
    '................',
    '.........mmm....',
    '.......mmmmmmm..',
    '......mmmmmmmm..',
    '......mmmmmmmmm.',
    '.....mmmmmmmmmm.',
    '.....mmmmmmmmm..',
    '......mmmmmmmm..',
    '.....bmmmmmm....',
    '....bb..........',
    '...bb...........',
    '.bbb............',
    '.bbb............',
    '..b.............',
  ], { m, b: bone });
}
item('chicken', (s) => drumstick(s, mat(0xfbe0d0, 0xf2c8b4, 0xe4b09a, 0xc08a74, 0x4a2a1e), mat(0xffffff, 0xf0f0e4, 0xdcdcc8, 0xb0b09c, 0x3a3a30)));
item('cooked_chicken', (s) => drumstick(s, mat(0xf0c078, 0xd8a050, 0xbc8236, 0x8a5a20, 0x2e1a06), mat(0xffffff, 0xf0f0e4, 0xdcdcc8, 0xb0b09c, 0x3a3a30)));

// =================================================================================================
// Public API
// =================================================================================================

const cache = new Map<string, Uint8ClampedArray | null>();

/** 16x16 RGBA icon for a non-block item, or null if the name is unknown. */
export function generateItemTexture(name: string): Uint8ClampedArray | null {
  if (cache.has(name)) {
    const c = cache.get(name)!;
    return c ? new Uint8ClampedArray(c) : null;
  }
  const d = ITEMS.get(name);
  let out: Uint8ClampedArray | null = null;
  if (d) {
    try {
      const r = new Rng(hashStr('item:' + name));
      const s = new Sprite(r);
      d(s, r);
      out = s.render();
    } catch {
      out = null;
    }
  }
  cache.set(name, out);
  return out ? new Uint8ClampedArray(out) : null;
}

/** Names this module can draw. */
export function knownItemTextures(): string[] {
  return [...ITEMS.keys()];
}

