/**
 * Tiny pixel-art toolkit used by the procedural texture generators.
 * Pure TypeScript, no DOM — safe for Web Workers and Node.
 */

export type RGB = [number, number, number];

export const SIZE = 16;

/** FNV-1a 32-bit string hash. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic mulberry32 RNG. */
export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  irange(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)];
  }
  /** Weighted pick: weights array parallel to items. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// ---- colour helpers -----------------------------------------------------------------------------

export function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function scale(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}
export function add(c: RGB, d: number): RGB {
  return [c[0] + d, c[1] + d, c[2] + d];
}
export function gray(v: number): RGB {
  return [v, v, v];
}
export function lum(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Build an n-step ramp between colours (inclusive of ends). */
export function ramp(stops: RGB[], n: number): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    out.push(mix(stops[k], stops[k + 1], t - k));
  }
  return out;
}

// ---- tileable value noise ---------------------------------------------------------------------

/**
 * Returns a tileable value-noise function with the given lattice period (cells across 16px).
 * `period` must divide 16 evenly for perfect tiling (1,2,4,8,16).
 */
export function makeNoise(seed: number, period: number): (x: number, y: number) => number {
  const rng = new Rng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const cell = SIZE / period;
  return (x: number, y: number) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const m = (v: number) => ((v % period) + period) % period;
    const a = grid[m(y0) * period + m(x0)], b = grid[m(y0) * period + m(x0 + 1)];
    const c = grid[m(y0 + 1) * period + m(x0)], d = grid[m(y0 + 1) * period + m(x0 + 1)];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Fractal tileable noise normalised to ~0..1. */
export function makeFbm(seed: number, periods: number[], weights?: number[]): (x: number, y: number) => number {
  const fs = periods.map((p, i) => makeNoise(seed + i * 7919, p));
  const ws = weights ?? periods.map((_, i) => 1 / (i + 1));
  const tot = ws.reduce((a, b) => a + b, 0);
  return (x, y) => {
    let v = 0;
    for (let i = 0; i < fs.length; i++) v += fs[i](x, y) * ws[i];
    return v / tot;
  };
}

// ---- texture buffer -----------------------------------------------------------------------------

export class Tex {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  constructor(w = SIZE, h = SIZE) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  private i(x: number, y: number): number {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    return (y * this.w + x) * 4;
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** Set pixel (coordinates wrap around). */
  set(x: number, y: number, c: RGB, a = 255): void {
    const i = this.i(x, y);
    this.data[i] = Math.round(c[0]);
    this.data[i + 1] = Math.round(c[1]);
    this.data[i + 2] = Math.round(c[2]);
    this.data[i + 3] = a;
  }
  /** Set pixel only when inside bounds (no wrap). */
  put(x: number, y: number, c: RGB, a = 255): void {
    if (this.inside(x, y)) this.set(x, y, c, a);
  }
  get(x: number, y: number): RGB {
    const i = this.i(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number): number {
    return this.data[this.i(x, y) + 3];
  }
  setAlpha(x: number, y: number, a: number): void {
    this.data[this.i(x, y) + 3] = a;
  }
  fill(c: RGB, a = 255): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
  }
  clear(): void {
    this.data.fill(0);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 255): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, c, a);
  }
  /** Multiply pixel brightness. */
  shade(x: number, y: number, f: number): void {
    const c = this.get(x, y);
    const a = this.alpha(x, y);
    this.set(x, y, scale(c, f), a);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.put(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  forEach(fn: (x: number, y: number) => void): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y);
  }
  copyFrom(o: Tex): void {
    this.data.set(o.data);
  }
  clone(): Tex {
    const t = new Tex(this.w, this.h);
    t.data.set(this.data);
    return t;
  }
  /** Convert to grayscale in place (keeps alpha). */
  toGray(): void {
    this.forEach((x, y) => {
      const v = lum(this.get(x, y));
      this.set(x, y, gray(v), this.alpha(x, y));
    });
  }
}

/** Draw a char-map. Chars missing from the palette (e.g. '.' or ' ') are skipped. */
export function drawMap(t: Tex, rows: string[], pal: Record<string, RGB>, ox = 0, oy = 0, alpha = 255): void {
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y];
    for (let x = 0; x < r.length; x++) {
      const c = pal[r[x]];
      if (c) t.put(ox + x, oy + y, c, alpha);
    }
  }
}

/** Magenta/black checkerboard used for unknown textures. */
export function missingTexture(): Uint8ClampedArray {
  const t = new Tex();
  t.forEach((x, y) => t.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? [0, 0, 0] : [248, 0, 248]));
  return t.data;
}
