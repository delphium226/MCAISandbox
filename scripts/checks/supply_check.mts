/**
 * #202: every civic building, cathedral and castle checked for blocks the monument's yard cannot get (no server). Each is
 * drawn as a new record would be (the flags' defaults: the dressing, the detail palette), its bill planned with the yard's
 * plan (mcKiln's planOf: cut at the stonecutter where a carver cuts, sandstone made from sand) and each raw item matched to the yard's routes
 * (monument.ts' YARD_ROUTE: trips, chores, the mine's stock, stand-ins). Prints the unsuppliable ones and the blocks a
 * recipe chain makes for the yard (YARD_MADE). Then:
 * - the Zytglogge (train 17, R) plans sand, not sandstone;
 * - a civic building's stairs are planned as its build crafts them (no carver), a detail cathedral's sandstone pieces
 *   are cut from the yard's sand (the carver's FORGE, cutter.ts);
 * - the short lists leave out a building the supply check refuses (shortlist.ts' setSupplyCheck);
 * - MC_SAND_TRIPS' spot (the nearest dry sand cell beyond the village range, failed spots passed over) and sand in reach.
 * Fails when any civic building or cathedral is unsuppliable (the short lists would leave it out silently).
 * Usage: node_modules/.bin/tsx scripts/checks/supply_check.mts
 */
import minecraftData from 'minecraft-data';
import { Materials, YARD_MADE } from '../../server/src/mineflayer/mcMaterials';
import { planOf } from '../../server/src/mineflayer/mcKiln';
import { civicEntries, civicOptions, civicScale } from '../../server/src/civic';
import { M3, architectOptions, monumentPlan, newCivic, newMonument, sandstoneStandIn, unsuppliable, type MonumentM3 } from '../../server/src/monument';
import { GOTHIC_PRESETS } from '../../server/src/gothicGen';
import { CASTLE_PRESETS } from '../../server/src/castleGen';
import { cutWants, type CutStep } from '../../server/src/cutter';
import { DRESSING } from '../../server/src/dressing';
import { setSupplyCheck } from '../../server/src/shortlist';
import { sandInReach, sandSpot, sandstoneSand } from '../../server/src/mineflayer/mcSandTrips';
import type { Monument, Village } from '../../server/src/village';

const reg = minecraftData('26.1');
const world = { materials: new Materials(reg as any), registry: reg as any };
const plan = (m: Monument) => planOf(world, m);
let fails = 0;
const fail = (msg: string) => { fails++; console.log(`  FAIL ${msg}`); };

const recs: Array<{ id: string; type: string; m: Monument }> = [];
for (const e of civicEntries()) recs.push({ id: e.id, type: 'civic', m: newCivic(e.id, civicScale(e.id), 'spruce', 0) });
for (const p of Object.keys(GOTHIC_PRESETS)) for (const s of M3.scales) recs.push({ id: `${p} 1:${s}`, type: 'cathedral', m: Object.assign(newMonument('spruce', 0, 'cathedral'), { preset: p, scale: s }) });
for (const p of Object.keys(CASTLE_PRESETS)) recs.push({ id: p, type: 'castle', m: Object.assign(newMonument('spruce', 0, 'castle'), { preset: p, scale: 3 }) });

const made = new Map<string, string[]>();
let bad = 0;
for (const r of recs) {
  const short = unsuppliable(r.m, plan(r.m));
  if (short.length) {
    bad++;
    console.log(`  unsuppliable ${r.type} ${r.id}: ${short.join(', ')}`);
    if (r.type !== 'castle') fail(`${r.type} ${r.id} has a block the yard cannot get (${short.join(', ')})`);
  }
  const bill = monumentPlan(r.m).bill;
  for (const n of Object.keys(bill)) if (YARD_MADE.some((y) => n.includes(y))) { if (!made.has(n)) made.set(n, []); made.get(n)!.push(`${r.type}:${r.id.split(' ')[0]}`); }
}
console.log(`${recs.length} records (dressing ${DRESSING.on ? 'on' : 'off'}, detail ${(newMonument('oak', 0, 'cathedral') as MonumentM3).detail ? 'on' : 'off'}): ${bad} unsuppliable`);
console.log('made for the yard from sand (no sandstone trip):');
for (const [n, ids] of [...made].sort()) console.log(`  ${n}: ${[...new Set(ids)].length} records (${[...new Set(ids)].slice(0, 8).join(', ')}${ids.length > 8 ? ', ...' : ''})`);

