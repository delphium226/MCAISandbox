/**
 * Personal stock and wants (#68, #69; spec runs/2026-10-21/s43/spec_economy_stock_wants.md). World-free: the share a
 * chore earns from its net yield, a member's stock record, its wants as one line of facts. The world (mcWorld.ts) and the
 * skills (mcStorage.ts) move the goods; the simulator uses the same rules.
 */
import { FOOD_POINTS } from './appetite';
import type { OwnStock, Village } from './village';
import { rawSetting } from './settings';

type Counts = Record<string, number>;

/** On unless MC_OWN=off (on by default since 11-01, the user's); the share of a chore's net yield that is the member's. */
export const OWN = {
  on: /^(on|1|true)$/i.test(rawSetting('MC_OWN') ?? 'on'),
  share: Math.min(1, Math.max(0, Number(rawSetting('MC_OWN_SHARE') ?? 0.25))),
};

/**
 * Chore kinds whose yield earns a share: those that bring new goods from the world (harvests, eggs and milk, fishing,
 * gathering trips, and iron trips: the stone and coal they bring up, never the iron, which is the village's tools). Not
 * makes (they turn commons goods into others), initiatives, help, growth, works, lighting or furnishing (the review of
 * the spec). (Iron trips since the wealth monoculture, 10-23: a third of members' chores were make or iron, and the
 * share reached 10 fish in 30 minutes across 25 members.)
 */
export const SHARED = new Set(['farm', 'slot', 'penwork', 'activity', 'gather', 'iron']);

/**
 * Specialists (s43, the user's next step: holdings that differ so trades match): MC_SPECIAL=habit,price. `habit`: a member
 * leans toward the kinds it has done lately (1 + 0.6 x the kind's share of its last 12 chores); `price`: a chore whose
 * goods the board finds dear weighs more, a cheap one less (the goods' price factors, 0.6..1.6); `claim` (the user's
 * choice after those two did nothing: the open pumpkin farm flooded every chest): a member's 3rd harvest of an unclaimed
 * field, slot or pen claims it, one claim a member; only its claimant works it; a claim lapses after CLAIM_LAPSE_MS
 * unworked.
 */
export const CLAIM_AFTER = 3, CLAIM_LAPSE_MS = 15 * 60000;
export const SPECIAL = (() => {
  const s = new Set((rawSetting('MC_SPECIAL') ?? '').split(/[,;+]/).map((x) => x.trim()).filter(Boolean));
  return { habit: OWN.on && s.has('habit'), price: OWN.on && s.has('price'), claim: OWN.on && s.has('claim') };
})();

/** Items never shared: tools and what carries the work (a rod goes back to the commons whole), emeralds (the
 *  merchant's pay is the village's until the sales levy, DECISIONS 10-20), and seeds (planting stock: 232 of them were
 *  most of what the sim's members owned, s43). */
const NEVER = /(_pickaxe|_axe|_shovel|_hoe|_sword|^fishing_rod|^shears|^bucket|^water_bucket|^milk_bucket|^chest|^barrel|^emerald|_seeds)$/;

/**
 * What a member makes from its own stock (s43, the user's next step): food, crafted at the hut's table or smelted at a
 * works furnace; the inputs from its own chest, the product into it. A smelt burns the commons' fuel (the village's
 * furnaces: 1 charcoal a batch of up to 8, else 1 plank an item).
 */
export const OWN_RECIPES: Array<{ item: string; inputs: Counts; smelt: boolean }> = [
  { item: 'bread', inputs: { wheat: 3 }, smelt: false },
  { item: 'cooked_cod', inputs: { cod: 1 }, smelt: true },
  { item: 'cooked_salmon', inputs: { salmon: 1 }, smelt: true },
  { item: 'pumpkin_pie', inputs: { pumpkin: 1, sugar: 1, egg: 1 }, smelt: false },
  // (s43's own cane farms: the pie's sugar)
  { item: 'sugar', inputs: { sugar_cane: 1 }, smelt: false },
];

