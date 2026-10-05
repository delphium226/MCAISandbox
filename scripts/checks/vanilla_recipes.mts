/**
 * The economy's recipes against vanilla's own, read from the local jar (V2.5; offline, no server). Three parts:
 * A. smelting: the server's SMELT (mcMaterials' `smeltOptions`, built from the jar's `minecraft:smelting` recipes since
 *    V2.5) against the jar's recipes (input, count, cooking time, experience; the inputs its rule leaves out) and against
 *    the hand table it replaced (`SMELT_FALLBACK`, still used when the jar cannot be read: each of its outputs must keep
 *    its input, first);
 * B. crafting: for every item the economy's plans reach (designBlockList, GATHER, the stored designs' bills, the vanilla
 *    pieces' bills, tools and stations, and the recipe chains of all of them), minecraft-data's recipe variants against
 *    the jar's (ingredients, counts, result count; tags expanded the way minecraft-data expands them, one kind per key);
 * C. behaviour: Materials' options per item and the bills of every stored design and vanilla piece, planned with the
 *    hand table (as before V2.5), with the server's SMELT (crafting from minecraft-data, as the server plans now), and
 *    with crafting from the jar as well.
 * Mojang's data is read from the jar at run time and printed, never written. GATHER, UNOBTAINABLE and FAMILIES are read
 * from mcMaterials.ts's source.
 * Usage: node_modules/.bin/tsx scripts/checks/vanilla_recipes.mts   Env: MC_VANILLA_JAR (the server's jar setting, read
 * here too), VERBOSE=1 (every bill difference, not the first few per kind).
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import type { Design } from '../../server/src/village';
import { Materials, SMELT_FALLBACK, designBill, designBlockList, gatherNames, inWood, smeltOptions, woodPart, type Counts, type MaterialPlan, type Option } from '../../server/src/mineflayer/mcMaterials';
import { hasJar, itemTag, listEntries, readJson, vanillaJar } from '../../server/src/vanillaData';
import { VILLAGE_BIOMES, centreToDesign, listPieces, pieceToDesign, readPiece } from '../../server/src/vanillaPieces';

const JAR = vanillaJar();
const VERBOSE = !!process.env.VERBOSE;
if (!hasJar(JAR)) {
  console.log(`no jar at ${JAR}: nothing to compare`);
  process.exit(0);
}
const reg = minecraftData('26.1');
/** The server's planning: crafting from minecraft-data, smelting from the jar. */
const materials = new Materials(reg);
const serverOptions = (n: string): Option[] => (materials as unknown as { optionsFor(n: string): Option[] }).optionsFor(n);
/** The server's smelting table (output -> options). */
const SERVER_SMELT = smeltOptions(reg);
/** Planning as before V2.5: the same crafting, smelting from the hand table. */
const handSmelt = (n: string): Option[] => (SMELT_FALLBACK[n] ? [{ kind: 'smelt', out: 1, ins: { [SMELT_FALLBACK[n]]: 1 } }] : []);
const oldOptions = (n: string): Option[] => [...serverOptions(n).filter((o) => o.kind === 'craft'), ...handSmelt(n)];
const strip = (s: string) => s.replace(/^minecraft:/, '');

// ---------------------------------------------------------------------------------------------
// mcMaterials' private tables, from its source (read only)
// ---------------------------------------------------------------------------------------------
const SRC = fs.readFileSync('server/src/mineflayer/mcMaterials.ts', 'utf8');
function literal<T>(start: string, end: string): T {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error(`mcMaterials.ts: ${start} not found`);
  const j = SRC.indexOf(end, i + start.length);
  return new Function(`return ${SRC.slice(i + start.length, j + (end.startsWith('}') ? 1 : 0))}`)() as T;
}
const GATHER = literal<string[]>('const GATHER = new Set(', ');');
const UNOBTAINABLE = literal<Record<string, string>>('const UNOBTAINABLE: Record<string, string> = ', '};');
const FAMILIES = literal<Record<string, RegExp>>('const FAMILIES: Record<string, RegExp> = ', '};');
const FAMILY_OF = (name: string) => Object.keys(FAMILIES).find((f) => FAMILIES[f].test(name));
const ITEMS = Object.keys(reg.itemsByName);
const members = (token: string) => (token.startsWith('any:') ? ITEMS.filter((n) => FAMILIES[token].test(n)) : [token]);

