/**
 * Procedurally generated 16x16 block textures in a classic Minecraft pixel-art style.
 * No copyrighted assets: everything is computed from seeded RNG + hand-authored pixel maps.
 *
 * Encoding contract (the renderer depends on this):
 *  - Biome-tinted textures are GRAYSCALE (grass_block_top, leaves, short_grass, fern, water_*).
 *  - grass_block_side: dirt + grass fringe; fringe pixels are grayscale with alpha EXACTLY 128
 *    ("tint me with the grass colour, then make opaque").
 *  - Cutout textures use alpha 0 or 255 only. Translucent ones (water, ice, stained glass) use partial alpha.
 *
 * Row 0 of the returned array is the TOP of the texture.
 */
import {
  Tex, Rng, RGB, hex, mix, scale, gray, clamp, makeNoise, makeFbm, drawMap, missingTexture, hashStr, lum,
} from './pixel';

type Gen = (t: Tex, r: Rng, name: string) => void;
const GEN = new Map<string, Gen>();
const def = (names: string | string[], g: Gen) => {
  for (const n of Array.isArray(names) ? names : [names]) GEN.set(n, g);
};

/** Render another texture (by name) into a fresh Tex (deterministic). */
function base(name: string): Tex {
  const t = new Tex();
  const g = GEN.get(name);
  if (g) g(t, new Rng(hashStr(name)), name);
  return t;
}

const pick = (pal: RGB[], v: number): RGB => pal[clamp(Math.floor(v * pal.length), 0, pal.length - 1)];
const P = (...hs: number[]): RGB[] => hs.map(hex);

// =================================================================================================
// Helpers
// =================================================================================================

interface Voronoi {
  id: Int16Array;
  d1: Float32Array;
  d2: Float32Array;
  px: number[];
  py: number[];
}
/** Tileable Voronoi from a jittered grid (gx*gy points). */
function voronoi(r: Rng, gx: number, gy: number, jitter = 0.8, sx = 1, sy = 1): Voronoi {
  const px: number[] = [], py: number[] = [];
  const cw = 16 / gx, ch = 16 / gy;
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++) {
      px.push((i + 0.5 + (r.next() - 0.5) * jitter) * cw + (j % 2 ? cw * 0.5 : 0));
      py.push((j + 0.5 + (r.next() - 0.5) * jitter) * ch);
    }
  const id = new Int16Array(256), d1 = new Float32Array(256), d2 = new Float32Array(256);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let b1 = 1e9, b2 = 1e9, bi = 0;
      for (let k = 0; k < px.length; k++) {
        let dx = Math.abs(x + 0.5 - px[k]); dx = Math.min(dx, 16 - dx);
        let dy = Math.abs(y + 0.5 - py[k]); dy = Math.min(dy, 16 - dy);
        const d = Math.sqrt(dx * dx * sx + dy * dy * sy);
        if (d < b1) { b2 = b1; b1 = d; bi = k; } else if (d < b2) b2 = d;
      }
      id[y * 16 + x] = bi; d1[y * 16 + x] = b1; d2[y * 16 + x] = b2;
    }
  return { id, d1, d2, px, py };
}
const vid = (v: Voronoi, x: number, y: number) => v.id[(((y % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)];

/** Fill with palette-quantised noise: v = fbm*wN + rand*wR (+bias). */
function noiseFill(t: Tex, r: Rng, pal: RGB[], opts: { periods?: number[]; wN?: number; wR?: number; bias?: number; contrast?: number } = {}) {
  const f = makeFbm(r.int(1e9), opts.periods ?? [4, 8], undefined);
  const wN = opts.wN ?? 0.5, wR = opts.wR ?? 0.5, bias = opts.bias ?? 0, c = opts.contrast ?? 1;
  t.forEach((x, y) => {
    let v = f(x, y) * wN + r.next() * wR + bias;
    v = 0.5 + (v - 0.5) * c;
    t.set(x, y, pick(pal, v));
  });
}

/** Weighted random speckle fill (index weights). */
function speckle(t: Tex, r: Rng, pal: RGB[], weights: number[]) {
  const idx = pal.map((_, i) => i);
  t.forEach((x, y) => t.set(x, y, pal[r.weighted(idx, weights)]));
}

/** Sprinkle small 1-3px clusters of a colour. */
function clumps(t: Tex, r: Rng, n: number, cols: RGB[], maxSize = 3) {
  for (let i = 0; i < n; i++) {
    let x = r.int(16), y = r.int(16);
    const c = r.pick(cols);
    const s = r.irange(1, maxSize);
    for (let k = 0; k < s; k++) {
      t.set(x, y, c);
      if (r.chance(0.5)) x += r.chance(0.5) ? 1 : -1; else y += r.chance(0.5) ? 1 : -1;
    }
  }
}

function bevelFrame(t: Tex, light: RGB, dark: RGB, x0 = 0, y0 = 0, x1 = 15, y1 = 15) {
  for (let i = x0; i <= x1; i++) { t.set(i, y0, light); t.set(i, y1, dark); }
  for (let j = y0; j <= y1; j++) { t.set(x0, j, light); t.set(x1, j, dark); }
}

// =================================================================================================
// Natural terrain
// =================================================================================================

const STONE = P(0x686868, 0x737373, 0x7d7d7d, 0x878787, 0x919191);
function stone(t: Tex, r: Rng) {
  const f = makeFbm(r.int(1e9), [2, 4, 8], [0.6, 1, 0.5]);
  t.forEach((x, y) => {
    const v = f(x, y) * 0.75 + r.next() * 0.45 - 0.1;
    t.set(x, y, pick(STONE, v));
  });
  // soft horizontal streaks of darker stone with a lighter lip above
  for (let i = 0; i < 7; i++) {
    const x = r.int(16), y = r.int(16), len = r.irange(2, 4);
    for (let k = 0; k < len; k++) {
      t.set(x + k, y, STONE[r.chance(0.6) ? 0 : 1]);
      if (r.chance(0.5)) t.set(x + k, y - 1, STONE[4]);
    }
  }
  for (let i = 0; i < 5; i++) t.set(r.int(16), r.int(16), STONE[4]);
}
def('stone', stone);

const DIRT = P(0x593d29, 0x6c4a32, 0x79553a, 0x866043, 0x94694a, 0xa47a57);
function dirt(t: Tex, r: Rng) {
  const f = makeFbm(r.int(1e9), [4, 8]);
  t.forEach((x, y) => {
    const v = f(x, y) * 0.5 + r.next() * 0.55 - 0.02;
    const i = v < 0.2 ? 1 : v < 0.38 ? 2 : v < 0.78 ? 3 : 4;
    t.set(x, y, DIRT[i]);
  });
  clumps(t, r, 9, [DIRT[0], DIRT[1]], 2);
  clumps(t, r, 7, [DIRT[5], DIRT[4]], 2);
}
def('dirt', dirt);

const GRASS_G = [118, 136, 152, 166, 180, 194, 210];
function grassTopGray(t: Tex, r: Rng) {
  const f = makeFbm(r.int(1e9), [4, 8]);
  t.forEach((x, y) => {
    const v = f(x, y) * 0.45 + r.next() * 0.62 - 0.05;
    t.set(x, y, gray(GRASS_G[clamp(Math.floor(v * GRASS_G.length), 0, GRASS_G.length - 1)]));
  });
  // little bright blade tips and dark gaps like vanilla
  for (let i = 0; i < 10; i++) t.set(r.int(16), r.int(16), gray(r.chance(0.5) ? 222 : 108));
}
def('grass_block_top', grassTopGray);

/** Per-column fringe depth, drippy like vanilla. */
function fringeDepths(r: Rng): number[] {
  const d: number[] = [];
  for (let x = 0; x < 16; x++) {
    let v = 3 + (r.chance(0.55) ? 1 : 0);
    if (r.chance(0.18)) v += r.irange(1, 2);
    d.push(v);
  }
  // avoid two long drips side by side
  for (let x = 1; x < 16; x++) if (d[x] > 4 && d[x - 1] > 4) d[x] = 4;
  return d;
}
function grassFringe(t: Tex, r: Rng, alpha: number, onDirt: boolean) {
  const depths = fringeDepths(r);
  const top = base('grass_block_top');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < depths[x]; y++) {
      let g = top.get(x, y)[0];
      if (y === depths[x] - 1) g = Math.max(100, g - 30); // darker drip tips
      t.set(x, y, gray(g), alpha);
    }
    if (onDirt) {
      // soft shadow on the dirt right under the grass
      const yy = depths[x];
      const c = t.get(x, yy);
      t.set(x, yy, scale(c, 0.86), 255);
    }
  }
}
def('grass_block_side', (t, r) => {
  t.copyFrom(base('dirt'));
  grassFringe(t, r, 128, true);
});
def('grass_block_side_overlay', (t) => {
  t.clear();
  grassFringe(t, new Rng(hashStr('grass_block_side')), 255, false);
});
def('grass_block_snow', (t, r) => {
  t.copyFrom(base('dirt'));
  const S = P(0xcfdcdc, 0xe0ecec, 0xf0fafa, 0xffffff);
  const d = fringeDepths(r);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < d[x] + 1; y++) {
      const c = y === d[x] ? S[0] : S[1 + r.int(3)];
      t.set(x, y, c);
    }
    t.set(x, d[x] + 1, scale(t.get(x, d[x] + 1), 0.85));
  }
});

function sandLike(pal: RGB[]) {
  return (t: Tex, r: Rng) => {
    const f = makeNoise(r.int(1e9), 8);
    t.forEach((x, y) => {
      const v = r.next() * 0.8 + f(x, y) * 0.3 - 0.05;
      const i = v < 0.12 ? 0 : v < 0.38 ? 1 : v < 0.8 ? 2 : 3;
      t.set(x, y, pal[i]);
    });
  };
}
def('sand', sandLike(P(0xc4b582, 0xd4c796, 0xdbd3a0, 0xe7e1b9)));
def('red_sand', sandLike(P(0x9e5119, 0xb05d1d, 0xbe6621, 0xcd7a36)));

