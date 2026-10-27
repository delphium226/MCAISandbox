/**
 * MC_GEODE offline (#162 tier 3, chain C; gothicGen's accents, monument.ts' accents and stand-ins, mcGemCutter's geometry;
 * no server):
 * - the generator with accents draws the same cells and jobs, calcite round the west portals and across the west front,
 *   amethyst at the roses' hubs (and the altar with the furnishing); without it the cells as before;
 * - a record begun with the flag keeps `accents`; its plan gathers calcite and amethyst blocks as they lie (not shards);
 *   the stand-ins are polished diorite and chiselled stone bricks;
 * - a made-up geode (lining radius 4 round 0,20,0): geodeOf finds its centre and radius from its amethyst; the tunnel
 *   from a stairs' foot 14 away ends outside the shell and within reach of its calcite; the hollow told from the shell.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/geode_unit.mts (sets its flags itself)
 */
import minecraftData from 'minecraft-data';

process.env.MC_MONUMENT = 'on';
process.env.MC_KILN = 'on';
process.env.MC_MONUMENT_PALETTE = 'full';
process.env.MC_MONUMENT_DETAIL = 'on';
process.env.MC_GEODE = 'on';
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const gen = await import('../../server/src/gothicGen');
const mon = await import('../../server/src/monument');
const gem = await import('../../server/src/mineflayer/mcGemCutter');
type Monument = import('../../server/src/village').Monument;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};

// 1. The generator
for (const [p, calc] of [['notre_dame', [20, 60]], ['cologne', [30, 80]]] as const) {
  const P = gen.GOTHIC_PRESETS[p];
  const off = gen.generateCathedral(P, 3, { detail: true }), on = gen.generateCathedral(P, 3, { detail: true, accents: true });
  ok(on.design.blocks === off.design.blocks && on.jobs.length === off.jobs.length, `${p}: same cells and jobs`);
  ok((on.bill.calcite ?? 0) >= calc[0] && (on.bill.calcite ?? 0) <= calc[1] && !off.bill.calcite, `${p}: ${on.bill.calcite} calcite`);
  ok(JSON.stringify(gen.generateCathedral(P, 3, { detail: true }).bill) === JSON.stringify(off.bill), `${p}: without accents as before`);
  ok(JSON.stringify(gen.generateCathedral(P, 3, { accents: true }).bill) === JSON.stringify(gen.generateCathedral(P, 3).bill), `${p}: accents need detail`);
}
const nd = gen.generateCathedral(gen.GOTHIC_PRESETS.notre_dame, 3, { detail: true, accents: true });
ok(nd.bill.amethyst_block === 3, `notre_dame: ${nd.bill.amethyst_block} amethyst at the roses' hubs`);
// (the altar stands at 1:2, the nave too narrow for it at 1:3)
ok(gen.generateCathedral(gen.GOTHIC_PRESETS.notre_dame, 2, { detail: true, accents: true, furnish: true }).bill.amethyst_block === 6, 'the altar in amethyst with the furnishing (1:2)');

// 2. The record, its plan and stand-ins
const m = mon.newMonument('oak', 0) as Monument;
m.scale = 3;
ok(mon.GEODE_ON && mon.m3(m).accents, 'a new record keeps accents');
const c = mon.monumentPlan(m);
ok(c.bill.calcite === nd.bill.calcite, `the plan's calcite ${c.bill.calcite}`);
const mats = new Materials(minecraftData('26.1'), { cut: true });
const p = mats.plan({ calcite: 29, amethyst_block: 3 });
ok(p.gather.calcite === 29 && p.gather.amethyst_block === 3 && !p.gather.amethyst_shard, `gathered as they lie: ${JSON.stringify(p.gather)}`);
mon.m3(m).standIns = { calcite: mon.GEM_STAND.calcite, amethyst_block: mon.GEM_STAND.amethyst_block };
const s = mon.monumentPlan(m);
ok(!s.bill.calcite && !s.bill.amethyst_block && s.bill.polished_diorite > c.bill.polished_diorite, 'stood in as tier 2\'s blocks');

// 3. A made-up geode
const lining: Array<{ x: number; y: number; z: number }> = [];
for (let x = -6; x <= 6; x++) for (let y = 14; y <= 26; y++) for (let z = -6; z <= 6; z++) {
  const d = Math.hypot(x + 0.5, y + 0.5 - 20, z + 0.5);
  if (d >= 3.5 && d < 4.5) lining.push({ x, y, z });
}
const g = gem.geodeOf(lining, { x: 14, y: 20, z: 3 })!;
ok(Math.hypot(g.x, g.y - 19.5, g.z) < 1 && g.r >= 3.8 && g.r <= 5, `geodeOf: centre ${g.x},${g.y},${g.z}, radius ${g.r}`);
ok(!gem.geodeOf([], { x: 0, y: 0, z: 0 }), 'no amethyst: no geode');
const path = gem.tunnelPath({ x: 14, y: 20, z: 3 }, g);
const end = path.at(-1)!;
const dEnd = Math.hypot(end[0] - g.x, end[1] + 0.5 - g.y, end[2] - g.z);
ok(path.length >= 6 && path.length <= 14 && path.every(([, y]) => y === 20), `the tunnel: ${path.length} cells, level`);
ok(dEnd > g.r + 2 && dEnd <= g.r + 4.5, `its end ${dEnd.toFixed(1)} from the centre: outside the shell (${(g.r + 2).toFixed(1)}), the calcite in reach`);
ok(path.every(([x, , z], i) => i === 0 ? Math.abs(x - 14) + Math.abs(z - 3) === 1 : Math.abs(x - path[i - 1][0]) + Math.abs(z - path[i - 1][2]) === 1), 'each cell beside the last');
ok(gem.inHollow(g, { x: 0, y: 19, z: 0 }) && !gem.inHollow(g, { x: 4, y: 19, z: 0 }) && !gem.inHollow(g, { x: 6, y: 19, z: 0 }), 'the hollow told from the lining and outside');
ok(!gem.GEM_TAKE.includes('budding_amethyst'), 'budding amethyst never taken');
// the atlas's pick: the sighting nearest a level's tunnel within 5 of its y; none too far or too high
const lv = [{ k: 0, y: 26, cells: [{ x: 0, y: 26, z: 0 }, { x: 10, y: 26, z: 0 }] }, { k: 1, y: 14, cells: [{ x: 0, y: 14, z: 0 }] }];
const pk = gem.pickGeode([[3, 30, 27, 5], [5, 14, 10, 40], [2, 3, 15, 3]], lv);
ok(pk && pk.k === 1 && pk.at.join() === '3,15,3', `pickGeode: ${JSON.stringify(pk)}`);
ok(gem.pickGeode([[3, 30, 27, 5]], lv)?.from.x === 10, 'the nearest tunnel cell');
ok(!gem.pickGeode([[3, 200, 26, 0], [3, 0, 40, 0]], lv), 'none too far or off the levels');
console.log(failures ? `FAIL geode_unit: ${failures} of ${checks}` : `OK geode_unit: ${checks} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
