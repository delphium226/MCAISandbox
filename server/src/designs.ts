/**
 * Model-designed buildings: a design is a stack of layers (bottom-up), each a list of rows (north to south) of
 * palette symbols (west to east). '.' is air and '_' leaves the existing block alone. Models write rows with the symbols
 * separated by spaces ("L P P P L"), which they count far more reliably than packed strings; rows are stored packed.
 * Designs are drawn by an LLM
 * (see tieredBrain's design_building), checked here, stored in the village's design library and built by build_design.
 */
import type { Design } from './village';

// 12 layers (10 before phase D): a gable over 11 rows takes floor, three wall layers, five steps and the ridge
export const DESIGN_LIMITS = { minSide: 3, maxSide: 15, maxLayers: 12 };

/** Block items a design may use; all place as ordinary blocks (no orientation needed except doors). */
export const DESIGN_BLOCKS = [
  'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'cobblestone', 'mossy_cobblestone',
  'stone_bricks', 'mossy_stone_bricks', 'bricks', 'smooth_stone', 'sandstone', 'terracotta', 'white_wool', 'glass',
  'oak_slab', 'stone_slab', 'cobblestone_slab', 'oak_fence', 'cobblestone_wall', 'bookshelf', 'glowstone', 'lantern',
  'crafting_table', 'furnace', 'chest', 'oak_door', 'dirt', 'grass_block', 'stone',
];

/**
 * What one survival design may cost (phase D, D.1), in raw blocks to gather (Materials.plan: logs, cobblestone, sand...)
 * and furnace runs, instead of the 9x9 cap of 09-28 (Accept5's ~750 blocks): a house up to HOUSE_UNITS, a landmark (a
 * hall, chapel, tower...: LANDMARK) up to LANDMARK_UNITS, and plan_layout lays out one building over HOUSE_UNITS a
 * village. A flat 7x7 cottage was ~108 units and a flat 9x9 hall ~213 (designbench, 10-04); a stair gable adds ~20-40.
 */
export const HOUSE_UNITS = 250;
export const LANDMARK_UNITS = 400;
export const MAX_SMELTS = 32;
const LANDMARK_WORDS = /(hall|chapel|church|temple|tower|market|inn|tavern|guildhall|keep|landmark|library|school)$/i;
/** Whether a design's name names a landmark: a word of it ends in hall, chapel, tower... ("meeting_hall", "watchtower"). */
export const isLandmark = (name: string) => name.split(/[\s_-]+/).some((w) => LANDMARK_WORDS.test(w));

/** A block's name without namespace and states. */
const baseOf = (block: string) => block.replace(/^minecraft:/, '').replace(/\[.*\]$/, '');

/** Whether a block is a door (of any wood; not a trapdoor). */
export const isDoor = (block: string) => /_door$/.test(baseOf(block));

const CLOCKWISE: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/**
 * A block with states turned clockwise (seen from above) `rot` quarter turns, as build_design turns a building:
 * facing north -> east -> south -> west, axis x <-> z on odd turns, a fence's or pane's sides with it, a sign's
 * rotation by 4 a turn. Stair shapes, halves and slab types stay; doors are left alone (build_design faces each door
 * out of its wall).
 */
