/**
 * Members pay each other (#108; spec runs/2026-10-23/payments/spec.md). World-free: contracts and their escrow, the purse,
 * the levy on payments, the `pay` act's move, refunds and the ledger. The world (mcWorld.ts, mcBuild.ts, mcStorage.ts)
 * moves goods and writes chests; acts.ts calls in through its pay hooks. Everything here is behind MC_PAY (off).
 *
 * Money is the emeralds in members' own chest records (v.homes[name].chest.items.emerald). A priced contract moves its
 * price out of the payer's record into the contract's escrow; release moves it to the payee less the levy, which waits in
 * v.levyOwed until the world deposits it into the village's storage. Members' chests + escrow + levyOwed change only by
 * `minted` (the purse, the bounty's top-up) and merchant trades: payments create no money (checks/pay_ledger.mts).
 */
import { OWN } from './own';
import type { OwnStock, Village } from './village';

type Counts = Record<string, number>;
const on = (v: string | undefined) => /^(on|1|true)$/i.test(v ?? 'off');

export const PAY = {
  on: OWN.on && on(process.env.MC_PAY),
  /** The most a request may offer, in whole emeralds (per step for wages). */
  max: Math.max(1, Number(process.env.MC_PAY_MAX) || 8),
  /** Emeralds each member gets once, when its own chest is placed (the user's choice 1). */
  purse: Math.max(0, Number(process.env.MC_PURSE ?? 4)),
  /** The levy on contracts (the user's choice 3: gifts go free): 'contracts' or 'off'. */
  levy: (process.env.MC_PAY_LEVY ?? 'contracts') === 'off' ? 'off' : 'contracts',
  /** Test only: the share of unpriced requests given a 1-emerald bounty (the user's choice 4). */
  bounty: Math.min(1, Math.max(0, Number(process.env.MC_PAY_BOUNTY) || 0)),
  /** How long an untaken priced request holds its escrow. */
  expireMs: 30 * 60000,
  /** A gift to a member who delivered to the payer within this long is logged as a gift after work. */
  afterWorkMs: 10 * 60000,
  /** The `pay` act's budget a village day. */
  perDay: 3,
};

export type ContractKind = 'goods' | 'wage' | 'bounty';
export type ContractState = 'open' | 'taken' | 'delivering' | 'paid' | 'refunded';

export interface Contract {
  id: string;
  kind: ContractKind;
  /** Who pays (a member; 'village' for a bounty). */
  payer: string;
  /** Who is paid: the taker of a goods contract or a bounty; a wage's helpers are paid by step. */
  payee?: string;
  /** The option that settles it (gather:logs, make:torch, help:<project>). */
  option: string;
  /** Emeralds a delivery (goods, bounty) or a step (wage). */
  price: number;
  steps: number;
  paidSteps: number;
  /** Emeralds still held. */
  escrow: number;
  state: ContractState;
  why?: string;
  /** Goods earmarked for the buyer at the chore's end, and what reached its chest; `inHand`: the part the deliverer
   *  kept in hand (a full storage refused it), not withdrawn. */
  earmark?: Counts;
  inHand?: Counts;
  arrived?: Counts;
  /** acts.ts' ids. */
  request?: string;
  commitment?: string;
  made: number;
  t: number;
}

export type LedgerOp = 'control' | 'minted' | 'escrow' | 'release' | 'levy' | 'sales levy' | 'refund' | 'gift' | 'gift after work' | 'goods' | 'levy deposited' | 'reconciled';
export interface LedgerRow { t: number; op: LedgerOp; from?: string; to?: string; n: number; item?: string; contract?: string; why?: string }

interface PayState { contracts: Contract[]; next: number; levyOwed: number; ledger: LedgerRow[]; payDays?: Record<string, number> }

/** The village's payments record (in villages.json beside the chests, so escrow and chests are saved together). */
export function payOf(v: Village): PayState {
  const x = v as Village & { pay?: PayState };
  return (x.pay ??= { contracts: [], next: 1, levyOwed: 0, ledger: [] });
}

/** The ledger keeps this many rows (the newest); conservation is checked over what it holds. */
const LEDGER_MAX = 4000;

