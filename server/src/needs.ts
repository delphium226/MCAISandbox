/**
 * A village's needs (N.1, s36): gauges read from plain numbers the world counts (unlit light spots, open decor spots, hungry
 * members, members without a house, chest spots used, mine faces held), each a level 0..1 with a short text, and a small
 * state per need kept across sweeps that says whether the need is met, being answered (its amount fell), offered and
 * ignored, blocked, or without any answer yet. Nothing here votes or acts: the world reads the gauges (mcWorld.ts needTick),
 * saves the states on the village and puts the facts and weights on the chore menus. World-free and pure. Spec
 * runs/2026-10-18/s36/spec_needs_v2.md A.
 */

export type NeedKind = 'light' | 'furnish' | 'food' | 'housing' | 'storage' | 'mine';

/** Plain numbers from the world; a field left undefined means that gauge is not kept. */
export interface NeedInputs {
  members: number;                     // >= 0; every share guards members < 1
  houses?: number;                     // housing (show only)
  unlit?: number; spots?: number;      // light: unlit spots of all light spots (lightParts)
  unlitParts?: number;
  openDecor?: number; decorSpots?: number; openDecorParts?: number;   // furnish (decorParts)
  hungry?: number;                     // food, only when the appetite is on: members peckish or hungry
  chests?: number; chestSpots?: number;                                // storage (show only)
  mineHeld?: number; mineFaces?: number; mineBlocked?: string;         // mine (show only)
}

/** One gauge: its level (a fraction 0..1), the amount whose fall means it is being answered, and a text of 80 chars or less. */
export interface NeedReading { kind: NeedKind; level: number; amount: number; text: string }

/** Below LOW a need is met; at HIGH or more for 10 minutes with no answer it is logged as 'no answer'. */
export const LOW = 0.25, HIGH = 0.6;

/** How long a fall of the amount counts as an answer, and how long a high need waits before 'no answer'. */
const WINDOW_MS = 10 * 60_000;
/** Sweeps an answering option may sit on an idle menu untaken before the need is 'ignored'. */
const IGNORED_SWEEPS = 6;
const MAX_TEXT = 80;

/** A count from the world: a finite number, never below 0. */
const num = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0);
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
/** part / whole, 0 when the whole is under 1. */
const share = (part: number, whole: number) => (whole < 1 ? 0 : clamp01(part / whole));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string) => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT - 3)}...`);

/** The kept gauges (pure), in the order light, furnish, food, housing, storage, mine. */
export function readNeeds(i: NeedInputs): NeedReading[] {
  const out: NeedReading[] = [];
  const members = num(i.members);
  const add = (kind: NeedKind, level: number, amount: number, text: string) => out.push({ kind, level: clamp01(level), amount, text: clip(text) });
  if (i.unlit !== undefined && i.spots !== undefined) {
    const unlit = num(i.unlit), spots = num(i.spots);
    const where = i.unlitParts !== undefined ? ` in ${plural(num(i.unlitParts), 'building')}` : ` of ${spots}`;
    add('light', share(unlit, spots), unlit, `${plural(unlit, 'unlit spot')}${where}`);
  }
  if (i.openDecor !== undefined && i.decorSpots !== undefined) {
    const open = num(i.openDecor), spots = num(i.decorSpots);
    const where = i.openDecorParts !== undefined ? ` in ${plural(num(i.openDecorParts), 'building')}` : ` of ${spots}`;
    add('furnish', share(open, spots), open, `${plural(open, 'open decor spot')}${where}`);
  }
  if (i.hungry !== undefined) {
    const hungry = num(i.hungry);
    add('food', share(hungry, members), hungry, `${hungry} of ${plural(members, 'member')} hungry`);
  }
  if (i.houses !== undefined) {
    const without = Math.max(0, members - num(i.houses));
    add('housing', share(without, members), without, `${without} of ${plural(members, 'member')} without a house`);
  }
  if (i.chests !== undefined && i.chestSpots !== undefined) {
    const chests = num(i.chests), spots = num(i.chestSpots);
    add('storage', share(chests, spots), chests, `${chests} of ${plural(spots, 'chest spot')} used`);
  }
  if (i.mineHeld !== undefined && i.mineFaces !== undefined) {
    const held = num(i.mineHeld), faces = num(i.mineFaces);
    const text = `${held} of ${plural(faces, 'mine face')} held`;
    add('mine', share(held, faces), held, i.mineBlocked ? `mine blocked (${i.mineBlocked}); ${text}` : text);
  }
  return out;
}

/** Persisted per need; durations, not wall-clock times (a checkpoint restored later must not escalate at once). */
export interface NeedState {
  level: number; amount: number;
  aboveMs: number;          // time at >= LOW
  lastFallMs: number;       // time since the amount last fell
  offeredSweeps: number;    // sweeps an answering option was on an idle menu untaken
  status: 'met' | 'low' | 'answered' | 'ignored' | 'blocked' | 'no answer'; why?: string;
}

/**
 * The need's next state after a sweep `dtMs` long (capped at 60 s): durations add up, the amount's fall restarts its clock,
 * the offer count rises on an untaken offer and clears on a take. Status, first rule that holds: level < LOW: met; the
 * amount fell within 10 minutes: answered; level >= HIGH for 10 minutes and nothing answers it: no answer; a reason it
 * could not be offered: blocked (why); offered untaken 6 sweeps: ignored; else low. A first reading counts no time and no
 * fall (lastFallMs starts at the 10 minutes, so it is not 'answered' at once).
 */
export function stepNeed(prev: NeedState | undefined, r: NeedReading, dtMs: number,
  seen: { offered: boolean; taken: boolean; blocked?: string }, answerable: boolean): NeedState {
  const dt = prev ? Math.min(60_000, num(dtMs)) : 0;
  const level = clamp01(r.level), amount = num(r.amount);
  const aboveMs = level >= LOW ? (prev?.aboveMs ?? 0) + dt : 0;
  const lastFallMs = prev && amount < prev.amount ? 0 : (prev?.lastFallMs ?? WINDOW_MS) + dt;
  // (cleared by a take, and while the need is met: one that rises again starts from none)
  const offeredSweeps = seen.taken || level < LOW ? 0 : (prev?.offeredSweeps ?? 0) + (seen.offered ? 1 : 0);
  const base = { level, amount, aboveMs, lastFallMs, offeredSweeps };
  if (level < LOW) return { ...base, status: 'met' };
  if (lastFallMs < WINDOW_MS) return { ...base, status: 'answered' };
  if (level >= HIGH && aboveMs >= WINDOW_MS && !answerable) return { ...base, status: 'no answer' };
  if (seen.blocked) return { ...base, status: 'blocked', why: seen.blocked };
  if (offeredSweeps >= IGNORED_SWEEPS) return { ...base, status: 'ignored' };
  return { ...base, status: 'low' };
}

/** A member's weight for an option answering a need: 1 + level x (0.5 + trait), level and trait taken as 0..1, at most 2.5. */
export function needWeight(level: number, trait: number): number {
  return Math.min(2.5, 1 + clamp01(level) * (0.5 + clamp01(trait)));
}

/** The temperament trait that weighs each need (food care, light diligence, furnish pride; the rest have no answer yet). */
export const NEED_TRAIT: Record<NeedKind, 'care' | 'diligence' | 'pride'> = {
  light: 'diligence', furnish: 'pride', food: 'care', housing: 'care', storage: 'diligence', mine: 'diligence',
};
