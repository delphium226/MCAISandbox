/**
 * The monument's quarry (M2, #145; quarry.ts) checked offline, no server:
 * - the pit's size: it holds the cobblestone wanted with the slack (1:4 and 1:2 Notre-Dame's bills), at most 16 deep;
 * - every side's turn maps the pit's local cells one to one onto its square, u = 0 on the entry side;
 * - digging the whole pit in a random order of open rows (members taking rows as openRows gives them, some rows cut at
 *   random): every cell dug lies inside the square and between its top and floor, never under a cell not yet dug
 *   (headroom), its digger's stand is the cell dug before it in its row, the step above (dug) or the entry ring; a row
 *   below a cut row only under its dug part; the pit ends done with every open cell dug, its volume when nothing is cut;
 * - openRows: held rows left out, shallowest first;
 * - the site search on a made-up ground: off taken ground and its 2-block margin, off water, ground within 2, the
 *   entry side toward the hut; none found when everything is taken;
 * - with MC_QUARRY off (a child run) the flag reads off.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/quarry_unit.mts
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.QUARRY_CHILD === 'off') {
  const { QUARRY } = await import('../../server/src/quarry');
  console.log(`QUARRY.on=${QUARRY.on}`);
  process.exit(0);
}
process.env.MC_QUARRY = 'on';
const { QUARRY, newQuarry, openRows, pitDone, pitSide, pitSize, pitVolume, pitXZ, rowCell, rowLength, cellsLeft, searchQuarry, soilDepth } = await import('../../server/src/quarry');
const { monumentPlan } = await import('../../server/src/monument');

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};

// The size from the bills
for (const scale of [4, 2]) {
  const c = monumentPlan({ preset: 'notre_dame', scale, palette: 'today', wood: 'oak', at: 0, state: 'building', done: [], yard: {}, stages: [] });
  const want = (c.bill.cobblestone ?? 0) + (c.bill.cobblestone_wall ?? 0) + (c.bill.cobblestone_stairs ?? 0) * 1.5;
  const { side, depth } = pitSize(want);
  ok(pitVolume(side, depth) >= want * 1.3, `1:${scale}: a ${side}x${side}x${depth} pit holds ${pitVolume(side, depth)} < ${Math.round(want * 1.3)}`);
  ok(depth <= 16 && depth <= side - 4, `1:${scale}: depth ${depth} at side ${side}`);
  console.log(`1:${scale}: ${Math.round(want)} cobblestone wanted -> a ${side}x${side} pit ${depth} deep (${pitVolume(side, depth)} cells)`);
}
ok(pitSize(0).side >= 10, 'a pit for nothing is still the smallest');
// (with topsoil: the stone under it holds the want; the live check's 4 layers of soil over 1:4)
for (const soil of [0, 2, 4, 6]) {
  const { side, depth } = pitSize(1812, soil);
  ok(pitVolume(side, depth, soil) >= 1812 * 1.3 && depth - soil <= 16 && depth <= side - 4, `soil ${soil}: a ${side}x${side}x${depth} pit's stone ${pitVolume(side, depth, soil)}`);
  console.log(`1:4 with ${soil} layers of soil: a ${side}x${side} pit ${depth} deep (${pitVolume(side, depth, soil)} cells of stone)`);
}
ok(soilDepth([4, 3, 5, 4, 12]) === 4 && soilDepth([]) === 0, 'soil depth is the median');

// The turns
for (const side of ['w', 'e', 'n', 's'] as const) {
  const q = newQuarry({ x1: 100, z1: 200, x2: 111, z2: 211 }, 70, 8, side, 'T', 0);
  const seen = new Set<string>();
  for (let u = 0; u < 12; u++)
    for (let v = 0; v < 12; v++) {
      const c = pitXZ(q, u, v);
      ok(c.x >= 100 && c.x <= 111 && c.z >= 200 && c.z <= 211, `${side}: (${u},${v}) -> ${c.x},${c.z} outside`);
      seen.add(`${c.x},${c.z}`);
    }
  ok(seen.size === 144, `${side}: ${seen.size} of 144 cells`);
  const e = pitXZ(q, 0, 5);
  const onSide = { w: e.x === 100, e: e.x === 111, n: e.z === 200, s: e.z === 211 }[side];
  ok(onSide, `${side}: u=0 is not on the entry side (${e.x},${e.z})`);
}

// Digging a whole pit in a random order
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const [S, D, cutP] of [[12, 8, 0], [16, 12, 0.03], [20, 16, 0.01], [14, 10, 0.1]] as Array<[number, number, number]>) {
  for (const side of ['w', 's'] as const) {
    const q = newQuarry({ x1: 0, z1: 0, x2: S - 1, z2: S - 1 }, 80, D, side, 'T', 0);
    const dug = new Set<string>();
    const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const ring = (x: number, z: number) => x < 0 || x >= S || z < 0 || z >= S;
    let guard = 0, cuts = 0, n = 0;
    const left0 = cellsLeft(q);
    for (;;) {
      if (++guard > 100000) { ok(false, 'the dig never ended'); break; }
      const held = new Set<string>();
      const open = openRows(q, held);
      if (!open.length) break;
      // (a member takes one of the first few rows offered, as several take rows at once)
      const { k, v } = open[Math.floor(rnd() * Math.min(4, open.length))];
      const key = `${k},${v}`;
      const len = rowLength(q, k, v);
      const i = q.rows[key] ?? 0;
      if (rnd() < cutP) { q.cut[key] = i; cuts++; continue; }
      const c = rowCell(q, k, v, i);
      ok(!ring(c.x, c.z), `cell ${key}/${i} outside the square`);
      ok(c.y <= q.y && c.y > q.y - q.depth, `cell ${key}/${i} y ${c.y} outside ${q.y - q.depth + 1}..${q.y}`);
      ok(k === 0 || dug.has(key3(c.x, c.y + 1, c.z)), `cell ${key}/${i} at ${c.x},${c.y},${c.z} under an undug cell`);
      const st = c.stand;
      const standOk = (k === 0 && i === 0 ? ring(st.x, st.z) && st.y === q.y + 1 : dug.has(key3(st.x, st.y, st.z)))
        && (i === 0 || st.y === c.y) && Math.abs(st.x - c.x) + Math.abs(st.z - c.z) === 1;
      ok(standOk, `cell ${key}/${i}: stand ${st.x},${st.y},${st.z} not dug, not the step or ring`);
      ok(i === 0 || dug.has(key3(st.x, st.y + 1, st.z)) || k === 0, `cell ${key}/${i}: no headroom at its stand`);
      ok(!dug.has(key3(c.x, c.y, c.z)), `cell ${key}/${i} dug twice`);
      dug.add(key3(c.x, c.y, c.z));
      q.rows[key] = i + 1;
      n++;
      ok(i + 1 <= len, `row ${key} past its length ${len}`);
    }
    ok(pitDone(q), `${S}x${D} ${side}: not done at the end`);
    ok(cellsLeft(q) === 0, `${S}x${D} ${side}: ${cellsLeft(q)} cells left at the end`);
    if (!cutP) ok(n === pitVolume(S, D), `${S}x${D} ${side}: dug ${n} of ${pitVolume(S, D)}`);
    if (!cutP) ok(left0 === pitVolume(S, D), `${S}x${D} ${side}: cellsLeft at the start ${left0} not ${pitVolume(S, D)}`);
    console.log(`pit ${S}x${S}x${D} (${side}): dug ${n} of ${pitVolume(S, D)} with ${cuts} rows cut`);
  }
}

// openRows: held rows out, shallowest first
{
  const q = newQuarry({ x1: 0, z1: 0, x2: 11, z2: 11 }, 70, 6, 'w', 'T', 0);
  ok(openRows(q, new Set()).length === 12 && openRows(q, new Set()).every((r) => r.k === 0), 'a new pit offers its 12 top rows');
  ok(openRows(q, new Set(['0,3'])).every((r) => r.v !== 3), 'a held row is not offered');
  q.rows['0,3'] = 12;
  const o = openRows(q, new Set());
  ok(o.length === 12 && o[o.length - 1].k === 1 && o[o.length - 1].v === 3, 'a finished top row opens the row under it, offered after the top rows');
  ok(rowLength(q, 1, 3) === 11, `the row under a full row is ${rowLength(q, 1, 3)} long, not 11`);
  q.cut['0,4'] = 5;
  ok(rowLength(q, 1, 4) === 4, `the row under a row cut at 5 is ${rowLength(q, 1, 4)} long, not 4`);
  q.cut['0,5'] = 1;
  ok(rowLength(q, 1, 5) === 0 && !openRows(q, new Set()).some((r) => r.k === 1 && r.v === 5), 'a row cut at its first cell opens nothing under it');
}

// The site search
{
  const hut = { x: 0, z: 0 };
  const water = (x: number, z: number) => x >= 30 && x <= 40 && z >= -10 && z <= 10;
  const taken = (x: number, z: number) => (x >= -12 && x <= 12 && z >= -12 && z <= 12) || (x >= 60 && x <= 90 && z >= -5 && z <= 25);
  const hill = (x: number, z: number) => x < -20 ? 70 + Math.floor((-20 - x) / 2) : 70;
  const r = searchQuarry({ side: 14, center: { x: 30, z: 0 }, hut, range: 60, takenAt: taken,
    ground: (x, z) => (water(x, z) ? null : { y: hill(x, z), trees: 0 }) });
  ok(r, 'a site is found');
  if (r) {
    const { area } = r;
    let off = true, dry = true, lo = Infinity, hi = -Infinity;
    for (let x = area.x1 - 2; x <= area.x2 + 2; x++)
      for (let z = area.z1 - 2; z <= area.z2 + 2; z++) {
        if (taken(x, z)) off = false;
        if (x >= area.x1 && x <= area.x2 && z >= area.z1 && z <= area.z2) {
          if (water(x, z)) dry = false;
          lo = Math.min(lo, hill(x, z));
          hi = Math.max(hi, hill(x, z));
        }
      }
    ok(off, `the site ${JSON.stringify(area)} is on taken ground or its margin`);
    ok(dry, `the site ${JSON.stringify(area)} is on water`);
    ok(hi - lo <= 2 && r.y === hi, `the site's ground spans ${lo}..${hi}, its top ${r.y}`);
    ok(area.x2 - area.x1 === 13 && area.z2 - area.z1 === 13, 'the site is 14 a side');
    const cx = (area.x1 + area.x2) / 2, cz = (area.z1 + area.z2) / 2;
    const e = pitXZ({ ...area, side: r.side }, 0, 7);
    ok(Math.hypot(e.x - hut.x, e.z - hut.z) < Math.hypot(cx - hut.x, cz - hut.z), `the entry side ${r.side} does not face the hut`);
    console.log(`site: ${JSON.stringify(area)} y ${r.y} side ${r.side} cost ${Math.round(r.cost)}`);
  }
  ok(!searchQuarry({ side: 14, center: { x: 0, z: 0 }, hut, range: 40, takenAt: () => true, ground: () => ({ y: 70, trees: 0 }) }), 'no site when everything is taken');
}

ok(QUARRY.on, 'MC_QUARRY=on reads on');
const off = execFileSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], { env: { ...process.env, QUARRY_CHILD: 'off', MC_QUARRY: '' }, encoding: 'utf8' });
ok(/QUARRY\.on=false/.test(off), `with MC_QUARRY unset the flag is off (${off.trim()})`);
ok(pitSide({ x1: 0, z1: 0, x2: 9, z2: 9 }) === 10, 'pitSide');

console.log(`${failures ? 'FAIL' : 'OK'} quarry_unit: ${checks - failures} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
