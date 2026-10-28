/**
 * The monument's dyes after test train 7 (MC_DYE_BED; F327: Notre-Dame 1:3 stalled at stage 7 on purple and red, the dye
 * bed's composter with no seeds to spare). Offline, on the stalled checkpoint's villages.json (no server):
 * - the composter takes what storage can spare beyond seeds and wheat: flowers past 32, saplings past 8 (never the bed's
 *   tall flowers); on the checkpoint's storage that is enough for bone meal by the dozen;
 * - a colour stood in (dyeStandIn) is plain glass from the first job the yard does not cover: the stage no longer wants
 *   its dye, the jobs built keep their blocks, the job's pane count stays the same;
 * - with every colour short stood in, stage 7 wants no dye at all.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/dye_stand_in.mts [villages.json] (sets its flags itself)
 */
import minecraftData from 'minecraft-data';
import { existsSync, readFileSync } from 'fs';

for (const [k, v] of Object.entries({ MC_MONUMENT: 'on', MC_KILN: 'on', MC_MONUMENT_PALETTE: 'full', MC_MONUMENT_DETAIL: 'on', MC_DEEP_STONE: 'on', MC_GLAZING: 'on', MC_DYE_BED: 'on', MC_QUARRY: 'on' })) process.env[k] = v;
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const mon = await import('../../server/src/monument');
const dye = await import('../../server/src/dyeBed');
type Monument = import('../../server/src/village').Monument;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// 1. The composter's spares
const spare = dye.compostable({ wheat_seeds: 22, wheat: 8, wildflowers: 188, birch_sapling: 28, lily_of_the_valley: 12, rose_bush: 40, pumpkin: 52, sugar_cane: 35 });
ok(JSON.stringify(spare) === JSON.stringify({ wildflowers: 156, birch_sapling: 20 }), `flowers past 32 and saplings past 8, never seeds kept, tall flowers or food (${JSON.stringify(spare)})`);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const bm = dye.compost({ level: 0 }, spare, rnd).boneMeal;
ok(bm >= 12, `the checkpoint's spares make bone meal by the dozen (${bm})`);
ok(dye.COMPOST_CHANCE.oak_sapling === 0.3 && dye.COMPOST_CHANCE.wildflowers === 0.65, 'the game\'s chances');

