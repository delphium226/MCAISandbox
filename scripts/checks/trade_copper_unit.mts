/**
 * The trade and copper rungs offline (#246 MC_TRADE_AGE, #247 MC_COPPER_AGE; docs/specs/ladder-rungs.md; no server):
 * - each rung's four stages counted from what the world reports (a trade's sale, an iron trip's raw copper, a make's
 *   copper blocks) and from levels (stalls built, emeralds and instruments in storage, the canopy built), each ending at
 *   its target, in order, the work credited;
 * - the stages' feeds tag the options that feed them (an initiative's help by its kind's alias);
 * - the copper goods' targets (blocks, then one lightning rod and one spyglass), the amethyst shard's keep, the merchant's
 *   shard offer and the canopy's design (5 copper blocks);
 * - with MC_MERCHANT_ORDERS on (a second run of this file) trade's last stage counts orders filled;
 * - with MC_TRADE_AGE=off and MC_COPPER_AGE=off (a third run) both rungs are words, off the ballot, nothing counted.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/trade_copper_unit.mts (sets MC_LADDER and MC_IRON_AGE itself)
 */
import { spawnSync } from 'node:child_process';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
if (MODE === 'off') process.env.MC_TRADE_AGE = process.env.MC_COPPER_AGE = 'off';
if (MODE === 'orders') process.env.MC_MERCHANT_ORDERS = 'on';
const L = await import('../../server/src/ladder');

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
/** A complete village with storage of `items`, its ladder on `rung` (iron reached). */
const make = (rung: 'trade' | 'copper', items: Record<string, number> = {}): Village => {
  const v = { name: 'T', complete: true, initiatives: [], storage: { chests: [{ x: 0, y: 0, z: 0, items }] } } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  L.chooseRung(v, rung, [rung], 2);
  return v;
};
const note = (v: Village, got: Array<[import('../../server/src/ladder').Counter, number]>, who: string, t = 10) => got.flatMap(([c, n]) => L.noteLadder(v, c, who, n, t));
const store = (v: Village) => (v.storage as unknown as { chests: Array<{ items: Record<string, number> }> }).chests[0].items;
const built = (v: Village, kind: string, n: number) => {
  for (let i = 0; i < n; i++) v.initiatives!.push({ id: `i${v.initiatives!.length + 1}`, by: 'the village', kind, design: `small_${kind}_oak`, x: 0, y: 0, z: 0, at: 1, state: 'built', crew: [], steps: [] });
};

