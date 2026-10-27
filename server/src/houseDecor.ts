/**
 * House decorations (#141, MC_HOUSE_DECOR=on; off by default; spec runs/2026-10-27/houses/spec.md 5, the user's decisions
 * of 10-27): each member's own house has decoration slots (streetPlan.ts decorSlots, after its basics and furniture),
 * the trades make the pieces into storage (make_furnishing: the weaver's carpets and banners, the smith's lanterns and
 * candles and flower pots) and the house's owner places them from its own menu (mcHome.ts decorate_home), as its
 * character likes them: its colour and the kinds it puts first. World-free: kinds, costs from a storage count, taste,
 * what the village's houses still want.
 */
import { goalFromValues, valuesOf, type Value } from './character';
import type { DecorSlot } from './streetPlan';
import { rawSetting } from './settings';

export const HOUSE_DECOR = /^(on|1|true|yes)$/i.test(rawSetting('MC_HOUSE_DECOR') ?? 'off');

export type DecorKind = 'carpet' | 'banner' | 'pot' | 'candle' | 'lantern';
export const DECOR_KINDS: DecorKind[] = ['carpet', 'banner', 'pot', 'candle', 'lantern'];
/** The slot each kind takes. */
export const SLOT_OF: Record<DecorKind, DecorSlot['kind']> = { carpet: 'floor', banner: 'wall', pot: 'surface', candle: 'surface', lantern: 'ceiling' };

type Counts = Record<string, number>;

/** Flowers a pot takes (the small ones: a potted_X block for each). */
const POT_FLOWERS = ['poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'];

/** A member's colour by its strongest value (pure: a member's character is a function of its name). */
const VALUE_COLOURS: Record<Value, string[]> = {
  openness: ['light_blue', 'cyan', 'purple'],
  conservation: ['brown', 'white', 'gray'],
  enhancement: ['red', 'yellow', 'orange'],
  transcendence: ['green', 'lime', 'pink'],
};

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A member's taste: its colour and its kinds in the order it puts them up (beauty: pots and banners first; home: carpets
 *  and candles; the rest by its name's own turn). */
export function decorTaste(member: string): { colour: string; kinds: DecorKind[] } {
  const v = valuesOf(member);
  const top = (Object.keys(v) as Value[]).sort((a, b) => v[b] - v[a])[0];
  const colours = VALUE_COLOURS[top];
  const colour = colours[hash(`${member.toLowerCase()}|colour`) % colours.length];
  const goal = goalFromValues(member);
  const first: DecorKind[] = goal === 'beauty' ? ['pot', 'banner'] : goal === 'home' ? ['carpet', 'candle'] : goal === 'standing' || goal === 'wealth' ? ['banner', 'lantern'] : [];
  const k = hash(`${member.toLowerCase()}|decor`) % DECOR_KINDS.length;
  const rest = [...DECOR_KINDS.slice(k), ...DECOR_KINDS.slice(0, k)].filter((x) => !first.includes(x));
  return { colour, kinds: [...first, ...rest] };
}

/** The stocked item for a kind (in the member's colour when it can choose): what the trades make. */
export function stockItem(kind: DecorKind, colour = 'white'): string {
  return kind === 'carpet' ? `${colour}_carpet` : kind === 'banner' ? `${colour}_banner` : kind === 'pot' ? 'flower_pot' : kind;
}

/** Whether an item is a house decoration a trade stocks (make_furnishing makes it into storage). */
export const isDecorItem = (item: string) => /^(\w+_carpet|\w+_banner|flower_pot|candle|lantern)$/.test(item);

/**
 * What one piece costs from storage `store` and the block it sets (`facing` a banner's): the stocked item, the member's
 * colour first; a carpet may instead take 1 wool (2 wool make 3 at the owner's bench: the spec's one piece an owner makes);
 * a pot takes a flower too when storage holds one (potted). Null with why when storage has none.
 */
