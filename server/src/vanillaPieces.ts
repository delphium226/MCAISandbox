/**
 * Vanilla village pieces as designs (phase D, vanilla villages, V2.1): the structure files under
 * data/minecraft/structure/village/ in the local server jar, read at runtime (never copied into the repo), turned into
 * the design format build_design builds, with their block states. A piece is cut at its entrance door (the door's
 * level is layer 1, the floor under it layer 0; vanilla's ground fill below is dropped), turned so its entrance faces
 * south, and its blocks substituted so the survival economy can make them (decoration and workstations to air; the
 * table below). World-independent like designs.ts: the checks (bill, budget) are the caller's.
 */
import { readNbt, type Nbt } from './nbt';
import type { Design } from './village';
import { VANILLA_ALL, baseName, isDoor, outsideCells, outwardStep, turnState, variantWood, woodVariant } from './designs';
import { DEFAULT_JAR, listEntries, readEntry, vanillaJar } from './vanillaData';

export { DEFAULT_JAR };

type Obj = { [key: string]: Nbt };

export const VILLAGE_BIOMES = ['plains', 'savanna', 'snowy', 'taiga', 'desert'] as const;
const PREFIX = 'data/minecraft/structure/village/';

/** Piece paths under the village folder ("plains/houses/plains_small_house_1"), optionally of one biome and kind. */
export function listPieces(jar = DEFAULT_JAR, biome?: string, kind = 'houses'): string[] {
  const want = `${PREFIX}${biome ? `${biome}/` : ''}`;
  return listEntries(want, jar)
    .filter((n) => n.endsWith('.nbt'))
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
  const { value } = readNbt(readEntry(`${PREFIX}${path}.nbt`, jar));
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
const DECOR = /(_bed|_carpet|_banner|_sign|_button|_pressure_plate|^potted_|^flower_pot|^bell$|lantern$|^torch$|^wall_torch$|^ladder$|^chest$|^barrel$|^composter$|^smoker$|^blast_furnace$|^furnace$|_table$|^loom$|^lectern$|^stonecutter$|^grindstone$|^brewing_stand$|cauldron$|^campfire$|^hay_block$|^clay$|^cave_air$|^pumpkin$|^carved_pumpkin$|^melon$|^anvil$|^jukebox$|^note_block$)/;

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
  // Snow blocks need snowballs and ice a silk touch: diorite stands in for both in snowy pieces (R1, the user's choice)
  if (VANILLA_ALL && /^(snow_block|ice|packed_ice|blue_ice)$/.test(name)) return 'diorite';
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
  // Wool needs sheep (or string): a slab of the piece's wood keeps a market stall's awning a roof (the user's choice)
  if (/_wool$/.test(name)) return `${wood}_slab`;
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

/** A state's block name and its properties. */
const base = (s: string | null) => (s ?? '').replace(/\[.*$/, '');
const props = (s: string) => Object.fromEntries((/\[(.*)\]$/.exec(s)?.[1] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?!@^~<>/|';
const TURNS: Record<string, number> = { south: 0, east: 1, north: 2, west: 3 }; // clockwise quarter turns to face south
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/**
 * One of vanilla's own light cells in a piece (B.4), in the design's grid (layer, column i, row j, after the trim and the
 * turns): a wall torch with its facing (away from its wall), or a standing torch (a standing lantern, as a torch). The
 * cell itself is air in the design (torches are DECOR); lighting puts a torch back there.
 */
export interface VanillaLight { layer: number; i: number; j: number; block: 'wall_torch' | 'torch'; facing?: 'north' | 'south' | 'east' | 'west' }

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
  /** Vanilla's light cells inside the design's grid (B.4). */
  lights: VanillaLight[];
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
  const entrance = entranceOf(piece);
  if (!entrance || !STEP[entrance.facing]) throw new Error('no entrance jigsaw facing a side');
  const raw = piece.cells.slice();
  for (const j of piece.jigsaws) raw[(j.y * D + j.z) * W + j.x] = j.finalState === 'structure_void' ? null : j.finalState;
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= W || z >= D || y >= H ? null : raw[(y * D + z) * W + x]);
  // The entrance door: the lower half nearest the jigsaw, at its level or a little above
  let door: [number, number, number] | null = null, best = Infinity;
  const doors: Array<{ at: [number, number, number]; dist: number }> = [];
  for (let y = entrance.y; y <= Math.min(H - 1, entrance.y + 3); y++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const s = at(x, y, z);
        if (!s || !/_door$/.test(base(s)) || props(s).half !== 'lower') continue;
        const dist = Math.abs(x - entrance.x) + Math.abs(z - entrance.z) + (y - entrance.y) * 0.5;
        doors.push({ at: [x, y, z], dist });
        if (dist < best) [best, door] = [dist, [x, y, z]];
      }
  if (!door) throw new Error('no door');
  try {
    return importAt(piece, raw, biome, door, entrance.facing, name, false);
  } catch (e) {
    if (!VANILLA_ALL || !/does not open south/.test((e as Error).message)) throw e;
    // R1: the door found opens away from the entrance's side. A ground floor's door comes before a balcony's (the
    // desert cartographer's upper door was nearer the jigsaw), and a door that opens sideways onto the yard the
    // entrance leads into (plains weaponsmith, snowy fisher cottage and weapon smith, taiga medium house 1) is the way
    // in: the design is turned to face it south
    for (const d of doors.sort((p, q) => p.at[1] - q.at[1] || p.dist - q.dist)) {
      try {
        return importAt(piece, raw, biome, d.at, entrance.facing, name, true);
      } catch {
        continue;
      }
    }
    throw e;
  }
}

/** A piece's entrance jigsaw (with R1, also under the misspelt name the snowy shepherd's house has in the jar). */
function entranceOf(piece: Piece): Jigsaw | undefined {
  return piece.jigsaws.find((j) => j.name === 'minecraft:building_entrance' || (VANILLA_ALL && j.name === 'minecraft:buidling_entrance'));
}

/** Clockwise quarter turns that bring a step out of a door ([dx, dz]) to south. */
const turnsToSouth = ([dx, dz]: [number, number]) => (dx === 1 ? 1 : dz === -1 ? 2 : dx === -1 ? 3 : 0);

/**
 * pieceToDesign's cut at a door: its level is layer 1, turned so the entrance faces south. The entrance door must then
 * open toward the entrance's side (south): otherwise the flood got inside or the door found is not the entrance's. With
 * `sideways` (R1's fallback), a door of layer 1 that opens out of the building another way is accepted and the design
 * turned on so that it faces south.
 */
function importAt(piece: Piece, raw: Array<string | null>, biome: string, door: [number, number, number], facing: string, name: string, sideways: boolean): ImportedPiece {
  let turns = TURNS[facing];
  let { design, droppedBelow, subs, lights } = convert(piece, raw, biome, door[1], turns, name, `vanilla ${name} (${biome}), entrance south`);
  const notes: string[] = [];
  const doorsOf = (d: Design) => {
    const doorCells: Array<[number, number]> = [];
    d.layers[1]?.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '_' && c !== '.' && isDoor(d.palette[c])) doorCells.push([i, j]); }));
    const outsideL1 = d.layers[1] ? outsideCells(d.layers[1]) : new Set<string>();
    const steps = doorCells.map(([i, j]) => outwardStep(d.layers[1], i, j, outsideL1));
    return { doorCells, steps, toSouth: steps.filter((s) => s && s[0] === 0 && s[1] === 1) };
  };
  let found = doorsOf(design);
  if (!found.toSouth.length && sideways) {
    const step = found.steps.find((s): s is [number, number] => !!s);
    if (step) {
      turns = (turns + turnsToSouth(step)) % 4;
      ({ design, droppedBelow, subs, lights } = convert(piece, raw, biome, door[1], turns, name, `vanilla ${name} (${biome}), its door south`));
      found = doorsOf(design);
      notes.push('turned to face its door south (it opens away from the entrance jigsaw)');
    }
  }
  if (!found.toSouth.length) throw new Error(`the entrance door does not open south (doors in layer 1: ${found.doorCells.length})`);
  if (found.doorCells.length > found.toSouth.length) notes.push(`${found.doorCells.length - found.toSouth.length} other door(s) in layer 1`);
  if (droppedBelow) notes.push(`${droppedBelow} blocks below the floor dropped`);
  // (the side of the piece that ends up south: the entrance's, or the door's when turned to it)
  const front = Object.keys(TURNS).find((k) => TURNS[k] === turns) ?? facing;
  return { design, path: piece.path, biome, front, droppedBelow, substitutions: subs, notes, lights };
}

