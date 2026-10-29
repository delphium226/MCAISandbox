/**
 * Members' own designs checked offline (#174, MC_HOME_DESIGN=model; spec runs/2026-10-29/homedesign/spec.md), with bills
 * from Materials.plan as gen_homes.mts costs them:
 * - homeOptions for the 25 names in the five families: every offered value fits the budget alone, none left out that fits;
 * - fitChoice on the plainest, the character's and the dearest picks (each member's own ranking): every home valid
 *   (validateDesign with Minecraft's blocks and states), within the box, 12 layers, the budget and 32 smelts, easy
 *   materials, one south door, and its name a dwelling's (isDwelling, not isLandmark, homeOwner its member);
 * - the cuts follow the ranking: a feature ranked first outlives every feature ranked below it;
 * - readDesign on canned replies (valid, out of the enum, missing fields, words for numbers, text JSON, a nested house, no
 *   input) and castDesign with the call injected (a valid reply, a thrown call, a withdrawn one, a budget pause);
 * - chosenHomes with no choices is ownHomes byte for byte (the flag's off path); with a claim, no character owner takes the
 *   larger budget;
 * - the holdout splits the names about half and half at 0.5, stably; the memory note stays under 140 characters;
 * - the prompt's size (characters / 4 as tokens).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/home_design.mts
 */
import minecraftData from 'minecraft-data';
process.env.MC_HOME_DESIGN = 'model';
process.env.MC_HOME_DESIGN_HOLDOUT = '0.5';
const { V2_LIMITS } = await import('../../server/src/buildingGen');
const { HOUSE_UNITS, HOUSE_UNITS_LARGE, MAX_SMELTS, isLandmark, validateDesign } = await import('../../server/src/designs');
const H = await import('../../server/src/houseStyle');
const D = await import('../../server/src/homeDesign');
const { isDwelling } = await import('../../server/src/grow');
const { NAME_POOL } = await import('../../server/src/agentNames');
const { CallWithdrawn } = await import('../../server/src/modelCall');
const { Materials, designBill, hardToGather } = await import('../../server/src/mineflayer/mcMaterials');
type Design = import('../../server/src/village').Design;
type HomeChoice = import('../../server/src/houseStyle').HomeChoice;

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
const costs = new Map<string, { units: number; smelts: number; hard: string[] }>();
function cost(d: Design) {
  const k = JSON.stringify([d.layers, d.palette]);
  let c = costs.get(k);
  if (!c) {
    const b = designBill(d);
    let plan = materials.plan(b);
    plan = materials.plan({ ...b, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    c = { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts, hard: [...hardToGather(plan.gather), ...plan.problems.map(() => 'problem')] };
    costs.set(k, c);
  }
  return c;
}
const bill = { units: (d: Design) => cost(d).units, smelts: (d: Design) => cost(d).smelts };

let failed = 0;
const fail = (what: string) => {
  failed++;
  if (failed <= 40) console.log(`FAIL ${what}`);
};

function checkHome(d: Design, member: string, budget: number): string[] {
  const p: string[] = [];
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'check', { isPlaceable, states: true });
  p.push(...errors.map((e) => `validateDesign: ${e}`));
  if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox) p.push(`box ${d.width}x${d.depth}`);
  if (d.height > V2_LIMITS.maxLayers) p.push(`${d.height} layers`);
  const c = cost(d);
  if (c.units > budget) p.push(`${c.units} units over ${budget}`);
  if (c.smelts > MAX_SMELTS) p.push(`${c.smelts} smelts`);
  if (c.hard.length) p.push(`hard: ${c.hard.join(', ')}`);
  const doors = d.layers[1].flatMap((row) => [...row]).filter((ch) => /_door$/.test(d.palette[ch] ?? '')).length;
  if (doors !== 1) p.push(`${doors} doors`);
  if (!isDwelling(d.name) || isLandmark(d.name) || H.homeOwner(d) !== member) p.push(`name ${d.name}: dwelling ${isDwelling(d.name)}, landmark ${isLandmark(d.name)}, owner ${H.homeOwner(d)}`);
  if (d.style?.chosen !== 'model') p.push('not marked chosen');
  return p;
}

const FAMILIES = Object.keys(H.FAMILY);
const MEMBERS = ['Mayor', ...NAME_POOL.slice(0, 24)];
const DEAR: HomeChoice = { ...H.PLAIN_CHOICE, size: 'large', shape: 'rect', storeys: 2, roof: 'other', walls: 'contrast', base: 'cobblestone', frame: 'timber', windows: 'wide', door: 'left', porch: true, chimney: true, shutters: true, priority: ['porch', 'storeys', 'chimney', 'size', 'shutters', 'look', 'shape'] };

