/**
 * The monument's stonecutter checked offline (#162, chain A; server/src/cutter.ts and Materials' `cut`; no server):
 * - the jar's stonecutting recipes read (stone into stairs 1:1, slabs 2);
 * - a plan without `cut` has no cut steps and crafts stone bricks at the table, as before;
 * - a plan with `cut` makes every stonecutter piece by cutting, leaves cobblestone gathered, takes andesite as gathered;
 * - the chain on Notre-Dame and Chartres at 1:4 and 1:2 with `detail` (the stone pieces of the bill, tuff as stone
 *   bricks): cobblestone smelted in the yard, then the carver's loads of at most CUT_LOAD until nothing is left to cut,
 *   after which the plan asks for nothing to cut or smelt; prints the loads (the carver's chores) and the cuts.
 * Usage: node_modules/.bin/tsx scripts/checks/cutter_unit.mts
 */
import minecraftData from 'minecraft-data';
import { Materials, cutOptions } from '../../server/src/mineflayer/mcMaterials';
import { CUT_LOAD, applyCuts, cutInputs, cutLoad, cutWants, cutterCell, needsCutting } from '../../server/src/cutter';
import { GOTHIC_PRESETS, generateCathedral } from '../../server/src/gothicGen';

const reg = minecraftData('26.1');
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };

const cuts = cutOptions();
const stair = cuts.get('stone_brick_stairs')?.find((o) => o.ins.stone);
const slab = cuts.get('stone_brick_slab')?.find((o) => o.ins.stone);
console.log(`stonecutting: ${cuts.size} outputs; stone -> stairs ${stair?.out}, slabs ${slab?.out}`);
if (cuts.size < 150 || stair?.out !== 1 || slab?.out !== 2) fail('the jar\'s stonecutting recipes not read as expected');

const off = new Materials(reg).plan({ stone_bricks: 8, stone_brick_stairs: 4 }, {});
if (off.steps.some((s) => s.cut)) fail('a plan without cut has cut steps');
if (!off.steps.some((s) => s.do === 'craft' && s.item === 'stone_bricks')) fail('a plan without cut does not craft stone bricks');

const on = new Materials(reg, { cut: true });
const p = on.plan({ stone_bricks: 8, stone_brick_stairs: 4, polished_andesite: 6, cobblestone_stairs: 2, cobblestone: 3 }, { andesite: 2 });
const crafted = p.steps.filter((s) => s.do === 'craft' && !s.cut).map((s) => s.item);
if (crafted.some((n) => /stone|andesite/.test(n))) fail(`crafted at the table with cut: ${crafted.join(', ')}`);
if (!p.gather.andesite || p.gather.andesite !== 4) fail(`andesite not gathered (gather ${JSON.stringify(p.gather)})`);
if (!p.gather.cobblestone && !p.gather['any:cobblestone']) fail('cobblestone not gathered');
const stairStep = p.steps.find((s) => s.item === 'stone_brick_stairs');
if (!stairStep?.cut || stairStep.input !== 'stone' || stairStep.runs !== 4) fail(`stairs not cut 1:1 from stone: ${JSON.stringify(stairStep)}`);

const cell = cutterCell({ x2: 10, z1: 20, y: 64 });
if (cell.x !== 10 || cell.y !== 65 || cell.z !== 21) fail(`cutter cell ${JSON.stringify(cell)}`);

// The chain on the detail cathedrals' stone
const STONE = /^(stone_bricks|chiseled_stone_bricks|stone_brick_(stairs|slab|wall)|polished_(andesite|diorite|granite)|tuff_bricks)$/;
for (const [name, scale] of [['notre_dame', 4], ['chartres', 4], ['notre_dame', 2], ['chartres', 2]] as Array<[string, number]>) {
  const c = generateCathedral(GOTHIC_PRESETS[name], scale, { detail: true });
  const bill: Record<string, number> = {};
  for (const [k, q] of Object.entries(c.bill)) if (STONE.test(k)) { const n = k === 'tuff_bricks' ? 'stone_bricks' : k; bill[n] = (bill[n] ?? 0) + q; }
  const yard: Record<string, number> = { cobblestone: 20000, andesite: 5000, diorite: 5000, granite: 5000 };
  let loads = 0, cut = 0;
  for (let round = 0; round < 500; round++) {
    const plan = on.plan(bill, yard);
    // (the kiln, at once: every smelt the plan asks for)
    for (const s of plan.steps) if (s.do === 'smelt' && s.input && s.input.includes('cobblestone')) {
      yard.cobblestone -= s.runs; yard.stone = (yard.stone ?? 0) + s.makes;
    }
    const load = cutLoad(cutWants(on.plan(bill, yard).steps, yard));
    if (!load.length) break;
    if (Object.values(cutInputs(load)).reduce((t, q) => t + q, 0) > CUT_LOAD) fail('a load over CUT_LOAD');
    applyCuts(yard, load);
    loads++;
    cut += load.reduce((t, l) => t + l.makes, 0);
  }
  const after = on.plan(bill, yard);
  if (needsCutting(after.steps) || after.fuel.smelts) fail(`${name} 1:${scale}: cutting or smelting left: ${after.steps.map((s) => `${s.do}${s.cut ? '(cut)' : ''} ${s.makes} ${s.item}`).join(', ')}`);
  for (const [k, q] of Object.entries(bill)) if ((after.fromStock[k] ?? 0) < q) fail(`${name} 1:${scale}: ${k} ${after.fromStock[k] ?? 0} of ${q} from the yard`);
  console.log(`${name} 1:${scale}: ${Object.values(bill).reduce((t, q) => t + q, 0)} stone pieces, ${cut} cut in ${loads} carver loads (${Object.keys(bill).length} kinds)`);
}
console.log(failures ? `FAIL: ${failures} problems` : 'OK: the stonecutter');
process.exit(failures ? 1 : 0);
