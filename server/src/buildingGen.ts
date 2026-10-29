/**
 * Buildings drawn by code from a style (phase D, D.2): the architect chooses the size, materials and roof, and code
 * draws the layers, so the roof covers everything, every stair faces uphill, gable ends and walls are whole, windows sit
 * symmetrically and the door stands in an outer wall with room in front of it. World-independent, like huts.ts: a
 * Design comes out, built, billed and laid out like a drawn one. Stair shapes (corners, valleys) are left to the server,
 * which works them out from the neighbours when /setblock or /fill places a stair; stairShape() is vanilla's rule, for
 * checks.
 */
import type { Design } from './village';
import { HOME_BOX, HOUSE_WALLS, LANDMARK_WALLS } from './designs';

/** What the architect gives instead of layers (the submit_style tool). Sizes are the walls; an overhang adds a ring. */
export interface BuildingStyle {
  name: string;
  description: string;
  width: number;
  depth: number;
  wall_height: number;
  floor: 'none' | 'planks' | 'cobblestone';
  /** The lowest course of the walls (a stone base under wood). */
  base: 'none' | 'cobblestone' | 'stone_bricks' | 'sandstone';
  /** Logs: upright logs at the corners and a ring of logs laid on their side at the top of the walls. */
  frame: 'none' | 'logs' | 'timber';
  walls: 'planks' | 'logs' | 'cobblestone' | 'stone_bricks' | 'sandstone';
  roof: 'gable' | 'hip' | 'flat';
  /** Which way the ridge runs: x (east-west) or z (north-south); by default along the longer side. */
  roof_axis?: 'x' | 'z';
  roof_material: 'planks' | 'cobblestone' | 'stone_bricks' | 'sandstone' | 'stone';
  /** 1: the roof reaches a block past the walls (pitched roofs only). */
  overhang: number;
  windows: 'glass' | 'panes' | 'open' | 'none';
  door_side: 'north' | 'east' | 'south' | 'west';
  // ---- v2 (#104's R3, members' own houses; spec runs/2026-10-23/building-variety/spec_r3.md). All optional: a style
  // with none of them is drawn by the old path, unchanged. With any, generateV2 draws it (the door on the south side).
  /** rect, or a main block with a wing in front (south): L at one end, T in the middle. */
  footprint?: 'rect' | 'L' | 'T';
  /** The wing's walls: its side (L only), width (odd) and depth. */
  wing?: { side?: 'east' | 'west'; width: number; depth: number };
  /** 1 or 2; two storeys take wall_height 3 each, with a planks floor between and a ladder up. */
  storeys?: number;
  /** The second storey's walls (stone below, planks above). */
  upper_walls?: BuildingStyle['walls'];
  /** Every wooden block's wood (oak by default). */
  wood?: string;
  /** timber (in `frame`): log posts at the corners and every third cell of walls of 7 or more, a log beam atop each storey. */
  windows_pattern?: 'rhythm' | 'single' | 'wide';
  /** The door's cell from the middle of its wall: -1 (west), 0, 1 (east). */
  door_offset?: number;
  porch?: boolean;
  chimney?: boolean;
  shutters?: boolean;
  /** Not drawn: whose house it is and its neighbourhood's family (houseStyle.ts; what the world keys on, lesson 89). */
  owner?: string;
  family?: string;
  /** Not drawn: a member's own design (#174, MC_HOME_DESIGN=model) and its one-line reason. */
  chosen?: 'model';
  reason?: string;
}

/** Whether a style uses any v2 field (generateV2 draws it). */
export const isV2Style = (s: BuildingStyle) =>
  s.footprint !== undefined || s.wing !== undefined || s.storeys !== undefined || s.upper_walls !== undefined || s.wood !== undefined
  || s.frame === 'timber' || s.windows_pattern !== undefined || s.door_offset !== undefined || s.porch !== undefined || s.chimney !== undefined || s.shutters !== undefined;

const OPTIONS = {
  floor: ['none', 'planks', 'cobblestone'],
  base: ['none', 'cobblestone', 'stone_bricks', 'sandstone'],
  frame: ['none', 'logs'],
  walls: ['planks', 'logs', 'cobblestone', 'stone_bricks', 'sandstone'],
  roof: ['gable', 'hip', 'flat'],
  roof_axis: ['x', 'z'],
  roof_material: ['planks', 'cobblestone', 'stone_bricks', 'sandstone', 'stone'],
  windows: ['glass', 'panes', 'open', 'none'],
  door_side: ['north', 'east', 'south', 'west'],
} as const;

const DEFAULTS: Omit<BuildingStyle, 'name' | 'description' | 'width' | 'depth'> = {
  wall_height: 3, floor: 'none', base: 'none', frame: 'logs', walls: 'planks', roof: 'gable', roof_material: 'planks',
  overhang: 1, windows: 'glass', door_side: 'south',
};

