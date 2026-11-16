/**
 * The tier-3 rungs offline (MC_MACHINES_AGE, MC_BEES_AGE, MC_MAPS_AGE; docs/specs/ladder-rungs.md; no server):
 * - each rung's four stages counted from the records its skills write after the server confirmed them (the egg collector,
 *   the rail line, its powered rails, the apiary's housed nests, the maps charted and hung), from storage (rails and a
 *   minecart, the cartography table) and from the skills' messages (honeycomb, honey bottles, waxed copper), each ending at
 *   its target, in order, the rung reached;
 * - the stages' feeds tag the options that feed them (the pen's collector, the rung chores, the makes, the merchant's buys);
 * - the goods' targets, the merchant's keeps and offers (gold ingots, redstone, bee nests), the planner's recipes;
 * - the rail line's plan (padPaths.ts planRailLine on fixtures: 4-neighbour, steps of 1, no curve on a slope, around what
 *   is hard, a fail when too long or cut off), its shapes and the powered run with its torch (the rail line's check);
 * - the apiary's and the map wall's designs; the map areas' geometry (the wall's 2x2, the atlas' 3x3, the charting point);
 * - the ballot after tier 2: diamond, machines, bees and maps, bees only after husbandry and copper, maps after letters;
 * - with the three flags off (a second run of this file): words, off the ballot, nothing counted, no gold or nests sold.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/tier3_unit.mts (sets MC_LADDER, MC_IRON_AGE and MC_LETTERS itself)
 */
import { spawnSync } from 'node:child_process';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
// (maps comes after letters, a rung only with MC_LETTERS)
process.env.MC_LETTERS = 'on';
// (the Nether sells gold for its ingot too: off here, so the merchant's gold is the machines rung's alone)
if (MODE === 'off') process.env.MC_MACHINES_AGE = process.env.MC_BEES_AGE = process.env.MC_MAPS_AGE = process.env.MC_NETHER_AGE = 'off';
const L = await import('../../server/src/ladder');
type Counter = import('../../server/src/ladder').Counter;
type RungId = import('../../server/src/wanted').RungId;

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
/** A complete village with a storage hut at 0..6, 0..6 and storage of `items`, its ladder on `rung` (its earlier rungs reached). */
const make = (rung: RungId, items: Record<string, number> = {}): Village => {
  const v = { name: 'T3', complete: true, initiatives: [], structures: [], designs: {}, plots: [], layouts: [], storageHut: { x1: 0, z1: 0, x2: 6, z2: 6, spots: [] }, storage: { chests: [{ x: 0, y: 0, z: 0, items }] } } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = (['iron', 'letters', 'copper', 'trade', 'husbandry', 'music'] as RungId[]).map((r) => ({ rung: r, t: 1, workers: [] }));
  L.chooseRung(v, rung, [rung], 2);
  return v;
};
const note = (v: Village, got: Array<[Counter, number]>, who: string, t = 10) => got.flatMap(([c, n]) => L.noteLadder(v, c, who, n, t));
const store = (v: Village) => (v.storage as unknown as { chests: Array<{ items: Record<string, number> }> }).chests[0].items;
const levels = (v: Village, who: string, t = 10) => note(v, L.levelCounts(v, store(v)), who, t);
const work = (v: Village, kind: string, state: 'open' | 'built') => v.initiatives!.push({ id: `i${v.initiatives!.length + 1}`, by: 'the village', kind, design: `small_${kind}_oak`, x: 0, y: 0, z: 0, at: 1, state, crew: [], steps: [] });

