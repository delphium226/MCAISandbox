/**
 * X.1's activity specs and catalogue (server/src/activities.ts, spec runs/2026-10-16/s34/spec_x1_v2.md section A) checked
 * offline, a few seconds, no server:
 * 1. buildCatalog at oak, birch and spruce: every spec validates again on its own, the size is in a band (printed), keep
 *    and food specs equal MAKE_GOODS and FOOD_GOODS (same order, the same objects), no good needs wool, leather, string,
 *    iron or clay, no chest or D11's cuts, only the pinned wood's items, the order is keep, food, then the catalogue by
 *    class and name; units are the recipe's output, batches whole units of at most 4, targets whole units;
 * 2. decorDemand raises a keep's and a catalogue good's target, adds an item no list has once, drops what cannot be made
 *    (a bed: wool; another wood kind; a chest), and never gives one item two specs;
 * 3. the validator rejects an unknown skill, an unknown argument, a wrong type, counts 0 and 65, coordinates, a MAKE_NEVER
 *    item in a catalogue good, a duplicate id, a batch below its unit, and never throws;
 * 4. gatherSpecs (with and without a wood) and furnishSpec validate;
 * 5. building all three woods' catalogues takes < 200 ms; two builds from fresh caches are equal.
 * Prints the birch catalogue (ids, targets, units, batches). Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/activities_unit.mts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const minecraftData = (await import('minecraft-data')).default;
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const { MAKE_GOODS, FOOD_GOODS } = await import('../../server/src/mineflayer/mcWorkshop');
const A = await import('../../server/src/activities');
type Spec = import('../../server/src/activities').ActivitySpec;

const reg = minecraftData('26.1');
let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${what}`); }
};
const opts = (wood: string, decorDemand: Record<string, number> = {}) => ({ wood, decorDemand, keep: MAKE_GOODS, food: FOOD_GOODS });
const WOODS = ['oak', 'birch', 'spruce'];
const OTHER_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];

// 5 first, from cold caches: the jar's smelting table once (built at server start), then the three woods on a new Materials
new Materials(reg).plan({ glass: 1 }, {});
const timed = new Materials(reg);
const t0 = performance.now();
const built: Record<string, ReturnType<typeof A.buildCatalog>> = {};
for (const w of WOODS) built[w] = A.buildCatalog(reg, timed, opts(w));
const ms = performance.now() - t0;
console.log(`built oak, birch and spruce in ${ms.toFixed(0)} ms`);
ok(ms < 200, `the three catalogues take ${ms.toFixed(0)} ms (< 200)`);
ok(A.buildCatalog(reg, timed, opts('birch')) === built.birch, 'a second call is the cached result');
const again = A.buildCatalog(reg, new Materials(reg), opts('birch'));
ok(JSON.stringify(again) === JSON.stringify(built.birch), 'two builds from fresh caches are equal');

// 1. Each wood's catalogue
const ORDER = ['tool', 'station', 'light', 'decor', 'block', 'material', 'food'];
const m = new Materials(reg);
for (const w of WOODS) {
  const { specs, dropped } = built[w];
  const bySource = (s: string) => specs.filter((x) => x.source === s).length;
  console.log(`${w}: ${specs.length} specs (keep ${bySource('keep')}, food ${bySource('food')}, catalog ${bySource('catalog')}, decor ${bySource('decor')}); dropped ${dropped.length}: ${dropped.map((d) => `${d.id} (${d.why})`).join(', ')}`);
  ok(specs.length >= 40 && specs.length <= 70, `${w}: ${specs.length} specs, in 40-70`);
  const ids = new Set<string>();
  for (const s of specs) {
    const errs = A.validateSpec(s, { registry: reg, ids });
    ok(!errs.length, `${w}: ${s.id} validates (${errs.join('; ')})`);
    ids.add(s.id);
  }
  ok(ids.size === specs.length, `${w}: ids unique`);
  const keeps = specs.filter((s) => s.source === 'keep'), foods = specs.filter((s) => s.source === 'food');
  ok(keeps.length === MAKE_GOODS.length && keeps.every((s, i) => s.good === MAKE_GOODS[i] && s.id === `make:${MAKE_GOODS[i].item}`), `${w}: keep specs are MAKE_GOODS in order`);
  ok(foods.length === FOOD_GOODS.length && foods.every((s, i) => s.good === FOOD_GOODS[i]), `${w}: food specs are FOOD_GOODS in order`);
  ok(specs.slice(0, keeps.length + foods.length).every((s) => s.source === 'keep' || s.source === 'food'), `${w}: keep and food first`);
  const cat = specs.slice(keeps.length + foods.length);
  ok(cat.every((s, i) => !i || ORDER.indexOf(cat[i - 1].class!) < ORDER.indexOf(s.class!) || (cat[i - 1].class === s.class && cat[i - 1].id < s.id)), `${w}: catalogue by class, then name`);
  for (const s of specs) {
    const g = s.good!;
    ok(!/^(chest|stone_axe|stone_shovel|stone_sword)$/.test(g.item), `${w}: ${g.item} is not D11's cut`);
    const other = OTHER_WOODS.filter((k) => k !== w).find((k) => g.item.startsWith(`${k}_`));
    ok(!other, `${w}: ${g.item} is not ${other} wood`);
    const p = m.plan({ [g.item]: g.unit }, {});
    const touched = [...Object.keys(p.gather), ...p.steps.flatMap((st) => [st.item, st.input ?? ''])];
    ok(!touched.some((n) => /wool|leather|string|iron|clay/.test(n)), `${w}: ${g.item} needs no wool, leather, string, iron or clay (${touched.join(',')})`);
    if (s.source === 'catalog') {
      const step = m.plan({ [g.item]: 1 }, {}).steps.find((st) => st.item === g.item);
      ok(step && step.makes === g.unit, `${w}: ${g.item}'s unit ${g.unit} is the recipe's output ${step?.makes}`);
      ok(g.batch % g.unit === 0 && g.batch <= 4 * g.unit && g.batch <= g.target && g.target % g.unit === 0, `${w}: ${g.item} batch ${g.batch} and target ${g.target} in whole units`);
      ok(!/_(door|trapdoor|fence|fence_gate|sign|button|pressure_plate|stairs|slab)$/.test(g.item) || !OTHER_WOODS.some((k) => g.item.startsWith(`${k}_`)) || (s.wood === w && g.wood === w), `${w}: ${g.item} carries its wood`);
      ok(Object.keys(p.gather).every((n) => /^(any:logs|any:cobblestone|cobblestone|sand)$/.test(n) || n === `${w}_log`), `${w}: ${g.item} gathers only logs, cobblestone, sand (${Object.keys(p.gather)})`);
    }
  }
  ok(specs.every((s) => s.name === `Make ${A.goodWords(s.good!.item)}` || s.source === 'keep' || s.source === 'food'), `${w}: catalogue names from goodWords`);
  ok(specs.some((s) => s.id === `make:${w}_door`) && specs.some((s) => s.id === `make:${w}_stairs`), `${w}: its own doors and stairs are in`);
}

// The birch list, for reading
console.log('\nbirch catalogue (id, source/class, target, unit, batch, effect):');
for (const s of built.birch.specs) {
  const g = s.good!;
  console.log(`  ${s.id.padEnd(30)} ${`${s.source}${s.class ? `/${s.class}` : ''}`.padEnd(16)} target ${String(g.target).padStart(2)}  unit ${String(g.unit).padStart(2)}  batch ${String(g.batch).padStart(2)}  ${s.name} -- ${s.effect}`);
}
console.log('');

// 2. Furniture demand
{
  const demand = { birch_stairs: 3, barrel: 2, lever: 2, crafting_table: 1, white_bed: 1, oak_fence: 2, chest: 1, smoker: 1 };
  const { specs, dropped } = A.buildCatalog(reg, new Materials(reg), opts('birch', demand));
  const get = (item: string) => specs.filter((s) => s.good?.item === item);
  const base = (item: string) => built.birch.specs.find((s) => s.good?.item === item)!.good!;
  ok(get('birch_stairs').length === 1 && get('birch_stairs')[0].good!.target >= base('birch_stairs').target + 3, `demand raises birch_stairs' target (${get('birch_stairs')[0]?.good?.target} from ${base('birch_stairs').target})`);
  ok(get('crafting_table')[0]?.good!.target === 2, `demand raises crafting_table's target to 2 (${get('crafting_table')[0]?.good?.target})`);
  ok(get('barrel').length === 1 && get('barrel')[0].good!.target === 4 && get('barrel')[0].source === 'keep', `demand raises the barrel keep's target to 4 (${get('barrel')[0]?.good?.target})`);
  ok(MAKE_GOODS.find((g) => g.item === 'barrel')!.target === 2, 'MAKE_GOODS itself unchanged');
  ok(get('lever').length === 1 && get('lever')[0].source === 'decor' && get('lever')[0].good!.target === 2, `lever added once as a decor good, target 2 (${JSON.stringify(get('lever')[0]?.good)})`);
  ok(!get('white_bed').length && dropped.some((d) => d.id === 'make:white_bed'), 'a bed (wool) is dropped');
  ok(!get('oak_fence').length && dropped.some((d) => d.id === 'make:oak_fence'), 'oak fence in a birch village is dropped');
  ok(!get('chest').length && dropped.some((d) => d.id === 'make:chest'), 'a chest is dropped');
  ok(dropped.filter((d) => d.id === 'make:smoker').length === 1, 'smoker dropped once (candidate and demand: one entry)');
  ok(new Set(specs.map((s) => s.id)).size === specs.length, 'demand gives no item two specs');
  ok(specs.length === built.birch.specs.length + 1, `demand adds exactly one spec (${specs.length} vs ${built.birch.specs.length})`);
  console.log(`demand at birch: ${specs.length} specs; dropped ${dropped.map((d) => d.id).join(', ')}`);
}

// Plurals
for (const [item, words] of [['grindstone', 'grindstones'], ['stone', 'stone'], ['smooth_stone', 'smooth stone'], ['glass', 'glass'], ['birch_stairs', 'birch stairs'],
  ['stone_bricks', 'stone bricks'], ['torch', 'torches'], ['birch_fence', 'birch fences'], ['cut_sandstone', 'cut sandstone'], ['charcoal', 'charcoal'], ['box', 'boxes']]) {
  ok(A.goodWords(item) === words, `goodWords(${item}) is ${words} (${A.goodWords(item)})`);
}

// 3. The validator
{
  const good = (over: Partial<Spec> = {}, g: Record<string, unknown> = {}): Spec => ({
    id: 'make:birch_door', kind: 'make', name: 'Make birch doors', source: 'catalog', class: 'decor',
    steps: [{ skill: 'make', args: { item: 'birch_door' } }], effect: 'doors', success: { yield: 'make' }, wood: 'birch',
    good: { item: 'birch_door', target: 6, batch: 6, unit: 3, words: 'birch doors', forWhat: 'doors', wood: 'birch', ...g }, ...over,
  });
  const ctx = { registry: reg };
  const rejects = (s: Spec, what: string, extra?: Set<string>) => {
    const errs = A.validateSpec(s, { registry: reg, ids: extra });
    ok(errs.length > 0, `the validator rejects ${what}`);
    console.log(`  rejects ${what}: ${errs.join('; ')}`);
  };
  ok(A.validateSpec(good(), ctx).length === 0, `a good spec validates (${A.validateSpec(good(), ctx)})`);
  rejects(good({ steps: [{ skill: 'teleport', args: {} }] }), 'an unknown skill');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_door', speed: 2 } }] }), 'an unknown argument');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_door', count: '4' } }] }), 'a wrong type');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_door', count: 0 } }] }), 'count 0');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_door', count: 65 } }] }), 'count 65');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_door', furnace: 4 } }] }), 'furnace 4');
  rejects(good({ steps: [{ skill: 'collect', args: { block: 'sand', x: 1, y: 64, z: 2 } }] }), 'coordinates');
  rejects(good({ id: 'make:bread', steps: [{ skill: 'make', args: { item: 'bread' } }] }, { item: 'bread', words: 'bread' }), 'a MAKE_NEVER item in a catalogue good');
  rejects(good(), 'a duplicate id', new Set(['make:birch_door']));
  rejects(good({}, { batch: 2 }), 'a batch below its unit');
  rejects(good({}, { batch: 4 }), 'a batch not a multiple of its unit');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'string' } }] }, { item: 'string' }), 'an unobtainable item');
  rejects(good({ steps: [{ skill: 'make', args: { item: 'birch_dor' } }] }, { item: 'birch_dor' }), 'an unknown item');
  rejects(good({ id: 'Make Doors!' }), 'a bad id');
  rejects(good({ name: 'x'.repeat(61) }), 'a long name');
  rejects(good({ wood: 'oak' }), 'the wrong wood');
  let threw = false;
  try { A.validateSpec(null as any, ctx); A.validateSpec({ steps: [null] } as any, ctx); A.validateSpec({ kind: 'make', steps: 3 } as any, ctx); } catch { threw = true; }
  ok(!threw, 'the validator never throws');
  ok(A.validateSpec({ ...good(), source: 'food', wood: undefined, good: { ...FOOD_GOODS[0] }, id: 'make:bread', steps: [{ skill: 'make', args: { item: 'bread' } }] }, ctx).length === 0, 'a food good may take MAKE_NEVER items and target 0');
}

// 4. Gathering and furnishing
for (const w of [undefined, 'birch']) {
  const g = A.gatherSpecs(w);
  ok(g.map((s) => s.id).join() === 'gather:sand,gather:logs,gather:cobblestone', `gatherSpecs(${w}): sand, logs, cobblestone (${g.map((s) => s.id)})`);
  const ids = new Set<string>();
  for (const s of g) {
    const errs = A.validateSpec(s, { registry: reg, ids });
    ok(!errs.length, `gatherSpecs(${w}): ${s.id} validates (${errs.join('; ')})`);
    ids.add(s.id);
  }
  console.log(`gatherSpecs(${w}): ${g.map((s) => `${s.id} [${s.steps.map((st) => `${st.skill} ${JSON.stringify(st.args)}`).join(', ')}]`).join('; ')}`);
}
ok(A.validateSpec(A.furnishSpec, { registry: reg }).length === 0, `furnishSpec validates (${A.validateSpec(A.furnishSpec, { registry: reg })})`);
ok(A.validateSpec({ ...A.furnishSpec, steps: [{ skill: 'furnish', args: { part: 'house_3', count: 4 } }] }, { registry: reg }).length === 0, 'a furnish instance validates');

console.log(`\n${checks} checks, ${failures} failures`);
console.log(failures ? 'FAIL activities_unit' : 'PASS activities_unit');
process.exit(failures ? 1 : 0);
