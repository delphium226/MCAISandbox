/**
 * house_program (#175): the house-program library (server/src/houseProgram.ts) offline. Fixed programs using every piece,
 * in every family: each runs, compiles, fits the box, 12 layers, HOUSE_UNITS and 32 smelts, passes validateDesign
 * (Minecraft's blocks and states, the door rule, the rain and solid-roof checks) with one door and no stair on another
 * stair's ridge; and the sandbox refuses what it must (the server's scope, code from strings, loops, promise loops, long
 * programs) while unknown names are stubbed.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/house_program.mts   (VERBOSE=1 prints each house's views)
 */
import minecraftData from 'minecraft-data';

process.env.MC_TIME_SCALE = '1';
const P = await import('../../server/src/houseProgram');
const { V2_LIMITS } = await import('../../server/src/buildingGen');
const { HOUSE_UNITS, MAX_SMELTS, validateDesign, elevations } = await import('../../server/src/designs');
const { FAMILY } = await import('../../server/src/houseStyle');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
type Design = import('../../server/src/village').Design;

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  if (!m) return false;
  const b = reg.blocksByName[m[1]];
  if (!b || !reg.itemsByName[m[1]]) return false;
  if (m[2] === undefined) return true;
  const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
  return m[2].split(',').every((p) => {
    const [k, v] = p.split('=').map((t) => t.trim());
    const st = states.find((x) => x.name === k);
    if (!st || v === undefined) return false;
    return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
  });
};
const cost = (d: Design) => {
  const b = designBill(d);
  let plan = materials.plan(b);
  plan = materials.plan({ ...b, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  return { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts };
};
const bill = { units: (d: Design) => cost(d).units, smelts: (d: Design) => cost(d).smelts };

let failed = 0;
const fail = (what: string) => {
  failed++;
  if (failed <= 40) console.log(`FAIL ${what}`);
};

/** What a house must pass (progbench.mts reads the same list). */
function problems(d: Design, budget = HOUSE_UNITS): string[] {
  const p: string[] = [];
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'check', { isPlaceable, states: true });
  p.push(...errors.map((e) => `validateDesign: ${e}`));
  if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox) p.push(`box ${d.width}x${d.depth}`);
  if (d.height > V2_LIMITS.maxLayers) p.push(`${d.height} layers`);
  const c = cost(d);
  if (c.units > budget) p.push(`${c.units} units over ${budget}`);
  if (c.smelts > MAX_SMELTS) p.push(`${c.smelts} smelts`);
  const doors = d.layers[1].flatMap((row) => [...row]).filter((ch) => /_door$/.test(d.palette[ch] ?? '')).length;
  if (doors !== 1) p.push(`${doors} doors`);
  return p;
}

const PROGRAMS: Record<string, string> = {
  plain: 'body(5, 5)',
  long_hall: 'body(9, 5); roof("gable"); windows("wide")',
  two_storey: 'body(7, 7, 2); walls("cobblestone", "planks"); chimney("right"); porch()',
  l_wing: 'body(7, 5); wing("front", 3, 3, "end"); porch()',
  t_cross: 'body(7, 5); wing("front", 3, 3); shutters()',
  u_courtyard: 'body(9, 5); wing("front", 3, 3, "start"); wing("front", 3, 3, "end")',
  side_wings: 'body(5, 7); wing("left", 3, 3); wing("right", 3, 2, "start")',
  back_wing: 'body(7, 5, 2); wing("back", 3, 3)',
  tower: 'body(7, 5); tower("back-left"); frame("timber")',
  tower_front: 'body(7, 7); tower("front-right", 2); roof("hip")',
  two_towers: 'body(9, 5); tower("back-left"); tower("back-right")',
  bays: 'body(7, 7); bay("front"); bay("left"); bay("right"); door(-1)',
  bay_porch: 'body(9, 5); bay("front"); porch(); chimney()',
  flat: 'body(7, 7, 2); roof("flat", "sandstone"); walls("sandstone"); tower("back-right"); wing("left", 3, 3)',
  stone: 'body(9, 9, 2); walls("stone_bricks"); roof("hip", "stone_bricks"); windows("rhythm", "glass"); tower("front-left", 2); wing("right", 5, 4)',
  chained: 'body(7, 5).roof("hip").wing({ side: "back", width: 3, depth: 2 }).porch().note("chained")',
  object_args: 'house({ width: 7, depth: 7, storeys: 2, walls: "logs", roof: "gable" }); bay({ side: "back" })',
  tower_two: 'body(7, 7, 2); tower("back-left")',
  tower_two_hip: 'body(7, 5, 2); roof("hip"); tower("front-right", 2); porch()',
  u_narrow: 'body(5, 5); wing("front", 3, 2, "start"); wing("front", 3, 2, "end")',
  everything: 'body(9, 9, 2); wing("front", 5, 5); wing("back", 5, 5); tower("front-left", 2); tower("back-right", 2); bay("left"); bay("right"); porch(); chimney(); shutters(); frame("timber")',
};

