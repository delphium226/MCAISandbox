/**
 * #225 (MC_BOWS_FIRST, on; acts only with MC_BOWS where monsters fight): the bow and arrow supply before the wall (the
 * user's, 11-05). Arrows take flint, which only the merchant sold: a flint trip digs gravel (collect's own rules: dry,
 * within the village's range, inside the curfew's band at night) and breaks it again and again where the member stands,
 * placing it back each time, until flint drops (one in ten). Shot arrows that lie where they fell are picked up after the
 * fight (they despawn a minute after they land) and on a sweep by day while any lie near the spots the village shot from.
 * Making bows and arrows, the flint trip and the sweep rank above every wall job (wall work: 400, 150 urgent, weight 2).
 */
import { Vec3 } from 'vec3';
import type { Entity } from 'prismarine-entity';
import type { BotAgent } from './botAgent';
import { rawSetting } from '../settings';
import { bowsOn } from './mcArchery';
import { storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, mineBlock, placeAt } from './mcSurvival';
import { at, checkAbort, goals, sleep, walk, wetAt } from './mcUtil';

const flagOn = (name: string) => !/^(off|0|false|no)$/i.test(rawSetting(name) ?? 'on');
export const BOWS_FIRST_FLAG = flagOn('MC_BOWS_FIRST');
/** The bow supply first: bows on (monsters that fight) and the flag. */
export const bowsFirst = (): boolean => BOWS_FIRST_FLAG && bowsOn();
/** The bow supply's rank and weight: above the wall's 150 (urgent) and its weight 2. */
export const BOW_RANK = 140, BOW_NW = 2.5;
/** The arrows the village keeps (BOW_GOODS' target) and the most flint one trip brings. */
export const ARROW_KEEP = 64, FLINT_TRIP_MAX = 8;
/** Gravel breaks to flint one time in ten (the jar's gravel loot table without fortune). */
export const FLINT_CHANCE = 0.1;

/** The flint the arrow stock wants beyond what storage holds and what is on the way (`going`): one flint makes 4 arrows. */
export function flintShort(store: Record<string, number>, going = 0): number {
  const arrows = store.arrow ?? 0;
  if (arrows >= ARROW_KEEP) return 0;
  return Math.max(0, Math.ceil((ARROW_KEEP - arrows) / 4) - (store.flint ?? 0) - going);
}

export const flintCounts = { trips: 0, digs: 0, flint: 0, gravel: 0, picked: 0, sweeps: 0, sweepPicked: 0 };

const carried = (a: BotAgent, name: string) => a.bot.inventory.items().filter((it) => it.name === name).reduce((n, it) => n + it.count, 0);

/** A cell beside the bot to knap in: air at its level and above, solid under it, dry. */
function knapCell(a: BotAgent): Vec3 | null {
  const p = a.bot.entity.position.floored();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const q = p.offset(dx, 0, dz);
    const b = a.bot.blockAt(q), up = a.bot.blockAt(q.offset(0, 1, 0)), under = a.bot.blockAt(q.offset(0, -1, 0));
    if (!b || !up || !under) continue;
    if (!/^(air|cave_air)$/.test(b.name) || !/^(air|cave_air)$/.test(up.name)) continue;
    if (under.boundingBox !== 'block' || /fence|wall|gate|chest|farmland|slab|stairs/.test(under.name)) continue;
    if (wetAt(a, q)) continue;
    return q;
  }
  return null;
}

/**
 * flint_trip (a chore, not in TOOLS): `count` flint into the inventory. Stored gravel first, then gravel dug by collect for
 * what is short (about one gravel for each flint: a gravel that drops gravel is placed and broken again), then knapped
 * beside the member. The chore deposits the flint (and leftover gravel) after it.
 */
