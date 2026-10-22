/**
 * Techniques: innovation (#73, #71, #78; specs runs/2026-10-21/s43/spec_innovation_v1.md and s44/spec_innovation_v2.md;
 * the user's choices 10-21): a library of locked techniques a village unlocks by members' research. An entry adds
 * workshop goods (made by recipe from the commons, as every good is) once unlocked. v2: every experiment adds research
 * points (more on a good roll, a little on a bad one; more for curious members, repeat contributors and entries the village
 * wants); the entry unlocks when its points reach its need, 10 x its complexity (the recipe chain's steps beyond the basics,
 * its raw inputs, a furnace, hard inputs). Prerequisites (other entries, tools the village has made) make a tree.
 * Candidates: entries whose requirements the village meets (the adjacent possible), ranked up by goods members asked for in
 * vain on the barter board, by gluts the entry would use, by pledges and by points already in it. An attempt's materials
 * come from the commons; members may pledge own goods to a candidate (adding points), paid to its researchers by share.
 * World-free; the world (mcWorld.ts) offers experiments and pledges, the experiment skill rolls, the simulator runs it.
 */
import { baseValue } from './barter';
import { ownOf } from './own';
import type { MaterialPlan } from './mineflayer/mcMaterials';
import type { MakeGood } from './mineflayer/mcWorkshop';
import type { Village } from './village';

type Counts = Record<string, number>;

/** On with MC_INNOVATE=on. */
export const INNOVATE = /^(on|1|true)$/i.test(process.env.MC_INNOVATE ?? 'off');

/**
 * An entry: the goods it adds, what the village must hold first, one attempt's materials (`success`: taken only when the
 * attempt goes well, iron), its time, its base chance; `after`: entries unlocked first; `tools`: items the village has
 * made (the iron chore's record). `uses`: the goods it turns into others (a glut of them raises it).
 */
export interface LibraryEntry { id: string; name: string; goods: MakeGood[]; requires: Counts; attempt: Counts; success?: Counts; minutes: number; chance: number; uses: string[];
  after?: string[]; tools?: string[];
  /** What members may make of it from their own stock once it is unlocked (own makes, MC_OWN). */
  own?: Array<{ item: string; inputs: Counts; smelt: boolean }>;
  /** G6: an entry from a library spec's `research` block (a foundry activity, locked until researched): the spec's id, its
   *  skill, the wanted list's capability it answers, what it gives, and its complexity (a skill's chain is no recipe). */
  activity?: string; skill?: string; capability?: string; gives?: string[]; complexity?: number }

/**
 * The entries: goods the recipe data can make from what villages hold, each a new sink or a new good. Shears open jack
 * o'lanterns (a pumpkin carved with shears, a `carve` good: no recipe in the data, the make carves by command).
 */
export const LIBRARY: LibraryEntry[] = [
  {
    id: 'hay', name: 'hay bales', requires: { wheat: 3 }, attempt: { wheat: 3 }, minutes: 2, chance: 0.35, uses: ['wheat'], own: [{ item: 'hay_block', inputs: { wheat: 9 }, smelt: false }],
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
    id: 'lantern', name: 'lanterns', requires: { torch: 4, raw_iron: 1 }, attempt: { torch: 2 }, success: { raw_iron: 1 }, minutes: 3, chance: 0.25, uses: ['torch'],
    goods: [{ item: 'lantern', target: 8, batch: 2, unit: 1, words: 'lanterns', forWhat: 'brighter lights than torches (an invention of the village)', allow: ['raw_iron'] }],
  },
  {
    id: 'armor_stand', name: 'armour stands', requires: { stone_slab: 1 }, attempt: { stick: 4 }, minutes: 2, chance: 0.4, uses: [],
    goods: [{ item: 'armor_stand', target: 2, batch: 1, unit: 1, words: 'armour stands', forWhat: 'a stand for a house\'s tools (an invention of the village)' }],
  },
  {
    id: 'shears', name: 'shears', requires: { raw_iron: 2 }, attempt: { stick: 2 }, success: { raw_iron: 1 }, minutes: 3, chance: 0.3, uses: [], tools: ['iron_pickaxe'],
    goods: [{ item: 'shears', target: 2, batch: 1, unit: 1, words: 'shears', forWhat: 'shears for carving pumpkins (an invention of the village)', allow: ['raw_iron', 'iron_ingot'] }],
  },
  {
    id: 'jack_o_lantern', name: "jack o'lanterns", requires: { pumpkin: 2, torch: 2, shears: 1 }, attempt: { pumpkin: 1, torch: 1 }, minutes: 2, chance: 0.35, uses: ['pumpkin'], after: ['shears'],
    goods: [
      { item: 'carved_pumpkin', target: 8, batch: 4, unit: 1, words: 'carved pumpkins', forWhat: "pumpkins carved for jack o'lanterns (an invention of the village)", carve: true, allow: ['pumpkin'] },
      { item: 'jack_o_lantern', target: 8, batch: 4, unit: 1, words: "jack o'lanterns", forWhat: 'lights carved from the village\'s pumpkins (an invention of the village)' },
    ],
  },
];