if (MODE === 'off') {
  ok(!L.rungImplemented('trade') && !L.rungImplemented('copper'), 'off: trade and copper are words');
  ok(L.RUNG_DEFS.trade.stages.every((s) => !s.counter) && L.RUNG_DEFS.copper.stages.every((s) => !s.counter), 'off: no stage counted');
  const v = { name: 'T', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  const opts = L.rungOptions(v);
  ok(!opts.includes('trade') && !opts.includes('copper'), `off: off the ballot (${opts.join(', ')})`);
  ok(!L.tradeCounts('trade', 'traded with the merchant: sold 16 oak_log for 1 emerald (stock left 7)').length, 'off: no sale counted');
  ok(!L.copperCounts('dig_iron', 'brought up 2 raw iron, 1 coal, 9 raw copper; deposited').length, 'off: no copper counted');
  const { SELLS } = await import('../../server/src/merchant');
  ok(!SELLS.some((o) => o.item === 'amethyst_shard'), 'off: the merchant sells no amethyst shard');
  process.exit(fails ? 1 : 0);
}

if (MODE === 'orders') {
  const s4 = L.RUNG_DEFS.trade.stages[3];
  ok(s4.counter === 'orders' && s4.target === L.TRADE_ORDERS && /orders filled/.test(s4.words), `orders on: stage 4 is ${s4.words}`);
  // (an order's item is one no standing offer buys: the trade skill fills an order only then)
  ok(JSON.stringify(L.tradeCounts('trade', 'traded with the merchant: sold 16 birch_fence for 3 emerald (stock left 0)')) === '[["sales",1],["orders",1]]', 'an order filled: one sale and one order');
  const v = make('trade');
  const st = v.ladder!;
  st.stage = 3;
  st.totals = {};
  for (let i = 0; i < L.TRADE_ORDERS; i++) note(v, L.tradeCounts('trade', 'traded with the merchant: sold 8 ladder for 2 emerald (stock left 0)'), 'Ada');
  ok(!st.current && st.reached.some((r) => r.rung === 'trade'), `orders on: ${L.TRADE_ORDERS} orders reach the rung`);
  process.exit(fails ? 1 : 0);
}

// 1. The trade rung (MC_MERCHANT_ORDERS off: the last stage counts the workshop's goods sold)
{
  ok(L.rungImplemented('trade') && L.RUNG_DEFS.trade.tier === 2, 'trade is implemented, tier 2');
  const ss = L.RUNG_DEFS.trade.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `sales:${L.TRADE_SALES},stalls:${L.TRADE_STALLS},emeralds:${L.TRADE_EMERALDS},crafted:${L.TRADE_CRAFTED}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  const v = make('trade', { emerald: 3 });
  const st = v.ladder!;
  // the messages
  ok(JSON.stringify(L.tradeCounts('trade', 'traded with the merchant: sold 32 oak_log for 2 emerald (stock left 6)')) === '[["sales",2]]', 'logs sold: 2 lots');
  ok(JSON.stringify(L.tradeCounts('trade', 'traded with the merchant: sold 48 torch for 2 emerald (stock left 2)')) === '[["sales",2],["crafted",2]]', 'torches sold: 2 lots, crafted');
  ok(!L.tradeCounts('trade', 'traded with the merchant: bought 2 leather for 1 emerald (stock left 5)').length, 'a purchase is no sale');
  ok(!L.tradeCounts('make', 'made 4 torch; put into storage: 4 torch').length, 'only the trade step counts');
  // the feeds
  ok(L.feedsStage(v, 'activity:lib:sell') && L.feedsStage(v, 'make:glass') && !L.feedsStage(v, 'make:book') && !L.feedsStage(v, 'iron:dig'), 'stage 1 feeds the sale and the merchant\'s goods\' makes');
  note(v, L.levelCounts(v, store(v)), 'Eve');
  ok(st.stage === 0 && st.totals?.emeralds === 3 && st.count === 0, 'a later stage\'s level seen during stage 1 is kept for it');
  // stage 1: crafted lots during it count toward stage 4 too
  let news = note(v, L.tradeCounts('trade', 'traded with the merchant: sold 48 glass for 4 emerald (stock left 0)'), 'Ben');
  for (let i = 0; i < 8 && !news.length; i++) news = note(v, L.tradeCounts('trade', 'traded with the merchant: sold 32 birch_log for 2 emerald (stock left 4)'), 'Ada', 11 + i);
  ok(news[0]?.kind === 'stage' && st.stage === 1 && st.totals?.sales === L.TRADE_SALES && st.totals?.crafted === 4, `stage 1 ends at ${L.TRADE_SALES} lots: ${news[0]?.text}`);
  ok(news[0]?.workers[0] === 'Ada', 'its main worker named');
  // stage 2: stalls standing, a level (the first stall from completion counts)
  ok(L.feedsStage(v, 'help:i7', 'help:market_stall') && !L.feedsStage(v, 'help:i7', 'help:well'), 'stage 2 feeds a market stall\'s help (its alias), not a well\'s');
  built(v, 'market_stall', 1);
  built(v, 'well', 1);
  note(v, L.levelCounts(v, store(v)), 'Cara');
  ok(st.stage === 1 && st.totals?.stalls === 1 && st.count === 1, `one stall standing: ${L.progressLine(v, 20, 1)}`);
  note(v, L.levelCounts(v, store(v)), 'Cara');
  ok(st.totals?.stalls === 1, 'a level is counted once');
  built(v, 'market_stall', 2);
  news = note(v, L.levelCounts(v, store(v)), 'Dan', 30);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends at ${L.TRADE_STALLS} stalls: ${news[0]?.text}`);
  // stage 3: emeralds in storage, the highest seen
  ok(st.totals?.emeralds === 3 && st.count === 3, `the emeralds stored when stage 2 ended counted: ${L.progressLine(v, 40, 1)}`);
  store(v).emerald = 25;
  note(v, L.levelCounts(v, store(v)), 'Eve');
  store(v).emerald = 12;
  note(v, L.levelCounts(v, store(v)), 'Eve');
  ok(st.totals?.emeralds === 25 && st.stage === 2, 'emeralds spent do not count down (the highest seen)');
  store(v).emerald = L.TRADE_EMERALDS;
  news = note(v, L.levelCounts(v, store(v)), 'Fay', 50);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends at ${L.TRADE_EMERALDS} emeralds stored: ${news[0]?.text}`);
  // stage 4: the 4 crafted lots sold in stage 1 are there already
  ok(st.count === 4 && L.feedsStage(v, 'make:stone_bricks'), `stage 4 starts at the crafted lots already sold: ${L.progressLine(v, 60, 1)}`);
  news = [];
  for (let i = 0; i < 10 && !news.length; i++) news = note(v, L.tradeCounts('trade', 'traded with the merchant: sold 16 stone_bricks for 1 emerald (stock left 5)'), 'Gus', 70 + i);
  ok(news[0]?.kind === 'rung' && !st.current && st.totals !== undefined && st.reached.some((r) => r.rung === 'trade'), `the rung is reached at ${L.TRADE_CRAFTED} crafted lots: ${news[0]?.text}`);
  ok(st.reached.find((r) => r.rung === 'trade')!.workers.length === 4, 'each stage\'s workers kept');
  ok(L.levelCounts(v, { emerald: 99 }).length === 0, 'no levels once the rung is over');
}

// 2. The copper rung
{
  ok(L.rungImplemented('copper') && L.RUNG_DEFS.copper.tier === 2, 'copper is implemented, tier 2');
  const ss = L.RUNG_DEFS.copper.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `copper:${L.COPPER_RAW},cblocks:${L.COPPER_MADE},croof:1,instruments:${L.COPPER_INSTRUMENTS}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  const v = make('copper', {});
  const st = v.ladder!;
  ok(L.copperCurrent(v) && !L.tradeCurrent(v), 'copper is current');
  // the messages: an iron trip's raw copper (mcBuild.ts digIron's text), a make's blocks
  const trip = (n: number) => `iron trip: dug 30 cells; stairs 20 steps (level y=12), 400 tunnel cells, 50 raw iron and 20 coal in all; brought up 4 raw iron, 2 coal, 0 diamond, ${n} raw copper (took an iron pickaxe); deposited 4 raw_iron, 2 coal, ${n} raw_copper`;
  ok(JSON.stringify(L.copperCounts('dig_iron', trip(11))) === '[["copper",11]]', 'an iron trip\'s raw copper');
  ok(JSON.stringify(L.copperCounts('dig_iron', 'iron trip: ...; brought up 4 raw iron, 2 coal; deposited')) === '[]', 'a trip with none');
  ok(JSON.stringify(L.copperCounts('make', 'made 2 copper_block (made from storage: smelted 18 copper_ingot, crafted 2 copper_block); put into storage: 2 copper_block')) === '[["cblocks",2]]', 'a make\'s copper blocks');
  ok(JSON.stringify(L.copperCounts('make', 'made 1 lightning_rod; put into storage: 1 lightning_rod')) === '[]', 'a rod is no block');
  // stage 1 and its feed
  ok(L.feedsStage(v, 'iron:dig') && !L.feedsStage(v, 'make:copper_block'), 'stage 1 feeds the iron dig');
  ok(L.copperTarget(v, 'copper_block', {}) === L.COPPER_MADE && L.copperTarget(v, 'lightning_rod', {}) === 0, 'the blocks are wanted from the start, the instruments not yet');
  let news: ReturnType<typeof L.noteLadder> = [];
  for (let i = 0; i < 10 && !news.length; i++) news = note(v, L.copperCounts('dig_iron', trip(9)), i % 2 ? 'Ada' : 'Ben', 10 + i);
  ok(news[0]?.stage === 0 && st.stage === 1 && st.count === 0, `stage 1 ends at ${L.COPPER_RAW} raw copper: ${news[0]?.text}`);
  // stage 2: blocks
  ok(L.feedsStage(v, 'make:copper_block') && !L.feedsStage(v, 'iron:dig'), 'stage 2 feeds the copper block make');
  note(v, L.copperCounts('make', 'put into storage: 2 copper_block'), 'Cara');
  ok(L.copperTarget(v, 'copper_block', { copper_block: 2 }) === 2 + L.COPPER_MADE - 2, 'the block target: the stock and the blocks still to make');
  news = [];
  for (let i = 0; i < 3 && !news.length; i++) news = note(v, L.copperCounts('make', 'put into storage: 2 copper_block'), 'Cara', 20 + i);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends at ${L.COPPER_MADE} blocks: ${news[0]?.text}`);
  ok(L.copperTarget(v, 'copper_block', { copper_block: 5 }) === 5 && L.copperTarget(v, 'lightning_rod', {}) === 1 && L.copperTarget(v, 'spyglass', { spyglass: 1 }) === 1, 'then one lightning rod and one spyglass');
  ok(L.shardKeep(v, store(v)) === 1, 'the spyglass\'s amethyst shard kept for buying');
  // stage 3: the canopy
  ok(L.feedsStage(v, 'help:i9', 'help:copper_canopy') && !L.feedsStage(v, 'help:i9', 'help:market_stall'), 'stage 3 feeds the canopy\'s help');
  built(v, 'gazebo', 1);
  ok(L.levelCounts(v, store(v)).every(([c]) => c !== 'croof'), 'another work is no copper roof');
  built(v, L.COPPER_CANOPY, 1);
  news = note(v, L.levelCounts(v, store(v)), 'Dan', 30);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends with the canopy built: ${news[0]?.text}`);
  // stage 4: one of each instrument, as levels
  ok(L.feedsStage(v, 'make:spyglass') && L.feedsStage(v, 'make:lightning_rod') && L.feedsStage(v, 'activity:lib:buy:amethyst_shard'), 'stage 4 feeds both makes and the shard\'s purchase');
  store(v).lightning_rod = 2;
  note(v, L.levelCounts(v, store(v)), 'Eve');
  ok(st.count === 1 && st.stage === 3, 'two lightning rods are one instrument');
  store(v).spyglass = 1;
  ok(L.shardKeep(v, store(v)) === undefined, 'no shard wanted once a spyglass is stored');
  news = note(v, L.levelCounts(v, store(v)), 'Fay', 40);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'copper'), `the rung is reached with the spyglass: ${news[0]?.text}`);
  ok(L.copperTarget(v, 'copper_block', {}) === 0 && L.shardKeep(v, store(v)) === undefined, 'nothing wanted once the rung is over');
  // the goods, the merchant's shard, the canopy
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  ok(W.COPPER_GOODS.map((g) => g.item).join() === 'copper_block,lightning_rod,spyglass' && W.COPPER_GOODS.every((g) => g.rung === 'copper'), 'the copper goods');
  // (the make's planner: raw copper smelted to ingots and crafted in one make; the spyglass waits for its shard)
  const { default: minecraftData } = await import('minecraft-data');
  const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
  const mats = new Materials(minecraftData('26.1'));
  const pb = mats.plan({ copper_block: 2 }, { raw_copper: 18, coal: 3 }), pr = mats.plan({ lightning_rod: 1 }, { raw_copper: 3, coal: 1 });
  const ps = mats.plan({ spyglass: 1 }, { raw_copper: 2, amethyst_shard: 1, coal: 1 }), pn = mats.plan({ spyglass: 1 }, { raw_copper: 2, coal: 1 });
  ok(!Object.keys(pb.gather).length && pb.fuel.smelts === 18 && !Object.keys(pr.gather).length && !Object.keys(ps.gather).length, 'blocks, a rod and a spyglass planned from stored raw copper (and the shard)');
  ok(pn.gather.amethyst_shard === 1, 'no shard: the spyglass is short of it');
  const { SELLS } = await import('../../server/src/merchant');
  const shard = SELLS.find((o) => o.item === 'amethyst_shard');
  // (later rungs' goods may follow it: MC_MUSIC_AGE's redstone)
  ok(!!shard && SELLS.slice(SELLS.indexOf(shard) + 1).every((o) => ['redstone', 'bell', 'gold_ingot', 'bee_nest', 'experience_bottle', 'lapis_lazuli'].includes(o.item)), `the merchant sells an amethyst shard, last but for later rungs' goods (${shard?.emeralds} emeralds)`);
  const SW = await import('../../server/src/smallWorks');
  const { designBill } = await import('../../server/src/mineflayer/mcMaterials');
  const k = SW.smallWorkKind(L.COPPER_CANOPY);
  const d = k?.make('spruce');
  ok(!!d && designBill(d).copper_block === L.COPPER_MADE && SW.isSmallWork(d.name) && SW.smallWorkWood(d.name) === 'spruce' && SW.smallWorkKindOf(d.name) === L.COPPER_CANOPY, `the canopy: ${d?.name}, its roof ${designBill(d!).copper_block} copper blocks`);
  ok(!SW.SMALL_WORKS.some((x) => x.kind === L.COPPER_CANOPY) && !SW.menuWorks().some((x) => x.kind === L.COPPER_CANOPY), 'the canopy is not on a member\'s menu');
}

// 3. The ballot after iron: tier 2's implemented rungs, letters (MC_LETTERS), copper and trade
{
  const v = { name: 'B', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  const tier2 = L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 2 && L.rungImplemented(r)).slice(0, 4);
  ok(L.rungOptions(v).join() === tier2.join() && tier2.includes('copper') && tier2.includes('trade') && tier2.includes('letters') === L.LETTERS, `after iron: ${L.rungOptions(v).join(', ')}`);
  for (const id of ['copper', 'trade'] as const) {
    const pv = L.rungPreview(id);
    ok(/every skill exists/.test(pv) && pv.length <= 200, `${id}'s preview: ${pv}`);
  }
}

// 4. The other modes, each in a process of its own
for (const mode of ['orders', 'off']) {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], mode], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  ok(r.status === 0, `the ${mode} run`);
}

console.log(fails ? `trade_copper_unit: ${fails} failed` : 'trade_copper_unit: all passed');
process.exit(fails ? 1 : 0);
