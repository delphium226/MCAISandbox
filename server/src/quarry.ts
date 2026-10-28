/**
 * The monument's quarry (M2, #145; MC_QUARRY, off): a terrace pit beside the cathedral's pad that its cobblestone trips
 * dig instead of the village mine (the mine's 1,080 cells a level cannot feed 1:2's ~6k, M1's live check). World-free:
 * the pit's size from the bill, its cells and the cells a digger stands on, which row a member digs next, the site's
 * search over a ground function; mcQuarry.ts digs it.
 *
 * The pit is a square of side S, dug layer by layer from its top (the highest ground of the square), each layer one
 * block lower and starting one block further from the entry side, so every layer leaves a step: a staircase down the
 * entry side, toward the storage hut. A layer is dug in rows across the pit (one member a row), each from the step
 * inward, the digger standing in the cell it dug last (its first cell from the step above). A row lies only under the
 * dug part of the row above it (headroom), and stops where digging further would open water, lava, a cave or anything
 * built (lesson 102's y rule: nothing below the pit's floor and nothing outside its square is ever dug).
 *
 * Local coordinates: u along the steps (0 at the entry side), v across; `side` is the entry side.
 */
import { rawSetting } from './settings';
import type { Area } from './village';

export const QUARRY = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_QUARRY') ?? 'on'),
};

/** The quarry's record (Monument.quarry). */
export interface Quarry extends Area {
  /** The top layer's level (the highest ground of the square) and the layers at most. */
  y: number;
  depth: number;
  /** The entry side (the steps): toward the storage hut. */
  side: 'w' | 'e' | 'n' | 's';
  /** Cells done in each row ("k,v": layer k, row v), counted from the step side. */
  rows: Record<string, number>;
  /** Rows ended early (water, lava, a cave or a built block ahead): their final length. */
  cut: Record<string, number>;
  /** Cells dug, found open, and left (a row's cut). */
  dug: number;
  open: number;
  /** What its digging gave, by item. */
  got: Record<string, number>;
  state: 'open' | 'done';
  /** #165: the topsoil's layers when chosen (its rows are dug deepest first, so the first trips reach stone). */
  soil?: number;
  by: string;
  at: number;
  /** The structure record that keeps its ground (its id). */
  structure?: string;
}

/** Stone layers at most, the side's bounds, and how much more than the cobblestone wanted the pit's stone holds (cut
 *  rows, ores, andesite, diorite and granite give none). */
const MAX_DEPTH = 16, MIN_SIDE = 10, MAX_SIDE = 40, SLACK = 1.3;

/** Cells a pit of side s and depth L holds from layer `from` down: layer k is (s - k) x s. */
export function pitVolume(s: number, depth: number, from = 0): number {
  let n = 0;
  for (let k = from; k < depth; k++) n += (s - k) * s;
  return n;
}

/** The smallest pit whose stone (the layers under `soil` layers of topsoil) holds `want` cobblestone with the slack: at
 *  most MAX_DEPTH layers of stone, and at most s - 4 deep. M2's live check sized 1:4's pit for no soil: its top 4 layers
 *  of 13 gave 1,175 dirt and 8 cobblestone. */
export function pitSize(want: number, soil = 0): { side: number; depth: number } {
  const target = Math.ceil(Math.max(1, want) * SLACK);
  for (let s = MIN_SIDE; s <= MAX_SIDE; s++) {
    const depth = Math.min(soil + MAX_DEPTH, s - 4);
    if (depth > soil && pitVolume(s, depth, soil) >= target) {
      // (the shallowest that holds it)
      let d = depth;
      while (d > soil + 1 && pitVolume(s, d - 1, soil) >= target) d--;
      return { side: s, depth: d };
    }
  }
  return { side: MAX_SIDE, depth: Math.min(soil + MAX_DEPTH, MAX_SIDE - 4) };
}

