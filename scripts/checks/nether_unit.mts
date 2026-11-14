/**
 * The Nether rung offline (MC_NETHER_AGE; docs/specs/nether.md; no server):
 * - the rung's four stages counted from what the world reports (an expedition's "brought back N Nether blocks", a dig's
 *   "dug N ancient debris") and from levels (the portal lit, a netherite ingot stored), each ending at its target, in
 *   order; the feeds tag the options that feed each stage; the goods' targets and the gold keep;
 * - the portal's plan on fixtures (off blocked ground, flat, facing the hut, 160 blocks from another village's portal), its
 *   10-block frame and 6 inner cells, the far side's stand cell, the trip's box, the dig's lava rule;
 * - the planner: the netherite ingot from debris and gold, the flint and steel from an ingot and a flint;
 * - the ballot: tier 5, offered once every implemented lower tier is reached;
 * - the dimension gates (the 19 gaps' testable parts): world reads skip a Nether bot, the avoid list holds the portals and
 *   soul fire, `inDim`, the world rules set in every dimension, reset_site's Nether regions;
 * - with MC_NETHER_AGE=off (a second run of this file), and with MC_WORLD_MODE=hostile (a third): words, off the ballot,
 *   nothing counted.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/nether_unit.mts (sets MC_LADDER and MC_IRON_AGE itself)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
if (MODE === 'off') process.env.MC_NETHER_AGE = 'off';
if (MODE === 'hostile') process.env.MC_WORLD_MODE = 'hostile';
const L = await import('../../server/src/ladder');

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
type Counter = import('../../server/src/ladder').Counter;
const LOWER: Array<import('../../server/src/wanted').RungId> = ['iron', 'letters', 'diamond', 'enchantment', 'copper', 'machines', 'trade', 'husbandry', 'music', 'bees', 'maps', 'sea'];
const reachedAll = (v: Village) => {
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = LOWER.map((rung) => ({ rung, t: 1, workers: [] }));
  return st;
};

if (MODE === 'off' || MODE === 'hostile') {
  ok(!L.NETHER_AGE && !L.rungImplemented('nether'), `${MODE}: the Nether is words`);
  ok(L.RUNG_DEFS.nether.stages.every((s) => !s.counter), `${MODE}: no stage counted`);
  const v = { name: 'T', complete: true } as unknown as Village;
  reachedAll(v);
  ok(!L.rungOptions(v).includes('nether'), `${MODE}: off the ballot (${L.rungOptions(v).join(', ') || 'none'})`);
  ok(!L.netherCounts('nether_expedition', 'brought back 18 Nether blocks (3 kinds: ...)').length, `${MODE}: nothing counted`);
  process.exit(fails ? 1 : 0);
}

// 1. The stages, counted in order
{
  ok(L.NETHER_AGE && L.rungImplemented('nether'), 'the Nether is implemented (MC_NETHER_AGE and MC_IRON_AGE on, peaceful)');
  const d = L.RUNG_DEFS.nether;
  ok(d.tier === 5 && d.after.join() === 'enchantment', `tier 5 after enchantment (${d.tier}, ${d.after})`);
  ok(d.stages.map((s) => `${s.counter}:${s.target}`).join() === `portal:1,nblocks:${L.NETHER_BROUGHT},debris:${L.NETHER_DEBRIS},netherite:1`, `the stages ${d.stages.map((s) => `${s.counter}:${s.target}`).join()}`);
  const v = { name: 'N', complete: true, initiatives: [], structures: [], storage: { chests: [{ x: 0, y: 0, z: 0, items: {} }] } } as unknown as Village;
  reachedAll(v);
  L.chooseRung(v, 'nether', ['nether'], 2);
  ok(L.netherCurrent(v), 'the Nether is current once chosen');
  const store = (v.storage as unknown as { chests: Array<{ items: Record<string, number> }> }).chests[0].items;
  const note = (got: Array<[Counter, number]>, who: string) => got.flatMap(([c, n]) => L.noteLadder(v, c, who, n, 10));
  ok(!L.levelCounts(v, store).length, 'no level before the portal is lit');
  v.nether = { portal: { x: 0, y: 64, z: 0, axis: 'x', stand: { x: 1, y: 65, z: -1 }, lit: true } };
  const lv = L.levelCounts(v, store);
  ok(lv.length === 1 && lv[0][0] === 'portal' && lv[0][1] === 1, `the portal lit is a level of 1 (${JSON.stringify(lv)})`);
  let news = note(lv, 'Ada');
  ok(news.length === 1 && v.ladder!.stage === 1, `stage 1 ends with the portal lit (${news.map((n) => n.text).join(' | ')})`);
  const msg = (n: number) => `brought back ${n} Nether blocks (3 kinds: 12 netherrack, 4 blackstone, 2 quartz) from the Nether: 18 dug round the far portal; walked through the portal; walked back through the far portal`;
  ok(JSON.stringify(L.netherCounts('nether_expedition', msg(18))) === '[["nblocks",18]]', 'an expedition counts its Nether blocks');
  ok(!L.netherCounts('nether_expedition', 'brought back 0 Nether blocks (0 kinds: none) ...').length, 'an empty trip counts nothing');
  ok(!L.netherCounts('make', 'put into storage: 18 netherrack').length, 'netherrack from elsewhere is not counted');
  news = [...note(L.netherCounts('nether_expedition', msg(24)), 'Ben'), ...note(L.netherCounts('nether_expedition', msg(24)), 'Cara')];
  ok(!news.length && v.ladder!.count === 48, `48 of 64 after two trips (${v.ladder!.count})`);
  news = note(L.netherCounts('nether_expedition', msg(18)), 'Ben');
  ok(news.length === 1 && v.ladder!.stage === 2 && L.topWorkers(v.ladder!, 'nether', 1)[0] === 'Ben', 'stage 2 ends at 64, Ben its top worker');
  ok(JSON.stringify(L.netherCounts('nether_dig', 'dug 2 ancient debris in the Nether (6 seen at y 8-22); walked back through the far portal')) === '[["debris",2]]', 'a debris dig counts its debris');
  news = [...note(L.netherCounts('nether_dig', 'dug 2 ancient debris in the Nether (6 seen at y 8-22)'), 'Dan'), ...note(L.netherCounts('nether_dig', 'dug 3 ancient debris in the Nether'), 'Dan')];
  ok(news.length === 1 && v.ladder!.stage === 3, 'stage 3 ends at 4 debris (5 dug)');
  ok(L.rungKeep(v, 'gold_ingot', store) === L.NETHER_GOLD, 'the ingot\'s 4 gold kept while no ingot is made');
  ok(L.rungGoodTarget(v, 'netherite_ingot', store) === 1 && L.rungGoodTarget(v, 'flint_and_steel', store) === 0, 'the ingot wanted at stage 4; no flint and steel once the portal is lit');
  store.netherite_ingot = 1;
  ok(L.rungKeep(v, 'gold_ingot', store) === undefined, 'no gold kept once the ingot is stored');
  news = note(L.levelCounts(v, store), 'Eve');
  ok(news.length === 1 && news[0].kind === 'rung' && v.ladder!.reached.some((r) => r.rung === 'nether'), `the rung reached with the ingot in storage (${news[0]?.text})`);
}

// 2. Feeds and goods' targets
{
  const v = { name: 'F', complete: true, initiatives: [], structures: [] } as unknown as Village;
  reachedAll(v);
  L.chooseRung(v, 'nether', ['nether'], 2);
  const feeds = (stage: number, id: string) => {
    v.ladder!.stage = stage;
    return L.feedsStage(v, id);
  };
  ok(['rung:portal', 'rung:obsidian', 'rung:fill_bucket', 'rung:flint', 'make:flint_and_steel'].every((id) => feeds(0, id)) && !feeds(0, 'rung:expedition'), 'stage 1: the portal, obsidian, the bucket, the flint, the flint and steel');
  ok(feeds(1, 'rung:expedition') && !feeds(1, 'rung:portal'), 'stage 2: the expedition');
  ok(feeds(2, 'rung:debris') && feeds(2, 'diamond:forge') && !feeds(2, 'rung:expedition'), 'stage 3: the debris dig and the diamond pickaxe');
  ok(feeds(3, 'make:netherite_ingot') && feeds(3, 'activity:lib:buy:gold_ingot') && feeds(3, 'activity:lib:sell'), 'stage 4: the ingot, the gold bought, the sales that pay for it');
  v.ladder!.stage = 0;
  ok(L.rungGoodTarget(v, 'flint_and_steel', {}) === 1 && L.rungGoodTarget(v, 'netherite_ingot', {}) === 0, 'a flint and steel wanted until the portal is lit');
  ok(L.rungKeep(v, 'gold_ingot', {}) === undefined, 'no gold kept before the debris stage');
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  ok(W.NETHER_GOODS.map((g) => g.item).join() === 'flint_and_steel,netherite_ingot' && W.NETHER_GOODS.every((g) => g.rung === 'nether'), 'the workshop\'s Nether goods');
  const { SELLS } = await import('../../server/src/merchant');
  ok(SELLS.some((o) => o.item === 'gold_ingot'), 'the merchant sells gold ingots');
}

// 3. The ballot: tier 5 once every implemented lower rung is reached
{
  const v = { name: 'B', complete: true } as unknown as Village;
  const st = reachedAll(v);
  ok(L.rungOptions(v).join() === 'nether', `every lower rung reached: the Nether alone (${L.rungOptions(v).join()})`);
  st.reached = st.reached.filter((r) => r.rung !== 'sea');
  ok(!L.rungOptions(v).includes('nether'), `the sea (tier 4) not reached: no Nether yet (${L.rungOptions(v).join()})`);
  st.reached = st.reached.filter((r) => r.rung !== 'enchantment');
  ok(!L.rungOptions(v).includes('nether'), 'enchantment not reached: no Nether');
  const W2 = await import('../../server/src/wanted');
  ok(!W2.RUNG_NEEDS.nether.length && /every skill exists/.test(L.rungPreview('nether')), `the preview: ${L.rungPreview('nether')}`);
}

// 4. The portal's plan and the trip's geometry
{
  const P = await import('../../server/src/netherPlan');
  const p = { x: 10, y: 64, z: 20, axis: 'x' as const };
  const f = P.frameCells(p), inner = P.innerCells(p);
  const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;
  ok(f.length === P.FRAME_BLOCKS && new Set(f.map(key)).size === 10 && !f.some((c) => (c.x === 10 || c.x === 13) && (c.y === 64 || c.y === 68)), 'the frame: 10 obsidian, no corners');
  ok(inner.length === 6 && inner.every((c) => c.x >= 11 && c.x <= 12 && c.y >= 65 && c.y <= 67 && c.z === 20) && !inner.some((c) => f.some((q) => key(q) === key(c))), 'six inner cells inside the frame');
  const pz = P.innerCells({ x: 10, y: 64, z: 20, axis: 'z' });
  ok(pz.every((c) => c.x === 10 && c.z >= 21 && c.z <= 22), 'along z the frame spans z');
  // flat ground at y 64 everywhere, a plot box blocked round the hut
  const flat: import('../../server/src/netherPlan').GroundRead = () => ({ y: 64, firm: true, clear: true });
  const hut = { x: 0, z: 0 };
  const plot = { x1: -16, z1: -16, x2: 16, z2: 16 };
  const blocked = (x: number, z: number) => x >= plot.x1 && x <= plot.x2 && z >= plot.z1 && z <= plot.z2;
  const s = P.planPortal(hut, flat, blocked, [])!;
  ok(!!s, 'a site found on flat ground');
  const box = [...P.frameCells(s), ...P.faceCells(s, 1), ...P.faceCells(s, -1)];
  ok(box.every((c) => !blocked(c.x, c.z)), `the site off the plot (${s.x},${s.z} along ${s.axis})`);
  ok(Math.hypot(s.x - hut.x, s.z - hut.z) <= P.PORTAL_REACH, 'within reach of the hut');
  const toHut = Math.hypot(s.stand.x - hut.x, s.stand.z - hut.z), back = s.axis === 'x' ? { x: s.stand.x, z: 2 * s.z - s.stand.z } : { x: 2 * s.x - s.stand.x, z: s.stand.z };
  ok(toHut < Math.hypot(back.x - hut.x, back.z - hut.z), 'the stand cell on the hut\'s side');
  ok(s.y === 64 && s.stand.y === 65, 'the frame sunk into the ground: the inner cells level with the stand cell');
  ok(P.planPortal(hut, flat, blocked, [{ x: 30, z: 0 }, { x: -30, z: 0 }, { x: 0, z: 30 }, { x: 0, z: -30 }]) === null, 'no site within 160 of another village\'s portal');
  const steep: import('../../server/src/netherPlan').GroundRead = (x, z) => ({ y: 64 + ((x + z) & 1), firm: true, clear: true });
  ok(P.planPortal(hut, steep, blocked, []) === null, 'no site on ground that is not level');
  const wet: import('../../server/src/netherPlan').GroundRead = () => ({ y: 62, firm: false, clear: true });
  ok(P.planPortal(hut, wet, blocked, []) === null, 'none on water');
  // the far side: a portal along x at y 57, obsidian under it, air in front at z -1
  const portal = [0, 1].flatMap((x) => [57, 58, 59].map((y) => ({ x: -191 + x, y, z: -9 })));
  const name = (x: number, y: number, z: number) => (portal.some((c) => c.x === x && c.y === y && c.z === z) ? 'nether_portal' : y === 56 ? 'obsidian' : y < 56 ? 'netherrack' : z === -10 || z === -8 ? 'air' : 'obsidian');
  const st = P.farStand(portal, name);
  ok(!!st && st.y === 57 && (st.z === -10 || st.z === -8) && (st.x === -191 || st.x === -190), `the far portal's stand cell beside it (${JSON.stringify(st)})`);
  ok(P.inTripBox({ x: 0, y: 60, z: 0 }, { x: 32, y: 48, z: -32 }) && !P.inTripBox({ x: 0, y: 60, z: 0 }, { x: 33, y: 60, z: 0 }) && !P.inTripBox({ x: 0, y: 60, z: 0 }, { x: 0, y: 47, z: 0 }), 'the trip\'s box: 32 out, 12 up and down');
  // the dig's rules on a fixture column: lava beside the cell, the cell underfoot, an unloaded neighbour
  const world = (lavaAt?: string) => (x: number, y: number, z: number) => (`${x},${y},${z}` === lavaAt ? 'lava' : y > 60 ? 'air' : 'netherrack');
  const feet = { x: 0, y: 61, z: 0 };
  ok(P.safeToDig({ x: 2, y: 60, z: 0 }, feet, world()), 'netherrack with no lava near may be dug');
  ok(!P.safeToDig({ x: 0, y: 60, z: 0 }, feet, world()), 'never the block underfoot');
  ok(!P.safeToDig({ x: 2, y: 60, z: 0 }, feet, world('3,60,0')) && !P.safeToDig({ x: 2, y: 59, z: 0 }, feet, world('2,58,0')), 'never a block with lava beside or under it');
  ok(!P.safeToDig({ x: 2, y: 60, z: 0 }, feet, (x, y, z) => (x === 2 && y === 60 && z === 1 ? '' : world()(x, y, z))), 'never one with an unloaded neighbour');
  ok(P.exposed({ x: 2, y: 60, z: 0 }, world()) && !P.exposed({ x: 2, y: 50, z: 0 }, world()), 'exposed: a face on air');
  ok(['netherrack', 'blackstone', 'basalt', 'soul_sand', 'nether_quartz_ore'].every((n) => P.DIG_NETHER.includes(n)) && ['netherrack', 'quartz', 'gold_nugget', 'blackstone'].every((n) => L.NETHER_BLOCKS.includes(n)), 'the blocks dug and the items counted');
}

// 5. The planner: the ingot from debris and gold, the flint and steel
{
  const { default: minecraftData } = await import('minecraft-data');
  const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
  const mats = new Materials(minecraftData('26.1'));
  const a = mats.plan({ netherite_ingot: 1 }, { ancient_debris: 4, gold_ingot: 4, coal: 2 });
  ok(!Object.keys(a.gather).length && !a.problems.length && a.steps.map((q) => `${q.do}:${q.item}`).join() === 'smelt:netherite_scrap,craft:netherite_ingot', `the ingot planned from 4 debris and 4 gold (${a.steps.map((q) => `${q.do}:${q.item}`).join()})`);
  const b = mats.plan({ flint_and_steel: 1 }, { iron_ingot: 1, flint: 1 });
  ok(!Object.keys(b.gather).length && !b.problems.length, 'the flint and steel from an ingot and a flint');
}

// 6. The dimension gates
{
  const D = await import('../../server/src/mineflayer/mcDim');
  ok(D.dimOf({ bot: { game: { dimension: 'minecraft:the_nether' } } }) === 'the_nether' && D.dimOf({ game: { dimension: 'overworld' } }) === 'overworld' && D.dimOf(null) === 'overworld' && D.overworld({ bot: {} }), 'dimOf and overworld');
  ok(D.inDim('the_nether', 'tp Ada 1 2 3') === 'execute in minecraft:the_nether run tp Ada 1 2 3' && D.inDim('overworld', 'tp Ada 1 2 3') === 'tp Ada 1 2 3', 'inDim');
  // (tiered-brain-building: no worldReads.ts; the atlas' column provider and the plot reads in mcWorld.ts skip Nether bots)
  const WS = readFileSync(new URL('../../server/src/mineflayer/mcWorld.ts', import.meta.url), 'utf-8');
  ok(/if \(a\.dim !== 'overworld'\) continue;\s*const column/.test(WS) && (WS.match(/\.dim === 'overworld' && \(s = stateAt/g) ?? []).length === 2, 'world reads with no reader asked skip a bot in the Nether; the atlas takes overworld columns only');
  const BA = readFileSync(new URL('../../server/src/mineflayer/botAgent.ts', import.meta.url), 'utf-8');
  ok(/AVOID_BLOCKS = \['nether_portal', 'end_portal', 'end_gateway', 'soul_fire'\]/.test(BA) && /m\.blocksToAvoid\.add/.test(BA), 'walks avoid the portals and soul fire');
  ok(/chunkColumnLoad', \(p\) => \{ if \(overworld\(this\)\)/.test(BA) && /if \(!overworld\(this\)\) \{\s*this\.protectedCache/.test(BA), 'the atlas and village ground are the overworld\'s');
  ok(/recallFromDim\(this, 'logged in there/.test(BA), 'a log-in off the overworld is recalled before unbury');
  const W = readFileSync(new URL('../../server/src/mineflayer/mcWorld.ts', import.meta.url), 'utf-8');
  ok(/a\.dim !== 'overworld' \|\| !underHome/.test(W) && /private netherWatch\(\)/.test(W), 'the underground watch skips the Nether; the Nether watch recalls a lost member');
  const S = readFileSync(new URL('../../server/src/mineflayer/mcSkills.ts', import.meta.url), 'utf-8');
  const N = await import('../../server/src/mineflayer/mcNether');
  ok(/\.\.\.NETHER_SKILLS/.test(S) && ['build_portal', 'nether_expedition', 'nether_dig'].every((k) => k in N.NETHER_SKILLS), 'the skills are registered');
  // the world rules in every dimension (Paper keeps game rules per dimension: the probe's Gus died in Nether lava)
  const { applyWorldRules } = await import('../../server/src/mineflayer/mcRules');
  const set: Record<string, string> = {};
  const sent: string[] = [];
  const rcon = {
    async command(c: string) {
      sent.push(c);
      const m = /^(?:execute in minecraft:(\w+) run )?gamerule (\w+)(?: (\S+))?$/.exec(c);
      if (m) {
        const k = `${m[1] ?? 'overworld'}:${m[2]}`;
        if (m[3] !== undefined) set[k] = m[3];
        return `Gamerule ${m[2]} is currently set to: ${set[k] ?? 'true'}`;
      }
      if (c === 'difficulty') return 'The difficulty is Peaceful';
      if (c === 'tick query') return 'target tick rate: 20.0';
      return '';
    },
  };
  const r = await applyWorldRules(rcon as never);
  ok(r.ok && set['the_nether:fire_damage'] === 'false' && set['the_nether:keep_inventory'] === 'true' && set['the_end:spawn_monsters'] === 'false', `the rules set in the Nether and the End (${r.summary.slice(0, 80)})`);
  const py = spawnSync('python', ['-c', "import sys; sys.path.insert(0, 'scripts'); import reset_site as R, testserver as T; print(R.nether_regions(T.get_site('minevale3')))"], { encoding: 'utf8' });
  ok(py.stdout.trim() === '[(-1, -1), (-1, 0)]', `reset_site clears minevale3's Nether regions (${py.stdout.trim() || py.stderr.trim().slice(-120)})`);
}

if (!MODE) {
  for (const m of ['off', 'hostile']) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], m], { encoding: 'utf8', env: { ...process.env, MC_NETHER_AGE: undefined, MC_WORLD_MODE: undefined } as NodeJS.ProcessEnv });
    process.stdout.write(r.stdout);
    if (r.status !== 0) fails++;
  }
}
console.log(fails ? `${fails} FAILED` : 'nether_unit: all passed');
process.exit(fails ? 1 : 0);
