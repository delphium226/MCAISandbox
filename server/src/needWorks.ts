/**
 * Needs-driven works (s39, #1 #9; spec runs/2026-10-19/s39/spec_needworks_v2.md): the food flow, food points drained and
 * made per game hour over a rolling window, and what answers it in tiers by size (higher make targets, the free farm
 * slots, a farmstead laid out beside the work vote). World-free and pure: the world adds the flows (mcWorld.ts appetiteTick), reads
 * the gauge in needTick and wires the answers. Behind MC_NEED_WORKS.
 */
import { FOOD_POINTS, foodPoints } from './appetite';

type Counts = Record<string, number>;

/** MC_NEED_WORKS: on (the default since s40, 10-19) or off (0, false). */
export const NEED_WORKS = !/^(off|0|false)$/i.test(process.env.MC_NEED_WORKS ?? 'on');
/** Game minutes the flow must stay short before the farmstead is offered (MC_NEED_HOLD_MIN shortens it for tests). */
export const HOLD_MIN = Math.max(0, Number(process.env.MC_NEED_HOLD_MIN ?? 30) || 0);
/** Game minutes after a farmstead is laid out before another is offered (a crop cycle and its first harvest). */
export const COOLDOWN_MIN = Math.max(HOLD_MIN, Number(process.env.MC_NEED_COOLDOWN_MIN ?? 90) || 0);
/** Game minutes after a field work is laid out before another (s40: a crop cycle to its first harvest is ~40). */
export const FIELD_COOLDOWN_MIN = Math.max(HOLD_MIN, Number(process.env.MC_NEED_FIELD_COOLDOWN_MIN ?? 45) || 0);
/** MC_NEED_FARMSTEAD=on: the farmstead (s39) beside the field (s40); off by default: where no 9x9 field pad is left, no
 *  19x19 farmstead pad is either (Night40, the field spec's check 5). */
export const FARMSTEAD_ON = /^(on|1|true)$/i.test(process.env.MC_NEED_FARMSTEAD ?? 'off');

/** The window: BUCKETS buckets of BUCKET_MIN game minutes. */
export const BUCKET_MIN = 10, BUCKETS = 12;
/** Short when level >= SHORT_LEVEL and hours left < SHORT_HOURS; no longer short below CLEAR_LEVEL or above CLEAR_HOURS. */
export const SHORT_LEVEL = 0.25, SHORT_HOURS = 3, CLEAR_LEVEL = 0.15, CLEAR_HOURS = 6;
/** The window must hold this many game minutes before the gauge reads (a restored or new village reads nothing at once). */
export const MIN_WINDOW = 30;

