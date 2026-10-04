/**
 * The building generator checked offline (phase D, D.2; no server): every roof type at several sizes, with and without
 * an overhang, generated, validated as the architect's designs are (validateDesign with Minecraft's block list and
 * states), costed (Materials.plan, as designbench does) and checked:
 * - one door, in an outer wall of layer 1, open above, with two free cells in front of it;
 * - every stair faces uphill (the column on its tall side reaches its layer, the one on its low side does not rise above
 *   it), and the shapes the server will give them (vanilla's rule, stairShape) are outer corners only at a hip's
 *   corners and straight elsewhere;
 * - the walls are whole up to the roof (no gaps but the door and open windows: F111) and the roof covers the inside;
 * then every design stored in the villages files is validated again, so the door rules of D.2 (the building's edge, not
 * the grid's) change none of them.
 * Usage: node_modules/.bin/tsx scripts/checks/gen_designs.mts [VERBOSE=1 prints layers and elevations of every case]
 *        STYLE='{"width":7,...}' prints one style's design
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import { generateDesign, normalizeStyle, stairShape, type BuildingStyle } from '../../server/src/buildingGen';
import { doorOutward, elevations, lintDesign, outsideCells, outwardStep, validateDesign } from '../../server/src/designs';
import type { Design } from '../../server/src/village';
import { Materials, designBill, designBlockList } from '../../server/src/mineflayer/mcMaterials';

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const BLOCKS = designBlockList(true);
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
function cost(d: Design) {
  const bill = designBill(d);
  let plan = materials.plan(bill);
  plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  return { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts, gather: plan.gather };
}

const solid = (d: Design, ch: string | undefined) => !!ch && ch !== '.' && ch !== '_' && d.palette[ch] !== 'air';
const at = (d: Design, l: number, x: number, z: number) => (x < 0 || z < 0 || x >= d.width || z >= d.depth || l < 0 || l >= d.height ? undefined : d.layers[l][z][x]);
/** The highest solid layer of a column, -1 for none or outside the grid. */
const topOf = (d: Design, x: number, z: number) => {
  for (let l = d.height - 1; l >= 0; l--) if (solid(d, at(d, l, x, z))) return l;
  return -1;
};
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Problems found in a generated design (empty: it passed). */
function check(d: Design, style: BuildingStyle): string[] {
  const problems: string[] = [];
  const { errors } = validateDesign({ ...d }, 'check', { isPlaceable, blocks: BLOCKS, states: true });
  problems.push(...errors.map((e) => `validateDesign: ${e}`));
  // The door
  const l1 = d.layers[1];
  const outside = outsideCells(l1);
  // D.3's lint: a generated design draws whole walls and a pitched roof, so only a flat roof the style chose may show
  const lint = lintDesign(d);
  for (const note of lint.strong) if (!(style.roof === 'flat' && /roof is flat/.test(note))) problems.push(`lint: ${note}`);
  const doors: Array<[number, number]> = [];
  for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) if (/_door$/.test(d.palette[l1[z][x]] ?? '')) doors.push([x, z]);
  if (doors.length !== 1) problems.push(`${doors.length} doors`);
  for (const [x, z] of doors) {
    const out = outwardStep(l1, x, z, outside);
    if (!out) problems.push(`the door at ${x},${z} is not in an outer wall`);
    else {
      const side = out[0] < 0 ? 'west' : out[0] > 0 ? 'east' : out[1] < 0 ? 'north' : 'south';
      if (side !== style.door_side) problems.push(`the door faces ${side}, the style says ${style.door_side}`);
      for (let k = 1; k <= 2; k++)
        for (const l of [1, 2]) if (solid(d, at(d, l, x + out[0] * k, z + out[1] * k))) problems.push(`a block ${k} in front of the door at layer ${l}`);
    }
    if (solid(d, at(d, 2, x, z))) problems.push('a block over the door');
  }
  // Stairs: facing uphill, and the server's shapes
  const shapes: Record<string, number> = {};
  for (let l = 0; l < d.height; l++)
    for (let z = 0; z < d.depth; z++)
      for (let x = 0; x < d.width; x++) {
        const b = d.palette[d.layers[l][z][x]] ?? '';
        const m = /_stairs\[.*facing=(\w+)/.exec(b);
        if (!m) continue;
        const [sx, sz] = STEP[m[1]];
        const tall = topOf(d, x + sx, z + sz), low = topOf(d, x - sx, z - sz);
        if (tall < l) problems.push(`stair at layer ${l} ${x},${z} faces ${m[1]} but the roof there is lower (${tall})`);
        if (low > l) problems.push(`stair at layer ${l} ${x},${z} faces ${m[1]} but its low side rises to ${low}`);
        const shape = stairShape(d, l, x, z)!;
        shapes[shape] = (shapes[shape] ?? 0) + 1;
        const cornerCell = (x === 0 || x === d.width - 1) && (z === 0 || z === d.depth - 1);
        if (style.roof === 'hip' && cornerCell && !/^outer/.test(shape)) problems.push(`hip corner ${x},${z} would be ${shape}`);
        if (style.roof === 'gable' && shape !== 'straight') problems.push(`gable stair ${x},${z} layer ${l} would be ${shape}`);
      }
  if (style.roof === 'hip' && (shapes.outer_left ?? 0) + (shapes.outer_right ?? 0) < 4) problems.push(`a hip roof with ${(shapes.outer_left ?? 0) + (shapes.outer_right ?? 0)} outer corners`);
  // Whole walls (F111): every wall cell of layer 1 is solid up to the roof but the door and open windows
  for (let z = 0; z < d.depth; z++)
    for (let x = 0; x < d.width; x++) {
      if (!outwardStep(l1, x, z, outside) || !solid(d, l1[z][x]) && !/_door$/.test(d.palette[l1[z][x]] ?? '')) continue;
      const top = topOf(d, x, z);
      for (let l = 1; l < top; l++) {
        const ch = at(d, l, x, z);
        const door = /_door$/.test(d.palette[l1[z][x]] ?? '') && l <= 2;
        const window = l === 2 && style.windows === 'open';
        if (!solid(d, ch) && !door && !window) problems.push(`a gap in the wall at ${x},${z} layer ${l}`);
      }
    }
  return problems;
}

