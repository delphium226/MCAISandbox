/**
 * Members' own houses (#104's R3, MC_GEN_HOMES=on; off by default; spec runs/2026-10-23/building-variety/spec_r3.md): each
 * house of a growth neighbourhood drawn by the generator (buildingGen.ts v2) for the member who will live in it. Its form
 * (footprint, storeys, size, door, porch, chimney, shutters) comes from the member's character, its look (walls, base,
 * roof, frame, windows) from the neighbourhood's family (the voted biome) as often as the member values tradition, and
 * its wood from the neighbourhood. Pure and deterministic: a member's character is a function of its name (character.ts),
 * each member has its own seeded stream, and no model is called. World-free: the caller passes the bill's units.
 */
import { V2_LIMITS, generateDesign, type BuildingStyle } from './buildingGen';
import { goalFromValues, hexacoOf, hexacoWeights, valuesOf, VALUES, type Value } from './character';
import { BIG_HOUSES, HOUSE_UNITS, HOUSE_UNITS_LARGE, MAX_SMELTS } from './designs';
import type { Design } from './village';
import { rawSetting } from './settings';

// (on by default since 10-25, the user's: "always use the newer building style"; =off turns it off)
export const GEN_HOMES = !/^(off|0|false|no)$/i.test(rawSetting('MC_GEN_HOMES') ?? 'on');

/** A wall's length under #141's MC_BIG_HOUSES (designs.ts): +2 (both; long on the longer wall only) or x1.5 kept odd (x15). */
const grown = (n: number) => (BIG_HOUSES === 'both' || BIG_HOUSES === 'long' ? n + 2 : BIG_HOUSES === 'x15' ? Math.floor(n * 0.75) * 2 + 1 : n);
/** A house's walls grown (#141): long grows the longer wall (the width when even), the others both. */
export function growWalls(width: number, depth: number): [number, number] {
  if (BIG_HOUSES === 'long') return width >= depth ? [grown(width), depth] : [width, grown(depth)];
  return [grown(width), grown(depth)];
}

/** A neighbourhood's look, after vanilla's village of its biome. */
export interface Family {
  walls: BuildingStyle['walls'];
  base: BuildingStyle['base'];
  roof: BuildingStyle['roof'];
  roof_material: BuildingStyle['roof_material'];
  frame: BuildingStyle['frame'];
  windows: BuildingStyle['windows'];
  /** The wood when neither the neighbourhood nor the village has one. */
  wood: string;
}
export const FAMILY: Record<string, Family> = {
  plains: { walls: 'planks', base: 'cobblestone', roof: 'gable', roof_material: 'planks', frame: 'logs', windows: 'panes', wood: 'oak' },
  savanna: { walls: 'planks', base: 'none', roof: 'hip', roof_material: 'planks', frame: 'logs', windows: 'panes', wood: 'acacia' },
  taiga: { walls: 'planks', base: 'cobblestone', roof: 'gable', roof_material: 'planks', frame: 'logs', windows: 'panes', wood: 'spruce' },
  // (stone bricks take a furnace run a block: walls ~70 and even a base ~55, over MAX_SMELTS's 32, and a cobblestone roof
  // cut 21 of 24 homes (the R3 review's measure, gen_homes): spruce walls on cobblestone under a hip roof instead)
  snowy: { walls: 'planks', base: 'cobblestone', roof: 'hip', roof_material: 'planks', frame: 'logs', windows: 'panes', wood: 'spruce' },
  desert: { walls: 'sandstone', base: 'none', roof: 'flat', roof_material: 'sandstone', frame: 'none', windows: 'open', wood: 'oak' },
};
/** A biome style's family key ("plains", "savanna@spruce", a Minecraft biome); plains for anything else. */
export const familyKey = (style?: string): string => {
  const b = (style ?? '').replace(/^minecraft:/, '').replace(/@.*$/, '');
  return FAMILY[b] ? b : Object.keys(FAMILY).find((k) => b.includes(k)) ?? 'plains';
};
export const familyOf = (style?: string): Family => FAMILY[familyKey(style)];

