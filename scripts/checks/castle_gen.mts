/**
 * The castle generator checked offline (the monument's second type, #153; server/src/castleGen.ts; no server), as
 * gothic_gen.mts checks the cathedral's: every preset at 1:4, 1:3 and 1:2 (and Conwy at 1:1), generated, validated as the
 * architect's designs are (Minecraft's blocks and states, sizes unlimited, no door rule: its gates are open passages),
 * and checked:
 * - the bill: designBill equals the generator's; Conwy's blocks in a range (1:2 4-12k, the note's estimate ~6-9k; 1:4
 *   1-4k), its parts all there (8 drum towers, 3 gates with 2 portcullises, a hall roof, battlements);
 * - the stages and jobs: the stages (only those the preset has parts for, in the castle's order) and the jobs each sum
 *   to the whole bill, every cell in exactly one job, jobs at most 800 blocks and (but a stage's last) at least 300, and
 *   a sample of jobDesign holding just its job's cells;
 * - every roof stair faces uphill, in every quarter turn as build_design turns it, and four turns give the design back;
 * - the floor is walkable: every floor cell with two cells of air above it (the wards, every tower's ground floor, the
 *   hall, the barbicans, the keep) is reached on foot from outside, through the gates;
 * - the main gate is at x = 0 in the middle of z (the site search's door, as the cathedral's west portal).
 * Usage: node_modules/.bin/tsx scripts/checks/castle_gen.mts [OUT_DIR: also writes each design and its quarter turn
 *        as JSON for scripts/render_design.py]
 */
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { jobDesign } from '../../server/src/gothicGen';
import { CASTLE_PRESETS, CASTLE_STAGES, generateCastle } from '../../server/src/castleGen';
import { turnState, validateDesign } from '../../server/src/designs';
import type { Design } from '../../server/src/village';
import { designBill } from '../../server/src/mineflayer/mcMaterials';

const reg = minecraftData('26.1');
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
    if (!st || v === undefined) return false;
    return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
  });
};