def('gravel', (t, r) => {
  const v = voronoi(r, 6, 6, 0.9, 1, 1.2);
  const pal = P(0x5e5856, 0x77716f, 0x878281, 0x999492, 0xaaa5a3, 0x7f7570);
  const cols: number[] = v.px.map(() => r.weighted([0, 1, 2, 3, 4, 5], [1, 3, 3, 3, 2, 1.5]));
  t.forEach((x, y) => {
    const k = vid(v, x, y);
    let c = pal[cols[k]];
    const edgeR = vid(v, x + 1, y) !== k, edgeD = vid(v, x, y + 1) !== k;
    const edgeL = vid(v, x - 1, y) !== k, edgeU = vid(v, x, y - 1) !== k;
    if (edgeR || edgeD) c = scale(c, 0.72);
    else if (edgeL || edgeU) c = scale(c, 1.12);
    if (r.chance(0.12)) c = scale(c, r.chance(0.5) ? 0.9 : 1.08);
    t.set(x, y, c);
  });
});

def('clay', (t, r) => {
  noiseFill(t, r, P(0x9097a6, 0x9aa1ae, 0xa1a7b4, 0xa8aeba, 0xb0b5c1), { wN: 0.45, wR: 0.55 });
});
def('terracotta', (t, r) => {
  noiseFill(t, r, P(0x8f5840, 0x955c42, 0x985e43, 0x9c6146, 0xa1664b), { wN: 0.3, wR: 0.7 });
});
def('snow', (t, r) => {
  speckle(t, r, P(0xdce8ea, 0xebf5f5, 0xf5fcfc, 0xffffff), [1, 3, 5, 3]);
});
def('ice', (t, r) => {
  const pal = P(0x7ba6f2, 0x8db4f8, 0x9dc0fb, 0xb1cdfc);
  const f = makeFbm(r.int(1e9), [2, 4]);
  t.forEach((x, y) => t.set(x, y, pick(pal, f(x, y) * 0.8 + r.next() * 0.25 - 0.05), 190 + r.int(12)));
  // light diagonal cracks / streaks
  for (let i = 0; i < 4; i++) {
    const x = r.int(16), y = r.int(16), len = r.irange(3, 6);
    for (let k = 0; k < len; k++) t.set(x + k, y - k, hex(0xd8e8ff), 206);
  }
});

def('moss_block', (t, r) => {
  noiseFill(t, r, P(0x43551f, 0x4f6427, 0x596e2d, 0x647a33, 0x71883b), { wN: 0.5, wR: 0.55, periods: [4, 8] });
  clumps(t, r, 8, [hex(0x7d9542)], 2);
});

def('bedrock', (t, r) => {
  const pal = P(0x1e1e1e, 0x333333, 0x4c4c4c, 0x626262, 0x7a7a7a, 0x959595);
  const f = makeFbm(r.int(1e9), [8, 16], [1, 0.6]);
  t.forEach((x, y) => t.set(x, y, pick(pal, (f(x, y) - 0.5) * 1.5 + 0.5 + (r.next() - 0.5) * 0.7)));
});

def('obsidian', (t, r) => {
  const pal = P(0x06040a, 0x0e0a16, 0x150f20, 0x1f162e);
  const f = makeFbm(r.int(1e9), [4, 8]);
  const ridge = makeNoise(r.int(1e9), 4);
  t.forEach((x, y) => {
    t.set(x, y, pick(pal, f(x, y) * 0.7 + r.next() * 0.4 - 0.05));
    const rv = 1 - Math.abs(ridge(x, y) * 2 - 1);
    if (rv > 0.9) t.set(x, y, hex(r.chance(0.5) ? 0x3b2757 : 0x2e1f47));
  });
  for (let i = 0; i < 6; i++) {
    const x = r.int(16), y = r.int(16);
    t.set(x, y, hex(0x4a3470));
    t.set(x + 1, y, hex(0x2e1f47));
  }
});

def('granite', (t, r) => {
  noiseFill(t, r, P(0x7f5343, 0x8d5f4d, 0x956756, 0x9e6f5d, 0xa87a67), { wN: 0.55, wR: 0.5, periods: [4, 8] });
  clumps(t, r, 10, [hex(0xc4978a), hex(0xb88675)], 2);
  clumps(t, r, 8, [hex(0x6b4436), hex(0x74493a)], 2);
});
def('diorite', (t, r) => {
  noiseFill(t, r, P(0xaaaaaa, 0xb6b6b8, 0xbfbfc1, 0xc9c9cb, 0xd6d6d8), { wN: 0.5, wR: 0.55, periods: [4, 8] });
  clumps(t, r, 14, [hex(0x7a7a7a), hex(0x8e8e8e), hex(0x6a6a6a)], 3);
  clumps(t, r, 6, [hex(0xededef)], 2);
});
def('andesite', (t, r) => {
  noiseFill(t, r, P(0x767676, 0x808080, 0x888888, 0x8f8f8f, 0x989898), { wN: 0.55, wR: 0.5, periods: [4, 8] });
  clumps(t, r, 10, [hex(0x646464), hex(0x6b6b6b)], 3);
  clumps(t, r, 9, [hex(0xa9a9a9), hex(0xb2b2b2)], 3);
});

// ---- cobblestone -------------------------------------------------------------------------------
const COBBLE = P(0x3a3a3a, 0x4d4d4d, 0x626262, 0x747474, 0x868686, 0x999999, 0xacacac);
function cobble(t: Tex, r: Rng) {
  const v = voronoi(r, 3, 3, 0.7, 1, 1);
  const baseIdx = v.px.map(() => r.weighted([3, 4, 5], [1.2, 2, 1]));
  t.forEach((x, y) => {
    const k = vid(v, x, y);
    if (vid(v, x + 1, y) !== k || vid(v, x, y + 1) !== k) {
      t.set(x, y, COBBLE[r.chance(0.65) ? 1 : 0]);
      return;
    }
    let dx = x + 0.5 - v.px[k]; if (dx > 8) dx -= 16; if (dx < -8) dx += 16;
    let dy = y + 0.5 - v.py[k]; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
    let s = baseIdx[k] - (dx + dy) * 0.16 + (r.next() - 0.5) * 1.1;
    if (vid(v, x + 2, y) !== k || vid(v, x, y + 2) !== k) s -= 0.9;
    if (vid(v, x - 1, y) !== k || vid(v, x, y - 1) !== k) s += 0.9;
    t.set(x, y, COBBLE[clamp(Math.round(s), 2, 6)]);
  });
}
def('cobblestone', cobble);

const MOSS = P(0x344a1e, 0x405a24, 0x4d6b2b, 0x5c7c33);
function mossify(t: Tex, r: Rng, amount: number, mortarMask?: (x: number, y: number) => boolean) {
  const f = makeFbm(r.int(1e9), [2, 4, 8]);
  t.forEach((x, y) => {
    let v = f(x, y) + (r.next() - 0.5) * 0.25;
    if (mortarMask && mortarMask(x, y)) v += 0.12;
    if (v > 1 - amount) {
      const lvl = clamp(Math.floor((v - (1 - amount)) / amount * 4 + r.next() * 1.4), 0, 3);
      const c = t.get(x, y);
      t.set(x, y, lum(c) < 80 ? MOSS[0] : MOSS[lvl]);
    }
  });
}
def('mossy_cobblestone', (t, r) => {
  t.copyFrom(base('cobblestone'));
  mossify(t, r, 0.3, (x, y) => lum(t.get(x, y)) < 90);
});

// ---- bricks ----------------------------------------------------------------------------------------
def('bricks', (t, r) => {
  const M = P(0x9b928d, 0xb4aca6, 0xc2bbb5);
  const B = P(0x7c4536, 0x8b5040, 0x96614c, 0xa36c56, 0xb27a63);
  t.forEach((x, y) => {
    const row = y >> 2, yy = y & 3;
    const off = row & 1 ? 4 : 0;
    const xx = (x + off) & 7;
    if (yy === 3 || xx === 7) { t.set(x, y, M[r.chance(0.3) ? 0 : r.chance(0.5) ? 1 : 2]); return; }
    let i = 2 + (r.next() < 0.3 ? -1 : r.next() < 0.3 ? 1 : 0);
    if (yy === 0) i += 1;
    if (yy === 2) i -= 1;
    if (xx === 0) i += 0.5;
    t.set(x, y, B[clamp(Math.round(i), 0, 4)]);
  });
});

// ---- stone bricks ---------------------------------------------------------------------------------
function stoneBricks(t: Tex, r: Rng) {
  const S = P(0x5d5d5d, 0x6f6f6f, 0x7a7a7a, 0x838383, 0x8e8e8e, 0x9c9c9c);
  const f = makeFbm(r.int(1e9), [4, 8]);
  const mortar = (x: number, y: number) => {
    if (y === 7 || y === 15) return true;
    if (y < 7) return x === 15;
    return x === 7;
  };
  t.forEach((x, y) => {
    if (mortar(x, y)) { t.set(x, y, S[0]); return; }
    let s = 2.6 + (f(x, y) - 0.5) * 2.2 + (r.next() - 0.5) * 1.2;
    if (mortar(x, y - 1) || y === 0 || mortar(x - 1, y) || (y < 7 ? x === 0 : x === 8)) s += 1.3;
    if (mortar(x, y + 1) || mortar(x + 1, y)) s -= 1.3;
    t.set(x, y, S[clamp(Math.round(s), 1, 5)]);
  });
  // tiny cracks
  for (let i = 0; i < 2; i++) {
    const x = r.irange(2, 12), y = r.pick([2, 3, 4, 10, 11, 12]);
    t.set(x, y, S[1]); t.set(x + 1, y + (r.chance(0.5) ? 1 : 0), S[1]);
  }
}
def('stone_bricks', stoneBricks);
def('mossy_stone_bricks', (t, r) => {
  t.copyFrom(base('stone_bricks'));
  mossify(t, r, 0.3, (x, y) => y === 7 || y === 15 || (y < 7 ? x === 15 : x === 7));
});