export interface ImportedCentre {
  design: Design;
  path: string;
  biome: string;
  /** Where streets leave it: the side, and the street's middle along that side (a column from the west for north and
   * south, a row from the north for east and west), in the design's grid. */
  connectors: Array<{ side: string; offset: number }>;
  /** Whether vanilla's piece holds water or lava (a fountain: the economy has no buckets). */
  water: boolean;
  /** Its plaza's dirt_path cells in layer 0 (design columns and rows): "_" in the design, laid free with the streets. */
  paths: Array<[number, number]>;
  substitutions: Record<string, number>;
  /** Vanilla's light cells inside the design's grid (B.4). */
  lights: VanillaLight[];
}

/**
 * A town centre (a meeting point) as a design: no door; its street connectors are at walk level, so that level is layer
 * 1 and the ground layer 0, as the streets' path; not turned (the connectors keep their sides). Throws with fewer than
 * two street connectors.
 */
export function centreToDesign(piece: Piece, biome: string): ImportedCentre {
  const { width: W, depth: D } = piece;
  const name = piece.path.split('/').pop()!;
  const streets = piece.jigsaws.filter((j) => j.name === 'minecraft:street' && STEP[j.facing]);
  if (streets.length < 2) throw new Error(`${streets.length} street connector(s)`);
  const water = piece.cells.some((c) => /^(water|lava)$/.test(base(c)) || /waterlogged=true/.test(c ?? ''));
  const raw = piece.cells.slice();
  for (const j of piece.jigsaws) raw[(j.y * D + j.z) * W + j.x] = j.finalState === 'structure_void' ? null : j.finalState;
  const dy = Math.min(...streets.map((j) => j.y));
  const { design, subs, x1, z1, w0, d0, lights } = convert(piece, raw, biome, dy, 0, name, `vanilla ${name} (${biome}), a town centre`);
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  const connectors = streets.map((j) => ({ side: j.facing, offset: j.facing === 'north' || j.facing === 'south' ? clamp(j.x - x1, w0) : clamp(j.z - z1, d0) }));
  // The plaza's path is street, laid free by prepare_site like the streets (the review of V2.3: charged as dirt it was
  // gathered for a centre whose streets cost nothing)
  const paths: Array<[number, number]> = [];
  design.layers[0] = design.layers[0].map((row, j) => [...row].map((ch, i) => {
    if (ch !== '_' && ch !== '.' && design.palette[ch] === 'dirt_path') { paths.push([i, j]); return '_'; }
    return ch;
  }).join(''));
  for (const [ch, b] of Object.entries(design.palette)) if (b === 'dirt_path' && !design.layers.some((l) => l.some((r) => r.includes(ch)))) delete design.palette[ch];
  design.blocks -= paths.length;
  return { design, path: piece.path, biome, connectors, water, paths, substitutions: subs, lights };
}

