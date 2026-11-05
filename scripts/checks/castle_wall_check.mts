// #217 step 3 (castleWall.ts) and step 4's plan (mcWalls.ts startCastle): the castle wall's geometry on plain rings and
// on checkpoints' villages (w203_n9 and t12_pad_open by default): every tower has a stair of four from the ground to a
// landing beside a gap in its parapet; every gatehouse a passage 3 wide and 3 high through it with three gates at each
// end; with the curtain's sections the walk (towers', gatehouses' and sections' decks) is one ring and two wide; no cell on
// a pad, a street, a lamp, a plot or another village's work; the bills count the cells. Prints each ring's table (spec
// section 3): ring length, towers, gatehouses, the stone of stage 2 and of the curtain on flat ground.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/castle_wall_check.mts [villages.json ...]
import fs from 'node:fs';
import { DECK, castlePlan, partBill, walkCells, type CastlePart } from '../../server/src/castleWall';
import { growBox, inBox, orderRing, ringCells, type Box, type Cell } from '../../server/src/walls';
import { castleBill, crossingsOf, startCastle, startWall, wallBoxes } from '../../server/src/mineflayer/mcWalls';
import type { Village } from '../../server/src/village';

let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const key = (x: number, z: number) => `${x},${z}`;

/** The checks every plan passes; returns its table row. */
function checkPlan(name: string, rects: Box[], parts: { towers: CastlePart[]; gatehouses: CastlePart[]; sections: CastlePart[] }, avoid: Box[] = []): string {
  const ring = new Set(ringCells(rects).map((c) => key(c.x, c.z)));
  const { towers, gatehouses, sections } = parts;
  ok(towers.length >= 4, `${name}: ${towers.length} towers (the corners at least)`);
  // (towers: a stair of four, fills 0,1,2 then the landing at the deck, beside a door cell with air at +5 and +6)
  const stairOk = towers.every((t) => {
    const st = t.cols.slice(-4);
    if (st.map((c) => c.fill).join(',') !== `0,1,2,${DECK}`) return false;
    const land = st[3];
    const door = t.cols.find((c) => Math.abs(c.x - land.x) + Math.abs(c.z - land.z) === 1 && c.tops.some((x) => x.dy === DECK + 1 && x.tok === 'air'));
    return !!door && st.slice(0, 3).every((c, i) => c.tops.some((x) => x.dy === i + 1 && x.tok === 'stairs'));
  });
  ok(stairOk, `${name}: every tower has a stair from the ground to a landing by a gap in its parapet`);
  ok(towers.every((t) => t.ring.length >= 3), `${name}: every tower stands on the ring (${towers.map((t) => t.ring.length).join(',')} ring cells)`);
  // (gatehouses: 21 passage columns with air at 1-3 or a gate at 1, 6 gates, a deck over them)
  const passOk = gatehouses.every((g) => {
    const pass = g.cols.filter((c) => c.fill === 0 && c.tops.some((x) => x.dy === DECK && x.tok === 'stone'));
    const clear = pass.every((c) => [1, 2, 3].every((dy) => c.tops.some((x) => x.dy === dy && (x.tok === 'air' || (dy === 1 && x.tok === 'gate')))));
    return pass.length === 21 && clear && partBill(g).gates === 6;
  });
  ok(passOk, `${name}: every gatehouse has a passage 3 wide and 3 high with 3 gates at each end (${gatehouses.length} gatehouses)`);
  // (no two parts share a cell; none on the village's work)
  const all = [...towers, ...gatehouses, ...sections];
  const seen = new Map<string, string>();
  let shared = 0;
  for (const p of all) for (const c of p.cols) {
    const k = key(c.x, c.z);
    if (seen.has(k) && seen.get(k) !== p.id) shared++;
    seen.set(k, p.id);
  }
  ok(!shared, `${name}: no cell in two parts (${shared})`);
  const onWork = all.flatMap((p) => p.cols).filter((c) => avoid.some((b) => inBox(b, c.x, c.z)));
  ok(!onWork.length, `${name}: no cell on the village's work (${onWork.length})`);
  // (the walk: one 4-connected ring, two wide along the sections)
  const walk = walkCells(all);
  const wset = new Set(walk.map((c) => key(c.x, c.z)));
  const start = walk[0];
  const reach = new Set<string>();
  const queue: Cell[] = start ? [start] : [];
  while (queue.length) {
    const c = queue.pop()!;
    const k = key(c.x, c.z);
    if (reach.has(k) || !wset.has(k)) continue;
    reach.add(k);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) queue.push({ x: c.x + dx, z: c.z + dz });
  }
  ok(reach.size === wset.size, `${name}: the walk is one piece (${reach.size} of ${wset.size} cells reached from one)`);
  const sectionRing = sections.flatMap((s) => s.ring);
  const thin = sectionRing.filter((k) => {
    const [x, z] = k.split(',').map(Number);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && wset.has(key(x + dx, z + dz))) n++;
    return n === 0;
  });
  ok(!thin.length, `${name}: every curtain ring cell has a walk cell beside it inside (${thin.length} without)`);
  ok(sectionRing.length + new Set([...towers, ...gatehouses].flatMap((p) => p.ring)).size >= ring.size - 2, `${name}: the parts cover the ring (${sectionRing.length} + parts of ${ring.size})`);
  // (bills: stone = every fill + stone tops)
  const bill2 = castleBill([...towers, ...gatehouses]), bill3 = castleBill(sections);
  const count = [...towers, ...gatehouses].reduce((n, p) => n + p.cols.reduce((m, c) => m + Math.max(0, c.fill) + c.tops.filter((t) => ['stone', 'merlon', 'stairs', 'lip'].includes(t.tok)).length, 0), 0);
  ok(count === bill2.stone, `${name}: stage 2's bill counts its cells (${bill2.stone})`);
  return `| ${name} | ${ring.size} | ${towers.length} | ${gatehouses.length} | ${bill2.stone} | ${bill3.stone} | ${(bill3.stone / Math.max(1, sectionRing.length)).toFixed(1)} |`;
}