export async function flintTrip(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('flint_trip: not in a village');
  const want = Math.max(1, Math.min(FLINT_TRIP_MAX, Math.floor(Number(args.count) || 1)));
  const notes: string[] = [];
  flintCounts.trips++;
  // (gravel: storage's first, then dug; a gravel gives one flint in the end, on average ten breaks)
  const stored = storageContents(v).gravel ?? 0;
  if (carried(a, 'gravel') < want && stored > 0 && v.storage?.chests.length)
    await withdrawItems(a, v, { gravel: Math.min(stored, want - carried(a, 'gravel')) }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`storage's gravel: ${e.message.slice(0, 60)}`);
    });
  if (carried(a, 'gravel') < want) {
    const dug = await SURVIVAL_SKILLS.collect.run(a, { block: 'gravel', count: want - carried(a, 'gravel') }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return `gravel: ${e.message.slice(0, 100)}`;
    });
    if (dug) notes.push(dug);
  }
  const gravel0 = carried(a, 'gravel');
  if (!gravel0) throw new Error(`flint_trip: no gravel to break (${notes.join('; ') || 'none stored or found'})`);
  const flint0 = carried(a, 'flint');
  let digs = 0, cell = knapCell(a);
  if (!cell) {
    // (a step aside for room: the gravel bank's edge can be all water or slope)
    const p = a.bot.entity.position;
    await walk(a, new goals.GoalNearXZ(Math.floor(p.x) + 3, Math.floor(p.z) + 3, 1), 'room to knap', signal, 10000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    cell = knapCell(a);
  }
  if (!cell) throw new Error(`flint_trip: no dry level cell beside ${at(a.bot.entity.position)} to break gravel on`);
  const maxDigs = want * 40;
  while (carried(a, 'flint') - flint0 < want && carried(a, 'gravel') > 0 && digs < maxDigs) {
    checkAbort(signal);
    try {
      if (a.bot.blockAt(cell)?.name !== 'gravel') await placeAt(a, 'gravel', cell, signal);
      await mineBlock(a, cell, signal, true, 10000);
      digs++;
      await sleep(150, signal);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      notes.push(`knap: ${(e as Error).message.slice(0, 80)}`);
      cell = knapCell(a);
      if (!cell) break;
    }
  }
  const got = carried(a, 'flint') - flint0;
  flintCounts.digs += digs;
  flintCounts.flint += got;
  flintCounts.gravel += Math.max(0, gravel0 - carried(a, 'gravel'));
  console.log(`[flint] ${a.name} ${v.name}: ${got} flint from ${gravel0 - carried(a, 'gravel')} gravel in ${digs} breaks (${flintCounts.flint} flint, ${flintCounts.digs} breaks so far)`);
  if (!got) throw new Error(`flint_trip: no flint in ${digs} breaks of ${gravel0} gravel${notes.length ? ` (${notes.join('; ')})` : ''}`);
  return `knapped ${got} flint from gravel in ${digs} breaks${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

// ---- Arrows lying where they fell ------------------------------------------------------------------------------------

/** Where each village shot from lately (the bot's spot at a shot), for the sweep. */
const shotSpots = new Map<string, Array<{ x: number; y: number; z: number; at: number }>>();
/** How long a shot spot counts for the sweep (arrows in the ground despawn after 1200 ticks). */
export const SHOT_SPOT_MS = 15 * 60000;

export function noteShot(village: string | undefined, p: { x: number; y: number; z: number }): void {
  if (!village) return;
  const now = Date.now();
  const list = (shotSpots.get(village) ?? []).filter((s) => now - s.at < SHOT_SPOT_MS);
  list.push({ x: p.x, y: p.y, z: p.z, at: now });
  shotSpots.set(village, list.slice(-40));
}

export const recentShots = (village: string): Array<{ x: number; y: number; z: number; at: number }> =>
  (shotSpots.get(village) ?? []).filter((s) => Date.now() - s.at < SHOT_SPOT_MS);

/** Arrows lying (in the ground or on it) within `r` of `c` that a bot sees. */
export function arrowsLying(a: BotAgent, c: { x: number; y: number; z: number }, r: number): Entity[] {
  return Object.values(a.bot.entities).filter((e) => e.name === 'arrow' && Math.hypot(e.position.x - c.x, e.position.z - c.z) <= r && Math.abs(e.position.y - c.y) <= 6
    && Math.hypot(e.velocity?.x ?? 0, e.velocity?.y ?? 0, e.velocity?.z ?? 0) < 0.05);
}

/** Walks onto the arrows lying within `r` of the bot (a player picks up its own kind's arrows by touch), for up to `ms`;
 *  the arrows picked up. */
export async function pickUpArrows(a: BotAgent, signal: AbortSignal, r = 12, ms = 20000, centre?: { x: number; y: number; z: number }): Promise<number> {
  if (!bowsFirst()) return 0;
  const before = carried(a, 'arrow');
  const t0 = Date.now();
  const tried = new Set<number>();
  while (Date.now() - t0 < ms) {
    checkAbort(signal);
    const me = a.bot.entity.position;
    const lying = arrowsLying(a, centre ?? me, r).filter((e) => !tried.has(e.id)).sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me));
    if (!lying.length) break;
    const e = lying[0];
    tried.add(e.id);
    await walk(a, new goals.GoalNear(e.position.x, e.position.y, e.position.z, 1), 'an arrow', signal, 8000).catch((er: Error) => {
      if (er.message === 'cancelled') throw er;
    });
    await sleep(400, signal);
  }
  const got = Math.max(0, carried(a, 'arrow') - before);
  flintCounts.picked += got;
  return got;
}

/** pick_up_arrows (a chore): to the spot the village shot from, the arrows lying within 24 picked up. */
export async function pickUpArrowsSkill(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const x = Number(args.x), y = Number(args.y), z = Number(args.z);
  flintCounts.sweeps++;
  if (Number.isFinite(x) && Number.isFinite(z))
    await walk(a, new goals.GoalNear(x, Number.isFinite(y) ? y : a.bot.entity.position.y, z, 3), 'where arrows were shot', signal, 60000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
  const got = await pickUpArrows(a, signal, 24, 45000, Number.isFinite(x) ? { x, y: Number.isFinite(y) ? y : a.bot.entity.position.y, z } : undefined);
  flintCounts.sweepPicked += got;
  console.log(`[arrows] ${a.name} ${a.village()?.name ?? '?'}: picked up ${got} arrows near ${Math.round(x)},${Math.round(z)}`);
  if (!got) throw new Error('pick_up_arrows: no arrows could be picked up (gone: arrows in the ground last a minute)');
  return `picked up ${got} arrows`;
}

export const FLINT_SKILLS = {
  flint_trip: { run: flintTrip },
  pick_up_arrows: { run: pickUpArrowsSkill },
};

