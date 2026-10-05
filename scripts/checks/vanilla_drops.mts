/**
 * Which blocks drop an item (V2.5, loot tables; offline, no server): for every item the village economy gathers or may
 * ask collect for, the blocks collect goes for today (collectTargets in mcSurvival.ts, called as it is, on
 * minecraft-data's `drops`, after its hand rule for placed blocks) against the blocks whose vanilla loot table, read from
 * the local jar, drops it to a bot (no silk touch, no shears, no fortune; the weakest tool the block needs for drops,
 * from minecraft-data's harvestTools, in hand). Vanilla drops are split into guaranteed (in every block state), by state
 * (some states only: a door's lower half, ripe wheat) and by chance (gravel's flint, short grass's seeds), with the
 * tool each block needs. Then the same for what counts as progress (collect's `items`), and a summary of minecraft-data's
 * drop lists against vanilla's for every block. Mojang's data is only read and printed, never written.
 * Usage: node_modules/.bin/tsx scripts/checks/vanilla_drops.mts [ITEM ...]
 * Env: JAR (default mc/server's), ALL=1 (every block's drop difference, not only the first few of each kind).
 */
import minecraftData from 'minecraft-data';
import { DEFAULT_JAR, itemTag, listEntries, readJson } from '../../server/src/vanillaData';
import { collectTargets } from '../../server/src/mineflayer/mcSurvival';
import { Materials, chargedItem, designBill, designBlockList, gatherNames } from '../../server/src/mineflayer/mcMaterials';
import { VILLAGE_BIOMES, centreToDesign, listPieces, pieceToDesign, readPiece } from '../../server/src/vanillaPieces';

const JAR = process.env.JAR ?? DEFAULT_JAR;
const ALL = !!process.env.ALL;
const reg = minecraftData('26.1');
// collectTargets only reads a.world.registry
const agent = { world: { registry: reg } } as unknown as Parameters<typeof collectTargets>[0];
const t0 = performance.now();
const strip = (s: string) => s.replace(/^minecraft:/, '');

// ---------------------------------------------------------------------------------------------
// Loot tables, evaluated for one block state and the tool in hand: item -> probability of at least one
// ---------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
interface Ctx { block: string; state: Record<string, string>; tool: string | null }
const unknownConds = new Set<string>(), unknownEntries = new Set<string>(), dynamics = new Map<string, string>();
/** Assumptions made (location checks: a double plant's other half is there). */
const assumed = new Map<string, string>();

function toolMatches(pred: Json, tool: string | null): boolean {
  if (pred?.predicates?.['minecraft:enchantments'] || pred?.enchantments) return false; // never enchanted (silk touch)
  if (!tool) return false;
  if (pred?.items === undefined) return true;
  const list: string[] = Array.isArray(pred.items) ? pred.items : [pred.items];
  return list.some((i) => (i.startsWith('#') ? itemTag(i, JAR).has(tool) : strip(i) === tool));
}

function stateMatches(props: Record<string, Json>, state: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(props)) {
    const s = state[k];
    if (s === undefined) return false;
    if (typeof v === 'object' && v !== null) {
      const n = Number(s);
      if (v.min !== undefined && !(n >= Number(v.min))) return false;
      if (v.max !== undefined && !(n <= Number(v.max))) return false;
    } else if (String(v) !== s) return false;
  }
  return true;
}

function cond(c: Json, ctx: Ctx): number {
  switch (strip(c.condition)) {
    case 'survives_explosion': return 1; // broken by hand, not blown up
    case 'block_state_property': return stateMatches(c.properties ?? {}, ctx.state) ? 1 : 0;
    case 'match_tool': return toolMatches(c.predicate, ctx.tool) ? 1 : 0;
    case 'inverted': return 1 - cond(c.term, ctx);
    case 'any_of': return 1 - (c.terms as Json[]).reduce((p, t) => p * (1 - cond(t, ctx)), 1);
    case 'all_of': return (c.terms as Json[]).reduce((p, t) => p * cond(t, ctx), 1);
    case 'table_bonus': return Math.min(1, c.chances[0]); // no fortune
    case 'random_chance': return typeof c.chance === 'number' ? c.chance : 0.5;
    case 'random_chance_with_enchanted_bonus': return typeof c.unenchanted_chance === 'number' ? c.unenchanted_chance : 0.5;
    case 'entity_properties': return 1; // the breaking player is there
    case 'location_check': assumed.set(ctx.block, 'location_check (the other half of a double plant is there)'); return 1;
    default: unknownConds.add(`${c.condition} (${ctx.block})`); return 0.5;
  }
}
const conds = (cs: Json[] | undefined, ctx: Ctx) => (cs ?? []).reduce((p, c) => p * cond(c, ctx), 1);