export function turnState(block: string, rot: number): string {
  const m = /^([^[]+)\[(.*)\]$/.exec(block);
  const r = ((Math.round(rot) % 4) + 4) % 4;
  if (!m || !r || isDoor(block)) return block;
  const props = m[2].split(',').map((p) => {
    let [key, val] = p.split('=').map((t) => t.trim());
    for (let i = 0; i < r; i++) {
      if (key === 'facing' && CLOCKWISE[val]) val = CLOCKWISE[val];
      else if (key === 'axis' && (val === 'x' || val === 'z')) val = val === 'x' ? 'z' : 'x';
      else if (CLOCKWISE[key]) key = CLOCKWISE[key];
    }
    if (key === 'rotation' && /^\d+$/.test(val)) val = String((Number(val) + 4 * r) % 16);
    return `${key}=${val}`;
  });
  return `${m[1]}[${props.join(',')}]`;
}

/**
 * Put the door where it belongs. Models reliably draw good buildings but often place the door a block inside the wall
 * or forget it, so rather than bouncing those back: move an inside door onto the nearest outer wall, or add one in the
 * middle of the south wall, and clear the block above it. Returns what was changed.
 */
function fixDoor(layers: string[][], palette: Record<string, string>, width: number, depth: number): string[] {
  if (layers.length < 3 || layers[1].length !== depth || layers[1].some((r) => r.length !== width)) return [];
  let door = Object.keys(palette).find((k) => isDoor(palette[k]));
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
 * Layers as models actually send them, turned into a list of layers of row strings: some send the whole list as a JSON
 * string (at times without its outer brackets), rows as arrays of symbols (["L","P","L"]), or one flat list of rows
 * for all layers (split every `depth` rows).
 */
function normalizeLayers(raw: unknown, depth: number): string[][] {
  let v = raw;
  if (typeof v === 'string') {
    // Sometimes the layers come without their outer brackets: [[...]], [[...]]
    const text = v.trim().replace(/,\s*$/, '');
    try {
      v = JSON.parse(text);
    } catch {
      try {
        v = JSON.parse(`[${text}]`);
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(v)) return [];
  const row = (r: unknown): string | null => (typeof r === 'string' ? r : Array.isArray(r) && r.every((c) => typeof c === 'string') ? (r as string[]).join(' ') : null);
  // A flat list of rows (each a string, or an array of single symbols): one list for all layers
  const flat = v.every((r) => typeof r === 'string' || (Array.isArray(r) && r.every((c) => typeof c === 'string' && c.trim().length <= 1)));
  if (flat && v.length) {
    const rows = v.map(row).filter((r): r is string => r !== null);
    if (depth > 0 && rows.length > depth && rows.length % depth === 0) {
      const out: string[][] = [];
      for (let i = 0; i < rows.length; i += depth) out.push(rows.slice(i, i + depth));
      return out;
    }
    return [rows];
  }
  return v.map((l) => (Array.isArray(l) ? l.map(row).filter((r): r is string => r !== null) : []));
}

/**
 * Check a design the model submitted; returns the cleaned design or the problems to send back to it.
 * isPlaceable comes from the world the design is for (WorldAdapter.isPlaceable).
 */
export function validateDesign(
  raw: Record<string, unknown>,
  by: string,
  opts: {
    isPlaceable: (block: string) => boolean;
    maxSide?: number;
    maxLayers?: number;
    requireDoor?: boolean;
    /** The block list the architect was given (WorldAdapter.designBlocks): anything else is refused. */
    blocks?: string[];
    /** Whether block states ("oak_stairs[facing=north]") may be written. */
    states?: boolean;
  },
): { design?: Design; errors: string[]; fixes?: string[] } {
  const maxLayers = opts.maxLayers ?? DESIGN_LIMITS.maxLayers;
  const requireDoor = opts.requireDoor ?? true;
  const errors: string[] = [];
  const name = String(raw.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_ -]/g, '').slice(0, 32);
  if (!name) errors.push('name is required');
  const description = String(raw.description ?? '').slice(0, 200);
  const palette: Record<string, string> = {};
  const rawPalette = (raw.palette ?? {}) as Record<string, unknown>;
  for (const [ch, raw] of Object.entries(rawPalette)) {
    // No water in a building: a waterlogged stair or slab would let it run (the state is dropped)
    let block = typeof raw === 'string' ? raw.trim().replace(/^minecraft:/, '') : raw;
    if (typeof block === 'string' && /\[/.test(block)) {
      const props = (/\[(.*)\]$/.exec(block)?.[1] ?? '').split(',').map((p) => p.trim().replace(/\s*=\s*/, '=')).filter((p) => p && !/^waterlogged=/.test(p));
      block = props.length ? `${baseOf(block)}[${props.join(',')}]` : baseOf(block);
    }
    // "stone_brick" for stone_bricks (gpt-oss, 10-04): the listed name it means
    if (typeof block === 'string' && opts.blocks && !opts.blocks.includes(baseOf(block)) && opts.blocks.includes(`${baseOf(block)}s`)) block = block.replace(baseOf(block), `${baseOf(block)}s`);
    // "." or "_" given as air in the palette says what the symbols mean already
    if ((ch === '.' || ch === '_') && block === 'air') continue;
    if (ch.length !== 1 || ch === '.' || ch === '_' || ch === ' ') errors.push(`palette key "${ch}" must be one character other than ".", "_" and space`);
    else if (typeof block !== 'string') errors.push(`palette "${ch}": "${String(block)}" is not a placeable block`);
    else if (block === 'air') palette[ch] = block;
    else if (/\[/.test(block) && !opts.states) errors.push(`palette "${ch}": write "${baseOf(block)}" without a state in brackets`);
    else if (opts.blocks && !opts.blocks.includes(baseOf(block))) errors.push(`palette "${ch}": ${baseOf(block)} is not in the block list; use one of the listed blocks`);
    else if (/_slab\[.*type=double/.test(block)) errors.push(`palette "${ch}": a double slab is a full block: use ${baseOf(block).replace(/_slab$/, '')} (or the planks or bricks it is made of) instead`);
    else if (!opts.isPlaceable(block)) errors.push(`palette "${ch}": "${block}" is not a placeable block${/\[/.test(block) ? ' (check the state names and values)' : ''}`);
    else palette[ch] = block;
  }
  // Rows may be spaced ("L P P L") or packed ("LPPL"); a row that has spaces is split on them
  const pack = (r: unknown) => {
    const t = String(r).trim();
    return /\s/.test(t) ? t.split(/\s+/).map((c) => (c.length === 1 ? c : '?')).join('') : t;
  };
  const layers = normalizeLayers(raw.layers, Math.floor(Number(raw.depth)) || 0).map((l) => l.map(pack));
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
          if (isDoor(palette[ch]) && li === 1 && outer) doors++;
        }
      }
    });
  });
  if (unknown.size) errors.push(`symbols not in the palette (each cell must be one character): ${[...unknown].map((c) => `"${c}"`).join(', ')}`);
  if (!doors && requireDoor) errors.push('no door: put a door character (e.g. oak_door) in layer 1 on the outer edge, with "." above it in layer 2 and outside it');
  // The roof covers the inside: every open cell of layer 1 has a block somewhere above it (a stair roof copied from a
  // 5-deep example onto a 7-deep house left two rows open to the sky, 10-04)
  // (drawn buildings only: imported schematics may be open-topped)
  if (!errors.length && requireDoor && layers.length > 2) {
    const open: string[] = [];
    for (let j = 0; j < depth; j++)
      for (let i = 0; i < width; i++) {
        if (layers[1][j][i] !== '.') continue;
        let covered = false;
        for (let li = 2; li < layers.length && !covered; li++) {
          const ch = layers[li][j][i];
          covered = ch !== '.' && ch !== '_' && palette[ch] !== 'air';
        }
        if (!covered) open.push(`row ${j} column ${i}`);
      }
    // ...and the space under the roof stays empty: Minevale9's hall filled four roof layers with planks under its
    // stairs and topped them with cobblestone (~5 blocks a column, 253 to gather where a gable needs ~1-2 a column)
    // (counted above each column's highest open cell, so the floors of a taller building do not count, the review of D.1)
    let inside = 0, above = 0;
    const solid = (ch: string) => ch !== '.' && ch !== '_' && palette[ch] !== 'air';
    for (let j = 0; j < depth; j++)
      for (let i = 0; i < width; i++) {
        if (layers[1][j][i] !== '.') continue;
        inside++;
        let top = 1;
        for (let li = 2; li < layers.length; li++) if (!solid(layers[li][j][i])) top = li;
        for (let li = top + 1; li < layers.length; li++) if (solid(layers[li][j][i])) above++;
      }
    if (!open.length && inside && above / inside > 2.5) errors.push(`the roof is solid: ${above} blocks stand above the ${inside} inside cells (${(above / inside).toFixed(1)} a column); a roof needs one block a column (stairs on the slopes, the ridge on top) with the space under it left empty (".")`);
    if (open.length) errors.push(`the roof leaves ${open.length} cell${open.length > 1 ? 's' : ''} inside open to the sky (${open.slice(0, 4).join('; ')}${open.length > 4 ? '; ...' : ''}): every row needs roof above it, rising one layer per row from each side until the slopes meet at the ridge (draw open-air parts such as a porch with "_", not ".")`);
  }
  if (errors.length) return { errors: errors.slice(0, 12) };
  return { design: { name, description, palette, layers, width, depth, height: layers.length, blocks, by }, errors: [], fixes };
}

