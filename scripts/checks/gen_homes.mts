/**
 * Members' own houses checked offline (#104's R3, houseStyle.ts; spec runs/2026-10-23/building-variety/spec_r3.md): the
 * 24 workers housed in 6 neighbourhoods of 4 in each of the five families, every home drawn by ownHomes as the world
 * would (bills from Materials.plan, as gen_designs.mts costs them), and checked:
 * - valid (validateDesign with Minecraft's blocks and states), within the box (9x9, 12 layers), the budget (150 units,
 *   one home a neighbourhood up to 230) and 32 smelts, with easy materials only;
 * - one door, in the south wall, open above, two free cells before it;
 * - every stair faces uphill (its tall side's column reaches its layer, its low side's does not rise above it);
 * - whole walls up to the roof (no gaps but the door and open windows), every cell inside the walls roofed over;
 * - ladders and open trapdoors against a solid block (a ladder's back, a shutter's wall);
 * then counts distinct designs (prediction: at least 20 of 24 a family), compares the look of the most traditional and the
 * most open members' houses with their family's, and draws twice to see the same houses (deterministic).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/gen_homes.mts [VERBOSE=1: every home's layers]
 *        OUT=DIR writes each home as a design JSON for scripts/render_design.py
 */
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { V2_LIMITS, stairShape, type BuildingStyle } from '../../server/src/buildingGen';
import { elevations, HOUSE_UNITS, HOUSE_UNITS_LARGE, outsideCells, outwardStep, validateDesign } from '../../server/src/designs';
import { FAMILY, homeOwner, homeTraits, isHomeName, ownHomes } from '../../server/src/houseStyle';
import { isDwelling } from '../../server/src/grow';
import { isLandmark, woodVariant } from '../../server/src/designs';
import { NAME_POOL } from '../../server/src/agentNames';
import { valuesOf } from '../../server/src/character';
import { workerName } from '../../server/src/agentNames';
import type { Design } from '../../server/src/village';
import { Materials, designBill, hardToGather } from '../../server/src/mineflayer/mcMaterials';

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
    if (!st || v === undefined) return false;
    return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
  });
};
// (gen_designs.mts' cost: the bill with a crafting table, and a furnace when anything smelts)
const costs = new Map<string, { units: number; smelts: number; hard: string[] }>();
function cost(d: Design) {
  const k = JSON.stringify([d.layers, d.palette]);
  let c = costs.get(k);
  if (!c) {
    const bill = designBill(d);
    let plan = materials.plan(bill);
    plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    c = { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts, hard: [...hardToGather(plan.gather), ...plan.problems.map(() => 'problem')] };
    costs.set(k, c);
  }
  return c;
}
let failed = 0;
const bill = { units: (d: Design) => cost(d).units, smelts: (d: Design) => cost(d).smelts };

const solid = (d: Design, ch: string | undefined) => !!ch && ch !== '.' && ch !== '_' && d.palette[ch] !== 'air';
const at = (d: Design, l: number, x: number, z: number) => (x < 0 || z < 0 || x >= d.width || z >= d.depth || l < 0 || l >= d.height ? undefined : d.layers[l][z][x]);
const block = (d: Design, l: number, x: number, z: number) => d.palette[at(d, l, x, z) ?? ''] ?? '';
const topOf = (d: Design, x: number, z: number) => {
  for (let l = d.height - 1; l >= 0; l--) if (solid(d, at(d, l, x, z))) return l;
  return -1;
};
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