/** Probability that an entry's functions leave a count of at least 1. */
function countAtLeastOne(fns: Json[] | undefined, ctx: Ctx): number {
  let lo = 1, p = 1;
  for (const f of fns ?? []) {
    if (conds(f.conditions, ctx) < 1) continue; // conditional counts (a double slab gives 2): the plain one is enough here
    const fn = strip(f.function);
    if (fn === 'set_count' && !f.add) {
      const c = f.count;
      if (typeof c === 'number') { lo = c; p = c >= 1 ? 1 : 0; }
      else if (strip(c.type ?? '') === 'uniform') { const a = Math.floor(c.min), b = Math.floor(c.max); lo = a; p = b < 1 ? 0 : (b - Math.max(1, a) + 1) / (b - a + 1); }
      else if (strip(c.type ?? '') === 'binomial') { lo = 0; p = 1 - (1 - c.p) ** c.n; }
      else if (strip(c.type ?? '') === 'constant') { lo = c.value; p = c.value >= 1 ? 1 : 0; }
    }
  }
  return lo >= 1 ? 1 : p;
}

type Drops = Map<string, number>;
const sum = (out: Drops, item: string, p: number) => out.set(item, Math.min(1, (out.get(item) ?? 0) + p));

/** Adds an entry's drops (weighted by reach) to out; returns the chance that it succeeded (for alternatives). */
function entry(e: Json, ctx: Ctx, reach: number, out: Drops): number {
  const own = conds(e.conditions, ctx);
  const type = strip(e.type);
  if (type === 'item') {
    const p = reach * own * countAtLeastOne(e.functions, ctx);
    if (p > 0) sum(out, strip(e.name), p);
    return own;
  }
  if (type === 'tag') {
    for (const i of itemTag(e.name, JAR)) sum(out, i, reach * own);
    return own;
  }
  if (type === 'alternatives') {
    let r = 1, s = 0;
    for (const ch of e.children ?? []) {
      const sc = entry(ch, ctx, reach * own * r, out);
      s += r * sc;
      r *= 1 - sc;
    }
    return own * s;
  }
  if (type === 'group') {
    for (const ch of e.children ?? []) entry(ch, ctx, reach * own, out);
    return own;
  }
  if (type === 'sequence') {
    let r = 1;
    for (const ch of e.children ?? []) r *= entry(ch, ctx, reach * own * r, out);
    return own * r;
  }
  if (type === 'loot_table') {
    const t = typeof e.value === 'string' ? readJson(`data/minecraft/loot_table/${strip(e.value)}.json`, JAR) : e.value;
    for (const [i, p] of table(t, ctx)) sum(out, i, reach * own * p);
    return own;
  }
  if (type === 'dynamic') { dynamics.set(ctx.block, strip(e.name)); return own; }
  if (type === 'empty') return own;
  unknownEntries.add(`${e.type} (${ctx.block})`);
  return 0;
}

function table(t: Json, ctx: Ctx): Drops {
  const all: Drops = new Map();
  for (const pool of t.pools ?? []) {
    const pc = conds(pool.conditions, ctx);
    if (!pc) continue;
    const local: Drops = new Map();
    // One entry is chosen per roll among those that succeed, by weight (every block table has one entry a pool)
    const entries: Json[] = pool.entries ?? [];
    const w = entries.reduce((s, e) => s + (e.weight ?? 1), 0);
    for (const e of entries) entry(e, ctx, entries.length > 1 ? (e.weight ?? 1) / w : 1, local);
    for (const [i, p] of local) all.set(i, 1 - (1 - (all.get(i) ?? 0)) * (1 - p * pc));
  }
  return all;
}