/** The hand table (output -> input token) the jar's smelting replaced. */
const SMELT: Record<string, string> = SMELT_FALLBACK;

// ---------------------------------------------------------------------------------------------
// The jar's recipes
// ---------------------------------------------------------------------------------------------
type Ingredient = string | string[];
interface JarRecipe { file: string; type: string; result: string; count: number; slots: Ingredient[]; cookingtime?: number; experience?: number }
const unparsed: Record<string, number> = {};
const recipes: JarRecipe[] = [];
for (const file of listEntries('data/minecraft/recipe/', JAR).filter((n) => n.endsWith('.json'))) {
  const j = readJson<any>(file, JAR);
  const type = strip(String(j.type));
  const short = file.slice('data/minecraft/recipe/'.length, -5);
  const result = j.result?.id ? strip(j.result.id) : '';
  const count = j.result?.count ?? 1;
  const ok = (x: unknown): x is Ingredient => typeof x === 'string' || (Array.isArray(x) && x.every((y) => typeof y === 'string'));
  let slots: Ingredient[] | null = null;
  if (type === 'crafting_shaped' && j.key && Array.isArray(j.pattern)) {
    slots = [];
    for (const row of j.pattern as string[]) for (const ch of row) if (ch !== ' ') slots.push(j.key[ch]);
  } else if (type === 'crafting_shapeless' && Array.isArray(j.ingredients)) slots = j.ingredients;
  else if (type === 'crafting_transmute' && j.input && j.material) slots = [j.input, ...Array(j.material_count ?? 1).fill(j.material)];
  else if (/^(smelting|blasting|smoking|campfire_cooking|stonecutting)$/.test(type) && j.ingredient) slots = [j.ingredient];
  if (!slots || !result || !slots.every(ok)) {
    unparsed[type] = (unparsed[type] ?? 0) + 1;
    continue;
  }
  recipes.push({ file: short, type, result, count, slots, cookingtime: j.cookingtime, experience: j.experience });
}
/** An ingredient's items, in vanilla's order (tags resolved). */
function expand(ing: Ingredient): string[] {
  const out: string[] = [];
  for (const s of Array.isArray(ing) ? ing : [ing]) {
    if (s.startsWith('#')) for (const m of itemTag(s, JAR)) out.push(m);
    else out.push(strip(s));
  }
  return [...new Set(out)];
}
const showIng = (ing: Ingredient) => (Array.isArray(ing) ? `[${ing.map(strip).join('|')}]` : strip(ing));
const byResult = new Map<string, JarRecipe[]>();
for (const r of recipes) byResult.set(r.result, [...(byResult.get(r.result) ?? []), r]);
const CRAFTING = /^crafting_(shaped|shapeless|transmute)$/;

// ---------------------------------------------------------------------------------------------
// Recipe variants, one per ingredient choice (minecraft-data's form: one kind per shaped key, as it lists them)
// ---------------------------------------------------------------------------------------------
interface Variant { ins: Counts; out: number }
const vkey = (v: Variant) => `${Object.entries(v.ins).sort().map(([n, q]) => `${q} ${n}`).join(', ')} -> ${v.out}`;

function mdVariants(name: string): Variant[] {
  const item = reg.itemsByName[name];
  const list = (item && (reg.recipes as Record<number, any[]>)[item.id]) || [];
  return list.map((r) => {
    const ids: unknown[] = r.inShape ? r.inShape.flat() : (r.ingredients ?? []);
    const ins: Counts = {};
    for (const raw of ids) {
      const id = raw && typeof raw === 'object' ? (raw as { id: number }).id : (raw as number | null);
      if (id === null || id === undefined || id < 0) continue;
      const n = reg.items[id]?.name;
      if (n) ins[n] = (ins[n] ?? 0) + 1;
    }
    return { ins, out: r.result?.count ?? 1 };
  });
}

