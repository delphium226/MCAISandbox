/**
 * Bills of materials and the recipe chain behind them, for the peaceful village economy: what a design needs, and what
 * must be gathered, crafted and smelted to get it, less what is already in hand. Code does this arithmetic, not the
 * model (it miscounts batches and invents recipes).
 *
 * Crafting recipes come from minecraft-data, which lists one recipe per ingredient variant (a chest has twelve, one per
 * plank kind). Recipes that differ only by wood kind (or cobblestone kind) are merged into one that takes "any planks",
 * so a chest does not demand oak specifically. minecraft-data has no smelting recipes: the few buildings need are below.
 * Fuel is counted as planks (1.5 smelts each), less any coal or charcoal in hand (8 smelts each).
 */
import type minecraftData from 'minecraft-data';
import type { Design } from '../village';

type Registry = ReturnType<typeof minecraftData>;
export type Counts = Record<string, number>;

/** Interchangeable items: a recipe that accepts every kind takes the "any:" token instead. */
const FAMILIES: Record<string, RegExp> = {
  'any:planks': /_planks$/,
  'any:logs': /^(?!stripped_).*_(log|stem)$/,
  'any:cobblestone': /^(cobblestone|cobbled_deepslate|blackstone)$/,
};
const FAMILY_OF = (name: string) => Object.keys(FAMILIES).find((f) => FAMILIES[f].test(name));
const FAMILY_RECIPES: Record<string, Option> = { 'any:planks': { kind: 'craft', out: 4, ins: { 'any:logs': 1 } } };

/** Smelting (input -> output, one each); minecraft-data has none. */
const SMELT: Record<string, string> = {
  glass: 'sand', stone: 'any:cobblestone', smooth_stone: 'stone', brick: 'clay_ball', terracotta: 'clay',
  iron_ingot: 'raw_iron', copper_ingot: 'raw_copper', gold_ingot: 'raw_gold', charcoal: 'any:logs',
  smooth_sandstone: 'sandstone', cracked_stone_bricks: 'stone_bricks',
};

/** Found in the world as they are (gathering beats their recipes, e.g. coal from a coal block). */
const GATHER = new Set(['coal', 'raw_iron', 'raw_copper', 'raw_gold', 'white_wool', 'clay_ball', 'sand', 'red_sand', 'sandstone', 'red_sandstone', 'terracotta', 'dirt', 'gravel', 'sugar_cane', 'leather', 'vine']);

/** Not obtainable in a peaceful overworld: Nether blocks and hostile-mob drops. */
const UNOBTAINABLE: Record<string, string> = {
  glowstone_dust: 'Nether only', glowstone: 'Nether only', quartz: 'Nether only', netherrack: 'Nether only', soul_sand: 'Nether only',
  blaze_rod: 'Nether only', string: 'dropped by spiders (no hostile mobs in peaceful)', gunpowder: 'dropped by creepers (none in peaceful)',
  bone: 'dropped by skeletons (none in peaceful)', slime_ball: 'dropped by slimes (none in peaceful)', ender_pearl: 'dropped by endermen (none in peaceful)',
  spider_eye: 'dropped by spiders (none in peaceful)', rotten_flesh: 'dropped by zombies (none in peaceful)',
};

/** Placing one of these charges another item (grass needs silk touch to carry: charge dirt). */
const CHARGE_AS: Record<string, string> = { grass_block: 'dirt' };

interface Option {
  kind: 'craft' | 'smelt';
  /** Items made per run. */
  out: number;
  ins: Counts;
}

export interface Step {
  do: 'craft' | 'smelt';
  item: string;
  runs: number;
  makes: number;
}

export interface MaterialPlan {
  /** What was asked for. */
  bill: Counts;
  /** Taken from what is in hand (inventory and storage), by item. */
  fromStock: Counts;
  /** Still to gather, by raw item ("any:logs" = logs of any kind). */
  gather: Counts;
  /** Crafting and smelting in order (ingredients before what uses them). */
  steps: Step[];
  fuel: { smelts: number; coal: number; planks: number };
  /** Items that cannot be had here, with why. */
  problems: string[];
}

/** The item a block name costs: states and namespace stripped, grass charged as dirt. */
export function chargedItem(block: string): string {
  const name = block.replace(/^minecraft:/, '').replace(/\[.*\]$/, '');
  return CHARGE_AS[name] ?? name;
}

/** Items a design uses: every cell except air, "." and "_"; a door counts once for its two cells. */
export function designBill(d: Design): Counts {
  const bill: Counts = {};
  d.layers.forEach((layer, li) =>
    layer.forEach((row, ri) => {
      for (let ci = 0; ci < row.length; ci++) {
        const ch = row[ci];
        if (ch === '.' || ch === '_' || !d.palette[ch] || d.palette[ch] === 'air') continue;
        const item = chargedItem(d.palette[ch]);
        if (/_door$/.test(item) && li > 0 && d.palette[d.layers[li - 1]?.[ri]?.[ci] ?? '.'] === d.palette[ch]) continue;
        bill[item] = (bill[item] ?? 0) + 1;
      }
    }),
  );
  return bill;
}