/** Sizes of the walls; with an overhang the design is two wider and deeper (DESIGN_LIMITS.maxSide 15). */
export const STYLE_LIMITS = { minSide: 5, maxSide: 13, minWall: 3, maxWall: 4 };

/** Blocks by material: the block, its stairs and its slab (oak for wood: a survival village builds in its own wood). */
const MATERIAL: Record<string, { block: string; stairs?: string; slab?: string }> = {
  planks: { block: 'oak_planks', stairs: 'oak_stairs', slab: 'oak_slab' },
  logs: { block: 'oak_log' },
  cobblestone: { block: 'cobblestone', stairs: 'cobblestone_stairs', slab: 'cobblestone_slab' },
  stone_bricks: { block: 'stone_bricks', stairs: 'stone_brick_stairs', slab: 'stone_brick_slab' },
  sandstone: { block: 'sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab' },
  stone: { block: 'stone', stairs: 'stone_stairs', slab: 'stone_slab' },
};

type Dir = 'north' | 'east' | 'south' | 'west';
const STEP: Record<Dir, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIRS: Dir[] = ['north', 'east', 'south', 'west'];
const OPPOSITE: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/**
 * A style as models send it, checked and completed: unknown values are errors (with the choices), missing ones take the
 * defaults, sizes are clamped and made odd (a centred ridge and door; notes say what changed).
 */
export function normalizeStyle(raw: Record<string, unknown>): { style?: BuildingStyle; errors: string[]; notes: string[] } {
  const errors: string[] = [], notes: string[] = [];
  const pick = <K extends keyof typeof OPTIONS>(key: K): (typeof OPTIONS)[K][number] | undefined => {
    const v = raw[key];
    if (v === undefined || v === null || v === '') return (DEFAULTS as Record<string, unknown>)[key] as (typeof OPTIONS)[K][number] | undefined;
    // ("oak_stairs" for the roof's material, gpt-oss 10-04: the block family is meant)
    const s = String(v).trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_').replace(/_(stairs|slab|wall)$/, '');
    // Common near-misses: "oak_planks" for planks, "stone_brick" for stone_bricks, "glass_pane" for panes
    // (a wood's name means planks: a survival village builds in its own wood whatever is drawn)
    const alias: Record<string, string> = { oak_planks: 'planks', wood: 'planks', plank: 'planks', oak: 'planks', spruce: 'planks', birch: 'planks', spruce_planks: 'planks', birch_planks: 'planks', oak_log: 'logs', log: 'logs', stone_brick: 'stone_bricks', glass_pane: 'panes', glass_panes: 'panes', pane: 'panes', cobble: 'cobblestone', pyramid: 'hip', hipped: 'hip', gabled: 'gable', no: 'none', false: 'none' };
    const wood = /_planks$|^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)$/.test(s) ? 'planks' : /_(log|wood)$/.test(s) ? 'logs' : undefined;
    const val = (OPTIONS[key] as readonly string[]).includes(s) ? s : alias[s] ?? wood;
    if (!val || !(OPTIONS[key] as readonly string[]).includes(val)) {
      errors.push(`${key} "${String(v)}" is not one of: ${OPTIONS[key].join(', ')}`);
      return undefined;
    }
    return val as (typeof OPTIONS)[K][number];
  };
  const size = (key: 'width' | 'depth') => {
    const n = raw[key] === undefined || raw[key] === null || raw[key] === '' ? NaN : Math.round(Number(raw[key]));
    if (!Number.isFinite(n)) {
      errors.push(`${key} is required (${STYLE_LIMITS.minSide} to ${STYLE_LIMITS.maxSide})`);
      return 0;
    }
    let s = Math.min(STYLE_LIMITS.maxSide, Math.max(STYLE_LIMITS.minSide, n));
    // Down, so a size code suggested as the most that fits stays within it
    if (s % 2 === 0) s -= 1;
    if (s !== n) notes.push(`${key} ${n} made ${s} (odd sizes keep the ridge and the door centred)`);
    return s;
  };
  const width = size('width'), depth = size('depth');
  const wh = Math.round(Number(raw.wall_height ?? DEFAULTS.wall_height));
  const wall_height = Math.min(STYLE_LIMITS.maxWall, Math.max(STYLE_LIMITS.minWall, Number.isFinite(wh) ? wh : DEFAULTS.wall_height));
  if (wall_height !== wh) notes.push(`wall_height made ${wall_height} (${STYLE_LIMITS.minWall} or ${STYLE_LIMITS.maxWall})`);
  const roof = pick('roof');
  let overhang = Number(raw.overhang ?? DEFAULTS.overhang) >= 1 || raw.overhang === true || /^(true|yes)$/i.test(String(raw.overhang)) ? 1 : 0;
  if (roof === 'flat' && overhang) {
    overhang = 0;
    if (raw.overhang !== undefined) notes.push('a flat roof has no overhang (a parapet instead)');
  }
  const style = {
    name: String(raw.name ?? '').trim(), description: String(raw.description ?? '').trim(), width, depth, wall_height,
    floor: pick('floor'), base: pick('base'), frame: pick('frame'), walls: pick('walls'), roof,
    roof_axis: raw.roof_axis === undefined || raw.roof_axis === '' ? undefined : pick('roof_axis'),
    roof_material: pick('roof_material'), overhang, windows: pick('windows'), door_side: pick('door_side'),
  };
  if (errors.length) return { errors, notes };
  return { style: style as BuildingStyle, errors, notes };
}

