/**
 * #250 (MC_RUNG_WAGE with MC_PAY), offline against a fake server: the village's wage for a chore that fed the ladder's
 * current stage when picked and ended well (none for a failed, cut or unfed chore), paid into the member's own chest
 * record from storage's emeralds above the merchant's keep (the trade rung's 40 held), else minted; the cap (5 emeralds
 * a member a village day, one wage when a wage is more); the ledger's conservation; the ladder tag and the progress line
 * saying the wage; and nothing with MC_PAY off or MC_RUNG_WAGE=0 (two more runs of this file).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/rung_wage_unit.mts
 */
import { spawnSync } from 'node:child_process';

const MODE = process.argv[2] ?? '';
Object.assign(process.env, { MCAI_SOCIAL: 'on', MC_ACTS: 'on', MC_OWN: 'on', MC_PAY: MODE === 'payoff' ? 'off' : 'on', MC_LADDER: 'on', MC_IRON_AGE: 'on' });
if (MODE === 'zero') process.env.MC_RUNG_WAGE = '0';
const M = await import('../../server/src/mineflayer/mcPay');
const P = await import('../../server/src/pay');
const L = await import('../../server/src/ladder');
type Village = import('../../server/src/village').Village;

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const quiet = console.log;

// A fake server: one storage chest at 1,64,0 (Paper's replies to `data get block ... Items[i]` and `item replace`)
type Slot = { id: string; count: number };
const chest = new Map<number, Slot>();
const rcon = async (cmd: string): Promise<string> => {
  let m = /^data get block (-?\d+) (-?\d+) (-?\d+) Items\[(\d+)\]$/.exec(cmd);
  if (m) {
    const e = [...chest.entries()].sort((p, q) => p[0] - q[0])[Number(m[4])];
    if (!e) return `Found no elements matching Items[${m[4]}]`;
    return `${m[1]}, ${m[2]}, ${m[3]} has the following block data: {Slot: ${e[0]}b, id: "minecraft:${e[1].id}", count: ${e[1].count}}`;
  }
  m = /^item replace block (-?\d+) (-?\d+) (-?\d+) container\.(\d+) with minecraft:([a-z_]+)(?: (\d+))?$/.exec(cmd);
  if (m) {
    if (m[5] === 'air') chest.delete(Number(m[4]));
    else chest.set(Number(m[4]), { id: m[5], count: Number(m[6] ?? 1) });
    return 'Replaced a slot';
  }
  return 'Unknown command';
};
const real = () => [...chest.values()].filter((s) => s.id === 'emerald').reduce((t, s) => t + s.count, 0);
const setStore = (n: number) => {
  chest.clear();
  if (n) chest.set(0, { id: 'emerald', count: n });
  (v.storage!.chests[0].items as Record<string, number>).emerald = n;
  if (!n) delete (v.storage!.chests[0].items as Record<string, number>).emerald;
};

const home = () => ({ chest: { x: 0, y: 0, z: 0, items: {} as Record<string, number> } });
const v = {
  name: 'W', complete: true, initiatives: [],
  storage: { chests: [{ x: 1, y: 64, z: 0, items: {} as Record<string, number> }] },
  homes: { Ada: home(), Ben: home() },
} as unknown as Village;
const st = L.ladderOf(v, 1)!;
const em = (name: string) => (v.homes as Record<string, { chest: { items: Record<string, number> } }>)[name]?.chest.items.emerald ?? 0;
// (the keep: the trade rung's 40 while trade is current, as the world's emeraldKeep)
const keep = () => (L.tradeCurrent(v) ? L.TRADE_EMERALDS : 4);
let saves = 0;
console.log = () => {};
M.startPay({ village: () => v, save: () => void saves++, rcon, commonsSpare: (x) => ((x.storage!.chests[0].items as Record<string, number>).emerald ?? 0) - keep() });
console.log = quiet;
const settle = () => new Promise((r) => setTimeout(r, 20));
const fed = L.stageTag(v, 1);
const end = (over: Partial<{ ok: boolean; cut: boolean; fed: string }> = {}) => ({ ok: true, cut: false, fed, option: 'iron:dig', ...over });

if (MODE === 'payoff' || MODE === 'zero') {
  ok(P.rungWageDue(v, 'Ada', '1') === 0 && M.rungWageNow(v, 'Ada') === 0, `${MODE}: no wage due`);
  setStore(50);
  ok(M.payWageFor(v, 'Ada', end()) === 0 && em('Ada') === 0 && real() === 50, `${MODE}: a feeding chore pays nothing`);
  ok(L.stageTag(v, M.rungWageNow(v, 'Ada')) === '[for the iron age]' && !/pays/.test(L.progressLine(v, 2, 1, P.PAY.on ? P.PAY.rungWage : 0)), `${MODE}: the tag and the line say no wage (${L.stageTag(v, 0)})`);
  process.exit(fail ? 1 : 0);
}

