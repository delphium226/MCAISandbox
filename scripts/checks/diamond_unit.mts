/**
 * The diamond rung offline (#22, MC_DIAMOND_AGE; runs/2026-10-30/diamond/spec.md; no server):
 * - the rung's four stages counted: depth below y 0, diamonds brought up, the first diamond pickaxe and one per deep miner
 *   from one counter, each stage's workers kept;
 * - the counts from a chore step: the chain's depth from the mine record (the diamond level within the slack counts as
 *   all the way, only what is new since the rung began), diamonds from a dig trip's text, a diamond pickaxe given;
 * - the chain laid deep by landings: aim 40 below or the diamond level, `aboveY` and `diamond` on the leg, none at the
 *   diamond level, none while the rung is not current, none while the stairs still go down;
 * - who the next diamond pickaxe is for, and the iron pickaxe gate;
 * - with MC_DIAMOND_AGE=off (a second run of this file): the stages are words, nothing deepens.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/diamond_unit.mts (sets MC_LADDER and MC_IRON_AGE itself)
 */
import { spawnSync } from 'node:child_process';
import type { Mine, Village } from '../../server/src/village';

const OFF = process.argv[2] === 'off', START = process.argv[2] === 'start';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
if (OFF) process.env.MC_DIAMOND_AGE = 'off';
if (START) process.env.MC_LADDER_START = 'diamond';
const L = await import('../../server/src/ladder');
const D = await import('../../server/src/mineflayer/mcDiamond');
const { chainDeepest } = await import('../../server/src/mineflayer/mcMine');

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const reg = { note: () => undefined, save: () => undefined };
/** A village on the diamond rung, its chain's current level at `level` (its stairs from 6 above), finished or not. */
const make = (level: number | undefined, current = 'diamond'): Village => {
  const iron = { x: 0, z: 0, y: (level ?? -10) + 6, dir: [1, 0], steps: level === undefined ? 3 : 6, level, legs: level === undefined ? [] : [{ x: 6, z: 0, y: level, dir: [1, 0], dug: 0, ended: [] }], dug: 40, got: {} };
  const v = { name: 'T', complete: true, mine: { top: { x: 0, z: 0 }, hut: { x1: -2, z1: -2, x2: 2, z2: 2 }, dir: [1, 0], level: 57, steps: 9, dug: 0, ended: [], got: {}, iron } } as unknown as Village;
  L.ladderOf(v, 1)!;
  if (current) L.chooseRung(v, current as never, [current as never], 2);
  return v;
};

if (START) {
  const v = { name: 'T', complete: true } as unknown as Village;
  const s = L.ladderOf(v, 1)!;
  ok(s.current === 'diamond' && s.reached.map((r) => r.rung).join() === 'iron' && L.rungOptions(v).join() === 'letters,copper,machines,trade', `MC_LADDER_START=diamond: starts on diamond, iron reached (${L.progressLine(v, 2, 1)})`);
  process.exit(fails ? 1 : 0);
}
if (OFF) {
  const v = make(-8);
  ok(L.RUNG_DEFS.diamond.stages.every((s) => !s.counter), 'off: the diamond stages are words');
  ok(D.deepenForDiamonds(reg, v) === '' && v.mine!.iron!.level === -8 && !v.mine!.ironPast, 'off: nothing deepens');
  ok(D.diamondCounts(v, 'dig_iron', 'brought up 0 raw iron, 0 coal, 3 diamond').length === 0, 'off: nothing counted');
  ok(D.deepDigBlocked(v, false, {}) === null, 'off: the dig is not gated');
  process.exit(fails ? 1 : 0);
}