/** Kept on the village (saved with it): sums per bucket of game time, the current bucket's minutes, the shortness. */
export interface FoodFlow {
  buckets: Array<{ drained: number; made: number; min: number }>;
  /** The ledger's food made, in points, when last read (made is counted as its rise). */
  madeSeen?: number;
  short?: boolean;
  /** Game minutes the gauge has read short (for the hold); 0 when not. */
  shortMin?: number;
  /** Game minutes since the last farmstead was laid out (absent: none yet). */
  sinceFarmstead?: number;
  /** Game minutes since the last field work was laid out (absent: none yet; s40). */
  sinceField?: number;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

/** The flow after `gameMin` game minutes in which `drained` and `made` food points went (both >= 0). */
export function addFlow(f: FoodFlow | undefined, gameMin: number, drained: number, made: number): FoodFlow {
  const out: FoodFlow = { ...(f ?? {}), buckets: (f?.buckets ?? []).map((b) => ({ ...b })) };
  let left = Math.max(0, fin(gameMin)), d = Math.max(0, fin(drained)), m = Math.max(0, fin(made));
  if (!out.buckets.length) out.buckets.push({ drained: 0, made: 0, min: 0 });
  // (spread over the buckets the minutes cross, in proportion; a long gap fills at most the window)
  const total = left;
  do {
    const cur = out.buckets[out.buckets.length - 1];
    const room = Math.max(0, BUCKET_MIN - cur.min);
    const step = Math.min(room, left);
    const share = total > 0 ? step / total : 1;
    cur.min += step;
    cur.drained += d * share;
    cur.made += m * share;
    left -= step;
    if (cur.min >= BUCKET_MIN) out.buckets.push({ drained: 0, made: 0, min: 0 });
    if (out.buckets.length > BUCKETS + 1) out.buckets.splice(0, out.buckets.length - BUCKETS - 1);
    if (total === 0) break;
  } while (left > 1e-9);
  if (out.sinceFarmstead !== undefined) out.sinceFarmstead += Math.max(0, fin(gameMin));
  if (out.sinceField !== undefined) out.sinceField += Math.max(0, fin(gameMin));
  return out;
}

/** Drained and made per game hour over the window, and the minutes it holds. */
export function flowRates(f: FoodFlow | undefined): { drained: number; made: number; min: number } {
  const bs = f?.buckets ?? [];
  const min = bs.reduce((s, b) => s + b.min, 0);
  if (min <= 0) return { drained: 0, made: 0, min: 0 };
  return { drained: (bs.reduce((s, b) => s + b.drained, 0) * 60) / min, made: (bs.reduce((s, b) => s + b.made, 0) * 60) / min, min };
}

/** Food points a ledger of items made is worth: finished food only (wheat counts when baked). */
export function madePoints(made: Counts | undefined): number {
  return Object.entries(made ?? {}).reduce((s, [item, n]) => s + (FOOD_POINTS[item] ?? 0) * Math.max(0, fin(n)), 0);
}

/** Food points storage holds or can make: ready food, bread from wheat (3 a loaf), pies from pumpkin, egg and sugar. */
export function storedPoints(store: Counts): number {
  const n = (k: string) => Math.max(0, fin(store[k] ?? 0));
  const eggs = n('egg') + n('brown_egg') + n('blue_egg');
  const pies = Math.min(n('pumpkin'), eggs, n('sugar') + n('sugar_cane'));
  return foodPoints(store) + Math.floor(n('wheat') / 3) * (FOOD_POINTS.bread ?? 5) + pies * (FOOD_POINTS.pumpkin_pie ?? 8);
}

/** The gauge: level (net drain as a share of drain), hours of food left, a short text; null before MIN_WINDOW. */
export function foodflowReading(f: FoodFlow | undefined, stored: number): { level: number; hours: number; text: string } | null {
  const r = flowRates(f);
  if (r.min < MIN_WINDOW || r.drained <= 0) return null;
  const net = r.drained - r.made;
  const level = Math.max(0, Math.min(1, net / r.drained));
  const hours = net > 0 ? Math.max(0, stored) / net : 99;
  const text = `food: made ${Math.round(r.made)} of ${Math.round(r.drained)} points an hour; ${hours >= 99 ? 'no shortfall' : `${hours.toFixed(1)} hours left`}`;
  return { level, hours: Math.min(99, hours), text };
}

/** The shortness after `gameMin` more minutes with this reading (hysteresis: short at SHORT_*, clear at CLEAR_*). */
export function stepShort(f: FoodFlow, reading: { level: number; hours: number } | null, gameMin: number): FoodFlow {
  const was = !!f.short;
  let short = was;
  if (!reading) short = false;
  else if (!was && reading.level >= SHORT_LEVEL && reading.hours < SHORT_HOURS) short = true;
  else if (was && (reading.level < CLEAR_LEVEL || reading.hours > CLEAR_HOURS)) short = false;
  return { ...f, short, shortMin: short ? (was ? (f.shortMin ?? 0) : 0) + (was ? Math.max(0, fin(gameMin)) : 0) : 0 };
}

/** Tier 1: the food goods' targets in storage (bread, pies): 2 and 1/2 a member, 3 and 1 a member while short. */
export function foodTarget(item: 'bread' | 'pumpkin_pie', members: number, short: boolean): number {
  const m = Math.max(0, Math.floor(members));
  if (item === 'bread') return (short ? 3 : 2) * m;
  return short ? m : Math.ceil(m / 2);
}

/**
 * Tier 3: whether the work vote may offer a farmstead: short for HOLD_MIN, no free farm slot left to start (tier 2 first),
 * none under way, and COOLDOWN_MIN since the last one was laid out. The reason when not, for the log.
 */
export function farmsteadDue(f: FoodFlow | undefined, freeSlots: number, underWay: boolean): { due: boolean; why: string } {
  if (!f?.short) return { due: false, why: 'food not short' };
  if ((f.shortMin ?? 0) < HOLD_MIN) return { due: false, why: `short for ${Math.round(f.shortMin ?? 0)} of ${HOLD_MIN} min` };
  if (freeSlots > 0) return { due: false, why: `${freeSlots} free farm slot${freeSlots === 1 ? '' : 's'} first` };
  if (underWay) return { due: false, why: 'a farmstead under way' };
  if (f.sinceFarmstead !== undefined && f.sinceFarmstead < COOLDOWN_MIN) return { due: false, why: `the last farmstead ${Math.round(f.sinceFarmstead)} of ${COOLDOWN_MIN} min ago` };
  return { due: true, why: '' };
}

/**
 * s40 (spec runs/2026-10-20/s40/spec_fields_v1.md): whether a field work is due, the farmstead's rules on a small pad: short
 * for HOLD_MIN, no free farm slot left to start, none under way, FIELD_COOLDOWN_MIN since the last field. The reason when not.
 */
export function fieldDue(f: FoodFlow | undefined, freeSlots: number, underWay: boolean): { due: boolean; why: string } {
  if (!f?.short) return { due: false, why: 'food not short' };
  if ((f.shortMin ?? 0) < HOLD_MIN) return { due: false, why: `short for ${Math.round(f.shortMin ?? 0)} of ${HOLD_MIN} min` };
  if (freeSlots > 0) return { due: false, why: `${freeSlots} free farm slot${freeSlots === 1 ? '' : 's'} first` };
  if (underWay) return { due: false, why: 'a field under way' };
  if (f.sinceField !== undefined && f.sinceField < FIELD_COOLDOWN_MIN) return { due: false, why: `the last field ${Math.round(f.sinceField)} of ${FIELD_COOLDOWN_MIN} min ago` };
  return { due: true, why: '' };
}
