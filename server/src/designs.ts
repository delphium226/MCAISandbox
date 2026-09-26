/**
 * Model-designed buildings: a design is a stack of layers (bottom-up), each a list of rows (north to south) of
 * palette symbols (west to east). '.' is air and '_' leaves the existing block alone. Models write rows with the symbols
 * separated by spaces ("L P P P L"), which they count far more reliably than packed strings; rows are stored packed.
 * Designs are drawn by an LLM
 * (see tieredBrain's design_building), checked here, stored in the village's design library and built by build_design.
 */
import type { Design } from './village';

export const DESIGN_LIMITS = { minSide: 3, maxSide: 15, maxLayers: 10 };

/** Block items a design may use; all place as ordinary blocks (no orientation needed except doors). */
export const DESIGN_BLOCKS = [
  'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'cobblestone', 'mossy_cobblestone',
  'stone_bricks', 'mossy_stone_bricks', 'bricks', 'smooth_stone', 'sandstone', 'terracotta', 'white_wool', 'glass',
  'oak_slab', 'stone_slab', 'cobblestone_slab', 'oak_fence', 'cobblestone_wall', 'bookshelf', 'glowstone', 'lantern',
  'crafting_table', 'furnace', 'chest', 'oak_door', 'dirt', 'grass_block', 'stone',
];

/**
 * Put the door where it belongs. Models reliably draw good buildings but often place the door a block inside the wall
 * or forget it, so rather than bouncing those back: move an inside door onto the nearest outer wall, or add one in the
 * middle of the south wall, and clear the block above it. Returns what was changed.
 */
function fixDoor(layers: string[][], palette: Record<string, string>, width: number, depth: number): string[] {
  if (layers.length < 3 || layers[1].length !== depth || layers[1].some((r) => r.length !== width)) return [];
  let door = Object.keys(palette).find((k) => palette[k] === 'oak_door');
  const grid = layers.map((l) => l.map((r) => r.split('')));
  const outer = (i: number, j: number) => j === 0 || j === depth - 1 || i === 0 || i === width - 1;
  const cells: Array<[number, number]> = [];
  if (door) for (let j = 0; j < depth; j++) for (let i = 0; i < width; i++) if (grid[1][j][i] === door) cells.push([i, j]);
  const fixes: string[] = [];
  let at = cells.find(([i, j]) => outer(i, j));
  if (!at && cells.length) {
    // Move the first inside door straight out to the nearest wall
    const [i, j] = cells[0];
    const options: Array<[number, [number, number], string]> = [
      [j, [i, 0], 'north'], [depth - 1 - j, [i, depth - 1], 'south'], [i, [0, j], 'west'], [width - 1 - i, [width - 1, j], 'east'],
    ];
    const [, target, side] = options.sort((a, b) => a[0] - b[0])[0];
    grid[1][j][i] = '.';
    at = target;
    fixes.push(`moved the door onto the ${side} wall`);
  }
  if (!at) {
    if (!door) {
      door = 'D' in palette ? '+' : 'D';
      palette[door] = 'oak_door';
    }
    at = [Math.floor(width / 2), depth - 1];
    fixes.push('added a door in the middle of the south wall');
  }
  const [i, j] = at;
  grid[1][j][i] = door!;
  if (grid[2][j][i] !== '.') {
    grid[2][j][i] = '.';
    if (!fixes.length) fixes.push('cleared the block above the door');
  }
  if (!fixes.length) return [];
  grid.forEach((l, li) => (layers[li] = l.map((r) => r.join(''))));
  return fixes;
}

/**
 * Check a design the model submitted; returns the cleaned design or the problems to send back to it.
 * isPlaceable comes from the world the design is for (WorldAdapter.isPlaceable).
 */
