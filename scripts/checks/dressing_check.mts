/**
 * The wall dressing's check (dressing.ts, MC_DRESSING): for every monument preset (cathedrals at 1:3 with the palette a
 * village begins them with, castles at 1:3) and every civic building (at the civic tier's scale):
 * - the pass is deterministic (two runs give the same grid and palette);
 * - it changes no cell's shape: air stays air and solid stays solid (so the footprint, the walkable cells and the block
 *   count), doors, gates, trapdoors, panes and layer 0 are as drawn, every changed cell was a wall family's block, and
 *   no cell with air above it below layer 2 (a floor) changes;
 * - the jobs keep their cells and their bills sum to the bill;
 * - every block the dressing adds to the record's real bill (monumentPlan, after the palette mapping) is one the
 *   record's supply makes (base, detail, deep);
 * and lists the bill's change per preset (items, and raw materials by a rough table), with the changes by kind.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/dressing_check.mts [OUT_DIR]   (writes OUT_DIR/bills.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { GOTHIC_PRESETS, generateCathedral } from '../../server/src/gothicGen';
import { CASTLE_PRESETS, generateCastle } from '../../server/src/castleGen';
import { civicEntries, civicScale, drawCivic } from '../../server/src/civic';
import { dress, PRESET_STONE, supplyOf, type Supply } from '../../server/src/dressing';
import { DEEP_STONE_ON, monumentPlan, type MonumentM3 } from '../../server/src/monument';
import type { Cathedral } from '../../server/src/gothicGen';

const out = process.argv[2];
let fails = 0;
const fail = (msg: string) => { fails++; if (fails <= 40) console.log(`  FAIL ${msg}`); };

/** Blocks each supply makes (what the dressing may add to a bill). */
const BASE = /^(cobblestone(_stairs|_slab|_wall)?|stone(_stairs|_slab)?|smooth_stone(_slab)?|stone_bricks|stone_brick_(stairs|slab|wall)|chiseled_stone_bricks|sandstone(_stairs|_slab|_wall)?|cut_sandstone|chiseled_sandstone)$/;
const DETAIL = /^((polished_)?(andesite|diorite|granite)(_stairs|_slab)?)$/;
const DEEP = /^(tuff|polished_tuff|tuff_bricks|tuff_brick_stairs|chiseled_tuff_bricks|cobbled_deepslate|deepslate_bricks|deepslate_brick_stairs|polished_deepslate)$/;
const allowed = (item: string, s: Supply) => BASE.test(item) || (s !== 'base' && DETAIL.test(item)) || (s === 'deep' && DEEP.test(item));
/** The wall families' blocks the pass may change (dressing.ts' kits, and what the colour swap turns stone bricks into). */
const FAMILY = /^(stone_bricks|cobblestone|stone|smooth_stone|sandstone|polished_diorite|polished_granite|tuff_bricks|stone_brick_(stairs|slab|wall)|chiseled_stone_bricks)$/;

/** Raw materials an item stands for, roughly (crafting 1:1 for bricks and cut stone; sandstone 4 sand; stairs 1, slabs 1/2). */
function raw(item: string): [string, number] {
  const n = item.replace(/_(stairs|wall)$/, '').replace(/_slab$/, '');
  const half = /_slab$/.test(item) ? 0.5 : 1;
  if (/^(cobblestone|stone|smooth_stone|stone_brick|stone_bricks|chiseled_stone_bricks)$/.test(n)) return ['cobblestone', half];
  if (/sandstone/.test(n)) return ['sand', 4 * half];
  if (/andesite/.test(n)) return ['andesite', half];
  if (/diorite/.test(n)) return ['diorite', half];
  if (/granite/.test(n)) return ['granite', half];
  if (/tuff/.test(n)) return ['tuff', half];
  if (/deepslate/.test(n)) return ['cobbled_deepslate', half];
  return [item, 1];
}
const rawOf = (bill: Record<string, number>) => {
  const r: Record<string, number> = {};
  for (const [k, q] of Object.entries(bill)) { const [n, f] = raw(k); r[n] = (r[n] ?? 0) + q * f; }
  return r;
};
const diff = (a: Record<string, number>, b: Record<string, number>) => {
  const d: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const v = (b[k] ?? 0) - (a[k] ?? 0); if (Math.abs(v) >= 0.5) d[k] = Math.round(v); }
  return d;
};
const fmt = (d: Record<string, number>) => Object.entries(d).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ') || 'none';

interface Case { id: string; type: 'cathedral' | 'castle' | 'civic'; scale: number; detail: boolean; deep: boolean; draw: () => Cathedral }
const cases: Case[] = [
  ...Object.values(GOTHIC_PRESETS).map((p) => ({ id: p.name, type: 'cathedral' as const, scale: 3, detail: true, deep: DEEP_STONE_ON, draw: () => generateCathedral(p, 3, { detail: true }) })),
  ...Object.values(CASTLE_PRESETS).map((p) => ({ id: p.name, type: 'castle' as const, scale: 3, detail: false, deep: false, draw: () => generateCastle(p, 3) })),
  ...civicEntries().map((e) => { const s = civicScale(e.id); return { id: e.id, type: 'civic' as const, scale: s, detail: false, deep: false, draw: () => drawCivic(e.id, s) }; }),
];

