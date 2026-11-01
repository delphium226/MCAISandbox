/**
 * House programs (#175; brief runs/2026-10-29/planning/brief_houseprog.md): a member's house written by a model as a
 * short program against a small design library, compiled by code to the generator's design grid. The model says what
 * (a body, wings, a tower, a bay, a porch, the roof and the materials); each piece does its own geometry, as
 * buildingGen.ts v2 does for its fixed options (lessons 54-56): the walls are a union of rectangles, each part's roof is
 * its own height field (the highest wins; a part's overhang reaches only over open ground), every stair faces uphill,
 * the door stands in the front (south) wall with room before it, and over the box or the bill code cuts one thing at a
 * time and says so. World-free, like buildingGen.ts: the caller passes the bill.
 *
 * The program runs in houseSandbox.ts (node:vm, capped; in the world inside a worker thread with its own small heap): the
 * library there only records calls as JSON, which are read back and applied here, so nothing the program builds ever
 * reaches the server's scope.
 */
import type { Design } from './village';
import { V2_LIMITS, encode } from './buildingGen';
import { MAX_SMELTS } from './designs';
import { FAMILY } from './houseStyle';
import { runProgram, runProgramIsolated, type ProgramRun } from './houseSandbox';
import { dressDesign } from './dressing';

export { PROGRAM_LIMITS, WORKER_LIMITS, runProgram, runProgramIsolated, type ProgramRun } from './houseSandbox';

type Dir = 'north' | 'east' | 'south' | 'west';
const STEP: Record<Dir, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIRS: Dir[] = ['north', 'east', 'south', 'west'];
const OPPOSITE: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const AXIS = (d: Dir) => (d === 'north' || d === 'south' ? 'z' : 'x');

export type Side = 'front' | 'back' | 'left' | 'right';
export type Corner = 'front-left' | 'front-right' | 'back-left' | 'back-right';
type WallM = 'planks' | 'logs' | 'cobblestone' | 'stone_bricks' | 'sandstone';
type RoofM = 'planks' | 'cobblestone' | 'stone_bricks' | 'sandstone' | 'stone';
/** Front is the door's side (south in the design; the world turns it to face the street). */
const SIDE_DIR: Record<Side, Dir> = { front: 'south', back: 'north', left: 'west', right: 'east' };

/** What a program asks for, after the library's checks. */
export interface HouseSpec {
  body: { width: number; depth: number; storeys: 1 | 2 };
  wings: Array<{ side: Side; width: number; depth: number; at: 'start' | 'middle' | 'end' }>;
  towers: Array<{ corner: Corner; storeys: number }>;
  bays: Side[];
  roof: 'gable' | 'hip' | 'flat';
  roof_material: RoofM;
  walls: WallM;
  upper_walls?: WallM;
  base: 'none' | 'cobblestone' | 'stone_bricks' | 'sandstone';
  frame: 'none' | 'logs' | 'timber';
  windows: 'rhythm' | 'wide' | 'single' | 'none';
  glass: 'glass' | 'panes' | 'open';
  porch: boolean;
  chimney: false | 'left' | 'right';
  shutters: boolean;
  door_offset: number;
  overhang: 0 | 1;
  wood: string;
  note: string;
}

/** The library as the model sees it (the prompt's API section). */
export const LIBRARY_DOC = `Write JavaScript that calls these functions (nothing else exists: no DOM, no require). Front is the side with the door.
body(width, depth, storeys)    the main block's walls: width (left-right) and depth (front-back) 5 to 9, odd; storeys 1 or 2
wing(side, width, depth, at)   a one-storey wing on a side of the body: side "front"|"back"|"left"|"right"; width 3 to 7 along
                               that wall, odd, and narrower than the wall; depth 2 to 5 out from it; at "start"|"middle"|"end"
                               of the wall. Two wings at most. Two on one side, at start and end, make a U round a courtyard
                               3 wide (the body is made 9 along that side for it)
tower(corner, storeys)         a 3x3 tower at a corner of the body, rising above the roof: corner "front-left"|"front-right"|
                               "back-left"|"back-right"; storeys 1 or 2 above the roof. Its corner must be free of wings. On a
                               two-storey house the body gets a low roof (one step, a flat top) so the tower stands above it
bay(side)                      a glass bay window standing out from the body's wall on that side
porch()                        a covered porch on two posts before the door
chimney(side)                  a cobblestone chimney up the "left" or "right" wall
roof(shape, material)          "gable"|"hip"|"flat"; material "planks"|"cobblestone"|"stone_bricks"|"sandstone"|"stone"
walls(material, upper)         "planks"|"logs"|"cobblestone"|"stone_bricks"|"sandstone"; upper: the second storey's (optional)
base(material)                 a course of "cobblestone"|"stone_bricks"|"sandstone" under the walls, or "none"
frame(kind)                    "logs" (log corner posts and beams), "timber" (posts along the walls too) or "none"
windows(pattern, glass)        pattern "rhythm" (every other cell)|"wide" (three together)|"single"|"none"; glass "glass"|"panes"|"open"
shutters()                     trapdoor shutters beside the windows
door(offset)                   the door's place along the front wall: -1 (left), 0 (middle), 1 (right)
note(text)                     one sentence: why this house suits you (anything not in this list is not built)
Anything not called keeps the street's look. Code draws the walls, roof, stairs and door; the whole house must fit 11x11
blocks and 12 high, and over the budget code cuts the dearest parts first (towers, then second storeys, then wings), so
ask for what matters most to you.`;

const WALLS: WallM[] = ['planks', 'logs', 'cobblestone', 'stone_bricks', 'sandstone'];
const ROOFM: RoofM[] = ['planks', 'cobblestone', 'stone_bricks', 'sandstone', 'stone'];

/** The street's look as a starting spec: a plain 5x5 house in the family's materials. */
export function defaultSpec(familyName: string, wood?: string): HouseSpec {
  const f = FAMILY[familyName] ?? FAMILY.plains;
  return {
    body: { width: 5, depth: 5, storeys: 1 }, wings: [], towers: [], bays: [], roof: f.roof, roof_material: f.roof_material,
    walls: f.walls, base: f.base, frame: f.frame, windows: f.windows === 'none' ? 'none' : 'rhythm', glass: f.windows === 'none' ? 'open' : f.windows, porch: false, chimney: false,
    shutters: false, door_offset: 0, overhang: f.roof === 'flat' ? 0 : 1, wood: wood ?? f.wood, note: '',
  };
}

// ---------------------------------------------------------------------------------------------
// Reading a program's calls (plain JSON from the sandbox) into a spec, fixing what can be fixed with a note
// ---------------------------------------------------------------------------------------------

