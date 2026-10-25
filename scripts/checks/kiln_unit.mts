/**
 * The cathedral's kiln and full palette (M2, #145; kiln.ts, monument.ts' planned yard) checked offline, no server:
 * - the full palette (fullBlock) as the village makes it, at 1:4 and 1:2: every block's raw materials gatherable here
 *   (cobblestone, logs, sand, flowers; no problems in the plan), its smelts and fuel reported; the glass colours from a
 *   flower census (stand-ins, none below the minimum);
 * - the furnaces' ledger: a load of one input at a time (64 a slot), its cook estimate by the clock and the game's speed,
 *   an unload, the load spread over a lane (inputs kept apart);
 * - the whole 1:4 cathedral run through the yard's planned ledger as the masons and gatherers move it (gather what
 *   stageWantsPlanned asks; load kilnWants into the furnaces; unload; craft the stage's bricks; build every job jobReady
 *   offers, jobBuiltPlanned taking its plan from the yard): every stage built, no job offered while its smelts are not
 *   done, the yard empty of the stage's goods at the end, no gathering asked for what the furnaces hold.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/kiln_unit.mts
 */
import minecraftData from 'minecraft-data';

process.env.MC_MONUMENT = 'on';
process.env.MC_KILN = 'on';
process.env.MC_GLAZING = 'on';
process.env.MC_MONUMENT_PALETTE = 'full';
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const mon = await import('../../server/src/monument');
const kiln = await import('../../server/src/kiln');
type Monument = import('../../server/src/village').Monument;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};
const reg = minecraftData('26.1');
const mats = new Materials(reg);
const plan: import('../../server/src/monument').PlanOf = (bill, have) => mats.plan(bill, have);
const colours = { blue: 'blue', red: 'red', yellow: 'yellow' };
const flowers = mon.dyeFlowers({ cornflower: 30, poppy: 20, rose_bush: 2, dandelion: 40, sunflower: 1 });
const record = (scale: number): Monument => ({ preset: 'notre_dame', scale, palette: 'full', wood: 'spruce', at: 0, state: 'building', done: [], yard: {}, stages: [], colours, flowers,
  site: { x1: 0, z1: 0, x2: 40, z2: 40, y: 70, rotate: 0, prepared: true } });

// The palette and its plan
ok(mon.fullBlock('polished_andesite', 'oak') === 'stone' && mon.fullBlock('tuff_bricks', 'oak') === 'stone_bricks', 'andesite and tuff stand-ins');
ok(mon.fullBlock('deepslate_tile_stairs[facing=east]', 'oak') === 'oak_stairs[facing=east]', 'the roof in the village wood');
ok(mon.fullBlock('blue_stained_glass_pane[east=true]', 'oak', { blue: 'light_blue' }) === 'light_blue_stained_glass_pane[east=true]', 'a stained pane in its stand-in colour');
ok(mon.fullBlock('red_stained_glass_pane', 'oak', {}) === 'glass_pane', 'a pane with no colour is plain');
ok(mon.fullBlock('stone_brick_stairs[half=top]', 'oak') === 'stone_brick_stairs[half=top]', 'stone bricks kept');
const gc = mon.glassColours({ cornflower: 3, blue_orchid: 10, poppy: 12, wildflowers: 24 });
ok(gc.blue === 'light_blue' && gc.red === 'red' && gc.yellow === 'yellow', `the colours from a census: ${JSON.stringify(gc)}`);
ok(!Object.keys(mon.glassColours({ cornflower: 2 })).length, 'no colour below the minimum');
ok(flowers.red === 'poppy' && flowers.yellow === 'dandelion' && flowers.blue === 'cornflower', `the dye flowers from a census: ${JSON.stringify(flowers)}`);
const EASY = /^(cobblestone|any:cobblestone|any:logs|[a-z_]+_log|sand|cornflower|poppy|dandelion|blue_orchid|wildflowers)$/;
for (const scale of [4, 2]) {
  const c = mon.monumentPlan(record(scale));
  const p = mats.plan(c.bill, {});
  ok(!p.problems.length, `1:${scale}: problems ${p.problems.join('; ')}`);
  // (what the stage wants gathered at the start of each stage, with the census' flowers)
  const odd = [...new Set(c.jobs.map((j) => j.stage))].flatMap((st) => {
    const m = record(scale);
    m.done = c.jobs.map((j, i) => (j.stage < st ? i : -1)).filter((i) => i >= 0);
    return Object.keys(mon.stageWantsPlanned(m, plan)).filter((n) => !EASY.test(n));
  });
  ok(!odd.length, `1:${scale}: gathers ${odd.join(', ')}`);
  ok(Object.keys(c.bill).every((n) => !/deepslate|tuff|andesite/.test(n)), `1:${scale}: a block with no source: ${Object.keys(c.bill).join(', ')}`);
  ok(c.bill.stone_bricks > 0 && (c.bill.blue_stained_glass_pane ?? 0) > 0, `1:${scale}: bricks and stained panes in the bill`);
  const raw = Object.entries(p.gather).map(([n, q]) => `${q} ${n}`).join(', ');
  console.log(`1:${scale} full: ${c.design.blocks} blocks; gather ${raw}; ${p.fuel.smelts} smelts (fuel ${p.fuel.planks} planks or ${Math.ceil(p.fuel.smelts / 8)} coal); kiln of ${kiln.kilnSize(p.fuel.smelts)}`);
}

