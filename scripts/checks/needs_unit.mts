/**
 * The needs' pure parts (server/src/needs.ts, spec runs/2026-10-18/s36/spec_needs_v2.md A) checked offline: readNeeds on
 * hand inputs (no member, every gauge absent, full, empty, the texts within 80 chars, the mine's blocked reason, storage in
 * slots or in chests), stepNeed's
 * statuses and durations (met, low, answered for 10 minutes after a fall, no answer at HIGH after 10 minutes, blocked,
 * ignored after 6 untaken offers, a take clearing them, dt capped at 60 s, a first reading counting no time) and needWeight's
 * bounds. Deterministic. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/needs_unit.mts
 */
import { HIGH, LOW, NEED_TRAIT, needWeight, readNeeds, stepNeed, type NeedReading, type NeedState } from '../../server/src/needs';

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}
const by = (rs: NeedReading[], kind: string) => rs.find((r) => r.kind === kind);

// readNeeds
ok(readNeeds({ members: 5 }).length === 0, 'every gauge absent: no reading');
const all = readNeeds({ members: 25, houses: 22, unlit: 31, spots: 62, unlitParts: 6, openDecor: 12, decorSpots: 40, openDecorParts: 4, hungry: 4, chests: 8, chestSpots: 9, mineHeld: 3, mineFaces: 12 });
ok(all.map((r) => r.kind).join() === 'light,furnish,food,housing,storage,mine', 'every gauge kept, in order');
ok(by(all, 'light')?.text === '31 unlit spots in 6 buildings' && by(all, 'light')?.level === 0.5 && by(all, 'light')?.amount === 31, 'light: text, level, amount');
ok(by(all, 'furnish')?.text === '12 open decor spots in 4 buildings' && by(all, 'furnish')?.level === 0.3, 'furnish');
ok(by(all, 'food')?.text === '4 of 25 members hungry' && by(all, 'food')?.level === 0.16, 'food');
ok(by(all, 'housing')?.text === '3 of 25 members without a house' && by(all, 'housing')?.level === 0.12 && by(all, 'housing')?.amount === 3, 'housing');
ok(by(all, 'storage')?.text === '8 of 9 chest spots used' && Math.abs(by(all, 'storage')!.level - 8 / 9) < 1e-9, 'storage');
ok(by(all, 'mine')?.text === '3 of 12 mine faces held' && by(all, 'mine')?.level === 0.25, 'mine');
ok(all.every((r) => r.text.length > 0 && r.text.length <= 80 && r.level >= 0 && r.level <= 1), 'texts 1-80 chars, levels 0..1');
const none = readNeeds({ members: 0, houses: 0, hungry: 0, unlit: 0, spots: 0, chests: 0, chestSpots: 0 });
ok(none.length === 4 && none.every((r) => r.level === 0), 'no member, no spots: every level 0');
ok(by(readNeeds({ members: 0.5, hungry: 3, houses: 0 }), 'food')?.level === 0 && by(readNeeds({ members: 0.5, houses: 0 }), 'housing')?.level === 0, 'members < 1: shares 0');
const full = readNeeds({ members: 4, houses: 0, hungry: 4, unlit: 10, spots: 10, chests: 9, chestSpots: 9 });
ok(full.every((r) => r.level === 1), 'full: every level 1');
ok(by(readNeeds({ members: 4, hungry: 9, houses: 9 }), 'food')?.level === 1 && by(readNeeds({ members: 4, houses: 9 }), 'housing')?.level === 0, 'over a whole clamps to 1; more houses than members: 0');
ok(by(readNeeds({ members: 1, unlit: 1, spots: 4 }), 'light')?.text === '1 unlit spot of 4', 'light without parts, singular');
const blocked = by(readNeeds({ members: 3, mineHeld: 0, mineFaces: 6, mineBlocked: 'no pickaxe in storage' }), 'mine');
ok(blocked?.text.includes('mine blocked') && blocked.text.includes('no pickaxe') && blocked.text.length <= 80, 'mine blocked: the text says so');
ok(by(readNeeds({ members: 3, mineHeld: 0, mineFaces: 6, mineBlocked: 'x'.repeat(200) }), 'mine')!.text.length <= 80, 'a long reason clipped to 80');
ok(readNeeds({ members: 3, unlit: 2 }).length === 0, 'a half-given gauge is not kept');
// (s40, F256: a mine that gives no stone has no faces; it reads full now instead of going unread)
ok(by(readNeeds({ members: 3, mineBlocked: 'it gives no stone' }), 'mine')?.level === 1, 'a blocked mine without faces reads full');
// storage in slots (s37 S1): read before the chests, which stay for the text
const slotted = by(readNeeds({ members: 25, slots: 99, slotCap: 243, chests: 8, chestSpots: 9 }), 'storage');
ok(slotted?.text === '99 of 243 storage slots used (8 of 9 chests)' && Math.abs(slotted.level - 99 / 243) < 1e-9 && slotted.amount === 99, 'storage in slots: text, level, amount');
ok(by(readNeeds({ members: 25, slots: 40, slotCap: 54 }), 'storage')?.text === '40 of 54 storage slots used', 'slots without chests: no chest count');
ok(by(readNeeds({ members: 1, slots: 3, slotCap: 27, chests: 1, chestSpots: 1 }), 'storage')?.text === '3 of 27 storage slots used (1 of 1 chest)', 'one chest: singular');
ok(by(readNeeds({ members: 3, slots: 0, slotCap: 0, chests: 0, chestSpots: 0 }), 'storage')?.level === 0, 'no slots at all: level 0');
ok(by(readNeeds({ members: 3, slots: 300, slotCap: 243 }), 'storage')?.level === 1, 'over the cap clamps to 1');
ok(by(readNeeds({ members: 3, slots: 10, chests: 2, chestSpots: 9 }), 'storage')?.text === '2 of 9 chest spots used', 'slots without a cap: the chests reading');
ok(by(readNeeds({ members: 3, slots: 99999, slotCap: 99999, chests: 9999, chestSpots: 9999 }), 'storage')!.text.length <= 80, 'slots text within 80');
ok(readNeeds({ members: 3, slotCap: 27 }).length === 0, 'a cap without slots: no reading');
ok(JSON.stringify(readNeeds({ members: 25, unlit: 31, spots: 62 })) ===JSON.stringify(readNeeds({ members: 25, unlit: 31, spots: 62 })), 'deterministic');