/** A library spec's `research` block (library.ts validates it): the entry it adds, locked until researched (G6). */
export interface Research { name: string; requires: Counts; attempt: Counts; success?: Counts; minutes: number; chance: number; complexity: number;
  after?: string[]; tools?: string[]; goods: MakeGood[]; capability?: string }

/**
 * G6: a library spec with a `research` block becomes an entry (a foundry activity merged locked, spec
 * runs/2026-10-21/g6-loop/spec.md 3), its id the spec's less "lib:": registered by loadLibrary (library.ts) for each valid
 * spec while MC_INNOVATE is on, so the validator is the one source of truth. A built-in entry's id wins; idempotent.
 */
export function registerResearch(s: { id: string; skill: string; gives: Array<{ item: string }>; research?: Research }): LibraryEntry | null {
  const r = s.research;
  if (!r) return null;
  const id = s.id.slice(4);
  const had = LIBRARY.find((x) => x.id === id);
  if (had) return had.activity === s.id ? had : null;
  const e: LibraryEntry = {
    id, name: r.name, goods: r.goods, requires: r.requires, attempt: r.attempt, ...(r.success ? { success: r.success } : {}), minutes: r.minutes, chance: r.chance, uses: [],
    ...(r.after?.length ? { after: r.after } : {}), ...(r.tools?.length ? { tools: r.tools } : {}),
    activity: s.id, skill: s.skill, ...(r.capability ? { capability: r.capability } : {}), gives: s.gives.map((g) => g.item), complexity: r.complexity,
  };
  LIBRARY.push(e);
  LOCKED_SKILLS.set(s.skill, e);
  return e;
}

/** The locked foundry activities: the entry each skill's activity waits on, by skill name (foundry/lock.ts gates them). */
export const LOCKED_SKILLS = new Map<string, LibraryEntry>();
/** G8: the foundry skills a ladder rung locks (a library spec's `rung`; registered by loadLibrary while MC_LADDER is on). */
export const RUNG_SKILLS = new Map<string, string>();

/**
 * The wanted list's top capabilities by village (wanted.ts, written by the API's writer with MC_WANTED on): a locked entry
 * answering one of them counts as demanded (the user's, 10-21). Kept here so tech.ts imports nothing of wanted.ts.
 */
export const WANTED_TOP = new Map<string, string[]>();

/** Inputs that take finding (iron, clay, leather, wool, string): +2 complexity each. */
export const HARD = /^(raw_iron|iron_ingot|clay_ball|leather|string|[a-z_]+_wool)$/;
/** The steps every village does already (its common knowledge): not counted in an entry's chain. */
export const BASIC = /^(stick|charcoal|torch|(any:)?[a-z_]*planks)$/;

/** Points are kept in tenths (integers: sums of rounded floats fell just under a need). */
export const TENTHS = 10;

/**
 * The village's techniques: unlocked entries, when and by whom; v1's failed tries by "entry|member" (they raise the next
 * chance) and attempts by "entry|member" (v2); points in tenths by entry and member (attempts only; pledges in
 * `pledgePts`); each entry's need (tenths, fixed at its first point); open pledges by entry; entries each member helped
 * unlock (`credit`).
 */
export interface Tech { unlocked: string[]; at: Record<string, number>; inventor: Record<string, string>; tries: Record<string, number>; pledges: Record<string, Array<{ by: string; item: string; n: number; pts?: number }>>; failed: Record<string, number>;
  attempts: Record<string, number>; points: Record<string, Record<string, number>>; pledgePts: Record<string, number>; need: Record<string, number>; credit: Record<string, string[]>;
  /** Each unlocked entry's holders of its royalty (s44, the user's): every point put in at the unlock, attempts' and
   *  pledges' (tenths, by member). */
  owners: Record<string, Record<string, number>> }