/**
 * Members' sales to the merchant (s43, MC_OWN_SALES=on): what it buys from members, items an emerald (vanilla's farmer and
 * fisherman; since 10-23 also the mason's stone, the smiths' coal, the fletcher's sticks and string), at most
 * OWN_SALE_LOTS lots of a good a restock across members; the levy (MC_OWN_LEVY, 0.25: DECISIONS 10-20) goes to the
 * village's storage, fractions carried per member.
 */
export const OWN_SALES_ON = OWN.on && /^(on|1|true)$/i.test(rawSetting('MC_OWN_SALES') ?? 'off');
export const OWN_SALES: Record<string, number> = {
  pumpkin: 6, wheat: 20, bread: 6, cod: 15, salmon: 13, carrot: 22, potato: 26,
  coal: 15, stone: 20, granite: 16, andesite: 16, diorite: 16, stick: 32, string: 20,
};

/** What a member's share takes: food, what its own recipes take, and what the merchant buys from members (a wealth
 *  member's way to emeralds: the stone and coal of gathering and iron trips); fishing's junk and the rest stay the
 *  commons'. */
export const OWN_GOODS = new Set([...Object.keys(FOOD_POINTS), ...OWN_RECIPES.flatMap((r) => Object.keys(r.inputs)), 'sugar_cane', ...Object.keys(OWN_SALES)]);
export const OWN_SALE_LOTS = 4;

/**
 * Members' own farms (s43, MC_OWN_FARM=on): a member with a house and no farm may lay out a wheat field of its own near its
 * house (lay_out_field's pad, within OWN_FARM_REACH of the house), seeded from the commons' spare seeds; it is claimed for
 * it for good, and its harvests are wholly its own (a share of 1).
 */
export const OWN_FARM = OWN.on && /^(on|1|true)$/i.test(rawSetting('MC_OWN_FARM') ?? 'off');
export const OWN_FARM_REACH = 24;

/**
 * How far from its house an own farm's centre may lie: lay_out_field's reach for `own` (mcBuild.ts: its 9x9 pad's corners
 * within 96 of the storage hut, FIELD_HUT_REACH and FIELD_PAD there). Under 8 none fits, the hut being too far (W1, 10-23:
 * the option was offered and failed "within 0 blocks").
 */
export function ownFieldReach(hut: { x: number; z: number }, home: { x: number; z: number }): number {
  return Math.min(OWN_FARM_REACH, Math.floor(96 - Math.hypot(hut.x - home.x, hut.z - home.z) - Math.ceil((9 / 2) * Math.SQRT2)));
}

/**
 * The kinds of own farm (s43, the user's: members choose by price and what they lack): a wheat field, or a farm slot of
 * pumpkins, sugar cane or carrots on the same pad (start_farm from storage); each with its product and the plants it
 * needs in the commons. Hen pens wait for pens beyond the annex.
 */
export const OWN_FARM_KINDS: Record<string, { product: string; plant: string; need: number }> = {
  wheat: { product: 'wheat', plant: 'wheat_seeds', need: 16 },
  pumpkin: { product: 'pumpkin', plant: 'pumpkin', need: 2 },
  sugar_cane: { product: 'sugar_cane', plant: 'sugar_cane', need: 6 },
  carrots: { product: 'carrot', plant: 'carrot', need: 6 },
};

/**
 * A kind's appeal to a member: its product's price factor on the board, 1.5 when the member holds none of the product,
 * divided by 1 + the own farms of that kind already standing (members spread over the kinds).
 */
export function farmKindScore(kind: string, factor: Record<string, number>, holds: Record<string, number>, standing: Record<string, number>): number {
  const k = OWN_FARM_KINDS[kind];
  return (factor[k.product] ?? 1) * ((holds[k.product] ?? 0) > 0 ? 1 : 1.5) / (1 + (standing[kind] ?? 0));
}
export const LEVY = Math.min(1, Math.max(0, Number(rawSetting('MC_OWN_LEVY') ?? 0.25)));

