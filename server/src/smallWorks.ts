/**
 * Small works (s35's initiatives): little things a member builds on the village's own ground on its own initiative, with
 * others helping: a well, a bench, a market stall... Drawn in code (as the huts are) in the village's wood, each at most
 * 7x7 and 5 layers, from logs, cobblestone and sand and what is crafted or smelted of them, so a member's gathering covers
 * it. World-free: the world finds their spots with smallWorkSpots from the areas it keeps free and builds them with
 * build_design at the centre returned.
 */
import type { Area, Design } from './village';

export interface SmallWorkKind {
  /** The kind's key, in the design's name (small_<kind>_<wood>). */
  kind: string;
  /** How it reads in a sentence ("a well"). */
  words: string;
  /** What it is for ("a meeting place in the village"). */
  forWhat: string;
  /** Its design in a wood kind ("oak", "spruce"...). */
  make: (wood: string) => Design;
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

export const SMALL_WORKS: SmallWorkKind[] = [
  { kind: 'well', words: 'a well', forWhat: 'a meeting place in the village', make: well },
  { kind: 'bench', words: 'a bench', forWhat: 'somewhere to sit and rest', make: bench },
  { kind: 'market_stall', words: 'a market stall', forWhat: 'trading goods with neighbours', make: marketStall },
  { kind: 'woodshed', words: 'a woodshed', forWhat: 'keeping firewood dry', make: woodshed },
  { kind: 'statue', words: 'a statue', forWhat: 'honouring the village', make: statue },
  { kind: 'lamp_posts', words: 'a pair of lamp posts', forWhat: 'lighting the way', make: lampPosts },
  { kind: 'gazebo', words: 'a gazebo', forWhat: 'shade and gatherings', make: gazebo },
  { kind: 'signpost', words: 'a signpost', forWhat: 'showing the way', make: signpost },
];

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
