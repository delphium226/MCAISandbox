/**
 * The civic tier's drawing kit (civic.ts; timberGen.ts and towerGen.ts draw with it): a grid of cells by stage, roofs as
 * height fields over a footprint (every stair faces uphill, gables and cross-gables join without special cases, as
 * gothicGen's roofs), round and square shells, cones and pyramids, and the finish that turns the cells into gothicGen's
 * Cathedral shape (a Design, stages, jobs cut by x slices, the bill, the cell maps), so the monument's machinery (site,
 * yard, kiln, jobs) builds a civic building as it builds a cathedral.
 *
 * Wood is drawn as oak; civic.ts swaps it for the village wood (`oak_` and `stripped_oak_` only, never dark oak).
 * Coordinates: x west to east (the long axis, the door at x = 0 toward the village, as the cathedral's west portal),
 * y up, z north to south.
 */
import { gothicCost, type Cathedral, type GothicJob } from './gothicGen';
import type { Design } from './village';

export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** The blocks the kit draws with (the village's: logs, planks, cobblestone, stone bricks, glass; oak is the village wood). */
export const C = {
  post: 'oak_log[axis=y]', beamX: 'oak_log[axis=x]', beamZ: 'oak_log[axis=z]', planks: 'oak_planks', fence: 'oak_fence',
  slab: 'oak_slab[type=bottom]', slabTop: 'oak_slab[type=top]', trapdoor: 'oak_trapdoor[half=top,open=false]',
  stair: (facing: string, half = 'bottom') => `oak_stairs[facing=${facing},half=${half}]`,
  cobble: 'cobblestone', stone: 'stone', bricks: 'stone_bricks', smooth: 'smooth_stone', cobbleWall: 'cobblestone_wall', brickWall: 'stone_brick_wall',
  cobbleStair: (facing: string, half = 'bottom') => `cobblestone_stairs[facing=${facing},half=${half}]`,
  brickStair: (facing: string, half = 'bottom') => `stone_brick_stairs[facing=${facing},half=${half}]`,
  brickSlab: 'stone_brick_slab[type=bottom]', cobbleSlab: 'cobblestone_slab[type=bottom]',
  pane: 'glass_pane', glass: 'glass', white: 'polished_diorite', red: 'polished_granite', torch: 'torch', sand: 'sandstone', cutSand: 'cut_sandstone',
};

/** A roof's materials: its stair (by facing and half), its full block and its slab. */
export interface RoofMat { stair: (facing: string, half?: string) => string; full: string; slab: string }
export const ROOF_WOOD: RoofMat = { stair: C.stair, full: C.planks, slab: C.slab };
export const ROOF_COBBLE: RoofMat = { stair: C.cobbleStair, full: C.cobble, slab: C.cobbleSlab };
export const ROOF_BRICK: RoofMat = { stair: C.brickStair, full: C.bricks, slab: C.brickSlab };

/** The cells drawn, each with its stage (a later set overwrites the cell and its stage). */
export class Grid {
  cells = new Map<string, string>();
  stage = new Map<string, number>();
  set(x: number, y: number, z: number, block: string, stage: number): void {
    if (y < 0) return;
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    const k = key(x, y, z);
    this.cells.set(k, block);
    this.stage.set(k, stage);
  }
  /** Set only where the cell is empty. */
  put(x: number, y: number, z: number, block: string, stage: number): void {
    if (!this.cells.has(key(Math.round(x), Math.round(y), Math.round(z)))) this.set(x, y, z, block, stage);
  }
  has(x: number, y: number, z: number): boolean { return this.cells.has(key(x, y, z)); }
  clear(x: number, y: number, z: number): void { const k = key(x, y, z); this.cells.delete(k); this.stage.delete(k); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | ((x: number, y: number, z: number) => string | null), stage: number): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const b = typeof block === 'string' ? block : block(x, y, z);
      if (b) this.set(x, y, z, b, stage);
    }
  }
  /** Shift every cell so the lowest x, z are `margin` and the lowest y 0; returns the width and depth. */
  normalise(margin = 0): { W: number; D: number } {
    let x0 = Infinity, z0 = Infinity, y0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const k of this.cells.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y);
    }
    const cells = new Map<string, string>(), stage = new Map<string, number>();
    for (const [k, b] of this.cells) {
      const [x, y, z] = k.split(',').map(Number);
      const n = key(x - x0 + margin, y - y0, z - z0 + margin);
      cells.set(n, b);
      stage.set(n, this.stage.get(k)!);
    }
    this.cells = cells; this.stage = stage;
    return { W: x1 - x0 + 1 + 2 * margin, D: z1 - z0 + 1 + 2 * margin };
  }
}