/** How an item reads in messages. */
export function label(name: string): string {
  return name.startsWith('any:') ? `${name.slice(4)} (any kind)` : name;
}

export class Materials {
  private options = new Map<string, Option[]>();

  constructor(private registry: Registry) {}

  /** Crafting recipes (variant recipes merged into "any:" ones) and smelting for an item. */
  private optionsFor(name: string): Option[] {
    const cached = this.options.get(name);
    if (cached) return cached;
    const out: Option[] = [];
    if (FAMILY_RECIPES[name]) out.push(FAMILY_RECIPES[name]);
    const item = this.registry.itemsByName[name];
    const recipes = (item && (this.registry.recipes as Record<number, any[]>)[item.id]) || [];
    const groups = new Map<string, { exact: Option; general: Option; n: number }>();
    for (const r of recipes) {
      const ids: Array<number | null> = r.inShape ? r.inShape.flat() : (r.ingredients ?? []);
      const exact: Counts = {}, general: Counts = {};
      for (const raw of ids) {
        const id = raw && typeof raw === 'object' ? (raw as { id: number }).id : raw;
        if (id === null || id === undefined || id < 0) continue;
        const n = this.registry.items[id]?.name;
        if (!n) continue;
        exact[n] = (exact[n] ?? 0) + 1;
        const g = FAMILY_OF(n) ?? n;
        general[g] = (general[g] ?? 0) + 1;
      }
      const key = JSON.stringify(Object.entries(general).sort());
      const count = r.result?.count ?? 1;
      const g = groups.get(key);
      if (g) g.n++;
      else groups.set(key, { exact: { kind: 'craft', out: count, ins: exact }, general: { kind: 'craft', out: count, ins: general }, n: 1 });
    }
    for (const g of groups.values()) out.push(g.n > 1 ? g.general : g.exact);
    if (SMELT[name]) out.push({ kind: 'smelt', out: 1, ins: { [SMELT[name]]: 1 } });
    this.options.set(name, out);
    return out;
  }

  /**
   * Raw units per item (smelting adds a little: it is slow and burns fuel); null when every way to get it leads back
   * into the path (iron_block from iron_ingot while pricing iron_ingot). Results that depended on the path are not kept.
   */
  private cost(name: string, path: Set<string>, memo: Map<string, number>): number | null {
    const m = memo.get(name);
    if (m !== undefined) return m;
    if (path.has(name)) return null;
    if (UNOBTAINABLE[name]) return 1000;
    const options = this.optionsFor(name);
    // No recipe at all: gathered as it is
    let best = GATHER.has(name) || name === 'any:logs' || name === 'any:cobblestone' || !options.length ? 1 : Infinity;
    let cut = false;
    path.add(name);
    for (const o of options) {
      let c = o.kind === 'smelt' ? 0.3 : 0.02;
      for (const [n, q] of Object.entries(o.ins)) {
        const ci = this.cost(n, path, memo);
        if (ci === null) { c = Infinity; cut = true; break; }
        c += ci * q;
      }
      best = Math.min(best, c / o.out);
    }
    path.delete(name);
    if (best === Infinity) return cut ? null : 1;
    if (!cut) memo.set(name, best);
    return best;
  }

  /** The chosen way to get an item, or null when it is gathered. */
  private choose(name: string, memo: Map<string, number>): Option | null {
    const gather = GATHER.has(name) || name === 'any:logs' || name === 'any:cobblestone' || !!UNOBTAINABLE[name];
    let best: Option | null = null, bestCost = gather ? (UNOBTAINABLE[name] ? 1000 : 1) : Infinity;
    for (const o of this.optionsFor(name)) {
      let c = o.kind === 'smelt' ? 0.3 : 0.02;
      for (const [n, q] of Object.entries(o.ins)) {
        const ci = this.cost(n, new Set([name]), memo);
        if (ci === null) { c = Infinity; break; }
        c += ci * q;
      }
      c /= o.out;
      if (c < bestCost) { best = o; bestCost = c; }
    }
    return best;
  }

  /** What getting these items takes, given what is already in hand. */
  plan(bill: Counts, have: Counts = {}): MaterialPlan {
    const first = this.propagate(bill, have);
    // Fuel: coal and charcoal in hand first, the rest as planks
    const smelts = first.smelts;
    const coalHave = (have.coal ?? 0) + (have.charcoal ?? 0);
    const coal = Math.min(coalHave, Math.ceil(smelts / 8));
    const planks = Math.ceil(Math.max(0, smelts - coal * 8) / 1.5);
    const result = planks ? this.propagate({ ...bill, 'any:planks': (bill['any:planks'] ?? 0) + planks }, have) : first;
    return { bill, fromStock: result.fromStock, gather: result.gather, steps: result.steps, fuel: { smelts, coal, planks }, problems: result.problems };
  }