function jarVariants(r: JarRecipe, cap = 400): Variant[] {
  // Identical ingredients (one shaped key, or a repeated shapeless entry) take one kind together
  const groups = new Map<string, { items: string[]; n: number }>();
  for (const s of r.slots) {
    const k = JSON.stringify(s);
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { items: expand(s), n: 1 });
  }
  let combos: Counts[] = [{}];
  for (const g of groups.values()) {
    const next: Counts[] = [];
    for (const c of combos) for (const m of g.items) {
      if (next.length >= cap) break;
      next.push({ ...c, [m]: (c[m] ?? 0) + g.n });
    }
    combos = next;
  }
  const seen = new Set<string>();
  return combos.map((ins) => ({ ins, out: r.count })).filter((v) => !seen.has(vkey(v)) && !!seen.add(vkey(v)));
}

/** Variants merged as Materials.optionsFor merges them (two or more alike but for the family -> "any:" option). */
function mergeAsMaterials(vs: Variant[]): Option[] {
  const groups = new Map<string, { exact: Option; general: Option; n: number }>();
  for (const v of vs) {
    const general: Counts = {};
    for (const [n, q] of Object.entries(v.ins)) {
      const g = FAMILY_OF(n) ?? n;
      general[g] = (general[g] ?? 0) + q;
    }
    const key = JSON.stringify(Object.entries(general).sort());
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { exact: { kind: 'craft', out: v.out, ins: v.ins }, general: { kind: 'craft', out: v.out, ins: general }, n: 1 });
  }
  return [...groups.values()].map((g) => (g.n > 1 ? g.general : g.exact));
}

// ---------------------------------------------------------------------------------------------
// The server's SMELT (built from the jar by mcMaterials), and Materials planning with the hand table
// ---------------------------------------------------------------------------------------------
const SMELTING = recipes.filter((r) => r.type === 'smelting');
const jarSmeltOptions = (name: string): Option[] => SERVER_SMELT.get(name) ?? [];
/** Vanilla inputs the server's rule leaves out, by output (ores, unobtainable, tools and armour, no way to get them). */
const excludedInputs = new Map<string, string[]>();
for (const r of SMELTING) {
  const used = new Set(jarSmeltOptions(r.result).flatMap((o) => Object.keys(o.ins).flatMap(members)));
  const left = expand(r.slots[0]).filter((m) => !used.has(m));
  if (left.length) excludedInputs.set(r.result, [...new Set([...(excludedInputs.get(r.result) ?? []), ...left])]);
}
/**
 * Recolouring recipes (a wool of any other colour and a dye -> this wool): every colour is made from every other, and
 * Materials' cost search, which memoises nothing on a cycle, never finishes on them (white_wool hung the first run of
 * this script). A variant is left out when one of its ingredients is a choice among several items and is itself crafted
 * from this recipe's result. minecraft-data lists one variant (black_wool) and so never hit it.
 */
const craftsFrom = new Map<string, Set<string>>();
for (const r of recipes) if (CRAFTING.test(r.type)) for (const s of r.slots) for (const m of expand(s)) craftsFrom.set(r.result, (craftsFrom.get(r.result) ?? new Set()).add(m));
const recoloured = new Set<string>();
function recolours(r: JarRecipe, v: Variant): boolean {
  // A choice among two or more items that are themselves made from this result (sandstone_slab <- chiseled_sandstone,
  // one partner, is an ordinary cycle Materials handles)
  const hit = r.slots.some((s) => { const back = expand(s).filter((m) => craftsFrom.get(m)?.has(r.result)); return back.length > 1 && back.some((m) => v.ins[m]); });
  if (hit) recoloured.add(r.file);
  return hit;
}
const jarCraftCache = new Map<string, Option[]>();
function jarCraftOptions(name: string): Option[] {
  if (name.startsWith('any:')) return oldOptions(name).filter((o) => o.kind === 'craft'); // FAMILY_RECIPES (any:planks <- any:logs)
  const c = jarCraftCache.get(name);
  if (c) return c;
  const vs = (byResult.get(name) ?? []).filter((r) => CRAFTING.test(r.type)).flatMap((r) => jarVariants(r).filter((v) => !recolours(r, v)));
  const out = mergeAsMaterials(vs);
  jarCraftCache.set(name, out);
  return out;
}
function patched(options: (n: string) => Option[]): Materials {
  const m = new Materials(reg);
  const cache = new Map<string, Option[]>();
  (m as unknown as { optionsFor(n: string): Option[] }).optionsFor = (n: string) => {
    const c = cache.get(n);
    if (c) return c;
    const out = options(n);
    cache.set(n, out);
    return out;
  };
  return m;
}
/** Before V2.5 (the hand table); the server as it plans now; and crafting from the jar as well. */
const hand = patched(oldOptions);
const smeltJar = materials;
const allJar = patched((n) => [...jarCraftOptions(n), ...(n.startsWith('any:') ? [] : jarSmeltOptions(n))]);

