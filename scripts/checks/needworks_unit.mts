/**
 * The needs-driven works' pure parts (server/src/needWorks.ts, spec runs/2026-10-19/s39/spec_needworks_v2.md A, B)
 * checked offline: the flow's buckets and rates (a window that rolls, a long gap filling at most the window, a restore
 * keeping its buckets), made points (finished food only), stored points (bread from wheat, pies from pumpkin, egg and
 * sugar), the gauge (nothing before 30 minutes, a starving village whose levels stopped at 0 still reads its drain), the
 * shortness's hysteresis and hold, the targets, and the farmstead's gate (hold, free slots first, under way, cooldown).
 * Deterministic. Exits non-zero on any failure.
 * Usage: MC_NEED_HOLD_MIN=30 node node_modules/tsx/dist/cli.mjs scripts/checks/needworks_unit.mts
 */
import { placeFarm } from '../../server/src/streetPlan';
import { BUCKETS, BUCKET_MIN, COOLDOWN_MIN, FIELD_COOLDOWN_MIN, HOLD_MIN, addFlow, farmsteadDue, fieldDue, flowRates, foodTarget, foodflowReading, madePoints, stepShort, storedPoints, type FoodFlow } from '../../server/src/needWorks';

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// Flow: 60 game minutes at 180 drained / 40 made an hour, in 5-minute steps
let f: FoodFlow | undefined;
for (let i = 0; i < 12; i++) f = addFlow(f, 5, 15, 40 / 12);
let r = flowRates(f);
ok(near(r.min, 60) && near(r.drained, 180) && near(r.made, 40), `rates over an hour (${JSON.stringify(r)})`);
ok(f!.buckets.length <= BUCKETS + 1, 'buckets bounded');
// The window rolls: 4 more hours at 60/h drained, nothing made, leave only that
for (let i = 0; i < 48; i++) f = addFlow(f, 5, 5, 0);
r = flowRates(f);
ok(near(r.drained, 60, 1e-3) && near(r.made, 0) && r.min <= BUCKETS * BUCKET_MIN + 1e-9 && r.min >= (BUCKETS - 1) * BUCKET_MIN, `the window rolls (${JSON.stringify(r)})`);
// A long gap in one step fills at most the window
const g = addFlow(undefined, 1000, 3000, 0);
ok(flowRates(g).min <= (BUCKETS + 1) * BUCKET_MIN && near(flowRates(g).drained, 180), 'a long gap: the window, at its rate');
// A restore (JSON round trip) keeps the buckets
const back = JSON.parse(JSON.stringify(f)) as FoodFlow;
ok(near(flowRates(back).drained, flowRates(f).drained), 'a restore keeps the flow');
// No time, no drain: nothing changes the rates' minutes
ok(near(flowRates(addFlow(f, 0, 0, 0)).min, flowRates(f).min), 'a zero step adds no time');

// Points
ok(madePoints({ bread: 2, pumpkin_pie: 1, wheat: 9, egg: 5 }) === 18, 'made: finished food only');
ok(storedPoints({ bread: 2, wheat: 7, pumpkin: 3, egg: 2, sugar_cane: 5 }) === 10 + 10 + 16, `stored: bread, wheat/3, pies (${storedPoints({ bread: 2, wheat: 7, pumpkin: 3, egg: 2, sugar_cane: 5 })})`);
ok(storedPoints({}) === 0, 'stored: empty');

// The gauge
ok(foodflowReading(addFlow(undefined, 20, 60, 0), 100) === null, 'nothing before 30 minutes');
let h: FoodFlow | undefined;
for (let i = 0; i < 12; i++) h = addFlow(h, 5, 15, 40 / 12);
const rd = foodflowReading(h, 280)!;
ok(rd && near(rd.level, 140 / 180) && near(rd.hours, 2), `level and hours (${JSON.stringify(rd)})`);
ok(rd.text.length <= 80 && /made 40 of 180/.test(rd.text), `text: ${rd.text}`);
// Starving: levels stopped at 0 do not stop the count (the world counts rate x minutes): drained stays, stored 0
const st = foodflowReading(h, 0)!;
ok(st.hours === 0 && st.level > 0.7, 'starving: 0 hours left, short');
// Surplus: made over drained
let s: FoodFlow | undefined;
for (let i = 0; i < 12; i++) s = addFlow(s, 5, 10, 20);
ok(foodflowReading(s, 0)!.level === 0 && foodflowReading(s, 0)!.hours === 99, 'surplus: level 0, no shortfall');

