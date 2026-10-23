/**
 * G3's levy on MC_OWN's shares, offline (spec runs/2026-10-21/g3-rules/spec.md 4, as revised; own.ts): a sharing chore's
 * share pended, not owed (earnShare's fractions and exclusions); the pending total and its age; the levy's amount
 * (rounded, at most all; not at least 1 since 10-23); settled as none / levy / all (the most plentiful items left first); a pending share
 * older than a day lapses to the member whole.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/own_pending_unit.mts
 */
import { lapsePending, levyLeft, pendShare, pendingOf, settlePending } from '../../server/src/own';
import type { OwnStock } from '../../server/src/village';

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const fresh = (): OwnStock => ({ owed: {}, got: {}, used: {} });

// Pended, not owed; fractions carried as earnShare's; tools never shared
{
  const o = fresh();
  const a = pendShare(o, { wheat: 12, carrot: 4, iron_pickaxe: 1 }, 1000, 0.25);
  ok(a.wheat === 3 && a.carrot === 1 && !a.iron_pickaxe, `added ${JSON.stringify(a)}`);
  ok(!Object.keys(o.owed).length, 'nothing owed while pending');
  const p = pendingOf(o)!;
  ok(p.total === 4 && p.since === 1000, `pending ${JSON.stringify(p)}`);
  pendShare(o, { egg: 2 }, 5000, 0.25);
  ok(pendingOf(o)!.since === 1000 && o.part?.egg === 0.5, 'its age from the first; small yields add up in part');
  pendShare(o, { egg: 2 }, 6000, 0.25);
  ok(pendingOf(o)!.total === 5 && pendingOf(o)!.items.egg === 1, 'four eggs at 0.25 pend one');
}

// The levy's amount
ok(levyLeft(1, 0.1) === 0 && levyLeft(4, 0.1) === 0 && levyLeft(5, 0.1) === 1 && levyLeft(10, 0.2) === 2 && levyLeft(3, 0.2) === 1 && levyLeft(0, 0.2) === 0 && levyLeft(5, 0) === 0 && levyLeft(2, 0.5) === 1 && levyLeft(4, 1) === 4, 'levyLeft');

// Settled three ways
{
  const mk = () => {
    const o = fresh();
    pendShare(o, { wheat: 24, carrot: 8 }, 0, 0.25);
    return o;
  };
  const a = mk(), b = mk(), c = mk();
  const ra = settlePending(a, 'none', 0.2)!, rb = settlePending(b, 'levy', 0.2)!, rc = settlePending(c, 'all', 0.2)!;
  ok(a.owed.wheat === 6 && a.owed.carrot === 2 && !Object.keys(ra.left).length, `none: ${JSON.stringify(a.owed)}`);
  ok(rb.left.wheat === 2 && !rb.left.carrot && b.owed.wheat === 4 && b.owed.carrot === 2, `levy 20% of 8 leaves 2 wheat: ${JSON.stringify(rb)}`);
  ok(!Object.keys(c.owed).length && rc.left.wheat === 6 && rc.left.carrot === 2, `all: ${JSON.stringify(rc)}`);
  ok(!pendingOf(a) && !pendingOf(b) && !pendingOf(c) && settlePending(a, 'none', 0) === null, 'settled once');
}

// Lapses after a day, whole
{
  const o = fresh();
  pendShare(o, { wheat: 8 }, 0, 0.25);
  ok(lapsePending(o, 1000, 60000) === null && !!pendingOf(o), 'not before the day');
  const l = lapsePending(o, 60000, 60000);
  ok(l?.wheat === 2 && o.owed.wheat === 2 && !pendingOf(o), `lapsed whole: ${JSON.stringify(l)}`);
}

console.log(`own_pending_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
