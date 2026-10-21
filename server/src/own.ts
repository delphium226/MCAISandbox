/**
 * Personal stock and wants (#68, #69; spec runs/2026-10-21/s43/spec_economy_stock_wants.md). World-free: the share a
 * chore earns from its net yield, a member's stock record, its wants as one line of facts. The world (mcWorld.ts) and the
 * skills (mcStorage.ts) move the goods; the simulator uses the same rules.
 */
import { FOOD_POINTS } from './appetite';
import type { OwnStock, Village } from './village';

type Counts = Record<string, number>;

/** On with MC_OWN=on (off by default until a live run passes); the share of a chore's net yield that is the member's. */
export const OWN = {
  on: /^(on|1|true)$/i.test(process.env.MC_OWN ?? 'off'),
  share: Math.min(1, Math.max(0, Number(process.env.MC_OWN_SHARE ?? 0.25))),
};

/**
 * Chore kinds whose yield earns a share: those that bring new goods from the world (harvests, eggs and milk, fishing,
 * gathering trips). Not makes (they turn commons goods into others), initiatives, help, growth, works, iron (its iron is
 * the village's tools), lighting or furnishing (the review of the spec).
 */
export const SHARED = new Set(['farm', 'slot', 'penwork', 'activity', 'gather']);

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
  const s = new Set((process.env.MC_SPECIAL ?? '').split(/[,;+]/).map((x) => x.trim()).filter(Boolean));
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
];

/** What a member's share takes: food and what its own recipes take (fishing's junk and the rest stay the commons'). */
export const OWN_GOODS = new Set([...Object.keys(FOOD_POINTS), ...OWN_RECIPES.flatMap((r) => Object.keys(r.inputs)), 'sugar_cane']);

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
