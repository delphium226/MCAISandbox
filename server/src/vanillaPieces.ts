/**
 * Vanilla village pieces as designs (phase D, vanilla villages, V2.1): the structure files under
 * data/minecraft/structure/village/ in the local server jar, read at runtime (never copied into the repo), turned into
 * the design format build_design builds, with their block states. A piece is cut at its entrance door (the door's
 * level is layer 1, the floor under it layer 0; vanilla's ground fill below is dropped), turned so its entrance faces
 * south, and its blocks substituted so the survival economy can make them (decoration and workstations to air; the
 * table below). World-independent like designs.ts: the checks (bill, budget) are the caller's.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readNbt, type Nbt } from './nbt';
import type { Design } from './village';
import { isDoor, outsideCells, outwardStep, turnState } from './designs';

type Obj = { [key: string]: Nbt };

/** The jar the pieces are read from (mc/server's Paper; the test world's server runs the same version). */
export const DEFAULT_JAR = 'mc/server/versions/26.1.2/paper-26.1.2.jar';
export const VILLAGE_BIOMES = ['plains', 'savanna', 'snowy', 'taiga', 'desert'] as const;
const PREFIX = 'data/minecraft/structure/village/';

// ---------------------------------------------------------------------------------------------
// Reading the jar: a zip's central directory, each entry stored or deflated (zlib, no dependency)
// ---------------------------------------------------------------------------------------------

interface ZipEntry { name: string; method: number; size: number; offset: number }

const jars = new Map<string, { buf: Buffer; entries: Map<string, ZipEntry> }>();

function openJar(path: string) {
  const cached = jars.get(path);
  if (cached) return cached;
  const buf = fs.readFileSync(path);
  // The end-of-central-directory record is in the last 64 KiB (a comment may follow it)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${path} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.startsWith(PREFIX)) entries.set(name, { name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const jar = { buf, entries };
  jars.set(path, jar);
  return jar;
}

function readEntry(path: string, name: string): Buffer {
  const { buf, entries } = openJar(path);
  const e = entries.get(name);
  if (!e) throw new Error(`no ${name} in ${path}`);
  // The local header's name and extra lengths can differ from the central directory's
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.size);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`${name}: zip method ${e.method} is not supported`);
}

/** Piece paths under the village folder ("plains/houses/plains_small_house_1"), optionally of one biome and kind. */
export function listPieces(jar = DEFAULT_JAR, biome?: string, kind = 'houses'): string[] {
  const { entries } = openJar(jar);
  const want = `${PREFIX}${biome ? `${biome}/` : ''}`;
  return [...entries.keys()]
    .filter((n) => n.startsWith(want) && n.endsWith('.nbt'))
    .map((n) => n.slice(PREFIX.length, -4))
    .filter((n) => n.split('/')[1] === kind)
    .sort();
}

// ---------------------------------------------------------------------------------------------
// A piece: its blocks as states, and its jigsaw blocks
// ---------------------------------------------------------------------------------------------

export interface Jigsaw {
  x: number; y: number; z: number;
  /** Which way the jigsaw faces (its orientation's first part: west, up...). */
  facing: string;
  /** "minecraft:building_entrance", "minecraft:bottom", "minecraft:street"... */
  name: string;
  /** The block it becomes once the structure is placed. */
  finalState: string;
  pool: string;
}

export interface Piece {
  path: string;
  width: number; height: number; depth: number;
  /** Block states by (y * depth + z) * width + x, namespace stripped; null where the file has no block (structure void). */
  cells: Array<string | null>;
  jigsaws: Jigsaw[];
}

const num = (v: Nbt | undefined) => Number(v ?? 0);
const stripNs = (s: string) => s.replace(/^minecraft:/, '');

const stateName = (e: Obj) => {
  const props = e.Properties as Obj | undefined;
  const p = props ? Object.entries(props).map(([k, v]) => `${k}=${String(v)}`).join(',') : '';
  return stripNs(String(e.Name)) + (p ? `[${p}]` : '');
};

