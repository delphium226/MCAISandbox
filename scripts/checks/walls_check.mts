// Survival (d) spec 5 (MC_WALLS, walls.ts and mcWalls.ts): the wall's plan on a checkpoint's village (t12_pad_open by
// default): the ring 6 outside every layout and structure, off pads, streets, plots and lamps; closed (every cell with two
// ring neighbours, no diagonal leak); segments of ~24 with a gate each on a straight run, torches every ~8 and never on a
// gate; the bill. Growth: a neighbourhood past the ring adds a rectangle, the old ring's cells inside go to take down, the
// new ring encloses both. The ring as boxes for growth's survey covers every cell. Offline: no world needed.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/walls_check.mts [villages.json]
import fs from 'node:fs';
import { WALL_MARGIN, covered, growBox, hull, inBox, ringCells, ringRuns, segBill, wallPlan, type Box } from '../../server/src/walls';
import { regrowWall, segDone, startWall, wallBoxes, wallTaken } from '../../server/src/mineflayer/mcWalls';
import type { Village } from '../../server/src/village';

const file = process.argv[2] ?? 'mc/testcheckpoints/t12_pad_open/villages.json';
const all = Object.values((JSON.parse(fs.readFileSync(file, 'utf-8')) as { villages: Record<string, Village> }).villages);
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const key = (x: number, z: number) => `${x},${z}`;

// (the pure plan on a plain square: 4 sides of 61 + 1 corners)
{
  const p = wallPlan([{ x1: 0, z1: 0, x2: 60, z2: 60 }]);
  const cells = p.segs.flatMap((s) => s.cells);
  ok(cells.length === 240 && p.ring.size === 240, `a 61x61 region's ring has 240 cells (${cells.length})`);
  ok(p.segs.every((s) => s.cells.length >= 18 && s.cells.length <= 30), `segments of ~24 (${p.segs.map((s) => s.cells.length).join(',')})`);
  ok(p.segs.every((s) => s.cells.filter((c) => c.gate).length >= 1), 'a gate in every segment');
  ok(cells.filter((c) => c.gate).every((c) => (c.gate === 'x' ? c.z === 0 || c.z === 60 : c.x === 0 || c.x === 60)), "each gate on a straight side, across it");
  ok(!cells.some((c) => c.gate && c.torch), 'no torch on a gate');
  const t = cells.filter((c) => c.torch).length;
  ok(t >= 26 && t <= 32, `a torch every ~8 (${t})`);
  const b = segBill(p.segs[0], 'birch');
  ok(b.cobblestone === p.segs[0].cells.length - 1 && b.birch_fence === b.cobblestone && b.birch_fence_gate === 1, `a segment's bill: ${JSON.stringify(b)}`);
}
// (an L: no diagonal leak at the reflex corner, each cell with two ring side neighbours at least)
{
  const rects: Box[] = [{ x1: 0, z1: 0, x2: 40, z2: 20 }, { x1: 0, z1: 0, x2: 20, z2: 40 }];
  const ring = new Set(ringCells(rects).map((c) => key(c.x, c.z)));
  const lone = [...ring].filter((k) => {
    const [x, z] = k.split(',').map(Number);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => ring.has(key(x + dx, z + dz))).length < 2;
  });
  ok(!lone.length && ring.has(key(20, 20)) && !ring.has(key(21, 21)), `an L's ring is closed by side steps (the reflex corner 20,20 in it; ${lone.length} cells short)`);
}
// (growth: the region adds a rectangle, covered after)
{
  const r0 = [growBox({ x1: 0, z1: 0, x2: 40, z2: 40 }, WALL_MARGIN)];
  const hood = { x1: 60, z1: 0, x2: 80, z2: 20 };
  ok(!covered(r0, hood), 'a neighbourhood past the ring is not covered');
}

const villages = all.filter((v) => v.complete && (v.layouts ?? []).length);
ok(villages.length > 0, `${file}: ${villages.length} complete villages`);
for (const v of villages) {
  const w = startWall(v, all)!;
  const cells = w.segs.flatMap((s) => s.cells);
  const boxes = wallBoxes(v);
  const h = hull(boxes)!;
  ok(cells.length > 0 && cells.every((c) => !inBox(growBox(h, WALL_MARGIN - 1), c.x, c.z)), `${v.name}: ${cells.length} cells in ${w.segs.length} segments, all ${WALL_MARGIN} outside the built bounds ${JSON.stringify(h)}`);
  // (off pads, streets, lamps, plots and every structure: nothing of the village in the ring)
  const onWork = cells.filter((c) => [...boxes, ...v.plots].some((b) => inBox(b, c.x, c.z))
    || (v.layouts ?? []).some((l) => (l.lamps ?? []).some((p) => p.x === c.x && p.z === c.z) || ((l as { streets?: Box[] }).streets ?? []).some((s) => inBox(s, c.x, c.z))));
  ok(!onWork.length, `${v.name}: no ring cell on a pad, street, lamp, plot or structure (${onWork.length})`);
  ok(w.segs.every((s) => s.cells.some((c) => c.gate)), `${v.name}: a gate in every segment (${cells.filter((c) => c.gate).length} gates)`);
  const runs = wallTaken(v as Village & { wall?: unknown } as Village) ;
  ok(runs.length === 0, `${v.name}: growth's survey keeps off nothing before the vote`);
  v.wall = w;
  const taken = wallTaken(v);
  ok(cells.every((c) => taken.some((b) => inBox(b, c.x, c.z))) && taken.length < cells.length / 4, `${v.name}: the ring as ${taken.length} boxes for growth's survey covers every cell`);
  // (two cells built, one a gate; then growth east of the ring)
  const g = cells.find((c) => c.gate)!, east = cells.filter((c) => !c.gate && c.x === h.x2 + WALL_MARGIN && !c.torch), plain = east[Math.floor(east.length / 2)];
  w.built[key(g.x, g.z)] = { y: 70, top: 70, gate: g.gate };
  w.built[key(plain.x, plain.z)] = { y: 70, top: 71 };
  const seg = w.segs.find((s) => s.cells.includes(plain))!;
  ok(!segDone(w, seg), `${v.name}: a segment is not done with one cell built`);
  const hood: Box = { x1: h.x2 + 14, z1: plain.z - 10, x2: h.x2 + 34, z2: plain.z + 10 };
  v.layouts = [...(v.layouts ?? []), { ...hood, buildings: [] } as never];
  const line = regrowWall(v, all);
  const cells2 = w.segs.flatMap((s) => s.cells);
  ok(!!line && w.rects.length === 2 && covered(w.rects, hood), `${v.name}: growth past the ring adds a rectangle (${line})`);
  ok(w.down?.some((d) => d.x === plain.x && d.z === plain.z) && !w.built[key(plain.x, plain.z)], `${v.name}: the old ring's cell now inside goes to take down`);
  ok(w.built[key(g.x, g.z)] ? cells2.some((c) => c.x === g.x && c.z === g.z && c.gate === g.gate) : true, `${v.name}: a built gate still on the ring stays a gate`);
  ok(cells2.every((c) => !inBox(growBox(hood, WALL_MARGIN - 1), c.x, c.z)), `${v.name}: the new ring keeps ${WALL_MARGIN} off the new neighbourhood (${cells2.length} cells)`);
  ok(regrowWall(v, all) === '', `${v.name}: nothing changes the second time`);
}
const runs = ringRuns([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }]);
ok(runs.length === 2, `ring runs: a row and a column (${JSON.stringify(runs)})`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
