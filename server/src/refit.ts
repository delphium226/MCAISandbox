/**
 * Refits (#75, MC_WORKS_GROW; runs/2026-10-21/works-grow/design.md): works that grow with the village without new land. A
 * standing building is raised a tier on its own footprint: tier 2 turns its cobblestone into stone bricks, tier 3 its log
 * posts into bark-all-round wood and its wooden roof stairs and slabs into stone brick. A refit design is the building's
 * own design with only the cells that change (every other cell "_", left as it is), so doors, furniture, torches, signs
 * and decor spots are never touched and build_design charges only what changes. World-free: the world posts and builds
 * them (layout.ts postRefit, mcBuild.ts build_design's refit).
 */
import { MINING_HUT, STORAGE_HUT } from './huts';
import type { Design, Structure, Task, Village } from './village';

/** The tiers a building can be raised to, in order (1 is as first built). */
export const REFIT_TIERS = [2, 3] as const;
/** What each tier does, for an option's name and facts. */
export const TIER_WORDS: Record<number, { short: string; facts: string }> = {
  2: { short: 'in stone', facts: 'cobblestone walls, stairs and slabs rebuilt as stone bricks' },
  3: { short: 'in timber and a stone roof', facts: 'log posts rebuilt as bark-all-round wood, wooden roof stairs and slabs as stone brick' },
};

/** A refit design's name: the building's design and the tier ("plains_library_2~t2"). */
export const refitName = (base: string, tier: number) => `${base}~t${tier}`;
/** The building's design and tier a refit design's name stands for, or null for any other design. */
export function parseRefit(name: string): { base: string; tier: number } | null {
  const m = /^(.+)~t(\d+)$/.exec(name);
  return m ? { base: m[1], tier: Number(m[2]) } : null;
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const STONE: Record<string, string> = {
  cobblestone: 'stone_bricks', cobblestone_stairs: 'stone_brick_stairs', cobblestone_slab: 'stone_brick_slab', cobblestone_wall: 'stone_brick_wall',
};

/**
 * What a block becomes at a tier (its states kept), or null when the tier leaves it. `upper`: the cell is in the
 * design's upper half (tier 3 turns only the roof's wooden stairs and slabs).
 */
export function refitBlock(block: string, tier: number, upper: boolean): string | null {
  const i = block.indexOf('[');
  const base = (i >= 0 ? block.slice(0, i) : block).replace(/^minecraft:/, ''), states = i >= 0 ? block.slice(i) : '';
  let to: string | undefined;
  if (tier === 2) to = STONE[base];
  else if (tier === 3)
    for (const w of WOODS) {
      if (base === `${w}_log`) to = `${w}_wood`;
      else if (base === `stripped_${w}_log`) to = `stripped_${w}_wood`;
      else if (upper && base === `${w}_stairs`) to = 'stone_brick_stairs';
      else if (upper && base === `${w}_slab`) to = 'stone_brick_slab';
      if (to) break;
    }
  if (!to) return null;
  // (a wood block has an axis like the log; stone brick stairs and slabs take the wooden ones' states as they are)
  return `${to}${states}`;
}

/** A design's refit at a tier: only the changed cells, the rest "_"; null when the tier changes nothing. */
export function refitDesign(d: Design, tier: number): Design | null {
  const palette: Record<string, string> = {};
  for (const [ch, b] of Object.entries(d.palette)) {
    const to = refitBlock(b, tier, true);
    if (to) palette[ch] = to;
  }
  if (!Object.keys(palette).length) return null;
  const half = Math.ceil(d.height / 2);
  let blocks = 0;
  const layers = d.layers.map((layer, li) => layer.map((row) => [...row].map((ch) => {
    const b = palette[ch];
    if (!b || refitBlock(d.palette[ch], tier, li >= half) === null) return '_';
    blocks++;
    return ch;
  }).join('')));
  if (!blocks) return null;
  return {
    name: refitName(d.name, tier), description: `${d.name} refitted ${TIER_WORDS[tier]?.short ?? `to tier ${tier}`}`,
    palette, layers, width: d.width, depth: d.depth, height: d.height, blocks, by: 'code',
  };
}

/** A building that can be refitted: its record, design, and the place and turn its own Build task built it at. */
export interface RefitPlace { st: Structure; design: Design; x: number; z: number; rot: number; label: string }

/**
 * Every refittable building of a village with where it was built (the done Build task whose design is the record's kind
 * and whose footprint starts at the record's corner, as lightParts finds it): not the huts, not small works or anything
 * else built without a Build task.
 */
export function refitPlaces(v: Village): RefitPlace[] {
  const out: RefitPlace[] = [];
  const done = v.tasks.filter((t) => t.status === 'done' && /^Build /.test(t.title));
  for (const st of v.structures) {
    if (st.kind === STORAGE_HUT || st.kind === MINING_HUT || parseRefit(st.kind)) continue;
    const d = v.designs[st.kind];
    if (!d) continue;
    for (const t of done) {
      const m = /build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(\d+))?/.exec(t.detail);
      if (!m || m[1] !== st.kind) continue;
      const rot = (((Math.round(Number(m[4] ?? 0) / 90) % 4) + 4) % 4);
      const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
      const x = Number(m[2]), z = Number(m[3]);
      if (x - Math.floor(W / 2) !== st.x1 || z - Math.floor(D / 2) !== st.z1) continue;
      out.push({ st, design: d, x, z, rot, label: t.title.slice(6) });
      break;
    }
  }
  return out;
}

/** A layout's next refit: its index (from 1), the tier and the buildings still below it that the tier changes. */
export interface RefitOption { layout: number; tier: number; places: RefitPlace[] }

/**
 * Each layout's next refit: the lowest tier some building of it is still below (a building the tier changes nothing on
 * counts as at it), the next only once every building of the layout has the previous; layouts in their order.
 */
export function refitOptions(v: Village): RefitOption[] {
  const places = refitPlaces(v);
  const out: RefitOption[] = [];
  (v.layouts ?? []).forEach((l, i) => {
    const mine = places.filter((p) => p.st.x1 >= l.x1 && p.st.x2 <= l.x2 && p.st.z1 >= l.z1 && p.st.z2 <= l.z2);
    for (const tier of REFIT_TIERS) {
      const due = mine.filter((p) => (p.st.tier ?? 1) < tier && refitDesign(p.design, tier));
      if (due.length) {
        out.push({ layout: i + 1, tier, places: due });
        return;
      }
    }
  });
  return out;
}

/** A refit's project id ("refit:4:2": layout 4 to tier 2), and back. */
export const refitProject = (o: { layout: number; tier: number }) => `refit:${o.layout}:${o.tier}`;
export function parseRefitProject(id: string): { layout: number; tier: number } | null {
  const m = /^refit:(\d+):(\d+)$/.exec(id);
  return m ? { layout: Number(m[1]), tier: Number(m[2]) } : null;
}

/** Whether a task is a refit's build (build_design of a refit design). */
export const isRefitBuild = (t: Task) => /^build_design "[^"]+~t\d+"/.test(t.detail);
