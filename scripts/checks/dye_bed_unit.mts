/**
 * The monument's dyes (#162, chain B; dyeBed.ts, Materials' `dyes`, the detail cathedral's colours) checked offline, no
 * server:
 * - the dye recipes read from the registry (tall flowers give 2, mixes, green from cactus);
 * - the colours iron_age_g1's land makes (the measured census within 144: tall flowers too; storage's lapis; the
 *   composter's bone meal; the merchant's ink) against today's census (within 80, no tall flowers, no composter): the
 *   first gives red, pink, magenta, blue and their mixes, the second little more than yellow and white;
 * - the composter's chances (7 levels, seeds 30%) and what storage can spare; the bed's kinds and cells;
 * - a detail cathedral at 1:4 with every colour G1 makes, planned with `cut` and `dyes`: its stage wants name dyes, never
 *   a flower, and with the dyer filling them it is built through the yard (gather, kiln, carver, dyer, jobs).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/dye_bed_unit.mts
 */
import minecraftData from 'minecraft-data';

process.env.MC_MONUMENT = 'on';
process.env.MC_KILN = 'on';
process.env.MC_GLAZING = 'on';
process.env.MC_MONUMENT_PALETTE = 'full';
process.env.MC_MONUMENT_DETAIL = 'on';
process.env.MC_DYE_BED = 'on';
process.env.MC_MONUMENT_SCALE = '0.25';
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const mon = await import('../../server/src/monument');
const cutter = await import('../../server/src/cutter');
const dye = await import('../../server/src/dyeBed');
const { DETAIL_COLOURS } = await import('../../server/src/gothicGen');
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

const rec = dye.dyeRecipes(reg);
ok(rec.red_dye?.some((r) => r.length === 1 && r[0] === 'rose_bush'), 'red from a rose bush');
ok(rec.orange_dye?.some((r) => r.includes('red_dye') && r.includes('yellow_dye')), 'orange mixed');
ok(rec.green_dye?.some((r) => r[0] === 'cactus'), 'green from cactus');

// G1's land (runs/2026-10-26/tier2/spec.md section 1) and its stores at the end of the iron age
const g1Wide = { wildflowers: 2885, rose_bush: 68, peony: 66, lilac: 52, lily_of_the_valley: 36, poppy: 2, dandelion: 1 };
const g1Near = { wildflowers: 910, lily_of_the_valley: 19, lilac: 2 };
const wide = dye.makeableColours(rec, { census: g1Wide, stores: { lapis_lazuli: 54 }, composter: true, merchant: true });
const near = dye.makeableColours(rec, { census: g1Near, stores: {}, composter: false, merchant: false });
for (const c of ['red', 'pink', 'magenta', 'yellow', 'white', 'blue', 'orange', 'purple', 'light_blue', 'light_gray', 'gray', 'black'])
  ok(wide.includes(c), `G1 with the dye census makes ${c} (${wide.join(', ')})`);
for (const c of ['green', 'lime', 'cyan', 'brown']) ok(!wide.includes(c), `G1 makes no ${c}`);
ok(near.length <= 3 && near.includes('yellow') && near.includes('white') && !near.includes('red'), `today's census: ${near.join(', ')}`);
const windows = dye.windowColours(DETAIL_COLOURS, wide);
ok(windows.length >= 8 && windows[0] === 'blue', `the windows' colours: ${windows.join(', ')}`);
console.log(`colours: G1 with the dye census ${wide.length} (${wide.join(', ')}); today's census ${near.length} (${near.join(', ')}); windows ${windows.join(', ')}`);

// The composter
const b = { level: 0 };
ok(dye.compost(b, { wheat_seeds: 7 }, () => 0.1).boneMeal === 1 && b.level === 0, '7 seeds that all take give a bone meal');
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const many = dye.compost({ level: 0 }, { wheat_seeds: 7000 }, rnd).boneMeal;
ok(many > 260 && many < 340, `7000 seeds give ${many} bone meal (~300)`);
ok(JSON.stringify(dye.compostable({ wheat_seeds: 30, wheat: 100, poppy: 5 })) === JSON.stringify({ wheat_seeds: 6, wheat: 36 }), 'compost spares seeds past 24 and wheat past 64, never flowers');
const kinds = dye.bedKinds(g1Wide);
ok(kinds.length === 6 && kinds[0] === 'rose_bush' && kinds.includes('lilac'), `bed kinds ${kinds.join(', ')}`);
const bed = dye.newBed({ x1: 0, z1: 0, x2: 7, z2: 2 }, 64, kinds, 'Ada', 0);
ok(bed.cells.length === 6 && bed.cells.every((c) => c.z === 1) && bed.composter.x === 7 && bed.composter.y === 65, 'the bed\'s cells and composter');
ok(!dye.bedKinds({ wildflowers: 40 }).length, 'no bed without tall flowers');

