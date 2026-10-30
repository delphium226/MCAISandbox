/**
 * More mines (#8; spec runs/2026-10-30/mines/spec.md): when the village's mine gives nothing (its stairs stopped short
 * of stone, or every level ended or capped) and the village needs stone or iron, a new mine is opened: code finds an
 * entrance near the village, off every village's work, and an idle member digs its stairs (mcMine's open_mine, mcWorld's
 * mineTick). World-free and pure: the world feeds the ground and the keep-off test. Behind MC_MORE_MINES (on since 10-30).
 */
import { rawSetting } from './settings';

/** MC_MORE_MINES=on: a new mine opened when the village's mine gives nothing and stone or iron is short. */
export const MORE_MINES = /^(on|1|true|yes)$/i.test(rawSetting('MC_MORE_MINES') ?? 'on');

/** Mines a village has at most, the first one counted; cobblestone in storage under which stone counts as short. */
export const MAX_MINES = 4, COBBLE_SHORT = 256;

/** Whether a new mine is due, and why not when it is not. */
export function moreMinesDue(s: {
  /** The current mine still gives (stairs on stone, cells left). */
  gives: boolean;
  /** Its stairs are still to be dug (a new mine's record whose dig was cut off: dug on, no new site). */
  resumable: boolean;
  cobble: number;
  /** The iron level ended with no way down, or there is none to lay (no level to start from). */
  ironStuck: boolean;
  /** Mines in the record: the current one and those before it. */
  mines: number;
  underWay: boolean;
  backoffUntil: number;
  now: number;
}): { due: boolean; why: string } {
  if (s.underWay) return { due: false, why: 'a new mine under way' };
  if (s.backoffUntil > s.now) return { due: false, why: `resting ${Math.ceil((s.backoffUntil - s.now) / 60000)} min after a failure` };
  if (s.resumable) return { due: true, why: 'the new mine\'s stairs to finish' };
  if (s.gives) return { due: false, why: 'the mine still gives' };
  if (s.mines >= MAX_MINES) return { due: false, why: `${s.mines} mines already (at most ${MAX_MINES})` };
  if (s.cobble >= COBBLE_SHORT && !s.ironStuck) return { due: false, why: `the mine gives nothing, but ${s.cobble} cobblestone in storage and iron not stuck` };
  return { due: true, why: s.cobble < COBBLE_SHORT ? `the mine gives nothing and ${s.cobble} cobblestone in storage` : 'the mine gives nothing and its iron level has no way down' };
}

/** A column's ground as the bot sees it: the top block's y, whether it is dry natural ground, tree blocks on it. */
export type Ground = { y: number; ok: boolean; trees: number } | null;
/** A block as the bot sees it (null: not loaded): stone, water or lava, open (air), sand or gravel (falls), other
 *  natural ground, or anything the mine may not dig (logs, leaves, built blocks). */
export type Deep = 'stone' | 'wet' | 'open' | 'loose' | 'other' | 'hard' | null;

/** Stair columns checked at most (dig_mine's default depth), rings searched (dig_mine's tunnels stop 90 from home: an
 *  entrance at 40 leaves them ~40 outward), and the grid. */
export const STAIRS = 24, MIN_R = 16, MAX_R = 40, GRID = 2;

/**
 * The new mine's entrance: on a GRID grid MIN_R-MAX_R from the village's home, stairs pointing away from it (the nearer
 * compass direction, so the first tunnel runs outward); the entrance and STAIRS stair columns, 3 wide, off everything
 * `takenAt` keeps; each column's ground loaded and dry, at most 3 tree blocks at the entrance, and ground over the steps
 * from the fourth on (dig_mine wants a solid ceiling there). Cheapest first (the walk from `from`, the storage hut, plus
 * the ground's rise and fall); then the stairs read down as dig_mine digs them: no water or lava in or beside a step's
 * cells, stone at a level at most `maxLevel` within STAIRS steps (7 at least). The entrance's y is its ground block's
 * (dig_mine's floor: step 1 digs it). Null with counts when none passes.
 */
