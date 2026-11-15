/**
 * The emeralds the rungs buy with (#246, #24, #251; no server):
 * - MC_MERCHANT_MORE: the merchant also buys pumpkins and the mason's three stones, appended after SELLS (a saved merchant's
 *   uses keep their indices), counted as lots by the trade rung, with no arbitrage loop;
 * - MC_RUNG_BUYS_FIRST: the emeralds the rung's goods still cost (bee nests, the powered rails' gold and redstone), held
 *   back from other purchases;
 * - MC_WILD_NESTS: the wild nests' record (open, tended, failed and retried), the campfire's cell under a nest, the bee
 *   nests' keep at 0 while two wild nests cover the hives, the stage's feed;
 * - with the three flags off (a second run of this file) none of it.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/emerald_unit.mts
 */
import { spawnSync } from 'node:child_process';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
process.env.MC_LETTERS = 'on';
process.env.MC_NETHER_AGE = 'off';
if (MODE === 'off') process.env.MC_MERCHANT_MORE = process.env.MC_RUNG_BUYS_FIRST = process.env.MC_WILD_NESTS = 'off';
const L = await import('../../server/src/ladder');
const M = await import('../../server/src/merchant');
const W = await import('../../server/src/wildNests');
type RungId = import('../../server/src/wanted').RungId;

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const make = (rung: RungId, items: Record<string, number> = {}): Village => {
  const v = { name: 'E', complete: true, initiatives: [], structures: [], designs: {}, plots: [], layouts: [], storageHut: { x1: 0, z1: 0, x2: 6, z2: 6, spots: [] }, storage: { chests: [{ x: 0, y: 0, z: 0, items }] } } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = (['iron', 'letters', 'copper', 'trade', 'husbandry', 'music'] as RungId[]).map((r) => ({ rung: r, t: 1, workers: [] }));
  L.chooseRung(v, rung, [rung], 2);
  return v;
};