// ---- smooth stone / sandstone ---------------------------------------------------------------------
def('smooth_stone', (t, r) => {
  speckle(t, r, P(0x999999, 0x9e9e9e, 0xa3a3a3), [1, 4, 1]);
  bevelFrame(t, hex(0xb5b5b5), hex(0x7f7f7f));
});
def('smooth_stone_slab_side', (t, r) => {
  speckle(t, r, P(0x999999, 0x9e9e9e, 0xa3a3a3), [1, 4, 1]);
  bevelFrame(t, hex(0xb5b5b5), hex(0x7f7f7f), 0, 0, 15, 7);
  bevelFrame(t, hex(0xb5b5b5), hex(0x7f7f7f), 0, 8, 15, 15);
});
const SAND_S = P(0xa99a6b, 0xbfb07f, 0xcdbf8b, 0xd8cb9b, 0xe2d8ac);
def('sandstone_top', (t, r) => speckle(t, r, SAND_S.slice(1), [1, 3, 6, 3]));
def('sandstone', (t, r) => {
  const f = makeNoise(r.int(1e9), 8);
  t.forEach((x, y) => {
    let v: number;
    if (y < 3) v = 3 + (r.next() < 0.3 ? 1 : 0);
    else if (y === 3) v = 1;
    else if (y < 11) v = 2.4 + (f(x, y) - 0.5) * 1.5 + (r.next() - 0.5) * 1.2 + ((y & 1) ? 0.3 : -0.2);
    else if (y === 11) v = 1 + (r.chance(0.3) ? 1 : 0);
    else v = 2.2 + (r.next() - 0.5) * 2.4 - (y === 15 ? 0.6 : 0);
    t.set(x, y, SAND_S[clamp(Math.round(v), 0, 4)]);
  });
});
def('sandstone_bottom', (t, r) => {
  speckle(t, r, SAND_S.slice(1), [2, 4, 5, 2]);
  for (let i = 0; i < 5; i++) {
    let x = r.int(16), y = r.int(16);
    for (let k = 0; k < r.irange(2, 5); k++) { t.set(x, y, SAND_S[0]); x += r.irange(0, 1); y += r.irange(-1, 1); }
  }
});

// =================================================================================================
// Ores & minerals
// =================================================================================================

const ORE_SHAPES: Array<Array<[number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
];
/** pal: [outline, dark, mid, light, highlight] */
function ore(pal: RGB[], count = 5) {
  return (t: Tex, r: Rng) => {
    t.copyFrom(base('stone'));
    const m = new Uint8Array(256);
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && m[y * 16 + x] > 0;
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < count; tries++) {
      const sh = r.pick(ORE_SHAPES);
      const ox = r.irange(1, 12), oy = r.irange(1, 12);
      let ok = true;
      for (const [dx, dy] of sh)
        for (let j = -2; j <= 2 && ok; j++)
          for (let i = -2; i <= 2 && ok; i++) if (at(ox + dx + i, oy + dy + j)) ok = false;
      if (!ok) continue;
      for (const [dx, dy] of sh) m[(oy + dy) * 16 + ox + dx] = placed + 1;
      // sometimes add an extra pixel for irregularity
      if (r.chance(0.5)) {
        const [dx, dy] = r.pick(sh);
        const nx = ox + dx + r.pick([-1, 1, 0]), ny = oy + dy + r.pick([1, 0]);
        if (nx >= 1 && ny >= 1 && nx < 15 && ny < 15) m[ny * 16 + nx] = placed + 1;
      }
      placed++;
    }
    // outline (on stone) first
    t.forEach((x, y) => {
      if (at(x, y)) return;
      if (at(x - 1, y) || at(x, y - 1) || at(x - 1, y - 1)) t.set(x, y, mix(t.get(x, y), pal[0], 0.75));
      else if (at(x + 1, y) || at(x, y + 1)) t.set(x, y, mix(t.get(x, y), pal[0], 0.35));
    });
    t.forEach((x, y) => {
      if (!at(x, y)) return;
      const tl = !at(x - 1, y) || !at(x, y - 1);
      const br = !at(x + 1, y) || !at(x, y + 1);
      let c = pal[2];
      if (tl && !br) c = pal[3];
      else if (br && !tl) c = pal[1];
      if (!at(x - 1, y) && !at(x, y - 1)) c = pal[4];
      t.set(x, y, c);
    });
  };
}
def('coal_ore', ore(P(0x1c1c1c, 0x141414, 0x262626, 0x363636, 0x4f4f4f), 6));
def('iron_ore', ore(P(0x5f4a3b, 0xa98670, 0xc7a18a, 0xd8af93, 0xeccbb4), 5));
def('gold_ore', ore(P(0x6c5410, 0xc49a16, 0xf2c62b, 0xfcee4b, 0xffffb5), 5));
def('diamond_ore', ore(P(0x0d4f4a, 0x1ea39a, 0x39d4ca, 0x6af2f0, 0xd6fffd), 5));
def('lapis_ore', ore(P(0x0b1f55, 0x163c96, 0x1d4bb4, 0x2c64d6, 0x6d98ee), 6));
def('redstone_ore', ore(P(0x4a0000, 0x930000, 0xc40000, 0xff1414, 0xff8080), 6));
def('emerald_ore', ore(P(0x064a1d, 0x0f8d3b, 0x13b24c, 0x1fdc66, 0xa6ffc4), 4));

function metalBlock(pal: RGB[], pattern: 'iron' | 'gold' | 'diamond') {
  // pal: [darkest, dark, mid, light, highlight]
  return (t: Tex, r: Rng) => {
    t.fill(pal[2]);
    t.forEach((x, y) => { if (r.chance(0.18)) t.set(x, y, r.chance(0.5) ? pal[3] : mix(pal[2], pal[1], 0.5)); });
    // outer bevel
    bevelFrame(t, pal[4], pal[0]);
    // inner bevel (reversed) for an inset panel
    for (let i = 1; i <= 14; i++) { t.set(i, 1, pal[3]); t.set(1, i, pal[3]); t.set(i, 14, pal[1]); t.set(14, i, pal[1]); }
    t.set(1, 14, pal[2]); t.set(14, 1, pal[2]);
    if (pattern === 'iron') {
      for (const yy of [4, 9]) for (let x = 3; x <= 12; x++) { t.set(x, yy, pal[1]); t.set(x, yy + 1, pal[3]); }
    } else if (pattern === 'gold') {
      t.set(3, 3, pal[4]); t.set(4, 3, pal[4]); t.set(3, 4, pal[4]); t.set(5, 3, pal[3]); t.set(3, 5, pal[3]);
      for (let k = 0; k < 4; k++) { t.set(6 + k, 12 - k, pal[3]); t.set(7 + k, 12 - k, pal[1]); }
      t.set(11, 4, pal[3]); t.set(12, 4, pal[1]);
    } else {
      const diamond = (cx: number, cy: number) => {
        t.set(cx, cy - 1, pal[4]); t.set(cx - 1, cy, pal[4]); t.set(cx, cy, pal[3]); t.set(cx + 1, cy, pal[1]); t.set(cx, cy + 1, pal[1]);
      };
      diamond(5, 5); diamond(10, 10); diamond(10, 5); diamond(5, 10);
    }
  };
}
def('iron_block', metalBlock(P(0x8a8a8a, 0xbfbfbf, 0xd8d8d8, 0xe8e8e8, 0xffffff), 'iron'));
def('gold_block', metalBlock(P(0xa3700a, 0xe0a510, 0xf7d03a, 0xfbe663, 0xffffc0), 'gold'));
def('diamond_block', metalBlock(P(0x1f8f87, 0x4ad7cd, 0x6ceee6, 0xa6fbf6, 0xeafffe), 'diamond'));
def('coal_block', (t, r) => {
  noiseFill(t, r, P(0x0c0c0c, 0x141414, 0x1b1b1b, 0x232323, 0x2d2d2d), { wN: 0.4, wR: 0.65 });
  clumps(t, r, 6, [hex(0x3a3a3a), hex(0x424242)], 2);
});

def('glowstone', (t, r) => {
  const v = voronoi(r, 4, 4, 0.9);
  const pal = P(0x5a3d1c, 0x8a6533, 0xb88a45, 0xe7b95a, 0xfbd97c, 0xffefb5);
  t.forEach((x, y) => {
    const i = y * 16 + x;
    const edge = v.d2[i] - v.d1[i];
    let s = clamp(edge * 1.6 + (r.next() - 0.5) * 1.3, 0, 5);
    if (edge < 0.45) s = r.chance(0.6) ? 0 : 1;
    t.set(x, y, pal[Math.round(s)]);
  });
});

// =================================================================================================
// Wood
// =================================================================================================

interface WoodPal { sep: RGB; dark: RGB; mid: RGB; mid2: RGB; light: RGB; }
const OAK: WoodPal = { sep: hex(0x6b5230), dark: hex(0x8a6c40), mid: hex(0x9f844d), mid2: hex(0xaf8f55), light: hex(0xbc9862) };
const BIRCH: WoodPal = { sep: hex(0x957f51), dark: hex(0xb4a06a), mid: hex(0xc4b077), mid2: hex(0xcfbd83), light: hex(0xd9c890) };
const SPRUCE: WoodPal = { sep: hex(0x4a3219), dark: hex(0x5b4023), mid: hex(0x684b2b), mid2: hex(0x735431), light: hex(0x7f5f38) };

