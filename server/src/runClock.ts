/**
 * The run's pause (#115 step 3, spec runs/2026-10-24/run-profiles/spec.md 3): while paused no bot starts an action or
 * ticks its brain (botAgent.ts), the world gives no chores and makes no choices (mcWorld.ts farmChores), and model calls
 * wait before the gate (modelCall.ts; calls in flight finish); Paper's ticks are frozen beside it (mcApi.ts). The paused
 * time is kept so clocks that count the wall may leave it out: `runNow()` is Date.now() less every pause so far, and the
 * watch scripts read `pausedMs` from GET /api/run.
 */

let pausedAt: number | null = null;
let pausedTotal = 0;
let waiters: Array<() => void> = [];

export const isPaused = (): boolean => pausedAt !== null;

/** Milliseconds paused so far, the current pause included. */
export const pausedMs = (now = Date.now()): number => pausedTotal + (pausedAt !== null ? now - pausedAt : 0);

/** The wall clock less every pause: for timers that must not count paused time. */
export const runNow = (): number => Date.now() - pausedMs();

/** Pauses the run; false when it was paused already. */
export function pause(now = Date.now()): boolean {
  if (pausedAt !== null) return false;
  pausedAt = now;
  console.log('[run] paused');
  return true;
}

/** Resumes the run and wakes every waiter; false when it was not paused. */
export function resume(now = Date.now()): boolean {
  if (pausedAt === null) return false;
  const ms = now - pausedAt;
  pausedTotal += ms;
  pausedAt = null;
  const w = waiters;
  waiters = [];
  for (const f of w) f();
  console.log(`[run] resumed after ${(ms / 60000).toFixed(1)} min paused (${(pausedTotal / 60000).toFixed(1)} in all)`);
  return true;
}

/** Resolves at once when not paused, else at the resume (or rejects 'cancelled' when the signal aborts). */
export function whilePaused(signal?: AbortSignal): Promise<void> {
  if (pausedAt === null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      waiters = waiters.filter((f) => f !== done);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    waiters.push(done);
  });
}

/** The run clock's state for the API. */
export const runState = () => ({ paused: isPaused(), pausedMs: pausedMs(), since: pausedAt });