// The Zytglogge: sand, not sandstone
{
  const z = newCivic('zytglogge', civicScale('zytglogge'), 'oak', 0);
  const g = plan(z)(monumentPlan(z).bill, {}).gather;
  console.log(`zytglogge gathers: ${Object.entries(g).map(([n, q]) => `${q} ${n}`).join(', ')}`);
  if (g.sandstone) fail('the Zytglogge still plans sandstone as gathered');
  if (!(g.sand > 0)) fail('the Zytglogge plans no sand');
  // (no carver for a civic building: its yard is planned as its build crafts, cobblestone stairs 6 for 4)
  const top = monumentPlan(z).jobs.find((j) => (j.bill.cobblestone_stairs ?? 0) > 0);
  if (top) {
    const need = plan(z)({ cobblestone_stairs: top.bill.cobblestone_stairs }, {}).gather;
    const want = Math.ceil(top.bill.cobblestone_stairs / 4) * 6;
    console.log(`zytglogge ${top.bill.cobblestone_stairs} cobblestone stairs: the yard plans ${need.cobblestone ?? need['any:cobblestone']} cobblestone (crafted: ${want})`);
    if ((need.cobblestone ?? need['any:cobblestone'] ?? 0) < want) fail('a civic building\'s cobblestone stairs are planned as cut, which its build does not do');
  }
  // (no sand near home: the sandstone stands in as stone bricks from the first job the yard does not cover)
  z.yard = { sand: 4 * 40 };
  const from = sandstoneStandIn(z);
  const p = monumentPlan(z);
  const left = p.jobs.slice(from ?? 0).reduce((t, j) => t + Object.keys(j.bill).filter((n) => /sandstone/.test(n)).length, 0);
  const kept = p.jobs.slice(0, from ?? 0).reduce((t, j) => t + Object.entries(j.bill).filter(([n]) => /sandstone/.test(n)).reduce((s, [, q]) => s + q, 0), 0);
  console.log(`zytglogge, no sand: stands in from job ${from} (${kept} sandstone pieces kept before it); ${Object.entries(p.bill).filter(([n]) => /stone_brick/.test(n)).map(([n, q]) => `${q} ${n}`).join(', ')}`);
  if (from === null || left || kept > 40) fail('the Zytglogge\'s sandstone does not stand in as the jobs past the yard\'s sand');
  if (sandstoneStandIn(z) !== null) fail('the sandstone stood in twice');
}
// A detail cathedral's cut sandstone from the yard's sand
{
  const york = Object.assign(newMonument('oak', 0, 'cathedral'), { preset: 'york', scale: 3 }) as MonumentM3;
  const bill = monumentPlan(york).bill;
  const sb: Record<string, number> = {};
  for (const [n, q] of Object.entries(bill)) if (/sandstone/.test(n)) sb[n] = q;
  if (!Object.keys(sb).length) console.log('  note york has no sandstone now (the cut check is skipped)');
  else {
    const steps = plan(york)(sb, { sand: 400 }).steps as CutStep[];
    const cuts = cutWants(steps, { sand: 400 });
    console.log(`york ${JSON.stringify(sb)} with 400 sand in the yard: cuts ${cuts.map((c) => `${c.makes} ${c.item} from ${c.runs} ${c.input}`).join(', ') || 'none'}`);
    if (steps.some((s) => s.cut && s.input === 'sandstone') && !cuts.some((c) => c.input === 'sand')) fail('the carver cuts no sandstone pieces from the yard\'s sand');
  }
}
// The short lists leave out what the supply check refuses
{
  const v = (mine: boolean) => ({ name: 'Testvale', plots: [], structures: [], ...(mine ? { mine: {} } : {}) } as unknown as Village);
  const before = civicOptions(v(true), true).map((o) => o.id);
  const cathedrals = [...new Set(architectOptions(undefined, 'Testvale').map((o) => o.preset))];
  setSupplyCheck((type, preset) => !(type === 'civic' ? before[0] === preset : cathedrals[0] === preset));
  const after = civicOptions(v(true), true).map((o) => o.id);
  const cAfter = [...new Set(architectOptions(undefined, 'Testvale').map((o) => o.preset))];
  setSupplyCheck(null);
  console.log(`civic list ${before.join(', ')} -> without ${before[0]}: ${after.join(', ')}`);
  console.log(`cathedral list ${cathedrals.join(', ')} -> without ${cathedrals[0]}: ${cAfter.join(', ')}`);
  if (after.includes(before[0]) || !after.length) fail('the civic list kept a building the supply check refused');
  if (cAfter.includes(cathedrals[0]) || !cAfter.length) fail('the cathedral list kept one the supply check refused');
}
// MC_SAND_TRIPS: the nearest dry sand cell beyond the village range, skipped spots passed over, the sand in reach
{
  const cell = (cx: number, cz: number, sandAt: number[]) => ({ cx, cz, surface: { sand: sandAt.length * 16 }, h: Array.from({ length: 16 }, () => 62), s: Array.from({ length: 16 }, (_, i) => (sandAt.includes(i) ? 's' : 'o')).join('') }) as any;
  const atlas = { near: () => [cell(10, 0, [0]), cell(20, 0, [5]), cell(0, 30, [15])] };
  const home = { x: 0, z: 0 };
  const a = sandSpot(atlas, home, 144, new Set()), b = sandSpot(atlas, home, 144, new Set([a ? a.key : '']));
  console.log(`sand spots: ${a?.x},${a?.z} (${a?.dist}), then ${b?.x},${b?.z} (${b?.dist}); in reach ${sandInReach(atlas, home)}; Zytglogge's sandstone takes ${sandstoneSand(monumentPlan(newCivic('zytglogge', civicScale('zytglogge'), 'oak', 0)).bill)} sand`);
  if (a?.x !== 162 || a?.z !== 2 || b?.x !== 326 || sandInReach(atlas, home) !== 3 * 48) fail('sandSpot or sandInReach is off');
  // (#206: a second expedition's spot keeps SAND_TRIPS.apart from the first's)
  const apart = sandSpot(atlas, home, 144, new Set(), a ? [a] : []);
  console.log(`a second expedition's spot: ${apart?.x},${apart?.z}`);
  if (apart?.x !== 326) fail('a second expedition was sent to the first one\'s spot');
  // (a river between: chunk 5,0 all water, so the spot past it is passed over for the one north, out of range here: none)
  const river = { near: () => [...atlas.near(), { cx: 5, cz: 0, surface: {}, h: Array(16).fill(null), s: '~'.repeat(16) } as any] };
  const c = sandSpot(river, home, 144, new Set());
  console.log(`with a river at x 80-95: ${c ? `${c.x},${c.z}` : 'no spot'}`);
  if (c) fail('a sand spot across open water was chosen');
}
console.log(fails ? `${fails} FAILED` : 'supply_check: all ok');
process.exit(fails ? 1 : 0);