// 1. The stages
const v = make(-8);
const st = v.ladder!;
ok(st.current === 'diamond' && /stage 1 of 4: 0 of 56 blocks dug down below y 0/.test(L.progressLine(v, 3, 600000)), `progress: ${L.progressLine(v, 3, 600000)}`);
ok(L.feedsStage(v, 'iron:dig') && !L.feedsStage(v, 'diamond:forge:diamond_pickaxe:Ada'), 'stage 1 feeds the dig');
L.noteLadder(v, 'diamonds', 'Ben', 4, 4);
let news = L.noteLadder(v, 'depth', 'Ada', 56, 5);
ok(news.length === 1 && st.stage === 1 && st.count === 4, `stage 1 ends at 56 blocks down; 4 diamonds already up: ${news[0]?.text}`);
news = L.noteLadder(v, 'dtools', 'Cara', 1, 6);
ok(news.length === 0 && st.stage === 1, 'a diamond pickaxe given during stage 2 waits');
news = L.noteLadder(v, 'diamonds', 'Ben', 6, 7);
ok(news.length === 2 && st.stage === 3, `10 diamonds end stage 2, and the pickaxe already given ends stage 3 (${news.map((n) => n.stage + 1).join(', ')})`);
ok(L.feedsStage(v, 'diamond:forge:diamond_pickaxe:Ada') && /1 of 3 diamond pickaxes given/.test(L.progressLine(v, 8, 1)), `stage 4: ${L.progressLine(v, 8, 1)}`);
L.noteLadder(v, 'dtools', 'Dan', 1, 9);
news = L.noteLadder(v, 'dtools', 'Eve', 1, 10, 4);
ok(news[0]?.kind === 'rung' && st.reached.at(-1)?.rung === 'diamond', `the rung is reached: ${news[0]?.text}`);
ok(JSON.stringify(st.reached.at(-1)!.workers[3]) === JSON.stringify(['Dan', 'Eve']), `stage 4's workers are its own (the shared counter credits the current stage): ${JSON.stringify(st.reached.at(-1)!.workers)}`);
ok(L.rungPreview('diamond').includes('every skill exists'), `the ballot's preview: ${L.rungPreview('diamond')}`);

// 2. The counts from a chore step
const c = make(-8);
const msg = 'iron trip: carrying 6 raw iron; ... brought up 5 raw iron, 2 coal, 3 diamond; deposited';
let got = D.diamondCounts(c, 'dig_iron', msg);
ok(JSON.stringify(got) === '[["depth",8],["diamonds",3]]', `a trip at y -8: ${JSON.stringify(got)}`);
for (const [k, n] of got) L.noteLadder(c, k, 'Ada', n, 3);
c.mine!.iron!.level = -30;
got = D.diamondCounts(c, 'dig_iron', 'brought up 0 raw iron, 0 coal, 0 diamond');
ok(JSON.stringify(got) === '[["depth",22]]', `deeper to -30: only the new 22: ${JSON.stringify(got)}`);
for (const [k, n] of got) L.noteLadder(c, k, 'Ada', n, 4);
c.mine!.iron!.level = -54;
got = D.diamondCounts(c, 'dig_iron', 'brought up 0 raw iron');
ok(JSON.stringify(got) === '[["depth",26]]', `-54 is the diamond level within the slack (all 56): ${JSON.stringify(got)}`);
ok(chainDeepest({ iron: { y: -40, steps: 9, legs: [] } } as unknown as Mine) === -49, 'stairs still going: their last step');
ok(JSON.stringify(D.diamondCounts(c, 'make_iron_tool', 'made a diamond_pickaxe (...); given to Ada', 'diamond_pickaxe')) === '[["dtools",1]]', 'a diamond pickaxe given');
ok(D.diamondCounts(c, 'make_iron_tool', 'made a iron_pickaxe; given to Ada', 'iron_pickaxe').length === 0, 'an iron one is not');
ok(D.diamondCounts(make(-8, 'letters'), 'dig_iron', msg).length === 0, 'nothing while another rung is current');