/** Architect's note in the survival economy. */
export const DESIGN_SURVIVAL = 'Materials are gathered by hand in survival: build from planks, logs, cobblestone, stone and sandstone and what is made of them (stairs, slabs, fences, fence gates, trapdoors, doors, walls, torches), with at most 4 glass and stone or stone bricks only as trim (they are smelted).';

/** How to write facing blocks, for a world that takes block states. */
const STATE_RULES = `
- Blocks that face a way take a state in the palette, one symbol per state. Stairs: "oak_stairs[facing=south]"; facing
  is the stair's tall back side, so on a roof it points uphill, toward the ridge (add half=top for upside-down stairs
  under eaves). Slabs: "oak_slab[type=bottom]" or "[type=top]". Logs laid on their side: "oak_log[axis=x]" (east-west)
  or "[axis=z]" (north-south). Trapdoors as shutters beside windows: "spruce_trapdoor[facing=north,half=top,open=true]".
  Fences, walls and panes join up by themselves; doors are turned by the builder.
- A pitched roof looks far better than a flat one: stairs on the slopes rising one layer per row from both sides until
  they meet, a ridge of planks or slabs on the middle row, the gable ends filled in with the wall material. A building
  7 deep has stairs on rows 0 and 6, then 1 and 5, then 2 and 4, and the ridge on row 3; one 9 deep needs a fourth step.
  The roof is a shell: leave the space under the stairs empty ("."), as in the example.`;

