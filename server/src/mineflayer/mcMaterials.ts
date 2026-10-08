/**
 * Bills of materials and the recipe chain behind them, for the peaceful village economy: what a design needs, and what
 * must be gathered, crafted and smelted to get it, less what is already in hand. Code does this arithmetic, not the
 * model (it miscounts batches and invents recipes).
 *
 * Crafting recipes come from minecraft-data, which lists one recipe per ingredient variant (a chest has twelve, one per
 * plank kind). Recipes that differ only by wood kind (or cobblestone kind) are merged into one that takes "any planks",
 * so a chest does not demand oak specifically. minecraft-data has no smelting recipes: they are read from the server's jar
 * (V2.5; the hand table below when it cannot be read). Fuel is counted as planks (1.5 smelts each), less any coal or
 * charcoal in hand (8 smelts each).
 */
import type minecraftData from 'minecraft-data';
import type { Design } from '../village';
import { hasJar, itemTag, listEntries, readJson, vanillaJar } from '../vanillaData';

type Registry = ReturnType<typeof minecraftData>;
export type Counts = Record<string, number>;

/** Interchangeable items: a recipe that accepts every kind takes the "any:" token instead (a mushroom stem is no log). */
const FAMILIES: Record<string, RegExp> = {
  'any:planks': /_planks$/,
  'any:logs': /^(?!stripped_|mushroom_).*_(log|stem)$/,
  'any:cobblestone': /^(cobblestone|cobbled_deepslate|blackstone)$/,
};
const FAMILY_OF = (name: string) => Object.keys(FAMILIES).find((f) => FAMILIES[f].test(name));
const FAMILY_RECIPES: Record<string, Option> = { 'any:planks': { kind: 'craft', out: 4, ins: { 'any:logs': 1 } } };

/** Smelting (output <- input, one each) when the jar cannot be read: the hand table the jar's recipes replaced (V2.5). */
export const SMELT_FALLBACK: Record<string, string> = {
  glass: 'sand', stone: 'any:cobblestone', smooth_stone: 'stone', brick: 'clay_ball', terracotta: 'clay',
  iron_ingot: 'raw_iron', copper_ingot: 'raw_copper', gold_ingot: 'raw_gold', charcoal: 'any:logs',
  smooth_sandstone: 'sandstone', cracked_stone_bricks: 'stone_bricks',
};

/** Found in the world as they are (gathering beats their recipes, e.g. coal from a coal block). */
const GATHER = new Set(['coal', 'raw_iron', 'raw_copper', 'raw_gold', 'white_wool', 'clay_ball', 'sand', 'red_sand', 'sandstone', 'red_sandstone', 'terracotta', 'dirt', 'gravel', 'sugar_cane', 'leather', 'vine']);

/** Gathered items that take finding (ores underground, animals): charcoal from logs beats coal ore, for example. */
const GATHER_COST: Record<string, number> = { coal: 2, raw_iron: 3, raw_copper: 3, raw_gold: 4, leather: 3, white_wool: 2, clay_ball: 2, sugar_cane: 2, vine: 2 };
const gatherCost = (name: string) => GATHER_COST[name] ?? 1;
/**
 * Raw materials a village gathers well: logs, stone (cobblestone), sand, sandstone, dirt, gravel, terracotta. Anything
 * else takes finding (iron ore, animals, moss deep in lush caves: mossy cobblestone sent two workers 70 blocks down
 * for 10 minutes, Accept5), so a village design should not need it.
 */
const EASY_GATHER = /^(any:logs|any:cobblestone|.*_(log|stem)|cobblestone|stone|sand|red_sand|sandstone|red_sandstone|dirt|gravel|(.*_)?terracotta)$/;
export const hardToGather = (gather: Counts) => Object.keys(gather).filter((n) => !EASY_GATHER.test(n));

/** Not obtainable in a peaceful overworld: Nether blocks and hostile-mob drops. */
const UNOBTAINABLE: Record<string, string> = {
  glowstone_dust: 'Nether only', glowstone: 'Nether only', quartz: 'Nether only', netherrack: 'Nether only', soul_sand: 'Nether only',
  blaze_rod: 'Nether only', string: 'dropped by spiders (no hostile mobs in peaceful)', gunpowder: 'dropped by creepers (none in peaceful)',
  bone: 'dropped by skeletons (none in peaceful)', slime_ball: 'dropped by slimes (none in peaceful)', ender_pearl: 'dropped by endermen (none in peaceful)',
  spider_eye: 'dropped by spiders (none in peaceful)', rotten_flesh: 'dropped by zombies (none in peaceful)',
};