/** A footprint cell with its roof's height above the eave and the part it belongs to. */
export interface RoofPart {
  /** The part's box (inclusive), its ridge's axis ('x': along x; 'z': along z) and rise per block in from the eave. */
  x0: number; x1: number; z0: number; z1: number; ridge: 'x' | 'z'; rise: number;
  /** A hipped part slopes at its ends too. */
  hip?: boolean;
  /** Its eave's level (default the roof's). */
  eave?: number;
}

/**
 * A roof as the highest of its parts' height fields (a part's height at a cell: rise times the cells in from its nearer
 * eave across the ridge, and along it too when hipped). Each surface cell is a stair facing its highest neighbour, a
 * ridge cell the full block (or the slab where the roof is one cell high); under it full blocks down to the lowest
 * neighbour's height, so a steep roof has no holes. Returns each footprint cell's top (y), for gable walls and chimneys.
 */
export function drawRoof(g: Grid, parts: RoofPart[], eave: number, mat: RoofMat, stage: number): Map<string, number> {
  const top = new Map<string, number>();
  const h = (x: number, z: number): number => {
    let best = -Infinity;
    for (const p of parts) {
      if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      let d = p.ridge === 'x' ? Math.min(z - p.z0, p.z1 - z) : Math.min(x - p.x0, p.x1 - x);
      if (p.hip) d = Math.min(d, p.ridge === 'x' ? Math.min(x - p.x0, p.x1 - x) : Math.min(z - p.z0, p.z1 - z));
      best = Math.max(best, (p.eave ?? eave) + Math.floor(d * p.rise));
    }
    return best;
  };
  const N: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
  for (const p of parts)
    for (let x = p.x0; x <= p.x1; x++)
      for (let z = p.z0; z <= p.z1; z++) {
        if (top.has(`${x},${z}`)) continue;
        const y = h(x, z);
        if (y === -Infinity) continue;
        top.set(`${x},${z}`, y);
        let up: string | null = null, upH = y, low = y;
        for (const [dx, dz, f] of N) {
          const n = h(x + dx, z + dz);
          if (n > upH) { upH = n; up = f; }
          low = Math.min(low, n === -Infinity ? (p.eave ?? eave) - 1 : n);
        }
        if (up) g.set(x, y, z, mat.stair(up), stage);
        else g.set(x, y, z, low >= y ? mat.slab : mat.full, stage);
        for (let yy = Math.max(low + 1, (p.eave ?? eave)); yy < y; yy++) g.set(x, yy, z, mat.full, stage);
      }
  return top;
}

/** A gable wall: the wall line's cells from `from` up under the roof's top (`top` from drawRoof). */
export function gableFill(g: Grid, top: Map<string, number>, cells: Array<[number, number]>, from: number, block: (x: number, y: number, z: number) => string, stage: number): void {
  for (const [x, z] of cells) {
    const t = top.get(`${x},${z}`);
    if (t === undefined) continue;
    for (let y = from; y < t; y++) g.put(x, y, z, block(x, y, z), stage);
  }
}

