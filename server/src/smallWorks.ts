/**
 * Small works (s35's initiatives): little things a member builds on the village's own ground on its own initiative, with
 * others helping: a well, a bench, a market stall... Drawn in code (as the huts are) in the village's wood, each at most
 * 7x7 and 5 layers, from logs, cobblestone and sand and what is crafted or smelted of them, so a member's gathering covers
 * it. World-free: the world finds their spots with smallWorkSpots from the areas it keeps free and builds them with
 * build_design at the centre returned. With R1 (#104, MC_VANILLA_ALL), vanilla's lamp and decoration pieces join them,
 * read from the jar in the village's wood (VANILLA_WORKS), and its pens and farms make a pool of yard works (YARD_WORKS).
 */
import { VANILLA_ALL, rewoodBlock } from './designs';
import { vanillaJar } from './vanillaData';
import { VILLAGE_BIOMES, decorToDesign, listDecorPieces, listPieces, pieceToDesign, readPiece, yardToDesign } from './vanillaPieces';
import type { Area, Design } from './village';

export interface SmallWorkKind {
  /** The kind's key, in the design's name (small_<kind>_<wood>). */
  kind: string;
  /** How it reads in a sentence, without an article ("well": "Start building a well", "your own well"). */
  words: string;
  /** What it is for ("a meeting place in the village"). */
  forWhat: string;
  /** Its design in a wood kind ("oak", "spruce"...). */
  make: (wood: string) => Design;
  /** R1's vanilla kinds: the village biome whose piece it is (a menu may keep them to villages of that style). */
  biome?: string;
}

/** A design name's prefix for small works. */
export const SMALL_WORK_PREFIX = 'small_';
/** Whether a design is a small work's. */
export const isSmallWork = (name: string) => name.startsWith(SMALL_WORK_PREFIX) && SMALL_WORKS.some((k) => name.startsWith(`${SMALL_WORK_PREFIX}${k.kind}_`));

/** A wood kind's log (the Nether's are stems, bamboo's is a block). */
const logOf = (wood: string) => (wood === 'crimson' || wood === 'warped' ? `${wood}_stem` : wood === 'bamboo' ? 'bamboo_block' : `${wood}_log`);

function design(kind: string, wood: string, description: string, palette: Record<string, string>, layers: string[][]): Design {
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  return {
    name: `${SMALL_WORK_PREFIX}${kind}_${wood}`, description, palette, layers: layers.map((l) => [...l]),
    width: layers[0][0].length, depth: layers[0].length, height: layers.length, blocks, by: 'code',
  };
}

// Layers are bottom-up, rows north to south, columns west to east; layer 0 is the ground's own level ("_" leaves it as it
// is), so what stands on the ground is in layer 1. Open trapdoors lie against the side opposite their facing; stairs
// facing north have their back to the north.

/** A 3x3 well: a cobblestone base and ring round an open basin, fence posts at the corners, a slab roof. */
function well(w: string): Design {
  return design('well', w, 'a small well: a cobblestone ring, fence posts and a slab roof', {
    C: 'cobblestone', F: `${w}_fence`, S: `${w}_slab[type=bottom]`,
  }, [
    ['CCC', 'CCC', 'CCC'],
    ['CCC', 'C.C', 'CCC'],
    ['F.F', '...', 'F.F'],
    ['F.F', '...', 'F.F'],
    ['SSS', 'SSS', 'SSS'],
  ]);
}

/** A 5x3 bench: three stairs (backs to the north) between trapdoor arms. */
function bench(w: string): Design {
  return design('bench', w, 'a bench: three stairs between trapdoor arms', {
    R: `${w}_stairs[facing=north,half=bottom]`,
    W: `${w}_trapdoor[facing=west,half=bottom,open=true]`, E: `${w}_trapdoor[facing=east,half=bottom,open=true]`,
  }, [
    ['_____', '_____', '_____'],
    ['_____', 'WRRRE', '_____'],
  ]);
}