// ---------------------------------------------------------------------------------------------
// What the economy reaches: seeds, then every item its plans craft, smelt or gather
// ---------------------------------------------------------------------------------------------
const bills: Array<{ name: string; bill: Counts }> = [];
const seenBills = new Set<string>();
const addBill = (name: string, bill: Counts) => {
  const k = JSON.stringify(Object.entries(bill).sort());
  if (seenBills.has(k) || !Object.keys(bill).length) return;
  seenBills.add(k);
  bills.push({ name, bill });
};
for (const file of ['mc/server/villages.json', 'mc/testserver/villages.json']) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const vs: any[] = Array.isArray(data) ? data : Object.values(data.villages ?? data);
  for (const v of vs) for (const d of Object.values(v.designs ?? {}) as Design[]) {
    try { addBill(`${v.name}/${d.name}`, designBill(d)); } catch { /* a malformed old design */ }
  }
}
const storedBills = bills.length;
let pieces = 0;
for (const biome of VILLAGE_BIOMES) for (const kind of ['houses', 'town_centers']) for (const p of listPieces(JAR, biome, kind)) {
  try {
    const piece = readPiece(p, JAR);
    const d = kind === 'houses' ? pieceToDesign(piece, biome).design : centreToDesign(piece, biome).design;
    // In the piece's commonest wood, as a village builds it (scripts/checks/vanilla_pieces.mts)
    const raw = designBill(d);
    const kinds: Counts = {};
    for (const [n, q] of Object.entries(raw)) { const w = woodPart(n); if (w) kinds[w.kind] = (kinds[w.kind] ?? 0) + q; }
    addBill(`vanilla ${p}`, inWood(raw, Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0]));
    pieces++;
  } catch { /* pieces without an entrance or door are not imported */ }
}
const TOOLS = ['chest', 'crafting_table', 'furnace', 'stick', 'torch', 'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe', 'wooden_shovel', 'stone_shovel', 'charcoal'];
const seeds = new Set<string>([...designBlockList(false), ...GATHER, ...TOOLS, ...Object.keys(SMELT), ...Object.keys(UNOBTAINABLE)]);
for (const { bill } of bills) for (const n of Object.keys(bill)) seeds.add(n);
// Wooden parts in every overworld wood (builders swap to the village's kind)
const WOODS9 = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
for (const n of [...seeds]) { const w = woodPart(n); if (w && !w.part.startsWith('stripped_')) for (const k of WOODS9) seeds.add(`${k}_${w.part}`); }
const reach = new Set<string>();
for (const m of [hand, smeltJar, allJar]) for (const n of seeds) {
  if (!reg.itemsByName[n]) continue;
  const p = m.plan({ [n]: 1 });
  for (const t of [n, ...p.steps.flatMap((s) => [s.item, s.input ?? '']), ...Object.keys(p.gather)]) for (const x of members(t)) if (x && reg.itemsByName[x]) reach.add(x);
}
const sorted = [...reach].sort();

