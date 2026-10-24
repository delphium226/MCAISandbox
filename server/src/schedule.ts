/**
 * Scheduled setting changes (#115 step 5, spec runs/2026-10-24/run-profiles/spec.md 5): a profile's `schedule`, passed as
 * MC_SCHEDULE ([{at_min, set: {NAME: value}}], JSON), applied by setSetting(..., 'schedule') once the run has gone that
 * many minutes since the agent server started, paused time left out (runClock.ts). Each step once, in order; a refused
 * change is logged and the rest go on. run_report.py lists the [setting] lines with their run minutes.
 */
import { runNow } from './runClock';
import { rawSetting, setSetting } from './settings';

export interface ScheduleStep {
  at_min: number;
  set: Record<string, string | number | boolean>;
}

/** MC_SCHEDULE parsed and checked (a minute >= 0 and a set each), in order of minute; throws on a fault. */
export function parseSchedule(json: string): ScheduleStep[] {
  if (!json.trim()) return [];
  const raw = JSON.parse(json) as ScheduleStep[];
  if (!Array.isArray(raw)) throw new Error('MC_SCHEDULE: a list of {at_min, set}');
  for (const [i, s] of raw.entries())
    if (!(Number(s?.at_min) >= 0) || !s.set || typeof s.set !== 'object') throw new Error(`MC_SCHEDULE step ${i + 1}: needs "at_min" (>= 0) and "set"`);
  return [...raw].sort((a, b) => a.at_min - b.at_min);
}

/** Starts the schedule (once, at the agent server's start); every 5 s the steps due are applied. */
export function startSchedule(): void {
  const steps = parseSchedule(rawSetting('MC_SCHEDULE') ?? '');
  if (!steps.length) return;
  const start = runNow();
  let next = 0;
  console.log(`[setting] schedule: ${steps.map((s) => `${s.at_min} min ${Object.keys(s.set).join(', ')}`).join('; ')}`);
  const timer = setInterval(() => {
    const min = (runNow() - start) / 60000;
    while (next < steps.length && steps[next].at_min <= min) {
      const step = steps[next++];
      for (const [name, v] of Object.entries(step.set)) {
        const value = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
        const r = setSetting(name, value, `schedule at run minute ${step.at_min}`);
        if (!r.ok) console.warn(`[setting] schedule at run minute ${step.at_min}: ${r.error}`);
      }
    }
    if (next >= steps.length) clearInterval(timer);
  }, 5000);
  timer.unref();
}
