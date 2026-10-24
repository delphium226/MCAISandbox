/**
 * A village that grows (s30, the user's): once complete, code lays out more houses toward one a member, a neighbourhood at
 * a time (a small cross-street pad of up to four houses, its own plot off the village's ground within 96 blocks, with lamps
 * and signs), built by the same economy while the village stays complete. Growth tasks are those whose ids come from the
 * neighbourhood's first on (ids are registry-wide and rising), so the claim gates need no new field. No model call decides
 * any of it. World-independent: the world's tick decides (MineflayerWorld.growTick), a chore lays out (lay_out_houses).
 */
import { HOUSE_UNITS, HOUSE_UNITS_LARGE, VANILLA_ALL, VARIANT_WOODS, WOOD_VARIANTS, baseName, isLargeHome, variantName, variantWood, woodVariant } from './designs';
import { GEN_HOMES, isHomeName, ownHomes } from './houseStyle';
import { MINING_HUT, STORAGE_HUT } from './huts';
import { doorOf, placeFarm, placeLamps, planStreets } from './streetPlan';
import type { Area, Design, Task, Village } from './village';
import { rawSetting } from './settings';

/** On unless MC_GROW=0 (Q1: off until the staged runs passed; G3 and G25 did, 10-15); batch and range (D4, D6; 16 inside
 *  the village's range unless MC_GROW_RANGE says, s43). */
export const GROW = { on: rawSetting('MC_GROW') !== '0', batch: Number(rawSetting('MC_GROW_BATCH')) || 4, range: Number(rawSetting('MC_GROW_RANGE')) || (Number(rawSetting('MC_VILLAGE_RANGE')) || 144) - 16 };

/**
 * N.2 housing (s37; on by default since s38, MC_HOUSING=off turns it off): each member owns a house, a street of houses is a member's own project
 * (the chore menu's `grow:street`) or a voted work, and growth's code trigger is retired (growth lays out only on a
 * request). Growth's machinery stays: GROW.on must stay true. Spec runs/2026-10-18/s37/spec_batch_n2.md H.
 */
export const HOUSING = rawSetting('MC_HOUSING') !== 'off';

/** A task id's number ("t123" -> 123): ids come from one counter, so a later task has a higher one. */
export const taskNum = (t: { id: string }) => Number(/\d+/.exec(t.id)?.[0] ?? NaN);

const VANILLA_PIECE = /^(plains|desert|savanna|taiga|snowy)_/;
const SMALL_VANILLA = /_small_house_\d+$/;

/**
 * Whether a design is a dwelling (D3), by its name: the staged library records vanilla pieces as `by: 'api'` (lesson 89).
 * Not the huts ("mining_hut" holds neither "mine" nor anything else the other rule would catch).
 */
