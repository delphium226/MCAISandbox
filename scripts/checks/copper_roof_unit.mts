/**
 * MC_COPPER_ROOF offline (#162 tier 3, chain B; gothicGen's copperRoof, monument.ts' copper plan and re-roof, the kiln's
 * raw copper, the carver's forged cuts; no server):
 * - the generator with copperRoof draws the same cells and jobs, the high roof and the flèche's base as cut copper (each
 *   the deepslate cell it replaces, copperOff), the low roof still deepslate; without it the cells exactly as before;
 * - Notre-Dame 1:3 (detail, deep) with the rung reached before it is begun: every job built through the yard as members
 *   move it (gathers, the kiln's smelts of cobblestone, sand and raw copper, the carver's loads with copper blocks forged
 *   from 9 ingots); the roof's bill in cut copper (~2.25 raw copper a cell), no re-roof;
 * - the same cathedral built without copper, then the rung reached: its roof's jobs listed for the re-roof, their old
 *   cells kept as deepslate on the plan, a job of copper cells each after the plan's own, the cathedral building again
 *   and finished once they stand; a re-roof's old blocks are its cells' deepslate;
 * - the stand-in when short: the old roof's block (deepslate, or the wood without deep), from the first job the copper
 *   held does not cover.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/copper_roof_unit.mts (sets its flags itself)
 */
import minecraftData from 'minecraft-data';

process.env.MC_MONUMENT = 'on';
process.env.MC_KILN = 'on';
process.env.MC_MONUMENT_PALETTE = 'full';
process.env.MC_MONUMENT_DETAIL = 'on';
process.env.MC_DEEP_STONE = 'on';
process.env.MC_COPPER_ROOF = 'test';
// (the monument's flags are on by default since 10-28: these cases are written with them off unless set above)
for (const k of ['MC_MONUMENT', 'MC_QUARRY', 'MC_KILN', 'MC_GLAZING', 'MC_MONUMENT_DETAIL', 'MC_DYE_BED', 'MC_MONUMENT_ROLES', 'MC_MONUMENT_NEWS', 'MC_LODGE', 'MC_DEEP_STONE', 'MC_GEODE_GUARD', 'MC_FURNISH_LANTERNS', 'MC_FURNISH_BANNERS', 'MC_FURNISH_CANDLES']) process.env[k] ??= 'off';
process.env.MC_MONUMENT_PALETTE ??= 'today';
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const gen = await import('../../server/src/gothicGen');
const mon = await import('../../server/src/monument');
const cutter = await import('../../server/src/cutter');
const { KILN_SMELTS } = await import('../../server/src/kiln');
type Monument = import('../../server/src/village').Monument;
type CutStep = import('../../server/src/cutter').CutStep;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};
const reg = minecraftData('26.1');
const mats = new Materials(reg, { cut: true });
const plan: import('../../server/src/monument').PlanOf = (bill, have) => mats.plan(bill, have);

ok(mon.COPPER_ROOF.on && mon.COPPER_ROOF.test, 'the flag read (test)');
ok(KILN_SMELTS.raw_copper === 'copper_ingot', 'the kiln smelts raw copper');

// 1. The generator
const P = gen.GOTHIC_PRESETS.notre_dame;
const off = gen.generateCathedral(P, 3, { detail: true }), on = gen.generateCathedral(P, 3, { detail: true, copperRoof: true });
const cellsOf = (c: typeof off) => {
  const m = new Map<string, string>();
  c.design.layers.forEach((l, y) => l.forEach((row, z) => [...row].forEach((ch, x) => ch !== '.' && m.set(`${x},${y},${z}`, c.design.palette[ch]))));
  return m;
};
const a = cellsOf(off), b = cellsOf(on);
ok(a.size === b.size && on.jobs.length === off.jobs.length, `same cells and jobs (${a.size}/${b.size}, ${off.jobs.length}/${on.jobs.length})`);
let cu = 0, bad = 0;
const cuStage: Record<number, number> = {};
for (const [k, blk] of b) {
  if (/^cut_copper/.test(blk)) {
    cu++;
    cuStage[on.cellStage.get(k)!] = (cuStage[on.cellStage.get(k)!] ?? 0) + 1;
    if (mon.copperOff(blk) !== a.get(k)) bad++;
  } else if (blk !== a.get(k)) bad++;
  if (on.cellJob.get(k) !== off.cellJob.get(k)) bad++;
}
ok(!bad, `${bad} cells differ other than deepslate -> copper`);
ok(cu >= 280 && cu <= 360, `${cu} copper cells at 1:3 (spec: 306 high roof + 19 flèche)`);
ok(Object.keys(cuStage).every((s) => s === '5' || s === '8'), `copper only in stages 5 and 8: ${JSON.stringify(cuStage)}`);
ok([...a.values()].some((x) => /^deepslate_tile/.test(x)) && [...b.values()].some((x) => /^deepslate_tile/.test(x)), 'the low roof still deepslate');
ok(JSON.stringify(gen.generateCathedral(P, 3, { detail: true }).bill) === JSON.stringify(off.bill), 'without copperRoof the bill as before');

