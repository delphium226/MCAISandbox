/**
 * #45's gardens, offline (smallWorks.ts gardenSpots, MC_GARDENS): a front garden either side of a door's walkway, 1-2
 * cells out from the wall, never on the walkway's own column (the door, its stand cells) and never on a hard area or off
 * soil; both walkway directions; a flower ring round a green's centre, open on each side; build_design's centre puts the
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

// A door at (10, 20) in a south wall, opening south (oz +1): the walkway is x = 10, z = 21.. (the stand cells beside it)
{
  const s = gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [], soil: soilAll });
  ok(s.length === 1 && s[0].kind === 'garden_ns', `one north-south garden (${JSON.stringify(s)})`);
  const cells = s[0].cells.map(key).sort();
  ok(cells.length === 8 && cells.every((c) => !c.startsWith('10,')), `8 cells, none on the walkway's column x=10 (${cells.join(' ')})`);
  ok(s[0].cells.every((c) => c.z === 21 || c.z === 22) && s[0].cells.every((c) => Math.abs(c.x - 10) >= 1 && Math.abs(c.x - 10) <= 2), 'rows 1-2 out from the wall, 1-2 cells either side');
  ok(JSON.stringify(planted('garden_ns', s[0].x, s[0].z)) === JSON.stringify(cells), 'build_design plants exactly the spot\'s cells');
}
// Opening north (oz -1), and east/west (ox +-1)
{
  const n = gardenSpots({ doors: [{ x: 0, z: 0, ox: 0, oz: -1, y: 64 }], greens: [], hard: [], soil: soilAll })[0];
  ok(!!n && n.cells.every((c) => (c.z === -1 || c.z === -2) && c.x !== 0) && JSON.stringify(planted('garden_ns', n.x, n.z)) === JSON.stringify(n.cells.map(key).sort()), 'opening north');
  const e = gardenSpots({ doors: [{ x: 5, z: 5, ox: 1, oz: 0, y: 64 }], greens: [], hard: [], soil: soilAll })[0];
  ok(!!e && e.kind === 'garden_ew' && e.cells.length === 8 && e.cells.every((c) => (c.x === 6 || c.x === 7) && c.z !== 5) && JSON.stringify(planted('garden_ew', e.x, e.z)) === JSON.stringify(e.cells.map(key).sort()), 'opening east');
  const w = gardenSpots({ doors: [{ x: 5, z: 5, ox: -1, oz: 0, y: 64 }], greens: [], hard: [], soil: soilAll })[0];
  ok(!!w && w.cells.every((c) => (c.x === 4 || c.x === 3) && c.z !== 5), 'opening west');
}
// A hard area (a lamp beside the walkway) or a cell off soil drops the garden; a diagonal door is refused
{
  const hard: GardenInput['hard'] = [{ x1: 12, z1: 22, x2: 12, z2: 22 }];
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard, soil: soilAll }).length === 0, 'a lamp on a bed cell: no garden');
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [], soil: (x, z) => !(x === 8 && z === 21) }).length === 0, 'a cell off soil: no garden');
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 1, oz: 1, y: 64 }], greens: [], hard: [], soil: soilAll }).length === 0, 'a diagonal door: none');
  // (the walkway itself hard, as a street: still a garden, since none of its cells is the walkway)
  ok(gardenSpots({ doors: [{ x: 10, z: 20, ox: 0, oz: 1, y: 64 }], greens: [], hard: [{ x1: 10, z1: 21, x2: 10, z2: 40 }], soil: soilAll }).length === 1, 'a street on the walkway column: the garden stays beside it');
}
// The ring round a green's centre (a 3x3 statue there, left alone)
{
  const r = gardenSpots({ doors: [], greens: [{ x: 50, z: 50, y: 64 }], hard: [{ x1: 49, z1: 49, x2: 51, z2: 51 }], soil: soilAll })[0];
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
ok(['garden_ns', 'garden_ew', 'flower_ring', 'sapling'].every((k) => BEAUTY_WORKS.has(k) && !STANDING_WORKS.has(k)), 'gardens count toward beauty, not standing');
ok(GARDENS || !SMALL_WORKS.some((k) => GARDEN_WORKS.includes(k)), 'off by default: SMALL_WORKS without the gardens');
for (const k of GARDEN_WORKS.filter((x) => x.kind !== 'sapling')) {
  const d = k.make('birch');
  ok(d.palette.F.startsWith('wildflowers') && d.layers[0].every((row) => /^_+$/.test(row)), `${k.kind}: flowers on the ground as it is`);
}

console.log(`gardens_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