/**
 * A member's house's design name in a family: "home_" and six digits from both. Not the member's name: names carry words
 * the name rules key on (Finn and Quinn end in "inn": isLandmark takes them for landmarks and isDwelling refuses them, the
 * R3 review), and a member's house differs by family. The member is the style's `owner` (lesson 89).
 */
export const homeName = (member: string, family: string) => `home_${String(hash(`${member.trim().toLowerCase()}|${family}`) % 1000000).padStart(6, '0')}`;
/** Whether a design name is a member's own house's ("home_123456", its wood variants and refits too). */
export const isHomeName = (name: string) => /^home_\d{6}(?:@[a-z_]+)?(?:~t\d+)?$/.test(name);
/** Whose house a design is (its style's owner), or null. */
export const homeOwner = (d: Design | undefined) => (d && isHomeName(d.name) ? d.style?.owner ?? null : null);

// (FNV-1a and mulberry32, as choose.ts has them: kept here so this file needs nothing of the brain)
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Activities whose liking adds a house's extra (hexacoWeights' kinds). */
const LIKE_KINDS = ['farm', 'make', 'iron', 'furnish', 'light', 'pen', 'explore', 'gather', 'help'];

/** What of a member's character the style reads (for the checks and the panel). */
export interface HomeTraits { conformity: number; dominant: Value; goal: string; likes: string[] }
export function homeTraits(member: string): HomeTraits {
  const v = valuesOf(member);
  const order = [...VALUES].sort((a, b) => v[b] - v[a]);
  const rank = order.indexOf('conservation');
  const weights = hexacoWeights(member, LIKE_KINDS);
  const likes = LIKE_KINDS.filter((k) => weights[k] !== undefined).sort((a, b) => weights[b] - weights[a] || LIKE_KINDS.indexOf(a) - LIKE_KINDS.indexOf(b)).slice(0, 2);
  return { conformity: rank === 0 ? 0.8 : rank === 3 ? 0.2 : 0.5, dominant: order[0], goal: goalFromValues(member), likes };
}

/**
 * A member's house as a style (spec 2), before the budget's cuts. Drawn in oak unless `wood` is given: the world builds a
 * design in the village's wood, or with R2 its neighbourhood's (pickHouses names the pick "NAME@wood"), as every design.
 */
