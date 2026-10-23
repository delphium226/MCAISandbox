/**
 * #108's world side (MC_PAY; spec runs/2026-10-23/payments/spec.md): the env pay.ts' hooks need (villages, barter's holds,
 * the levy's rate, the price guide, the chore's earmark), the earmark taken at a chore's end before its share and G3's
 * puts are booked, the goods earmarked for deliveries held from other members, and the delivery option on a payee's
 * menu. mcWorld.ts calls in at its init, its chore end, makeSpare and its menu; nothing here runs with MC_PAY off.
 */
import { ACTS, actOpen, closeCommitment, closeRequest, setPayHooks, tellMember } from '../acts';
import { baseValue, boardOf, held } from '../barter';
import { clockOf } from '../memory';
import { OWN_SALES } from '../own';
import { PAY, contractOf, givePurse, guideFor, makePayHooks, payOf, reconcile, setPayWorld, type Contract, type PayEnv } from '../pay';
import { RULES, levyRate } from '../rules';
import type { Village } from '../village';

type Counts = Record<string, number>;

if (PAY.on && !ACTS.on) throw new Error('MC_PAY=on needs MC_ACTS=on (requests carry the prices) and MC_OWN=on (own chests hold the money)');

/** Whether an item answers an option: gather:logs any log, else the option's own item. */
export const answers = (option: string, item: string) => {
  const what = option.split(':')[1] ?? '';
  return what === 'logs' ? /_log$/.test(item) && !item.startsWith('stripped_') : item === what;
};
const sum = (c: Counts) => Object.values(c).reduce((t, q) => t + q, 0);

/** The options' recent gross puts by member (the guide's median), and the earmarks taken at chores' ends. */
const puts = new Map<string, number[]>();
const marks = new Map<string, Counts>();

export interface PayWorld {
  village(name: string): Village | undefined;
  save(): void;
}

/** The env for pay.ts, and the hooks set into acts.ts (once, at the world's start). */
export function startPay(w: PayWorld): void {
  if (!PAY.on) return;
  const env: PayEnv = {
    village: (n) => w.village(n),
    held: (v, agent) => held(boardOf(v), agent),
    rate: (village) => (RULES.on ? levyRate(village) : Number(process.env.MC_LEVY) || undefined),
    guide: (v, agent, option) => guideOf(v.name, agent, option),
    // (v1: the bounty is minted and logged so: the commons' emeralds are the merchant's, spec 9)
    takeCommonsEmerald: () => false,
    earmark: (v, c, agent, e) => marks.get(`${v.name}|${agent}|${e.chore}`) ?? (c.kind === 'bounty' ? marks.get(`${v.name}|${agent}|${e.chore}|seen`) ?? {} : {}),
    dayKey: (village, now) => String(clockOf(village, now)?.day ?? Math.floor(now / ACTS.dayMs)),
    tell: (village, to, text, now) => tellMember(village, to, text, now),
    save: () => w.save(),
  };
  setPayHooks(makePayHooks(env, { closeRequest }));
  setPayWorld(env, { closeCommitment });
  console.log(`[pay] payments on: purse ${PAY.purse}, prices 1-${PAY.max}, levy on ${PAY.levy}${PAY.bounty ? `, bounty on ${Math.round(PAY.bounty * 100)}% of unpriced requests` : ''}`);
}

/** At load: live contracts whose request and promise are gone, or whose parties left, refunded; and a purse to each member
 *  whose chest stood before payments were on (a checkpoint's village). */
export function reconcilePay(v: Village, members: Set<string>, now: number): void {
  if (!PAY.on) return;
  let purses = 0;
  for (const name of members) if (givePurse(v, name, now)) purses++;
  if (purses) console.log(`[pay] ${v.name}: a purse of ${PAY.purse} emeralds to ${purses} member${purses === 1 ? '' : 's'} whose chest stood already`);
  const n = reconcile(v, (r, c) => actOpen(v.name, r, c), members, now);
  if (n) console.log(`[pay] ${v.name}: ${n} contract${n === 1 ? '' : 's'} refunded at load`);
}

