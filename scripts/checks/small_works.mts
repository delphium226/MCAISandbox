/**
 * Small works checked offline (s35's initiatives, smallWorks.ts; no server): every kind in oak, birch and spruce passes
 * validateDesign (with block states, no door needed), stays within 7x7 and 5 layers, and its bill plans (Materials.plan)
 * to gathering only logs, cobblestone and sand; each bill is printed. Then the spots: the areas a village keeps free built
 * from mc/testcheckpoints/mv3_base25/villages.json the way the world does (structures +1, every layout's streets, lamps +1,
 * signs, the farm and the slots, the annex and works plots, reservations, the mine's hut, door fronts: 3 cells out of the
 * side a building's sign faces, else the side nearest a street), and smallWorkSpots counted for 3x3, 5x5 and 7x7 (every
 * candidate, and how many fit at once taking them in order with each one's spot +2 blocked), twice to check it is
 * deterministic. Prints PASS or FAIL (exit 1).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/small_works.mts   Env: VILLAGES (another villages.json).
 */
import { readFileSync } from 'node:fs';
import minecraftData from 'minecraft-data';
import { validateDesign } from '../../server/src/designs';
import type { Area, Village } from '../../server/src/village';
import { Materials, designBill, hardToGather } from '../../server/src/mineflayer/mcMaterials';
import { SMALL_WORKS, isSmallWork, smallWorkSpots, type SpotInput } from '../../server/src/smallWorks';

const reg = minecraftData('26.1');
const materials = new Materials(reg);
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