export function memberStyle(member: string, familyName: string, wood?: string): BuildingStyle {
  const family = FAMILY[familyName] ?? FAMILY.plains;
  const h = hexacoOf(member);
  const t = homeTraits(member);
  const rnd = stream(hash(`${member.toLowerCase()}|home`));
  // (the look: the family's with the member's conformity, else the member's own pick)
  const look = <T>(fam: T, own: T): T => (rnd() < t.conformity ? fam : own);
  const contrast: BuildingStyle['walls'] = family.walls === 'planks' ? 'cobblestone' : 'planks';
  const walls = look(family.walls, h.O >= 0.3 ? contrast : family.walls);
  const base = look(family.base, t.goal === 'mastery' || t.dominant === 'enhancement' ? 'cobblestone' : family.base);
  const otherRoof: BuildingStyle['roof'] = family.roof === 'gable' ? 'hip' : 'gable';
  const roof = look(family.roof, family.roof === 'flat' ? 'hip' : otherRoof);
  const windows_pattern = look<BuildingStyle['windows_pattern']>('rhythm', h.X >= 0.3 ? 'wide' : h.X <= -0.3 ? 'single' : 'rhythm');
  // (the form: the member's own)
  const footprint: 'rect' | 'L' | 'T' = t.dominant === 'openness' || t.goal === 'invention' || t.goal === 'beauty'
    ? (h.O > 0.5 ? 'T' : 'L') : t.dominant === 'conservation' ? 'rect' : rnd() < 0.4 ? 'L' : 'rect';
  const storeys = t.dominant === 'enhancement' || t.goal === 'wealth' || t.goal === 'standing' ? 2 : 1;
  const strongest = (['C', 'E', 'X'] as const).filter((k) => h[k] >= 0.3).sort((a, b) => h[b] - h[a])[0];
  const sizes: Array<[number, number]> = [[5, 5], [5, 7], [7, 5], [7, 7]];
  let [width, depth] = strongest === 'C' ? [7, 7] : strongest === 'E' ? [5, 7] : strongest === 'X' ? [7, 5] : sizes[Math.floor(rnd() * 4)];
  const porch = h.A >= 0.3 || t.dominant === 'transcendence' || t.likes.includes('farm');
  const chimney = t.goal === 'home' || h.E >= 0.3 || t.likes.includes('make') || t.likes.includes('iron');
  const shutters = t.goal === 'beauty' || t.likes.includes('furnish') || t.likes.includes('light');
  const flat = roof === 'flat';
  // (a wing in front with a porch leaves no row for the overhang in 9: such a house goes without one)
  let overhang = flat || (footprint !== 'rect' && porch) ? 0 : 1;
  let wing: BuildingStyle['wing'];
  if (footprint !== 'rect') {
    width = overhang ? 7 : rnd() < 0.5 ? 7 : 9;
    depth = 5;
    wing = { side: rnd() < 0.5 ? 'east' : 'west', width: width === 9 && rnd() < 0.5 ? 5 : 3, depth: overhang ? 2 : porch ? 2 : 3 };
  } else if (porch && overhang) depth = 5;
  [width, depth] = growWalls(width, depth);
  // (a hard-working member elaborates a log frame into timber where the walls are long enough, whatever its conformity)
  const frame = h.C >= 0.3 && family.frame === 'logs' && Math.min(width, depth) >= 7 ? 'timber' : look(family.frame, h.C >= 0.3 ? 'logs' : h.C <= -0.3 ? 'none' : family.frame);
  const door_offset = footprint === 'rect' && h.C < 0.3 ? Math.floor(rnd() * 3) - 1 : 0;
  const upper_walls: BuildingStyle['walls'] = walls === 'planks' || walls === 'logs' ? walls : 'planks';
  if (flat) overhang = 0;
  const style: BuildingStyle = {
    name: homeName(member, familyName), description: '', width, depth, wall_height: storeys === 1 && h.X >= 0.5 ? 4 : 3, floor: 'none', base, frame, walls,
    roof, roof_material: family.roof_material === 'sandstone' && roof !== 'flat' ? 'sandstone' : family.roof_material, overhang,
    windows: family.windows === 'open' && walls !== 'sandstone' ? 'panes' : family.windows, door_side: 'south',
    footprint, ...(wing ? { wing } : {}), storeys, ...(storeys === 2 ? { upper_walls } : {}), ...(wood ? { wood } : {}),
    windows_pattern, door_offset, porch, chimney, shutters, owner: member, family: familyName,
  };
  return style;
}

