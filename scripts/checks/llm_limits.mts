// MC_LLM_LIMITS (llmLimits.ts, the user's 10-23): at its default every limit is as before; off, the member's gap, the hourly
// cap and work blocks' pacing, the queue's and the gate's give-up, the in-flight cap (every cloud slot), the token budget
// and acts' one in three are lifted, and a setting given on its own still wins. Each case in a child process (the
// settings are read once at import).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/llm_limits.mts
import { execFileSync } from 'node:child_process';

if (process.env.LIMITS_CHILD) {
  const { CHOOSE, ChoiceStats } = await import('../../server/src/choose');
  const { ACTS } = await import('../../server/src/acts');
  const { usage } = await import('../../server/src/modelUsage');
  const st = new ChoiceStats();
  for (let i = 0; i < 3; i++) st.noteModel('Ada', i * 1000);
  console.log(JSON.stringify({
    minGapMs: CHOOSE.minGapMs, perHour: CHOOSE.perHour === Infinity ? 'inf' : CHOOSE.perHour, parallel: CHOOSE.parallel,
    queueMs: CHOOSE.queueMs === Infinity ? 'inf' : CHOOSE.queueMs, waitMs: CHOOSE.waitMs === Infinity ? 'inf' : CHOOSE.waitMs,
    every: ACTS.every, budget: (usage as unknown as { limit: number | null }).limit, paced: st.modelCallsLastHour('Ada', 4000),
  }));
} else {
  const run = (env: Record<string, string>) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1]], { env: { ...process.env, MC_LLM_LIMITS: '', MC_CHOOSE_MIN_GAP_MS: '', MC_CHOOSE_HOURLY: '', MC_CHOOSE_PARALLEL: '', MC_CHOOSE_QUEUE_MS: '', MC_CHOOSE_WAIT_MS: '', MC_ACTS_EVERY: '', MC_WORK_BLOCKS: 'on', LIMITS_CHILD: '1', ...env }, encoding: 'utf-8' }).trim().split('\n').pop()!);
  let fails = 0;
  const ok = (c: boolean, what: string) => {
    if (!c) fails++;
    console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`);
  };
  const def = run({}), off = run({ MC_LLM_LIMITS: 'off' }), own = run({ MC_LLM_LIMITS: 'off', MC_CHOOSE_HOURLY: '12', MC_CHOOSE_PARALLEL: '1' });
  ok(def.minGapMs === 90000 && def.perHour === 30 && def.parallel === 2 && def.queueMs === 30000 && def.waitMs === 15000 && def.every === 3 && def.budget !== null, `default: as before ${JSON.stringify(def)}`);
  ok(def.paced === 30, 'default with work blocks: 3 calls in 3 s read as the cap (pacing on)');
  ok(off.minGapMs === 0 && off.perHour === 'inf' && off.parallel === 3 && off.queueMs === 'inf' && off.waitMs === 'inf' && off.every === 1 && off.budget === null, `off: every limit lifted ${JSON.stringify(off)}`);
  ok(off.paced === 3, 'off: no pacing (the 3 calls counted as they are)');
  ok(own.perHour === 12 && own.parallel === 1 && own.minGapMs === 0, `off with MC_CHOOSE_HOURLY=12 and MC_CHOOSE_PARALLEL=1: those settings win ${JSON.stringify(own)}`);
  console.log(fails ? `llm_limits: ${fails} failed` : 'llm_limits: all passed');
  process.exit(fails ? 1 : 0);
}
