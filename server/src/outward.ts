/**
 * #138 (MC_GROW_OUTWARD, off by default): the village grows outward building by building on a village laid out on pads
 * (#84, MC_PAD_PER_BUILDING), instead of neighbourhoods on flat plots found further off. Pure: the ground and what is
 * taken come in as functions, so the offline check (scripts/checks/grow_outward.mts) runs it on fixtures and
 * lay_out_houses (mcBuild.ts) on the world.
 *
 * Each building in turn (GDMC's slope-scored placement, runs/2026-10-24/layout-measure/measure.py's place()): every
 * position in `area`, the door turned toward the meeting point, its pad (the footprint and a 1-block ring) at its
 * median ground, clamped as prepare_site clamps the first pads' levels (home -3..+6, within its gap + 1 of every pad
 * beside it). The score is the pad's cut and fill, the halo's work out to 3 blocks, 1.5 a block of the door's distance
 * from the meeting point and 4 a block of level more than 2 from home. A pad and the ring round it keep off everything
 * taken (pads, buildings, fields, paths, the mine, other villages' ground) and off water; a pad over a drop of more
 * than 8 is refused. Each building placed is taken for the next.
 */
import { rawSetting } from './settings';
import type { Area } from './village';

// (on by default since 10-26, the user's after test train 6, F323; =off for growth inside the plot)
export const GROW_OUTWARD = !/^(off|0|false|no)$/i.test(rawSetting('MC_GROW_OUTWARD') ?? 'on');

/** A building to place, as drawn: its size and its door (doorOf: the door cell and the way it opens). */
export interface OutwardItem {
  name: string;
  width: number;
  depth: number;
  door: [number, number];
  out: [number, number];
}

export interface OutwardInput {
  /** Where pads may go. */
  area: Area;
  /** The ground's top at a column, or null (water, unloaded, nothing within reach). */
  ground: (x: number, z: number) => number | null;
  /** Columns no pad (nor the ring kept round it) may cover. */
  taken: (x: number, z: number) => boolean;
  /** The meeting point (or the storage hut): doors turn toward it, distance is counted from it. */
  hub: { x: number; z: number };
  /** G7 (MC_TALK): a place a person asked for; distance is counted from it instead of the hub. */
  near?: { x: number; z: number };
  /** The home level (the storage hut's pad). */
  home: number;
  /** The pads already standing, with their levels (the levels rule). */
  pads: Array<Area & { y: number }>;
  items: OutwardItem[];
}

export interface OutwardPlace {
  name: string;
  /** The footprint as built (turned), and its centre and turn as build_design takes them. */
  x1: number; z1: number; x2: number; z2: number;
  x: number; z: number; rotate: number;
  /** The cell outside the door on the pad's ring, where its path starts. */
  door: { x: number; z: number };
  /** The pad's level. */
  y: number;
  cost: number;
}

const HALO = 3;

/** A design cell (i, j) and a direction turned clockwise `rot` quarter turns, as build_design turns a building. */
function turn(i: number, j: number, w: number, d: number, rot: number): [number, number] {
  let [u, v, ww, dd] = [i, j, w, d];
  for (let r = 0; r < rot; r++) [u, v, ww, dd] = [dd - 1 - v, u, dd, ww];
  return [u, v];
}
function turnDir(ox: number, oz: number, rot: number): [number, number] {
  let [a, b] = [ox, oz];
  for (let r = 0; r < rot; r++) [a, b] = [-b, a];
  return [a, b];
}

