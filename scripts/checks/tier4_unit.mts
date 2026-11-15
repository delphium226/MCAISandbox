/**
 * The tier-4 rungs offline (MC_ENCHANTMENT_AGE, MC_SEA_AGE; docs/specs/ladder-rungs.md; no server), with MC_LETTERS on (its
 * default since 11-14):
 * - each rung's four stages counted from the skills' messages (obsidian cast, books enchanted, boats made, fish caught) and
 *   from the records the skills write after the server confirmed them (the table placed, the levels `xp query` read, the
 *   dock whole) or the built work (the lighthouse), each ending at its target, in order, the rung reached;
 * - the stages' feeds tag the options that feed them (the rung chores, the makes, the forge's bucket, the merchant's buys);
 * - the goods' targets (the table, the books, the boats in the village's wood, the lighthouse's lantern and rod), the
 *   merchant's keeps and offers (bottles o' enchanting, lapis), the planner's recipes, the enchanter;
 * - the pure geometry: the lava the deep tunnels reach, the table's floor cell by its bookshelves, the dock on fixtures, the
 *   table's offer, experience points, the boat of a wood, the lighthouse's design, the skills registered;
 * - the ballot: tier 4 after every implemented tier-3 rung, enchantment after letters and diamond, the sea after copper;
 * - flags off (a second run): words, off the ballot, nothing counted, no bottles sold; MC_LETTERS off (a third run):
 *   enchantment unreachable, maps with it, and the sea still offered once the rest of tier 3 is reached.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/tier4_unit.mts (sets MC_LADDER and MC_IRON_AGE itself)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Village } from '../../server/src/village';

const MODE = process.argv[2] ?? '';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
if (MODE === 'off') process.env.MC_ENCHANTMENT_AGE = process.env.MC_SEA_AGE = 'off';
if (MODE === 'noletters') process.env.MC_LETTERS = 'off';
const L = await import('../../server/src/ladder');
const E = await import('../../server/src/enchantSea');
type Counter = import('../../server/src/ladder').Counter;
type RungId = import('../../server/src/wanted').RungId;

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const BEFORE: RungId[] = ['iron', 'letters', 'copper', 'trade', 'husbandry', 'music', 'diamond', 'machines', 'bees', 'maps'];
/** A complete village with storage of `items`, its ladder on `rung` (the rungs before tier 4 reached). */
const make = (rung: RungId, items: Record<string, number> = {}, wood = 'oak'): Village => {
  const v = { name: 'T4', complete: true, wood, initiatives: [], structures: [], designs: {}, plots: [], layouts: [], storageHut: { x1: 0, z1: 0, x2: 6, z2: 6, spots: [] }, storage: { chests: [{ x: 0, y: 0, z: 0, items }] } } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = BEFORE.map((r) => ({ rung: r, t: 1, workers: [] }));
  L.chooseRung(v, rung, [rung], 2);
  return v;
};
const note = (v: Village, got: Array<[Counter, number]>, who: string, t = 10) => got.flatMap(([c, n]) => L.noteLadder(v, c, who, n, t));
const store = (v: Village) => (v.storage as unknown as { chests: Array<{ items: Record<string, number> }> }).chests[0].items;
const levels = (v: Village, who: string, t = 10) => note(v, L.levelCounts(v, store(v)), who, t);
const work = (v: Village, kind: string, state: 'open' | 'built') => v.initiatives!.push({ id: `i${v.initiatives!.length + 1}`, by: 'the village', kind, design: `small_${kind}_oak`, x: 0, y: 0, z: 0, at: 1, state, crew: [], steps: [] });
const ballot = (reached: RungId[]) => {
  const v = { name: 'B', complete: true } as unknown as Village;
  const st = L.ladderOf(v, 1)!;
  st.current = undefined;
  st.reached = reached.map((r) => ({ rung: r, t: 1, workers: [] }));
  return L.rungOptions(v);
};