/**
 * The conversion shared by houses and town centres: vanilla's blocks (jigsaws already their final state) from piece
 * layer `dy - 1` up as design layers (`dy` is layer 1: a house's door level, a centre's walk level), the ground in layer
 * 0, plants, structure void and air outside (a flood of layer 1 from the edge) or open to the sky as "_", blocks
 * substituted (`sub`: substitute, or R1's own for decorations and yards), trimmed, turned `turns` quarter turns clockwise.
 * Returns the trim's corner and size before turning, and vanilla's light cells mapped through the same trim and turns (B.4).
 */
function convert(piece: Piece, raw: Array<string | null>, biome: string, dy: number, turns: number, name: string, description: string, sub: (name: string, biome: string, wood: string) => string = substitute) {
  const { width: W, height: H, depth: D } = piece;
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= W || z >= D || y >= H ? null : raw[(y * D + z) * W + x]);
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
            let to = sub(n, biome, wood);
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
        if (s && !passable(s) && !GROUND.test(n) && sub(n, biome, wood) !== 'air') droppedBelow++;
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

  // Vanilla's light cells (B.4), through the real trim and turns (the check's L1: 9 of 128 pieces trim differently with
  // the torches marked): wall torches, standing torches and standing lanterns (as torches; a hanging one has nothing
  // under it to stand on); dropped outside the trimmed grid, on layer 0 or above the top layer kept
  const lights: VanillaLight[] = [];
  for (let l = 1; l <= top; l++)
    for (let z = z1; z <= z2; z++)
      for (let x = x1; x <= x2; x++) {
        const s = at(x, y0 + l, z), n = base(s);
        const block = n === 'wall_torch' ? 'wall_torch' : n === 'torch' || (/lantern$/.test(n) && props(s!).hanging !== 'true') ? 'torch' : null;
        if (!block) continue;
        let [i, j, ww, dd] = [x - x1, z - z1, w, d];
        for (let r = 0; r < turns; r++) [i, j, ww, dd] = [dd - 1 - j, i, dd, ww];
        const facing = block === 'wall_torch' ? /facing=([a-z]+)/.exec(turnState(`wall_torch[facing=${props(s!).facing}]`, turns))?.[1] as VanillaLight['facing'] : undefined;
        if (block === 'wall_torch' && !facing) continue;
        lights.push({ layer: l, i, j, block, ...(facing ? { facing } : {}) });
      }

  // Turned clockwise until the entrance faces south (as build_design turns: column u = depth-1-row, row v = column)
  for (let r = 0; r < turns; r++) {
    grid = grid.map((layer) => Array.from({ length: w }, (_, v) => Array.from({ length: d }, (_, u) => layer[d - 1 - u][v])));
    [w, d] = [d, w];
  }
  const palette: Record<string, string> = {};
  const symbolOf = new Map<string, string>();
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
  const design: Design = { name, description, palette, layers: layersOut, width: w, depth: d, height: layersOut.length, blocks, by: 'vanilla' };
  return { design, droppedBelow, subs, x1, z1, w0: x2 - x1 + 1, d0: z2 - z1 + 1, lights };
}