const rows: string[] = [];
const totals = { changed: 0, cells: 0 };
const t0 = Date.now();
for (const k of cases) {
  const c = k.draw(), supply = supplyOf(k.type, k.detail, k.deep);
  const a = dress(c, { seed: k.id, supply }), b = dress(c, { seed: k.id, supply });
  if (JSON.stringify(a.design.layers) !== JSON.stringify(b.design.layers) || JSON.stringify(a.design.palette) !== JSON.stringify(b.design.palette)) fail(`${k.id}: two runs differ`);
  const d0 = c.design, d1 = a.design;
  if (d1.width !== d0.width || d1.depth !== d0.depth || d1.height !== d0.height || d1.blocks !== d0.blocks) fail(`${k.id}: the size or the block count changed`);
  let changed = 0, cells = 0;
  const at = (d: typeof d0, x: number, y: number, z: number) => { const ch = d.layers[y]?.[z]?.[x]; return !ch || ch === '.' ? null : d.palette[ch]; };
  for (let y = 0; y < d0.height; y++) for (let z = 0; z < d0.depth; z++) for (let x = 0; x < d0.width; x++) {
    const p = at(d0, x, y, z), q = at(d1, x, y, z);
    if (!p !== !q) { fail(`${k.id}: ${x},${y},${z} ${p ?? 'air'} -> ${q ?? 'air'}`); continue; }
    if (!p || !q) continue;
    cells++;
    if (p === q) continue;
    changed++;
    const pn = p.replace(/\[.*$/, '');
    if (!FAMILY.test(pn)) fail(`${k.id}: ${x},${y},${z} ${p} is no wall block, changed to ${q}`);
    if (/door|gate|trapdoor|glass|pane/.test(pn)) fail(`${k.id}: ${x},${y},${z} ${p} (a door or window) changed`);
    if (y === 0 && !/^(sandstone|smooth_stone)/.test(q)) fail(`${k.id}: layer 0 changed at ${x},${z}: ${p} -> ${q}`);
    if (y < 2 && !at(d0, x, y + 1, z) && !p.includes('[') && q.includes('[')) fail(`${k.id}: a floor at ${x},${y},${z} changed shape: ${p} -> ${q}`);
  }
  totals.changed += changed; totals.cells += cells;
  for (const [i, j] of a.jobs.entries()) if (j.blocks !== c.jobs[i].blocks || j.x0 !== c.jobs[i].x0 || j.y1 !== c.jobs[i].y1) fail(`${k.id}: job ${i} changed`);
  const sum: Record<string, number> = {};
  for (const j of a.jobs) for (const [n, q] of Object.entries(j.bill)) sum[n] = (sum[n] ?? 0) + q;
  if (JSON.stringify(Object.entries(sum).sort()) !== JSON.stringify(Object.entries(a.bill).sort())) fail(`${k.id}: the jobs' bills do not sum to the bill`);
  // the record's real bill, plain and dressed (monumentPlan: the palette mapping, the village wood)
  const rec = (dressed: boolean): MonumentM3 => ({
    preset: k.id, scale: k.scale, palette: 'full', wood: 'oak', at: 0, state: 'building', done: [], yard: {}, stages: [],
    ...(k.type !== 'cathedral' ? { type: k.type } : {}), ...(k.detail ? { detail: true } : {}), ...(k.deep ? { deep: true } : {}), ...(dressed ? { dress: true } : {}),
  });
  const plain = monumentPlan(rec(false)).bill, dressed = monumentPlan(rec(true)).bill;
  const dItems = diff(plain, dressed);
  for (const [n, v] of Object.entries(dItems)) if (v > 0 && !allowed(n, supply)) fail(`${k.id} (${supply}): adds ${v} ${n}, which its supply does not make`);
  const s = a.dressStats;
  rows.push(`| ${k.id} | ${k.type} | ${PRESET_STONE[k.id] ?? 'grey'} | ${supply} | 1:${k.scale} | ${d0.blocks} | ${changed} (${Math.round((100 * changed) / cells)}%) | `
    + `${s.texture}/${s.plinth}/${s.course}/${s.corbel}/${s.quoin}/${s.window}/${s.step}/${s.band} | ${fmt(dItems)} | ${fmt(diff(rawOf(plain), rawOf(dressed)))} |`);
}
const head = ['| Building | Type | Stone | Supply | Scale | Blocks | Changed | texture/plinth/course/corbel/quoin/window/step/band | Bill change (items) | Raw change (rough) |', '|---|---|---|---|---|---|---|---|---|---|'];
console.log(`dressing_check: ${cases.length} buildings, ${totals.changed} of ${totals.cells} cells changed (${Math.round((100 * totals.changed) / totals.cells)}%), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const r of rows.filter((r) => /notre_dame|cologne|seville|milan|strasbourg|conwy|malbork|carcassonne|white_tower|lavenham_guildhall|tower_of_hercules|threave/.test(r))) console.log(r.slice(0, 400));
if (out) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'bills.md'), [`# The dressing's bill change per preset`, '', `${cases.length} buildings; the block count of each is unchanged (the budgets hold).`, '', ...head, ...rows].join('\n') + '\n');
  console.log(`wrote ${path.join(out, 'bills.md')}`);
}
console.log(fails ? `dressing_check: ${fails} FAILS` : 'dressing_check: ok');
process.exit(fails ? 1 : 0);