// Hysteresis and hold
let k: FoodFlow = { buckets: [] };
k = stepShort(k, { level: 0.5, hours: 2 }, 5);
ok(k.short && k.shortMin === 0, 'short at once, its hold from 0');
k = stepShort(k, { level: 0.2, hours: 4 }, 5);
ok(k.short && k.shortMin === 5, 'between the bars: still short, the hold grows');
k = stepShort(k, { level: 0.5, hours: 7 }, 5);
ok(!k.short && k.shortMin === 0, 'over 6 hours left: clear');
k = stepShort(k, { level: 0.2, hours: 2 }, 5);
ok(!k.short, 'level under 0.25: not short again');
ok(!stepShort({ buckets: [], short: true, shortMin: 40 }, null, 5).short, 'no reading: not short');

// Targets
ok(foodTarget('bread', 25, false) === 50 && foodTarget('pumpkin_pie', 25, false) === 13, 'targets: as before');
ok(foodTarget('bread', 25, true) === 75 && foodTarget('pumpkin_pie', 25, true) === 25, 'targets: raised while short');

// The farmstead's gate
const shortFor = (min: number, extra: Partial<FoodFlow> = {}): FoodFlow => ({ buckets: [], short: true, shortMin: min, ...extra });
ok(!farmsteadDue(undefined, 0, false).due, 'gate: no flow');
ok(!farmsteadDue({ buckets: [], short: false }, 0, false).due, 'gate: not short');
ok(HOLD_MIN === 0 || !farmsteadDue(shortFor(HOLD_MIN - 1), 0, false).due, 'gate: before the hold');
ok(!farmsteadDue(shortFor(HOLD_MIN), 1, false).due, 'gate: a free slot first');
ok(!farmsteadDue(shortFor(HOLD_MIN), 0, true).due, 'gate: one under way');
ok(!farmsteadDue(shortFor(HOLD_MIN, { sinceFarmstead: COOLDOWN_MIN - 1 }), 0, false).due, 'gate: the cooldown');
ok(farmsteadDue(shortFor(HOLD_MIN, { sinceFarmstead: COOLDOWN_MIN }), 0, false).due, 'gate: after the cooldown');
ok(farmsteadDue(shortFor(HOLD_MIN), 0, false).due, 'gate: due');
// The cooldown counts game minutes as the flow goes
const c = addFlow({ buckets: [], sinceFarmstead: 0 }, 25, 0, 0);
ok(c.sinceFarmstead === 25, 'cooldown advances with the flow');

// s40: the field work's gate (the farmstead's rules, its own cooldown) and its cooldown on the flow
ok(!fieldDue(undefined, 0, false).due, 'field: no flow');
ok(!fieldDue({ buckets: [], short: false }, 0, false).due, 'field: not short');
ok(HOLD_MIN === 0 || !fieldDue(shortFor(HOLD_MIN - 1), 0, false).due, 'field: before the hold');
ok(!fieldDue(shortFor(HOLD_MIN), 2, false).due, 'field: free slots first');
ok(!fieldDue(shortFor(HOLD_MIN), 0, true).due, 'field: one under way');
ok(!fieldDue(shortFor(HOLD_MIN, { sinceField: FIELD_COOLDOWN_MIN - 1 }), 0, false).due, 'field: the cooldown');
ok(fieldDue(shortFor(HOLD_MIN, { sinceField: FIELD_COOLDOWN_MIN }), 0, false).due, 'field: after the cooldown');
ok(fieldDue(shortFor(HOLD_MIN, { sinceFarmstead: 0 }), 0, false).due, 'field: a farmstead\'s cooldown does not hold it');
const cf = addFlow({ buckets: [], sinceField: 5 }, 10, 0, 0);
ok(cf.sinceField === 15 && cf.sinceFarmstead === undefined, 'field cooldown advances with the flow');

// s40: a field on a bare 9x9 pad (lay_out_field's placeFarm: no buildings, no streets)
const pad = { x1: 0, z1: 0, x2: 8, z2: 8 };
const farm = placeFarm([], pad, { near: { x: 4, z: 4 } });
ok(!!farm && farm.x2 - farm.x1 + 1 === 5 && farm.z2 - farm.z1 + 1 === 7, `field: 5x7 on a 9x9 pad (${JSON.stringify(farm && [farm.x1, farm.z1, farm.x2, farm.z2])})`);
ok(!!farm && farm.sow.length === 16 && farm.x1 > pad.x1 && farm.x2 < pad.x2 && farm.z1 > pad.z1 && farm.z2 < pad.z2, 'field: 16 sow cells, inside the pad\'s edge');
ok(!placeFarm([], { x1: 0, z1: 0, x2: 6, z2: 6 }), 'field: none on a 7x7 pad');

process.stdout.write(`needworks_unit: ${checks - failures}/${checks} passed\n`);
if (failures) process.exit(1);
