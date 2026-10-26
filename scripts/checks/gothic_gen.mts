/**
 * The Gothic cathedral generator checked offline (the monument, M0; server/src/gothicGen.ts; no server): every preset at
 * 1:4 and 1:2 (and Notre-Dame at 1:1), generated, validated as the architect's designs are (validateDesign with
 * Minecraft's blocks and states, sizes unlimited, no door rule: its portals are open arches), and checked:
 * - the bill: designBill (what a build charges) equals the generator's, and Notre-Dame's blocks fall in a range: 1:2
 *   6-22k (the report's shell estimate was ~12.5k, its detailed one ~20k; the generator's one-block walls and hollow
 *   towers came to ~8k), 1:4 a church of 2-6k;
 * - the stages and jobs: the eight stages and the jobs each sum to the whole bill, every cell in exactly one job, jobs
 *   at most 800 blocks and (but a stage's last) at least 300, and every job's jobDesign holding just its cells;
 * - every roof stair faces uphill (the cell on its facing side is higher or holds a block at its layer, the one behind
 *   it nothing above), in every quarter turn as build_design turns it (turnState and its grid turn), and four turns
 *   give the design back;
 * - the floor is walkable: every floor cell with two cells of air above it is reached on foot from outside (four
 *   neighbours, a step of one up or down at most), so no member is shut in (the report's [stuck] risk).
 * With --detail (or GOTHIC_DETAIL=1, as scripts/checks/gothic_detail.mts runs it; #162's tier 2) every case is drawn with
 * `detail` and checked the same way, and also: nine stages; capitals, arch shoulders, the patterned floor, lanterns on
 * chains, banners and (with towers) the bell are there; the windows hold at least six colours; and the bill planned with
 * the stonecutter (Materials `cut`) cuts every stonecutter piece (none crafted at the table) and can be had but for the
 * candles' string (the merchant's) and the bell (no recipe).
 * Usage: node_modules/.bin/tsx scripts/checks/gothic_gen.mts [--detail] [OUT_DIR: also writes each design and its quarter
 *        turn as JSON for scripts/render_design.py]
 */
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { GOTHIC_PRESETS, GOTHIC_STAGES, generateCathedral, jobDesign } from '../../server/src/gothicGen';
import { Materials, chargedItem, cutOptions } from '../../server/src/mineflayer/mcMaterials';
import { turnState, validateDesign } from '../../server/src/designs';
import type { Design } from '../../server/src/village';
import { designBill } from '../../server/src/mineflayer/mcMaterials';

const DETAIL = process.argv.includes('--detail') || process.env.GOTHIC_DETAIL === '1';

const reg = minecraftData('26.1');
const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  if (!m) return false;
  const b = reg.blocksByName[m[1]];
  if (!b || !reg.itemsByName[chargedItem(m[1])]) return false;
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
          const ok = inGrid(u, v) ? stand(w, u, v) && (dy <= 0 || !block(d, y + 2, x, z)) : w === 0 && u >= -1 && v >= -1 && u <= d.width && v <= d.depth;
          if (!ok) continue;
          seen.add(k); next.push([w, u, v]);
        }
    q = next;
  }
  let n = 0;
  for (let x = 0; x < d.width; x++) for (let z = 0; z < d.depth; z++) if (stand(1, x, z) && !seen.has(`1,${x},${z}`)) n++;
  return n;
}

