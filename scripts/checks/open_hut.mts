/**
 * The open-sided storage hut checked offline (MC_OPEN_STORAGE, huts.ts; the user's, 10-24), beside the walled one:
 * - the same footprint, floor, roof, chest, barrel and station cells (only the walls differ), valid with Minecraft's
 *   block states;
 * - every chest and barrel spot reachable: a free cell (layers 1 and 2 clear) a member can walk to from outside the hut
 *   within openChest's reach (3 blocks), and from how many sides (the walled hut: the aisle only);
 * - no stand cell blocked: STORAGE_HUT_STAND and every aisle cell placeClaimed walks to (mcStorage.ts) are free and
 *   reachable, and no free cell inside the footprint is a pocket cut off from outside (#77);
 * - its name sign and torches placed at four turns (placeSigns, buildingLights), every torch on a support;
 * - its bill honest: the walls' planks gone, nothing added but the posts' logs.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/open_hut.mts
 */
import minecraftData from 'minecraft-data';
import { STORAGE_HUT_BARREL_SPOTS, STORAGE_HUT_SPOTS, STORAGE_HUT_STAND, STORAGE_HUT_STATIONS, storageHutDesign } from '../../server/src/huts';
import { validateDesign } from '../../server/src/designs';
import { buildingLights, holdsTorch, placeSigns, torchesWanted } from '../../server/src/streetPlan';
import { designBill } from '../../server/src/mineflayer/mcMaterials';
import type { Design } from '../../server/src/village';

