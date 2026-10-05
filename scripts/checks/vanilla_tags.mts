/**
 * The Minecraft adapter's block and item lists (mcBlocks.ts, V2.5) as built from vanilla's tags against the hand rules
 * they replaced (HAND, the fallback without the jar); no server, nothing written. Prints per list: the hand rule's size
 * over minecraft-data's 26.1 blocks or items, the derived size, "vanilla adds" (derived, not hand), "vanilla lacks"
 * (hand, not derived), hand names that are not 26.1 blocks/items, hand patterns that match nothing, and derived names
 * minecraft-data does not know. Lists only solid blocks reach are compared within solid blocks (the rest has no effect).
 * Then the waterlogged states: mcUtil's wet table against prismarine-block's `waterlogged` property for every state of
 * every block with an empty box and a waterlogged property (0 mismatches expected), and which natural blocks have one.
 * Usage: node_modules/.bin/tsx scripts/checks/vanilla_tags.mts [LIST ...]   (LIST: a list's id, e.g. NATURAL, or
 *        WATERLOGGED; a shared part's id, e.g. GROUND, prints its members)
 * Env: MC_VANILLA_JAR (default mc/server's), VERBOSE=1 (print both full sets).
 */
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { hasJar, vanillaJar } from '../../server/src/vanillaData';
import { DEFS, HAND, WET, deriveSets } from '../../server/src/mineflayer/mcBlocks';
import { stateTables } from '../../server/src/mineflayer/mcUtil';

/** Where each list is used, and which blocks reach its test. */
const META: Record<string, { file: string; note: string; within?: 'solid' }> = {
  NATURAL_GROUND: { file: 'mcBuild.ts', within: 'solid', note: "find_site: a column's top (solid, not NON_GROUND) that is not this counts as built" },
  NATURAL: { file: 'mcBuild.ts', note: 'prepare_site clears columns of only these; build/build_box call anything else "an existing structure"' },
  LIQUID: { file: 'mcBuild.ts', note: "find_site's surface read: a column topped by one of these (or a waterlogged state with an empty box) is water" },
  NON_GROUND: { file: 'mcBuild.ts', within: 'solid', note: "find_site's surface read passes over solid blocks of these" },
  BUILD_ISLOG: { file: 'mcBuild.ts', note: "mcBuild's isLog: the surface read's tree count, treeAt's log search (felling on plots)" },
  WALK_DIG: { file: 'botAgent.ts', within: 'solid', note: "the pathfinder's blocksCantBreak is every block not in this (walks may dig only these)" },
  WET: { file: 'mcUtil.ts', note: 'tables().wet (wetAt, wetAbove, wetOver, wetSide; the mine); open is an empty box and not wet (exposedAt, openAt)' },
  FALLING: { file: 'mcUtil.ts, mcMine.ts', note: 'wetOver: water above a stack of these comes down; the mine: a ceiling of these is no solid ceiling' },
  JUNK: { file: 'mcStorage.ts', note: 'deposit "all" keeps these back (unless a claimed collect task of the agent names the item, F132)' },
  TOOL: { file: 'mcStorage.ts', note: 'deposit "all" keeps tools' },
  WILD_GROUND: { file: 'mcSurvival.ts', note: 'fallen-tree check: at least half the row must lie on these' },
  TREE_LOG: { file: 'mcSurvival.ts, mcBuild.ts', note: "felling and collect's tree logs, find_site's wood count, the preparer's logs" },
  MINE_DIGGABLE: { file: 'mcMine.ts', within: 'solid', note: 'the mine digs only these (a solid cell not in it ends the tunnel: "not natural ground")' },
  MINE_STONE: { file: 'mcMine.ts', note: "the mine's stairs end in (and its tunnels need) these" },
  RESCUE_DIGGABLE: { file: 'mcRescue.ts', within: 'solid', note: 'the stuck rescue climbs (digs) through only these' },
  ATLAS_LOG: { file: 'mcAtlas.ts', note: "the atlas's tree cells and wood kinds" },
  ATLAS_LEAF: { file: 'mcAtlas.ts', note: "the atlas's canopy cells" },
  ATLAS_WATER: { file: 'mcAtlas.ts', note: "the atlas's water cells (lava is tested first)" },
  ATLAS_SKIP: { file: 'mcAtlas.ts', within: 'solid', note: 'the atlas passes over solid blocks of these (not ground; logs and leaves are taken as trees before this test)' },
};