/** A round (or octagonal: `sides` 8) shell: radius from r0 at y0 to r1 at y1, `thick` cells thick; `block` per cell. */
export function roundShell(g: Grid, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, block: (x: number, y: number, z: number, i: number) => string | null, stage: (y: number) => number, opts: { thick?: number; sides?: number; floorEvery?: number; floor?: string } = {}): void {
  const thick = opts.thick ?? 1;
  const dist = (dx: number, dz: number) => {
    if (opts.sides === 8) return Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) / Math.SQRT2);
    if (opts.sides === 4) return Math.max(Math.abs(dx), Math.abs(dz));
    return Math.hypot(dx, dz);
  };
  for (let y = y0; y <= y1; y++) {
    const r = r0 + (r1 - r0) * (y1 > y0 ? (y - y0) / (y1 - y0) : 0);
    const R = Math.ceil(r) + 1;
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const d = dist(dx, dz);
        if (d > r + 0.5) continue;
        const shell = d > r + 0.5 - thick;
        const floor = opts.floorEvery && (y - y0) % opts.floorEvery === 0;
        if (!shell && !floor) continue;
        const b = shell ? block(cx + dx, y, cz + dz, Math.round(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * 16) % 16) : opts.floor ?? C.planks;
        if (b) g.set(cx + dx, y, cz + dz, b, stage(y));
      }
  }
}

/** A cone (or pyramid: `sides` 4; octagonal: 8) of `mat`'s stairs and blocks from radius r at y0 to a point at y1. */
export function cone(g: Grid, cx: number, cz: number, y0: number, y1: number, r: number, mat: RoofMat, stage: number, sides = 0, finial?: string): void {
  const dist = (dx: number, dz: number) => (sides === 4 ? Math.max(Math.abs(dx), Math.abs(dz)) : sides === 8 ? Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) / Math.SQRT2) : Math.hypot(dx, dz));
  const H = Math.max(1, y1 - y0);
  for (let y = y0; y <= y1; y++) {
    const rr = r * (1 - (y - y0) / H);
    const R = Math.ceil(r) + 1;
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const d = dist(dx, dz);
        if (d > rr + 0.5 || (y < y1 && d < rr - 0.6)) continue;
        // (facing toward the axis: the stair's back is its high side)
        const f = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : dz > 0 ? 'north' : 'south';
        g.set(cx + dx, y, cz + dz, (dx === 0 && dz === 0) || rr < 0.8 ? mat.full : mat.stair(f), stage);
      }
  }
  if (finial) g.set(cx, y1 + 1, cz, finial, stage);
}

/** A square tower's shell (x0..x1, z0..z1, y0..y1) with floors every `floorEvery` and windows from `win`. */
export function squareShell(g: Grid, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: (x: number, y: number, z: number) => string, stage: (y: number) => number, floorEvery = 0, floor: string = C.planks): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        if (edge) g.set(x, y, z, wall(x, y, z), stage(y));
        else if (floorEvery && (y - y0) % floorEvery === 0) g.set(x, y, z, floor, stage(y));
      }
}

/** Battlements on a wall line: merlons every second cell. */
export function crenel(g: Grid, cells: Array<[number, number]>, y: number, block: string, stage: number): void {
  cells.forEach(([x, z], i) => { if (i % 2 === 0) g.set(x, y, z, block, stage); });
}

/** A box's perimeter cells (x0..x1, z0..z1), clockwise from the north-west corner. */
export function ring(x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) out.push([x, z0]);
  for (let z = z0 + 1; z <= z1; z++) out.push([x1, z]);
  for (let x = x1 - 1; x >= x0; x--) out.push([x, z1]);
  for (let z = z1 - 1; z > z0; z--) out.push([x0, z]);
  return out;
}

/** The cells as gothicGen's Cathedral: the palette, layers, bill and stages, and jobs of jobMin-jobMax blocks cut by x
 *  slices within each stage (the last of a stage may be smaller). */