function log(p: PayState, row: LedgerRow) {
  p.ledger.push(row);
  if (p.ledger.length > LEDGER_MAX) p.ledger.splice(0, p.ledger.length - LEDGER_MAX);
  console.log(`[pay] ${row.op} ${row.n} ${row.item ?? 'emerald'}${row.from ? ` from ${row.from}` : ''}${row.to ? ` to ${row.to}` : ''}${row.contract ? ` (${row.contract})` : ''}${row.why ? `: ${row.why}` : ''}`);
}

const chestOf = (v: Village, name: string) => v.homes?.[name]?.chest;
const em = (v: Village, name: string) => chestOf(v, name)?.items.emerald ?? 0;
function addTo(v: Village, name: string, item: string, n: number) {
  const c = chestOf(v, name);
  if (!c) return false;
  c.items[item] = (c.items[item] ?? 0) + n;
  if (c.items[item] <= 0) delete c.items[item];
  return true;
}

/** Emeralds a member may spend now: its chest's less what barter holds of them (`held`, barter.ts). */
export function freeEmeralds(v: Village, name: string, held: Counts = {}): number {
  return Math.max(0, em(v, name) - (held.emerald ?? 0));
}

/** Emeralds a member holds in escrow for its own contracts (the wealth goal's worth counts them as the payer's). */
export function escrowOf(v: Village, name: string): number {
  return payOf(v).contracts.filter((c) => c.payer === name && (c.state === 'open' || c.state === 'taken' || c.state === 'delivering')).reduce((t, c) => t + c.escrow, 0);
}

/** The purse (choice 1): MC_PURSE emeralds into a member's own chest record once, logged as minted. True if given. */
export function givePurse(v: Village, name: string, now: number): boolean {
  const own = v.homes?.[name] as (OwnStock & { pursed?: boolean }) | undefined;
  if (!PAY.on || !own?.chest || own.pursed || PAY.purse <= 0) return false;
  own.pursed = true;
  addTo(v, name, 'emerald', PAY.purse);
  log(payOf(v), { t: now, op: 'minted', to: name, n: PAY.purse, why: 'the purse' });
  return true;
}

/**
 * A priced request's contract: checks the price and the payer's free emeralds, then holds the price (x steps) in escrow
 * last, so a refusal leaves nothing to roll back. Returns the contract, or a refusal for the model.
 */
export function openContract(v: Village, o: { kind: ContractKind; payer: string; option: string; price: number; steps?: number; request?: string; held?: Counts; to?: string }, now: number): Contract | string {
  const price = Math.floor(Number(o.price));
  const steps = o.kind === 'wage' ? Math.max(1, Math.min(4, Math.floor(Number(o.steps) || 1))) : 1;
  if (!Number.isFinite(price) || price < 1 || price > PAY.max) return `a price is 1 to ${PAY.max} emeralds${o.kind === 'wage' ? ' a step' : ''}`;
  if (o.kind !== 'bounty') {
    if (!chestOf(v, o.payer)) return `you have no chest of your own yet to pay from`;
    if (o.to && o.to !== 'anyone' && !chestOf(v, o.to)) return `${o.to} has no chest of their own yet to be paid into`;
    const free = freeEmeralds(v, o.payer, o.held);
    if (free < price * steps) return `you hold ${free} emerald${free === 1 ? '' : 's'} free, not the ${price * steps} this needs`;
  }
  const p = payOf(v);
  const c: Contract = { id: `k${p.next++}`, kind: o.kind, payer: o.payer, option: o.option, price, steps, paidSteps: 0, escrow: price * steps, state: 'open', made: now, t: now, ...(o.request ? { request: o.request } : {}) };
  if (o.kind !== 'bounty') addTo(v, o.payer, 'emerald', -c.escrow);
  p.contracts.push(c);
  // (a bounty's row is openBounty's: from the commons, or minted)
  if (o.kind !== 'bounty') log(p, { t: now, op: 'escrow', from: o.payer, n: c.escrow, contract: c.id, why: o.option });
  return c;
}

export const contractOf = (v: Village, id: string | undefined) => (id ? payOf(v).contracts.find((c) => c.id === id) : undefined);
export const contractOfRequest = (v: Village, request: string) => payOf(v).contracts.find((c) => c.request === request);
const live = (c: Contract) => c.state === 'open' || c.state === 'taken' || c.state === 'delivering';

