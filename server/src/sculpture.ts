/**
 * Sculptures (the talk build's small decorative works, 11-12): a statue, a fountain, an arch or a pillar a person asks the
 * Mayor for, written by the architect block by block (box() and block() in the program's sandbox, houseSandbox.ts) and
 * compiled here to a design grid, as houseProgram.ts compiles a house from its parts. A figure has no rooms, door or
 * roof: code sets it on a one-block plinth over its footprint and draws nothing else.
 *
 * The model names colours; code turns each into a block the survival economy gathers easily (mcMaterials' easy list):
 * white diorite, grey andesite or cobblestone, yellow sandstone, red and orange granite, brown the village's planks. Wool,
 * concrete, terracotta and the like are read as their colour (a "white_wool" chicken is built in diorite), with a note.
 *
 * Fitting: the box (V2_LIMITS: 11 across, 12 layers with the plinth) clips what is outside with a note; over the budget,
 * the hidden inside of the figure goes first (blocks no face shows), then stone and glass change to unsmelted blocks over
 * the furnace runs; still over, no design and the reason in words. World-free: the caller passes the bill.
 */
import type { Design } from './village';
import { V2_LIMITS, encode } from './buildingGen';
import { MAX_SMELTS } from './designs';
import type { ProgramBill } from './houseProgram';
import { rawSetting } from './settings';

/** The library's sculpture functions (houseSandbox.ts records them beside the house's). */
export const SCULPTURE_NAMES = ['block', 'box', 'plinth'];

const VANILLA_ALL = !/^(off|0|false|no)$/i.test(rawSetting('MC_VANILLA_ALL') ?? 'on');
/** Each colour's block (the village gathers its raw material easily; "wood" and "log" take the village's own wood). */
export const COLOUR_BLOCKS: Record<string, string> = {
  white: VANILLA_ALL ? 'diorite' : 'sandstone',
  light_gray: VANILLA_ALL ? 'andesite' : 'cobblestone',
  gray: 'cobblestone',
  dark_gray: 'cobblestone',
  black: 'cobblestone',
  stone: 'stone',
  stone_bricks: 'stone_bricks',
  yellow: 'sandstone',
  orange: VANILLA_ALL ? 'granite' : 'sandstone',
  red: VANILLA_ALL ? 'polished_granite' : 'sandstone',
  brown: 'oak_planks',
  wood: 'oak_planks',
  log: 'oak_log',
  glass: 'glass',
  wall: 'cobblestone_wall',
  fence: 'oak_fence',
};
/** Other words for the colours (and the closest easy colour for those the village cannot make). */
export const COLOUR_ALIAS: Record<string, string> = {
  grey: 'gray', light_grey: 'light_gray', silver: 'light_gray', dark_grey: 'dark_gray', cream: 'yellow', beige: 'yellow', tan: 'yellow',
  gold: 'yellow', golden: 'yellow', sand: 'yellow', pink: 'red', crimson: 'red', scarlet: 'red', rust: 'orange', copper: 'orange', amber: 'orange',
  planks: 'wood', wooden: 'wood', timber: 'wood', oak: 'wood', bark: 'log', cobblestone: 'gray', cobble: 'gray', diorite: 'white', andesite: 'light_gray',
  granite: 'orange', polished_granite: 'red', sandstone: 'yellow', stone_brick: 'stone_bricks', bricks: 'red', brick: 'red', quartz: 'white', snow: 'white',
  bone: 'white', ivory: 'white', iron: 'light_gray', fences: 'fence', walls: 'wall',
  // (no green, blue or purple block the village gathers easily: the nearest it has)
  green: 'wood', lime: 'wood', olive: 'wood', blue: 'glass', light_blue: 'glass', cyan: 'glass', purple: 'gray', magenta: 'red', violet: 'gray',
};
const EMPTY = /^(air|none|empty|nothing|clear|hole)$/;
const DYED = /^(.*?)_(wool|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|carpet|dye|candle|bed|banner|shulker_box)$/;
/** The plinth's materials. */
const PLINTH: Record<string, string> = { cobblestone: 'cobblestone', stone: 'stone', stone_bricks: 'stone_bricks', sandstone: 'sandstone', planks: 'oak_planks', wood: 'oak_planks', andesite: 'andesite', diorite: 'diorite' };

const word = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');