/** Read one piece ("plains/houses/plains_small_house_1") from the jar. */
export function readPiece(path: string, jar = DEFAULT_JAR): Piece {
  const { value } = readNbt(readEntry(jar, `${PREFIX}${path}.nbt`));
  const [width, height, depth] = (value.size as Nbt[]).map(num);
  const palette = ((value.palette ?? (value.palettes as Nbt[][] | undefined)?.[0] ?? []) as Obj[]).map(stateName);
  const cells: Array<string | null> = new Array(width * height * depth).fill(null);
  const jigsaws: Jigsaw[] = [];
  for (const b of (value.blocks ?? []) as Obj[]) {
    const [x, y, z] = (b.pos as Nbt[]).map(num);
    const state = palette[num(b.state)] ?? null;
    cells[(y * depth + z) * width + x] = state;
    if (state?.startsWith('jigsaw')) {
      const nbt = (b.nbt ?? {}) as Obj;
      jigsaws.push({
        x, y, z,
        facing: /orientation=([a-z]+)_/.exec(state)?.[1] ?? 'up',
        name: String(nbt.name ?? ''),
        finalState: stripNs(String(nbt.final_state ?? 'minecraft:air')),
        pool: String(nbt.pool ?? ''),
      });
    }
  }
  return { path, width, height, depth, cells, jigsaws };
}

// ---------------------------------------------------------------------------------------------
// Substitution: vanilla's blocks kept where the economy makes them, the rest to a near block or to air
// ---------------------------------------------------------------------------------------------

/** Ground and plants: left as the prepared plot has them ("_") in the floor layer, plants "_" anywhere. */
const GROUND = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|sand|red_sand|gravel|clay|farmland|mycelium)$/;
const PLANT = /^(short_grass|tall_grass|fern|large_fern|dead_bush|wheat|carrots|potatoes|beetroots|pumpkin_stem|melon_stem|attached_.*_stem|sweet_berry_bush|sugar_cane|cactus|bamboo|.*_sapling|seagrass|tall_seagrass|kelp|kelp_plant|lily_pad|vine|.*_leaves|poppy|dandelion|oxeye_daisy|cornflower|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|sunflower|lilac|rose_bush|peony|.*_mushroom|snow|sea_pickle)$/;
/** Decoration, lights, workstations and containers: air (an interiors pass may bring some back later). */
const DECOR = /(_bed|_carpet|_banner|_sign|_button|_pressure_plate|^potted_|^flower_pot|^bell$|lantern$|^torch$|^wall_torch$|^ladder$|^chest$|^barrel$|^composter$|^smoker$|^blast_furnace$|^furnace$|_table$|^loom$|^lectern$|^stonecutter$|^grindstone$|^brewing_stand$|cauldron$|^campfire$|^hay_block$|_wool$|^clay$|^cave_air$|^pumpkin$|^carved_pumpkin$|^melon$|^anvil$|^jukebox$|^note_block$)/;

