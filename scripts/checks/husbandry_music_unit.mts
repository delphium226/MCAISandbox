/**
 * The husbandry and music rungs offline (MC_HUSBANDRY_AGE, MC_MUSIC_AGE; docs/specs/ladder-rungs.md; no server):
 * - each rung's four stages counted from what the world reports (breed_pen's young born, shear_pen's wool, a trade's
 *   redstone, a make's note blocks) and from levels (pen kinds holding a pair, hay bales stored, the bandstand and the bell
 *   post built), each ending at its target, in order;
 * - the stages' feeds tag the options that feed them;
 * - the goods' targets (hay bales, note blocks), the music keeps (redstone, the bell), the merchant's redstone offer, the
 *   two works' designs (8 tuned note blocks; a bell), the planner's note block and hay bale;
 * - the ballot after iron with the new tier-2 rungs (at most 4, in the ballot's order);
 * - with MC_HUSBANDRY_AGE=off and MC_MUSIC_AGE=off (a second run of this file) both rungs are words, off the ballot,
 *   nothing counted, no redstone sold.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/husbandry_music_unit.mts (sets MC_LADDER and MC_IRON_AGE itself)
 */
import { spawnSync } from 'node:child_process';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
if (MODE === 'off') process.env.MC_HUSBANDRY_AGE = process.env.MC_MUSIC_AGE = 'off';
const L = await import('../../server/src/ladder');

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
type Slot = { kind?: string; annex?: boolean; pen?: { built?: boolean; animals?: number } };
/** A complete village with storage of `items` and annex pen slots, its ladder on `rung` (iron reached). */
const make = (rung: 'husbandry' | 'music', items: Record<string, number> = {}, slots: Slot[] = []): Village => {
  const v = { name: 'H', complete: true, initiatives: [], layouts: [{ slots }], storage: { chests: [{ x: 0, y: 0, z: 0, items }] } } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  L.chooseRung(v, rung, [rung], 2);
  return v;
};
const note = (v: Village, got: Array<[import('../../server/src/ladder').Counter, number]>, who: string, t = 10) => got.flatMap(([c, n]) => L.noteLadder(v, c, who, n, t));
const store = (v: Village) => (v.storage as unknown as { chests: Array<{ items: Record<string, number> }> }).chests[0].items;
const work = (v: Village, kind: string, state: 'open' | 'built') => v.initiatives!.push({ id: `i${v.initiatives!.length + 1}`, by: 'the village', kind, design: `small_${kind}_oak`, x: 0, y: 0, z: 0, at: 1, state, crew: [], steps: [] });
const pen = (kind: string, animals: number, built = true): Slot => ({ kind, annex: true, pen: { built, animals } });

