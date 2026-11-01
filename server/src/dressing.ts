/**
 * The wall dressing (MC_DRESSING, on): a pass over a design's grid that gives its walls texture, relief and colour
 * without moving a cell. Deterministic (seeded by the building). Two levels:
 * - full (the monuments and civic buildings: monument.ts dresses a record begun with it, `MonumentM3.dress`);
 * - light (every other design that is ours to draw: buildingGen's homes, house programs, the vanilla houses and works,
 *   the huts; each generator dresses what it returns, so every caller, bill and build sees the same blocks).
 *
 * The pass only swaps one solid block for another: air stays air (and '_' cells as they are), every solid cell stays
 * solid, so the footprint, the cell count (the block budgets), the jobs' cells, doors, floors and walkable cells are the
 * generator's. It touches the masonry and plank cells of a wall's face (a full block of a family below, with exterior air
 * beside it: open to the sky or a straight line out of the grid), never layer 0 nor a cell with interior air above it.
 *
 * - Colour (full): each preset's real stone (PRESET_STONE): golden sandstone (Seville, Wells, Carcassonne), pale
 *   smooth-stone ashlar (Milan, the White Tower), dark tuff streaks (Cologne, St Vitus, with the deep stone), pink granite
 *   bands (Strasbourg, with the detail palette); grey stone bricks otherwise.
 * - Texture: each wall block mixed with its variants in patches, more weathered low and on the north face, cleaner high
 *   (light: half as much).
 * - Relief: a plinth course (light: the first course only), quoins at the corners, window sills (inverted stairs) and
 *   lintels; full only: reveals, string courses and a corbel table of inverted stairs, buttress set-offs stepped.
 *
 * Survival: each family's kit lists, by supply level, only blocks the village's chains make: house (homes and works:
 * nothing smelted, as homes count their furnace runs: cobblestone, sandstone, the wood's logs and stairs), base (every
 * monument and civic record: also the kiln's stone and smooth stone, crafted bricks and chiselled pieces), detail (a
 * detail cathedral: the quarry's andesite, diorite and granite, cut by the carver) and deep (MC_DEEP_STONE: tuff and
 * cobbled deepslate). Left out: cracked bricks (the kiln smelts cobble, sand, stone and copper, never bricks, which are
 * crafted at the build), mossy blocks (vines drop only to shears, moss grows in lush caves), mud bricks, terracotta and
 * bricks (no smelt of clay), weathered copper, banners and lanterns outside the furnishing (they would need air cells).
 */
import type { Cathedral } from './gothicGen';
import { gothicCost } from './gothicGen';
import type { Design } from './village';
import { rawSetting } from './settings';

export const DRESSING = { on: !/^(off|0|false|no)$/i.test(rawSetting('MC_DRESSING') ?? 'on') };

/** What the village can supply: homes and works (house), every monument record (base), a detail cathedral (detail), one
 *  with the deep stone too (deep). */
export type Supply = 'house' | 'base' | 'detail' | 'deep';
export type Stone = 'grey' | 'golden' | 'pale' | 'dark' | 'pink';
export type Level = 'full' | 'light';

/** Each preset's real stone (ids of gothicGen's and castleGen's presets and the civic entries); grey when absent. */
export const PRESET_STONE: Record<string, Stone> = {
  // golden limestone and sandstone
  seville: 'golden', toledo: 'golden', burgos: 'golden', leon: 'golden', wells: 'golden', york: 'golden',
  carcassonne: 'golden', krak_des_chevaliers: 'golden', castel_del_monte: 'golden',
  // white marble, chalk and whitewash
  milan: 'pale', white_tower: 'pale', chateau_gaillard: 'pale', alcazar_segovia: 'pale',
  // dark: Cologne's blackened sandstone, St Vitus' grey, Edinburgh's basalt crag, the Porta Nigra
  cologne: 'dark', st_vitus: 'dark', edinburgh: 'dark', porta_nigra: 'dark',
  // Strasbourg's pink Vosges sandstone
  strasbourg: 'pink',
};

/** A wall family's blocks at a supply level. `weathered`: low and north; `clean`: high up; `accent`: here and there. A
 *  block with `{axis}` takes the face's axis (a log lintel along the wall). */
interface Kit {
  main: string;
  stair?: string;
  weathered: string[];
  clean: string[];
  accent?: string;
  quoin: string;
  plinth: string;
  lintel: string;
  /** Mixed through the whole face at this share (the dark stone's tuff). */
  body?: { blocks: string[]; share: number };
  /** Every `band`-th course of this block (the pink stone's granite). */
  band?: { block: string; every: number };
}

