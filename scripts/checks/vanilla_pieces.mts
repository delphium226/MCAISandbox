/**
 * Vanilla village pieces as designs, checked offline (phase D, vanilla villages, V2.1; no server): every house piece of
 * each biome read from the local jar, imported (vanillaPieces.ts: cut at the entrance door, turned to face south,
 * substituted), validated as a stored design is (validateDesign with block states and a door), then checked as the
 * architect's survival designs are (tieredBrain's design()): every block obtainable and easy to gather, no workstations,
 * the budget (HOUSE_UNITS, or LANDMARK_UNITS for a library or temple), the furnace runs. Prints a line per piece and a
 * summary per biome (how many import, how many pass, gather units), and the substitutions made.
 * Usage: node_modules/.bin/tsx scripts/checks/vanilla_pieces.mts [BIOME ...]
 * Env: KIND (default houses; town_centers: centreToDesign, no door, street connectors listed), PIECE (one piece path, e.g. plains/houses/plains_small_house_1:
 *      prints its layers), OUT=DIR (each design as JSON plus index.json for scripts/contact_sheet.py and
 *      rotate_design.py --design; keep DIR out of the repo: the pieces are Mojang's), JAR (default mc/server's).
 */
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, elevations, isLandmark, lintDesign, validateDesign } from '../../server/src/designs';
import type { Design } from '../../server/src/village';
import { Materials, designBill, hardToGather, inWood, woodPart } from '../../server/src/mineflayer/mcMaterials';
import { DEFAULT_JAR, VILLAGE_BIOMES, centreToDesign, listPieces, pieceToDesign, readPiece } from '../../server/src/vanillaPieces';

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const JAR = process.env.JAR ?? DEFAULT_JAR;
const KIND = process.env.KIND ?? 'houses';
const OUT = process.env.OUT;
const STATIONS = /^(furnace|blast_furnace|smoker|crafting_table|chest|barrel|anvil)$/; // tieredBrain.ts
// mcWorld.ts isPlaceable: states must be the block's own
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
/**
 * As mcWorld.materialTasks counts it (a crafting table, and a furnace when something is smelted), in one wood kind as a
 * village builds (the piece's commonest: a spruce house's oak door is made of spruce).
 */
function cost(d: Design) {
  const raw = designBill(d);
  const kinds: Record<string, number> = {};
  for (const [n, q] of Object.entries(raw)) { const w = woodPart(n); if (w) kinds[w.kind] = (kinds[w.kind] ?? 0) + q; }
  const bill = inWood(raw, Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0]);
  let plan = materials.plan(bill);
  plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  const hard = hardToGather(plan.gather);
  return { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts, problems: [...plan.problems, ...hard.map((h) => `hard to gather: ${h}`)], gather: plan.gather };
}

interface Row { biome: string; name: string; ok: boolean; why: string; units?: number; budget?: number; size?: string; blocks?: number; file?: string; notes: string[] }
const rows: Row[] = [];
const subs: Record<string, number> = {};
const biomes = process.argv.slice(2).length ? process.argv.slice(2) : [...VILLAGE_BIOMES];
const pieces = process.env.PIECE ? [process.env.PIECE] : biomes.flatMap((b) => listPieces(JAR, b, KIND));
if (OUT) fs.mkdirSync(OUT, { recursive: true });