/** In words, for the design's description and the panel ("an L-shaped two-storey house in spruce with a porch"). */
export function describeStyle(s: BuildingStyle): string {
  const shape = s.footprint === 'L' ? 'an L-shaped ' : s.footprint === 'T' ? 'a T-shaped ' : 'a ';
  const parts = [`a ${s.roof} roof`, s.walls !== 'planks' && `${s.walls.replace(/_/g, ' ')} walls`, s.porch && 'a porch', s.chimney && 'a chimney', s.shutters && 'shutters'].filter(Boolean) as string[];
  return `${shape}${s.storeys === 2 ? 'two-storey' : 'one-storey'} house${s.wood ? ` in ${s.wood.replace(/_/g, ' ')}` : ''} with ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
}

export interface HomeBill {
  /** The bill's gather units (the world's materialTasks; the checks' Materials.plan). */
  units?: (d: Design) => number;
  /** Its furnace runs. */
  smelts?: (d: Design) => number;
}

/**
 * A style drawn within the limits (spec 3): the box (V2_LIMITS), and `budget` units and MAX_SMELTS when the bill can be
 * read. Over them, code cuts one thing at a time, the dearest first: the second storey, the wing, the size (two at a
 * time, to 5), the chimney, the porch, the shutters, then glass for panes and panes for open windows. The cuts ride on
 * the description. Null when even the plainest house is over (the caller then builds a vanilla house).
 */
export function fitHome(style: BuildingStyle, budget: number, bill: HomeBill = {}): { design: Design; cuts: string[] } | null {
  const cuts: string[] = [];
  const fits = (d: Design) => d.width <= V2_LIMITS.maxBox && d.depth <= V2_LIMITS.maxBox && d.height <= V2_LIMITS.maxLayers
    && (!bill.units || bill.units(d) <= budget) && (!bill.smelts || bill.smelts(d) <= MAX_SMELTS);
  const steps: Array<[string, (s: BuildingStyle) => BuildingStyle | null]> = [
    ['one storey', (s) => (s.storeys === 2 ? { ...s, storeys: 1, upper_walls: undefined } : null)],
    ['no wing', (s) => (s.footprint && s.footprint !== 'rect' ? { ...s, footprint: 'rect', wing: undefined, width: Math.min(s.width, grown(7)), depth: Math.min(s.depth, grown(s.porch && s.overhang ? 5 : 7)), overhang: s.roof === 'flat' ? 0 : 1 } : null)],
    ['smaller', (s) => (s.width >= 7 && s.width >= s.depth ? { ...s, width: s.width - 2 } : s.depth >= 7 ? { ...s, depth: s.depth - 2 } : s.width >= 7 ? { ...s, width: s.width - 2 } : null)],
    ['smaller', (s) => (s.width >= 7 ? { ...s, width: s.width - 2 } : s.depth >= 7 ? { ...s, depth: s.depth - 2 } : null)],
    ['no chimney', (s) => (s.chimney ? { ...s, chimney: false } : null)],
    ['no porch', (s) => (s.porch ? { ...s, porch: false } : null)],
    ['no shutters', (s) => (s.shutters ? { ...s, shutters: false } : null)],
    ['cobblestone for stone', (s) => (s.walls === 'stone_bricks' || s.base === 'stone_bricks' || s.roof_material === 'stone_bricks' || s.roof_material === 'stone'
      ? { ...s, walls: s.walls === 'stone_bricks' ? 'cobblestone' : s.walls, base: s.base === 'stone_bricks' ? 'cobblestone' : s.base, roof_material: s.roof_material === 'stone_bricks' || s.roof_material === 'stone' ? 'cobblestone' : s.roof_material } : null)],
    ['panes', (s) => (s.windows === 'glass' ? { ...s, windows: 'panes' } : null)],
    ['open windows', (s) => (s.windows === 'panes' ? { ...s, windows: 'open' } : null)],
    ['planks walls', (s) => (s.walls !== 'planks' ? { ...s, walls: 'planks', upper_walls: s.upper_walls && 'planks' } : null)],
    ['smaller', (s) => (s.width >= 7 ? { ...s, width: s.width - 2 } : s.depth >= 7 ? { ...s, depth: s.depth - 2 } : null)],
  ];
  let s = style;
  let d = generateDesign(s);
  for (const [why, step] of steps) {
    if (fits(d)) break;
    const next = step(s);
    if (!next) continue;
    s = next;
    d = generateDesign(s);
    cuts.push(why);
  }
  if (!fits(d)) return null;
  return { design: d, cuts };
}

/**
 * The houses of a neighbourhood for its owners-to-be (spec 4), in their order: each member's style fitted to a house's
 * budget, except one, the member wanting two storeys most (self-enhancement first), who may take HOUSE_UNITS_LARGE (the
 * user's choice, 10-23: one larger home a neighbourhood, as plan_layout lays out one building over HOUSE_UNITS). An owner
 * whose house cannot fit at all is left out (the caller fills in a vanilla house).
 */
export function ownHomes(owners: string[], style: string | undefined, bill: HomeBill = {}, wood?: string): Design[] {
  const family = familyKey(style);
  const styles = owners.map((m) => memberStyle(m, family, wood));
  const two = owners.map((m, i) => ({ m, i, e: valuesOf(m).enhancement })).filter((x) => styles[x.i].storeys === 2).sort((a, b) => b.e - a.e || a.m.localeCompare(b.m));
  const large = two[0]?.i;
  const out: Design[] = [];
  owners.forEach((m, i) => {
    const fit = fitHome(styles[i], i === large ? HOUSE_UNITS_LARGE : HOUSE_UNITS, bill);
    if (!fit) return;
    const s = fit.design.style!;
    const who = m.charAt(0).toUpperCase() + m.slice(1);
    fit.design.description = `${who}'s house: ${describeStyle(s)}${fit.cuts.length ? ` (cut to fit: ${[...new Set(fit.cuts)].join(', ')})` : ''}`;
    s.description = fit.design.description;
    out.push(fit.design);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Members' own designs (#174, MC_HOME_DESIGN=model; spec runs/2026-10-29/homedesign/spec.md): a member's picks from the
// generator's options (homeDesign.ts asks the model), turned into a style here, cut in the member's own ranking.
// ---------------------------------------------------------------------------------------------

/** A rect house's sizes before #141's growth (growWalls): small 5x5, deep 5x7, wide 7x5, large 7x7. */
export const HOME_SIZES = { small: [5, 5], deep: [5, 7], wide: [7, 5], large: [7, 7] } as const;
export type HomeSize = keyof typeof HOME_SIZES;
/** The features a member ranks (the cuts go in reverse): each one it picked beyond the plainest house. */
export const HOME_FEATURES = ['storeys', 'shape', 'size', 'porch', 'chimney', 'shutters', 'look'] as const;
export type HomeFeature = (typeof HOME_FEATURES)[number];

/** A member's picks (the tool's fields, normalised). The look is relative to the street's family. */
export interface HomeChoice {
  size: HomeSize;
  shape: 'rect' | 'L' | 'T';
  wing_side: 'east' | 'west';
  storeys: 1 | 2;
  roof: 'street' | 'other';
  walls: 'street' | 'contrast';
  base: 'street' | 'cobblestone';
  frame: 'street' | 'timber' | 'none';
  windows: 'rhythm' | 'wide' | 'single';
  door: 'centre' | 'left' | 'right';
  porch: boolean;
  chimney: boolean;
  shutters: boolean;
  /** Asks for the street's one larger house (the world resolves the claim: true in ownHomes means it holds it). */
  larger: boolean;
  /** Most wanted first; features left out are cut before those listed. */
  priority: HomeFeature[];
}

/** The plainest house: the base every option's cost is measured against. */
export const PLAIN_CHOICE: HomeChoice = {
  size: 'small', shape: 'rect', wing_side: 'east', storeys: 1, roof: 'street', walls: 'street', base: 'street', frame: 'street',
  windows: 'rhythm', door: 'centre', porch: false, chimney: false, shutters: false, larger: false, priority: [],
};

const contrastOf = (f: Family): BuildingStyle['walls'] => (f.walls === 'planks' ? 'cobblestone' : 'planks');
const otherRoofOf = (f: Family): BuildingStyle['roof'] => (f.roof === 'gable' ? 'hip' : f.roof === 'flat' ? 'hip' : 'gable');

/**
 * A member's picks as a style, with memberStyle's derived rules (the porch/overhang rule, upper walls, the roof material,
 * a tall storey for X >= 0.5). An L or T is 7 wide with a 3-wide wing, or 9 with a 5-wide wing when its size is wide or
 * large and it has no overhang (a porch before the wing: only then does the box take 9).
 */
export function styleFromChoice(member: string, familyName: string, c: HomeChoice, wood?: string, reason?: string): BuildingStyle {
  const family = FAMILY[familyName] ?? FAMILY.plains;
  const h = hexacoOf(member);
  const walls = c.walls === 'contrast' ? contrastOf(family) : family.walls;
  const base = c.base === 'cobblestone' ? 'cobblestone' : family.base;
  const roof = c.roof === 'other' ? otherRoofOf(family) : family.roof;
  const flat = roof === 'flat';
  const footprint = c.shape;
  let overhang = flat || (footprint !== 'rect' && c.porch) ? 0 : 1;
  let [width, depth]: number[] = [...HOME_SIZES[c.size]];
  let wing: BuildingStyle['wing'];
  if (footprint !== 'rect') {
    const big = !overhang && (c.size === 'wide' || c.size === 'large');
    width = big ? 9 : 7;
    depth = 5;
    wing = { side: footprint === 'T' ? 'east' : c.wing_side, width: big ? 5 : 3, depth: overhang ? 2 : c.porch ? 2 : 3 };
  } else if (c.porch && overhang) depth = 5;
  [width, depth] = growWalls(width, depth);
  const frame = c.frame === 'timber' && family.frame === 'logs' && Math.min(width, depth) >= 7 ? 'timber' : c.frame === 'none' ? 'none' : family.frame;
  const door_offset = footprint === 'rect' ? (c.door === 'left' ? -1 : c.door === 'right' ? 1 : 0) : 0;
  const upper_walls: BuildingStyle['walls'] = walls === 'planks' || walls === 'logs' ? walls : 'planks';
  if (flat) overhang = 0;
  return {
    name: homeName(member, familyName), description: '', width, depth, wall_height: c.storeys === 1 && h.X >= 0.5 ? 4 : 3, floor: 'none', base, frame, walls,
    roof, roof_material: family.roof_material === 'sandstone' && roof !== 'flat' ? 'sandstone' : family.roof_material, overhang,
    windows: family.windows === 'open' && walls !== 'sandstone' ? 'panes' : family.windows, door_side: 'south',
    footprint, ...(wing ? { wing } : {}), storeys: c.storeys, ...(c.storeys === 2 ? { upper_walls } : {}), ...(wood ? { wood } : {}),
    windows_pattern: c.windows, door_offset, porch: c.porch, chimney: c.chimney, shutters: c.shutters, owner: member, family: familyName,
    chosen: 'model', ...(reason ? { reason } : {}),
  };
}

/** Today's character draw (memberStyle) read back as picks: the fallback for a field the model left out, and the bench's
 *  reference. */
export function characterChoice(member: string, familyName: string): HomeChoice {
  const family = FAMILY[familyName] ?? FAMILY.plains;
  const s = memberStyle(member, familyName);
  const fp = s.footprint ?? 'rect';
  const sizeOf = (): HomeSize => {
    if (fp !== 'rect') return s.wing && s.wing.width >= 5 ? 'large' : 'small';
    for (const k of Object.keys(HOME_SIZES) as HomeSize[]) {
      const [w, d] = HOME_SIZES[k];
      const [gw, gd] = growWalls(w, s.porch && s.overhang ? 5 : d);
      if (gw === s.width && gd === s.depth) return k;
    }
    return 'small';
  };
  return {
    size: sizeOf(), shape: fp, wing_side: s.wing?.side === 'west' ? 'west' : 'east', storeys: s.storeys === 2 ? 2 : 1,
    roof: s.roof === family.roof ? 'street' : 'other', walls: s.walls === family.walls ? 'street' : 'contrast',
    base: s.base === family.base ? 'street' : 'cobblestone', frame: s.frame === family.frame ? 'street' : s.frame === 'timber' ? 'timber' : 'none',
    windows: s.windows_pattern ?? 'rhythm', door: (s.door_offset ?? 0) < 0 ? 'left' : (s.door_offset ?? 0) > 0 ? 'right' : 'centre',
    porch: !!s.porch, chimney: !!s.chimney, shutters: !!s.shutters, larger: false, priority: [],
  };
}

/** The features a choice has beyond the plainest house. */
export function choiceFeatures(c: HomeChoice): HomeFeature[] {
  return HOME_FEATURES.filter((f) => (f === 'storeys' ? c.storeys === 2 : f === 'shape' ? c.shape !== 'rect' : f === 'size' ? c.size !== 'small'
    : f === 'look' ? c.roof !== 'street' || c.walls !== 'street' || c.base !== 'street' || c.frame !== 'street' : c[f]));
}

/** One cut of a feature (null when nothing is left to cut), in fitHome's words. */
function cutFeature(c: HomeChoice, f: HomeFeature): [string, HomeChoice] | null {
  switch (f) {
    case 'storeys': return c.storeys === 2 ? ['one storey', { ...c, storeys: 1 }] : null;
    case 'shape': return c.shape !== 'rect' ? ['no wing', { ...c, shape: 'rect' }] : null;
    case 'size': return c.size === 'large' ? ['smaller', { ...c, size: 'deep' }] : c.size !== 'small' ? ['smaller', { ...c, size: 'small' }] : null;
    case 'look': return c.walls !== 'street' ? ['street walls', { ...c, walls: 'street' }] : c.base !== 'street' ? ['street base', { ...c, base: 'street' }]
      : c.frame !== 'street' ? ['street frame', { ...c, frame: 'street' }] : c.roof !== 'street' ? ['street roof', { ...c, roof: 'street' }] : null;
    default: return c[f] ? [`no ${f}`, { ...c, [f]: false }] : null;
  }
}

/**
 * A member's picks fitted to `budget` (spec R4): over it, code cuts the member's features in reverse of its ranking
 * (features it did not rank go first), one step at a time, then fitHome's own steps on what is left. The cuts in words;
 * null when even the plainest house is over (the caller builds a vanilla house).
 */
export function fitChoice(member: string, familyName: string, choice: HomeChoice, budget: number, bill: HomeBill = {}, wood?: string, reason?: string): { design: Design; cuts: string[]; choice: HomeChoice } | null {
  const fits = (d: Design) => d.width <= V2_LIMITS.maxBox && d.depth <= V2_LIMITS.maxBox && d.height <= V2_LIMITS.maxLayers
    && (!bill.units || bill.units(d) <= budget) && (!bill.smelts || bill.smelts(d) <= MAX_SMELTS);
  const draw = (c: HomeChoice) => generateDesign(styleFromChoice(member, familyName, c, wood, reason));
  let c = choice;
  let d = draw(c);
  const cuts: string[] = [];
  const ranked = choice.priority.filter((f, i) => HOME_FEATURES.includes(f) && choice.priority.indexOf(f) === i);
  const order = [...HOME_FEATURES.filter((f) => !ranked.includes(f)), ...[...ranked].reverse()];
  for (const f of order) {
    if (fits(d)) break;
    for (let step = cutFeature(c, f); step && !fits(d); step = cutFeature(c, f)) {
      c = step[1];
      cuts.push(step[0]);
      d = draw(c);
    }
  }
  if (fits(d)) return { design: d, cuts, choice: c };
  const rest = fitHome(d.style!, budget, bill);
  return rest ? { design: rest.design, cuts: [...cuts, ...rest.cuts], choice: c } : null;
}

/** A field's offered values, each with its units over the plainest house (homeOptions). */
export interface HomeOptions {
  /** The plainest house's units. */
  base: number;
  fields: Record<string, Array<{ value: string | number | boolean; units: number }>>;
}
/** The values each field may take: each value alone on the plainest house, offered when it fits `budget` (the most the
 *  member could have: the larger budget while it is free), the box and the smelts. */
export function homeOptions(member: string, familyName: string, budget: number, bill: HomeBill = {}): HomeOptions {
  const units = (c: HomeChoice) => {
    const d = generateDesign(styleFromChoice(member, familyName, c));
    if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox || d.height > V2_LIMITS.maxLayers) return Infinity;
    if (bill.smelts && bill.smelts(d) > MAX_SMELTS) return Infinity;
    return bill.units ? bill.units(d) : d.width * d.depth;
  };
  const base = units(PLAIN_CHOICE);
  const large = units({ ...PLAIN_CHOICE, size: 'large' });
  const family = FAMILY[familyName] ?? FAMILY.plains;
  const values: Record<string, Array<string | number | boolean>> = {
    size: ['small', 'deep', 'wide', 'large'], shape: ['rect', 'L', 'T'], storeys: [1, 2], roof: ['street', 'other'], walls: ['street', 'contrast'],
    base: family.base === 'cobblestone' ? ['street'] : ['street', 'cobblestone'], frame: family.frame === 'logs' ? ['street', 'timber', 'none'] : ['street'],
    windows: ['rhythm', 'wide', 'single'], door: ['centre', 'left', 'right'], porch: [false, true], chimney: [false, true], shutters: [false, true],
  };
  const fields: HomeOptions['fields'] = {};
  for (const [k, vs] of Object.entries(values)) {
    fields[k] = [];
    for (const value of vs) {
      // (timber needs walls of 7: costed beyond the large house it needs)
      const timber = k === 'frame' && value === 'timber';
      const c = { ...PLAIN_CHOICE, [k]: value, ...(timber ? { size: 'large' } : {}) } as HomeChoice;
      const u = units(c);
      if (u <= budget) fields[k].push({ value, units: Math.max(0, u - (timber ? large : base)) });
    }
  }
  return { base, fields };
}