/**
 * Draw a style as a Design. The grid is the walls plus the overhang ring; the roof is a height field over it (gable:
 * rising from the two long sides to a ridge, hip: from all four, a pyramid on a square), each cell's roof block a stair
 * facing uphill or, at the top, a slab ridge; the wall columns are filled up to the roof (gable ends), the inside stays
 * empty (the roof is a shell). Flat: one roof layer and a slab parapet on the walls.
 */
export function generateDesign(style: BuildingStyle, by = 'code'): Design {
  if (isV2Style(style)) return generateV2(style, by);
  const o = style.overhang ? 1 : 0;
  const w = style.width, d = style.depth, hw = style.wall_height;
  const W = w + 2 * o, D = d + 2 * o;
  const axis = style.roof_axis ?? (w >= d ? 'x' : 'z');
  const roofM = MATERIAL[style.roof_material], wallM = MATERIAL[style.walls];
  const inWalls = (x: number, z: number) => x >= o && x < o + w && z >= o && z < o + d;
  const corner = (x: number, z: number) => (x === o || x === o + w - 1) && (z === o || z === o + d - 1);
  const ring = (x: number, z: number) => inWalls(x, z) && (x === o || x === o + w - 1 || z === o || z === o + d - 1);
  // The roof's height above its eaves at each cell, and the layer its block sits in (an overhang's eaves hang a layer
  // below the top of the walls)
  const H = (x: number, z: number) => {
    if (style.roof === 'flat') return 0;
    const across = axis === 'x' ? Math.min(z, D - 1 - z) : Math.min(x, W - 1 - x);
    return style.roof === 'hip' ? Math.min(across, x, W - 1 - x, z, D - 1 - z) : across;
  };
  const roofLayer = (x: number, z: number) => hw + 1 + H(x, z) - o;
  let top = 0;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) top = Math.max(top, roofLayer(x, z));
  const height = style.roof === 'flat' ? hw + 3 : top + 1;
  const grid: string[][][] = Array.from({ length: height }, () => Array.from({ length: D }, () => Array<string>(W).fill('.')));
  const set = (l: number, x: number, z: number, block: string) => (grid[l][z][x] = block);

  // The door: the middle of its wall (sizes are odd)
  const [dx, dz] = STEP[style.door_side];
  const door: [number, number] = [
    dx ? (dx < 0 ? o : o + w - 1) : o + (w - 1) / 2,
    dz ? (dz < 0 ? o : o + d - 1) : o + (d - 1) / 2,
  ];
  // Windows in the second layer: every other cell of each wall from its middle, off the door and (on walls over 7) the
  // corners' neighbours (sizes are odd, so they come out symmetric)
  const windowAt = (x: number, z: number) => {
    if (style.windows === 'none' || corner(x, z)) return false;
    const along = z === o || z === o + d - 1 ? x - o : z - o; // position along the wall, corners at 0 and side-1
    const side = z === o || z === o + d - 1 ? w : d;
    const mid = (side - 1) / 2;
    if ((along <= 1 || along >= side - 2) && side > 7) return false;
    if (x === door[0] && z === door[1]) return false;
    return Math.abs(along - mid) % 2 === 0;
  };
  const windowBlock = style.windows === 'glass' ? 'glass' : style.windows === 'panes' ? 'glass_pane' : '.';

  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const rl = style.roof === 'flat' ? hw + 1 : roofLayer(x, z);
      // Outside the walls: leave the ground as it is up to the eaves
      if (!inWalls(x, z)) for (let l = 0; l < Math.min(rl, height); l++) set(l, x, z, '_');
      else {
        // No floor: the prepared ground inside, but a foundation course under the walls (the base's block or the walls')
        const foundation = MATERIAL[style.base === 'none' ? style.walls : style.base].block;
        set(0, x, z, style.floor !== 'none' ? MATERIAL[style.floor].block : ring(x, z) ? foundation : '_');
        if (ring(x, z)) {
          for (let l = 1; l <= hw; l++) {
            let b = wallM.block;
            if (style.frame === 'logs' && corner(x, z)) b = 'oak_log';
            else if (style.frame === 'logs' && l === hw) b = `oak_log[axis=${z === o || z === o + d - 1 ? 'x' : 'z'}]`;
            else if (l === 1 && style.base !== 'none') b = MATERIAL[style.base].block;
            else if (l === 2 && windowAt(x, z)) b = windowBlock;
            set(l, x, z, b);
          }
          // Up to the roof: the gable ends (wood walls fill with planks, log walls stay logs)
          for (let l = hw + 1; l < rl; l++) set(l, x, z, wallM.block);
        }
      }
    }
  set(1, door[0], door[1], 'oak_door');
  set(2, door[0], door[1], '.');

  if (style.roof === 'flat') {
    // The roof one layer over the walls, a lip of slabs on the walls
    for (let z = o; z < o + d; z++)
      for (let x = o; x < o + w; x++) {
        set(hw + 1, x, z, ring(x, z) ? (style.frame === 'logs' && corner(x, z) ? 'oak_log' : wallM.block) : roofM.block);
        if (ring(x, z)) set(hw + 2, x, z, `${roofM.slab}[type=bottom]`);
      }
  } else {
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) set(roofLayer(x, z), x, z, roofBlock(x, z));
  }

  /** A pitched roof's block: a stair facing uphill, or the slab ridge at the top. */
  function roofBlock(x: number, z: number): string {
    const h = H(x, z);
    const at = (dir: Dir) => {
      const [sx, sz] = STEP[dir];
      const nx = x + sx, nz = z + sz;
      return nx < 0 || nz < 0 || nx >= W || nz >= D ? -1 : H(nx, nz);
    };
    const up = DIRS.filter((dir) => at(dir) === h + 1);
    // One way up: a slope; two (a valley, with L and T footprints): either faces right, the server shapes the corner
    if (up.length) return `${roofM.stairs}[facing=${up[0]},half=bottom]`;
    // A corner of a hip: only the diagonal rises; face along z (the server makes it an outer corner)
    const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]].find(([sx, sz]) => {
      const nx = x + sx, nz = z + sz;
      return nx >= 0 && nz >= 0 && nx < W && nz < D && H(nx, nz) === h + 1;
    });
    if (diagonal) return `${roofM.stairs}[facing=${diagonal[1] > 0 ? 'south' : 'north'},half=bottom]`;
    // At the top: lower on one side only (an even span's two top rows) faces away from it; otherwise the ridge
    const lower = DIRS.filter((dir) => at(dir) < h);
    if (lower.length === 1) return `${roofM.stairs}[facing=${OPPOSITE[lower[0]]},half=bottom]`;
    return `${roofM.slab}[type=bottom]`;
  }

  const { palette, layers } = encode(grid);
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: style.name, description: style.description, palette, layers, width: W, depth: D, height, blocks, by, style,
  };
}

