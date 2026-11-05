/**
 * #217 step 3: the castle wall's geometry, pure (as walls.ts). From the fence ring's plan (walls.ts wallPlan's ring in
 * order, its region of rectangles) it draws every cell of the stone parts:
 * - towers: 5 x 5, solid to +4 above their base, a parapet at +5 with merlons at +6 on alternate cells, a stair of four
 *   up their inner side from the ground and a gap in the parapet where it lands; at the ring's corners and every
 *   ~TOWER_EVERY cells along it, never on a gatehouse, a street crossing or another's work;
 * - gatehouses: 7 x 7 across the ring where a street crosses it, a passage 3 wide and 3 high through it with three fence
 *   gates at each end, the deck at +4 with a parapet on the inner and outer rows, a stair up beside it inside;
 * - curtain sections (stage 3; drawn, not offered yet: the user's answer to Q3): the ring cell and the band of cells
 *   inside it, solid to +4 (the walk stands at +5), a parapet on the ring cell at +5, merlons on every other one at +6 and
 *   an outward lip (an upside-down stair at +4 outside the ring cell).
 * Heights are relative to a part's base (the world reads the ground: mcWalls.ts); `fill` means solid from the column's
 * own ground up to base + fill (a footing where the ground dips). The deck of every part is at +4, so the walk runs level
 * from a tower over a curtain section to the next.
 */
import { inBox, inRegion, straightAxis, type Box, type Cell } from './walls';

export type Dir = 'north' | 'south' | 'east' | 'west';
export type Tok = 'stone' | 'merlon' | 'stairs' | 'lip' | 'gate' | 'torch' | 'air';
export interface Top { dy: number; tok: Tok; facing?: Dir; axis?: 'x' | 'z' }
/** One column of a part: solid from the ground to base + fill (-1: nothing solid, the ground left as it is), then `tops`. */
export interface Column extends Cell { fill: number; tops: Top[] }
export interface CastlePart {
  id: string;
  kind: 'tower' | 'gatehouse' | 'section';
  /** The ring cell it stands on (its centre for a tower or gatehouse, the first cell for a section). */
  at: Cell;
  /** Along the ring and inward, unit vectors. */
  u: Cell;
  n: Cell;
  cols: Column[];
  /** The ring cells it covers, as "x,z". */
  ring: string[];
}

export const TOWER_EVERY = 40;
export const SECTION_LEN = 24;
export const DECK = 4;
const key = (x: number, z: number) => `${x},${z}`;
export const dirOf = (d: Cell): Dir => (d.x > 0 ? 'east' : d.x < 0 ? 'west' : d.z > 0 ? 'south' : 'north');
const at = (c: Cell, u: Cell, n: Cell, a: number, b: number): Cell => ({ x: c.x + a * u.x + b * n.x, z: c.z + a * u.z + b * n.z });

/** The wall's bill for a part on flat ground: the bulk stone (any mine stone), stairs, fence gates, torches. */
export function partBill(p: CastlePart): { stone: number; stairs: number; gates: number; torches: number } {
  const out = { stone: 0, stairs: 0, gates: 0, torches: 0 };
  for (const c of p.cols) {
    out.stone += Math.max(0, c.fill);
    for (const t of c.tops) {
      if (t.tok === 'stone' || t.tok === 'merlon') out.stone++;
      else if (t.tok === 'stairs' || t.tok === 'lip') out.stairs++;
      else if (t.tok === 'gate') out.gates++;
      else if (t.tok === 'torch') out.torches++;
    }
  }
  return out;
}

/** The inward unit vector at a straight ring cell (the side whose cell 3 in lies in the region off the ring), else null. */
function inward(rects: Box[], ring: Set<string>, c: Cell, axis: 'x' | 'z'): Cell | null {
  const cands = axis === 'x' ? [{ x: 0, z: 1 }, { x: 0, z: -1 }] : [{ x: 1, z: 0 }, { x: -1, z: 0 }];
  return cands.find((n) => [1, 2, 3].every((k) => inRegion(rects, c.x + k * n.x, c.z + k * n.z) && !ring.has(key(c.x + k * n.x, c.z + k * n.z)))) ?? null;
}