const lightsByName = new Map<string, { key: string; design: Design; lights: VanillaLight[] } | null>();
const lightsOf = new WeakMap<Design, VanillaLight[] | null>();
/** A jar read that failed, by jar and name: tried again a minute later, never cached (B.4's review, lens 3 L3). */
const lightsFailed = new Map<string, number>();
/** A design's layers and palette as one string (whether a stored design is still the jar's import). */
const designKey = (d: Design) => JSON.stringify([d.layers, Object.entries(d.palette).sort(([a], [b]) => a.localeCompare(b))]);

/**
 * The light cells of the piece a design is named after, cached (B.4); null when no piece has the name or the design's
 * layers and palette differ from the jar's import (a design posted under a vanilla name is not the piece, lesson 89). A
 * wood variant ("NAME@spruce", R2) has its piece's lights when it is that import in the wood.
 * The jar is the world's (vanillaJar: MC_VANILLA_JAR, as the library it was imported from); a read that fails gives null
 * for a minute and is then tried again.
 */
export function vanillaLights(d: Design, jar = vanillaJar()): VanillaLight[] | null {
  if (lightsOf.has(d)) return lightsOf.get(d)!;
  const name = baseName(d.name), wood = variantWood(d.name);
  const k = `${jar}|${name}`;
  if (!lightsByName.has(k)) {
    if (Date.now() - (lightsFailed.get(k) ?? -Infinity) < 60000) return null;
    let found: { key: string; design: Design; lights: VanillaLight[] } | null = null;
    const biome = VILLAGE_BIOMES.find((b) => name.startsWith(`${b}_`));
    if (biome)
      try {
        for (const kind of ['houses', 'town_centers'] as const) {
          const path = listPieces(jar, biome, kind).find((p) => p.split('/').pop() === name);
          if (!path) continue;
          const piece = readPiece(path, jar);
          // (a piece the importer refuses is no design of the library: null, cached; only a read is tried again)
          let imp: ImportedPiece | ImportedCentre | null = null;
          try {
            imp = kind === 'houses' ? pieceToDesign(piece, biome) : centreToDesign(piece, biome);
          } catch {
            imp = null;
          }
          found = imp ? { key: designKey(imp.design), design: imp.design, lights: imp.lights } : null;
          break;
        }
      } catch (e) {
        if (!lightsFailed.has(k)) console.log(`[light] the vanilla lights of ${d.name} could not be read from ${jar}: ${(e as Error).message.slice(0, 160)}`);
        lightsFailed.set(k, Date.now());
        return null;
      }
    lightsFailed.delete(k);
    lightsByName.set(k, found);
  }
  const f = lightsByName.get(k);
  const lights = f && (wood ? designKey(woodVariant(f.design, wood)) : f.key) === designKey(d) ? f.lights : null;
  lightsOf.set(d, lights);
  return lights;
}

