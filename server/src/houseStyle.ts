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
import { HOUSE_UNITS, HOUSE_UNITS_LARGE, MAX_SMELTS } from './designs';
import type { Design } from './village';

export const GEN_HOMES = /^(on|1|true)$/i.test(process.env.MC_GEN_HOMES ?? 'off');

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
    ['no wing', (s) => (s.footprint && s.footprint !== 'rect' ? { ...s, footprint: 'rect', wing: undefined, width: Math.min(s.width, 7), depth: Math.min(s.depth, s.porch && s.overhang ? 5 : 7), overhang: s.roof === 'flat' ? 0 : 1 } : null)],
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