export function finishCivic(name: string, description: string, scale: number, g: Grid, stageNames: readonly string[], by: string, jobMin = 150, jobMax = 450): Cathedral {
  // (a stage with no cells is left out and the rest numbered from 1)
  const used = [...new Set(g.stage.values())].sort((a, b) => a - b);
  const renum = new Map(used.map((s, i) => [s, i + 1]));
  for (const [k, s] of g.stage) g.stage.set(k, renum.get(s)!);
  const names = used.map((s) => stageNames[s - 1]);
  const { W, D } = g.normalise(0);
  let H = 0;
  for (const kk of g.cells.keys()) H = Math.max(H, Number(kk.split(',')[1]) + 1);
  const blocks = [...new Set(g.cells.values())].sort();
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>?@!~^:;,(){}[]|/';
  if (blocks.length > CHARS.length) throw new Error(`${by}: ${blocks.length} blocks, more than the palette holds`);
  const charOf = new Map(blocks.map((b, i) => [b, CHARS[i]]));
  const palette: Record<string, string> = Object.fromEntries(blocks.map((b) => [charOf.get(b)!, b]));
  const layers: string[][] = [];
  for (let y = 0; y < H; y++) {
    const rows: string[] = [];
    for (let z = 0; z < D; z++) {
      let row = '';
      for (let x = 0; x < W; x++) { const b = g.cells.get(key(x, y, z)); row += b ? charOf.get(b)! : '.'; }
      rows.push(row);
    }
    layers.push(rows);
  }
  const bill: Record<string, number> = {};
  const stages = new Array(names.length).fill(0);
  for (const [kk, b] of g.cells) {
    const [item, n] = gothicCost(b);
    bill[item] = (bill[item] ?? 0) + n;
    stages[g.stage.get(kk)! - 1]++;
  }
  const design: Design = {
    name: `${name}_1_${scale}`.slice(0, 32), description: `${description} (1:${scale})`.slice(0, 200),
    palette, layers, width: W, depth: D, height: H, blocks: g.cells.size, by,
  };
  const cellJob = new Map<string, number>();
  const jobs = cutJobs(g, jobMin, jobMax, cellJob, names.length);
  return { design, scale, stages, jobs, bill, cellStage: g.stage, cellJob, stageNames: names };
}

/** Each stage's cells cut into jobs: whole x slices gathered west to east until a job holds jobMin; a slice larger than
 *  jobMax cut into bands of layers (a tower's shaft). */
function cutJobs(g: Grid, jobMin: number, jobMax: number, cellJob: Map<string, number>, nStages: number): GothicJob[] {
  const jobs: GothicJob[] = [];
  for (let st = 1; st <= nStages; st++) {
    const bySlice = new Map<number, Array<[number, number, number, string]>>();
    for (const [kk, b] of g.cells) {
      if (g.stage.get(kk) !== st) continue;
      const [x, y, z] = kk.split(',').map(Number);
      (bySlice.get(x) ?? bySlice.set(x, []).get(x)!).push([x, y, z, b]);
    }
    let cur: Array<[number, number, number, string]> = [];
    let index = 0;
    const flush = () => {
      if (!cur.length) return;
      const j: GothicJob = { stage: st, index: index++, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, blocks: cur.length, bill: {} };
      for (const [x, y, z, b] of cur) {
        j.x0 = Math.min(j.x0, x); j.x1 = Math.max(j.x1, x); j.y0 = Math.min(j.y0, y); j.y1 = Math.max(j.y1, y);
        j.z0 = Math.min(j.z0, z); j.z1 = Math.max(j.z1, z);
        const [item, n] = gothicCost(b);
        j.bill[item] = (j.bill[item] ?? 0) + n;
        cellJob.set(key(x, y, z), jobs.length);
      }
      jobs.push(j); cur = [];
    };
    for (const x of [...bySlice.keys()].sort((a, b) => a - b)) {
      let slice = bySlice.get(x)!;
      if (slice.length > jobMax) {
        if (cur.length >= jobMin) flush();
        else slice = [...cur, ...slice], cur = [];
        slice.sort((a, b) => a[1] - b[1]);
        const band = slice.length % jobMax && slice.length % jobMax < jobMin ? Math.ceil(slice.length / Math.ceil(slice.length / jobMax)) : jobMax;
        for (let i = 0; i < slice.length; i += band) { cur = slice.slice(i, i + band); flush(); }
        continue;
      }
      if (cur.length + slice.length > jobMax && cur.length >= jobMin) flush();
      cur.push(...slice);
      if (cur.length >= jobMin) flush();
    }
    flush();
  }
  return jobs;
}

/** A measure in metres at 1:scale, at least `min` cells. */
export const scaled = (scale: number) => (m: number, min = 1) => Math.max(min, Math.round(m / scale));
