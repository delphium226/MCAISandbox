/**
 * More mines in the world (#8, MC_MORE_MINES; spec runs/2026-10-30/mines/spec.md; mineSite.ts has the trigger and the
 * search): open_mine, a chore mcWorld's mineTick gives an idle member when the village's mine gives nothing. It finds an
 * entrance near the village off every village's work (the bot's view of the ground and the blocks under it), records the
 * new mine in place of the old (kept in its `before`: every keep-off still covers it) and digs its stairs with dig_mine.
 * No hut: the stairs start in the open ground. A record whose stairs were cut off is dug on, at the same site.
 */
import { Vec3 } from 'vec3';
import type { Area, Mine, Village } from '../village';
import { villageHome } from '../village';
import { siteTaken } from '../monument';
import { MORE_MINES, STAIRS, searchMineSite, type Deep } from '../mineSite';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { FALLING, MINE_DIGGABLE, MINE_STONE } from './mcBlocks';
import { digMine, forgetMine, layIronStart, mineAreas, mineGives } from './mcMine';
import { surfaceAt, withScanTurn } from './mcBuild';
import { reach, wetAt } from './mcUtil';

/** Villages whose new mine's site is being chosen or its stairs dug (one at a time). */
const opening = new Set<string>();

/** The ground a mine's entrance and stairs take (a stopped one's too: the next site keeps off it), for the site search. */
function entranceBox(m: Mine): Area {
  const n = Math.max(m.steps, STAIRS);
  const ex = m.top.x + m.dir[0] * n, ez = m.top.z + m.dir[1] * n;
  return { x1: Math.min(m.hut.x1, ex - 1), z1: Math.min(m.hut.z1, ez - 1), x2: Math.max(m.hut.x2, ex + 1), z2: Math.max(m.hut.z2, ez + 1) };
}

/** A block under the ground as the bot sees it, for the stairs' read-down. */
function deepAt(a: BotAgent, x: number, y: number, z: number): Deep {
  const b = a.bot.blockAt(new Vec3(x, y, z));
  if (!b) return null;
  if (wetAt(a, b.position)) return 'wet';
  if (b.boundingBox === 'empty') return 'open';
  if (FALLING.has(b.name)) return 'loose';
  return MINE_STONE.has(b.name) ? 'stone' : MINE_DIGGABLE.has(b.name) ? 'other' : 'hard';
}

async function openMine(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  if (!MORE_MINES) throw new Error('open_mine: MC_MORE_MINES is off');
  const v = a.village();
  if (!v?.mine) throw new Error('open_mine: your village has no mine');
  if (opening.has(v.name)) throw new Error('open_mine: another member is opening the new mine');
  const reg = a.world.villages;
  opening.add(v.name);
  try {
    let m = v.mine;
    const resume = m.floor !== undefined && m.level === undefined && !m.stopped;
    if (!resume) {
      if (mineGives(m)) throw new Error('open_mine: the village mine still gives cobblestone');
      const site = await chooseSite(a, v, signal);
      if (!forgetMine(v.name)) throw new Error('open_mine: an iron trip is under way in the old mine; try again after it');
      const old = v.mine;
      const { before, ...rest } = old;
      m = {
        hut: { x1: site.x - 1, z1: site.z - 1, x2: site.x + 1, z2: site.z + 1 }, top: { x: site.x, z: site.z }, dir: site.dir,
        steps: 0, dug: 0, ended: [], got: {}, floor: site.y, openedBy: a.name, openedAt: Date.now(), before: [...(before ?? []), rest],
        ...(old.ironMade ? { ironMade: [...old.ironMade] } : {}), ...(old.ironGiven ? { ironGiven: [...old.ironGiven] } : {}),
      };
      v.mine = m;
      // (the mine trend reads the new record from 0)
      if (v.mineFlow) v.mineFlow.dugSeen = 0;
      reg.note(v, `${a.name} opened a new mine at ${site.x},${site.y},${site.z}, its stairs heading ${compass(site.dir)} (the old one gives nothing: ${short(old.stopped ?? 'spent')})`);
      reg.save();
      console.log(`[mine] ${v.name}: ${a.name} opens mine ${(m.before ?? []).length + 1} at ${site.x},${site.y},${site.z} heading ${compass(site.dir)}: stairs ~${site.steps} steps to stone at y=${site.level} (cost ${site.cost.toFixed(1)})`);
    } else console.log(`[mine] ${v.name}: ${a.name} digs on the new mine's stairs at ${m.top.x},${m.floor},${m.top.z} (${m.steps} steps so far)`);
    // To the column behind the entrance (dig_mine stands there for the first step)
    await reach(a, new Vec3(m.top.x - m.dir[0] + 0.5, m.floor! + 1, m.top.z - m.dir[1] + 0.5), 2, signal, 120000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const r = await digMine(a, { max_depth: STAIRS }, signal);
    console.log(`[mine] ${v.name}: ${a.name}: ${r}`);
    if (m.level === undefined) throw new Error(`open_mine: ${m.stopped ? `the new mine's stairs stopped: ${m.stopped}` : r}`);
    // (its iron level's start now, beside the bottom step, before the miners' tunnels take every side of it)
    if (!m.iron) {
      layIronStart(v, m, reg);
      console.log(`[mine] ${v.name}: the new mine's iron stairs ${m.iron!.finished ? `have no start (${m.iron!.finished})` : `start at ${m.iron!.x},${m.iron!.y},${m.iron!.z}`}`);
    }
    return `opened a new mine: ${r}`;
  } finally {
    opening.delete(v.name);
  }
}

/** The new mine's site, from the bot's view (the search runs in a scan turn: one at a time across bots). */
async function chooseSite(a: BotAgent, v: Village, signal: AbortSignal) {
  const home = villageHome(v);
  if (!home) throw new Error('open_mine: the village has no home');
  const hut = v.storageHut;
  const from = hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : home;
  const all = [...a.world.villages.villages.values()];
  const mines = all.flatMap((o) => (o.mine ? [o.mine, ...(o.mine.before ?? [])] : []));
  const boxes = [...all.flatMap((o) => (o.mine ? mineAreas(o.mine) : [])), ...mines.map(entranceBox)];
  const takenAt = siteTaken(v, all.filter((o) => o !== v), boxes, Date.now(), a.name);
  // (the tunnels' level: 6 below the lowest pad, as dig_mine wants on pads, #84)
  const pads = v.plots.filter((q) => q.pads || q.pad);
  const maxLevel = pads.length ? Math.min(...pads.map((q) => q.y)) - 6 : 1000;
  const yHint = v.plots[0]?.y ?? Math.floor(a.bot.entity.position.y);
  const r = await withScanTurn(signal, () => searchMineSite({
    home, from, maxLevel, takenAt,
    ground: (x, z) => {
      const c = surfaceAt(a, x, z, yHint);
      return c ? { y: c.y, ok: !c.liquid && MINE_DIGGABLE.has(c.block), trees: c.trees } : null;
    },
    deep: (x, y, z) => deepAt(a, x, y, z),
  }));
  if (!r.site) {
    const why = Object.entries(r.why).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`[mine] ${v.name}: no site for a new mine (${why})`);
    throw new Error(`open_mine: no site for a new mine within reach of the village (${why})`);
  }
  return r.site;
}

const compass = ([dx, dz]: [number, number]) => (dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north');
const short = (s: string) => (s.length > 100 ? `${s.slice(0, 97)}...` : s);

export const MORE_MINE_SKILLS: Record<string, McSkill> = {
  open_mine: { run: openMine },
};