// ---------------------------------------------------------------------------------------------
// v2 (#104's R3): a wing (L, T), two storeys, a porch, a chimney, shutters, a timber frame, window patterns
// ---------------------------------------------------------------------------------------------

/** What a v2 home may take (houseStyle.ts holds them): its box, overhang and porch included, and its layers. */
export const V2_LIMITS = { maxBox: HOME_BOX, maxLayers: 12 };

interface Part { x0: number; x1: number; z0: number; z1: number; axis: 'x' | 'z'; joined?: Dir }

/** A material's blocks in a wood (planks and logs follow `wood`; stone is as MATERIAL has it). */
function woodMat(m: string, wood: string): { block: string; stairs?: string; slab?: string } {
  if (m === 'planks') return { block: `${wood}_planks`, stairs: `${wood}_stairs`, slab: `${wood}_slab` };
  if (m === 'logs') return { block: `${wood}_log` };
  return MATERIAL[m];
}

/**
 * Draw a v2 style. The walls are a union of rectangles (the main block, a wing in front); the roof is the highest of each
 * part's own height field (a wing's runs into the main roof's slope: a cross gable, its valley left to the server's stair
 * shapes); two storeys put a planks floor on layer 4 with a ladder up a back corner; the door is in the front (south)
 * wall, the wing's when there is one; a porch is a slab canopy on two fence posts before the door; a chimney a
 * cobblestone column up a side wall; shutters open trapdoors outside the windows (F112: facing out of the wall's cell).
 */
