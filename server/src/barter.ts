/**
 * Barter between members (#70, s43; the user's choices: code drafts offers, members accept through their menus, prices
 * start at code values and drift, goods change hands at a notice board by the storage hut). World-free: values, what a
 * member keeps, wants and can spare, an offer drafted, one accepted, offers lapsing. The world (mcWorld.ts) posts and
 * lapses them each minute and offers the trades on menus; the trade skill settles one; the simulator runs the same code.
 */
import { FOOD_POINTS, foodPoints } from './appetite';
import { OWN, OWN_RECIPES, OWN_SALES } from './own';
import type { OwnStock, Village } from './village';

type Counts = Record<string, number>;

/** On with MC_BARTER=on beside MC_OWN; an offer lapses unanswered after lapseMs; a lapse cheapens its good, a take dears it. */
export const BARTER = {
  on: OWN.on && /^(on|1|true)$/i.test(process.env.MC_BARTER ?? 'off'),
  lapseMs: Number(process.env.MC_BARTER_LAPSE_MIN ?? 10) * 60000,
  down: 0.9,
  up: 1.05,
};

/** An offer on the board: `by` gives `giveN` `give` for `wantN` `want`. */
export interface Offer { id: string; by: string; give: string; giveN: number; want: string; wantN: number; at: number; state: 'open' | 'taken' | 'lapsed'; takenBy?: string; endAt?: number }

/** The village's notice board: its offers (open and the last ended), price factors by good, counts. */
export interface Board { offers: Offer[]; factor: Record<string, number>; n: number; posted: number; taken: number; lapsed: number; traded: Record<string, number> }

export function boardOf(v: Village): Board {
  const x = v as Village & { board?: Board };
  return (x.board ??= { offers: [], factor: {}, n: 0, posted: 0, taken: 0, lapsed: 0, traded: {} });
}

/** A good's code value: its food points; a recipe's input its share of the product's (raw fish 0.8 of cooked); else 1. */
export function baseValue(item: string): number {
  if (FOOD_POINTS[item] !== undefined) return FOOD_POINTS[item];
  // (an emerald: what the cheapest sale to the merchant gives for one, s43's sales)
  if (item === 'emerald') return Math.min(...Object.entries(OWN_SALES).map(([n, q]) => q * baseValue(n)));
  if (item === 'sugar_cane') return baseValue('sugar');
  for (const r of OWN_RECIPES) {
    const k = r.inputs[item];
    if (!k) continue;
    const units = Object.values(r.inputs).reduce((t, q) => t + q, 0);
    return Math.round(((FOOD_POINTS[r.item] ?? 1) / units) * (r.smelt ? 0.8 : 1) * 100) / 100;
  }
  return 1;
}

/** Its price now: the value times its factor (0.25..4). */
export const price = (b: Board, item: string) => baseValue(item) * (b.factor[item] ?? 1);

const nudge = (b: Board, item: string, by: number) => {
  b.factor[item] = Math.min(4, Math.max(0.25, Math.round((b.factor[item] ?? 1) * by * 1000) / 1000));
};

/** What a member's open offers hold back. */
export function held(b: Board, name: string): Counts {
  const out: Counts = {};
  for (const o of b.offers) if (o.state === 'open' && o.by === name) out[o.give] = (out[o.give] ?? 0) + o.giveN;
  return out;
}

/** Its own chest less what its open offers hold back. */
export function available(b: Board, name: string, own: OwnStock | undefined): Counts {
  const out: Counts = { ...(own?.chest?.items ?? {}) };
  for (const [n, q] of Object.entries(held(b, name))) out[n] = Math.max(0, (out[n] ?? 0) - q);
  return out;
}

/** What a member keeps whatever it is offered: food for 2 meals (16 points, the best first) and one batch of each recipe's inputs. */
export function keepOf(items: Counts): Counts {
  const keep: Counts = {};
  let pts = 0;
  for (const [n, q] of Object.entries(items).filter(([n]) => FOOD_POINTS[n] !== undefined).sort((x, y) => FOOD_POINTS[y[0]] - FOOD_POINTS[x[0]]))
    for (let i = 0; i < q && pts < 16; i++) {
      keep[n] = (keep[n] ?? 0) + 1;
      pts += FOOD_POINTS[n];
    }
  for (const r of OWN_RECIPES) for (const [n, q] of Object.entries(r.inputs)) keep[n] = Math.max(keep[n] ?? 0, Math.min(items[n] ?? 0, q));
  return keep;
}

/** What it can spare: available less what it keeps. */
export function surplus(items: Counts): Counts {
  const keep = keepOf(items), out: Counts = {};
  for (const [n, q] of Object.entries(items)) if (q - (keep[n] ?? 0) > 0) out[n] = q - (keep[n] ?? 0);
  return out;
}

/**
 * What it wants, most pressing first: food when it holds under 2 meals (the food the others can spare most of), then a
 * recipe's missing inputs when it holds some of the others (one batch).
 */
