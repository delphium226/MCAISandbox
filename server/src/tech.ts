/**
 * Techniques: innovation v1 (#73, #71; spec runs/2026-10-21/s43/spec_innovation_v1.md; the user's choices 10-21): a library of
 * locked techniques a village unlocks by members' experiments. An entry adds workshop goods (made by recipe from the
 * commons, as every good is) once unlocked. Candidates: entries whose requirements the village meets (the adjacent
 * possible), ranked up by goods members asked for in vain on the barter board and by gluts the entry would use. An
 * attempt's materials come from the commons; members may pledge own goods to a candidate, paid to its inventor.
 * World-free; the world (mcWorld.ts) offers experiments and pledges, the experiment skill rolls, the simulator runs it.
 */
import type { MakeGood } from './mineflayer/mcWorkshop';
import type { Village } from './village';

type Counts = Record<string, number>;

/** On with MC_INNOVATE=on. */
export const INNOVATE = /^(on|1|true)$/i.test(process.env.MC_INNOVATE ?? 'off');

/** An entry: the goods it adds, what the village must hold first, one attempt's materials and time, its base chance. */
export interface LibraryEntry { id: string; name: string; goods: MakeGood[]; requires: Counts; attempt: Counts; minutes: number; chance: number; uses: string[];
  /** What members may make of it from their own stock once it is unlocked (own makes, MC_OWN). */
  own?: Array<{ item: string; inputs: Counts; smelt: boolean }> }

/**
 * v1's entries: goods the recipe data can make from what villages hold, each a new sink or a new good. `uses`: the goods
 * it turns into others (a glut of them raises it), beside its goods' own inputs.
 */
export const LIBRARY: LibraryEntry[] = [
  {
    id: 'hay', name: 'hay bales', requires: { wheat: 9 }, attempt: { wheat: 3 }, minutes: 2, chance: 0.35, uses: ['wheat'], own: [{ item: 'hay_block', inputs: { wheat: 9 }, smelt: false }],
    goods: [{ item: 'hay_block', target: 8, batch: 1, unit: 1, words: 'hay bales', forWhat: 'wheat kept dry in bales (an invention of the village)', allow: ['wheat'] }],
  },
  {
    id: 'pies', name: 'pumpkin pies for everyone', requires: { pumpkin: 2, egg: 1, sugar_cane: 1 }, attempt: { pumpkin: 2, egg: 1 }, minutes: 3, chance: 0.3, uses: ['pumpkin', 'egg', 'sugar_cane'],
    goods: [
      { item: 'sugar', target: 8, batch: 4, unit: 1, words: 'sugar', forWhat: 'sugar for pies (an invention of the village)', food: true, allow: ['sugar_cane'] },
      { item: 'pumpkin_pie', target: 8, batch: 2, unit: 1, words: 'pumpkin pies', forWhat: 'pies from the village\'s pumpkins (an invention of the village)', food: true, allow: ['pumpkin', 'sugar', 'sugar_cane', 'egg'] },
    ],
  },
  {
    id: 'lantern', name: 'lanterns', requires: { torch: 4, raw_iron: 1 }, attempt: { torch: 2, raw_iron: 1 }, minutes: 3, chance: 0.25, uses: ['torch'],
    goods: [{ item: 'lantern', target: 8, batch: 2, unit: 1, words: 'lanterns', forWhat: 'brighter lights than torches (an invention of the village)', allow: ['raw_iron'] }],
  },
  {
    id: 'armor_stand', name: 'armour stands', requires: { stone_slab: 1 }, attempt: { stick: 4 }, minutes: 2, chance: 0.4, uses: [],
    goods: [{ item: 'armor_stand', target: 2, batch: 1, unit: 1, words: 'armour stands', forWhat: 'a stand for a house\'s tools (an invention of the village)' }],
  },
];

/** The village's techniques: unlocked entries, when and by whom, attempts by "entry|member", open pledges by entry. */
export interface Tech { unlocked: string[]; at: Record<string, number>; inventor: Record<string, string>; tries: Record<string, number>; pledges: Record<string, Array<{ by: string; item: string; n: number }>>; failed: Record<string, number> }

export function techOf(v: Village): Tech {
  const x = v as Village & { innovation?: Tech };
  // (MC_TECH_UNLOCKED=hay,campfire: entries a village starts with, for experiments)
  return (x.innovation ??= { unlocked: (process.env.MC_TECH_UNLOCKED ?? '').split(/[,;+]/).filter((id) => LIBRARY.some((e) => e.id === id)), at: {}, inventor: {}, tries: {}, pledges: {}, failed: {} });
}

