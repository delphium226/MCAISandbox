/**
 * Requested works at full size and in any material (MC_TALK_BIG, docs/specs/requested-builds.md). Offline, through the
 * real path: canned architect programs cast by castPublic (the worker sandbox, readSculpture with the block resolver,
 * compile and fit at 30x30x30 with the budget for 50 members), each drawn work made an asked record (monument.ts newAsked)
 * whose plan (askedCathedral: stages of layers, civicDraw's jobs) covers every cell once, and whose bill the asked record's
 * planner (mcKiln yardMaterials: dyes as such, terracotta from clay, concrete from powder) resolves to raw items the yard
 * has a route to. Cases: a 30-base blue-glass stepped pyramid, a red-wool castle tower, a mixed-material arch (quartz,
 * netherrack and water substituted, a dye the village cannot make swapped), a 40-wide draw clipped to 30, a solid cube
 * over the budget hollowed, an asked record's stand-in when the wool will not come, the kiln's and the builder's steps
 * for terracotta and concrete, and the Mayor's prompt (a 30-block pyramid is designed; a city is refused).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_big.mts   (VERBOSE=1 prints each work's layers' counts)
 */
import minecraftData from 'minecraft-data';

process.env.MC_TIME_SCALE = '1';
const T = await import('../../server/src/talkDesign');
const S = await import('../../server/src/sculpture');
const P = await import('../../server/src/playerTalk');
const A = await import('../../server/src/askedWork');
const M = await import('../../server/src/monument');
const { yardMaterials } = await import('../../server/src/mineflayer/mcKiln');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
type Design = import('../../server/src/village').Design;

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};

const reg = minecraftData('26.1');
const world = { materials: new Materials(reg), registry: reg };
const planner = yardMaterials(world, { asked: true } as never)!;
ok(A.TALK_BIG.on, 'MC_TALK_BIG on by default');
// (the village's dyes: every colour but brown and black, as a village with no cocoa and no ink sacs)
const colours = new Set(A.DYE_COLOURS.filter((c) => c !== 'brown' && c !== 'black'));
const resolve = A.makeResolver({ known: (n) => !!reg.blocksByName[n] && !!reg.itemsByName[n], plan: (b) => planner.plan(b), colours, colourBlocks: S.COLOUR_BLOCKS, alias: S.COLOUR_ALIAS, wood: 'birch' });
const bill = { units: (d: Design) => Object.values(planner.plan(designBill(d)).gather).reduce((t, q) => t + q, 0), smelts: (d: Design) => planner.plan(designBill(d)).fuel.smelts };
const reply = (text: string) => (async () => ({ reply: { calls: [], text }, ms: 5, waitMs: 0 })) as unknown as typeof import('../../server/src/modelCall').callModel;
const spec = { provider: 'ollama', model: 'gpt-oss:120b-cloud' } as const;
const cast = (what: string, code: string, name: string, budget = A.bigBudget(50)) =>
  T.castPublic({ agent: 'Mayor', spec, ctx: { text: `please build ${what}`, what, family: 'plains', wood: 'oak' }, budget, bill, name, big: { resolve }, call: reply(`\`\`\`js\n${code}\n\`\`\``) });
const palOf = (d: Design | null) => [...new Set(Object.values(d?.palette ?? {}))].sort();
const planOf = M.monumentPlan;
const plan = (b: Record<string, number>, have: Record<string, number> = {}) => planner.plan(b, have);

/** A drawn work as an asked record: its plan covers every cell once, its stages and jobs are within bounds, and its bill
 *  resolves to raw items the yard has a route to. */