// ---------------------------------------------------------------------------------------------
// A. Smelting
// ---------------------------------------------------------------------------------------------
console.log(`jar ${JAR}: ${recipes.length} recipes read${Object.keys(unparsed).length ? ` (not read: ${Object.entries(unparsed).map(([t, n]) => `${n} ${t}`).join(', ')})` : ''}; minecraft-data ${reg.version.minecraftVersion}`);
console.log(`reach: ${reach.size} items (${seeds.size} seeds; ${storedBills} stored design bills and ${pieces} vanilla pieces, ${bills.length} distinct bills)`);
console.log(`\n== A. Smelting: the hand table (SMELT_FALLBACK, ${Object.keys(SMELT).length} entries) against the jar's ${SMELTING.length} smelting recipes`);
const fmtSmelt = (r: JarRecipe) => `${r.file}: ${showIng(r.slots[0])} x${r.count}, ${r.cookingtime}t, ${r.experience}xp`;
for (const [out, input] of Object.entries(SMELT).sort()) {
  const vr = SMELTING.filter((r) => r.result === out);
  const ours = members(input);
  const theirs = [...new Set(vr.flatMap((r) => expand(r.slots[0])))];
  const notes: string[] = [];
  if (!vr.length) notes.push('NO vanilla smelting recipe');
  const wrong = ours.filter((m) => !theirs.includes(m));
  const extra = theirs.filter((m) => !ours.includes(m));
  if (wrong.length) notes.push(`MISMATCH: vanilla does not smelt ${wrong.join(', ')} into ${out}${wrong.map((w) => { const o = SMELTING.find((r) => expand(r.slots[0]).includes(w)); return o ? ` (${w} -> ${o.result})` : ` (${w}: no smelting)`; }).join('')}`);
  if (extra.length) notes.push(`vanilla also takes ${extra.join(', ')}`);
  if (vr.some((r) => r.count !== 1)) notes.push('MISMATCH: result count is not 1');
  if (vr.some((r) => r.cookingtime !== 200)) notes.push('cooking time is not 200 ticks');
  console.log(`${out} <- ${input}${input.startsWith('any:') ? ` {${ours.join(', ')}}` : ''}\n    vanilla ${vr.map(fmtSmelt).join('; ') || '-'}\n    ${notes.length ? notes.join('; ') : 'same'}`);
}
// The server's table: every output with its options in order (the first wins a tie), and what its rule left out
const fmtOpt = (o: Option) => `${Object.keys(o.ins)[0]}${o.out !== 1 ? ` x${o.out}` : ''}`;
console.log(`\n== A2. The server's SMELT (smeltOptions, from the jar): ${SERVER_SMELT.size} outputs`);
for (const [out, os] of [...SERVER_SMELT].sort()) {
  const vr = SMELTING.filter((r) => r.result === out);
  const notes: string[] = [];
  if (!vr.length) notes.push('NO vanilla smelting recipe (the hand table: is the jar unread?)');
  const wrong = os.flatMap((o) => Object.keys(o.ins).flatMap(members)).filter((m) => !vr.some((r) => expand(r.slots[0]).includes(m)));
  if (wrong.length) notes.push(`not vanilla's: ${wrong.join(', ')}${os.some((o) => FAMILIES[Object.keys(o.ins)[0]]) ? ' (a family member vanilla does not smelt)' : ''}`);
  if (excludedInputs.get(out)) notes.push(`left out: ${excludedInputs.get(out)!.join(', ')}`);
  if (!SMELT[out]) notes.push('new (not in the hand table)');
  console.log(`  ${out} <- ${os.map(fmtOpt).join(' | ')}${notes.length ? `   [${notes.join('; ')}]` : ''}`);
}
// Parity: each hand-table output keeps a smelt option with its input, first (stone from cobblestone, plain: vanilla smelts
// no other cobblestone kind into stone)
const EXPECT: Record<string, string> = { ...SMELT, stone: 'cobblestone' };
const parity = Object.entries(EXPECT).map(([out, input]) => {
  const os = SERVER_SMELT.get(out) ?? [];
  const at = os.findIndex((o) => Object.keys(o.ins)[0] === input && o.out === 1);
  return at === 0 ? '' : at > 0 ? `${out} <- ${input} is option ${at + 1}, not first` : `${out} <- ${input} MISSING`;
}).filter(Boolean);
console.log(`Parity with the hand table (${Object.keys(EXPECT).length} outputs): ${parity.length ? `FAILED: ${parity.join('; ')}` : 'every output keeps its input, first'}`);
if (parity.length) process.exitCode = 1;
const smeltOuts = [...new Set(SMELTING.map((r) => r.result))];
const lacking = smeltOuts.filter((o) => !SERVER_SMELT.has(o) && reach.has(o));
console.log(`\nVanilla smelting for items the economy reaches that the server's SMELT lacks (${lacking.length}):`);
for (const o of lacking) {
  const opts = serverOptions(o).map((x) => `${x.kind} ${vkey({ ins: x.ins, out: x.out })}`).join(' | ') || (GATHER.includes(o) ? 'gathered (GATHER)' : 'none: gathered as it is');
  console.log(`  ${o}: ${SMELTING.filter((r) => r.result === o).map(fmtSmelt).join('; ')}\n      now: ${opts}`);
}
const fromReach = SMELTING.filter((r) => !SERVER_SMELT.has(r.result) && !reach.has(r.result) && expand(r.slots[0]).some((m) => reach.has(m)));
console.log(`\nVanilla smelting with an input the economy reaches, output outside it and not in the server's SMELT (${fromReach.length}):`);
console.log(`  ${fromReach.map((r) => `${r.result} <- ${expand(r.slots[0]).filter((m) => reach.has(m)).join('|')}`).join('; ') || '-'}`);
const otherCook = recipes.filter((r) => /^(blasting|smoking|campfire_cooking)$/.test(r.type) && reach.has(r.result));
if (otherCook.length) console.log(`Blasting/smoking/campfire recipes for reached items (no blast furnace or smoker in the economy): ${otherCook.map((r) => `${r.result} (${r.type})`).join(', ')}`);
console.log(`Smelting inputs the server's rule leaves out for reached or hand-table outputs (ores, unobtainable, tools and armour, no way to get them): ${[...excludedInputs].filter(([o]) => reach.has(o) || SMELT[o]).map(([o, ins]) => `${o} <- ${ins.join('|')}`).join('; ') || 'none'}`);