/** The example design: a gabled house where states are allowed, a flat-roofed hut where they are not. */
const GABLE_EXAMPLE = `Example, a house with width 7 and depth 7: floor, two wall layers, a gable roof of stairs rising from the north
and south walls to a plank ridge on the middle row, gable ends of planks:
palette {"C":"cobblestone","P":"oak_planks","L":"oak_log","G":"glass","D":"oak_door","N":"oak_stairs[facing=south]","S":"oak_stairs[facing=north]"}
layers [
 ["C C C C C C C","C C C C C C C","C C C C C C C","C C C C C C C","C C C C C C C","C C C C C C C","C C C C C C C"],
 ["L P P P P P L","P . . . . . P","P . . . . . P","P . . . . . P","P . . . . . P","P . . . . . P","L P P D P P L"],
 ["L P G P G P L","P . . . . . P","G . . . . . G","P . . . . . P","G . . . . . G","P . . . . . P","L P G . G P L"],
 ["N N N N N N N","P . . . . . P","P . . . . . P","P . . . . . P","P . . . . . P","P . . . . . P","S S S S S S S"],
 [". . . . . . .","N N N N N N N","P . . . . . P","P . . . . . P","P . . . . . P","S S S S S S S",". . . . . . ."],
 [". . . . . . .",". . . . . . .","N N N N N N N","P . . . . . P","S S S S S S S",". . . . . . .",". . . . . . ."],
 [". . . . . . .",". . . . . . .",". . . . . . .","P P P P P P P",". . . . . . .",". . . . . . .",". . . . . . ."]
]`;
const HUT_EXAMPLE = `Example, a hut with width 5 and depth 5 (floor, two wall layers, roof):
palette {"C":"cobblestone","P":"oak_planks","L":"oak_log","G":"glass","D":"oak_door"}
layers [
 ["C C C C C","C C C C C","C C C C C","C C C C C","C C C C C"],
 ["L P P P L","P . . . P","P . . . P","P . . . P","L P D P L"],
 ["L P G P L","P . . . P","G . . . G","P . . . P","L P . P L"],
 ["P P P P P","P P P P P","P P P P P","P P P P P","P P P P P"]
]`;

/** The architect's system prompt for a world's block list (WorldAdapter.designBlocks), with or without block states. */
export function designSystem(blocks: string[], states: boolean): string {
  return `You are an architect designing buildings for a Minecraft-like village. You draw a building as
horizontal layers from the ground up. Each layer is a list of rows from north to south; each row lists one symbol per
block from west to east, separated by single spaces. A palette maps each symbol (one character) to a block. Use "." for
air (empty space inside the building and doorways) and "_" to leave whatever is already there (e.g. outside an L-shaped
footprint).

Rules:
- First choose the size: width (symbols per row) and depth (rows per layer), 3 to 15 each, and state them. Every layer
  must have exactly depth rows and every row exactly width symbols; count them. At most ${DESIGN_LIMITS.maxLayers} layers.
- Layer 0 is the floor, at ground level. Walls start at layer 1. The last layers are the roof.
- Leave the inside empty (".") so people can walk in, with at least 2 layers of headroom.
- Put exactly one door symbol (e.g. oak_door) in layer 1 on the outer edge, with "." directly above it in layer 2.
- Add windows (glass) in the walls, usually in layer 2.
- Palette blocks must come from: ${blocks.join(', ')}.${states ? STATE_RULES : ''}
- Keep it buildable and tidy: symmetric shapes, clear corners (logs or stone make good corner posts), a roof that covers
  the whole top. Vary style and materials between designs to give the village character.

${states ? GABLE_EXAMPLE : HUT_EXAMPLE}

Submit the design with the submit_design tool.`;
}

/** The sandbox's prompt (no block states). */
export const DESIGN_SYSTEM = designSystem(DESIGN_BLOCKS, false);

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
