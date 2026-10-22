/**
 * #45's gardens, offline (smallWorks.ts gardenSpots, MC_GARDENS): a 2x2 front bed beside a door's walkway, never on the
 * walkway or the cell beside it (the sign, the stand cells), moved out past the building and a street, never on a hard
 * area or off soil; every door direction; a flower ring round a green's centre, open on each side; build_design's centre puts the
 * design's flowers exactly on the spot's cells; the kinds count toward beauty; off by default (SMALL_WORKS unchanged).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/gardens_unit.mts
 */
import { GARDENS, GARDEN_WORKS, SMALL_WORKS, gardenSpots, type GardenInput } from '../../server/src/smallWorks';
import { BEAUTY_WORKS, STANDING_WORKS } from '../../server/src/goals';

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const soilAll = () => true;
const key = (c: { x: number; z: number }) => `${c.x},${c.z}`;

// The cells build_design plants for a spot (its centre less floor(w/2), floor(d/2); layer 1's F cells)
function planted(kind: string, x: number, z: number): string[] {
  const d = GARDEN_WORKS.find((k) => k.kind === kind)!.make('oak');
  const x1 = x - Math.floor(d.width / 2), z1 = z - Math.floor(d.depth / 2);
  const out: string[] = [];
  d.layers[1].forEach((row, j) => [...row].forEach((c, i) => c === 'F' && out.push(`${x1 + i},${z1 + j}`)));
  return out.sort();
}