const base = 9;
if (MODE === 'off') {
  ok(!M.OFFERS.some((o) => o.item === 'pumpkin') && M.BUYS.length === base, 'off: the merchant buys the nine goods only');
  ok(M.rungReserve(() => 2, {}) === 0, 'off: nothing held back for the rung');
  const v = make('bees');
  v.apiary = { wild: { '1,70,1': {}, '2,70,2': {} } };
  ok(!W.wildCover(v, 2) && L.rungKeep(v, 'bee_nest', {}) === L.BEES_NESTS, 'off: wild nests never cover the hives; two nests bought');
} else {
  // The merchant's buys
  const more = M.OFFERS.slice(M.OFFERS.length - 4);
  ok(more.map((o) => `${o.n} ${o.item}`).join(', ') === '6 pumpkin, 16 granite, 16 andesite, 16 diorite' && more.every((o) => o.dir === 'buys' && o.emeralds === 1), `the farmer's and mason's buys last: ${more.map((o) => o.item).join(', ')}`);
  ok(M.OFFERS.slice(0, base).every((o) => o.dir === 'buys') && M.OFFERS[base] === M.SELLS[0] && M.OFFERS.indexOf(M.SELLS[M.SELLS.length - 1]) === base + M.SELLS.length - 1, 'the old offers keep their indices');
  ok(M.BUYS.length === base + 4 && M.MORE_ITEMS.has('pumpkin') && M.MORE_KEEP === 64, 'BUYS holds them, a stack kept');
  ok(M.arbitrage([{ out: 'pumpkin', n: 1, ins: { pumpkin_seeds: 1 } }, { out: 'granite', n: 2, ins: { diorite: 1, quartz: 1 } }]).length === 0, 'no emeralds from nothing');
  const t = make('trade');
  const got = L.tradeCounts('trade', 'traded with the merchant: sold 12 pumpkin for 2 emerald (stock left 4)');
  ok(got.some(([c, n]) => c === 'sales' && n === 2), `a pumpkin sale is 2 lots: ${JSON.stringify(got)}`);
  void t;

  // Rung goods first
  const nests = (item: string) => (item === 'bee_nest' ? 2 : undefined);
  ok(M.rungReserve(nests, {}) === 12 && M.rungReserve(nests, { bee_nest: 1 }) === 6 && M.rungReserve(nests, { bee_nest: 2 }) === 0, 'two nests held back: 12, 6, 0 emeralds');
  const mc = make('machines');
  mc.ladder!.stage = 3;
  mc.machines = { line: { done: true, cells: [], laid: 0 } } as unknown as Village['machines'];
  const keep = (item: string) => L.rungKeep(mc, item, {});
  ok(M.rungReserve(keep, {}) === 12 + 1 && M.rungReserve(keep, { gold_ingot: 6 }) === 1, `the powered rails' gold and redstone: ${M.rungReserve(keep, {})} emeralds`);
  ok(M.rungReserve(() => 4, { carrot: 0 }) > 0 && !M.RUNG_BOUGHT.has('carrot') && !M.RUNG_BOUGHT.has('fishing_rod'), 'carrots and rods are not rung goods');

  // Wild nests
  const v = make('bees');
  ok(L.feedsStage(v, 'rung:wild_nest') && /wild nests tended/.test(L.RUNG_DEFS.bees.stages[0].words), 'stage 1 feeds the wild nests\' chore and names them');
  ok(L.rungKeep(v, 'bee_nest', {}) === L.BEES_NESTS && !W.wildCover(v, 2), 'no wild nest seen: two nests bought');
  v.apiary = { wild: { '30,70,0': {} } };
  ok(L.rungKeep(v, 'bee_nest', {}) === L.BEES_NESTS, 'one wild nest: two still bought for the apiary');
  v.apiary.wild!['10,80,5'] = {};
  ok(L.rungKeep(v, 'bee_nest', {}) === 0 && W.wildCover(v, 2), 'two wild nests to tend: none bought');
  ok(W.wildCandidates(v, { x: 3, z: 3 }, Date.now()).map((p) => p.join()).join(' ') === '10,80,5 30,70,0', 'nearest the hut first');
  const now = Date.now();
  v.apiary.wild!['10,80,5'] = { fail: 'no bees', at: now };
  ok(!W.wildCover(v, 2, now) && W.wildCandidates(v, { x: 3, z: 3 }, now).length === 1, 'a failed nest is left out');
  ok(W.wildCover(v, 2, now + 31 * 60000) && W.wildCandidates(v, { x: 3, z: 3 }, now + 16 * 60000, 2).length === 2, 'and tried again after 30 game minutes');
  v.apiary.wild!['30,70,0'] = { campfire: [30, 67, 0], at: now };
  v.apiary.housed = ['30,70,0'];
  ok(W.wildTended(v).map((p) => p.join()).join() === '30,70,0' && !W.wildOpen(v.apiary.wild!['30,70,0'], now), 'a tended nest is one of the hives, not a candidate');
  ok(L.levelCounts(v, {}).some(([c, n]) => c === 'hives' && n === 1), 'the hives level counts it');

  // The campfire's cell
  const solid = (n: string) => /^(grass_block|dirt|stone|oak_log|oak_leaves)$/.test(n);
  const cell = (under: string[]) => JSON.stringify(W.campfireCell(under, solid));
  ok(cell(['air', 'air', 'grass_block']) === '{"k":2}', 'two air then ground: the campfire two below');
  ok(cell(['air', 'short_grass', 'dirt']) === '{"k":2}', 'a plant cell takes it');
  ok(cell(['grass_block']) .includes('why'), 'ground right under the nest: no room');
  ok(cell(['oak_leaves', 'air']).includes('blocks the smoke'), 'leaves under the nest block the smoke');
  ok(cell(['air', 'air', 'air', 'air', 'air', 'air']).includes('no ground within 5'), 'nothing within 5: none');
  ok(cell(['air', 'campfire', 'dirt']) === '{"k":2,"have":true}', 'a campfire there already');

  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], 'off'], { encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').map((l) => (l ? `  [off] ${l}` : l)).join('\n'));
  if (r.status !== 0) fails++;
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
