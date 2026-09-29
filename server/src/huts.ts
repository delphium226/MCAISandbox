/**
 * Buildings every village gets, drawn in code rather than by the architect: the storage hut (and, later, the mining
 * hut). Code lays them out with the village's first layout and knows where things go inside them.
 */
import type { Design } from './village';

export const STORAGE_HUT = 'storage_hut';

/**
 * The storage hut: 7 wide, 9 deep, 4 high; cobblestone floor, plank walls, log corners, plank roof, an open doorway in
 * the middle of the south wall (no door: a bot in an open door's cell still caught on its panel, StageH7), no windows.
 * Inside, 5x7 with nine chest spots ("_": the build leaves what is there, so the hut is built around chests already
 * standing), four along each side wall and one at the back, none side by side (two chests side by side join into a
 * double chest). The village's crafting table and furnace stand in the middle, off the
 * aisle and off the cells workers stand on to reach the chests: the village crafts and smelts there (V.2b).
 */
const LAYERS = [
  Array(9).fill('CCCCCCC'),
  ['LPPPPPL', 'P_._._P', 'P.....P', 'P_..._P', 'P.T.F.P', 'P_..._P', 'P.....P', 'P_..._P', 'LPP.PPL'],
  ['LPPPPPL', ...Array(7).fill('P.....P'), 'LPP.PPL'],
  Array(9).fill('PPPPPPP'),
];

/** Chest spots in hut cells (x west to east, z north to south), in the order chests are put down: from the door inward. */
export const STORAGE_HUT_SPOTS: Array<[number, number]> = [[1, 7], [5, 7], [1, 5], [5, 5], [1, 3], [5, 3], [1, 1], [5, 1], [3, 1]];

/** The crafting table and furnace in hut cells. */
export const STORAGE_HUT_STATIONS = { crafting_table: [2, 4], furnace: [4, 4] } as const;

/** Where to stand to put the first chest down: the aisle cell beside spot 1. */
export const STORAGE_HUT_STAND: [number, number] = [2, 7];

export function storageHutDesign(): Design {
  const palette = { C: 'cobblestone', P: 'oak_planks', L: 'oak_log', T: 'crafting_table', F: 'furnace' };
  const blocks = LAYERS.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: STORAGE_HUT,
    description: 'the village storage hut, built by code: plan_layout adds it by itself (not a design to build or copy)',
    palette, layers: LAYERS.map((l) => [...l]), width: 7, depth: 9, height: LAYERS.length, blocks, by: 'code',
  };
}

/** A storage hut's chest spots in the world, for a hut whose footprint starts at x1, z1 (not rotated). */
export const hutSpots = (x1: number, z1: number) => STORAGE_HUT_SPOTS.map(([x, z]) => ({ x: x1 + x, z: z1 + z }));

export const MINING_HUT = 'mining_hut';

/**
 * The mining hut (plan step V.5): 5x5, 4 high, wood only (planks, log corners, an open doorway in the middle of the south
 * wall), so it goes up before the village has any cobblestone. Inside, the top of the mine's staircase: three floor cells
 * in a line from the middle toward the north wall are open ('.'), the last one under the wall, and the stairs go on
 * down northward from there, one block down per step, three blocks of headroom. The layout turns the hut so that the
 * stairs face the nearest edge of the plot: the mine runs out from under the village, not beneath it.
 */
const MINING_LAYERS = [
  ['PP.PP', 'PP.PP', 'PP.PP', 'PPPPP', 'PPPPP'],
  ['LPPPL', 'P...P', 'P...P', 'P...P', 'LP.PL'],
  ['LPPPL', 'P...P', 'P...P', 'P...P', 'LP.PL'],
  Array(5).fill('PPPPP'),
];

export function miningHutDesign(): Design {
  const palette = { P: 'oak_planks', L: 'oak_log' };
  const blocks = MINING_LAYERS.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: MINING_HUT,
    description: 'the village mining hut over the mine stairs, built by code: plan_layout adds it by itself (not a design to build or copy)',
    palette, layers: MINING_LAYERS.map((l) => [...l]), width: 5, depth: 5, height: MINING_LAYERS.length, blocks, by: 'code',
  };
}

/** A 5x5 hut cell turned clockwise `rot` times, as build_design turns designs. */
function turn5(i: number, j: number, rot: number): [number, number] {
  let [u, v] = [i, j];
  for (let r = 0; r < rot; r++) [u, v] = [4 - v, u];
  return [u, v];
}

/** The mine's first step (hut cell (2,2)) and its direction in the world, for a mining hut at x1, z1 turned `rot` times. */
export function miningStairs(x1: number, z1: number, rot: number): { x: number; z: number; dir: [number, number] } {
  const [tx, tz] = turn5(2, 2, rot);
  const [nx, nz] = turn5(2, 1, rot);
  return { x: x1 + tx, z: z1 + tz, dir: [nx - tx, nz - tz] };
}

/** How many quarter turns make the stairs (north in the design) face the nearest edge of the plot. */
export function miningHutTurn(hut: { x1: number; z1: number; x2: number; z2: number }, plot: { x1: number; z1: number; x2: number; z2: number }): number {
  const room = [hut.z1 - plot.z1, plot.x2 - hut.x2, plot.z2 - hut.z2, hut.x1 - plot.x1];
  return room.indexOf(Math.min(...room));
}