export function decorCost(kind: DecorKind, store: Counts, colour: string, facing = 'north'): { take: Counts; block: string; item: string } | { short: string } {
  const pick = (re: RegExp, want: string) => ((store[want] ?? 0) >= 1 ? want : Object.keys(store).filter((n) => re.test(n) && (store[n] ?? 0) >= 1).sort((p, q) => store[q] - store[p] || p.localeCompare(q))[0]);
  if (kind === 'carpet') {
    const c = pick(/_carpet$/, `${colour}_carpet`);
    if (c) return { take: { [c]: 1 }, block: c, item: c };
    const w = pick(/_wool$/, `${colour}_wool`);
    return w ? { take: { [w]: 1 }, block: w.replace(/_wool$/, '_carpet'), item: w.replace(/_wool$/, '_carpet') } : { short: 'a carpet (or wool)' };
  }
  if (kind === 'banner') {
    const b = pick(/_banner$/, `${colour}_banner`);
    return b ? { take: { [b]: 1 }, block: `${b.replace(/_banner$/, '_wall_banner')}[facing=${facing}]`, item: b } : { short: 'a banner (the weaver makes them)' };
  }
  if (kind === 'pot') {
    if ((store.flower_pot ?? 0) < 1) return { short: 'a flower pot (the smith makes them from bricks)' };
    const f = POT_FLOWERS.filter((n) => (store[n] ?? 0) >= 1).sort((p, q) => store[q] - store[p] || p.localeCompare(q))[0];
    return f ? { take: { flower_pot: 1, [f]: 1 }, block: `potted_${f}`, item: 'flower_pot' } : { take: { flower_pot: 1 }, block: 'flower_pot', item: 'flower_pot' };
  }
  if (kind === 'candle') {
    const c = pick(/^(\w+_)?candle$/, `${colour}_candle`);
    return c ? { take: { [c]: 1 }, block: `${c}[candles=1,lit=true]`, item: c } : { short: 'a candle (the smith makes them)' };
  }
  return (store.lantern ?? 0) >= 1 ? { take: { lantern: 1 }, block: 'lantern[hanging=true]', item: 'lantern' } : { short: 'a lantern (the smith makes them)' };
}

/** A decoration placed in a house (the village's record, by structure id). */
export interface DecorPlaced { x: number; y: number; z: number; kind: DecorKind; block: string; at: number; by: string }

/**
 * The pieces a house would take next, as many as `n`, in its owner's order: kinds the house does not have yet first, each
 * with a free slot of its kind and a cost storage can pay (the store counted down as they are picked).
 */
export function decorPicks(member: string, free: DecorSlot[], placed: DecorPlaced[], store: Counts, n = 2): Array<{ kind: DecorKind; slot: DecorSlot; cost: { take: Counts; block: string; item: string } }> {
  const t = decorTaste(member);
  const left = { ...store };
  const used = new Set<DecorSlot>();
  const out: Array<{ kind: DecorKind; slot: DecorSlot; cost: { take: Counts; block: string; item: string } }> = [];
  const order = [...t.kinds.filter((k) => !placed.some((p) => p.kind === k)), ...t.kinds.filter((k) => placed.some((p) => p.kind === k))];
  for (let round = 0; round < 3 && out.length < n; round++)
    for (const kind of order) {
      if (out.length >= n) break;
      const slot = free.find((s) => s.kind === SLOT_OF[kind] && !used.has(s));
      if (!slot) continue;
      const c = decorCost(kind, left, t.colour, slot.facing);
      if ('short' in c) continue;
      for (const [k, q] of Object.entries(c.take)) left[k] = (left[k] ?? 0) - q;
      used.add(slot);
      out.push({ kind, slot, cost: c });
    }
  return out;
}

/**
 * The stock the village's houses want of each item the trades make, less what storage holds: each house's free slots
 * by kind (a surface counted once, as a pot or a candle in turn), white for carpets and banners and in the owners' colours
 * where the owners' tastes name one. `houses`: each owned house's owner and free slots.
 */
export function decorWants(houses: Array<{ owner: string; free: DecorSlot[] }>, store: Counts): Counts {
  const want: Counts = {};
  let surfaces = 0;
  for (const h of houses) {
    const t = decorTaste(h.owner);
    for (const s of h.free) {
      const item = s.kind === 'floor' ? stockItem('carpet', t.colour) : s.kind === 'wall' ? stockItem('banner', t.colour) : s.kind === 'ceiling' ? 'lantern' : surfaces++ % 2 ? 'candle' : 'flower_pot';
      want[item] = (want[item] ?? 0) + 1;
    }
  }
  // (any colour serves a carpet or a banner: storage's count by kind)
  const byKind = (re: RegExp) => Object.entries(store).filter(([k]) => re.test(k)).reduce((t, [, q]) => t + q, 0);
  const out: Counts = {};
  const stocked: Record<string, number> = { carpet: byKind(/_carpet$/) + byKind(/_wool$/), banner: byKind(/_banner$/), candle: byKind(/^(\w+_)?candle$/) };
  for (const [item, q] of Object.entries(want).sort()) {
    const k = /_carpet$/.test(item) ? 'carpet' : /_banner$/.test(item) ? 'banner' : item === 'candle' ? 'candle' : item;
    const have = stocked[k] ?? store[item] ?? 0;
    const short = q - have;
    stocked[k] = Math.max(0, have - q);
    if (short > 0) out[item] = short;
  }
  return out;
}
