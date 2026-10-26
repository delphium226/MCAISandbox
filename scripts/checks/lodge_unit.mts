/**
 * The masons' lodge (#163; lodge.ts) checked offline, no server:
 * - its parts for 4 to 40 furnaces: the kiln's strip inside the lodge at its corner, every furnace in the kiln's strip,
 *   the chests in the row south of it, three at least, never two side by side (they would join), none on a furnace, the
 *   stonecutter's cell or the table; the table inside the lodge;
 * - what its chests take (the monument's goods) and leave to the hut (a dyer's seeds, L3);
 * - bulk trips: 4 stacks at most, the last cut to what is still wanted after the trips out, none for a little while one
 *   is out; members taking trips in turn (some ending early) never bring more than the want, and fill it;
 * - the site search on a made-up ground: nearest the point between the pad and the quarry, off taken ground (searchQuarry's
 *   margin), none when everything is taken;
 * - #161 on iron_age_g1's own ground (scripts/checks/ground_dump.py's dump, made if missing) with Castle1's 1:2 pad and
 *   quarry standing: the kiln's old search near the hut (within 64) for the castle's two-row 22-furnace strip, and the
 *   lodge's search between pad and quarry, at 7 (T2d's), 10, 16, 22, 30 and 40 furnaces; and with T2d's pad and quarry.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/lodge_unit.mts [GROUND.json]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

process.env.MC_LODGE = 'on';
const { lodgeParts, lodgeSize, bulkTrip, searchLodge, lodgeKeeps, LODGE } = await import('../../server/src/lodge');
const { kilnCells, kilnStrip } = await import('../../server/src/kiln');
const { cutterCell } = await import('../../server/src/cutter');
const { searchQuarry } = await import('../../server/src/quarry');
const { siteTaken } = await import('../../server/src/monument');

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};
ok(LODGE.on && LODGE.stacks === 4, `the flag reads on, 4 stacks (${JSON.stringify(LODGE)})`);

// 1. The parts
for (let k = 4; k <= 40; k++) {
  const { w, d } = lodgeSize(k);
  const area = { x1: 100, z1: 200, x2: 100 + w - 1, z2: 200 + d - 1 };
  const p = lodgeParts(area, 70, k);
  const inside = (c: { x: number; z: number }, a: { x1: number; z1: number; x2: number; z2: number }) => c.x >= a.x1 && c.x <= a.x2 && c.z >= a.z1 && c.z <= a.z2;
  const ks = kilnStrip(k);
  ok(p.kiln.x1 === area.x1 && p.kiln.z1 === area.z1 && p.kiln.x2 - p.kiln.x1 + 1 === ks.w && p.kiln.z2 - p.kiln.z1 + 1 === ks.d && inside({ x: p.kiln.x2, z: p.kiln.z2 }, area), `k ${k}: the kiln's strip ${JSON.stringify(p.kiln)} in ${JSON.stringify(area)}`);
  const furnaces = kilnCells(p.kiln, 70, k);
  ok(furnaces.every((f) => inside(f, p.kiln)), `k ${k}: a furnace outside the kiln's strip`);
  const cut = cutterCell({ ...p.kiln, y: 70 });
  ok(inside(cut, p.kiln) && !furnaces.some((f) => f.x === cut.x && f.z === cut.z), `k ${k}: the cutter's cell ${JSON.stringify(cut)}`);
  ok(p.chests.length >= 3, `k ${k}: ${p.chests.length} chests`);
  const key = (c: { x: number; z: number }) => `${c.x},${c.z}`;
  const taken = new Set([...furnaces.map(key), key(cut), key(p.table)]);
  for (const c of p.chests) {
    ok(inside(c, area) && !inside(c, p.kiln) && c.y === 71, `k ${k}: a chest at ${key(c)} y ${c.y}`);
    ok(!taken.has(key(c)), `k ${k}: a chest on a furnace, the cutter or the table at ${key(c)}`);
    ok(!p.chests.some((o) => o !== c && Math.abs(o.x - c.x) + Math.abs(o.z - c.z) === 1), `k ${k}: chests side by side at ${key(c)}`);
  }
  ok(inside(p.table, area) && !inside(p.table, p.kiln), `k ${k}: the table at ${key(p.table)}`);
  ok(area.z2 > p.chests[0].z, `k ${k}: a walk outside the chests' row`);
}

// 2. Bulk trips
ok(bulkTrip(1000, 0) === 256 && bulkTrip(100, 0) === 100 && bulkTrip(300, 256) === 44 && bulkTrip(260, 256) === null && bulkTrip(10, 0) === 10 && bulkTrip(0, 0) === null, 'bulkTrip arithmetic');
for (let seed = 1; seed <= 200; seed++) {
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const want = Math.floor(rnd() * 2000) + 1;
  let had = 0, sent = 0, steps = 0;
  const out: number[] = [];
  while (steps++ < 500) {
    // a member takes a trip while fewer than 3 are out; the earliest out comes back with all or part of its amount
    const t = out.length < 3 ? bulkTrip(want - had, out.reduce((s, x) => s + x, 0)) : null;
    if (t !== null && (!out.length || rnd() < 0.6)) { out.push(t); sent += t; continue; }
    if (!out.length) break;
    const back = out.shift()!;
    had += rnd() < 0.2 ? Math.floor(back * rnd()) : back;
  }
  ok(had >= want, `seed ${seed}: want ${want}, had ${had} at the end`);
  ok(had <= want && sent >= want, `seed ${seed}: want ${want}, had ${had}, sent ${sent} (an overshoot)`);
}

// 2b. What the lodge's chests take: the monument's goods, not a dyer's seeds (L3)
const ym = { yard: { red_dye: 4 } }, bill = { polished_granite: 60, stone_brick_slab: 18 };
ok(['cobblestone', 'stone', 'sand', 'birch_log', 'oak_planks', 'charcoal', 'granite', 'red_dye', 'polished_granite', 'stone_brick_slab'].every((n) => lodgeKeeps(ym, bill, n)), 'the lodge takes the monument goods');
ok(!['wheat_seeds', 'raw_copper', 'lapis_lazuli', 'bread', 'iron_ingot', 'blue_dye'].some((n) => lodgeKeeps(ym, bill, n)), 'the lodge leaves the hut goods');

// 3. The search on made-up ground
const flat = () => ({ y: 70, trees: 0 });
const pad = { x1: 0, z1: 60, x2: 20, z2: 90 }, quarry = { x1: 0, z1: 0, x2: 19, z2: 19 };
const free = searchLodge({ k: 8, pad, quarry, hut: { x: 100, z: 20 }, ground: flat, takenAt: () => false });
ok(free && Math.abs((free.area.x1 + free.area.x2) / 2 - 10) <= 3 && Math.abs((free.area.z1 + free.area.z2) / 2 - 42) <= 3 && free.target.x === 10 && free.target.z === 42, `flat: nearest the point between pad and quarry (${JSON.stringify(free)})`);
const box = (a: { x1: number; z1: number; x2: number; z2: number }, n: number) => (x: number, z: number) => x >= a.x1 - n && x <= a.x2 + n && z >= a.z1 - n && z <= a.z2 + n;
const takenPQ = (x: number, z: number) => box(pad, 3)(x, z) || box(quarry, 3)(x, z) || box({ x1: -10, z1: 20, x2: 40, z2: 59 }, 0)(x, z);
const off = searchLodge({ k: 8, pad, quarry, hut: { x: 100, z: 20 }, ground: flat, takenAt: takenPQ });
ok(off && ![...Array(off.area.x2 - off.area.x1 + 5)].some((_, i) => [...Array(off.area.z2 - off.area.z1 + 5)].some((_, j) => takenPQ(off.area.x1 - 2 + i, off.area.z1 - 2 + j))), `off taken ground and its margin (${JSON.stringify(off)})`);
ok(searchLodge({ k: 8, pad, quarry, hut: { x: 100, z: 20 }, ground: flat, takenAt: () => true }) === null, 'none when everything is taken');
ok(searchLodge({ k: 8, pad, quarry, hut: { x: 100, z: 20 }, ground: () => null, takenAt: () => false }) === null, 'none on no ground');

// 4. #161 on iron_age_g1's ground
const groundFile = process.argv[2] ?? 'runs/lodge/iron_age_g1_ground.json';
if (!fs.existsSync(groundFile)) {
  fs.mkdirSync(groundFile.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
  execFileSync('python', ['scripts/checks/ground_dump.py', 'mc/testcheckpoints/iron_age_g1/world', '-1850', '-110', '-1500', '170', groundFile], { stdio: 'inherit' });
}
const G = JSON.parse(fs.readFileSync(groundFile, 'utf8')) as { x1: number; z1: number; x2: number; z2: number; cols: Array<[number, boolean, number] | null> };
const W = G.x2 - G.x1 + 1;
const ground = (x: number, z: number) => {
  if (x < G.x1 || x > G.x2 || z < G.z1 || z > G.z2) return null;
  const c = G.cols[(z - G.z1) * W + (x - G.x1)];
  return !c || c[1] ? null : { y: c[0], trees: c[2] };
};
const data = JSON.parse(fs.readFileSync('mc/testcheckpoints/iron_age_g1/villages.json', 'utf8')) as { villages: any[] };
const v0 = data.villages.find((v) => v.name === 'G1');
const hut = v0.storageHut;
const hutAt = { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) };
const { mineAreas } = await import('../../server/src/mineflayer/mcMine');
const mineBox = (v: any) => (v.mine ? mineAreas(v.mine) : []);
const cases = [
  { name: 'Castle1 (Conwy 1:2)', pad: { x1: -1729, z1: 44, x2: -1709, z2: 105 }, quarry: { x1: -1750, z1: 9, x2: -1725, z2: 34 }, ks: [22, 10, 16, 30, 40] },
  { name: 'T2d (Chartres 1:4)', pad: { x1: -1739, z1: 52, x2: -1719, z2: 84 }, quarry: { x1: -1745, z1: 6, x2: -1726, z2: 25 }, ks: [7, 22] },
];
for (const c of cases) {
  const v = JSON.parse(JSON.stringify(v0));
  v.structures.push({ id: 'pad', ...c.pad, y: 70, kind: 'monument' }, { id: 'pit', ...c.quarry, y: 50, kind: 'quarry' });
  const takenAt = siteTaken(v, data.villages.filter((o) => o.name !== 'G1'), mineBox(v), Date.now(), 'T');
  for (const k of c.ks) {
    const { w, d } = kilnStrip(k);
    const t0 = performance.now();
    const old = searchQuarry({ side: w, depthSide: d, center: hutAt, hut: hutAt, range: 64, ground, takenAt });
    const t1 = performance.now();
    const found = searchLodge({ k, pad: c.pad, quarry: c.quarry, hut: hutAt, maxRange: 96, ground, takenAt });
    const t2 = performance.now();
    const mid = found && { x: (found.area.x1 + found.area.x2) / 2, z: (found.area.z1 + found.area.z2) / 2 };
    const dist = (a: { x1: number; z1: number; x2: number; z2: number }) => mid ? Math.round(Math.hypot(mid.x - (a.x1 + a.x2) / 2, mid.z - (a.z1 + a.z2) / 2)) : NaN;
    console.log(`${c.name}, ${k} furnaces (${w}x${d} kiln, ${lodgeSize(k).w}x${lodgeSize(k).d} lodge): the kiln near the hut ${old ? `at ${old.area.x1},${old.area.z1}` : 'NONE'} (${Math.round(t1 - t0)} ms); the lodge ${found ? `at ${found.area.x1}..${found.area.x2}, ${found.area.z1}..${found.area.z2} y ${found.y}: ${dist(c.pad)} from the pad's middle, ${dist(c.quarry)} from the quarry's, ${dist(hut)} from the hut` : 'NONE'} (${Math.round(t2 - t1)} ms)`);
    ok(found, `${c.name}: a lodge for ${k} furnaces`);
    ok(t2 - t1 < 1500, `${c.name}: the lodge search took ${Math.round(t2 - t1)} ms`);
  }
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log(`FAILED: ${failures}`);
  process.exit(1);
}
console.log('OK');
