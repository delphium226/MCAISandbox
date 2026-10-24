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
import { PAY, bountyFunded, contractOf, givePurse, guideFor, levyDeposited, makePayHooks, payOf, reconcile, setPayWorld, type Contract, type PayEnv } from '../pay';
import { RULES, levyRate } from '../rules';
import type { Village } from '../village';
import { takeRefused } from './mcStorage';

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
  /** A server command (RCON). */
  rcon(cmd: string): Promise<string>;
  /** Emeralds the commons holds above the merchant's keep (a bounty may take one). */
  commonsSpare(v: Village): number;
}

/** The env for pay.ts, and the hooks set into acts.ts (once, at the world's start). */
export function startPay(w: PayWorld): void {
  if (!PAY.on) return;
  const env: PayEnv = {
    village: (n) => w.village(n),
    held: (v, agent) => held(boardOf(v), agent),
    rate: (village) => (RULES.on ? levyRate(village) : Number(process.env.MC_LEVY) || undefined),
    guide: (v, agent, option) => guideOf(v.name, agent, option),
    guideLine: (v, agent) => guideLines(v.name, agent),
    // (spec 9: from the commons' emeralds above the merchant's keep, taken by command and counted; else minted)
    fundBounty: (v, c, now) => {
      if (w.commonsSpare(v) - (bountyTaking.get(v.name) ?? 0) < 1) {
        bountyFunded(v, c.id, false, now);
        return;
      }
      bountyTaking.set(v.name, (bountyTaking.get(v.name) ?? 0) + 1);
      void storeByCommand(w.rcon, v, 'emerald', -1).then((n) => {
        bountyFunded(v, c.id, n === -1, Date.now());
        if (n !== -1) console.log(`[pay] ${v.name}: the bounty ${c.id}'s emerald could not be taken from storage: minted instead`);
        w.save();
      }, () => bountyFunded(v, c.id, false, Date.now())).finally(() => bountyTaking.set(v.name, Math.max(0, (bountyTaking.get(v.name) ?? 1) - 1)));
    },
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

/** The prompt's guide: the member's options with puts on record (else the village's), the most recorded first, 3 at most. */
function guideLines(village: string, agent: string): Array<{ words: string; n: number }> {
  const opts = (who: string | null) => [...puts.entries()].filter(([k]) => k.startsWith(`${village}|`) && (!who || k.split('|')[1] === who)).map(([k, q]) => ({ option: k.split('|')[2], n: q.length }));
  const mine = opts(agent);
  const counts = new Map<string, number>();
  for (const o of mine.length ? mine : opts(null)) counts.set(o.option, (counts.get(o.option) ?? 0) + o.n);
  return [...counts.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3).flatMap(([option]) => {
    const n = guideOf(village, agent, option);
    const [kind, item = ''] = option.split(':');
    return n === undefined ? [] : [{ words: `${kind === 'make' ? 'a batch of' : 'a trip of'} ${item.replace(/_/g, ' ')}`, n }];
  });
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
  // (goods a full storage refused are still in hand: put, for the guide and a buyer, not in storage)
  const hand: Counts = {};
  for (const [n, q] of Object.entries(takeRefused(agent))) if (q > 0 && answers(option, n)) {
    hand[n] = q;
    put[n] = (put[n] ?? 0) + q;
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
  const out: Counts = {}, inHand: Counts = {};
  let left = 64;
  for (const [n, q] of Object.entries(put)) {
    const t = Math.min(q, left);
    if (t > 0) out[n] = t;
    const h = Math.min(t, hand[n] ?? 0);
    if (h > 0) inHand[n] = h;
    left -= t;
  }
  c.inHand = Object.keys(inHand).length ? inHand : undefined;
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
  for (const c of payOf(v).contracts) if (c.state === 'delivering') for (const [n, q] of Object.entries(c.earmark ?? {})) {
    const s = q - (c.inHand?.[n] ?? 0);
    if (s > 0) out[n] = (out[n] ?? 0) + s;
  }
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

/** Bounties' emeralds being taken from storage now, by village (so two draws do not count one spare emerald). */
const bountyTaking = new Map<string, number>();

/** The levy owed the commons (payments' and merchant_own's sales levy), whether or not payments are on. */
export function levyOwed(v: Village): number {
  return (v as Village & { pay?: { levyOwed?: number } }).pay?.levyOwed ?? 0;
}

type Slot = { slot: number; id: string; count: number };
/** A container's slots by command, one list element a call (`data get block ... Items[i]`: the whole list's reply is cut
 *  short past a few stacks), or null when it cannot be read (unloaded, not a container). */
export async function slotsOf(rcon: PayWorld['rcon'], c: { x: number; y: number; z: number }): Promise<Slot[] | null> {
  const out: Slot[] = [];
  for (let i = 0; i < 54; i++) {
    const r = await rcon(`data get block ${c.x} ${c.y} ${c.z} Items[${i}]`).catch(() => '');
    if (/found no elements/i.test(r)) return out;
    const at = r.indexOf('{');
    if (!/block data/i.test(r) || at < 0) return null;
    // (the compound's own keys only: an item's components, nested compounds, cut out)
    let top = r.slice(at + 1, r.lastIndexOf('}'));
    while (/\{[^{}]*\}/.test(top)) top = top.replace(/\{[^{}]*\}/g, '');
    const slot = /Slot:\s*(\d+)b/.exec(top), id = /id:\s*"minecraft:([a-z0-9_]+)"/.exec(top), count = /count:\s*(\d+)/.exec(top);
    if (slot && id) out.push({ slot: Number(slot[1]), id: id[1], count: count ? Number(count[1]) : 1 });
  }
  return out;
}

/**
 * Items into (delta > 0) or out of (delta < 0) the village's storage by command, no walk (#111: the levy's deposit, a
 * bounty's emerald): a chest's slots written with `item replace`, the result counted on the server, and the chest's record
 * changed by what the count shows moved. Returns the signed number moved (0 when nothing could be).
 */
export async function storeByCommand(rcon: PayWorld['rcon'], v: Village, item: string, delta: number): Promise<number> {
  const chests = [...(v.storage?.chests ?? [])];
  // (adding: a chest that holds the item first, then the misc group's, then any; taking: those that hold it, most first)
  const order = delta > 0
    ? chests.sort((p, q) => Number((q.items[item] ?? 0) > 0) - Number((p.items[item] ?? 0) > 0) || Number(q.group === 'misc') - Number(p.group === 'misc'))
    : chests.filter((c) => (c.items[item] ?? 0) > 0).sort((p, q) => (q.items[item] ?? 0) - (p.items[item] ?? 0));
  const has = (s: Slot[]) => s.filter((x) => x.id === item).reduce((t, x) => t + x.count, 0);
  let left = Math.abs(delta), moved = 0;
  for (const c of order) {
    if (!left) break;
    const before = await slotsOf(rcon, c);
    if (!before) continue;
    let k = left;
    if (delta > 0) {
      for (const sl of before.filter((x) => x.id === item && x.count < 64)) {
        if (!k) break;
        const n = Math.min(k, 64 - sl.count);
        await rcon(`item replace block ${c.x} ${c.y} ${c.z} container.${sl.slot} with minecraft:${item} ${sl.count + n}`).catch(() => '');
        k -= n;
      }
      const used = new Set(before.map((x) => x.slot));
      for (let i = 0; i < 27 && k > 0; i++) if (!used.has(i)) {
        const n = Math.min(k, 64);
        await rcon(`item replace block ${c.x} ${c.y} ${c.z} container.${i} with minecraft:${item} ${n}`).catch(() => '');
        k -= n;
      }
    } else {
      for (const sl of before.filter((x) => x.id === item).sort((p, q) => p.count - q.count)) {
        if (!k) break;
        const n = Math.min(k, sl.count);
        await rcon(`item replace block ${c.x} ${c.y} ${c.z} container.${sl.slot} with ${sl.count - n > 0 ? `minecraft:${item} ${sl.count - n}` : 'minecraft:air'}`).catch(() => '');
        k -= n;
      }
    }
    // (the server's count decides what moved, whatever the replies said)
    const after = await slotsOf(rcon, c);
    if (!after) continue;
    const got = Math.max(0, delta > 0 ? has(after) - has(before) : has(before) - has(after));
    c.items[item] = Math.max(0, (c.items[item] ?? 0) + (delta > 0 ? got : -got));
    if (!c.items[item]) delete c.items[item];
    moved += got;
    left -= Math.min(left, got);
  }
  return delta > 0 ? moved : -moved;
}

/** Levy deposits under way, by village, and the count last said could not be written. */
const depositing = new Set<string>();
const depositWarned = new Map<string, number>();

/**
 * The levy owed deposited into a storage chest by command and counted (#111, spec 7): from the sweep, at most one deposit
 * a village at once; what could not be written stays owed and is tried again the next sweep.
 */
export function levySweep(w: PayWorld, v: Village): void {
  const n = levyOwed(v);
  if (n <= 0 || depositing.has(v.name)) return;
  depositing.add(v.name);
  void storeByCommand(w.rcon, v, 'emerald', n).then((got) => {
    if (got > 0) {
      levyDeposited(v, got, Date.now(), 'by command, counted');
      w.save();
    }
    // (said once a count: a full storage refuses it every sweep until a slot frees)
    if (got < n && depositWarned.get(v.name) !== n - got) console.log(`[pay] ${v.name}: ${n - got} levy emerald${n - got === 1 ? '' : 's'} could not be written into storage (no room); tried again each sweep`);
    depositWarned.set(v.name, got < n ? n - got : 0);
  }, (e: Error) => console.log(`[pay] ${v.name}: the levy deposit failed: ${e.message.slice(0, 120)}`)).finally(() => depositing.delete(v.name));
}
export { contractOf };