const out = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (out) fs.mkdirSync(out, { recursive: true });
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };
const cases: Array<[string, number]> = [];
for (const name of Object.keys(GOTHIC_PRESETS)) cases.push([name, 4], [name, 2]);
cases.push(['notre_dame', 1]);
for (const [name, scale] of cases) {
  const t0 = Date.now();
  const c = generateCathedral(GOTHIC_PRESETS[name], scale, { detail: DETAIL });
  const d = c.design;
  const total = d.blocks;
  const top = Object.entries(c.bill).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`${name} 1:${scale}: ${d.width}x${d.depth}x${d.height}, ${total} blocks, ${c.jobs.length} jobs (${Date.now() - t0} ms); ${top}`);
  console.log(`  stages: ${c.stages.map((n, i) => `${i + 1} ${c.stageNames[i]} ${n}`).join('; ')}`);
  if (!DETAIL && c.stageNames !== GOTHIC_STAGES) fail('the stages without detail are not GOTHIC_STAGES');
  if (DETAIL) {
    if (c.stageNames.length !== 9) fail(`${c.stageNames.length} stages with detail, not 9`);
    const blocks = [...new Set(Object.values(d.palette))];
    const n = (re: RegExp) => Object.entries(c.bill).filter(([k]) => re.test(k)).reduce((t, [, q]) => t + q, 0);
    for (const [what, re] of [['capitals', /^chiseled_stone_bricks$/], ['lanterns', /^lantern$/], ['chains', /^iron_chain$/], ['banners', /_banner$/], ['diorite floor', /^polished_diorite$/]] as Array<[string, RegExp]>)
      if (!n(re)) fail(`no ${what}`);
    // (1:4's arches are too low for shoulders that leave an opening two high)
    if (scale <= 2 && !blocks.some((b) => /^stone_brick_stairs\[.*half=top/.test(b))) fail('no arch shoulders (upside-down stairs)');
    if (GOTHIC_PRESETS[name].towers && !c.bill.bell) fail('no bell in the towers');
    const colours = new Set(Object.keys(c.bill).map((k) => /^(\w+)_stained_glass_pane$/.exec(k)?.[1]).filter(Boolean));
    if (colours.size < 6) fail(`${colours.size} window colours`);
    const p = new Materials(reg, { cut: true }).plan(c.bill, {});
    const cutItems = new Set([...cutOptions().keys()]);
    const tableCut = p.steps.filter((st) => st.do === 'craft' && !st.cut && cutItems.has(st.item) && !/^cobble/.test(st.item));
    if (tableCut.length) fail(`crafted at the table though the stonecutter makes them: ${tableCut.map((st) => st.item).join(', ')}`);
    const unexpected = p.problems.filter((q) => !/^string:/.test(q));
    if (unexpected.length) fail(`plan problems: ${unexpected.join('; ')}`);
    console.log(`  detail: ${blocks.length} blocks, ${colours.size} colours; ${['chiseled_stone_bricks', 'lantern', 'iron_chain', 'bell', 'candle'].map((k) => `${c.bill[k] ?? 0} ${k}`).join(', ')}, ${n(/_banner$/)} banners; cut ${p.steps.filter((st) => st.cut).reduce((t, st) => t + st.makes, 0)} at the stonecutter; gather ${Object.entries(p.gather).map(([k, q]) => `${q} ${k}`).join(', ')}`);
  }
  const { errors } = validateDesign({ ...d }, 'check', { isPlaceable, states: true, maxSide: 1000, maxLayers: 1000, requireDoor: false });
  for (const e of errors.slice(0, 5)) fail(`validateDesign: ${e}`);
  const bill = designBill(d);
  for (const k of new Set([...Object.keys(bill), ...Object.keys(c.bill)])) if ((bill[k] ?? 0) !== (c.bill[k] ?? 0)) fail(`bill ${k}: designBill ${bill[k]} vs ${c.bill[k]}`);
  if (name === 'notre_dame' && scale === 2 && (total < 6000 || total > 22000)) fail(`Notre-Dame 1:2 has ${total} blocks, outside 6-22k`);
  if (name === 'notre_dame' && scale === 4 && (total < 2000 || total > 6000)) fail(`Notre-Dame 1:4 has ${total} blocks, outside 2-6k`);
  if (c.stages.reduce((t, n) => t + n, 0) !== total) fail('stages do not sum to the design');
  if (c.jobs.reduce((t, j) => t + j.blocks, 0) !== total || c.cellJob.size !== total) fail('jobs do not sum to the design');
  c.jobs.forEach((j, i) => {
    const last = i === c.jobs.length - 1 || c.jobs[i + 1].stage !== j.stage;
    if (j.blocks > 800) fail(`job ${j.stage}.${j.index} has ${j.blocks} blocks`);
    if (j.blocks < 300 && !last) fail(`job ${j.stage}.${j.index} has only ${j.blocks} blocks`);
  });
  for (const j of c.jobs.filter((_, i) => i % 7 === 0)) {
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
console.log(failures ? `FAIL: ${failures} problems` : `OK: every preset and scale passed${DETAIL ? ' (detail)' : ''}`);
process.exit(failures ? 1 : 0);