export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
/** A wooden item: its wood kind and part ("acacia", "planks"). */
export const WOOD_ITEM = new RegExp(`^(${WOODS.join('|')})_(planks|log|wood|door|slab|stairs|fence|fence_gate|trapdoor|pressure_plate|button|sign)$`);
/**
 * A wooden block placed by a builder: its kind and part, the part with "stripped_" kept ("stripped_spruce_log" ->
 * spruce, "stripped_log"), so a swap to the village's kind keeps the look (vanilla pieces, V2.1). Null for other blocks.
 */
const WOOD_BLOCK = new RegExp(`^(stripped_)?(${WOODS.join('|')})_(planks|log|wood|door|slab|stairs|fence|fence_gate|trapdoor|pressure_plate|button|sign|wall_sign)$`);
export function woodPart(name: string): { kind: string; part: string } | null {
  const m = WOOD_BLOCK.exec(name);
  if (!m || (m[1] && !/^(log|wood)$/.test(m[3]))) return null;
  return { kind: m[2], part: `${m[1] ?? ''}${m[3]}` };
}
/** The block of a wood kind and part ("oak", "stripped_log" -> "stripped_oak_log"). */
export const woodName = (kind: string, part: string) => (part.startsWith('stripped_') ? `stripped_${kind}_${part.slice(9)}` : `${kind}_${part}`);

/**
 * A bill in the village's wood kind (oak planks become acacia planks where acacia grows): a village gathers one kind,
 * because a builder puts each wooden part in one kind and mixed logs came up a few short almost every build.
 */
export function inWood(bill: Counts, wood: string | undefined): Counts {
  if (!wood) return bill;
  const out: Counts = {};
  for (const [n, q] of Object.entries(bill)) {
    const m = WOOD_ITEM.exec(n);
    const k = m ? `${wood}_${m[2]}` : n;
    out[k] = (out[k] ?? 0) + q;
  }
  return out;
}

/** Placing one of these charges another item (grass and paths need silk touch or a shovel's use: charge dirt). */
const CHARGE_AS: Record<string, string> = { grass_block: 'dirt', dirt_path: 'dirt' };

export interface Option {
  kind: 'craft' | 'smelt';
  /** Items made per run. */
  out: number;
  ins: Counts;
}

let smeltTable: Map<string, Option[]> | undefined;

/**
 * Smelting options by output, from the jar's `minecraft:smelting` recipes, built once per process (one registry, the
 * server's version); today's hand table when the jar is missing or cannot be read (one `[vanilla]` line says why).
 */
export function smeltOptions(registry: Registry): Map<string, Option[]> {
  if (smeltTable) return smeltTable;
  try {
    smeltTable = jarSmelt(registry);
  } catch (e) {
    console.error(`[vanilla] smelting from the hand table: ${(e as Error).message}`);
    smeltTable = new Map(Object.entries(SMELT_FALLBACK).map(([out, input]) => [out, [{ kind: 'smelt', out: 1, ins: { [input]: 1 } }]]));
  }
  return smeltTable;
}

/**
 * The jar's smelting, with inputs a plan can get: gathered, a family's member, or itself made (crafted, or smelted from
 * such an input). Ores (blocks that drop something else and that nothing makes: collect yields raw iron, never iron
 * ore), unobtainable items and tools and armour (iron nuggets from an iron pickaxe) are left out, as are inputs with no
 * way to get them (raw beef, cactus). Inputs of one family merge into its "any:" option as crafting variants do
 * (charcoal from any logs); where today's table named an input, that option comes first and wins a tie (glass from sand
 * before red sand).
 */