/** A sale's emeralds split: the member's and the levy, the levy's fraction carried in `part.levy`. */
export function levySplit(own: OwnStock, emeralds: number): { kept: number; levy: number } {
  const part = (own.part ??= {});
  const x = (part.levy ?? 0) + emeralds * LEVY;
  const levy = Math.floor(x + 1e-9);
  part.levy = Math.round((x - levy) * 1000) / 1000;
  if (!part.levy) delete part.levy;
  return { kept: emeralds - levy, levy };
}

/** The most of a recipe the items allow, at most 8. */
export function ownBatch(r: (typeof OWN_RECIPES)[number], items: Counts): number {
  return Math.min(8, ...Object.entries(r.inputs).map(([n, q]) => Math.floor((items[n] ?? 0) / q)));
}

/** A batch made in the record: the inputs out of the chest, the product in; false when the chest no longer holds them. */
export function makeInRecord(chest: { items: Counts }, r: (typeof OWN_RECIPES)[number], n: number, own?: OwnStock): boolean {
  if (n <= 0 || ownBatch(r, chest.items) < n) return false;
  for (const [k, q] of Object.entries(r.inputs)) {
    chest.items[k] -= q * n;
    if (!chest.items[k]) delete chest.items[k];
    if (own) own.used[k] = (own.used[k] ?? 0) + q * n;
  }
  chest.items[r.item] = (chest.items[r.item] ?? 0) + n;
  if (own) (own.made ??= {})[r.item] = (own.made[r.item] ?? 0) + n;
  return true;
}

/** A member's record, made on first use. */
export function ownOf(v: Village, name: string): OwnStock {
  const h = (v.homes ??= {});
  return (h[name] ??= { owed: {}, got: {}, used: {} });
}

/** The positive part of after - before, per item (what a chore put into the commons net of what it took). */
export function netPut(before: Counts, after: Counts): Counts {
  const out: Counts = {};
  for (const [n, q] of Object.entries(after)) {
    const d = q - (before[n] ?? 0);
    if (d > 0) out[n] = d;
  }
  return out;
}

/**
 * The share of a net yield added to a member's owed goods: whole items owed, the fractions kept in `part` so small
 * yields add up (four eggs at 0.25 owe one). Returns what was added in whole items.
 */
export function earnShare(own: OwnStock, net: Counts, share = OWN.share): Counts {
  const added: Counts = {};
  const part = (own.part ??= {});
  for (const [n, q] of Object.entries(net)) {
    if (q <= 0 || NEVER.test(n) || !OWN_GOODS.has(n)) continue;
    const x = (part[n] ?? 0) + q * share;
    const whole = Math.floor(x + 1e-9);
    part[n] = Math.round((x - whole) * 1000) / 1000;
    if (!part[n]) delete part[n];
    if (whole > 0) {
      own.owed[n] = (own.owed[n] ?? 0) + whole;
      added[n] = whole;
    }
  }
  return added;
}

/** Items owed in all. */
export const owedTotal = (own: OwnStock | undefined) => Object.values(own?.owed ?? {}).reduce((t, q) => t + q, 0);

/** A member's wants as code measures them (#69), for its menu and the panel. */
export interface Wants {
  /** Meals' worth of food in its own chest, and whether it is peckish or hungry. */
  food: { meals: number; hungry: boolean };
  /** Open furniture spots and unlit spots in its own house (undefined: no house). */
  house?: { furnish: number; light: number };
  /** Tools it lacks (not in its hands or its own chest). */
  tools: string[];
  /** Its own open initiative's missing materials. */
  project?: { kind: string; missing: Counts };
}

/** The wants that are open (each a short phrase), in a fixed order. */
export function openWants(w: Wants): string[] {
  const out: string[] = [];
  if (w.food.meals < 2) out.push(w.food.meals ? `food (${w.food.meals} meal of your own${w.food.hungry ? ', and you are hungry' : ''})` : `food (none of your own${w.food.hungry ? ', and you are hungry' : ''})`);
  if (w.house && (w.house.furnish || w.house.light)) out.push(`your house (${[w.house.furnish ? `${w.house.furnish} furniture spot${w.house.furnish === 1 ? '' : 's'} open` : '', w.house.light ? `${w.house.light} unlit` : ''].filter(Boolean).join(', ')})`);
  if (w.tools.length) out.push(`tools (no ${w.tools.join(', no ')})`);
  if (w.project && Object.keys(w.project.missing).length) out.push(`your ${w.project.kind} (needs ${Object.entries(w.project.missing).slice(0, 3).map(([n, q]) => `${Math.ceil(q)} ${n.replace(/^any:/, '').replace(/_/g, ' ')}`).join(', ')})`);
  return out;
}

