/**
 * Import Minecraft schematics as village designs. Reads Sponge .schem (v1-v3), legacy MCEdit .schematic, Litematica
 * .litematic and structure-block .nbt files, maps Minecraft's blocks onto this game's (nearest match where there is
 * no equivalent), trims empty space, and returns a design in the same layer format the architect model draws.
 */
import { readNbt, Nbt } from './nbt';
import { ITEMS_BY_NAME } from '../../shared/src/items';
import { BLOCKS_BY_NAME } from '../../shared/src/blocks';

type Obj = { [key: string]: Nbt };

/** A block grid: `get` returns a Minecraft block state ("oak_door[half=upper]"), or null for "leave as is". */
interface Grid {
  width: number;
  height: number;
  length: number;
  get(x: number, y: number, z: number): string | null;
  format: string;
}

const num = (v: Nbt | undefined) => Number(v ?? 0);
const stripNs = (s: string) => s.replace(/^minecraft:/, '');

/** Unpack Sponge's varint-encoded block data. */
function varints(bytes: Int8Array, count: number): Int32Array {
  const out = new Int32Array(count);
  let i = 0, pos = 0;
  while (i < count && pos < bytes.length) {
    let v = 0, shift = 0, b: number;
    do {
      b = bytes[pos++] & 0xff;
      v |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    out[i++] = v;
  }
  return out;
}

function sponge(root: Obj): Grid {
  const s = (root.Schematic as Obj | undefined) ?? root; // v3 nests everything under "Schematic"
  const width = num(s.Width) & 0xffff, height = num(s.Height) & 0xffff, length = num(s.Length) & 0xffff;
  const blocks = (s.Blocks as Obj | undefined) ?? s;
  const palette = (blocks.Palette ?? s.Palette) as Obj;
  const data = (blocks.Data ?? s.BlockData) as Int8Array;
  if (!palette || !data) throw new Error('this .schem has no block palette or block data');
  const names: string[] = [];
  for (const [state, id] of Object.entries(palette)) names[num(id)] = state;
  const ids = varints(data, width * height * length);
  return { width, height, length, format: `Sponge schematic v${num(s.Version) || 2}`, get: (x, y, z) => names[ids[x + z * width + y * width * length]] ?? null };
}

/** Pre-1.13 numeric block ids for the common building blocks, as [id, meta -> name]. */
const LEGACY: Record<number, string | ((m: number) => string)> = {
  0: 'air', 1: (m) => ['stone', 'granite', 'granite', 'diorite', 'diorite', 'andesite', 'andesite'][m] ?? 'stone', 2: 'grass_block', 3: 'dirt',
  4: 'cobblestone', 5: (m) => ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'][m & 7] + '_planks', 7: 'bedrock', 8: 'water', 9: 'water',
  10: 'lava', 11: 'lava', 12: 'sand', 13: 'gravel', 14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore',
  17: (m) => ['oak', 'spruce', 'birch', 'jungle'][m & 3] + '_log', 18: (m) => ['oak', 'spruce', 'birch', 'jungle'][m & 3] + '_leaves',
  20: 'glass', 24: 'sandstone', 31: 'short_grass', 32: 'dead_bush', 35: 'white_wool', 37: 'dandelion', 38: 'poppy', 43: 'smooth_stone',
  44: (m) => ['stone_slab', 'sandstone_slab', 'oak_slab', 'cobblestone_slab', 'brick_slab', 'stone_brick_slab'][m & 7] ?? 'stone_slab',
  45: 'bricks', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian', 50: 'torch', 53: 'oak_stairs', 54: 'chest', 58: 'crafting_table',
  61: 'furnace', 62: 'furnace', 64: (m) => (m & 8 ? 'oak_door[half=upper]' : 'oak_door'), 65: 'ladder', 67: 'cobblestone_stairs', 78: 'snow', 79: 'ice',
  80: 'snow_block', 82: 'clay', 85: 'oak_fence', 89: 'glowstone', 95: 'white_stained_glass', 98: (m) => (m === 1 ? 'mossy_stone_bricks' : 'stone_bricks'),
  102: 'glass_pane', 108: 'brick_stairs', 109: 'stone_brick_stairs', 125: 'oak_planks', 126: 'oak_slab', 134: 'spruce_stairs', 135: 'birch_stairs',
  136: 'jungle_stairs', 139: 'cobblestone_wall', 155: 'quartz_block', 156: 'quartz_stairs', 159: 'terracotta', 160: 'glass_pane',
  161: (m) => ['acacia', 'dark_oak'][m & 1] + '_leaves', 162: (m) => ['acacia', 'dark_oak'][m & 1] + '_log', 163: 'acacia_stairs',
  164: 'dark_oak_stairs', 171: 'white_carpet', 172: 'terracotta', 188: 'spruce_fence', 193: 'spruce_door', 194: 'birch_door',
};

function legacy(s: Obj): Grid {
  const width = num(s.Width) & 0xffff, height = num(s.Height) & 0xffff, length = num(s.Length) & 0xffff;
  const blocks = s.Blocks as Int8Array, data = s.Data as Int8Array | undefined;
  if (!blocks) throw new Error('this .schematic has no Blocks array');
  const unknown = (id: number) => `legacy_block_${id}`;
  return {
    width, height, length, format: 'MCEdit schematic (legacy ids)',
    get: (x, y, z) => {
      const i = (y * length + z) * width + x;
      const id = blocks[i] & 0xff, meta = data ? data[i] & 0x0f : 0;
      const e = LEGACY[id];
      return e === undefined ? unknown(id) : typeof e === 'string' ? e : e(meta);
    },
  };
}

const stateName = (e: Obj) => {
  const props = e.Properties as Obj | undefined;
  const p = props ? Object.entries(props).map(([k, v]) => `${k}=${String(v)}`).join(',') : '';
  return p ? `${String(e.Name)}[${p}]` : String(e.Name);
};

function litematic(root: Obj): Grid {
  const regions = Object.values((root.Regions ?? {}) as Obj) as Obj[];
  if (!regions.length) throw new Error('this .litematic has no regions');
  // Each region spans Position..Position+Size (Size may be negative); combine them into one grid
  const boxes = regions.map((r) => {
    const p = r.Position as Obj, s = r.Size as Obj;
    const lo = (a: string) => num(p[a]) + Math.min(0, num(s[a]) + 1);
    return { r, x0: lo('x'), y0: lo('y'), z0: lo('z'), sx: Math.abs(num(s.x)), sy: Math.abs(num(s.y)), sz: Math.abs(num(s.z)) };
  });
  const mx = Math.min(...boxes.map((b) => b.x0)), my = Math.min(...boxes.map((b) => b.y0)), mz = Math.min(...boxes.map((b) => b.z0));
  const width = Math.max(...boxes.map((b) => b.x0 + b.sx)) - mx;
  const height = Math.max(...boxes.map((b) => b.y0 + b.sy)) - my;
  const length = Math.max(...boxes.map((b) => b.z0 + b.sz)) - mz;
  const grid: (string | null)[] = new Array(width * height * length).fill(null);
  for (const b of boxes) {
    const palette = ((b.r.BlockStatePalette ?? []) as Obj[]).map(stateName);
    const states = b.r.BlockStates as BigInt64Array;
    const bits = BigInt(Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length)))));
    const mask = (1n << bits) - 1n;
    const total = b.sx * b.sy * b.sz;
    for (let i = 0; i < total; i++) {
      const bit = BigInt(i) * bits, word = Number(bit >> 6n), off = bit & 63n;
      let v = (BigInt.asUintN(64, states[word]) >> off) & mask;
      if (off + bits > 64n) v |= (BigInt.asUintN(64, states[word + 1]) << (64n - off)) & mask;
      const x = i % b.sx, z = Math.floor(i / b.sx) % b.sz, y = Math.floor(i / (b.sx * b.sz));
      grid[(b.y0 - my + y) * width * length + (b.z0 - mz + z) * width + (b.x0 - mx + x)] = palette[Number(v)] ?? null;
    }
  }
  return { width, height, length, format: `Litematica (${regions.length} region${regions.length > 1 ? 's' : ''})`, get: (x, y, z) => grid[y * width * length + z * width + x] };
}

