/**
 * #115 step 3: the run clock (server/src/runClock.ts): pause and resume, the paused time counted with the current pause,
 * runNow() leaving it out, whilePaused() waiting until the resume (and refusing on an abort), a second pause or resume a
 * no-op; and the model gate's, the bot tick's and the world chores' holds are in place (by their source lines).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/run_pause.mts
 */
import fs from 'node:fs';

const rc = await import('../../server/src/runClock');
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
console.log = ((log) => (...a: unknown[]) => (String(a[0]).startsWith('[run]') ? undefined : log(...a)))(console.log);

ok(!rc.isPaused() && rc.pausedMs() === 0, 'not paused at start');
const t = 1_000_000;
ok(rc.pause(t) && !rc.pause(t + 5) && rc.isPaused(), 'paused once (a second pause is a no-op)');
ok(rc.pausedMs(t + 60_000) === 60_000, 'the current pause counts');
let woke = false;
const w = rc.whilePaused().then(() => (woke = true));
const ac = new AbortController();
const aborted = rc.whilePaused(ac.signal).then(() => 'resolved', (e: Error) => e.message);
ac.abort();
ok((await aborted) === 'cancelled', 'an aborted wait is cancelled');
await new Promise((r) => setTimeout(r, 10));
ok(!woke, 'a waiter waits while paused');
ok(rc.resume(t + 120_000) && !rc.resume(t + 130_000), 'resumed once');
await w;
ok(woke && rc.pausedMs() === 120_000 && !rc.isPaused(), `the waiter woke; 2 min paused in all (${rc.pausedMs()} ms)`);
const before = Date.now() - rc.runNow();
ok(Math.abs(before - 120_000) < 50, 'runNow() leaves the pauses out');
ok(rc.pause(t + 200_000) && rc.resume(t + 230_000) && rc.pausedMs() === 150_000, 'pauses add up');
const resolved = await Promise.race([rc.whilePaused().then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);
ok(resolved, 'not paused: whilePaused resolves at once');
const src = (f: string) => fs.readFileSync(f, 'utf8');
ok(/await whilePaused\(req\.signal\);\s*\r?\n\s*let slot/.test(src('server/src/modelCall.ts')), 'model calls wait before the gate');
ok(/if \(!this\.bot\.entity\) return;[\s\S]{0,200}if \(isPaused\(\)\) return;\s*\r?\n\s*this\.brain\?\.tick/.test(src('server/src/mineflayer/botAgent.ts')), "a bot's tick holds while paused");
ok(/if \(isPaused\(\) \|\| now - this\.farmCheckAt < 30000\) return;/.test(src('server/src/mineflayer/mcWorld.ts')), 'the world gives no chores while paused');
console.log(fails ? `run_pause: ${fails} of ${checks} failed` : `run_pause: all ${checks} passed`);
process.exit(fails ? 1 : 0);
