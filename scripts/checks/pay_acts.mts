/**
 * #108's acts (acts.ts with pay.ts' hooks; spec runs/2026-10-23/payments/spec.md 13.3), offline: a priced request held in
 * escrow, refused over the free emeralds, out of range, or with no chest; its tag and inbox line; taken by choosing; its
 * chore ending into a delivery (the promise open, not kept) and the delivery settling it kept and paid; a chore that put
 * none of the goods leaves it open; expiry refunds; a wage taken by two helpers, a step paid each; the pay act and the give
 * alias; impliedAccept only at or above the guide; and with no hooks set the acts behave as before.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/pay_acts.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-acts-'));
Object.assign(process.env, { MC_MEMORY: 'on', MC_MEMORY_QUALITY: 'on', MC_CLOCK: 'off', MCAI_SOCIAL: 'on', MC_ACTS: 'on', MC_OWN: 'on', MC_PAY: 'on', MC_PURSE: '4', MCAI_ACTS_LOG: path.join(dir, 'acts.jsonl') });

const mem = await import('../../server/src/memory');
const acts = await import('../../server/src/acts');
const P = await import('../../server/src/pay');
type Village = import('../../server/src/village').Village;

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};
const quiet = console.log;
console.log = () => {};

mem.initMemory(dir);
// (an act every decision: the cadence is acts_unit's to check)
acts.setActsSettings({ every: 1 });
const V = 'Testvale';
const MIN = 60000;
let T = 2_000_000_000;
const names = ['Ada', 'Ben', 'Clara', 'Dev'];
for (const n of names) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T);
const v = { name: V, homes: Object.fromEntries(names.filter((n) => n !== 'Dev').map((n, i) => [n, { owed: {}, got: {}, used: {}, chest: { x: i, y: 64, z: 0, items: {} } }])) } as unknown as Village;
for (const n of names) P.givePurse(v, n, T);
const em = (n: string) => v.homes![n]?.chest?.items.emerald ?? 0;
const told: string[] = [];
let earmarks: Record<string, number> = { oak_log: 12 };
const env: import('../../server/src/pay').PayEnv = {
  village: (n) => (n === V ? v : undefined),
  held: () => ({}),
  rate: () => undefined,
  guide: (_v, _a, option) => (option === 'gather:logs' ? 2 : 1),
  takeCommonsEmerald: () => false,
  earmark: () => ({ ...earmarks }),
  dayKey: () => 'd1',
  tell: (_v, to, text) => { told.push(`${to}: ${text}`); },
  save: () => {},
};
const world = (): import('../../server/src/acts').ActsWorld => ({
  items: new Map([['gather:logs', 'logs'], ['make:torch', 'torch']]),
  projects: new Map([['help:i1', { words: 'gazebo', owner: 'Ada' }]]),
  at: new Map([['Ada', { x: 0, z: 0 }], ['Ben', { x: 5, z: 0 }], ['Clara', { x: 10, z: 0 }], ['Dev', { x: 100, z: 0 }]]),
  verify: () => true,
});
const chosen = (option: string, chore: string, name = option) => ({ option, kind: option.split(':')[0], name, decisionId: `d-${chore}`, chore });
const st = () => acts.actsState(V);
const end = (agent: string, option: string, chore: string, started: number, at: number) => acts.noteEnd(V, agent, { option, chore, started, ok: true, productive: true, cut: false }, at);

// with no hooks set: the price is not read, the pay act is not an act
let d = acts.handle(V, 'Ada', { act: 'pay', act_to: 'Ben', act_amount: '1' } as never, chosen('make:torch', 'x0'), world(), T);
ok(d.some((x) => x.includes('"pay" is not an act')), `no hooks: pay is not an act (${d})`);
ok(acts.actFields({ act: 'request', act_price: 3 }).act_price === undefined, 'no hooks: act_price not parsed');

acts.setPayHooks(P.makePayHooks(env, acts));
ok(acts.actFields({ act: { type: 'request', price: 3, steps: 2 } }).act_price === '3' && acts.actFields({ act: 'pay', amount: 2 }).act_amount === '2', 'hooks set: price, steps, amount parsed, nested or flat');

// refusals: over the max, over the free emeralds, the payer with no chest, an addressee with no chest
T += 60 * MIN;
d = acts.handle(V, 'Ada', { act: 'request', act_to: 'Ben', act_item: 'logs', act_price: '9' }, chosen('make:torch', 'a0'), world(), T);
ok(d.some((x) => x.startsWith('refused request: a price is 1 to 8')) && em('Ada') === 4, `over the max refused (${d})`);
T += 61 * MIN;
d = acts.handle(V, 'Ada', { act: 'request', act_to: 'Ben', act_item: 'logs', act_price: '5' }, chosen('make:torch', 'a0b'), world(), T);
ok(d.some((x) => x.includes('4 emeralds free')) && em('Ada') === 4, `over the free emeralds refused (${d})`);
T += 61 * MIN;
d = acts.handle(V, 'Dev', { act: 'request', act_to: 'anyone', act_item: 'logs', act_price: '1' }, chosen('make:torch', 'd0'), world(), T);
ok(d.some((x) => x.includes('no chest of your own')), `the payer with no chest refused (${d})`);
T += 61 * MIN;
d = acts.handle(V, 'Ada', { act: 'request', act_to: 'Dev', act_item: 'torch', act_price: '1' }, chosen('make:torch', 'a0c'), world(), T);
ok(d.some((x) => x.includes('Dev has no chest')), `an addressee with no chest refused (${d})`);

// a priced request to anyone for logs: escrow, the tag, the inbox line at priority 2
T += 61 * MIN;
d = acts.handle(V, 'Ada', { act: 'request', act_to: 'anyone', act_item: 'logs', act_price: '3' }, chosen('make:torch', 'a1'), world(), T);
const r1 = st().requests.find((r) => r.price === 3)!;
ok(d.includes('request') && r1?.contract && em('Ada') === 1 && P.escrowOf(v, 'Ada') === 3, `a priced request held 3 (${d})`);
ok(acts.tags(V, 'Ben', T + MIN).get('gather:logs') === '[Ada pays 3 emeralds]', `the price tag (${acts.tags(V, 'Ben', T + MIN).get('gather:logs')})`);
ok(acts.inbox(V, 'Ben', T + MIN)[0]?.startsWith("Ada pays 3 emeralds anyone to gather logs, into Ada's own chest"), `the inbox line first (${acts.inbox(V, 'Ben', T + MIN)[0]})`);
// Ben takes it by choosing; its chore ends: delivering, not kept
d = acts.handle(V, 'Ben', {}, chosen('gather:logs', 'b1', 'Gather logs'), world(), T + 2 * MIN);
const c1 = st().commitments.find((c) => c.from === 'Ben' && c.request === r1.id)!;
const k1 = P.contractOf(v, r1.contract)!;
ok(c1 && k1.state === 'taken' && k1.payee === 'Ben', `taken by choosing (${d}, ${k1.state})`);
end('Ben', 'gather:logs', 'b1', T + 2 * MIN, T + 6 * MIN);
ok(c1.state === 'open' && c1.delivering && k1.state === 'delivering' && k1.earmark?.oak_log === 12, `the chore's end: delivering (${c1.state}, ${k1.state})`);
ok(acts.inbox(V, 'Ada', T + 7 * MIN).some((l) => l.startsWith('Ben is bringing your logs')), 'Ada told the logs are coming');
acts.sweep(V, world(), T + 20 * MIN);
ok(c1.state === 'open', 'a delivering promise is not broken past due');
// the delivery arrives: paid, kept
P.finishDelivery(env, acts, v, k1.id, { oak_log: 12 }, T + 21 * MIN);
ok(c1.state === 'kept' && k1.state === 'paid' && em('Ben') === 7 && em('Ada') === 1, `delivered: kept and paid (${c1.state}, Ben ${em('Ben')})`);

// a chore that put none of the goods leaves the promise open
T += 61 * MIN;
acts.handle(V, 'Clara', { act: 'request', act_to: 'Ben', act_item: 'torch', act_price: '2' }, chosen('gather:logs', 'cl1'), world(), T);
const r2 = st().requests.find((r) => r.from === 'Clara' && r.price === 2)!;
acts.handle(V, 'Ben', {}, chosen('make:torch', 'b2', 'Make torch'), world(), T + MIN);
const c2 = st().commitments.find((c) => c.request === r2.id)!;
earmarks = {};
end('Ben', 'make:torch', 'b2', T + MIN, T + 3 * MIN);
ok(c2.state === 'open' && !c2.delivering, 'no goods put: the promise stays open');
// it breaks past due: refunded
acts.sweep(V, world(), T + 40 * MIN);
ok(c2.state === 'broken' && P.contractOf(v, r2.contract)!.state === 'refunded' && em('Clara') === 4, `broken past due: refunded (${c2.state}, Clara ${em('Clara')})`);
earmarks = { oak_log: 12 };

// expiry refunds an untaken priced request
T += 61 * MIN;
acts.handle(V, 'Clara', { act: 'request', act_to: 'anyone', act_item: 'torch', act_price: '1' }, chosen('gather:logs', 'cl2'), world(), T);
const r3 = st().requests.find((r) => r.from === 'Clara' && r.state === 'open')!;
acts.sweep(V, world(), T + 31 * MIN);
ok(r3.state === 'expired' && P.contractOf(v, r3.contract)!.state === 'refunded' && em('Clara') === 4, 'expired: refunded');

// a wage: Ada pays 1 a step, 2 steps, on her gazebo; Ben and Clara take it; each step paid
T += 61 * MIN;
const ada0 = em('Ada');
v.homes!.Ada.chest!.items.emerald = 3;
d = acts.handle(V, 'Ada', { act: 'request', act_to: 'anyone', act_project: 'gazebo', act_price: '1', act_steps: '2' }, chosen('make:torch', 'a2'), world(), T);
const w = st().requests.find((r) => r.what.option === 'help:i1' && r.state === 'open')!;
ok(w?.steps === 2 && em('Ada') === 1 && P.escrowOf(v, 'Ada') === 2, `a wage of 2 steps held (${d})`);
acts.handle(V, 'Ben', {}, chosen('help:i1', 'b3', 'Help with the gazebo'), world(), T + MIN);
acts.handle(V, 'Clara', {}, chosen('help:i1', 'cl3', 'Help with the gazebo'), world(), T + MIN);
ok(w.state === 'open' && st().commitments.filter((c) => c.request === w.id).length === 2, 'two helpers took the wage, still open');
const b0 = em('Ben'), cl0 = em('Clara');
end('Ben', 'help:i1', 'b3', T + MIN, T + 4 * MIN);
end('Clara', 'help:i1', 'cl3', T + MIN, T + 5 * MIN);
ok(em('Ben') === b0 + 1 && em('Clara') === cl0 + 1 && w.state === 'accepted' && P.contractOf(v, w.contract)!.state === 'paid', `a step paid each, the wage closed (${w.state})`);
void ada0;

// the pay act and the give alias
T += 61 * MIN;
const before = [em('Ben'), em('Clara')];
d = acts.handle(V, 'Ben', { act: 'give', act_to: 'Clara', act_amount: '2' }, chosen('make:torch', 'b4'), world(), T);
ok(d.includes('pay') && em('Ben') === before[0] - 2 && em('Clara') === before[1] + 2, `give with an amount is pay (${d})`);
ok(told.some((x) => x.startsWith('Clara: Ben paid you 2 emeralds')), 'Clara told');
T += 61 * MIN;
d = acts.handle(V, 'Ben', { act: 'pay', act_to: 'Ben', act_amount: '1' }, chosen('make:torch', 'b5'), world(), T);
ok(d.some((x) => x.includes('cannot pay yourself')), `pay to itself refused (${d})`);

// impliedAccept: a fixed pick accepts only at or above the guide (logs: 2)
T += 61 * MIN;
acts.handle(V, 'Clara', { act: 'request', act_to: 'anyone', act_item: 'logs', act_price: '1' }, chosen('make:torch', 'cl4'), world(), T);
ok(acts.impliedAccept(V, 'Ben', chosen('gather:logs', 'b6'), world(), T + MIN) === undefined, 'below the guide: a fixed pick does not accept');
T += 61 * MIN;
acts.handle(V, 'Clara', { act: 'request', act_to: 'Ben', act_item: 'torch', act_price: '1' }, chosen('gather:logs', 'cl5'), world(), T);
const id = acts.impliedAccept(V, 'Ben', chosen('make:torch', 'b7'), world(), T + MIN);
ok(!!id && st().commitments.find((c) => c.id === id)?.request, `at the guide: a fixed pick accepts (${id})`);

// conservation: every emerald seen is minted (the purses)
ok(P.emeraldsSeen(v) === P.mintedOf(v) + (3 - ada0), `conservation (${P.emeraldsSeen(v)} seen, ${P.mintedOf(v)} minted, Ada's top-up ${3 - ada0})`);
acts.setPayHooks(null);
console.log = quiet;
console.log(`pay_acts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