/** A colour (or block name) as the block built, or null for an empty cell; a note when it was read as something else. */
export function colourBlock(v: unknown, notes: string[]): string | null {
  const w = word(v);
  if (EMPTY.test(w)) return null;
  if (COLOUR_BLOCKS[w]) return COLOUR_BLOCKS[w];
  if (COLOUR_ALIAS[w]) return COLOUR_BLOCKS[COLOUR_ALIAS[w]];
  const dyed = DYED.exec(w);
  if (dyed) {
    const c = COLOUR_ALIAS[dyed[1]] ?? dyed[1];
    const b = COLOUR_BLOCKS[c] ?? (dyed[2].includes('glass') ? 'glass' : COLOUR_BLOCKS.white);
    notes.push(`${w} built in ${b} (the village gathers no ${dyed[2].replace(/_/g, ' ')})`);
    return b;
  }
  if (/(^|_)(planks|log|wood|stem)$/.test(w)) return /log|wood|stem/.test(w) ? COLOUR_BLOCKS.log : COLOUR_BLOCKS.wood;
  if (/(^|_)(stairs|slab)$/.test(w)) return colourBlock(w.replace(/_(stairs|slab)$/, ''), notes);
  notes.push(`colour "${String(v).slice(0, 30)}" is not one the village can build: grey cobblestone`);
  return COLOUR_BLOCKS.gray;
}

/** A figure as read from a program's calls: its cells (x, y, z from the program, y 0 on the plinth). */
export interface SculptSpec {
  cells: Map<string, string>;
  plinth: string | null;
  note: string;
}

const num = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
/** A call's arguments by name: positional, or one object of named fields. */
function argsOf(raw: unknown[], names: string[]): Record<string, unknown> {
  if (raw.length === 1 && raw[0] && typeof raw[0] === 'object' && !Array.isArray(raw[0])) return raw[0] as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  names.forEach((n, i) => (out[n] = raw[i]));
  return out;
}
/** Coordinates a program may write (wider than the box: what is outside it is clipped with a note, not looped over). */
const SPAN = 48;
const clampC = (n: number) => Math.max(-SPAN, Math.min(SPAN, n));

/** Whether a program's calls draw a figure (any block() or box()) rather than a house. */
export const isSculpture = (calls: Array<[string, ...unknown[]]>) => calls.some(([fn]) => fn === 'block' || fn === 'box');

/** MC_TALK_BIG (askedWork.ts): the colours with no easy block as concrete in their colour, resolved as any block. */
const BIG_COLOURS: Record<string, string> = {
  green: 'green_concrete', lime: 'lime_concrete', blue: 'blue_concrete', light_blue: 'light_blue_concrete', cyan: 'cyan_concrete', purple: 'purple_concrete',
  magenta: 'magenta_concrete', pink: 'pink_concrete', black: 'black_concrete', violet: 'purple_concrete', olive: 'green_concrete',
};
/** A word resolved as a real block (askedWork's resolver; undefined: not a block name). */
export type BlockResolver = (word: string) => { block: string | null; note?: string } | undefined;
/** MC_TALK_BIG: a block id as the resolver gives it (the nearest the village can get, with a note), a colour with no easy
 *  block as its concrete, else the colour's easy block. */
