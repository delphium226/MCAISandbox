/**
 * The food step checked offline (runs/2026-10-15/s30/spec_food.md 6 and 7 step 1, its check spec_food_check.md; no server).
 * Copies of a villages.json are loaded into a real MineflayerWorld on a scratch folder (no bots, RCON stubbed, model calls
 * refused, console.log muted, the clock frozen), as grow_check.mts does, with MC_GROW=1, MC_GROW_FARMS=1 and MC_APPETITE=18.
 * 1. padLadder per biome (plains, desert, savanna, taiga, snowy) for 1-4 houses picked as grow.ts picks them: every rung with a
 *    field at the smallest size 17-33 where postLayout's own order fits it (scratch/food_pad.mts's `fits`), none over 31,
 *    none of a size an earlier rung with as many houses has, the last the pad without a field (padFor's); plains 4 houses
 *    30/4+2, 27/3+1, 19/2+1, 22/4 (food_pad.out), and 1 house 19 with a field and 2 slots first (the check's L9).
 * 2. postLayout in neighbourhood mode with a field on the G25 record (scratch/g25_villages.json): at a free site (--site
 *    X,Y,Z, else one found 40-70 blocks from home off every layout), a field and 2 slots, lamps and signs off the field,
 *    every house placed, every field and slot corner within 96 of the storage hut (printed with the hut chunk's Chebyshev
 *    distance, the check's M5), no seed task when storage's spare seeds cover the field and seed tasks for all of it when
 *    storage has none (parts of 8), the plant task (tend_farm layout=K) behind the prepare and those seed tasks; in a snowy
 *    biome the houses laid out with no field and the reason on the layout (farmWhy).
 * 3. appetite.ts: drain, stateOf, chooseMeal (the most items at or below 20, overflow, bread first, the cake last and only
 *    for a hungry member, the planting stock kept), foodPoints, isFoodKind, isFoodTask; and FOOD_POINTS against the tables of
 *    stage_village.py, watch_village.py, make_log.py and the panel (the FOOD ledger and the panel's points use them).
 * 4. makePlan for bread and pumpkin pie (mcWorkshop.ts MAKE_GOODS) on fixture stocks with 25 members: the wheat keep (6),
 *    the cake's egg and cane keeps, the target (2 bread a member) met.
 * 5. The sweep with an appetite (fake members as grow_check.mts's): a hungry member's menu holds only food work (fixed and
 *    model mode), a peckish one with food in storage gets `eat` first and no model call (M2), a fed one no `eat`; a hungry
 *    first member does not stop the sweep for the members after it (H2); a peckish worker is not held back for growth tasks
 *    it may not claim (H1). The fixes review's cases: a hungry member may claim the field's planting with bread in storage
 *    (lens 1 M2); a peckish one with only a cake stored takes board work and gets no meal (L1); a meal another member is on
 *    the way to eat is not offered again nor holds a claim (M1); seeds an open planting still needs are kept from the pens
 *    (mcBuild.ts seedsForFields, lens 2 H1).
 * A part whose code is not there yet says what it needs and is skipped (exit 3 when anything was skipped and nothing failed).
 * Usage: node_modules/.bin/tsx scripts/checks/food_check.mts [villages.json] [--village NAME] [--site X,Y,Z]
 * (default runs/2026-10-15/s30/scratch/g25_villages.json and G25; VERBOSE=1 lists part 2's tasks). Exits 1 on a FAIL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Counts = Record<string, number>;

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  if (i < 0) return undefined;
  const val = argv[i + 1];
  argv.splice(i, 2);
  return val;
};
const VILLAGE = opt('--village') ?? 'G25';
const SITE = opt('--site');
const SRC = argv[0] ?? 'runs/2026-10-15/s30/scratch/g25_villages.json';

// (read when the world's modules load: set first; model calls go nowhere, the farms and the appetite on)
process.env.MC_GROW = '1';
process.env.MC_GROW_FARMS = '1';
// (spec_vote1: the style vote off, so growth picks as before)
process.env.MC_VOTE = 'off';
process.env.MC_APPETITE = '18';
process.env.MC_APPETITE_IDLE = '0.25';
process.env.MC_CHOOSE = 'fixed';
process.env.MC_CHOICE_INSTANCES = '';
process.env.MC_CHOICE_FAMILIES = 'make';
process.env.MC_TIME_SCALE = '1';
process.env.MC_OLLAMA_URL = 'http://127.0.0.1:9';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'food-check-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
const NOW = Date.parse('2026-10-15T12:00:00Z');
let clock = NOW;
Date.now = () => clock;
let modelCalls = 0;
globalThis.fetch = (async () => {
  modelCalls++;
  throw new Error('food_check: no network');
}) as never;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);
let fails = 0, skips = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fails++;
  say(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const skip = (what: string) => {
  skips++;
  say(`  SKIP ${what}`);
};
const load = async (p: string) => {
  try {
    return await import(p);
  } catch (e) {
    say(`  (cannot load ${p}: ${String((e as Error)?.message ?? e).split('\n')[0]})`);
    return null;
  }
};

const G: Any = await load('../../server/src/grow');
const L: Any = await load('../../server/src/layout');
const SP: Any = await load('../../server/src/streetPlan');
const AP: Any = await load('../../server/src/appetite');
const VP: Any = await load('../../server/src/vanillaPieces');
const VD: Any = await load('../../server/src/vanillaData');
const MWm: Any = await load('../../server/src/mineflayer/mcWorld');
const W9: Any = await load('../../server/src/mineflayer/mcWorkshop');
const MB: Any = await load('../../server/src/mineflayer/mcBuild');
const MW = MWm?.MineflayerWorld;

const grow1 = (a: Any, n: number) => ({ x1: a.x1 - n, z1: a.z1 - n, x2: a.x2 + n, z2: a.z2 + n });
const inside = (c: { x: number; z: number }, a: Any) => c.x >= a.x1 && c.x <= a.x2 && c.z >= a.z1 && c.z <= a.z2;

/** scratch/food_pad.mts's `fits`: the houses, a field and `slots` slots on an S pad by postLayout's own order. */
function fits(designs: Any[], size: number, slots: number): boolean {
  const items = designs.map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...SP.doorOf(d) }));
  const s = SP.planStreets(0, 0, size, null, items);
  if (s.unplaced.length) return false;
  const grids = s.places.map((p: Any) => ({ design: designs.find((d) => d.name === p.name), x: p.x, z: p.z, rot: (p.rotate ?? 0) / 90 }));
  const farm = SP.placeFarm(grids, s.plot, { streets: s.streets });
  if (!farm) return false;
  const lamps = SP.placeLamps(s, undefined, undefined, [farm]);
  if (lamps.length < 2) return false;
  const placed: Any[] = [];
  const near = { x: (farm.x1 + farm.x2) / 2, z: (farm.z1 + farm.z2) / 2 };
  for (let i = 0; i < slots; i++) {
    const avoid = [grow1(farm, 1), ...placed.map((q) => grow1(q, 1)), ...lamps.map((c: Any) => grow1({ x1: c.x, z1: c.z, x2: c.x, z2: c.z }, 1))];
    const q = SP.placeFarm(grids, s.plot, { streets: s.streets, near, avoid });
    if (!q) return false;
    placed.push(q);
  }
  return true;
}
const smallest = (designs: Any[], slots: number) => {
  for (let size = 17; size <= 33; size++) if (fits(designs, size, slots)) return size;
  return null;
};
const ladderText = (l: Any[]) => l.map((o) => `${o.size}/${o.n}${o.slots >= 0 ? `+${o.slots}` : ''}`).join(', ') || 'none';