function generateV2(style: BuildingStyle, by: string): Design {
  const flat = style.roof === 'flat';
  const o = style.overhang && !flat ? 1 : 0;
  const wood = style.wood ?? 'oak';
  const w = style.width, d = style.depth;
  const storeys = style.storeys === 2 ? 2 : 1;
  const hw = storeys === 2 ? 3 : style.wall_height;
  const top = storeys === 2 ? 2 * hw + 1 : hw;
  const main = { x0: o, x1: o + w - 1, z0: o, z1: o + d - 1 };
  let wing: typeof main | null = null;
  if ((style.footprint === 'L' || style.footprint === 'T') && style.wing) {
    const ww = style.wing.width, wd = style.wing.depth;
    const x0 = style.footprint === 'T' ? o + Math.floor((w - ww) / 2) : style.wing.side === 'west' ? o : o + w - ww;
    wing = { x0, x1: x0 + ww - 1, z0: o + d, z1: o + d + wd - 1 };
  }
  const front = wing ? wing.z1 : main.z1;
  const doorX = wing ? Math.floor((wing.x0 + wing.x1) / 2) : o + (w - 1) / 2 + Math.max(-1, Math.min(1, Math.round(style.door_offset ?? 0)));
  const porchRows = style.porch ? (o ? 1 : 2) : 0;
  const W = w + 2 * o, D = front + 1 + o + porchRows;
  const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const inWalls = (x: number, z: number) => inRect(main, x, z) || (!!wing && inRect(wing, x, z));
  const outward = (x: number, z: number): Dir[] => DIRS.filter((dir) => !inWalls(x + STEP[dir][0], z + STEP[dir][1]));
  const ring = (x: number, z: number) => inWalls(x, z) && outward(x, z).length > 0;
  const corner = (x: number, z: number) => {
    const out = outward(x, z);
    return inWalls(x, z) && out.length >= 2 && AXIS(out[0]) !== AXIS(out[1]);
  };

  // The roof: each part's height field over its walls and overhang (a wing's from the main block's ridge line forward,
  // not sloping on its joined side), the highest where they overlap
  const mainAxis: 'x' | 'z' = wing ? 'x' : style.roof_axis ?? (w >= d ? 'x' : 'z');
  const parts: Part[] = [{ x0: 0, x1: W - 1, z0: 0, z1: main.z1 + o, axis: mainAxis }];
  if (wing) parts.push({ x0: wing.x0 - o, x1: wing.x1 + o, z0: o + Math.floor((d - 1) / 2), z1: wing.z1 + o, axis: 'z', joined: 'north' });
  const partH = (p: Part, x: number, z: number) => {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return -1;
    if (flat) return 0;
    const across = p.axis === 'x' ? Math.min(z - p.z0, p.z1 - z) : Math.min(x - p.x0, p.x1 - x);
    if (style.roof !== 'hip') return across;
    const along = p.axis === 'x' ? Math.min(x - p.x0, p.x1 - x) : p.joined === 'north' ? p.z1 - z : Math.min(z - p.z0, p.z1 - z);
    return Math.min(across, along);
  };
  const H = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= D ? -1 : Math.max(...parts.map((p) => partH(p, x, z))));
  const roofLayer = (x: number, z: number) => top + 1 + H(x, z) - o;

  // The chimney: a side wall of the main block away from an L's wing, one cell from its back corner
  let chimney: [number, number] | null = null;
  if (style.chimney) {
    const side = wing && style.footprint === 'L' && style.wing?.side !== 'west' ? main.x0 : wing && style.footprint === 'L' ? main.x1 : main.x0;
    chimney = [side, main.z0 + 1];
  }
  const ladder: [number, number] | null = storeys === 2 ? [main.x0 + 1, main.z0 + 1] : null;

  let height = flat ? top + 3 : 0;
  if (!flat) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (H(x, z) >= 0) height = Math.max(height, roofLayer(x, z) + 1);
  if (chimney) height = Math.max(height, (flat ? top + 1 : roofLayer(chimney[0], chimney[1])) + 3);
  const grid: string[][][] = Array.from({ length: height }, () => Array.from({ length: D }, () => Array<string>(W).fill('.')));
  const set = (l: number, x: number, z: number, block: string) => (grid[l][z][x] = block);
  const get = (l: number, x: number, z: number) => grid[l][z][x];

  const wallsOf = (l: number) => (storeys === 2 && l > hw ? style.upper_walls ?? style.walls : style.walls);
  const roofM = woodMat(style.roof_material, wood);
  const log = `${wood}_log`;
  // Straight runs of each face (corners excluded): where windows and timber posts go
  const runs: Array<{ dir: Dir; cells: Array<[number, number]> }> = [];
  for (const dir of DIRS) {
    const alongX = dir === 'north' || dir === 'south';
    for (let a = 0; a < (alongX ? D : W); a++) {
      let cur: Array<[number, number]> = [];
      for (let b = 0; b <= (alongX ? W : D); b++) {
        const [x, z] = alongX ? [b, a] : [a, b];
        const out = b < (alongX ? W : D) ? outward(x, z) : [];
        if (inWalls(x, z) && out.length === 1 && out[0] === dir) cur.push([x, z]);
        else {
          if (cur.length) runs.push({ dir, cells: cur });
          cur = [];
        }
      }
    }
  }
  const at = (cells: Array<[number, number]>, x: number, z: number) => cells.some(([cx, cz]) => cx === x && cz === z);
  const windowCells = new Set<string>();
  const posts = new Set<string>();
  const key = (x: number, z: number) => `${x},${z}`;
  for (const r of runs) {
    const L = r.cells.length, mid = (L - 1) / 2;
    const pattern = style.windows_pattern ?? 'rhythm';
    const pick = (p: number) => {
      if (pattern === 'single') return L < 5 ? Math.abs(p - mid) < 0.6 : p === Math.round(mid - L / 4) || p === Math.round(mid + L / 4);
      if (pattern === 'wide') return L >= 5 ? Math.abs(p - mid) <= 1 : Math.abs(p - mid) < 0.6;
      if (L > 5 && (p === 0 || p === L - 1)) return false;
      return Number.isInteger(mid) ? Math.abs(p - mid) % 2 === 0 : Math.abs(p - mid) % 2 === 0.5;
    };
    r.cells.forEach(([x, z], p) => {
      // (timber: a post every third cell from each corner on walls of 7 or more; none where a window is)
      if (style.frame === 'timber' && L >= 5 && (p + 1) % 3 === 0 && p !== L - 1) posts.add(key(x, z));
      if (style.windows === 'none' || !pick(p)) return;
      if (x === doorX && z === front) return;
      if (chimney && x === chimney[0] && z === chimney[1]) return;
      if (ladder && x === ladder[0] && z === ladder[1] - 1) return;
      windowCells.add(key(x, z));
    });
  }
  for (const k of windowCells) posts.delete(k);
  const windowBlock = style.windows === 'glass' ? 'glass' : style.windows === 'panes' ? 'glass_pane' : '.';
  const winLayers = storeys === 2 ? [2, hw + 3] : [2];

  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const h = H(x, z);
      const rl = flat ? top + 1 : h >= 0 ? roofLayer(x, z) : top + 1;
      if (!inWalls(x, z)) {
        for (let l = 0; l < Math.min(rl, height); l++) set(l, x, z, '_');
        continue;
      }
      const isRing = ring(x, z);
      const foundation = MATERIAL[style.base === 'none' ? style.walls : style.base].block;
      set(0, x, z, style.floor !== 'none' ? woodMat(style.floor, wood).block : isRing ? foundation : '_');
      if (!isRing) {
        if (storeys === 2) set(hw + 1, x, z, ladder && x === ladder[0] && z === ladder[1] ? `ladder[facing=south]` : woodMat('planks', wood).block);
        continue;
      }
      const out = outward(x, z);
      const beamAxis = out.length === 1 ? (AXIS(out[0]) === 'z' ? 'x' : 'z') : undefined;
      for (let l = 1; l <= top; l++) {
        const m = woodMat(wallsOf(l), wood);
        let b = m.block;
        const beamRow = l === hw || l === top;
        if (style.frame !== 'none' && corner(x, z)) b = log;
        else if (style.frame === 'timber' && posts.has(key(x, z))) b = log;
        else if (style.frame !== 'none' && beamRow && beamAxis) b = `${log}[axis=${beamAxis}]`;
        else if (l === 1 && style.base !== 'none') b = MATERIAL[style.base].block;
        else if (winLayers.includes(l) && windowCells.has(key(x, z))) b = windowBlock;
        set(l, x, z, b);
      }
      for (let l = top + 1; l < rl; l++) set(l, x, z, woodMat(wallsOf(top), wood).block);
    }
  set(1, doorX, front, `${wood}_door`);
  set(2, doorX, front, '.');
  if (ladder) for (let l = 1; l <= hw; l++) set(l, ladder[0], ladder[1], 'ladder[facing=south]');

  if (flat) {
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        if (!inWalls(x, z)) continue;
        set(top + 1, x, z, ring(x, z) ? (style.frame !== 'none' && corner(x, z) ? log : woodMat(wallsOf(top), wood).block) : roofM.block);
        if (ring(x, z)) set(top + 2, x, z, `${roofM.slab}[type=bottom]`);
      }
  } else {
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (H(x, z) >= 0) set(roofLayer(x, z), x, z, roofBlock(x, z));
  }

  // The porch: two fence posts two cells before the door's wall, a slab canopy under the eaves over the three cells
  if (style.porch) {
    const pz = front + 2;
    for (const px of [doorX - 1, doorX + 1]) for (let l = 1; l < hw; l++) set(l, px, pz, `${wood}_fence`);
    for (let z = front + 1; z <= pz; z++)
      for (let x = doorX - 1; x <= doorX + 1; x++) {
        const c = get(hw, x, z);
        if (c === '.' || c === '_') set(hw, x, z, `${roofM.slab}[type=bottom]`);
        for (let l = 0; l < hw; l++) if (get(l, x, z) === '.') set(l, x, z, '_');
      }
  }
  // The chimney: cobblestone up the wall and through the roof, a block above it, a wall cap
  if (chimney) {
    const [cx, cz] = chimney;
    const rl = flat ? top + 1 : roofLayer(cx, cz);
    for (let l = 1; l <= rl + 1; l++) set(l, cx, cz, 'cobblestone');
    set(rl + 2, cx, cz, 'cobblestone_wall');
  }
  // Shutters: beside each run of storey-1 windows, in the cell outside the wall, facing out
  if (style.shutters && style.windows !== 'none')
    for (const r of runs) {
      const [sx, sz] = STEP[r.dir];
      r.cells.forEach(([x, z], p) => {
        // (never on the door's wall cell: its outside cell is the way in)
        if (windowCells.has(key(x, z)) || (x === doorX && z === front)) return;
        const nextTo = [r.cells[p - 1], r.cells[p + 1]].some((c) => c && windowCells.has(key(c[0], c[1])));
        if (!nextTo) return;
        const ox = x + sx, oz = z + sz;
        if (ox < 0 || oz < 0 || ox >= W || oz >= D || inWalls(ox, oz)) return;
        if (get(2, ox, oz) !== '_' && get(2, ox, oz) !== '.') return;
        set(2, ox, oz, `${wood}_trapdoor[facing=${r.dir},half=bottom,open=true]`);
      });
    }

  /** A pitched roof's block, as generateDesign's: a stair facing uphill, a valley's either way, else a slab ridge. */
  function roofBlock(x: number, z: number): string {
    const h = H(x, z);
    const near = (dir: Dir) => H(x + STEP[dir][0], z + STEP[dir][1]);
    const up = DIRS.filter((dir) => near(dir) === h + 1);
    if (up.length) return `${roofM.stairs}[facing=${up[0]},half=bottom]`;
    const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]].find(([sx, sz]) => H(x + sx, z + sz) === h + 1);
    if (diagonal) return `${roofM.stairs}[facing=${diagonal[1] > 0 ? 'south' : 'north'},half=bottom]`;
    const lower = DIRS.filter((dir) => near(dir) < h);
    if (lower.length === 1) return `${roofM.stairs}[facing=${OPPOSITE[lower[0]]},half=bottom]`;
    return `${roofM.slab}[type=bottom]`;
  }

  const { palette, layers } = encode(grid);
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return { name: style.name, description: style.description, palette, layers, width: W, depth: D, height, blocks, by, style };
}