if (MODE === 'off') {
  for (const r of ['enchantment', 'sea'] as const) ok(!L.rungImplemented(r) && L.RUNG_DEFS[r].stages.every((s) => !s.counter), `off: ${r} is words`);
  const opts = ballot(BEFORE);
  ok(!opts.includes('enchantment') && !opts.includes('sea'), `off: off the ballot (${opts.join(', ') || 'none'})`);
  ok(!L.enchantCounts('make_obsidian', 'made 2 obsidian from still lava').length && !L.seaCounts('make', 'put into storage: 2 oak_boat').length, 'off: nothing counted');
  const { SELLS } = await import('../../server/src/merchant');
  ok(!SELLS.some((o) => o.item === 'experience_bottle' || o.item === 'lapis_lazuli'), 'off: the merchant sells no bottles o\' enchanting or lapis');
  const W = await import('../../server/src/wanted');
  ok(W.RUNG_NEEDS.enchantment.length > 0 && W.RUNG_NEEDS.sea.length > 0, 'off: the rungs\' needs are back');
  process.exit(fails ? 1 : 0);
}
if (MODE === 'noletters') {
  ok(!L.LETTERS && !L.rungImplemented('letters') && L.rungImplemented('enchantment'), 'no letters: letters is words, enchantment is built');
  // (tier 3 reached but maps, which needs letters: the tier no longer waits for it; the sea, after copper, is offered)
  const opts = ballot(['iron', 'copper', 'trade', 'husbandry', 'music', 'diamond', 'machines', 'bees']);
  ok(opts.join() === 'sea', `no letters: the sea is offered once the rest of tier 3 is reached, enchantment and maps are not (${opts.join(', ') || 'none'})`);
  process.exit(fails ? 1 : 0);
}

ok(L.LETTERS, 'MC_LETTERS is on (its default since 11-14)');