export function techOf(v: Village): Tech {
  const x = v as Village & { innovation?: Tech };
  // (MC_TECH_UNLOCKED=hay,campfire: entries a village starts with, for experiments)
  const t = (x.innovation ??= { unlocked: (process.env.MC_TECH_UNLOCKED ?? '').split(/[,;+]/).filter((id) => LIBRARY.some((e) => e.id === id)), at: {}, inventor: {}, tries: {}, pledges: {}, failed: {} } as Tech);
  // (v2's fields on a v1 record)
  t.attempts ??= {};
  t.points ??= {};
  t.pledgePts ??= {};
  t.need ??= {};
  t.credit ??= {};
  t.owners ??= {};
  return t;
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

const complexities = new Map<string, number>();

/**
 * An entry's complexity: its goods planned together from nothing (`plan`, the materials planner), the steps beyond the
 * basics (+1 a carve good), half a point a raw input (logs aside; a carve good's input in place of its item), +1 if a
 * step beyond the basics smelts, +2 a hard input. Pure recipe data: cached by entry.
 */
export function complexity(e: LibraryEntry, plan: (bill: Counts) => MaterialPlan): number {
  const c = complexities.get(e.id);
  if (c !== undefined) return c;
  if (e.complexity !== undefined) return e.complexity;
  const carved = e.goods.filter((g) => g.carve);
  const p = plan(Object.fromEntries(e.goods.filter((g) => !g.carve).map((g) => [g.item, 1])));
  const steps = p.steps.filter((s) => !BASIC.test(s.item) && !carved.some((g) => g.item === s.item)).length + carved.length;
  const raw = new Set(Object.keys(p.gather).filter((n) => !/logs$/.test(n) && !carved.some((g) => g.item === n)));
  for (const g of carved) raw.add(g.item === 'carved_pumpkin' ? 'pumpkin' : g.item);
  const hard = [...raw].filter((n) => HARD.test(n)).length;
  // (a smelt among the basics, the torch's charcoal, is common knowledge too)
  const out = steps + 0.5 * raw.size + (p.steps.some((x) => x.do === 'smelt' && !BASIC.test(x.item)) ? 1 : 0) + 2 * hard;
  complexities.set(e.id, out);
  return out;
}

/** The points an entry needs, in tenths: its recorded need (fixed at the first point), else 10 x its complexity. */
export function needOf(v: Village, e: LibraryEntry, plan: (bill: Counts) => MaterialPlan): number {
  return techOf(v).need[e.id] ?? Math.round(10 * complexity(e, plan) * TENTHS);
}

/** The points in an entry so far (tenths): its attempts' and its pledges'. */
export function pointsIn(v: Village, id: string): number {
  const t = techOf(v);
  return Object.values(t.points[id] ?? {}).reduce((s, q) => s + q, 0) + (t.pledgePts[id] ?? 0);
}

/** The demand boost on an attempt's points, from the candidate's rank (1 + wants + gluts + pledges): 1x to 2x. */
export const boostOf = (rank: number) => Math.round((1 + Math.min(1, Math.max(0, rank - 1) / 4)) * 100) / 100;

/**
 * One attempt's points, in tenths: 8 on success, 2 on failure; x (1 + 0.5 x curiosity), x (1 + 0.1 x the member's
 * earlier attempts at it, at most 1.5), x the demand boost.
 */
export function attemptPoints(ok: boolean, curiosity: number, earlier: number, boost: number): number {
  return Math.round((ok ? 8 : 2) * TENTHS * (1 + 0.5 * Math.max(-1, Math.min(1, curiosity))) * Math.min(1.5, 1 + 0.1 * earlier) * boost);
}

/** A settled attempt: whether the roll went well, the points it added, whether it unlocked the entry, and what each
 *  member receives (pledges by share; a pledge back to its pledger when nobody else researched it). */
export interface Settled { ok: boolean; chance: number; gained: number; unlocked: boolean; already?: boolean; total: number; need: number; shares: Record<string, Counts>; inventor?: string }

/**
 * An attempt settled (its materials already taken): success by `roll` < the member's chance; its points added; at the
 * need the entry unlocks (only here: a pledge never crosses it alone), the top researcher its inventor (ties: the
 * earliest), every researcher credited, the pledges split by share of attempt points (floored, the rest to the inventor;
 * a pledger gets no share of its own pledge, and has it back when no other researcher can hold it). Idempotent: an entry
 * already unlocked (by a fellow member while this attempt ran) settles nothing.
 */
export function settleAttempt(v: Village, e: LibraryEntry, member: string, roll: number, now: number, curiosity: number, boost: number, plan: (bill: Counts) => MaterialPlan, canHold: (m: string) => boolean = () => true): Settled {
  const t = techOf(v);
  const need = needOf(v, e, plan);
  const key = `${e.id}|${member}`;
  const chance = chanceFor(e, t.tries[key] ?? 0);
  if (t.unlocked.includes(e.id)) return { ok: false, chance, gained: 0, unlocked: false, already: true, total: pointsIn(v, e.id), need, shares: {} };
  const ok = roll < chance;
  if (!ok) t.tries[key] = (t.tries[key] ?? 0) + 1;
  const gained = attemptPoints(ok, curiosity, t.attempts[key] ?? 0, boost);
  t.attempts[key] = (t.attempts[key] ?? 0) + 1;
  t.need[e.id] = need;
  const pts = (t.points[e.id] ??= {});
  pts[member] = (pts[member] ?? 0) + gained;
  const total = pointsIn(v, e.id);
  if (total < need) return { ok, chance, gained, unlocked: false, total, need, shares: {} };
  t.unlocked.push(e.id);
  t.at[e.id] = now;
  // (insertion order is the order members first put points in: the earliest wins a tie)
  const ranked = Object.entries(pts).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const inventor = ranked[0][0];
  t.inventor[e.id] = inventor;
  for (const [m] of ranked) if (!(t.credit[m] ??= []).includes(e.id)) t.credit[m].push(e.id);
  // (the royalty's holders: researchers by attempt points, pledgers by their pledges' points)
  const owners: Record<string, number> = {};
  for (const [m, q] of ranked) owners[m] = q;
  for (const p of t.pledges[e.id] ?? []) if (p.pts) owners[p.by] = (owners[p.by] ?? 0) + p.pts;
  t.owners[e.id] = owners;
  const shares: Record<string, Counts> = {};
  const give = (m: string, item: string, n: number) => {
    if (n <= 0) return;
    const s = (shares[m] ??= {});
    s[item] = (s[item] ?? 0) + n;
  };
  for (const p of t.pledges[e.id] ?? []) {
    // (to researchers who can hold goods, an own chest: a share for one without would be lost)
    const others = ranked.filter(([m]) => m !== p.by && canHold(m));
    if (!others.length) {
      give(p.by, p.item, p.n);
      continue;
    }
    const sum = others.reduce((s, [, q]) => s + q, 0);
    let left = p.n;
    for (const [m, q] of others) {
      const n = Math.floor((p.n * q) / sum);
      give(m, p.item, n);
      left -= n;
    }
    give(others[0][0], p.item, left);
  }
  delete t.pledges[e.id];
  return { ok, chance, gained, unlocked: true, total, need, shares, inventor };
}

/**
 * A pledge's points (tenths): the goods' code value (no board factor), each pledge at most a quarter of the need and the
 * entry's pledges at most half; recorded with the pledge. Null for an entry already unlocked or its pledges full (the
 * pledge refused, the goods left alone).
 */
export function addPledge(v: Village, e: LibraryEntry, by: string, item: string, n: number, plan: (bill: Counts) => MaterialPlan): number | null {
  const t = techOf(v);
  if (t.unlocked.includes(e.id)) return null;
  const need = needOf(v, e, plan);
  t.need[e.id] = need;
  const room = Math.max(0, Math.floor(need / 2) - (t.pledgePts[e.id] ?? 0));
  const pts = Math.min(room, Math.floor(need / 4), Math.round(baseValue(item) * n * TENTHS));
  if (pts <= 0) return null;
  t.pledgePts[e.id] = (t.pledgePts[e.id] ?? 0) + pts;
  (t.pledges[e.id] ??= []).push({ by, item, n, pts });
  return pts;
}

/** A candidate: an entry the village could try now, its rank and why (the facts' words); `demand` some want, glut or
 *  pledge (before the started bonus); `started` points already in it; `boost` its attempts' points multiplier. */
export interface Candidate { e: LibraryEntry; rank: number; why: string[]; demand: boolean; started: boolean; boost: number }

/**
 * The candidates (pure): entries not unlocked whose prerequisites are met (`after` unlocked, `tools` in `made`: the iron
 * chore's record, plus MC_TECH_MADE for experiments), whose requirements the commons holds and whose attempt it can pay;
 * ranked 1 + its goods' unmet wants (asked in lapsed offers) + gluts (a used good held idle above 64, in the commons or
 * members' chests) / 64 + pledges; `demand`: rank above 1 (necessity, the user's 10-21 frame); entries with points in them
 * rank 2 higher (finish what was started); the best 3. The world offers the started and wanted ones to everyone, the rest
 * to curious members only (the user's, 10-21).
 */
export function candidates(v: Village, store: Counts, wants: Counts, held: Counts, now: number, made: string[] = []): Candidate[] {
  const t = techOf(v);
  const tools = new Set([...made, ...(process.env.MC_TECH_MADE ?? '').split(/[,;+]/).filter(Boolean)]);
  const out: Candidate[] = [];
  void now;
  for (const e of LIBRARY) {
    if (t.unlocked.includes(e.id)) continue;
    if ((e.after ?? []).some((id) => !t.unlocked.includes(id)) || (e.tools ?? []).some((n) => !tools.has(n))) continue;
    if (Object.entries(e.requires).some(([n, q]) => (store[n] ?? 0) < q) || Object.entries(e.attempt).some(([n, q]) => (store[n] ?? 0) < q)) continue;
    const why: string[] = [];
    let rank = 1;
    // (wants for what it makes; gluts of what it uses: wanting wheat is no reason for hay bales, which take it)
    // (a foundry activity's gives count as its goods; G6)
    for (const g of [...new Set([...e.goods.map((x) => x.item), ...(e.gives ?? [])])]) {
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
    // (G6, MC_WANTED: the capability it answers is among the village's most wanted)
    if (e.capability && (WANTED_TOP.get(v.name) ?? []).includes(e.capability)) {
      rank += 3;
      why.push(`${e.capability.replace(/_/g, ' ')} is among the village's most wanted capabilities`);
    }
    const pledged = (t.pledges[e.id] ?? []).length;
    if (pledged) {
      rank += pledged;
      why.push(`${pledged} pledge${pledged === 1 ? '' : 's'}`);
    }
    const demand = rank > 1, boost = boostOf(rank);
    const started = pointsIn(v, e.id) > 0;
    out.push({ e, rank: rank + (started ? 2 : 0), why, demand, started, boost });
  }
  return out.sort((x, y) => y.rank - x.rank).slice(0, 3);
}

/** Points as the menus say them (tenths to a whole number). */
export const ptsText = (tenths: number) => `${Math.round(tenths / TENTHS)}`;

/**
 * The goods a royalty is paid on: an entry's final goods, not one a sibling good is made from (sugar for pies, carved
 * pumpkins: paid twice along the chain, and owed intermediates carried out of the commons before the final make), nor one
 * an entry requires (shears: carried home, they would stop the carving).
 */
export const royaltyGood = (item: string) => {
  if (LIBRARY.some((e) => e.requires[item] !== undefined)) return false;
  const e = LIBRARY.find((x) => x.goods.some((g) => g.item === item));
  return !!e && !e.goods.some((g) => g.item !== item && ((g.allow ?? []).includes(item) || (item === 'carved_pumpkin' && g.item === 'jack_o_lantern')));
};

/** The inventors' royalty (s44, the user's): this share of every batch the workshop makes of an unlocked entry's goods. */
export const ROYALTY = Math.min(1, Math.max(0, Number(process.env.MC_TECH_ROYALTY ?? 0.1)));

/**
 * The royalty on goods the workshop put into the commons (`made`, by item): for each final good of an unlocked entry, ROYALTY of
 * it split among the entry's holders by their points (attempts' and pledges'), owed to each holder with a house of its own
 * (`housed`) as own stock's shares are: whole items owed, fractions kept in its `part`; carried home by carry_home. A
 * holder without a house earns nothing. Returns what was added in whole items, by member.
 */
export function payRoyalties(v: Village, made: Counts, housed: (m: string) => boolean): Record<string, Counts> {
  const t = techOf(v);
  const out: Record<string, Counts> = {};
  for (const [item, n] of Object.entries(made)) {
    if (n <= 0) continue;
    if (!royaltyGood(item)) continue;
    const e = LIBRARY.find((x) => t.unlocked.includes(x.id) && x.goods.some((g) => g.item === item));
    const owners = e ? t.owners[e.id] : undefined;
    if (!owners) continue;
    const sum = Object.values(owners).reduce((s, q) => s + q, 0);
    if (sum <= 0) continue;
    for (const [m, q] of Object.entries(owners)) {
      if (!housed(m)) continue;
      const own = ownOf(v, m);
      const part = (own.part ??= {});
      const x = (part[item] ?? 0) + (n * ROYALTY * q) / sum;
      const whole = Math.floor(x + 1e-9);
      part[item] = Math.round((x - whole) * 1000) / 1000;
      if (!part[item]) delete part[item];
      if (whole > 0) {
        own.owed[item] = (own.owed[item] ?? 0) + whole;
        (out[m] ??= {})[item] = whole;
      }
    }
  }
  return out;
}