function jarSmelt(registry: Registry): Map<string, Option[]> {
  const jar = vanillaJar();
  if (!hasJar(jar)) throw new Error(`no jar at ${jar}`);
  const strip = (s: string) => s.replace(/^minecraft:/, '');
  const recipes: Array<{ out: string; count: number; inputs: string[] }> = [];
  for (const file of listEntries('data/minecraft/recipe/', jar)) {
    if (!file.endsWith('.json')) continue;
    const j = readJson<{ type?: string; ingredient?: unknown; result?: { id?: string; count?: number } }>(file, jar);
    if (j.type !== 'minecraft:smelting') continue;
    const ing = typeof j.ingredient === 'string' ? [j.ingredient] : j.ingredient;
    if (!Array.isArray(ing) || !ing.every((s) => typeof s === 'string') || !j.result?.id) throw new Error(`${file}: a smelting recipe not read`);
    const inputs = (ing as string[]).flatMap((s) => (s.startsWith('#') ? [...itemTag(s, jar)] : [strip(s)]));
    recipes.push({ out: strip(j.result.id), count: j.result.count ?? 1, inputs: [...new Set(inputs)] });
  }
  if (!recipes.length) throw new Error(`no smelting recipes in ${jar}`);
  const gear = itemTag('enchantable/durability', jar);
  const crafted = (n: string) => {
    const item = registry.itemsByName[n];
    return !!FAMILY_RECIPES[n] || !!(item && (registry.recipes as Record<number, unknown[]>)[item.id]?.length);
  };
  const smelted = new Set(recipes.map((r) => r.out));
  const dropsOther = (n: string) => {
    const b = registry.blocksByName[n];
    if (!b || crafted(n) || smelted.has(n)) return false;
    return ((b.drops ?? []) as unknown[]).some((d) => {
      const id = typeof d === 'object' && d ? ((d as { drop?: { id?: number }; id?: number }).drop?.id ?? (d as { id?: number }).id) : (d as number);
      return registry.items[id as number]?.name !== n;
    });
  };
  // Outputs with a usable input, grown until nothing changes (stone_bricks' cracked form: stone from cobblestone)
  const hasSmelt = new Set<string>();
  const usable = (n: string) => !dropsOther(n) && !UNOBTAINABLE[n] && !gear.has(n)
    && (GATHER.has(n) || !!FAMILY_OF(n) || n.startsWith('any:') || crafted(n) || hasSmelt.has(n));
  for (let grew = true; grew;) {
    grew = false;
    for (const r of recipes) if (!hasSmelt.has(r.out) && r.inputs.some(usable)) { hasSmelt.add(r.out); grew = true; }
  }
  const table = new Map<string, Option[]>();
  for (const out of hasSmelt) {
    const groups = new Map<string, { exact: Option; general: Option; inputs: Set<string> }>();
    for (const r of recipes) if (r.out === out) for (const m of r.inputs.filter(usable)) {
      const key = `${FAMILY_OF(m) ?? m} ${r.count}`;
      const g = groups.get(key);
      if (g) g.inputs.add(m);
      else groups.set(key, { exact: { kind: 'smelt', out: r.count, ins: { [m]: 1 } }, general: { kind: 'smelt', out: r.count, ins: { [FAMILY_OF(m) ?? m]: 1 } }, inputs: new Set([m]) });
    }
    const was = SMELT_FALLBACK[out];
    const today = (o: Option) => { const i = Object.keys(o.ins)[0]; return i === was || (!!was && !!FAMILIES[was]?.test(i)); };
    const options = [...groups.values()].map((g) => (g.inputs.size > 1 ? g.general : g.exact));
    table.set(out, [...options.filter(today), ...options.filter((o) => !today(o))]);
  }
  return table;
}

export interface Step {
  do: 'craft' | 'smelt';
  item: string;
  runs: number;
  makes: number;
  /** What is smelted (smelting steps). */
  input?: string;
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

/**
 * What the architect may build with in Minecraft (phase D): planks, logs and what is made of them in three woods (the
 * builder swaps the wood for the village's own), cobblestone, stone, stone bricks and sandstone with their stairs, slabs
 * and walls, glass; in creative also blocks the economy cannot make. Every survival block's raw materials are
 * easy to gather (scripts/bench/designbench.mts checks the list against Materials.plan).
 */
export function designBlockList(survival: boolean): string[] {
  const wood = ['oak', 'spruce', 'birch'].flatMap((w) => ['planks', 'log', 'stairs', 'slab', 'fence', 'fence_gate', 'trapdoor', 'door'].map((p) => `${w}_${p}`));
  const stone = ['cobblestone', 'cobblestone_stairs', 'cobblestone_slab', 'cobblestone_wall', 'stone', 'stone_stairs', 'stone_slab', 'stone_bricks',
    'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall', 'sandstone', 'sandstone_stairs', 'sandstone_slab', 'sandstone_wall'];
  // (no torches: one set over air by command drops off and is bought again on every pass, the review of D.1)
  const blocks = [...wood, ...stone, 'glass', 'glass_pane', 'dirt'];
  const extra = ['bricks', 'brick_stairs', 'brick_slab', 'mossy_cobblestone', 'mossy_stone_bricks', 'smooth_stone', 'terracotta', 'white_wool', 'bookshelf', 'lantern'];
  return survival ? blocks : [...blocks, ...extra];
}

/** The item a block name costs: states and namespace stripped, grass and paths charged as dirt, stripped logs and wood as logs. */
export function chargedItem(block: string): string {
  const name = block.replace(/^minecraft:/, '').replace(/\[.*\]$/, '');
  // Stripped logs and bark blocks are charged as the log (vanilla pieces, V2.1: stripping is an axe's use; wood is
  // really 4 logs for 3, close enough), so they are gathered as logs and swapped with the village's wood
  const w = woodPart(name);
  if (w && /(^|_)(log|wood)$/.test(w.part)) return `${w.kind}_log`;
  // A sign on a wall is the sign item (the block has none of its own)
  if (w?.part === 'wall_sign') return `${w.kind}_sign`;
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
    out.push(...(smeltOptions(this.registry).get(name) ?? []));
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
    let best = GATHER.has(name) || name === 'any:logs' || name === 'any:cobblestone' || !options.length ? gatherCost(name) : Infinity;
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
    let best: Option | null = null, bestCost = gather ? (UNOBTAINABLE[name] ? 1000 : gatherCost(name)) : Infinity;
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
      steps.push({ do: o.kind, item: n, runs, makes: runs * o.out, ...(o.kind === 'smelt' ? { input: Object.keys(o.ins)[0] } : {}) });
      if (o.kind === 'smelt') smelts += runs;
      // Surplus from a batch (6 planks make 3 doors) stays in the pool for later uses
      if (runs * o.out > need) surplus[n] = (surplus[n] ?? 0) + runs * o.out - need;
      for (const [i, q] of Object.entries(o.ins)) demand[i] = (demand[i] ?? 0) + runs * q;
    }
    steps.reverse();
    return { fromStock, gather, steps, problems, smelts };
  }
}