const SB = 'stone_bricks';
/** The kits by family (the full block a wall is drawn in) and supply; a family without a kit for a supply is left as drawn. */
function kitOf(main: string, supply: Supply, stone: Stone): Kit | undefined {
  const house = supply === 'house', detail = supply === 'detail' || supply === 'deep', deep = supply === 'deep';
  const planks = /^([a-z_]+)_planks$/.exec(main);
  if (planks) {
    // (a plank wall on a cobblestone footing, log quoins and lintels, sills of the wood's stairs)
    const w = planks[1];
    return { main, stair: `${w}_stairs`, weathered: [], clean: [], quoin: `${w}_log[axis=y]`, plinth: 'cobblestone', lintel: `${w}_log[axis={axis}]` };
  }
  switch (main) {
    case SB: {
      if (house) return { main, stair: 'stone_brick_stairs', weathered: ['cobblestone'], clean: [], quoin: 'cobblestone', plinth: 'cobblestone', lintel: SB };
      const k: Kit = {
        main, stair: 'stone_brick_stairs', weathered: ['cobblestone', 'stone', ...(detail ? ['andesite'] : []), ...(deep ? ['tuff'] : [])],
        clean: [SB], accent: 'chiseled_stone_bricks', quoin: detail ? 'polished_andesite' : 'smooth_stone',
        plinth: deep ? 'deepslate_bricks' : detail ? 'andesite' : 'cobblestone', lintel: detail ? 'chiseled_stone_bricks' : 'smooth_stone',
      };
      if (stone === 'dark') {
        if (deep) { k.body = { blocks: ['tuff_bricks'], share: 0.35 }; k.quoin = 'polished_deepslate'; k.weathered = ['tuff', 'cobblestone', 'cobbled_deepslate']; }
        else { k.body = { blocks: ['cobblestone'], share: 0.3 }; k.weathered = ['cobblestone']; }
      }
      if (stone === 'pink' && detail) { k.band = { block: 'polished_granite', every: 3 }; k.quoin = 'polished_granite'; k.weathered.push('granite'); }
      return k;
    }
    case 'cobblestone':
      return house ? { main, stair: 'cobblestone_stairs', weathered: [], clean: [], quoin: main, plinth: main, lintel: main }
        : { main, stair: 'cobblestone_stairs', weathered: ['cobblestone', ...(detail ? ['andesite'] : [])], clean: ['stone'], quoin: SB, plinth: 'cobblestone', lintel: SB };
    case 'stone':
      return house ? undefined : { main, stair: 'stone_stairs', weathered: ['cobblestone'], clean: ['smooth_stone'], quoin: SB, plinth: 'cobblestone', lintel: SB };
    case 'smooth_stone':
      return house ? undefined : { main, stair: 'stone_stairs', weathered: ['stone'], clean: ['smooth_stone'], ...(detail ? { accent: 'polished_diorite' } : {}), quoin: detail ? 'polished_diorite' : SB, plinth: detail ? 'andesite' : 'cobblestone', lintel: detail ? 'polished_diorite' : SB };
    case 'sandstone':
      // (homes: no plinth, a desert house stands on its own stone)
      return { main, stair: 'sandstone_stairs', weathered: ['sandstone'], clean: ['cut_sandstone'], accent: 'chiseled_sandstone', quoin: 'cut_sandstone', plinth: house ? main : SB, lintel: 'chiseled_sandstone' };
    case 'polished_diorite':
      return detail ? { main, stair: 'polished_diorite_stairs', weathered: ['diorite'], clean: ['polished_diorite'], quoin: 'smooth_stone', plinth: 'andesite', lintel: 'smooth_stone' } : undefined;
    case 'polished_granite':
      return detail ? { main, stair: 'polished_granite_stairs', weathered: ['granite'], clean: ['polished_granite'], quoin: 'polished_diorite', plinth: 'andesite', lintel: 'polished_diorite' } : undefined;
    case 'tuff_bricks':
      return deep ? { main, stair: 'tuff_brick_stairs', weathered: ['tuff', 'polished_tuff'], clean: ['tuff_bricks'], quoin: 'polished_tuff', plinth: 'deepslate_bricks', lintel: 'chiseled_tuff_bricks' } : undefined;
    default:
      return undefined;
  }
}

