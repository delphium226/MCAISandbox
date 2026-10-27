/**
 * The gem cutter (#162 tier 3, chain C; MC_GEODE, off): the cathedral's calcite and amethyst blocks from one geode worked
 * from outside (runs/2026-10-27/tier3/spec.md 3C). A geode is a hollow ball (smooth basalt, calcite, a lining of amethyst
 * with budding amethyst, air); members who dug into one fell in and could not path out (#133, T2d). So:
 * - the geode is the nearest one to an iron level's stairs foot (the level nearest y 24 first, geodes being commonest at
 *   y 16-31), found by its amethyst on the first trip and kept on the monument (`gem`);
 * - a tunnel runs level from the stairs' foot toward its centre and stops at the shell (or at water, lava or an opening
 *   onto the hollow), its floor filled where it is open;
 * - from the tunnel's end the cutter digs the shell's blocks in reach, nearest first (real digs, Paper's times), never
 *   budding amethyst nor the cells under the tunnel; each dug block's drop is given to it, and a dug cell that borders
 *   the hollow is filled with cobblestone at once (charged), so the tunnel never opens onto the ball;
 * - once the cells in reach are used up, the next trip's tunnel steps on round the shell by one cell (`end` moved
 *   sideways), the far side never reached.
 * The geode guard (MC_GEODE_GUARD) keeps every path out of the shell; these digs go through mineBlock, which it does not
 * touch.
 */
import { Vec3 } from 'vec3';
import type { Village } from '../village';
import { m3 } from '../monument';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { GEODE_SHELL } from './mcGeode';
import { ironLevelCells, ironLevelFeet, walkInMine, walkToIronLevel } from './mcMine';
import { STORAGE_SKILLS, withdrawItems } from './mcStorage';
import { mineBlock } from './mcSurvival';
import { checkAbort, goals, nearestBlocks, walk } from './mcUtil';
import { timeScale } from './mcRules';

/** The geode worked, on the monument record (centre, the lining's radius, the level its tunnel starts from). */
export interface GemRecord {
  x: number; y: number; z: number; r: number; level: number;
  /** The level's tunnel cell the geode's tunnel starts from. */
  start: [number, number, number];
  /** The tunnel's cells dug so far (feet cells), its end the last. */
  tunnel: Array<[number, number, number]>;
  trips: number; got: Record<string, number>; fills: number;
  /** Why the last tunnel stopped short, if it did. */
  stopped?: string;
}

/** The blocks taken from the shell (budding amethyst never). */
export const GEM_TAKE = ['smooth_basalt', 'calcite', 'amethyst_block'];
/** How far the gem cutter digs from where it stands (eye to the block's centre), and the longest tunnel. */
const REACH = 4.2, TUNNEL_MAX = 32;

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A geode from its amethyst (lining blocks and budding): the cluster round the nearest, its centre and lining radius. */
export function geodeOf(points: Array<{ x: number; y: number; z: number }>, from: { x: number; y: number; z: number }): { x: number; y: number; z: number; r: number } | null {
  if (!points.length) return null;
  const near = [...points].sort((p, q) => dist(p, from) - dist(q, from))[0];
  const ball = points.filter((p) => dist(p, near) <= 10);
  const c = { x: ball.reduce((t, p) => t + p.x, 0) / ball.length, y: ball.reduce((t, p) => t + p.y, 0) / ball.length, z: ball.reduce((t, p) => t + p.z, 0) / ball.length };
  const r = Math.max(...ball.map((p) => dist(p, c)));
  return { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 10) / 10, r: Math.round(r * 10) / 10 };
}

/** The geode to work: of the atlas's budding amethyst sightings ([count, x, y, z]), the one nearest (across) to a cell of
 *  an iron level's tunnels within 5 of its y, and that cell. */