/** A wood kind's planks from a block of that wood ("spruce_log" -> "spruce_planks"), oak for anything else. */
const woodOf = (name: string) => /^(?:stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_/.exec(name)?.[1];

/**
 * The block a vanilla block becomes, by name (states are carried over by the caller where the new block has them):
 * the block itself, another block, "air", or "_" (leave the ground). `biome` picks terracotta's stand-in and
 * `wood` is the piece's main wood (for bookshelves).
 */
export function substitute(name: string, biome: string, wood = 'oak'): string {
  // (decoration first: potted_red_tulip is a pot, not a plant)
  if (DECOR.test(name)) return 'air';
  if (PLANT.test(name)) return '_';
  if (name === 'structure_void' || name === 'jigsaw' || name === 'water' || name === 'lava') return '_';
  // Smelted from sandstone (~165 furnace runs for a desert house): the sandstone it is made of
  if (name === 'smooth_sandstone') return 'sandstone';
  if (/^smooth_sandstone_(slab|stairs)$/.test(name)) return name.replace('smooth_', '');
  if (/stained_glass_pane$|^iron_bars$/.test(name)) return 'glass_pane';
  if (/stained_glass$/.test(name)) return 'glass';
  const stone = /^(diorite|granite|andesite|polished_diorite|polished_granite|polished_andesite|mossy_cobblestone)(_slab|_stairs|_wall)?$/.exec(name);
  if (stone) return `cobblestone${stone[2] ?? ''}`;
  if (name === 'bricks') return 'cobblestone';
  if (/_glazed_terracotta$/.test(name)) return 'chiseled_sandstone';
  // Terracotta needs clay or badlands: a near colour the economy makes, by biome (the user's choice, 10-04)
  if (/terracotta$/.test(name)) {
    if (biome === 'savanna') return 'acacia_planks';
    if (biome === 'desert') return 'sandstone';
    return 'cobblestone';
  }
  // Books need leather: the piece's own planks keep the wall whole
  if (name === 'bookshelf') return `${wood}_planks`;
  return name;
}

/** The full block a double slab is (validateDesign refuses double slabs, and one would be charged as one slab). */
function fullBlock(slab: string): string {
  const wood = woodOf(slab);
  if (wood) return `${wood}_planks`;
  const base = slab.replace(/_slab$/, '');
  const full: Record<string, string> = { stone_brick: 'stone_bricks', brick: 'cobblestone', smooth_sandstone: 'sandstone', petrified_oak: 'oak_planks' };
  return full[base] ?? base;
}

/** States kept (the server works out the rest: stair shapes, fence and pane sides, lesson 55). */
const KEEP_STATES = new Set(['facing', 'half', 'axis', 'type', 'open', 'rotation']);

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?!@^~<>/|';
const TURNS: Record<string, number> = { south: 0, east: 1, north: 2, west: 3 }; // clockwise quarter turns to face south
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

export interface ImportedPiece {
  design: Design;
  path: string;
  biome: string;
  /** Which way the entrance faced in the piece (the design is turned so it faces south). */
  front: string;
  /** Blocks of vanilla's ground fill or foundation dropped below the floor layer (not ground blocks). */
  droppedBelow: number;
  /** "vanilla -> ours" with counts (blocks turned to air included). */
  substitutions: Record<string, number>;
  notes: string[];
}

/**
 * A vanilla piece as a design: the entrance door's level is layer 1 and the floor under it layer 0 (vanilla raises
 * plains floors a block: they sit on the ground here, the entrance step flush with it); jigsaw blocks become their
 * final state; ground in the floor layer, plants, structure void and air outside the building or open to the sky
 * become "_"; blocks substituted (above); turned so the entrance faces south. Throws when the piece has no entrance or
 * no door, or its door does not open toward the entrance.
 */
export function pieceToDesign(piece: Piece, biome: string): ImportedPiece {
  const { width: W, height: H, depth: D } = piece;
  const name = piece.path.split('/').pop()!;
  const entrance = piece.jigsaws.find((j) => j.name === 'minecraft:building_entrance');
  if (!entrance || !STEP[entrance.facing]) throw new Error('no entrance jigsaw facing a side');
  const raw = piece.cells.slice();
  for (const j of piece.jigsaws) raw[(j.y * D + j.z) * W + j.x] = j.finalState === 'structure_void' ? null : j.finalState;
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= W || z >= D || y >= H ? null : raw[(y * D + z) * W + x]);
  const base = (s: string | null) => (s ?? '').replace(/\[.*$/, '');
  const props = (s: string) => Object.fromEntries((/\[(.*)\]$/.exec(s)?.[1] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
  // The entrance door: the lower half nearest the jigsaw, at its level or a little above
  let door: [number, number, number] | null = null, best = Infinity;
  for (let y = entrance.y; y <= Math.min(H - 1, entrance.y + 3); y++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const s = at(x, y, z);
        if (!s || !/_door$/.test(base(s)) || props(s).half !== 'lower') continue;
        const dist = Math.abs(x - entrance.x) + Math.abs(z - entrance.z) + (y - entrance.y) * 0.5;
        if (dist < best) [best, door] = [dist, [x, y, z]];
      }
  if (!door) throw new Error('no door');
  const dy = door[1];
  const y0 = dy - 1; // piece y of design layer 0
  // The piece's main wood (bookshelves become its planks)
  const woods = new Map<string, number>();
  for (const s of raw) { const w = s && woodOf(base(s)); if (w) woods.set(w, (woods.get(w) ?? 0) + 1); }
  const wood = [...woods].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'oak';

  // Outside the building in the door layer, on vanilla's blocks: air, void, plants and snow (piled snow blocks too) joined to the edge (door
  // halves stay solid, so the flood cannot get in through the doorway; decoration counts as solid)
  const open = (s: string | null) => s === null || /^(air|cave_air|structure_void)$/.test(base(s)) || PLANT.test(base(s));
  // (a snow block with open space above it is a pile; an igloo's snow walls go up to its roof)
  const passable = (s: string | null, x = -1, z = -1) => open(s) || (base(s) === 'snow_block' && x >= 0 && open(at(x, dy + 1, z)));
  const outside = new Set<string>();
  const queue: Array<[number, number]> = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (x === 0 || z === 0 || x === W - 1 || z === D - 1) queue.push([x, z]);
  while (queue.length) {
    const [x, z] = queue.pop()!;
    if (x < 0 || z < 0 || x >= W || z >= D || outside.has(`${x},${z}`) || !passable(at(x, dy, z), x, z)) continue;
    outside.add(`${x},${z}`);
    queue.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }

  // Each cell as a block ("air" for air), "_" or the door's upper half ("."), layer by layer from y0 up
  const subs: Record<string, number> = {};
  const count = (from: string, to: string) => { if (from !== to) subs[`${from} -> ${to}`] = (subs[`${from} -> ${to}`] ?? 0) + 1; };
  const layers = H - y0;
  const out: string[][][] = []; // [layer][z][x]
  for (let l = 0; l < layers; l++) {
    const y = y0 + l;
    out.push([]);
    for (let z = 0; z < D; z++) {
      out[l].push([]);
      for (let x = 0; x < W; x++) {
        const s = at(x, y, z);
        let cell: string;
        if (s === null) cell = '_';
        else {
          const n = base(s), p = props(s);
          if (/_door$/.test(n)) cell = p.half === 'upper' ? '.' : n;
          else if (n === 'air' || n === 'cave_air') cell = 'air';
          // (snow piled on the ground outside the walls is ground too: snowy pieces)
          else if ((l === 0 && GROUND.test(n)) || (n === 'snow_block' && outside.has(`${x},${z}`))) cell = '_';
          else {
            let to = substitute(n, biome, wood);
            if (/_slab$/.test(to) && p.type === 'double') to = fullBlock(to);
            if (to !== '_' && to !== 'air' && n !== 'air') count(n, to);
            else if (to === 'air') count(n, 'air');
            // (states carry over only to a block of the same shape: glazed terracotta's facing means nothing to sandstone)
            const shaped = to === n || to.split('_').pop() === n.split('_').pop();
            const kept = Object.entries(p).filter(([k]) => shaped && KEEP_STATES.has(k) && !(k === 'type' && p.type === 'double') && to !== 'air' && to !== '_').sort(([u], [v]) => u.localeCompare(v));
            cell = to === '_' || to === 'air' || !kept.length ? to : `${to}[${kept.map(([k, v]) => `${k}=${v}`).join(',')}]`;
          }
        }
        out[l][z].push(cell);
      }
    }
  }
  // Below the floor: what is dropped that is not ground
  let droppedBelow = 0;
  for (let y = 0; y < y0; y++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const s = at(x, y, z), n = base(s);
        if (s && !passable(s) && !GROUND.test(n) && substitute(n, biome, wood) !== 'air') droppedBelow++;
      }
  // Air: "_" in the floor layer (no pits), outside the building, or with nothing above it (a fenced yard is open to
  // the sky); "." inside, under a roof
  const solid = (c: string) => c !== '_' && c !== 'air' && c !== '.';
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      let covered = false;
      for (let l = layers - 1; l >= 0; l--) {
        const c = out[l][z][x];
        if (solid(c)) covered = true;
        else if (c === 'air') out[l][z][x] = l === 0 || !covered || outside.has(`${x},${z}`) ? '_' : '.';
      }
    }

  // Trim columns, rows and top layers with no block
  const has = (pred: (l: number, z: number, x: number) => boolean) => {
    for (let l = 0; l < layers; l++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (pred(l, z, x)) return true;
    return false;
  };
  const filled = (l: number, z: number, x: number) => solid(out[l][z][x]);
  let x1 = 0, x2 = W - 1, z1 = 0, z2 = D - 1, top = layers - 1;
  while (x1 < x2 && !has((l, z, x) => x === x1 && filled(l, z, x))) x1++;
  while (x2 > x1 && !has((l, z, x) => x === x2 && filled(l, z, x))) x2--;
  while (z1 < z2 && !has((l, z, x) => z === z1 && filled(l, z, x))) z1++;
  while (z2 > z1 && !has((l, z, x) => z === z2 && filled(l, z, x))) z2--;
  while (top > 1 && !has((l, z, x) => l === top && filled(l, z, x))) top--;
  let w = x2 - x1 + 1, d = z2 - z1 + 1;
  let grid: string[][][] = out.slice(0, top + 1).map((layer) => layer.slice(z1, z2 + 1).map((row) => row.slice(x1, x2 + 1)));

  // Turned clockwise until the entrance faces south (as build_design turns: column u = depth-1-row, row v = column)
  const turns = TURNS[entrance.facing];
  for (let r = 0; r < turns; r++) {
    grid = grid.map((layer) => Array.from({ length: w }, (_, v) => Array.from({ length: d }, (_, u) => layer[d - 1 - u][v])));
    [w, d] = [d, w];
  }
  const palette: Record<string, string> = {};
  const symbolOf = new Map<string, string>();
  const notes: string[] = [];
  const layersOut = grid.map((layer) => layer.map((row) => row.map((c) => {
    if (c === '_' || c === '.') return c;
    const block = turnState(c, turns);
    let ch = symbolOf.get(block);
    if (!ch) {
      ch = SYMBOLS[symbolOf.size];
      if (!ch) throw new Error(`more than ${SYMBOLS.length} distinct blocks`);
      symbolOf.set(block, ch);
      palette[ch] = block;
    }
    return ch;
  }).join('')));
  const blocks = layersOut.reduce((t, layer) => t + layer.reduce((u, row) => u + [...row].filter((c) => c !== '_' && c !== '.').length, 0), 0);
  const design: Design = {
    name, description: `vanilla ${name} (${biome}), entrance south`, palette, layers: layersOut, width: w, depth: d, height: layersOut.length, blocks, by: 'vanilla',
  };
  // The entrance door must open toward the entrance's side (now south): otherwise the flood got inside or the door
  // found is not the entrance's
  const doorCells: Array<[number, number]> = [];
  layersOut[1]?.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '_' && c !== '.' && isDoor(palette[c])) doorCells.push([i, j]); }));
  const outsideL1 = layersOut[1] ? outsideCells(layersOut[1]) : new Set<string>();
  const toSouth = doorCells.filter(([i, j]) => { const s = outwardStep(layersOut[1], i, j, outsideL1); return s && s[0] === 0 && s[1] === 1; });
  if (!toSouth.length) throw new Error(`the entrance door does not open south (doors in layer 1: ${doorCells.length})`);
  if (doorCells.length > toSouth.length) notes.push(`${doorCells.length - toSouth.length} other door(s) in layer 1`);
  if (droppedBelow) notes.push(`${droppedBelow} blocks below the floor dropped`);
  return { design, path: piece.path, biome, front: entrance.facing, droppedBelow, substitutions: subs, notes };
}