function planks(p: WoodPal) {
  return (t: Tex, r: Rng) => {
    const seams = [r.irange(2, 5), r.irange(9, 13), r.irange(0, 3), r.irange(6, 10)];
    for (let b = 0; b < 4; b++) {
      for (let yy = 0; yy < 3; yy++) {
        const y = b * 4 + yy;
        let x = 0;
        while (x < 16) {
          const len = r.irange(2, 6);
          const c = yy === 0 ? r.weighted([p.light, p.mid2, p.mid], [3, 2, 1]) : yy === 2 ? r.weighted([p.mid2, p.mid, p.dark], [1, 3, 1.4]) : r.weighted([p.light, p.mid2, p.mid], [1, 3, 2]);
          for (let k = 0; k < len && x < 16; k++, x++) t.set(x, y, c);
        }
        // grain dashes
        if (r.chance(0.7)) {
          const gx = r.int(16), gl = r.irange(2, 4);
          for (let k = 0; k < gl; k++) t.set(gx + k, y, p.dark);
        }
      }
      for (let x = 0; x < 16; x++) t.set(x, b * 4 + 3, p.sep);
      // vertical seam where two boards meet
      const sx = seams[b];
      for (let yy = 0; yy < 3; yy++) {
        t.set(sx, b * 4 + yy, p.sep);
        t.set(sx + 1, b * 4 + yy, p.light);
      }
      // nail-ish dark dots beside the seam
      t.set(sx + 2 + r.int(2), b * 4 + 1, p.dark);
    }
  };
}
def('oak_planks', planks(OAK));
def('birch_planks', planks(BIRCH));
def('spruce_planks', planks(SPRUCE));

function barkColumns(t: Tex, r: Rng, pal: RGB[], crevice: RGB) {
  // pal: dark..light, vertical streaks
  const colBias: number[] = [];
  for (let x = 0; x < 16; x++) colBias.push(r.next());
  for (let x = 0; x < 16; x++) {
    let y = r.int(16);
    let n = 0;
    while (n < 16) {
      const len = r.irange(2, 6);
      let idx = clamp(Math.floor(colBias[x] * pal.length * 0.9 + (r.next() - 0.5) * 2.2), 0, pal.length - 1);
      for (let k = 0; k < len && n < 16; k++, n++, y++) t.set(x, y, pal[idx]);
      idx = 0;
    }
  }
  // deep crevices
  for (let i = 0; i < 6; i++) {
    const x = r.int(16), y = r.int(16), len = r.irange(3, 8);
    for (let k = 0; k < len; k++) t.set(x, y + k, crevice);
    t.set(x + 1, y + r.int(len), pal[pal.length - 1]);
  }
}
def('oak_log', (t, r) => barkColumns(t, r, P(0x4d3b23, 0x5b4629, 0x6a5232, 0x7a5f3a, 0x866a42), hex(0x3a2c19)));
def('spruce_log', (t, r) => barkColumns(t, r, P(0x2b1d0e, 0x36260f, 0x3f2d15, 0x4a3519, 0x553f20), hex(0x1f150a)));
def('birch_log', (t, r) => {
  speckle(t, r, P(0xc9ccc4, 0xd6d8d0, 0xe0e2da, 0xeceee8), [1, 3, 4, 2]);
  // grey vertical tints
  for (let x = 0; x < 16; x++) if (r.chance(0.3)) for (let y = 0; y < 16; y++) if (r.chance(0.6)) t.set(x, y, scale(t.get(x, y), 0.93));
  // black horizontal lenticel marks
  for (let i = 0; i < 8; i++) {
    const x = r.int(16), y = r.int(16), w = r.irange(2, 4);
    for (let k = 0; k < w; k++) t.set(x + k, y, hex(k === 0 || k === w - 1 ? 0x4a4a44 : 0x2a2a26));
    if (r.chance(0.5)) t.set(x + 1, y + 1, hex(0x5c5c56));
  }
});

function logTop(bark: RGB[], rings: RGB[], ringDark: RGB) {
  return (t: Tex, r: Rng) => {
    t.forEach((x, y) => {
      const dx = x - 7.5, dy = y - 7.5;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (cheb > 6.5) { t.set(x, y, r.pick(bark)); return; }
      const d = cheb * 0.55 + Math.sqrt(dx * dx + dy * dy) * 0.45 + (r.next() - 0.5) * 0.35;
      const ring = Math.floor(d);
      let c = ring % 2 === 1 ? ringDark : rings[r.chance(0.7) ? 0 : 1];
      if (cheb > 5.5) c = ringDark;
      t.set(x, y, c);
    });
  };
}
def('oak_log_top', logTop(P(0x4d3b23, 0x5b4629, 0x6a5232), P(0xb08d57, 0xa6844f), hex(0x8c6c3f)));
def('spruce_log_top', logTop(P(0x2b1d0e, 0x36260f, 0x3f2d15), P(0x7a5a34, 0x735431), hex(0x5b4023)));
def('birch_log_top', (t, r) => {
  logTop(P(0xd6d8d0, 0xe0e2da, 0x3a3a36), P(0xd2bf85, 0xc9b67c), hex(0xb09c64))(t, r);
});

// ---- leaves ---------------------------------------------------------------------------------------
function leaves(g: number[], holes: number, needle = false) {
  return (t: Tex, r: Rng) => {
    const f = makeFbm(r.int(1e9), [4, 8], [1, 0.7]);
    const vals = new Float32Array(256);
    t.forEach((x, y) => { vals[y * 16 + x] = f(x, y) * 0.5 + r.next() * 0.6; });
    t.forEach((x, y) => {
      const v = vals[y * 16 + x];
      let i = clamp(Math.floor((v - 0.08) * g.length), 0, g.length - 1);
      if (needle && (x + y * 3) % 5 === 0) i = Math.max(0, i - 1);
      t.set(x, y, gray(g[i]));
    });
    // leaf highlights: small bright pixel with a dark pixel beneath-right
    for (let k = 0; k < (needle ? 14 : 18); k++) {
      const x = r.int(16), y = r.int(16);
      t.set(x, y, gray(g[g.length - 1]));
      if (needle) t.set(x, y + 1, gray(g[g.length - 2]));
      else t.set(x + 1, y + 1, gray(g[1]));
    }
    // holes in the darkest spots
    const sorted = [...vals.keys()].sort((a, b) => vals[a] - vals[b]);
    const nHoles = Math.round(256 * holes);
    for (let k = 0; k < nHoles; k++) {
      const i = sorted[k];
      t.setAlpha(i % 16, i >> 4, 0);
    }
    // pixels right under a hole are shadowed
    t.forEach((x, y) => {
      if (t.alpha(x, y) && !t.alpha(x, y - 1) && y > 0) t.set(x, y, gray(Math.max(g[0], t.get(x, y)[0] - 28)));
    });
  };
}
/** Leaf-cluster variant: small voronoi "leaves" shaded top-left light, with holes along cluster gaps. */
function leafClusters(g: number[], holes: number, grid: number) {
  return (t: Tex, r: Rng) => {
    const v = voronoi(r, grid, grid, 0.9, 1, 1);
    const baseShade = v.px.map(() => r.range(2, g.length - 2.2));
    const score = new Float32Array(256);
    t.forEach((x, y) => {
      const k = vid(v, x, y);
      let dx = x + 0.5 - v.px[k]; if (dx > 8) dx -= 16; if (dx < -8) dx += 16;
      let dy = y + 0.5 - v.py[k]; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
      const edge = v.d2[y * 16 + x] - v.d1[y * 16 + x];
      let s = baseShade[k] - (dx + dy) * 0.28 + (r.next() - 0.5) * 1.5;
      if (edge < 0.8) s -= 1.2;
      score[y * 16 + x] = edge + r.next() * 0.9;
      t.set(x, y, gray(g[clamp(Math.round(s), 0, g.length - 1)]));
    });
    const order = [...score.keys()].sort((a, b) => score[a] - score[b]);
    const n = Math.round(256 * holes);
    for (let k = 0; k < n; k++) t.setAlpha(order[k] % 16, order[k] >> 4, 0);
  };
}
def('oak_leaves', leafClusters([96, 118, 142, 166, 190, 216], 0.19, 4));
def('birch_leaves', leafClusters([120, 142, 164, 186, 206, 228], 0.19, 4));
def('spruce_leaves', leaves([84, 104, 124, 146, 168, 192], 0.16, true));

// =================================================================================================
// Fluids
// =================================================================================================

function water(flow: boolean) {
  return (t: Tex, r: Rng) => {
    const n = makeFbm(r.int(1e9), [2, 4], [1, 0.6]);
    const TAU = Math.PI * 2;
    t.forEach((x, y) => {
      const w1 = flow ? Math.sin(TAU * (y * 2 + x * 0) / 16 + n(x, y) * 3) : Math.sin(TAU * (x + y * 2) / 16 + n(x, y) * 3.2);
      const w2 = flow ? Math.sin(TAU * (y * 1 - x) / 16 + n(y, x) * 2) : Math.sin(TAU * (x * 2 - y) / 16 + n(y, x) * 2.5);
      const v = w1 * 0.6 + w2 * 0.4;
      let g = 188 + v * 16 + (r.next() - 0.5) * 8;
      if (v > 0.72) g = 222;
      else if (v > 0.55) g = 208;
      t.set(x, y, gray(clamp(g, 160, 230)), 185);
    });
  };
}
def('water_still', water(false));
def('water_flow', water(true));

function lava(flow: boolean) {
  return (t: Tex, r: Rng) => {
    const pal = P(0x8e2407, 0xb83a0b, 0xd4560e, 0xe8741a, 0xf59a26, 0xfcc238, 0xffe27a);
    const f = makeFbm(r.int(1e9), flow ? [2, 4] : [2, 4, 8], [1, 0.7, 0.35]);
    const g = makeNoise(r.int(1e9), 4);
    const TAU = Math.PI * 2;
    t.forEach((x, y) => {
      const sx = flow ? x * 2 : x, sy = flow ? y * 0.5 : y;
      let v = f(sx, sy) + Math.sin(TAU * (x + y) / 16 + g(x, y) * 4) * 0.12;
      v = (v - 0.5) * 1.7 + 0.55 + (r.next() - 0.5) * 0.18;
      t.set(x, y, pick(pal, v));
    });
  };
}
def('lava_still', lava(false));
def('lava_flow', lava(true));