/** The roof seen from above with each block's role: ^ v < > stairs by facing (tall side), o outer and i inner corners, = ridge. */
function roofMap(d: Design): string[] {
  const rows: string[] = [];
  for (let z = 0; z < d.depth; z++) {
    let row = '';
    for (let x = 0; x < d.width; x++) {
      const l = topOf(d, x, z);
      const b = l < 0 ? '' : d.palette[d.layers[l][z][x]];
      const m = /_stairs\[.*facing=(\w+)/.exec(b);
      if (m) {
        const shape = stairShape(d, l, x, z)!;
        row += /^outer/.test(shape) ? 'o' : /^inner/.test(shape) ? 'i' : ({ north: '^', south: 'v', east: '>', west: '<' } as Record<string, string>)[m[1]];
      } else row += /_slab/.test(b) ? '=' : l < 0 ? ' ' : '#';
    }
    rows.push(`   |${row}|`);
  }
  return rows;
}

function show(d: Design) {
  console.log(elevations(d));
  console.log('Roof (^ v < > stairs by their tall side, o outer, i inner corner, = ridge slab):');
  console.log(roofMap(d).join('\n'));
  d.layers.forEach((layer, li) => console.log(`layer ${li}: ${layer.join(' ')}`));
}

/** What a build of the design should show, for rotate_design.py: each stair's shape and each door's way out (design cells). */
function expected(d: Design) {
  const shapes: Record<string, string> = {}, doors: Record<string, string> = {};
  for (let l = 0; l < d.height; l++) for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) {
    const s = stairShape(d, l, x, z);
    if (s) shapes[`${l},${x},${z}`] = s;
  }
  const outside = outsideCells(d.layers[1]);
  for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) {
    if (!/_door$/.test(d.palette[d.layers[1][z][x]] ?? '')) continue;
    const o = outwardStep(d.layers[1], x, z, outside);
    if (o) doors[`${x},${z}`] = o[0] < 0 ? 'west' : o[0] > 0 ? 'east' : o[1] < 0 ? 'north' : 'south';
  }
  return { shapes, doors };
}

if (process.env.STYLE || process.env.DESIGN) {
  let d: Design, style: BuildingStyle | undefined;
  if (process.env.STYLE) {
    const n = normalizeStyle({ name: 'style', description: 'from STYLE', ...JSON.parse(process.env.STYLE) });
    if (!n.style) throw new Error(n.errors.join('; '));
    if (n.notes.length && !process.env.OUT) console.log(`notes: ${n.notes.join('; ')}`);
    style = n.style;
    d = generateDesign(style);
  } else d = JSON.parse(fs.readFileSync(process.env.DESIGN!, 'utf8'));
  // OUT: the design and what a build of it should show, as JSON (rotate_design.py)
  if (process.env.OUT) {
    fs.writeFileSync(process.env.OUT, JSON.stringify({ design: d, ...expected(d) }));
    process.exit(0);
  }
  show(d);
  if (!style) process.exit(0);
  const c = cost(d);
  console.log(`${d.blocks} blocks, ${c.units} gather units, ${c.smelts} smelts: ${JSON.stringify(c.gather)}`);
  const problems = check(d, style);
  console.log(problems.length ? `FAIL\n- ${problems.join('\n- ')}` : 'pass');
  process.exit(problems.length ? 1 : 0);
}

