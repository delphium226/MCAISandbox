/**
 * Buildings every village gets, drawn in code rather than by the architect: the storage hut (and, later, the mining
 * hut). Code lays them out with the village's first layout and knows where things go inside them.
 */
import type { Area, Design } from './village';
import { annexCandidates } from './farmSlots';
import { rawSetting } from './settings';

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

/**
 * The open-sided storage hut (MC_OPEN_STORAGE; always on by default since 10-25, the user's: "the storage shed must always be open sided"; the user's, 10-24): the same footprint, floor, roof,
 * chest, barrel and station spots, but no walls: log posts at the four corners and halfway along each long side (the
 * torches' and the sign's support: a wall torch on a post, the name sign over the entrance on the roof's edge), so members
 * reach the chests from outside as well as from the aisle (#77: a member walled into a pocket under the hut).
 */
export const OPEN_STORAGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_OPEN_STORAGE') ?? 'on');
const OPEN_LAYERS = [
  Array(9).fill('CCCCCCC'),
  ['L.....L', '._._._.', '.......', '._..._.', 'L.T.F.L', '._..._.', '.......', '._..._.', 'L.....L'],
  ['L.....L', ...Array(3).fill('.......'), 'L.....L', ...Array(3).fill('.......'), 'L.....L'],
  Array(9).fill('PPPPPPP'),
];

/** Chest spots in hut cells (x west to east, z north to south), in the order chests are put down: from the door inward. */
export const STORAGE_HUT_SPOTS: Array<[number, number]> = [[1, 7], [5, 7], [1, 5], [5, 5], [1, 3], [5, 3], [1, 1], [5, 1], [3, 1]];

/**
 * Barrel spots in hut cells (s40, F256): the six cells along the side walls between the chest spots, from the door
 * inward. Barrels never join (a chest beside a chest makes a double chest), so they stand beside chests; taken after
 * the free chest spots (MC_STORAGE_BARRELS). +162 slots: 405 in all.
 */
export const STORAGE_HUT_BARREL_SPOTS: Array<[number, number]> = [[1, 6], [5, 6], [1, 4], [5, 4], [1, 2], [5, 2]];

/** The crafting table and furnace in hut cells. */
export const STORAGE_HUT_STATIONS = { crafting_table: [2, 4], furnace: [4, 4] } as const;

/** Where to stand to put the first chest down: the aisle cell beside spot 1. */
export const STORAGE_HUT_STAND: [number, number] = [2, 7];

export function storageHutDesign(open = OPEN_STORAGE): Design {
  const palette = { C: 'cobblestone', P: 'oak_planks', L: 'oak_log', T: 'crafting_table', F: 'furnace' };
  const layers = open ? OPEN_LAYERS : LAYERS;
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: STORAGE_HUT,
    description: `the village storage hut${open ? ', open-sided' : ''}, built by code: plan_layout adds it by itself (not a design to build or copy)`,
    palette, layers: layers.map((l) => [...l]), width: 7, depth: 9, height: layers.length, blocks, by: 'code',
  };
}

/**
 * MC_STORAGE_GROW (#121; on by default since 10-24, the user's after test train 1; off turns it off): storage that grows. A deposit keeps at most a cap of each bulk stone kind
 * (the rest goes on the spoil heap), and a storage yard is prepared beside the village once the hut is nearly full.
 */
export const STORAGE_GROW = !/^(off|0|false|no)$/i.test(rawSetting('MC_STORAGE_GROW') ?? 'on');

/**
 * The storage yard's barrel spots (#121), for a yard on side `side` of the plot (the annex's 13x9 geometry: 13 along the
 * plot's edge, 9 away from it): two double rows along the long axis, at depths 2-3 and 5-6, cells 1-11 along it, so every
 * barrel has an aisle cell beside it (depths 1, 4 and 7; barrels never join, so they stand side by side). `stand`: that
 * aisle cell. Nearest `door` first. 44 spots.
 */
export function storageYardSpots(r: { x1: number; z1: number; x2: number; z2: number; side: 'n' | 's' | 'e' | 'w' }, door: { x: number; z: number }): Array<{ x: number; z: number; stand: { x: number; z: number } }> {
  const along = r.side === 'n' || r.side === 's';
  const len = along ? r.x2 - r.x1 + 1 : r.z2 - r.z1 + 1;
  const out: Array<{ x: number; z: number; stand: { x: number; z: number } }> = [];
  const cell = (i: number, d: number) => (along ? { x: r.x1 + i, z: r.z1 + d } : { x: r.x1 + d, z: r.z1 + i });
  for (const [d, aisle] of [[2, 1], [3, 4], [5, 4], [6, 7]]) for (let i = 1; i <= len - 2; i++) out.push({ ...cell(i, d), stand: cell(i, aisle) });
  const dist = (s: { x: number; z: number }) => Math.abs(s.x - door.x) + Math.abs(s.z - door.z);
  return out.sort((p, q) => dist(p) - dist(q) || p.x - q.x || p.z - q.z);
}

/**
 * Where a storage yard may go (#121): the annex's 13x9 candidates round the plot, 3, 7 and 11 blocks out (a grown village
 * leaves little room right beside its plot: im2_mine's first ring was all taken).
 */
export const storageYardCandidates = (plot: Area) => [0, 4, 8].flatMap((o) => annexCandidates({ x1: plot.x1 - o, z1: plot.z1 - o, x2: plot.x2 + o, z2: plot.z2 + o }));

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
