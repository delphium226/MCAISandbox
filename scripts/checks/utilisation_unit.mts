/**
 * The panel's utilisation clock (server/src/utilisation.ts, #67) checked offline: the first sample counts no time, a gap
 * counts at most 30 s, busy and seen time land in 1-minute bins, a view aggregates bins and leaves unseen points null,
 * and the bins stay bounded to a day. Deterministic. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/utilisation_unit.mts
 */
import { UTIL_BINS, UtilClock } from '../../server/src/utilisation';

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}
const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-9;

const T0 = 1_000 * 60_000; // a minute boundary
const c = new UtilClock();
c.sample(T0, [{ name: 'A', busy: true }, { name: 'B', busy: false }]);
ok(c.view(T0, 1, 1).agents.A === undefined, 'the first sample counts no time');
// 12 samples 5 s apart: A busy, B idle for the first half then busy
for (let i = 1; i <= 11; i++) c.sample(T0 + i * 5000, [{ name: 'A', busy: true }, { name: 'B', busy: i > 6 }]);
let v = c.view(T0 + 55_000, 1, 1);
ok(near(v.agents.A[0], 1), `A busy all minute (${v.agents.A[0]})`);
ok(near(v.agents.B[0], 5 / 11), `B busy 5 of 11 samples (${v.agents.B[0]})`);
ok(near(v.overall[0], 16 / 22) && near(v.total, 16 / 22), 'overall: busy over seen, both agents');
// A gap of 5 minutes counts 30 s, in the minute it ends in
c.sample(T0 + 6 * 60_000, [{ name: 'A', busy: false }]);
v = c.view(T0 + 6 * 60_000, 1, 7);
ok(v.agents.A.length === 7 && v.agents.A[1] === null && near(v.agents.A[6], 0), `a gap: unseen minutes null, the last 30 s idle (${JSON.stringify(v.agents.A)})`);
ok(v.agents.B[6] === null, 'B not sampled in the last minute: null');
// A coarser view sums its minutes
const w = c.view(T0 + 6 * 60_000, 7, 1);
ok(near(w.agents.A[0], 55 / 85), `7 minutes in one point: busy 55 s of 85 s (${w.agents.A[0]})`);
// Bounded
const d = new UtilClock();
for (let m = 0; m <= UTIL_BINS + 30; m++) d.sample(T0 + m * 60_000, [{ name: 'A', busy: true }]);
const dv = d.view(T0 + (UTIL_BINS + 30) * 60_000, 1, UTIL_BINS + 30 > 1000 ? 1000 : UTIL_BINS + 30);
ok(dv.agents.A.length === 1000 && dv.agents.A.every((x) => x === null || x === 1), 'a long run: views bounded, shares right');
ok((d as unknown as { bins: Map<string, { seen: number[] }> }).bins.get('A')!.seen.length <= UTIL_BINS, 'bins kept to a day');

process.stdout.write(`utilisation_unit: ${checks - failures}/${checks} passed\n`);
if (failures) process.exit(1);
