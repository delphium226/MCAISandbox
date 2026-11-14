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
import { rawSetting } from './settings';
import { dressDesign } from './dressing';

export interface SmallWorkKind {
  /** The kind's key, in the design's name (small_<kind>_<wood>). */
  kind: string;
  /** How it reads in a sentence, without an article ("well": "Start building a well", "your own well"). */
  words: string;
  /** What it is for ("a meeting place in the village"). */
  forWhat: string;
  /** Its design in a wood kind ("oak", "spruce"...); a flower bed's in a mix of flowers (#140, MC_FLOWER_MIX); a parterre's
   *  in its green's shape ("star9", MC_GREENS_MIX). */
  make: (wood: string, flowers?: string[], shape?: string) => Design;
  /** R1's vanilla kinds: the village biome whose piece it is (a menu may keep them to villages of that style). */
  biome?: string;
}

/** A design name's prefix for small works. */
export const SMALL_WORK_PREFIX = 'small_';
/** Whether a design is a small work's. */
export const isSmallWork = (name: string) => name.startsWith(SMALL_WORK_PREFIX) && [...SMALL_WORKS, ...RUNG_WORKS].some((k) => name.startsWith(`${SMALL_WORK_PREFIX}${k.kind}_`));

/** A wood kind's log (the Nether's are stems, bamboo's is a block). */
const logOf = (wood: string) => (wood === 'crimson' || wood === 'warped' ? `${wood}_stem` : wood === 'bamboo' ? 'bamboo_block' : `${wood}_log`);