// ---------------------------------------------------------------------------------------------
// R1 (#104): vanilla's lamps and decorations, and its doorless pieces (pens, farms) as yards
// ---------------------------------------------------------------------------------------------

/** The lamp and decoration pieces outside the biomes' houses/ folders ("plains/plains_lamp_1", "taiga/taiga_decoration_3"). */
export function listDecorPieces(jar = DEFAULT_JAR, biome?: string): string[] {
  return listEntries(PREFIX, jar)
    .filter((n) => n.endsWith('.nbt'))
    .map((n) => n.slice(PREFIX.length, -4))
    .filter((n) => {
      const [b, piece, more] = n.split('/');
      return !more && (VILLAGE_BIOMES as readonly string[]).includes(b) && (!biome || b === biome) && /_(lamp|decoration)/.test(piece ?? '');
    })
    .sort();
}

/** A decoration's blocks (R1): its torches and fire kept (a standing lantern becomes a torch: lanterns need iron), hay a
 *  log of the piece's wood (hay needs wheat), the rest as substitute. */
const decorSub = (n: string, biome: string, wood: string) =>
  n === 'torch' || n === 'campfire' ? n : n === 'lantern' ? 'torch' : n === 'hay_block' ? `${wood}_log` : substitute(n, biome, wood);

/**
 * A lamp or decoration piece as a design (R1): its bottom jigsaw's level (the cell on the street's ground) is layer 1, the
 * ground layer 0; not turned. A hanging lantern (snowy lamp posts) has nothing under it to stand on, and a wall torch is
 * no item (a design is billed by its blocks' items): a torch stands on the block either hung from instead, a layer up.
 */
export function decorToDesign(piece: Piece, biome: string): Design {
  const { width: W, height: H, depth: D } = piece;
  const name = piece.path.split('/').pop()!;
  const bottom = piece.jigsaws.find((j) => j.name === 'minecraft:bottom' && j.facing === 'down');
  if (!bottom) throw new Error('no bottom jigsaw facing down');
  const cells = piece.cells.slice();
  for (const j of piece.jigsaws) cells[(j.y * D + j.z) * W + j.x] = j.finalState === 'structure_void' ? null : j.finalState;
  const torches: Array<[number, number, number]> = [];
  for (let y = 0; y < H; y++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const s = cells[(y * D + z) * W + x];
        const hanging = base(s) === 'lantern' && props(s!).hanging === 'true';
        const wall = base(s) === 'wall_torch' ? STEP[props(s!).facing] : undefined;
        if (!hanging && !wall) continue;
        cells[(y * D + z) * W + x] = 'air';
        // (the block it hangs from: above a lantern; behind a wall torch, which faces away from its wall)
        const [sx, sy, sz] = hanging ? [x, y + 1, z] : [x - wall![0], y, z - wall![1]];
        const support = sx >= 0 && sz >= 0 && sx < W && sz < D && sy < H ? cells[(sy * D + sz) * W + sx] : null;
        if (support && !/^(air|cave_air|structure_void)$/.test(base(support)) && !torches.some(([tx, ty, tz]) => tx === sx && ty === sy + 1 && tz === sz)) torches.push([sx, sy + 1, sz]);
      }
  const H2 = Math.max(H, ...torches.map(([, y]) => y + 1));
  const raw: Array<string | null> = new Array(W * H2 * D).fill(null);
  cells.forEach((c, k) => (raw[k] = c));
  for (const [x, y, z] of torches) if (!raw[(y * D + z) * W + x] || base(raw[(y * D + z) * W + x]) === 'air') raw[(y * D + z) * W + x] = 'torch';
  return convert({ ...piece, height: H2, cells: raw }, raw, biome, bottom.y, 0, name, `vanilla ${name} (${biome}), a street decoration`, decorSub).design;
}

/** A yard's blocks (R1): soil, farmland, paths, piled snow and a frozen channel left as the ground is (a raised bed keeps
 *  the plot's own ground: nothing to gather that a village does not), the rest as substitute. */
const yardSub = (n: string, biome: string, wood: string) => (GROUND.test(n) || /^(dirt_path|snow_block|ice|packed_ice)$/.test(n) ? '_' : substitute(n, biome, wood));

