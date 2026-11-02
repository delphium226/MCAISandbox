/**
 * Survival (d) spec 5 (MC_WALLS): the village wall as geometry, pure (as huts.ts). The wall encloses a region of
 * rectangles: the built bounds + WALL_MARGIN when it is voted, then a rectangle more for each neighbourhood built past it
 * (growth). Its ring is every region cell with an outside neighbour, diagonals included (a ring with a diagonal step
 * leaks between two fence posts), cut along the ring into segments of ~SEG_LEN cells, each a member's chore. A fence gate
 * on every crossing given and at least one in each segment (its middle, on a straight run), a torch every TORCH_EVERY
 * cells. The world side (mcWalls.ts) puts the cells on the ground: fence on cobblestone, the gate on the ground.
 */

export type Box = { x1: number; z1: number; x2: number; z2: number };
export type Cell = { x: number; z: number };

/** How far outside the built bounds the wall stands (spec 5). */
export const WALL_MARGIN = 6;
/** Cells in a segment (one chore), and a torch every this many cells along the ring. */
export const SEG_LEN = 24;
export const TORCH_EVERY = 8;

/** A cell of the wall: a gate's `gate` is the axis the wall runs along there ('x': east-west, passed north-south). */
export interface WallCell extends Cell {
  gate?: 'x' | 'z';
  torch?: boolean;
}
export interface WallSeg {
  id: number;
  cells: WallCell[];
}

const key = (x: number, z: number) => `${x},${z}`;
export const growBox = (b: Box, n: number): Box => ({ x1: b.x1 - n, z1: b.z1 - n, x2: b.x2 + n, z2: b.z2 + n });
export const inBox = (b: Box, x: number, z: number): boolean => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
export const inRegion = (rects: Box[], x: number, z: number): boolean => rects.some((b) => inBox(b, x, z));

/** The box round all of `boxes`; null with none. */
export function hull(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return { x1: Math.min(...boxes.map((b) => b.x1)), z1: Math.min(...boxes.map((b) => b.z1)), x2: Math.max(...boxes.map((b) => b.x2)), z2: Math.max(...boxes.map((b) => b.z2)) };
}

/** Whether `box` grown by `margin` lies inside the region (its edge cells all in it: the region has no holes). */
export function covered(rects: Box[], box: Box, margin = WALL_MARGIN): boolean {
  const g = growBox(box, margin);
  for (let x = g.x1; x <= g.x2; x++) if (!inRegion(rects, x, g.z1) || !inRegion(rects, x, g.z2)) return false;
  for (let z = g.z1; z <= g.z2; z++) if (!inRegion(rects, g.x1, z) || !inRegion(rects, g.x2, z)) return false;
  return true;
}

/**
 * The region after growth: a rectangle more for each box not inside it by `margin` (the box grown by it), stretched to
 * the region's hull across a gap of up to `bridge` (growth keeps 5 off the ring, so a new neighbourhood's rectangle would
 * stand apart from the old one: two walled islands, and the old ring never taken down).
 */
export function growRegion(rects: Box[], boxes: Box[], margin = WALL_MARGIN, bridge = 16): Box[] {
  const out = [...rects];
  for (const b of boxes) {
    if (covered(out, b, margin)) continue;
    const r = growBox(b, margin), h = hull(out);
    if (h) {
      if (r.x1 > h.x2 && r.x1 - h.x2 <= bridge) r.x1 = h.x2;
      if (r.x2 < h.x1 && h.x1 - r.x2 <= bridge) r.x2 = h.x1;
      if (r.z1 > h.z2 && r.z1 - h.z2 <= bridge) r.z1 = h.z2;
      if (r.z2 < h.z1 && h.z1 - r.z2 <= bridge) r.z2 = h.z1;
    }
    out.push(r);
  }
  return out;
}