/** The topsoil's depth from columns read down from their top: the median of each column's layers above its first stone. */
export function soilDepth(columns: number[]): number {
  if (!columns.length) return 0;
  const c = [...columns].sort((a, b) => a - b);
  return c[Math.floor(c.length / 2)];
}

/** A local cell (u, v) of the pit in the world (x, z). */
export function pitXZ(q: Pick<Quarry, 'x1' | 'z1' | 'x2' | 'z2' | 'side'>, u: number, v: number): { x: number; z: number } {
  switch (q.side) {
    case 'w': return { x: q.x1 + u, z: q.z1 + v };
    case 'e': return { x: q.x2 - u, z: q.z1 + v };
    case 'n': return { x: q.x1 + v, z: q.z1 + u };
    default: return { x: q.x1 + v, z: q.z2 - u };
  }
}

/** The pit's side (it is square). */
export const pitSide = (q: Area) => q.x2 - q.x1 + 1;

/** Whether row (k, v) is finished: dug to its length, or cut. */
export function rowDone(q: Quarry, k: number, v: number): boolean {
  const key = `${k},${v}`;
  return q.cut[key] !== undefined || (q.rows[key] ?? 0) >= rowLength(q, k, v);
}

/** Row (k, v)'s length: the whole width at the top; below, only under the dug part of the row above (less its first
 *  cell, the step). 0 until the row above is finished (or past the depth). */
export function rowLength(q: Quarry, k: number, v: number): number {
  const S = pitSide(q);
  if (k < 0 || k >= q.depth || v < 0 || v >= S) return 0;
  if (k === 0) return S;
  const above = `${k - 1},${v}`;
  const dugAbove = q.cut[above] ?? q.rows[above] ?? 0;
  if (q.cut[above] === undefined && dugAbove < rowLength(q, k - 1, v)) return 0;
  return Math.max(0, Math.min(S - k, dugAbove - 1));
}

/** Cell i of row (k, v) in the world, and where its digger stands (the cell before it in the row, or the step above). */
export function rowCell(q: Quarry, k: number, v: number, i: number): { x: number; y: number; z: number; stand: { x: number; y: number; z: number } } {
  const u = k + i;
  const c = pitXZ(q, u, v), s = pitXZ(q, u - 1, v);
  const y = q.y - k;
  return { ...c, y, stand: i === 0 ? { ...s, y: y + 1 } : { ...s, y } };
}

/** Rows ready to dig (open, not finished), shallowest first, then nearest `near` (a row v); `held`: rows others dig.
 *  #165: rows in the stone (the layers below `soil`) before the topsoil's, and the topsoil's deepest first, so a slice
 *  goes down to stone before the top layer is cleared: Cologne 1:3's first five 5-minute trips dug only topsoil. */
export function openRows(q: Quarry, held: Set<string>, near = 0): Array<{ k: number; v: number }> {
  const S = pitSide(q);
  const out: Array<{ k: number; v: number }> = [];
  for (let k = 0; k < q.depth; k++)
    for (let v = 0; v < S; v++) {
      if (held.has(`${k},${v}`) || rowDone(q, k, v) || !rowLength(q, k, v)) continue;
      out.push({ k, v });
    }
  const soil = q.soil ?? 0, rank = (k: number) => (k >= soil ? k - soil : soil + (soil - k));
  return out.sort((a, b) => rank(a.k) - rank(b.k) || Math.abs(a.v - near) - Math.abs(b.v - near));
}

/** Whether the pit has nothing left to dig (every row finished or never to be opened). */
export function pitDone(q: Quarry): boolean {
  return !openRows(q, new Set()).length;
}

/** Cells still to dig in the rows open or to come (an estimate: the rows below finished rows at their full length). */
export function cellsLeft(q: Quarry): number {
  const S = pitSide(q);
  let n = 0;
  for (let v = 0; v < S; v++) {
    let len = S;
    for (let k = 0; k < q.depth; k++) {
      const key = `${k},${v}`;
      const L = k === 0 ? S : rowLength(q, k, v) || Math.max(0, Math.min(S - k, len - 1));
      if (q.cut[key] !== undefined) break;
      n += Math.max(0, L - (q.rows[key] ?? 0));
      len = L;
    }
  }
  return n;
}