// 1. The enchantment rung
{
  const R = L.RUNG_DEFS.enchantment;
  ok(L.rungImplemented('enchantment') && R.tier === 4 && R.after.join() === 'letters,diamond', 'enchantment is implemented, tier 4, after letters and diamond');
  ok(R.stages.map((s) => `${s.counter}:${s.target}`).join() === `obsidian:${L.ENCHANT_OBSIDIAN},etable:1,xplevel:${L.ENCHANT_LEVELS},enchanted:${L.ENCHANT_BOOKS}`, `the stages: ${R.stages.map((s) => s.words).join(' | ')}`);
  const v = make('enchantment', {});
  const st = v.ladder!;
  ok(L.enchantmentCurrent(v) && !L.seaCurrent(v), 'enchantment is current');
  // stage 1: obsidian, from make_obsidian's message
  ok(L.feedsStage(v, 'rung:obsidian') && L.feedsStage(v, 'rung:fill_bucket') && L.feedsStage(v, 'iron:forge:bucket') && !L.feedsStage(v, 'rung:place_table'), 'stage 1 feeds the obsidian, the bucket\'s filling and the forge\'s bucket');
  ok(!L.enchantCounts('make_obsidian', 'cast no obsidian at the deep level at y -56: 1 cast, none brought up').length, 'no obsidian brought up counts nothing');
  note(v, L.enchantCounts('make_obsidian', 'made 3 obsidian from still lava at the deep level (y -56): water poured from a bucket on still lava and taken back up, the obsidian mined with a diamond pickaxe'), 'Ada');
  ok(st.stage === 0 && st.count === 3, `3 of 4 obsidian: ${L.progressLine(v, 11, 1)}`);
  let news = note(v, L.enchantCounts('make_obsidian', 'made 1 obsidian from still lava at the deep level (y -56)'), 'Ada', 12);
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends at 4 obsidian: ${news[0]?.text}`);
  // stage 2: the table, made then placed (the record place_enchanting_table writes once the server shows it)
  ok(L.feedsStage(v, 'make:enchanting_table') && L.feedsStage(v, 'rung:place_table') && L.feedsStage(v, 'iron:dig') && L.feedsStage(v, 'make:book'), 'stage 2 feeds the table\'s make and placing, the deep dig (diamonds) and books');
  ok(L.rungGoodTarget(v, 'enchanting_table', {}) === 1 && L.rungGoodTarget(v, 'book', {}) === 1 + L.ENCHANT_BOOKS, 'the goods wanted: the table, a book for it and one a book to enchant');
  ok(L.rungGoodTarget(v, 'book', { enchanting_table: 1 }) === L.ENCHANT_BOOKS, 'a table made: its book is no longer wanted');
  store(v).enchanting_table = 1;
  levels(v, 'Ben');
  ok(st.stage === 1, 'a table in storage is not the stage');
  v.enchant = { table: [3, 64, 4] };
  news = levels(v, 'Ben', 20);
  ok(news[0]?.stage === 1 && st.stage === 2 && L.rungGoodTarget(v, 'enchanting_table', { enchanting_table: 0 }) === 0, `stage 2 ends with the table placed: ${news[0]?.text}`);
  // stage 3: the levels, the highest a member holds; the bottles kept for buying
  ok(L.feedsStage(v, 'rung:xp_bottles') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:experience_bottle') && L.feedsStage(v, 'iron:dig') && L.feedsStage(v, 'iron:smelt'), 'stage 3 feeds the bottles, their buying, the deep ores and the furnaces');
  ok(L.rungKeep(v, 'experience_bottle', {}) === L.ENCHANT_BOTTLES && L.rungKeep(v, 'lapis_lazuli', {}) === L.ENCHANT_BOOKS, 'bottles and lapis kept for buying');
  v.enchant = { ...v.enchant, levels: { Cara: 3, Dan: 5 } };
  levels(v, 'Dan');
  ok(st.stage === 2 && st.count === 5 && L.levelsHeld(v) === 5, `5 of 8 levels, the highest held: ${L.progressLine(v, 30, 1)}`);
  ok(L.enchanterOf(v, ['Cara', 'Dan']) === 'Dan' && L.enchanterOf({ ...v, enchant: { ...v.enchant, enchanter: 'Cara' } } as Village, ['Cara', 'Dan']) === 'Cara'
    && L.enchanterOf({ ...v, enchant: { ...v.enchant, enchanter: 'Eve' } } as Village, ['Cara', 'Dan']) === 'Dan' && L.enchanterOf(make('enchantment'), ['Ada']) === undefined,
    'the enchanter: the one named while here, else the most levels, else none');
  v.enchant = { ...v.enchant, levels: { Cara: 3, Dan: 9 } };
  news = levels(v, 'Dan', 40);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends at 8 levels held: ${news[0]?.text}`);
  // stage 4: books enchanted (spending levels does not undo stage 3)
  ok(L.feedsStage(v, 'rung:enchant') && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:lapis_lazuli') && !L.feedsStage(v, 'rung:xp_bottles'), 'stage 4 feeds the enchanting and the lapis');
  ok(L.rungKeep(v, 'experience_bottle', {}) === undefined, 'no bottles kept after the levels stage');
  v.enchant = { ...v.enchant, levels: { Dan: 4 } };
  levels(v, 'Dan');
  note(v, L.enchantCounts('enchant_books', 'enchanted 3 books at the enchanting table (3 at the table); 4 levels left'), 'Dan', 50);
  ok(st.stage === 3 && st.count === 3 && L.rungKeep(v, 'lapis_lazuli', {}) === 2 && L.rungGoodTarget(v, 'book', {}) === 2, `3 of 5 enchanted, the lapis and books still wanted: ${L.progressLine(v, 50, 1)}`);
  ok(L.rungKeep(v, 'leather', {}) === 2 && L.rungKeep(v, 'leather', { book: 1 }) === 1 && L.rungKeep(v, 'leather', { book: 2 }) === undefined && L.feedsStage(v, 'activity:lib:buy', 'activity:lib:buy:leather'), 'a leather kept and bought for each book still to bind (enchantment7: none was, stage 4 stopped at the 2 stocked books)');
  ok(!L.enchantCounts('enchant_books', 'enchanted no book at the enchanting table').length, 'no book enchanted counts nothing');
  news = note(v, L.enchantCounts('enchant_books', 'enchanted 2 books at the enchanting table (1 at the table, 1 by a charged command: the table\'s window did not answer); 2 levels left'), 'Dan', 60);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'enchantment') && !st.current, `the rung is reached with 5 books: ${news[0]?.text}`);
  const { SELLS } = await import('../../server/src/merchant');
  ok(SELLS.some((o) => o.item === 'experience_bottle') && SELLS.some((o) => o.item === 'lapis_lazuli'), 'the merchant sells bottles o\' enchanting and lapis');
}