function structure(root: Obj): Grid {
  const size = (root.size as Nbt[]).map(num);
  const [width, height, length] = size;
  const palette = ((root.palette ?? (root.palettes as Nbt[][] | undefined)?.[0] ?? []) as Obj[]).map(stateName);
  const grid: (string | null)[] = new Array(width * height * length).fill(null); // missing = structure void
  for (const b of (root.blocks ?? []) as Obj[]) {
    const [x, y, z] = (b.pos as Nbt[]).map(num);
    grid[y * width * length + z * width + x] = palette[num(b.state)] ?? null;
  }
  return { width, height, length, format: 'structure block (.nbt)', get: (x, y, z) => grid[y * width * length + z * width + x] };
}

export function readSchematic(data: Buffer): Grid {
  const { value } = readNbt(data);
  if (value.Regions) return litematic(value);
  if (Array.isArray(value.size) && value.blocks) return structure(value);
  const s = (value.Schematic as Obj | undefined) ?? value;
  if (s.Palette || (s.Blocks && !(s.Blocks instanceof Int8Array))) return sponge(value);
  if (s.Blocks instanceof Int8Array) return legacy(s);
  throw new Error('not a recognised schematic (.schem, .schematic, .litematic or structure .nbt)');
}

// ---------------------------------------------------------------------------------------------
// Block mapping
// ---------------------------------------------------------------------------------------------