let houses = 0;
const cutsSeen: Record<string, number> = {};
for (const fam of Object.keys(FAMILY))
  for (const [name, code] of Object.entries(PROGRAMS)) {
    const out = P.houseFromProgram(code, fam, HOUSE_UNITS, bill, `home_${name}`);
    if (out.run.error) fail(`${fam} ${name}: ${out.run.error}`);
    if (!out.fit) {
      fail(`${fam} ${name}: does not fit (${out.notes.join('; ')})`);
      continue;
    }
    houses++;
    for (const c of out.fit.cuts) cutsSeen[c] = (cutsSeen[c] ?? 0) + 1;
    const p = problems(out.fit.design);
    if (p.length) fail(`${fam} ${name}: ${p.join('; ')}\n${elevations(out.fit.design)}`);
    if (process.env.VERBOSE === '1' && fam === 'plains') {
      console.log(`--- ${name}: ${out.fit.design.description} ${out.fit.design.width}x${out.fit.design.depth}x${out.fit.design.height}, ${cost(out.fit.design).units} units; cuts ${out.fit.cuts.join(', ') || 'none'}; notes ${out.notes.join('; ') || 'none'}`);
      console.log(elevations(out.fit.design));
    }
  }
console.log(`houses: ${houses} of ${Object.keys(FAMILY).length * Object.keys(PROGRAMS).length} fit and pass; cuts ${JSON.stringify(cutsSeen)}`);

// Unfitted: every piece's geometry passes validateDesign before any cut too (the box and bill aside)
for (const [name, code] of Object.entries(PROGRAMS)) {
  const notes: string[] = [];
  const spec = P.applyCalls(P.runProgram(code).calls, P.defaultSpec('plains'), notes);
  const { design } = P.compileHouse(spec, `home_${name}`);
  const p = problems(design, Infinity).filter((x) => /^validateDesign|doors/.test(x) && !/at most \d+ layers|width and depth must be/.test(x));
  if (p.length) fail(`unfitted ${name}: ${p.join('; ')}\n${elevations(design)}`);
}

// The sandbox
const refuse: Record<string, string> = {
  process: 'body(5,5); process.exit(1)',
  constructor: 'this.constructor.constructor("return process")()',
  fnconstructor: 'body.constructor("return 1")()',
  eval: 'eval("body(5,5)")',
  loop: 'while (true) {}',
  promise: 'const f = () => Promise.resolve().then(f); f()',
  long: `body(5,5);${' '.repeat(5000)}`,
  syntax: 'body(5,5',
};
for (const [name, code] of Object.entries(refuse)) {
  const r = P.runProgram(code);
  if (!r.error) fail(`sandbox ${name}: no error (${JSON.stringify(r.calls)})`);
}
const req = P.runProgram('require("fs").readFileSync("x")');
if (!req.error || !req.unknown.includes('require')) fail(`sandbox require: ${JSON.stringify(req)}`);
const stub = P.runProgram('body(7,5); balcony("front"); garden(); roof("hip")');
if (stub.error || stub.unknown.join() !== 'balcony,garden' || stub.calls.length !== 4) fail(`sandbox stub: ${JSON.stringify(stub)}`);
const t0 = Date.now();
P.runProgram('for (;;) {}');
if (Date.now() - t0 > 1000) fail(`sandbox loop took ${Date.now() - t0} ms`);
if (typeof (globalThis as Record<string, unknown>).body !== 'undefined') fail('sandbox leaked body into the server');
console.log(`sandbox: ${Object.keys(refuse).length} refused, unknown names stubbed`);

// The same through the world's path (a worker thread with its own capped heap), and what only the worker stops: a
// program that allocates past its heap within the vm's time cap
const iso = { ...refuse, heap: 'const a = []; for (;;) a.push(new Array(1e6).fill(1.5))' };
const w0 = Date.now();
const isoRuns = await Promise.all(Object.entries(iso).map(async ([name, code]) => [name, await P.runProgramIsolated(code)] as const));
for (const [name, r] of isoRuns) if (!r.error) fail(`worker ${name}: no error (${JSON.stringify(r.calls)})`);
const heapRun = isoRuns.find(([n]) => n === 'heap')![1];
if (!/memory|worker/.test(heapRun.error ?? '')) fail(`worker heap: ${heapRun.error}`);
const wreq = await P.runProgramIsolated('require("fs").readFileSync("x")');
if (!wreq.error || !wreq.unknown.includes('require')) fail(`worker require: ${JSON.stringify(wreq)}`);
const wstub = await P.runProgramIsolated('body(7,5); balcony("front"); garden(); roof("hip")');
if (wstub.error || wstub.unknown.join() !== 'balcony,garden' || wstub.calls.length !== 4) fail(`worker stub: ${JSON.stringify(wstub)}`);
const wfit = await P.houseFromProgramIsolated(PROGRAMS.everything, 'plains', HOUSE_UNITS, bill, 'home_iso');
if (!wfit.fit || JSON.stringify(wfit.fit.design) !== JSON.stringify(P.houseFromProgram(PROGRAMS.everything, 'plains', HOUSE_UNITS, bill, 'home_iso').fit?.design)) fail('worker: a house differs from the in-thread run');
const wlate = await P.runProgramIsolated('body(5,5)', { ...P.WORKER_LIMITS, timeoutMs: 1 });
if (!/did not finish/.test(wlate.error ?? '')) fail(`worker timeout: ${JSON.stringify(wlate)}`);
console.log(`worker: ${Object.keys(iso).length} refused (heap: ${heapRun.error}), stubs and houses as in-thread, ${Date.now() - w0} ms`);

