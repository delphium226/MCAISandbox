/**
 * Graded door-to-door paths between a village's pads (#84 C2, MC_PAD_PER_BUILDING; spec runs/2026-10-24/layout-measure/
 * spec_c.md and RESUME_C2.md). Pure: the ground comes in as a function, so the offline check (scripts/checks/pads_plan.mts)
 * runs it on fixtures and the skill (mcBuild.ts prepare_site layout=N path=K) on the world.
 *
 * A tree grown from the hub's door (the meeting point's, else the storage hut's): each other door joins the nearest cell
 * already on it by an 8-neighbour A* over the ground, off footprints, fields, water and other villages' ground, a step of
 * more than 1 made costly (GDMC's idea, measure.py's graded_paths). The centreline is then graded, the review's M2:
 * - each cell's anchor h is its ground clamped between the pads' envelopes (a pad's level -/+ its distance from the pad),
 *   and a cell on a pad is the pad's level;
 * - its target is floor((max_n(h(n) - d) + min_n(h(n) + d)) / 2) over the centreline's cells, d along the centreline, so
 *   no two neighbouring centreline cells differ by more than 1.
 * Each centreline cell's neighbours make the path 3 wide, at the mean of the centreline targets beside them.
 */
import type { Area } from './village';

export interface PathPad extends Area {
  y: number;
  what: string;
  kind: 'building' | 'field';
  /** A building's door step: the cell outside its door, on the pad's ring. */
  door?: { x: number; z: number };
  /** The building's footprint (inside the ring). */
  inner?: Area;
}

export interface PathInput {
  /** Where paths may run (the layout and its halo). */
  area: Area;
  pads: PathPad[];
  /** The pad the tree grows from (its door). */
  hub: number;
  /** The ground's top at a column, or null (water, unloaded, nothing within reach). */
  ground: (x: number, z: number) => number | null;
  /** Columns paths keep off besides footprints and fields (other villages, the mine, built things). */
  blocked?: (x: number, z: number) => boolean;
  /** #138 (MC_GROW_OUTWARD): the paths already graded, [x, z, y] (their cells kept at their levels: new paths join them),
   *  and the pads to plan paths for (the others are on the tree already). With a tree, `hub` may be -1. */
  tree?: Array<[number, number, number]>;
  only?: number[];
}

export interface PlannedPath {
  /** The pad (index into `pads`) this path leads from to the tree. */
  pad: number;
  what: string;
  /** Its cells (centreline and sides, only the ones it adds to the tree) with their targets. */
  cells: Array<[number, number, number]>;
  /** Its centreline, door to joining cell. */
  line: Array<[number, number]>;
  fail?: string;
}