/**
 * The quarry's site (pure; the kiln's strip too, `depthSide` its other side): a square of side S (plus the entry ring) whose ground varies by at most 2, dry, read, off
 * everything `takenAt` names (with a 2-block margin), within `range` of `center`, nearest the hut. Searched on every
 * second position with every second column sampled (lesson 16: ~400k ground reads at S 26 would hold the event loop).
 * Its entry side faces the hut.
 */
export function searchQuarry(input: {
  side: number; depthSide?: number; center: { x: number; z: number }; hut: { x: number; z: number }; range: number;
  ground: (x: number, z: number) => { y: number; trees: number } | null; takenAt: (x: number, z: number) => boolean;
}): { area: Area; y: number; side: Quarry['side']; cost: number } | null {
  const S = input.side, Sd = input.depthSide ?? input.side, R = input.range;
  const memo = new Map<string, { y: number; trees: number } | null>();
  const g = (x: number, z: number) => {
    const k = `${x},${z}`;
    if (!memo.has(k)) memo.set(k, input.ground(x, z));
    return memo.get(k)!;
  };
  let best: { area: Area; y: number; side: Quarry['side']; cost: number } | null = null;
  for (let x1 = input.center.x - R; x1 <= input.center.x + R - S; x1 += 2)
    for (let z1 = input.center.z - R; z1 <= input.center.z + R - Sd; z1 += 2) {
      const x2 = x1 + S - 1, z2 = z1 + Sd - 1;
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const dist = Math.hypot(cx - input.hut.x, cz - input.hut.z);
      if (best && dist >= best.cost) continue;
      let lo = Infinity, hi = -Infinity, trees = 0, bad = false;
      // (the square and a 2-block ring: taken ground at every second column and the ring's corners and midpoints)
      for (let x = x1 - 2; x <= x2 + 2 && !bad; x += 2)
        for (let z = z1 - 2; z <= z2 + 2 && !bad; z += 2) {
          if (input.takenAt(x, z)) bad = true;
          if (x < x1 || x > x2 || z < z1 || z > z2) continue;
          const c = g(x, z);
          if (!c) { bad = true; break; }
          lo = Math.min(lo, c.y);
          hi = Math.max(hi, c.y);
          trees += c.trees;
          if (hi - lo > 2) bad = true;
        }
      for (const [x, z] of [[x2, z2], [x2, z1], [x1, z2], [x2 + 2, z2 + 2]]) if (!bad && input.takenAt(x, z)) bad = true;
      if (bad) continue;
      const cost = dist + 4 * (hi - lo) + trees / 4;
      if (best && cost >= best.cost) continue;
      const dx = input.hut.x - cx, dz = input.hut.z - cz;
      const side: Quarry['side'] = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? 'w' : 'e') : (dz < 0 ? 'n' : 's');
      best = { area: { x1, z1, x2, z2 }, y: hi, side, cost };
    }
  return best;
}

/** A new quarry record. */
export function newQuarry(area: Area, y: number, depth: number, side: Quarry['side'], by: string, now: number, soil?: number): Quarry {
  return { ...area, y, depth, side, rows: {}, cut: {}, dug: 0, open: 0, got: {}, state: 'open', by, at: now, ...(soil ? { soil } : {}) };
}

/** The record's line for logs. */
export function quarryLine(q: Quarry): string {
  const got = Object.entries(q.got).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${c} ${n}`).join(', ') || 'nothing yet';
  return `quarry ${pitSide(q)}x${pitSide(q)}x${q.depth} at ${q.x1},${q.z1} y ${q.y} (${q.side}) ${q.state}: ${q.dug} dug, ${q.open} open, ${Object.keys(q.cut).length} rows cut, ~${cellsLeft(q)} left; gave ${got}`;
}