// The cases: each roof at 5x5, 7x9 and 9x7, with and without an overhang, in several materials
const cases: Array<Record<string, unknown>> = [];
const looks = [
  { walls: 'planks', frame: 'logs', base: 'cobblestone', roof_material: 'planks', windows: 'glass', floor: 'none', wall_height: 3 },
  { walls: 'cobblestone', frame: 'none', base: 'none', roof_material: 'stone_bricks', windows: 'panes', floor: 'planks', wall_height: 4 },
  { walls: 'sandstone', frame: 'logs', base: 'none', roof_material: 'sandstone', windows: 'open', floor: 'cobblestone', wall_height: 3 },
];
let n = 0;
for (const roof of ['gable', 'hip', 'flat'])
  for (const [width, depth] of [[5, 5], [7, 9], [9, 7], [13, 13]])
    for (const overhang of roof === 'flat' ? [0] : [0, 1]) {
      const look = looks[n % looks.length];
      const door_side = (['south', 'east', 'north', 'west'] as const)[n % 4];
      cases.push({ name: `${roof} ${width}x${depth}${overhang ? ' overhang' : ''}`, description: 'test', width, depth, roof, overhang, door_side, ...look });
      n++;
    }
cases.push({ name: 'gable along z', description: 'test', width: 9, depth: 7, roof: 'gable', roof_axis: 'z', overhang: 1, walls: 'planks', roof_material: 'planks' });
cases.push({ name: 'even sizes', description: 'test', width: 6, depth: 8, roof: 'hip', overhang: 1, walls: 'logs', roof_material: 'cobblestone' });

let failed = 0;
console.log('case                         size       layers blocks units smelts shapes                          result');
for (const raw of cases) {
  const { style, errors, notes } = normalizeStyle(raw);
  if (!style) {
    failed++;
    console.log(`${String(raw.name).padEnd(28)} style refused: ${errors.join('; ')}`);
    continue;
  }
  const d = generateDesign(style);
  const problems = check(d, style);
  const c = cost(d);
  const shapes: Record<string, number> = {};
  for (let l = 0; l < d.height; l++) for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) {
    const s = stairShape(d, l, x, z);
    if (s) shapes[s] = (shapes[s] ?? 0) + 1;
  }
  if (problems.length) failed++;
  console.log(`${String(raw.name).padEnd(28)} ${`${d.width}x${d.depth}`.padEnd(10)} ${String(d.height).padStart(6)} ${String(d.blocks).padStart(6)} ${String(c.units).padStart(5)} ${String(c.smelts).padStart(6)} ${Object.entries(shapes).map(([k, v]) => `${k} ${v}`).join(', ').padEnd(31)} ${problems.length ? 'FAIL' : 'pass'}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  for (const p of problems.slice(0, 8)) console.log(`    - ${p}`);
  if (process.env.VERBOSE || problems.length) show(d);
}

// Stored designs: the D.2 door rules must leave every one as it was (no new fixes, the door still counted)
let stored = 0, changed = 0;
const linted: Record<string, number> = {};
for (const file of ['mc/server/villages.json', 'mc/testserver/villages.json']) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const villages = Array.isArray(data) ? data : Object.values(data.villages ?? data);
  for (const v of villages as Array<{ name: string; designs?: Record<string, Design> }>)
    for (const d of Object.values(v.designs ?? {})) {
      // (code's huts, designs the generator drew: their doors were always faced by the new rule; vanilla town centres
      // have no door)
      if (d.by === 'code' || d.style || /a town centre/.test(d.description)) continue;
      stored++;
      const { errors, fixes } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, d.by, { isPlaceable: () => true, maxLayers: 99, maxSide: 99, states: true });
      const doorErr = errors.filter((e) => /door/.test(e));
      // build_design's door facing before D.2 (by the grid's edge) against doorOutward's (by the building's edge)
      const turned: string[] = [];
      if (d.layers[1]?.length === d.depth)
        d.layers[1].forEach((row, j) => [...row].forEach((ch, i) => {
          if (!/_door$/.test(d.palette[ch] ?? '')) return;
          const old = i === 0 ? [-1, 0] : i === d.width - 1 ? [1, 0] : j === 0 ? [0, -1] : [0, 1];
          const now = doorOutward(d, i, j, 0);
          if (old[0] !== now[0] || old[1] !== now[1]) turned.push(`door at ${i},${j} faced ${old} now ${now}`);
        }));
      if (doorErr.length || fixes?.length || turned.length) {
        changed++;
        console.log(`stored ${v.name}/${d.name}: ${[...doorErr, ...(fixes ?? []), ...turned].join('; ')}`);
      }
      // D.3's lint over the stored designs, counted by rule (LINT=1 prints each)
      const l = lintDesign(d);
      for (const n of [...l.strong.map((x) => `strong: ${x}`), ...l.weak.map((x) => `weak: ${x}`)]) {
        const rule = n.replace(/\d+/g, 'N').replace(/the (north|south|east|west) wall/, 'the SIDE wall').slice(0, 60);
        linted[rule] = (linted[rule] ?? 0) + 1;
        if (process.env.LINT) console.log(`lint ${v.name}/${d.name}: ${n}`);
      }
    }
}
console.log('\nlint over the stored designs (by rule):');
for (const [rule, n] of Object.entries(linted).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rule}`);
console.log(`\n${cases.length - failed}/${cases.length} generated cases passed; ${stored} stored designs checked, ${changed} with door changes`);
process.exit(failed || changed ? 1 : 0);