const word = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
const SIDE_ALIAS: Record<string, Side> = {
  front: 'front', south: 'front', street: 'front', back: 'back', rear: 'back', north: 'back', left: 'left', west: 'left',
  right: 'right', east: 'right',
};
function side(v: unknown, fallback: Side, notes: string[], what: string): Side {
  const s = SIDE_ALIAS[word(v)];
  if (v !== undefined && !s) notes.push(`${what} side "${String(v)}" read as ${fallback}`);
  return s ?? fallback;
}
function corner(v: unknown, notes: string[]): Corner {
  // ("north-west", "back_left", "NW", "front right")
  let s = word(v).replace(/_/g, '');
  if (/^[ns][ew]$/.test(s)) s = (s[0] === 'n' ? 'back' : 'front') + (s[1] === 'w' ? 'left' : 'right');
  const fb = /front|south/.test(s) ? 'front' : 'back';
  const lr = /left|west/.test(s) ? 'left' : /right|east/.test(s) ? 'right' : null;
  if (!lr) {
    if (v !== undefined) notes.push(`tower corner "${String(v)}" read as back-left`);
    return 'back-left';
  }
  return `${fb}-${lr}` as Corner;
}
const num = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};
function odd(n: number, lo: number, hi: number, what: string, notes: string[]): number {
  let s = Math.min(hi, Math.max(lo, n));
  if (s % 2 === 0) s = s - 1 >= lo ? s - 1 : s + 1;
  if (s !== n) notes.push(`${what} ${n} made ${s}${n % 2 === 0 && n >= lo && n <= hi ? ' (odd sizes keep the ridge and the door centred)' : ` (${lo} to ${hi})`}`);
  return s;
}
function material<T extends string>(v: unknown, list: readonly T[], what: string, notes: string[]): T | undefined {
  const s = word(v).replace(/_(stairs|slab|wall|block)s?$/, '');
  const alias: Record<string, string> = {
    wood: 'planks', plank: 'planks', oak_planks: 'planks', timber: 'planks', log: 'logs', oak_log: 'logs', stone_brick: 'stone_bricks',
    brick: 'stone_bricks', bricks: 'stone_bricks', cobble: 'cobblestone', sand: 'sandstone', thatch: 'planks', shingles: 'planks',
  };
  const wood = /_planks$|^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)$/.test(s) ? 'planks' : /_(log|wood)$/.test(s) ? 'logs' : undefined;
  const val = (list as readonly string[]).includes(s) ? s : alias[s] ?? wood;
  if (val && (list as readonly string[]).includes(val)) return val as T;
  notes.push(`${what} "${String(v)}" is not one of ${list.join(', ')}: kept the street's`);
  return undefined;
}
/** A call's arguments by name: positional, or one object of named fields. */
function argsOf(raw: unknown[], names: string[]): Record<string, unknown> {
  if (raw.length === 1 && raw[0] && typeof raw[0] === 'object' && !Array.isArray(raw[0])) return raw[0] as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  names.forEach((n, i) => (out[n] = raw[i]));
  return out;
}