/** The ring: region cells with any of their 8 neighbours outside the region. */
export function ringCells(rects: Box[]): Cell[] {
  const h = hull(rects);
  if (!h) return [];
  const out: Cell[] = [];
  for (let z = h.z1; z <= h.z2; z++)
    for (let x = h.x1; x <= h.x2; x++) {
      if (!inRegion(rects, x, z)) continue;
      let edge = false;
      for (let dx = -1; dx <= 1 && !edge; dx++) for (let dz = -1; dz <= 1 && !edge; dz++) if ((dx || dz) && !inRegion(rects, x + dx, z + dz)) edge = true;
      if (edge) out.push({ x, z });
    }
  return out;
}

/** The ring in walking order: from its north-west cell, on to an unvisited side neighbour, else a diagonal one, else the nearest. */
export function orderRing(cells: Cell[]): Cell[] {
  if (!cells.length) return [];
  const left = new Map(cells.map((c) => [key(c.x, c.z), c]));
  const start = [...cells].sort((p, q) => p.z - q.z || p.x - q.x)[0];
  const out: Cell[] = [];
  let cur: Cell | undefined = start;
  const SIDE = [[1, 0], [0, 1], [-1, 0], [0, -1]], DIAG = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  while (cur) {
    out.push(cur);
    left.delete(key(cur.x, cur.z));
    const c: Cell = cur;
    cur = undefined;
    for (const [dx, dz] of [...SIDE, ...DIAG]) {
      const n = left.get(key(c.x + dx, c.z + dz));
      if (n) {
        cur = n;
        break;
      }
    }
    if (!cur && left.size) {
      let best = Infinity;
      for (const n of left.values()) {
        const d = Math.hypot(n.x - c.x, n.z - c.z);
        if (d < best) [best, cur] = [d, n];
      }
    }
  }
  return out;
}

/** The axis of a straight run at a ring cell ('x': its east and west neighbours are ring, north and south not), else null. */
export function straightAxis(ring: Set<string>, x: number, z: number): 'x' | 'z' | null {
  const e = ring.has(key(x + 1, z)), w = ring.has(key(x - 1, z)), n = ring.has(key(x, z - 1)), s = ring.has(key(x, z + 1));
  if (e && w && !n && !s) return 'x';
  if (n && s && !e && !w) return 'z';
  return null;
}

/** The village's wall (v.wall): voted or refused, its region, segments and the cells built. */
export interface WallRecord {
  state: 'voted' | 'refused';
  at: number;
  /** Deaths the danger count had when the wall was refused: it is offered again only after another. */
  deaths?: number;
  vote?: string;
  rects: Box[];
  segs: WallSeg[];
  /** Built cells by "x,z": the lowest and highest block set (the torch included) and a gate's axis. */
  built: Record<string, { y: number; top: number; gate?: 'x' | 'z' }>;
  /** Cells of an earlier ring now inside the region (growth), to take down. */
  down?: Array<{ x: number; z: number; y: number; top: number }>;
  /** Ring cells left out: in water or lava, or kept off (another's work); by "x,z". */
  gaps?: string[];
  /** Segments that failed lately: no member is offered one before `until`. */
  back?: Record<string, number>;
}

export interface WallPlan {
  segs: WallSeg[];
  /** Ring cells left out: inside a box to keep off (another village's work, a mine's hut). */
  gaps: Cell[];
  /** Every ring cell (gaps included), as keys. */
  ring: Set<string>;
}

/**
 * The wall of a region: its ring in order, the cells in `keep` boxes left out, cut into segments of ~segLen; a gate on
 * each crossing cell on a straight run (within 2 cells along the ring of one that is not) and in the middle of each
 * segment that has none, where `gateOk` allows; a torch every `torchEvery` cells (never on a gate).
 */
