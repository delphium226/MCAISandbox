/**
 * A village that grows (s30, the user's): once complete, code lays out more houses toward one a member, a neighbourhood at
 * a time (a small cross-street pad of up to four houses, its own plot off the village's ground within 96 blocks, with lamps
 * and signs), built by the same economy while the village stays complete. Growth tasks are those whose ids come from the
 * neighbourhood's first on (ids are registry-wide and rising), so the claim gates need no new field. No model call decides
 * any of it. World-independent: the world's tick decides (MineflayerWorld.growTick), a chore lays out (lay_out_houses).
 */
import { HOUSE_UNITS } from './designs';
import { MINING_HUT, STORAGE_HUT } from './huts';
import { doorOf, placeFarm, placeLamps, planStreets } from './streetPlan';
import type { Area, Design, Task, Village } from './village';

/** On unless MC_GROW=0 (Q1: off until the staged runs passed; G3 and G25 did, 10-15); batch and range (D4, D6). */
export const GROW = { on: process.env.MC_GROW !== '0', batch: Number(process.env.MC_GROW_BATCH) || 4, range: Number(process.env.MC_GROW_RANGE) || 80 };

/**
 * N.2 housing (s37, MC_HOUSING=on; off by default): each member owns a house, a street of houses is a member's own project
 * (the chore menu's `grow:street`) or a voted work, and growth's code trigger is retired (growth lays out only on a
 * request). Growth's machinery stays: GROW.on must stay true. Spec runs/2026-10-18/s37/spec_batch_n2.md H.
 */
export const HOUSING = process.env.MC_HOUSING === 'on';

/** A task id's number ("t123" -> 123): ids come from one counter, so a later task has a higher one. */
export const taskNum = (t: { id: string }) => Number(/\d+/.exec(t.id)?.[0] ?? NaN);

const VANILLA_PIECE = /^(plains|desert|savanna|taiga|snowy)_/;
const SMALL_VANILLA = /_small_house_\d+$/;

/**
 * Whether a design is a dwelling (D3), by its name: the staged library records vanilla pieces as `by: 'api'` (lesson 89).
 * Not the huts ("mining_hut" holds neither "mine" nor anything else the other rule would catch).
 */
export function isDwelling(name: string): boolean {
  const n = name.toLowerCase();
  if (n === STORAGE_HUT || n === MINING_HUT) return false;
  if (VANILLA_PIECE.test(n)) return /_(small|medium|big)_house_\d+$/.test(n);
  return /house|cottage|home|cabin|dwelling|lodge|hut/.test(n) && !/hall|library|meeting|shop|smith|temple|church|tavern|inn|market|barn|storage|workshop|mine|tower/.test(n);
}

/** The dwellings standing: structures, not the layouts' names (a failed build is no house). */
export function housesOf(v: Village): number {
  return v.structures.filter((s) => isDwelling(s.kind)).length;
}

/** Whether a complete village has a neighbourhood on its board. */
export function growing(v: Village | undefined): boolean {
  return !!v?.complete && !!v.growth?.active;
}

/** Whether a task is the growing neighbourhood's (posted from its layout on: requeued gathering and needs included). */
export function isGrowTask(v: Village, t: Task): boolean {
  return growing(v) && taskNum(t) >= v.growth!.active!.from;
}

/**
 * The houses of the next neighbourhood (D4): `n` picks, the least built first (Build tasks naming the design, and picks
 * already made), then library order, so siblings take turns. Candidates: the biome's vanilla small houses (a street
 * village whose world has the library; picked ones are copied into the library, nothing is deleted) and the dwellings some
 * layout already used, 9x9 or smaller and within a house's budget (`units`, when the world can say: L6). Empty when none.
 */
export function pickHouses(v: Village, n: number, lib: Design[] | null, units?: (d: Design) => number, only?: Design[]): string[] {
  const cands: Design[] = [];
  const add = (d: Design) => {
    if (!cands.some((c) => c.name === d.name)) cands.push(d);
  };
  // (`only`: a voted style's houses and none else, whatever the plan: spec_vote1 2)
  if (only) for (const d of only) add(d);
  if (lib && v.plan === 'street' && !only) for (const d of lib) if (SMALL_VANILLA.test(d.name)) add(d);
  const used = new Set((v.layouts ?? []).flatMap((l) => l.buildings));
  if (!only)
    for (const d of Object.values(v.designs))
      if (used.has(d.name) && isDwelling(d.name) && d.width <= 9 && d.depth <= 9 && (!VANILLA_PIECE.test(d.name) || SMALL_VANILLA.test(d.name))
        && (!units || units(d) <= HOUSE_UNITS)) add(d);
  if (!cands.length || n < 1) return [];
  const built = new Map(cands.map((d) => [d.name, v.tasks.filter((t) => /^Build /.test(t.title) && t.detail.startsWith(`build_design "${d.name}"`)).length]));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = cands.reduce((b, c) => (built.get(c.name)! < built.get(b.name)! ? c : b));
    built.set(d.name, built.get(d.name)! + 1);
    out.push(d.name);
  }
  for (const name of new Set(out)) if (!v.designs[name]) v.designs[name] = structuredClone(cands.find((d) => d.name === name)!);
  return out;
}

