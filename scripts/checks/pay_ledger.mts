/**
 * #108's money, offline (pay.ts; spec runs/2026-10-23/payments/spec.md 13.2), on a synthetic village: the purse once;
 * escrow last (a refusal holds nothing); delivery released pro rata, the rest refunded; refunds on expiry, short and
 * reconciliation; a wage paid by step to several helpers; the levy's carry; the pay act's checks and gifts after work;
 * and conservation across a seeded random sequence (members' chests + escrow + the levy owed change only by minted).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/pay_ledger.mts
 */
process.env.MC_OWN = 'on';
process.env.MC_PAY = 'on';
process.env.MC_PURSE = '4';
const P = await import('../../server/src/pay');
type Village = import('../../server/src/village').Village;

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${what}`);
  }
};
const quiet = console.log;
console.log = () => {};
const names = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena'];
const village = (): Village => ({ name: 'T', homes: Object.fromEntries(names.map((n, i) => [n, { owed: {}, got: {}, used: {}, chest: { x: i, y: 64, z: 0, items: {} } }])) } as unknown as Village);
const em = (v: Village, n: string) => v.homes![n].chest!.items.emerald ?? 0;
let t = 1_000_000;

// the purse, once
let v = village();
for (const n of names) P.givePurse(v, n, t);
ok(names.every((n) => em(v, n) === 4) && !P.givePurse(v, 'Ada', t) && em(v, 'Ada') === 4, 'the purse: 4 each, once');
ok(P.mintedOf(v) === 20 && P.emeraldsSeen(v) === 20, 'the purse is minted and seen');

// escrow last: a refusal holds nothing
const r1 = P.openContract(v, { kind: 'goods', payer: 'Ada', option: 'gather:logs', price: 9 }, t);
ok(typeof r1 === 'string' && em(v, 'Ada') === 4, `over the max refused, nothing held (${r1})`);
const r2 = P.openContract(v, { kind: 'goods', payer: 'Ada', option: 'gather:logs', price: 3, held: { emerald: 2 } }, t);
ok(typeof r2 === 'string' && em(v, 'Ada') === 4, `over the free emeralds (barter holds 2) refused (${r2})`);
const c1 = P.openContract(v, { kind: 'goods', payer: 'Ada', option: 'gather:logs', price: 3, request: 'r1' }, t) as import('../../server/src/pay').Contract;
ok(typeof c1 === 'object' && em(v, 'Ada') === 1 && P.escrowOf(v, 'Ada') === 3 && P.emeraldsSeen(v) === 20, 'a price of 3 held in escrow');
ok(!P.takeContract(v, c1.id, 'Ada', 'c1', t), 'the payer cannot take its own');
ok(P.takeContract(v, c1.id, 'Ben', 'c1', t) && c1.state === 'taken', 'Ben takes it');
ok(P.startDelivery(v, c1.id, { oak_log: 12 }, t) && c1.state === 'delivering', 'the chore ended: 12 logs earmarked, delivering');
// half arrived: 1 of 3 paid (floor of 1.5), 2 back; no levy
let s = P.settleDelivery(v, c1.id, { oak_log: 6 }, undefined, t)!;
ok(s.paid === 1 && s.refunded === 2 && em(v, 'Ben') === 5 && em(v, 'Ada') === 3 && c1.state === 'paid' && P.emeraldsSeen(v) === 20, `pro rata: ${JSON.stringify(s)}`);

// the levy: 25% of 3 is 0 now and 0.75 carried, then of 3 again 1 (1.5) carried 0.5
const c2 = P.openContract(v, { kind: 'goods', payer: 'Clara', option: 'make:torch', price: 3 }, t) as import('../../server/src/pay').Contract;
P.takeContract(v, c2.id, 'Dev', 'c2', t);
P.startDelivery(v, c2.id, { torch: 4 }, t);
s = P.settleDelivery(v, c2.id, { torch: 4 }, 0.25, t)!;
ok(s.paid === 3 && s.levy === 0 && v.homes!.Dev.part?.payLevy === 0.75, `the levy's fraction carried (${JSON.stringify(s)}, ${v.homes!.Dev.part?.payLevy})`);
const c3 = P.openContract(v, { kind: 'goods', payer: 'Clara', option: 'make:torch', price: 1 }, t) as import('../../server/src/pay').Contract;
P.takeContract(v, c3.id, 'Dev', 'c3', t);
P.startDelivery(v, c3.id, { torch: 4 }, t);
s = P.settleDelivery(v, c3.id, { torch: 4 }, 0.25, t)!;
ok(s.paid === 0 && s.levy === 1 && P.payOf(v).levyOwed === 1 && P.emeraldsSeen(v) === 20, `the carry reaches a whole emerald (${JSON.stringify(s)})`);

// short: nothing arrived, all refunded
const c4 = P.openContract(v, { kind: 'goods', payer: 'Elena', option: 'gather:logs', price: 2 }, t) as import('../../server/src/pay').Contract;
P.takeContract(v, c4.id, 'Ben', 'c4', t);
P.startDelivery(v, c4.id, { oak_log: 8 }, t);
s = P.settleDelivery(v, c4.id, {}, 0.25, t)!;
ok(s.paid === 0 && s.refunded === 2 && em(v, 'Elena') === 4 && c4.state === 'refunded', 'short: refunded');

// expiry after 30 minutes
const c5 = P.openContract(v, { kind: 'goods', payer: 'Elena', option: 'gather:sand', price: 2 }, t) as import('../../server/src/pay').Contract;
ok(P.expire(v, t + 29 * 60000).length === 0 && P.expire(v, t + 30 * 60000).length === 1 && em(v, 'Elena') === 4 && c5.state === 'refunded', 'expired untaken: refunded');