const placeable = (name: string) => {
  const it = ITEMS_BY_NAME.get(name);
  const place = it ? it.places ?? it.block?.name : undefined;
  return !!place && BLOCKS_BY_NAME.has(place);
};

/** Wood types this game lacks, by colour. */
const WOOD: Record<string, string> = { oak: 'oak', spruce: 'spruce', birch: 'birch', jungle: 'oak', acacia: 'oak', dark_oak: 'spruce', mangrove: 'spruce', cherry: 'birch', bamboo: 'birch', crimson: 'spruce', warped: 'oak', pale_oak: 'birch' };
const woodOf = (n: string) => Object.keys(WOOD).sort((a, b) => b.length - a.length).find((w) => n.startsWith(w) || n.startsWith(`stripped_${w}`));
/** Stone-like blocks this game lacks. */
const STONE: Record<string, string> = {
  polished_andesite: 'andesite', polished_diorite: 'diorite', polished_granite: 'granite', cracked_stone_bricks: 'stone_bricks',
  chiseled_stone_bricks: 'stone_bricks', deepslate_bricks: 'stone_bricks', deepslate_tiles: 'stone_bricks', cobbled_deepslate: 'cobblestone',
  polished_deepslate: 'smooth_stone', deepslate: 'stone', tuff: 'stone', calcite: 'smooth_stone', blackstone: 'cobblestone',
  polished_blackstone: 'smooth_stone', polished_blackstone_bricks: 'stone_bricks', nether_bricks: 'bricks', red_nether_bricks: 'bricks',
  mud_bricks: 'bricks', quartz_block: 'smooth_stone', smooth_quartz: 'smooth_stone', quartz_bricks: 'smooth_stone', quartz_pillar: 'smooth_stone',
  chiseled_sandstone: 'sandstone', cut_sandstone: 'sandstone', smooth_sandstone: 'sandstone', red_sandstone: 'sandstone', prismarine: 'mossy_stone_bricks',
  stone_brick: 'stone_bricks', brick: 'bricks', end_stone_bricks: 'sandstone', purpur_block: 'terracotta', packed_mud: 'dirt', mud: 'dirt',
  coarse_dirt: 'dirt', rooted_dirt: 'dirt', podzol: 'dirt', mycelium: 'dirt', dirt_path: 'dirt', farmland: 'dirt', hay_block: 'sandstone',
  iron_bars: 'oak_fence', sea_lantern: 'glowstone', shroomlight: 'glowstone', jack_o_lantern: 'glowstone', barrel: 'chest', smoker: 'furnace',
  blast_furnace: 'furnace', crafting_table: 'crafting_table', cartography_table: 'crafting_table', fletching_table: 'crafting_table',
  smithing_table: 'crafting_table', loom: 'crafting_table', lectern: 'bookshelf', chiseled_bookshelf: 'bookshelf',
};
/** Decorations and fittings with no counterpart: leave the space empty. */
const EMPTY = /carpet|pressure_plate|button|lever|sign|banner|flower_pot|potted_|rail|_bed$|cobweb|trapdoor|fence_gate|item_frame|painting|head|skull|candle|chain$|bell|anvil|cauldron|brewing|enchanting|campfire|scaffolding|ladder|vine|pane_|^air$|cave_air|void_air|structure_void|barrier|light$/;
/** Nature: keep whatever is already on site. */
const KEEP = /^(water|lava|bubble_column|short_grass|tall_grass|grass$|fern|large_fern|dead_bush|seagrass|kelp|snow$)|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|lilac|rose|peony|sunflower|mushroom$|sapling|sugar_cane|bamboo$|lily_pad|moss_carpet/;