// 3. The chain laid deep
const d = make(-8);
let note = D.deepenForDiamonds(reg, d);
let i = d.mine!.iron! as typeof d.mine.iron & { aboveY?: number; diamond?: boolean };
ok(!!note && i.targetY === -48 && i.aboveY === -8 && i.diamond === true && d.mine!.ironPast?.length === 1 && i.level === undefined, `a landing at -8, the next leg to -48: ${note}`);
ok(D.deepenForDiamonds(reg, d) === '', 'not while its stairs go down');
i.level = -44;
i.steps = 36;
i.legs = [{ x: i.x + i.dir[0] * 36, z: i.z + i.dir[1] * 36, y: -44, dir: i.dir, dug: 0, ended: [] }];
note = D.deepenForDiamonds(reg, d);
ok(d.mine!.iron!.targetY === -56 && d.mine!.ironPast?.length === 2, `a stop at -44 a landing, the next leg to -56: ${note}`);
ok(D.deepenForDiamonds(reg, make(-55)) === '', 'none at the diamond level (within the slack)');
ok(D.deepenForDiamonds(reg, make(-8, 'letters')) === '', 'none while another rung is current');
const nostart = make(-8);
nostart.mine!.iron!.legs = [];
nostart.mine!.iron!.abandoned = [];
(nostart.mine!.iron! as { deepGiven?: unknown[] }).deepGiven = ([[1, 0], [0, 1], [0, -1], [-1, 0]] as Array<[number, number]>).map((dir) => ({ x: 6, z: 0, y: -8, dir, steps: 3, why: 'a cave' }));
ok(D.deepenForDiamonds(reg, nostart) === '' && nostart.mine!.iron!.level === -8 && !nostart.mine!.iron!.finished && !!(nostart.mine as { diamondTried?: number }).diamondTried, 'every start given up before: the level stays, tried again later');

// 4. The forge and the gate
const f = make(-56);
ok(D.diamondForgeNeed(f, [{ name: 'Ada', digs: 2 }, { name: 'Ben', digs: 5 }, { name: 'Cara', digs: 0 }], 3).toString() === '[object Object]' && (D.diamondForgeNeed(f, [{ name: 'Ada', digs: 2 }, { name: 'Ben', digs: 5 }], 3) as { for: string }).for === 'Ben', 'the deep miner with most digs first');
f.mine!.ironGiven = [{ item: 'diamond_pickaxe', to: 'Ben', by: 'Dan', at: 1 }];
ok((D.diamondForgeNeed(f, [{ name: 'Ada', digs: 2 }, { name: 'Ben', digs: 5 }], 3) as { for: string }).for === 'Ada', 'then the next without one');
ok(/short.*2 of 3/.test(String(D.diamondForgeNeed(f, [{ name: 'Ada', digs: 2 }], 2))), 'diamonds short');
ok(D.diamondForgeNeed(make(-8, 'letters'), [{ name: 'Ada', digs: 2 }], 9) === '', 'not before the rung');
ok(D.deepDigBlocked(f, false, {}) === 'the deep level needs an iron pickaxe' && D.deepDigBlocked(f, true, {}) === null && D.deepDigBlocked(f, false, { iron_pickaxe: 1 }) === null, 'the iron pickaxe gate');
ok(D.deepDigBlocked(make(-8), false, {}) !== null, 'gated for the whole rung, the landings too');
ok(D.deepDigBlocked(make(-8, 'letters'), false, {}) === null, 'not on an iron level before the rung');
ok(D.deepDigWords(f, { diamond: 4 })?.name === 'Dig for diamonds in the deep mine' && D.deepDigWords(make(-8, 'letters'), {}) === null, `the dig's words: ${D.deepDigWords(f, { diamond: 4 })?.facts}`);

// 5. The diamond forge's planner takes diamonds from stock (the world's has no source for them: the block's recipe loops)
const { default: minecraftData } = await import('minecraft-data');
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const gp = new Materials(minecraftData('26.1'), { gems: true }).plan({ diamond_pickaxe: 1 }, { diamond: 3, stick: 2 });
ok(!Object.keys(gp.gather).length && gp.steps.length === 1 && gp.steps[0].item === 'diamond_pickaxe', `a diamond pickaxe from 3 stored diamonds: ${JSON.stringify(gp.steps)}`);

// 6. The flag off, in a process of its own
for (const mode of ['off', 'start']) {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], mode], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  ok(r.status === 0, `the ${mode} run`);
}

console.log(fails ? `DIAMOND UNIT FAIL (${fails})` : 'DIAMOND UNIT OK');
process.exit(fails ? 1 : 0);