// a wage: 2 steps of 1, two helpers, a third step refused
const w = P.openContract(v, { kind: 'wage', payer: 'Ben', option: 'help:i7', price: 1, steps: 2 }, t) as import('../../server/src/pay').Contract;
ok(w.escrow === 2 && P.payStep(v, w.id, 'Ben', undefined, t) === 0, 'the owner is not paid for its own project');
ok(P.payStep(v, w.id, 'Clara', undefined, t) === 1 && P.payStep(v, w.id, 'Dev', undefined, t) === 1 && w.state === 'paid' && P.payStep(v, w.id, 'Elena', undefined, t) === 0, 'two helpers paid a step each, then closed');

// reconciliation: a taken contract whose promise is gone, and one whose payee left
const c6 = P.openContract(v, { kind: 'goods', payer: 'Ada', option: 'gather:logs', price: 1, request: 'r6' }, t) as import('../../server/src/pay').Contract;
P.takeContract(v, c6.id, 'Ben', 'c6', t);
const before = em(v, 'Ada');
ok(P.reconcile(v, () => false, new Set(names), t) === 1 && em(v, 'Ada') === before + 1 && c6.state === 'refunded', 'reconciled: refunded');

// the pay act
const day = 'd1';
ok(P.payNow(v, 'Ada', 'Ada', 'emerald', 1, {}, t, day).startsWith('you cannot'), 'not to itself');
ok(P.payNow(v, 'Ada', 'Ben', 'emerald', 99, {}, t, day).includes('free'), 'not more than it holds');
ok(P.payNow(v, 'Ada', 'Zed', 'emerald', 1, {}, t, day).includes('no chest'), 'not to a member with no chest');
const a0 = em(v, 'Ada'), b0 = em(v, 'Ben');
ok(P.payNow(v, 'Ada', 'Ben', 'emerald', 1, {}, t, day).startsWith('paid') && em(v, 'Ada') === a0 - 1 && em(v, 'Ben') === b0 + 1, 'a gift moves at once, no levy');
P.payNow(v, 'Ada', 'Ben', 'emerald', 1, {}, t, day);
P.payNow(v, 'Ada', 'Ben', 'emerald', 1, {}, t, day);
ok(P.payNow(v, 'Ada', 'Ben', 'emerald', 1, {}, t, day).includes('3 times'), 'three a day');
// a gift after work: Ada paid Ben's contract c1 at t, a gift within 10 minutes is logged so
ok(P.payOf(v).ledger.some((r) => r.op === 'gift after work' && r.from === 'Ada' && r.to === 'Ben'), 'a gift after a delivery is logged as a gift after work');
ok(P.emeraldsSeen(v) === 20 + 0 && P.mintedOf(v) === 20, `conservation after the cases (${P.emeraldsSeen(v)})`);

// conservation across a random sequence
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
v = village();
for (const n of names) P.givePurse(v, n, t);
let ops = 0, bad = 0;
for (let i = 0; i < 3000; i++) {
  t += 20000;
  const a = pick(names), b = pick(names);
  const live = P.payOf(v).contracts.filter((c) => c.state === 'open' || c.state === 'taken' || c.state === 'delivering');
  const r = rnd();
  if (r < 0.25) P.openContract(v, { kind: rnd() < 0.3 ? 'wage' : 'goods', payer: a, option: 'gather:logs', price: 1 + Math.floor(rnd() * 8), steps: 1 + Math.floor(rnd() * 4) }, t);
  else if (r < 0.35) P.openBounty(v, 'gather:logs', `r${i}`, rnd() < 0.5, t);
  else if (r < 0.5 && live.length) { const c = pick(live); if (c.kind !== 'wage') P.takeContract(v, c.id, b, `c${i}`, t); else P.payStep(v, c.id, b, rnd() < 0.5 ? 0.25 : undefined, t); }
  else if (r < 0.6 && live.length) { const c = pick(live); if (c.state === 'taken') P.startDelivery(v, c.id, { oak_log: 1 + Math.floor(rnd() * 12) }, t); }
  else if (r < 0.7 && live.length) { const c = pick(live); if (c.state === 'delivering') P.settleDelivery(v, c.id, { oak_log: Math.floor(rnd() * 14) }, rnd() < 0.5 ? 0.3 : undefined, t); else if (c.kind === 'bounty') P.payBounty(v, c.id, b, t); }
  else if (r < 0.78 && live.length) P.refund(v, pick(live).id, 'random', t);
  else if (r < 0.9) P.payNow(v, a, b, 'emerald', 1 + Math.floor(rnd() * 3), {}, t, `d${Math.floor(i / 50)}`);
  else P.expire(v, t);
  ops++;
  // members' chests + escrow + the levy owed = minted (no merchant here; a bounty from the commons counts as minted into
  // this sum, logged as escrow from the village)
  const fromCommons = P.payOf(v).ledger.filter((x) => x.op === 'escrow' && x.from === 'the village').reduce((tt, x) => tt + x.n, 0);
  if (P.emeraldsSeen(v) !== P.mintedOf(v) + fromCommons) bad++;
  if (Object.values(v.homes!).some((h) => (h.chest!.items.emerald ?? 0) < 0)) bad++;
}
ok(bad === 0, `conservation over ${ops} random operations (${bad} breaks; seen ${P.emeraldsSeen(v)})`);
console.log = quiet;
console.log(`pay_ledger: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
