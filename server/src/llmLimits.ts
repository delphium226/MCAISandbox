/**
 * MC_LLM_LIMITS (the user's, 10-23): on (default) keeps every limit on how often members call the model; off lifts them
 * all for a run, each limit's own setting still taking precedence where it is set:
 *   - the member's minimum gap between model decisions (MC_CHOOSE_MIN_GAP_MS; 90 s, 30 s with work blocks): none;
 *   - the hourly cap (MC_CHOOSE_HOURLY) and work blocks' 3-in-6-minutes pacing: none;
 *   - the decision queue's give-up to the fixed pick (MC_CHOOSE_QUEUE_MS) and the gate's withdrawal (MC_CHOOSE_WAIT_MS):
 *     a decision waits for its turn;
 *   - decisions in flight (MC_CHOOSE_PARALLEL): every cloud slot;
 *   - the hourly token budget's pause and degrade (MC_TOKEN_BUDGET_HOUR): none;
 *   - acts once in 3 decisions (MC_ACTS_EVERY): every decision;
 *   - the low classes' share of the gate (ballots, reflections, the chronicle: all slots but one): every slot.
 * What stays is the provider's own concurrency, MC_CALL_SLOTS (Ollama Cloud's 3 at once), as a queue, never a fallback.
 */
export const LLM_LIMITS = !/^(off|0|false|no)$/i.test(process.env.MC_LLM_LIMITS ?? 'on');

/** A setting's value: its own env if set, else the limited default, else the unlimited one. */
export function limited(env: string | undefined, on: number, off: number): number {
  return env !== undefined && env.trim() !== '' ? Number(env) : LLM_LIMITS ? on : off;
}

/** The cloud slots MC_CALL_SLOTS gives Ollama Cloud (3 by default): decisions in flight with the limits off. */
export function cloudSlots(): number {
  const m = /ollama-cloud\s*=\s*(\d+)/.exec(process.env.MC_CALL_SLOTS ?? '');
  return m ? Number(m[1]) : 3;
}