export function pickGeode(seen: Array<[number, number, number, number]>, levels: Array<{ k: number; y: number; cells: Array<{ x: number; y: number; z: number }> }>): { k: number; from: { x: number; y: number; z: number }; at: [number, number, number] } | null {
  let best: { k: number; from: { x: number; y: number; z: number }; at: [number, number, number]; d: number } | null = null;
  for (const [, x, y, z] of seen)
    for (const l of levels) {
      if (Math.abs(y - l.y) > 5) continue;
      for (const c of l.cells) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (!best || d < best.d) best = { k: l.k, from: c, at: [x, y, z], d };
      }
    }
  return best && best.d <= TUNNEL_MAX + 8 ? { k: best.k, from: best.from, at: best.at } : null;
}

/** The tunnel's feet cells from `from` (level, along the longer axis first) toward the geode, ending one cell outside its
 *  shell (the lining radius plus calcite and basalt); at most TUNNEL_MAX. */
export function tunnelPath(from: { x: number; y: number; z: number }, g: { x: number; y: number; z: number; r: number }): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let x = from.x, z = from.z;
  const y = from.y, stop = g.r + 2.5;
  const gx = Math.round(g.x), gz = Math.round(g.z);
  const xFirst = Math.abs(gx - x) >= Math.abs(gz - z);
  while (out.length < TUNNEL_MAX) {
    const near = (u: number, w: number) => dist({ x: u, y: y + 0.5, z: w }, g) <= stop;
    let nx = x, nz = z;
    if (xFirst ? x !== gx : z === gz) nx += Math.sign(gx - x); else nz += Math.sign(gz - z);
    if (nx === x && nz === z) break;
    if (near(nx, nz)) break;
    x = nx; z = nz;
    out.push([x, y, z]);
  }
  return out;
}