// 2. A monument through its build: gathers, kiln (cobblestone, sand, raw copper), carver (forged copper), jobs
const yardRun = (m: Monument, label: string) => {
  let loads = 0, forged = 0, copperSmelts = 0;
  for (let round = 0; round < 4000 && mon.currentStage(m); round++) {
    for (const [n, q] of Object.entries(mon.stageWantsPlanned(m, plan))) m.yard[n] = (m.yard[n] ?? 0) + q;
    for (const [input, q] of Object.entries(mon.kilnWants(m, plan))) {
      m.yard[input] -= q;
      if (input === 'raw_copper') copperSmelts += q;
      const out = KILN_SMELTS[input];
      m.yard[out] = (m.yard[out] ?? 0) + q;
    }
    const load = cutter.cutLoad(cutter.cutWants(plan(mon.stageBill(m, mon.AHEAD), m.yard).steps as CutStep[], m.yard));
    for (const l of load) if (l.unit) {
      forged += l.runs / l.unit;
      ok(l.runs % l.unit === 0 && l.makes === (l.runs / l.unit) * 4, `${label}: a forged cut of whole blocks (${JSON.stringify(l)})`);
    }
    if (load.length) { cutter.applyCuts(m.yard, load); loads++; }
    for (const i of mon.openJobs(m)) if (mon.jobReady(m, i, plan)) mon.jobBuiltPlanned(m, i, plan, round);
  }
  return { loads, forged, copperSmelts };
};
const fresh = () => {
  const m = mon.newMonument('spruce', 0) as Monument;
  m.preset = 'notre_dame';
  m.scale = 3;
  m.state = 'building';
  m.site = { x1: 0, z1: 0, x2: 60, z2: 60, y: 70, rotate: 0, prepared: true };
  return m;
};
{
  const m = fresh();
  ok(mon.m3(m).detail && mon.m3(m).deep && !mon.m3(m).copper, 'a new record: detail and deep, copper not yet');
  const deepBill = mon.monumentPlan(m).bill;
  ok(mon.copperOn(m) === 0 && mon.m3(m).copper && !mon.m3(m).reroof!.length, 'the rung at the start: copper on, nothing to re-roof');
  const c = mon.monumentPlan(m);
  ok(c.bill.cut_copper_stairs > 0 && c.bill.cut_copper > 0 && (c.bill.deepslate_tile_stairs ?? 0) < deepBill.deepslate_tile_stairs, `the plan's roof in copper: ${c.bill.cut_copper_stairs} stairs, ${c.bill.cut_copper} cut, ${c.bill.deepslate_tile_stairs} deepslate stairs left (low roof)`);
  const raw = mats.plan({ cut_copper_stairs: c.bill.cut_copper_stairs, cut_copper: c.bill.cut_copper }, {}).gather.raw_copper ?? 0;
  ok(raw >= 2.2 * cu && raw <= 2.4 * cu, `${raw} raw copper for ${cu} cells`);
  const r = yardRun(m, 'copper');
  ok(!mon.currentStage(m) && m.state === 'built', `copper: built (${m.done.length} of ${c.jobs.length}, stage ${mon.currentStage(m)})`);
  ok(r.forged > 0 && r.copperSmelts >= raw * 0.95, `copper: ${r.forged} blocks forged, ${r.copperSmelts} raw copper smelted`);
  // jobTargets: a stage-5 job's targets include copper stairs
  const j5 = c.jobs.findIndex((j, i) => j.stage === 5 && (c.copperCells.get(i)?.length ?? 0) > 0);
  ok(mon.jobTargets(m, j5, (blk) => blk).some((t) => /^cut_copper_stairs\[/.test(t.block)), 'a roof job places cut copper stairs');
  console.log(`copper at the start: ${c.jobs.length} jobs, ${r.loads} carver loads, ${r.forged} blocks forged, ${r.copperSmelts} raw copper smelted; yard left ${JSON.stringify(Object.fromEntries(Object.entries(m.yard).filter(([n]) => /copper/.test(n))))}`);
}
{
  const m = fresh();
  const r0 = yardRun(m, 'deep');
  const c0 = mon.monumentPlan(m);
  ok(m.state === 'built' && !c0.bill.cut_copper_stairs, 'without the rung: built in deepslate');
  const jobs0 = c0.jobs.length, built0 = m.built;
  const cells = mon.copperOn(m);
  const c = mon.monumentPlan(m), re = mon.m3(m).reroof!;
  ok(cells === cu, `${cells} cells to re-roof (want ${cu})`);
  ok(re.length > 0 && re.every((i) => [5, 8].includes(c.jobs[i].stage)), `re-roof lists ${re.length} roof jobs`);
  ok(c.jobs.length === jobs0 + re.length && c.jobs.slice(jobs0).every((j, k) => j.reroof === re[k] && j.cells?.length === j.blocks), `${c.jobs.length - jobs0} re-roof jobs after the plan's ${jobs0}`);
  ok(m.state === 'building' && mon.currentStage(m) === 5, `building again at stage ${mon.currentStage(m)}`);
  // the old jobs keep their deepslate on the plan; the re-roof's targets are copper and only the copper cells
  const old = re[0], rj = jobs0;
  ok(mon.jobTargets(m, old, (blk) => blk).every((t) => !/^cut_copper/.test(t.block)), 'a re-roofed job keeps its deepslate on the plan');
  const tg = mon.jobTargets(m, rj, (blk) => blk);
  ok(tg.length === c.jobs[rj].blocks && tg.every((t) => /^cut_copper/.test(t.block)), `re-roof job ${rj}: ${tg.length} copper targets`);
  const back = mon.reroofReturns(m, rj);
  ok(Object.keys(back).every((n) => /^deepslate_tile/.test(n)) && Object.values(back).reduce((t, q) => t + q, 0) === c.jobs[rj].blocks, `its old blocks back: ${JSON.stringify(back)}`);
  ok(!Object.keys(mon.reroofReturns(m, 0)).length, 'no old blocks from a plan job');
  ok(mon.progressLine(m, 0, 1).includes('stage 5'), 'the progress line at stage 5');
  const r = yardRun(m, 'reroof');
  ok(m.state === 'built' && !mon.currentStage(m) && m.done.length === c.jobs.length, `re-roofed and finished (${m.done.length} of ${c.jobs.length})`);
  ok(r.copperSmelts > 0 && r.forged > 0, `the re-roof: ${r.copperSmelts} raw copper smelted, ${r.forged} blocks forged`);
  console.log(`re-roof: ${re.length} jobs (${cells} cells) after ${r0.loads} loads in deepslate; ${r.loads} more carver loads; built at ${built0} then ${m.built}`);
}

// 3. The stand-in when short, and its first job
{
  const m = fresh();
  mon.copperOn(m);
  ok(mon.copperStandIn(m, 'cut_copper_stairs') === 'deepslate_tile_stairs' && mon.copperStandIn(m, 'cut_copper') === 'deepslate_tiles', 'deep: copper stands in as deepslate');
  delete mon.m3(m).deep;
  ok(mon.copperStandIn(m, 'cut_copper_stairs') === 'spruce_stairs', 'without deep: as the wood');
  mon.m3(m).deep = true;
  const c = mon.monumentPlan(m);
  const first = c.jobs.findIndex((j) => (j.bill.cut_copper_stairs ?? 0) + (j.bill.cut_copper ?? 0) > 0);
  ok(mon.copperFrom(m, {}) === first, `nothing held: from the first copper job (${mon.copperFrom(m, {})}, ${first})`);
  ok(mon.copperFrom(m, { raw_copper: 9999 }) === c.jobs.length, 'plenty held: none stands in');
  const need = (c.jobs[first].bill.cut_copper_stairs ?? 0) + (c.jobs[first].bill.cut_copper ?? 0);
  ok(mon.copperFrom(m, { copper_block: Math.ceil(need / 4) }) > first, 'the first job covered by its blocks');
  mon.m3(m).standIns = { cut_copper_stairs: 'deepslate_tile_stairs', cut_copper: 'deepslate_tiles', cut_copper_slab: 'deepslate_tile_slab' };
  mon.m3(m).standInFrom = { cut_copper_stairs: first + 1, cut_copper: first + 1, cut_copper_slab: first + 1 };
  const s = mon.monumentPlan(m);
  ok((s.jobs[first].bill.cut_copper_stairs ?? 0) > 0 && !s.jobs.slice(first + 1).some((j) => j.bill.cut_copper_stairs), 'copper kept before the stand-in job, deepslate after');
}
// The forged cut: ingots into whole blocks, the cap kept to whole blocks
{
  const steps = mats.plan({ cut_copper_stairs: 40 }, { copper_ingot: 100 }).steps as CutStep[];
  const w = cutter.cutWants(steps, { copper_ingot: 100 });
  ok(w.length === 1 && w[0].input === 'copper_ingot' && w[0].runs === 90 && w[0].makes === 40 && w[0].unit === 9, `cutWants from ingots: ${JSON.stringify(w)}`);
  const l = cutter.cutLoad(w, 50);
  ok(l.length === 1 && l[0].runs === 45 && l[0].makes === 20, `cutLoad keeps whole blocks: ${JSON.stringify(l)}`);
  const y = { copper_ingot: 100 };
  cutter.applyCuts(y, l);
  ok(y.copper_ingot === 55 && (y as Record<string, number>).cut_copper_stairs === 20, `the yard after: ${JSON.stringify(y)}`);
  ok(JSON.stringify(cutter.cutWants(mats.plan({ stone_bricks: 10 }, { stone: 10 }).steps as CutStep[], { stone: 10 })) === '[{"item":"stone_bricks","input":"stone","runs":10,"makes":10}]', 'a stone cut as before');
}
console.log(failures ? `FAIL copper_roof_unit: ${failures} of ${checks}` : `OK copper_roof_unit: ${checks} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