const reg = minecraftData('26.1');
const isPlaceable = (b: string) => !!reg.blocksByName[b.replace(/\[.*$/, '')] && !!reg.itemsByName[b.replace(/\[.*$/, '')];
let failed = 0;
const ok = (c: boolean, msg: string) => {
  if (!c) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const walled = storageHutDesign(false), open = storageHutDesign(true);
ok(open.width === walled.width && open.depth === walled.depth && open.height === walled.height, 'the open hut has another footprint or height');
ok(validateDesign({ ...open, layers: open.layers.map((l) => [...l]), palette: { ...open.palette } }, 'code', { isPlaceable, states: true, requireDoor: false }).errors.length === 0, 'the open hut is not a valid design');
for (const l of [0, 3]) ok(JSON.stringify(open.layers[l]) === JSON.stringify(walled.layers[l]), `layer ${l} (floor, roof) differs`);
// (inside the walls, layer 1 is cell for cell the walled hut's: chests' "_", barrels' and the aisle's ".", the stations)
for (let z = 1; z < 8; z++) ok(open.layers[1][z].slice(1, 6) === walled.layers[1][z].slice(1, 6), `layer 1 row ${z} inside differs`);

// Free cells: layers 1 and 2 clear ("." or "_" with nothing set there: a chest spot is not a stand cell once a chest is on it)
const containers = [...STORAGE_HUT_SPOTS, ...STORAGE_HUT_BARREL_SPOTS];
const stations = Object.values(STORAGE_HUT_STATIONS) as Array<readonly [number, number]>;
const blocked = (d: Design, x: number, z: number) => {
  if (x < 0 || z < 0 || x >= d.width || z >= d.depth) return false;
  if (containers.some(([cx, cz]) => cx === x && cz === z) || stations.some(([sx, sz]) => sx === x && sz === z)) return true;
  return [1, 2].some((l) => !['.', '_'].includes(d.layers[l][z][x]));
};
/** Cells walkable from outside (a ring 4 wide around the footprint counts as open ground). */
function reachable(d: Design): Set<string> {
  const seen = new Set<string>(), queue: Array<[number, number]> = [[-4, -4]];
  seen.add('-4,-4');
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
      if (nx < -4 || nz < -4 || nx > d.width + 3 || nz > d.depth + 3 || seen.has(k) || blocked(d, nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen;
}
const report: string[] = [];
for (const [name, d] of [['walled', walled], ['open', open]] as const) {
  const r = reachable(d);
  const cells = [...r].map((k) => k.split(',').map(Number));
  let outsideReach = 0, edgeNear = 0, sides = 0;
  for (const [cx, cz] of containers) {
    const near = cells.filter(([x, z]) => Math.hypot(x - cx, z - cz) <= 3);
    ok(near.length > 0, `${name}: the container at ${cx},${cz} has no reachable cell within 3`);
    // (a free side on the hut's edge, where the walled hut has its walls: reached from outside without the aisle)
    const edge = (dirs: number[][]) => dirs.some(([dx, dz]) => { const x = cx + dx, z = cz + dz; return r.has(`${x},${z}`) && (x <= 0 || z <= 0 || x >= d.width - 1 || z >= d.depth - 1); });
    if (edge([[1, 0], [-1, 0], [0, 1], [0, -1]])) outsideReach++;
    // (a barrel beside a side post has its edge cells diagonally, a step from it)
    if (edge([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])) edgeNear++;
    sides += [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => r.has(`${cx + dx},${cz + dz}`)).length;
  }
  // Stand cells: the first chest's, and the aisle cell beside each spot (placeClaimed's rule)
  const stands: Array<[number, number]> = [STORAGE_HUT_STAND, ...STORAGE_HUT_SPOTS.map(([x, z]): [number, number] => (x < 3 ? [x + 1, z] : x > 3 ? [x - 1, z] : [x, z + 1]))];
  for (const [x, z] of stands) ok(!blocked(d, x, z) && r.has(`${x},${z}`), `${name}: stand cell ${x},${z} is blocked or cut off`);
  let pockets = 0;
  for (let z = 0; z < d.depth; z++) for (let x = 0; x < d.width; x++) if (!blocked(d, x, z) && !r.has(`${x},${z}`)) pockets++;
  ok(pockets === 0, `${name}: ${pockets} free cells inside cut off from outside`);
  const inFoot = cells.filter(([x, z]) => x >= 0 && z >= 0 && x < d.width && z < d.depth).length;
  report.push(`${name}: ${outsideReach} of ${containers.length} containers with a free side on the hut's edge (reached from outside, not the aisle), ${edgeNear} with one beside or diagonal, ${(sides / containers.length).toFixed(1)} free sides each on average, ${inFoot} free cells inside, ${pockets} pockets`);
  if (name === 'open') ok(edgeNear === containers.length, "open: a container has no free cell on the hut's edge beside it");
}

// Sign and torches at four turns
for (let rot = 0; rot < 4; rot++) {
  const place = { design: open, x: 100, z: -200, rot };
  const sign = placeSigns([place])[0];
  ok(!!sign, `open rot ${rot}: no name sign fits`);
  const spots = buildingLights(place, { signs: sign ? [sign] : [] });
  ok(spots.length > 0, `open rot ${rot}: no torch spot`);
  if (rot === 0) report.push(`open: sign at layer ${sign?.layer} facing ${sign?.facing}; ${spots.length} torch spots (${torchesWanted(open)} wanted), on posts`);
}
// (each code spot's support, at rot 0 in design cells: a wall torch's back is the cell less its facing)
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
// (placed with its centre at 3,4: design cells are the world's)
for (const s of buildingLights({ design: open, x: 3, z: 4, rot: 0 }, {})) {
  if (s.block !== 'wall_torch') continue;
  const [fx, fz] = STEP[s.facing!];
  const back = open.palette[open.layers[s.layer][s.z - fz]?.[s.x - fx] ?? ''];
  ok(holdsTorch(back, s.facing), `open: torch at ${s.x},${s.layer},${s.z} has no support (${back})`);
}

// The bill: the walls' planks gone; the posts' logs the only thing more
const bw = designBill(walled), bo = designBill(open);
const keys = [...new Set([...Object.keys(bw), ...Object.keys(bo)])].sort();
report.push(`bill walled ${JSON.stringify(bw)}, open ${JSON.stringify(bo)}`);
for (const k of keys) if (!/_log$/.test(k)) ok((bo[k] ?? 0) <= (bw[k] ?? 0), `open bill has more ${k}`);
ok((bo.oak_planks ?? 0) < (bw.oak_planks ?? 0), 'the open hut bills as many planks as the walled one');

console.log(report.join('\n'));
console.log(failed ? `FAIL open_hut: ${failed} problems` : 'PASS open_hut: chests reachable from outside, stand cells free, sign and torches placed, bill smaller');
process.exit(failed ? 1 : 0);