// =================================================================================================
// Cutout plants / decorations
// =================================================================================================

function sprite(rows: string[], pal: Record<string, number>): Gen {
  const p: Record<string, RGB> = {};
  for (const k of Object.keys(pal)) p[k] = hex(pal[k]);
  return (t) => { t.clear(); drawMap(t, rows, p); };
}

def('dandelion', sprite([
  '................',
  '................',
  '................',
  '................',
  '......yY........',
  '.....yYYy.......',
  '....yYOYYy......',
  '.....yYYOy......',
  '......yyy.......',
  '.......g........',
  '.......g........',
  '....l..g........',
  '.....l.g..l.....',
  '.....Llg.Ll.....',
  '......Lgl.......',
  '.......g........',
], { y: 0xf6d23a, Y: 0xfff14f, O: 0xe29a1c, g: 0x3d7d1e, l: 0x5aa02c, L: 0x2f6516 }));

def('poppy', sprite([
  '................',
  '................',
  '................',
  '.....rR.........',
  '....rRRr.Rr.....',
  '....rRRRrRRr....',
  '.....rRkkRRr....',
  '....rRRkkRr.....',
  '....rrRRRrr.....',
  '......rrg.......',
  '.......g........',
  '.......g........',
  '......lgl.......',
  '.....Ll.gL......',
  '......L.gLl.....',
  '........g.......',
], { r: 0xa31414, R: 0xe01d1d, k: 0x2b1a12, g: 0x3d7d1e, l: 0x5aa02c, L: 0x2f6516 }));

def('cornflower', sprite([
  '................',
  '................',
  '................',
  '................',
  '.......B........',
  '...b..bBb..b....',
  '....bBBwBBb.....',
  '.....BwdwB......',
  '....bBBwBBb.....',
  '...b..bBb..b....',
  '.......g........',
  '.......g........',
  '.....l.g.l......',
  '.....Llg.L......',
  '......Lgl.......',
  '.......g........',
], { b: 0x3a55b8, B: 0x5b7ee6, w: 0x9cb4ff, d: 0x2a2e6a, g: 0x3d7d1e, l: 0x5aa02c, L: 0x2f6516 }));

def('oak_sapling', sprite([
  '................',
  '................',
  '.....lL.........',
  '....lGGL.lL.....',
  '...lGgGGlGGL....',
  '....LGgGGGgL....',
  '..lGGLGGgGL.....',
  '..LGgGGLGGGlL...',
  '...LLGgGGgGGL...',
  '.....LLGbGLL....',
  '......l.b.L.....',
  '........b.......',
  '........b.......',
  '.......Bb.......',
  '.......B........',
  '.......B........',
], { l: 0x7ab83a, G: 0x4f8e22, g: 0x6aa932, L: 0x356b16, b: 0x6b5230, B: 0x4d3b23 }));

def('birch_sapling', sprite([
  '................',
  '................',
  '......lL........',
  '.....lGGL.......',
  '....lGgGGL.lL...',
  '...lGGGgGGlGGL..',
  '...LGgGGLGGgGL..',
  '....LGGgGGGGL...',
  '.....LLGwGLL....',
  '......l.w.......',
  '........w.......',
  '........w.......',
  '........k.......',
  '........w.......',
  '........w.......',
  '........k.......',
], { l: 0xa6d36a, G: 0x7cb043, g: 0x93c457, L: 0x557d2b, w: 0xdadcd4, k: 0x3a3a36 }));

def('spruce_sapling', sprite([
  '................',
  '................',
  '.......G........',
  '......GgG.......',
  '.....GgLgG......',
  '.......L........',
  '.....GGgGG......',
  '....GgLGLgG.....',
  '...G..gLg..G....',
  '......GbG.......',
  '....GGgbgGG.....',
  '...GgL.b.LgG....',
  '..G....b....G...',
  '.......b........',
  '.......B........',
  '.......B........',
], { G: 0x2f5a2f, g: 0x3f7440, L: 0x21401f, b: 0x4a3519, B: 0x36260f }));

def('red_mushroom', sprite([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......rRRr......',
  '....rRwRRRRr....',
  '...rRRRRRwRRr...',
  '...RwRRRRRRRR...',
  '...dddddddddd...',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '.......ss.......',
], { r: 0xb71c1c, R: 0xe02828, w: 0xf2f2f2, d: 0x8a1414, s: 0xc8c0b0, S: 0xe8e2d6 }));

def('brown_mushroom', sprite([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......bBBb......',
  '....bBBLBBBb....',
  '...bBLBBBBBBb...',
  '...ddddddddddd..',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '.......ss.......',
], { b: 0x7c5a44, B: 0x967058, L: 0xae8a70, d: 0x5e4232, s: 0xb8ab98, S: 0xd8cebf }));

def('dead_bush', sprite([
  '................',
  '................',
  '..b.........b...',
  '...b.......b....',
  '...b..b...b..b..',
  '....b.b..b..b...',
  '.b...b.b.b.b....',
  '..b..b.bb..b....',
  '...b.b..b.b.....',
  '....bb..bb...b..',
  '.....b..b...b...',
  '......b.b..b....',
  '......bbbbb.....',
  '.......BbB......',
  '........B.......',
  '........B.......',
], { b: 0x8a6230, B: 0x6b4a22 }));

def('sugar_cane', (t, r) => {
  t.clear();
  const L = P(0x5e9b35, 0x7cbf4a, 0x9ed66a), D = hex(0x3f7424), N = hex(0xc6e89a);
  const stalks = [2, 7, 12];
  stalks.forEach((sx, si) => {
    const off = (si * 3 + r.int(2)) % 5;
    for (let y = 0; y < 16; y++) {
      const node = (y + off) % 5 === 0;
      t.set(sx, y, node ? N : L[1]);
      t.set(sx + 1, y, node ? L[2] : D);
    }
    // a leaf sprouting from one node
    const ny = ((5 - off) % 5) + 5;
    const dir = si === 0 ? 1 : si === 2 ? -1 : r.chance(0.5) ? 1 : -1;
    const x0 = dir > 0 ? sx + 2 : sx - 1;
    t.set(x0, ny - 1, L[0]); t.set(x0 + dir, ny - 2, L[1]); t.set(x0 + dir, ny - 3, L[2]);
  });
});

function shortGrass(t: Tex, r: Rng) {
  t.clear();
  const blades = 13;
  for (let i = 0; i < blades; i++) {
    const bx = 0.6 + (i + r.range(0.1, 0.9)) * 14.8 / blades;
    const centre = 1 - Math.abs(bx - 7.5) / 8;
    const h = Math.round(clamp(3 + centre * 9 + r.range(-3, 3), 3, 15));
    const lean = (bx - 7.5) / 7.5 * r.range(0.5, 2.5) + r.range(-0.8, 0.8);
    for (let k = 0; k < h; k++) {
      const f = k / Math.max(1, h - 1);
      const x = Math.round(bx - 0.5 + lean * f * f);
      const y = 15 - k;
      if (x < 0 || x > 15) continue;
      const g = f > 0.85 ? 228 : f > 0.6 ? 208 : f > 0.35 ? 186 : f > 0.15 ? 162 : 140;
      t.set(x, y, gray(g + r.irange(-6, 6)));
    }
  }
}
def('short_grass', shortGrass);

function fern(t: Tex, r: Rng) {
  t.clear();
  const fronds: Array<[number, number, number]> = [[7, 7, 1], [8, 2, 4], [7, 13, 4], [7, 0, 9], [8, 15, 9]];
  // draw back fronds first
  fronds.forEach(([sx, ex, ey], fi) => {
    const x0 = sx + 0.5, y0 = 15.5, x1 = ex + 0.5, y1 = ey + 0.5;
    const L = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / L, dy = (y1 - y0) / L;
    const px = -dy, py = dx;
    const n = Math.ceil(L);
    for (let k = 0; k <= n; k++) {
      const cx = x0 + dx * k, cy = y0 + dy * k;
      const f = k / n;
      t.put(Math.floor(cx), Math.floor(cy), gray(f > 0.85 ? 214 : 132 + f * 60));
      if (k >= 1 && k < n && (k + fi) % 2 === 0) {
        const ll = f < 0.55 ? 2 : 1;
        for (let j = 1; j <= ll; j++) {
          const ox = dx * 0.7 * j, oy = dy * 0.7 * j;
          t.put(Math.floor(cx + px * j + ox), Math.floor(cy + py * j + oy), gray(j === ll ? 212 : 184));
          t.put(Math.floor(cx - px * j + ox), Math.floor(cy - py * j + oy), gray(j === ll ? 172 : 150));
        }
      }
    }
  });
  void r;
}
def('fern', fern);

