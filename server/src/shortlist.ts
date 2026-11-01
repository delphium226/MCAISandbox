/**
 * Random shortlists for the buildings a village picks (MC_PICK_RANDOM, on; the user's, 11-01: "make the buildings the
 * mayor picks more random"). The civic tier's list, the monument architect's cathedrals and the public works vote's
 * order are drawn from a seed per run and per village, so one checkpoint gives other buildings in other runs; the model
 * still picks from what is shown. The run's seed is MC_PICK_SEED when set (to replay a run: its `[pick] seed` line),
 * else drawn at start and logged.
 */
import { randomBytes } from 'node:crypto';
import { rawSetting } from './settings';

export const PICKS = {
  random: /^(on|1|true|yes)$/i.test(rawSetting('MC_PICK_RANDOM') ?? 'on'),
  seed: (rawSetting('MC_PICK_SEED') ?? '').trim() || randomBytes(4).toString('hex'),
};
/** Test hook. */
export function setPicks(s: Partial<typeof PICKS>): void { Object.assign(PICKS, s); }

let logged = false;
/** The run's seed, logged once (the first time a list is drawn). */
export function pickSeed(): string {
  if (!logged) {
    logged = true;
    console.log(`[pick] seed ${PICKS.seed} (MC_PICK_SEED=${PICKS.seed} draws the same lists again)`);
  }
  return PICKS.seed;
}

/** FNV-1a: a string's 32-bit hash. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A rank for `id` in this run's draw keyed by `key` (a village and what is drawn): sort ascending to shuffle. */
export const drawRank = (key: string, id: string) => hash32(`${pickSeed()}|${key}|${id}`);

/** `items` in this run's order for `key`. */
export function drawOrder<T>(items: T[], key: string, id: (t: T) => string): T[] {
  return items.map((t) => ({ t, r: drawRank(key, id(t)) })).sort((a, b) => a.r - b.r).map((x) => x.t);
}
