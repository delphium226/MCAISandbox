/**
 * The street plan (phase D, vanilla villages, V2.3): a village laid out as vanilla lays one out, in code. A town centre
 * in the middle of the pad, streets 3 wide from each of its street connectors out to the pad's edge (a crossing through
 * the middle without a centre), and the buildings along the streets, each turned so its door opens onto a street (its
 * entrance step touching the street, as vanilla's houses join their street pieces). World-independent: plan_layout
 * (layout.ts) posts the work, prepare_site lays the streets as dirt_path.
 */
import { doorOutward, outsideCells, outwardStep } from './designs';
import type { Area, Design, Layout } from './village';

export const STREET_WIDTH = 3;
/** Blocks kept free between two buildings, and between a building and the centre: each build claims a block round its
 * own area (a gap of 1 put two neighbours' claims on the same cell, the review of V2.3). */
export const STREET_GAP = 2;
/** The longest path from a door to its street (a building set back from the street). */
export const MAX_PATH = 4;

/** A building to place: its size as drawn, the cell of its door in layer 1 and the way the door opens. */
export interface PlanItem {
  name: string;
  width: number;
  depth: number;
  door: [number, number];
  out: [number, number];
  /** The storage hut stays as drawn (its chest spots are not turned); the mining hut backs onto the pad's edge. */
  kind?: 'storage' | 'mine';
}

export interface PlanCentre {
  name: string;
  width: number;
  depth: number;
  connectors: Array<{ side: string; offset: number }>;
  /** Its plaza's path cells (design columns and rows), laid with the streets. */
  paths?: Array<[number, number]>;
}

export interface StreetLayout extends Layout {
  /** The streets, as rectangles (they overlap where they meet), and the paths from doors set back from them and the
   * centre's plaza (also in `streets`: prepare_site lays them all as dirt_path). */
  streets: Area[];
  paths: Area[];
  /** Names that found no place (for a second site). */
  unplaced: string[];
  /** A green's area inside its ring (V2.4): kept free, the centre in it. */
  green?: Area;
  /** Each placed building's door cell and the way it opens, and the mining hut's ground kept out to the pad's edge
   * (for the street lamps, which keep off both). */
  doors?: Array<{ x: number; z: number; ox: number; oz: number }>;
  back?: Area;
}

/**
 * Where a design's door is and which way it opens (as drawn): of its doors on an outer wall, one opening south (a vanilla
 * piece's entrance, turned to face south; its back or side doors are not the entrance), the one nearest the middle of
 * that side; the middle of the south side when it has none.
 */