/** Readable symbols for the usual blocks; anything else (or a clash) takes the next free one. */
function symbolFor(block: string): string {
  const m = /^([a-z_]+?)(?:\[(.*)\])?$/.exec(block);
  const base = m?.[1] ?? block, states = m?.[2] ?? '';
  if (/_stairs$/.test(base)) return { north: 'N', south: 'S', east: 'E', west: 'W' }[/facing=(\w+)/.exec(states)?.[1] ?? ''] ?? 's';
  if (/_slab$/.test(base)) return 'H';
  if (/_log$/.test(base)) return /axis=x/.test(states) ? 'X' : /axis=z/.test(states) ? 'Z' : 'L';
  if (/_door$/.test(base)) return 'D';
  if (/_planks$/.test(base)) return 'P';
  return ({ cobblestone: 'C', stone_bricks: 'B', sandstone: 'A', stone: 'O', glass: 'G', glass_pane: 'G' } as Record<string, string>)[base] ?? '?';
}

export function encode(grid: string[][][]): { palette: Record<string, string>; layers: string[][] } {
  const palette: Record<string, string> = {};
  const symbol = new Map<string, string>();
  const spare = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
  const of = (block: string) => {
    if (block === '.' || block === '_') return block;
    let s = symbol.get(block);
    if (!s) {
      s = symbolFor(block);
      if (s === '?' || palette[s]) s = spare.find((c) => !palette[c])!;
      palette[s] = block;
      symbol.set(block, s);
    }
    return s;
  };
  return { palette, layers: grid.map((layer) => layer.map((row) => row.map(of).join(''))) };
}