/** A goods contract or bounty taken up by a promise. */
export function takeContract(v: Village, id: string, payee: string, commitment: string, now: number): boolean {
  const c = contractOf(v, id);
  if (!c || c.state !== 'open' || c.kind === 'wage' || payee === c.payer) return false;
  Object.assign(c, { payee, commitment, state: 'taken' as const, t: now });
  return true;
}

/** The levy's split of a payment (choice 3: contracts only): whole emeralds to the levy, the fraction carried per payee. */
export function payLevy(v: Village, payee: string, n: number, rate: number | undefined): { kept: number; levy: number } {
  if (!rate || rate <= 0 || PAY.levy === 'off') return { kept: n, levy: 0 };
  const own = v.homes?.[payee];
  const part = (own ? (own.part ??= {}) : {}) as Counts;
  const x = (part.payLevy ?? 0) + n * Math.min(1, rate);
  const levy = Math.min(n, Math.floor(x + 1e-9));
  part.payLevy = Math.round((x - levy) * 1000) / 1000;
  if (!part.payLevy) delete part.payLevy;
  return { kept: n - levy, levy };
}

/** Escrow paid out to a payee less the levy (the levy into v.levyOwed, deposited by the world). */
function payOut(v: Village, c: Contract, payee: string, n: number, rate: number | undefined, now: number): { kept: number; levy: number } {
  const p = payOf(v);
  if (n <= 0) return { kept: 0, levy: 0 };
  c.escrow -= n;
  const s = payLevy(v, payee, n, rate);
  addTo(v, payee, 'emerald', s.kept);
  p.levyOwed += s.levy;
  log(p, { t: now, op: 'release', from: c.payer, to: payee, n: s.kept, contract: c.id, why: c.option });
  if (s.levy) log(p, { t: now, op: 'levy', from: payee, n: s.levy, contract: c.id });
  return s;
}

/** The rest of a contract's escrow back to its payer (a bounty's to the commons: v.levyOwed's deposit path), closed refunded. */
export function refund(v: Village, id: string, why: string, now: number): number {
  const c = contractOf(v, id);
  if (!c || !live(c)) return 0;
  const n = c.escrow;
  const p = payOf(v);
  if (n > 0) {
    if (c.kind === 'bounty' || !addTo(v, c.payer, 'emerald', n)) p.levyOwed += n;
    log(p, { t: now, op: 'refund', to: c.kind === 'bounty' || !chestOf(v, c.payer) ? 'the village' : c.payer, n, contract: c.id, why });
  }
  Object.assign(c, { escrow: 0, state: 'refunded' as const, why, t: now });
  return n;
}

/** A goods contract's chore ended with goods earmarked in storage for the buyer: waiting for delivery. */
export function startDelivery(v: Village, id: string, earmark: Counts, now: number): boolean {
  const c = contractOf(v, id);
  if (!c || c.state !== 'taken' || c.kind !== 'goods') return false;
  Object.assign(c, { earmark: { ...earmark }, state: 'delivering' as const, t: now });
  return true;
}

/**
 * The delivery reached the buyer's chest (or fell short): the price released pro rata to what arrived over what was
 * earmarked (whole emeralds, the rest refunded), the levy from the payee's side. A delivery of nothing refunds `short`.
 */
export function settleDelivery(v: Village, id: string, arrived: Counts, rate: number | undefined, now: number): { paid: number; levy: number; refunded: number } | null {
  const c = contractOf(v, id);
  if (!c || c.state !== 'delivering' || !c.payee) return null;
  const want = Object.values(c.earmark ?? {}).reduce((t, q) => t + q, 0);
  const got = Math.min(want, Object.values(arrived).reduce((t, q) => t + Math.max(0, q), 0));
  c.arrived = { ...arrived };
  if (got <= 0 || want <= 0) return { paid: 0, levy: 0, refunded: refund(v, id, 'short: nothing reached the buyer', now) };
  const n = Math.min(c.escrow, Math.floor((c.price * got) / want + 1e-9));
  const s = payOut(v, c, c.payee, n, rate, now);
  const refunded = c.escrow > 0 ? refund(v, id, `pro rata: ${got} of ${want} arrived`, now) : 0;
  Object.assign(c, { state: 'paid' as const, t: now });
  return { paid: s.kept, levy: s.levy, refunded };
}