// stepNeed
const rd = (level: number, amount: number): NeedReading => ({ kind: 'light', level, amount, text: '' });
const quiet = { offered: false, taken: false };
const s0 = stepNeed(undefined, rd(0.1, 2), 30_000, quiet, true);
ok(s0.status === 'met' && s0.aboveMs === 0 && s0.offeredSweeps === 0, 'below LOW: met');
const s1 = stepNeed(undefined, rd(0.5, 20), 30_000, quiet, true);
ok(s1.status === 'low' && s1.aboveMs === 0 && s1.lastFallMs === 600_000, 'a first reading: low, no time counted, no fall');
const s2 = stepNeed(s1, rd(0.5, 20), 30_000, quiet, true);
ok(s2.aboveMs === 30_000 && s2.lastFallMs === 630_000 && s2.status === 'low', 'durations add up');
ok(stepNeed(s1, rd(0.5, 20), 600_000, quiet, true).aboveMs === 60_000, 'dt capped at 60 s');
ok(stepNeed(s1, rd(0.5, 20), -5, quiet, true).aboveMs === 0 && stepNeed(s1, rd(0.5, 20), NaN, quiet, true).aboveMs === 0, 'a bad dt counts nothing');
const fell = stepNeed(s2, rd(0.45, 18), 30_000, quiet, true);
ok(fell.status === 'answered' && fell.lastFallMs === 0, 'the amount fell: answered');
let st: NeedState = fell;
for (let k = 0; k < 19; k++) st = stepNeed(st, rd(0.45, 18), 30_000, quiet, true);
ok(st.status === 'answered' && st.lastFallMs === 570_000, 'answered while the fall is under 10 minutes old');
st = stepNeed(st, rd(0.45, 18), 30_000, quiet, true);
ok(st.status === 'low' && st.lastFallMs === 600_000, 'no fall for 10 minutes: low again');
ok(stepNeed(st, rd(0.5, 25), 30_000, quiet, true).status === 'low', 'a rise is not an answer');
ok(stepNeed(fell, rd(0.1, 2), 30_000, quiet, true).status === 'met', 'met before answered');
ok(stepNeed(s2, rd(0.2, 20), 30_000, quiet, true).aboveMs === 0, 'below LOW clears aboveMs');