function check(d: Design, budget: number): string[] {
  const style = d.style as BuildingStyle;
  const problems: string[] = [];
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'check', { isPlaceable, states: true });
  problems.push(...errors.map((e) => `validateDesign: ${e}`));
  if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox) problems.push(`box ${d.width}x${d.depth} over ${V2_LIMITS.maxBox}x${V2_LIMITS.maxBox}`);
  if (d.height > 12) problems.push(`${d.height} layers`);
  const c = cost(d);
  if (c.units > budget) problems.push(`${c.units} units over ${budget}`);
  if (c.smelts > 32) problems.push(`${c.smelts} smelts`);
  if (c.hard.length) problems.push(`hard materials: ${c.hard.join(', ')}`);
  const l1 = d.layers[1];
  const outside = outsideCells(l1);
  const doors: Array<[number, number]> = [];
  for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) if (/_door$/.test(d.palette[l1[z][x]] ?? '')) doors.push([x, z]);
  if (doors.length !== 1) problems.push(`${doors.length} doors`);
  for (const [x, z] of doors) {
    const out = outwardStep(l1, x, z, outside);
    if (!out) problems.push(`the door at ${x},${z} is not in an outer wall`);
    else {
      if (out[0] !== 0 || out[1] !== 1) problems.push(`the door at ${x},${z} does not face south`);
      for (let k = 1; k <= 2; k++) for (const l of [1, 2]) if (solid(d, at(d, l, x + out[0] * k, z + out[1] * k))) problems.push(`a block ${k} before the door at layer ${l}`);
    }
    if (solid(d, at(d, 2, x, z))) problems.push('a block over the door');
  }
  const winLayers = style.storeys === 2 ? [2, 6] : [2];
  for (let l = 0; l < d.height; l++)
    for (let z = 0; z < d.depth; z++)
      for (let x = 0; x < d.width; x++) {
        const b = block(d, l, x, z);
        let m = /_stairs\[.*facing=(\w+)/.exec(b);
        // (a sill under a window, MC_DRESSING's, is no roof stair)
        if (m && !/glass/.test(block(d, l + 1, x, z) ?? '')) {
          const [sx, sz] = STEP[m[1]];
          // (a chimney rises above the roof beside it: its column is no slope)
          const chimney = (cx: number, cz: number) => [...Array(d.height).keys()].some((l2) => block(d, l2, cx, cz) === 'cobblestone_wall');
          const tall = topOf(d, x + sx, z + sz), low = chimney(x - sx, z - sz) ? -1 : topOf(d, x - sx, z - sz);
          if (tall < l) problems.push(`stair at layer ${l} ${x},${z} faces ${m[1]} but the roof there is lower (${tall})`);
          if (low > l) problems.push(`stair at layer ${l} ${x},${z} faces ${m[1]} but its low side rises to ${low}`);
          stairShape(d, l, x, z);
        }
        // (a ladder's back: the cell it faces away from; an open trapdoor's wall: the cell behind its facing, F112)
        m = /^ladder\[facing=(\w+)/.exec(b) ?? /_trapdoor\[facing=(\w+).*open=true/.exec(b);
        if (m) {
          const [sx, sz] = STEP[m[1]];
          if (!solid(d, at(d, l, x - sx, z - sz)) || /_(door|trapdoor)|ladder|glass_pane/.test(block(d, l, x - sx, z - sz))) problems.push(`${b} at layer ${l} ${x},${z} has nothing solid behind it`);
        }
      }
  // Whole walls and a roof over the inside
  for (let z = 0; z < d.depth; z++)
    for (let x = 0; x < d.width; x++) {
      const ch = l1[z][x];
      const wall = !!outwardStep(l1, x, z, outside) && (solid(d, ch) || /_door$/.test(d.palette[ch] ?? ''));
      const inside = !outside.has(`${x},${z}`) && !wall;
      const top = topOf(d, x, z);
      if (wall)
        for (let l = 1; l < top; l++) {
          const door = /_door$/.test(d.palette[ch] ?? '') && l <= 2;
          const window = winLayers.includes(l) && style.windows === 'open';
          if (!solid(d, at(d, l, x, z)) && !door && !window) problems.push(`a gap in the wall at ${x},${z} layer ${l}`);
        }
      if (inside && top < (style.storeys === 2 ? 8 : style.wall_height + 1)) problems.push(`no roof over ${x},${z}`);
    }
  return problems;
}

// Every name the pool can give a house: a dwelling by the name rules, never a landmark (Finn, Quinn: the R3 review)
for (const m of ['Mayor', ...NAME_POOL]) for (const fam of Object.keys(FAMILY)) {
  const [d] = ownHomes([m], fam, bill);
  if (!d || !isHomeName(d.name) || !isDwelling(d.name) || isLandmark(d.name) || homeOwner(d) !== m) {
    failed++;
    console.log(`FAIL ${m} ${fam}: ${d ? `${d.name} dwelling ${isDwelling(d.name)}, landmark ${isLandmark(d.name)}, owner ${homeOwner(d)}` : 'no house'}`);
  }
}
const workers = Array.from({ length: 24 }, (_, i) => workerName(i + 1));
const hoods = Array.from({ length: 6 }, (_, k) => workers.slice(4 * k, 4 * k + 4));
const lines: string[] = [];
const all: Design[] = [];
const pooled: Array<{ k: number; shared: number }> = [];
for (const fam of Object.keys(FAMILY)) {
  const homes: Design[] = [];
  let large = 0, missing = 0;
  for (const hood of hoods) {
    const got = ownHomes(hood, fam, bill);
    missing += hood.length - got.length;
    const big = got.filter((d) => cost(d).units > HOUSE_UNITS).length;
    if (big > 1) {
      failed++;
      console.log(`FAIL ${fam}: ${big} homes over ${HOUSE_UNITS} in one neighbourhood`);
    }
    large += big;
    for (const d of got) {
      const budget = cost(d).units > HOUSE_UNITS ? HOUSE_UNITS_LARGE : HOUSE_UNITS;
      const p = check(d, budget);
      if (p.length) {
        failed++;
        console.log(`FAIL ${fam} ${d.name}: ${p.slice(0, 6).join('; ')}`);
        if (process.env.VERBOSE !== '0') console.log(elevations(d));
      }
      if (process.env.VERBOSE === '1') console.log(`${d.name} ${d.description}\n${d.layers.map((l, i) => `layer ${i}: ${l.join(' ')}`).join('\n')}`);
      homes.push(d);
    }
  }
  if (missing) {
    failed++;
    console.log(`FAIL ${fam}: ${missing} members got no house`);
  }
  const distinct = new Set(homes.map((d) => JSON.stringify([d.layers, d.palette]))).size;
  if (distinct < 20) {
    failed++;
    console.log(`FAIL ${fam}: ${distinct} distinct homes of ${homes.length} (the prediction: at least 20)`);
  }
  const styles = homes.map((d) => d.style as BuildingStyle);
  const count = (f: (s: BuildingStyle) => boolean) => styles.filter(f).length;
  const units = homes.map((d) => cost(d).units);
  const cut = homes.filter((d) => /cut to fit/.test(d.description)).length;
  // Conformity: the five most traditional members' houses against the five most open members', by look choices shared with the family
  const F = FAMILY[fam];
  const shared = (s: BuildingStyle) => [s.walls === F.walls, s.base === F.base, s.roof === F.roof, s.frame === F.frame, (s.windows_pattern ?? 'rhythm') === 'rhythm'].filter(Boolean).length;
  const by = (key: 'conservation' | 'openness') => [...homes].sort((a, b) => valuesOf(homeOwner(b)!).conservation * (key === 'conservation' ? 1 : -1) - valuesOf(homeOwner(a)!).conservation * (key === 'conservation' ? 1 : -1)).slice(0, 5);
  const mean = (ds: Design[]) => ds.reduce((t, d) => t + shared(d.style as BuildingStyle), 0) / ds.length;
  const trad = mean(by('conservation')), open = mean(by('openness'));
  for (const d of homes) pooled.push({ k: homeTraits(homeOwner(d)!).conformity, shared: shared(d.style as BuildingStyle) });
  lines.push(`${fam.padEnd(8)} ${String(distinct).padStart(2)}/${homes.length} distinct; L ${count((s) => s.footprint === 'L')}, T ${count((s) => s.footprint === 'T')}, two storeys ${count((s) => s.storeys === 2)} (large ${large}), porch ${count((s) => !!s.porch)}, chimney ${count((s) => !!s.chimney)}, shutters ${count((s) => !!s.shutters)}, timber ${count((s) => s.frame === 'timber')}; cut ${cut}; units ${Math.min(...units)}-${Math.max(...units)}; looks shared: traditional ${trad.toFixed(1)}, open ${open.toFixed(1)}`);
  all.push(...homes);
}
// Conformity over every family: members who value tradition most (conformity 0.8) share more looks with their family than
// those who value it least (0.2)
const avg = (k: number) => { const xs = pooled.filter((p) => p.k === k); return xs.reduce((t, p) => t + p.shared, 0) / (xs.length || 1); };
lines.push(`conformity: houses of the most traditional members share ${avg(0.8).toFixed(2)} of 5 looks with their family, the middle ${avg(0.5).toFixed(2)}, the least ${avg(0.2).toFixed(2)}`);
if (!(avg(0.8) > avg(0.2))) {
  failed++;
  console.log("FAIL: traditional members' houses are no closer to their family than the others'");
}
// Deterministic: the same owners draw the same houses
const again = ownHomes(hoods[0], 'plains', bill);
const first = all.slice(0, again.length);
if (JSON.stringify(again.map((d) => [d.name, d.layers, d.palette])) !== JSON.stringify(first.map((d) => [d.name, d.layers, d.palette]))) {
  failed++;
  console.log('FAIL: drawing the same neighbourhood twice gave different houses');
}
// A member's character shows: the traits behind the first neighbourhood's houses
for (const d of first) {
  const t = homeTraits(homeOwner(d)!);
  console.log(`  ${d.name.padEnd(12)} values ${t.dominant}, goal ${t.goal}, likes ${t.likes.join('+')}: ${d.description}`);
}
if (process.env.OUT) {
  fs.mkdirSync(process.env.OUT, { recursive: true });
  // (each in its family's wood, as R2 would build it)
  for (const d of all) {
    const s = d.style as BuildingStyle;
    fs.writeFileSync(path.join(process.env.OUT, `${s.family}-${s.owner}.json`), JSON.stringify({ ...woodVariant(d, FAMILY[s.family!].wood), name: `${s.owner} (${s.family})` }));
  }
}
// The size (#141, MC_BIG_HOUSES): the mean box, free ground-floor cells inside the walls and wood blocks, so a run asserts the
// built sizes and not the flag (a budget left unscaled cuts every home back to today's)
{
  const n = all.length;
  const interior = (d: Design) => {
    const l1 = d.layers[1] ?? [];
    const out = outsideCells(l1);
    let c = 0;
    for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) if (!out.has(`${x},${z}`) && !solid(d, at(d, 1, x, z))) c++;
    return c;
  };
  const wood = (d: Design) => d.layers.reduce((t, l) => t + l.reduce((u, row) => u + [...row].filter((ch) => /oak|spruce|birch|acacia|jungle|dark_oak|mangrove|cherry|planks|_log/.test(d.palette[ch] ?? '')).length, 0), 0);
  const plains = all.filter((d) => (d.style as BuildingStyle).family === 'plains');
  const m = (ds: Design[], f: (d: Design) => number) => ds.reduce((t, d) => t + f(d), 0) / (ds.length || 1);
  lines.push(`size (MC_BIG_HOUSES=${process.env.MC_BIG_HOUSES ?? 'off'}): box ${m(all, (d) => d.width).toFixed(1)} x ${m(all, (d) => d.depth).toFixed(1)}, interior ${m(all, interior).toFixed(1)} cells; plains: interior ${m(plains, interior).toFixed(1)}, wood ${m(plains, wood).toFixed(0)}, units ${m(plains, (d) => cost(d).units).toFixed(0)} (${n} homes)`);
}
console.log(lines.join('\n'));
console.log(failed ? `FAIL gen_homes: ${failed} problems` : `PASS gen_homes: ${all.length} homes in 5 families, every one valid, in budget and in its box`);
process.exit(failed ? 1 : 0);
