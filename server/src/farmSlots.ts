/**
 * Farm slots (opportunistic farming, 10-08): what each kind plants where on a 5x7 slot, and what it takes to start one.
 * A slot has the wheat field's shape (streetPlan.ts placeFarm): 5 cells across a water channel (the middle column), 7
 * along it. Pure geometry and tables, shared by the skills (mcBuild.ts start_farm, harvest_slot), the world's chores
 * (mcWorld.ts) and the offline check (scripts/checks/street_plan.mts).
 */
import { rawSetting } from './settings';
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

export function annexCandidates(plot: Area, size: [number, number] = ANNEX): Array<Area & { side: Side }> {
  const [L, D] = size;
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
  /** The back-row cell the luring bot is teleported to, and the inner 3x5 cells (#139: the inside's bounding box). */
  back: [number, number];
  inner: Area;
  /** #139: the inside as boxes (one for a rectangle, two for an L; animals are counted in these) and its cells. */
  boxes: Area[];
  area: number;
}

/**
 * #139 (MC_PEN_VARIETY; on by default since 10-25, the user's, after train 5; =off for the classic pens): pens of varied
 * sizes and shapes on a larger annex, and more kinds of animals (sheep, pigs, rabbits, goats besides chickens and cows),
 * each pen's cap from its inside area.
 */
export const PEN_VARIETY = !/^(off|0|false|no)$/i.test(rawSetting('MC_PEN_VARIETY') ?? 'on');

/**
 * The animals a pen holds (pens v2, 10-09; #139 adds four; from the jar's tags: chicken_food, cow_food, sheep_food,
 * pig_food, rabbit_food, goat_food): the items they follow and breed on (the first storage holds is used; seeds also come
 * from the grass), the most a 3x5 pen keeps, the inside cells each needs in a pen of another size (#139: 3x5 holds 6
 * chickens and 4 cows, as before) and the herd a pen is chosen for. Never in SLOT_KINDS: a pen is not harvested.
 */
export const PEN_KINDS: Record<string, { lure: string; lures?: string[]; cap: number; area: number; herd: number }> = {
  chicken: { lure: 'wheat_seeds', cap: 6, area: 2.5, herd: 6 },
  cow: { lure: 'wheat', cap: 4, area: 3.75, herd: 4 },
  sheep: { lure: 'wheat', cap: 4, area: 3.5, herd: 6 },
  pig: { lure: 'carrot', lures: ['carrot', 'potato', 'beetroot'], cap: 4, area: 3.5, herd: 4 },
  rabbit: { lure: 'carrot', lures: ['carrot', 'dandelion', 'golden_carrot'], cap: 6, area: 2.5, herd: 4 },
  goat: { lure: 'wheat', cap: 3, area: 4.5, herd: 3 },
};
/** The kinds pens are offered for, in order: chickens and cows (as before); with #139 sheep and pigs (common at every
 *  test site, runs/2026-10-25/pens-flowers/measure.md) and rabbits and goats (none near the test sites). */
export const PEN_ORDER = PEN_VARIETY ? ['chicken', 'sheep', 'pig', 'cow', 'rabbit', 'goat'] : ['chicken', 'cow'];
/** Every lure of a kind (the first is its default). */
export const penLures = (kind: string): string[] => PEN_KINDS[kind]?.lures ?? (PEN_KINDS[kind] ? [PEN_KINDS[kind].lure] : []);
/** The lure a kind is led and bred with: the first of its lures `store` holds, else its default. */
export function penLure(kind: string, store: Record<string, number> = {}): string {
  const all = penLures(kind);
  return all.find((l) => (store[l] ?? 0) > 0) ?? all[0];
}
/** A chicken lays one by its variant (the jar's chicken_lay): temperate, warm, cold; a cake takes any. */
export const EGGS = ['egg', 'brown_egg', 'blue_egg'];

/** A pen on a 5x7 slot (10-09): a fence ring, its gate in the middle of the slot's end facing `face`; #139: a slot with a
 *  `shape` is planned by penShapePlan. */
export function penPlan(s: FarmSpot & { shape?: PenShape }, face: Side): PenPlan {
  if (s.shape) return penShapePlan(s, face, s.shape);
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
  const inner = { x1: Math.min(ax, bx), z1: Math.min(az, bz), x2: Math.max(ax, bx), z2: Math.max(az, bz) };
  return { ring, gate, facing, outside: step(1), approach: step(2), back: slotCell(s, 2, fr === 0 ? 5 : 1), inner, boxes: [inner], area: 15 };
}

// ---- #139 (MC_PEN_VARIETY): pens of varied sizes and shapes ----