const fails: string[] = [];
const fmt = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${q} ${n}`).join(', ');
// Raw materials a small work may need: logs, cobblestone, sand
const EASY = /^(any:logs|any:cobblestone|.*_(log|stem)|bamboo_block|cobblestone|sand)$/;

console.log('== designs');
for (const wood of ['oak', 'birch', 'spruce']) {
  for (const k of SMALL_WORKS) {
    const d = k.make(wood);
    const tag = `${k.kind}/${wood}`;
    const { design, errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } } as unknown as Record<string, unknown>, d.by, { isPlaceable, states: true, requireDoor: false });
    if (!design) fails.push(`${tag}: ${errors.join('; ')}`);
    if (d.name !== `small_${k.kind}_${wood}` || !isSmallWork(d.name)) fails.push(`${tag}: name ${d.name}`);
    if (d.width > 7 || d.depth > 7 || d.height > 5) fails.push(`${tag}: ${d.width}x${d.depth}x${d.height} is over 7x7x5`);
    if (design && (design.width !== d.width || design.depth !== d.depth || design.blocks !== d.blocks)) fails.push(`${tag}: validateDesign reads ${design.width}x${design.depth}, ${design.blocks} blocks; made ${d.width}x${d.depth}, ${d.blocks}`);
    for (const l of d.layers) if (l.length !== d.depth || l.some((r) => r.length !== d.width)) fails.push(`${tag}: a layer is not ${d.width}x${d.depth}`);
    // No other wood kind in it
    for (const b of Object.values(d.palette)) {
      const m = /^(oak|birch|spruce)_/.exec(b);
      if (m && m[1] !== wood) fails.push(`${tag}: ${b} is not ${wood}`);
    }
    const bill = designBill(d);
    const plan = materials.plan(bill);
    const hard = hardToGather(plan.gather);
    const other = Object.keys(plan.gather).filter((n) => !EASY.test(n));
    if (plan.problems.length) fails.push(`${tag}: ${plan.problems.join('; ')}`);
    if (hard.length || other.length) fails.push(`${tag}: gathers ${[...new Set([...hard, ...other])].join(', ')}`);
    // Logs of its own wood only (a barrel's recipe planned cherry slabs: cherry logs in a birch village)
    const alien = Object.keys(plan.gather).filter((n) => /_(log|stem)$/.test(n) && n !== `${wood}_log`);
    if (alien.length) fails.push(`${tag}: gathers ${alien.join(', ')} (not ${wood})`);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    const line = `${k.kind.padEnd(13)} ${wood.padEnd(6)} ${d.width}x${d.depth}x${d.height} ${String(d.blocks).padStart(3)} blocks | bill: ${fmt(bill)} | gather: ${fmt(plan.gather)} (${units} units, ${plan.fuel.smelts} smelts)`;
    if (wood === 'birch' || process.env.ALL) console.log(line);
  }
}
if (!process.env.ALL) console.log('(oak and spruce checked the same; ALL=1 prints them)');

// The spots on a real village record
const file = process.env.VILLAGES ?? 'mc/testcheckpoints/mv3_base25/villages.json';
const v = (JSON.parse(readFileSync(file, 'utf8')) as { villages: Village[] }).villages[0];
const grow = (a: Area, n: number): Area => ({ x1: a.x1 - n, z1: a.z1 - n, x2: a.x2 + n, z2: a.z2 + n });
const cell = (x: number, z: number, n = 0): Area => grow({ x1: x, z1: z, x2: x, z2: z }, n);

function spotInput(v: Village): SpotInput {
  const blocked: Area[] = [];
  const streets = (v.layouts ?? []).flatMap((l) => l.streets ?? []);
  const signs = (v.layouts ?? []).flatMap((l) => l.signs ?? []);
  for (const s of v.structures) {
    blocked.push(grow(s, 1));
    if (s.kind === 'storage') continue;
    // Its door's front: the side its sign faces, else the side nearest a street (the town centre's paths are streets)
    const sign = signs.find((g) => g.building === s.kind && g.cx >= s.x1 && g.cx <= s.x2 && g.cz >= s.z1 && g.cz <= s.z2);
    let side = sign?.facing;
    if (!side && streets.length) {
      const gap = (a: Area) => Math.min(...streets.map((t) => Math.max(t.x1 - a.x2, a.x1 - t.x2, 0) + Math.max(t.z1 - a.z2, a.z1 - t.z2, 0)));
      const sides = {
        north: gap({ ...s, z1: s.z1 - 3, z2: s.z1 - 1 }), south: gap({ ...s, z1: s.z2 + 1, z2: s.z2 + 3 }),
        west: gap({ ...s, x1: s.x1 - 3, x2: s.x1 - 1 }), east: gap({ ...s, x1: s.x2 + 1, x2: s.x2 + 3 }),
      };
      side = (Object.entries(sides) as Array<[keyof typeof sides, number]>).sort((a, b) => a[1] - b[1])[0][0];
    }
    if (side === 'north') blocked.push({ ...s, z1: s.z1 - 3, z2: s.z1 - 1 });
    if (side === 'south') blocked.push({ ...s, z1: s.z2 + 1, z2: s.z2 + 3 });
    if (side === 'west') blocked.push({ ...s, x1: s.x1 - 3, x2: s.x1 - 1 });
    if (side === 'east') blocked.push({ ...s, x1: s.x2 + 1, x2: s.x2 + 3 });
  }
  for (const l of v.layouts ?? []) {
    blocked.push(...(l.streets ?? []));
    for (const p of l.lamps ?? []) blocked.push(cell(p.x, p.z, 1));
    for (const g of l.signs ?? []) blocked.push(cell(g.x, g.z));
    if (l.farm) blocked.push({ x1: l.farm.x1, z1: l.farm.z1, x2: l.farm.x2, z2: l.farm.z2 });
    for (const s of l.slots ?? []) blocked.push({ x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2 });
    if (l.annex) blocked.push(l.annex);
    if (l.works) blocked.push(l.works);
  }
  blocked.push(...v.reservations);
  if (v.mine?.hut) blocked.push(grow(v.mine.hut, 1));
  const plots = v.plots.filter((p) => !p.annex && !p.works).map((p) => ({ x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2, y: p.y }));
  return { plots, blocked };
}

console.log(`\n== spots on ${v.name} (${file})`);
const input = spotInput(v);
console.log(`${input.plots.length} plot(s): ${input.plots.map((p) => `${p.x1},${p.z1}..${p.x2},${p.z2} y=${p.y}`).join('; ')}; ${input.blocked.length} blocked areas`);
const overlaps = (a: Area, b: Area) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;
if (process.env.MAP) {
  // The plot as a map: "#" blocked, "o" the nearest 3x3 spots' footprints, "." free
  for (const p of input.plots) {
    const near = smallWorkSpots(input, 3, 3, 4);
    for (let z = p.z1; z <= p.z2; z++) {
      let row = '';
      for (let x = p.x1; x <= p.x2; x++)
        row += near.some((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.z - z) <= 1) ? 'o' : input.blocked.some((b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2) ? '#' : '.';
      console.log(`${String(z).padStart(5)} ${row}`);
    }
  }
}
const counts: Record<string, number> = {};
// (5x3: the bench's, stall's, woodshed's and lamp posts' footprint)
for (const [w, d] of [[3, 3], [5, 3], [5, 5], [7, 7]]) {
  const size = `${w}x${d}`;
  const t0 = performance.now();
  const all = smallWorkSpots(input, w, d);
  const ms = performance.now() - t0;
  const again = smallWorkSpots(input, w, d);
  if (JSON.stringify(all) !== JSON.stringify(again)) fails.push(`${size}: two calls differ`);
  const top = smallWorkSpots(input, w, d, 5);
  if (JSON.stringify(top) !== JSON.stringify(all.slice(0, 5))) fails.push(`${size}: max=5 is not the first 5`);
  // Each spot (build_design's centre: x1 + floor(w / 2)): its footprint and ring inside a plot, clear of every blocked area
  const foot = (s: { x: number; z: number }): Area => ({ x1: s.x - Math.floor(w / 2), z1: s.z - Math.floor(d / 2), x2: s.x - Math.floor(w / 2) + w - 1, z2: s.z - Math.floor(d / 2) + d - 1 });
  for (const s of all) {
    const ring = grow(foot(s), 1);
    if (!input.plots.some((p) => ring.x1 >= p.x1 && ring.x2 <= p.x2 && ring.z1 >= p.z1 && ring.z2 <= p.z2 && p.y === s.y)) fails.push(`${size}: ${s.x},${s.z} is not inside a plot`);
    const hit = input.blocked.find((b) => overlaps(b, ring));
    if (hit) { fails.push(`${size}: ${s.x},${s.z} overlaps ${JSON.stringify(hit)}`); break; }
  }
  // How many fit at once: taken in order, each one's spot +2 blocked for the next (as the world blocks other initiatives')
  let taken = 0;
  let free = { ...input, blocked: [...input.blocked] };
  for (;;) {
    const s = smallWorkSpots(free, w, d, 1)[0];
    if (!s) break;
    taken++;
    free = { ...free, blocked: [...free.blocked, grow(foot(s), 2)] };
  }
  counts[size] = all.length;
  console.log(`${size}: ${all.length} candidate spots (${ms.toFixed(1)} ms), ${taken} at once; nearest the centre: ${all.slice(0, 3).map((s) => `${s.x},${s.z}`).join(' ') || '-'}`);
}
if (!counts['3x3']) fails.push('no 3x3 spot on the village');
// Every kind finds a spot
for (const k of SMALL_WORKS) {
  const d = k.make('birch');
  if (!smallWorkSpots(input, d.width, d.depth, 1).length) fails.push(`${k.kind}: no ${d.width}x${d.depth} spot`);
}
// A plot fully blocked has none; an unblocked 5x5 plot holds exactly one 3x3 spot, at its centre
if (smallWorkSpots({ plots: [{ x1: 0, z1: 0, x2: 9, z2: 9, y: 64 }], blocked: [{ x1: -5, z1: -5, x2: 20, z2: 20 }] }, 3, 3).length) fails.push('a blocked plot has spots');
const one = smallWorkSpots({ plots: [{ x1: 10, z1: 20, x2: 14, z2: 24, y: 70 }], blocked: [] }, 3, 3);
if (JSON.stringify(one) !== JSON.stringify([{ x: 12, z: 22, y: 70 }])) fails.push(`a 5x5 plot's 3x3 spots: ${JSON.stringify(one)}`);
// Scale: a 60x60 plot with 400 blocked cells, as a menu at 25 agents might ask
const many: Area[] = [];
for (let k = 0; k < 400; k++) many.push(cell(((k * 37) % 60), ((k * 53) % 60)));
const t1 = performance.now();
for (let k = 0; k < 25; k++) smallWorkSpots({ plots: [{ x1: 0, z1: 0, x2: 59, z2: 59, y: 64 }], blocked: many }, 3, 3, 2);
console.log(`25 calls on a 60x60 plot with 400 blocked areas: ${(performance.now() - t1).toFixed(1)} ms`);

console.log(fails.length ? `\nFAIL (${fails.length}):\n  ${fails.slice(0, 30).join('\n  ')}` : `\nPASS: ${SMALL_WORKS.length} kinds x 3 woods valid, easy materials; spots ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`);
process.exit(fails.length ? 1 : 0);