/**
 * A doorless piece (an animal pen, a farm: pieceToDesign refuses it, "no door") as a yard design (R1): its entrance
 * jigsaw's level is layer 1 and the ground layer 0, turned so the way in faces south. Throws without an entrance or when
 * the piece holds a door (a house the importer refused for another reason is no yard).
 */
export function yardToDesign(piece: Piece, biome: string): Design {
  const { width: W, depth: D } = piece;
  const name = piece.path.split('/').pop()!;
  const entrance = entranceOf(piece);
  if (!entrance || !STEP[entrance.facing]) throw new Error('no entrance jigsaw facing a side');
  if (piece.cells.some((c) => /_door$/.test(base(c)))) throw new Error('it has a door: a house, not a yard');
  const raw = piece.cells.slice();
  for (const j of piece.jigsaws) raw[(j.y * D + j.z) * W + j.x] = j.finalState === 'structure_void' ? null : j.finalState;
  return convert(piece, raw, biome, entrance.y, TURNS[entrance.facing], name, `vanilla ${name} (${biome}), a yard, its way in south`, yardSub).design;
}

// ---------------------------------------------------------------------------------------------
// A biome's library: the pieces a village there builds from (V2.3)
// ---------------------------------------------------------------------------------------------

/** The biomes of Minecraft's world mapped onto the five village biomes (vanilla's own choice where it has one). */
export function villageBiome(biome: string): string {
  const b = biome.replace(/^minecraft:/, '');
  if (/desert/.test(b)) return 'desert';
  if (/savanna|badlands/.test(b)) return 'savanna';
  if (/snowy_(plains|slopes|beach)|ice_spikes|frozen|snowy$/.test(b)) return 'snowy';
  if (/taiga|^grove$/.test(b)) return 'taiga';
  return 'plains';
}

export interface VanillaLibrary {
  biome: string;
  /** The town centre (a meeting point without water), or null: the plan's streets then cross in the middle. */
  centre: ImportedCentre | null;
  /** Houses in the order offered: small ones (siblings: "matching" houses), then others, then one landmark. */
  houses: Design[];
}

const libraries = new Map<string, VanillaLibrary>();

/**
 * A village biome's pieces that pass `accept` (the caller's survival checks: bill, budget, materials), at most `small`
 * small houses, `other` other houses and one landmark (a library or temple), and its first passing meeting point without
 * water. Read from the jar once per biome. With R1 (VANILLA_ALL), every dwelling that passes (small, medium and big
 * houses: the medium and big ones within the larger home's budget the world's `accept` allows) and the other caps as
 * before (the public works pool has the rest).
 */
export function vanillaLibrary(biome: string, accept: (d: Design, centre: boolean) => boolean, jar = DEFAULT_JAR, small = VANILLA_ALL ? Infinity : 4, other = 2): VanillaLibrary {
  const key = `${biome}|${jar}`;
  const cached = libraries.get(key);
  if (cached) return cached;
  const houses: Design[] = [];
  const landmark = /_(library|temple)_/;
  let smalls = 0, others = 0, landmarks = 0;
  for (const path of listPieces(jar, biome, 'houses')) {
    const name = path.split('/').pop()!;
    const kind = /small_house/.test(name) || (VANILLA_ALL && /_(medium|big)_house_\d+$/.test(name)) ? 'small' : landmark.test(name) ? 'landmark' : 'other';
    if ((kind === 'small' && smalls >= small) || (kind === 'other' && others >= other) || (kind === 'landmark' && landmarks >= 1)) continue;
    let d: Design;
    try {
      d = pieceToDesign(readPiece(path, jar), biome).design;
    } catch {
      continue;
    }
    if (!accept(d, false)) continue;
    houses.push(d);
    if (kind === 'small') smalls++;
    else if (kind === 'landmark') landmarks++;
    else others++;
  }
  houses.sort((a, b) => Number(landmark.test(a.name)) - Number(landmark.test(b.name)) || Number(!/small_house/.test(a.name)) - Number(!/small_house/.test(b.name)));
  let centre: ImportedCentre | null = null;
  for (const path of listPieces(jar, biome, 'town_centers')) {
    if (!/meeting_point/.test(path)) continue;
    try {
      const c = centreToDesign(readPiece(path, jar), biome);
      if (!c.water && accept(c.design, true)) { centre = c; break; }
    } catch {
      continue;
    }
  }
  const lib = { biome, centre, houses };
  libraries.set(key, lib);
  return lib;
}