export function placeOutward(input: OutwardInput): Array<OutwardPlace | { name: string; why: string }> {
  const { area, ground, hub, home, items } = input;
  const W = area.x2 - area.x1 + 1, D = area.z2 - area.z1 + 1;
  // The grid: ground (NaN where none) and taken, with prefix sums of taken and of no-ground for O(1) rectangle tests
  const G = new Float64Array(W * D);
  const T = new Uint8Array(W * D);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const g = ground(area.x1 + x, area.z1 + z);
      G[z * W + x] = g ?? NaN;
      T[z * W + x] = input.taken(area.x1 + x, area.z1 + z) ? 1 : 0;
    }
  const pads = [...input.pads];
  const sums = () => {
    const S = new Int32Array((W + 1) * (D + 1)), N = new Int32Array((W + 1) * (D + 1));
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const i = (z + 1) * (W + 1) + x + 1;
        S[i] = T[z * W + x] + S[i - 1] + S[i - W - 1] - S[i - W - 2];
        N[i] = (Number.isNaN(G[z * W + x]) ? 1 : 0) + N[i - 1] + N[i - W - 1] - N[i - W - 2];
      }
    return { S, N };
  };
  // (rectangle in grid coordinates, inclusive; outside the grid counts as taken)
  const count = (P: Int32Array, x1: number, z1: number, x2: number, z2: number) => {
    if (x1 < 0 || z1 < 0 || x2 >= W || z2 >= D) return 1;
    const at = (x: number, z: number) => P[z * (W + 1) + x];
    return at(x2 + 1, z2 + 1) - at(x1, z2 + 1) - at(x2 + 1, z1) + at(x1, z1);
  };
  const gap = (p: Area, q: Area) => Math.max(0, Math.max(q.x1 - p.x2, p.x1 - q.x2, q.z1 - p.z2, p.z1 - q.z2) - 1);
  const out: Array<OutwardPlace | { name: string; why: string }> = [];
  for (const it of items) {
    const { S, N } = sums();
    let best: OutwardPlace | null = null;
    for (let rot = 0; rot < 4; rot++) {
      const w = rot % 2 ? it.depth : it.width, d = rot % 2 ? it.width : it.depth;
      const [di, dj] = turn(it.door[0], it.door[1], it.width, it.depth, rot);
      const [ox, oz] = turnDir(it.out[0], it.out[1], rot);
      // (the pad's grid rectangle: footprint at gx..gx+w-1 plus the ring; the ring kept clear round it one further)
      for (let gz = 2; gz + d + 1 < D; gz++)
        for (let gx = 2; gx + w + 1 < W; gx++) {
          if (count(S, gx - 2, gz - 2, gx + w + 1, gz + d + 1) || count(N, gx - 1, gz - 1, gx + w, gz + d)) continue;
          const x1 = area.x1 + gx, z1 = area.z1 + gz, x2 = x1 + w - 1, z2 = z1 + d - 1;
          // The door faces the hub: the way it opens points at it (a quarter of the turns at most per spot)
          const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
          if (ox * (hub.x - cx) + oz * (hub.z - cz) <= 0) continue;
          // Its step: out of the door until off the footprint (a door set back in the footprint walks out)
          let sx = x1 + di, sz = z1 + dj;
          while (sx >= x1 && sx <= x2 && sz >= z1 && sz <= z2) {
            sx += ox;
            sz += oz;
          }
          // The level: the pad's median ground, clamped by the levels rule
          const hs: number[] = [];
          for (let z = gz - 1; z <= gz + d; z++) for (let x = gx - 1; x <= gx + w; x++) hs.push(G[z * W + x]);
          hs.sort((a, b) => a - b);
          const pad = { x1: x1 - 1, z1: z1 - 1, x2: x2 + 1, z2: z2 + 1 };
          let lo = home - 3, hi = home + 6;
          for (const q of pads) {
            const g = gap(pad, q) + 1;
            lo = Math.max(lo, q.y - g);
            hi = Math.min(hi, q.y + g);
          }
          if (lo > hi) continue;
          const y = Math.max(lo, Math.min(hi, hs[hs.length >> 1]));
          if (hs[0] < y - 8) continue;
          let cost = 0;
          for (const g of hs) cost += Math.abs(g - y);
          // (the halo's work, ring by ring: what stands more than k from the level k out)
          for (let k = 1; k <= HALO; k++)
            for (let z = gz - 1 - k; z <= gz + d + k; z++)
              for (let x = gx - 1 - k; x <= gx + w + k; x++) {
                if (z > gz - 1 - k && z < gz + d + k && x > gx - 1 - k && x < gx + w + k) continue;
                if (x < 0 || z < 0 || x >= W || z >= D) continue;
                const g = G[z * W + x];
                if (!Number.isNaN(g)) cost += Math.max(0, Math.abs(g - y) - k);
              }
          cost += 1.5 * Math.hypot(sx - (input.near ?? hub).x, sz - (input.near ?? hub).z) + 4 * Math.max(0, Math.abs(y - home) - 2);
          if (!best || cost < best.cost)
            best = { name: it.name, x1, z1, x2, z2, x: x1 + Math.floor(w / 2), z: z1 + Math.floor(d / 2), rotate: rot * 90, door: { x: sx, z: sz }, y, cost: Math.round(cost * 10) / 10 };
        }
    }
    if (!best) {
      out.push({ name: it.name, why: `no free ground near the village for ${it.name} (${it.width}x${it.depth})` });
      continue;
    }
    out.push(best);
    pads.push({ x1: best.x1 - 1, z1: best.z1 - 1, x2: best.x2 + 1, z2: best.z2 + 1, y: best.y });
    // (taken for the next: the pad and the ring kept round it, and the door step's way out)
    for (let z = best.z1 - 2; z <= best.z2 + 2; z++)
      for (let x = best.x1 - 2; x <= best.x2 + 2; x++)
        if (x >= area.x1 && x <= area.x2 && z >= area.z1 && z <= area.z2) T[(z - area.z1) * W + x - area.x1] = 1;
  }
  return out;
}
