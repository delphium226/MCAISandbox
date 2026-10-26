/**
 * The monument with the stonecutter (#162, MC_MONUMENT_DETAIL; monument.ts, cutter.ts, the cut plan) checked offline,
 * no server:
 * - a cathedral begun with the flag keeps `detail` on its record and is drawn with the detail palette without its
 *   furnishing (eight stages): chiselled bricks, polished andesite and diorite kept (not stone), windows plain without
 *   glazing; a castle never gets `detail`; a record without it is drawn as before;
 * - Notre-Dame and Chartres at 1:4 run through the yard as members move it: gather what stageWantsPlanned asks (the
 *   quarried stones among it, gathered as they lie), the kiln's smelts (kilnWants), the carver's loads (cutWants,
 *   cutLoad), and each job jobReady offers built (jobBuiltPlanned): every job built; a job is never offered while its
 *   pieces are uncut (and it is held back for that at least once: the carver's work is real); the loads counted.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/cutter_monument.mts
 */
import minecraftData from 'minecraft-data';

process.env.MC_MONUMENT = 'on';
process.env.MC_KILN = 'on';
process.env.MC_MONUMENT_PALETTE = 'full';
process.env.MC_MONUMENT_DETAIL = 'on';
process.env.MC_MONUMENT_SCALE = '0.25';
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const mon = await import('../../server/src/monument');
const cutter = await import('../../server/src/cutter');
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
const mats = new Materials(reg, { cut: true });
const plan: import('../../server/src/monument').PlanOf = (bill, have) => mats.plan(bill, have);

ok(cutter.CUTTER.on, 'the flag read');
const castle = mon.newMonument('oak', 0, 'castle');
ok(!mon.m3(castle).detail, 'a castle has no detail');
const plain = mon.newMonument('oak', 0);
delete mon.m3(plain).detail;
const plainPlan = mon.monumentPlan(plain);
ok(!plainPlan.bill.chiseled_stone_bricks && plainPlan.bill.stone && plainPlan.stageNames.length === 8, 'a record without detail drawn as before');

for (const preset of ['notre_dame', 'chartres']) {
  const m = mon.newMonument('spruce', 0) as Monument;
  ok(mon.m3(m).detail === true, `${preset}: the record keeps detail`);
  m.preset = preset;
  m.state = 'building';
  m.site = { x1: 0, z1: 0, x2: 40, z2: 40, y: 70, rotate: 0, prepared: true };
  const c = mon.monumentPlan(m);
  ok(c.stageNames.length === 8, `${preset}: ${c.stageNames.length} stages (no furnishing yet)`);
  ok(c.bill.chiseled_stone_bricks > 0 && c.bill.polished_andesite > 0 && c.bill.polished_diorite > 0 && !c.bill.stone, `${preset}: the detail stones kept: ${JSON.stringify(c.bill)}`);
  ok(!Object.keys(c.bill).some((k) => /stained/.test(k)) && !c.bill.lantern, `${preset}: plain windows without glazing, no furnishing`);
  let loads = 0, built = 0, heldForCuts = 0;
  for (let round = 0; round < 2000 && mon.currentStage(m); round++) {
    for (const [n, q] of Object.entries(mon.stageWantsPlanned(m, plan))) m.yard[n] = (m.yard[n] ?? 0) + q;
    for (const [input, q] of Object.entries(mon.kilnWants(m, plan))) {
      m.yard[input] -= q;
      const out = input === 'sand' ? 'glass' : 'stone';
      m.yard[out] = (m.yard[out] ?? 0) + q;
    }
    // (a job held back only for its cutting: nothing to gather or smelt)
    for (const i of mon.openJobs(m)) {
      const p = plan(c.jobs[i].bill, m.yard);
      if (!Object.values(p.gather).some((q) => q > 0) && !p.fuel.smelts && cutter.needsCutting(p.steps as import('../../server/src/cutter').CutStep[])) {
        heldForCuts++;
        ok(!mon.jobReady(m, i, plan), `${preset}: job ${i} offered with its pieces uncut`);
      }
    }
    const load = cutter.cutLoad(cutter.cutWants(plan(mon.stageBill(m, mon.AHEAD), m.yard).steps as import('../../server/src/cutter').CutStep[], m.yard));
    if (load.length) { cutter.applyCuts(m.yard, load); loads++; }
    for (const i of mon.openJobs(m)) if (mon.jobReady(m, i, plan)) { mon.jobBuiltPlanned(m, i, plan, round); built++; }
  }
  ok(!mon.currentStage(m) && m.state === 'built', `${preset}: built (${m.done.length} of ${c.jobs.length} jobs, stage ${mon.currentStage(m)})`);
  ok(heldForCuts > 0, `${preset}: no job ever waited on the carver`);
  ok(loads >= 5 && loads <= 30, `${preset}: ${loads} carver loads`);
  console.log(`${preset} 1:4 detail: ${c.design.blocks} blocks, ${built} jobs built, ${loads} carver loads, ${heldForCuts} job-rounds held for cutting; yard left ${JSON.stringify(m.yard)}`);
}
console.log(failures ? `FAIL cutter_monument: ${failures} of ${checks}` : `OK cutter_monument: ${checks} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