// ---------------------------------------------------------------------------------------------
// B. Crafting
// ---------------------------------------------------------------------------------------------
console.log(`\n== B. Crafting: minecraft-data against the jar, ${sorted.length} items the economy reaches`);
let same = 0;
const sameNames: string[] = [];
const diffLines: string[] = [];
for (const n of sorted) {
  const md = mdVariants(n);
  const jr = (byResult.get(n) ?? []).filter((r) => CRAFTING.test(r.type));
  const jv = jr.flatMap((r) => jarVariants(r));
  const mk = new Map(md.map((v) => [vkey(v), v])), jk = new Map(jv.map((v) => [vkey(v), v]));
  const onlyMd = [...mk.keys()].filter((k) => !jk.has(k));
  const onlyJar = [...jk.keys()].filter((k) => !mk.has(k));
  if (!onlyMd.length && !onlyJar.length) { same++; if (md.length) sameNames.push(n); continue; }
  // Result-count differences: the same ingredients, another count
  const ingr = (k: string) => k.replace(/ -> \d+$/, '');
  const countDiff = onlyMd.filter((k) => onlyJar.some((j) => ingr(j) === ingr(k)));
  const lines = [`${n}: minecraft-data ${md.length} variant(s), jar ${jr.length} recipe(s) [${jr.map((r) => `${r.file} ${r.type.replace('crafting_', '')}: ${r.slots.map(showIng).filter((s, i, a) => a.indexOf(s) === i).map((s) => `${r.slots.filter((x) => showIng(x) === s).length}x ${s}`).join(' + ')} -> ${r.count}`).join('; ')}]`];
  if (countDiff.length) lines.push(`    RESULT COUNT differs: ${countDiff.map((k) => `md ${k} vs jar ${onlyJar.find((j) => ingr(j) === ingr(k))}`).join('; ')}`);
  const om = onlyMd.filter((k) => !countDiff.includes(k)), oj = onlyJar.filter((k) => !countDiff.some((c) => ingr(c) === ingr(k)));
  const cap = (l: string[]) => (l.length > 8 && !VERBOSE ? [...l.slice(0, 8), `... ${l.length - 8} more`] : l);
  if (om.length) lines.push(`    only in minecraft-data (${om.length}): ${cap(om).join(' | ')}`);
  if (oj.length) lines.push(`    only in the jar (${oj.length}): ${cap(oj).join(' | ')}`);
  diffLines.push(lines.join('\n'));
}
console.log(`same variants: ${same} items (${sameNames.length} with a recipe)`);
console.log(diffLines.join('\n'));
// Every item either source has a crafting recipe for, in one line each way (beyond the economy's reach)
{
  const names = new Set<string>([...recipes.filter((r) => CRAFTING.test(r.type)).map((r) => r.result), ...Object.keys(reg.recipes).map((id) => reg.items[Number(id)]?.name).filter(Boolean)]);
  const mdOnly: string[] = [], jarOnly: string[] = [], countDiff: string[] = [], extraMd: string[] = [];
  let differ = 0;
  for (const n of names) {
    const md = mdVariants(n), jv = (byResult.get(n) ?? []).filter((r) => CRAFTING.test(r.type)).flatMap((r) => jarVariants(r));
    if (!jv.length && md.length) { mdOnly.push(n); continue; }
    if (jv.length && !md.length) { jarOnly.push(n); continue; }
    const jk = new Set(jv.map(vkey)), mk = new Set(md.map(vkey));
    const om = [...mk].filter((k) => !jk.has(k)), oj = [...jk].filter((k) => !mk.has(k));
    if (om.length || oj.length) differ++;
    const ingr = (k: string) => k.replace(/ -> \d+$/, '');
    for (const k of om) (oj.some((j) => ingr(j) === ingr(k)) ? countDiff : extraMd).push(`${n}: ${k}`);
  }
  console.log(`All ${names.size} crafted items: ${differ} differ in variants; crafted only in minecraft-data: ${mdOnly.join(', ') || 'none'}; only in the jar: ${jarOnly.length ? `${jarOnly.length} (${jarOnly.slice(0, 12).join(', ')}${jarOnly.length > 12 ? ', ...' : ''})` : 'none'}; result counts differing: ${countDiff.join('; ') || 'none'}; minecraft-data variants vanilla does not allow: ${extraMd.slice(0, 10).join('; ') || 'none'}${extraMd.length > 10 ? `; ... ${extraMd.length - 10} more` : ''}`);
}
const cutters = sorted.filter((n) => (byResult.get(n) ?? []).some((r) => r.type === 'stonecutting'));
console.log(`Stonecutter recipes for reached items (the economy has no stonecutter): ${cutters.length} items, e.g. ${cutters.slice(0, 8).map((n) => { const r = byResult.get(n)!.find((x) => x.type === 'stonecutting')!; return `${n} ${r.count} <- 1 ${showIng(r.slots[0])}`; }).join(', ')}`);