function bigBlock(v: unknown, notes: string[], resolve: BlockResolver): string | null {
  const w = word(v).replace(/\[.*$/, '');
  if (EMPTY.test(w)) return null;
  const r = resolve(w) ?? (BIG_COLOURS[w] ? resolve(BIG_COLOURS[w]) : undefined);
  if (r) {
    if (r.note) notes.push(r.note);
    return r.block;
  }
  return colourBlock(v, notes);
}

/** The box a figure is drawn in: across, layers with the plinth, furnace runs, and whether it is a big work (MC_TALK_BIG:
 *  glass is never unsmelted). */
export interface SculptLimits { side: number; up: number; smelts: number; big: boolean }
export const SMALL_LIMITS: SculptLimits = { side: V2_LIMITS.maxBox, up: V2_LIMITS.maxLayers, smelts: MAX_SMELTS, big: false };

/** The calls read into a figure: block() and box() in order (a later one over an earlier), plinth(), note(). With
 *  `resolve` (MC_TALK_BIG), blocks are named by id and resolved; notes said once. */
export function readSculpture(calls: Array<[string, ...unknown[]]>, notes: string[], resolve?: BlockResolver): SculptSpec {
  const said = notes.length;
  const blockOf = (v: unknown) => (resolve ? bigBlock(v, notes, resolve) : colourBlock(v, notes));
  const cells = new Map<string, string>();
  let plinth: string | null = 'cobblestone', note = '';
  const skipped = new Set<string>();
  const set = (x: number, y: number, z: number, b: string | null) => {
    const k = `${x},${y},${z}`;
    if (b) cells.set(k, b);
    else cells.delete(k);
  };
  for (const [fn, ...raw] of calls) {
    switch (fn) {
      case 'block': {
        const a = argsOf(raw, ['x', 'y', 'z', 'colour']);
        const x = num(a.x), y = num(a.y), z = num(a.z);
        if (x === null || y === null || z === null) {
          notes.push(`block(${raw.map((r) => JSON.stringify(r)).join(', ').slice(0, 40)}) has no x, y, z: skipped`);
          break;
        }
        set(clampC(x), clampC(y), clampC(z), blockOf(a.colour ?? a.color ?? a.material ?? a.block ?? 'gray'));
        break;
      }
      case 'box': {
        const a = argsOf(raw, ['x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'colour']);
        const c = [a.x1 ?? a.x, a.y1 ?? a.y, a.z1 ?? a.z, a.x2, a.y2, a.z2].map(num);
        if (c.some((n) => n === null)) {
          notes.push(`box(${raw.map((r) => JSON.stringify(r)).join(', ').slice(0, 50)}) needs x1, y1, z1, x2, y2, z2: skipped`);
          break;
        }
        const [x1, y1, z1, x2, y2, z2] = (c as number[]).map(clampC);
        const b = blockOf(a.colour ?? a.color ?? a.material ?? a.block ?? 'gray');
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
          for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
            for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) set(x, y, z, b);
        break;
      }
      case 'plinth': {
        const w = word(raw[0] ?? 'cobblestone');
        if (/^(none|no|false|off)$/.test(w)) plinth = null;
        else plinth = PLINTH[w] ?? PLINTH[w.replace(/s$/, '')] ?? (notes.push(`plinth "${w}" read as cobblestone`), 'cobblestone');
        break;
      }
      case 'note':
        note = String(raw[0] ?? '').slice(0, 300);
        break;
      default:
        if (!skipped.has(fn)) notes.push(`${fn}() is a house's part, not a figure's: ignored`);
        skipped.add(fn);
    }
  }
  if (resolve) notes.splice(said, notes.length - said, ...new Set(notes.slice(said)));
  return { cells, plinth, note };
}

/** A figure in a few words: "a 5x7 statue, 9 high, in diorite, polished granite and sandstone on a cobblestone plinth". */
export function sculptureWords(d: Design, what = 'figure', plinth = true): string {
  const count: Record<string, number> = {};
  d.layers.forEach((layer, li) => layer.forEach((row) => {
    for (const ch of row) if ((li > 0 || !plinth) && d.palette[ch]) count[d.palette[ch]] = (count[d.palette[ch]] ?? 0) + 1;
  }));
  const mats = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.replace(/_/g, ' '));
  const base = plinth ? d.palette[d.layers[0]?.[0]?.[0] ?? '.'] : undefined;
  const list = mats.length > 1 ? `${mats.slice(0, -1).join(', ')} and ${mats.at(-1)}` : mats[0] ?? 'stone';
  return `a ${d.width}x${d.depth} ${what}, ${d.height} high, in ${list}${base ? ` on a ${base.replace(/_/g, ' ')} plinth` : ''}`;
}

/** The figure drawn as a design grid: its cells' box (clipped to the limits), the plinth as layer 0, the figure above. */
export function compileSculpture(spec: SculptSpec, name: string, description = 'a sculpture', lim: SculptLimits = SMALL_LIMITS): { design: Design | null; notes: string[]; why?: string } {
  const notes: string[] = [];
  const pts = [...spec.cells.entries()].map(([k, b]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, b };
  });
  if (!pts.length) return { design: null, notes, why: 'the program drew no blocks' };
  const minOf = (k: 'x' | 'y' | 'z') => Math.min(...pts.map((p) => p[k]));
  const x0 = minOf('x'), y0 = minOf('y'), z0 = minOf('z');
  // (MC_TALK_BIG: a work drawn the full height has no plinth rather than its top layer cut: bigbench's towers and obelisks
  // drew y 0..29 or 0..30 in 7 of 8 samples; over 30 the rest is still clipped)
  const full = lim.big && !!spec.plinth && Math.max(...pts.map((p) => p.y)) - y0 + 1 >= lim.up;
  if (full) {
    notes.push(`no plinth: the work fills all ${lim.up} layers`);
    spec = { ...spec, plinth: null };
  }
  const maxSide = lim.side, maxUp = lim.up - (spec.plinth ? 1 : 0);
  const inBox = pts.filter((p) => p.x - x0 < maxSide && p.z - z0 < maxSide && p.y - y0 < maxUp);
  if (inBox.length < pts.length) notes.push(`${pts.length - inBox.length} blocks outside ${maxSide}x${maxSide} and ${maxUp} high left out`);
  if (y0 !== 0) notes.push(`the figure's lowest blocks at y=${y0} set on the plinth`);
  const W = Math.max(...inBox.map((p) => p.x - x0)) + 1, D = Math.max(...inBox.map((p) => p.z - z0)) + 1, H = Math.max(...inBox.map((p) => p.y - y0)) + 1;
  // (a plinth: the footprint's box at ground level, as a house's floor; a footprint thinner than 3 gets 3, so it stands)
  const base = spec.plinth ? 1 : 0;
  const Wd = Math.max(W, base ? Math.min(3, maxSide) : 1), Dd = Math.max(D, base ? Math.min(3, maxSide) : 1);
  const ox = Math.floor((Wd - W) / 2), oz = Math.floor((Dd - D) / 2);
  const grid: string[][][] = Array.from({ length: H + base }, () => Array.from({ length: Dd }, () => Array<string>(Wd).fill('.')));
  if (spec.plinth) for (const row of grid[0]) row.fill(spec.plinth);
  for (const p of inBox) grid[p.y - y0 + base][p.z - z0 + oz][p.x - x0 + ox] = p.b;
  const { palette, layers } = encode(grid);
  let blocks = 0;
  for (const l of layers) for (const r of l) for (const ch of r) if (ch !== '.' && ch !== '_') blocks++;
  return { design: { name, description, palette, layers, width: Wd, depth: Dd, height: H + base, blocks, by: 'program' }, notes };
}