// ---------------------------------------------------------------- 1. the pad ladder
say('== 1. padLadder per biome');
if (!G?.padLadder || !SP || !VP?.vanillaLibrary || !VD?.vanillaJar) skip('needs grow.ts padLadder (spec 2.1), streetPlan.ts and the vanilla library');
else if (!G.GROW_FARMS) skip('grow.ts GROW_FARMS is off although MC_GROW_FARMS=1 was set before loading it');
else {
  let jar: Any;
  try {
    jar = VD.vanillaJar();
  } catch (e) {
    jar = null;
    skip(`no Minecraft jar to read the vanilla pieces from: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
  }
  for (const biome of jar ? ['plains', 'desert', 'savanna', 'taiga', 'snowy'] : []) {
    const lib = VP.vanillaLibrary(biome, () => true, jar);
    for (let n = 1; n <= 4; n++) {
      const v: Any = { plan: 'street', designs: {}, layouts: [], tasks: [], structures: [] };
      const pick: string[] = G.pickHouses(v, n, lib.houses);
      const ds = pick.map((h) => v.designs[h]);
      const ladder: Any[] = G.padLadder(ds);
      const plain = G.padFor(ds);
      const bad: string[] = [];
      for (const [i, o] of ladder.entries()) {
        if (o.size > 31) bad.push(`${o.size} over 31`);
        if (o.slots >= 0 && smallest(ds.slice(0, o.n), o.slots) !== o.size) bad.push(`${o.size}/${o.n}+${o.slots}: the smallest fit is ${smallest(ds.slice(0, o.n), o.slots)}`);
        if (ladder.slice(0, i).some((q) => q.size === o.size && q.n >= o.n)) bad.push(`${o.size}/${o.n} repeats an earlier size`);
      }
      const last = ladder[ladder.length - 1];
      // (padFor's pad last, unless a rung with a field already has its size for as many houses: then it adds nothing)
      const covered = plain && ladder.some((o) => o.slots >= 0 && o.size === plain.size && o.n >= plain.n);
      if (plain && !covered && !(last && last.slots === -1 && last.size === plain.size && last.n === plain.n)) bad.push(`the last rung is not padFor's ${plain.size}/${plain.n}`);
      if (!ladder.some((o) => o.slots >= 0) && smallest(ds, 2) !== null && smallest(ds, 2)! <= 31) bad.push('no rung with a field though one fits');
      check(!bad.length, `${biome} ${n} house${n > 1 ? 's' : ''} (${ds.map((d) => `${d.width}x${d.depth}`).join(',')}): ${ladderText(ladder)}${bad.length ? `: ${bad.join('; ')}` : ''}`);
      if (biome === 'plains' && n === 4) check(ladderText(ladder) === '30/4+2, 27/3+1, 19/2+1, 22/4', `plains 4 houses: ${ladderText(ladder)} (want 30/4+2, 27/3+1, 19/2+1, 22/4, food_pad.out)`);
      if (biome === 'plains' && n === 1) check(ladder[0]?.size === 19 && ladder[0]?.n === 1 && ladder[0]?.slots === 2, `plains 1 house: first rung ${ladderText(ladder.slice(0, 1))} (want 19/1+2, the check's L9)`);
    }
  }
}