/** The design turned clockwise once, as build_design turns it: column i, row j -> (depth - 1 - j, i). */
function quarter(d: Design): Design {
  const W = d.depth, D = d.width;
  const pal: Record<string, string> = {};
  for (const [ch, b] of Object.entries(d.palette)) pal[ch] = turnState(b, 1);
  const layers = d.layers.map((layer) => {
    const rows = Array.from({ length: D }, () => new Array<string>(W).fill('.'));
    layer.forEach((row, j) => { for (let i = 0; i < row.length; i++) rows[i][d.depth - 1 - j] = row[i]; });
    return rows.map((r) => r.join(''));
  });
  return { ...d, palette: pal, layers, width: W, depth: D };
}
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const block = (d: Design, y: number, x: number, z: number) => {
  const ch = d.layers[y]?.[z]?.[x];
  return ch && ch !== '.' && ch !== '_' ? d.palette[ch] : undefined;
};
/** Roof stairs (deepslate tile stairs) that do not face uphill. */
function badStairs(d: Design): string[] {
  const bad: string[] = [];
  d.layers.forEach((layer, y) => layer.forEach((row, z) => {
    for (let x = 0; x < row.length; x++) {
      const b = block(d, y, x, z);
      const m = b && /^deepslate_tile_stairs\[facing=(\w+),half=bottom\]$/.exec(b);
      if (!m) continue;
      const [dx, dz] = STEP[m[1]];
      const high = block(d, y, x + dx, z + dz) || block(d, y + 1, x + dx, z + dz);
      const behind = block(d, y + 1, x - dx, z - dz);
      if (!high || (behind && /deepslate_tile/.test(behind))) bad.push(`${x},${y},${z} ${m[1]}`);
    }
  }));
  return bad;
}
/** Floor cells (solid, two of air above) not reached on foot from outside the grid. */
function shutIn(d: Design): number {
  const stand = (y: number, x: number, z: number) => y >= 1 && y <= d.height && !!block(d, y - 1, x, z) && !block(d, y, x, z) && !block(d, y + 1, x, z);
  const seen = new Set<string>();
  let q: Array<[number, number, number]> = [];
  // From the ring round the grid, at ground level (layer 0 is the floor, so outside stands at layer 0 on the pad)
  for (let x = -1; x <= d.width; x++) for (const z of [-1, d.depth]) q.push([0, x, z]);
  for (let z = 0; z < d.depth; z++) for (const x of [-1, d.width]) q.push([0, x, z]);
  q.forEach(([y, x, z]) => seen.add(`${y},${x},${z}`));
  const inGrid = (x: number, z: number) => x >= 0 && z >= 0 && x < d.width && z < d.depth;
  while (q.length) {
    const next: Array<[number, number, number]> = [];
    for (const [y, x, z] of q)
      for (const [dx, dz] of Object.values(STEP))
        for (const dy of [0, 1, -1]) {
          const u = x + dx, v = z + dz, w = y + dy;
          const k = `${w},${u},${v}`;
          if (seen.has(k)) continue;
          // (a grid cell the castle leaves empty at layer 0 is the prepared pad's ground, walked on as outside is)
          const pad = inGrid(u, v) && w === 0 && !block(d, 0, u, v) && !block(d, 1, u, v);
          const ok = inGrid(u, v) ? pad || (stand(w, u, v) && (dy <= 0 || !block(d, y + 2, x, z))) : w === 0 && u >= -1 && v >= -1 && u <= d.width && v <= d.depth;
          if (!ok) continue;
          seen.add(k); next.push([w, u, v]);
        }
    q = next;
  }
  let n = 0;
  for (let x = 0; x < d.width; x++) for (let z = 0; z < d.depth; z++) if (stand(1, x, z) && !seen.has(`1,${x},${z}`)) n++;
  return n;
}

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };
const cases: Array<[string, number]> = [];
for (const name of Object.keys(CASTLE_PRESETS)) cases.push([name, 4], [name, 3], [name, 2]);
cases.push(['conwy', 1]);
for (const [name, scale] of cases) {
  const t0 = Date.now();
  const c = generateCastle(CASTLE_PRESETS[name], scale);
  const d = c.design;
  const total = d.blocks;
  const top = Object.entries(c.bill).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`${name} 1:${scale}: ${d.width}x${d.depth}x${d.height}, ${total} blocks, ${c.jobs.length} jobs (${Date.now() - t0} ms); ${top}`);
  console.log(`  stages: ${c.stages.map((n, i) => `${i + 1} ${c.stageNames[i]} ${n} (${c.jobs.filter((j) => j.stage === i + 1).length} jobs)`).join('; ')}`);
  if (c.stageNames.some((n, i) => CASTLE_STAGES.indexOf(n as (typeof CASTLE_STAGES)[number]) <= (i ? CASTLE_STAGES.indexOf(c.stageNames[i - 1] as (typeof CASTLE_STAGES)[number]) : -1))) fail(`stages out of the castle's order: ${c.stageNames.join(', ')}`);
  if (c.stages.some((n) => !n)) fail('an empty stage');
  const { errors } = validateDesign({ ...d }, 'check', { isPlaceable, states: true, maxSide: 1000, maxLayers: 1000, requireDoor: false });
  for (const e of errors.slice(0, 5)) fail(`validateDesign: ${e}`);
  const bill = designBill(d);
  for (const k of new Set([...Object.keys(bill), ...Object.keys(c.bill)])) if ((bill[k] ?? 0) !== (c.bill[k] ?? 0)) fail(`bill ${k}: designBill ${bill[k]} vs ${c.bill[k]}`);
  if (name === 'conwy') {
    if (scale === 2 && (total < 4000 || total > 12000)) fail(`Conwy 1:2 has ${total} blocks, outside 4-12k`);
    if (scale === 4 && (total < 1000 || total > 4000)) fail(`Conwy 1:4 has ${total} blocks, outside 1-4k`);
    // (the great hall needs 1:3 or larger: at 1:4 its box is too small and it is left out)
    if (scale <= 3 && !c.bill.deepslate_tile_stairs) fail('no hall roof');
    if (c.stageNames.length !== (scale <= 3 ? 6 : 5)) fail(`Conwy has ${c.stageNames.length} stages: ${c.stageNames.join(', ')}`);
    if ((c.bill.iron_bars ?? 0) < 2) fail('no portcullis at each end');
    // (the main gate: the first layer's row at the middle of z is floor at x = 0, and air above it)
    const zc = Math.floor((d.depth - 1) / 2);
    const gate = [zc, zc + 1].some((z) => d.layers[0][z][0] !== '.' && d.layers[1][z][0] === '.' && d.layers[2][z][0] === '.');
    if (!gate) fail(`no opening at x = 0 by z ${zc}`);
  }
  if (c.stages.reduce((t, n) => t + n, 0) !== total) fail('stages do not sum to the design');
  if (c.jobs.reduce((t, j) => t + j.blocks, 0) !== total || c.cellJob.size !== total) fail('jobs do not sum to the design');
  c.jobs.forEach((j, i) => {
    const last = i === c.jobs.length - 1 || c.jobs[i + 1].stage !== j.stage;
    if (j.blocks > 800) fail(`job ${j.stage}.${j.index} has ${j.blocks} blocks`);
    if (j.blocks < 300 && !last) fail(`job ${j.stage}.${j.index} has only ${j.blocks} blocks`);
  });
  for (const j of c.jobs.filter((_, i) => i % 5 === 0)) {
    const jd = jobDesign(c, j).design;
    const n = Object.values(designBill(jd)).reduce((t, q) => t + q, 0);
    if (n !== j.blocks) fail(`jobDesign ${j.stage}.${j.index}: ${n} blocks, the job has ${j.blocks}`);
  }
  let r = d;
  for (let turn = 0; turn < 4; turn++) {
    const bad = badStairs(r);
    if (bad.length) fail(`turn ${turn}: ${bad.length} roof stairs not facing uphill, e.g. ${bad.slice(0, 3).join('; ')}`);
    if (out && turn < 2 && scale >= 2) fs.writeFileSync(path.join(out, `${d.name}_r${turn}.json`), JSON.stringify(r));
    r = quarter(r);
  }
  if (JSON.stringify(r.layers) !== JSON.stringify(d.layers) || JSON.stringify(r.palette) !== JSON.stringify(d.palette)) fail('four quarter turns do not give the design back');
  const shut = shutIn(d);
  if (shut) fail(`${shut} floor cells not reached on foot from outside`);
}
console.log(failures ? `FAIL: ${failures} problems` : 'OK: every preset and scale passed');
process.exit(failures ? 1 : 0);
