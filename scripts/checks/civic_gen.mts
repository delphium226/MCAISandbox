/**
 * The civic tier's generators checked offline (civic.ts, timberGen.ts, towerGen.ts; no server): every building of every
 * source drawn at the tier's scale (the largest under MC_CIVIC_BLOCKS), and checked:
 * - its blocks are Minecraft's (names and states, as castle_gen.mts checks the castle's) and items the village can get;
 * - the bill: the jobs' bills and the stages sum to the whole, every cell in exactly one job, jobs at most 450 blocks;
 * - the blocks are within the budget (or it is drawn at 1:4, the smallest), and the footprint within 72;
 * - an opening on the west face (x = 0, the site search's door side) at ground level;
 * - the monument's plan of it as a civic record (monument.ts' monumentPlan: the village wood swapped in, the bill again)
 *   matches, and the short list for a new village (timber only) and one with its mine (both ages) is as the rules say.
 * Prints a table (preset, kind, age, scale, size, blocks, jobs, stages) and the totals.
 * Usage: node_modules/.bin/tsx scripts/checks/civic_gen.mts [OUT_DIR: also writes each design as JSON for
 *        scripts/render_design.py; scripts/checks/civic_render.py draws them all on one sheet]
 */
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { CIVIC, civicEntries, civicOptions, civicScale, drawCivic } from '../../server/src/civic';
import { monumentPlan, newCivic } from '../../server/src/monument';
import type { Village } from '../../server/src/village';

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
// (what the village gathers or makes: wood, cobblestone and its smelted and cut forms, sand and sandstone, glass, the
// quarry's diorite and granite polished, torches)
const GETTABLE = /^(oak_(log|planks|fence|slab|stairs|trapdoor)|cobblestone(_stairs|_slab|_wall)?|stone(_bricks|_brick_stairs|_brick_slab|_brick_wall)?|smooth_stone|sandstone|cut_sandstone|glass(_pane)?|polished_(diorite|granite)|torch)$/;

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
let fails = 0;
const fail = (msg: string) => { fails++; console.log(`  FAIL ${msg}`); };
const rows: string[] = [];
let total = 0, jobsTotal = 0;
for (const e of civicEntries()) {
  const scale = civicScale(e.id), c = drawCivic(e.id, scale), d = c.design;
  total += d.blocks; jobsTotal += c.jobs.length;
  rows.push(`${e.id.padEnd(26)} ${e.kind.padEnd(12)} ${e.age.padEnd(6)} 1:${scale}  ${`${d.width}x${d.depth}x${d.height}`.padEnd(9)} ${String(d.blocks).padStart(5)} blocks ${String(c.jobs.length).padStart(3)} jobs  ${c.stages.join('/')}`);
  for (const b of Object.values(d.palette)) {
    if (!isPlaceable(b)) fail(`${e.id}: ${b} is not a placeable block with valid states`);
    if (!GETTABLE.test(b.replace(/\[.*$/, ''))) fail(`${e.id}: ${b} is not a block the village can get`);
  }
  const sum = (bills: Array<Record<string, number>>) => { const t: Record<string, number> = {}; for (const bl of bills) for (const [k, q] of Object.entries(bl)) t[k] = (t[k] ?? 0) + q; return t; };
  if (JSON.stringify(Object.entries(sum(c.jobs.map((j) => j.bill))).sort()) !== JSON.stringify(Object.entries(c.bill).sort())) fail(`${e.id}: the jobs' bills do not sum to the bill`);
  if (c.stages.reduce((t, n) => t + n, 0) !== d.blocks) fail(`${e.id}: the stages do not sum to the blocks`);
  if (c.jobs.reduce((t, j) => t + j.blocks, 0) !== d.blocks || c.cellJob.size !== d.blocks) fail(`${e.id}: a cell is in no job or in two`);
  if (c.jobs.some((j) => j.blocks > 450)) fail(`${e.id}: a job over 450 blocks`);
  if (d.blocks > CIVIC.blocks && scale < 4) fail(`${e.id}: ${d.blocks} blocks over the budget at 1:${scale}`);
  if (Math.max(d.width, d.depth) > 72) console.log(`  note ${e.id}: ${d.width}x${d.depth} is wider than the short list takes (72)`);
  // (an opening at the west end: two cells of air over the floor or the pad within 6 of x = 0)
  let door = false;
  for (let z = 0; z < d.depth && !door; z++) for (let x = 0; x < Math.min(6, d.width) && !door; x++)
    if (d.layers[1]?.[z]?.[x] === '.' && d.layers[2]?.[z]?.[x] === '.' && d.layers[0][z][x] !== '.') door = true;
  if (!door) console.log(`  note ${e.id}: no opening found on its west face`);
  const m = newCivic(e.id, scale, 'spruce', 0);
  const p = monumentPlan(m);
  if (p.design.blocks !== d.blocks || Object.keys(p.bill).some((k) => /^oak_/.test(k)) || !Object.keys(p.bill).some((k) => /^spruce_/.test(k)) && Object.keys(c.bill).some((k) => /^oak_/.test(k))) fail(`${e.id}: the civic record's plan is not the drawing in the village wood`);
  if (out) fs.writeFileSync(path.join(out, `${e.id}.json`), JSON.stringify(d));
}
console.log(rows.join('\n'));
console.log(`${civicEntries().length} buildings, ${total} blocks, ${jobsTotal} jobs (budget ${CIVIC.blocks})`);
// The short lists
const v = (mine: boolean) => ({ name: 'Testvale', plots: [], structures: [], ...(mine ? { mine: {} } : {}) } as unknown as Village);
const early = civicOptions(v(false), false), later = civicOptions(v(true), false);
console.log(`short list, new village: ${early.map((o) => `${o.id} 1:${o.scale}`).join(', ')}`);
console.log(`short list, with its mine: ${later.map((o) => `${o.id} 1:${o.scale}`).join(', ')}`);
if (early.some((o) => o.age !== 'timber')) fail('a stone building on a new village\'s list');
if (early.length < 4 || later.length < 4) fail('a short list under 4');
const byKind = new Map<string, number>();
for (const o of later) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
if ([...byKind.values()].some((n) => n > 2)) fail('more than two of a kind on a list');
// Variety (DECISIONS a39e559): a building this village built, and another village's most recent one, are off its list;
// kinds it has not built come first
{
  const pick = early[0], second = early[1];
  const built = { ...v(false), civics: [{ preset: pick.id, kind: pick.kind, scale: pick.scale, at: 0, built: 1, blocks: pick.blocks }] } as unknown as Village;
  const again = civicOptions(built, false);
  if (again.some((o) => o.id === pick.id)) fail(`a building the village built (${pick.id}) is on its list again`);
  const firstOld = again.findIndex((o) => o.kind === pick.kind), lastNew = again.map((o) => o.kind !== pick.kind).lastIndexOf(true);
  if (firstOld >= 0 && firstOld < lastNew) fail(`a kind the village built (${pick.kind}) comes before a kind it has not`);
  const other = { ...v(false), name: 'Othervale', civics: [{ preset: second.id, kind: second.kind, scale: second.scale, at: 0, built: 1, blocks: second.blocks }, { preset: pick.id, kind: pick.kind, scale: pick.scale, at: 0, built: 2, blocks: pick.blocks }] } as unknown as Village;
  const withOther = civicOptions(v(false), false, undefined, [other]);
  if (withOther.some((o) => o.id === pick.id)) fail(`another village's most recent building (${pick.id}) is on the list`);
  if (!civicOptions(v(false), false, 20, [other]).some((o) => o.id === second.id)) fail(`another village's older building (${second.id}) is left off the list`);
  console.log(`variety: after ${pick.id} the list starts ${again.slice(0, 3).map((o) => o.id).join(', ')}; beside Othervale (last ${pick.id}): ${withOther.slice(0, 3).map((o) => o.id).join(', ')}`);
}
console.log(fails ? `civic_gen: ${fails} FAILED` : 'civic_gen: ok');
process.exit(fails ? 1 : 0);