/**
 * A style within a design's furnace runs (designs.ts MAX_SMELTS): stone and stone bricks become cobblestone (roof,
 * walls, base) and glass windows panes, then open, one change at a time until it fits; the notes say what changed.
 * gpt-oss sent stone-brick halls needing ~190 runs three times over, hint or not (designbench, 10-04): code makes the
 * change, as fixDoor moves a door, rather than refusing the design.
 */
export function fitSmelts(style: BuildingStyle, smelts: (s: BuildingStyle) => number, max: number): { style: BuildingStyle; notes: string[] } {
  const steps: Array<['roof_material' | 'walls' | 'base' | 'windows', string, string]> = [
    ['roof_material', 'stone_bricks', 'cobblestone'], ['roof_material', 'stone', 'cobblestone'], ['walls', 'stone_bricks', 'cobblestone'],
    ['base', 'stone_bricks', 'cobblestone'], ['windows', 'glass', 'panes'], ['windows', 'panes', 'open'],
  ];
  let s = style, n = smelts(s);
  const notes: string[] = [];
  for (const [key, from, to] of steps) {
    if (n <= max) break;
    if (s[key] !== from) continue;
    s = { ...s, [key]: to };
    notes.push(`${key} ${from} made ${to} (${n} furnace runs; a design may need ${max})`);
    n = smelts(s);
  }
  return { style: s, notes };
}

