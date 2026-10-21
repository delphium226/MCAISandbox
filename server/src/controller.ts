/**
 * The controller's rules beside the decision call (G2, PLAN E.4, #28). The one call itself is choose.ts' (reason, choice,
 * G1's memory fields, and with MC_ACTS act and say); its rate (90 s floor, 30 an hour) is choose.ts' CHOOSE; the acts and
 * the coherence of `say` are acts.ts'. This module keeps the two non-social rules both arms of Experiment 1 share (the
 * spec check's H1): the day's intention as a menu weight, and a chore over in under 30 s with nothing gained counted as a
 * failure toward its kind's cooldown (the world applies both). World-free.
 *
 * Settings (read once):
 *   MC_CONTROLLER     off (default) | on: the intention's weight and the quick-failure rule
 *   MC_INTENT_WEIGHT  1.3: the weight on options of the day's intention's focus kind
 *   MC_SCRIPTED_ACTS  0.3: with MC_CHOOSE=scripted, the chance a scripted decision carries an act and a line
 */
import { MEMORY, agentMemory, clockOf } from './memory';

export const CONTROLLER = {
  on: /^(on|1|true|yes)$/i.test(process.env.MC_CONTROLLER ?? ''),
  intentWeight: Number(process.env.MC_INTENT_WEIGHT ?? 1.3),
};

export const SCRIPTED_ACTS = Number(process.env.MC_SCRIPTED_ACTS ?? 0.3);

/** Test hook. */
export function setControllerSettings(s: Partial<typeof CONTROLLER>): void {
  Object.assign(CONTROLLER, s);
}

/** The focus kind (a FOCUS word) of the member's intention for today, if it set one (memory and the clock on). */
export function intentionFocus(village: string, agent: string, now: number): string | undefined {
  if (!MEMORY.clock) return undefined;
  const c = clockOf(village, now);
  const a = agentMemory(village, agent);
  return c && a?.today && a.today.day === c.day ? a.today.focus : undefined;
}
