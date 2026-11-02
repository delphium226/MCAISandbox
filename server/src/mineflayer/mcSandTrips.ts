/**
 * #202 (MC_SAND_TRIPS, on): sand expeditions for a monument's sandstone. A record wanting at least SAND_TRIPS.min sand when
 * the sand within the village's range has run out (a trip found none, or the village marks it unavailable) sends one
 * member to the nearest dry sand the atlas knows (a 4x4 map cell mostly sand, beach or desert) up to SAND_TRIPS.range
 * blocks from home: it walks there, fills its inventory's room (collect's `far`), and brings the load to the lodge. In a
 * world with monsters only in the morning and only where the curfew reaches. A spot whose trip brought nothing is passed
 * over; after SAND_TRIPS.fails such trips the sandstone stands in as stone bricks (monument.ts' sandstoneStandIn). The
 * short lists count the sand the atlas knows in that range (sandInReach): train 17's Zytglogge wanted ~1300 sand on a
 * plains site whose river banks gave 267.
 */
import { rawSetting } from '../settings';
import { modeSpec } from '../worldMode';
import type { ChunkSummary } from './mcAtlas';

export const SAND_TRIPS = {
  on: !/^(off|0|false|no)$/i.test(rawSetting('MC_SAND_TRIPS') ?? 'on'),
  /** How far from home an expedition goes (blocks). */
  range: 400,
  /** The least sand a stage must want for one. */
  min: 128,
  /** Trips that brought nothing before the sandstone stands in. */
  fails: 2,
};
/** An expedition's digging minutes (collect's `trip`; it ends sooner when the load is full): 6, and twice the walk out at
 *  ~250 blocks a minute, so a far trip's load is worth its walk (the first, 145 blocks out on the bulk trip's 5 minutes,
 *  brought 148 of the 1151 it had room for). */
export const sandTripMin = (dist: number): number => 6 + 2 * dist / 250;
/** Sand under a dry sand column, counted for what lies in reach (beaches and deserts are 3-5 deep). */
export const SAND_DEPTH = 3;

type AtlasLike = { near(x: number, z: number, radius: number): ChunkSummary[] };
export interface SandSpot { x: number; y: number; z: number; dist: number; key: string }

/** The map cells of open water a straight line from home to a spot crosses (sampled every 4 blocks). */
export function waterCrossed(byChunk: Map<string, ChunkSummary>, home: { x: number; z: number }, x: number, z: number): number {
  const steps = Math.ceil(Math.hypot(x - home.x, z - home.z) / 4);
  let n = 0;
  for (let i = 1; i < steps; i++) {
    const px = Math.floor(home.x + ((x - home.x) * i) / steps), pz = Math.floor(home.z + ((z - home.z) * i) / steps);
    const c = byChunk.get(`${px >> 4},${pz >> 4}`);
    if (c?.s?.[((pz & 15) >> 2) * 4 + ((px & 15) >> 2)] === '~') n++;
  }
  return n;
}

/** The nearest map cell mostly of dry sand beyond `from` blocks and within the range, not in `skip` (cell keys), and on
 *  the village's side of open water: a line from home crossing 2 water cells or more is passed over (run 5's east-bank
 *  spot stranded its member in the river for 33 minutes on the way back). */
export function sandSpot(atlas: AtlasLike, home: { x: number; z: number }, from: number, skip: Set<string>): SandSpot | null {
  let best: SandSpot | null = null;
  const near = atlas.near(home.x, home.z, SAND_TRIPS.range), byChunk = new Map(near.map((c) => [`${c.cx},${c.cz}`, c] as const));
  for (const c of near) {
    if ((c.surface?.sand ?? 0) < 4) continue;
    for (let i = 0; i < 16; i++) {
      const y = c.h?.[i];
      if (c.s?.[i] !== 's' || y === null || y === undefined) continue;
      const x = c.cx * 16 + (i % 4) * 4 + 2, z = c.cz * 16 + Math.floor(i / 4) * 4 + 2, key = `${x},${z}`;
      const dist = Math.round(Math.hypot(x - home.x, z - home.z));
      if (dist < from || dist > SAND_TRIPS.range || skip.has(key) || (best && dist >= best.dist) || waterCrossed(byChunk, home, x, z) >= WATER_CROSS) continue;
      best = { x, y: Math.round(y), z, dist, key };
    }
  }
  return best;
}

/** A test of sand across open water from home (WATER_CROSS cells or more on the line), for collect's sand: run 6's
 *  shore trips to the east bank left two members swimming in the river with their loads. */
export const WATER_CROSS = 2;
export function acrossWater(atlas: AtlasLike, home: { x: number; z: number }, range: number): (x: number, z: number) => boolean {
  const byChunk = new Map(atlas.near(home.x, home.z, range).map((c) => [`${c.cx},${c.cz}`, c] as const));
  return (x, z) => waterCrossed(byChunk, home, x, z) >= WATER_CROSS;
}

/** The sand the atlas knows within `range` of home (dry sand columns, SAND_DEPTH deep): the expedition range by default. */
export function sandInReach(atlas: AtlasLike, home: { x: number; z: number }, range = SAND_TRIPS.range): number {
  return atlas.near(home.x, home.z, range).reduce((t, c) => t + (c.surface?.sand ?? 0), 0) * SAND_DEPTH;
}

/** The sand a bill's sandstone takes (4 a block, every sandstone piece counted as one block). */
export const sandstoneSand = (bill: Record<string, number>): number =>
  4 * Object.entries(bill).filter(([n]) => /^(cut_|chiseled_|smooth_)?sandstone(_stairs|_slab|_wall)?$/.test(n)).reduce((t, [, q]) => t + q, 0);

/** Why no expedition goes now, or null: in a world with monsters only in the morning (time of day under 6000, a trip
 *  of some minutes back before dusk) and only within the curfew's distance. */
export function tripBarred(dist: number, timeOfDay: number | undefined, curfew: { dist: number } | null): string | null {
  if (!modeSpec().mobs) return null;
  if (curfew && dist > curfew.dist) return `the curfew keeps members within ${curfew.dist} blocks`;
  if (timeOfDay === undefined || timeOfDay >= 6000) return 'only in the morning, back before dusk';
  return null;
}