  private propagate(bill: Counts, haveIn: Counts) {
    const memo = new Map<string, number>();
    const pool: Counts = { ...haveIn };
    // Left over from batches (6 planks make 3 doors): used before crafting more, but not stock
    const surplus: Counts = {};
    const chosen = new Map<string, Option | null>();
    // Producers of each item's ingredients, found depth first
    const visit = (n: string) => {
      if (chosen.has(n)) return;
      const o = this.choose(n, memo);
      chosen.set(n, o);
      if (o) for (const i of Object.keys(o.ins)) visit(i);
    };
    for (const n of Object.keys(bill)) visit(n);
    // Consumers before producers (Kahn), exact items before "any:" ones so specific stock is taken first
    const consumers = new Map<string, number>();
    for (const o of chosen.values()) if (o) for (const i of Object.keys(o.ins)) consumers.set(i, (consumers.get(i) ?? 0) + 1);
    const order: string[] = [];
    const ready = [...chosen.keys()].filter((n) => !consumers.get(n));
    while (ready.length) {
      ready.sort((a, b) => Number(a.startsWith('any:')) - Number(b.startsWith('any:')));
      const n = ready.shift()!;
      order.push(n);
      const o = chosen.get(n);
      if (o) for (const i of Object.keys(o.ins)) {
        consumers.set(i, consumers.get(i)! - 1);
        if (!consumers.get(i)) ready.push(i);
      }
    }
    const demand: Counts = { ...bill };
    const fromStock: Counts = {}, gather: Counts = {};
    const steps: Step[] = [];
    const problems: string[] = [];
    let smelts = 0;
    const take = (n: string, want: number) => {
      const members = n.startsWith('any:') ? Object.keys(pool).filter((k) => FAMILIES[n].test(k)).sort((a, b) => pool[b] - pool[a]) : [n];
      let got = 0;
      for (const k of members) {
        const t = Math.min(pool[k] ?? 0, want - got);
        if (t <= 0) continue;
        pool[k] -= t;
        fromStock[k] = (fromStock[k] ?? 0) + t;
        got += t;
      }
      return got;
    };
    for (const n of order) {
      let spare = 0;
      for (const k of n.startsWith('any:') ? Object.keys(surplus).filter((k) => FAMILIES[n].test(k)) : [n]) {
        const t = Math.min(surplus[k] ?? 0, (demand[n] ?? 0) - spare);
        if (t > 0) { surplus[k] -= t; spare += t; }
      }
      const need = (demand[n] ?? 0) - spare - take(n, (demand[n] ?? 0) - spare);
      if (need <= 0) continue;
      const o = chosen.get(n);
      if (!o) {
        gather[n] = (gather[n] ?? 0) + need;
        if (UNOBTAINABLE[n]) problems.push(`${label(n)}: ${UNOBTAINABLE[n]}`);
        else if (!n.startsWith('any:') && !this.registry.itemsByName[n]) problems.push(`${n}: no such item`);
        continue;
      }
      const runs = Math.ceil(need / o.out);
      steps.push({ do: o.kind, item: n, runs, makes: runs * o.out });
      if (o.kind === 'smelt') smelts += runs;
      // Surplus from a batch (6 planks make 3 doors) stays in the pool for later uses
      if (runs * o.out > need) surplus[n] = (surplus[n] ?? 0) + runs * o.out - need;
      for (const [i, q] of Object.entries(o.ins)) demand[i] = (demand[i] ?? 0) + runs * q;
    }
    steps.reverse();
    return { fromStock, gather, steps, problems, smelts };
  }
}

/** One paragraph for a model or a failure message. */
export function describePlan(p: MaterialPlan): string {
  const list = (c: Counts) => Object.entries(c).map(([n, q]) => `${q} ${label(n)}`).join(', ');
  const parts = [`needs ${list(p.bill)}`];
  if (Object.keys(p.fromStock).length) parts.push(`in hand: ${list(p.fromStock)}`);
  if (Object.keys(p.gather).length) parts.push(`gather ${list(p.gather)}`);
  const crafts = p.steps.filter((s) => s.do === 'craft').map((s) => `${s.makes} ${label(s.item)}`);
  const smelts = p.steps.filter((s) => s.do === 'smelt').map((s) => `${s.makes} ${label(s.item)}`);
  if (crafts.length) parts.push(`craft ${crafts.join(', ')}`);
  if (smelts.length) parts.push(`smelt ${smelts.join(', ')} (fuel: ${p.fuel.coal ? `${p.fuel.coal} coal` : ''}${p.fuel.coal && p.fuel.planks ? ' + ' : ''}${p.fuel.planks ? `${p.fuel.planks} planks, or ${Math.ceil((p.fuel.smelts - p.fuel.coal * 8) / 8)} coal instead` : ''})`);
  if (p.problems.length) parts.push(`cannot be had: ${p.problems.join('; ')}`);
  return parts.join('; ');
}
