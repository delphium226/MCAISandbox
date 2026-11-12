/**
 * The talk build's statues (11-12, sculpture.ts): a person asks the Mayor for "a statue of a chicken" and the village
 * builds one. Offline: the Mayor's design prompt names statues and fountains as designable; the architect's prompt has
 * the sculpture functions; the architect's default is the cloud model; a canned chicken program runs in the worker sandbox
 * (castPublic, its real path), compiles to a figure on a plinth and fits LANDMARK_UNITS, 32 smelts and the box with the
 * survival economy's bill (Materials from the registry) and its hard-to-gather check; the design passes validateDesign
 * without a door, its colours are the easy blocks (wool read as its colour), a neighbourhood pad holds it (padFor) and it is
 * never a dwelling; a fountain and an arch too; an oversized solid figure is hollowed to fit; a figure in hard materials is
 * refused with what failed in words; and a bakery still goes the house library's way.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_statue.mts   (VERBOSE=1 prints each figure's layers)
 */
import minecraftData from 'minecraft-data';

process.env.MC_TIME_SCALE = '1';
const T = await import('../../server/src/talkDesign');
const S = await import('../../server/src/sculpture');
const P = await import('../../server/src/playerTalk');
const { isDwelling, padFor } = await import('../../server/src/grow');
const { LANDMARK_UNITS, MAX_SMELTS, validateDesign } = await import('../../server/src/designs');
const { V2_LIMITS } = await import('../../server/src/buildingGen');
const { Materials, designBill, hardToGather } = await import('../../server/src/mineflayer/mcMaterials');
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
const materials = new Materials(reg);
const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  return !!m && !!reg.blocksByName[m[1]] && !!reg.itemsByName[m[1]];
};
// (mcWorld's homeBill and materialTasks' problems, without the world)
const plan = (d: Design) => {
  const b = designBill(d);
  let p = materials.plan(b);
  p = materials.plan({ ...b, crafting_table: 1, ...(p.fuel.smelts ? { furnace: 1 } : {}) });
  return p;
};
const bill = { units: (d: Design) => Object.values(plan(d).gather).reduce((t, q) => t + q, 0) + 2, smelts: (d: Design) => plan(d).fuel.smelts };
const problems = (d: Design) => {
  const p = plan(d), hard = hardToGather(p.gather);
  return [...p.problems, ...(hard.length ? [`it needs ${hard.join(', ')}, which takes finding`] : [])];
};
const reply = (text: string) => (async () => ({ reply: { calls: [], text }, ms: 5, waitMs: 0 })) as unknown as typeof import('../../server/src/modelCall').callModel;
const spec = { provider: 'ollama', model: 'gpt-oss:120b-cloud' } as const;
const cast = (what: string, code: string, name: string, budget = LANDMARK_UNITS) =>
  T.castPublic({ agent: 'Mayor', spec, ctx: { text: `please build ${what} here`, what, family: 'plains', wood: 'oak' }, budget, bill, problems, name, call: reply(`\`\`\`js\n${code}\n\`\`\``) });

const view = (d: Design) => d.layers.map((l, i) => `layer ${i}\n${l.join('\n')}`).join('\n') + `\n${JSON.stringify(d.palette)}`;
function sound(d: Design | null, what: string) {
  if (!d) return ok(false, `${what}: no design`);
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'check', { isPlaceable, states: true, requireDoor: false });
  ok(!errors.length, `${what}: validateDesign (${errors.join('; ')})`);
  ok(d.width <= V2_LIMITS.maxBox && d.depth <= V2_LIMITS.maxBox && d.height <= V2_LIMITS.maxLayers, `${what}: in the box (${d.width}x${d.depth}, ${d.height} high)`);
  const u = bill.units(d), sm = bill.smelts(d);
  ok(u <= LANDMARK_UNITS && sm <= MAX_SMELTS, `${what}: within the bill (${u} units, ${sm} smelts)`);
  ok(!problems(d).length, `${what}: easy materials (${problems(d).join('; ')})`);
  ok(!!padFor([d]), `${what}: a neighbourhood pad holds it`);
  ok(!isDwelling(d.name), `${what}: never a dwelling (${d.name})`);
  ok(d.layers[0].every((r) => !r.includes('.')), `${what}: a plinth under its whole footprint`);
  if (process.env.VERBOSE) console.log(`${what}:\n${view(d)}`);
}

