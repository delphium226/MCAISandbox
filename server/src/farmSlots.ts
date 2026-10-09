/**
 * Farm slots (opportunistic farming, 10-08): what each kind plants where on a 5x7 slot, and what it takes to start one.
 * A slot has the wheat field's shape (streetPlan.ts placeFarm): 5 cells across a water channel (the middle column), 7
 * along it. Pure geometry and tables, shared by the skills (mcBuild.ts start_farm, harvest_slot), the world's chores
 * (mcWorld.ts) and the offline check (scripts/checks/street_plan.mts).
 */
import type { FarmSpot } from './streetPlan';
import type { Area } from './village';

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

/**
 * The annex (10-09, the user's choice: pens on an extra plot beside the village, not on the plot's slots): 13 along the
 * plot's edge by 9 out, its inner edge 3 out from the plot (past prepare_site's 2-block margin), on any side, sliding by 1
 * along the edge. `side` is where it lies from the plot. Pure geometry: mcBuild.ts annexSpot scores the ground.
 */
export type Side = 'n' | 's' | 'e' | 'w';
export const ANNEX: [number, number] = [13, 9];

export function annexCandidates(plot: Area): Array<Area & { side: Side }> {
  const [L, D] = ANNEX;
  const out: Array<Area & { side: Side }> = [];
  for (let x = plot.x1; x + L - 1 <= plot.x2; x++) {
    out.push({ x1: x, x2: x + L - 1, z1: plot.z1 - 3 - D + 1, z2: plot.z1 - 3, side: 'n' });
    out.push({ x1: x, x2: x + L - 1, z1: plot.z2 + 3, z2: plot.z2 + 3 + D - 1, side: 's' });
  }
  for (let z = plot.z1; z + L - 1 <= plot.z2; z++) {
    out.push({ z1: z, z2: z + L - 1, x1: plot.x1 - 3 - D + 1, x2: plot.x1 - 3, side: 'w' });
    out.push({ z1: z, z2: z + L - 1, x1: plot.x2 + 3, x2: plot.x2 + 3 + D - 1, side: 'e' });
  }
  return out;
}

/** The side facing back to the plot from an annex on `side`. */
export const FACING_PLOT: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/**
 * The annex's two 5x7 slots: a 1-cell border and a 1-cell gap, the 7-long axis pointing at the plot (so each pen's gate,
 * in the middle of the end facing the plot, opens onto the annex's border and the margins toward the village). `face`:
 * the slot's side facing the plot.
 */
export function annexSlots(r: Area & { side: Side }): Array<FarmSpot & { face: Side }> {
  const face = FACING_PLOT[r.side];
  if (r.side === 'n' || r.side === 's')
    return [r.x1 + 1, r.x1 + 7].map((x) => ({ x1: x, x2: x + 4, z1: r.z1 + 1, z2: r.z1 + 7, water: { x1: x + 2, x2: x + 2, z1: r.z1 + 1, z2: r.z1 + 7 }, sow: [], face }));
  return [r.z1 + 1, r.z1 + 7].map((z) => ({ z1: z, z2: z + 4, x1: r.x1 + 1, x2: r.x1 + 7, water: { z1: z + 2, z2: z + 2, x1: r.x1 + 1, x2: r.x1 + 7 }, sow: [], face }));
}

export interface PenPlan {
  /** The fence ring (the slot's outer cells but the gate). */
  ring: Array<[number, number]>;
  /** The gate, in the middle of the end facing `face`, and its block state facing (inward, as vanilla's pens). */
  gate: [number, number];
  facing: 'north' | 'south' | 'east' | 'west';
  /** The cell just outside the gate, and the one beyond it (where a luring bot waits). */
  outside: [number, number];
  approach: [number, number];
  /** The back-row cell the luring bot is teleported to, and the inner 3x5 cells. */
  back: [number, number];
  inner: Area;
}

/** A chicken pen on a 5x7 slot (10-09): a fence ring, its gate in the middle of the slot's end facing `face`. */
export function penPlan(s: FarmSpot, face: Side): PenPlan {
  const alongZ = s.water.x1 === s.water.x2;
  // r = 0 is the north end of a slot along z, the west end of one along x
  const fr = (alongZ ? face === 'n' : face === 'w') ? 0 : 6;
  const out = fr === 0 ? -1 : 1;
  const ring: Array<[number, number]> = [];
  for (let c = 0; c < 5; c++)
    for (let r = 0; r < 7; r++) if ((c === 0 || c === 4 || r === 0 || r === 6) && !(c === 2 && r === fr)) ring.push(slotCell(s, c, r));
  const gate = slotCell(s, 2, fr);
  const step = (n: number): [number, number] => (alongZ ? [gate[0], gate[1] + out * n] : [gate[0] + out * n, gate[1]]);
  const facing = alongZ ? (fr === 0 ? 'south' : 'north') : fr === 0 ? 'east' : 'west';
  const [ax, az] = slotCell(s, 1, 1), [bx, bz] = slotCell(s, 3, 5);
  return { ring, gate, facing, outside: step(1), approach: step(2), back: slotCell(s, 2, fr === 0 ? 5 : 1),
    inner: { x1: Math.min(ax, bx), z1: Math.min(az, bz), x2: Math.max(ax, bx), z2: Math.max(az, bz) } };
}