const rows: string[] = [];
// (a plain square, two crossings)
{
  const rects = [{ x1: 0, z1: 0, x2: 100, z2: 80 }];
  const order = orderRing(ringCells(rects));
  const p = castlePlan(order, rects, { crossings: [{ x: 50, z: 0 }, { x: 100, z: 40 }] });
  ok(p.gatehouses.length === 2, `square: a gatehouse at each crossing (${p.gatehouses.length}; ${p.skipped.join('; ')})`);
  rows.push(checkPlan('square 101x81', rects, p));
}
// (an L: a reflex corner)
{
  const rects = [{ x1: 0, z1: 0, x2: 90, z2: 40 }, { x1: 0, z1: 0, x2: 40, z2: 90 }];
  const p = castlePlan(orderRing(ringCells(rects)), rects, { crossings: [{ x: 20, z: 0 }] });
  rows.push(checkPlan('L 91', rects, p));
}
// (a part kept off another's work moves along the ring)
{
  const rects = [{ x1: 0, z1: 0, x2: 100, z2: 80 }];
  const keep = [{ x1: -6, z1: -6, x2: 3, z2: 3 }];
  const p = castlePlan(orderRing(ringCells(rects)), rects, { keep });
  ok(p.towers.every((t) => t.cols.every((c) => !inBox(keep[0], c.x, c.z))), `kept off: no tower on another's work (${p.skipped.join('; ') || 'moved along'})`);
}

const files = process.argv.length > 2 ? process.argv.slice(2) : ['mc/testcheckpoints/w203_n9/villages.json', 'mc/testcheckpoints/t12_pad_open/villages.json'];
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`(no ${file})`);
    continue;
  }
  const all = Object.values((JSON.parse(fs.readFileSync(file, 'utf-8')) as { villages: Record<string, Village> }).villages);
  for (const v of all.filter((x) => x.complete && (x.layouts ?? []).length)) {
    v.wall = (v.wall?.state === 'voted' ? v.wall : startWall(v, all)) ?? undefined;
    if (!v.wall) continue;
    const ring = new Set(ringCells(v.wall.rects).map((c) => key(c.x, c.z)));
    const crossings = crossingsOf(v, ring);
    const c = startCastle(v, all);
    ok(!!c, `${file.split('/').slice(-2)[0]} ${v.name}: the stone stage planned (${c?.parts.length ?? 0} parts, ${crossings.length} crossings)`);
    if (!c) continue;
    const order = orderRing(ringCells(v.wall.rects));
    const avoid = [...wallBoxes(v), ...v.plots, ...(v.layouts ?? []).flatMap((l) => (l as { streets?: Box[] }).streets ?? [])];
    const full = castlePlan(order, v.wall.rects, { crossings, avoid: wallBoxes(v).map((b) => growBox(b, 1)) });
    rows.push(checkPlan(`${file.split('/').slice(-2)[0]} ${v.name}`, v.wall.rects, full, avoid));
  }
}
console.log('\n| ring | cells | towers | gatehouses | stage 2 stone | curtain stone | a ring cell |\n|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