/**
 * A 5x3 market stall: a plank floor, fence posts at the corners, a slab counter at the front, a log crate and a crafting
 * table at the back, a slab roof. (No barrel: its recipe's slabs plan as cherry, so a birch village would gather cherry
 * logs for it; no chest: a chest is the storage's.)
 */
function marketStall(w: string): Design {
  return design('market_stall', w, 'a market stall: fence posts, a counter, a crate and a crafting table under a slab roof', {
    P: `${w}_planks`, F: `${w}_fence`, T: `${w}_slab[type=top]`, S: `${w}_slab[type=bottom]`, B: `${logOf(w)}[axis=y]`, K: 'crafting_table',
  }, [
    ['PPPPP', 'PPPPP', 'PPPPP'],
    ['FB.KF', '.....', 'FTTTF'],
    ['F...F', '.....', 'F...F'],
    ['SSSSS', 'SSSSS', 'SSSSS'],
  ]);
}

/** A 5x3 woodshed: logs stacked two high along the back under a slab roof on fence posts. */
function woodshed(w: string): Design {
  return design('woodshed', w, 'a woodshed: a stack of logs under a slab roof on fence posts', {
    F: `${w}_fence`, L: `${logOf(w)}[axis=x]`, S: `${w}_slab[type=bottom]`,
  }, [
    ['_____', '_____', '_____'],
    ['FLLLF', '.LLL.', 'F...F'],
    ['FLLLF', '.LLL.', 'F...F'],
    ['SSSSS', 'SSSSS', 'SSSSS'],
  ]);
}

/** A 3x3 statue: a stone brick column on a stone slab base, a chiseled block on top. */
function statue(w: string): Design {
  return design('statue', w, 'a statue: a stone brick column on a stone slab base, a chiseled top', {
    S: 'stone_slab[type=bottom]', B: 'stone_bricks', X: 'chiseled_stone_bricks',
  }, [
    ['___', '___', '___'],
    ['SSS', 'SBS', 'SSS'],
    ['...', '.B.', '...'],
    ['...', '.B.', '...'],
    ['...', '.X.', '...'],
  ]);
}

/** A 5x3 pair of lamp posts: a cobblestone foot, two fence posts and a torch on top, three cells apart. */
function lampPosts(w: string): Design {
  return design('lamp_posts', w, 'a pair of lamp posts: fence posts on cobblestone with torches on top', {
    C: 'cobblestone', F: `${w}_fence`, T: 'torch',
  }, [
    ['_____', '_____', '_____'],
    ['_____', 'C...C', '_____'],
    ['_____', 'F...F', '_____'],
    ['_____', 'F...F', '_____'],
    ['_____', 'T...T', '_____'],
  ]);
}