// #152: fuel from any logs and coal when they run short; the kiln's rows and lanes; 1:2's pace against the quarry
{
  const f1 = kiln.fuelFor({ birch_log: 10, oak_log: 50, coal: 20 }, 300, 'birch');
  const logs = Object.values(f1.logs).reduce((t, n) => t + n, 0);
  ok(f1.coal === 'coal' && f1.coalN === 4 && (f1.logs.birch_log ?? 0) === 10 && logs * 4 >= f1.planks, `fuel: 4 spare coal, the monument's birch first, oak for the rest (${JSON.stringify(f1)})`);
  ok((f1.coalN * 8 + f1.planks * 1.5) >= 300 * 1.15, 'fuel covers the load with its margin');
  const f2 = kiln.fuelFor({ birch_log: 2, coal: 20 }, 300, 'birch');
  ok(f2.coalN === 20, `with logs short, coal down to none (${JSON.stringify(f2)})`);
  for (const k of [8, 10, 16, 31, 40]) {
    const { w, d } = kiln.kilnStrip(k);
    const cells = kiln.kilnCells({ x1: 0, z1: 0, x2: w - 1, z2: d - 1 }, 70, k);
    const keys = new Set(cells.map((c) => `${c.x},${c.z}`));
    ok(keys.size === k && cells.every((c) => c.x >= 1 && c.x <= w - 2 && c.z >= 1 && c.z <= d - 2 && c.z % 2 === 1), `kiln of ${k}: ${w}x${d}, cells inside with a walk on each side`);
    const lanes = kiln.kilnLanes({ furnaces: cells as never });
    ok(lanes === Math.max(2, Math.ceil(k / 4)), `kiln of ${k}: ${lanes} lanes`);
  }
  // (Mon2e's rates at 2x: 20.7 cobblestone a member-minute digging, ~9 members on the quarry; 8.1 smelts a furnace-minute)
  const c = mon.monumentPlan(record(2));
  const p = mats.plan(c.bill, {});
  const k = kiln.kilnSize(p.fuel.smelts);
  const quarryMin = (p.gather.cobblestone ?? p.gather['any:cobblestone'] ?? 0) / (9 * 20.7), kilnMin = p.fuel.smelts / (k * 8.1);
  ok(kilnMin <= quarryMin, `1:2: the kiln of ${k} smelts in ${kilnMin.toFixed(0)} min, the quarry gives in ${quarryMin.toFixed(0)} (2x)`);
  console.log(`1:2 pace (2x, Mon2e's rates): quarry ${quarryMin.toFixed(1)} min, kiln of ${k} furnaces ${kilnMin.toFixed(1)} min, ${kiln.kilnLanes({ furnaces: Array(k) })} lanes`);
}

