/**
 * Farm slots (opportunistic farming, 10-08): what each kind plants where on a 5x7 slot, and what it takes to start one.
 * A slot has the wheat field's shape (streetPlan.ts placeFarm): 5 cells across a water channel (the middle column), 7
 * along it. Pure geometry and tables, shared by the skills (mcBuild.ts start_farm, harvest_slot), the world's chores
 * (mcWorld.ts) and the offline check (scripts/checks/street_plan.mts).
 */
import type { FarmSpot } from './streetPlan';

export interface SlotKind {
  /** The block that grows (crops by their block; cane; the stem for pumpkin and melon). */
  block: string;
  /** The item planted, charged one a cell (CHARGE_AS in mcMaterials.ts maps the block to it). */
  item: string;
  /** collect's block or item name for the first plants, how many to bring, and the item made from them by hand. */
  take: string;
  count: number;
  make?: string;
  /** Crops: the age they are ripe at. */
  ripe?: number;
  /** Stem fruit: the block that grows beside the stems. */
  fruit?: string;
  /** Whether the planted cells are farmland (crops, stems) or dirt (cane). */
  farmland: boolean;
}

/** The kinds, in the order a free slot takes them (cheapest and commonest first; the last three only from vanilla villages' fields). */
export const SLOT_KINDS: Record<string, SlotKind> = {
  sugar_cane: { block: 'sugar_cane', item: 'sugar_cane', take: 'sugar_cane', count: 6, farmland: false },
  pumpkin: { block: 'pumpkin_stem', item: 'pumpkin_seeds', take: 'pumpkin', count: 2, make: 'pumpkin_seeds', fruit: 'pumpkin', farmland: true },
  melon: { block: 'melon_stem', item: 'melon_seeds', take: 'melon_slice', count: 6, make: 'melon_seeds', fruit: 'melon', farmland: true },
  carrots: { block: 'carrots', item: 'carrot', take: 'carrot', count: 6, ripe: 7, farmland: true },
  potatoes: { block: 'potatoes', item: 'potato', take: 'potato', count: 6, ripe: 7, farmland: true },
  beetroots: { block: 'beetroots', item: 'beetroot_seeds', take: 'beetroot_seeds', count: 6, ripe: 3, farmland: true },
};
export const SLOT_ORDER = Object.keys(SLOT_KINDS);

/** The cell at column c (0..4 across the channel) and row r (0..6 along it). */
export function slotCell(s: FarmSpot, c: number, r: number): [number, number] {
  return s.water.x1 === s.water.x2 ? [s.x1 + c, s.z1 + r] : [s.x1 + r, s.z1 + c];
}

export interface SlotPlan {
  /** Where the kind grows (its block at the plot's level + 1). */
  cells: Array<[number, number]>;
  /** Where a stem's fruit can grow: every cell neither water nor a stem (the design review's H1: stems on inner rows only). */
  fruit: Array<[number, number]>;
  /** Ground under the cells: farmland, or dirt for cane; the fruit cells dirt. */
  farmland: Array<[number, number]>;
  dirt: Array<[number, number]>;
}

/**
 * Where a kind goes on a slot: crops on the wheat's pattern (columns 0, 1, 3, 4 at rows 0, 2, 4, 6) with every other cell
 * farmland; cane in the two columns beside the water, every row, on dirt; stems in those columns at the inner rows 1, 3, 5
 * (a fruit grows on a neighbouring soil cell, never off the slot), every other cell a dirt fruit cell.
 */
export function slotPlan(s: FarmSpot, kind: string): SlotPlan {
  const k = SLOT_KINDS[kind];
  const out: SlotPlan = { cells: [], fruit: [], farmland: [], dirt: [] };
  for (let c = 0; c < 5; c++)
    for (let r = 0; r < 7; r++) {
      if (c === 2) continue;
      const cell = slotCell(s, c, r);
      if (k.fruit) {
        if ((c === 1 || c === 3) && r % 2 === 1) {
          out.cells.push(cell);
          out.farmland.push(cell);
        } else {
          out.fruit.push(cell);
          out.dirt.push(cell);
        }
      } else if (!k.farmland) {
        if (c === 1 || c === 3) {
          out.cells.push(cell);
          out.dirt.push(cell);
        }
      } else {
        out.farmland.push(cell);
        if (r % 2 === 0) out.cells.push(cell);
      }
    }
  return out;
}