if (MODE === 'off') {
  for (const r of ['machines', 'bees', 'maps'] as const) {
    ok(!L.rungImplemented(r) && L.RUNG_DEFS[r].stages.every((s) => !s.counter), `off: ${r} is words`);
  }
  const v = { name: 'T3', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = (['iron', 'letters', 'copper', 'trade', 'husbandry', 'music'] as RungId[]).map((r) => ({ rung: r, t: 1, workers: [] }));
  const opts = L.rungOptions(v);
  ok(!opts.some((r) => r === 'machines' || r === 'bees' || r === 'maps'), `off: off the ballot (${opts.join(', ')})`);
  ok(!L.beesCounts('tend_apiary', 'sheared 2 full bee nests at the apiary: 6 honeycomb').length, 'off: no honeycomb counted');
  const { SELLS } = await import('../../server/src/merchant');
  ok(!SELLS.some((o) => o.item === 'gold_ingot' || o.item === 'bee_nest'), 'off: the merchant sells no gold ingots or bee nests');
  process.exit(fails ? 1 : 0);
}

const P = await import('../../server/src/padPaths');

// 1. The machines rung
{
  ok(L.rungImplemented('machines') && L.RUNG_DEFS.machines.tier === 3 && L.RUNG_DEFS.machines.after.join() === 'iron', 'machines is implemented, tier 3, after iron');
  const ss = L.RUNG_DEFS.machines.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `collector:1,carts:${L.MACHINES_RAILS + 1},railline:1,powered:${L.MACHINES_POWERED}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  const v = make('machines', { rail: 0 });
  const st = v.ladder!;
  ok(L.machinesCurrent(v) && !L.beesCurrent(v) && !L.mapsCurrent(v), 'machines is current');
  // stage 1: the collector, a record its skill writes once the server shows the hopper and the chest
  ok(L.feedsStage(v, 'penwork:2:collector') && L.feedsStage(v, 'make:hopper') && !L.feedsStage(v, 'penwork:2:eggs'), 'stage 1 feeds the pen\'s collector and the hopper make');
  ok(L.rungGoodTarget(v, 'hopper', {}) === 1 && L.rungGoodTarget(v, 'rail', {}) === L.MACHINES_RAILS && L.rungGoodTarget(v, 'minecart', {}) === 1, 'the goods wanted: a hopper, 16 rails, a minecart');
  ok(!levels(v, 'Ada').length && st.stage === 0, 'nothing counted before the collector');
  v.machines = { collector: { slot: 2, hopper: [0, 64, 0], chest: [0, 64, 1], by: 'Ada', t: 1 } };
  let news = levels(v, 'Ada');
  ok(news[0]?.stage === 0 && st.stage === 1 && L.rungGoodTarget(v, 'hopper', { hopper: 0 }) === 0, `stage 1 ends with the collector fitted: ${news[0]?.text}`);
  // stage 2: 16 rails and a minecart stored (a level: rails over 16 do not stand for the cart)
  ok(L.feedsStage(v, 'make:rail') && L.feedsStage(v, 'make:minecart'), 'stage 2 feeds the rail and minecart makes');
  store(v).rail = 32;
  levels(v, 'Ben');
  ok(st.stage === 1 && st.totals?.carts === L.MACHINES_RAILS, `32 rails are 16 of the 17 pieces: ${L.progressLine(v, 20, 1)}`);
  store(v).minecart = 1;
  news = levels(v, 'Ben', 20);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends with the minecart: ${news[0]?.text}`);
  // stage 3: the line (the rails it still takes are the rail target)
  ok(L.feedsStage(v, 'rung:rail_line') && L.feedsStage(v, 'make:rail') && !L.feedsStage(v, 'rung:power_line'), 'stage 3 feeds laying the line and the rail make');
  v.machines.line = { cells: Array.from({ length: 40 }, (_, i): [number, number, number] => [i, 65, 0]), shapes: [], laid: 10 };
  ok(L.rungGoodTarget(v, 'rail', { rail: 5 }) === 30, 'the rail target: the line\'s rails still to lay');
  levels(v, 'Cara');
  ok(st.stage === 2, 'a line part laid is not the stage');
  v.machines.line = { ...v.machines.line, laid: 40, done: true };
  news = levels(v, 'Cara', 30);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends with the line laid: ${news[0]?.text}`);
  // stage 4: powered rails confirmed powered; gold and redstone kept for buying
  ok(L.feedsStage(v, 'rung:power_line') && L.feedsStage(v, 'make:powered_rail') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:gold_ingot') && L.feedsStage(v, 'activity:lib:sell'), 'stage 4 feeds the powered rails, their make and the gold');
  ok(L.rungKeep(v, 'gold_ingot', {}) === L.MACHINES_POWERED && L.rungKeep(v, 'redstone', {}) === 2 && L.rungKeep(v, 'gold_ingot', { powered_rail: 6 }) === undefined, 'gold and redstone kept while the powered rails are to make');
  ok(L.rungGoodTarget(v, 'powered_rail', {}) === L.MACHINES_POWERED && L.rungGoodTarget(v, 'redstone_torch', {}) === 1, 'the powered rails and the torch wanted');
  v.machines.line = { ...v.machines.line, powered: [[3, 65, 0], [4, 65, 0]] };
  levels(v, 'Dan');
  ok(st.stage === 3 && st.count === 2, `2 of 6 powered: ${L.progressLine(v, 40, 1)}`);
  v.machines.line = { ...v.machines.line, powered: Array.from({ length: 6 }, (_, i): [number, number, number] => [3 + i, 65, 0]), torch: [5, 65, 1] };
  news = levels(v, 'Dan', 50);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'machines') && !st.current, `the rung is reached with 6 powered rails: ${news[0]?.text}`);
  const { SELLS } = await import('../../server/src/merchant');
  ok(SELLS.some((o) => o.item === 'gold_ingot') && SELLS.some((o) => o.item === 'redstone'), 'the merchant sells gold ingots and redstone');
}

// 2. The rail line's plan (the check of the route-and-place code's planning)
{
  const flat = () => 64;
  const none = () => false;
  const valid = (p: { cells: Array<[number, number, number]>; shapes: string[] }) => p.cells.every((c, i) => {
    const q = p.cells[i + 1];
    return !q || (Math.abs(q[0] - c[0]) + Math.abs(q[2] - c[2]) === 1 && Math.abs(q[1] - c[1]) <= 1);
  });
  // (a curve is flat with its neighbours along the line; a slope runs straight)
  const curveFlat = (p: { cells: Array<[number, number, number]>; shapes: string[] }) => p.shapes.every((s, i) => !/_(east|west)$/.test(s) || !/^(north|south)_/.test(s) || [p.cells[i - 1], p.cells[i + 1]].every((n) => !n || n[1] <= p.cells[i][1]));
  const a = P.planRailLine([0, 0], [10, 0], flat, none);
  ok(!a.fail && a.cells.length === 11 && a.shapes.every((s) => s === 'east_west') && a.cells.every((c) => c[1] === 65), `a straight on flat ground: ${a.cells.length} rails, ${[...new Set(a.shapes)].join()}`);
  const step = (x: number) => (x >= 5 ? 65 : 64);
  const b = P.planRailLine([0, 0], [10, 0], (x) => step(x), none);
  ok(!b.fail && valid(b) && b.shapes[4] === 'ascending_east' && b.cells[5][1] === 66, `a step of one: rail 5 climbs east (${b.shapes.slice(3, 7).join(' ')})`);
  const cliff = (x: number) => (x >= 5 ? 66 : 64);
  const c = P.planRailLine([0, 0], [10, 0], (x) => cliff(x), (x, z) => Math.abs(z) > 3);
  ok(!!c.fail, `a step of two with no way round fails: ${c.fail}`);
  const wall = (x: number, z: number) => x === 5 && z >= -2 && z <= 2;
  const d = P.planRailLine([0, 0], [10, 0], flat, wall);
  ok(!d.fail && valid(d) && !d.cells.some(([x, , z]) => wall(x, z)) && d.shapes.some((s) => /^(north|south)_(east|west)$/.test(s)) && curveFlat(d), `round a wall: ${d.cells.length} rails, curves ${d.shapes.filter((s) => /^(north|south)_(east|west)$/.test(s)).length}`);
  // (a turn on a slope is not taken: the hill rises north of x 5, the line must turn on flat ground)
  const hill = (x: number, z: number) => 64 + (x >= 5 && z < 0 ? Math.min(3, -z) : 0);
  const e = P.planRailLine([0, 0], [5, -6], hill, none);
  ok(!e.fail && valid(e) && curveFlat(e), `up a hill and round: ${e.cells.length} rails, ${e.shapes.join(' ')}`);
  const f = P.planRailLine([0, 0], [200, 0], flat, none, 160);
  ok(!!f.fail && /at most 160/.test(f.fail), `too long: ${f.fail}`);
  ok(P.railShapes([[0, 65, 0], [1, 65, 0], [1, 65, 1]]).join() === 'east_west,south_west,north_south', 'the shapes: a straight, a curve, a straight');
  const run = P.poweredRun(a.cells, a.shapes, () => true, L.MACHINES_POWERED);
  ok(!!run && run.from >= 1 && run.from + L.MACHINES_POWERED <= a.cells.length - 1 && run.torch[2] !== 0 && run.torch[1] === 65, `the powered run: rails ${run?.from}..${(run?.from ?? 0) + 5}, the torch at ${run?.torch.join(',')}`);
  ok(P.poweredRun(d.cells.slice(0, 5), d.shapes.slice(0, 5), () => true) === null, 'no powered run on a line shorter than 6 straights');
}

// 3. The bees rung
{
  ok(L.rungImplemented('bees') && L.RUNG_DEFS.bees.tier === 3 && L.RUNG_DEFS.bees.after.join() === 'husbandry,copper', 'bees is implemented, tier 3, after husbandry and copper');
  const ss = L.RUNG_DEFS.bees.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `hives:${L.BEES_NESTS},honeycomb:${L.BEES_COMB},honey:${L.BEES_HONEY},waxed:${L.BEES_WAX}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  const v = make('bees', {});
  const st = v.ladder!;
  // the messages
  ok(JSON.stringify(L.beesCounts('tend_apiary', 'sheared 2 full bee nests at the apiary: 6 honeycomb')) === '[["honeycomb",6]]', 'the apiary\'s shearing');
  ok(JSON.stringify(L.beesCounts('tend_apiary', 'filled 1 honey bottle at the apiary')) === '[["honey",1]]', 'a honey bottle');
  ok(!L.beesCounts('tend_apiary', 'no full bee nest at the apiary (the bees fill a nest from the flowers over some minutes; honey level 5 is full)').length, 'no full nest, nothing counted');
  ok(JSON.stringify(L.beesCounts('harvest_honeycomb', 'got 3 honeycomb from 1 bee nests at 5,70,9 (0 more in the state within 48 blocks): reached target of 3 honeycomb')) === '[["honeycomb",3]]', 'the wild nests\' activity');
  ok(JSON.stringify(L.beesCounts('wax_copper', 'waxed 3 copper blocks of the copper canopy (3 of 5 waxed)')) === '[["waxed",3]]', 'copper waxed');
  // stage 1: the apiary, its nests housed
  ok(L.feedsStage(v, 'help:i2', 'help:apiary') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:bee_nest') && L.feedsStage(v, 'make:campfire'), 'stage 1 feeds the apiary, its nests and campfires');
  ok(L.rungKeep(v, 'bee_nest', {}) === L.BEES_NESTS && L.rungGoodTarget(v, 'campfire', {}) === L.BEES_NESTS, 'two nests bought and two campfires made for the apiary');
  work(v, L.BEES_APIARY, 'open');
  ok(L.rungKeep(v, 'bee_nest', {}) === undefined && L.rungGoodTarget(v, 'campfire', {}) === 0, 'none once it is posted (it holds its own)');
  v.initiatives![0].state = 'built';
  ok(!levels(v, 'Ada').length, 'a built apiary whose nests took no bees is not counted');
  v.apiary = { housed: ['1,66,1', '3,66,1'] };
  let news = levels(v, 'Ada');
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends with both nests housed: ${news[0]?.text}`);
  // stage 2: honeycomb
  ok(L.feedsStage(v, 'rung:apiary:shear') && L.feedsStage(v, 'activity:lib:honeycomb') && L.feedsStage(v, 'iron:forge:shears') && !L.feedsStage(v, 'rung:apiary:bottle'), 'stage 2 feeds shearing, the wild nests and the shears');
  news = [];
  for (let i = 0; i < 10 && !news.length; i++) news = note(v, L.beesCounts('tend_apiary', 'sheared 1 full bee nest at the apiary: 3 honeycomb'), 'Ben', 20 + i);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends at ${L.BEES_COMB} honeycomb: ${news[0]?.text}`);
  // stage 3: honey
  ok(L.feedsStage(v, 'rung:apiary:bottle') && L.feedsStage(v, 'make:glass_bottle'), 'stage 3 feeds bottling and the bottles');
  ok(L.rungGoodTarget(v, 'glass_bottle', {}) === L.BEES_HONEY, 'glass bottles for the honey still to fill');
  news = [];
  for (let i = 0; i < 10 && !news.length; i++) news = note(v, L.beesCounts('tend_apiary', 'filled 2 honey bottles at the apiary'), 'Cara', 40 + i);
  ok(news[0]?.stage === 2 && st.stage === 3 && L.rungGoodTarget(v, 'glass_bottle', {}) === 0, `stage 3 ends at ${L.BEES_HONEY} bottles: ${news[0]?.text}`);
  // stage 4: the canopy waxed
  ok(L.feedsStage(v, 'rung:wax_copper') && L.feedsStage(v, 'rung:apiary:shear'), 'stage 4 feeds the waxing and more honeycomb');
  // (#251: no canopy standing, as from MC_LADDER_START=bees: its blocks made and the canopy posted, then nothing more)
  ok(L.beesCanopyWanted(v) && L.copperTarget(v, 'copper_block', { copper_block: 2 }) === L.COPPER_MADE && L.copperTarget(v, 'spyglass', {}) === 0
    && L.feedsStage(v, 'make:copper_block') && L.feedsStage(v, 'help:i9', 'help:copper_canopy'), 'stage 4 with no canopy: its 5 copper blocks wanted');
  work(v, L.COPPER_CANOPY, 'open');
  ok(!L.beesCanopyWanted(v) && L.copperTarget(v, 'copper_block', {}) === 0 && !L.canopyBuilt(v), 'none once the canopy is posted');
  v.initiatives![v.initiatives!.length - 1].state = 'built';
  ok(L.canopyBuilt(v) && !L.beesCanopyWanted(v), 'the canopy built: waxing offered');
  note(v, L.beesCounts('wax_copper', 'waxed 3 copper blocks of the copper canopy (3 of 5 waxed)'), 'Dan', 60);
  news = note(v, L.beesCounts('wax_copper', 'waxed 2 copper blocks of the copper canopy (5 of 5 waxed)'), 'Eve', 61);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'bees'), `the rung is reached with the roof waxed: ${news[0]?.text}`);
  const { SELLS } = await import('../../server/src/merchant');
  const nest = SELLS.find((o) => o.item === 'bee_nest');
  ok(!!nest && nest.emeralds > 0, `the merchant sells a bee nest (${nest?.emeralds} emeralds)`);
  // the apiary's design: two nests over lit campfires with air between, wildflowers, its nest cells as APIARY_NESTS says
  const SW = await import('../../server/src/smallWorks');
  const { designBill } = await import('../../server/src/mineflayer/mcMaterials');
  const ap = SW.smallWorkKind(L.BEES_APIARY)?.make('birch');
  const bill = ap ? designBill(ap) : {};
  ok(!!ap && bill.bee_nest === 2 && bill.campfire === 2 && (bill.wildflowers ?? 0) >= 4 && SW.smallWorkKindOf(ap.name) === L.BEES_APIARY, `the apiary: ${ap?.name}, ${JSON.stringify(bill)}`);
  const cell = (x: number, l: number, z: number) => ap!.palette[ap!.layers[l][z][x]] ?? ap!.layers[l][z][x];
  ok(SW.APIARY_NESTS.every(([x, l, z]) => /^bee_nest/.test(cell(x, l, z)) && cell(x, l - 1, z) === '.' && /^campfire\[lit=true/.test(cell(x, l - 2, z)) && cell(x, l - 1, z + 1) === '.'),
    'each nest over air over a lit campfire, the cell in front of it open to stand in');
  ok(![L.BEES_APIARY, L.MAPS_WALL_WORK].some((k) => SW.SMALL_WORKS.some((x) => x.kind === k) || SW.menuWorks().some((x) => x.kind === k)), 'neither the apiary nor the map wall is on a member\'s menu');
}