const key = (x: number, z: number) => `${x},${z}`;
const inside = (a: Area, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
const cheb = (a: Area, x: number, z: number) => Math.max(a.x1 - x, x - a.x2, a.z1 - z, z - a.z2, 0);

/** Paths for every building pad with a door but the hub's, in the order they join the tree (nearest the hub first). */
export function planPadPaths(input: PathInput): PlannedPath[] {
  const { area, pads, ground } = input;
  const hub = pads[input.hub] as PathPad | undefined;
  const tree = input.tree ?? [];
  const fixed = new Map(tree.map(([x, z, y]) => [key(x, z), y]));
  if (!hub && !tree.length) return [];
  const padAt = (x: number, z: number) => pads.find((p) => inside(p, x, z));
  // (footprints and fields are never walked through: a field's ring and a building's ring are, being the pads' edges)
  const hard = (x: number, z: number) => !inside(area, x, z) || pads.some((p) => (p.kind === 'field' ? inside(p, x, z) : !!p.inner && inside(p.inner, x, z)))
    || !!input.blocked?.(x, z);
  const gmemo = new Map<string, number | null>();
  const g = (x: number, z: number) => {
    const k = key(x, z);
    if (!gmemo.has(k)) {
      const p = padAt(x, z);
      gmemo.set(k, p && p.kind === 'building' ? p.y : ground(x, z));
    }
    return gmemo.get(k)!;
  };
  // (the tree starts at the hub's door, or with no door (a meeting point, open on every side) anywhere on its ring)
  const ring: Array<[number, number]> = [];
  if (hub && !hub.door) for (let x = hub.x1; x <= hub.x2; x++) for (let z = hub.z1; z <= hub.z2; z++) if (!(hub.inner && inside(hub.inner, x, z)) && !input.blocked?.(x, z)) ring.push([x, z]);
  const at0 = !hub ? { x: tree[0][0], z: tree[0][1] } : hub.door ?? { x: Math.round((hub.x1 + hub.x2) / 2), z: Math.round((hub.z1 + hub.z2) / 2) };
  const on = new Set<string>(!hub ? [] : hub.door ? [key(hub.door.x, hub.door.z)] : ring.map(([x, z]) => key(x, z)));
  const centre: Array<[number, number]> = hub?.door ? [[hub.door.x, hub.door.z]] : [];
  // (the tree already graded: on it, and part of the centreline whose levels anchor the new paths' grades)
  for (const [x, z] of tree) if (!on.has(key(x, z))) {
    on.add(key(x, z));
    centre.push([x, z]);
  }
  const inCentre = new Set(centre.map(([x, z]) => key(x, z)));
  const lines: PlannedPath[] = [];
  const order = pads.map((p, k) => ({ p, k })).filter(({ p, k }) => k !== input.hub && p.kind === 'building' && p.door && (!input.only || input.only.includes(k)))
    .sort((a, b) => Math.abs(a.p.door!.x - at0.x) + Math.abs(a.p.door!.z - at0.z) - (Math.abs(b.p.door!.x - at0.x) + Math.abs(b.p.door!.z - at0.z)) || a.k - b.k);
  for (const { p, k } of order) {
    const start: [number, number] = [p.door!.x, p.door!.z];
    if (on.has(key(...start))) {
      lines.push({ pad: k, what: p.what, cells: [], line: [start] });
      continue;
    }
    const line = astar(start, on, centre.length ? centre : ring, hard, g);
    if (!line) {
      lines.push({ pad: k, what: p.what, cells: [], line: [], fail: `no way from the door of ${p.what} to the paths (water, buildings or steep ground)` });
      continue;
    }
    // (its joining cell too when it is the hub's ring, on the tree but not yet on a centreline: it needs a target)
    for (const [x, z] of line) if (!inCentre.has(key(x, z))) {
      on.add(key(x, z));
      inCentre.add(key(x, z));
      centre.push([x, z]);
    }
    lines.push({ pad: k, what: p.what, cells: [], line });
  }
  // The anchors, then the two envelopes along the centreline (8-neighbour relaxation over its cells)
  const env = (x: number, z: number) => {
    let lo = -Infinity, hi = Infinity;
    for (const q of pads) if (q.kind === 'building') {
      const d = cheb(q, x, z);
      lo = Math.max(lo, q.y - d);
      hi = Math.min(hi, q.y + d);
    }
    return [lo, hi] as const;
  };
  const h = new Map<string, number>();
  for (const [x, z] of centre) {
    const p = padAt(x, z);
    if (fixed.has(key(x, z))) {
      h.set(key(x, z), fixed.get(key(x, z))!);
      continue;
    }
    if (p && p.kind === 'building') {
      h.set(key(x, z), p.y);
      continue;
    }
    const [lo, hi] = env(x, z);
    const gg = g(x, z) ?? hub?.y ?? tree[0][2];
    h.set(key(x, z), lo <= hi ? Math.max(lo, Math.min(hi, gg)) : Math.round((lo + hi) / 2));
  }
  const relax = (sign: 1 | -1) => {
    const e = new Map(h);
    for (let changed = true; changed;) {
      changed = false;
      for (const [x, z] of centre) {
        if (fixed.has(key(x, z))) continue;
        let best = e.get(key(x, z))!;
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            const n = e.get(key(x + dx, z + dz));
            if (n === undefined) continue;
            if (sign > 0 ? n - 1 > best : n + 1 < best) best = n - sign;
          }
        if (best !== e.get(key(x, z))) {
          e.set(key(x, z), best);
          changed = true;
        }
      }
    }
    return e;
  };
  const lower = relax(1), upper = relax(-1);
  const t = new Map<string, number>();
  for (const [x, z] of centre) t.set(key(x, z), fixed.get(key(x, z)) ?? Math.floor((lower.get(key(x, z))! + upper.get(key(x, z))!) / 2));
  // The cells each path adds: its centreline and its sides, a cell to the first path that reaches it (never a cell of
  // the tree already graded)
  const taken = new Set<string>(fixed.keys());
  const hubCells: Array<[number, number, number]> = [];
  // (every centreline cell to its own path first: a cell taken as another's side would keep the side's level)
  const own = (out: Array<[number, number, number]>, x: number, z: number) => {
    if (taken.has(key(x, z))) return;
    taken.add(key(x, z));
    out.push([x, z, t.get(key(x, z))!]);
  };
  const add = (out: Array<[number, number, number]>, x: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const X = x + dx, Z = z + dz, k = key(X, Z);
        if (taken.has(k) || t.has(k) || hard(X, Z) || g(X, Z) === null) continue;
        const ns: number[] = [];
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const n = t.get(key(X + a, Z + b));
          if (n !== undefined) ns.push(n);
        }
        const q = padAt(X, Z);
        let y = Math.floor(ns.reduce((s, n) => s + n, 0) / ns.length);
        if (q && q.kind === 'building') y = q.y;
        else {
          const [lo, hi] = env(X, Z);
          if (lo <= hi) y = Math.max(lo, Math.min(hi, y));
        }
        taken.add(k);
        out.push([X, Z, y]);
      }
  };
  if (hub?.door) own(hubCells, hub.door.x, hub.door.z);
  for (const L of lines) for (const [x, z] of L.line) own(L.cells, x, z);
  if (hub?.door) add(hubCells, hub.door.x, hub.door.z);
  for (const L of lines) for (const [x, z] of L.line) add(L.cells, x, z);
  // (the hub's door cell and its sides go with the first path)
  if (lines.length && hubCells.length) lines.find((L) => !L.fail)?.cells.unshift(...hubCells);
  return lines;
}