// The world's path (#175 wiring): castProgram with a reply injected, the house named and owned as the world keys it
// (lesson 57), chosenHomes giving it as it is, the note code's and under 140 characters, failures as `why`
const HD = await import('../../server/src/homeDesign');
const HS = await import('../../server/src/houseStyle');
const reply = (text: string) => (async () => ({ reply: { calls: [], text }, ms: 5, waitMs: 0 })) as unknown as typeof import('../../server/src/modelCall').callModel;
const ctx = { persona: '', character: 'You are calm.', self: '', family: 'taiga', street: [], village: '' };
const spec = { provider: 'ollama' as const, model: 'qwen3.8:27b' };
const good = await HD.castProgram({ agent: 'Ada', spec, ctx, budget: HOUSE_UNITS, bill, call: reply('```js\nbody(7, 5, 2); tower("back-left"); balcony(); note("A tall spire for my prayers.")\n```') });
if (!good.design) fail(`world: no design (${good.why} ${good.error})`);
else {
  if (HS.homeOwner(good.design) !== 'Ada' || !HS.isHomeName(good.design.name) || good.design.style?.chosen !== 'program' || good.design.style?.family !== 'taiga') fail(`world: not keyed (${good.design.name}, ${JSON.stringify(good.design.style)})`);
  if (good.note.length > 138 || !/^I chose my house: /.test(good.note) || /spire/.test(good.note) || !/no balcony/.test(good.note)) fail(`world: note "${good.note}"`);
  const p = problems(good.design);
  if (p.length) fail(`world: ${p.join('; ')}`);
  const homes = HS.chosenHomes(['Ada', 'Ben'], 'taiga', new Map(), bill, undefined, new Map([['Ada', good.design]]));
  if (homes.length !== 2 || homes[0].name !== good.design.name || HS.homeOwner(homes[1]) !== 'Ben') fail(`world: chosenHomes ${homes.map((h) => h.name).join(',')}`);
  console.log(`world: ${good.design.description}; note "${good.note}"`);
}
const none = await HD.castProgram({ agent: 'Ben', spec, ctx, budget: HOUSE_UNITS, bill, call: reply('I would like a nice house.') });
const loop = await HD.castProgram({ agent: 'Ben', spec, ctx, budget: HOUSE_UNITS, bill, call: reply('```js\nwhile (true) {}\n```') });
// (an apostrophe inside a single-quoted note: the character bench's 2 failures of 48, repaired by requoteNotes)
const quote = await HD.castProgram({ agent: 'Nora', spec, ctx, budget: HOUSE_UNITS, bill, call: reply("```js\nbody(5, 5, 1);\nroof('hip', 'planks');\nnote('A plain house keeps the street's tradition.');\n```") });
if (!quote.design || quote.said !== "A plain house keeps the street's tradition.") fail(`world: quote repair ${quote.why} ${quote.error} "${quote.said}"`);
if (none.design || none.why !== 'model' || loop.design || loop.why !== 'error') fail(`world: failures ${none.why} ${loop.why}`);
// (the prompt, F340: character first, no stake, the village's forms counted as ones to avoid)
const forms = HD.villageForms(["Clara's house: a 7x7 one-storey planks house with a porch (cut to fit: no tower)", "Iris's house: a 7x7 one-storey planks house with a porch", 'Ben: a 5x5 one-storey house with a gable roof']);
if (forms[0] !== '7x7 one-storey planks house with a porch (2 houses)' || forms[1] !== '5x5 one-storey house with a gable roof') fail(`forms ${JSON.stringify(forms)}`);
const pp = HD.buildProgramPrompt({ ...ctx, forms, street: ['Iris: 7x7'] }, HOUSE_UNITS).user;
if (!pp.startsWith('You are calm.') || /delays|moving in/.test(pp) || !pp.includes('- 7x7 one-storey planks house with a porch (2 houses)') || pp.includes('Iris: 7x7') || !/your own/.test(pp)) fail(`prompt: ${pp}`);
for (const fam of Object.keys(FAMILY))
  for (const code of Object.values(PROGRAMS)) {
    const out = P.houseFromProgram(code, fam, HOUSE_UNITS, bill);
    const note = out.fit ? P.programNote(out.fit.spec, out.fit.cuts, out.run.unknown) : '';
    if (out.fit && note.length > 138) fail(`note ${note.length}: ${note}`);
  }

console.log(failed ? `house_program: ${failed} failures` : 'house_program: ok');
process.exit(failed ? 1 : 0);