/** The library's functions, applied to a spec; a call with nothing it can use is noted and skipped. */
export function applyCalls(calls: Array<[string, ...unknown[]]>, spec: HouseSpec, notes: string[]): HouseSpec {
  const s: HouseSpec = { ...spec, body: { ...spec.body }, wings: [...spec.wings], towers: [...spec.towers], bays: [...spec.bays] };
  let bodies = 0;
  for (const [fn, ...raw] of calls) {
    switch (fn) {
      case 'house': {
        // (an object of everything at once: read each field as its own call)
        const a = argsOf(raw, []);
        const sub: Array<[string, ...unknown[]]> = [];
        if (a.width !== undefined || a.depth !== undefined || a.storeys !== undefined) sub.push(['body', { width: a.width ?? s.body.width, depth: a.depth ?? s.body.depth, storeys: a.storeys ?? s.body.storeys }]);
        if (a.walls !== undefined) sub.push(['walls', a.walls, a.upper_walls]);
        if (a.roof !== undefined) sub.push(['roof', a.roof, a.roof_material]);
        if (a.base !== undefined) sub.push(['base', a.base]);
        if (a.frame !== undefined) sub.push(['frame', a.frame]);
        Object.assign(s, applyCalls(sub, s, notes));
        break;
      }
      case 'body': {
        const a = argsOf(raw, ['width', 'depth', 'storeys']);
        if (++bodies > 1) notes.push('body() called again: the last one counts');
        const st = num(a.storeys ?? a.floors, 1);
        if (st > 2) notes.push(`storeys ${st} made 2 (a tower goes higher)`);
        s.body = {
          width: odd(num(a.width, 5), 5, 9, 'body width', notes), depth: odd(num(a.depth, 5), 5, 9, 'body depth', notes),
          storeys: st >= 2 ? 2 : 1,
        };
        break;
      }
      case 'wing': {
        const a = argsOf(raw, ['side', 'width', 'depth', 'at']);
        if (s.wings.length >= 2) {
          notes.push('a third wing left out (two at most)');
          break;
        }
        const at = word(a.at ?? a.position);
        s.wings.push({
          side: side(a.side, 'front', notes, 'wing'), width: odd(num(a.width, 3), 3, 7, 'wing width', notes),
          depth: Math.min(5, Math.max(2, num(a.depth, 3))),
          at: /^(start|left|back|first|west|north|begin)/.test(at) ? 'start' : /^(end|right|front|last|east|south)/.test(at) ? 'end' : 'middle',
        });
        break;
      }
      case 'tower': {
        const a = argsOf(raw, ['corner', 'storeys']);
        if (s.towers.length >= 2) {
          notes.push('a third tower left out (two at most)');
          break;
        }
        s.towers.push({ corner: corner(a.corner, notes), storeys: Math.min(2, Math.max(1, num(a.storeys ?? a.height, 1))) });
        break;
      }
      case 'bay': {
        const b = side(argsOf(raw, ['side']).side, 'front', notes, 'bay');
        if (!s.bays.includes(b)) s.bays.push(b);
        break;
      }
      case 'porch': s.porch = true; break;
      case 'shutters': s.shutters = true; break;
      case 'chimney': {
        const v = word(argsOf(raw, ['side']).side);
        s.chimney = v === 'right' || v === 'east' ? 'right' : 'left';
        break;
      }
      case 'roof': {
        const a = argsOf(raw, ['shape', 'material']);
        const sh = word(a.shape ?? a.type);
        const shape = /gable|pitch|peak|a_frame|steep/.test(sh) ? 'gable' : /hip|pyramid|dome|cone|round/.test(sh) ? 'hip' : /flat|terrace|none/.test(sh) ? 'flat' : null;
        if (shape) {
          if (shape !== sh) notes.push(`roof "${String(a.shape)}" read as ${shape}`);
          s.roof = shape;
          s.overhang = shape === 'flat' ? 0 : 1;
        } else if (a.shape !== undefined) notes.push(`roof "${String(a.shape)}" is not gable, hip or flat: kept the street's`);
        const m = a.material !== undefined ? material(a.material, ROOFM, 'roof material', notes) : undefined;
        if (m) s.roof_material = m;
        break;
      }
      case 'walls': {
        const a = argsOf(raw, ['material', 'upper']);
        const m = material(a.material ?? a.walls, WALLS, 'walls', notes);
        if (m) s.walls = m;
        if (a.upper !== undefined && a.upper !== null) {
          const u = material(a.upper, WALLS, 'upper walls', notes);
          if (u) s.upper_walls = u;
        }
        break;
      }
      case 'base': {
        const v = word(argsOf(raw, ['material']).material);
        const m = v === 'none' || v === 'false' || v === '' ? 'none' : material(v, ['cobblestone', 'stone_bricks', 'sandstone'] as const, 'base', notes);
        if (m) s.base = m;
        break;
      }
      case 'frame': {
        const v = word(argsOf(raw, ['kind']).kind);
        s.frame = /timber|tudor|half/.test(v) ? 'timber' : /none|no|false/.test(v) ? 'none' : 'logs';
        break;
      }
      case 'windows': {
        const a = argsOf(raw, ['pattern', 'glass']);
        const p = word(a.pattern);
        s.windows = /wide|large|big|three|panor/.test(p) ? 'wide' : /single|few|small|one|narrow/.test(p) ? 'single' : /none|no/.test(p) ? 'none' : 'rhythm';
        const g = word(a.glass);
        if (g) s.glass = /pane/.test(g) ? 'panes' : /open|none|no/.test(g) ? 'open' : 'glass';
        break;
      }
      case 'door': s.door_offset = Math.max(-1, Math.min(1, num(argsOf(raw, ['offset']).offset, 0))); break;
      case 'note': s.note = String(raw[0] ?? '').slice(0, 200); break;
      default: notes.push(`${fn}() is not in the library: ignored`);
    }
  }
  // (two wings on one side make a U: the body's wall between them widened to 9, so the court between is 3 wide)
  for (const sd of ['front', 'back', 'left', 'right'] as Side[]) {
    if (s.wings.filter((x) => x.side === sd).length !== 2) continue;
    const key = sd === 'front' || sd === 'back' ? 'width' : 'depth';
    if (s.body[key] < 9) {
      notes.push(`the body made 9 ${key === 'width' ? 'wide' : 'deep'} for the courtyard between the ${sd} wings (was ${s.body[key]})`);
      s.body = { ...s.body, [key]: 9 };
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// The compiler: a spec to a design
// ---------------------------------------------------------------------------------------------

interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Part extends Rect {
  kind: 'body' | 'wing' | 'tower' | 'bay';
  /** The layer of the top course of its walls. */
  top: number;
  axis: 'x' | 'z';
  /** The side it joins the body on (wings and bays). */
  joined?: Dir;
  o: number;
  /** What its roof's height field covers: the walls, the overhang ring, and a wing's run into the body. */
  roof: Rect;
  /** The most its roof rises (a low roof: one step and a flat top), when set. */
  cap?: number;
}
const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const overlaps = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

function woodMat(m: string, wood: string): { block: string; stairs?: string; slab?: string } {
  if (m === 'planks') return { block: `${wood}_planks`, stairs: `${wood}_stairs`, slab: `${wood}_slab` };
  if (m === 'logs') return { block: `${wood}_log` };
  if (m === 'stone_bricks') return { block: 'stone_bricks', stairs: 'stone_brick_stairs', slab: 'stone_brick_slab' };
  return { block: m, stairs: `${m}_stairs`, slab: `${m}_slab` };
}

/** In words (the design's description and the bench's reading). */
export function describeSpec(s: HouseSpec): string {
  const b = s.body;
  const parts = [
    ...s.wings.map((w) => `a ${w.side} wing (${w.at})`), ...s.towers.map((t) => `a ${t.corner} tower`), ...s.bays.map((b) => `a ${b} bay window`),
    s.porch && 'a porch', s.chimney && 'a chimney', s.shutters && 'shutters',
  ].filter(Boolean) as string[];
  return `a ${b.width}x${b.depth} ${b.storeys === 2 ? 'two-storey' : 'one-storey'} ${s.walls.replace(/_/g, ' ')} house with a ${s.roof} ${s.roof_material.replace(/_/g, ' ')} roof${parts.length ? `, ${parts.join(', ')}` : ''}`;
}

/**
 * The member's memory note (#175: code writes it, from the house as built, never the program's own note, which claimed
 * pieces the library does not have): its form, what the cuts took, and what was asked and is not in the library. Under
 * 140 characters (NOTE_CHARS).
 */
export function programNote(built: HouseSpec, cuts: string[], unknown: string[], notes: string[] = []): string {
  const b = built.body;
  const pair = (['front', 'back', 'left', 'right'] as Side[]).find((sd) => built.wings.filter((w) => w.side === sd).length === 2);
  const parts = [
    pair ? 'two wings round a courtyard' : built.wings.length ? (built.wings.length === 2 ? 'two wings' : `a ${built.wings[0].side} wing`) : '',
    built.towers.length ? (built.towers.length === 2 ? 'two towers' : 'a tower') : '',
    built.bays.length ? (built.bays.length > 1 ? 'bay windows' : 'a bay window') : '',
    built.porch ? 'a porch' : '', built.chimney ? 'a chimney' : '',
  ].filter(Boolean);
  const walls = built.walls === 'planks' ? '' : `${built.walls.replace(/_/g, ' ')} `;
  const form = `a ${b.width}x${b.depth} ${b.storeys === 2 ? 'two-storey' : 'one-storey'} ${walls}house${parts.length ? ` with ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : ''}`;
  const lost = [...new Set(cuts.map((c) => c.replace(/ \(.*\)$/, '')).filter((c) => /^no (tower|wing|bay window|porch|chimney)|^one storey/.test(c)))];
  // (a part geometry left out: "the back-right tower left out: a wing or tower stands there")
  for (const n of notes) {
    const m = /^the .*?(tower|wing|bay window|porch|chimney).* left out/.exec(n);
    if (m && !lost.includes(`no ${m[1]}`)) lost.push(`no ${m[1]}`);
  }
  const missing = unknown.filter((u) => /^[a-z][a-z_]*$/i.test(u)).slice(0, 2).map((u) => `no ${u.replace(/_/g, ' ')}`);
  const tail = [...lost.map((c) => (c === 'one storey' ? 'one storey to fit' : c)), ...missing];
  const full = `I chose my house: ${form}${tail.length ? ` (${tail.join(', ')})` : ''}`;
  return full.length <= 138 ? full : `I chose my house: ${form}`.slice(0, 138);
}

/** Draw a spec as a Design; notes say what geometry left out or moved, and `drawn` is the spec without it. */
export function compileHouse(spec: HouseSpec, name = 'home_program', by = 'program'): { design: Design; notes: string[]; drawn: HouseSpec } {
  const notes: string[] = [];
  const drawn: HouseSpec = { ...spec, wings: [], towers: [], bays: [] };
  const flat = spec.roof === 'flat';
  const o = flat ? 0 : spec.overhang;
  const { width: w, depth: d, storeys } = spec.body;
  const bodyTop = storeys === 2 ? 7 : 3;
  const hasFB = spec.wings.some((x) => x.side === 'front' || x.side === 'back');
  const hasLR = spec.wings.some((x) => x.side === 'left' || x.side === 'right');
  const bodyAxis: 'x' | 'z' = hasFB ? 'x' : hasLR ? 'z' : w >= d ? 'x' : 'z';
  // (a tower on a two-storey house: under 12 layers it finds no room above a full pitch, so the body takes a low roof,
  // one step of stairs at the eaves and a flat top of slabs, and the tower stands two layers above it)
  const low = storeys === 2 && !flat && spec.towers.length > 0;
  const body: Part = { kind: 'body', x0: 0, x1: w - 1, z0: 0, z1: d - 1, top: bodyTop, axis: bodyAxis, o, roof: { x0: -o, x1: w - 1 + o, z0: -o, z1: d - 1 + o }, ...(low ? { cap: o } : {}) };
  const parts: Part[] = [body];

  // Wings: on a side of the body, one storey, their ridge across the wall they stand on; at the body's height their
  // roof runs into the body's to its ridge (a cross gable), lower it stops at the body's wall
  for (const wg of spec.wings) {
    const along = wg.side === 'front' || wg.side === 'back' ? w : d;
    // (two wings on one side, a U round a courtyard: narrowed so both stand with a cell between them)
    const pair = spec.wings.filter((x) => x.side === wg.side).length === 2;
    const half = Math.floor((along - 1) / 2);
    const cap = pair ? (half % 2 ? half : half - 1) : along - 2 - ((along - 2) % 2 === 0 ? 1 : 0);
    const ww = Math.min(wg.width, cap);
    if (ww !== wg.width) notes.push(`a ${wg.side} wing ${wg.width} wide made ${ww} (the body's wall is ${along})`);
    const start = wg.at === 'start' ? 0 : wg.at === 'end' ? along - ww : Math.floor((along - ww) / 2);
    const equal = bodyTop === 3;
    let r: Rect, roof: Rect, joined: Dir, axis: 'x' | 'z';
    if (wg.side === 'front') {
      r = { x0: start, x1: start + ww - 1, z0: d, z1: d + wg.depth - 1 };
      roof = { x0: r.x0 - o, x1: r.x1 + o, z0: equal ? Math.floor((d - 1) / 2) : d - 1, z1: r.z1 + o };
      joined = 'north'; axis = 'z';
    } else if (wg.side === 'back') {
      r = { x0: start, x1: start + ww - 1, z0: -wg.depth, z1: -1 };
      roof = { x0: r.x0 - o, x1: r.x1 + o, z0: r.z0 - o, z1: equal ? Math.ceil((d - 1) / 2) : 0 };
      joined = 'south'; axis = 'z';
    } else if (wg.side === 'left') {
      r = { x0: -wg.depth, x1: -1, z0: start, z1: start + ww - 1 };
      roof = { x0: r.x0 - o, x1: equal ? Math.ceil((w - 1) / 2) : 0, z0: r.z0 - o, z1: r.z1 + o };
      joined = 'east'; axis = 'x';
    } else {
      r = { x0: w, x1: w + wg.depth - 1, z0: start, z1: start + ww - 1 };
      roof = { x0: equal ? Math.floor((w - 1) / 2) : w - 1, x1: r.x1 + o, z0: r.z0 - o, z1: r.z1 + o };
      joined = 'west'; axis = 'x';
    }
    if (parts.some((p) => p.kind === 'wing' && overlaps(p, { x0: r.x0 - 1, x1: r.x1 + 1, z0: r.z0 - 1, z1: r.z1 + 1 }))) {
      notes.push(`the ${wg.side} wing (${wg.at}) left out: it would touch the other wing`);
      continue;
    }
    parts.push({ kind: 'wing', ...r, top: 3, axis, joined, o, roof });
    drawn.wings.push(wg);
  }

  // Towers: 3x3, centred on a corner of the body (a cell out past each wall), above the body's ridge
  const R0 = roofField(parts);
  let ridge = 0;
  for (const v of R0.values()) ridge = Math.max(ridge, v.layer);
  for (const t of spec.towers) {
    const cx = t.corner.endsWith('left') ? 0 : w - 1, cz = t.corner.startsWith('back') ? 0 : d - 1;
    const r = { x0: cx - 1, x1: cx + 1, z0: cz - 1, z1: cz + 1 };
    // (two layers over the ridge, three more a storey asked for, as far as the layers allow)
    const top = Math.min(V2_LIMITS.maxLayers - 3, Math.max(ridge + 2 + (t.storeys - 1) * 3, bodyTop + 3));
    if (parts.some((p) => p.kind !== 'body' && overlaps(p, { x0: r.x0 - 1, x1: r.x1 + 1, z0: r.z0 - 1, z1: r.z1 + 1 }))) {
      notes.push(`the ${t.corner} tower left out: a wing or tower stands there`);
      continue;
    }
    if (top < ridge + 1) {
      notes.push(`the ${t.corner} tower left out: no room above this roof (${V2_LIMITS.maxLayers} layers)`);
      continue;
    }
    parts.push({ kind: 'tower', ...r, top, axis: 'x', o: 0, roof: r });
    drawn.towers.push(t);
  }
  if (low && drawn.towers.length) notes.push('a low roof on the two-storey body, so the tower stands above it');

  // The door: the front wall, a wing's front when a wing stands in the middle of it, with two free cells before it
  const union1 = (x: number, z: number) => parts.some((p) => inRect(p, x, z));
  const frontWing = parts.find((p) => p.kind === 'wing' && p.joined === 'north' && spec.wings.find((x) => x.side === 'front')?.at === 'middle');
  const pref: [number, number] = frontWing ? [Math.floor((frontWing.x0 + frontWing.x1) / 2), frontWing.z1] : [(w - 1) / 2 + spec.door_offset, d - 1];
  let door: [number, number] | null = null;
  let best = Infinity;
  for (const p of parts)
    for (let x = p.x0; x <= p.x1; x++) {
      const z = p.z1;
      // (two free cells before it, walls on both sides along the face: never a corner)
      if (!union1(x, z) || union1(x, z + 1) || union1(x, z + 2) || !union1(x - 1, z) || !union1(x + 1, z)) continue;
      if (parts.some((q) => q.kind === 'tower' && inRect(q, x, z))) continue;
      // (a porch's two posts need the cells beside the door's way out too)
      const porchRoom = !spec.porch || [x - 1, x + 1].every((px) => !union1(px, z + 1) && !union1(px, z + 2));
      const score = Math.abs(x - pref[0]) + 2 * Math.abs(z - pref[1]) + (porchRoom ? 0 : 10);
      if (score < best) [best, door] = [score, [x, z]];
    }
  if (!door) {
    // (cannot happen with a body of 5: its front middle is always free; kept so a bad spec draws rather than throws)
    door = [(w - 1) / 2, d - 1];
    notes.push('no free front wall for the door: drawn in the middle of the body\'s');
  }
  const [doorX, doorZ] = door;

  // Bays: 3 cells along a wall, one out, off the corners, the door and the porch
  const baySides = [...spec.bays];
  for (let bi = 0; bi < baySides.length; bi++) {
    const b = baySides[bi];
    const dir = SIDE_DIR[b];
    const alongX = dir === 'north' || dir === 'south';
    const len = alongX ? w : d;
    const fixed = dir === 'north' ? -1 : dir === 'south' ? d : dir === 'west' ? -1 : w;
    const mid = Math.floor((len - 3) / 2);
    // (off the corners on a side; on the front it may reach a corner, to stand beside the door)
    const lo = dir === 'south' ? 0 : 1, hi = dir === 'south' ? len - 1 : len - 2;
    const tries = [mid, mid + 2, mid - 2, mid + 1, mid - 1, mid + 3, mid - 3].filter((a) => a >= lo && a + 2 <= hi);
    let placed = false;
    for (const a of tries) {
      const r: Rect = alongX ? { x0: a, x1: a + 2, z0: fixed, z1: fixed } : { x0: fixed, x1: fixed, z0: a, z1: a + 2 };
      if (parts.some((p) => p.kind !== 'body' && overlaps(p, { x0: r.x0 - 1, x1: r.x1 + 1, z0: r.z0 - 1, z1: r.z1 + 1 }))) continue;
      if (dir === 'south' && doorZ === d - 1 && r.x0 <= doorX + (spec.porch ? 1 : 0) && r.x1 >= doorX - (spec.porch ? 1 : 0)) continue;
      if (dir === 'south' && doorZ !== d - 1) continue;
      parts.push({ kind: 'bay', ...r, top: 2, axis: alongX ? 'x' : 'z', joined: OPPOSITE[dir], o: 0, roof: r });
      placed = true;
      drawn.bays.push(b);
      break;
    }
    if (!placed) {
      // (a front bay crowded out by the door and porch goes to a free side wall instead)
      const other = dir === 'south' ? (['left', 'right', 'back'] as Side[]).find((x) => !baySides.includes(x)) : undefined;
      if (other) {
        baySides.push(other);
        notes.push(`the front bay window moved to the ${other} wall: no room beside the door`);
      } else notes.push(`the ${b} bay window left out: no room on that wall`);
    }
  }

  // ---- the shape in layers
  const inU = (l: number, x: number, z: number) => parts.some((p) => p.top >= l && inRect(p, x, z));
  const T = (x: number, z: number) => parts.reduce((t, p) => (inRect(p, x, z) ? Math.max(t, p.top) : t), -1);
  const wallAt = (l: number, x: number, z: number) => {
    if (!inU(l, x, z)) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && !inU(l, x + dx, z + dz)) return true;
    return false;
  };
  const outward = (l: number, x: number, z: number) => DIRS.filter((dir) => !inU(l, x + STEP[dir][0], z + STEP[dir][1]));
  const R = roofField(parts);
  const roofAt = (x: number, z: number) => R.get(`${x},${z}`)?.layer ?? -1;

  // The chimney: up a side wall of the body one cell from the back corner, off towers and wings
  let chimney: [number, number] | null = null;
  if (spec.chimney) {
    for (const sd of spec.chimney === 'right' ? ['right', 'left'] : ['left', 'right']) {
      const c: [number, number] = [sd === 'left' ? 0 : w - 1, 1];
      const out = outward(1, c[0], c[1]);
      if (out.length === 1 && out[0] === (sd === 'left' ? 'west' : 'east') && !parts.some((p) => p.kind === 'tower' && inRect(p, c[0], c[1]))) {
        chimney = c;
        break;
      }
    }
    if (!chimney) {
      notes.push('the chimney left out: no free side wall');
      drawn.chimney = false;
    }
  }
  // The ladder up to a second storey: in a corner of the body against a wall that stands from the ground to the floor
  let ladder: [number, number, Dir] | null = null;
  if (storeys === 2) {
    const tries: Array<[number, number, Dir]> = [[1, 1, 'south'], [w - 2, 1, 'south'], [1, d - 2, 'north'], [w - 2, d - 2, 'north']];
    ladder = tries.find(([x, z, f]) => {
      const bx = x - STEP[f][0], bz = z - STEP[f][1];
      return !wallAt(1, x, z) && [1, 2, 3, 4].every((l) => wallAt(l, bx, bz)) && !(chimney && bx === chimney[0] && bz === chimney[1]) && !(bx === doorX && bz === doorZ);
    }) ?? null;
    if (!ladder) notes.push('no wall for a ladder: the second storey has none');
  }
  const ladderBack = ladder ? [ladder[0] - STEP[ladder[2]][0], ladder[1] - STEP[ladder[2]][1]] : null;

  // ---- bounds and grid
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (x: number, z: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  };
  for (const p of parts) grow(p.x0, p.z0), grow(p.x1, p.z1);
  for (const k of R.keys()) {
    const [x, z] = k.split(',').map(Number);
    grow(x, z);
  }
  const porchCells: Array<[number, number]> = [];
  let porch = spec.porch;
  if (porch) {
    for (let z = doorZ + 1; z <= doorZ + 2; z++) for (let x = doorX - 1; x <= doorX + 1; x++) porchCells.push([x, z]);
    if (porchCells.some(([x, z]) => union1(x, z))) {
      notes.push('the porch left out: no room before the door');
      porch = false;
      drawn.porch = false;
      porchCells.length = 0;
    }
    for (const [x, z] of porchCells) grow(x, z);
  }
  let height = 0;
  for (const v of R.values()) height = Math.max(height, v.layer + (flat ? 2 : 1));
  if (chimney) height = Math.max(height, roofAt(chimney[0], chimney[1]) + 3);
  const W = maxX - minX + 1, D = maxZ - minZ + 1;
  const grid: string[][][] = Array.from({ length: height }, () => Array.from({ length: D }, () => Array<string>(W).fill('.')));
  const set = (l: number, x: number, z: number, b: string) => {
    if (l >= 0 && l < height) grid[l][z - minZ][x - minX] = b;
  };
  const get = (l: number, x: number, z: number) => (l >= 0 && l < height && z >= minZ && z <= maxZ && x >= minX && x <= maxX ? grid[l][z - minZ][x - minX] : '#');

  const wood = spec.wood;
  const log = `${wood}_log`;
  const roofM = woodMat(spec.roof_material, wood);
  const wallsOf = (l: number, x: number, z: number) => (storeys === 2 && l > 3 && l <= 7 && inRect(body, x, z) ? spec.upper_walls ?? spec.walls : spec.walls);
  const bayAt = (x: number, z: number) => parts.some((p) => p.kind === 'bay' && inRect(p, x, z));
  const towerAt = (x: number, z: number) => parts.find((p) => p.kind === 'tower' && inRect(p, x, z));

  // Windows: runs of each face (one way out) at each window layer, the pattern along each run
  const winLayers = [2, ...(storeys === 2 ? [5] : []), ...parts.filter((p) => p.kind === 'tower').map((p) => p.top - 1)];
  const windowCells = new Set<string>();
  const posts = new Set<string>();
  const key = (l: number, x: number, z: number) => `${l},${x},${z}`;
  const runsAt = (l: number) => {
    const runs: Array<Array<[number, number]>> = [];
    for (const dir of DIRS) {
      const alongX = AXIS(dir) === 'z';
      for (let a = alongX ? minZ : minX; a <= (alongX ? maxZ : maxX); a++) {
        let cur: Array<[number, number]> = [];
        for (let b = alongX ? minX : minZ; b <= (alongX ? maxX : maxZ) + 1; b++) {
          const [x, z] = alongX ? [b, a] : [a, b];
          const ok = wallAt(l, x, z) && !bayAt(x, z) && (() => {
            const out = outward(l, x, z);
            return out.length === 1 && out[0] === dir;
          })();
          if (ok) cur.push([x, z]);
          else {
            if (cur.length) runs.push(cur);
            cur = [];
          }
        }
      }
    }
    return runs;
  };
  for (const l of winLayers) {
    // (a tower's own layer, above the body's walls: one window a face)
    const tower = l > bodyTop;
    for (const run of runsAt(l)) {
      const L = run.length, mid = (L - 1) / 2;
      const pick = (p: number) => {
        if (tower) return Math.abs(p - mid) < 0.6;
        if (spec.windows === 'single') return L < 5 ? Math.abs(p - mid) < 0.6 : p === Math.round(mid - L / 4) || p === Math.round(mid + L / 4);
        if (spec.windows === 'wide') return L >= 5 ? Math.abs(p - mid) <= 1 : Math.abs(p - mid) < 0.6;
        if (L > 5 && (p === 0 || p === L - 1)) return false;
        return Number.isInteger(mid) ? Math.abs(p - mid) % 2 === 0 : Math.abs(p - mid) % 2 === 0.5;
      };
      run.forEach(([x, z], p) => {
        if (spec.windows === 'none' || !pick(p)) return;
        if (x === doorX && z === doorZ) return;
        if (chimney && x === chimney[0] && z === chimney[1]) return;
        if (ladderBack && x === ladderBack[0] && z === ladderBack[1]) return;
        windowCells.add(key(l, x, z));
      });
    }
  }
  if (spec.frame === 'timber') for (const run of runsAt(1)) run.forEach(([x, z], p) => {
    if (run.length >= 5 && (p + 1) % 3 === 0 && p !== run.length - 1) posts.add(`${x},${z}`);
  });
  for (const k of windowCells) posts.delete(k.split(',').slice(1).join(','));
  const windowBlock = spec.glass === 'glass' ? 'glass' : spec.glass === 'panes' ? 'glass_pane' : '.';

  // ---- walls, floors, gable ends
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++) {
      const rl = roofAt(x, z);
      if (!union1(x, z)) {
        // (open ground, under eaves or not: left as it is up to the eaves, the ground and the layer above at least)
        for (let l = 0; l < Math.max(rl, 2); l++) set(l, x, z, '_');
        continue;
      }
      const t = T(x, z);
      const outer = wallAt(1, x, z);
      const foundation = woodMat(spec.base === 'none' ? spec.walls : spec.base, wood).block;
      set(0, x, z, outer ? foundation : '_');
      const beamTops = [3, bodyTop, t];
      for (let l = 1; l <= t; l++) {
        if (!wallAt(l, x, z)) {
          if (storeys === 2 && l === 4 && inRect(body, x, z)) set(l, x, z, ladder && x === ladder[0] && z === ladder[1] ? `ladder[facing=${ladder[2]}]` : `${wood}_planks`);
          continue;
        }
        const out = outward(l, x, z);
        const isCorner = out.length === 0 || (out.length >= 2 && AXIS(out[0]) !== AXIS(out[1]));
        const beamAxis = out.length === 1 ? (AXIS(out[0]) === 'z' ? 'x' : 'z') : undefined;
        let b = woodMat(wallsOf(l, x, z), wood).block;
        if (bayAt(x, z)) b = l === 1 ? woodMat(spec.base === 'none' ? spec.walls : spec.base, wood).block : spec.glass === 'glass' ? 'glass' : 'glass_pane';
        else if (spec.frame !== 'none' && isCorner) b = log;
        else if (spec.frame === 'timber' && posts.has(`${x},${z}`)) b = log;
        else if (spec.frame !== 'none' && beamTops.includes(l) && beamAxis) b = `${log}[axis=${beamAxis}]`;
        else if (l === 1 && spec.base !== 'none') b = woodMat(spec.base, wood).block;
        else if (windowCells.has(key(l, x, z))) b = windowBlock;
        set(l, x, z, b);
      }
      if (wallAt(t, x, z)) for (let l = t + 1; l < rl; l++) set(l, x, z, woodMat(wallsOf(t, x, z), wood).block);
    }
  set(1, doorX, doorZ, `${wood}_door`);
  set(2, doorX, doorZ, '.');
  if (ladder) for (let l = 1; l <= 3; l++) set(l, ladder[0], ladder[1], `ladder[facing=${ladder[2]}]`);

  // ---- the roof
  for (const [k, v] of R) {
    const [x, z] = k.split(',').map(Number);
    if (flat) {
      if (union1(x, z) && wallAt(T(x, z), x, z)) {
        set(v.layer, x, z, spec.frame !== 'none' && outward(T(x, z), x, z).length !== 1 ? log : woodMat(wallsOf(T(x, z), x, z), wood).block);
        set(v.layer + 1, x, z, `${roofM.slab}[type=bottom]`);
      } else set(v.layer, x, z, roofM.block);
    } else if (v.part.kind === 'bay') set(v.layer, x, z, `${roofM.stairs}[facing=${v.part.joined},half=bottom]`);
    else set(v.layer, x, z, roofBlock(x, z, v.layer));
  }
  function roofBlock(x: number, z: number, h: number): string {
    const near = (dir: Dir) => roofAt(x + STEP[dir][0], z + STEP[dir][1]);
    const up = DIRS.filter((dir) => near(dir) === h + 1);
    if (up.length) return `${roofM.stairs}[facing=${up[0]},half=bottom]`;
    const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]].find(([sx, sz]) => roofAt(x + sx, z + sz) === h + 1);
    if (diagonal) return `${roofM.stairs}[facing=${diagonal[1] > 0 ? 'south' : 'north'},half=bottom]`;
    const lower = DIRS.filter((dir) => near(dir) < h);
    if (lower.length === 1) return `${roofM.stairs}[facing=${OPPOSITE[lower[0]]},half=bottom]`;
    return `${roofM.slab}[type=bottom]`;
  }

  // ---- the porch, the chimney, shutters
  if (porch) {
    const pz = doorZ + 2;
    for (const px of [doorX - 1, doorX + 1]) for (let l = 1; l < 3; l++) set(l, px, pz, `${wood}_fence`);
    for (const [x, z] of porchCells) {
      const c = get(3, x, z);
      if (c === '.' || c === '_') set(3, x, z, `${roofM.slab}[type=bottom]`);
      for (let l = 0; l < 3; l++) if (get(l, x, z) === '.') set(l, x, z, '_');
    }
  }
  if (chimney) {
    const [cx, cz] = chimney;
    const rl = roofAt(cx, cz);
    for (let l = 1; l <= rl + 1; l++) set(l, cx, cz, 'cobblestone');
    set(rl + 2, cx, cz, 'cobblestone_wall');
  }
  if (spec.shutters && spec.windows !== 'none')
    for (const run of runsAt(2)) {
      run.forEach(([x, z], p) => {
        if (windowCells.has(key(2, x, z)) || (x === doorX && z === doorZ)) return;
        if (![run[p - 1], run[p + 1]].some((c) => c && windowCells.has(key(2, c[0], c[1])))) return;
        const dir = outward(2, x, z)[0];
        const ox = x + STEP[dir][0], oz = z + STEP[dir][1];
        if (union1(ox, oz) || ox < minX || ox > maxX || oz < minZ || oz > maxZ) return;
        const c = get(2, ox, oz);
        if (c !== '_' && c !== '.') return;
        set(2, ox, oz, `${wood}_trapdoor[facing=${dir},half=bottom,open=true]`);
      });
    }
  // (a window whose outside cell is a block, a tower's window onto the body's roof, stays wall)
  for (const k of windowCells) {
    const [l, x, z] = k.split(',').map(Number);
    const dir = outward(l, x, z)[0];
    const c = get(l, x + STEP[dir][0], z + STEP[dir][1]);
    if (c !== '.' && c !== '_' && c !== '#' && !/trapdoor/.test(c)) set(l, x, z, woodMat(wallsOf(l, x, z), wood).block);
  }

  const { palette, layers } = encode(grid);
  const blocks = layers.flat().reduce((s, row) => s + [...row].filter((c) => c !== '.' && c !== '_').length, 0);
  // (MC_DRESSING: the walls dressed lightly, dressing.ts)
  return { design: dressDesign({ name, description: describeSpec(drawn), palette, layers, width: W, depth: D, height, blocks, by }), notes, drawn };

  /** Each cell's roof layer: the highest of the parts' height fields that may reach it (its own walls, open ground, or a
   *  wing's run into the body). */
  function roofField(ps: Part[]): Map<string, { layer: number; part: Part }> {
    const out = new Map<string, { layer: number; part: Part }>();
    const inAny = (x: number, z: number) => ps.some((p) => inRect(p, x, z));
    for (const p of ps)
      for (let z = p.roof.z0; z <= p.roof.z1; z++)
        for (let x = p.roof.x0; x <= p.roof.x1; x++) {
          if (!inRect(p, x, z) && inAny(x, z) && !(p.kind === 'wing' && inRect(body, x, z))) continue;
          const h = heightOf(p, x, z);
          const layer = p.top + 1 + h - p.o;
          const k = `${x},${z}`;
          const cur = out.get(k);
          if (!cur || layer > cur.layer) out.set(k, { layer, part: p });
        }
    return out;
  }
  function heightOf(p: Part, x: number, z: number): number {
    if (flat || p.kind === 'bay') return 0;
    const r = p.roof;
    const across = p.axis === 'x' ? Math.min(z - r.z0, r.z1 - z) : Math.min(x - r.x0, r.x1 - x);
    if (spec.roof !== 'hip' && p.kind !== 'tower') return Math.min(across, p.cap ?? Infinity);
    const along = p.joined === 'north' ? r.z1 - z : p.joined === 'south' ? z - r.z0 : p.joined === 'east' ? x - r.x0 : p.joined === 'west' ? r.x1 - x
      : p.axis === 'x' ? Math.min(x - r.x0, r.x1 - x) : Math.min(z - r.z0, r.z1 - z);
    return Math.min(across, along, p.cap ?? Infinity);
  }
}