// 2. The stand-in on the stalled cathedral
const file = process.argv[2] ?? 'mc/testcheckpoints/t7_a_mon_stage7/villages.json';
if (!existsSync(file)) {
  console.log(`(no ${file}: the checkpoint part skipped)`);
} else {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const v = (Array.isArray(d.villages) ? d.villages : Object.values(d.villages ?? d) as any[]).find((x: any) => x.monument);
  const m = v.monument as Monument;
  const mats = new Materials(minecraftData('26.1'), { cut: true, dyes: true });
  const plan: import('../../server/src/monument').PlanOf = (b, h) => mats.plan(b, h);
  const before = mon.monumentPlan(m);
  const wants0 = mon.stageWantsPlanned(m, plan);
  ok(mon.currentStage(m) === 7 && wants0.purple_dye === 2, `the checkpoint stalls at stage 7 wanting 2 purple dye (${mon.currentStage(m)}, ${JSON.stringify(wants0)})`);
  const job = before.jobs.findIndex((j, i) => j.stage === 7 && !m.done.includes(i));
  const panes = (b: Record<string, number>) => Object.entries(b).filter(([k]) => /glass_pane$/.test(k)).reduce((t, [, q]) => t + q, 0);
  const purple0 = before.jobs[job].bill.purple_stained_glass_pane ?? 0, plain0 = before.jobs[job].bill.glass_pane ?? 0;
  ok(!mon.dyeStood(m, 'purple_dye'), 'purple not stood in before');
  const from = mon.dyeStandIn(m, 'purple_dye');
  ok(from === job, `purple stands in from the stage's job ${job} (${from})`);
  ok(mon.dyeStood(m, 'purple_dye'), 'purple stood in after');
  const after = mon.monumentPlan(m);
  ok(after !== before, 'a new plan');
  ok(!after.jobs[job].bill.purple_stained_glass_pane && after.jobs[job].bill.glass_pane === plain0 + purple0, `job ${job}: ${purple0} purple panes now plain (${after.jobs[job].bill.glass_pane})`);
  ok(panes(after.jobs[job].bill) === panes(before.jobs[job].bill), 'the same number of panes');
  ok(m.done.every((i) => JSON.stringify(after.jobs[i].bill) === JSON.stringify(before.jobs[i].bill)), 'the jobs built keep their bills');
  const wants1 = mon.stageWantsPlanned(m, plan);
  ok(!wants1.purple_dye, `no purple dye wanted (${JSON.stringify(wants1)})`);
  ok(Object.keys(wants1).every((k) => !/_dye$/.test(k)), 'stage 7 wants no dye left');
  // (a yard that covers a job: the stand-in starts after it)
  const m2 = JSON.parse(JSON.stringify({ ...m, standIns: {}, standInFrom: {} })) as Monument;
  m2.yard.red_dye = 9;
  ok(mon.dyeStandIn(m2, 'red_dye') > job, 'a yard with enough red keeps the stage\'s red panes');
  // (every colour of the windows stood in: the cathedral still has all its cells, and the rest of the jobs no dye)
  const m3 = JSON.parse(JSON.stringify({ ...m, standIns: {}, standInFrom: {}, done: [], yard: {} })) as Monument;
  for (const c of Object.keys(m.colours ?? {})) mon.dyeStandIn(m3, `${c}_dye`);
  const all = mon.monumentPlan(m3);
  { const left = [...new Set(all.jobs.flatMap((j) => Object.keys(j.bill).filter((k) => /stained_glass/.test(k))))]; ok(!left.length, `every colour stood in: no stained glass anywhere (${left.join(", ")})`); }
  ok(all.jobs.reduce((t, j) => t + j.blocks, 0) === before.jobs.reduce((t, j) => t + j.blocks, 0), 'the same blocks');
  // (the furnishing's lanterns left out when no iron is to be had: only the furnishing's job changes)
  const m4 = JSON.parse(JSON.stringify(m)) as Monument & { furnish?: Record<string, boolean> };
  if (m4.furnish?.lanterns) {
    const a = mon.monumentPlan(m4);
    m4.furnish.lanterns = false;
    const b = mon.monumentPlan(m4);
    const changed = a.jobs.map((j, i) => (JSON.stringify(j.bill) !== JSON.stringify(b.jobs[i]?.bill) ? i : -1)).filter((i) => i >= 0);
    const fj = a.jobs.length - 1;
    ok(a.jobs.length === b.jobs.length && changed.length === 1 && changed[0] === fj && a.jobs[fj].stage === mon.furnishStage(m4), `lanterns out: only the furnishing's job ${fj} changes (${changed.join(',')})`);
    ok(!b.jobs[fj].bill.lantern && !b.jobs[fj].bill.iron_chain && b.jobs[fj].bill.bell === 1, 'no lantern or chain left, the bell kept');
    m4.furnish.banners = false;
    const c = mon.monumentPlan(m4);
    ok(c.jobs.length === a.jobs.length && Object.keys(c.jobs[fj].bill).every((k) => !/banner/.test(k)) && c.jobs[fj].bill.bell === 1, `banners out too: the furnishing's job keeps only the bell (${JSON.stringify(c.jobs[fj].bill)})`);
  }
  // (the re-furnish, the user's 10-28: lanterns and banners left out, the furnishing's job built, then iron in storage)
  if (m.furnish && (m as any).site) {
    const { refurnishReady } = await import('../../server/src/furnish');
    const m5 = JSON.parse(JSON.stringify({ ...m, standIns: { ...(m as any).standIns, blue_wall_banner: 'white_wall_banner' } })) as Monument;
    mon.furnishLeaveOut(m5, 'lanterns');
    mon.furnishLeaveOut(m5, 'banners');
    const p0 = mon.monumentPlan(m5);
    m5.done = p0.jobs.map((_, i) => i);
    ok(JSON.stringify((m5 as any).leftOut) === '["lanterns","banners"]' && !(m5 as any).furnish.lanterns, 'left out and recorded');
    const later = Date.now() + (mon.REFURNISH_WAIT_MIN + 1) * 60000;
    ok(!Object.keys(mon.leftOutItems(m5, 'lanterns')).length, 'nothing to bring back within the wait after leaving out');
    const items = mon.leftOutItems(m5, 'lanterns', later);
    ok(items.lantern > 0 && items.iron_chain > 0 && Object.keys(items).length === 2, `the lanterns' pieces (${JSON.stringify(items)})`);
    ok(!refurnishReady('lanterns', { torch: 64 }, items), 'not back with no iron');
    ok(refurnishReady('lanterns', { iron_ingot: 64 }, items), 'back with 64 ingots in storage');
    ok(refurnishReady('lanterns', { iron_ingot: 98, iron_nugget: 1, torch: 58 }, items), 'back with D4\'s storage (one nugget, counted once)');
    ok(!refurnishReady('lanterns', { iron_ingot: 20 }, items), 'not back with too few ingots');
    ok(!refurnishReady('banners', { white_wool: 99 }, mon.leftOutItems(m5, 'banners', later)) && refurnishReady('banners', { shears: 1 }, mon.leftOutItems(m5, 'banners', later)), 'banners back with shears');
    const n = mon.refurnishOn(m5, 'lanterns');
    const p1 = mon.monumentPlan(m5), rj = p1.jobs[p1.jobs.length - 1];
    ok(n === items.lantern + items.iron_chain && rj.refurnish === 'lanterns' && rj.cells?.length === n, `the lanterns back as a job of their ${n} cells`);
    ok(JSON.stringify(rj.bill) === JSON.stringify({ lantern: items.lantern, iron_chain: items.iron_chain }), `its bill only lanterns and chains (${JSON.stringify(rj.bill)})`);
    ok(p1.jobs.length === p0.jobs.length + 1 && !m5.done.includes(rj.index) && mon.currentStage(m5) === mon.furnishStage(m5), 'the furnishing stage open again on that job');
    const t = mon.jobTargets(m5, rj.index, (b) => b);
    ok(t.length === n && t.every((q) => /^(lantern|iron_chain)/.test(q.block)), 'its targets are the lanterns and chains only (no bell)');
    ok(mon.refurnishOn(m5, 'lanterns') === 0 && JSON.stringify((m5 as any).leftOut) === '["banners"]', 'once only; banners still out');
    // (left out again before its job is built: the job goes, and it may come back after the wait, listed once)
    const jobs1 = mon.monumentPlan(m5).jobs.length;
    mon.furnishLeaveOut(m5, 'lanterns');
    ok(mon.monumentPlan(m5).jobs.length === jobs1 - 1 && !(m5 as any).refurnish.includes('lanterns'), 'left out again: its unbuilt job goes');
    ok(mon.refurnishOn(m5, 'lanterns') > 0 && (m5 as any).refurnish.filter((k: string) => k === 'lanterns').length === 1, 'back again, listed once');
    // (back before the furnishing's job stood: just drawn again)
    const m6 = JSON.parse(JSON.stringify(m)) as Monument;
    mon.furnishLeaveOut(m6, 'lanterns');
    ok(mon.refurnishOn(m6, 'lanterns') === 0 && (m6 as any).furnish.lanterns && !(m6 as any).refurnish, 'back before the job stood: drawn again in its own job');
  }
  {
    const { furnishKindOf } = await import('../../server/src/furnish');
    ok(furnishKindOf('lantern') === 'lanterns' && furnishKindOf('iron_chain') === 'lanterns' && furnishKindOf('white_banner') === 'banners'
      && furnishKindOf('candle') === 'candles' && furnishKindOf('bell') === null, 'the furnishing kinds left out by item (never the bell)');
  }
}

console.log(`${failures ? 'FAIL' : 'OK'} dye_stand_in: ${checks - failures} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