export function wantList(items: Counts, others: Counts): Array<{ item: string; n: number }> {
  const out: Array<{ item: string; n: number }> = [];
  const pts = foodPoints(items);
  if (pts < 16) {
    const food = Object.entries(others).filter(([n, q]) => FOOD_POINTS[n] !== undefined && q > 0).sort((x, y) => y[1] * FOOD_POINTS[y[0]] - x[1] * FOOD_POINTS[x[0]])[0];
    if (food) out.push({ item: food[0], n: Math.max(1, Math.ceil((16 - pts) / FOOD_POINTS[food[0]])) });
  }
  for (const r of OWN_RECIPES) {
    const ins = Object.entries(r.inputs);
    if (!ins.some(([n]) => (items[n] ?? 0) > 0)) continue;
    for (const [n, q] of ins) if ((items[n] ?? 0) < q && !out.some((w) => w.item === n)) out.push({ item: n, n: q - (items[n] ?? 0) });
  }
  return out;
}

/**
 * The offer code drafts for a member (none while it has one open): its most pressing want some other member could give,
 * paid in its most valuable surplus good (not the wanted one) at the board's prices, scaled down to what it can spare.
 * `others`: what the other members can spare, summed.
 */
export function draftOffer(b: Board, name: string, items: Counts, others: Counts, now: number): Offer | null {
  if (b.offers.some((o) => o.state === 'open' && o.by === name)) return null;
  const spare = surplus(items);
  for (const w of wantList(items, others)) {
    if ((others[w.item] ?? 0) <= 0) continue;
    const give = Object.entries(spare).filter(([n]) => n !== w.item).sort((x, y) => y[1] * price(b, y[0]) - x[1] * price(b, x[0]))[0];
    if (!give) continue;
    let wantN = Math.min(w.n, others[w.item]);
    let giveN = Math.ceil((wantN * price(b, w.item)) / price(b, give[0]));
    if (giveN > give[1]) {
      wantN = Math.floor((give[1] * price(b, give[0])) / price(b, w.item));
      if (wantN < 1) continue;
      giveN = Math.ceil((wantN * price(b, w.item)) / price(b, give[0]));
      if (giveN > give[1]) continue;
    }
    return { id: `o${++b.n}`, by: name, give: give[0], giveN, want: w.item, wantN, at: now, state: 'open' };
  }
  return null;
}

/**
 * Whether a member would take an offer: not its own, it can spare what is asked, and it wants what is given (on its want
 * list) or what is given is worth at least what it gives at the board's prices.
 */
export function wouldTake(b: Board, o: Offer, name: string, items: Counts, others: Counts): boolean {
  if (o.state !== 'open' || o.by === name) return false;
  if ((surplus(items)[o.want] ?? 0) < o.wantN) return false;
  if (wantList(items, others).some((w) => w.item === o.give)) return true;
  return o.giveN * price(b, o.give) >= o.wantN * price(b, o.want);
}

/** An offer settled between two records (the poster's goods were held back; the taker's are checked); false when either falls short. */
export function settle(b: Board, o: Offer, poster: OwnStock, taker: OwnStock, takerName: string, now: number): boolean {
  const pc = poster.chest, tc = taker.chest;
  if (o.state !== 'open' || !pc || !tc) return false;
  // (a poster no longer holding its goods: the offer comes down, as a lapse; Eco1's Ada failed the same one twice, s43)
  if ((pc.items[o.give] ?? 0) < o.giveN) {
    Object.assign(o, { state: 'lapsed', endAt: now });
    b.lapsed++;
    return false;
  }
  if ((tc.items[o.want] ?? 0) < o.wantN) return false;
  const move = (from: Counts, to: Counts, n: string, q: number) => {
    from[n] -= q;
    if (!from[n]) delete from[n];
    to[n] = (to[n] ?? 0) + q;
  };
  move(pc.items, tc.items, o.give, o.giveN);
  move(tc.items, pc.items, o.want, o.wantN);
  Object.assign(o, { state: 'taken', takenBy: takerName, endAt: now });
  b.taken++;
  b.traded[`${o.give}>${o.want}`] = (b.traded[`${o.give}>${o.want}`] ?? 0) + 1;
  nudge(b, o.give, BARTER.up);
  return true;
}

/** Offers open past lapseMs lapse, each cheapening its good; the board keeps the last 60 ended. Returns the lapsed. */
export function lapse(b: Board, now: number): Offer[] {
  const out: Offer[] = [];
  for (const o of b.offers)
    if (o.state === 'open' && now - o.at > BARTER.lapseMs) {
      Object.assign(o, { state: 'lapsed', endAt: now });
      b.lapsed++;
      nudge(b, o.give, BARTER.down);
      out.push(o);
    }
  const ended = b.offers.filter((o) => o.state !== 'open');
  if (ended.length > 60) b.offers = [...b.offers.filter((o) => o.state === 'open'), ...ended.slice(-60)];
  return out;
}

/** "6 pumpkin for 2 bread". */
export const offerText = (o: Offer) => `${o.giveN} ${o.give.replace(/_/g, ' ')} for ${o.wantN} ${o.want.replace(/_/g, ' ')}`;