function record(d: Design, what: string) {
  const rec = M.newAsked({ design: d, what, noun: A.askedNoun(what) }, 'oak', 0);
  const c = planOf(rec);
  ok(c.cellJob.size === d.blocks && c.design.blocks === d.blocks, `${what}: the plan covers every cell once (${c.cellJob.size} of ${d.blocks})`);
  ok(c.jobs.every((j) => j.blocks <= 450) && c.jobs.length >= Math.ceil(d.blocks / 450), `${what}: ${c.jobs.length} jobs of at most 450 blocks (${Math.max(...c.jobs.map((j) => j.blocks))} the largest)`);
  const perStage = c.stages;
  ok(c.stageNames.length === perStage.length && perStage.every((n) => n <= A.TALK_BIG.stageBlocks + 900), `${what}: ${perStage.length} stages (${perStage.join(', ')} blocks)`);
  const g = plan(c.bill);
  const stray = Object.keys(g.gather).filter((n) => !A.askedRoute(n));
  ok(!stray.length && !g.problems.length, `${what}: every raw item has a route (${JSON.stringify(g.gather)}${stray.length ? `; no route: ${stray.join(', ')}` : ''}${g.problems.join('; ')})`);
  ok(!c.stageNames.some((n) => !n) && M.monumentNoun(rec) === A.askedNoun(what), `${what}: named (${M.cathedralName(rec)}, noun ${M.monumentNoun(rec)}, stages ${c.stageNames.slice(0, 2).join(' / ')}...)`);
  const st1 = Object.values(M.stageBill(rec)).reduce((t, q) => t + q, 0), all = Object.values(c.bill).reduce((t, q) => t + q, 0);
  ok(perStage.length === 1 || st1 < all, `${what}: the first stage wants a part of the bill (${st1} of ${all})`);
  if (process.env.VERBOSE) console.log(`${what}: ${d.width}x${d.depth}x${d.height}, ${d.blocks} blocks, ${c.jobs.length} jobs, stages ${perStage.join('/')}; gather ${JSON.stringify(g.gather)}; smelts ${g.fuel.smelts}`);
  return { rec, c, g };
}

// ---- the prompts
const mayor = P.talkSystem('mayor', true);
ok(/30x30/.test(mayor) && /pyramid/.test(mayor) && /design, not refuse/.test(mayor) && /design it, do not refuse it/.test(mayor), 'the Mayor: works up to 30x30x30 are designed');
ok(/larger than about 30x30x30/.test(mayor) && /skyscraper/.test(mayor) && /live creatures/.test(mayor), 'the Mayor: larger than 30x30x30, creatures and items still refused');
const arch = T.buildPublicPrompt({ text: 'a 30-block pyramid of blue glass', what: 'a 30-block blue glass pyramid', family: 'plains' }, A.bigBudget(50), true);
ok(/0\.\.29 in x and z/.test(arch.system) && /blue_stained_glass/.test(arch.system) && /box\(x1, y1, z1, x2, y2, z2, block\)/.test(arch.system), 'the architect: 30x30, block ids, box()');
ok(/Budget: 7500 units/.test(arch.user) && /in the material and at the size/.test(arch.user), `the architect: the budget for 50 members (${A.bigBudget(50)})`);
ok(A.bigBudget(5) === 3000 && A.bigBudget(100) === 9000, 'the budget: 3,000 to 9,000');

// ---- the resolver
ok(resolve('blue_stained_glass')?.block === 'blue_stained_glass' && !resolve('blue_stained_glass')?.note, 'blue stained glass as it is');
ok(resolve('red_wool')?.block === 'red_wool' && resolve('white_concrete')?.block === 'white_concrete' && resolve('orange_terracotta')?.block === 'orange_terracotta', 'wool, concrete and terracotta as they are');
ok(resolve('cut_copper')?.block === 'cut_copper' && resolve('iron_block')?.block === 'iron_block' && resolve('deepslate_bricks')?.block === 'deepslate_bricks', 'copper, iron and deepslate as they are');
const qz = resolve('quartz_block');
ok(qz?.block === 'white_concrete' && /quartz block built in white concrete/.test(qz.note ?? ''), `quartz: white concrete, with a note (${qz?.note})`);
const bl = resolve('black_wool');
ok(bl?.block === 'cobblestone' && /no black dye/.test(bl.note ?? ''), `black wool with no black dye: its easy look (${bl?.block}: ${bl?.note})`);
ok(resolve('prismarine')?.block === 'cyan_terracotta' && resolve('obsidian')?.block === 'cobblestone' && resolve('glowstone')?.block === 'yellow_stained_glass', `prismarine, obsidian, glowstone: the nearest (${resolve('prismarine')?.block}, ${resolve('obsidian')?.block}, ${resolve('glowstone')?.block})`);
ok(resolve('water')?.block === 'light_blue_stained_glass' && resolve('bedrock')?.block === 'cobblestone', 'water and bedrock: the nearest');
ok(resolve('birch_planks')?.block === 'birch_planks' && resolve('oak_log')?.block === 'oak_log', 'the village\'s wood and oak (swapped for it on the record) as they are');
ok(resolve('red') === undefined && resolve('blue') === undefined, 'colour words are no block ids (the sculpture colours)');