// A detail cathedral with G1's colours, through the yard
const mats = new Materials(reg, { cut: true, dyes: true });
const plan: import('../../server/src/monument').PlanOf = (bill, have) => mats.plan(bill, have);
const m = mon.newMonument('birch', 0);
m.state = 'building';
m.site = { x1: 0, z1: 0, x2: 40, z2: 40, y: 70, rotate: 0, prepared: true };
m.colours = Object.fromEntries(windows.map((c) => [c, c]));
const c = mon.monumentPlan(m);
const panes = Object.keys(c.bill).filter((k) => /_stained_glass_pane$/.test(k));
ok(panes.length >= 6, `the cathedral's stained panes: ${panes.join(', ')}`);
let dyes = 0, flowersAsked: string[] = [];
for (let round = 0; round < 3000 && mon.currentStage(m); round++) {
  for (const [n, q] of Object.entries(mon.stageWantsPlanned(m, plan))) {
    if (/_dye$/.test(n)) dyes += q;
    if (dye.DYE_FLOWERS.includes(n)) flowersAsked.push(n);
    m.yard[n] = (m.yard[n] ?? 0) + q;
  }
  for (const [input, q] of Object.entries(mon.kilnWants(m, plan))) {
    m.yard[input] -= q;
    const out = input === 'sand' ? 'glass' : 'stone';
    m.yard[out] = (m.yard[out] ?? 0) + q;
  }
  const load = cutter.cutLoad(cutter.cutWants(plan(mon.stageBill(m, mon.AHEAD), m.yard).steps as CutStep[], m.yard));
  if (load.length) cutter.applyCuts(m.yard, load);
  for (const i of mon.openJobs(m)) if (mon.jobReady(m, i, plan)) mon.jobBuiltPlanned(m, i, plan, round);
}
ok(m.state === 'built', `built (${m.done.length} of ${c.jobs.length} jobs)`);
ok(!flowersAsked.length, `no flower asked for by the stage (the dyer makes the dyes): ${[...new Set(flowersAsked)].join(', ')}`);
ok(dyes > 0, 'dyes asked for');
// (and each wanted dye made by the dyer's plan from G1's sources: storage's lapis; the composter's bone meal, the bed's tall
// flowers and the wildflowers and lilies picked, renewed)
const yields = dye.dyeYields(reg);
const renew = new Set(['bone_meal', 'rose_bush', 'peony', 'lilac', 'wildflowers', 'lily_of_the_valley']);
for (const p of panes) {
  const col = p.replace(/_stained_glass_pane$/, '');
  const st = dye.dyeSteps(yields, `${col}_dye`, 4, { lapis_lazuli: 54 }, renew);
  ok(st && Object.keys(st.takes).every((k) => k === 'lapis_lazuli' || renew.has(k)), `${col} dye from G1's sources: ${JSON.stringify(st)}`);
}
const lb = dye.dyeSteps(yields, 'light_blue_dye', 4, { lapis_lazuli: 54 }, renew);
ok(lb?.takes.lapis_lazuli === 2 && lb.takes.bone_meal === 2 && lb.crafts.map((c) => c.item).join() === 'blue_dye,white_dye,light_blue_dye', `light blue mixed: ${JSON.stringify(lb)}`);
const rd = dye.dyeSteps(yields, 'red_dye', 5, {}, renew);
ok(rd?.takes.rose_bush === 3 && rd.crafts.at(-1)?.makes === 6, `red from 3 rose bushes: ${JSON.stringify(rd)}`);
ok(dye.dyeSteps(yields, 'green_dye', 1, {}, renew) === null, 'no green here');
const used = dye.dyeSteps(yields, 'red_dye', 3, { red_dye: 2, rose_bush: 5 }, renew);
ok(used?.takes.red_dye === 2 && used.takes.rose_bush === 1, `dyes held first: ${JSON.stringify(used)}`);
console.log(`Notre-Dame 1:4 detail with ${panes.length} colours: ${dyes} dyes asked for, ${c.design.blocks} blocks, built`);
console.log(failures ? `FAIL dye_bed_unit: ${failures} of ${checks}` : `OK dye_bed_unit: ${checks} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