/** Cells no face shows (all six neighbours filled, the plinth below counting): the first to go over the budget. */
function hollow(spec: SculptSpec): SculptSpec | null {
  const filled = (x: number, y: number, z: number) => spec.cells.has(`${x},${y},${z}`);
  const ys = [...spec.cells.keys()].map((k) => Number(k.split(',')[1]));
  const y0 = Math.min(...ys);
  const hidden = [...spec.cells.keys()].filter((k) => {
    const [x, y, z] = k.split(',').map(Number);
    const below = y - 1 < y0 ? !!spec.plinth : filled(x, y - 1, z);
    return below && filled(x, y + 1, z) && filled(x + 1, y, z) && filled(x - 1, y, z) && filled(x, y, z + 1) && filled(x, y, z - 1);
  });
  if (!hidden.length) return null;
  const cells = new Map(spec.cells);
  for (const k of hidden) cells.delete(k);
  return { ...spec, cells };
}
/** Smelted blocks swapped for unsmelted ones (stone and stone bricks to cobblestone, glass to white; a big work's glass
 *  is what was asked for and stays). */
function unsmelt(spec: SculptSpec, big = false): SculptSpec | null {
  const swap: Record<string, string> = { stone: 'cobblestone', stone_bricks: 'cobblestone', smooth_stone: 'cobblestone', ...(big ? {} : { glass: COLOUR_BLOCKS.white }) };
  if (![...spec.cells.values()].some((b) => swap[b]) && !(spec.plinth && swap[spec.plinth])) return null;
  return { ...spec, cells: new Map([...spec.cells].map(([k, b]) => [k, swap[b] ?? b])), plinth: spec.plinth && (swap[spec.plinth] ?? spec.plinth) };
}

/**
 * A figure drawn within the box, `budget` units and MAX_SMELTS: over the bill its hidden inside goes first, then the
 * smelted blocks; still over, no design and why in words. `problems` (the world's hard-to-gather check) is asked last.
 */
export function fitSculpture(spec: SculptSpec, budget: number, bill: ProgramBill & { problems?: (d: Design) => string[] } = {}, name = 'sculpture', description?: string, lim: SculptLimits = SMALL_LIMITS):
  { design: Design | null; cuts: string[]; notes: string[]; why?: string } {
  const cuts: string[] = [];
  let s = spec;
  for (let i = 0; i < 4; i++) {
    const c = compileSculpture(s, name, description, lim);
    if (!c.design) return { design: null, cuts, notes: c.notes, why: c.why };
    const units = bill.units?.(c.design) ?? 0, smelts = bill.smelts?.(c.design) ?? 0;
    const over = units > budget, smelty = smelts > lim.smelts;
    if (!over && !smelty) {
      const p = bill.problems?.(c.design) ?? [];
      if (p.length) return { design: null, cuts, notes: c.notes, why: `the village cannot get its materials: ${p.join('; ').slice(0, 160)}` };
      return { design: c.design, cuts, notes: c.notes };
    }
    const next = smelty ? unsmelt(s, lim.big) ?? hollow(s) : hollow(s) ?? unsmelt(s, lim.big);
    if (!next) return { design: null, cuts, notes: c.notes, why: over ? `it needs ${units} units of materials, over the ${budget} the village gives a requested work` : `it needs ${smelts} furnace runs, over ${lim.smelts}` };
    cuts.push(next.cells.size < s.cells.size ? 'hollow inside' : 'unsmelted stone');
    s = next;
  }
  return { design: null, cuts, notes: [], why: 'it would not fit after every cut' };
}