// ---- a 30-base blue-glass stepped pyramid (the user's example)
const PYRAMID = `plinth("none");
for (let i = 0; i < 15; i++) box(i, i, i, 29 - i, i, 29 - i, "blue_stained_glass");
note("A stepped pyramid of blue glass, 30 blocks at its base");`;
const pyr = await cast('a 30-block blue glass pyramid', PYRAMID, T.askedName('a 30-block blue glass pyramid', 'r21'));
ok(!!pyr.design && pyr.figure && !pyr.why, `the pyramid drawn (${pyr.why ?? ''} ${pyr.error ?? ''})`);
const pd = pyr.design!;
ok(pd && pd.width === 30 && pd.depth === 30 && pd.height === 15 && pd.blocks === 4960, `the pyramid: 30x30, 15 high, 4960 blocks (${pd?.width}x${pd?.depth}, ${pd?.height}, ${pd?.blocks})`);
ok(JSON.stringify(palOf(pd)) === '["blue_stained_glass"]' && !pyr.cuts.length, `in blue stained glass, solid, nothing cut (${palOf(pd)}; ${pyr.cuts})`);
ok(/^a 30x30 blue glass pyramid, 15 high, in blue stained glass$/.test(pyr.form ?? ''), `in words: ${pyr.form}`);
if (pd) {
  const { rec, g } = record(pd, 'a 30-block blue glass pyramid');
  ok(g.gather.sand >= 4960 && g.gather.blue_dye === Math.ceil(4960 / 8) && g.fuel.smelts >= 4960, `the pyramid's bill: sand, blue dye, smelts (${g.gather.sand} sand, ${g.gather.blue_dye} blue dye, ${g.fuel.smelts} smelts)`);
  // (stage 1: the kiln smelts its sand; built from the yard's glass and dye)
  const kw = M.kilnWants({ ...rec, yard: { sand: 2000 } } as never, (b, h) => plan(b, h));
  ok((kw.sand ?? 0) > 0, `the kiln smelts the pyramid's sand (${JSON.stringify(kw)})`);
  const j0 = M.monumentPlan(rec).jobs[0];
  const ready = M.jobReady({ ...rec, yard: { glass: j0.blocks, blue_dye: Math.ceil(j0.blocks / 8) } } as never, 0, (b, h) => plan(b, h));
  ok(ready && !M.jobReady(rec, 0, (b, h) => plan(b, h)), `job 0 ready once the yard holds its glass and dye (${j0.blocks} blocks)`);
  const eta = A.askedEta(pd.blocks, 50, A.slowShare(pd, (b) => plan(b)));
  ok(eta >= 60 && eta <= 300, `the pyramid's ETA with 50 members: ${eta} min`);
}