/**
 * A pen's shape: `w` cells across (odd: the gate in the middle of the end facing the plot), `l` along, fence ring
 * included; `cut`: an L, a corner of [across, along] cells cut from the far end on the high-column side (less than half
 * across less one, so the gate's column runs inside the whole length).
 */
export interface PenShape { name: string; w: number; l: number; cut?: [number, number] }

/** The shapes (outer sizes with the fence; insides 3x3 to 7x9, and an L of 9x9 less a 3x4 corner). */
export const PEN_SHAPES: Record<string, PenShape> = {
  small: { name: 'small', w: 5, l: 5 },
  standard: { name: 'standard', w: 5, l: 7 },
  square: { name: 'square', w: 7, l: 7 },
  long: { name: 'long', w: 7, l: 9 },
  large: { name: 'large', w: 9, l: 11 },
  ell: { name: 'ell', w: 9, l: 9, cut: [3, 4] },
};

/** The varied annex (#139): 25 along the plot's edge by 13 out, 3 out from the plot as the classic 13x9. */
export const ANNEX_VARIED: [number, number] = [25, 13];

/**
 * #229 (MC_PENS_BIG, on; the user's 11-05: "make the animal farms twice as big and get members to breed the animals"):
 * each shape's inside doubled, longer and as wide (so a set still fits the 25 along the plot's edge), on an annex 18 out
 * in place of 13; a pen's cap follows its area, so the caps double too. A pen built before on a 25x13 annex is enlarged
 * where it stands (enlargedSlot: its far end moved out to the annex's edge).
 */
export const PENS_BIG = !/^(off|0|false|no)$/i.test(rawSetting('MC_PENS_BIG') ?? 'on');
export const ANNEX_BIG: [number, number] = [25, 18];
/** The doubled shapes (insides 3x6 to 9x14 and an L of 76; twice 9, 15, 25, 35, 63 and 37 or a little more). */
export const PEN_SHAPES_BIG: Record<string, PenShape> = {
  small: { name: 'small', w: 5, l: 8 },
  standard: { name: 'standard', w: 5, l: 12 },
  square: { name: 'square', w: 7, l: 12 },
  long: { name: 'long', w: 7, l: 16 },
  large: { name: 'large', w: 11, l: 16 },
  ell: { name: 'ell', w: 9, l: 15, cut: [3, 5] },
};

/** The sets of pens a varied annex holds (each fits 25 x 13 with a 1-cell border and 1-cell gaps); a village takes one by
 *  its name (penSetFor), so villages differ. */
export const PEN_SETS: string[][] = [
  ['small', 'standard', 'large'],
  ['standard', 'square', 'ell'],
  ['small', 'long', 'ell'],
  ['standard', 'long', 'square'],
  ['small', 'standard', 'standard', 'small'],
];

/** A string's small hash (FNV-1a), for picks that differ by village but never between runs. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The set of pen shapes a village's varied annex holds, by its name (#229: the doubled shapes on a big annex). */
export const penSetFor = (village: string, big = false): PenShape[] => PEN_SETS[hashOf(village.toLowerCase()) % PEN_SETS.length].map((n) => (big ? PEN_SHAPES_BIG : PEN_SHAPES)[n]);

/**
 * A varied annex's pens (#139): its shapes side by side along the edge facing the plot, centred, with a 1-cell border and
 * 1-cell gaps, each reaching its `l` out from the annex's border on the plot's side (the gate end, as annexSlots'). Each
 * slot is a FarmSpot whose `water` is its middle column (only the slot's direction is read from it) with its shape.
 */
export function variedAnnexSlots(r: Area & { side: Side }, shapes: PenShape[]): Array<FarmSpot & { face: Side; shape: PenShape }> {
  const face = FACING_PLOT[r.side];
  const alongX = r.side === 'n' || r.side === 's';
  const len = alongX ? r.x2 - r.x1 + 1 : r.z2 - r.z1 + 1;
  const used = shapes.reduce((s, q) => s + q.w, 0) + shapes.length - 1;
  let at = (alongX ? r.x1 : r.z1) + Math.max(1, Math.floor((len - used) / 2));
  const out: Array<FarmSpot & { face: Side; shape: PenShape }> = [];
  for (const shape of shapes) {
    let a1: number, a2: number;
    if (r.side === 'n') [a1, a2] = [r.z2 - shape.l, r.z2 - 1];
    else if (r.side === 's') [a1, a2] = [r.z1 + 1, r.z1 + shape.l];
    else if (r.side === 'w') [a1, a2] = [r.x2 - shape.l, r.x2 - 1];
    else [a1, a2] = [r.x1 + 1, r.x1 + shape.l];
    const mid = at + (shape.w - 1) / 2;
    const spot: FarmSpot = alongX
      ? { x1: at, x2: at + shape.w - 1, z1: a1, z2: a2, water: { x1: mid, x2: mid, z1: a1, z2: a2 }, sow: [] }
      : { z1: at, z2: at + shape.w - 1, x1: a1, x2: a2, water: { z1: mid, z2: mid, x1: a1, x2: a2 }, sow: [] };
    out.push({ ...spot, face, shape });
    at += shape.w + 1;
  }
  return out;
}