function wheat(stage: number) {
  return (t: Tex, r: Rng) => {
    t.clear();
    const heights = [3, 5, 7, 9, 11, 12, 14, 15];
    const H = heights[stage];
    const stems = [
      P(0x2e6b15, 0x3f8a1d, 0x5aa82b), P(0x2e6b15, 0x3f8a1d, 0x5aa82b), P(0x2e6b15, 0x3f8a1d, 0x5aa82b), P(0x2e6b15, 0x3f8a1d, 0x5aa82b),
      P(0x3a6f18, 0x4f8a22, 0x6aa22c), P(0x4d7a1f, 0x6a932a, 0x86a834), P(0x6e7a26, 0x8e9432, 0xaaa83e), P(0x7d6a22, 0x9a8530, 0xb59d3e),
    ];
    const heads = [
      null, null, null, null,
      P(0x3f7a1a, 0x5a9a26, 0x74b232, 0x8cc442), P(0x6a8a22, 0x8aa02c, 0xa4b43a, 0xbccb50),
      P(0x9a8a24, 0xb8a334, 0xcfbb48, 0xe0d066), P(0x9a6e1c, 0xc2922c, 0xdcb449, 0xf2d878),
    ];
    const stem = stems[stage], head = heads[stage];
    const cols = [1, 4, 7, 10, 13];
    cols.forEach((cx, ci) => {
      const h = clamp(H + ((ci * 5 + stage) % 3) - 1, 2, 16);
      const headLen = head ? Math.min(h - 1, stage >= 6 ? 6 : 4) : 0;
      let x = cx + (r.chance(0.5) ? 0 : 1);
      for (let k = 0; k < h; k++) {
        const y = 15 - k;
        if (head && k >= h - headLen) {
          const top = k === h - 1;
          if (top) { t.set(x, y, head[3]); continue; }
          const odd = (k & 1) === 1;
          t.set(x, y, odd ? head[2] : head[1]);
          t.set(x + 1, y, odd ? head[0] : head[3]);
        } else {
          t.set(x, y, stem[(k + ci) % 3 === 0 ? 0 : 1]);
          // leaves
          if (k > 0 && k < h - headLen - 1 && (k + ci) % 4 === 1) {
            const dir = (k + ci) % 8 < 4 ? -1 : 1;
            t.put(x + dir, y - 1, stem[2]);
            if (stage >= 2) t.put(x + dir * 2, y - 2, stem[1]);
          }
          if (k === 4 && stage >= 3 && ci % 2 === 0) x = clamp(x + (ci < 2 ? -1 : 1), 0, 14);
        }
      }
    });
  };
}
for (let i = 0; i < 8; i++) def(`wheat_stage${i}`, wheat(i));

def('ladder', (t) => {
  t.clear();
  const W = P(0x5c4527, 0x7a5d34, 0x9a7a45, 0xb08d57);
  for (let y = 0; y < 16; y++) {
    t.set(2, y, W[3]); t.set(3, y, W[1]);
    t.set(12, y, W[2]); t.set(13, y, W[1]);
  }
  for (const ry of [1, 5, 9, 13]) {
    for (let x = 4; x <= 11; x++) { t.set(x, ry, W[2]); t.set(x, ry + 1, W[0]); }
    t.set(4, ry, W[3]);
  }
});

def('torch', (t) => {
  t.clear();
  t.set(7, 6, hex(0xffffc8)); t.set(8, 6, hex(0xfff08a));
  t.set(7, 7, hex(0xffd84a)); t.set(8, 7, hex(0xffb02a));
  t.set(7, 8, hex(0xe8801a)); t.set(8, 8, hex(0xb85a12));
  for (let y = 9; y < 16; y++) { t.set(7, y, hex(0x8a6a3a)); t.set(8, y, hex(0x5e4524)); }
});
def('torch_fire', sprite([
  '................',
  '.......y........',
  '......yo........',
  '......yoy.......',
  '.....yooy..y....',
  '....yoYoo..oy...',
  '....yoYYoy.oy...',
  '...yoYWYooyoy...',
  '...yoYWWYooy....',
  '..yoYYWWYYoy....',
  '..yoYWWWWYoy....',
  '..yoYWWWWYooy...',
  '..yoYYWWYYoy....',
  '...yoYYYYoy.....',
  '....yooooy......',
  '.....yyyy.......',
], { y: 0xd8501a, o: 0xf08a1e, Y: 0xffc83a, W: 0xfff6b8 }));

def('lantern', (t) => {
  t.clear();
  const F = P(0x2b2e36, 0x3f434d, 0x5a5f6b);
  // handle (cols 7..8 rows 6..8)
  for (let y = 6; y <= 8; y++) { t.set(7, y, F[1]); t.set(8, y, F[0]); }
  // body cols 5..10 rows 9..15
  for (let y = 9; y <= 15; y++)
    for (let x = 5; x <= 10; x++) {
      const frame = y === 9 || y === 10 || y === 15 || x === 5 || x === 10;
      if (frame) t.set(x, y, y === 9 ? F[2] : x === 10 || y === 15 ? F[0] : F[1]);
      else {
        const core = (x === 7 || x === 8) && y >= 12 && y <= 13;
        t.set(x, y, hex(core ? 0xfff4b0 : y === 11 ? 0xf6a431 : 0xffcf4a));
      }
    }
});

// =================================================================================================
// Glass / wool
// =================================================================================================

def('glass', (t) => {
  t.clear();
  const A = hex(0xdcf0f4), B = hex(0xa9ccd6);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, A); t.set(0, i, A);
    t.set(i, 15, B); t.set(15, i, B);
  }
  // gaps in the frame like vanilla
  const W = hex(0xffffff);
  for (const [x, y] of [[2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [4, 7], [5, 6], [6, 5], [10, 13], [11, 12], [12, 11], [13, 10]] as Array<[number, number]>)
    t.set(x, y, W);
});

def('white_wool', (t, r) => wool(t, r, [233, 236, 236]));
function wool(t: Tex, r: Rng, c: RGB) {
  const f = makeNoise(r.int(1e9), 8);
  t.forEach((x, y) => {
    const weave = (((x >> 1) + (y >> 1)) & 1) ? 0.045 : -0.045;
    const diag = ((x + 2 * y) % 4 === 0) ? -0.06 : ((x + 2 * y) % 4 === 2) ? 0.03 : 0;
    let s = 1 + weave + diag + (f(x, y) - 0.5) * 0.12 + (r.next() - 0.5) * 0.09;
    t.set(x, y, scale(c, s));
  });
}

// WOOL_COLORS mirrored here to avoid a dependency on shared/ at texture-generation time.
const WOOL: Array<[string, RGB]> = [
  ['orange', [240, 118, 19]], ['magenta', [189, 68, 179]], ['light_blue', [58, 175, 217]], ['yellow', [248, 198, 39]],
  ['lime', [112, 185, 25]], ['pink', [237, 141, 172]], ['gray', [62, 68, 71]], ['light_gray', [142, 142, 134]],
  ['cyan', [21, 137, 145]], ['purple', [121, 42, 172]], ['blue', [53, 57, 157]], ['brown', [114, 71, 40]],
  ['green', [84, 109, 27]], ['red', [160, 39, 34]], ['black', [20, 21, 25]], ['white', [233, 236, 236]],
];
for (const [k, c] of WOOL) {
  if (k !== 'white') def(`${k}_wool`, (t, r) => wool(t, r, c));
  def(`${k}_stained_glass`, (t, r) => {
    const cc = mix(c, [255, 255, 255], 0.12);
    t.forEach((x, y) => t.set(x, y, scale(cc, 1 + (r.next() - 0.5) * 0.06), 140));
    const edge = scale(c, 0.8);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, edge, 205); t.set(0, i, edge, 205); t.set(i, 15, edge, 205); t.set(15, i, edge, 205);
    }
    const hi = mix(c, [255, 255, 255], 0.55);
    for (const [x, y] of [[3, 4], [4, 3], [3, 6], [4, 5], [5, 4], [6, 3], [11, 12], [12, 11]] as Array<[number, number]>) t.set(x, y, hi, 165);
  });
}

// =================================================================================================
// Crafted / functional blocks
// =================================================================================================

def('crafting_table_top', (t, r) => {
  t.copyFrom(base('oak_planks'));
  const lt = P(0xb78f5a, 0xc29d65, 0xcca56a);
  t.forEach((x, y) => { if (x > 0 && y > 0 && x < 15 && y < 15) t.set(x, y, r.weighted(lt, [2, 3, 1])); });
  // frame
  bevelFrame(t, hex(0x7a5c34), hex(0x4f3a1f));
  for (let i = 1; i < 15; i++) { t.set(i, 1, hex(0x5e4527)); t.set(1, i, hex(0x5e4527)); t.set(i, 14, hex(0xd6b27a)); t.set(14, i, hex(0xd6b27a)); }
  // 3x3 grid
  for (const g of [5, 10]) for (let i = 2; i < 14; i++) { t.set(g, i, hex(0x7a5c34)); t.set(i, g, hex(0x7a5c34)); }
  for (const g of [5, 10]) for (let i = 2; i < 14; i++) { if (i !== 5 && i !== 10) { t.set(g + 1, i, hex(0xd9b67e)); t.set(i, g + 1, hex(0xd9b67e)); } }
});
function tableSideBase(t: Tex, r: Rng) {
  t.copyFrom(base('oak_planks'));
  // top rim
  for (let x = 0; x < 16; x++) { t.set(x, 0, hex(0xc9a36b)); t.set(x, 1, hex(0xb08a55)); t.set(x, 2, hex(0x4f3a1f)); }
  // darker lower body with legs
  t.forEach((x, y) => {
    if (y < 3) return;
    if (x <= 1 || x >= 14) {
      t.set(x, y, x === 0 || x === 14 ? hex(0x9c7a47) : hex(0x6b5230));
      if (y === 15) t.set(x, y, hex(0x4f3a1f));
    } else t.set(x, y, scale(t.get(x, y), 0.72));
  });
  void r;
}
const TOOL_PAL = {
  I: hex(0x9a9a9a), S: hex(0xd4d4d4), K: hex(0x4a4a4a), T: hex(0x6e6e6e),
  w: hex(0x9c7a47), W: hex(0x5e4527), o: hex(0x2b1e10),
};
def('crafting_table_side', (t, r) => {
  tableSideBase(t, r);
  // hammer + pincers hanging on the side
  drawMap(t, [
    '.KKKKK.....K..K.',
    '.KSSIK.....KIIK.',
    '.KKKKK......KK..',
    '....w.......KK..',
    '....w......KI.IK',
    '....w......KI.IK',
    '....w......KK.KK',
    '....W...........',
    '....W...........',
  ], TOOL_PAL, 0, 4);
});
def('crafting_table_front', (t, r) => {
  tableSideBase(t, r);
  // saw
  drawMap(t, [
    'ooooKKKKKKKKK..',
    'owwoSSSSSSSSSK.',
    'o.woIIIIIIIIIIK',
    'owwoIIIIIIIIIK.',
    'ooooTKTKTKTKT..',
  ], TOOL_PAL, 1, 4);
  // hammer
  drawMap(t, [
    '.KKKKK..',
    'KSSSIK..',
    '.KKwKK..',
    '...w....',
    '...w....',
    '...W....',
  ], TOOL_PAL, 8, 9);
  // chisel
  drawMap(t, ['K', 'I', 'I', 'w', 'W', 'o'], TOOL_PAL, 4, 10);
});