// 4. The maps rung
{
  ok(L.rungImplemented('maps') && L.RUNG_DEFS.maps.tier === 3 && L.RUNG_DEFS.maps.after.join() === 'letters', 'maps is implemented, tier 3, after letters');
  const ss = L.RUNG_DEFS.maps.stages;
  ok(ss.map((s) => `${s.counter}:${s.target}`).join() === `ctable:1,vmap:1,mapwall:${L.MAPS_WALL},mapped:${L.MAPS_ATLAS}`, `the stages: ${ss.map((s) => s.words).join(' | ')}`);
  // the geometry: vanilla's grid, the hut at 3,3 in area 0,0 (its south-east quarter: the wall's 2x2 is 0..1, 0..1)
  ok(L.mapCell(63, 63).join() === '0,0' && L.mapCell(64, -65).join() === '1,-1' && JSON.stringify(L.cellArea(1, 0)) === '{"x1":64,"z1":-64,"x2":191,"z2":63}', 'map areas are 128 a side, the first centred on 0,0');
  const wc = L.wallCells({ x: 3, z: 3 });
  ok(wc.map((w) => `${w.pos}:${w.cell.join(',')}`).join(' ') === 'nw:0,0 ne:1,0 sw:0,1 se:1,1', `the wall's 2x2 toward the hut's nearest corner: ${wc.map((w) => `${w.pos}:${w.cell.join(',')}`).join(' ')}`);
  ok(L.wallCells({ x: -3, z: -3 }).map((w) => w.cell.join(',')).join(' ') === '-1,-1 0,-1 -1,0 0,0', 'and toward the north-west from its north-west quarter');
  const at = L.atlasCells({ x: 3, z: 3 });
  ok(at.length === 9 && at[4].join() === '0,0' && wc.every((w) => at.some((q) => q.join() === w.cell.join())), 'the atlas is the 3x3 round the own area, the wall inside it');
  const cp = L.chartPoint([1, 1], { x: 3, z: 3 });
  ok(cp.x === 72 && cp.z === 72 && L.mapCell(cp.x, cp.z).join() === '1,1', `the charting point: 8 inside the area, nearest the hut (${cp.x},${cp.z})`);
  const v = make('maps', {});
  const st = v.ladder!;
  // stage 1: the table
  ok(L.feedsStage(v, 'make:cartography_table') && L.rungGoodTarget(v, 'cartography_table', {}) === 1, 'stage 1 feeds the table\'s make');
  ok(!L.chartWanted(v).length, 'no area wanted before stage 2');
  store(v).cartography_table = 1;
  let news = levels(v, 'Ada');
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends with the table: ${news[0]?.text}`);
  // stage 2: the village's own area
  ok(L.chartWanted(v).map((q) => q.join()).join(' ') === '0,0' && L.rungGoodTarget(v, 'map', {}) === 1 && L.rungKeep(v, 'redstone', {}) === 1, 'the own area wanted: one map, its compass\'s redstone');
  ok(L.feedsStage(v, 'rung:chart:0:0') && L.feedsStage(v, 'make:map') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:redstone'), 'stage 2 feeds charting, the map make and the redstone');
  v.maps = { cells: { '1,0': { id: 4, by: 'Ben', t: 1 } } };
  levels(v, 'Ben');
  ok(st.stage === 1, 'another area is not the village\'s own');
  v.maps.cells!['0,0'] = { id: 5, by: 'Ben', t: 2 };
  news = levels(v, 'Ben', 20);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends with the own area charted: ${news[0]?.text}`);
  // stage 3: the map wall
  ok(L.chartWanted(v).map((q) => q.join()).join(' ') === '0,1 1,1', `the wall's areas still to chart, nearest first: ${L.chartWanted(v).map((q) => q.join()).join(' ')}`);
  ok(L.feedsStage(v, 'rung:hang_maps') && L.feedsStage(v, 'help:i1', 'help:map_wall') && L.feedsStage(v, 'make:item_frame') && L.feedsStage(v, 'rung:chart:1:1'), 'stage 3 feeds the wall, its hanging, frames and charting');
  ok(L.rungGoodTarget(v, 'item_frame', {}) === L.MAPS_WALL, 'four item frames wanted');
  v.maps.hung = { nw: 5, ne: 4 };
  levels(v, 'Cara');
  ok(st.stage === 2 && st.count === 2, `2 of 4 hung: ${L.progressLine(v, 30, 1)}`);
  v.maps.cells!['0,1'] = { id: 6, by: 'Cara', t: 3 };
  v.maps.cells!['1,1'] = { id: 7, by: 'Cara', t: 3 };
  v.maps.hung = { nw: 5, ne: 4, sw: 6, se: 7 };
  news = levels(v, 'Cara', 40);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends with four maps hung: ${news[0]?.text}`);
  // stage 4: the atlas (the wall's four counted already)
  ok(st.count === 4 && L.chartWanted(v).length === 5 && L.rungGoodTarget(v, 'map', {}) === 4, `the atlas: 4 of 9, five areas left (${L.chartWanted(v).map((q) => q.join()).join(' ')})`);
  for (const q of L.chartWanted(v)) v.maps.cells![L.cellKey(q[0], q[1])] = { id: 9, by: 'Dan', t: 4 };
  news = levels(v, 'Dan', 50);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'maps'), `the rung is reached with the 3x3 charted: ${news[0]?.text}`);
  // the map wall's design: the frames' cells open, a solid board north of each, the cartography table
  const SW = await import('../../server/src/smallWorks');
  const mw = SW.smallWorkKind(L.MAPS_WALL_WORK)?.make('spruce');
  const cell = (x: number, l: number, z: number) => mw!.palette[mw!.layers[l][z][x]] ?? mw!.layers[l][z][x];
  ok(!!mw && Object.values(SW.MAP_WALL_FRAMES).every(([x, l, z]) => cell(x, l, z) === '.' && !/^[._]$/.test(cell(x, l, z - 1))) && Object.values(mw.palette).includes('cartography_table'), 'the map wall: each frame\'s cell open before a solid board, a cartography table');
}

// 5. The planner makes the goods from what storage holds
{
  const { default: minecraftData } = await import('minecraft-data');
  const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
  const mats = new Materials(minecraftData('26.1'));
  const cases: Array<[string, Record<string, number>]> = [
    ['hopper', { iron_ingot: 5, oak_planks: 8 }], ['rail', { iron_ingot: 6, stick: 1 }], ['minecart', { iron_ingot: 5 }],
    ['powered_rail', { gold_ingot: 6, stick: 1, redstone: 1 }], ['redstone_torch', { redstone: 1, stick: 1 }],
    ['campfire', { oak_log: 3, stick: 3, coal: 1 }], ['glass_bottle', { glass: 3 }],
    ['cartography_table', { paper: 2, oak_planks: 4 }], ['map', { paper: 8, iron_ingot: 4, redstone: 1 }], ['item_frame', { stick: 8, leather: 1 }],
  ];
  for (const [item, stock] of cases) {
    const p = mats.plan({ [item]: 1 }, stock);
    ok(!Object.keys(p.gather).length && !p.problems.length, `${item} planned from ${JSON.stringify(stock)}`);
  }
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  ok([...W.MACHINES_GOODS, ...W.BEES_GOODS, ...W.MAPS_GOODS].every((g) => !!g.rung), 'the goods are the rungs\' own');
}

// 6. The ballot after tier 2: tier 3 in the ballot's order; bees only after husbandry and copper, maps after letters
{
  const v = { name: 'B', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  const tier2 = L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 2 && L.rungImplemented(r));
  st.reached = [{ rung: 'iron', t: 1, workers: [] }, ...tier2.map((r) => ({ rung: r, t: 1, workers: [] }))];
  ok(L.rungOptions(v).join() === ['diamond', 'machines', 'bees', 'maps'].filter((r) => L.rungImplemented(r as RungId)).join(), `after tier 2: ${L.rungOptions(v).join(', ')}`);
  st.reached = st.reached.filter((r) => r.rung !== 'husbandry' && r.rung !== 'letters');
  ok(!L.rungOptions(v).some((r) => L.RUNG_DEFS[r].tier === 3), `tier 3 waits while a tier-2 rung is open (${L.rungOptions(v).join(', ')})`);
  for (const id of ['machines', 'bees', 'maps'] as const) {
    const pv = L.rungPreview(id);
    ok(/every skill exists/.test(pv) && pv.length <= 200, `${id}'s preview: ${pv}`);
  }
}

// 7. The off mode, in a process of its own
{
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], 'off'], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  ok(r.status === 0, 'the off run');
}

console.log(fails ? `tier3_unit: ${fails} failed` : 'tier3_unit: all passed');
process.exit(fails ? 1 : 0);