// ---------------------------------------------------------------------------------------------
// C. Behaviour: options and plans
// ---------------------------------------------------------------------------------------------
console.log(`\n== C. Behaviour: Materials' options per reached item (merged as Materials merges them)`);
const optKey = (o: Option) => `${o.kind} ${vkey({ ins: o.ins, out: o.out })}`;
const optDiff = (label: string, get: (n: string) => Option[], only: 'smelt' | 'craft') => {
  let n = 0;
  for (const name of sorted) {
    const a = oldOptions(name).filter((o) => o.kind === only).map(optKey), b = get(name).filter((o) => o.kind === only).map(optKey);
    const lost = a.filter((k) => !b.includes(k)), gained = b.filter((k) => !a.includes(k));
    if (!lost.length && !gained.length) continue;
    n++;
    console.log(`  ${label} ${name}:${lost.length ? ` drops ${lost.join(' | ')}` : ''}${gained.length ? ` adds ${(gained.length > 6 && !VERBOSE ? [...gained.slice(0, 6), `... ${gained.length - 6} more`] : gained).join(' | ')}` : ''}`);
  }
  if (!n) console.log(`  ${label}: no differences`);
};
optDiff('smelt (jar SMELT)', (n) => (n.startsWith('any:') ? [] : jarSmeltOptions(n)), 'smelt');
optDiff('craft (jar recipes)', jarCraftOptions, 'craft');