/** A 5x5 gazebo: a plank floor, fence posts at the corners, a bench of stairs along the north and the south, a slab roof. */
function gazebo(w: string): Design {
  return design('gazebo', w, 'a gazebo: fence posts and a slab roof over a plank floor, with two benches', {
    P: `${w}_planks`, F: `${w}_fence`, N: `${w}_stairs[facing=north,half=bottom]`, Q: `${w}_stairs[facing=south,half=bottom]`,
    S: `${w}_slab[type=bottom]`,
  }, [
    ['PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
    ['FNNNF', '.....', '.....', '.....', 'FQQQF'],
    ['F...F', '.....', '.....', '.....', 'F...F'],
    ['F...F', '.....', '.....', '.....', 'F...F'],
    ['SSSSS', 'SSSSS', 'SSSSS', 'SSSSS', 'SSSSS'],
  ]);
}

/** A 3x3 signpost: a sign facing south on a two-high fence post. */
function signpost(w: string): Design {
  return design('signpost', w, 'a signpost: a sign on a fence post', {
    F: `${w}_fence`, N: `${w}_sign[rotation=0]`,
  }, [
    ['___', '___', '___'],
    ['___', '_F_', '___'],
    ['___', '_F_', '___'],
    ['___', '_N_', '___'],
  ]);
}

/**
 * #45: flower beds and front gardens (MC_GARDENS, off). A front garden is two beds of flowers on the grass either side
 * of a house's door walkway (the walkway itself left as it is), one design a walkway's direction; a flower ring circles a
 * green's centre, its four sides open. Planted from flowers members pick (pick_flowers, the planner's FLOWER_ITEMS);
 * layer 0 keeps the ground, which must be soil (the world's soil test in gardenSpots). Their spots come from gardenSpots,
 * not smallWorkSpots: they hug a door or a green's centre, where other works keep off.
 */
export const GARDENS = /^(on|1|true)$/i.test(process.env.MC_GARDENS ?? 'off');
/** The flower a garden plants (the commonest near minevale3, yellow; one item a block). */
export const GARDEN_FLOWER = 'wildflowers[flower_amount=4,facing=north]';

/**
 * A 2x2 front bed of flowers beside a door's walkway (one side; the other side may take its own). The two fixed garden
 * shapes first tried (5x2 and 2x5 either side of the walkway) fitted none of mv3_grown25's 28 doors: doors sit a cell
 * inside the outline, streets run along the walls, and the door's sign covers the cells beside the walkway (G2's probe,
 * 10-22); a one-sided bed searched outward fits where the land is free.
 */
function frontBed(_w: string): Design {
  return design('front_bed', _w, "a flower bed by a house's door", { F: GARDEN_FLOWER }, [
    ['__', '__'],
    ['FF', 'FF'],
  ]);
}

/** A 5x5 flower ring round a green's centre (its middle 3x3 left as it is, the middle of each side open as a way in; only round
 *  an empty centre: build_design refuses a box over a building). */
function flowerRing(_w: string): Design {
  return design('flower_ring', _w, "a flower ring round the green's centre, open on each side", { F: GARDEN_FLOWER }, [
    ['_____', '_____', '_____', '_____', '_____'],
    ['FF_FF', 'F___F', '_____', 'F___F', 'FF_FF'],
  ]);
}

/** #46: a sapling of the village's wood, planted where its canopy has room (a 5x5 clear round it). */
function sapling(w: string): Design {
  const kind = w === 'crimson' || w === 'warped' || w === 'bamboo' ? 'oak_sapling' : w === 'mangrove' ? 'mangrove_propagule' : `${w}_sapling`;
  return design('sapling', w, 'a young tree', { T: kind === 'mangrove_propagule' ? kind : `${kind}[stage=0]` }, [
    ['_'],
    ['T'],
  ]);
}

/** The garden kinds (#45, #46), small works with their own spots (gardenSpots). */
export const GARDEN_WORKS: SmallWorkKind[] = [
  { kind: 'front_bed', words: 'flower bed', forWhat: "flowers by a house's door", make: frontBed },
  { kind: 'flower_ring', words: 'flower ring', forWhat: 'flowers round the green', make: flowerRing },
  { kind: 'sapling', words: 'young tree', forWhat: 'shade and green for the village', make: sapling },
];
export const isGarden = (kind: string) => GARDEN_WORKS.some((k) => k.kind === kind);

// ---- R1 (#104, MC_VANILLA_ALL): vanilla's lamps and decorations as small works, its pens and farms as yard works ----

/** A vanilla piece's design as a small work's kind: its shape and blocks, its wood the village's. */
function vanillaKind(kind: string, words: string, forWhat: string, biome: string, src: Design): SmallWorkKind {
  const palette = (w: string) => Object.fromEntries(Object.entries(src.palette).map(([c, b]) => [c, rewoodBlock(b, w)]));
  return { kind, words, forWhat, biome, make: (w) => design(kind, w, src.description, palette(w), src.layers) };
}

/** What each lamp and decoration piece is (the menu's words) and what for. */
const DECOR_WORDS: Record<string, [string, string]> = {
  plains_lamp_1: ['plains lamp post', 'lighting the street with four torches, as plains villages do'],
  desert_lamp_1: ['desert lamp post', 'lighting the street from a sandstone post, as desert villages do'],
  savanna_lamp_post_01: ['savanna torch post', 'lighting the street, as savanna villages do'],
  snowy_lamp_post_01: ['snowy lamp post with two arms', 'lighting the street, as snowy villages do'],
  snowy_lamp_post_02: ['snowy lamp post with one arm', 'lighting the street, as snowy villages do'],
  snowy_lamp_post_03: ['snowy lamp post with four arms', 'lighting a crossing, as snowy villages do'],
  taiga_lamp_post_1: ['taiga torch post', 'lighting the street from a stone post, as taiga villages do'],
  taiga_decoration_1: ['trapdoor planter', 'a bed for flowers, as taiga villages have'],
  taiga_decoration_2: ['stone seat', 'somewhere to sit, as taiga villages have'],
  taiga_decoration_3: ['stone marker', 'marking the way, as taiga villages do'],
  taiga_decoration_4: ['stone steps', 'a corner of the village in taiga style'],
  taiga_decoration_5: ['campfire', 'warmth and a place to gather'],
  taiga_decoration_6: ['campfire ring', 'warmth and a place to gather, as taiga villages have'],
};

/** The most a yard may span: a green (15 across) less the ring smallWorkSpots keeps free round a work. */
export const YARD_MAX = 13;
/** The fewest blocks a yard keeps (a savanna farm all of soil and water is nothing once its ground is left as it is). */
const YARD_MIN_BLOCKS = 8;

/**
 * Blocks an initiative's crew cannot bring yet (it gathers logs, cobblestone, sand and, with R1, sandstone): a campfire's
 * fuel plans as coal (mcMaterials). A vanilla kind holding one stays in VANILLA_WORKS, off SMALL_WORKS.
 */
const CREW_CANNOT = /^campfire/;
export const crewCanBuild = (k: SmallWorkKind) => !Object.values(k.make('oak').palette).some((b) => CREW_CANNOT.test(b));

/** One kind a piece, read from the jar once; none (and a line) when the jar cannot be read. */
function readKinds(what: string, read: () => SmallWorkKind[]): SmallWorkKind[] {
  try {
    return read();
  } catch (e) {
    console.warn(`[vanilla] no ${what} from ${vanillaJar()}: ${(e as Error).message.slice(0, 160)}`);
    return [];
  }
}

/** R1: vanilla's 14 lamp and decoration pieces (plains, desert and savanna lamps, three snowy lamps, taiga's lamp and six
 *  decorations), each in the village's wood; SMALL_WORKS takes those a crew can build (crewCanBuild). */
export const VANILLA_WORKS: SmallWorkKind[] = !VANILLA_ALL ? [] : readKinds('lamps and decorations', () => listDecorPieces(vanillaJar()).map((path) => {
  const [biome, name] = path.split('/');
  const [words, forWhat] = DECOR_WORDS[name] ?? [name.replace(/_\d+$/, '').replace(/_/g, ' '), `a corner of the village in ${biome} style`];
  return vanillaKind(name, words, forWhat, biome, decorToDesign(readPiece(path, vanillaJar()), biome));
}));

/**
 * R1: the animal pens, farms and plains' accessory of the biomes' houses/ folders (the importer refuses them for having no
 * door), as doorless yard works up to YARD_MAX across, each in the village's wood.
 * Not on the chore menu: SMALL_WORKS leaves them out (a pool for the world to offer, by the village's style).
 */
export const YARD_WORKS: SmallWorkKind[] = !VANILLA_ALL ? [] : readKinds('yards', () => VILLAGE_BIOMES.flatMap((biome) => listPieces(vanillaJar(), biome, 'houses').flatMap((path) => {
  const piece = readPiece(path, vanillaJar());
  try {
    pieceToDesign(piece, biome);
    return [];
  } catch (e) {
    if (!/no door/.test((e as Error).message)) return [];
  }
  // (pens, farms and plains' accessory: the doorless temples, forges and market squares are not yards)
  if (!/animal_pen|farm|accessory/.test(path)) return [];
  let d: Design;
  try {
    d = yardToDesign(piece, biome);
  } catch {
    return [];
  }
  if (d.width > YARD_MAX || d.depth > YARD_MAX || d.blocks < YARD_MIN_BLOCKS) return [];
  const name = d.name;
  const what = name.replace(/_\d+$/, '').replace(/_/g, ' ');
  const forWhat = /pen/.test(name) ? 'keeping animals in a pen' : /farm/.test(name) ? "growing crops in vanilla's own beds" : `an open-air corner of a ${biome} village`;
  return [vanillaKind(name, what, forWhat, biome, d)];
})));

export const SMALL_WORKS: SmallWorkKind[] = [
  { kind: 'well', words: 'well', forWhat: 'a meeting place in the village', make: well },
  { kind: 'bench', words: 'bench', forWhat: 'somewhere to sit and rest', make: bench },
  { kind: 'market_stall', words: 'market stall', forWhat: 'trading goods with neighbours', make: marketStall },
  { kind: 'woodshed', words: 'woodshed', forWhat: 'keeping firewood dry', make: woodshed },
  { kind: 'statue', words: 'statue', forWhat: 'honouring the village', make: statue },
  { kind: 'lamp_posts', words: 'pair of lamp posts', forWhat: 'lighting the way', make: lampPosts },
  { kind: 'gazebo', words: 'gazebo', forWhat: 'shade and gatherings', make: gazebo },
  { kind: 'signpost', words: 'signpost', forWhat: 'showing the way', make: signpost },
  ...(GARDENS ? GARDEN_WORKS : []),
  ...VANILLA_WORKS.filter(crewCanBuild),
];

/** A small work's kind by its key: the menu's (SMALL_WORKS) or a yard's (R1's YARD_WORKS, empty with the flag off). */
export const smallWorkKind = (kind: string) => SMALL_WORKS.find((k) => k.kind === kind) ?? YARD_WORKS.find((k) => k.kind === kind);

/** The kinds a village's members may start (R1): with MC_VANILLA_ALL, vanilla's kinds and the yards a crew can build only in
 *  the village's own style (`biome`: its library's); without, SMALL_WORKS itself. */
export function menuWorks(biome?: string): SmallWorkKind[] {
  if (!VANILLA_ALL) return SMALL_WORKS;
  return [...SMALL_WORKS, ...YARD_WORKS.filter(crewCanBuild)].filter((k) => !k.biome || k.biome === biome);
}

/**
 * The wood a small work's design is in, by its name ("small_well_spruce" -> "spruce"; the longest kind first, so
 * "small_lamp_posts_dark_oak" is the lamp posts in dark oak), or undefined for another name. R2 (MC_WOOD_VARIANTS): a work
 * made in a neighbourhood's wood is gathered and billed in that wood, not the catalogue's.
 */
export function smallWorkWood(name: string): string | undefined {
  const kinds = [...SMALL_WORKS, ...GARDEN_WORKS, ...VANILLA_WORKS, ...YARD_WORKS].map((k) => k.kind).sort((a, b) => b.length - a.length);
  const k = kinds.find((x) => name.startsWith(`${SMALL_WORK_PREFIX}${x}_`));
  return k ? name.slice(SMALL_WORK_PREFIX.length + k.length + 1) || undefined : undefined;
}

export interface SpotInput {
  /** Prepared building plots (not the annex, not the works plot), each at its level. */
  plots: Array<Area & { y: number }>;
  /** Areas kept free: structures (+1), streets, lamps (+1), signs, farms, slots, door fronts, reservations, the mine's
   *  surface, other initiatives' spots (+2)... */
  blocked: Area[];
}

/**
 * Where a w x d small work fits: the footprint and a 1-cell ring round it inside one prepared plot and clear of every
 * blocked area. Returns build_design's centre (x1 + floor(w / 2), z1 + floor(d / 2)) and the plot's level, nearest the
 * plot's centre first (then north to south, west to east; plots in their order on ties), at most `max`. Candidates may
 * overlap one another: they are alternatives. A grid and prefix sums per plot: about the plot's cells plus the blocked
 * cells inside it.
 */
export function smallWorkSpots(input: SpotInput, w: number, d: number, max = Infinity): Array<{ x: number; z: number; y: number }> {
  const out: Array<{ x: number; z: number; y: number; dist: number; plot: number }> = [];
  const W = w + 2, D = d + 2;
  input.plots.forEach((p, pi) => {
    const pw = p.x2 - p.x1 + 1, pd = p.z2 - p.z1 + 1;
    if (pw < W || pd < D) return;
    // Blocked cells, then a summed-area table (one row and column of zeros in front)
    const grid = new Uint8Array(pw * pd);
    for (const b of input.blocked) {
      const x1 = Math.max(b.x1, p.x1), x2 = Math.min(b.x2, p.x2), z1 = Math.max(b.z1, p.z1), z2 = Math.min(b.z2, p.z2);
      if (x1 > x2 || z1 > z2) continue;
      for (let z = z1; z <= z2; z++) grid.fill(1, (z - p.z1) * pw + (x1 - p.x1), (z - p.z1) * pw + (x2 - p.x1) + 1);
    }
    const sw = pw + 1;
    const sum = new Int32Array(sw * (pd + 1));
    for (let j = 0; j < pd; j++) {
      let row = 0;
      for (let i = 0; i < pw; i++) {
        row += grid[j * pw + i];
        sum[(j + 1) * sw + i + 1] = sum[j * sw + i + 1] + row;
      }
    }
    const cx = (p.x1 + p.x2) / 2, cz = (p.z1 + p.z2) / 2;
    for (let j = 0; j + D <= pd; j++)
      for (let i = 0; i + W <= pw; i++) {
        const n = sum[(j + D) * sw + i + W] - sum[j * sw + i + W] - sum[(j + D) * sw + i] + sum[j * sw + i];
        if (n) continue;
        // The footprint starts inside the ring
        const x = p.x1 + i + 1 + Math.floor(w / 2), z = p.z1 + j + 1 + Math.floor(d / 2);
        const mx = p.x1 + i + 1 + (w - 1) / 2, mz = p.z1 + j + 1 + (d - 1) / 2;
        out.push({ x, z, y: p.y, dist: (mx - cx) ** 2 + (mz - cz) ** 2, plot: pi });
      }
  });
  out.sort((a, b) => a.dist - b.dist || a.z - b.z || a.x - b.x || a.plot - b.plot);
  return out.slice(0, max).map(({ x, z, y }) => ({ x, z, y }));
}

/** What gardenSpots reads from the world (#45). */
export interface GardenInput {
  /** Each house's door: the door's cell, the outward step (ox, oz: one of them +-1), the ground level outside it. */
  doors: Array<{ x: number; z: number; ox: number; oz: number; y: number }>;
  /** Greens with their centre (x, z) and level, and their area (for #46's corner trees). */
  greens: Array<{ x: number; z: number; y: number } & Partial<Area>>;
  /** Prepared building plots (for #46's corner trees; optional). */
  plots?: Array<Area & { y: number }>;
  /** Cells no garden may touch: buildings' own footprints, streets, lamps and signs, farms and slots, the mine, other
   *  works, reservations, builds laid out... (not the rings and door fronts other works keep off: a garden hugs them). */
  hard: Area[];
  /** The buildings' footprints (build_design refuses a box over one): checked against each spot's box and its 1-cell
   *  margin; without it, `hard` is (stricter: streets, signs and lamps then keep off the margin too). */
  structures?: Area[];
  /** Whether the ground at (x, z), at the spot's level, is soil a flower stands on (grass, dirt, podzol...). */
  soil: (x: number, z: number, y: number) => boolean;
}

/** A garden's place: its kind, build_design's centre (as smallWorkSpots gives it) and the cells it plants. */
export interface GardenSpot { kind: string; x: number; y: number; z: number; cells: Array<{ x: number; z: number }> }

const inArea = (a: Area, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;

/**
 * Where gardens fit (pure, #45): for each door, a 2x2 flower bed beside its walkway (its near column 2-6 cells to either
 * side, its rows 1-6 out from the door, the first that fits, its build box and margin clear of every building: the walkway and the cells beside it stay free for the door's
 * sign and its stand cells, lessons 44, 62, 68); for each green, the ring round its centre; #46's corner trees. A spot is kept only when every cell it plants is free of the hard areas and on
 * soil. Each spot's centre is build_design's for its design (x1 + floor(w / 2), z1 + floor(d / 2)).
 */
export function gardenSpots(input: GardenInput): GardenSpot[] {
  const free = (x: number, z: number, y: number) => !input.hard.some((a) => inArea(a, x, z)) && input.soil(x, z, y);
  const out: GardenSpot[] = [];
  const plant = (kind: string, d: Design, x1: number, z1: number, y: number) => {
    const cells: Array<{ x: number; z: number }> = [];
    const top = d.layers[1];
    for (let j = 0; j < top.length; j++) for (let i = 0; i < top[j].length; i++) if (top[j][i] === 'F') cells.push({ x: x1 + i, z: z1 + j });
    if (!cells.every((c) => free(c.x, c.z, y))) return;
    // (build_design works on the design's box and a 1-cell margin, and refuses one that overlaps a building: the margin
    // clear of the buildings' footprints too, G2's L2: a front bed's box ran into the house beside it)
    const box = { x1: x1 - 1, z1: z1 - 1, x2: x1 + d.width, z2: z1 + d.depth };
    if ((input.structures ?? input.hard).some((a) => a.x1 <= box.x2 && a.x2 >= box.x1 && a.z1 <= box.z2 && a.z2 >= box.z1)) return;
    out.push({ kind, x: x1 + Math.floor(d.width / 2), y, z: z1 + Math.floor(d.depth / 2), cells });
  };
  for (const dr of input.doors) {
    if (Math.abs(dr.ox) + Math.abs(dr.oz) !== 1) continue;
    // (the bed's rows 1-6 out from the door, its near column 2-6 cells to either side of the walkway: the walkway and the
    // cell beside it stay free for the door's sign and its stand cells, lessons 44, 62, 68; the first that fits)
    const d = frontBed('oak');
    const px = dr.oz !== 0 ? 1 : 0, pz = dr.ox !== 0 ? 1 : 0;
    const n = out.length;
    find: for (let k = 1; k <= 6; k++) for (let lat = 2; lat <= 6; lat++) for (const side of [-1, 1]) {
      // (the bed's two cells nearest the door start k out; its near column `lat` to the side)
      const ax = dr.x + dr.ox * k + px * side * lat, az = dr.z + dr.oz * k + pz * side * lat;
      const bx = ax + dr.ox + px * side, bz = az + dr.oz + pz * side;
      plant('front_bed', d, Math.min(ax, bx), Math.min(az, bz), dr.y);
      if (out.length > n) break find;
    }
  }
  for (const g of input.greens) plant('flower_ring', flowerRing('oak'), g.x - 2, g.z - 2, g.y);
  // (#46: a tree at each corner of a green or plot, 2 in from its edges, its 5x5 canopy clear of every hard area)
  const corners = [...input.greens.filter((g) => g.x1 !== undefined).map((g) => ({ x1: g.x1!, z1: g.z1!, x2: g.x2!, z2: g.z2!, y: g.y })), ...(input.plots ?? [])];
  for (const a of corners) {
    if (a.x2 - a.x1 < 6 || a.z2 - a.z1 < 6) continue;
    for (const [x, z] of [[a.x1 + 2, a.z1 + 2], [a.x2 - 2, a.z1 + 2], [a.x1 + 2, a.z2 - 2], [a.x2 - 2, a.z2 - 2]]) {
      let clear = input.soil(x, z, a.y);
      for (let dx = -2; dx <= 2 && clear; dx++) for (let dz = -2; dz <= 2 && clear; dz++) if (input.hard.some((h) => inArea(h, x + dx, z + dz))) clear = false;
      if (clear) out.push({ kind: 'sapling', x, y: a.y, z, cells: [{ x, z }] });
    }
  }
  return out;
}