/** The colour swap of a preset's stone: the stone-brick family's pieces in another stone, where the supply allows. */
function recolour(block: string, stone: Stone): string {
  const m = /^([a-z_]+)(\[.*\])?$/.exec(block);
  if (!m) return block;
  const [, name, st = ''] = m;
  if (stone === 'golden') {
    const to: Record<string, string> = { stone_bricks: 'sandstone', stone_brick_stairs: 'sandstone_stairs', stone_brick_slab: 'sandstone_slab', stone_brick_wall: 'sandstone_wall', chiseled_stone_bricks: 'chiseled_sandstone' };
    if (to[name]) return to[name] + st;
  }
  // (pale: smooth-stone ashlar from the kiln's smooth stone; it has no stairs or wall, so those stay stone bricks)
  if (stone === 'pale' && name === 'stone_bricks') return 'smooth_stone';
  if (stone === 'pale' && name === 'stone_brick_slab') return `smooth_stone_slab${st}`;
  return block;
}

// ---- the seeded noise ----
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function hash4(seed: number, a: number, b: number, c: number, salt: number): number {
  let h = seed ^ Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35) ^ Math.imul(c + 0x1b87, 0x27d4eb2f) ^ Math.imul(salt + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const DIRS: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
const OPP: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const isGlass = (b: string | null) => !!b && /glass/.test(b);

export interface DressOpts {
  /** The building's seed (its preset id or design name). */
  seed: string;
  supply: Supply;
  /** full (monuments and civic) or light (homes, works, huts). */
  level?: Level;
  /** Its real stone (PRESET_STONE[seed] by default; light: grey). */
  stone?: Stone;
}

/** What the pass changed: cells by kind of change. */
export interface DressStats { texture: number; plinth: number; course: number; corbel: number; quoin: number; window: number; step: number; band: number; recolour: number }
const noStats = (): DressStats => ({ texture: 0, plinth: 0, course: 0, corbel: 0, quoin: 0, window: 0, step: 0, band: 0, recolour: 0 });

/** The dressed design (same size, cells and '_' cells; its palette of the dressed blocks) and what changed. */
export function dressGrid(d: Design, o: DressOpts): { design: Design; stats: DressStats } {
  const W = d.width, D = d.depth, H = d.height, full = (o.level ?? 'full') === 'full';
  const stone = full ? o.stone ?? PRESET_STONE[o.seed] ?? 'grey' : 'grey';
  const seed = hashStr(o.seed);
  const stats = noStats();
  // the grid as blocks (null: air or a '_' cell, kept), the preset's stone swapped in
  const grid: Array<Array<Array<string | null>>> = d.layers.map((layer) => layer.map((row) => [...row].map((ch) => (ch === '.' || ch === '_' ? null : d.palette[ch] ?? null))));
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const b = grid[y][z][x];
    if (!b) continue;
    const r = recolour(b, stone);
    if (r !== b) { grid[y][z][x] = r; stats.recolour++; }
  }
  const get = (x: number, y: number, z: number): string | null => (x < 0 || z < 0 || y < 0 || x >= W || z >= D || y >= H ? null : grid[y][z]?.[x] ?? null);
  const inBox = (x: number, y: number, z: number) => x >= 0 && z >= 0 && y >= 0 && x < W && z < D && y < H;
  // the highest solid cell of each column: air above it is open to the sky
  const top: number[][] = Array.from({ length: D }, () => Array(W).fill(-1));
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (get(x, y, z)) top[z][x] = y;
  const sky = (x: number, y: number, z: number) => x < 0 || z < 0 || x >= W || z >= D || y > top[z][x];
  /** Air beside a face that is outside: off the grid, open to the sky, or a straight line of air out of the grid. */
  const outside = (x: number, y: number, z: number, dx: number, dz: number): boolean => {
    if (!inBox(x, y, z)) return true;
    if (get(x, y, z)) return false;
    if (sky(x, y, z)) return true;
    for (let i = 1; ; i++) {
      const px = x + dx * i, pz = z + dz * i;
      if (!inBox(px, y, pz)) return true;
      if (get(px, y, pz)) return false;
    }
  };
  // the kits of the families drawn (each family's main block after the colour swap)
  const kits = new Map<string, Kit | undefined>();
  const kit = (b: string | null): Kit | undefined => {
    if (!b || b.includes('[')) return undefined;
    if (!kits.has(b)) kits.set(b, kitOf(b, o.supply, stone));
    return kits.get(b);
  };
  const plinthTop = full && H >= 20 ? 2 : 1;
  const step = H >= 40 ? 8 : H >= 24 ? 6 : 4;
  const course = (y: number) => y > plinthTop + 2 && (y - plinthTop) % step === 0;
  /** A column's run of masonry from y up (the top of the wall the cell is in). */
  const runTop = (x: number, y: number, z: number, main: string): number => {
    let t = y;
    while (get(x, t + 1, z) === main) t++;
    return t;
  };
  const stair = (k: Kit, facing: string, half: 'top' | 'bottom') => `${k.stair}[facing=${facing},half=${half}]`;
  const axis = (f?: (typeof DIRS)[number]) => (f && (f[2] === 'east' || f[2] === 'west') ? 'z' : 'x');

  const out = grid.map((layer) => layer.map((row) => [...row]));
  for (let y = 1; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const b = grid[y][z][x];
    const k = kit(b);
    if (!k || !b) continue;
    const faces = DIRS.filter(([dx, dz]) => outside(x + dx, y, z + dz, dx, dz));
    if (!faces.length) continue;
    const up = get(x, y + 1, z), below = get(x, y - 1, z);
    // (the face a course or sill shows on: the only one, or of a wall with air both sides (a curtain over its courtyard),
    // the side open straight out of the grid)
    const outward = (f: (typeof DIRS)[number]) => { for (let i = 1; ; i++) { const px = x + f[0] * i, pz = z + f[1] * i; if (!inBox(px, y, pz)) return true; if (get(px, y, pz)) return false; } };
    const one = faces.length === 1 ? faces[0]
      : faces.length === 2 && faces[0][0] === -faces[1][0] && faces[0][1] === -faces[1][1] ? (outward(faces[1]) && !outward(faces[0]) ? faces[1] : faces[0]) : undefined;
    const set = (blk: string, kind: keyof DressStats) => { if (blk === b) return; out[y][z][x] = blk.replace('{axis}', axis(one)); stats[kind]++; };
    if (!up) {
      // a set-off: a short ledge against taller masonry, stepped (a buttress's weathering); anything else open above (a
      // wall top, a walk) is left as drawn
      if (!full || !one || !k.stair || y < 2) continue;
      const [dx, dz, dir] = one;
      const ix = x - dx, iz = z - dz;
      if (!get(ix, y, iz) || !get(ix, y + 1, iz) || !sky(x, y + 1, z)) continue;
      let run = 1;
      for (const sgn of [1, -1]) for (let i = 1; i <= 4; i++) {
        const px = x + sgn * dz * i, pz = z + sgn * dx * i;
        if (get(px, y, pz) && !get(px, y + 1, pz) && get(px - dx, y + 1, pz - dz)) run++;
        else break;
      }
      if (run <= 4) set(stair(k, OPP[dir], 'bottom'), 'step');
      continue;
    }
    // windows: the sill under a pane, the lintel over it, the reveals beside it (full)
    // (no sill on the first course: a stair there is a step up to the window)
    if (one && k.stair && y >= 2 && isGlass(up) && !isGlass(below)) { set(stair(k, OPP[one[2]], 'top'), 'window'); continue; }
    if (isGlass(below)) { set(k.lintel, 'window'); continue; }
    if (full && one) {
      const [dx, dz] = one;
      if (isGlass(get(x + dz, y, z + dx)) || isGlass(get(x - dz, y, z - dx))) { set(k.quoin, 'window'); continue; }
    }
    // quoins: a corner of two faces that each run on for 2 more cells, every other course
    if (faces.length === 2 && faces[0][0] * faces[1][0] + faces[0][1] * faces[1][1] === 0) {
      // (along face A the wall runs away from face B, inward, and the other way round)
      const [A, B] = faces;
      const along = (f: typeof A, g: typeof A) => [1, 2].every((i) => get(x - g[0] * i, y, z - g[1] * i) === b && outside(x - g[0] * i + f[0], y, z - g[1] * i + f[1], f[0], f[1]));
      if (along(A, B) && along(B, A)) { if (y % 2 === 0) set(k.quoin, 'quoin'); continue; }
    }
    if (y <= plinthTop) { set(k.plinth, 'plinth'); continue; }
    if (full && one && k.stair) {
      const [dx, dz, dir] = one;
      // the corbel table: under the lowest top of the cell and its neighbours along the face, every other cell
      const tops = [0, 1, -1].map((i) => {
        const px = x + dz * i, pz = z + dx * i;
        return get(px, y, pz) === b ? runTop(px, y, pz, b) : y;
      });
      const t = Math.min(...tops);
      if (t - 1 === y && y > plinthTop + 2 && t >= plinthTop + 4) {
        if ((x + z) % 2 === 0) set(stair(k, OPP[dir], 'top'), 'corbel');
        continue;
      }
      if (course(y) && t - y >= 2 && up === b && !isGlass(below)) { set(stair(k, OPP[dir], 'top'), 'course'); continue; }
    }
    if (full && k.band && (y - plinthTop) % k.band.every === 0) { set(k.band.block, 'band'); continue; }
    // texture: patches (a coarse cell's hash and the cell's own), weathered low and north, cleaner high (light: half)
    const amt = full ? 1 : 0.5;
    const hy = y / Math.max(1, H - 1);
    const north = faces.some((f) => f[2] === 'north'), west = faces.some((f) => f[2] === 'west');
    const n = 0.6 * hash4(seed, x >> 1, y >> 1, z >> 1, 1) + 0.4 * hash4(seed, x, y, z, 2);
    const pick = (list: string[], salt: number) => list[Math.floor(hash4(seed, x, y, z, salt) * list.length)];
    const weather = amt * Math.min(0.55, 0.42 * (1 - hy) ** 1.5 + (north ? 0.14 : 0) + (west ? 0.04 : 0));
    // (the body's stone in streaks down the wall, as soot and rain stain it: runs of 4-8 courses a column)
    if (full && k.body && hash4(seed, x, (y + (hash4(seed, x, 0, z, 8) * 4 | 0)) >> 3, z, 3) < k.body.share) { set(pick(k.body.blocks, 4), 'texture'); continue; }
    if (k.weathered.length && n < weather) { set(pick(k.weathered, 5), 'texture'); continue; }
    if (k.clean.length && n > 1 - 0.3 * amt * hy) { set(pick(k.clean, 6), 'texture'); continue; }
    if (k.accent && hash4(seed, x, y, z, 7) < 0.025 * amt) set(k.accent, 'texture');
  }

  // the palette again: the design's characters kept for blocks still drawn, new ones for the dressing's
  const used = new Set<string>();
  for (const layer of out) for (const row of layer) for (const blk of row) if (blk) used.add(blk);
  const palette: Record<string, string> = {};
  const charOf = new Map<string, string>();
  for (const [ch, blk] of Object.entries(d.palette)) if (used.has(blk) && !charOf.has(blk)) { charOf.set(blk, ch); palette[ch] = blk; }
  const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>?@!~^:;,(){}[]|/\'"`';
  let next = 0x100;
  const free = [...POOL].filter((ch) => !(ch in d.palette));
  for (const blk of [...used].sort()) {
    if (charOf.has(blk)) continue;
    let ch = free.shift();
    while (!ch) { const cand = String.fromCharCode(next++); if (!(cand in d.palette)) ch = cand; }
    charOf.set(blk, ch);
    palette[ch] = blk;
  }
  const layers = out.map((layer, y) => layer.map((row, z) => row.map((blk, x) => (blk ? charOf.get(blk)! : d.layers[y][z][x] === '_' ? '_' : '.')).join('')));
  return { design: { ...d, palette, layers }, stats };
}