export function isDwelling(name: string): boolean {
  // (a wood variant is its base design's: "plains_small_house_1@spruce", R2)
  const n = baseName(name).toLowerCase();
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
 * With R1 (VANILLA_ALL): every vanilla dwelling of the library (medium and big houses too), used vanilla dwellings up to
 * 13x13 and HOUSE_UNITS_LARGE, and at most one larger home a batch (plan_layout lays out one building over HOUSE_UNITS a
 * layout).
 * With R2 (WOOD_VARIANTS) and the neighbourhood's `wood`: each pick is the design's wood variant ("NAME@spruce", copied
 * into the library), a design and its variants counted together, so shapes still take turns across woods.
 * With R3 (GEN_HOMES, #104) and `own`, the owners-to-be in the order the houses will be given: each owner's own house,
 * drawn in the neighbourhood's family (houseStyle.ts ownHomes: at most one over HOUSE_UNITS), copied into the library;
 * an owner whose house cannot fit, or a batch larger than the owners, takes vanilla picks as before (none over
 * HOUSE_UNITS beside a larger own house: plan_layout lays out one building over it a layout).
 */
export function pickHouses(v: Village, n: number, lib: Design[] | null, units?: (d: Design) => number, only?: Design[], wood?: string, own?: { owners: string[]; family?: string }): string[] {
  if (GEN_HOMES && own?.owners.length && n > 0) {
    const homes = ownHomes(own.owners.slice(0, n), own.family, { units });
    // (a home's name is its owner's and family's: drawn again, it replaces the one laid out before, never built)
    for (const d of homes) v.designs[d.name] = d;
    const big = !!units && homes.some((d) => units(d) > HOUSE_UNITS);
    const fill = n > homes.length ? pickHouses(v, n - homes.length, lib, units, only).filter((name) => !big || !units || units(v.designs[name]) <= HOUSE_UNITS) : [];
    const names = [...homes.map((d) => d.name), ...fill];
    if (!WOOD_VARIANTS || !wood) return names;
    return names.map((name) => {
      const vn = variantName(name, wood);
      if (!v.designs[vn] || isHomeName(name)) v.designs[vn] = woodVariant(v.designs[name], wood);
      return vn;
    });
  }
  const cands: Design[] = [];
  // (a design and its wood variants are one candidate: names without "@" are their own base)
  const add = (d: Design) => {
    if (!cands.some((c) => baseName(c.name) === baseName(d.name))) cands.push(d);
  };
  // (`only`: a voted style's houses and none else, whatever the plan: spec_vote1 2)
  if (only) for (const d of only) add(d);
  // (R1: a vanilla dwelling of any size is a home; larger ones may be up to 13 across and HOUSE_UNITS_LARGE)
  const vanillaHome = (d: Design) => (VANILLA_ALL ? VANILLA_PIECE.test(d.name) && isDwelling(d.name) : SMALL_VANILLA.test(baseName(d.name)));
  const roomy = VANILLA_ALL ? (d: Design) => VANILLA_PIECE.test(d.name) : () => false;
  if (lib && v.plan === 'street' && !only) for (const d of lib) if (vanillaHome(d) && (!VANILLA_ALL || (d.width <= 13 && d.depth <= 13))) add(d);
  const used = new Set((v.layouts ?? []).flatMap((l) => l.buildings));
  if (!only)
    for (const d of Object.values(v.designs))
      if (used.has(d.name) && isDwelling(d.name) && !isHomeName(baseName(d.name)) && d.width <= (roomy(d) ? 13 : 9) && d.depth <= (roomy(d) ? 13 : 9) && (!VANILLA_PIECE.test(d.name) || vanillaHome(d))
        && (!units || units(d) <= (roomy(d) ? HOUSE_UNITS_LARGE : HOUSE_UNITS))) add(d);
  if (!cands.length || n < 1) return [];
  // (R2: builds of a design's variants count as its own)
  const builds = (d: Design) => v.tasks.filter((t) => /^Build /.test(t.title) && (t.detail.startsWith(`build_design "${d.name}"`)
    || (WOOD_VARIANTS && (t.detail.startsWith(`build_design "${baseName(d.name)}"`) || t.detail.startsWith(`build_design "${baseName(d.name)}@`))))).length;
  const built = new Map(cands.map((d) => [d.name, builds(d)]));
  // (R1: which candidates are larger homes, by their bill when the world can say, else by name)
  const big = new Set(VANILLA_ALL ? cands.filter((d) => isLargeHome(d.name, units?.(d))).map((d) => d.name) : []);
  const out: string[] = [];
  let bigs = 0;
  for (let i = 0; i < n; i++) {
    const pool = bigs ? cands.filter((c) => !big.has(c.name)) : cands;
    if (!pool.length) break;
    const d = pool.reduce((b, c) => (built.get(c.name)! < built.get(b.name)! ? c : b));
    if (big.has(d.name)) bigs++;
    built.set(d.name, built.get(d.name)! + 1);
    out.push(d.name);
  }
  if (WOOD_VARIANTS && wood) {
    const named = out.map((name) => variantName(name, wood));
    for (const [i, name] of named.entries()) if (!v.designs[name]) v.designs[name] = woodVariant(cands.find((d) => d.name === out[i])!, wood);
    return named;
  }
  for (const name of new Set(out)) if (!v.designs[name]) v.designs[name] = structuredClone(cands.find((d) => d.name === name)!);
  return out;
}

// ---- R2 (#104, MC_WOOD_VARIANTS): a wood for each neighbourhood -------------------------------------------------------

/** Log blocks within reach by wood kind from the atlas's chunk summaries near home (mcAtlas's `near`: each chunk's `low`,
 *  logs within 5 blocks of the ground, else all its `logs`). Pure: the world passes the summaries. */
export function treesNear(chunks: Array<{ logs?: Record<string, number>; low?: Record<string, number> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of chunks) for (const [w, q] of Object.entries(c.low ?? c.logs ?? {})) out[w] = (out[w] ?? 0) + q;
  return out;
}

/** The woods the village's neighbourhoods are in (the first plot's, v.wood, then each growth layout's houses' variant). */
export function hoodWoods(v: Village): string[] {
  const out = v.wood ? [v.wood] : [];
  for (const l of v.layouts ?? []) {
    if (!l.grow) continue;
    const w = l.buildings.map(variantWood).find(Boolean);
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** The share more logs than a neighbourhood needs that must stand near home for its wood (plan_layout's rule for the
 *  village's first wood: acacia chosen from 42 logs for ~80 needed sent gatherers 80 blocks away). */
const HOOD_TREE_MARGIN = 1.5;

/**
 * The next neighbourhood's wood (R2): among VARIANT_WOODS with at least 1.5x `need` logs near home (`trees`, log blocks
 * by wood: treesNear), a wood no neighbourhood is in yet first (`used`: hoodWoods), then the most trees, then the list's
 * order. Null with MC_WOOD_VARIANTS off or no wood with trees enough: the village's own wood, as before.
 */
export function hoodWood(trees: Record<string, number>, need: number, used: string[]): string | null {
  if (!WOOD_VARIANTS) return null;
  const ok = VARIANT_WOODS.filter((w) => (trees[w] ?? 0) >= Math.max(1, need) * HOOD_TREE_MARGIN);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => Number(used.includes(a)) - Number(used.includes(b)) || (trees[b] ?? 0) - (trees[a] ?? 0) || VARIANT_WOODS.indexOf(a) - VARIANT_WOODS.indexOf(b))[0];
}

/** The wood of the neighbourhood whose plot holds x, z (a growth layout with variant houses), else undefined: a small work
 *  or lamp there is made in it (R2). */
export function hoodWoodAt(v: Village, x: number, z: number): string | undefined {
  for (const l of v.layouts ?? []) {
    if (!l.grow || x < l.x1 || x > l.x2 || z < l.z1 || z > l.z2) continue;
    const w = l.buildings.map(variantWood).find(Boolean);
    if (w) return w;
  }
  return undefined;
}

/**
 * The pad (D5): the smallest size from 17 to 29 where a plain cross-street plan places every house and leaves room for 2
 * lamps or more; else one house fewer (4 small houses need 23: at 19-21 they fit with no lamp cell, the scratch's count).
 * With `slots` 0 or more (s30's food step, D2): every house of `designs` with a wheat field and that many farm slots, by
 * postLayout's own order (the field on the pad, 2 lamps or more keeping off it, the slots off the field, each other and
 * the lamps: runs/2026-10-15/s30/scratch/food_pad.mts), sizes 17 to 33, no house fewer. With R1 (VANILLA_ALL) a batch
 * holding a house wider than 9 (a larger home, 11-13 across) may take a pad up to the ladder's 31.
 */
export function padFor(designs: Design[], slots = -1): { size: number; n: number } | null {
  const max = VANILLA_ALL && designs.some((d) => Math.max(d.width, d.depth) > 9) ? LADDER_MAX : 29;
  if (slots >= 0) {
    const n = designs.length;
    if (!n) return null;
    for (let size = 17; size <= 33; size++) if (fieldFits(designs, size, slots)) return { size, n };
    return null;
  }
  for (let n = designs.length; n >= 1; n--) {
    const items = designs.slice(0, n).map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...doorOf(d) }));
    for (let size = 17; size <= max; size++) {
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
export const GROW_FARMS = rawSetting('MC_GROW_FARMS') === '1';

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
