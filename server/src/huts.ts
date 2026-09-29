/**
 * Buildings every village gets, drawn in code rather than by the architect: the storage hut (and, later, the mining
 * hut). Code lays them out with the village's first layout and knows where things go inside them.
 */
import type { Design } from './village';

export const STORAGE_HUT = 'storage_hut';

/**
 * The storage hut: 7 wide, 9 deep, 4 high; cobblestone floor, plank walls, log corners, plank roof, an oak door in the
 * middle of the south wall, no windows. Inside, 5x7 with nine chest spots ("_": the build leaves what is there, so the
 * hut is built around chests already standing), four along each side wall and one at the back, none side by side (two
 * chests side by side join into a double chest).
 */
const LAYERS = [
  Array(9).fill('CCCCCCC'),
  ['LPPPPPL', 'P_._._P', 'P.....P', 'P_..._P', 'P.....P', 'P_..._P', 'P.....P', 'P_..._P', 'LPPDPPL'],
  ['LPPPPPL', ...Array(7).fill('P.....P'), 'LPP.PPL'],
  Array(9).fill('PPPPPPP'),
];

/** Chest spots in hut cells (x west to east, z north to south), in the order chests are put down: from the door inward. */
export const STORAGE_HUT_SPOTS: Array<[number, number]> = [[1, 7], [5, 7], [1, 5], [5, 5], [1, 3], [5, 3], [1, 1], [5, 1], [3, 1]];

/** Where to stand to put the first chest down: the aisle cell beside spot 1. */
export const STORAGE_HUT_STAND: [number, number] = [2, 7];

export function storageHutDesign(): Design {
  const palette = { C: 'cobblestone', P: 'oak_planks', L: 'oak_log', D: 'oak_door' };
  const blocks = LAYERS.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: STORAGE_HUT,
    description: 'the village storage: nine chests inside, sorted by material (built by code, not the architect)',
    palette, layers: LAYERS.map((l) => [...l]), width: 7, depth: 9, height: LAYERS.length, blocks, by: 'code',
  };
}

/** A storage hut's chest spots in the world, for a hut whose footprint starts at x1, z1 (not rotated). */
export const hutSpots = (x1: number, z1: number) => STORAGE_HUT_SPOTS.map(([x, z]) => ({ x: x1 + x, z: z1 + z }));