const VERBOSE = !!process.env.VERBOSE;
const JAR = vanillaJar();
const reg = minecraftData('26.1');
const blocks = reg.blocksArray;
const universe = {
  block: new Set(blocks.map((b) => b.name)),
  item: new Set(reg.itemsArray.map((i) => i.name)),
};
const solid = new Set(blocks.filter((b) => b.boundingBox === 'block').map((b) => b.name));

/** Top-level alternatives of a regex source (split on "|" outside groups and classes). */
function alternatives(src: string): string[] {
  const out: string[] = [];
  let depth = 0, cls = false, cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { cur += c + src[++i]; continue; }
    if (cls) { if (c === ']') cls = false; }
    else if (c === '[') cls = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** A regex's literal names ("^(a|b)$" groups and "^a$") and its patterns, each as a regex of its own. */
function tokens(re: RegExp): { names: string[]; patterns: RegExp[] } {
  const names: string[] = [], patterns: RegExp[] = [];
  for (const alt of alternatives(re.source)) {
    const group = /^\^\((.*)\)\$$/.exec(alt) ?? /^\^([a-z0-9_]+)\$$/.exec(alt);
    if (group) {
      for (const t of alternatives(group[1])) {
        if (/^[a-z0-9_]+$/.test(t)) names.push(t);
        else patterns.push(new RegExp(`^(?:${t})$`));
      }
    } else patterns.push(new RegExp(alt));
  }
  return { names, patterns };
}

const fmt = (s: Iterable<string>) => {
  const a = [...s].sort();
  return a.length ? `${a.length}: ${a.join(' ')}` : '0';
};

const only = process.argv.slice(2);
const t0 = Date.now();
let problems = 0;
if (!hasJar(JAR)) console.log(`no jar at ${JAR}: no lists to compare (the adapter uses HAND for all of them)`);
else {
  const derivedAll = deriveSets(JAR);
  for (const d of DEFS) {
    if (only.length && !only.includes(d.id)) continue;
    const der = derivedAll.get(d.id)!;
    const rule = HAND[d.id];
    const meta = META[d.id];
    if (!rule) {
      if (only.length || VERBOSE) console.log(`\n== ${d.id} (shared part)\n   derived ${fmt(der)}`);
      continue;
    }
    if (!meta) {
      console.log(`\n== ${d.id}: no entry in this script's META`);
      problems++;
    }
    const uni = universe[d.kind];
    const test = typeof rule === 'function' ? rule : (n: string) => rule.test(n);
    const hand = new Set([...uni].filter(test));
    const within = meta?.within;
    const inScope = (n: string) => d.kind !== 'block' || !within || solid.has(n);
    const adds = [...der].filter((n) => uni.has(n) && !hand.has(n));
    const lacks = [...hand].filter((n) => !der.has(n));
    console.log(`\n== ${d.id}  ${meta?.file ?? ''}`);
    if (meta) console.log(`   ${meta.note}`);
    console.log(`   definition: ${[...(d.use ?? []).map((u) => `[${u}]`), ...(d.tags ?? []).map((t) => `#${t}`)].join(' + ')}${d.extras?.length ? ` + extras(${d.extras.length})` : ''}${d.exclude?.length ? ` - exclude(${d.exclude.length})` : ''}`);
    console.log(`   hand ${hand.size} ${d.kind}s, derived ${[...der].filter((n) => uni.has(n)).length}${within ? ` (compared within ${within} blocks)` : ''}`);
    const addsIn = adds.filter(inScope), addsOut = adds.filter((n) => !inScope(n));
    const lacksIn = lacks.filter(inScope), lacksOut = lacks.filter((n) => !inScope(n));
    console.log(`   vanilla adds ${fmt(addsIn)}`);
    console.log(`   vanilla lacks ${fmt(lacksIn)}`);
    if (within && (addsOut.length || lacksOut.length)) console.log(`   (outside ${within}, no effect: adds ${fmt(addsOut)}; lacks ${fmt(lacksOut)})`);
    if (rule instanceof RegExp) {
      const { names, patterns } = tokens(rule);
      const notReal = names.filter((n) => !uni.has(n));
      const deadPatterns = patterns.filter((p) => ![...uni].some((n) => p.test(n))).map((p) => p.source);
      if (notReal.length) console.log(`   hand names not 26.1 ${d.kind}s: ${notReal.join(' ')}`);
      if (deadPatterns.length) console.log(`   hand patterns matching nothing: ${deadPatterns.join(' ')}`);
    }
    const unknown = [...der].filter((n) => !uni.has(n));
    if (unknown.length) console.log(`   derived names minecraft-data 26.1 does not know: ${unknown.join(' ')}`);
    if (VERBOSE) console.log(`   hand ${fmt(hand)}\n   derived ${fmt(der)}`);
  }
  // Every list the adapter uses has a hand rule, and the atlas's wood kinds come from names ending in _log
  for (const id of Object.keys(HAND)) if (!DEFS.some((d) => d.id === id)) { console.log(`\n!! HAND ${id} has no definition`); problems++; }
  const oddLogs = [...derivedAll.get('ATLAS_LOG')!].filter((n) => !n.endsWith('_log'));
  if (oddLogs.length) { console.log(`\n!! ATLAS_LOG names not ending in _log (the atlas's wood kinds): ${oddLogs.join(' ')}`); problems++; }
}

// Waterlogged states: mcUtil's wet table against prismarine-block, for every state of every empty-box waterloggable block
if (!only.length || only.includes('WATERLOGGED')) {
  const Block = prismarineBlock('26.1');
  const { wet, open } = stateTables(reg);
  const wl = blocks.filter((b) => (b.states ?? []).some((s) => s.name === 'waterlogged'));
  const empty = wl.filter((b) => b.boundingBox === 'empty');
  let states = 0, wetStates = 0;
  const mismatches: string[] = [];
  for (const b of empty)
    for (let s = b.minStateId; s <= b.maxStateId; s++) {
      states++;
      const logged = Block.fromStateId(s, 0).getProperties().waterlogged === true;
      const expect = logged || WET.has(b.name);
      if (expect) wetStates++;
      if ((wet[s] === 1) !== expect || (open[s] === 1) === expect) mismatches.push(`${b.name}#${s - b.minStateId} (waterlogged ${logged}, wet ${wet[s]}, open ${open[s]})`);
    }
  // A solid waterloggable block is never wet by its state (leaves, slabs, stairs)
  for (const b of wl.filter((x) => x.boundingBox === 'block'))
    for (let s = b.minStateId; s <= b.maxStateId; s++) if (wet[s] === 1 && !WET.has(b.name)) mismatches.push(`${b.name}#${s - b.minStateId} (solid, wet)`);
  problems += mismatches.length;
  console.log(`\n== WATERLOGGED: ${wl.length} blocks have a waterlogged state, ${empty.length} of them an empty box (${states} states, ${wetStates} wet)`);
  console.log(`   wet table vs prismarine-block: ${mismatches.length} mismatches${mismatches.length ? `: ${mismatches.slice(0, 20).join(', ')}` : ''}`);
  if (hasJar(JAR)) {
    const nat = deriveSets(JAR).get('NATURAL')!;
    console.log(`   natural (in NATURAL), empty box (wet when waterlogged): ${fmt(empty.filter((b) => nat.has(b.name)).map((b) => b.name))}`);
    console.log(`   natural, solid box (never wet): ${fmt(wl.filter((b) => b.boundingBox === 'block' && nat.has(b.name)).map((b) => b.name))}`);
  }
}
console.log(`\n(${Date.now() - t0} ms, jar ${JAR}${problems ? `; ${problems} problems` : ''})`);
if (problems) process.exitCode = 1;