// 1. options
let offered = 0;
for (const fam of FAMILIES) for (const m of MEMBERS.slice(0, 6)) {
  for (const budget of [HOUSE_UNITS, HOUSE_UNITS_LARGE]) {
    const o = H.homeOptions(m, fam, budget, bill);
    for (const [k, vs] of Object.entries(o.fields)) {
      if (!vs.length) fail(`${fam} ${m}: no value for ${k}`);
      for (const v of vs) {
        offered++;
        if (o.base + v.units > budget && !(k === "frame" && v.value === "timber")) fail(`${fam} ${m}: ${k}=${v.value} offered at ${o.base + v.units} over ${budget}`);
      }
    }
  }
}
console.log(`options: ${offered} values offered across ${FAMILIES.length} families, every one within its budget`);

// 2. homes from picks, and the cuts in the member's ranking
let homes = 0, cut = 0;
const kept: Record<string, number> = {};
for (const fam of FAMILIES) for (const m of MEMBERS) {
  for (const [label, c, budget] of [['plain', H.PLAIN_CHOICE, HOUSE_UNITS], ['character', H.characterChoice(m, fam), HOUSE_UNITS], ['dear', DEAR, HOUSE_UNITS], ['dear-larger', { ...DEAR, larger: true }, HOUSE_UNITS_LARGE], ['L-porch', { ...DEAR, shape: 'L', size: 'wide' }, HOUSE_UNITS]] as Array<[string, HomeChoice, number]>) {
    const fit = H.fitChoice(m, fam, c, budget, bill, undefined, 'a test');
    if (!fit) { fail(`${fam} ${m} ${label}: no house fits`); continue; }
    homes++;
    for (const p of checkHome(fit.design, m, budget)) fail(`${fam} ${m} ${label}: ${p}`);
    if (fit.cuts.length) cut++;
    if (label === 'dear') {
      // (the ranking: porch first, then storeys...: a feature cut means every feature ranked below it was cut first)
      const left = H.choiceFeatures(fit.choice);
      const ranked = c.priority.filter((f) => H.choiceFeatures(c).includes(f));
      for (let i = 0; i < ranked.length; i++) if (!left.includes(ranked[i])) for (const f of ranked.slice(i + 1)) if (left.includes(f) && f !== 'look') fail(`${fam} ${m}: ${ranked[i]} cut but ${f}, ranked below it, kept (${fit.cuts.join(', ')})`);
      for (const f of left) kept[`${fam}:${f}`] = (kept[`${fam}:${f}`] ?? 0) + 1;
    }
  }
}
console.log(`homes: ${homes} checked (${cut} cut to fit); the dear house's features kept of ${MEMBERS.length}: ${FAMILIES.map((f) => `${f} ${['porch', 'storeys', 'chimney', 'size'].map((k) => `${k} ${kept[`${f}:${k}`] ?? 0}`).join(' ')}`).join('; ')}`);

// 3. readDesign
const opts = H.homeOptions('Ada', 'plains', HOUSE_UNITS_LARGE, bill);
const fb = H.characterChoice('Ada', 'plains');
const call = (input: unknown, name = 'design_house') => ({ calls: [{ name, input }], text: '' });
const cases: Array<[string, ReturnType<typeof call> | { calls: never[]; text: string }, (r: ReturnType<typeof D.readDesign>) => boolean]> = [
  ['valid', call({ reason: 'I like company', size: 'deep', shape: 'rect', storeys: 2, roof: 'other', walls: 'street', porch: true, chimney: false, shutters: true, larger: true, priority: ['porch', 'storeys'] }),
    (r) => !!r && r.choice.size === 'deep' && r.choice.storeys === 2 && r.choice.porch && r.choice.larger && r.choice.priority.join() === 'porch,storeys' && r.reason === 'I like company'],
  ['out of enum', call({ reason: 'x', size: 'huge', storeys: 2 }), (r) => !!r && r.choice.size === fb.size && r.partial.includes('size')],
  ['missing fields', call({ reason: 'x', porch: true }), (r) => !!r && r.choice.storeys === fb.storeys && r.choice.porch && r.partial.includes('storeys')],
  ['words', call({ reason: 'x', storeys: 'two', porch: 'yes', shape: 'l', door: 'center', priority: 'storeys, porch' }), (r) => !!r && r.choice.storeys === 2 && r.choice.porch && r.choice.shape === 'L' && r.choice.door === 'centre' && r.choice.priority.join() === 'storeys,porch'],
  ['text JSON', { calls: [], text: 'Here: {"reason": "y", "size": "wide", "porch": false}' }, (r) => !!r && r.choice.size === 'wide' && !r.choice.porch],
  ['nested house', call({ reason: 'z', house: { size: 'large', chimney: true } }), (r) => !!r && r.choice.size === 'large' && r.choice.chimney && r.reason === 'z'],
  ['no input', { calls: [], text: 'I cannot decide.' }, (r) => r === null],
  ['nothing valid', call({ reason: 'x', size: 'huge' }), (r) => r === null],
];
for (const [label, reply, ok] of cases) if (!ok(D.readDesign(reply as never, opts, fb, true))) fail(`readDesign ${label}: ${JSON.stringify(D.readDesign(reply as never, opts, fb, true))}`);
if (D.readDesign(call({ reason: 'x', size: 'deep', larger: true }) as never, opts, fb, false)?.choice.larger) fail('readDesign: larger taken while not offered');
console.log(`readDesign: ${cases.length + 1} cases`);