/** A member's design request for ownHomes (#174): its picks and reason; `larger` true only for the street's claimer. */
export interface OwnChoice { choice: HomeChoice; reason: string }

/**
 * ownHomes with members' own picks (MC_HOME_DESIGN=model): an owner with a choice gets fitChoice (the larger budget only
 * when its choice holds the street's claim), the others memberStyle as today; today's larger-house rule applies among
 * those others only while no choice holds the claim. Same order, names and descriptions as ownHomes.
 */
export function chosenHomes(owners: string[], style: string | undefined, choices: Map<string, OwnChoice>, bill: HomeBill = {}, wood?: string): Design[] {
  const family = familyKey(style);
  const claimed = owners.some((m) => choices.get(m)?.choice.larger);
  const styles = owners.map((m) => (choices.has(m) ? null : memberStyle(m, family, wood)));
  const two = claimed ? [] : owners.map((m, i) => ({ m, i, e: valuesOf(m).enhancement })).filter((x) => styles[x.i]?.storeys === 2).sort((a, b) => b.e - a.e || a.m.localeCompare(b.m));
  const large = two[0]?.i;
  const out: Design[] = [];
  owners.forEach((m, i) => {
    const own = choices.get(m);
    const fit = own ? fitChoice(m, family, own.choice, own.choice.larger ? HOUSE_UNITS_LARGE : HOUSE_UNITS, bill, wood, own.reason)
      : fitHome(styles[i]!, i === large ? HOUSE_UNITS_LARGE : HOUSE_UNITS, bill);
    if (!fit) return;
    const s = fit.design.style!;
    const who = m.charAt(0).toUpperCase() + m.slice(1);
    const cut = fit.cuts.length ? ` (cut to fit: ${[...new Set(fit.cuts)].join(', ')})` : '';
    fit.design.description = `${who}'s house: ${describeStyle(s)}${cut}${own?.reason ? `; ${who} chose it: ${own.reason}` : ''}`;
    s.description = fit.design.description;
    out.push(fit.design);
  });
  return out;
}
