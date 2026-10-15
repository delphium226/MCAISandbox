/**
 * A village that grows (s30, the user's): once complete, code lays out more houses toward one a member, a neighbourhood at
 * a time (a small cross-street pad of up to four houses, its own plot off the village's ground within 96 blocks, with lamps
 * and signs), built by the same economy while the village stays complete. Growth tasks are those whose ids come from the
 * neighbourhood's first on (ids are registry-wide and rising), so the claim gates need no new field. No model call decides
 * any of it. World-independent: the world's tick decides (MineflayerWorld.growTick), a chore lays out (lay_out_houses).
 */
import { HOUSE_UNITS } from './designs';
import { MINING_HUT, STORAGE_HUT } from './huts';
import { doorOf, placeLamps, planStreets } from './streetPlan';
import type { Design, Task, Village } from './village';

/** On unless MC_GROW=0 (Q1: off until the staged runs passed; G3 and G25 did, 10-15); batch and range (D4, D6). */
export const GROW = { on: process.env.MC_GROW !== '0', batch: Number(process.env.MC_GROW_BATCH) || 4, range: Number(process.env.MC_GROW_RANGE) || 80 };

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
export function pickHouses(v: Village, n: number, lib: Design[] | null, units?: (d: Design) => number): string[] {
  const cands: Design[] = [];
  const add = (d: Design) => {
    if (!cands.some((c) => c.name === d.name)) cands.push(d);
  };
  if (lib && v.plan === 'street') for (const d of lib) if (SMALL_VANILLA.test(d.name)) add(d);
  const used = new Set((v.layouts ?? []).flatMap((l) => l.buildings));
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
 */
export function padFor(designs: Design[]): { size: number; n: number } | null {
  for (let n = designs.length; n >= 1; n--) {
    const items = designs.slice(0, n).map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...doorOf(d) }));
    for (let size = 17; size <= 29; size++) {
      const s = planStreets(0, 0, size, null, items);
      if (!s.unplaced.length && placeLamps(s).length >= 2) return { size, n };
    }
  }
  return null;
}