// 1. The tag and the progress line
ok(P.PAY.rungWage === 1, 'MC_RUNG_WAGE defaults to 1');
ok(fed === '[for the iron age, pays 1 emerald]' && L.stageTag(v, 3) === '[for the iron age, pays 3 emeralds]' && L.stageTag(v) === '[for the iron age]', `the tag: ${fed}`);
const line = L.progressLine(v, 2, 1, 1);
ok(/stage 1 of 4: .*The village pays 1 emerald into your chest for each chore that feeds its ambition \(up to 5 a day\)\./.test(line), `the progress line: ${line}`);
ok(!/pays/.test(L.progressLine(v, 2, 1, 0)), 'no wage, no sentence');

// 2. Only a chore that fed the stage and ended well
setStore(50);
console.log = () => {};
const none = [M.payWageFor(v, 'Ada', end({ ok: false })), M.payWageFor(v, 'Ada', end({ cut: true })), M.payWageFor(v, 'Ada', end({ fed: undefined }))];
console.log = quiet;
ok(none.every((n) => n === 0) && em('Ada') === 0 && real() === 50, 'a failed, a cut and an unfed chore earn nothing');
ok(M.rungWageNow(v, 'Cara') === 0, 'no chest of its own: no wage');

// 3. From the commons above the keep (4 here; the merchant's), counted from the server
console.log = () => {};
ok(M.payWageFor(v, 'Ada', end()) === 1, 'a fed chore that ended well: the wage');
await settle();
console.log = quiet;
ok(em('Ada') === 1 && real() === 49 && (v.storage!.chests[0].items as Record<string, number>).emerald === 49, `paid from storage: Ada ${em('Ada')}, storage ${real()}`);
const rows = P.payOf(v).ledger;
ok(rows.at(-1)?.op === 'escrow' && rows.at(-1)?.from === 'the village' && rows.at(-1)?.to === 'Ada' && /rung wage/.test(rows.at(-1)?.why ?? ''), `the ledger: ${JSON.stringify(rows.at(-1))}`);
ok(saves > 0, 'the village saved');

// 4. The trade rung's 40 held: minted instead
st.current = undefined;
st.reached = [{ rung: 'iron', t: 1, workers: [] }];
L.chooseRung(v, 'trade', ['trade'], 3);
setStore(L.TRADE_EMERALDS);
console.log = () => {};
ok(M.payWageFor(v, 'Ben', end({ fed: L.stageTag(v, 1) })) === 1, 'a wage while trade is current');
await settle();
console.log = quiet;
ok(em('Ben') === 1 && real() === L.TRADE_EMERALDS && P.payOf(v).ledger.at(-1)?.op === 'minted', `storage kept at ${real()} (the trade rung's keep): minted`);

// 5. The cap: 5 a member a village day
setStore(100);
console.log = () => {};
const got: number[] = [];
for (let i = 0; i < 7; i++) got.push(M.payWageFor(v, 'Ada', end()));
await settle();
console.log = quiet;
ok(got.join() === '1,1,1,1,0,0,0' && em('Ada') === 5, `5 a day: ${got.join(', ')}; Ada holds ${em('Ada')}`);
ok(M.rungWageNow(v, 'Ada') === 0 && L.stageTag(v, M.rungWageNow(v, 'Ada')) === '[for the age of trade]', 'capped: the tag says no wage');
ok(P.rungWageDue(v, 'Ada', 'another day') === 1, 'a new village day pays again');
ok(P.rungWageDue(v, 'Ada', 'd', 3) === 3, 'a wage of 3: the first fits');
P.reserveRungWage(v, 'Ada', 'd', 3);
ok(P.rungWageDue(v, 'Ada', 'd', 3) === 0, 'a wage of 3: a second would pass 5');
ok(P.rungWageDue(v, 'Ben', 'e', 7) === 7 && P.reserveRungWage(v, 'Ben', 'e', 7) === 7 && P.rungWageDue(v, 'Ben', 'e', 7) === 0, 'a wage of 7: one a day');

// 6. Conservation: members' chests + escrow + owed = minted + taken from the commons
const fromCommons = P.payOf(v).ledger.filter((x) => x.op === 'escrow' && x.from === 'the village').reduce((t, x) => t + x.n, 0);
ok(P.emeraldsSeen(v) === P.mintedOf(v) + fromCommons, `conservation: seen ${P.emeraldsSeen(v)} = minted ${P.mintedOf(v)} + commons ${fromCommons}`);

// 7. The off modes, each in a process of its own
for (const mode of ['payoff', 'zero']) {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], mode], { encoding: 'utf-8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  ok(r.status === 0, `the ${mode} run`);
}

console.log(fail ? `rung_wage_unit: ${fail} failed` : `rung_wage_unit: all ${pass} passed`);
process.exit(fail ? 1 : 0);