if (MODE === 'off') {
  ok(!L.rungImplemented('husbandry') && !L.rungImplemented('music'), 'off: husbandry and music are words');
  ok(L.RUNG_DEFS.husbandry.stages.every((s) => !s.counter) && L.RUNG_DEFS.music.stages.every((s) => !s.counter), 'off: no stage counted');
  const v = { name: 'H', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  for (const r of ['letters', 'copper', 'trade'] as const) st.reached.push({ rung: r, t: 1, workers: [] });
  const opts = L.rungOptions(v);
  ok(!opts.includes('husbandry') && !opts.includes('music'), `off: off the ballot (${opts.join(', ')})`);
  ok(!L.husbandryCounts('breed_pen', 'fed 2 cows wheat in the pen on annex slot 1: 1 young born, 3 in the pen').length, 'off: no birth counted');
  ok(!L.musicCounts('make', 'made 2 note_block; put into storage: 2 note_block').length, 'off: no note block counted');
  const { SELLS } = await import('../../server/src/merchant');
  // (the machines and maps rungs still buy redstone from it: their compasses and powered rails)
  const F = await import('../../server/src/ladderFlags');
  ok(SELLS.some((o) => o.item === 'redstone') === ((F.MACHINES_AGE && F.IRON_AGE) || F.MAPS_AGE), 'off: the merchant sells no redstone for music (only for machines or maps)');
  process.exit(fails ? 1 : 0);
}

// 1. The husbandry rung
{
  ok(L.rungImplemented('husbandry') && L.RUNG_DEFS.husbandry.tier === 2 && L.RUNG_DEFS.husbandry.after.join() === 'iron', 'husbandry is implemented, tier 2, after iron');
  const ss = L.RUNG_DEFS.husbandry.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `pens:${L.HUSBANDRY_PENS},bred:${L.HUSBANDRY_BRED},wool:${L.HUSBANDRY_WOOL},hay:${L.HUSBANDRY_HAY}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  const slots = [pen('chicken', 3), pen('chicken', 5), pen('sheep', 1), pen('cow', 4, false)];
  const v = make('husbandry', { hay_block: 2 }, slots);
  const st = v.ladder!;
  ok(L.husbandryCurrent(v) && !L.musicCurrent(v), 'husbandry is current');
  // the messages (mcBuild.ts breedPen's and shearPen's words)
  ok(JSON.stringify(L.husbandryCounts('breed_pen', 'fed 4 sheeps wheat in the pen on annex slot 2: 2 young born, 6 in the pen')) === '[["bred",2]]', 'a breeding\'s young born');
  ok(!L.husbandryCounts('breed_pen', 'fed 2 cows wheat in the pen on annex slot 1: no young yet').length && !L.husbandryCounts('breed_pen', 'the cow pen on annex slot 1 has 1 adult ready to breed of 3').length, 'no young, nothing counted');
  ok(JSON.stringify(L.husbandryCounts('shear_pen', 'sheared 3 sheep in the pen on annex slot 2: 5 wool (3 white_wool, 2 black_wool)')) === '[["wool",5]]', 'a shearing\'s wool');
  ok(!L.husbandryCounts('shear_pen', 'no sheep with wool in the pen on annex slot 2 (wool grows back when they eat the pen\'s grass)').length, 'no wool, nothing counted');
  ok(!L.husbandryCounts('make', 'put into storage: 2 hay_block').length, 'hay is a level, not a make\'s count');
  // stage 1: kinds of pen holding a pair (a level)
  ok(L.feedsStage(v, 'pen:cow') && L.feedsStage(v, 'annex') && !L.feedsStage(v, 'penwork:1:breed'), 'stage 1 feeds leading animals into pens and the annex');
  ok(L.pairedPenKinds(v).join() === 'chicken', `one kind holds a pair (an unbuilt pen and a lone sheep do not): ${L.pairedPenKinds(v).join()}`);
  note(v, L.levelCounts(v, store(v)), 'Ada');
  ok(st.stage === 0 && st.totals?.pens === 1 && st.totals?.hay === 2, `1 of 3 kinds; the hay seen is kept for stage 4: ${L.progressLine(v, 20, 1)}`);
  slots[2].pen!.animals = 2;
  slots[3].pen!.built = true;
  let news = note(v, L.levelCounts(v, store(v)), 'Ben', 20);
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends at ${L.HUSBANDRY_PENS} kinds: ${news[0]?.text}`);
  // stage 2: young born
  ok(L.feedsStage(v, 'penwork:3:breed') && L.feedsStage(v, 'penfeed') && !L.feedsStage(v, 'penwork:3:shear'), 'stage 2 feeds breeding and seeds for it');
  news = [];
  for (let i = 0; i < 20 && !news.length; i++) news = note(v, L.husbandryCounts('breed_pen', 'fed 4 cows wheat in the pen on annex slot 4: 2 young born, 6 in the pen'), i % 3 ? 'Cara' : 'Dan', 30 + i);
  ok(news[0]?.stage === 1 && st.stage === 2 && st.totals?.bred === L.HUSBANDRY_BRED, `stage 2 ends at ${L.HUSBANDRY_BRED} young: ${news[0]?.text}`);
  // stage 3: wool
  ok(L.feedsStage(v, 'penwork:3:shear') && L.feedsStage(v, 'iron:forge:shears') && !L.feedsStage(v, 'penwork:3:breed'), 'stage 3 feeds shearing and the village\'s shears');
  news = [];
  for (let i = 0; i < 20 && !news.length; i++) news = note(v, L.husbandryCounts('shear_pen', 'sheared 2 sheep in the pen on annex slot 3: 4 wool (4 white_wool)'), 'Eve', 50 + i);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends at ${L.HUSBANDRY_WOOL} wool: ${news[0]?.text}`);
  // stage 4: hay bales stored, the highest seen; the workshop's target
  ok(L.feedsStage(v, 'make:hay_block') && L.feedsStage(v, 'farm:2') && L.feedsStage(v, 'slot:2:3', 'slot:wheat'), 'stage 4 feeds the hay make and the wheat harvests');
  ok(L.rungGoodTarget(v, 'hay_block', { hay_block: 2 }) === L.HUSBANDRY_HAY && L.rungGoodTarget(v, 'note_block', {}) === 0, 'the hay target: the rung\'s bales; no note blocks');
  ok(st.count === 2, 'stage 4 starts at the 2 bales seen in stage 1');
  store(v).hay_block = 7;
  note(v, L.levelCounts(v, store(v)), 'Fay');
  store(v).hay_block = 3;
  note(v, L.levelCounts(v, store(v)), 'Fay');
  ok(st.totals?.hay === 7 && st.stage === 3, 'bales taken do not count down');
  store(v).hay_block = L.HUSBANDRY_HAY;
  news = note(v, L.levelCounts(v, store(v)), 'Gus', 80);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'husbandry') && !st.current, `the rung is reached at ${L.HUSBANDRY_HAY} bales: ${news[0]?.text}`);
  ok(L.rungGoodTarget(v, 'hay_block', {}) === 0 && !L.levelCounts(v, store(v)).length, 'nothing wanted once the rung is over');
}

// 2. The music rung
{
  ok(L.rungImplemented('music') && L.RUNG_DEFS.music.tier === 2 && L.RUNG_DEFS.music.after.join() === 'iron', 'music is implemented, tier 2, after iron');
  const ss = L.RUNG_DEFS.music.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `redstone:${L.MUSIC_REDSTONE},notes:${L.MUSIC_NOTES},bandstand:1,bell:1`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  ok(!ss.some((s) => /jukebox|disc/.test(s.words)), 'no jukebox (a diamond) and no disc (a creeper killed by a skeleton)');
  const v = make('music', {});
  const st = v.ladder!;
  // the messages: the trade skill's purchase, a make's puts
  ok(JSON.stringify(L.musicCounts('trade', 'traded with the merchant: bought 4 redstone for 2 emerald (stock left 2)')) === '[["redstone",4]]', 'redstone bought');
  ok(!L.musicCounts('trade', 'traded with the merchant: bought 2 leather for 1 emerald (stock left 5)').length, 'other purchases are not');
  ok(JSON.stringify(L.musicCounts('make', 'made 2 note_block (made from storage: crafted 16 oak_planks); put into storage: 2 note_block')) === '[["notes",2]]', 'a make\'s note blocks');
  // the keeps: redstone for the note blocks still to make, the bell until its post is posted or built
  ok(L.musicKeep(v, 'redstone') === L.MUSIC_NOTES && L.musicKeep(v, 'bell') === 1, 'redstone and the bell kept for buying');
  ok(L.rungGoodTarget(v, 'note_block', { note_block: 1 }) === 1 + L.MUSIC_NOTES, 'the note block target: the stock and those still to make');
  // (rungs test 11-14: the note blocks made from redstone already stored, 4 bought: the keep stays over storage's 3)
  {
    const w = make('music', {});
    w.ladder!.totals = { notes: L.MUSIC_NOTES, redstone: 4 };
    ok(L.musicKeep(w, 'redstone', { redstone: 3 }) === 3 + L.MUSIC_REDSTONE - 4, `redstone still bought for stage 1 once the note blocks are made (${L.musicKeep(w, 'redstone', { redstone: 3 })})`);
  }
  // stage 1: redstone
  ok(L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:redstone') && L.feedsStage(v, 'activity:lib:sell') && !L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:leather'), 'stage 1 feeds buying redstone and selling for its emeralds');
  let news = note(v, L.musicCounts('trade', 'traded with the merchant: bought 4 redstone for 2 emerald (stock left 2)'), 'Ada');
  news = note(v, L.musicCounts('trade', 'traded with the merchant: bought 4 redstone for 2 emerald (stock left 0)'), 'Ben', 11);
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends at ${L.MUSIC_REDSTONE} redstone: ${news[0]?.text}`);
  // stage 2: note blocks
  ok(L.feedsStage(v, 'make:note_block'), 'stage 2 feeds the note block make');
  note(v, L.musicCounts('make', 'put into storage: 2 note_block'), 'Cara');
  ok(L.musicKeep(v, 'redstone') === L.MUSIC_NOTES - 2, 'the redstone kept falls with the note blocks made');
  news = [];
  for (let i = 0; i < 4 && !news.length; i++) news = note(v, L.musicCounts('make', 'put into storage: 2 note_block'), 'Cara', 20 + i);
  ok(news[0]?.stage === 1 && st.stage === 2 && L.musicKeep(v, 'redstone') === undefined && L.rungGoodTarget(v, 'note_block', { note_block: 8 }) === 8, `stage 2 ends at ${L.MUSIC_NOTES} note blocks; no more redstone or blocks wanted: ${news[0]?.text}`);
  // stage 3: the bandstand
  ok(L.feedsStage(v, 'help:i3', 'help:bandstand') && !L.feedsStage(v, 'help:i3', 'help:well'), 'stage 3 feeds the bandstand\'s help');
  work(v, 'well', 'built');
  work(v, L.MUSIC_BANDSTAND, 'open');
  ok(!L.levelCounts(v, store(v)).some(([c]) => c === 'bandstand'), 'an open bandstand is not built');
  v.initiatives!.at(-1)!.state = 'built';
  news = note(v, L.levelCounts(v, store(v)), 'Dan', 30);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends with the bandstand built: ${news[0]?.text}`);
  // stage 4: the bell post
  ok(L.feedsStage(v, 'help:i5', 'help:bell_post') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:bell'), 'stage 4 feeds the bell post\'s help and buying the bell');
  work(v, L.MUSIC_BELL_POST, 'open');
  ok(L.musicKeep(v, 'bell') === undefined, 'no bell bought while the post holds one');
  v.initiatives!.at(-1)!.state = 'built';
  news = note(v, L.levelCounts(v, store(v)), 'Eve', 40);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'music'), `the rung is reached with the bell post: ${news[0]?.text}`);
  ok(L.musicKeep(v, 'bell') === undefined && L.musicKeep(v, 'redstone') === undefined, 'nothing kept once the rung is over');
}

// 3. The goods, the merchant, the works, the planner
{
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  ok(W.HUSBANDRY_GOODS.map((g) => g.item).join() === 'hay_block' && W.HUSBANDRY_GOODS[0].allow?.includes('wheat') && W.MUSIC_GOODS.map((g) => g.item).join() === 'note_block', 'the goods: hay bales (wheat allowed), note blocks');
  const { SELLS } = await import('../../server/src/merchant');
  const red = SELLS.find((o) => o.item === 'redstone');
  ok(!!red && SELLS.some((o) => o.item === 'bell'), `the merchant sells redstone (${red?.n} for ${red?.emeralds}) and a bell`);
  const SW = await import('../../server/src/smallWorks');
  const { designBill, Materials } = await import('../../server/src/mineflayer/mcMaterials');
  const bs = SW.smallWorkKind(L.MUSIC_BANDSTAND)?.make('spruce'), bp = SW.smallWorkKind(L.MUSIC_BELL_POST)?.make('birch');
  ok(!!bs && designBill(bs).note_block === L.MUSIC_NOTES && SW.isSmallWork(bs.name) && SW.smallWorkKindOf(bs.name) === L.MUSIC_BANDSTAND && SW.smallWorkWood(bs.name) === 'spruce', `the bandstand: ${bs?.name}, ${designBill(bs!).note_block} note blocks`);
  const notes = Object.values(bs!.palette).filter((b) => b.startsWith('note_block')).map((b) => Number(/note=(\d+)/.exec(b)?.[1]));
  ok(notes.join() === SW.BANDSTAND_NOTES.join() && notes.every((n, i) => !i || n > notes[i - 1]), `tuned to a rising scale: ${notes.join(' ')}`);
  // (each note block has air above it, so it sounds)
  const above = bs!.layers[1].every((row, z) => [...row].every((c, x) => !/^[1-8]$/.test(c) || bs!.layers[2][z][x] === '.'));
  ok(above, 'air above every note block');
  ok(!!bp && designBill(bp).bell === 1 && SW.smallWorkKindOf(bp.name) === L.MUSIC_BELL_POST, `the bell post: ${bp?.name}, one bell`);
  ok(![L.MUSIC_BANDSTAND, L.MUSIC_BELL_POST].some((k) => SW.SMALL_WORKS.some((x) => x.kind === k) || SW.menuWorks().some((x) => x.kind === k)), 'neither is on a member\'s menu');
  const { default: minecraftData } = await import('minecraft-data');
  const mats = new Materials(minecraftData('26.1'));
  const pn = mats.plan({ note_block: 2 }, { oak_planks: 16, redstone: 2 }), pq = mats.plan({ note_block: 1 }, { oak_planks: 8 });
  const ph = mats.plan({ hay_block: 2 }, { wheat: 18 });
  ok(!Object.keys(pn.gather).length && !pn.problems.length, 'note blocks planned from stored planks and redstone');
  ok(!!Object.keys(pq.gather).length || !!pq.problems.length, `no redstone: the note block is short (${JSON.stringify(pq.gather)})`);
  ok(!Object.keys(ph.gather).length && !ph.problems.length, 'hay bales planned from stored wheat');
}

// 4. The ballot after iron: tier 2's implemented rungs, at most 4, in the ballot's order; music after the first is reached
{
  const v = { name: 'B', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = [{ rung: 'iron', t: 1, workers: [] }];
  const tier2 = L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 2 && L.rungImplemented(r));
  ok(tier2.includes('husbandry') && tier2.includes('music'), `tier 2: ${tier2.join(', ')}`);
  ok(L.rungOptions(v).join() === tier2.slice(0, 4).join() && L.rungOptions(v).length <= 4, `after iron: ${L.rungOptions(v).join(', ')}`);
  for (const r of tier2.filter((x) => x !== 'husbandry' && x !== 'music')) st.reached.push({ rung: r, t: 1, workers: [] });
  ok(L.rungOptions(v).join() === tier2.filter((x) => x === 'husbandry' || x === 'music').join(), `the other tier-2 rungs reached: ${L.rungOptions(v).join(', ')}`);
  for (const id of ['husbandry', 'music'] as const) {
    const pv = L.rungPreview(id);
    ok(/every skill exists/.test(pv) && pv.length <= 200, `${id}'s preview: ${pv}`);
  }
  st.reached.push({ rung: 'husbandry', t: 1, workers: [] }, { rung: 'music', t: 1, workers: [] });
  ok(!L.rungOptions(v).some((r) => L.RUNG_DEFS[r].tier === 2), `tier 2 done: ${L.rungOptions(v).join(', ')}`);
}

// 5. The off mode, in a process of its own
{
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], 'off'], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  ok(r.status === 0, 'the off run');
}

console.log(fails ? `husbandry_music_unit: ${fails} failed` : 'husbandry_music_unit: all passed');
process.exit(fails ? 1 : 0);