for (const p of pieces) {
  const biome = p.split('/')[0], name = p.split('/').pop()!;
  const row: Row = { biome, name, ok: false, why: '', notes: [] };
  rows.push(row);
  let imported;
  const centre = KIND === 'town_centers';
  try {
    if (centre) {
      const c = centreToDesign(readPiece(p, JAR), biome);
      imported = { ...c, notes: [`streets ${c.connectors.map((k) => `${k.side}@${k.offset}`).join(' ')}`, ...(c.water ? ['water'] : [])] };
    } else imported = pieceToDesign(readPiece(p, JAR), biome);
  } catch (e) {
    row.why = `import: ${(e as Error).message}`;
    continue;
  }
  for (const [k, n] of Object.entries(imported.substitutions)) subs[k] = (subs[k] ?? 0) + n;
  row.notes.push(...imported.notes);
  const d0 = imported.design;
  row.size = `${d0.width}x${d0.depth}x${d0.height}`;
  const checked = validateDesign({ ...d0 } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable, states: true, requireDoor: !centre });
  if (!checked.design) {
    row.why = `invalid: ${checked.errors.join('; ')}`;
    continue;
  }
  const d = { ...checked.design, description: d0.description };
  if (checked.fixes?.length) row.notes.push(`fixed: ${checked.fixes.join(', ')}`);
  row.blocks = d.blocks;
  const c = cost(d);
  row.units = c.units;
  const landmark = isLandmark(d.name);
  row.budget = landmark ? LANDMARK_UNITS : HOUSE_UNITS;
  const errors: string[] = [...c.problems];
  const stations = [...new Set(Object.values(d.palette).map((b) => b.replace(/\[.*$/, '')).filter((b) => STATIONS.test(b)))];
  if (stations.length) errors.push(`workstations ${stations.join(', ')}`);
  if (c.units > row.budget) errors.push(`over budget (${c.units} of ${row.budget})`);
  if (c.smelts > MAX_SMELTS) errors.push(`${c.smelts} furnace runs (at most ${MAX_SMELTS})`);
  const lint = lintDesign(d);
  if (lint.strong.length) row.notes.push(`lint: ${lint.strong.join('; ')}`);
  row.ok = !errors.length;
  row.why = errors.join('; ');
  if (process.env.PIECE) {
    console.log(JSON.stringify(d.palette, null, 1));
    d.layers.forEach((l, i) => console.log(`layer ${i}\n${l.map((r) => '  ' + r).join('\n')}`));
    console.log(elevations(d));
    console.log('gather', c.gather, 'smelts', c.smelts);
  }
  if (OUT) {
    row.file = `${biome}__${name}.json`;
    fs.writeFileSync(path.join(OUT, row.file), JSON.stringify(d));
  }
}

for (const b of [...new Set(rows.map((r) => r.biome))]) {
  const rs = rows.filter((r) => r.biome === b);
  console.log(`\n== ${b} (${KIND}): ${rs.length} pieces`);
  for (const r of rs)
    console.log(`  ${r.ok ? 'PASS' : 'fail'} ${r.name.padEnd(30)} ${(r.size ?? '').padEnd(9)} ${String(r.blocks ?? '').padStart(4)} blocks ${r.units !== undefined ? `${String(r.units).padStart(4)}/${r.budget} units` : '               '}  ${r.why}${r.notes.length ? `  [${r.notes.join('; ')}]` : ''}`.slice(0, 400));
}
console.log('\nsummary: biome, pieces, imported, valid, pass, gather units of the passing (min/median/max), why the rest failed');
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
for (const b of [...new Set(rows.map((r) => r.biome))]) {
  const rs = rows.filter((r) => r.biome === b);
  const imported = rs.filter((r) => !r.why.startsWith('import:'));
  const valid = imported.filter((r) => !r.why.startsWith('invalid:'));
  const pass = rs.filter((r) => r.ok);
  const u = pass.map((r) => r.units!);
  const reasons: Record<string, number> = {};
  for (const r of rs.filter((x) => !x.ok)) {
    const k = r.why.startsWith('import:') ? r.why.slice(0, 40) : r.why.startsWith('invalid:') ? `invalid: ${r.why.slice(9, 50)}` : r.why.split('; ').map((w) => w.replace(/\(.*\)/, '').trim()).join('; ').slice(0, 60);
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  console.log(`  ${b.padEnd(8)} ${rs.length} pieces, ${imported.length} imported, ${valid.length} valid, ${pass.length} pass; units ${u.length ? `${Math.min(...u)}/${median(u)}/${Math.max(...u)}` : '-'}`);
  for (const [k, n] of Object.entries(reasons).sort((x, y) => y[1] - x[1])) console.log(`      ${n} x ${k}`);
}
console.log('\nsubstitutions (all pieces):');
console.log(Object.entries(subs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
if (OUT) {
  const index = rows.filter((r) => r.file).map((r) => ({
    file: r.file, group: r.biome, name: r.name, ok: r.ok,
    caption: [`${r.size}, ${r.blocks} blocks`, `${r.units} of ${r.budget} units`, r.ok ? 'pass' : r.why.slice(0, 40)],
  }));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`\nwrote ${index.length} designs and index.json to ${OUT}`);
}