/** The guide: the median of the member's recent gross puts of the option (else the village's), as emeralds. */
function guideOf(village: string, agent: string, option: string): number | undefined {
  const mine = puts.get(`${village}|${agent}|${option}`) ?? [];
  const all = mine.length ? mine : [...puts.entries()].filter(([k]) => k.startsWith(`${village}|`) && k.endsWith(`|${option}`)).flatMap(([, q]) => q);
  if (!all.length) return undefined;
  const med = [...all].sort((x, y) => x - y)[Math.floor(all.length / 2)];
  const item = option.split(':')[1] === 'logs' ? 'oak_log' : option.split(':')[1] ?? '';
  return guideFor(item, med, OWN_SALES, baseValue).n;
}

/**
 * A chore's end, before its share and G3's puts are booked: its gross put of the option's goods (since its start) noted
 * for the guide; when it serves a taken goods contract of the member's, that put (at most 64) earmarked for the buyer and
 * returned, to come off the net the share is taken from. A bounty's goods stay the village's: noted, not earmarked.
 */
export function markAtEnd(v: Village, agent: string, option: string, chore: string, grossStart: Counts | undefined, grossNow: Counts): Counts {
  if (!PAY.on || !grossStart) return {};
  const put: Counts = {};
  for (const [n, q] of Object.entries(grossNow)) {
    const d = q - (grossStart[n] ?? 0);
    if (d > 0 && answers(option, n)) put[n] = d;
  }
  if (!sum(put)) return {};
  const k = `${v.name}|${agent}|${option}`;
  const list = puts.get(k) ?? [];
  list.push(sum(put));
  if (list.length > 7) list.shift();
  puts.set(k, list);
  // (the oldest taken contract of the option the member serves: acts.ts serves the oldest priced promise a chore)
  const c = payOf(v).contracts.filter((x) => x.state === 'taken' && x.payee === agent && x.option === option).sort((x, y) => x.made - y.made)[0];
  if (!c) return {};
  if (c.kind === 'bounty') {
    marks.set(`${v.name}|${agent}|${chore}|seen`, put);
    return {};
  }
  const out: Counts = {};
  let left = 64;
  for (const [n, q] of Object.entries(put)) {
    const t = Math.min(q, left);
    if (t > 0) out[n] = t;
    left -= t;
  }
  marks.set(`${v.name}|${agent}|${chore}`, out);
  setTimeout(() => {
    marks.delete(`${v.name}|${agent}|${chore}`);
    marks.delete(`${v.name}|${agent}|${chore}|seen`);
  }, 60000).unref?.();
  return out;
}

/** Goods earmarked for deliveries not yet made, held from every other use of the commons (makeSpare). */
export function earmarked(v: Village): Counts {
  const out: Counts = {};
  if (!PAY.on) return out;
  for (const c of payOf(v).contracts) if (c.state === 'delivering') for (const [n, q] of Object.entries(c.earmark ?? {})) out[n] = (out[n] ?? 0) + q;
  return out;
}

/** The member's deliveries waiting: its delivering contracts, for the menu's delivery option. */
export function deliveriesOf(v: Village, agent: string): Contract[] {
  if (!PAY.on) return [];
  return payOf(v).contracts.filter((c) => c.state === 'delivering' && c.payee === agent).sort((x, y) => x.t - y.t);
}

/** A delivery's words for its option. */
export function deliveryWords(c: Contract): string {
  return Object.entries(c.earmark ?? {}).map(([n, q]) => `${q} ${n.replace(/_/g, ' ')}`).join(', ') || 'the goods';
}

/** The levy owed deposited into the commons (a storage chest's record and the chest, by command): the world's part. */
export function levyOwed(v: Village): number {
  return PAY.on ? payOf(v).levyOwed : 0;
}
export function levyDeposited(v: Village, n: number, now: number): void {
  const p = payOf(v);
  p.levyOwed = Math.max(0, p.levyOwed - n);
  p.ledger.push({ t: now, op: 'levy deposited', n });
}
export { contractOf };