// ---- a red-wool castle tower
const TOWER = `plinth("stone_bricks");
box(0, 0, 0, 10, 26, 10, "red_wool"); box(1, 0, 1, 9, 26, 9, "air");
for (let x = 0; x <= 10; x += 2) { block(x, 27, 0, "red_wool"); block(x, 27, 10, "red_wool"); block(0, 27, x, "red_wool"); block(10, 27, x, "red_wool"); }
box(4, 0, 10, 6, 3, 10, "air"); box(1, 13, 1, 9, 13, 9, "spruce_planks");
note("A red wool castle tower with battlements");`;
const tow = await cast('a red wool castle tower', TOWER, T.askedName('a red wool castle tower', 'r22'));
ok(!!tow.design && !tow.why, `the tower drawn (${tow.why ?? ''} ${tow.error ?? ''})`);
const td = tow.design!;
ok(td && td.height === 29 && td.width === 11 && palOf(td).includes('red_wool') && palOf(td).includes('stone_bricks') && palOf(td).includes('oak_planks'), `the tower: 11x11, 29 high, red wool on stone bricks, its floor in the village's wood (${td?.width}x${td?.depth}x${td?.height}; ${palOf(td)})`);
ok(tow.notes.some((n) => /spruce planks built in the village's birch wood/.test(n)), `the spruce floor swapped for the village's wood, said (${tow.notes.join('; ')})`);
if (td) {
  const { rec, g } = record(td, 'a red wool castle tower');
  ok(g.gather.white_wool > 900 && g.gather.red_dye > 900, `the tower's bill: white wool and red dye (${g.gather.white_wool}, ${g.gather.red_dye})`);
  // (the wool will not come: the red wool stands in as polished granite from the first job the yard does not cover)
  const subs = M.askedStandIn(rec, 'white_wool', (b, h) => plan(b, h), (b) => A.easyOf(b, S.COLOUR_BLOCKS, S.COLOUR_ALIAS));
  ok(subs.length === 1 && subs[0].block === 'red_wool' && subs[0].as === 'polished_granite' && subs[0].from === 0, `the wool's stand-in (${JSON.stringify(subs)})`);
  const after = plan(M.monumentPlan(rec).bill);
  ok(!after.gather.white_wool && !after.gather.red_dye, `after it no wool or red dye is wanted (${JSON.stringify(after.gather)})`);
}

// ---- a mixed-material arch: quartz pillars, terracotta, concrete, a copper top, black and nether blocks swapped
const ARCH = `plinth("none");
box(0, 0, 0, 3, 15, 3, "quartz_block"); box(16, 0, 0, 19, 15, 3, "quartz_block");
box(0, 16, 0, 19, 18, 3, "orange_terracotta"); box(4, 15, 0, 15, 15, 3, "terracotta");
box(0, 19, 0, 19, 19, 3, "cut_copper"); box(8, 20, 1, 11, 21, 2, "white_concrete");
block(9, 22, 1, "black_wool"); block(10, 22, 1, "netherrack"); block(9, 22, 2, "water"); block(10, 22, 2, "blue");
note("A triumphal arch of mixed stone and copper");`;
const arc = await cast('a terracotta arch', ARCH, T.askedName('a terracotta arch', 'r23'));
ok(!!arc.design && !arc.why, `the arch drawn (${arc.why ?? ''} ${arc.error ?? ''})`);
const ap = palOf(arc.design);
ok(['white_concrete', 'orange_terracotta', 'terracotta', 'cut_copper', 'cobblestone', 'red_terracotta', 'light_blue_stained_glass', 'blue_concrete'].every((b) => ap.includes(b)) && !ap.includes('quartz_block'), `the arch's blocks (${ap})`);
ok(arc.notes.filter((n) => / built in /.test(n)).length === 4, `four swaps said once each (${arc.notes.join('; ')})`);
if (arc.design) {
  const { rec } = record(arc.design, 'a terracotta arch');
  // (terracotta: clay smelted in the kiln; concrete: powder crafted and set at the build)
  const c = M.monumentPlan(rec), tStage = c.jobs.find((j) => j.bill.terracotta || j.bill.orange_terracotta)?.stage ?? 1;
  const done = c.jobs.map((j, i) => (j.stage < tStage ? i : -1)).filter((i) => i >= 0);
  const kw = M.kilnWants({ ...rec, done, state: 'building', yard: { clay: 200 } } as never, (b, h) => plan(b, h));
  ok((kw.clay ?? 0) > 0, `the kiln smelts the arch's clay (${JSON.stringify(kw)})`);
  const cp = plan({ white_concrete: 8 }, { sand: 4, gravel: 4, white_dye: 1 });
  ok(cp.steps.some((s) => s.wet && s.item === 'white_concrete' && s.input === 'white_concrete_powder') && cp.steps.some((s) => s.item === 'white_concrete_powder') && !Object.keys(cp.gather).length && !cp.fuel.smelts, `concrete: powder crafted, set wet (${JSON.stringify(cp.steps)})`);
  const tp = plan({ red_terracotta: 8 });
  ok(tp.gather.clay === 8 && tp.gather.red_dye === 1 && tp.fuel.smelts === 8, `red terracotta from clay and dye (${JSON.stringify(tp.gather)}, ${tp.fuel.smelts} smelts)`);
}
// (the world's own planner is unchanged: concrete is not made there, terracotta is gathered as it lies)
ok(!world.materials.plan({ white_concrete: 1 }).steps.length && world.materials.plan({ terracotta: 1 }).gather.terracotta === 1, 'the other plans are as before');

// ---- drawn the full 30 high: no plinth rather than the top cut
const tall = await cast('a stone obelisk', `box(0, 0, 0, 4, 29, 4, "stone_bricks"); note("An obelisk");`, T.askedName('a stone obelisk', 'r29'));
ok(!!tall.design && tall.design.height === 30 && tall.design.blocks === 750 && tall.notes.some((n) => /no plinth/.test(n)), `a 30-high draw keeps its top, no plinth (${tall.design?.height}; ${tall.notes.join('; ')})`);

// ---- drawn wider than 30: clipped with a note
const wide = await cast('a great wall', `box(0, 0, 0, 39, 2, 1, "stone_bricks"); note("A wall");`, T.askedName('a great wall', 'r24'));
ok(!!wide.design && wide.design.width === 30 && wide.notes.some((n) => /left out/.test(n)), `a 40-wide draw clipped to 30 (${wide.design?.width}; ${wide.notes.join('; ')})`);

// ---- over the budget: a solid cube hollowed and said; far over: refused in words
const cube = await cast('a white cube', `box(0, 0, 0, 15, 15, 15, "white_concrete"); note("A cube");`, T.askedName('a white cube', 'r25'), 3000);
ok(!!cube.design && cube.cuts.includes('hollow inside') && cube.design.blocks < 4096, `a solid 16-cube over 3,000 units hollowed (${cube.cuts}; ${cube.design?.blocks} blocks)`);
const solid = await cast('a white cube', `box(0, 0, 0, 9, 9, 9, "white_concrete"); note("A cube");`, T.askedName('a white cube', 'r26'), 3000);
ok(!!solid.design && !solid.cuts.length && solid.design.blocks === 1100, `under the budget a solid work stays solid (${solid.design?.blocks} blocks with its plinth)`);
const huge = await cast('a white block', `box(0, 0, 0, 29, 28, 29, "white_concrete"); note("A block");`, T.askedName('a white block', 'r27'), 3000);
ok(!huge.design && huge.why === 'fit' && /units of materials/.test(huge.error ?? ''), `far over even hollow: refused in words (${huge.error})`);

// ---- the small path is as it was (talk_statue covers it): no big option, 11x11x12 and easy colours
const small = await T.castPublic({ agent: 'Mayor', spec, ctx: { text: 'x', what: 'a statue', family: 'plains' }, budget: 400, bill: {}, name: 'asked_statue_r28', call: reply('```js\nbox(0,0,0,20,20,0,"red_wool");\n```') });
ok(!!small.design && small.design.width === 11 && palOf(small.design).includes('polished_granite'), `without MC_TALK_BIG's option: 11 wide, easy colours (${small.design?.width}; ${palOf(small.design)})`);

// ---- names
ok(A.askedWords('asked:asked_blue_glass_pyramid_r21') === 'blue glass pyramid' && M.presetWords('asked:asked_blue_glass_pyramid_r21') === 'the blue glass pyramid', 'an asked preset in words');
ok(A.askedNoun('a 30-block blue glass pyramid') === 'pyramid' && A.askedNoun('a statue of a chicken') === 'statue' && A.askedNoun('a red wool castle tower') === 'tower', 'an asked work\'s noun');

console.log(`talk_big: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