// The furnaces' ledger
{
  const f: import('../../server/src/kiln').KilnFurnace = { x: 0, y: 0, z: 0, n: 0, until: 0 };
  kiln.loadFurnace(f, 'cobblestone', 40, 0, 2);
  ok(f.n === 40 && f.until === 40 * 5000, `40 at 2x end at 200 s (${f.until})`);
  ok(kiln.cookedBy(f, 50000, 2) === 10, `10 cooked by 50 s (${kiln.cookedBy(f, 50000, 2)})`);
  let threw = false;
  try { kiln.loadFurnace(f, 'sand', 1, 0); } catch { threw = true; }
  ok(threw, 'a furnace holding cobblestone refuses sand');
  kiln.unloadFurnace(f, 40);
  ok(!f.n && !f.input && !f.until, 'emptied, it forgets its input');
  const fs = Array.from({ length: 4 }, (_, i) => ({ x: i, y: 0, z: 0, n: 0, until: 0 } as import('../../server/src/kiln').KilnFurnace));
  kiln.loadFurnace(fs[1], 'sand', 30, 0);
  const sp = kiln.spreadLoad(fs, { cobblestone: 150, sand: 50 });
  const by = (input: string) => sp.filter((p) => p.input === input).reduce((t, p) => t + p.n, 0);
  ok(by('sand') === 50, `all the sand loaded (${JSON.stringify(sp.map((p) => [p.f.x, p.input, p.n]))})`);
  const spread = kiln.spreadLoad(fs.map((f) => ({ ...f, n: 0, input: undefined, until: 0 })), { cobblestone: 133 });
  ok(spread.length === 4 && spread.every((p) => p.n >= 33 && p.n <= 34), `133 cobblestone spread evenly over 4 empty furnaces (${spread.map((p) => p.n).join(', ')})`);
  ok(sp.every((p) => p.n <= kiln.SLOT) && fs.every((f) => sp.filter((p) => p.f === f).reduce((t, p) => t + p.n, f.n) <= kiln.SLOT), 'no furnace past 64');
  ok(fs.every((f) => new Set([f.n ? f.input : undefined, ...sp.filter((p) => p.f === f).map((p) => p.input)].filter(Boolean)).size <= 1), 'one input a furnace');
  ok(by('cobblestone') === 128, `128 cobblestone in the other furnaces (${by('cobblestone')})`);
  const left2 = Array.from({ length: 4 }, (_, i) => ({ x: i, y: 0, z: 0, n: 0, until: 0 } as import('../../server/src/kiln').KilnFurnace));
  for (const f of left2) kiln.loadFurnace(f, 'cobblestone', 2, 0, 2);
  ok(!kiln.spreadLoad(left2, { sand: 42 }).length, 'furnaces each on 2 cobblestone take no sand');
  const sv = kiln.spreadLoad(kiln.loadView(left2, 60000, 2), { sand: 42 });
  ok(sv.reduce((t, p) => t + p.n, 0) === 42, `once their 2 are cooked they take the sand (${sv.map((p) => p.n).join(', ')})`);
  ok(kiln.laneFurnaces({ furnaces: fs } as never, 1, 2).length === 2 && kiln.laneFurnaces({ furnaces: fs } as never, 2, 2)[0] === fs[1], 'lanes take every second furnace');
}