// ---------------------------------------------------------------------------------------------
// Fitting: the box, the layers and the bill, cut one thing at a time (lesson 56)
// ---------------------------------------------------------------------------------------------

export interface ProgramBill { units?: (d: Design) => number; smelts?: (d: Design) => number }

type Cut = [string, (s: HouseSpec, over: { x: boolean; z: boolean }) => HouseSpec | null];
const smaller = (s: HouseSpec, axis: 'x' | 'z' | 'any'): HouseSpec | null => {
  const b = s.body;
  const wFirst = axis === 'x' || (axis === 'any' && b.width >= b.depth);
  if (wFirst && b.width >= 7) return { ...s, body: { ...b, width: b.width - 2 } };
  if (axis !== 'x' && b.depth >= 7) return { ...s, body: { ...b, depth: b.depth - 2 } };
  if (axis === 'any' && b.width >= 7) return { ...s, body: { ...b, width: b.width - 2 } };
  return null;
};
const BOX_CUTS: Cut[] = [
  ['no overhang', (s) => (s.overhang ? { ...s, overhang: 0 } : null)],
  ['shallower wing', (s, over) => {
    const i = s.wings.findIndex((w) => w.depth > 2 && ((over.z && (w.side === 'front' || w.side === 'back')) || (over.x && (w.side === 'left' || w.side === 'right'))));
    return i < 0 ? null : { ...s, wings: s.wings.map((w, j) => (j === i ? { ...w, depth: w.depth - 1 } : w)) };
  }],
  ['smaller', (s, over) => smaller(s, over.x && !over.z ? 'x' : over.z && !over.x ? 'z' : 'any')],
  ['no porch', (s, over) => (s.porch && over.z ? { ...s, porch: false } : null)],
  ['no wing', (s) => (s.wings.length ? { ...s, wings: s.wings.slice(0, -1) } : null)],
  ['no tower', (s) => (s.towers.length ? { ...s, towers: s.towers.slice(0, -1) } : null)],
  ['no bay window', (s) => (s.bays.length ? { ...s, bays: s.bays.slice(0, -1) } : null)],
];
// (the second storey before the tower: a tower is the rarer wish and the cheaper part, and a two-storey house with one
// rarely fits the budget, the progbench replay)
const COST_CUTS: Cut[] = [
  ['one storey', (s) => (s.body.storeys === 2 ? { ...s, body: { ...s.body, storeys: 1 }, upper_walls: undefined } : null)],
  ['no tower', (s) => (s.towers.length ? { ...s, towers: s.towers.slice(0, -1) } : null)],
  ['no wing', (s) => (s.wings.length ? { ...s, wings: s.wings.slice(0, -1) } : null)],
  ['smaller', (s) => smaller(s, 'any')],
  ['no bay window', (s) => (s.bays.length ? { ...s, bays: s.bays.slice(0, -1) } : null)],
  ['smaller', (s) => smaller(s, 'any')],
  ['no chimney', (s) => (s.chimney ? { ...s, chimney: false } : null)],
  ['no porch', (s) => (s.porch ? { ...s, porch: false } : null)],
  ['no shutters', (s) => (s.shutters ? { ...s, shutters: false } : null)],
  ['cobblestone for stone', (s) => (s.walls === 'stone_bricks' || s.base === 'stone_bricks' || s.roof_material === 'stone_bricks' || s.roof_material === 'stone' || s.upper_walls === 'stone_bricks'
    ? { ...s, walls: s.walls === 'stone_bricks' ? 'cobblestone' : s.walls, upper_walls: s.upper_walls === 'stone_bricks' ? 'cobblestone' : s.upper_walls, base: s.base === 'stone_bricks' ? 'cobblestone' : s.base, roof_material: s.roof_material === 'stone_bricks' || s.roof_material === 'stone' ? 'cobblestone' : s.roof_material } : null)],
  ['panes', (s) => (s.glass === 'glass' ? { ...s, glass: 'panes' } : null)],
  ['open windows', (s) => (s.glass === 'panes' ? { ...s, glass: 'open' } : null)],
  ['planks walls', (s) => (s.walls !== 'planks' || (s.upper_walls && s.upper_walls !== 'planks') ? { ...s, walls: 'planks', upper_walls: s.upper_walls && 'planks' } : null)],
  ['smaller', (s) => smaller(s, 'any')],
];

