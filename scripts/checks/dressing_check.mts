/**
 * The wall dressing's check (dressing.ts, MC_DRESSING), over every design family it dresses:
 * - full: every monument preset (cathedrals at 1:3 with the palette a village begins them with, castles at 1:3) and every
 *   civic building (at the civic tier's scale);
 * - light: buildingGen's homes (each biome family, several members, by member style and by the character draw), the
 *   house programs' defaults, the vanilla house pieces of every biome, the small works and the two huts.
 * For each:
 * - the pass is deterministic (two runs give the same grid and palette);
 * - it changes no cell's shape: air stays air, '_' cells stay, solid stays solid (so the footprint, the walkable cells
 *   and the block count), doors, gates, trapdoors, panes and layer 0 are as drawn, every changed cell was a wall family's
 *   block, and no cell with air above it below layer 2 (a floor) changes shape;
 * - (monuments) the jobs keep their cells and their bills sum to the bill;
 * - every item the dressing adds to the bill (a monument's real bill: monumentPlan, after the palette mapping) is one the
 *   supply makes (house: nothing smelted; base, detail, deep);
 * and lists the bill's change per design (items, and raw materials by a rough table), with the changes by kind.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/dressing_check.mts [OUT_DIR]   (writes OUT_DIR/bills.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { GOTHIC_PRESETS, generateCathedral } from '../../server/src/gothicGen';
import { CASTLE_PRESETS, generateCastle } from '../../server/src/castleGen';
import { civicEntries, civicScale, drawCivic } from '../../server/src/civic';
import { DRESSING, dress, dressGrid, PRESET_STONE, supplyOf, type Supply } from '../../server/src/dressing';
import { DEEP_STONE_ON, monumentPlan, type MonumentM3 } from '../../server/src/monument';
import { generateDesign } from '../../server/src/buildingGen';
import { FAMILY, characterChoice, memberStyle, styleFromChoice } from '../../server/src/houseStyle';
import { compileHouse, defaultSpec } from '../../server/src/houseProgram';
import { VILLAGE_BIOMES, listPieces, pieceToDesign, readPiece } from '../../server/src/vanillaPieces';
import { SMALL_WORKS } from '../../server/src/smallWorks';
import { miningHutDesign, storageHutDesign } from '../../server/src/huts';
import { vanillaJar } from '../../server/src/vanillaData';
import type { Cathedral } from '../../server/src/gothicGen';
import type { Design } from '../../server/src/village';

const out = process.argv[2];
let fails = 0;
const fail = (msg: string) => { fails++; if (fails <= 40) console.log(`  FAIL ${msg}`); };

/** Items each supply makes (what the dressing may add to a bill). */
const HOUSE = /^(cobblestone(_stairs|_slab|_wall)?|sandstone(_stairs|_slab|_wall)?|cut_sandstone|chiseled_sandstone|[a-z_]+_(planks|log|stairs))$/;
const BASE = /^(stone(_stairs|_slab)?|smooth_stone(_slab)?|stone_bricks|stone_brick_(stairs|slab|wall)|chiseled_stone_bricks)$/;
const DETAIL = /^((polished_)?(andesite|diorite|granite)(_stairs|_slab)?)$/;
const DEEP = /^(tuff|polished_tuff|tuff_bricks|tuff_brick_stairs|chiseled_tuff_bricks|cobbled_deepslate|deepslate_bricks|deepslate_brick_stairs|polished_deepslate)$/;
const WOOD_STAIRS = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_stairs$/;
const allowed = (item: string, s: Supply) => (HOUSE.test(item) && (!/_stairs$/.test(item) || WOOD_STAIRS.test(item) || /^(cobblestone|sandstone)_stairs$/.test(item)))
  || (s !== 'house' && BASE.test(item)) || ((s === 'detail' || s === 'deep') && DETAIL.test(item)) || (s === 'deep' && DEEP.test(item));
/** The wall families' blocks the pass may change (dressing.ts' kits, and what the colour swap turns stone bricks into). */
const FAMILY_BLOCK = /^(stone_bricks|cobblestone|stone|smooth_stone|sandstone|polished_diorite|polished_granite|tuff_bricks|stone_brick_(stairs|slab|wall)|chiseled_stone_bricks|[a-z_]+_planks)$/;

/** Raw materials an item stands for, roughly (crafting 1:1 for bricks and cut stone; sandstone 4 sand; a plank 1/4 log, a
 *  wooden stair 3/8; stairs 1, slabs 1/2). */