/** Block state properties a table tests, with their values from minecraft-data (bools have none listed). */
function referencedStates(block: string, t: Json): Array<Record<string, string>> {
  const props = new Set<string>();
  const walk = (x: Json) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (strip(x.condition ?? '') === 'block_state_property') for (const k of Object.keys(x.properties ?? {})) props.add(k);
    Object.values(x).forEach(walk);
  };
  walk(t);
  const info = (reg.blocksByName[block] as Json)?.states as Array<{ name: string; type: string; values?: string[] }> | undefined;
  let combos: Array<Record<string, string>> = [{}];
  for (const p of props) {
    const s = info?.find((x) => x.name === p);
    const values = s?.values ?? (s?.type === 'bool' ? ['true', 'false'] : ['?']);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [p]: v })));
  }
  return combos;
}

// ---------------------------------------------------------------------------------------------
// Every block: what a bot gets from it
// ---------------------------------------------------------------------------------------------

/** Tools in the order a bot would have them (collect makes a wooden pickaxe itself; nothing else). */
const TOOL_ORDER = ['wooden_pickaxe', 'stone_pickaxe', 'wooden_shovel', 'wooden_axe', 'wooden_hoe', 'wooden_sword', 'copper_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
interface BlockDrops {
  tool: string | null; // needed for drops (minecraft-data's harvestTools), weakest
  items: Map<string, { kind: 'guaranteed' | 'state' | 'chance'; p: number; states?: string }>;
  table: string | null;
}
const loot = new Map<string, BlockDrops>();
const noTable: string[] = [];
const files = new Set(listEntries('data/minecraft/loot_table/blocks/', JAR).filter((f) => f.endsWith('.json')).map((f) => f.slice('data/minecraft/loot_table/blocks/'.length, -5)));
for (const b of reg.blocksArray) {
  const tools = b.harvestTools ? Object.keys(b.harvestTools).map((id) => reg.items[Number(id)].name) : null;
  const tool = tools ? TOOL_ORDER.find((t) => tools.includes(t)) ?? tools[0] : null;
  // Wall variants share the standing block's table (wall_torch drops a torch)
  const name = files.has(b.name) ? b.name : files.has(b.name.replace('wall_', '')) ? b.name.replace('wall_', '') : null;
  const items: BlockDrops['items'] = new Map();
  if (!name) {
    noTable.push(b.name);
    loot.set(b.name, { tool, items, table: null });
    continue;
  }
  const t = readJson(`data/minecraft/loot_table/blocks/${name}.json`, JAR);
  const states = referencedStates(b.name, t);
  const per = states.map((state) => table(t, { block: b.name, state, tool }));
  const names = new Set(per.flatMap((m) => [...m.keys()]));
  for (const i of names) {
    const ps = per.map((m) => m.get(i) ?? 0);
    const max = Math.max(...ps);
    if (max <= 0) continue;
    if (ps.every((p) => p >= 0.999)) items.set(i, { kind: 'guaranteed', p: 1 });
    else if (max >= 0.999) {
      const where = states.filter((_, k) => ps[k] >= 0.999).map((s) => Object.entries(s).map(([k, v]) => `${k}=${v}`).join(','));
      items.set(i, { kind: 'state', p: 1, states: where.length > 3 ? `${where.length} of ${states.length} states` : where.join(' | ') });
    } else items.set(i, { kind: 'chance', p: max });
  }
  loot.set(b.name, { tool, items, table: name });
}

/** minecraft-data's drop list for a block, as collectTargets reads it. */
const mdDrops = (b: { drops: unknown }) => (b.drops as Array<number | { drop: number | { id: number } }>).map((d) => reg.items[typeof d === 'number' ? d : typeof d.drop === 'number' ? d.drop : d.drop.id]?.name ?? '?');

// ---------------------------------------------------------------------------------------------
// collectTargets with vanilla's drops: the same name rules and placed-block rule, the droppers from the loot tables
// ---------------------------------------------------------------------------------------------

const PLACED = ['cobblestone', 'mossy_cobblestone', 'stone_bricks', 'bricks'];
function vanillaTargets(raw: string, chance: boolean) {
  const n = raw.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
  if (/^(logs?|wood|trees?|any_log)$/.test(n)) return null; // not drop-based: unchanged
  const name = reg.blocksByName[n] || reg.itemsByName[n] ? n : n.replace(/s$/, '');
  const blocks = new Set<string>(), items = new Set<string>();
  const ok = (k: string) => k === 'guaranteed' || k === 'state' || chance;
  if (reg.blocksByName[name]) {
    blocks.add(name);
    if (/_ore$/.test(name) && reg.blocksByName[`deepslate_${name}`]) blocks.add(`deepslate_${name}`);
    for (const b of blocks) for (const [i, d] of loot.get(b)!.items) if (ok(d.kind)) items.add(i);
  }
  if (reg.itemsByName[name]) {
    for (const [b, d] of loot) if (d.items.has(name) && ok(d.items.get(name)!.kind)) blocks.add(b);
    if (!reg.blocksByName[name]) items.clear();
    items.add(name);
  }
  if (blocks.size > 1) for (const p of PLACED) blocks.delete(p);
  return { blocks, items };
}

// ---------------------------------------------------------------------------------------------
// The names collect is asked for
// ---------------------------------------------------------------------------------------------

const materials = new Materials(reg);
const gatherOf = (bill: Record<string, number>) => Object.keys(gatherNames(materials.plan(bill).gather));
const economy = new Map<string, Set<string>>(); // name -> where it comes from
const add = (n: string, why: string) => { if (!economy.has(n)) economy.set(n, new Set()); economy.get(n)!.add(why); };
// What a village's buildings send to collect: the architect's block list (survival and creative) and vanilla's pieces
for (const n of designBlockList(false)) for (const g of gatherOf({ [chargedItem(n)]: 1 })) add(g, 'design blocks');
let pieces = 0;
for (const biome of VILLAGE_BIOMES)
  for (const kind of ['houses', 'town_centers'])
    for (const p of listPieces(JAR, biome, kind)) {
      try {
        const piece = readPiece(p, JAR);
        const d = kind === 'houses' ? pieceToDesign(piece, biome).design : centreToDesign(piece, biome).design;
        for (const g of gatherOf(designBill(d))) add(g, 'vanilla pieces');
        pieces++;
      } catch { /* pieces that do not import are vanilla_pieces.mts's business */ }
    }
// mcMaterials.ts GATHER (mirrored: not exported), collect calls in code and tests, then names listed for this check
for (const n of ['coal', 'raw_iron', 'raw_copper', 'raw_gold', 'white_wool', 'clay_ball', 'sand', 'red_sand', 'sandstone', 'red_sandstone', 'terracotta', 'dirt', 'gravel', 'sugar_cane', 'leather', 'vine']) add(n, 'GATHER');
for (const n of ['cobblestone', 'stone', 'logs']) add(n, 'collect calls');
for (const n of ['coal_ore', 'iron_ore']) add(n, 'brains.ts');
for (const n of ['flint', 'clay', 'copper_ore', 'gold_ore', 'snowball', 'snow_block', 'ice', 'wheat_seeds', 'wheat', 'stick', 'apple', 'oak_log', 'cobbled_deepslate', 'moss_block', 'mossy_cobblestone', 'oak_sapling', 'mud', 'packed_mud', 'coarse_dirt', 'grass_block', 'podzol',
  'snow', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'packed_ice', 'cactus', 'pumpkin', 'melon_slice', 'bamboo', 'kelp', 'short_grass', 'red_mushroom', 'brown_mushroom'])
  add(n, 'listed');
for (const b of reg.blocksArray) if (/^[a-z_]+_terracotta$/.test(b.name) && !/glazed/.test(b.name)) add(b.name, 'listed');
for (const n of process.argv.slice(2)) add(n, 'argument');
// Everything Materials could ever send to collect: the gather leaves of every item
const anyItem = new Set<string>();
for (const it of reg.itemsArray) {
  try { for (const g of gatherOf({ [it.name]: 1 })) anyItem.add(g); } catch { /* recipe cycles */ }
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;
const fmtBlock = (b: string, item: string) => {
  const d = loot.get(b)!;
  const i = d.items.get(item);
  const how = !i ? '' : i.kind === 'guaranteed' ? '' : i.kind === 'state' ? ` [${i.states}]` : ` [${pct(i.p)}]`;
  return `${b}${how}${d.tool ? ` (${d.tool})` : ''}`;
};
const yields = (b: string) => [...loot.get(b)!.items.keys()];
function compare(n: string) {
  let cur: ReturnType<typeof collectTargets> | null = null, err = '';
  try { cur = collectTargets(agent, n); } catch (e) { err = (e as Error).message.replace(/;.*/, ''); }
  const curB = new Set((cur?.blocks ?? []).map((id) => reg.blocks[id].name));
  const curI = new Set((cur?.items ?? []).map((id) => reg.items[id].name));
  const vg = vanillaTargets(n, false), va = vanillaTargets(n, true);
  const lines: string[] = [];
  const kinds = new Set<string>();
  // Blocks collect goes for that give the bot nothing it counts as progress (vanilla): collect would dig and never gain
  const nothing = [...curB].filter((b) => !yields(b).some((i) => curI.has(i)));
  if (nothing.length) {
    lines.push(`! collect goes for blocks that give it nothing it counts (${[...curI].join(',') || 'nothing'}): ${nothing.map((b) => `${b} -> ${yields(b).join(',') || 'nothing'}${loot.get(b)!.tool ? ` (${loot.get(b)!.tool})` : ''}`).join(', ')}`);
    kinds.add('nothing');
  }
  // Blocks that drop only with a tool collect never makes (it makes wooden pickaxes; stone ones come from storage)
  const noTool = [...curB].filter((b) => loot.get(b)!.tool && !/^(wooden|stone)_pickaxe$/.test(loot.get(b)!.tool!));
  if (noTool.length && noTool.length === curB.size) {
    lines.push(`! every block needs a tool collect does not make: ${noTool.map((b) => `${b} (${loot.get(b)!.tool})`).join(', ')}`);
    kinds.add('tool');
  }
  if (!vg || !va) return { n, lines, cur: curB, kinds };
  const item = reg.itemsByName[n] || reg.blocksByName[n] ? n : n.replace(/s$/, '');
  const lost = [...curB].filter((b) => !va.blocks.has(b));
  const gain = [...vg.blocks].filter((b) => !curB.has(b));
  const gainChance = [...va.blocks].filter((b) => !curB.has(b) && !vg.blocks.has(b));
  const curOnlyChance = [...curB].filter((b) => va.blocks.has(b) && !vg.blocks.has(b));
  // Nothing on either side (spawn eggs, food): no difference
  if (!curB.size && !va.blocks.size) return { n, lines: [] as string[], cur: curB, kinds: new Set<string>() };
  if (err) { lines.push(`collect today fails: "${err}"`); kinds.add('fails'); }
  if (gain.length) { lines.push(`+ vanilla adds: ${gain.map((b) => fmtBlock(b, item)).join(', ')}`); kinds.add('gain'); }
  if (gainChance.length) { lines.push(`+ vanilla adds, by chance only: ${gainChance.map((b) => fmtBlock(b, item)).join(', ')}`); kinds.add('chance'); }
  if (lost.length) { lines.push(`- not in vanilla: ${lost.join(', ')}`); kinds.add('lost'); }
  if (curOnlyChance.length) { lines.push(`~ collect goes for blocks vanilla gives it from only by chance: ${curOnlyChance.map((b) => fmtBlock(b, item)).join(', ')}`); kinds.add('onlyChance'); }
  const iGain = [...va.items].filter((i) => !curI.has(i)), iLost = [...curI].filter((i) => !va.items.has(i));
  if (cur && (iGain.length || iLost.length)) { lines.push(`progress items: ${[...curI].join(',')} -> vanilla ${[...va.items].join(',')}`); kinds.add('items'); }
  return { n, lines, cur: curB, kinds };
}

const tableBlocks = new Set([...loot.values()].map((d) => d.table));
const unused = [...files].filter((f) => !tableBlocks.has(f));
console.log(`Loot tables: ${files.size} in ${JAR}; ${reg.blocksArray.length} blocks in minecraft-data 26.1; ${noTable.length} blocks without a table (drop nothing: ${noTable.join(' ')}); ${unused.length} tables without a minecraft-data block${unused.length ? `: ${unused.join(' ')}` : ''}`);
console.log(`Bot: no silk touch, no shears, no fortune; in hand the weakest tool minecraft-data's harvestTools names (loot tables carry no tool rule). ${pieces} vanilla pieces read.`);
if (assumed.size) console.log(`Assumed: ${[...new Set(assumed.values())].join('; ')} (${[...assumed.keys()].join(' ')})`);
if (unknownConds.size || unknownEntries.size) console.log(`NOT UNDERSTOOD: ${[...unknownConds, ...unknownEntries].join('; ')}`);
if (dynamics.size) console.log(`Dynamic drops (container contents, not items): ${[...dynamics].map(([b, d]) => `${b}=${d}`).join(' ')}`);

console.log('\n== The economy\'s names: collect today (collectTargets on minecraft-data) against vanilla loot tables');
const same: string[] = [], sameListed: string[] = [];
for (const [n, why] of economy) {
  const r = compare(n);
  if (!r.lines.length) {
    // (an item no block drops on either side, leather: collect fails today as it would with vanilla)
    const blocks = r.cur.size ? `${[...r.cur].slice(0, 6).join(',')}${r.cur.size > 6 ? ` +${r.cur.size - 6}` : ''}` : 'no block drops it: collect fails';
    const from = [...why].filter((w) => w !== 'listed');
    (from.length ? same : sameListed).push(`${n} (${blocks})${from.length ? ` [${from.join(', ')}]` : ''}`);
    continue;
  }
  console.log(`${n}  [${[...why].join(', ')}]`);
  for (const l of r.lines) console.log(`    ${l}`);
}
console.log(`same blocks and progress items, names the economy posts: ${same.join('; ')}`);
console.log(`same, names only listed for this check: ${sameListed.join('; ')}`);

const others = [...anyItem].filter((n) => !economy.has(n)).sort().map(compare).filter((r) => r.lines.length);
console.log(`\n== Other gather leaves Materials could post (${[...anyItem].filter((n) => !economy.has(n)).length} more names; ${others.length} differ)`);
const groups: Array<[string, string]> = [['fails', 'collect fails today, vanilla has droppers'], ['gain', 'vanilla adds guaranteed or by-state droppers'], ['chance', 'vanilla adds chance-only droppers'], ['lost', 'collect goes for blocks vanilla does not drop it from'], ['onlyChance', 'collect goes for blocks vanilla gives it from only by chance'], ['items', 'progress items differ'], ['nothing', 'collect goes for blocks that give nothing it counts']];
for (const [k, label] of groups) {
  const list = others.filter((r) => r.kinds.has(k)).map((r) => r.n);
  if (list.length) console.log(`${label} (${list.length}): ${list.join(' ')}`);
}
if (ALL) for (const r of others) console.log(`${r.n}: ${r.lines.join(' | ')}`);
else console.log('(ALL=1 prints each one\'s blocks; or name items as arguments)');

console.log('\n== minecraft-data drop lists against vanilla, every block');
const kinds: Record<string, string[]> = { 'md lists a drop vanilla never gives the bot': [], 'md lists a chance drop as its only drop': [], 'md misses a guaranteed drop': [], 'md misses a by-state drop': [], 'md misses a chance drop': [] };
let equal = 0;
for (const b of reg.blocksArray) {
  const md = new Set(mdDrops(b));
  const v = loot.get(b.name)!;
  let diffs = 0;
  for (const i of md) {
    const d = v.items.get(i);
    if (!d) { kinds['md lists a drop vanilla never gives the bot'].push(`${b.name}:${i}`); diffs++; }
    else if (d.kind === 'chance') { kinds['md lists a chance drop as its only drop'].push(`${b.name}:${i}(${pct(d.p)})`); diffs++; }
  }
  for (const [i, d] of v.items) {
    if (md.has(i)) continue;
    diffs++;
    kinds[d.kind === 'guaranteed' ? 'md misses a guaranteed drop' : d.kind === 'state' ? 'md misses a by-state drop' : 'md misses a chance drop'].push(`${b.name}:${i}${d.kind === 'state' ? `[${d.states}]` : d.kind === 'chance' ? `(${pct(d.p)})` : ''}`);
  }
  if (!diffs) equal++;
}
console.log(`${equal} of ${reg.blocksArray.length} blocks: the same drops`);
for (const [k, list] of Object.entries(kinds)) {
  if (!list.length) continue;
  const show = ALL ? list : list.slice(0, 25);
  console.log(`${k} (${list.length}): ${show.join(' ')}${show.length < list.length ? ' ...' : ''}`);
}
const shovel = [...loot].filter(([, d]) => d.tool && /shovel/.test(d.tool) && d.items.size).map(([b]) => b);
const iron = [...loot].filter(([, d]) => d.tool && /^(iron|diamond|netherite)_/.test(d.tool) && d.items.size).map(([b]) => b);
console.log(`\nTools: blocks that drop only with a shovel (collect fails "needs wooden_shovel"; it makes only pickaxes): ${shovel.join(' ')}`);
console.log(`Blocks that need an iron pickaxe or better (no bot makes one): ${iron.join(' ')}`);
console.log(`\n${Math.round(performance.now() - t0)} ms`);