/**
 * The pad (D5): the smallest size from 17 to 29 where a plain cross-street plan places every house and leaves room for 2
 * lamps or more; else one house fewer (4 small houses need 23: at 19-21 they fit with no lamp cell, the scratch's count).
 * With `slots` 0 or more (s30's food step, D2): every house of `designs` with a wheat field and that many farm slots, by
 * postLayout's own order (the field on the pad, 2 lamps or more keeping off it, the slots off the field, each other and
 * the lamps: runs/2026-10-15/s30/scratch/food_pad.mts), sizes 17 to 33, no house fewer.
 */
export function padFor(designs: Design[], slots = -1): { size: number; n: number } | null {
  if (slots >= 0) {
    const n = designs.length;
    if (!n) return null;
    for (let size = 17; size <= 33; size++) if (fieldFits(designs, size, slots)) return { size, n };
    return null;
  }
  for (let n = designs.length; n >= 1; n--) {
    const items = designs.slice(0, n).map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...doorOf(d) }));
    for (let size = 17; size <= 29; size++) {
      const s = planStreets(0, 0, size, null, items);
      if (!s.unplaced.length && placeLamps(s).length >= 2) return { size, n };
    }
  }
  return null;
}

/** Whether the houses, a field and `slots` farm slots fit an S x S neighbourhood as postLayout places them. */
function fieldFits(designs: Design[], size: number, slots: number): boolean {
  const items = designs.map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...doorOf(d) }));
  const s = planStreets(0, 0, size, null, items);
  if (s.unplaced.length) return false;
  const grids = s.places.map((p) => ({ design: designs.find((d) => d.name === p.name)!, x: p.x, z: p.z, rot: (p.rotate ?? 0) / 90 }));
  const farm = placeFarm(grids, s.plot, { streets: s.streets });
  if (!farm) return false;
  const lamps = placeLamps(s, undefined, undefined, [farm]);
  if (lamps.length < 2) return false;
  const near = { x: (farm.x1 + farm.x2) / 2, z: (farm.z1 + farm.z2) / 2 };
  const placed: Area[] = [];
  for (let i = 0; i < slots; i++) {
    const avoid = [grow(farm, 1), ...placed.map((q) => grow(q, 1)), ...lamps.map((c) => grow({ x1: c.x, z1: c.z, x2: c.x, z2: c.z }, 1))];
    const q = placeFarm(grids, s.plot, { streets: s.streets, near, avoid });
    if (!q) return false;
    placed.push(q);
  }
  return true;
}

const grow = (a: Area, n: number): Area => ({ x1: a.x1 - n, z1: a.z1 - n, x2: a.x2 + n, z2: a.z2 + n });

/** Neighbourhood fields and farm slots (s30's food step, D1; off until the staged runs G3f and G25f pass). */
export const GROW_FARMS = process.env.MC_GROW_FARMS === '1';

/** Biomes where a layout gets no wheat field (postLayout's rule: the channel freezes, or no grass for seeds). */
export const NO_FIELD_BIOME = /snowy|frozen|ice|grove|peaks|desert|badlands/;

/** One rung of the pad ladder: an S x S pad for the first `n` houses of the pick, with a field and `slots` slots (-1: no
 *  field, the growth's pad before the food step). */
export interface PadOption { size: number; n: number; slots: number }

/** The biggest pad the ladder offers (a 31 pad's corners stay within the village's range at growReach 74). */
const LADDER_MAX = 31;

/**
 * The pad ladder (D2, the check's L9): for the batch's houses, (all of them, field, 2 slots), (3, field, 1), (2, field, 1),
 * then the pad without a field (padFor's own); a rung needing more than 31, or of a size an earlier rung with as many
 * houses already has, is dropped. With MC_GROW_FARMS off, only the pad without a field. lay_out_houses surveys once and
 * takes the first rung a square is found for.
 */
export function padLadder(designs: Design[]): PadOption[] {
  const plain = padFor(designs);
  if (!GROW_FARMS) return plain ? [{ ...plain, slots: -1 }] : [];
  const n = designs.length;
  const out: PadOption[] = [];
  const add = (o: PadOption) => {
    if (o.size > LADDER_MAX || out.some((q) => q.size === o.size && q.n >= o.n)) return;
    out.push(o);
  };
  const tried = new Set<string>();
  for (const [h, s] of [[n, 2], [Math.min(n, 3), 1], [Math.min(n, 2), 1]]) {
    if (h < 1 || tried.has(`${h}:${s}`)) continue;
    tried.add(`${h}:${s}`);
    const p = padFor(designs.slice(0, h), s);
    if (p) add({ ...p, slots: s });
  }
  if (plain) add({ ...plain, slots: -1 });
  return out;
}