/** The goods unlocked entries add (in the library's order). */
export function techGoods(v: Village): MakeGood[] {
  const t = techOf(v);
  return LIBRARY.filter((e) => t.unlocked.includes(e.id)).flatMap((e) => e.goods);
}

/** The own makes unlocked entries add (hay bales from a member's own wheat). */
export function techOwnRecipes(v: Village): Array<{ item: string; inputs: Counts; smelt: boolean }> {
  const t = techOf(v);
  return LIBRARY.filter((e) => t.unlocked.includes(e.id)).flatMap((e) => e.own ?? []);
}

/** A failed attempt raises that member's next chance at it (learning by trying): +0.1 a failure, at most 0.9. */
export const chanceFor = (e: LibraryEntry, tries: number) => Math.min(0.9, e.chance + 0.1 * tries);

/**
 * An attempt settled (the materials already taken): success by `roll` < the member's chance; a success unlocks the entry,
 * records its inventor and pays its pledges (returned, for the caller to put in the inventor's own chest); three failures
 * in a row by anyone rest the entry 20 minutes.
 */
export function settleAttempt(v: Village, e: LibraryEntry, member: string, roll: number, now: number): { ok: boolean; chance: number; pledges: Counts } {
  const t = techOf(v);
  const key = `${e.id}|${member}`, run = `${e.id}|*`;
  const chance = chanceFor(e, t.tries[key] ?? 0);
  if (roll >= chance) {
    t.tries[key] = (t.tries[key] ?? 0) + 1;
    t.tries[run] = (t.tries[run] ?? 0) + 1;
    if (t.tries[run] >= 3) {
      t.failed[e.id] = now + 20 * 60000;
      t.tries[run] = 0;
    }
    return { ok: false, chance, pledges: {} };
  }
  t.unlocked.push(e.id);
  t.at[e.id] = now;
  t.inventor[e.id] = member;
  const pledges: Counts = {};
  for (const p of t.pledges[e.id] ?? []) pledges[p.item] = (pledges[p.item] ?? 0) + p.n;
  delete t.pledges[e.id];
  return { ok: true, chance, pledges };
}

/** A candidate: an entry the village could try now, its rank and why (the facts' words). */
export interface Candidate { e: LibraryEntry; rank: number; why: string[]; demand: boolean }

/**
 * The candidates (pure): entries not unlocked whose requirements the commons holds and whose attempt it can pay, not
 * resting (3 failures rest an entry 20 minutes); ranked 1 + its goods' and uses' unmet wants (asked in lapsed offers) +
 * gluts (a used good held idle above 64, in the commons or members' chests) / 64 + pledges; the best 3. `demand`: rank above
 * 1 (some want, glut or pledge: necessity, the user's 10-21 frame); the world offers the rest to curious members only.
 */
export function candidates(v: Village, store: Counts, wants: Counts, held: Counts, now: number): Candidate[] {
  const t = techOf(v);
  const out: Candidate[] = [];
  for (const e of LIBRARY) {
    if (t.unlocked.includes(e.id) || (t.failed[e.id] ?? 0) > now) continue;
    if (Object.entries(e.requires).some(([n, q]) => (store[n] ?? 0) < q) || Object.entries(e.attempt).some(([n, q]) => (store[n] ?? 0) < q)) continue;
    const why: string[] = [];
    let rank = 1;
    // (wants for what it makes; gluts of what it uses: wanting wheat is no reason for hay bales, which take it)
    for (const g of e.goods.map((x) => x.item)) {
      if (wants[g]) {
        rank += wants[g];
        why.push(`${g.replace(/_/g, ' ')} wanted ${wants[g]} time${wants[g] === 1 ? '' : 's'}`);
      }
    }
    for (const u of e.uses) {
      const idle = (store[u] ?? 0) + (held[u] ?? 0);
      if (idle > 64) {
        rank += idle / 64;
        why.push(`${idle} ${u.replace(/_/g, ' ')} lying idle`);
      }
    }
    const pledged = (t.pledges[e.id] ?? []).length;
    if (pledged) {
      rank += pledged;
      why.push(`${pledged} pledge${pledged === 1 ? '' : 's'}`);
    }
    out.push({ e, rank, why, demand: rank > 1 });
  }
  return out.sort((x, y) => y.rank - x.rank).slice(0, 3);
}