export function validateDesign(
  raw: Record<string, unknown>,
  by: string,
  opts: { isPlaceable: (block: string) => boolean; maxSide?: number; maxLayers?: number; requireDoor?: boolean },
): { design?: Design; errors: string[]; fixes?: string[] } {
  const maxLayers = opts.maxLayers ?? DESIGN_LIMITS.maxLayers;
  const requireDoor = opts.requireDoor ?? true;
  const errors: string[] = [];
  const name = String(raw.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_ -]/g, '').slice(0, 32);
  if (!name) errors.push('name is required');
  const description = String(raw.description ?? '').slice(0, 200);
  const palette: Record<string, string> = {};
  const rawPalette = (raw.palette ?? {}) as Record<string, unknown>;
  for (const [ch, block] of Object.entries(rawPalette)) {
    if (ch.length !== 1 || ch === '.' || ch === '_' || ch === ' ') errors.push(`palette key "${ch}" must be one character other than ".", "_" and space`);
    else if (typeof block !== 'string' || (block !== 'air' && !opts.isPlaceable(block))) errors.push(`palette "${ch}": "${String(block)}" is not a placeable block`);
    else palette[ch] = block;
  }
  // Rows may be spaced ("L P P L") or packed ("LPPL"); a row that has spaces is split on them
  const pack = (r: unknown) => {
    const t = String(r).trim();
    return /\s/.test(t) ? t.split(/\s+/).map((c) => (c.length === 1 ? c : '?')).join('') : t;
  };
  const layers = Array.isArray(raw.layers) ? (raw.layers as unknown[]).map((l) => (Array.isArray(l) ? l.map(pack) : [])) : [];
  if (!layers.length) errors.push('layers must be a non-empty list of layers, each a list of rows');
  if (layers.length > maxLayers) errors.push(`at most ${maxLayers} layers`);
  const minSide = DESIGN_LIMITS.minSide, maxSide = opts.maxSide ?? DESIGN_LIMITS.maxSide;
  const width = Math.floor(Number(raw.width)) || layers[0]?.[0]?.length || 0;
  const depth = Math.floor(Number(raw.depth)) || layers[0]?.length || 0;
  if (depth < minSide || depth > maxSide || width < minSide || width > maxSide) errors.push(`width and depth must be ${minSide} to ${maxSide} (got ${width}x${depth})`);
  const fixes = errors.length || !requireDoor ? [] : fixDoor(layers, palette, width, depth);
  let blocks = 0, doors = 0;
  const unknown = new Set<string>();
  layers.forEach((layer, li) => {
    if (layer.length !== depth) errors.push(`layer ${li} has ${layer.length} rows; depth is ${depth}`);
    layer.forEach((row, ri) => {
      if (row.length !== width) errors.push(`layer ${li} row ${ri} has ${row.length} symbols; width is ${width}: ${row.split('').join(' ')}`);
      for (let ci = 0; ci < row.length; ci++) {
        const ch = row[ci];
        if (ch === '.' || ch === '_') continue;
        if (!palette[ch]) unknown.add(ch);
        else if (palette[ch] !== 'air') {
          blocks++;
          const outer = ri === 0 || ri === depth - 1 || ci === 0 || ci === width - 1;
          if (palette[ch] === 'oak_door' && li === 1 && outer) doors++;
        }
      }
    });
  });
  if (unknown.size) errors.push(`symbols not in the palette (each cell must be one character): ${[...unknown].map((c) => `"${c}"`).join(', ')}`);
  if (!doors && requireDoor) errors.push('no door: put an oak_door character in layer 1 on the outer edge, with "." above it in layer 2 and outside it');
  if (errors.length) return { errors: errors.slice(0, 12) };
  return { design: { name, description, palette, layers, width, depth, height: layers.length, blocks, by }, errors: [], fixes };
}

export const DESIGN_SYSTEM = `You are an architect designing buildings for a Minecraft-like village. You draw a building as
horizontal layers from the ground up. Each layer is a list of rows from north to south; each row lists one symbol per
block from west to east, separated by single spaces. A palette maps each symbol (one character) to a block. Use "." for
air (empty space inside the building and doorways) and "_" to leave whatever is already there (e.g. outside an L-shaped
footprint).

Rules:
- First choose the size: width (symbols per row) and depth (rows per layer), 3 to 15 each, and state them. Every layer
  must have exactly depth rows and every row exactly width symbols; count them. At most 10 layers.
- Layer 0 is the floor, at ground level. Walls start at layer 1. The last layer or two are the roof.
- Leave the inside empty (".") so people can walk in, with at least 2 layers of headroom.
- Put exactly one oak_door symbol in layer 1 on the outer edge, with "." directly above it in layer 2.
- Add windows (glass) in the walls, usually in layer 2.
- Palette blocks must come from: ${DESIGN_BLOCKS.join(', ')}.
- Keep it buildable and tidy: symmetric shapes, clear corners (logs or stone make good corner posts), a roof that covers
  the whole top. Vary style and materials between designs to give the village character.

Example, a hut with width 5 and depth 5 (floor, two wall layers, roof):
palette {"C":"cobblestone","P":"oak_planks","L":"oak_log","G":"glass","D":"oak_door"}
layers [
 ["C C C C C","C C C C C","C C C C C","C C C C C","C C C C C"],
 ["L P P P L","P . . . P","P . . . P","P . . . P","L P D P L"],
 ["L P G P L","P . . . P","G . . . G","P . . . P","L P . P L"],
 ["P P P P P","P P P P P","P P P P P","P P P P P","P P P P P"]
]

Submit the design with the submit_design tool.`;

export const DESIGN_TOOL = {
  name: 'submit_design',
  description: 'Submit a building design.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Short name, e.g. "stone cottage".' },
      description: { type: 'string', description: 'One sentence describing the building.' },
      width: { type: 'integer', description: 'Symbols per row (west to east), 3 to 15.' },
      depth: { type: 'integer', description: 'Rows per layer (north to south), 3 to 15.' },
      palette: { type: 'object', description: 'Map of single characters to block ids.', additionalProperties: { type: 'string' } },
      layers: { type: 'array', description: 'Layers bottom-up; each is a list of depth rows, each row width symbols separated by spaces.', items: { type: 'array', items: { type: 'string' } } },
    },
    required: ['name', 'description', 'width', 'depth', 'palette', 'layers'],
  },
};