function stoneWorkBase(t: Tex, r: Rng) {
  const S = P(0x585858, 0x6b6b6b, 0x767676, 0x828282, 0x8e8e8e);
  const f = makeFbm(r.int(1e9), [4, 8]);
  t.forEach((x, y) => t.set(x, y, pick(S, f(x, y) * 0.5 + r.next() * 0.55)));
  bevelFrame(t, hex(0x9a9a9a), hex(0x4a4a4a));
}
def('furnace_top', (t, r) => {
  stoneWorkBase(t, r);
  for (let i = 2; i < 14; i++) { t.set(i, 2, hex(0x5a5a5a)); t.set(2, i, hex(0x5a5a5a)); t.set(i, 13, hex(0x959595)); t.set(13, i, hex(0x959595)); }
});
def('furnace_side', (t, r) => {
  stoneWorkBase(t, r);
  for (let x = 1; x < 15; x++) { t.set(x, 1, hex(0x8e8e8e)); t.set(x, 2, hex(0x5a5a5a)); }
});
function furnaceFront(lit: boolean): Gen {
  return (t, r) => {
    stoneWorkBase(t, r);
    // top vent
    for (let x = 4; x <= 11; x++) { t.set(x, 2, hex(0x9a9a9a)); t.set(x, 5, hex(0x9a9a9a)); }
    for (let x = 4; x <= 11; x++) for (let y = 3; y <= 4; y++) t.set(x, y, (x & 1) ? hex(0x2a2a2a) : hex(0x4a4a4a));
    // mouth frame
    for (let x = 3; x <= 12; x++) { t.set(x, 7, hex(0x3a3a3a)); t.set(x, 14, hex(0xa2a2a2)); }
    for (let y = 7; y <= 14; y++) { t.set(3, y, hex(0x3a3a3a)); t.set(12, y, hex(0xa2a2a2)); }
    // mouth interior
    for (let y = 8; y <= 13; y++)
      for (let x = 4; x <= 11; x++) {
        if (!lit) t.set(x, y, hex(y === 8 ? 0x101010 : (x + y) % 5 === 0 ? 0x262626 : 0x1a1a1a));
        else {
          const hgt = 13 - y;
          const flame = hgt < 2 + ((x * 7 + 3) % 4) - (x === 4 || x === 11 ? 1 : 0);
          const c = hgt === 0 ? 0xfff2a0 : flame ? (hgt < 2 ? 0xffd23a : hgt < 3 ? 0xf59a1e : 0xd8561a) : y === 8 ? 0x2a1206 : 0x3a1a08;
          t.set(x, y, hex(c));
        }
      }
    if (lit) for (let x = 3; x <= 12; x++) t.set(x, 14, hex(0xd2a060));
  };
}
def('furnace_front', furnaceFront(false));
def('furnace_front_on', furnaceFront(true));

// chest
const CH = { out: hex(0x2e1f0b), dark: hex(0x6d4516), mid: hex(0x92601f), light: hex(0xab7428), hi: hex(0xc28a36) };
function chestBase(t: Tex, r: Rng, lidLine: boolean) {
  for (let y = 0; y < 16; y++) {
    let x = 0;
    while (x < 16) {
      const len = r.irange(2, 7);
      const c = (y & 3) === 3 ? r.weighted([CH.dark, CH.mid], [3, 1]) : r.weighted([CH.mid, CH.light, CH.hi], [4, 3, 1]);
      for (let k = 0; k < len && x < 16; k++, x++) t.set(x, y, c);
    }
  }
  for (let i = 0; i < 16; i++) { t.set(i, 0, CH.out); t.set(i, 15, CH.out); t.set(0, i, CH.out); t.set(15, i, CH.out); }
  for (let i = 1; i < 15; i++) { t.set(i, 1, CH.hi); t.set(1, i, CH.hi); t.set(i, 14, CH.dark); t.set(14, i, CH.dark); }
  if (lidLine) for (let x = 0; x < 16; x++) { t.set(x, 5, CH.out); t.set(x, 6, CH.hi); t.set(x, 4, CH.dark); }
}
def('chest_side', (t, r) => chestBase(t, r, true));
def('chest_top', (t, r) => chestBase(t, r, false));
def('chest_front', (t, r) => {
  chestBase(t, r, true);
  drawMap(t, [
    'kkkk',
    'kSLk',
    'kLDk',
    'kDDk',
    'kkkk',
  ], { k: hex(0x1c1c1c), S: hex(0xeeeeee), L: hex(0xbdbdbd), D: hex(0x7e7e7e) }, 6, 3);
});

def('bookshelf', (t, r) => {
  const pl = base('oak_planks');
  t.copyFrom(pl);
  const bg = hex(0x2b1e10);
  const colors = P(0x9c2a22, 0x2a3f8c, 0x2e6a2a, 0x6b4424, 0x5f2a74, 0xb09a6a, 0x2a6a6a, 0x8a6a2a);
  for (const [y0, y1] of [[1, 6], [9, 14]] as Array<[number, number]>) {
    for (let y = y0; y <= y1; y++) for (let x = 0; x < 16; x++) t.set(x, y, bg);
    let x = 0;
    while (x < 16) {
      const w = r.chance(0.35) ? 2 : 1;
      const c = r.pick(colors);
      const top = y0 + (r.chance(0.35) ? 1 : 0);
      if (r.chance(0.12)) { x += 1; continue; } // gap
      for (let k = 0; k < w && x < 16; k++, x++)
        for (let y = top; y <= y1; y++) {
          let cc = k === 0 ? scale(c, 1.15) : scale(c, 0.8);
          if (y === top) cc = scale(c, 1.3);
          if (y === top + 2 || y === y1 - 1) cc = mix(cc, hex(0xd8c070), 0.35);
          t.set(x, y, cc);
        }
    }
  }
  for (let x = 0; x < 16; x++) { t.set(x, 0, pl.get(x, 1)); t.set(x, 15, OAK.sep); t.set(x, 7, OAK.light); t.set(x, 8, OAK.sep); }
});

def('tnt_side', (t) => {
  const R = P(0x8e2414, 0xb8301b, 0xd4402a, 0xe8604a);
  t.forEach((x, y) => {
    const m = x & 3;
    t.set(x, y, R[m === 0 ? 0 : m === 1 ? 3 : m === 2 ? 2 : 1]);
  });
  for (let x = 0; x < 16; x++) { t.set(x, 0, scale(t.get(x, 0), 0.85)); t.set(x, 15, scale(t.get(x, 15), 0.8)); }
  for (let y = 5; y <= 10; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(y === 5 || y === 10 ? 0xb5b5b5 : 0xe6e6e6));
  drawMap(t, [
    '###.#..#.###',
    '.#..##.#..#.',
    '.#..#.##..#.',
    '.#..#..#..#.',
  ], { '#': hex(0x1a1a1a) }, 2, 6);
});
function tntEnd(fuse: boolean): Gen {
  return (t) => {
    t.fill(hex(0x8e2414));
    const R = P(0xb8301b, 0xd4402a, 0xe8604a);
    for (const [cx, cy] of [[3.5, 3.5], [11.5, 3.5], [3.5, 11.5], [11.5, 11.5], [7.5, 7.5]] as Array<[number, number]>) {
      t.forEach((x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 3.3) t.set(x, y, d < 1.4 ? R[0] : d < 2.4 ? R[1] : x - cx + y - cy < 0 ? R[2] : R[0]);
        else if (d < 3.9) t.set(x, y, hex(0x5a1408));
      });
    }
    if (fuse) {
      t.set(7, 7, hex(0x3a3a3a)); t.set(8, 7, hex(0x5a5a5a)); t.set(7, 8, hex(0x5a5a5a)); t.set(8, 8, hex(0x2a2a2a));
      t.set(8, 6, hex(0x7a7a7a));
    }
  };
}
def('tnt_top', tntEnd(true));
def('tnt_bottom', tntEnd(false));