/**
 * A style's walls within a cap (D.2, after Minevale14's 13x13 hall of 536 blocks: the user's choice, houses 9 and
 * landmarks 11 across), made smaller by code with a note rather than refused. Sizes stay odd.
 */
export function capWalls(style: BuildingStyle, max: number): { style: BuildingStyle; notes: string[] } {
  const cap = max % 2 ? max : max - 1;
  if (style.width <= cap && style.depth <= cap) return { style, notes: [] };
  const s = { ...style, width: Math.min(style.width, cap), depth: Math.min(style.depth, cap) };
  return { style: s, notes: [`walls ${style.width}x${style.depth} made ${s.width}x${s.depth} (at most ${cap} across here)`] };
}

/** The style a design was generated from, if any. */
export const styleOf = (d: Design): BuildingStyle | undefined => d.style;

const CCW: Record<Dir, Dir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const AXIS = (dir: Dir) => (dir === 'north' || dir === 'south' ? 'z' : 'x');

/**
 * The shape the server gives a stair from its neighbours in the same layer (vanilla's StairBlock rule, read from the
 * 26.1.2 jar): facing is the tall side; a stair of the same half on the tall side facing across makes an outer corner,
 * one on the low side an inner corner, left when that neighbour faces counter-clockwise of this one. For checks only:
 * designs leave the shape to the server.
 */
export function stairShape(d: Design, layer: number, x: number, z: number): string | null {
  const read = (lx: number, lz: number) => {
    const ch = d.layers[layer]?.[lz]?.[lx];
    const b = ch && ch !== '.' && ch !== '_' ? d.palette[ch] : undefined;
    const m = b ? /^[a-z_]+_stairs\[(.*)\]$/.exec(b) : null;
    if (!m) return null;
    const facing = (/facing=(\w+)/.exec(m[1])?.[1] ?? 'north') as Dir;
    const half = /half=top/.test(m[1]) ? 'top' : 'bottom';
    return { facing, half };
  };
  const self = read(x, z);
  if (!self) return null;
  const near = (dir: Dir) => read(x + STEP[dir][0], z + STEP[dir][1]);
  const canTake = (dir: Dir) => {
    const n = near(dir);
    return !(n && n.facing === self.facing && n.half === self.half);
  };
  const back = near(self.facing);
  if (back && back.half === self.half && AXIS(back.facing) !== AXIS(self.facing) && canTake(OPPOSITE[back.facing]))
    return back.facing === CCW[self.facing] ? 'outer_left' : 'outer_right';
  const front = near(OPPOSITE[self.facing]);
  if (front && front.half === self.half && AXIS(front.facing) !== AXIS(self.facing) && canTake(front.facing))
    return front.facing === CCW[self.facing] ? 'inner_left' : 'inner_right';
  return 'straight';
}

/** The submit_style tool: the architect's style, drawn by code. */
export const STYLE_TOOL = {
  name: 'submit_style',
  description: 'Submit a building as a style; code draws the layers (walls, windows, door, a roof of stairs that covers everything).',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Short name, e.g. "stone cottage".' },
      description: { type: 'string', description: 'One sentence describing the building.' },
      width: { type: 'integer', description: `Walls west to east, odd: ${STYLE_LIMITS.minSide} to ${HOUSE_WALLS} for a house, to ${LANDMARK_WALLS} for a hall or other landmark.` },
      depth: { type: 'integer', description: `Walls north to south, odd: ${STYLE_LIMITS.minSide} to ${HOUSE_WALLS} for a house, to ${LANDMARK_WALLS} for a hall or other landmark.` },
      wall_height: { type: 'integer', description: 'Wall layers above the floor, 3 or 4.' },
      floor: { type: 'string', enum: [...OPTIONS.floor], description: 'none keeps the levelled ground (cheapest).' },
      base: { type: 'string', enum: [...OPTIONS.base], description: 'The lowest course of the walls, e.g. a stone base under wood.' },
      frame: { type: 'string', enum: [...OPTIONS.frame], description: 'logs: log corner posts and a log beam along the top of the walls.' },
      walls: { type: 'string', enum: [...OPTIONS.walls] },
      roof: { type: 'string', enum: [...OPTIONS.roof], description: 'gable: two slopes and gable ends; hip: four slopes (a pyramid on a square); flat: with a low parapet.' },
      roof_axis: { type: 'string', enum: [...OPTIONS.roof_axis], description: 'Ridge direction: x east-west, z north-south (default: along the longer side).' },
      roof_material: { type: 'string', enum: [...OPTIONS.roof_material], description: 'Stairs and slabs of this.' },
      overhang: { type: 'integer', enum: [0, 1], description: '1: the roof reaches one block past the walls.' },
      windows: { type: 'string', enum: [...OPTIONS.windows] },
      door_side: { type: 'string', enum: [...OPTIONS.door_side] },
    },
    required: ['name', 'description', 'width', 'depth', 'walls', 'roof', 'roof_material'],
  },
};