/** A bounty's deliverer paid at its chore's end (the goods are already in storage, where a bounty's go). */
export function payBounty(v: Village, id: string, payee: string, now: number): number {
  const c = contractOf(v, id);
  if (!c || c.kind !== 'bounty' || !live(c) || !chestOf(v, payee)) return 0;
  c.payee = payee;
  const s = payOut(v, c, payee, c.escrow, undefined, now);
  Object.assign(c, { state: 'paid' as const, t: now });
  return s.kept;
}

/** A wage's step done by a helper: one step's price to it, the request closed once its steps are paid. */
export function payStep(v: Village, id: string, helper: string, rate: number | undefined, now: number): number {
  const c = contractOf(v, id);
  if (!c || c.kind !== 'wage' || !live(c) || helper === c.payer || !chestOf(v, helper) || c.escrow < c.price) return 0;
  const s = payOut(v, c, helper, c.price, rate, now);
  c.paidSteps++;
  c.t = now;
  if (c.paidSteps >= c.steps || c.escrow <= 0) Object.assign(c, { state: 'paid' as const });
  return s.kept;
}

/** A bounty's contract: its emerald from the commons or minted (the arms kept random). `commonsSpare` undefined: the world
 *  funds it after (an emerald taken from storage by command, checked), and logs which through bountyFunded. */
export function openBounty(v: Village, option: string, request: string, commonsSpare: boolean | undefined, now: number): Contract {
  const c = openContract(v, { kind: 'bounty', payer: 'village', option, price: 1, request }, now) as Contract;
  if (commonsSpare !== undefined) bountyFunded(v, c.id, commonsSpare, now);
  return c;
}

/** How a bounty's emerald came: from the commons (taken out of a storage chest) or minted. */
export function bountyFunded(v: Village, id: string, fromCommons: boolean, now: number): void {
  log(payOf(v), { t: now, op: fromCommons ? 'escrow' : 'minted', from: fromCommons ? 'the village' : undefined, n: 1, contract: id, why: fromCommons ? 'a bounty from the commons' : 'a bounty minted: the commons could not spare one' });
}

/** A levy owed the commons from outside the payments (merchant_own's sales levy), deposited by the world as the
 *  payments' levy is. */
export function oweLevy(v: Village, n: number, from: string, now: number, why: string): void {
  if (n <= 0) return;
  const p = payOf(v);
  p.levyOwed += n;
  log(p, { t: now, op: 'sales levy', from, n, why });
}

/** The levy's emeralds that reached a storage chest (written and counted by the world). */
export function levyDeposited(v: Village, n: number, now: number, where?: string): void {
  if (n <= 0) return;
  const p = payOf(v);
  p.levyOwed = Math.max(0, p.levyOwed - n);
  log(p, { t: now, op: 'levy deposited', n, ...(where ? { why: where } : {}) });
}

/**
 * The `pay` act: emeralds or a good from the payer's own chest to the payee's at once, no levy (gifts go free); a gift to
 * a member who delivered to the payer lately is logged as a gift after work. Returns the report, or a refusal.
 */
export function payNow(v: Village, from: string, to: string, item: string, n: number, held: Counts, now: number, dayKey: string): string {
  const amount = Math.floor(Number(n));
  if (!PAY.on) return 'payments are off';
  if (!to || to === from) return 'you cannot pay yourself';
  if (!chestOf(v, from)) return 'you have no chest of your own yet';
  if (!chestOf(v, to)) return `${to} has no chest of their own yet`;
  if (!Number.isFinite(amount) || amount < 1) return 'an amount is a whole number, at least 1';
  const p = payOf(v);
  const days = (p.payDays ??= {});
  const k = `${from}|${dayKey}`;
  if ((days[k] ?? 0) >= PAY.perDay) return `you have paid ${PAY.perDay} times today`;
  const have = Math.max(0, (chestOf(v, from)!.items[item] ?? 0) - (held[item] ?? 0));
  if (have < amount) return `your own chest holds ${have} ${item.replace(/_/g, ' ')} free, not ${amount}`;
  days[k] = (days[k] ?? 0) + 1;
  addTo(v, from, item, -amount);
  addTo(v, to, item, amount);
  const after = p.contracts.some((c) => c.payer === from && c.payee === to && c.state === 'paid' && now - c.t <= PAY.afterWorkMs);
  log(p, { t: now, op: item === 'emerald' ? (after ? 'gift after work' : 'gift') : 'goods', from, to, n: amount, item });
  return `paid ${to} ${amount} ${item === 'emerald' ? `emerald${amount === 1 ? '' : 's'}` : item.replace(/_/g, ' ')}`;
}