export function doorOf(d: Design): { door: [number, number]; out: [number, number] } {
  const l1 = d.layers[1];
  const found: Array<{ door: [number, number]; out: [number, number]; rank: number }> = [];
  if (l1 && l1.length === d.depth) {
    const outside = outsideCells(l1);
    for (let j = 0; j < d.depth; j++)
      for (let i = 0; i < d.width; i++) {
        const ch = l1[j][i];
        if (ch === '.' || ch === '_' || !/_door$/.test((d.palette[ch] ?? '').replace(/\[.*$/, '')) || !outwardStep(l1, i, j, outside)) continue;
        const out = doorOutward(d, i, j, 0, outside);
        found.push({ door: [i, j], out, rank: (out[1] === 1 ? 0 : 100) + Math.abs(i - (d.width - 1) / 2) });
      }
  }
  const best = found.sort((a, b) => a.rank - b.rank)[0];
  return best ? { door: best.door, out: best.out } : { door: [Math.floor(d.width / 2), d.depth - 1], out: [0, 1] };
}

/** A design cell (i, j) turned clockwise `rot` quarter turns, as build_design turns a building of width w, depth d. */
function turnCell(i: number, j: number, w: number, d: number, rot: number): [number, number] {
  let [u, v, ww, dd] = [i, j, w, d];
  for (let r = 0; r < rot; r++) [u, v, ww, dd] = [dd - 1 - v, u, dd, ww];
  return [u, v];
}

/**
 * Lay the buildings out round a centre on a pad `size` across centred at (cx, cz). Buildings go in the order given
 * (the caller puts the huts first), each at the free spot nearest the pad's middle where its door's way out reaches a
 * street, directly (its entrance step touching the street, as in vanilla) or by a path of at most MAX_PATH blocks
 * (1 wide, laid with the streets); free means inside the pad (a block in from its edge), off the streets, paths and the
 * centre, and STREET_GAP from every other building and the centre. The mining hut's stairs run out its back: the ground
 * behind it out to the pad's edge must be free of buildings, and stays so.
 */
export function layoutStreets(cx: number, cz: number, size: number, centre: PlanCentre | null, items: PlanItem[]): StreetLayout {
  const x0 = cx - Math.floor(size / 2), z0 = cz - Math.floor(size / 2);
  const plot: Area = { x1: x0, z1: z0, x2: x0 + size - 1, z2: z0 + size - 1 };
  const half = Math.floor(STREET_WIDTH / 2);
  const streets: Area[] = [];
  const places: StreetLayout['places'] = [];
  const blocked: Area[] = []; // the centre
  if (centre) {
    const area = centreArea(plot, size, centre, 0);
    places.push(centrePlace(centre, area));
    blocked.push(area);
    for (const k of centre.connectors) {
      if (k.side === 'north' || k.side === 'south') {
        const x = area.x1 + k.offset;
        streets.push(k.side === 'north' ? { x1: x - half, x2: x + half, z1: plot.z1, z2: area.z1 - 1 } : { x1: x - half, x2: x + half, z1: area.z2 + 1, z2: plot.z2 });
      } else {
        const z = area.z1 + k.offset;
        streets.push(k.side === 'west' ? { x1: plot.x1, x2: area.x1 - 1, z1: z - half, z2: z + half } : { x1: area.x2 + 1, x2: plot.x2, z1: z - half, z2: z + half });
      }
    }
  } else {
    streets.push({ x1: cx - half, x2: cx + half, z1: plot.z1, z2: plot.z2 }, { x1: plot.x1, x2: plot.x2, z1: cz - half, z2: cz + half });
  }
  const done = placeAlong(plot, cx, cz, streets, { places, blocked, kept: [] }, items);
  const plaza = plazaOf(centre, done.places);
  return { plot, x: cx, z: cz, width: size, depth: size, places: done.places, streets: [...streets, ...done.paths, ...plaza], paths: [...done.paths, ...plaza], unplaced: done.unplaced, doors: done.doors, back: done.back };
}

/** Where the centre stands on the pad: in the middle, `dz` blocks south of it (a green moves its ring to make room). */
function centreArea(plot: Area, size: number, centre: PlanCentre, dz: number): Area {
  const c = { x1: plot.x1 + Math.floor((size - centre.width) / 2), z1: plot.z1 + Math.floor((size - centre.depth) / 2) + dz };
  return { ...c, x2: c.x1 + centre.width - 1, z2: c.z1 + centre.depth - 1 };
}
const centrePlace = (centre: PlanCentre, area: Area): StreetLayout['places'][number] =>
  ({ name: centre.name, width: centre.width, depth: centre.depth, ...area, x: area.x1 + Math.floor(centre.width / 2), z: area.z1 + Math.floor(centre.depth / 2), rotate: 0 });

/** The centre's plaza, in rows of cells. */
function plazaOf(centre: PlanCentre | null, places: StreetLayout['places']): Area[] {
  const plaza: Area[] = [];
  const at = places.find((p) => p.name === centre?.name);
  if (centre?.paths && at)
    for (const [i, j] of [...centre.paths].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const last = plaza[plaza.length - 1];
      if (last && last.z1 === at.z1 + j && last.x2 === at.x1 + i - 1) last.x2++;
      else plaza.push({ x1: at.x1 + i, x2: at.x1 + i, z1: at.z1 + j, z2: at.z1 + j });
    }
  return plaza;
}

/**
 * The buildings placed along `ways` (the streets their doors may open onto), round what `start` holds: the places so far
 * (the centre), the areas kept STREET_GAP apart (the centre) and the areas no building or path may cover (a green).
 */
function placeAlong(plot: Area, cx: number, cz: number, streets: Area[], start: { places: StreetLayout['places']; blocked: Area[]; kept: Area[] }, items: PlanItem[]): { places: StreetLayout['places']; paths: Area[]; unplaced: string[]; doors: NonNullable<StreetLayout['doors']>; back?: Area } {
  const overlaps = (a: Area, b: Area) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;
  const apart = (a: Area, b: Area) => a.x2 + STREET_GAP < b.x1 || b.x2 + STREET_GAP < a.x1 || a.z2 + STREET_GAP < b.z1 || b.z2 + STREET_GAP < a.z1;
  const inArea = (a: Area, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
  const baseCells = streets.flatMap(cellsOf);
  // A partial plan: what is placed, blocked (kept STREET_GAP apart), kept free (paths, the ground behind the mining
  // hut, a green), the paths (later doors may open onto them too)
  type Door = NonNullable<StreetLayout['doors']>[number];
  interface State { places: StreetLayout['places']; blocked: Area[]; kept: Area[]; paths: Area[]; unplaced: string[]; score: number; doors: Door[]; back?: Area }
  type Option = { area: Area; rot: number; score: number; W: number; D: number; path: Area | null; back: Area | null; door: Door };
  const options = (st: State, it: PlanItem): Option[] => {
    const ways = [...streets, ...st.paths];
    const onWay = (x: number, z: number) => ways.some((w) => inArea(w, x, z));
    const cells = [...baseCells, ...st.paths.flatMap(cellsOf)];
    const out = new Map<string, Option>();
    for (const rot of it.kind === 'storage' ? [0] : [0, 1, 2, 3]) {
      const W = rot % 2 ? it.depth : it.width, D = rot % 2 ? it.width : it.depth;
      const [du, dv] = turnCell(it.door[0], it.door[1], it.width, it.depth, rot);
      let [ox, oz] = it.out;
      for (let r = 0; r < rot; r++) [ox, oz] = [-oz, ox];
      // The first cell out of the footprint from the door, the way it opens: on a street, or a path's end
      let [eu, ev] = [du, dv];
      while (eu >= 0 && ev >= 0 && eu < W && ev < D) [eu, ev] = [eu + ox, ev + oz];
      for (const [sx, sz] of cells)
        for (let k = 0; k <= MAX_PATH; k++) {
          // The door's way out k blocks back from the street cell; the cells between are the path
          const [ex, ez] = [sx - k * ox, sz - k * oz];
          if (k && onWay(ex, ez)) break;
          const area = { x1: ex - eu, z1: ez - ev, x2: ex - eu + W - 1, z2: ez - ev + D - 1 };
          const key = `${area.x1},${area.z1},${rot}`;
          if (out.has(key)) continue;
          if (area.x1 <= plot.x1 || area.z1 <= plot.z1 || area.x2 >= plot.x2 || area.z2 >= plot.z2) continue;
          if (ways.some((w) => overlaps(area, w))) continue;
          if (!st.blocked.every((b) => apart(area, b)) || st.kept.some((b) => overlaps(area, b))) continue;
          const path = k ? { x1: Math.min(ex, sx - ox), x2: Math.max(ex, sx - ox), z1: Math.min(ez, sz - oz), z2: Math.max(ez, sz - oz) } : null;
          if (path && (st.blocked.some((b) => overlaps(path, b)) || st.kept.some((b) => overlaps(path, b)))) continue;
          // The mining hut's stairs run out the back, away from its door: nothing built from there to the pad's edge
          const back = it.kind !== 'mine' ? null
            : ox > 0 ? { x1: plot.x1, x2: area.x1 - 1, z1: area.z1, z2: area.z2 } : ox < 0 ? { x1: area.x2 + 1, x2: plot.x2, z1: area.z1, z2: area.z2 }
            : oz > 0 ? { x1: area.x1, x2: area.x2, z1: plot.z1, z2: area.z1 - 1 } : { x1: area.x1, x2: area.x2, z1: area.z2 + 1, z2: plot.z2 };
          if (back && st.blocked.some((b) => overlaps(back, b))) continue;
          // Nearest the middle, touching the street before set back from it; the mining hut near the edge (the ground
          // kept behind it is room no house can use)
          const behind = back ? (back.x2 - back.x1 + 1) * (back.z2 - back.z1 + 1) : 0;
          const score = Math.abs(area.x1 + W / 2 - cx) + Math.abs(area.z1 + D / 2 - cz) + 3 * k + behind / 2 + rot * 0.01;
          out.set(key, { area, rot, score, W, D, path, back, door: { x: area.x1 + du, z: area.z1 + dv, ox, oz } });
        }
    }
    return [...out.values()].sort((a, b) => a.score - b.score);
  };
  // The huts first (as given), then the biggest: small houses fill the gaps the big ones leave. A beam search: the best
  // BEAM partial plans after each building (most placed, then lowest score), each tried with its WIDTH best spots or
  // without it (a greedy first choice often left no room for the rest)
  const order = [...items].sort((a, b) => Number(!a.kind) - Number(!b.kind) || (a.kind || b.kind ? 0 : b.width * b.depth - a.width * a.depth));
  const BEAM = 24, WIDTH = 10;
  let beam: State[] = [{ places: start.places, blocked: start.blocked, kept: start.kept, paths: [], unplaced: [], score: 0, doors: [] }];
  for (const it of order) {
    const next: State[] = [];
    for (const st of beam) {
      for (const o of options(st, it).slice(0, WIDTH))
        next.push({
          places: [...st.places, { name: it.name, width: o.W, depth: o.D, ...o.area, x: o.area.x1 + Math.floor(o.W / 2), z: o.area.z1 + Math.floor(o.D / 2), rotate: o.rot * 90 }],
          blocked: [...st.blocked, o.area], kept: [...st.kept, ...(o.path ? [o.path] : []), ...(o.back ? [o.back] : [])],
          paths: [...st.paths, ...(o.path ? [o.path] : [])], unplaced: st.unplaced, score: st.score + o.score,
          doors: [...st.doors, o.door], back: o.back ?? st.back,
        });
      next.push({ ...st, unplaced: [...st.unplaced, it.name], score: st.score + 1000 });
    }
    next.sort((a, b) => a.unplaced.length - b.unplaced.length || a.score - b.score);
    beam = next.slice(0, BEAM);
  }
  return { places: beam[0].places, paths: beam[0].paths, unplaced: beam[0].unplaced, doors: beam[0].doors, back: beam[0].back };
}

/**
 * A green (V2.4, the user's choice): the centre in an open green `g` blocks wide, a street STREET_WIDTH wide round the
 * green, and every building outside it with its door onto that ring (the green itself is kept free: no building or
 * path); streets from the centre's own connectors cross the green to the ring. The centre and its ring stand `dz` blocks
 * south of the pad's middle (the storage hut, never turned, opens south and needs room north of the ring). Null when the
 * ring does not fit the pad with a block to spare.
 */
export function layoutGreen(cx: number, cz: number, size: number, centre: PlanCentre, items: PlanItem[], g: number, dz: number): StreetLayout | null {
  const x0 = cx - Math.floor(size / 2), z0 = cz - Math.floor(size / 2);
  const plot: Area = { x1: x0, z1: z0, x2: x0 + size - 1, z2: z0 + size - 1 };
  const area = centreArea(plot, size, centre, dz);
  const inner = { x1: area.x1 - g, z1: area.z1 - g, x2: area.x2 + g, z2: area.z2 + g };
  const outer = { x1: inner.x1 - STREET_WIDTH, z1: inner.z1 - STREET_WIDTH, x2: inner.x2 + STREET_WIDTH, z2: inner.z2 + STREET_WIDTH };
  if (outer.x1 <= plot.x1 || outer.z1 <= plot.z1 || outer.x2 >= plot.x2 || outer.z2 >= plot.z2) return null;
  const ring: Area[] = [
    { ...outer, z2: inner.z1 - 1 }, { ...outer, z1: inner.z2 + 1 },
    { x1: outer.x1, x2: inner.x1 - 1, z1: inner.z1, z2: inner.z2 }, { x1: inner.x2 + 1, x2: outer.x2, z1: inner.z1, z2: inner.z2 },
  ];
  const half = Math.floor(STREET_WIDTH / 2);
  const spokes: Area[] = centre.connectors.map((k) => {
    if (k.side === 'north' || k.side === 'south') {
      const x = area.x1 + k.offset;
      return k.side === 'north' ? { x1: x - half, x2: x + half, z1: inner.z1, z2: area.z1 - 1 } : { x1: x - half, x2: x + half, z1: area.z2 + 1, z2: inner.z2 };
    }
    const z = area.z1 + k.offset;
    return k.side === 'west' ? { x1: inner.x1, x2: area.x1 - 1, z1: z - half, z2: z + half } : { x1: area.x2 + 1, x2: inner.x2, z1: z - half, z2: z + half };
  });
  // (the ring is the only street doors open onto: a door onto a spoke would stand on the green)
  const done = placeAlong(plot, cx, cz, ring, { places: [centrePlace(centre, area)], blocked: [area], kept: [inner] }, items);
  const plaza = plazaOf(centre, done.places);
  return { plot, x: cx, z: cz, width: size, depth: size, places: done.places, streets: [...ring, ...spokes, ...done.paths, ...plaza], paths: [...done.paths, ...plaza], unplaced: done.unplaced, green: { ...inner }, doors: done.doors, back: done.back };
}

/**
 * The green that places every building, with the widest green (4 down to 2 blocks) and the centre nearest the pad's
 * middle (moved up to 4 blocks south or north); else the one that places the most (the caller then takes the street
 * plan). At most 27 layouts (~12 ms each: the search runs inside plan_layout, on the event loop).
 */
export function planGreen(cx: number, cz: number, size: number, centre: PlanCentre, items: PlanItem[]): StreetLayout | null {
  let best: StreetLayout | null = null;
  for (const g of [4, 3, 2])
    for (const dz of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const lay = layoutGreen(cx, cz, size, centre, items, g, dz);
      if (!lay) continue;
      if (!lay.unplaced.length) return lay;
      if (!best || lay.unplaced.length < best.unplaced.length) best = lay;
    }
  return best;
}

/**
 * The street plan that places the most buildings: with all of the centre's streets, or fewer (each street laid takes
 * room; a pad of 32 holds a centre, four streets and only four or five buildings), and a plain street from the middle of
 * each side of the centre that has none in vanilla (the savanna and taiga meeting points leave one or two sides without,
 * and the storage hut, never turned, needs an east-west street); ties go to more of vanilla's streets, then more
 * streets, then the plan whose buildings stand nearest the middle.
 */
export function planStreets(cx: number, cz: number, size: number, centre: PlanCentre | null, items: PlanItem[]): StreetLayout {
  if (!centre) return layoutStreets(cx, cz, size, null, items);
  const own = centre.connectors.map((k) => ({ ...k, vanilla: true }));
  const extra = ['north', 'east', 'south', 'west'].filter((side) => !own.some((k) => k.side === side))
    .map((side) => ({ side, offset: Math.floor((side === 'north' || side === 'south' ? centre.width : centre.depth) / 2), vanilla: false }));
  const all = [...own, ...extra];
  let best: { lay: StreetLayout; vanilla: number; arms: number; spread: number } | null = null;
  for (let mask = (1 << all.length) - 1; mask >= 1; mask--) {
    const arms = all.filter((_, i) => mask & (1 << i));
    const lay = layoutStreets(cx, cz, size, { ...centre, connectors: arms }, items);
    const vanilla = arms.filter((k) => k.vanilla).length;
    const spread = lay.places.reduce((t, p) => t + Math.abs(p.x - cx) + Math.abs(p.z - cz), 0);
    const better = !best || lay.unplaced.length < best.lay.unplaced.length
      || (lay.unplaced.length === best.lay.unplaced.length && (vanilla > best.vanilla || (vanilla === best.vanilla && (arms.length > best.arms || (arms.length === best.arms && spread < best.spread)))));
    if (better) best = { lay, vanilla, arms: arms.length, spread };
  }
  return best!.lay;
}

const cellsOf = (a: Area) => { const out: Array<[number, number]> = []; for (let x = a.x1; x <= a.x2; x++) for (let z = a.z1; z <= a.z2; z++) out.push([x, z]); return out; };

/** Whether a cell is on one of a layout's streets. */
export const streetAt = (streets: Area[] | undefined, x: number, z: number) => !!streets?.some((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2);

/** Blocks between two street lamps (the user's choice, 10-06: about every 8; vanilla's are 25-40 apart). */
export const LAMP_SPACING = 8;

/**
 * Where a street plan's lamp posts go (the user's, 10-06): beside a main street (not a door's path), off every street,
 * path and plaza, `clear` blocks from every building (each build claims a block round its own area, and a post in a
 * 2-wide gap would grow an arm to a wall), off the 3 cells out of each door (build_design clears 2 of them), off the mining
 * hut's ground out to the pad's edge and the pad's own edge cells. Street corners and crossings first, then the pad's
 * edge (the village's entrances), then along the streets, `spacing` apart.
 */
export function placeLamps(lay: StreetLayout, spacing = LAMP_SPACING, clear = 2): Array<{ x: number; z: number }> {
  const inArea = (a: Area | undefined, x: number, z: number) => !!a && x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
  const away = (x: number, z: number, a: Area) => Math.max(a.x1 - x, x - a.x2, a.z1 - z, z - a.z2, 0);
  const walk = new Set<string>();
  for (const d of lay.doors ?? []) for (let i = 1; i <= 3; i++) walk.add(`${d.x + d.ox * i},${d.z + d.oz * i}`);
  const main = lay.streets.filter((s) => !lay.paths.includes(s));
  const onStreet = (x: number, z: number) => streetAt(lay.streets, x, z);
  const found: Array<{ x: number; z: number; score: number }> = [];
  for (let x = lay.plot.x1 + 1; x < lay.plot.x2; x++)
    for (let z = lay.plot.z1 + 1; z < lay.plot.z2; z++) {
      if (onStreet(x, z) || walk.has(`${x},${z}`) || inArea(lay.back, x, z) || lay.places.some((p) => away(x, z, p) < clear)) continue;
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => streetAt(main, x + a, z + b)).length;
      if (!sides) continue;
      const edge = Math.min(x - lay.plot.x1, lay.plot.x2 - x, z - lay.plot.z1, lay.plot.z2 - z);
      const corner = sides >= 2 || [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => onStreet(x + a, z + b) && !onStreet(x + a, z) && !onStreet(x, z + b));
      found.push({ x, z, score: (corner ? 0 : 10) + (edge <= 2 ? 0 : 5) + edge * 0.1 });
    }
  found.sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z);
  const lamps: Array<{ x: number; z: number }> = [];
  for (const c of found) if (lamps.every((l) => Math.max(Math.abs(l.x - c.x), Math.abs(l.z - c.z)) >= spacing)) lamps.push({ x: c.x, z: c.z });
  return lamps;
}