/** The sculpture functions as the architect sees them (talkDesign.ts' prompt). */
export const SCULPTURE_DOC = `For a statue, sculpture, fountain, arch, pillar, obelisk or any figure that is not a building, do not call body() or the
house's parts: draw it block by block with these instead:
box(x1, y1, z1, x2, y2, z2, colour)   fill every block from one corner to the other (both included)
block(x, y, z, colour)                one block; a later call over an earlier one replaces it, colour "air" empties it
plinth(material)                      the one-block base code sets under the figure: "cobblestone" (default), "stone_bricks",
                                      "sandstone", "stone", "planks" or "none"
note(text)                            one sentence: what the figure is
x runs left to right, z back to front (the front, highest z, faces the street: put a face or the front there), y up from 0
(standing on the plinth). The whole figure must fit 0..${V2_LIMITS.maxBox - 1} in x and z and 0..${V2_LIMITS.maxLayers - 2} in y.
Colours: ${Object.keys(COLOUR_BLOCKS).filter((c) => !['stone_bricks', 'wall', 'fence', 'log'].includes(c)).join(', ')}; also "stone_bricks", "log", "wall" (a thin
stone post), "fence" (a thin wooden post). There is no green, blue or purple, and no water or lava.
Make it readable from the street: big simple shapes with box() (a body, a head, legs, a base), then block() for the details
(eyes, a beak, a comb). A figure 5 to 9 blocks in its longest direction reads well. Each block costs one unit.
Example (a lamp post on a step): plinth("stone_bricks"); box(1,0,1,3,0,3,"gray"); box(2,1,2,2,5,2,"wall"); block(2,6,2,"glass"); note("A lamp post")`;

/** MC_TALK_BIG: the sculpture functions at full size, in real blocks (talkDesign.ts' prompt for a big request). */
export function sculptureDocBig(side: number, up: number): string {
  return `For a statue, sculpture, monument, pyramid, obelisk, tower, arch, wall, fountain, pillar or any work that is not an
ordinary house-like building (and for any building wider than 11 or in a special material), do not call body() or the
house's parts: draw it with these instead:
box(x1, y1, z1, x2, y2, z2, block)   fill every block from one corner to the other (both included)
block(x, y, z, block)                one block; a later call over an earlier one replaces it, "air" empties it
plinth(material)                     the one-block base code sets under the work: "cobblestone" (default), "stone_bricks",
                                     "sandstone", "stone", "planks" or "none"
note(text)                           one sentence: what the work is
x runs left to right, z back to front (the front, highest z, faces the street), y up from 0 (standing on the plinth). The
whole work must fit 0..${side - 1} in x and z and 0..${up - 2} in y: up to ${side}x${side}, ${up} high with its plinth.
block: a Minecraft block id in the material the person asked for: blue_stained_glass, red_wool, white_concrete,
orange_terracotta, terracotta, quartz_block, sandstone, smooth_stone, stone_bricks, polished_andesite, deepslate_bricks,
bricks, cut_copper, spruce_planks, glass... or a colour word (white, gray, red, yellow, orange, brown...) for plain stone in
that colour. Use the material the person named; code swaps what the village cannot get for the nearest it can and says so.
Build volumes with box(): a stepped pyramid is one box per step, a tower a box of walls and box(..., "air") inside it, a
wall one box. Loops are fine (for (let i = 0; i < 15; i++) box(...)); never loop block() over a whole volume. Most works
are 5 to 60 calls. Each block costs a unit; code hollows a solid work's hidden inside only when it is over the budget.
Make the size the person asked for ("30 blocks" wide or high means 30); with no size, make it big enough to read from the
street (10 to 20 blocks).
Example (a 9-wide stepped pyramid of sandstone with a glass top): plinth("none"); for (let i = 0; i < 4; i++) box(i, i, i, 8 - i, i, 8 - i, "sandstone"); block(4, 4, 4, "yellow_stained_glass"); note("A stepped pyramid")`;
}