/**
 * The tower's stair variants along its inner side: three steps from `from` going `dir` (+1: along u), the landing next,
 * beside the door at (landing, 2). A corner tower needs one that starts past its own width (the cells beside it are ring).
 */
export const STAIRS: Array<{ from: number; dir: 1 | -1 }> = [{ from: -2, dir: 1 }, { from: 4, dir: -1 }, { from: -4, dir: 1 }, { from: 2, dir: -1 }];

/** A tower's columns at ring cell `c` (u along, n inward), its stair the variant given (STAIRS). */
export function towerCols(c: Cell, u: Cell, n: Cell, stair = STAIRS[0]): Column[] {
  const cols: Column[] = [];
  const land = stair.from + 3 * stair.dir;
  // (the stair's door; the doors to the curtain's walk are cut where its sections meet the part, castlePlan)
  const isDoor = (a: number, b: number) => a === land && b === 2;
  for (let a = -2; a <= 2; a++)
    for (let b = -2; b <= 2; b++) {
      const p = at(c, u, n, a, b);
      const edge = Math.abs(a) === 2 || Math.abs(b) === 2;
      const tops: Top[] = [];
      if (edge && !isDoor(a, b)) {
        tops.push({ dy: DECK + 1, tok: 'stone' });
        if ((a + b) % 2 === 0) tops.push({ dy: DECK + 2, tok: 'merlon' });
      } else if (isDoor(a, b)) tops.push({ dy: DECK + 1, tok: 'air' }, { dy: DECK + 2, tok: 'air' });
      if (a === 0 && b === 0) tops.push({ dy: DECK + 1, tok: 'torch' });
      cols.push({ ...p, fill: DECK, tops });
    }
  // (the stair: up along the inner side, its landing beside the door)
  const up = { x: u.x * stair.dir, z: u.z * stair.dir };
  for (let k = 0; k < 4; k++) {
    const p = at(c, u, n, stair.from + k * stair.dir, 3);
    const tops: Top[] = k < 3 ? [{ dy: k + 1, tok: 'stairs', facing: dirOf(up) }] : [];
    for (let dy = k + 2; dy <= k + 3; dy++) tops.push({ dy, tok: 'air' });
    cols.push({ ...p, fill: k < 3 ? k : DECK, tops });
  }
  return cols;
}

/** A gatehouse's columns at ring cell `c` (u along, n inward; the ring runs along `axis`). */
export function gatehouseCols(c: Cell, u: Cell, n: Cell, axis: 'x' | 'z'): Column[] {
  const cols: Column[] = [];
  for (let a = -3; a <= 3; a++)
    for (let b = -3; b <= 3; b++) {
      const p = at(c, u, n, a, b);
      const passage = Math.abs(a) <= 1;
      const tops: Top[] = [];
      if (passage) {
        tops.push(Math.abs(b) === 3 ? { dy: 1, tok: 'gate', axis } : { dy: 1, tok: 'air' }, { dy: 2, tok: 'air' }, { dy: 3, tok: 'air' }, { dy: DECK, tok: 'stone' });
      }
      const door = a === 2 && b === 3;
      if (Math.abs(b) === 3 && !door) {
        tops.push({ dy: DECK + 1, tok: 'stone' });
        if (b === -3 && (a + 3) % 2 === 0) tops.push({ dy: DECK + 2, tok: 'merlon' });
      } else if (door) tops.push({ dy: DECK + 1, tok: 'air' }, { dy: DECK + 2, tok: 'air' });
      if (!passage && b === 0 && Math.abs(a) === 2) tops.push({ dy: DECK + 1, tok: 'torch' });
      cols.push({ ...p, fill: passage ? 0 : DECK, tops });
    }
  // (the stair: inside, beside the passage's inner end, up along -u to a landing by the door)
  for (let k = 0; k < 4; k++) {
    const p = at(c, u, n, 5 - k, 4);
    const tops: Top[] = k < 3 ? [{ dy: k + 1, tok: 'stairs', facing: dirOf({ x: -u.x, z: -u.z }) }] : [];
    for (let dy = k + 2; dy <= k + 3; dy++) tops.push({ dy, tok: 'air' });
    cols.push({ ...p, fill: k < 3 ? k : DECK, tops });
  }
  return cols;
}