const SMELT_FIRST = ['cobblestone for stone', 'panes', 'open windows'];

/**
 * A spec drawn within the box (V2_LIMITS), the layers, `budget` units and MAX_SMELTS: over the box code takes off the
 * overhang, then shortens wings and the body on the axis that is over; over the bill it cuts the dearest parts first.
 * Null when even the plainest house is over (the caller then falls back to #174's pick).
 */
export function fitHouse(spec: HouseSpec, budget: number, bill: ProgramBill = {}, name?: string): { design: Design; spec: HouseSpec; cuts: string[]; notes: string[] } | null {
  const cuts: string[] = [];
  let s = spec;
  for (let i = 0; i < 40; i++) {
    const { design, notes, drawn } = compileHouse(s, name);
    // (a tower asked for is the rarer wish: on two storeys it finds no room under 12 layers, so the storey goes)
    if (s.body.storeys === 2 && notes.some((n) => /tower left out: no room above/.test(n))) {
      s = { ...s, body: { ...s.body, storeys: 1 }, upper_walls: undefined };
      cuts.push('one storey (room for the tower)');
      continue;
    }
    const over = { x: design.width > V2_LIMITS.maxBox, z: design.depth > V2_LIMITS.maxBox };
    const tall = design.height > V2_LIMITS.maxLayers;
    const smelty = !!bill.smelts && bill.smelts(design) > MAX_SMELTS;
    const dear = (bill.units && bill.units(design) > budget) || smelty;
    if (!over.x && !over.z && !tall && !dear) return { design, spec: drawn, cuts, notes };
    // (over the furnace runs, the stone and the glass change first, as fitSmelts does, before any part goes)
    const list = over.x || over.z ? BOX_CUTS : smelty ? [...COST_CUTS.filter(([why]) => SMELT_FIRST.includes(why)), ...COST_CUTS] : COST_CUTS;
    let next: HouseSpec | null = null;
    for (const [why, cut] of list) {
      next = cut(s, over);
      if (next) {
        cuts.push(why);
        break;
      }
    }
    if (!next) return null;
    s = next;
  }
  return null;
}