export function searchMineSite(input: {
  home: { x: number; z: number };
  from: { x: number; z: number };
  maxLevel: number;
  ground: (x: number, z: number) => Ground;
  deep: (x: number, y: number, z: number) => Deep;
  takenAt: (x: number, z: number) => boolean;
  /** Most candidates read down (the stairs' blocks), cheapest first. */
  tries?: number;
}): { site: { x: number; z: number; y: number; dir: [number, number]; steps: number; level: number; cost: number } | null; why: Record<string, number> } {
  const { home, from } = input;
  const why = { taken: 0, unloaded: 0, wet: 0, trees: 0, ceiling: 0, noStone: 0 };
  const cands: Array<{ x: number; z: number; y: number; dir: [number, number]; cost: number }> = [];
  const gcache = new Map<string, Ground>();
  const g = (x: number, z: number) => {
    const k = `${x},${z}`;
    if (!gcache.has(k)) gcache.set(k, input.ground(x, z));
    return gcache.get(k)!;
  };
  for (let x = home.x - MAX_R; x <= home.x + MAX_R; x += GRID)
    for (let z = home.z - MAX_R; z <= home.z + MAX_R; z += GRID) {
      const d = Math.hypot(x - home.x, z - home.z);
      if (d < MIN_R || d > MAX_R) continue;
      const dir: [number, number] = Math.abs(x - home.x) >= Math.abs(z - home.z) ? [x > home.x ? 1 : -1, 0] : [0, z > home.z ? 1 : -1];
      const [dx, dz] = dir;
      let bad = '';
      for (let k = 0; k < STAIRS && !bad; k++)
        for (const s of [0, 1, -1]) if (input.takenAt(x + dx * k + dz * s, z + dz * k + dx * s)) { bad = 'taken'; break; }
      if (bad) { why.taken++; continue; }
      const e = g(x, z);
      if (!e) { why.unloaded++; continue; }
      if (!e.ok) { why.wet++; continue; }
      if (e.trees > 3) { why.trees++; continue; }
      let rise = 0;
      for (let k = 1; k < STAIRS && !bad; k++) {
        const c = g(x + dx * k, z + dz * k);
        if (!c) bad = 'unloaded';
        else if (!c.ok) bad = 'wet';
        // (step i stands in column i - 1; from the fourth its top cell, y - i + 3, needs ground over it: y - k + 3)
        else if (k >= 3 && c.y < e.y - k + 3) bad = 'ceiling';
        else rise += Math.abs(c.y - e.y);
      }
      if (bad) { (why as Record<string, number>)[bad]++; continue; }
      cands.push({ x, z, y: e.y, dir, cost: Math.hypot(x - from.x, z - from.z) + rise / STAIRS });
    }
  cands.sort((p, q) => p.cost - q.cost);
  for (const c of cands.slice(0, input.tries ?? 200)) {
    const [dx, dz] = c.dir;
    let found: { steps: number; level: number } | null = null, stop = false;
    for (let i = 1; i <= STAIRS && !found && !stop; i++) {
      const x = c.x + dx * (i - 1), z = c.z + dz * (i - 1), floor = c.y - i;
      const cells = [0, 1, 2, 3].map((h) => input.deep(x, floor + h, z));
      // (dig_mine: the three cells dug natural ground or open, a floor under the step, and from the fourth step a solid
      // ceiling that does not fall)
      if (cells.some((b) => b === null || b === 'wet') || cells.slice(1).some((b) => b === 'hard') || cells[0] === 'open') { stop = true; break; }
      if (i >= 4 && !['stone', 'other', 'hard'].includes(input.deep(x, floor + 4, z) ?? 'open')) { stop = true; break; }
      // (water beside a step: dig_mine's unsafe stops there)
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const h of [1, 2]) if (input.deep(x + sx, floor + h, z + sz) === 'wet') stop = true;
      if (!stop && i >= 7 && cells.slice(0, 3).every((b) => b === 'stone') && floor + 1 <= input.maxLevel) found = { steps: i, level: floor + 1 };
    }
    if (found) return { site: { ...c, ...found }, why };
    why.noStone++;
  }
  return { site: null, why };
}