// ---- the prompts
const mayor = P.talkSystem('mayor', true);
ok(/statue/.test(mayor) && /fountain/.test(mayor) && /design it, do not refuse it/.test(mayor), 'the Mayor\'s design prompt: statues and fountains are designed');
ok(/live creatures/.test(mayor), 'the Mayor\'s design prompt: live creatures are still refused');
ok(/passes on to you/.test(mayor) && /passes on to you/.test(P.talkSystem('mayor', false)), 'a line a member passes on is a request to the Mayor');
const arch = T.buildPublicPrompt({ text: 'a statue of a chicken', what: 'a statue of a chicken', family: 'plains' }, LANDMARK_UNITS);
ok(/box\(x1, y1, z1, x2, y2, z2, colour\)/.test(arch.system) && /block\(x, y, z, colour\)/.test(arch.system) && /body\(width, depth, storeys\)/.test(arch.system), 'the architect\'s prompt: the house library and the sculpture functions');
ok(/unit a block/.test(arch.user), 'the architect\'s prompt: a figure\'s cost');
ok(T.TALK_ARCHITECT_DEFAULT === 'ollama:gpt-oss:120b-cloud' && T.TALK_DESIGNS.fallback?.model === 'gpt-oss:120b-cloud', 'the architect: the cloud model by default and as the fallback');
ok(process.env.MC_TALK_PROGRAM_MODEL || T.TALK_DESIGNS.model?.model === 'gpt-oss:120b-cloud', `the architect's model unset: gpt-oss cloud (${T.TALK_DESIGNS.model?.model})`);

// ---- the colours
const notes: string[] = [];
ok(S.colourBlock('white', notes) === 'diorite' && S.colourBlock('white_wool', notes) === 'diorite' && notes.some((n) => /white_wool built in diorite/.test(n)), 'white and white wool: diorite, with a note');
ok(S.colourBlock('red', []) === 'polished_granite' && S.colourBlock('orange_concrete', []) === 'granite' && S.colourBlock('yellow', []) === 'sandstone', 'red, orange, yellow: granite and sandstone');
ok(S.colourBlock('air', []) === null && S.colourBlock('grey', []) === 'cobblestone', 'air empties a cell; grey is gray');
for (const [c, b] of Object.entries(S.COLOUR_BLOCKS)) {
  const p = materials.plan({ [b]: 8 });
  ok(!p.problems.length && !hardToGather(p.gather).length, `colour ${c} (${b}) is easy to gather (${JSON.stringify(p.gather)} ${p.problems.join(';')})`);
}

// ---- a chicken (the user's request, F-train 11-12): white body, red comb and wattle, yellow beak, orange legs
const CHICKEN = `plinth("stone_bricks");
box(2,0,3,2,2,3,"orange"); box(4,0,3,4,2,3,"orange");
box(1,3,1,5,6,6,"white_wool");
box(2,7,4,4,9,6,"white");
block(2,8,6,"black"); block(4,8,6,"black");
box(3,8,7,3,8,8,"yellow");
block(3,7,7,"red");
box(3,10,4,3,10,6,"red");
box(0,4,2,0,6,5,"white"); box(6,4,2,6,6,5,"white");
box(2,5,0,4,7,0,"white");
note("A plump white chicken with a red comb, standing on a stone plinth");`;
const hen = await cast('a statue of a chicken', CHICKEN, T.askedName('a statue of a chicken', 'r9'));
ok(!!hen.design && hen.figure && !hen.why, `the chicken drawn (${hen.why ?? ''} ${hen.error ?? ''})`);
sound(hen.design, 'the chicken');
ok(/^a 7x9 statue of a chicken, 12 high, in diorite, .* on a cobblestone plinth$/.test(hen.form ?? ''), `the chicken in words: ${hen.form}`);
ok(hen.design?.description.startsWith('a statue of a chicken: ') && hen.design.name === 'asked_statue_of_chicken_r9', `its name and description (${hen.design?.name}: ${hen.design?.description})`);
const pal = Object.values(hen.design?.palette ?? {});
ok(['diorite', 'polished_granite', 'granite', 'sandstone', 'cobblestone'].every((b) => pal.includes(b)), `its blocks (${pal.join(', ')})`);
// (its stone-brick plinth is 63 furnace runs, over 32: code makes it cobblestone and says so)
ok(hen.cuts.includes('unsmelted stone') && !pal.includes('stone_bricks'), `the stone-brick plinth unsmelted (${hen.cuts.join(',')})`);
ok(hen.notes.some((n) => /white_wool built in diorite/.test(n)), 'the wool noted');
ok(hen.said.startsWith('A plump white chicken'), 'its note');