/** This game's block for a Minecraft block state: a block id, "air", "keep", or null if there is no sensible match. */
export function mapBlock(state: string): string | null {
  const name = stripNs(state.replace(/\[.*$/, ''));
  const props = state.match(/\[(.*)\]/)?.[1] ?? '';
  if (/_door$/.test(name)) return /half=upper/.test(props) ? 'air' : 'oak_door'; // doors are placed whole from the lower half
  if (placeable(name) && !/_stairs$|_slab$/.test(name)) return name;
  if (KEEP.test(name)) return 'keep';
  if (EMPTY.test(name)) return name === 'ladder' && placeable('ladder') ? 'ladder' : 'air';
  if (STONE[name]) return STONE[name];
  const wood = woodOf(name);
  if (/_planks$/.test(name) && wood) return `${WOOD[wood]}_planks`;
  if (/_(log|wood|stem|hyphae)$/.test(name) && wood) return `${WOOD[wood]}_log`;
  if (/_leaves$/.test(name)) return wood && ['oak', 'spruce', 'birch'].includes(WOOD[wood]) ? `${WOOD[wood]}_leaves` : 'oak_leaves';
  if (/_stairs$/.test(name)) {
    if (placeable(name)) return name;
    if (wood) return 'oak_stairs';
    const base = name.replace(/_stairs$/, '');
    return mapBlock(base) ?? mapBlock(`${base}s`) ?? 'stone_brick_stairs';
  }
  if (/_slab$/.test(name)) {
    if (placeable(name)) return name;
    if (wood) return 'oak_slab';
    return /cobble/.test(name) ? 'cobblestone_slab' : 'stone_slab';
  }
  if (/_fence$/.test(name)) return 'oak_fence';
  if (/_wall$/.test(name)) return 'cobblestone_wall';
  if (/glass/.test(name)) return 'glass';
  if (/_wool$/.test(name)) return 'white_wool';
  if (/terracotta|concrete/.test(name)) return name.startsWith('white_concrete') ? 'white_wool' : 'terracotta';
  if (/torch/.test(name)) return 'torch';
  if (/lantern/.test(name)) return 'lantern';
  if (/_ore$/.test(name)) return 'stone';
  if (/stone|brick|tile/.test(name)) return 'stone_bricks';
  return null;
}

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?!@^~<>/|';

export interface ImportResult {
  design: { name: string; description: string; width: number; depth: number; palette: Record<string, string>; layers: string[][] };
  format: string;
  originalSize: string;
  substitutions: Array<[string, string, number]>;
  unmatched: Array<[string, number]>;
}

/** Convert a schematic to a design (not yet validated). `skipBottom` drops ground layers baked into the schematic. */
export function schematicToDesign(data: Buffer, name: string, skipBottom = 0): ImportResult {
  const g = readSchematic(data);
  if (!g.width || !g.height || !g.length) throw new Error('the schematic is empty');
  if (g.width * g.height * g.length > 4_000_000) throw new Error(`too big (${g.width}x${g.height}x${g.length})`);
  const subs = new Map<string, number>(), unmatched = new Map<string, number>();
  const cell = (x: number, y: number, z: number): string => {
    const state = g.get(x, y, z);
    if (state === null) return 'keep';
    const m = mapBlock(state);
    const base = stripNs(state.replace(/\[.*$/, ''));
    if (m === null) {
      unmatched.set(base, (unmatched.get(base) ?? 0) + 1);
      return 'keep';
    }
    if (m !== base && m !== 'air' && m !== 'keep') subs.set(`${base} -> ${m}`, (subs.get(`${base} -> ${m}`) ?? 0) + 1);
    return m;
  };
  // Map everything, then trim planes that hold no blocks (air or keep only)
  const W = g.width, H = g.height, L = g.length;
  const cells: string[] = new Array(W * H * L);
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) cells[(y * L + z) * W + x] = cell(x, y, z);
  const solid = (b: string) => b !== 'air' && b !== 'keep';
  let x0 = W, x1 = -1, y0 = H, y1 = -1, z0 = L, z1 = -1;
  for (let y = skipBottom; y < H; y++)
    for (let z = 0; z < L; z++)
      for (let x = 0; x < W; x++)
        if (solid(cells[(y * L + z) * W + x])) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
  if (x1 < 0) throw new Error('no buildable blocks left after mapping');
  const palette: Record<string, string> = {};
  const symbolOf = new Map<string, string>();
  let next = 0;
  const layers: string[][] = [];
  for (let y = y0; y <= y1; y++) {
    const rows: string[] = [];
    for (let z = z0; z <= z1; z++) {
      let row = '';
      for (let x = x0; x <= x1; x++) {
        const b = cells[(y * L + z) * W + x];
        if (b === 'keep') row += '_';
        else if (b === 'air') row += '.';
        else {
          let ch = symbolOf.get(b);
          if (!ch) {
            ch = SYMBOLS[next++];
            if (!ch) throw new Error('more distinct blocks than the palette can hold');
            symbolOf.set(b, ch);
            palette[ch] = b;
          }
          row += ch;
        }
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  const width = x1 - x0 + 1, depth = z1 - z0 + 1;
  const sort = <T extends [string, ...unknown[]]>(m: Map<string, number>, f: (k: string, n: number) => T) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => f(k, n));
  return {
    design: { name, description: `imported from a ${g.format}`, width, depth, palette, layers },
    format: g.format,
    originalSize: `${W}x${L}x${H}`,
    substitutions: sort(subs, (k, n) => [k.split(' -> ')[0], k.split(' -> ')[1], n] as [string, string, number]).slice(0, 15),
    unmatched: sort(unmatched, (k, n) => [k, n] as [string, number]).slice(0, 15),
  };
}