/** Contracts past their time: an untaken request's escrow back after 30 minutes. */
export function expire(v: Village, now: number): Contract[] {
  const out: Contract[] = [];
  for (const c of payOf(v).contracts) if (c.state === 'open' && now - c.made >= PAY.expireMs) {
    refund(v, c.id, 'expired untaken', now);
    out.push(c);
  }
  return out;
}

/**
 * At load: a live contract whose request and promise are both closed or gone in the acts' record is refunded, and one
 * whose payer or payee left the village too. `isOpen(requestId, commitmentId)` answers from acts.ts.
 */
export function reconcile(v: Village, isOpen: (request?: string, commitment?: string) => boolean, members: Set<string>, now: number): number {
  let n = 0;
  for (const c of payOf(v).contracts) {
    if (!live(c)) continue;
    const gone = (c.payer !== 'village' && !members.has(c.payer)) || (!!c.payee && !members.has(c.payee));
    if (gone || (c.state !== 'delivering' && !isOpen(c.request, c.commitment))) {
      refund(v, c.id, gone ? 'a party left the village' : 'reconciled: its request or promise closed', now);
      n++;
    }
  }
  return n;
}

/** Emeralds the payments system can see: members' chests, escrow, the levy owed (the conservation check's sum). */
export function emeraldsSeen(v: Village): number {
  const chests = Object.values(v.homes ?? {}).reduce((t, h) => t + (h.chest?.items.emerald ?? 0), 0);
  const p = payOf(v);
  return chests + p.contracts.filter(live).reduce((t, c) => t + c.escrow, 0) + p.levyOwed;
}

/** Minted emeralds in the ledger (the purse, minted bounties). */
export const mintedOf = (v: Village) => payOf(v).ledger.filter((r) => r.op === 'minted').reduce((t, r) => t + r.n, 0);

/**
 * The price guide: about how many emeralds a chore's goods are worth, for the prompt. `perTrip` is the member's median
 * gross put of the option's good; the merchant's buy rate where it buys the good (`sales`, own.ts OWN_SALES), else the
 * board's value over an emerald's. Whole emeralds, at least 1 ("about 1" under 1).
 */
export function guideFor(item: string, perTrip: number, sales: Counts, value: (item: string) => number): { n: number; words: string } {
  const raw = sales[item] ? perTrip / sales[item] : (perTrip * value(item)) / Math.max(1e-9, value('emerald'));
  const n = Math.max(1, Math.round(raw));
  return { n, words: raw < 1 ? 'about 1 emerald' : `about ${n} emerald${n === 1 ? '' : 's'}` };
}

// ---------------------------------------------------------------------------------------------
// The hooks acts.ts calls (setPayHooks(makePayHooks(env)), the world's env)
// ---------------------------------------------------------------------------------------------

/** What the hooks need from the world. */
export interface PayEnv {
  village(name: string): Village | undefined;
  /** Goods barter holds of the member's own chest (barter.ts held). */
  held(v: Village, agent: string): Counts;
  /** The levy's rate on contracts now (G3's voted rate, else MC_LEVY, else none). */
  rate(village: string): number | undefined;
  /** About how many emeralds a chore of the option is worth to the member (the price guide), or undefined. */
  guide(v: Village, agent: string, option: string): number | undefined;
  /** The prompt's price guide (spec 8, 12): up to 3 goods the member or the village put lately, about E emeralds a trip. */
  guideLine?(v: Village, agent: string): Array<{ words: string; n: number }>;
  /** A bounty's emerald: the world takes one from the commons when it holds one above the merchant's keep, else it is
   *  minted; either way logged through bountyFunded. */
  fundBounty(v: Village, c: Contract, now: number): void;
  /** The chore's gross put of the option's goods, earmarked in storage for the contract (at most 64); {} when none. The
   *  world queues the delivery when it returns goods. */
  earmark(v: Village, c: Contract, agent: string, e: { option: string; chore: string }): Counts;
  /** The village's day for the pay act's budget. */
  dayKey(village: string, now: number): string;
  tell(village: string, to: string, text: string, now: number): void;
  save(): void;
}