// ---- a fountain and an arch
const fountain = await cast('a fountain', `plinth("cobblestone");
box(0,0,0,6,1,6,"gray"); box(1,1,1,5,1,5,"air");
box(3,1,3,3,4,3,"wall"); box(2,5,2,4,5,4,"light_gray"); block(3,6,3,"glass");
note("A stone fountain basin with a column");`, 'asked_fountain_r10');
ok(!!fountain.design && fountain.figure, `the fountain drawn (${fountain.why ?? ''} ${fountain.error ?? ''})`);
sound(fountain.design, 'the fountain');
const arch2 = await cast('an arch', `box(0,0,1,1,6,2,"stone_bricks"); box(7,0,1,8,6,2,"stone_bricks"); box(0,7,1,8,8,2,"stone_bricks"); note("A town arch");`, 'asked_arch_r11');
ok(!!arch2.design, `the arch drawn (${arch2.why ?? ''} ${arch2.error ?? ''})`);
sound(arch2.design, 'the arch');

// ---- over the budget: a solid block of a statue hollowed; too much even hollow: refused, with what failed
const big = await cast('a statue of a cow', `box(0,0,0,7,8,7,"white"); note("A big cow");`, 'asked_statue_of_cow_r12');
ok(!!big.design && big.cuts.includes('hollow inside'), `a solid 8x9x8 figure hollowed to fit (${big.cuts.join(',')} ${big.why ?? ''} ${big.error ?? ''})`);
if (big.design) sound(big.design, 'the hollowed cow');
const tooBig = await cast('a statue of a whale', `box(0,0,0,10,10,10,"white"); note("A whale");`, 'asked_whale_r13', 120);
ok(!tooBig.design && tooBig.why === 'fit' && /units of materials/.test(tooBig.error ?? ''), `over the budget even hollow: fit, in words (${tooBig.error})`);
ok(/could not make it fit .*units of materials/.test(T.failWords(tooBig.why, tooBig.error)), `the person's line says what failed: ${T.failWords(tooBig.why, tooBig.error)}`);
const clipped = await cast('an obelisk', `box(0,0,0,1,20,1,"gray"); note("Tall");`, 'asked_obelisk_r14');
ok(!!clipped.design && clipped.design.height === V2_LIMITS.maxLayers && clipped.notes.some((n) => /left out/.test(n)), `a figure taller than the box clipped with a note (${clipped.design?.height}; ${clipped.notes.join('; ')})`);
// (hard materials: a figure the bill's check refuses is not drawn, and says why)
const hard = await T.castPublic({ agent: 'Mayor', spec, ctx: { text: 'x', what: 'a statue', family: 'plains' }, budget: LANDMARK_UNITS, bill, name: 'asked_statue_r15',
  problems: () => ['it needs white_wool, which takes finding'], call: reply('```js\nbox(0,0,0,2,2,2,"white");\n```') });
ok(!hard.design && hard.why === 'fit' && /cannot get its materials: it needs white_wool/.test(hard.error ?? ''), `hard materials refused in words (${hard.error})`);
const empty = await cast('a statue', `block(1,1,1,"air"); note("nothing");`, 'asked_statue_r16');
ok(!empty.design && /drew no blocks/.test(empty.error ?? ''), `a figure of no blocks: why in words (${empty.error})`);

// ---- a bakery still goes the house library's way
const bakery = await cast('a bakery', 'body(7, 5, 1);\nchimney("right");\nnote("the village bakery");', 'asked_bakery_r17');
ok(!!bakery.design && !bakery.figure && /building/.test(bakery.form ?? '') && !!bakery.built, `a bakery: a house-library building (${bakery.form})`);

console.log(`talk_statue: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
