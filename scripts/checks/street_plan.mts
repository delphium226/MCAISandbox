/**
 * The street plan checked offline (phase D, vanilla villages, V2.3; no server): for each biome its library (the town
 * centre and the houses that pass the survival checks, read from the local jar), laid out with the storage and mining
 * huts on a 32x32 pad by layoutStreets, then checked: every building inside the pad, off the streets, STREET_GAP from the
 * others and the centre, its door's way out on a street, the storage hut unturned, the mining hut's back at the pad's
 * edge; and the streets reach the pad's edge; the street lamps (placeLamps, 10-06) off streets, walkways and the mine's
 * ground, 2 from every building, beside a street, spaced. Prints each plan as a map (letters buildings, "=" streets, "o"
 * door ways, "*" lamps).
 * Usage: node_modules/.bin/tsx scripts/checks/street_plan.mts [BIOME ...]   Env: SIZE (default 32), HOUSES (default
 * "small,small,landmark,other": which of the library's houses to lay out, in order), JAR.
 */
import minecraftData from 'minecraft-data';
import { HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, isLandmark, validateDesign } from '../../server/src/designs';
import type { Area, Design } from '../../server/src/village';
import { MINING_HUT, STORAGE_HUT, miningHutDesign, storageHutDesign } from '../../server/src/huts';
import { Materials, designBill, hardToGather, inWood, woodPart } from '../../server/src/mineflayer/mcMaterials';
import { LAMP_SPACING, STREET_GAP, doorOf, placeLamps, planGreen, planStreets, streetAt, type PlanItem } from '../../server/src/streetPlan';
import { DEFAULT_JAR, VILLAGE_BIOMES, vanillaLibrary } from '../../server/src/vanillaPieces';

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const SIZE = Number(process.env.SIZE ?? 32);
/** PLAN=green: the green of V2.4 (a ring street round the centre's green, every building outside it facing in). */
const GREEN = process.env.PLAN === 'green';
const JAR = process.env.JAR ?? DEFAULT_JAR;
const WANT = (process.env.HOUSES ?? 'small,small,landmark,other').split(',');
const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  if (!m) return false;
  const b = reg.blocksByName[m[1]];
  if (!b || !reg.itemsByName[m[1]]) return false;
  if (m[2] === undefined) return true;
  const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
  return m[2].split(',').every((p) => {
    const [k, v] = p.split('=').map((t) => t.trim());
    const st = states.find((x) => x.name === k);
    return !!st && v !== undefined && (st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v));
  });
};
/** The survival checks of scripts/checks/vanilla_pieces.mts. */
function accept(d: Design, centre: boolean): boolean {
  if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable, states: true, requireDoor: !centre }).design) return false;
  const raw = designBill(d);
  const kinds: Record<string, number> = {};
  for (const [n, q] of Object.entries(raw)) { const w = woodPart(n); if (w) kinds[w.kind] = (kinds[w.kind] ?? 0) + q; }
  const bill = inWood(raw, Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0]);
  let plan = materials.plan(bill);
  plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  const units = Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1;
  return !plan.problems.length && !hardToGather(plan.gather).length && units <= (isLandmark(d.name) ? LANDMARK_UNITS : HOUSE_UNITS) && plan.fuel.smelts <= MAX_SMELTS;
}