function astar(start: [number, number], on: Set<string>, targets: Array<[number, number]>, hard: (x: number, z: number) => boolean,
  g: (x: number, z: number) => number | null, limit = 20000): Array<[number, number]> | null {
  const hz = (x: number, z: number) => {
    let m = Infinity;
    for (const [tx, tz] of targets) m = Math.min(m, Math.max(Math.abs(tx - x), Math.abs(tz - z)));
    return m;
  };
  const best = new Map<string, number>([[key(...start), 0]]);
  const prev = new Map<string, [number, number]>();
  // (a binary heap of [f, g, x, z])
  const heap: Array<[number, number, number, number]> = [];
  const push = (e: [number, number, number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  if (g(...start) === null) return null;
  push([hz(...start), 0, start[0], start[1]]);
  let n = 0;
  while (heap.length && n++ < limit) {
    const [, cost, x, z] = pop();
    if (cost > (best.get(key(x, z)) ?? Infinity)) continue;
    if (on.has(key(x, z))) {
      const path: Array<[number, number]> = [[x, z]];
      while (path[path.length - 1][0] !== start[0] || path[path.length - 1][1] !== start[1]) path.push(prev.get(key(...path[path.length - 1]))!);
      return path.reverse();
    }
    const here = g(x, z)!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const X = x + dx, Z = z + dz;
        // (a target cell may sit on ground hard to others: the hub's door is on a pad's ring, never hard)
        if (hard(X, Z) && !on.has(key(X, Z))) continue;
        if (dx && dz && (hard(X, z) || hard(x, Z))) continue;
        const there = g(X, Z);
        if (there === null) continue;
        const dh = Math.abs(there - here);
        const step = (dx && dz ? 1.41 : 1) + 0.5 * dh + (dh > 1 ? 6 * (dh - 1) : 0);
        const ng = cost + step;
        if (ng < (best.get(key(X, Z)) ?? Infinity)) {
          best.set(key(X, Z), ng);
          prev.set(key(X, Z), [x, z]);
          push([ng + hz(X, Z), ng, X, Z]);
        }
      }
  }
  return null;
}

/**
 * Lamp posts along the paths' shoulders (the review's M8): a cell 2 from a centreline, beside the path and off it, on
 * ground, clear of `avoid` (buildings by 2, pads, fields, signs...), `spacing` apart, door ends first then along each path.
 */
export function pathLamps(paths: PlannedPath[], ground: (x: number, z: number) => number | null, avoid: (x: number, z: number) => boolean, spacing = 8): Array<{ x: number; z: number }> {
  const band = new Set<string>();
  for (const p of paths) for (const [x, z] of p.cells) band.add(key(x, z));
  const lamps: Array<{ x: number; z: number }> = [];
  const far = (x: number, z: number) => lamps.every((l) => Math.max(Math.abs(l.x - x), Math.abs(l.z - z)) >= spacing);
  for (const p of paths) {
    for (let i = 0; i < p.line.length; i++) {
      const [x, z] = p.line[i];
      if (!far(x, z)) continue;
      // (the shoulder cells two out, the four sides first)
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
        const X = x + dx, Z = z + dz;
        if (band.has(key(X, Z)) || avoid(X, Z) || ground(X, Z) === null) continue;
        lamps.push({ x: X, z: Z });
        break;
      }
    }
  }
  return lamps;
}