export function wallPlan(rects: Box[], opts: { crossings?: Cell[]; keep?: Box[]; segLen?: number; torchEvery?: number; gateOk?: (c: Cell, axis: 'x' | 'z') => boolean } = {}): WallPlan {
  const segLen = opts.segLen ?? SEG_LEN, torchEvery = opts.torchEvery ?? TORCH_EVERY;
  const all = ringCells(rects);
  const ring = new Set(all.map((c) => key(c.x, c.z)));
  const order = orderRing(all);
  const kept = (c: Cell) => (opts.keep ?? []).some((b) => inBox(b, c.x, c.z));
  const gaps = order.filter(kept);
  const cells: WallCell[] = order.filter((c) => !kept(c)).map((c) => ({ x: c.x, z: c.z }));
  const gateAt = (i: number): boolean => {
    const c = cells[i];
    const axis = straightAxis(ring, c.x, c.z);
    if (!axis || (opts.gateOk && !opts.gateOk(c, axis))) return false;
    // (not beside another gate)
    if (cells[i - 1]?.gate || cells[i + 1]?.gate) return false;
    c.gate = axis;
    return true;
  };
  const crossing = new Set((opts.crossings ?? []).map((c) => key(c.x, c.z)));
  for (let i = 0; i < cells.length; i++) {
    if (!crossing.has(key(cells[i].x, cells[i].z))) continue;
    for (const d of [0, 1, -1, 2, -2]) if (i + d >= 0 && i + d < cells.length && gateAt(i + d)) break;
  }
  const segs: WallSeg[] = [];
  const n = Math.max(1, Math.round(cells.length / segLen));
  for (let k = 0; k < n && cells.length; k++) {
    const from = Math.floor((k * cells.length) / n), to = Math.floor(((k + 1) * cells.length) / n);
    segs.push({ id: k + 1, cells: cells.slice(from, to) });
  }
  for (const s of segs) {
    if (s.cells.some((c) => c.gate)) continue;
    const base = cells.indexOf(s.cells[0]), mid = Math.floor(s.cells.length / 2);
    for (let d = 0; d <= mid + 1; d++) if ((mid + d < s.cells.length && gateAt(base + mid + d)) || (mid - d >= 0 && d && gateAt(base + mid - d))) break;
  }
  let since = Math.floor(torchEvery / 2);
  for (const c of cells) {
    if (++since >= torchEvery && !c.gate) {
      c.torch = true;
      since = 0;
    }
  }
  return { segs, gaps, ring };
}

/** The ring's cells as boxes (rows' runs of 2 or more, then the rest by columns), for surveys that keep off it. */
export function ringRuns(cells: Cell[]): Box[] {
  const left = new Set(cells.map((c) => key(c.x, c.z)));
  const out: Box[] = [];
  const sorted = [...cells].sort((p, q) => p.z - q.z || p.x - q.x);
  for (const c of sorted) {
    if (!left.has(key(c.x, c.z)) || !left.has(key(c.x + 1, c.z))) continue;
    let x2 = c.x;
    while (left.has(key(x2 + 1, c.z))) x2++;
    for (let x = c.x; x <= x2; x++) left.delete(key(x, c.z));
    out.push({ x1: c.x, z1: c.z, x2, z2: c.z });
  }
  for (const c of [...cells].sort((p, q) => p.x - q.x || p.z - q.z)) {
    if (!left.has(key(c.x, c.z))) continue;
    let z2 = c.z;
    while (left.has(key(c.x, z2 + 1))) z2++;
    for (let z = c.z; z <= z2; z++) left.delete(key(c.x, z));
    out.push({ x1: c.x, z1: c.z, x2: c.x, z2 });
  }
  return out;
}

/** A segment's bill: cobblestone and fence per cell (more cobblestone where the ground steps), a gate, torches. */
export function segBill(s: WallSeg, wood = 'oak'): Record<string, number> {
  const gates = s.cells.filter((c) => c.gate).length, torches = s.cells.filter((c) => c.torch).length;
  const walls = s.cells.length - gates;
  const out: Record<string, number> = { cobblestone: walls, [`${wood}_fence`]: walls };
  if (gates) out[`${wood}_fence_gate`] = gates;
  if (torches) out.torch = torches;
  return out;
}