/** What getting the items takes: "gather ...; craft ...; smelt ... (fuel ...)"; flags what cannot be had. */
export function describeWork(p: MaterialPlan): string {
  const list = (c: Counts) => Object.entries(c).map(([n, q]) => `${q} ${label(n)}`).join(', ');
  const parts: string[] = [];
  if (Object.keys(p.gather).length) parts.push(`gather ${list(p.gather)}`);
  const crafts = p.steps.filter((s) => s.do === 'craft').map((s) => `${s.makes} ${label(s.item)}`);
  const smelts = p.steps.filter((s) => s.do === 'smelt').map((s) => `${s.makes} ${label(s.item)}`);
  if (crafts.length) parts.push(`craft ${crafts.join(', ')}`);
  if (smelts.length) parts.push(`smelt ${smelts.join(', ')} (fuel: ${p.fuel.coal ? `${p.fuel.coal} coal` : ''}${p.fuel.coal && p.fuel.planks ? ' + ' : ''}${p.fuel.planks ? `${p.fuel.planks} planks, or ${Math.ceil((p.fuel.smelts - p.fuel.coal * 8) / 8)} coal instead` : ''})`);
  if (p.problems.length) parts.push(`cannot be had: ${p.problems.join('; ')}`);
  return parts.join('; ');
}

/** One paragraph for a model or a failure message. */
export function describePlan(p: MaterialPlan): string {
  const list = (c: Counts) => Object.entries(c).map(([n, q]) => `${q} ${label(n)}`).join(', ');
  const parts = [`needs ${list(p.bill)}`];
  if (Object.keys(p.fromStock).length) parts.push(`in hand: ${list(p.fromStock)}`);
  const work = describeWork(p);
  if (work) parts.push(work);
  return parts.join('; ');
}

const PICKAXE = /^(cobblestone|stone|sandstone|red_sandstone|terracotta|coal|raw_iron)$/;

/** A plan's raw materials under the names collect takes: logs in the village's wood kind (or "logs"), cobblestone. */
export function gatherNames(gather: Counts, wood?: string): Counts {
  const merged: Counts = {};
  for (const [item, n] of Object.entries(gather)) {
    // A furnace takes any cobblestone
    const what = /_log$|^any:logs$/.test(item) ? (wood ? `${wood}_log` : 'logs') : item === 'any:cobblestone' ? 'cobblestone' : item.replace(/^any:/, '');
    merged[what] = (merged[what] ?? 0) + n;
  }
  return merged;
}

/**
 * Village tasks that gather raw materials into the storage (collect, then deposit everything), in even parts small
 * enough for two workers to share: at most 12 logs or 32 of anything else (57 cobblestone: 29 and 28). With the
 * village's wood kind, logs are gathered in that kind; without it, any logs (builders swap wood kinds).
 */
export function gatherTasks(gather: Counts, label: string, wood?: string): Array<{ title: string; detail: string }> {
  const merged = gatherNames(gather, wood);
  const tasks: Array<{ title: string; detail: string }> = [];
  for (const [what, n] of Object.entries(merged)) {
    const parts = Math.ceil(n / (/logs?$/.test(what) ? 12 : 32));
    for (let i = 0; i < parts; i++) {
      const q = Math.floor(n / parts) + (i < n % parts ? 1 : 0);
      const tool = PICKAXE.test(what) ? ' (mining it needs a pickaxe: if you have none, craft a wooden_pickaxe first; keep your tools)' : '';
      tasks.push({
        title: `Gather ${q} ${what} for ${label}${parts > 1 ? ` (${i + 1}/${parts})` : ''}`,
        detail: `collect block=${what} count=${q}, then deposit item=all into the village storage (everything you gathered, not just part of it)${tool}`,
      });
    }
  }
  return tasks;
}