function design(kind: string, wood: string, description: string, palette: Record<string, string>, layers: string[][]): Design {
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  // (MC_DRESSING: the walls dressed lightly, dressing.ts)
  return dressDesign({
    name: `${SMALL_WORK_PREFIX}${kind}_${wood}`, description, palette, layers: layers.map((l) => [...l]),
    width: layers[0][0].length, depth: layers[0].length, height: layers.length, blocks, by: 'code',
  });
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

/** #247 (MC_COPPER_AGE): a 3x3 canopy, fence posts over a plank floor under a roof of 5 copper blocks in a cross with wood
 *  slabs at the corners: the copper age's copper roof, of its second stage's blocks. */
function copperCanopy(w: string): Design {
  return design('copper_canopy', w, 'a copper canopy: fence posts and a roof of copper blocks over a plank floor', {
    P: `${w}_planks`, F: `${w}_fence`, B: 'copper_block', S: `${w}_slab[type=bottom]`,
  }, [
    ['PPP', 'PPP', 'PPP'],
    ['F.F', '...', 'F.F'],
    ['F.F', '...', 'F.F'],
    ['SBS', 'BBB', 'SBS'],
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
// (on by default since 10-26, the user's: "always turn gardens on"; =off for none)
export const GARDENS = !/^(off|0|false|no)$/i.test(rawSetting('MC_GARDENS') ?? 'on');
/** The flower a garden plants (the commonest near minevale3, yellow; one item a block). */
export const GARDEN_FLOWER = 'wildflowers[flower_amount=4,facing=north]';

/**
 * #140 (MC_FLOWER_MIX; on by default since 10-26, the user's, and only with MC_GARDENS): a flower bed or ring planted from a mix of 2-4 of the
 * flowers growing near the village, not wildflowers alone. The one-block flowers a bed may take (the jar's
 * small_flowers that grow wild, with wildflowers and pink petals, set as four to a block); the tall ones (lilac, peony,
 * rose bush, sunflower) need a two-block placement and stay out.
 */
export const FLOWER_MIX = GARDENS && !/^(off|0|false|no)$/i.test(rawSetting('MC_FLOWER_MIX') ?? 'on');
export const BED_FLOWERS = ['wildflowers', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'pink_petals'];
/** A bed flower's block (wildflowers and pink petals as four to a block). */
const flowerBlock = (f: string) => (f === 'wildflowers' || f === 'pink_petals' ? `${f}[flower_amount=4,facing=north]` : f);
/** The kinds a flower work is planted from (#140). */
export const isFlowerWork = (kind: string) => kind === 'front_bed' || kind === 'flower_ring' || kind === 'parterre';

/** A string's small hash (FNV-1a): a member's mix differs from another's, never between runs. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/**
 * The mix a flower work is planted from (#140): from the bed flowers counted near the village (`counts`, blocks by kind),
 * those with at least `need` blocks (a work's gathering finds them), 2 to 4 of them drawn by weight of their count with a
 * seed (the member and the village's count of works: members differ, and a member's next one may too); one kind when only
 * one is common enough, wildflowers when none is. Kinds in the order drawn (the first is the bed's main flower). `ranOut`:
 * kinds the village has run out of (a bed dropped them: F324's 6 new beds each lost a gather on used-up lilies), left out.
 */
export function flowerMix(counts: Record<string, number>, seed: string, need = 4, ranOut: ReadonlySet<string> = new Set()): string[] {
  const pool = BED_FLOWERS.filter((f) => (counts[f] ?? 0) >= need && !ranOut.has(f)).map((f) => ({ f, w: Math.sqrt(counts[f]) }));
  if (!pool.length) return ['wildflowers'];
  let h = hashOf(seed);
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 10000) / 10000);
  const want = Math.min(pool.length, 2 + Math.floor(next() * 3));
  const out: string[] = [];
  while (out.length < want) {
    const left = pool.filter((q) => !out.includes(q.f));
    const total = left.reduce((t, q) => t + q.w, 0);
    let r = next() * total;
    const pick = left.find((q) => (r -= q.w) <= 0) ?? left[left.length - 1];
    out.push(pick.f);
  }
  return out;
}

/** A mix in words: "wildflowers, lily of the valley and dandelion". */
export function mixWords(mix: string[]): string {
  const w = mix.map((f) => f.replace(/_/g, ' '));
  return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/** A flower work's design: its kind's shape with the mix's letters (A the main flower), named with its mix after "~". */
function mixedDesign(kind: string, w: string, what: string, mix: string[] | undefined, layers: (letters: string[]) => string[][]): Design {
  const kinds = mix?.length ? mix : ['wildflowers'];
  const one = kinds.length === 1 && kinds[0] === 'wildflowers' && !mix?.length;
  // (without a mix, the design as it was: one letter F of GARDEN_FLOWER)
  const letters = one ? ['F'] : kinds.map((_, i) => 'ABCD'[i]);
  const d = design(kind, w, one ? what : `${what}, of ${mixWords(kinds)}`, Object.fromEntries(kinds.map((f, i) => [letters[i], one ? GARDEN_FLOWER : flowerBlock(f)])), layers(letters));
  return one ? d : { ...d, name: `${d.name}~${kinds.join('-')}` };
}

/**
 * A 2x2 front bed of flowers beside a door's walkway (one side; the other side may take its own). The two fixed garden
 * shapes first tried (5x2 and 2x5 either side of the walkway) fitted none of mv3_grown25's 28 doors: doors sit a cell
 * inside the outline, streets run along the walls, and the door's sign covers the cells beside the walkway (G2's probe,
 * 10-22); a one-sided bed searched outward fits where the land is free. #140: a mix of two kinds chequered, of three or
 * four one a cell.
 */
function frontBed(_w: string, mix?: string[]): Design {
  return mixedDesign('front_bed', _w, "a flower bed by a house's door", mix, (L) => {
    const [a, b = a, c = a, d = b] = L;
    const top = L.length === 2 ? [`${a}${b}`, `${b}${a}`] : L.length === 3 ? [`${a}${b}`, `${c}${a}`] : [`${a}${b}`, `${c}${d}`];
    return [['__', '__'], top];
  });
}

/** A 5x5 flower ring round a green's centre (its middle 3x3 left as it is, the middle of each side open as a way in; only round
 *  an empty centre: build_design refuses a box over a building). #140: the corners the main flower, the cells beside them
 *  along the rows the second, along the columns the third (else the second), a fourth on two opposite corners. */
function flowerRing(_w: string, mix?: string[]): Design {
  return mixedDesign('flower_ring', _w, "a flower ring round the green's centre, open on each side", mix, (L) => {
    const [a, b = a, c = b, d = a] = L;
    return [
      ['_____', '_____', '_____', '_____', '_____'],
      [`${a}${b}_${b}${d}`, `${c}___${c}`, '_____', `${c}___${c}`, `${d}${b}_${b}${a}`],
    ];
  });
}

/** #46: a sapling of the village's wood, planted where its canopy has room (a 5x5 clear round it). */
function sapling(w: string): Design {
  const kind = w === 'crimson' || w === 'warped' || w === 'bamboo' ? 'oak_sapling' : w === 'mangrove' ? 'mangrove_propagule' : `${w}_sapling`;
  return design('sapling', w, 'a young tree', { T: kind === 'mangrove_propagule' ? kind : `${kind}[stage=0]` }, [
    ['_'],
    ['T'],
  ]);
}

/**
 * MC_GREENS_MIX (off; the user's 10-28, DECISIONS d1d66f5): what fills a green. With MC_GREENS_MORE's 21x21 greens, D1
 * built 146 small works, 77 of them one 1x1 lamp: the one kind that still fitted greens filled from the centre out (42
 * menus offered it alone). With it on, each kind is capped per green (GREEN_CAP, lamps together), larger works rank
 * above small ones, each green keeps a square at its centre for a parterre (a geometric flower garden, its shape and size
 * differing from green to green) and two corners for trees until it has them, and the parterre and the trees rank first.
 */
export const GREENS_MIX = /^(on|1|true|yes)$/i.test(rawSetting('MC_GREENS_MIX') ?? 'off');

/** A parterre's shapes, one a green in turn (greenReserves). */
export const PARTERRE_SHAPES = ['quarters', 'rings', 'star', 'knot', 'chequer', 'diamond'] as const;

/**
 * A parterre's planted cells, S x S (S odd, 5-9), rows north to south: "A" the outer or main bed, "B" the second, "C" the
 * centre's, "_" a grass path (left as it is). quarters: four square beds edged in A round a cross of paths; rings:
 * concentric squares with paths between; star: the two axes and the diagonals; knot: the border and the diamond inside it;
 * chequer: every other cell, rings of two flowers; diamond: nested diamonds with filled corners.
 */
export function parterreRows(shape: string, S: number): string[] {
  const c = (S - 1) / 2, rows: string[] = [];
  for (let j = 0; j < S; j++) {
    let row = '';
    for (let i = 0; i < S; i++) {
      const dx = i - c, dz = j - c, ax = Math.abs(dx), az = Math.abs(dz), r = Math.max(ax, az), m = ax + az;
      let ch = '_';
      if (r === 0) ch = 'C';
      else if (shape === 'quarters') ch = dx === 0 || dz === 0 ? '_' : r === c || ax === 1 || az === 1 ? 'A' : 'B';
      else if (shape === 'rings') ch = (c - r) % 2 ? '_' : (c - r) / 2 === 0 ? 'A' : 'B';
      else if (shape === 'star') ch = dx === 0 || dz === 0 ? 'B' : ax === az ? 'A' : '_';
      else if (shape === 'knot') ch = r === c ? 'A' : m === c ? 'B' : '_';
      else if (shape === 'chequer') ch = (dx + dz) % 2 ? '_' : r % 2 ? 'B' : 'A';
      else if (shape === 'diamond') ch = m > c + 1 ? 'A' : m <= c && (c - m) % 2 === 0 ? 'B' : '_';
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

/** A shape string's parts ("star9" -> star, 9); quarters7 for anything else. */
export function parseShape(shape?: string): { shape: string; size: number } {
  const m = /^([a-z]+)(\d+)$/.exec(shape ?? '');
  const s = m && (PARTERRE_SHAPES as readonly string[]).includes(m[1]) ? m[1] : 'quarters';
  const n = m ? Math.max(5, Math.min(9, Number(m[2]) | 1)) : 7;
  return { shape: s, size: n };
}

/** A parterre's shape from its design's name ("small_parterre_oak~star9~poppy" -> star9), else undefined. */
export const parterreShapeOf = (name: string) => (name.startsWith(`${SMALL_WORK_PREFIX}parterre_`) ? name.split('~')[1] : undefined);

/** A parterre: its shape's beds in the mix's flowers (A the main, B the second, C the third, else the first). Named with
 *  its shape after "~" (and the mix after another), so shapes and mixes are designs of their own. */
function parterre(_w: string, mix?: string[], shapeName?: string): Design {
  const { shape, size } = parseShape(shapeName);
  const kinds = mix?.length ? mix : ['wildflowers'];
  const one = !mix?.length;
  const rows = parterreRows(shape, size);
  // (A, B and C: the mix's first three, falling back to the first; without a mix one letter F, as gardenSpots reads)
  const pick = (L: string) => (one ? GARDEN_FLOWER : flowerBlock(kinds[Math.min('ABC'.indexOf(L), kinds.length - 1)] ?? kinds[0]));
  const top = one ? rows.map((r) => r.replace(/[ABC]/g, 'F')) : rows;
  const palette: Record<string, string> = one ? { F: GARDEN_FLOWER } : Object.fromEntries(['A', 'B', 'C'].filter((L) => rows.some((r) => r.includes(L))).map((L) => [L, pick(L)]));
  const d = design('parterre', _w, `a ${shape} parterre of flower beds ${size}x${size} on the green${one ? '' : `, of ${mixWords(kinds)}`}`, palette, [rows.map((r) => '_'.repeat(r.length)), top]);
  return { ...d, name: `${d.name}~${shape}${size}${one ? '' : `~${kinds.join('-')}`}` };
}

/** The garden kinds (#45, #46), small works with their own spots (gardenSpots). */
export const GARDEN_WORKS: SmallWorkKind[] = [
  { kind: 'front_bed', words: 'flower bed', forWhat: "flowers by a house's door", make: frontBed },
  { kind: 'flower_ring', words: 'flower ring', forWhat: 'flowers round the green', make: flowerRing },
  { kind: 'sapling', words: 'young tree', forWhat: 'shade and green for the village', make: sapling },
  ...(GREENS_MIX ? [{ kind: 'parterre', words: 'flower garden', forWhat: 'a geometric garden of flower beds at the heart of the green', make: parterre }] : []),
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

/** The ladder's works (G8): posted by the village while a rung's stage wants one (mcWorld.ts postRungWorks), never on a
 *  member's menu. #247: the copper canopy, its roof the copper age's blocks. */
export const RUNG_WORKS: SmallWorkKind[] = [
  { kind: 'copper_canopy', words: 'copper canopy', forWhat: 'a copper roof for the copper age, of the copper blocks the workshop made', make: copperCanopy },
];

/** A small work's kind by its key: the menu's (SMALL_WORKS), a yard's (R1's YARD_WORKS, empty with the flag off) or the
 *  ladder's (RUNG_WORKS). */
export const smallWorkKind = (kind: string) => SMALL_WORKS.find((k) => k.kind === kind) ?? YARD_WORKS.find((k) => k.kind === kind) ?? RUNG_WORKS.find((k) => k.kind === kind);

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
  const kinds = [...SMALL_WORKS, ...GARDEN_WORKS, ...VANILLA_WORKS, ...YARD_WORKS, ...RUNG_WORKS].map((k) => k.kind).sort((a, b) => b.length - a.length);
  const k = kinds.find((x) => name.startsWith(`${SMALL_WORK_PREFIX}${x}_`));
  // (#140: a flower bed's mix follows its wood after a "~": "small_front_bed_oak~dandelion-poppy")
  return k ? name.slice(SMALL_WORK_PREFIX.length + k.length + 1).split('~')[0] || undefined : undefined;
}

export interface SpotInput {
  /** Prepared building plots (not the annex, not the works plot), each at its level. A plot with `ground` is not level
   *  (#84: a village laid out on pads, the ground between them): a spot there needs its footprint within 1 of its top and
   *  its ring within -2..+1 of it, read column by column (null: water or unloaded), and takes that top as its y; a
   *  footprint within 2, or with a tree on it (`wooded`), is a spot to prepare first (`prep`: its own little pad, the
   *  footprint and the ring), after every level one. */
  plots: Array<Area & { y: number; ground?: (x: number, z: number) => number | null; wooded?: (x: number, z: number) => boolean }>;
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
export function smallWorkSpots(input: SpotInput, w: number, d: number, max = Infinity): Array<{ x: number; z: number; y: number; prep?: true }> {
  const out: Array<{ x: number; z: number; y: number; dist: number; plot: number; prep?: true }> = [];
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
        const top = p.ground ? groundTop(p.ground, p.x1 + i, p.z1 + j, W, D, p.wooded) : { y: p.y, prep: false };
        if (!top) continue;
        out.push({ x, z, y: top.y, dist: (mx - cx) ** 2 + (mz - cz) ** 2, plot: pi, ...(top.prep ? { prep: true as const } : {}) });
      }
  });
  out.sort((a, b) => Number(!!a.prep) - Number(!!b.prep) || a.dist - b.dist || a.z - b.z || a.x - b.x || a.plot - b.plot);
  return out.slice(0, max).map(({ x, z, y, prep }) => ({ x, z, y, ...(prep ? { prep } : {}) }));
}

/** A W x D box's top (its footprint, inside the 1-cell ring) when the footprint is within 1 of it and the ring within -2..+1
 *  (`prep` when the footprint is within 2 or wooded: levelled first); else null (#84). */
function groundTop(ground: (x: number, z: number) => number | null, x1: number, z1: number, W: number, D: number, wooded?: (x: number, z: number) => boolean): { y: number; prep: boolean } | null {
  let top = -Infinity, low = Infinity, trees = false;
  for (let z = z1 + 1; z < z1 + D - 1; z++)
    for (let x = x1 + 1; x < x1 + W - 1; x++) {
      const g = ground(x, z);
      if (g === null) return null;
      top = Math.max(top, g);
      low = Math.min(low, g);
      if (top - low > 2) return null;
      trees ||= !!wooded?.(x, z);
    }
  for (let z = z1; z < z1 + D; z++)
    for (let x = x1; x < x1 + W; x++) {
      if (x > x1 && x < x1 + W - 1 && z > z1 && z < z1 + D - 1) continue;
      const g = ground(x, z);
      if (g === null || g < top - 2 || g > top + 1) return null;
    }
  return { y: top, prep: top - low > 1 || trees };
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
  /** MC_GREENS_MIX: the greens' reserves (greenReserves): a parterre spot each, and in place of every corner tree the
   *  reserved ones, when any green still wants trees; no flower rings on greens. */
  reserves?: GreenReserve[];
}

/** A garden's place: its kind, build_design's centre (as smallWorkSpots gives it) and the cells it plants; a parterre's
 *  shape (MC_GREENS_MIX). */
export interface GardenSpot { kind: string; x: number; y: number; z: number; cells: Array<{ x: number; z: number }>; shape?: string }

const inArea = (a: Area, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;

/**
 * Areas bucketed by 16x16 tile, for many cell and box tests against a long list (#149: a village on pads keeps each
 * graded path cell as an area of its own, thousands of them, and every garden cell was tested against all of them on
 * every menu). The answers are the plain list's; an area spanning more than 256 tiles is tested on every call.
 */
export function areaIndex(areas: Area[]): { hits: (x: number, z: number) => boolean; overlaps: (b: Area) => boolean } {
  const T = 16, tiles = new Map<string, Area[]>(), big: Area[] = [];
  const tile = (n: number) => Math.floor(n / T);
  for (const a of areas) {
    if ((tile(a.x2) - tile(a.x1) + 1) * (tile(a.z2) - tile(a.z1) + 1) > 256) {
      big.push(a);
      continue;
    }
    for (let tx = tile(a.x1); tx <= tile(a.x2); tx++)
      for (let tz = tile(a.z1); tz <= tile(a.z2); tz++) {
        const k = `${tx},${tz}`;
        const l = tiles.get(k);
        if (l) l.push(a);
        else tiles.set(k, [a]);
      }
  }
  const over = (a: Area, b: Area) => a.x1 <= b.x2 && a.x2 >= b.x1 && a.z1 <= b.z2 && a.z2 >= b.z1;
  return {
    hits: (x, z) => big.some((a) => inArea(a, x, z)) || !!tiles.get(`${tile(x)},${tile(z)}`)?.some((a) => inArea(a, x, z)),
    overlaps: (b) => {
      if (big.some((a) => over(a, b))) return true;
      for (let tx = tile(b.x1); tx <= tile(b.x2); tx++)
        for (let tz = tile(b.z1); tz <= tile(b.z2); tz++) if (tiles.get(`${tx},${tz}`)?.some((a) => over(a, b))) return true;
      return false;
    },
  };
}

/**
 * Where gardens fit (pure, #45): for each door, a 2x2 flower bed beside its walkway (its near column 2-6 cells to either
 * side, its rows 1-6 out from the door, the first that fits, its build box and margin clear of every building: the walkway and the cells beside it stay free for the door's
 * sign and its stand cells, lessons 44, 62, 68); for each green, the ring round its centre; #46's corner trees. A spot is kept only when every cell it plants is free of the hard areas and on
 * soil. Each spot's centre is build_design's for its design (x1 + floor(w / 2), z1 + floor(d / 2)).
 */
export function gardenSpots(input: GardenInput): GardenSpot[] {
  const hard = areaIndex(input.hard), builtOn = input.structures ? areaIndex(input.structures) : hard;
  const free = (x: number, z: number, y: number) => !hard.hits(x, z) && input.soil(x, z, y);
  const out: GardenSpot[] = [];
  const plant = (kind: string, d: Design, x1: number, z1: number, y: number) => {
    const cells: Array<{ x: number; z: number }> = [];
    const top = d.layers[1];
    for (let j = 0; j < top.length; j++) for (let i = 0; i < top[j].length; i++) if (top[j][i] === 'F') cells.push({ x: x1 + i, z: z1 + j });
    if (!cells.every((c) => free(c.x, c.z, y))) return;
    // (build_design works on the design's box and a 1-cell margin, and refuses one that overlaps a building: the margin
    // clear of the buildings' footprints too, G2's L2: a front bed's box ran into the house beside it)
    const box = { x1: x1 - 1, z1: z1 - 1, x2: x1 + d.width, z2: z1 + d.depth };
    if (builtOn.overlaps(box)) return;
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
  // (MC_GREENS_MIX: the green's parterre in place of its ring)
  if (input.reserves) {
    for (const r of input.reserves) if (r.pattern) {
      const n = out.length;
      plant('parterre', parterre('oak', undefined, r.pattern.shape), r.pattern.x1, r.pattern.z1, r.y);
      if (out.length > n) out[out.length - 1].shape = r.pattern.shape;
    }
  } else for (const g of input.greens) plant('flower_ring', flowerRing('oak'), g.x - 2, g.z - 2, g.y);
  const treeOk = (x: number, z: number, y: number) => {
    let clear = input.soil(x, z, y);
    for (let dx = -2; dx <= 2 && clear; dx++) for (let dz = -2; dz <= 2 && clear; dz++) if (hard.hits(x + dx, z + dz)) clear = false;
    return clear;
  };
  // (MC_GREENS_MIX: while a green wants trees, only its reserved corners take one)
  const wanted = input.reserves?.flatMap((r) => r.trees.map((t) => ({ ...t, y: r.y }))) ?? [];
  if (wanted.length) {
    for (const t of wanted) if (treeOk(t.x, t.z, t.y)) out.push({ kind: 'sapling', x: t.x, y: t.y, z: t.z, cells: [{ x: t.x, z: t.z }] });
    return out;
  }
  // (#46: a tree at each corner of a green or plot, 2 in from its edges, its 5x5 canopy clear of every hard area)
  // (MC_GREENS_MIX: a green's trees are its reserved corners alone; the plots' corners as before)
  const corners = [...(input.reserves ? [] : input.greens).filter((g) => g.x1 !== undefined).map((g) => ({ x1: g.x1!, z1: g.z1!, x2: g.x2!, z2: g.z2!, y: g.y })), ...(input.plots ?? [])];
  for (const a of corners) {
    if (a.x2 - a.x1 < 6 || a.z2 - a.z1 < 6) continue;
    for (const [x, z] of [[a.x1 + 2, a.z1 + 2], [a.x2 - 2, a.z1 + 2], [a.x1 + 2, a.z2 - 2], [a.x2 - 2, a.z2 - 2]])
      if (treeOk(x, z, a.y)) out.push({ kind: 'sapling', x, y: a.y, z, cells: [{ x, z }] });
  }
  return out;
}

// ---- MC_GREENS_MIX: each green's reserves, the caps per kind and the menu's order ----

/** A green as the reserves read it: its plot's area, id and level. */
export interface GreenArea extends Area { id: string; y: number }
/** A small work standing or open: its kind and its centre. */
export interface WorkAt { kind: string; x: number; z: number }
/** What a green keeps free (MC_GREENS_MIX): its parterre's square (none once one stands or is open there) and the corners
 *  kept for its trees (none once it has two). */
export interface GreenReserve { green: string; y: number; pattern: (Area & { shape: string }) | null; trees: Array<{ x: number; z: number }> }

/** Trees a green wants (two corners), the most of one kind a green holds, and of the lamps together. */
export const GREEN_TREES = 2, GREEN_CAP = 2, GREEN_LAMPS = 2;
/** A kind's cap group: every lamp one group (plains_lamp_1, lamp_posts, the snowy and taiga posts...). */
export const capGroup = (kind: string) => (/lamp/.test(kind) ? 'lamp' : kind);
const capOf = (group: string) => (group === 'lamp' ? GREEN_LAMPS : group === 'parterre' ? 1 : group === 'sapling' ? GREEN_TREES : GREEN_CAP);

/** A small work's kind from its design's name ("small_lamp_posts_birch" -> lamp_posts; the longest kind first). */
export function smallWorkKindOf(name: string): string | undefined {
  if (!name.startsWith(SMALL_WORK_PREFIX)) return undefined;
  const kinds = [...SMALL_WORKS, ...GARDEN_WORKS, ...VANILLA_WORKS, ...YARD_WORKS, ...RUNG_WORKS].map((k) => k.kind).sort((a, b) => b.length - a.length);
  return kinds.find((x) => name.startsWith(`${SMALL_WORK_PREFIX}${x}_`));
}

const inGreen = (g: Area, w: { x: number; z: number }) => w.x >= g.x1 && w.x <= g.x2 && w.z >= g.z1 && w.z <= g.z2;

/** Each green's count of works by cap group. */
export function greenCounts(greens: GreenArea[], works: WorkAt[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const g of greens) {
    const m = new Map<string, number>();
    for (const w of works) if (inGreen(g, w)) m.set(capGroup(w.kind), (m.get(capGroup(w.kind)) ?? 0) + 1);
    out.set(g.id, m);
  }
  return out;
}

/** The greens where a kind is at its cap (its works there may not grow). */
export function cappedGreens(kind: string, greens: GreenArea[], counts: Map<string, Map<string, number>>): Set<string> {
  const g = capGroup(kind);
  return new Set(greens.filter((x) => (counts.get(x.id)?.get(g) ?? 0) >= capOf(g)).map((x) => x.id));
}

/**
 * Each green's reserves (pure): a parterre's square while none stands or is open on it, its shape the next of
 * PARTERRE_SHAPES by the green's place in the list (and the village's seed), its size 9 on a green 25 or more across,
 * 7 on one 19 or more (MC_GREENS_MORE's 21), 5 on one 13 or more, the first size whose square, nearest the green's centre, is clear of `hard`;
 * and GREEN_TREES corners (2 in from its edges, their 5x5 canopy clear) while it has fewer trees. Stable: a reserve sits
 * on cells other works keep off (the world adds it to their blocked areas), so the same square is found again.
 */
export function greenReserves(greens: GreenArea[], hard: Area[], works: WorkAt[], seed = ''): GreenReserve[] {
  const idx = areaIndex(hard);
  const counts = greenCounts(greens, works);
  const h0 = hashOf(seed);
  return greens.map((g, gi) => {
    const side = Math.min(g.x2 - g.x1, g.z2 - g.z1) + 1;
    const has = counts.get(g.id)!;
    let pattern: GreenReserve['pattern'] = null;
    if (!has.get('parterre')) {
      const shape = PARTERRE_SHAPES[(h0 + gi) % PARTERRE_SHAPES.length];
      const sizes = side >= 25 ? [9, 7, 5] : side >= 19 ? [7, 5] : side >= 13 ? [5] : [];
      const cx = (g.x1 + g.x2) / 2, cz = (g.z1 + g.z2) / 2;
      find: for (const S of sizes) {
        const cands: Array<{ x1: number; z1: number; d: number }> = [];
        // (a ring of 1 inside the green: a path round it)
        for (let z1 = g.z1 + 1; z1 + S <= g.z2; z1++) for (let x1 = g.x1 + 1; x1 + S <= g.x2; x1++)
          cands.push({ x1, z1, d: (x1 + (S - 1) / 2 - cx) ** 2 + (z1 + (S - 1) / 2 - cz) ** 2 });
        cands.sort((a, b) => a.d - b.d || a.z1 - b.z1 || a.x1 - b.x1);
        for (const c of cands) {
          const box = { x1: c.x1, z1: c.z1, x2: c.x1 + S - 1, z2: c.z1 + S - 1 };
          if (idx.overlaps(box)) continue;
          pattern = { ...box, shape: `${shape}${S}` };
          break find;
        }
      }
    }
    const trees: GreenReserve['trees'] = [];
    const want = GREEN_TREES - (has.get('sapling') ?? 0);
    if (want > 0 && side >= 9) {
      const corners = [[g.x1 + 2, g.z1 + 2], [g.x2 - 2, g.z2 - 2], [g.x2 - 2, g.z1 + 2], [g.x1 + 2, g.z2 - 2]];
      for (const [x, z] of corners) {
        if (trees.length >= want) break;
        const canopy = { x1: x - 2, z1: z - 2, x2: x + 2, z2: z + 2 };
        if (pattern && canopy.x1 <= pattern.x2 && canopy.x2 >= pattern.x1 && canopy.z1 <= pattern.z2 && canopy.z2 >= pattern.z1) continue;
        if (!idx.overlaps(canopy)) trees.push({ x, z });
      }
    }
    return { green: g.id, y: g.y, pattern, trees };
  });
}

/** A reserve's areas kept free of other works: its parterre's square and its trees' 5x5 canopies. */
export const reserveAreas = (rs: GreenReserve[]): Area[] => rs.flatMap((r) => [
  ...(r.pattern ? [{ x1: r.pattern.x1, z1: r.pattern.z1, x2: r.pattern.x2, z2: r.pattern.z2 }] : []),
  ...r.trees.map((t) => ({ x1: t.x - 2, z1: t.z - 2, x2: t.x + 2, z2: t.z + 2 })),
]);

/**
 * The menu's order of kinds (MC_GREENS_MIX, pure): the parterre first, then, while a green wants trees, the sapling; then
 * the larger works (a footprint of 9 cells or more, not a lamp); then the rest; each tier in the member's shuffled order.
 */
export function greensMixOrder(order: SmallWorkKind[], wantsTrees: boolean, wood = 'oak'): SmallWorkKind[] {
  const tier = (k: SmallWorkKind) => {
    // (the parterre alone first: in G2 it was offered 8 times beside a sapling and never started)
    if (k.kind === 'parterre') return -1;
    if (wantsTrees && k.kind === 'sapling') return 0;
    if (k.kind === 'sapling' || capGroup(k.kind) === 'lamp' || isGarden(k.kind)) return 2;
    const d = k.make(wood);
    return d.width * d.depth >= 9 ? 1 : 2;
  };
  return order.map((k, i) => ({ k, i, t: tier(k) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.k);
}