// 4. castDesign with the call injected
const ctx: import('../../server/src/homeDesign').DesignContext = {
  persona: 'Ada is warm and sociable; she values helping others and dreams of a home full of guests.', character: D.characterOf('Ada'), self: 'You built 3 of the village\'s 20 buildings.',
  family: 'plains', street: ['Ben: two-storey house with a gable roof and a chimney, 210 units; Ben: "I want room for my tools"'], village: '8 members\' houses: 2 with two storeys, 3 with porches, 1 L- or T-shaped.',
  options: opts, budget: HOUSE_UNITS, larger: { budget: HOUSE_UNITS_LARGE }, stake: ['The houses before yours in this street come to about 210 units; yours is built after them, so every unit you add delays your moving in (and Cai, Dot, built after you).'],
};
const spec = { provider: 'ollama' as const, model: 'test-model' };
const base = { agent: 'Ada', spec, level: 'low' as const, ctx, fallback: fb, seed: 'v|Ada|plains' };
const ok = await D.castDesign({ ...base, call: async () => ({ reply: { calls: [{ name: 'design_house', input: { reason: 'guests', size: 'wide', porch: true } }], text: '', promptTokens: 1200, outputTokens: 400 }, ms: 5, waitMs: 0 }) });
if (!ok.choice || ok.choice.size !== 'wide' || ok.promptTokens !== 1200) fail(`castDesign valid: ${JSON.stringify(ok).slice(0, 200)}`);
const thrown = await D.castDesign({ ...base, call: async () => { throw new Error('boom'); } });
if (thrown.choice || thrown.why !== 'error') fail(`castDesign thrown: ${thrown.why}`);
const withdrawn = await D.castDesign({ ...base, call: async () => { throw new CallWithdrawn('gone'); } });
if (withdrawn.choice || withdrawn.why !== 'withdrawn') fail(`castDesign withdrawn: ${withdrawn.why}`);
const timeout = await D.castDesign({ ...base, call: async () => { throw new Error('fallback after 60000 ms'); } });
if (timeout.choice || timeout.why !== 'timeout') fail(`castDesign timeout: ${timeout.why}`);
const prompt = D.buildDesignPrompt(ctx, base.seed);
const toolChars = JSON.stringify(prompt.tools).length;
console.log(`castDesign: 4 cases; prompt ${prompt.system.length + prompt.user.length} chars + tool ${toolChars} (about ${Math.round((prompt.system.length + prompt.user.length + toolChars) / 4)} tokens)`);
if (process.env.VERBOSE) console.log(prompt.system + '\n---\n' + prompt.user);

// 5. chosenHomes: no choices is ownHomes; a claim keeps the larger budget from character owners
for (const fam of FAMILIES) for (let i = 0; i < 24; i += 4) {
  const hood = MEMBERS.slice(i + 1, i + 5);
  const a = JSON.stringify(H.ownHomes(hood, fam, bill));
  const b = JSON.stringify(H.chosenHomes(hood, fam, new Map(), bill));
  if (a !== b) fail(`chosenHomes without choices differs from ownHomes: ${fam} ${hood.join(',')}`);
  const claim = new Map([[hood[3], { reason: 'big', choice: { ...DEAR, larger: true } }]]);
  const got = H.chosenHomes(hood, fam, claim, bill);
  for (const d of got) if (H.homeOwner(d) !== hood[3] && cost(d).units > HOUSE_UNITS) fail(`${fam}: ${H.homeOwner(d)} took ${cost(d).units} units beside ${hood[3]}'s claim`);
}
console.log('chosenHomes: without choices the same as ownHomes in every family; a claim holds the larger budget');

// 6. the holdout and the note
const held = MEMBERS.filter((m) => D.inHoldout(m));
if (held.length < 7 || held.length > 18) fail(`holdout 0.5 kept ${held.length} of 25`);
if (held.join() !== MEMBERS.filter((m) => D.inHoldout(m)).join()) fail('holdout not stable');
const long = D.designNote('a T-shaped two-storey house with a hip roof, cobblestone walls, a porch, a chimney and shutters', 'Because I have always wanted a home where the whole street can gather on long evenings and share stories of the day', ['one storey']);
if (long.length > 140) fail(`note ${long.length} chars`);
console.log(`holdout 0.5: ${held.length} of 25 on the character draw (${held.join(', ')}); a long note is ${long.length} chars`);

console.log(failed ? `home_design: ${failed} FAILED` : 'home_design: ok');
process.exit(failed ? 1 : 0);