// The 1:4 cathedral through the planned ledger
{
  const m = record(4);
  m.kiln = kiln.newKiln({ x1: 0, z1: 50, x2: 9, z2: 52 }, 70, 8, 'T', 0);
  m.kiln.state = 'ready';
  const c = mon.monumentPlan(m);
  let now = 0, gathered: Record<string, number> = {}, smelted = 0, earlyJob = 0, rounds = 0, heldAsked = 0;
  while (mon.currentStage(m) && rounds++ < 2000) {
    // Gatherers bring what is wanted (never what the furnaces hold)
    const wants = mon.stageWantsPlanned(m, plan);
    const inKiln = kiln.kilnHolds(m.kiln);
    // (what the furnaces hold is wanted less: the want without them, less their stone)
    const noKiln = mats.plan(mon.stageBill(m, mon.AHEAD), m.yard).gather['any:cobblestone'] ?? mats.plan(mon.stageBill(m, mon.AHEAD), m.yard).gather.cobblestone ?? 0;
    if (inKiln.stone && (wants.cobblestone ?? 0) > Math.max(0, noKiln - inKiln.stone)) heldAsked++;
    for (const [n, q] of Object.entries(wants)) {
      const t = Math.min(q, 64);
      m.yard[n] = (m.yard[n] ?? 0) + t;
      gathered[n] = (gathered[n] ?? 0) + t;
    }
    // Masons: unload what is cooked, load what the stage wants smelted
    now += 60000;
    for (const f of m.kiln.furnaces) {
      const done = kiln.cookedBy(f, now, 2);
      if (done && f.input) {
        const out = kiln.KILN_SMELTS[f.input];
        m.yard[out] = (m.yard[out] ?? 0) + done;
        smelted += done;
        kiln.unloadFurnace(f, done);
      }
    }
    const kw = mon.kilnWants(m, plan);
    let fuel = 0;
    for (const p of kiln.spreadLoad(m.kiln.furnaces, kw)) {
      kiln.loadFurnace(p.f, p.input, p.n, now, 2);
      m.yard[p.input] -= p.n;
      fuel += p.n;
    }
    // (its fuel: planks from the yard's logs, as tend_kiln saws them)
    const logs = Math.min(m.yard.spruce_log ?? 0, Math.ceil(fuel / 1.5 / 4));
    if (logs) m.yard.spruce_log -= logs;
    // Bricks crafted from the stone the stage wants as bricks
    const step = plan(mon.stageBill(m), m.yard).steps.find((s) => s.do === 'craft' && s.item === 'stone_bricks');
    const b = Math.min(Math.floor((m.yard.stone ?? 0) / 4) * 4, (step?.runs ?? 0) * 4);
    if (b > 0) { m.yard.stone -= b; m.yard.stone_bricks = (m.yard.stone_bricks ?? 0) + b; }
    // Jobs the yard is ready for
    for (const i of mon.openJobs(m)) {
      if (!mon.jobReady(m, i, plan)) continue;
      const p = plan(c.jobs[i].bill, m.yard);
      if (p.fuel.smelts) earlyJob++;
      mon.jobBuiltPlanned(m, i, plan, now);
    }
  }
  ok(m.state === 'built' && m.done.length === c.jobs.length, `the 1:4 cathedral built through the ledger (${m.done.length} of ${c.jobs.length} jobs, ${rounds} rounds)`);
  ok(!earlyJob, `${earlyJob} jobs offered with smelts left`);
  ok(!heldAsked, `${heldAsked} rounds asked for cobblestone the furnaces hold`);
  ok(Object.values(m.yard).every((q) => q >= 0), `the yard never below 0 (${JSON.stringify(m.yard)})`);
  const left = Object.entries(m.yard).filter(([, q]) => q > 64);
  ok(!left.length, `the yard ends with ${JSON.stringify(left)} over a trip`);
  console.log(`1:4 through the ledger: ${rounds} rounds, gathered ${Object.entries(gathered).map(([n, q]) => `${q} ${n}`).join(', ')}; smelted ${smelted}; yard left ${JSON.stringify(m.yard)}`);
}

console.log(`${failures ? 'FAIL' : 'OK'} kiln_unit: ${checks - failures} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
