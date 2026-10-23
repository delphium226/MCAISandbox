// The model's pacing with work blocks (choose.ts modelCallsLastHour, F297): a member at a decision every 30 s for an hour,
// a model call whenever the rate rule allows one. Paced (MC_WORK_BLOCKS=on): the hour's 30 spread over the hour, 3-6 in
// every 10 minutes and at least 12 in the second half; unpaced (off): the 30 spent in the first ~15-30 minutes, none after. Runs both in child processes
// (the flag is read once at import).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/model_pace.mts
import { execFileSync } from 'node:child_process';

if (process.env.PACE_CHILD) {
  const { ChoiceStats, CHOOSE } = await import('../../server/src/choose');
  const st = new ChoiceStats();
  const bins = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 3600_000; t += 30_000) {
    if (st.modelCallsLastHour('Ada', t) >= CHOOSE.perHour) continue;
    st.noteModel('Ada', t);
    bins[Math.floor(t / 600_000)]++;
  }
  console.log(JSON.stringify(bins));
} else {
  const run = (on: boolean) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1]], { env: { ...process.env, PACE_CHILD: '1', MC_WORK_BLOCKS: on ? 'on' : 'off' }, encoding: 'utf-8' }).trim().split('\n').pop()!) as number[];
  const on = run(true), off = run(false);
  console.log(`model calls by 10 minutes, paced:   ${on.join(' ')} (${on.reduce((a, b) => a + b, 0)})`);
  console.log(`model calls by 10 minutes, unpaced: ${off.join(' ')} (${off.reduce((a, b) => a + b, 0)})`);
  const okOn = on.every((n) => n >= 3 && n <= 6) && on.slice(3).reduce((a, b) => a + b, 0) >= 12 && on.reduce((a, b) => a + b, 0) <= 30;
  const okOff = off.slice(2).every((n) => n === 0);
  console.log(okOn && okOff ? 'model_pace: PASS' : `model_pace: FAIL (paced even ${okOn}, unpaced as before ${okOff})`);
  process.exit(okOn && okOff ? 0 : 1);
}