const emWord = (n: number) => `${n} emerald${n === 1 ? '' : 's'}`;
/** The guide's words in the pay paragraph: "Price guide: a trip of logs about 2 emeralds, ... " ('' with none). */
export const guideText = (g: Array<{ words: string; n: number }>) => (g.length ? `Price guide (what one chore's goods are worth): ${g.map((x) => `${x.words} about ${emWord(x.n)}`).join(', ')}. ` : '');
let draw = 0x2545f491;
const rand = () => ((draw = (draw * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** The hooks for acts.ts (a structural match of acts.ts' PayHooks: pay.ts imports nothing of acts.ts but its closers). */
export function makePayHooks(env: PayEnv, acts: { closeRequest(village: string, id: string, s: 'accepted' | 'moot', now?: number): boolean }) {
  type Req = { id: string; from: string; to: string; what: { kind: 'item' | 'project'; option: string; words: string }; price?: number; steps?: number; contract?: string; bounty?: boolean };
  return {
    request(village: string, agent: string, r: Req, f: { act_price?: string; act_steps?: string }, now: number) {
      const v = env.village(village);
      if (!v) return undefined;
      if (f.act_price === undefined) {
        // (the test's contrast: a random half of unpriced requests carry the village's bounty, choice 4)
        if (!PAY.bounty || r.what.kind !== 'item' || rand() >= PAY.bounty) {
          if (PAY.bounty && r.what.kind === 'item') log(payOf(v), { t: now, op: 'control', n: 0, why: r.id });
          return undefined;
        }
        const c = openBounty(v, r.what.option, r.id, undefined, now);
        env.fundBounty(v, c, now);
        env.save();
        return { contract: c.id, price: 1, steps: 1, bounty: true };
      }
      const kind: ContractKind = r.what.kind === 'project' ? 'wage' : 'goods';
      const c = openContract(v, { kind, payer: agent, option: r.what.option, price: Number(f.act_price), steps: Number(f.act_steps) || 1, request: r.id, held: env.held(v, agent), to: r.to }, now);
      if (typeof c === 'string') return c;
      env.save();
      return { contract: c.id, price: c.price, steps: c.steps };
    },
    pay(village: string, agent: string, f: { act_to?: string; act_item?: string; act_amount?: string }, now: number) {
      const v = env.village(village);
      if (!v) return { ok: false, text: 'no village' };
      // (an item by its name in the chest, or without a plural s: "emeralds", "oak logs")
      const raw = (f.act_item ?? 'emerald').toLowerCase().trim().replace(/\s+/g, '_');
      const items = chestOf(v, agent)?.items ?? {};
      const item = /^emeralds?$/.test(raw) ? 'emerald' : items[raw] !== undefined ? raw : raw.replace(/s$/, '');
      const to = f.act_to ?? '';
      const text = payNow(v, agent, to, item, Number(f.act_amount), env.held(v, agent), now, env.dayKey(village, now));
      const ok = text.startsWith('paid');
      if (ok) {
        env.tell(village, to, `${agent} paid you ${text.replace(/^paid \S+ /, '')}`, now);
        env.save();
      }
      return { ok, text };
    },
    taken(village: string, r: Req, c: { id: string; from: string }, now: number) {
      const v = env.village(village);
      if (!v || !r.contract) return;
      const k = contractOf(v, r.contract);
      if (k && k.kind !== 'wage') takeContract(v, k.id, c.from, c.id, now);
      env.save();
    },
    ended(village: string, r: Req, c: { id: string; from: string; to: string }, e: { option: string; chore: string }, now: number): 'kept' | 'delivering' | 'open' {
      const v = env.village(village);
      const k = v && r.contract ? contractOf(v, r.contract) : undefined;
      if (!v || !k) return 'kept';
      if (k.kind === 'wage') {
        const got = payStep(v, k.id, c.from, env.rate(village), now);
        if (got || k.state === 'paid') env.tell(village, c.from, `You were paid ${emWord(got)} by ${k.payer} for a step on ${r.what.words.replace(/^help with /, '')} (${r.id})`, now);
        if (k.state === 'paid') acts.closeRequest(village, r.id, 'accepted', now);
        env.save();
        return 'kept';
      }
      const marked = env.earmark(v, k, c.from, e);
      if (!Object.values(marked).some((q) => q > 0)) return 'open';
      if (k.kind === 'bounty') {
        const got = payBounty(v, k.id, c.from, now);
        env.tell(village, c.from, `You were paid ${emWord(got)} by the village for ${r.what.words} (${r.id})`, now);
        env.save();
        return 'kept';
      }
      startDelivery(v, k.id, marked, now);
      env.save();
      return 'delivering';
    },
    closed(village: string, r: Req, how: string, now: number) {
      const v = env.village(village);
      const k = v && r.contract ? contractOf(v, r.contract) : undefined;
      if (!v || !k) return;
      const n = refund(v, k.id, how, now);
      if (n && k.kind !== 'bounty') env.tell(village, k.payer, `Your ${emWord(n)} for ${r.id} came back: ${how}`, now);
      env.save();
    },
    help(village: string, agent: string, now: number) {
      const v = env.village(village);
      if (!v || !chestOf(v, agent)) return '';
      void now;
      const held = escrowOf(v, agent);
      return 'A request may carry act_price (whole emeralds from your own chest, 1 to ' + PAY.max + '): code holds it and pays it when the goods reach your own chest, refunded if not; '
        + 'on a project, act_price is per step and act_steps (1-4) the steps, paid to each helper. '
        + 'pay: give a member emeralds or goods from your own chest now (act_to, act_item, act_amount; say why). '
        + `${guideText(env.guideLine?.(v, agent) ?? [])}You hold ${emWord(freeEmeralds(v, agent, env.held(v, agent)))}${held ? ` (${held} held for your requests)` : ''}.`;
    },
    acceptable(village: string, agent: string, r: Req, now: number) {
      void now;
      const v = env.village(village);
      if (!v || !r.price) return false;
      const g = env.guide(v, agent, r.what.option);
      return g !== undefined && r.price >= g;
    },
  };
}

/**
 * The world's delivery reached the buyer's chest (`arrived`, by server count), or could not (`{}`): the contract settled
 * and its promise closed through acts.ts (kept, or moot when nothing arrived: the deliverer did its part).
 */
export function finishDelivery(env: PayEnv, acts: { closeCommitment(village: string, id: string, s: 'kept' | 'moot' | 'broken', evidence: string, now?: number): boolean }, v: Village, id: string, arrived: Counts, now: number) {
  const c = contractOf(v, id);
  if (!c || c.state !== 'delivering') return null;
  const s = settleDelivery(v, id, arrived, env.rate(v.name), now);
  if (!s) return null;
  if (c.commitment) acts.closeCommitment(v.name, c.commitment, s.paid + s.levy > 0 ? 'kept' : 'moot', s.paid + s.levy > 0 ? `delivered to ${c.payer}'s chest` : 'the delivery fell short', now);
  if (c.payee) env.tell(v.name, c.payee, s.paid + s.levy > 0 ? `You were paid ${emWord(s.paid)} by ${c.payer} for ${c.option}${s.levy ? ` (${s.levy} to the levy)` : ''}` : `Your delivery to ${c.payer} fell short; nothing was paid`, now);
  if (s.refunded) env.tell(v.name, c.payer, `${emWord(s.refunded)} of your price came back (${c.id}): ${c.why ?? ''}`, now);
  env.save();
  return s;
}

/** The world's env and acts' closers, set once by the world with MC_PAY on (the skills settle deliveries through them). */
let world: { env: PayEnv; acts: Parameters<typeof finishDelivery>[1] } | null = null;
export function setPayWorld(env: PayEnv, acts: Parameters<typeof finishDelivery>[1]): void {
  world = { env, acts };
}
/** A delivery's end, from the deliver_own skill: settled, its promise closed, both sides told. */
export function deliveryDone(v: Village, id: string, arrived: Counts, now = Date.now()) {
  return world ? finishDelivery(world.env, world.acts, v, id, arrived, now) : null;
}
