/**
 * A village appetite (s30, the user's: "agents get hungry and eat", on peaceful, where vanilla hunger never drains): each
 * member of a complete village with a planted wheat field has an appetite of 20 points, drained by code in game time (18 a
 * busy game-hour, a quarter of that idle; MC_APPETITE), and eaten back from the village storage by an `eat_meal` chore.
 * Peckish (12 or less) members eat before they take new work; hungry ones (6 or less) take only food work. Nothing is
 * slowed and nothing damages. World-independent: the world drains and runs the chore (mcWorld.ts appetiteTick, mcBuild.ts
 * eat_meal); the record lives on the village (v.food, lesson 103). Spec runs/2026-10-15/s30/spec_food.md D6-D11.
 */
import type { ChoiceKind } from './world';
import type { Village } from './village';

type Counts = Record<string, number>;

/** MC_APPETITE: unset, 0 or off: no appetite; 1 or on: 18 points a busy game-hour; any other number: that rate. */
function rateOf(raw: string | undefined): number {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s || s === '0' || s === 'off' || s === 'false') return 0;
  if (s === '1' || s === 'on' || s === 'true') return 18;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The appetite's numbers (D7-D9, D14): the busy rate (0: off), the idle share, a new member's level, the bar, the eat and
 *  hungry levels, and how many may eat at once (25 withdrawers at once would crowd the hut's chest spots). */
export const APPETITE = {
  rate: rateOf(process.env.MC_APPETITE),
  idle: Number(process.env.MC_APPETITE_IDLE ?? 0.25) || 0,
  start: Math.max(0, Math.min(20, Number(process.env.MC_APPETITE_START ?? 20) || 0)),
  cap: 20,
  eatAt: 12,
  hungryAt: 6,
  eaters: 4,
};

/** Food points (D10): minecraft-data's foods, and the cake (a block: 7 slices of 2). Eggs, milk, sugar and pumpkins are
 *  ingredients, not food. */
export const FOOD_POINTS: Record<string, number> = {
  bread: 5, pumpkin_pie: 8, melon_slice: 2, carrot: 3, baked_potato: 5, potato: 1, apple: 4, cookie: 2, beetroot: 1,
  mushroom_stew: 6, beetroot_soup: 6, rabbit_stew: 10, sweet_berries: 2, glow_berries: 2, golden_carrot: 6, cake: 14,
};

/** Planting stock a meal never takes (D9: the slots' carrots, potatoes and beetroots, 8 of each kept). */
const KEEP: Record<string, number> = { carrot: 8, potato: 8, beetroot: 8 };

/** A meal's preference on equal overflow: bread, pie, melon slices, the rest, the cake last (ties in FOOD_POINTS' order). */
const ORDER = ['bread', 'pumpkin_pie', 'melon_slice'];
const prefer = (item: string) => (item === 'cake' ? 9 : ORDER.includes(item) ? ORDER.indexOf(item) : 5);

export type Appetite = { level: number; at: number; meals: number; hungryMs: number; lastMeal?: { at: number; item: string; n: number } };

/** The level after `gameMinutes` (D7): busy at the full rate, idle at its share; never below 0. */
export function drain(level: number, gameMinutes: number, busy: boolean): number {
  const rate = busy ? APPETITE.rate : APPETITE.rate * APPETITE.idle;
  return Math.max(0, level - (gameMinutes * rate) / 60);
}

/** D8's states. */
export function stateOf(level: number): 'fed' | 'peckish' | 'hungry' {
  return level <= APPETITE.hungryAt ? 'hungry' : level <= APPETITE.eatAt ? 'peckish' : 'fed';
}

/** What of each food storage can give a meal (beyond the planting stock kept). */
export function foodItems(store: Counts): Counts {
  const out: Counts = {};
  for (const item of Object.keys(FOOD_POINTS)) {
    const n = (store[item] ?? 0) - (KEEP[item] ?? 0);
    if (n > 0) out[item] = n;
  }
  return out;
}

/** Storage's food in points (what meals can take). */
export function foodPoints(store: Counts): number {
  return Object.entries(foodItems(store)).reduce((s, [item, n]) => s + n * FOOD_POINTS[item], 0);
}

/** "14 bread, 1 cake", or "no food". */
export function foodText(store: Counts): string {
  const items = Object.entries(foodItems(store)).sort((x, y) => prefer(x[0]) - prefer(y[0]));
  return items.length ? items.map(([item, n]) => `${n} ${item.replace(/_/g, ' ')}`).join(', ') : 'no food';
}

/**
 * The meal code chooses (D9, lesson 1; the check's L3): for each food, the most items that keep the level at or below 20
 * (at least one), and the food whose meal overflows 20 least, then bread, pie, melon slices, the rest; the cake last, and
 * only for a hungry member (a peckish Mayor ate a whole cake at 11.4 in G3f: the village's dearest food, 6 points of it
 * wasted; lens 1 L1). Null when storage holds nothing this member would eat.
 */
export function chooseMeal(level: number, store: Counts): { item: string; n: number } | null {
  const room = Math.max(0, APPETITE.cap - level);
  let best: { item: string; n: number; key: number[] } | null = null;
  for (const [item, have] of Object.entries(foodItems(store))) {
    if (item === 'cake' && level > APPETITE.hungryAt) continue;
    const pts = FOOD_POINTS[item];
    const n = Math.max(1, Math.min(have, Math.floor(room / pts)));
    const over = Math.max(0, level + n * pts - APPETITE.cap);
    const key = [over, prefer(item)];
    const before = (p: number[], q: number[]) => p[0] - q[0] || p[1] - q[1];
    if (!best || before(key, best.key) < 0) best = { item, n, key };
  }
  return best ? { item: best.item, n: best.n } : null;
}

/** Food work (D8): what a hungry member may still take. The fields, slots, starts, pens, pen work, the cake, eating, and
 *  the workshop's food goods (make: bread and pies only). */
export function isFoodKind(kind: ChoiceKind, opt?: { id: string }): boolean {
  if (kind === 'make') return /^make:(bread|pumpkin_pie)$/.test(opt?.id ?? '');
  return kind === 'eat' || kind === 'farm' || kind === 'slot' || kind === 'start' || kind === 'pen' || kind === 'penwork' || kind === 'cake';
}

/** A board task a hungry member may claim (D8): planting a field and gathering its seeds, keyed on the detail (the check's
 *  L2: tend_farm's own requeue posts seed tasks of its own wording). */
export function isFoodTask(t: { title: string; detail: string }): boolean {
  return /\btend_farm layout=/.test(t.detail) || /\bcollect block=wheat_seeds\b/.test(t.detail);
}

/** Whether a village keeps an appetite now: on, complete, and its record started (by the world's first drain, once a field
 *  is planted, or by the test API). The food rules (claims, the menu, food goods, keeps) follow the record. */
export function appetiteOn(v: Village | undefined): v is Village & { food: NonNullable<Village['food']> } {
  return APPETITE.rate > 0 && !!v?.complete && !!v.food;
}

/**
 * Meals under way, by "village|agent" (lens 1 M1: the sweep, the claim gate and every eater read the storage record, which
 * stays as it was until each eater has withdrawn, so two members went for the last bread): what each eater goes for, kept
 * from the other members' meals and claims as makeHolds keeps a make's inputs. Set when the chore is queued (runOption),
 * replaced by the meal eat_meal chooses, deleted at the chore's end.
 */
const meals = new Map<string, { item: string; n: number }>();
const mealKey = (village: string, agent: string) => `${village}|${agent.toLowerCase()}`;

/** A meal held for `agent` (returned: its own entry, for releaseMeal). */
export function holdMeal(village: string, agent: string, meal: { item: string; n: number }): { item: string; n: number } {
  const m = { item: meal.item, n: meal.n };
  meals.set(mealKey(village, agent), m);
  return m;
}

/** The meal held for `agent` released; with `mine`, only while it is still that entry (a stopped meal's finally can run
 *  after the agent's next meal was held). */
export function releaseMeal(village: string, agent: string, mine?: { item: string; n: number }): void {
  const k = mealKey(village, agent);
  if (!mine || meals.get(k) === mine) meals.delete(k);
}

/** Storage less the meals other members of the village are on their way to eat (`agent`'s own is its to take). */
export function storeForMeals(village: string, store: Counts, agent?: string): Counts {
  const own = agent ? mealKey(village, agent) : '';
  let out: Counts | null = null;
  for (const [k, m] of meals) {
    if (!k.startsWith(`${village}|`) || k === own) continue;
    out ??= { ...store };
    out[m.item] = Math.max(0, (out[m.item] ?? 0) - m.n);
  }
  return out ?? store;
}

/** Food made or used other than eaten, into the village's ledger (lesson 132: every flow of the good), when it keeps one. */
export function noteFood(v: Village | undefined, field: 'made' | 'used', c: Counts): void {
  if (!appetiteOn(v)) return;
  const to = (v.food[field] ??= {});
  for (const [item, n] of Object.entries(c)) if (n > 0) to[item] = (to[item] ?? 0) + n;
}