/** The cell at column c (0..w-1 across) and row r (0..l-1 along) of a shaped slot (slotCell's rule at any size). */
function shapeCell(s: FarmSpot, c: number, r: number): [number, number] {
  return s.water.x1 === s.water.x2 ? [s.x1 + c, s.z1 + r] : [s.x1 + r, s.z1 + c];
}

/**
 * A shaped pen's plan (#139): the shape's cells (an L less its cut corner), the ring every cell with a neighbour of 8
 * outside the shape (an L's inner corner too), the gate in the middle of the end facing `face`, the inside the rest, as
 * boxes of rows with the same span (one for a rectangle, two for an L).
 */
export function penShapePlan(s: FarmSpot, face: Side, shape: PenShape): PenPlan {
  const { w, l } = shape;
  const alongZ = s.water.x1 === s.water.x2;
  const fr = (alongZ ? face === 'n' : face === 'w') ? 0 : l - 1;
  const cutL = shape.cut?.[1] ?? 0;
  const far = (r: number) => (fr === 0 ? r >= l - cutL : r < cutL);
  const inShape = (c: number, r: number) => c >= 0 && c < w && r >= 0 && r < l && !(shape.cut && far(r) && c >= w - shape.cut[0]);
  const isRing = (c: number, r: number) => {
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (!inShape(c + dc, r + dr)) return true;
    return false;
  };
  const mid = (w - 1) / 2;
  const ring: Array<[number, number]> = [];
  const spans = new Map<number, [number, number]>();
  for (let r = 0; r < l; r++)
    for (let c = 0; c < w; c++) {
      if (!inShape(c, r)) continue;
      if (isRing(c, r)) {
        if (!(c === mid && r === fr)) ring.push(shapeCell(s, c, r));
      } else {
        const sp = spans.get(r);
        spans.set(r, sp ? [Math.min(sp[0], c), Math.max(sp[1], c)] : [c, c]);
      }
    }
  // (consecutive rows with the same span make one box)
  const boxes: Area[] = [];
  let run: { r1: number; r2: number; sp: [number, number] } | null = null;
  const flush = () => {
    if (!run) return;
    const [ax, az] = shapeCell(s, run.sp[0], run.r1), [bx, bz] = shapeCell(s, run.sp[1], run.r2);
    boxes.push({ x1: Math.min(ax, bx), z1: Math.min(az, bz), x2: Math.max(ax, bx), z2: Math.max(az, bz) });
    run = null;
  };
  for (let r = 0; r < l; r++) {
    const sp = spans.get(r);
    if (sp && run && run.sp[0] === sp[0] && run.sp[1] === sp[1]) run.r2 = r;
    else {
      flush();
      if (sp) run = { r1: r, r2: r, sp };
    }
  }
  flush();
  const gate = shapeCell(s, mid, fr);
  const out = fr === 0 ? -1 : 1;
  const step = (n: number): [number, number] => (alongZ ? [gate[0], gate[1] + out * n] : [gate[0] + out * n, gate[1]]);
  const facing = alongZ ? (fr === 0 ? 'south' : 'north') : fr === 0 ? 'east' : 'west';
  const inner = { x1: Math.min(...boxes.map((b) => b.x1)), z1: Math.min(...boxes.map((b) => b.z1)), x2: Math.max(...boxes.map((b) => b.x2)), z2: Math.max(...boxes.map((b) => b.z2)) };
  const area = boxes.reduce((n, b) => n + (b.x2 - b.x1 + 1) * (b.z2 - b.z1 + 1), 0);
  return { ring, gate, facing, outside: step(1), approach: step(2), back: shapeCell(s, mid, fr === 0 ? l - 2 : 1), inner, boxes, area };
}

/** A shape's inside cells (its plan's area, on no slot in particular). */
export function penShapeArea(shape: PenShape): number {
  const m = (shape.w - 1) / 2;
  return penShapePlan({ x1: 0, z1: 0, x2: shape.w - 1, z2: shape.l - 1, water: { x1: m, x2: m, z1: 0, z2: shape.l - 1 }, sow: [] }, 'n', shape).area;
}