let hi: NeedState | undefined;
for (let k = 0; k <= 20; k++) hi = stepNeed(hi, rd(0.8, 40), 30_000, quiet, false);
ok(hi!.aboveMs === 600_000 && hi!.status === 'no answer', 'at HIGH 10 minutes, not answerable: no answer');
let hi2: NeedState | undefined;
for (let k = 0; k <= 19; k++) hi2 = stepNeed(hi2, rd(0.8, 40), 30_000, quiet, false);
ok(hi2!.status === 'low', 'at HIGH under 10 minutes: low');
ok(stepNeed(hi, rd(0.8, 40), 30_000, quiet, true).status === 'low', 'answerable: never no answer');
ok(stepNeed(hi, rd(0.5, 40), 30_000, quiet, false).status === 'low', 'under HIGH: never no answer');
ok(stepNeed(hi, rd(0.8, 39), 30_000, quiet, false).status === 'answered', 'answered before no answer');
ok(stepNeed(hi, rd(0.8, 40), 30_000, { offered: false, taken: false, blocked: 'no sand near' }, false).status === 'no answer', 'no answer before blocked');

const b = stepNeed(s2, rd(0.5, 20), 30_000, { offered: false, taken: false, blocked: 'torches short' }, true);
ok(b.status === 'blocked' && b.why === 'torches short', 'blocked, with why');
ok(stepNeed(b, rd(0.5, 20), 30_000, quiet, true).why === undefined, 'why only while blocked');
let ig: NeedState = s2;
const offer = { offered: true, taken: false };
for (let k = 0; k < 5; k++) ig = stepNeed(ig, rd(0.5, 20), 30_000, offer, true);
ok(ig.offeredSweeps === 5 && ig.status === 'low', '5 untaken offers: low');
ig = stepNeed(ig, rd(0.5, 20), 30_000, offer, true);
ok(ig.offeredSweeps === 6 && ig.status === 'ignored', '6 untaken offers: ignored');
ok(stepNeed(ig, rd(0.5, 20), 30_000, { offered: true, taken: false, blocked: 'inputs short' }, true).status === 'blocked', 'blocked before ignored');
ok(stepNeed(ig, rd(0.5, 20), 30_000, quiet, true).offeredSweeps === 6, 'not offered: the count stays');
const took = stepNeed(ig, rd(0.5, 20), 30_000, { offered: true, taken: true }, true);
ok(took.offeredSweeps === 0 && took.status === 'low', 'taken: the count clears');
ok(JSON.stringify(stepNeed(s2, rd(0.5, 20), 30_000, offer, true)) === JSON.stringify(stepNeed(s2, rd(0.5, 20), 30_000, offer, true)), 'deterministic');
ok(JSON.parse(JSON.stringify(s1)).lastFallMs === 600_000, 'a state survives JSON (no Infinity)');

// needWeight
ok(needWeight(0, 1) === 1 && needWeight(1, 0) === 1.5 && needWeight(1, 1) === 2.5, 'needWeight: 1 at level 0, 1.5 and 2.5 at level 1');
ok(needWeight(0.5, 0.5) === 1.5, 'needWeight: 1 + 0.5 x 1');
ok(needWeight(5, 5) === 2.5 && needWeight(1, -1) === 1.5 && needWeight(-1, 1) === 1 && needWeight(NaN, 1) === 1, 'needWeight: bounded 1..2.5');
ok(NEED_TRAIT.food === 'care' && NEED_TRAIT.light === 'diligence' && NEED_TRAIT.furnish === 'pride', 'traits: food care, light diligence, furnish pride');
ok(LOW === 0.25 && HIGH === 0.6, 'LOW and HIGH');

process.stdout.write(`${failures ? 'FAIL' : 'OK'} needs_unit: ${checks - failures} of ${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