/**
 * Street crossings: from each street's ends, the ring cell its middle row (or column) meets going outward within `reach`.
 */
export function streetCrossings(ring: Set<string>, streets: Box[], reach = 40): Cell[] {
  const out: Cell[] = [];
  for (const s of streets) {
    const ew = s.x2 - s.x1 >= s.z2 - s.z1;
    const mid = ew ? Math.round((s.z1 + s.z2) / 2) : Math.round((s.x1 + s.x2) / 2);
    const ends: Array<[Cell, Cell]> = ew ? [[{ x: s.x1, z: mid }, { x: -1, z: 0 }], [{ x: s.x2, z: mid }, { x: 1, z: 0 }]] : [[{ x: mid, z: s.z1 }, { x: 0, z: -1 }], [{ x: mid, z: s.z2 }, { x: 0, z: 1 }]];
    for (const [p, d] of ends)
      for (let k = 1; k <= reach; k++) {
        const q = { x: p.x + k * d.x, z: p.z + k * d.z };
        if (ring.has(key(q.x, q.z))) {
          out.push(q);
          break;
        }
      }
  }
  return out;
}

export interface CastlePlan {
  towers: CastlePart[];
  gatehouses: CastlePart[];
  sections: CastlePart[];
  /** Why towers wanted at a place were left out (for the log). */
  skipped: string[];
}

/**
 * The castle wall of a ring (`order`: wallPlan's ring cells in walking order; `rects` its region): gatehouses at the
 * crossings (merged within 12 cells along the ring, at most `maxGates`, the first ones given first), towers at the corners
 * and every `every` cells, then the curtain's sections. `keep` boxes (other villages' work) and `avoid` boxes (the
 * village's own: no stair or footprint on them) are kept off; a part that does not fit moves up to 4 cells along the ring.
 */
