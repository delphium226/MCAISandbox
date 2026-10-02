/**
 * Sites from the atlas (plan step 2.3): where to look for a village site, judged on the shared atlas's chunk summaries
 * (mcAtlas.ts) before any bot walks there. The atlas only ranks areas: its 4x4-block cells (mean height, what covers
 * most of the cell) are too coarse for find_site's 2-4 block slope or a single wet or built column, so find_site walks
 * to the best few and lets its column survey (surveyGround, bestSite) choose the square itself (decisions log 10-02).
 *
 * A candidate is a square of whole cells: all but a tenth of them known, none water, lava or built, its cell means
 * within ATLAS_RANGE of each other, off every village's ground, within reach. It is ranked by its height range, trees
 * standing on it, distance, and what grows and lies around it as collect counts it: logs within 48 blocks and surface
 * sand within 96, from chunks whose ground is not more than 16 below the site (collect's floor; F96: sand 30 below a
 * village counted as there).
 */
import type { ChunkSummary } from './mcAtlas';

interface Area { x1: number; z1: number; x2: number; z2: number }

export interface AtlasSite {
  /** Centre and level (the median of the cell means). */
  x: number;
  z: number;
  y: number;
  /** Spread of the cell means; tree cells on the square; known cells of all. */
  range: number;
  trees: number;
  known: number;
  /** Log blocks in chunks within 48 blocks, surface sand in chunks within 96 (both at the site's height or above). */
  logs: number;
  sand: number;
  dist: number;
  score: number;
}

/** Most a square's cell means may spread (the column survey then holds the site to 2-4). */
const ATLAS_RANGE = 5;
/** Logs and sand that make ground good for a survival village: below these a candidate scores worse. */
const WANT_LOGS = 150, WANT_SAND = 30;

export function atlasSites(chunks: Map<string, ChunkSummary>, opts: {
  x: number; z: number; size: number; radius: number;
  home: { x: number; z: number } | null; homeRange: number; taken: Area[]; survival: boolean; count?: number;
}): AtlasSite[] {
  const { x: ox, z: oz, size, radius, home, homeRange, taken, survival } = opts;
  const k = Math.ceil(size / 4);
  // The cell grid around the origin (cell = 4x4 blocks, global cell coordinates x >> 2)
  const reach = radius + size;
  const c0x = (ox - reach) >> 2, c0z = (oz - reach) >> 2, n = Math.ceil((2 * reach) / 4) + 1;
  const h = new Float32Array(n * n).fill(NaN);
  const letter = new Uint8Array(n * n); // 0 unknown, 1 usable, 2 trees, 3 water/lava, 4 built or unusual
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const cx = c0x + i, cz = c0z + j;
      const s = chunks.get(`${cx >> 2},${cz >> 2}`);
      if (!s) continue;
      const cell = (cz & 3) * 4 + (cx & 3);
      const ch = s.s[cell] ?? ' ', y = s.h[cell];
      if (ch === ' ' || y === null || y === undefined) continue;
      h[j * n + i] = y;
      letter[j * n + i] = ch === '~' || ch === '^' ? 3 : ch === 'b' ? 4 : ch === 'T' ? 2 : 1;
    }
  const pad = taken.map((q) => ({ x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2 }));
  // Resources around a chunk, for a level: memoised by chunk and level
  const res = new Map<string, { logs: number; sand: number }>();
  const around = (x: number, z: number, level: number) => {
    const key = `${x >> 4},${z >> 4},${level}`;
    let r = res.get(key);
    if (r) return r;
    r = { logs: 0, sand: 0 };
    const cx = x >> 4, cz = z >> 4;
    for (let dz = -7; dz <= 7; dz++)
      for (let dx = -7; dx <= 7; dx++) {
        const s = chunks.get(`${cx + dx},${cz + dz}`);
        if (!s?.y || s.y[1] < level - 16) continue;
        const d = Math.hypot(dx * 16, dz * 16);
        if (d <= 48) r.logs += Object.values(s.logs).reduce((t, q) => t + q, 0);
        if (d <= 96) r.sand += (s.surface.sand ?? 0) + (s.surface.red_sand ?? 0);
      }
    res.set(key, r);
    return r;
  };
  const out: AtlasSite[] = [];
  for (let j = 0; j + k <= n; j++)
    for (let i = 0; i + k <= n; i++) {
      const x = (c0x + i) * 4 + Math.floor((k * 4) / 2), z = (c0z + j) * 4 + Math.floor((k * 4) / 2);
      const dist = Math.hypot(x - ox, z - oz);
      if (dist > radius || (home && Math.hypot(x - home.x, z - home.z) > homeRange)) continue;
      const x1 = (c0x + i) * 4, z1 = (c0z + j) * 4, x2 = x1 + k * 4 - 1, z2 = z1 + k * 4 - 1;
      if (pad.some((q) => q.x1 <= x2 && q.x2 >= x1 && q.z1 <= z2 && q.z2 >= z1)) continue;
      let known = 0, trees = 0, lo = Infinity, hi = -Infinity, bad = false;
      const ys: number[] = [];
      for (let b = 0; b < k && !bad; b++)
        for (let a = 0; a < k; a++) {
          const idx = (j + b) * n + i + a, l = letter[idx];
          if (!l) continue;
          if (l >= 3) {
            bad = true;
            break;
          }
          known++;
          if (l === 2) trees++;
          const y = h[idx];
          ys.push(y);
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      if (bad || known < 0.9 * k * k || hi - lo > ATLAS_RANGE) continue;
      ys.sort((u, w) => u - w);
      const y = Math.round(ys[ys.length >> 1]);
      const r = survival ? around(x, z, y) : { logs: 0, sand: 0 };
      const score = (hi - lo) * 6 + trees * 0.5 + dist * 0.1
        + (survival ? Math.max(0, WANT_LOGS - r.logs) * 0.3 + (r.sand ? Math.max(0, WANT_SAND - r.sand) * 0.3 : 20) : 0);
      out.push({ x, z, y, range: hi - lo, trees, known: Math.round((known / (k * k)) * 100) / 100, logs: r.logs, sand: r.sand, dist: Math.round(dist), score });
    }
  out.sort((u, w) => u.score - w.score);
  // The best few, at least 48 blocks apart (the column survey around one covers its neighbours)
  const picked: AtlasSite[] = [];
  for (const c of out) {
    if (picked.length >= (opts.count ?? 3)) break;
    if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= 48)) picked.push(c);
  }
  return picked;
}
