/**
 * The monument's dyes (#162, tier 2's chain B; MC_DYE_BED, off; runs/2026-10-26/tier2/spec.md): which window colours a
 * village can make, and the dye bed that keeps them coming. World-free: the colours from the dye recipes (the registry's,
 * mixes included) over the sources the village has; the census kinds and reach the colours are counted with; the dye
 * bed's cells and its record; the composter's chances. mcDyeBed.ts builds, tends and composts.
 *
 * Measured (spec section 1): near the iron_age_g1 village the flowers within 80 of the hut are wildflowers and a few
 * lilies, but within 144 stand 70 rose bushes, 66 peonies and 52 lilacs: tall flowers, which give 2 dyes each and drop a
 * copy whenever bone meal is used on them. Today's census (#140's, BED_FLOWERS within 80) misses them, so M2's glass found
 * no red. The dye census counts tall flowers too, out to DYE_REACH.
 *
 * With the bed, the monument's plan asks for the dyes themselves (Materials' `dyes`: every dye gathered), and the dyer
 * makes them: from storage's flowers, lapis and bone meal, from the bed's copies, and by mixing at the table.
 */
import { rawSetting } from './settings';
import type { Area } from './village';

/** MC_DYE_BED=on (#162, off; with MC_MONUMENT_DETAIL): the dye census, the dye bed and the dyer's chores. */
export const DYE_BED = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_DYE_BED') ?? 'off'),
};

/** Tall flowers: two blocks high, 2 dyes each, a copy dropped for each bone meal used on one (the classic dye farm). */
export const TALL_FLOWERS = ['rose_bush', 'peony', 'lilac', 'sunflower'];
/** The flowers that make a dye and grow wild (the one-block ones bed flowers use, and the tall ones). */
export const DYE_FLOWERS = ['wildflowers', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'pink_petals', 'torchflower', ...TALL_FLOWERS];
/** The dye census' reach round the storage hut (the bed flowers' is 80; the tall flowers near G1 stand out to ~140). */
export const DYE_REACH = 144;
/** A flower counts as a source when at least this many grow (a tall one: one is enough, the bed copies it). */
export const DYE_MIN = 6;