/** "Your wants: ..." or '' when none is open. */
export function wantsLine(w: Wants): string {
  const o = openWants(w);
  return o.length ? `Your wants: ${o.join('; ')}.` : '';
}

/**
 * G3's levy on the decision call (spec runs/2026-10-21/g3-rules/spec.md 4, as revised): a sharing chore's share is
 * pending, not owed, until the member's next model decision says how much of it to leave in the village storage (none,
 * the levy's amount, or all). The caller (the world, behind MC_RULES' levy) decides when to pend, ask and settle; with
 * nothing pended these change nothing. Pending goods are counted as owed nowhere: they sit in the commons until settled.
 */
export interface Pending { items: Counts; since: number }
export type ShareSplit = 'none' | 'levy' | 'all';

const pendingRec = (own: OwnStock) => own as OwnStock & { pending?: Pending };

/** A net yield's share pended (earnShare's fractions and exclusions; `now` starts its age if none was pending). */
export function pendShare(own: OwnStock, net: Counts, now: number, share = OWN.share): Counts {
  const tmp: OwnStock = { owed: {}, got: {}, used: {}, ...(own.part ? { part: own.part } : {}) };
  const added = earnShare(tmp, net, share);
  if (tmp.part) own.part = tmp.part;
  if (!Object.keys(added).length) return added;
  const o = pendingRec(own);
  const p = (o.pending ??= { items: {}, since: now });
  for (const [n, q] of Object.entries(added)) p.items[n] = (p.items[n] ?? 0) + q;
  return added;
}

/** The member's pending share (items, their total, since when), or null. */
export function pendingOf(own: OwnStock | undefined): (Pending & { total: number }) | null {
  const p = own ? pendingRec(own).pending : undefined;
  if (!p) return null;
  const total = Object.values(p.items).reduce((t, q) => t + q, 0);
  return total > 0 ? { ...p, total } : null;
}

/** What the levy at `rate` (0..1) leaves of a pending total: rounded, at most all. (Not at least 1 since 10-23: a 10% levy
 *  took the whole of every 1-item share, all of the wealth monoculture's.) */
export const levyLeft = (total: number, rate: number) => (total <= 0 || rate <= 0 ? 0 : Math.min(total, Math.round(total * rate)));

/**
 * The member's answer: `none` owes it all, `levy` leaves levyLeft(total, rate) items in the commons (the most plentiful
 * first) and owes the rest, `all` leaves everything. Returns what became owed and what was left; null with nothing
 * pending.
 */
export function settlePending(own: OwnStock, split: ShareSplit, rate: number): { kept: Counts; left: Counts } | null {
  const p = pendingOf(own);
  if (!p) return null;
  let leave = split === 'all' ? p.total : split === 'levy' ? levyLeft(p.total, rate) : 0;
  const kept: Counts = {}, left: Counts = {};
  for (const [n, q] of Object.entries(p.items).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
    const l = Math.min(q, leave);
    leave -= l;
    if (l) left[n] = l;
    if (q - l) {
      kept[n] = q - l;
      own.owed[n] = (own.owed[n] ?? 0) + q - l;
    }
  }
  delete pendingRec(own).pending;
  return { kept, left };
}

/** A pending share older than `maxMs` (a village day) is kept by the member (owed whole, no levy): the lapsed goods. */
export function lapsePending(own: OwnStock, now: number, maxMs: number): Counts | null {
  const p = pendingOf(own);
  if (!p || now - p.since < maxMs) return null;
  return settlePending(own, 'none', 0)!.kept;
}