// 2. The sea rung
{
  const R = L.RUNG_DEFS.sea;
  ok(L.rungImplemented('sea') && R.tier === 4 && R.after.join() === 'copper', 'the sea is implemented, tier 4, after copper');
  ok(R.stages.map((s) => `${s.counter}:${s.target}`).join() === `boats:${L.SEA_BOATS},dock:1,fish:${L.SEA_FISH},lighthouse:1`, `the stages: ${R.stages.map((s) => s.words).join(' | ')}`);
  const v = make('sea', {}, 'birch');
  const st = v.ladder!;
  ok(L.seaCurrent(v) && !L.enchantmentCurrent(v), 'the sea is current');
  // stage 1: boats in the village's wood
  ok(L.feedsStage(v, 'make:birch_boat') && L.feedsStage(v, 'make:bamboo_raft') && !L.feedsStage(v, 'rung:dock'), 'stage 1 feeds the boat makes');
  ok(L.rungGoodTarget(v, 'birch_boat', {}) === L.SEA_BOATS && L.rungGoodTarget(v, 'oak_boat', {}) === 0, 'three boats wanted, in the village\'s birch');
  note(v, L.seaCounts('make', 'made 2 birch_boat; put into storage: 2 birch_boat'), 'Ada');
  ok(st.stage === 0 && st.count === 2 && L.rungGoodTarget(v, 'birch_boat', { birch_boat: 2 }) === 3, `2 of 3 boats, one more wanted: ${L.progressLine(v, 11, 1)}`);
  let news = note(v, L.seaCounts('make', 'put into storage: 1 birch_boat'), 'Ada', 12);
  ok(news[0]?.stage === 0 && st.stage === 1, `stage 1 ends at 3 boats: ${news[0]?.text}`);
  // stage 2: the dock, its record whole
  ok(L.feedsStage(v, 'rung:dock'), 'stage 2 feeds the dock');
  v.sea = { dock: { cells: [{ x: 0, y: 63, z: 0, block: 'birch_planks' }], laid: 0 } };
  levels(v, 'Ben');
  ok(st.stage === 1, 'a planned dock is not the stage');
  v.sea = { dock: { ...v.sea.dock, laid: 1, done: true } };
  news = levels(v, 'Ben', 20);
  ok(news[0]?.stage === 1 && st.stage === 2, `stage 2 ends with the dock built: ${news[0]?.text}`);
  // stage 3: fish
  ok(L.feedsStage(v, 'activity:lib:fish') && L.feedsStage(v, 'make:fishing_rod'), 'stage 3 feeds fishing and its rods');
  ok(!L.seaCounts('fish', 'nothing bit in 4 minutes at -1540,62,30 (12 casts)').length, 'nothing caught counts nothing');
  note(v, L.seaCounts('fish', 'caught 14 fish (10 cod, 3 salmon, 1 pufferfish, 0 tropical fish) and 1 other items (1 bowl) at -1540,62,30 in 20 casts (time)'), 'Cara', 30);
  ok(st.stage === 2 && st.count === 14, `14 of 24 fish: ${L.progressLine(v, 30, 1)}`);
  news = note(v, L.seaCounts('fish', 'caught 10 fish (10 cod, 0 salmon, 0 pufferfish, 0 tropical fish) and 0 other items () at -1540,62,30 in 15 casts (time)'), 'Cara', 31);
  ok(news[0]?.stage === 2 && st.stage === 3, `stage 3 ends at 24 fish: ${news[0]?.text}`);
  // stage 4: the lighthouse, its lantern and rod made until it is posted
  ok(L.feedsStage(v, 'help:i1', 'help:lighthouse') && L.feedsStage(v, 'make:lantern') && L.feedsStage(v, 'make:lightning_rod'), 'stage 4 feeds the lighthouse, its lantern and rod');
  ok(L.rungGoodTarget(v, 'lantern', {}) === 1 && L.rungGoodTarget(v, 'lightning_rod', {}) === 1, 'a lantern and a lightning rod wanted');
  work(v, L.SEA_LIGHTHOUSE, 'open');
  ok(L.rungGoodTarget(v, 'lantern', {}) === 0 && L.rungWorkPosted(v, L.SEA_LIGHTHOUSE), 'posted: they are the work\'s');
  levels(v, 'Dan');
  ok(st.stage === 3, 'an open lighthouse is not the stage');
  v.initiatives![0].state = 'built';
  news = levels(v, 'Dan', 40);
  ok(news[0]?.kind === 'rung' && st.reached.some((r) => r.rung === 'sea'), `the rung is reached with the lighthouse built: ${news[0]?.text}`);
  // the lighthouse's design
  const SW = await import('../../server/src/smallWorks');
  const lh = SW.smallWorkKind(L.SEA_LIGHTHOUSE)?.make('spruce');
  ok(!!lh && lh.width === 3 && lh.depth === 3 && lh.height === 10 && Object.values(lh.palette).some((b) => /^lantern/.test(b)) && Object.values(lh.palette).some((b) => /^lightning_rod/.test(b)) && lh.layers[9][1][1] !== '.',
    `the lighthouse: 3x3, ${lh?.height} high, a lantern and a lightning rod on top`);
}