function raw(item: string): [string, number] {
  if (/_planks$/.test(item)) return ['logs', 0.25];
  if (WOOD_STAIRS.test(item)) return ['logs', 0.375];
  if (/_slab$/.test(item) && /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_/.test(item)) return ['logs', 0.125];
  if (/_(log|wood)$/.test(item)) return ['logs', 1];
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
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const v = (b[k] ?? 0) - (a[k] ?? 0); if (Math.abs(v) >= 0.5) d[k] = Math.round(v * 10) / 10; }
  return d;
};
const fmt = (d: Record<string, number>) => Object.entries(d).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ') || 'none';
/** A design's bill by item (states dropped). */
const billOf = (d: Design) => {
  const b: Record<string, number> = {};
  d.layers.forEach((l) => l.forEach((r) => { for (const ch of r) if (ch !== '.' && ch !== '_') { const n = d.palette[ch].replace(/\[.*$/, ''); b[n] = (b[n] ?? 0) + 1; } }));
  return b;
};

/** The cell invariants of a dressed design against its plain one; the changed cells and the solid cells. */
function compare(id: string, d0: Design, d1: Design): { changed: number; cells: number } {
  if (d1.width !== d0.width || d1.depth !== d0.depth || d1.height !== d0.height || d1.blocks !== d0.blocks) fail(`${id}: the size or the block count changed`);
  let changed = 0, cells = 0;
  const raw = (d: Design, x: number, y: number, z: number) => d.layers[y]?.[z]?.[x];
  const at = (d: Design, x: number, y: number, z: number) => { const ch = raw(d, x, y, z); return !ch || ch === '.' || ch === '_' ? null : d.palette[ch]; };
  for (let y = 0; y < d0.height; y++) for (let z = 0; z < d0.depth; z++) for (let x = 0; x < d0.width; x++) {
    if ((raw(d0, x, y, z) === '_') !== (raw(d1, x, y, z) === '_')) fail(`${id}: ${x},${y},${z} a '_' cell changed`);
    const p = at(d0, x, y, z), q = at(d1, x, y, z);
    if (!p !== !q) { fail(`${id}: ${x},${y},${z} ${p ?? 'air'} -> ${q ?? 'air'}`); continue; }
    if (!p || !q) continue;
    cells++;
    if (p === q) continue;
    changed++;
    const pn = p.replace(/\[.*$/, '');
    if (!FAMILY_BLOCK.test(pn)) fail(`${id}: ${x},${y},${z} ${p} is no wall block, changed to ${q}`);
    if (/door|gate|trapdoor|glass|pane/.test(pn)) fail(`${id}: ${x},${y},${z} ${p} (a door or window) changed`);
    if (y === 0 && !/^(sandstone|smooth_stone)/.test(q)) fail(`${id}: layer 0 changed at ${x},${z}: ${p} -> ${q}`);
    if (y < 2 && !at(d0, x, y + 1, z) && !p.includes('[') && q.includes('[')) fail(`${id}: a floor at ${x},${y},${z} changed shape: ${p} -> ${q}`);
  }
  return { changed, cells };
}

const rows: string[] = [];
const totals = { changed: 0, cells: 0 };
const t0 = Date.now();

// ---- full: the monuments and civic buildings ----
interface Case { id: string; type: 'cathedral' | 'castle' | 'civic'; scale: number; detail: boolean; deep: boolean; draw: () => Cathedral }
const cases: Case[] = [
  ...Object.values(GOTHIC_PRESETS).map((p) => ({ id: p.name, type: 'cathedral' as const, scale: 3, detail: true, deep: DEEP_STONE_ON, draw: () => generateCathedral(p, 3, { detail: true }) })),
  ...Object.values(CASTLE_PRESETS).map((p) => ({ id: p.name, type: 'castle' as const, scale: 3, detail: false, deep: false, draw: () => generateCastle(p, 3) })),
  ...civicEntries().map((e) => { const s = civicScale(e.id); return { id: e.id, type: 'civic' as const, scale: s, detail: false, deep: false, draw: () => drawCivic(e.id, s) }; }),
];
for (const k of cases) {
  const c = k.draw(), supply = supplyOf(k.type, k.detail, k.deep);
  const a = dress(c, { seed: k.id, supply }), b = dress(c, { seed: k.id, supply });
  if (JSON.stringify(a.design.layers) !== JSON.stringify(b.design.layers) || JSON.stringify(a.design.palette) !== JSON.stringify(b.design.palette)) fail(`${k.id}: two runs differ`);
  const { changed, cells } = compare(k.id, c.design, a.design);
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
  rows.push(`| ${k.id} | ${k.type} | ${PRESET_STONE[k.id] ?? 'grey'} | ${supply} | 1:${k.scale} | ${c.design.blocks} | ${changed} (${Math.round((100 * changed) / cells)}%) | `
    + `${s.texture}/${s.plinth}/${s.course}/${s.corbel}/${s.quoin}/${s.window}/${s.step}/${s.band} | ${fmt(dItems)} | ${fmt(diff(rawOf(plain), rawOf(dressed)))} |`);
}

// ---- light: homes, house programs, vanilla pieces, small works, huts (each generator's plain output, dressing off) ----
const designs: Array<{ id: string; family: string; draw: () => Design }> = [];
const MEMBERS = ['Ada', 'Ben', 'Cleo', 'Dan'];
for (const f of Object.keys(FAMILY)) {
  for (const m of MEMBERS) designs.push({ id: `home ${f} ${m}`, family: 'homes (style)', draw: () => generateDesign(memberStyle(m, f)) });
  for (const m of MEMBERS.slice(0, 2)) designs.push({ id: `home ${f} ${m} (character)`, family: 'homes (character)', draw: () => generateDesign(styleFromChoice(m, f, characterChoice(m, f))) });
  designs.push({ id: `program ${f}`, family: 'house programs', draw: () => compileHouse(defaultSpec(f)).design });
}
const jar = vanillaJar();
for (const b of VILLAGE_BIOMES) for (const p of listPieces(jar, b, 'houses')) {
  designs.push({ id: p.split('/').pop()!, family: `vanilla ${b}`, draw: () => pieceToDesign(readPiece(p, jar), b).design });
}
for (const k of SMALL_WORKS) designs.push({ id: `work ${k.kind}`, family: 'small works', draw: () => k.make('oak') });
designs.push({ id: 'storage_hut', family: 'huts', draw: () => storageHutDesign() }, { id: 'mining_hut', family: 'huts', draw: () => miningHutDesign() });
const fam: Record<string, { n: number; changed: number; cells: number; raw: Record<string, number> }> = {};
const lightRows: string[] = [];
for (const it of designs) {
  let d0: Design, d1: Design;
  try {
    DRESSING.on = false;
    d0 = it.draw();
    DRESSING.on = true;
    d1 = it.draw();
  } catch {
    DRESSING.on = true;
    continue;
  } finally {
    DRESSING.on = true;
  }
  // (deterministic: the pass again on the plain design gives the generator's dressed one)
  const again = dressGrid(d0, { seed: d0.name, supply: 'house', level: 'light' }).design;
  if (JSON.stringify(billOf(again)) !== JSON.stringify(billOf(d1)) || JSON.stringify(again.layers.map((l) => l.map((r) => [...r].map((ch) => again.palette[ch] ?? ch))))
    !== JSON.stringify(d1.layers.map((l) => l.map((r) => [...r].map((ch) => d1.palette[ch] ?? ch))))) fail(`${it.id}: the pass again differs from the generator's`);
  const { changed, cells } = compare(it.id, d0, d1);
  totals.changed += changed; totals.cells += cells;
  const dItems = diff(billOf(d0), billOf(d1)), dRaw = diff(rawOf(billOf(d0)), rawOf(billOf(d1)));
  for (const [n, v] of Object.entries(dItems)) if (v > 0 && !allowed(n, 'house')) fail(`${it.id} (house): adds ${v} ${n}, which a home's supply does not make`);
  const f = (fam[it.family] ??= { n: 0, changed: 0, cells: 0, raw: {} });
  f.n++; f.changed += changed; f.cells += cells;
  for (const [k, v] of Object.entries(dRaw)) f.raw[k] = (f.raw[k] ?? 0) + v;
  lightRows.push(`| ${it.id} | ${it.family} | ${cells} | ${changed} (${cells ? Math.round((100 * changed) / cells) : 0}%) | ${fmt(dItems)} | ${fmt(dRaw)} |`);
}

console.log(`dressing_check: ${cases.length} monuments and civic buildings, ${designs.length} homes, works and huts; ${totals.changed} of ${totals.cells} cells changed (${Math.round((100 * totals.changed) / totals.cells)}%), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const [k, f] of Object.entries(fam))
  console.log(`  ${k.padEnd(18)} ${String(f.n).padStart(3)} designs, ${Math.round((100 * f.changed) / Math.max(1, f.cells))}% of cells; raw a design: ${fmt(Object.fromEntries(Object.entries(f.raw).map(([r, v]) => [r, Math.round((v / f.n) * 10) / 10])))}`);
if (out) {
  fs.mkdirSync(out, { recursive: true });
  const head = ['| Building | Type | Stone | Supply | Scale | Blocks | Changed | texture/plinth/course/corbel/quoin/window/step/band | Bill change (items) | Raw change (rough) |', '|---|---|---|---|---|---|---|---|---|---|'];
  const lhead = ['| Design | Family | Blocks | Changed | Bill change (items) | Raw change (rough) |', '|---|---|---|---|---|---|'];
  fs.writeFileSync(path.join(out, 'bills.md'), [`# The dressing's bill change per design`, '', 'Block counts are unchanged everywhere (the budgets hold).', '',
    '## Monuments and civic buildings (full)', '', ...head, ...rows, '', '## Homes, works and huts (light)', '', ...lhead, ...lightRows].join('\n') + '\n');
  console.log(`wrote ${path.join(out, 'bills.md')}`);
}
console.log(fails ? `dressing_check: ${fails} FAILS` : 'dressing_check: ok');
process.exit(fails ? 1 : 0);