/** The model's reply as code: the first fenced block if there is one, else the whole reply. */
export function extractProgram(reply: string): string {
  const m = /```(?:[a-zA-Z]*)\s*\n([\s\S]*?)```/.exec(reply);
  return (m ? m[1] : reply).trim();
}

/** A program that does not parse, its note() lines quoted again: qwen3.8 wrote note('... the street's look ...') (2 of
 *  48 in the character bench), and the whole program failed for an apostrophe. The text from the first quote to the last
 *  on the line is the note. */
export function requoteNotes(code: string): string {
  return code.split('\n').map((line) => {
    const m = /^(\s*)note\(\s*(['"`])(.*)\2\s*\)\s*;?\s*$/.exec(line);
    return m ? `${m[1]}note(${JSON.stringify(m[3])});` : line;
  }).join('\n');
}

/** A program's calls read onto the street's spec and fitted (houseFromProgram's second half: the world runs the program
 *  in a worker first). */
export function houseFromRun(run: ProgramRun, familyName: string, budget: number, bill: ProgramBill = {}, name?: string, wood?: string) {
  const notes: string[] = [];
  const spec = applyCalls(run.calls, defaultSpec(familyName, wood), notes);
  if (!run.calls.some(([fn]) => fn === 'body' || fn === 'house')) notes.push('no body(): a 5x5 house');
  const fit = run.calls.length ? fitHouse(spec, budget, bill, name) : null;
  return { run, spec, notes: [...notes, ...(fit?.notes ?? [])], fit };
}

/** A program's whole path: run it, read its calls onto the street's spec, fit it. */
export function houseFromProgram(code: string, familyName: string, budget: number, bill: ProgramBill = {}, name?: string, wood?: string) {
  let run = runProgram(code);
  const fixed = /^syntax/.test(run.error ?? '') ? requoteNotes(code) : code;
  if (fixed !== code) run = runProgram(fixed);
  return houseFromRun(run, familyName, budget, bill, name, wood);
}

/** The same in a worker thread (runProgramIsolated): the world's path. */
export async function houseFromProgramIsolated(code: string, familyName: string, budget: number, bill: ProgramBill = {}, name?: string, wood?: string) {
  let run = await runProgramIsolated(code);
  const fixed = /^syntax/.test(run.error ?? '') ? requoteNotes(code) : code;
  if (fixed !== code) run = await runProgramIsolated(fixed);
  return houseFromRun(run, familyName, budget, bill, name, wood);
}