// A door at (10, 20) in a south wall, opening south (oz +1): the walkway is x = 10, z = 21..; a 2x2 bed beside it, its
// near column 2 cells to the side (x 8 or 12), rows 1-2 out, never on the walkway or the cell beside it
{
  const s1 = gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [], soil: soilAll });
  ok(s1.length === 1 && s1[0].kind === 'front_bed' && s1[0].cells.length === 4, `one front bed (${JSON.stringify(s1)})`);
  ok(s1[0].cells.every((c) => Math.abs(c.x - 10) >= 2 && Math.abs(c.x - 10) <= 3 && (c.z === 21 || c.z === 22)), `beside the walkway, 2-3 to the side, rows 1-2 (${s1[0].cells.map(key).join(' ')})`);
  ok(JSON.stringify(planted('front_bed', s1[0].x, s1[0].z)) === JSON.stringify(s1[0].cells.map(key).sort()), "build_design plants exactly the spot's cells");
}
// The other directions
for (const [ox, oz] of [[0, -1], [1, 0], [-1, 0]]) {
  const b = gardenSpots({ doors: [{ x: 0, z: 0, ox, oz, y: 64 }], greens: [], hard: [], soil: soilAll })[0];
  const along = (c: { x: number; z: number }) => (ox ? c.x * ox : c.z * oz), side = (c: { x: number; z: number }) => Math.abs(ox ? c.z : c.x);
  ok(!!b && b.cells.every((c) => along(c) >= 1 && along(c) <= 2 && side(c) >= 2) && JSON.stringify(planted('front_bed', b.x, b.z)) === JSON.stringify(b.cells.map(key).sort()), `opening ${ox},${oz}`);
}
// mv3_grown25's shapes (G2's probe, 10-22): the door a cell inside the outline, the sign beside it, a street along the
// wall: the bed moves out and to the free side
{
  const hard: GardenInput['hard'] = [
    { x1: 7, z1: 15, x2: 13, z2: 21 },   // the house, the door at z 20 one cell in from its south edge (z 21)
    { x1: 9, z1: 20, x2: 11, z2: 22 },   // its sign padded by 1, beside the walkway
    { x1: 4, z1: 22, x2: 30, z2: 23 },   // a street along the front, rows 2-3 out
  ];
  const b = gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard, soil: soilAll })[0];
  ok(!!b && b.cells.every((c) => !hard.some((h) => c.x >= h.x1 && c.x <= h.x2 && c.z >= h.z1 && c.z <= h.z2)) && b.cells.every((c) => c.x !== 10), `a bed past the house, the sign and the street (${b ? b.cells.map(key).join(' ') : 'none'})`);
}
// The build box's 1-cell margin clear of buildings (G2's L2: a bed's box ran into the house beside it): a house right
// beside the first candidate pushes the bed on
{
  const house = { x1: 13, z1: 15, x2: 19, z2: 30 };
  const b = gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [house], structures: [house], soil: soilAll })[0];
  ok(!!b && Math.min(...b.cells.map((c) => c.x)) - 1 > house.x2 || (!!b && Math.max(...b.cells.map((c) => c.x)) + 1 < house.x1), `the bed and its margin clear of the house (${b ? b.cells.map(key).join(' ') : 'none'})`);
  const box = b ? { x1: Math.min(...b.cells.map((c) => c.x)) - 1, x2: Math.max(...b.cells.map((c) => c.x)) + 1, z1: Math.min(...b.cells.map((c) => c.z)) - 1, z2: Math.max(...b.cells.map((c) => c.z)) + 1 } : null;
  ok(!!box && !(house.x1 <= box.x2 && house.x2 >= box.x1 && house.z1 <= box.z2 && house.z2 >= box.z1), 'no overlap with the house');
}
// A hard area on every candidate, or no soil, or a diagonal door: none
{
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [{ x1: 0, z1: 21, x2: 20, z2: 40 }], soil: soilAll }).length === 0, 'all of the front taken: none');
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [], soil: () => false }).length === 0, 'no soil: none');
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 1, oz: 1, y: 64 }], greens: [], hard: [], soil: soilAll }).length === 0, 'a diagonal door: none');
}
// The ring round a green's centre: an empty centre takes it; a building there (a statue) refuses it, since build_design
// works on the ring's whole box
{
  ok(gardenSpots({ doors: [], greens: [{ x: 50, z: 50, y: 64 }], hard: [], structures: [{ x1: 49, z1: 49, x2: 51, z2: 51 }], soil: soilAll }).length === 0, 'a statue at the centre: no ring');
  const r = gardenSpots({ doors: [], greens: [{ x: 50, z: 50, y: 64 }], hard: [], soil: soilAll })[0];
  ok(!!r && r.kind === 'flower_ring' && r.x === 50 && r.z === 50, `a ring centred on the green (${JSON.stringify(r)})`);
  ok(!!r && r.cells.length === 12 && r.cells.every((c) => Math.max(Math.abs(c.x - 50), Math.abs(c.z - 50)) === 2) && !r.cells.some((c) => (c.x === 50 || c.z === 50)), 'its 12 cells on the 5x5 border, each side\'s middle open');
  ok(!!r && JSON.stringify(planted('flower_ring', r.x, r.z)) === JSON.stringify(r.cells.map(key).sort()), 'build_design plants the ring\'s cells');
}
// #46: a tree at each green or plot corner whose 5x5 canopy is clear; a hard cell within 2 drops that corner
{
  const t = gardenSpots({ doors: [], greens: [{ x: 10, z: 10, y: 64, x1: 0, z1: 0, x2: 20, z2: 20 }], hard: [{ x1: 17, z1: 17, x2: 17, z2: 17 }], soil: soilAll }).filter((s) => s.kind === 'sapling');
  ok(t.length === 3 && t.every((s) => s.cells.length === 1 && s.x === s.cells[0].x) && !t.some((s) => s.x === 18 && s.z === 18), `three corner trees, the one by the hard cell dropped (${t.map((s) => `${s.x},${s.z}`).join(' ')})`);
  ok(gardenSpots({ doors: [], greens: [], plots: [{ x1: 0, z1: 0, x2: 4, z2: 4, y: 64 }], hard: [], soil: soilAll }).length === 0, 'a plot too small for a canopy: none');
  const d = GARDEN_WORKS.find((k) => k.kind === 'sapling')!.make('birch');
  ok(d.palette.T === 'birch_sapling[stage=0]' && d.width === 1 && d.depth === 1, 'a birch village plants birch');
}

// Goals and the flag
ok(['front_bed', 'flower_ring', 'sapling'].every((k) => BEAUTY_WORKS.has(k) && !STANDING_WORKS.has(k)), 'gardens count toward beauty, not standing');
ok(GARDENS || !SMALL_WORKS.some((k) => GARDEN_WORKS.includes(k)), 'off by default: SMALL_WORKS without the gardens');
for (const k of GARDEN_WORKS.filter((x) => x.kind !== 'sapling')) {
  const d = k.make('birch');
  ok(d.palette.F.startsWith('wildflowers') && d.layers[0].every((row) => /^_+$/.test(row)), `${k.kind}: flowers on the ground as it is`);
}

console.log(`gardens_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