// ---- G8's machines rung (MC_MACHINES_AGE, #24): a rail line, routed as a path is ----

/** A rail line's plan: its rails' cells (x, the rail's own y, z) from start to goal and each rail's shape. */
export interface RailPlan {
  cells: Array<[number, number, number]>;
  shapes: string[];
  fail?: string;
}

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_NAME = (dx: number, dz: number) => (dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north');

/**
 * A rail line from `start` to `goal` (columns), over the ground as the paths' A* reads it (`ground` the ground's top, null
 * for water or nothing; `hard` columns kept off: footprints, fields, pens, lamps, other villages). Rails take 4-neighbour
 * steps only (they never join corner to corner) and climb at most 1 a cell; a curve is never a slope, so a turn is only
 * taken where neither neighbour along the line is higher than its cell (the rule that keeps every rail connected). A turn
 * costs 2 more than a straight step, so the line keeps long straights (the powered rails need 6 in a row). The rail sits
 * one above the ground. At most `max` cells.
 */
export function planRailLine(start: [number, number], goal: [number, number], ground: (x: number, z: number) => number | null,
  hard: (x: number, z: number) => boolean, max = 160, limit = 60000): RailPlan {
  const g = (x: number, z: number) => (hard(x, z) && !(x === goal[0] && z === goal[1]) && !(x === start[0] && z === start[1]) ? null : ground(x, z));
  if (g(...start) === null) return { cells: [], shapes: [], fail: `the line's start at ${start[0]},${start[1]} has no ground` };
  if (g(...goal) === null) return { cells: [], shapes: [], fail: `the line's end at ${goal[0]},${goal[1]} has no ground` };
  // (a state is a cell and the direction it was entered by, 4 for the start)
  const sk = (x: number, z: number, d: number) => `${x},${z},${d}`;
  const best = new Map<string, number>([[sk(start[0], start[1], 4), 0]]);
  const prev = new Map<string, string>();
  const heap: Array<[number, number, number, number, number]> = [];
  const push = (e: [number, number, number, number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (x: number, z: number) => Math.abs(goal[0] - x) + Math.abs(goal[1] - z);
  push([h(...start), 0, start[0], start[1], 4]);
  let n = 0, end: string | null = null;
  while (heap.length && n++ < limit) {
    const [, cost, x, z, d] = pop();
    const k = sk(x, z, d);
    if (cost > (best.get(k) ?? Infinity)) continue;
    if (x === goal[0] && z === goal[1]) {
      end = k;
      break;
    }
    const here = g(x, z)!;
    const back = d < 4 ? g(x - DIRS[d][0], z - DIRS[d][1]) : null;
    for (let e = 0; e < 4; e++) {
      const X = x + DIRS[e][0], Z = z + DIRS[e][1];
      const there = g(X, Z);
      if (there === null || Math.abs(there - here) > 1) continue;
      // (no doubling back; a turn only on a cell no neighbour along the line rises above)
      if (d < 4 && e === (d ^ 1)) continue;
      const turn = d < 4 && e !== d;
      if (turn && (there > here || (back !== null && back > here))) continue;
      // (and no rail in a dip: a slope climbs one way only)
      if (back !== null && back > here && there > here) continue;
      const nk = sk(X, Z, e);
      const ng = cost + 1 + (turn ? 2 : 0) + 0.3 * Math.abs(there - here);
      if (ng < (best.get(nk) ?? Infinity)) {
        best.set(nk, ng);
        prev.set(nk, k);
        push([ng + h(X, Z), ng, X, Z, e]);
      }
    }
  }
  if (!end) return { cells: [], shapes: [], fail: `no way for rails from ${start[0]},${start[1]} to ${goal[0]},${goal[1]} (water, buildings or steps over 1)` };
  const cols: Array<[number, number]> = [];
  for (let k: string | undefined = end; k; k = prev.get(k)) {
    const [x, z] = k.split(',').map(Number);
    cols.push([x, z]);
  }
  cols.reverse();
  if (cols.length > max) return { cells: [], shapes: [], fail: `the line would be ${cols.length} rails long (at most ${max})` };
  const cells = cols.map(([x, z]): [number, number, number] => [x, g(x, z)! + 1, z]);
  return { cells, shapes: railShapes(cells) };
}

/**
 * Each rail's shape along a line of cells (x, y, z: 4-neighbours, steps of at most 1): straight along its neighbours, a
 * slope toward a neighbour one higher, a curve where the line turns (vanilla's rail shapes: north_south, east_west,
 * ascending_east..., north_east, north_west, south_east, south_west).
 */
export function railShapes(cells: Array<[number, number, number]>): string[] {
  return cells.map(([x, y, z], i) => {
    const p = cells[i - 1], q = cells[i + 1];
    const a = p ? [p[0] - x, p[2] - z] : q ? [x - q[0], z - q[2]] : [0, 1];
    const b = q ? [q[0] - x, q[2] - z] : p ? [x - p[0], z - p[2]] : [0, -1];
    if (a[0] === -b[0] && a[1] === -b[1]) {
      if (q && q[1] > y) return `ascending_${DIR_NAME(b[0], b[1])}`;
      if (p && p[1] > y) return `ascending_${DIR_NAME(a[0], a[1])}`;
      return b[0] ? 'east_west' : 'north_south';
    }
    const ns = a[1] ? DIR_NAME(0, a[1]) : DIR_NAME(0, b[1]);
    const ew = a[0] ? DIR_NAME(a[0], 0) : DIR_NAME(b[0], 0);
    return `${ns}_${ew}`;
  });
}

/**
 * Where the powered rails go: the first `n` cells in a row that are flat straights (a powered rail has no curve; the slopes
 * left to plain rails), away from the line's ends, and a cell beside the middle one for the redstone torch that powers them
 * (power runs 8 rails along powered rails), on ground at the rails' level and not on the line (`free`). Null when the line
 * has no such straight.
 */
export function poweredRun(cells: Array<[number, number, number]>, shapes: string[], free: (x: number, y: number, z: number) => boolean, n = 6): { from: number; torch: [number, number, number] } | null {
  const flat = (i: number) => (shapes[i] === 'east_west' || shapes[i] === 'north_south') && cells[i][1] === cells[Math.max(0, i - 1)][1] && cells[i][1] === cells[Math.min(cells.length - 1, i + 1)][1];
  const on = new Set(cells.map(([x, , z]) => `${x},${z}`));
  for (let i = 1; i + n <= cells.length - 1; i++) {
    let ok = true;
    for (let k = i; k < i + n && ok; k++) if (!flat(k) || shapes[k] !== shapes[i]) ok = false;
    if (!ok) continue;
    const [x, y, z] = cells[i + Math.floor(n / 2)];
    const side: Array<[number, number]> = shapes[i] === 'east_west' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [dx, dz] of side) if (!on.has(`${x + dx},${z + dz}`) && free(x + dx, y, z + dz)) return { from: i, torch: [x + dx, y, z + dz] };
  }
  return null;
}