/** The composter's chance a level for what the village grows (the game's ComposterBlock table; 7 levels a bone meal). */
export const COMPOST_CHANCE: Record<string, number> = {
  wheat_seeds: 0.3, beetroot_seeds: 0.3, melon_seeds: 0.3, pumpkin_seeds: 0.3, short_grass: 0.3,
  wheat: 0.65, beetroot: 0.65, carrot: 0.65, potato: 0.65, ...Object.fromEntries(DYE_FLOWERS.map((f) => [f, 0.65])),
  // (train 7's stall: no seeds to spare, but 188 wildflowers and 28 saplings in storage; the game's table again)
  ...Object.fromEntries(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak'].map((w) => [`${w}_sapling`, 0.3])),
  mangrove_propagule: 0.3, lily_pad: 0.65,
};
/** Levels a bone meal takes. */
export const COMPOST_LEVELS = 7;

/** The registry's recipes as this reads them (minecraft-data's: ingredient ids, shapes, results). */
interface Registry {
  itemsByName: Record<string, { id: number } | undefined>;
  items: Record<number, { name: string } | undefined>;
  recipes: unknown;
}
type RawRecipe = { ingredients?: unknown[]; inShape?: unknown[][]; result?: { count?: number } };
/** Every dye's recipes as lists of item names (flowers, lapis, bone meal, mixes of dyes), and green from cactus (smelted).
 *  `dyeYields` gives the same recipes with what each makes. */
export function dyeRecipes(reg: Registry): Record<string, string[][]> {
  return Object.fromEntries(Object.entries(dyeYields(reg)).map(([d, rs]) => [d, rs.map((r) => r.ins)]));
}
export function dyeYields(reg: Registry): Record<string, Array<{ ins: string[]; out: number }>> {
  const out: Record<string, Array<{ ins: string[]; out: number }>> = {};
  for (const name of Object.keys(reg.itemsByName).filter((n) => /_dye$/.test(n))) {
    const id = reg.itemsByName[name]!.id;
    const rs = ((reg.recipes as Record<number, RawRecipe[] | undefined>)[id] ?? []);
    out[name] = rs.map((r) => ({
      ins: (r.ingredients ?? r.inShape?.flat() ?? [])
        .map((i) => (i && typeof i === 'object' ? (i as { id?: number }).id : i))
        .filter((i): i is number => typeof i === 'number' && i >= 0)
        .map((i) => reg.items[i]?.name ?? '?'),
      out: r.result?.count ?? 1,
    }));
  }
  (out.green_dye ??= []).push({ ins: ['cactus'], out: 1 });
  return out;
}

/**
 * How to make n of a dye from what is to be had (the dyer's plan; Materials prices a dye by gathering cost and would pick
 * blue orchids that do not grow here over lapis and bone meal held): each dye from the recipe whose items are all to be
 * had, preferring one ingredient held (a flower, lapis, bone meal), then one the bed or composter renews, then a mix of
 * dyes themselves to be had; dyes held are used first. Returns the base items it takes and the crafts in order
 * (ingredients first), or null when the dye cannot be made.
 */
export function dyeSteps(yields: Record<string, Array<{ ins: string[]; out: number }>>, dye: string, n: number, held: Record<string, number>, renewable: Set<string>):
  { takes: Record<string, number>; crafts: Array<{ item: string; runs: number; makes: number }> } | null {
  const pool = { ...held };
  const takes: Record<string, number> = {};
  const crafts: Array<{ item: string; runs: number; makes: number }> = [];
  const can = new Set(makeableColours(Object.fromEntries(Object.entries(yields).map(([d, rs]) => [d, rs.map((r) => r.ins)])),
    { census: {}, stores: Object.fromEntries([...Object.keys(held).filter((k) => held[k] > 0), ...renewable].map((k) => [k, 1])), composter: false, merchant: false }).map((c) => `${c}_dye`));
  const ok = (i: string) => (pool[i] ?? 0) > 0 || renewable.has(i) || can.has(i);
  const rank = (r: { ins: string[] }) => (r.ins.length === 1 && (pool[r.ins[0]] ?? 0) > 0 ? 0 : r.ins.length === 1 && renewable.has(r.ins[0]) ? 1 : r.ins.length === 1 ? 3 : 2);
  const get = (item: string, q: number, depth: number): boolean => {
    const t = Math.min(q, pool[item] ?? 0);
    if (t > 0) { pool[item] -= t; takes[item] = (takes[item] ?? 0) + t; q -= t; }
    if (q <= 0) return true;
    if (!/_dye$/.test(item)) {
      if (!renewable.has(item)) return false;
      takes[item] = (takes[item] ?? 0) + q;
      return true;
    }
    if (depth > 4) return false;
    const r = (yields[item] ?? []).filter((x) => x.ins.length && x.ins.every(ok)).sort((x, y) => rank(x) - rank(y) || y.out - x.out)[0];
    if (!r) return false;
    const runs = Math.ceil(q / r.out);
    const per: Record<string, number> = {};
    for (const i of r.ins) per[i] = (per[i] ?? 0) + 1;
    for (const [i, k] of Object.entries(per)) if (!get(i, k * runs, depth + 1)) return false;
    crafts.push({ item, runs, makes: runs * r.out });
    if (runs * r.out > q) pool[item] = (pool[item] ?? 0) + runs * r.out - q;
    return true;
  };
  return get(dye, n, 0) ? { takes, crafts } : null;
}

/** What the village has to make dyes from: the census' flowers (counted near), what storage holds, and what the bed,
 *  the composter and the merchant give. */
export interface DyeSources {
  census: Record<string, number>;
  stores: Record<string, number>;
  /** Bone meal from the composter (the dye bed is on), ink sacs from the merchant (it is on). */
  composter: boolean;
  merchant: boolean;
}
/** The base items on hand or to be had. */
export function baseItems(s: DyeSources): Set<string> {
  const have = new Set<string>();
  for (const [n, q] of Object.entries(s.census)) if (q >= (TALL_FLOWERS.includes(n) && s.composter ? 1 : DYE_MIN)) have.add(n);
  for (const [n, q] of Object.entries(s.stores)) if (q > 0) have.add(n);
  if (s.composter) have.add('bone_meal');
  if (s.merchant) have.add('ink_sac');
  return have;
}

/** The dye colours the village can make: every dye whose recipe's items it has, mixes of those grown until none is
 *  added (orange from red and yellow, light grey from black and white...). */
export function makeableColours(recipes: Record<string, string[][]>, s: DyeSources): string[] {
  const have = baseItems(s);
  for (let grew = true; grew;) {
    grew = false;
    for (const [dye, rs] of Object.entries(recipes))
      if (!have.has(dye) && rs.some((r) => r.length && r.every((i) => have.has(i)))) { have.add(dye); grew = true; }
  }
  return Object.keys(recipes).filter((d) => have.has(d)).map((d) => d.replace(/_dye$/, ''));
}

/** The cathedral's window colours (the detail palette's cycle, gothicGen DETAIL_COLOURS' order) that the village can make;
 *  the rest stay plain glass until a source turns up (the refit, spec section 4). */
export function windowColours(order: string[], makeable: string[]): string[] {
  const can = new Set(makeable);
  return order.filter((c) => can.has(c));
}

/** The dye bed: a strip of grass with tall flowers in a row (a walk on each side) and a composter at its end. */
export interface DyeBed extends Area {
  y: number;
  state: 'building' | 'ready';
  /** The flowers' cells (their lower half) and kinds. */
  cells: Array<{ x: number; z: number; kind: string }>;
  composter: { x: number; y: number; z: number };
  /** The composter's level (0-7) as the ledger keeps it: compost goes in by command, its chance by code. */
  level: number;
  by: string;
  at: number;
  /** Copies taken, bone meal made, tends and composts. */
  made: Record<string, number>;
  tends: number;
  structure?: string;
}

/** Flowers on a bed (one a kind at least, up to `n` in all, the kinds the census counted most first). */
export function bedKinds(census: Record<string, number>, n = 6): string[] {
  const kinds = TALL_FLOWERS.filter((k) => (census[k] ?? 0) > 0).sort((a, b) => (census[b] ?? 0) - (census[a] ?? 0));
  if (!kinds.length) return [];
  return Array.from({ length: n }, (_, i) => kinds[i % kinds.length]);
}

/** The bed's strip for n flowers: a row of n with a walk each side, and the composter's cell at the row's end. */
export const bedStrip = (n: number) => ({ w: n + 2, d: 3 });
/** A new bed on a strip prepared at level y (the flowers stand on its grass at y + 1). */
export function newBed(area: Area, y: number, kinds: string[], by: string, now: number): DyeBed {
  return {
    ...area, y, state: 'building', by, at: now, level: 0, made: {}, tends: 0,
    cells: kinds.map((kind, i) => ({ x: area.x1 + 1 + i, z: area.z1 + 1, kind })),
    composter: { x: area.x1 + 1 + kinds.length, y: y + 1, z: area.z1 + 1 },
  };
}

/** Items composted: each raises the level with its chance (`roll` gives 0-1); a full composter gives a bone meal and
 *  empties. Returns the bone meal made and how many of each item went in (it stops when `items` run out). */
export function compost(bed: Pick<DyeBed, 'level'>, items: Record<string, number>, roll: () => number = Math.random): { boneMeal: number; used: Record<string, number> } {
  let boneMeal = 0;
  const used: Record<string, number> = {};
  for (const [n, q] of Object.entries(items)) {
    const chance = COMPOST_CHANCE[n];
    if (!chance) continue;
    for (let i = 0; i < q; i++) {
      used[n] = (used[n] ?? 0) + 1;
      if (roll() < chance) bed.level++;
      if (bed.level >= COMPOST_LEVELS) { bed.level = 0; boneMeal++; }
    }
  }
  return { boneMeal, used };
}

/** What a flower or sapling keeps in storage before the composter takes the rest (a dye's own flowers, replanting). */
export const COMPOST_KEEP = { flower: 32, sapling: 8 };
/** What storage can spare for compost: seeds past a keep for sowing, wheat past the food's (24, 64), flowers past
 *  COMPOST_KEEP's (their dyes come first: the dyer takes what it needs before composting), saplings past theirs; the
 *  bed's tall flowers never (it copies them). */
export function compostable(stock: Record<string, number>, keep: Record<string, number> = { wheat_seeds: 24, wheat: 64 }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of Object.keys(COMPOST_CHANCE)) {
    if (TALL_FLOWERS.includes(n)) continue;
    const k = keep[n] ?? (DYE_FLOWERS.includes(n) ? COMPOST_KEEP.flower : /_sapling$|_propagule$/.test(n) ? COMPOST_KEEP.sapling : 0);
    const q = (stock[n] ?? 0) - k;
    if (q > 0) out[n] = q;
  }
  return out;
}

/** The record's line for logs. */
export function bedLine(b: DyeBed): string {
  const made = Object.entries(b.made).map(([n, q]) => `${q} ${n}`).join(', ') || 'nothing yet';
  return `dye bed of ${b.cells.length} (${[...new Set(b.cells.map((c) => c.kind))].join(', ')}) at ${b.x1},${b.z1} ${b.state}: composter ${b.level}/7, ${b.tends} tends; made ${made}`;
}