export function castlePlan(order: Cell[], rects: Box[], opts: { crossings?: Cell[]; keep?: Box[]; avoid?: Box[]; every?: number; maxGates?: number } = {}): CastlePlan {
  const every = opts.every ?? TOWER_EVERY, maxGates = opts.maxGates ?? 4;
  const ring = new Set(order.map((c) => key(c.x, c.z)));
  const idx = new Map(order.map((c, i) => [key(c.x, c.z), i]));
  const N = order.length;
  const skipped: string[] = [];
  const blocked = (p: Cell, inner: boolean) => (opts.keep ?? []).some((b) => inBox(b, p.x, p.z))
    || (inner && (opts.avoid ?? []).some((b) => inBox(b, p.x, p.z)));
  const used = new Set<string>();
  /** Whether a part's columns fit: none kept off, none on another part, inner cells (off the ring, inside) in the region. */
  const fits = (cols: Column[]) => cols.every((q) => {
    const k = key(q.x, q.z);
    if (used.has(k)) return false;
    const inside = inRegion(rects, q.x, q.z) && !ring.has(k);
    return !blocked(q, inside);
  });
  const take = (p: CastlePart) => {
    for (const q of p.cols) used.add(key(q.x, q.z));
    // (and a cell round it, so two parts never touch)
    for (const q of p.cols) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) used.add(key(q.x + dx, q.z + dz));
  };
  const coverOf = (cols: Column[]) => cols.map((q) => key(q.x, q.z)).filter((k) => ring.has(k));
  const shifts = [0, 1, -1, 2, -2, 3, -3, 4, -4];

  const gatehouses: CastlePart[] = [];
  const gateIdx: number[] = [];
  for (const c of opts.crossings ?? []) {
    if (gatehouses.length >= maxGates) break;
    const i0 = idx.get(key(c.x, c.z));
    if (i0 === undefined || gateIdx.some((g) => Math.min(Math.abs(g - i0), N - Math.abs(g - i0)) < 12)) continue;
    let placed = false;
    for (const s of shifts) {
      const i = (((i0 + s) % N) + N) % N, q = order[i];
      const axis = straightAxis(ring, q.x, q.z);
      // (a straight run 3 each side: the passage's ends must be ring cells in line)
      if (!axis || ![-3, -2, -1, 1, 2, 3].every((d) => (axis === 'x' ? ring.has(key(q.x + d, q.z)) : ring.has(key(q.x, q.z + d))))) continue;
      const n = inward(rects, ring, q, axis);
      if (!n) continue;
      const u = axis === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const cols = gatehouseCols(q, u, n, axis);
      if (!fits(cols)) continue;
      const p: CastlePart = { id: `g${gatehouses.length + 1}`, kind: 'gatehouse', at: q, u, n, cols, ring: coverOf(cols) };
      gatehouses.push(p);
      gateIdx.push(i);
      take(p);
      placed = true;
      break;
    }
    if (!placed) skipped.push(`gatehouse at ${c.x},${c.z}: no straight run that fits`);
  }

  // Towers: corners first (ring cells off a straight run with a side neighbour on each axis), then every `every` cells
  const towers: CastlePart[] = [];
  const towerIdx: number[] = [];
  const tryTower = (i0: number, why: string): boolean => {
    for (const s of shifts) {
      const i = (((i0 + s) % N) + N) % N, q = order[i];
      const axis = straightAxis(ring, q.x, q.z);
      const frames: Array<[Cell, Cell]> = axis
        ? (() => {
          const n = inward(rects, ring, q, axis);
          return n ? [[axis === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 }, n] as [Cell, Cell]] : [];
        })()
        : [[{ x: 1, z: 0 }, { x: 0, z: 1 }], [{ x: 1, z: 0 }, { x: 0, z: -1 }], [{ x: 0, z: 1 }, { x: 1, z: 0 }], [{ x: 0, z: 1 }, { x: -1, z: 0 }]];
      for (const [u, n] of frames) for (const variant of STAIRS) {
        const cols = towerCols(q, u, n, variant);
        // (the stair's cells and the landing inside the region, off the ring)
        const stair = cols.slice(-4);
        if (!stair.every((c) => inRegion(rects, c.x, c.z) && !ring.has(key(c.x, c.z)))) continue;
        if (!fits(cols)) continue;
        const p: CastlePart = { id: `t${towers.length + 1}`, kind: 'tower', at: q, u, n, cols, ring: coverOf(cols) };
        towers.push(p);
        towerIdx.push(i);
        take(p);
        return true;
      }
    }
    skipped.push(`tower ${why} at ${order[i0].x},${order[i0].z}: no frame that fits`);
    return false;
  };
  const isCorner = (c: Cell) => {
    if (straightAxis(ring, c.x, c.z)) return false;
    const x = ring.has(key(c.x + 1, c.z)) || ring.has(key(c.x - 1, c.z)), z = ring.has(key(c.x, c.z + 1)) || ring.has(key(c.x, c.z - 1));
    return x && z;
  };
  const near = (i: number, list: number[], d: number) => list.some((g) => Math.min(Math.abs(g - i), N - Math.abs(g - i)) < d);
  for (let i = 0; i < N; i++) if (isCorner(order[i]) && !near(i, towerIdx, 8)) tryTower(i, 'corner');
  // (along the runs: from each part, every `every` cells to the next)
  const marks = [...towerIdx, ...gateIdx].sort((p, q) => p - q);
  if (!marks.length && N) marks.push(0);
  const gapsTo = marks.map((m, k) => [m, k + 1 < marks.length ? marks[k + 1] : marks[0] + N] as const);
  for (const [from, to] of gapsTo) {
    const n = Math.floor((to - from) / every);
    for (let k = 1; k <= n; k++) {
      const i = Math.round(from + ((to - from) * k) / (n + 1)) % N;
      if (!near(i, [...towerIdx, ...gateIdx], 10)) tryTower(i, 'run');
    }
  }

  // The curtain's sections (stage 3): ring cells not under a part, the band inside them, a lip outside straight cells
  const sections: CastlePart[] = [];
  const underPart = new Set([...towers, ...gatehouses].flatMap((p) => p.cols.map((c) => key(c.x, c.z))));
  const inner = (c: Cell): Cell[] => {
    const out: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const q = { x: c.x + dx, z: c.z + dz }, k = key(q.x, q.z);
      if ((dx || dz) && inRegion(rects, q.x, q.z) && !ring.has(k) && !underPart.has(k)) out.push(q);
    }
    return out;
  };
  const claimed = new Set<string>();
  let cur: Column[] = [], cover: string[] = [], first: Cell | null = null, k = 0, cnt = 0;
  const flush = () => {
    if (cur.length && first) sections.push({ id: `s${sections.length + 1}`, kind: 'section', at: first, u: { x: 0, z: 0 }, n: { x: 0, z: 0 }, cols: cur, ring: cover });
    cur = [];
    cover = [];
    first = null;
    cnt = 0;
  };
  for (const c of order) {
    const kc = key(c.x, c.z);
    if (underPart.has(kc)) {
      flush();
      continue;
    }
    first ??= c;
    const axis = straightAxis(ring, c.x, c.z);
    const n = axis ? inward(rects, ring, c, axis) : null;
    const tops: Top[] = [{ dy: DECK + 1, tok: 'stone' }];
    if (k++ % 2 === 0) tops.push({ dy: DECK + 2, tok: 'merlon' });
    cur.push({ ...c, fill: DECK, tops });
    cover.push(kc);
    if (n) cur.push({ x: c.x - n.x, z: c.z - n.z, fill: -1, tops: [{ dy: DECK, tok: 'lip', facing: dirOf(n) }] });
    for (const q of inner(c)) {
      const kq = key(q.x, q.z);
      if (claimed.has(kq)) continue;
      claimed.add(kq);
      cur.push({ ...q, fill: DECK, tops: [{ dy: DECK + 1, tok: 'air' }, { dy: DECK + 2, tok: 'air' }] });
    }
    if (++cnt >= SECTION_LEN) flush();
  }
  flush();
  // (doors to the walk, castleGen's: a part's parapet cell beside a section's walk cell opens at the deck)
  const band = new Set(sections.flatMap((p) => p.cols.filter((c) => c.fill === DECK && !ring.has(key(c.x, c.z))).map((c) => key(c.x, c.z))));
  for (const p of [...towers, ...gatehouses])
    for (const c of p.cols) {
      if (!c.tops.some((t) => t.dy === DECK + 1 && t.tok === 'stone') || c.tops.some((t) => t.tok === 'stairs')) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => band.has(key(c.x + dx, c.z + dz)))) continue;
      c.tops = [...c.tops.filter((t) => t.dy < DECK + 1), { dy: DECK + 1, tok: 'air' }, { dy: DECK + 2, tok: 'air' }];
    }
  return { towers, gatehouses, sections, skipped };
}

/** Every walk cell of a plan's deck (stand at base + 5): towers' and gatehouses' inner cells and sections' bands. */
export function walkCells(parts: CastlePart[]): Cell[] {
  const out: Cell[] = [];
  for (const p of parts)
    for (const c of p.cols) {
      const deck = c.fill === DECK || c.tops.some((t) => t.dy === DECK && t.tok === 'stone');
      const stair = c.tops.some((t) => t.tok === 'stairs');
      if (deck && !stair && !c.tops.some((t) => t.dy === DECK + 1 && (t.tok === 'stone' || t.tok === 'merlon'))) out.push({ x: c.x, z: c.z });
    }
  return out;
}