// 3. The pure geometry and arithmetic
{
  ok(E.xpTotal(8) === 112 && E.xpTotal(16) === 352 && E.xpTotal(17) === 394 && E.xpTotal(0) === 0, `experience points: 8 levels are ${E.xpTotal(8)}`);
  ok(E.levelOf('Ada has 5 experience levels') === 5 && E.levelOf('Ada has 1 experience level') === 1 && E.levelOf('No player was found') === null, 'xp query\'s answer read');
  ok(E.boatOf('birch') === 'birch_boat' && E.boatOf('bamboo') === 'bamboo_raft' && E.boatOf('crimson') === 'oak_boat' && E.boatOf(undefined) === 'oak_boat', 'the boat of a wood');
  ok(E.enchantChoice([{ level: 2 }, { level: 5 }, { level: 8 }], 3, 3) === 0 && E.enchantChoice([{ level: 4 }, { level: 5 }, { level: 8 }], 3, 3) === -1
    && E.enchantChoice([null, { level: 2 }, null], 5, 1) === -1 && E.enchantChoice([null, { level: 2 }, null], 5, 2) === 1, 'the table\'s cheapest offer the member can pay for');
  // the lava the deep tunnels reach: behind a wall, not in a tunnel, within reach, nearest first
  const cells = Array.from({ length: 11 }, (_, i) => ({ x: i, y: -56, z: 0 }));
  const lava = [{ x: 3, y: -56, z: 2 }, { x: 5, y: -55, z: 3 }, { x: 8, y: -56, z: 6 }, { x: 2, y: -56, z: 0 }, { x: 9, y: -57, z: -2 }];
  const t = E.lavaTargets(lava, cells, 5);
  ok(t.map((q) => `${q.lava.x},${q.lava.y},${q.lava.z}@${q.stand.x}`).join(' ') === '3,-56,2@3 9,-57,-2@9 5,-55,3@5', `the lava within reach: ${t.map((q) => `${q.lava.x},${q.lava.y},${q.lava.z}@${q.stand.x}`).join(' ')}`);
  ok(E.lavaTargets(lava, cells, 1).length === 1 && E.lavaTargets(lava, [], 5).length === 0, 'at most max; none without tunnels');
  // the table's floor cell: a library 9x9 at y 64, shelves along z 6 at x 3-5 on two layers
  const shelves = new Set(['3,64,6', '4,64,6', '5,64,6', '3,65,6', '4,65,6', '5,65,6']);
  const shelf = (x: number, y: number, z: number) => shelves.has(`${x},${y},${z}`);
  const free = (x: number, y: number, z: number) => !shelf(x, y, z);
  const room = (x: number, y: number, z: number) => free(x, y, z) && free(x, y + 1, z) && z !== 6;
  const spots = E.tableSpots({ x1: 0, z1: 0, x2: 8, z2: 8 }, 64, room, shelf, free);
  ok(spots[0]?.x === 4 && spots[0]?.z === 4 && spots[0]?.shelves === 6 && spots.length === 8, `the table's cell: ${spots[0]?.x},${spots[0]?.z} with ${spots[0]?.shelves} shelves in reach`);
  // (vanilla's middle cell for a shelf two out and one aside is the one straight between: x 4, z 5 for all six here)
  ok(E.shelvesAround({ x: 4, y: 64, z: 4 }, shelf, (x, y, z) => free(x, y, z) && !(x === 4 && z === 5 && y === 64)) === 3, 'a shelf behind a blocked cell does not count (the lower three)');
  ok(E.SHELF_OFFSETS.length === 32, 'vanilla\'s 32 bookshelf places');
  // the dock: land west of x 0 (top at 63), water east of it 3 deep (surface 62), the village to the west
  const read = (x: number, y: number, z: number): string | null => {
    if (Math.abs(z) > 20 || x < -30 || x > 30) return null;
    if (x < 0) return y <= 63 ? (y === 63 ? 'grass_block' : 'dirt') : 'air';
    if (y > 62) return 'air';
    return y >= 60 ? 'water' : 'sand';
  };
  const waters = [];
  for (let x = 0; x <= 12; x++) for (let z = -6; z <= 6; z++) waters.push({ x, y: 62, z });
  const plan = E.planDock(read, waters, { x: -20, z: 0 }, 'birch');
  const deck = plan?.cells.filter((q) => q.block === 'birch_planks') ?? [];
  ok(!!plan && plan.root.x === -1 && plan.root.z === 0 && plan.dir.join() === '1,0' && plan.len === E.DOCK_LEN && deck.length === E.DOCK_LEN * 3 && deck.every((q) => q.y === 63),
    `the dock from the shore nearest the village: root ${plan?.root.x},${plan?.root.y},${plan?.root.z}, ${plan?.len} out, deck at y 63`);
  ok(plan!.cells.filter((q) => q.block === 'birch_fence' && q.y <= 62).length === 6 && plan!.cells.filter((q) => q.block === 'torch').every((q) => q.y === 65) && plan!.water === 6,
    'two posts down to the bed (3 deep), a fence and a torch on each far corner');
  const narrow = (x: number, y: number, z: number) => (x >= 0 && x <= 2 ? read(x, y, z) : x > 2 && y <= 63 ? 'stone' : read(x, y, z));
  ok(E.planDock(narrow, waters, { x: -20, z: 0 }, 'oak')?.dir.join() !== '1,0', 'a pond too short eastward is not docked eastward');
  ok(E.planDock(() => 'stone', waters, { x: 0, z: 0 }, 'oak') === null, 'no water: no dock');
}