console.log(`\n== C2. Plans: ${bills.length} distinct bills (stored designs and vanilla pieces, as materialTasks plans them) and each reached item alone`);
const planOf = (m: Materials, bill: Counts) => {
  const p = m.plan(bill);
  return m.plan({ ...bill, crafting_table: 1, ...(p.fuel.smelts ? { furnace: 1 } : {}) });
};
const summary = (p: MaterialPlan) => `gather ${Object.entries(p.gather).sort().map(([n, q]) => `${q} ${n}`).join(', ')}; smelts ${p.fuel.smelts}; steps ${p.steps.map((s) => `${s.do} ${s.item}${s.input ? `<${s.input}` : ''} x${s.runs}`).sort().join(', ')}${p.problems.length ? `; problems ${p.problems.join('; ')}` : ''}`;
function comparePlans(label: string, m: Materials) {
  const kinds = new Map<string, string[]>();
  let changed = 0;
  const cases = [...bills, ...sorted.map((n) => ({ name: `item ${n}`, bill: { [n]: 1 } as Counts }))];
  for (const { name, bill } of cases) {
    const a = planOf(hand, bill), b = planOf(m, bill);
    const sa = summary(a), sb = summary(b);
    if (sa === sb) continue;
    changed++;
    // Group by what changed in the gather list and steps, so one cause reads once
    const ga = new Set(Object.keys(a.gather)), gb = new Set(Object.keys(b.gather));
    const ka = new Set(a.steps.map((s) => `${s.do} ${s.item}${s.input ? `<${s.input}` : ''}`)), kb = new Set(b.steps.map((s) => `${s.do} ${s.item}${s.input ? `<${s.input}` : ''}`));
    const sig = [
      ...[...ga].filter((x) => !gb.has(x)).map((x) => `-gather ${x}`), ...[...gb].filter((x) => !ga.has(x)).map((x) => `+gather ${x}`),
      ...[...ka].filter((x) => !kb.has(x)).map((x) => `-${x}`), ...[...kb].filter((x) => !ka.has(x)).map((x) => `+${x}`),
      ...(a.problems.join() !== b.problems.join() ? [`problems: ${a.problems.join('; ') || '-'} => ${b.problems.join('; ') || '-'}`] : []),
    ].join(', ') || 'same items, other counts';
    // What the gather tasks ask for (collect names, merged as gatherTasks merges them)
    const ta = JSON.stringify(Object.entries(gatherNames(a.gather)).sort()), tb = JSON.stringify(Object.entries(gatherNames(b.gather)).sort());
    const k = `${sig} (${ta === tb ? 'gather tasks same' : 'GATHER TASKS DIFFER'})`;
    const l = kinds.get(k) ?? [];
    l.push(`${name}\n        hand: ${sa}\n        new: ${sb}`);
    kinds.set(k, l);
  }
  console.log(`${label}: ${changed} of ${cases.length} plans change, ${kinds.size} kinds of change`);
  for (const [sig, l] of [...kinds].sort((x, y) => y[1].length - x[1].length)) {
    console.log(`  [${l.length}] ${sig}`);
    for (const e of VERBOSE ? l : l.slice(0, 2)) console.log(`      ${e}`);
  }
}
comparePlans('C2a. The server (SMELT from the jar, crafting from minecraft-data) against the hand table', smeltJar);
comparePlans('C2b. SMELT and crafting from the jar against the hand table', allJar);
// Stock that vanilla would let a plan use: red sand for glass (no family joins sand and red sand, so the cheaper sand
// option is chosen and red sand in hand stays unused either way)
for (const [bill, have] of [[{ glass: 4 }, { red_sand: 4 }], [{ stone: 4 }, { cobbled_deepslate: 4 }], [{ charcoal: 2 }, { stripped_oak_log: 2 }]] as Array<[Counts, Counts]>) {
  const a = hand.plan(bill, have), b = smeltJar.plan(bill, have);
  console.log(`probe ${JSON.stringify(bill)} with ${JSON.stringify(have)} in hand: hand table from stock ${JSON.stringify(a.fromStock)}, gather ${JSON.stringify(a.gather)}; jar SMELT from stock ${JSON.stringify(b.fromStock)}, gather ${JSON.stringify(b.gather)}`);
}
console.log(`(C2b leaves out recolouring recipes, which hang Materials' cost search: ${[...recoloured].sort().join(', ') || 'none met'})`);