/** The most a pen keeps (#139: a shaped pen by its inside area, at least 2; a classic 3x5 by the kind's cap). */
export function penCap(kind: string, s: { shape?: PenShape }): number {
  const k = PEN_KINDS[kind];
  if (!k) return 0;
  return s.shape ? Math.max(2, Math.floor(penShapeArea(s.shape) / k.area)) : k.cap;
}

/** Which free slot suits a kind (#139): the one whose inside is nearest the area of the kind's herd, the larger on a tie. */
export function penSlotFit<T extends { shape?: PenShape }>(kind: string, free: T[]): T | undefined {
  const k = PEN_KINDS[kind];
  if (!k || free.length < 2) return free[0];
  const want = k.herd * k.area;
  const area = (q: T) => (q.shape ? penShapeArea(q.shape) : 15);
  return [...free].sort((p, q) => Math.abs(area(p) - want) - Math.abs(area(q) - want) || area(q) - area(p))[0];
}

/** A pen's size in words for menus and notes (#139): "3x5", "small 3x3", "L-shaped (33 cells)". */
export function penWords(s: { shape?: PenShape }): string {
  const sh = s.shape;
  if (!sh) return '3x5';
  return sh.cut ? `L-shaped (${penShapeArea(sh)} cells)` : `${sh.name} ${sh.w - 2}x${sh.l - 2}`;
}

/**
 * The works plot's furnaces (S.9): a 13x9 plot of the annex's geometry, its first slot holding a row of three (the second
 * stays free for a sheep pen later). They stand at columns 0, 2 and 4 of the row one in from the slot's end facing the
 * plot (a free column between them), each facing its stand cell on that end row.
 */
export function worksFurnaces(r: Area & { side: Side }): Array<{ x: number; z: number; stand: [number, number]; facing: 'north' | 'south' | 'east' | 'west' }> {
  const s = annexSlots(r)[0];
  const alongZ = s.water.x1 === s.water.x2;
  // (fr as penPlan: the end row facing the plot)
  const fr = (alongZ ? s.face === 'n' : s.face === 'w') ? 0 : 6;
  const row = fr === 0 ? 1 : 5;
  const facing = alongZ ? (fr === 0 ? 'north' : 'south') : fr === 0 ? 'west' : 'east';
  return [0, 2, 4].map((c) => {
    const [x, z] = slotCell(s, c, row);
    return { x, z, stand: slotCell(s, c, fr), facing };
  });
}

/** #229: the inside a pen's shape had before the doubling (a classic slot's 3x5 as the standard shape). */
export function baseArea(s: { shape?: PenShape }): number {
  const sh = s.shape ?? PEN_SHAPES.standard;
  const base = PEN_SHAPES[sh.name];
  // (a shape of the same name but longer is a doubled one already: its base is the table's)
  return base ? penShapeArea(base) : penShapeArea(sh);
}

/**
 * #229 (MC_PENS_BIG): a built pen enlarged where it stands: its far end (away from the gate) moved out, one row at a time,
 * until the inside is twice its base's or the annex's edge is reached (the annex's own outer row may be used: the
 * prepared margin lies past it). Returns the slot's new rectangle, water line and shape, or null when it cannot grow (a
 * doubled pen, or no room).
 */
export function enlargedSlot(s: FarmSpot & { shape?: PenShape; face?: Side }, annex: Area): (FarmSpot & { shape: PenShape }) | null {
  const sh: PenShape = s.shape ?? PEN_SHAPES.standard;
  const face = s.face ?? 'n';
  const alongZ = s.water.x1 === s.water.x2;
  const gateLow = alongZ ? face === 'n' : face === 'w';
  const want = 2 * baseArea({ shape: sh });
  if (penShapeArea(sh) >= want) return null;
  // (room: from the far end to the annex's edge)
  const room = alongZ ? (gateLow ? annex.z2 - s.z2 : s.z1 - annex.z1) : gateLow ? annex.x2 - s.x2 : s.x1 - annex.x1;
  let l = sh.l;
  while (l < sh.l + room && penShapeArea({ ...sh, l }) < want) l++;
  if (l === sh.l) return null;
  const k = l - sh.l;
  const r = { x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2 };
  if (alongZ) gateLow ? (r.z2 += k) : (r.z1 -= k);
  else gateLow ? (r.x2 += k) : (r.x1 -= k);
  const water = alongZ ? { x1: s.water.x1, x2: s.water.x2, z1: r.z1, z2: r.z2 } : { z1: s.water.z1, z2: s.water.z2, x1: r.x1, x2: r.x2 };
  return { ...r, water, sow: s.sow ?? [], shape: { ...sh, l } };
}

/** #229: a pen is restocked below this many animals (a chicken pen below 4, the feathers' floor; any other below 2). */
export const restockLine = (kind: string): number => (kind === 'chicken' ? 4 : 2);