/** Whether a cell is in the geode's hollow (inside the lining). */
export const inHollow = (g: { x: number; y: number; z: number; r: number }, p: { x: number; y: number; z: number }) => dist({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, g) < g.r - 0.3;

const NB: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const OPEN = /^(air|cave_air|small_amethyst_bud|medium_amethyst_bud|large_amethyst_bud|amethyst_cluster)$/;

/** A cell filled with cobblestone by command, charged to the bot (false when it carries none). */
async function fill(a: BotAgent, p: Vec3): Promise<boolean> {
  const rcon = a.world.rcon;
  if ((await rcon.take(a.name, 'cobblestone', 1)) < 1) return false;
  await rcon.command(`setblock ${p.x} ${p.y} ${p.z} minecraft:cobblestone`);
  return true;
}

/** work_geode: one trip to the geode for `item` (calcite or amethyst_block), `want` at most, `minutes` of digging. */
async function workGeode(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v: Village | undefined = a.village();
  const m = v?.monument;
  if (!v || !m || !m3(m).accents) throw new Error('work_geode: the village has no monument wanting the geode\'s accents (MC_GEODE off)');
  const item = String(args.item ?? 'calcite'), want = Math.max(1, Number(args.want ?? 64));
  const until = Date.now() + (Number(args.minutes ?? 5) * 60000) / timeScale();
  const rec = m3(m) as { gem?: GemRecord };
  const reg = a.world.villages, rcon = a.world.rcon;
  const feet = ironLevelFeet(v.mine);
  if (!feet.length) throw new Error('work_geode: the village has no iron level to start a tunnel from');
  // 1. Cobblestone for the fills (the yard's own: the tunnel's floor and the seal)
  await withdrawItems(a, v, { cobblestone: 32 }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  // 2. The geode (first trip): the atlas's nearest budding amethyst to an iron level's tunnels, within 5 of its y; then
  // down to that level and along its tunnel to the nearest cell, where the cutter reads the ball from its amethyst
  let level = rec.gem?.level, from = rec.gem?.start;
  if (!rec.gem) {
    const hut = v.mine?.hut;
    const seen = (hut ? a.world.atlas.near((hut.x1 + hut.x2) / 2, (hut.z1 + hut.z2) / 2, 160) : []).flatMap((c) => (c.geode ? [c.geode] : []));
    const tried = (rec as { gemTried?: string[] }).gemTried ??= [];
    const levels = feet.map((f) => ({ k: f.k, y: f.y, cells: [{ x: f.x, y: f.y, z: f.z }, ...ironLevelCells(v.mine, f.k)] }));
    const pick = pickGeode(seen.filter((x) => !tried.includes(`${x[1]},${x[2]},${x[3]}`)), levels);
    if (!pick) throw new Error(`work_geode: no geode seen within 5 blocks of an iron level's height near the mine (${seen.length} seen in all, ${tried.length} tried)`);
    level = pick.k;
    from = [pick.from.x, pick.from.y, pick.from.z];
    tried.push(`${pick.at[0]},${pick.at[1]},${pick.at[2]}`);
    reg.save();
  }
  const foot = feet.find((f) => f.k === level) ?? feet[0];
  if (!(await walkToIronLevel(a, v, foot.k, signal))) throw new Error(`work_geode: could not get down to the iron level at y ${foot.y}`);
  await walkInMine(a, new Vec3(from![0] + 0.5, from![1], from![2] + 0.5), 1.5, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  if (!rec.gem) {
    const ids = ['budding_amethyst', 'amethyst_block'].map((n) => a.bot.registry.blocksByName[n]?.id).filter((x): x is number => x !== undefined);
    const here = a.bot.entity.position.floored();
    const pts = nearestBlocks(a, ids, 24, 400, undefined, { min: here.y - 14, max: here.y + 14 });
    const g = geodeOf(pts, here);
    if (!g) throw new Error(`work_geode: no geode within 24 of the iron level's tunnel at ${here.x},${here.y},${here.z}`);
    rec.gem = { ...g, level: foot.k, start: from!, tunnel: [], trips: 0, got: {}, fills: 0 };
    reg.note(v, `${a.name} found a geode by the iron mine at ${Math.round(g.x)},${Math.round(g.y)},${Math.round(g.z)} for the cathedral's calcite and amethyst`);
    console.log(`[geode] ${v.name}: ${a.name} found a geode at ${g.x},${g.y},${g.z} (lining radius ${g.r}, ${pts.length} amethyst seen) from the level at y ${foot.y}, its tunnel from ${from!.join(',')}`);
  }
  const g = rec.gem;
  g.trips++;
  reg.save();
  // 3. The tunnel: on from its end (or the stairs' foot), level, to the shell
  const start = g.tunnel.at(-1) ?? g.start;
  const path = g.tunnel.length ? [] : tunnelPath({ x: g.start[0], y: g.start[1], z: g.start[2] }, g);
  for (const [x, y, z] of g.tunnel) await walk(a, new goals.GoalBlock(x, y, z), 'the geode tunnel', signal, 60000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  let stopped = '';
  for (const [x, y, z] of path) {
    checkAbort(signal);
    if (Date.now() > until) { stopped = 'time'; break; }
    const cells = [new Vec3(x, y, z), new Vec3(x, y + 1, z)];
    const block = (p: Vec3) => a.bot.blockAt(p);
    if (cells.some((p) => !block(p))) { stopped = 'not loaded'; break; }
    if (cells.some((p) => GEODE_SHELL.includes(block(p)!.name))) break;
    // (water, lava or the hollow beside a cell: the tunnel stops a cell short)
    const wet = cells.some((p) => NB.some(([dx, dy, dz]) => { const n = block(p.offset(dx, dy, dz)); return !!n && (/water|lava/.test(n.name) || (OPEN.test(n.name) && inHollow(g, p.offset(dx, dy, dz)))); }));
    if (wet) { stopped = 'water, lava or the hollow beside it'; break; }
    for (const p of cells) if (block(p)!.boundingBox === 'block') await mineBlock(a, p, signal, true, 60000, false);
    const under = new Vec3(x, y - 1, z);
    if (block(under)?.boundingBox !== 'block' && !(await fill(a, under))) { stopped = 'no cobblestone for its floor'; break; }
    await walk(a, new goals.GoalBlock(x, y, z), 'the geode tunnel', signal, 30000);
    g.tunnel.push([x, y, z]);
    reg.save();
  }
  if (stopped) g.stopped = stopped;
  const end = g.tunnel.at(-1) ?? start;
  // 4. The shell's blocks in reach, nearest first; a cell that opens onto the hollow filled at once
  const eye = a.bot.entity.position.offset(0, 1.62, 0);
  const tunnelSet = new Set(g.tunnel.flatMap(([x, y, z]) => [`${x},${y - 1},${z}`, `${x},${y},${z}`, `${x},${y + 1},${z}`]));
  const ids = GEM_TAKE.map((n) => a.bot.registry.blocksByName[n]?.id).filter((x): x is number => x !== undefined);
  const near = nearestBlocks(a, ids, REACH + 1, 200).filter((p) => eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH && !tunnelSet.has(`${p.x},${p.y},${p.z}`) && !tunnelSet.has(`${p.x},${p.y + 1},${p.z}`));
  const took: Record<string, number> = {};
  let fills = 0;
  for (const p of near) {
    checkAbort(signal);
    if (Date.now() > until || (took[item] ?? 0) >= want) break;
    const b = a.bot.blockAt(p);
    if (!b || !GEM_TAKE.includes(b.name)) continue;
    await mineBlock(a, p, signal, true, 60000, false).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    if (a.bot.blockAt(p)?.name === b.name) continue;
    await rcon.command(`kill @e[type=item,x=${p.x + 0.5},y=${p.y + 0.5},z=${p.z + 0.5},distance=..1.5]`).catch(() => '');
    await rcon.give(a.name, b.name, 1);
    took[b.name] = (took[b.name] ?? 0) + 1;
    if (NB.some(([dx, dy, dz]) => { const q = p.offset(dx, dy, dz); const n = a.bot.blockAt(q); return !!n && OPEN.test(n.name) && inHollow(g, q); })) {
      if (await fill(a, p)) fills++;
      else break;
    }
  }
  for (const [n, q] of Object.entries(took)) g.got[n] = (g.got[n] ?? 0) + q;
  g.fills += fills;
  // (nothing left in reach: the next trip's tunnel steps on round the shell, a cell to the side of its end)
  if (!near.length && g.tunnel.length) {
    const [ex, ey, ez] = end;
    const out = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [ex + dx, ey, ez + dz] as [number, number, number])
      .filter(([x, y, z]) => !tunnelSet.has(`${x},${y},${z}`) && dist({ x, y: y + 0.5, z }, g) > g.r + 2.4)
      .sort((p, q) => dist({ x: p[0], y: p[1], z: p[2] }, g) - dist({ x: q[0], y: q[1], z: q[2] }, g))[0];
    if (out) g.tunnel.push(out);
  }
  reg.save();
  // 5. Home: everything deposited (the yard claims it from storage on the next look)
  const was = a.memory.monumentGather;
  a.memory.monumentGather = item;
  try {
    await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (!/^not carrying anything/.test(e.message)) throw e;
    });
  } finally {
    if (was === undefined) delete a.memory.monumentGather;
    else a.memory.monumentGather = was;
  }
  const line = Object.entries(took).map(([n, q]) => `${q} ${n}`).join(', ') || 'nothing';
  console.log(`[geode] ${v.name}: ${a.name} trip ${g.trips}: tunnel ${g.tunnel.length} cells${stopped ? ` (stopped: ${stopped})` : ''}, took ${line}, ${fills} cells sealed; ${near.length} shell blocks were in reach; in all ${Object.entries(g.got).map(([n, q]) => `${q} ${n}`).join(', ')}`);
  return `worked the geode by the iron mine: took ${line}${fills ? `, sealed ${fills} cells onto its hollow` : ''}${stopped ? `; the tunnel stopped: ${stopped}` : ''}`;
}

export const GEM_SKILLS: Record<string, McSkill> = {
  work_geode: { run: workGeode },
};