// ---- pumpkin / melon / cactus ---------------------------------------------------------------------
const PUMP = P(0x8a4a0c, 0xb8610f, 0xd07814, 0xe38a1d, 0xefa132, 0xf7b84a);
function pumpkinSide(t: Tex, r: Rng) {
  const prof = [0, 2, 3, 4, 4, 3, 2, 1];
  t.forEach((x, y) => {
    const seg = (x + 3) % 8;
    let i = prof[seg] + (r.next() < 0.2 ? -1 : 0);
    if (y === 0 || y === 15) i -= 1;
    t.set(x, y, PUMP[clamp(i, 0, 5)]);
  });
  for (let i = 0; i < 6; i++) t.set(r.int(16), r.int(16), PUMP[5]);
}
def('pumpkin_side', pumpkinSide);
def('pumpkin_top', (t, r) => {
  t.forEach((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let i = d > 7 ? 1 : d > 5 ? 3 : d > 3 ? 4 : 3;
    if (Math.abs(x - 7.5) < 1 || Math.abs(y - 7.5) < 1) i -= 1;
    if (r.chance(0.15)) i -= 1;
    t.set(x, y, PUMP[clamp(i, 0, 5)]);
  });
  drawMap(t, ['.sS.', 'sSSs', 'SSsd', '.dd.'], { s: hex(0x7a8a2a), S: hex(0x5a6a1c), d: hex(0x3e4a12) }, 6, 6);
});
def('jack_o_lantern', (t, r) => {
  pumpkinSide(t, r);
  const G = { o: hex(0x6b3a07), y: hex(0xffd23a), Y: hex(0xfff38a), a: hex(0xf2a51e) };
  drawMap(t, [
    '................',
    '................',
    '................',
    '...o......o.....',
    '..oYo....oYo....',
    '.oyYyo..oyYyo...',
    '.ooooo..ooooo...',
    '................',
    '..o.........o...',
    '..oyooo.oooyo...',
    '..oyYyYyYyYyo...',
    '..oayyYYYyyao...',
    '...oooyyyoooo...',
    '......ooo.......',
  ], G, 1, 0);
});
def('melon_side', (t, r) => {
  const M = P(0x3f6a0f, 0x547f16, 0x6a961f, 0x86aa2a, 0xa8c236);
  t.forEach((x, y) => {
    const s = (x + 1) % 4;
    let i = s === 0 ? 3 : s === 1 ? 2 : s === 2 ? 1 : 2;
    if (s === 0 && r.chance(0.3)) i = 4;
    if (r.chance(0.15)) i += r.chance(0.5) ? 1 : -1;
    t.set(x, y, M[clamp(i, 0, 4)]);
  });
});
def('melon_top', (t, r) => {
  const M = P(0x3f6a0f, 0x547f16, 0x6a961f, 0x86aa2a, 0xa8c236);
  t.forEach((x, y) => {
    const a = Math.atan2(y - 7.5, x - 7.5);
    const s = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2;
    let i = s ? 3 : 1;
    if (r.chance(0.2)) i += 1;
    t.set(x, y, M[clamp(i, 0, 4)]);
  });
  t.rect(6, 6, 4, 4, M[2]);
  drawMap(t, ['.aA.', 'aAAa', 'AAaD', '.DD.'], { a: hex(0x86aa2a), A: hex(0x6a961f), D: hex(0x3f6a0f) }, 6, 6);
});
const CAC = P(0x0a4a14, 0x0d6a1c, 0x138226, 0x229633, 0x4bb04e);
def('cactus_side', (t, r) => {
  const prof = [0, 0, 3, 2, 2, 1, 3, 2, 2, 1, 3, 2, 2, 1, 0, 0];
  t.forEach((x, y) => {
    let i = prof[x];
    if (r.chance(0.1)) i = clamp(i + (r.chance(0.5) ? 1 : -1), 1, 4);
    t.set(x, y, CAC[i]);
  });
  // spines: black dot + light tip on ridges
  for (let y = 1; y < 16; y += 4) for (const x of [2, 6, 10]) {
    const yy = y + ((x * 3) % 4);
    t.set(x, yy, hex(0x1a1a0a)); t.set(x + (x > 8 ? 1 : -1), yy - 1, hex(0xd8e0b0));
  }
  t.forEach((x, y) => { if (x === 1) t.set(x, y, CAC[0]); if (x === 14) t.set(x, y, CAC[0]); });
});
def('cactus_top', (t, r) => {
  t.forEach((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let i = d > 6 ? 0 : d > 5 ? 2 : d > 3.5 ? 3 : d > 1.5 ? 2 : 4;
    if (r.chance(0.12)) i = clamp(i + 1, 0, 4);
    t.set(x, y, CAC[i]);
  });
});
def('cactus_bottom', (t, r) => {
  t.forEach((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    t.set(x, y, CAC[d > 6 ? 0 : r.chance(0.3) ? 1 : 2]);
  });
});

// ---- farmland / bed --------------------------------------------------------------------------------
def('farmland', (t, r) => {
  const F = P(0x3e2716, 0x4f3320, 0x5d3d26, 0x6c4a30, 0x7c573a);
  t.forEach((x, y) => {
    const m = y & 3;
    let i = m === 0 ? 3 : m === 1 ? 2 : m === 2 ? 2 : 0;
    if (r.chance(0.25)) i += r.chance(0.5) ? 1 : -1;
    if (m === 0 && r.chance(0.2)) i = 4;
    t.set(x, y, F[clamp(i, 0, 4)]);
  });
});
def('bed_top', (t, r) => {
  const Rd = P(0x6e1410, 0x8e1c17, 0xa3241e, 0xbd3128);
  const Wt = P(0xb8b8b8, 0xd8d8d8, 0xeeeeee);
  t.forEach((x, y) => {
    if (y <= 4) {
      let c = Wt[2];
      if (y === 4 || x === 0 || x === 15) c = Wt[0];
      else if (y === 0 || x === 1 || x === 14) c = Wt[1];
      else if (r.chance(0.15)) c = Wt[1];
      t.set(x, y, c);
    } else {
      let c = Rd[2];
      if (y === 5) c = Rd[3];
      if (x === 0 || x === 15) c = Rd[0];
      else if (x === 1 || x === 14) c = Rd[1];
      else if (r.chance(0.12)) c = Rd[1];
      t.set(x, y, c);
    }
  });
});
def('bed_side', (t, r) => {
  const Rd = P(0x6e1410, 0x8e1c17, 0xa3241e, 0xbd3128);
  const Wd = P(0x4f3a1f, 0x7a5d34, 0x9c7a47);
  // Both halves identical so the slab (which samples rows 8..15) always looks right.
  for (const oy of [0, 8]) {
    for (let x = 0; x < 16; x++) {
      t.set(x, oy, Rd[3]);
      t.set(x, oy + 1, Rd[2]);
      t.set(x, oy + 2, r.chance(0.15) ? Rd[1] : Rd[2]);
      t.set(x, oy + 3, Rd[0]);
      t.set(x, oy + 4, Wd[2]);
      t.set(x, oy + 5, Wd[1]);
      t.set(x, oy + 6, (x <= 2 || x >= 13) ? Wd[1] : Wd[0]);
      t.set(x, oy + 7, (x <= 2 || x >= 13) ? Wd[0] : hex(0x2a1f12));
    }
  }
});

// =================================================================================================
// Destroy stages
// =================================================================================================
const CRACK_TIME: Float32Array = (() => {
  const r = new Rng('destroy_cracks');
  const T = new Float32Array(256).fill(Infinity);
  const plot = (x: number, y: number, time: number) => {
    if (x < 0 || y < 0 || x > 15 || y > 15) return false;
    const i = y * 16 + x;
    if (time < T[i]) T[i] = time;
    return true;
  };
  const crack = (sx: number, sy: number, ang: number, len: number, t0: number, depth: number) => {
    let x = sx, y = sy;
    for (let k = 0; k < len; k++) {
      ang += r.range(-0.4, 0.4);
      const nx = x + Math.cos(ang), ny = y + Math.sin(ang);
      if (!plot(Math.round(nx), Math.round(ny), t0 + k + 1)) return;
      x = nx; y = ny;
      if (depth < 2 && k > 1 && r.chance(0.14)) {
        crack(x, y, ang + (r.chance(0.5) ? 1 : -1) * r.range(0.7, 1.3), Math.floor((len - k) * 0.6), t0 + k + 1, depth + 1);
      }
    }
  };
  plot(7, 7, 0); plot(8, 8, 0.5);
  const a0 = r.range(0, Math.PI * 2);
  for (let k = 0; k < 5; k++) crack(7.5, 7.5, a0 + k * (Math.PI * 2 / 5) + r.range(-0.3, 0.3), 13, 0, 0);
  // late secondary cracks starting from existing crack pixels
  const existing = () => { const out: number[] = []; T.forEach((v, i) => { if (v < 7) out.push(i); }); return out; };
  const ex = existing();
  for (let k = 0; k < 6; k++) {
    const i = ex[r.int(ex.length)];
    crack(i % 16, i >> 4, r.range(0, Math.PI * 2), r.irange(4, 7), 5 + k * 0.5, 1);
  }
  // fill emptier quadrants late (stages 7..9)
  for (let k = 0; k < 8; k++) {
    const qx = (k & 1) * 8, qy = ((k >> 1) & 1) * 8;
    crack(qx + r.range(1, 7), qy + r.range(1, 7), r.range(0, Math.PI * 2), r.irange(3, 6), 7.5 + (k >> 2) * 1.5, 2);
  }
  return T;
})();
const CRACK_STAGE_T = [2.0, 2.8, 3.6, 4.2, 5.2, 6.3, 7.6, 8.8, 10.2, 99];
for (let s = 0; s < 10; s++) {
  def(`destroy_stage_${s}`, (t) => {
    t.clear();
    for (let i = 0; i < 256; i++) if (CRACK_TIME[i] <= CRACK_STAGE_T[s]) t.set(i % 16, i >> 4, [22, 20, 20], 200);
  });
}

// =================================================================================================
// Public API
// =================================================================================================

const cache = new Map<string, Uint8ClampedArray>();

/** 16*16*4 RGBA, row-major, row 0 = top. Unknown names give a magenta/black checkerboard. */
export function generateBlockTexture(name: string): Uint8ClampedArray {
  const hit = cache.get(name);
  if (hit) return new Uint8ClampedArray(hit);
  let out: Uint8ClampedArray;
  const g = GEN.get(name);
  if (!g) out = missingTexture();
  else {
    try {
      const t = new Tex();
      g(t, new Rng(hashStr(name)), name);
      out = t.data;
    } catch {
      out = missingTexture();
    }
  }
  cache.set(name, out);
  return new Uint8ClampedArray(out);
}

/** Names this module knows how to generate. */
export function knownBlockTextures(): string[] {
  return [...GEN.keys()];
}