// ---------------------------------------------------------------- the world copies
function world(): Any {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
  fs.copyFileSync(SRC, path.join(dir, 'villages.json'));
  mute();
  try {
    const w = new MW('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
    w.villages.save = () => {};
    w.atlas.sightings = () => [];
    w.atlas.animalSightings = () => [];
    w.atlas.known = () => 1;
    return w;
  } finally {
    unmute();
  }
}
/** Fake members (grow_check.mts's): enqueue records the call; idle while none of its own actions waits or runs. */
function members(w: Any, v: Any, names: string[], brain: (name: string) => Any = (n) => (n === 'Mayor' ? null : { name: 'fake', claimsTasks: () => true })) {
  w.agents.clear();
  w.chores?.clear?.();
  const calls: Array<[string, string, Any]> = [];
  const statuses: Any[] = [];
  const home = v.layouts?.[0] ?? { x1: 0, x2: 0, z1: 0, z2: 0, y: 64 };
  const pos = { x: Math.floor((home.x1 + home.x2) / 2) + 0.5, y: (home.y ?? 64) + 1, z: Math.floor((home.z1 + home.z2) / 2) + 0.5 };
  let id = 1;
  for (const name of names) {
    const own: Any[] = [];
    const memory: Any = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
    const a: Any = {
      name, role: memory.villageRole, memory, world: w,
      village: () => w.villages.get(memory.village),
      idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
      enqueue: (type: string, args: Any) => {
        const s = { id: id++, type, args, state: 'queued' };
        own.push(s);
        statuses.push(s);
        calls.push([name, type, args]);
        return s;
      },
      bot: { entity: { position: { ...pos } }, entities: {}, inventory: { items: () => [] }, world: { getColumn: () => null }, game: { minY: -64 } },
      brain: brain(name),
    };
    w.agents.set(name.toLowerCase(), a);
  }
  return { calls, statuses };
}
/** One sweep (farmChores with its 30 s gate opened): the members asked for a menu in order, and each menu. */
async function sweep(w: Any): Promise<{ asked: string[]; menus: Map<string, Any>; error?: string }> {
  const asked: string[] = [];
  const menus = new Map<string, Any>();
  const menu = w.menu;
  w.menu = function (this: Any, v: Any, a: Any, ...rest: Any[]) {
    const r = menu.call(this, v, a, ...rest);
    asked.push(a.name);
    menus.set(a.name, r.menu);
    return r;
  };
  w.farmCheckAt = 0;
  let error: string | undefined;
  mute();
  try {
    w.farmChores();
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  } catch (e) {
    error = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
  } finally {
    unmute();
    w.menu = menu;
  }
  return { asked, menus, error };
}
/** Storage's chests set to `items` (the first chest holds them all). */
function stock(v: Any, items: Counts) {
  const cs = v.storage?.chests ?? [];
  for (const c of cs) c.items = {};
  if (cs[0]) cs[0].items = { ...items };
}
const appetite = (v: Any, levels: Record<string, number>) => {
  v.food = { members: Object.fromEntries(Object.entries(levels).map(([n, level]) => [n, { level, at: clock, meals: 0, hungryMs: 0 }])), made: {}, eaten: {}, meals: 0 };
};

// ---------------------------------------------------------------- 2. a neighbourhood with a field
say(`== 2. postLayout, neighbourhood mode with a field (${SRC}, ${VILLAGE})`);
let nbSite: Any = null, nbPicks: string[] = [], nbSize = 30;
if (!MW || !L?.postLayout || !G?.pickHouses || !G?.padLadder) skip('needs mcWorld.ts, layout.ts postLayout and grow.ts');
else if (!fs.existsSync(SRC)) skip(`no ${SRC}`);
else {
  const w0 = world();
  const v0 = w0.villages.get(VILLAGE);
  if (!v0) skip(`no village ${VILLAGE} in ${SRC}`);
  else {
    const lib = w0.vanillaLibrary?.(v0.vanillaBiome ?? 'plains')?.houses ?? null;
    const copy = structuredClone(v0);
    nbPicks = G.pickHouses(copy, 4, lib);
    const ladder: Any[] = G.padLadder(nbPicks.map((p) => copy.designs[p]));
    const rung = ladder.find((o) => o.slots === 2) ?? ladder[0];
    nbSize = rung?.size ?? 30;
    nbPicks = nbPicks.slice(0, rung?.n ?? nbPicks.length);
    const hut = v0.storageHut;
    const hutAt = hut ? { x: (hut.x1 + hut.x2) / 2, z: (hut.z1 + hut.z2) / 2 } : null;
    const home = v0.layouts?.[0] ? { x: Math.floor((v0.layouts[0].x1 + v0.layouts[0].x2) / 2), z: Math.floor((v0.layouts[0].z1 + v0.layouts[0].z2) / 2) } : null;
    const y = v0.layouts?.[0]?.y ?? 64;
    if (SITE) {
      const [x, yy, z] = SITE.split(',').map(Number);
      nbSite = { x, y: yy, z, size: nbSize, biome: v0.vanillaBiome ?? 'plains' };
    } else if (home) {
      // (a pad off every layout, the annex and the works plot by 3, its centre 40-70 blocks from home)
      const sides = [v0.layouts ?? [], v0.layouts?.[0]?.annex, v0.layouts?.[0]?.works].flat().filter(Boolean);
      const half = Math.floor(nbSize / 2);
      for (let r = 40; r <= 70 && !nbSite; r += 3)
        for (let k = 0; k < 32 && !nbSite; k++) {
          const x = Math.round(home.x + r * Math.cos((k * Math.PI) / 16)), z = Math.round(home.z + r * Math.sin((k * Math.PI) / 16));
          const pad = { x1: x - half, z1: z - half, x2: x - half + nbSize - 1, z2: z - half + nbSize - 1 };
          if (sides.every((q: Any) => q.x2 < pad.x1 - 3 || q.x1 > pad.x2 + 3 || q.z2 < pad.z1 - 3 || q.z1 > pad.z2 + 3)) nbSite = { x, y, z, size: nbSize, biome: v0.vanillaBiome ?? 'plains' };
        }
    }
    if (!nbSite) skip('no free site for the dry layout (pass --site X,Y,Z)');
    else {
      say(`  ${nbPicks.length} houses (${nbPicks.join(', ')}) on ${nbSize}x${nbSize} at ${nbSite.x},${nbSite.y},${nbSite.z}; ladder ${ladderText(ladder)}`);
      const post = (seeds: number, biome?: string) => {
        const w = world();
        const v = w.villages.get(VILLAGE);
        for (const p of nbPicks) if (!v.designs[p]) v.designs[p] = structuredClone(copy.designs[p]);
        const cs = v.storage?.chests ?? [];
        for (const c of cs) delete c.items.wheat_seeds;
        if (cs[0] && seeds) cs[0].items.wheat_seeds = seeds;
        const ids = new Set(v.tasks.map((t: Any) => t.id));
        const before = { unplaced: JSON.stringify(v.unplaced ?? null), layouts: (v.layouts ?? []).length };
        let r: string;
        mute();
        try {
          r = L.postLayout(w, v, 'Worker1', { ...nbSite, ...(biome ? { biome } : {}) }, nbPicks, true, undefined, { poster: 'grow', neighbourhood: true, farm: true, slots: 2 });
        } catch (e) {
          r = `threw ${String((e as Error)?.stack ?? e).split('\n').slice(0, 2).join(' | ')}`;
        } finally {
          unmute();
        }
        const fresh = v.tasks.filter((t: Any) => !ids.has(t.id));
        return { w, v, r: String(r), fresh, rec: (v.layouts ?? [])[(v.layouts ?? []).length - 1] ?? {}, before };
      };
      // (a) storage's spare seeds cover the field
      const a = post(8 + 40);
      say(`  seeds in storage 48: ${a.r.slice(0, 160)}`);
      if (process.env.VERBOSE) for (const t of a.fresh) say(`    ${t.id} ${t.soft ? 'soft ' : ''}after [${(t.after ?? []).join(',')}] ${t.title}`);
      const K = (a.v.layouts ?? []).length;
      const f = a.rec.farm;
      check(/^Laid out/.test(a.r) && (a.v.layouts ?? []).length === a.before.layouts + 1, `laid out, one layout added (${a.before.layouts} -> ${(a.v.layouts ?? []).length})`);
      check(!!f && (a.rec.slots ?? []).length === 2, `a field ${f ? `${f.x1}..${f.x2},${f.z1}..${f.z2} (${(f.sow ?? []).length} to sow)` : 'none'}${a.rec.farmWhy ? ` (${a.rec.farmWhy})` : ''} and ${(a.rec.slots ?? []).length} slots (want 2)`);
      const builds = a.fresh.filter((t: Any) => /^Build /.test(t.title));
      check(builds.length === nbPicks.length && JSON.stringify(a.v.unplaced ?? null) === a.before.unplaced, `every house placed: ${builds.length} builds of ${nbPicks.length}, unplaced unchanged`);
      if (f) {
        const lampsOn = (a.rec.lamps ?? []).filter((c: Any) => inside(c, f));
        const signsOn = (a.rec.signs ?? []).filter((c: Any) => inside(c, f));
        check((a.rec.lamps ?? []).length >= 2 && !lampsOn.length && !signsOn.length, `lamps ${(a.rec.lamps ?? []).length} (>= 2), none on the field; signs on it ${signsOn.length}`);
        const slotsOn = (a.rec.slots ?? []).filter((s: Any) => !(s.x2 < f.x1 || s.x1 > f.x2 || s.z2 < f.z1 || s.z1 > f.z2));
        check(!slotsOn.length, `no slot overlaps the field`);
        if (hutAt) {
          const far = (q: Any) => Math.max(...[[q.x1, q.z1], [q.x1, q.z2], [q.x2, q.z1], [q.x2, q.z2]].map(([x, z]) => Math.hypot(x - hutAt.x, z - hutAt.z)));
          const cheb = (q: Any) => Math.max(Math.abs((q.x1 >> 4) - (Math.floor(hutAt.x) >> 4)), Math.abs((q.x2 >> 4) - (Math.floor(hutAt.x) >> 4)), Math.abs((q.z1 >> 4) - (Math.floor(hutAt.z) >> 4)), Math.abs((q.z2 >> 4) - (Math.floor(hutAt.z) >> 4)));
          const all = [f, ...(a.rec.slots ?? [])];
          say(`  from the storage hut: ${all.map((q: Any, i: number) => `${i ? `slot ${i}` : 'field'} ${far(q).toFixed(1)} blocks, ${cheb(q)} chunks`).join('; ')}`);
          check(all.every((q: Any) => far(q) <= 96), `every field and slot corner within 96 of the storage hut (farthest ${Math.max(...all.map(far)).toFixed(1)})`);
        }
      }
      const seedTasks = a.fresh.filter((t: Any) => /collect block=wheat_seeds/.test(t.detail ?? ''));
      check(!seedTasks.length, `no seed task with 40 spare seeds in storage (${seedTasks.length})`);
      const plant = a.fresh.find((t: Any) => /tend_farm layout=/.test(t.detail ?? ''));
      const prep = a.fresh.filter((t: Any) => /^Prepare /.test(t.title));
      check(!!plant && new RegExp(`tend_farm layout=${K}\\b`).test(plant.detail) && prep.length > 0 && prep.every((p: Any) => plant.after.includes(p.id)) && !!plant.soft,
        `the plant task ${plant ? `${plant.id} "${plant.title}" (${plant.detail.slice(0, 24)}) after [${plant.after.join(',')}]` : 'missing'}: layout=${K}, behind the prepare, soft`);
      check(a.fresh.every((t: Any) => !/^Set up the village (storage|stations)|^Dig the village mine/.test(t.title)), 'no storage, station or mine task');
      // (b) no seeds in storage: seed tasks for the whole field, in parts of 8, and the plant task behind them
      const b = post(0);
      const sb = b.fresh.filter((t: Any) => /collect block=wheat_seeds/.test(t.detail ?? ''));
      const want = (b.rec.farm?.sow ?? []).length;
      const got = sb.reduce((s: number, t: Any) => s + Number(/count=(\d+)/.exec(t.detail)?.[1] ?? 0), 0);
      const plantB = b.fresh.find((t: Any) => /tend_farm layout=/.test(t.detail ?? ''));
      check(!!b.rec.farm && got === want && sb.every((t: Any) => Number(/count=(\d+)/.exec(t.detail)?.[1] ?? 99) <= 8) && !!plantB && sb.every((t: Any) => plantB.after.includes(t.id)),
        `no seeds in storage: ${sb.length} seed tasks for ${got} of ${want}, each at most 8, the plant task behind them`);
      // (c) a snowy biome: the houses all the same, no field, the reason on the layout
      const c = post(48, 'snowy');
      check(/^Laid out/.test(c.r) && !c.rec.farm && !!c.rec.farmWhy && c.fresh.filter((t: Any) => /^Build /.test(t.title)).length === nbPicks.length,
        `snowy: ${c.r.slice(0, 60)}; field ${c.rec.farm ? 'placed' : 'none'}, farmWhy "${c.rec.farmWhy ?? ''}"`);
    }
  }
}

// ---------------------------------------------------------------- 3. appetite.ts
say('== 3. appetite.ts');
const needAp = ['APPETITE', 'FOOD_POINTS', 'drain', 'stateOf', 'chooseMeal', 'foodPoints', 'isFoodKind', 'isFoodTask'].filter((k) => !AP || !(k in AP));
if (needAp.length) skip(`needs appetite.ts ${needAp.join(', ')} (spec 2.3)`);
else {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  check(AP.APPETITE.rate === 18 && near(AP.APPETITE.idle, 0.25) && AP.APPETITE.eatAt === 12 && AP.APPETITE.hungryAt === 6, `APPETITE ${JSON.stringify(AP.APPETITE)}`);
  check(near(AP.drain(20, 60, true), 2) && near(AP.drain(20, 60, false), 15.5) && AP.drain(1, 600, true) === 0,
    `drain: an hour busy 20 -> ${AP.drain(20, 60, true)} (2), idle -> ${AP.drain(20, 60, false)} (15.5), floor ${AP.drain(1, 600, true)} (0)`);
  const st = [12.01, 12, 6.01, 6, 0].map((l) => AP.stateOf(l));
  check(st.join(',') === 'fed,peckish,peckish,hungry,hungry', `stateOf 12.01, 12, 6.01, 6, 0: ${st.join(', ')}`);
  const meal = (level: number, store: Counts) => AP.chooseMeal(level, store);
  const txt = (m: Any) => (m ? `${m.n} ${m.item}` : 'null');
  const cases: Array<[number, Counts, string, string]> = [
    [12, { bread: 5 }, '1 bread', 'at 12, 1 bread (2 would pass 20)'],
    [4, { bread: 5 }, '3 bread', 'at 4, 3 bread to 19'],
    [12, { bread: 3, pumpkin_pie: 2 }, '1 bread', 'bread before pie on equal overflow'],
    [15, { bread: 3, pumpkin_pie: 2 }, '1 bread', 'at 15 the pie overflows: bread'],
    [10, { cake: 1, melon_slice: 4 }, '4 melon_slice', 'not hungry: the cake last'],
    [5, { cake: 1 }, '1 cake', 'hungry, only a cake: the cake'],
    [10, { cake: 1 }, 'null', 'peckish, only a cake: nothing (lens 1 L1: G3f\'s Mayor ate a whole cake at 11.4)'],
    [10, { carrot: 8 }, 'null', 'the slots\' 8 carrots kept'],
    [10, { carrot: 10 }, '2 carrot', 'carrots beyond the 8 kept'],
    [10, { egg: 5, wheat: 20, milk_bucket: 1, sugar: 4, pumpkin: 3 }, 'null', 'ingredients are not food'],
    [10, {}, 'null', 'empty storage'],
  ];
  for (const [level, store, want, why] of cases) check(txt(meal(level, store)) === want, `chooseMeal(${level}, ${JSON.stringify(store)}) = ${txt(meal(level, store))} (${want}: ${why})`);
  check(AP.foodPoints({ bread: 2, cake: 1, egg: 3, carrot: 9 }) === 27, `foodPoints(2 bread, 1 cake, 3 eggs, 9 carrots) = ${AP.foodPoints({ bread: 2, cake: 1, egg: 3, carrot: 9 })} (27: carrots beyond the 8 kept)`);
  const kinds: Array<[string, string | undefined, boolean]> = [['eat', undefined, true], ['farm', undefined, true], ['slot', undefined, true], ['start', undefined, true], ['pen', undefined, true],
    ['penwork', undefined, true], ['cake', undefined, true], ['make', 'make:bread', true], ['make', 'make:pumpkin_pie', true], ['make', 'make:torch', false], ['explore', undefined, false],
    ['iron', undefined, false], ['light', undefined, false], ['gather', 'gather:sand', false], ['grow', undefined, false], ['annex', undefined, false], ['works', undefined, false]];
  const wrong = kinds.filter(([k, id, want]) => !!AP.isFoodKind(k, id ? { id } : undefined) !== want).map(([k, id]) => id ?? k);
  check(!wrong.length, `isFoodKind: fields, slots, starts, pens, pen work, the cake, eating and bread/pie makes only${wrong.length ? ` (wrong: ${wrong.join(', ')})` : ''}`);
  const tasks: Array<[Any, boolean]> = [[{ title: 'Plant the farm: 16 wheat', detail: 'tend_farm layout=3 (lay the farm\'s water, ...)' }, true],
    [{ title: 'Gather 8 wheat_seeds for the farm', detail: 'collect block=wheat_seeds count=8, then deposit all' }, true],
    [{ title: 'Build plains_small_house_1', detail: 'build_design design=plains_small_house_1 x=1 z=2' }, false],
    [{ title: 'Gather 12 birch_log', detail: 'collect block=birch_log count=12, then deposit all' }, false]];
  const wrongT = tasks.filter(([t, want]) => !!AP.isFoodTask(t) !== want).map(([t]) => t.title);
  check(!wrongT.length, `isFoodTask: the plant task and its seed tasks only${wrongT.length ? ` (wrong: ${wrongT.join('; ')})` : ''}`);
  // The FOOD ledger's and the panel's tables (their points must be the server's)
  const tables: Array<[string, RegExp]> = [
    ['scripts/stage_village.py', /^FOOD_POINTS = \{([\s\S]*?)\n\}/m], ['scripts/watch_village.py', /^FOOD_POINTS = \{([\s\S]*?)\n\}/m],
    ['scripts/checks/make_log.py', /^FOOD_POINTS = \{([\s\S]*?)\}/m], ['server/panel/index.html', /^const FOOD_POINTS = \{([\s\S]*?)\n\};/m],
  ];
  const server = JSON.stringify(Object.entries(AP.FOOD_POINTS).sort());
  for (const [f, re] of tables) {
    const m = re.exec(fs.readFileSync(f, 'utf8'));
    const t: Counts = {};
    for (const [, k, q] of (m?.[1] ?? '').matchAll(/"?([a-z_]+)"?\s*:\s*(\d+)/g)) t[k] = Number(q);
    const mine = JSON.stringify(Object.entries(t).sort());
    const diff = [...new Set([...Object.keys(t), ...Object.keys(AP.FOOD_POINTS)])].filter((k) => t[k] !== AP.FOOD_POINTS[k]);
    check(mine === server, `${f}'s FOOD_POINTS equals appetite.ts's${diff.length ? ` (differs: ${diff.join(', ')})` : ''}`);
  }
}

// ---------------------------------------------------------------- 4. food makes
say('== 4. makePlan for bread and pumpkin pie');
// (the food goods in MAKE_GOODS as the spec says, or kept apart as mcWorkshop.ts FOOD_GOODS)
const goods = [...(W9?.MAKE_GOODS ?? []), ...(W9?.FOOD_GOODS ?? [])] as Any[];
const bread = goods.find((g) => g.item === 'bread'), pie = goods.find((g) => g.item === 'pumpkin_pie');
if (!MW || !bread || !pie) skip(`needs mcWorkshop.ts MAKE_GOODS or FOOD_GOODS with bread and pumpkin_pie (spec 5)${MW ? '' : ' and mcWorld.ts'}`);
else if (!fs.existsSync(SRC)) skip(`no ${SRC}`);
else {
  const w = world();
  const v = w.villages.get(VILLAGE);
  if (!v) skip(`no village ${VILLAGE}`);
  else {
    const names = ['Mayor', ...Array.from({ length: 24 }, (_, i) => `Worker${i + 1}`)];
    members(w, v, names);
    appetite(v, Object.fromEntries(names.map((n) => [n, 18])));
    const plan = (g: Any, store: Counts) => {
      mute();
      try {
        return w.makePlan(v, g, 'Worker1', store);
      } catch (e) {
        return { why: `threw ${String((e as Error)?.message ?? e).split('\n')[0]}` };
      } finally {
        unmute();
      }
    };
    const t = (p: Any) => (p.count ? `${p.count} from ${JSON.stringify(p.inputs)}` : p.why);
    const b30 = plan(bread, { wheat: 30 });
    check(b30.count > 0 && (b30.inputs?.wheat ?? 0) <= 30 - 6, `bread from 30 wheat: ${t(b30)} (wheat taken at most 24: 6 kept)`);
    const b6 = plan(bread, { wheat: 8 });
    check(!b6.count, `bread from 8 wheat: ${t(b6)} (nothing: 6 kept, a loaf takes 3)`);
    const bAt = plan(bread, { bread: 50, wheat: 30 });
    check(!bAt.count, `bread with 50 in storage and 25 members: ${t(bAt)} (the target 2 a member met)`);
    const p1 = plan(pie, { pumpkin: 3, sugar: 3, egg: 3 });
    check(p1.count > 0 && (p1.inputs?.egg ?? 0) <= 2, `pie from 3 pumpkins, 3 sugar, 3 eggs: ${t(p1)} (eggs taken at most 2: the cake's 1 kept)`);
    const p2 = plan(pie, { pumpkin: 3, sugar: 3, egg: 1 });
    check(!p2.count, `pie with 1 egg: ${t(p2)} (nothing: the cake's egg kept)`);
    const p3 = plan(pie, { pumpkin: 3, sugar_cane: 4, egg: 3 });
    check(!p3.count || (p3.inputs?.sugar_cane ?? 0) <= 2, `pie from cane: ${t(p3)} (cane taken at most 2: the cake's 2 kept)`);
  }
}

// ---------------------------------------------------------------- 5. the sweep with an appetite
say('== 5. menus and the sweep with an appetite');
if (!MW || !fs.existsSync(SRC)) skip('needs mcWorld.ts and the villages file');
else {
  // (a fresh copy for each case: the sweep's facts are cached by the board's version, which direct edits do not move)
  const fresh = (items: Counts, levels: Record<string, number>, names: string[]) => {
    const wf = world();
    const vf = wf.villages.get(VILLAGE);
    delete vf.growth;
    members(wf, vf, names);
    stock(vf, items);
    appetite(vf, levels);
    return { w: wf, v: vf };
  };
  let { w, v } = { w: world(), v: null as Any };
  v = w.villages.get(VILLAGE);
  if (!v) skip(`no village ${VILLAGE}`);
  else if (typeof w.appetiteOf !== 'function' || typeof w.mayClaim !== 'function') skip('needs mcWorld.ts appetiteOf and mayClaim (spec 2.5)');
  else {
    const names = ['Mayor', 'Worker1', 'Worker2', 'Worker3'];
    const menuOf = (name: string) => {
      const a = w.agents.get(name.toLowerCase());
      mute();
      try {
        return w.choices(a);
      } finally {
        unmute();
      }
    };
    const kinds = (m: Any) => (m?.options ?? []).map((o: Any) => `${o.kind}:${o.id}`);
    const food = (m: Any) => (m?.options ?? []).every((o: Any) => AP.isFoodKind(o.kind, o));
    // Hungry, peckish and fed, storage with bread
    ({ w, v } = fresh({ bread: 12, wheat: 4, cobblestone: 64, birch_log: 20 }, { Mayor: 18, Worker1: 4, Worker2: 10, Worker3: 18 }, names));
    const mh = menuOf('Worker1'), mp = menuOf('Worker2'), mf = menuOf('Worker3');
    say(`  hungry Worker1: ${kinds(mh).join(', ') || 'nothing'}`);
    say(`  peckish Worker2: ${kinds(mp).join(', ') || 'nothing'}`);
    say(`  fed Worker3: ${kinds(mf).join(', ') || 'nothing'}`);
    check(food(mh) && (mh?.options ?? []).some((o: Any) => o.kind === 'eat'), 'the hungry member\'s menu: only food work, eating on it');
    check(mp?.options?.[0]?.kind === 'eat', `the peckish member eats first (${mp?.options?.[0]?.id ?? 'nothing'})`);
    check(!(mf?.options ?? []).some((o: Any) => o.kind === 'eat'), 'no eating on a fed member\'s menu');
    // Model mode: the hungry member's other work guarded as hungry
    w.agents.get('worker1').memory.choose = 'model';
    const mm = menuOf('Worker1');
    const guarded = (mm?.guarded ?? []).filter((g: Any) => /hungry/.test(g.why ?? ''));
    say(`  hungry Worker1, model mode: ${kinds(mm).join(', ') || 'nothing'}; guarded as hungry ${guarded.length}`);
    check(food(mm), 'model mode: only food work on the hungry member\'s menu');
    // Storage without food: no eating, the hungry member's menu still only food work
    ({ w, v } = fresh({ wheat: 4, cobblestone: 64, birch_log: 20 }, { Mayor: 18, Worker1: 4, Worker2: 10, Worker3: 18 }, names));
    const mn = menuOf('Worker1');
    check(food(mn) && !(mn?.options ?? []).some((o: Any) => o.kind === 'eat'), `no food in storage: no eating, only food work (${kinds(mn).join(', ') || 'nothing'})`);
    // H2: a hungry first member does not end the sweep for those after it
    const s2 = await sweep(w);
    say(`  sweep, hungry Worker1 first, no food: asked ${s2.asked.join(', ') || 'nobody'}${s2.error ? `; threw ${s2.error}` : ''}`);
    check(!s2.error && ['Worker2', 'Worker3'].every((n) => s2.asked.includes(n)), 'H2: the members after a hungry one are asked');
    // M2: a peckish member in model mode eats with no model call
    ({ w, v } = fresh({ bread: 12, wheat: 4 }, { Mayor: 18, Worker1: 18, Worker2: 10, Worker3: 18 }, names));
    w.agents.get('worker2').memory.choose = 'model';
    const m0 = modelCalls;
    const m2 = await sweep(w);
    const ate = ([...w.chores.values()] as Any[]).find((c) => c.agent === 'Worker2');
    say(`  sweep, peckish Worker2 in model mode: chores ${([...w.chores.values()] as Any[]).map((c) => `${c.agent}:${c.key}`).join(', ') || 'none'}; model calls ${modelCalls - m0}${m2.error ? `; threw ${m2.error}` : ''}`);
    check(!m2.error && !!ate && /^eat/.test(ate.key) && modelCalls === m0, 'M2: the peckish member eats, no model call');
    // The fixes review (s30): claims and meals against what storage really offers
    const plantT = { title: 'Plant the farm: 16 wheat', detail: 'tend_farm layout=2 (lay the farm\'s water, ...)' };
    const buildT = { title: 'Build plains_small_house_1', detail: 'build_design design=plains_small_house_1 x=1 z=2' };
    const ag = (n: string) => w.agents.get(n.toLowerCase());
    ({ w, v } = fresh({ bread: 12, wheat: 4 }, { Mayor: 18, Worker1: 4, Worker2: 10, Worker3: 18 }, names));
    check(w.mayClaim(ag('Worker1'), plantT) === true && w.mayClaim(ag('Worker1'), buildT) === false,
      `lens 1 M2: a hungry member with bread stored may plant (${w.mayClaim(ag('Worker1'), plantT)}) but not build (${w.mayClaim(ag('Worker1'), buildT)})`);
    ({ w, v } = fresh({ cake: 1, wheat: 4 }, { Mayor: 18, Worker1: 18, Worker2: 10, Worker3: 18 }, names));
    const mc = menuOf('Worker2');
    check(w.mayClaim(ag('Worker2'), buildT) === true && !(mc?.options ?? []).some((o: Any) => o.kind === 'eat'),
      `lens 1 L1: a peckish member with only a cake stored may build (${w.mayClaim(ag('Worker2'), buildT)}) and gets no meal (${kinds(mc).filter((k: string) => k.startsWith('eat')).join(', ') || 'none'})`);
    if (typeof AP.holdMeal !== 'function') skip('lens 1 M1 needs appetite.ts holdMeal');
    else {
      ({ w, v } = fresh({ bread: 1, wheat: 4 }, { Mayor: 18, Worker1: 18, Worker2: 10, Worker3: 10 }, names));
      const before = kinds(menuOf('Worker2')).some((k: string) => k.startsWith('eat'));
      AP.holdMeal(v.name, 'Worker3', { item: 'bread', n: 1 });
      const held = menuOf('Worker2');
      const claim = w.mayClaim(ag('Worker2'), buildT);
      AP.releaseMeal(v.name, 'Worker3');
      check(before && !(held?.options ?? []).some((o: Any) => o.kind === 'eat') && claim === true,
        `lens 1 M1: the last bread held for Worker3's meal: Worker2's meal ${before ? 'offered before' : 'NOT offered before'}, then ${(held?.options ?? []).some((o: Any) => o.kind === 'eat') ? 'still offered' : 'not offered'}; claim ${claim}`);
    }
    if (typeof MB?.seedsForFields !== 'function') skip('lens 2 H1 needs mcBuild.ts seedsForFields');
    else {
      const sv: Any = { layouts: [{ farm: { sow: Array.from({ length: 16 }, (_, i) => [i, 0]), planted: 8 } }, { farm: { sow: Array.from({ length: 16 }, (_, i) => [i, 1]), planted: 0 } }],
        tasks: [{ detail: 'tend_farm layout=1 (lay ...)', status: 'open' }, { detail: 'tend_farm layout=2 (lay ...)', status: 'done' }] };
      const open = MB.seedsForFields(sv);
      sv.tasks[0].status = 'failed';
      check(open === 8 && MB.seedsForFields(sv) === 0, `lens 2 H1: seeds kept for an open planting 8 of 16 sown: ${open} (8), none once it ended: ${MB.seedsForFields(sv)}`);
    }
    // H1: growing, a peckish worker first in the order is not held back for growth tasks it may not claim
    if (!nbSite || !L?.postLayout) skip('H1 needs part 2\'s site');
    else {
      const wg = world();
      const vg = wg.villages.get(VILLAGE);
      const lib = wg.vanillaLibrary?.(vg.vanillaBiome ?? 'plains')?.houses ?? null;
      const cp = structuredClone(vg);
      for (const p of G.pickHouses(cp, nbPicks.length, lib)) if (!vg.designs[p]) vg.designs[p] = structuredClone(cp.designs[p]);
      const from = wg.villages.nextId as number;
      const ids = new Set(vg.tasks.map((t: Any) => t.id));
      mute();
      try {
        L.postLayout(wg, vg, 'Worker1', nbSite, nbPicks, true, undefined, { poster: 'grow', neighbourhood: true, farm: true, slots: 2 });
      } finally {
        unmute();
      }
      const fresh = vg.tasks.filter((t: Any) => !ids.has(t.id));
      const rec = vg.layouts[vg.layouts.length - 1];
      vg.complete = true;
      vg.growth = {
        active: { k: 1, layout: vg.layouts.length, from, at: clock, by: 'Worker1', plot: { x1: rec.x1, z1: rec.z1, x2: rec.x2, z2: rec.z2 }, houses: nbPicks,
                  builds: fresh.filter((t: Any) => /^Build /.test(t.title)).map((t: Any) => t.id), members: 25, before: G.housesOf(vg), changed: clock, sig: '' },
        past: [],
      };
      const k = (wg.villages.claimable(vg) as Any[]).filter((t) => G.isGrowTask(vg, t)).length;
      const crew = ['Mayor', ...Array.from({ length: Math.min(k, 3) + 2 }, (_, i) => `Worker${i + 1}`)];
      clock = NOW + 120000;
      members(wg, vg, crew);
      stock(vg, { bread: 12, wheat: 4 });
      mute();
      const order: string[] = (wg.idleMembers(vg, clock) as Any[]).map((a) => a.name);
      unmute();
      const first = order.find((n) => n !== 'Mayor')!;
      appetite(vg, Object.fromEntries(crew.map((n) => [n, n === first ? 10 : 18])));
      const sh = await sweep(wg);
      const chore = ([...wg.chores.values()] as Any[]).find((c) => c.agent === first);
      say(`  growing, ${k} growth tasks claimable, peckish ${first} first: asked ${sh.asked.join(', ') || 'nobody'}; ${first}'s chore ${chore?.key ?? 'none'}${sh.error ? `; threw ${sh.error}` : ''}`);
      check(!sh.error && !!chore && /^eat/.test(chore.key), `H1: the peckish ${first} is given eat, not held for growth work`);
      clock = NOW;
    }
  }
}

fs.rmSync(SCRATCH, { recursive: true, force: true });
say(`food_check: ${fails} failures, ${skips} skipped`);
process.exit(fails ? 1 : skips ? 3 : 0);