/** A home, work or hut design dressed lightly (MC_DRESSING; the design itself when off or nothing changed). */
export function dressDesign(d: Design, seed = d.name): Design {
  if (!DRESSING.on) return d;
  const r = dressGrid(d, { seed, supply: 'house', level: 'light' });
  return Object.values(r.stats).some((n) => n > 0) ? r.design : d;
}

/** A monument or civic building dressed: the same cells, jobs and stages, the palette and the bills of the dressed blocks. */
export function dress(c: Cathedral, o: DressOpts): Cathedral & { dressStats: DressStats } {
  const { design, stats } = dressGrid(c.design, { ...o, seed: `${o.seed}|${c.scale}`, stone: o.stone ?? PRESET_STONE[o.seed] ?? 'grey' });
  const byJob = new Map<number, Record<string, number>>(), bill: Record<string, number> = {};
  design.layers.forEach((layer, y) => layer.forEach((row, z) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === '_') return;
    const j = c.cellJob.get(`${x},${y},${z}`) ?? 0;
    const jb = byJob.get(j) ?? byJob.set(j, {}).get(j)!;
    const [item, q] = gothicCost(design.palette[ch]);
    jb[item] = (jb[item] ?? 0) + q;
    bill[item] = (bill[item] ?? 0) + q;
  })));
  return { ...c, design, jobs: c.jobs.map((j, i) => ({ ...j, bill: byJob.get(i) ?? {} })), bill, dressStats: stats };
}

/** The supply a monument record's dressing may use: a detail cathedral's quarry stones, with the deep stone too. */
export const supplyOf = (type: 'cathedral' | 'castle' | 'civic', detail: boolean, deep: boolean): Supply =>
  type === 'cathedral' && detail ? (deep ? 'deep' : 'detail') : 'base';