// 4. The goods, the planner and the skills
{
  const { default: minecraftData } = await import('minecraft-data');
  const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
  const mats = new Materials(minecraftData('26.1'));
  const cases: Array<[string, Record<string, number>]> = [
    ['enchanting_table', { book: 1, diamond: 2, obsidian: 4 }], ['birch_boat', { birch_planks: 5 }], ['lantern', { iron_nugget: 8, torch: 1 }],
    ['lightning_rod', { copper_ingot: 3 }], ['book', { paper: 3, leather: 1 }],
  ];
  for (const [item, stock] of cases) {
    const p = mats.plan({ [item]: 1 }, stock);
    ok(!Object.keys(p.gather).length && !p.problems.length, `${item} planned from ${JSON.stringify(stock)}`);
  }
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  ok([...W.ENCHANT_GOODS, ...W.SEA_GOODS].every((g) => g.rung === 'enchantment' || g.rung === 'sea'), 'the goods are the rungs\' own');
  const src = readFileSync(new URL('../../server/src/mineflayer/mcBuild.ts', import.meta.url), 'utf-8');
  for (const sk of ['fill_bucket', 'make_obsidian', 'place_enchanting_table', 'use_xp_bottles', 'enchant_books', 'build_dock']) ok(new RegExp(`\\n  ${sk}: \\{ run: `).test(src), `the skill ${sk} is registered`);
  const W2 = await import('../../server/src/wanted');
  ok(!W2.RUNG_NEEDS.enchantment.length && !W2.RUNG_NEEDS.sea.length && /every skill exists/.test(L.rungPreview('enchantment')) && /every skill exists/.test(L.rungPreview('sea')), `the previews: ${L.rungPreview('enchantment')} / ${L.rungPreview('sea')}`);
}

// 5. The ballot: tier 4 once every implemented tier-3 rung is reached
{
  ok(!ballot(['iron', 'letters', 'copper', 'trade', 'husbandry', 'music', 'diamond', 'machines', 'bees']).some((r) => L.RUNG_DEFS[r].tier === 4), 'tier 4 waits while maps is open');
  ok(ballot(BEFORE).join() === 'enchantment,sea', `after tier 3: ${ballot(BEFORE).join(', ')}`);
  ok(ballot([...BEFORE, 'sea']).join() === 'enchantment' && ballot([...BEFORE, 'enchantment', 'sea']).join() === (L.rungImplemented('nether') ? 'nether' : ''), 'then the other, then the Nether (tier 5) where it is implemented');
}

// 6. The off and no-letters modes, in processes of their own
for (const m of ['off', 'noletters']) {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], m], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  ok(r.status === 0, `the ${m} run`);
}

console.log(fails ? `tier4_unit: ${fails} failed` : 'tier4_unit: all passed');
process.exit(fails ? 1 : 0);