let failed = 0;
for (const biome of process.argv.slice(2).length ? process.argv.slice(2) : [...VILLAGE_BIOMES]) {
  const lib = vanillaLibrary(biome, accept, JAR);
  const pick = (kind: string) => lib.houses.find((h) => !chosen.includes(h) && (kind === 'small' ? /small_house/.test(h.name) : kind === 'landmark' ? /_(library|temple)_/.test(h.name) : !/small_house|_(library|temple)_/.test(h.name)));
  const chosen: Design[] = [];
  for (const k of WANT) { const h = pick(k); if (h) chosen.push(h); }
  const designs = new Map<string, Design>([[STORAGE_HUT, storageHutDesign()], [MINING_HUT, miningHutDesign()], ...chosen.map((d) => [d.name, d] as [string, Design])]);
  const items: PlanItem[] = [STORAGE_HUT, MINING_HUT, ...chosen.map((d) => d.name)].map((n) => {
    const d = designs.get(n)!;
    return { name: n, width: d.width, depth: d.depth, ...doorOf(d), kind: n === STORAGE_HUT ? 'storage' : n === MINING_HUT ? 'mine' : undefined };
  });
  const c = lib.centre;
  const pc = c ? { name: c.design.name, width: c.design.width, depth: c.design.depth, connectors: c.connectors, paths: c.paths } : null;
  // (a green needs a centre: desert has none, and gets the street plan)
  const lay = (GREEN && pc ? planGreen(0, 0, SIZE, pc, items) : null) ?? planStreets(0, 0, SIZE, pc, items);
  const green = lay.green;
  const inGreen = (x: number, z: number) => !!green && x >= green.x1 && x <= green.x2 && z >= green.z1 && z <= green.z2;
  const problems: string[] = [];
  const bld = lay.places.filter((p) => p.name !== c?.design.name);
  const centreArea = lay.places.find((p) => p.name === c?.design.name);
  const inside = (a: Area) => a.x1 > lay.plot.x1 && a.z1 > lay.plot.z1 && a.x2 < lay.plot.x2 && a.z2 < lay.plot.z2;
  const apart = (a: Area, b: Area) => a.x2 + STREET_GAP < b.x1 || b.x2 + STREET_GAP < a.x1 || a.z2 + STREET_GAP < b.z1 || b.z2 + STREET_GAP < a.z1;
  const all = [...bld, ...(centreArea ? [centreArea] : [])];
  const walkway = new Set<string>();
  let mineBack: Area | null = null;
  for (const p of bld) {
    if (!inside(p)) problems.push(`${p.name} not inside the pad`);
    for (const q of all) if (q !== p && !apart(p, q)) problems.push(`${p.name} too close to ${q.name}`);
    for (let x = p.x1; x <= p.x2; x++) for (let z = p.z1; z <= p.z2; z++) if (streetAt(lay.streets, x, z)) problems.push(`${p.name} on a street at ${x},${z}`);
    // The door's way out, as build_design will set it: from the turned design
    const d = designs.get(p.name)!;
    const rot = (p.rotate ?? 0) / 90;
    const { door, out } = doorOf(d);
    let [u, v, w, dd] = [door[0], door[1], d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, v, w, dd] = [dd - 1 - v, u, dd, w];
    let [ox, oz] = out;
    for (let r = 0; r < rot; r++) [ox, oz] = [-oz, ox];
    let [x, z] = [p.x1 + u, p.z1 + v];
    while (x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2) [x, z] = [x + ox, z + oz];
    if (!streetAt(lay.streets, x, z)) problems.push(`${p.name}'s door opens onto ${x},${z}, not a street`);
    // On a green: nothing on it, and every door opens onto the ring (or a path to it), never across the green
    for (let gx = p.x1; gx <= p.x2; gx++) for (let gz = p.z1; gz <= p.z2; gz++) if (inGreen(gx, gz)) { problems.push(`${p.name} stands on the green`); gx = p.x2; break; }
    if (inGreen(x, z)) problems.push(`${p.name}'s door opens onto the green at ${x},${z}`);
    (p as unknown as { exit: [number, number] }).exit = [x, z];
    // (the walkway build_design clears out of the door, and the next cell: no lamp there)
    for (let i = 0; i < 3; i++) walkway.add(`${x + ox * i},${z + oz * i}`);
    if (p.name === STORAGE_HUT && p.rotate) problems.push('the storage hut is turned');
    // The mining hut's stairs run out its back: no building from there to the pad's edge
    if (p.name === MINING_HUT) {
      const back = ox > 0 ? { x1: lay.plot.x1, x2: p.x1 - 1, z1: p.z1, z2: p.z2 } : ox < 0 ? { x1: p.x2 + 1, x2: lay.plot.x2, z1: p.z1, z2: p.z2 }
        : oz > 0 ? { x1: p.x1, x2: p.x2, z1: lay.plot.z1, z2: p.z1 - 1 } : { x1: p.x1, x2: p.x2, z1: p.z2 + 1, z2: lay.plot.z2 };
      for (const q of all) if (q !== p && q.x1 <= back.x2 && back.x1 <= q.x2 && q.z1 <= back.z2 && back.z1 <= q.z2) problems.push(`${q.name} stands behind the mining hut`);
      mineBack = back;
    }
    // build_design's footprint for these x, z and rotate is the same area
    const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
    if (p.x - Math.floor(W / 2) !== p.x1 || p.z - Math.floor(D / 2) !== p.z1) problems.push(`${p.name}: build_design would put it elsewhere`);
  }
  // A street runs to the pad's edge along its own axis (a 3-wide street's long side); a green's ring and spokes do not
  for (const s of green ? [] : lay.streets.filter((t) => !lay.paths.includes(t))) {
    const alongX = s.x2 - s.x1 > s.z2 - s.z1;
    if (alongX ? s.x1 !== lay.plot.x1 && s.x2 !== lay.plot.x2 : s.z1 !== lay.plot.z1 && s.z2 !== lay.plot.z2) problems.push('a street ends inside the pad');
  }
  // The street lamps (10-06): off streets, walkways and the mine's ground, 2 from every building, beside a main street,
  // LAMP_SPACING apart, inside the pad
  const lamps = placeLamps(lay);
  const main = lay.streets.filter((t) => !lay.paths.includes(t));
  for (const l of lamps) {
    const at = `lamp ${l.x},${l.z}`;
    if (l.x <= lay.plot.x1 || l.z <= lay.plot.z1 || l.x >= lay.plot.x2 || l.z >= lay.plot.z2) problems.push(`${at} not inside the pad`);
    if (streetAt(lay.streets, l.x, l.z)) problems.push(`${at} on a street`);
    if (walkway.has(`${l.x},${l.z}`)) problems.push(`${at} on a door's walkway`);
    if (mineBack && l.x >= mineBack.x1 && l.x <= mineBack.x2 && l.z >= mineBack.z1 && l.z <= mineBack.z2) problems.push(`${at} behind the mining hut`);
    for (const q of all) if (Math.max(q.x1 - l.x, l.x - q.x2, q.z1 - l.z, l.z - q.z2, 0) < 2) problems.push(`${at} next to ${q.name}`);
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => streetAt(main, l.x + a, l.z + b))) problems.push(`${at} beside no street`);
    for (const m of lamps) if (m !== l && Math.max(Math.abs(m.x - l.x), Math.abs(m.z - l.z)) < LAMP_SPACING) problems.push(`${at} too close to another lamp`);
  }
  // The map
  const letters = 'ABCDEFGHIJ';
  const rows: string[] = [];
  for (let z = lay.plot.z1; z <= lay.plot.z2; z++) {
    let row = '';
    for (let x = lay.plot.x1; x <= lay.plot.x2; x++) {
      const k = all.findIndex((p) => x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2);
      const ex = bld.some((p) => (p as unknown as { exit: [number, number] }).exit?.[0] === x && (p as unknown as { exit: [number, number] }).exit?.[1] === z);
      row += lamps.some((l) => l.x === x && l.z === z) ? '*' : ex ? 'o' : k >= 0 ? (all[k] === centreArea ? '#' : letters[k]) : streetAt(lay.streets, x, z) ? '=' : inGreen(x, z) ? ',' : '.';
    }
    rows.push(row);
  }
  console.log(`\n== ${biome}${green ? ` (green, ${green.x2 - green.x1 + 1}x${green.z2 - green.z1 + 1} inside the ring)` : GREEN ? ' (no green: the street plan)' : ''}: centre ${c ? `${c.design.name} ${c.design.width}x${c.design.depth} (${c.connectors.map((k) => k.side).join(', ')})` : 'none (a crossing)'}; library ${lib.houses.map((h) => h.name).join(', ')}`);
  bld.forEach((p, i) => console.log(`  ${letters[i]} ${p.name} ${p.width}x${p.depth} at ${p.x},${p.z} rotate ${p.rotate}`));
  if (lay.unplaced.length) console.log(`  not placed: ${lay.unplaced.join(', ')}; plain crossing streets instead (plan_layout takes them when they place more): ${planStreets(0, 0, SIZE, null, items).unplaced.length} not placed`);
  console.log(rows.map((r) => '    ' + r).join('\n'));
  console.log(problems.length ? `  PROBLEMS: ${problems.join('; ')}` : `  ok: ${bld.length} of ${items.length} placed, ${lamps.length} lamps`);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
