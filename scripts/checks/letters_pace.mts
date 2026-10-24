/**
 * #134 (MC_LETTERS_PACE) offline on a checkpoint's villages.json (default mc/testcheckpoints/im2_mine: letters current,
 * 5 emeralds, no cane slot): the cane the merchant sells and storage keeps until the cane slots hold a slot's 14 stalks
 * (a start's 14 before any slot; cane bought before leather while short), the top-up a slot visit plants from storage,
 * none of it with letters not current; and the first market stall posted as a village work at completion (once, its help
 * ranked high), none once a stall stands or a merchant is there. letters_make.mts covers the flag off.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/letters_pace.mts [villages.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const villagesFile = process.argv[2] ?? 'mc/testcheckpoints/im2_mine/villages.json';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-pace-'));
process.env.MC_LADDER = 'on';
process.env.MC_LETTERS = 'on';
process.env.MC_LETTERS_PACE = 'on';
process.env.MC_CHOOSE = 'fixed';
process.env.MC_TIME_SCALE = '1';
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const lines: string[] = [];
const mute = () => { console.log = (...a: unknown[]) => void lines.push(a.join(' ')); console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  say(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { storageContents } = await import('../../server/src/mineflayer/mcStorage');
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.ladder?.current === 'letters') ?? data.villages.find((x) => x.complete);
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
w.villages.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = w.villages.get(base.name);
unmute();
say(`letters_pace: ${villagesFile}; village ${v.name}`);
v.ladder.current = 'letters';
v.ladder.stage = 0;
v.ladder.totals = {};
const chest = v.storage.chests[0];
const setStore = (c: Record<string, number>) => {
  for (const ch of v.storage.chests) for (const n of Object.keys(c)) delete ch.items[n];
  for (const [n, q] of Object.entries(c)) if (q) chest.items[n] = q;
};
const store = () => storageContents(v);
const keepOf = (item: string) => w.tradeKeep(v, item) ?? 8;
const pickText = (p: Any) => ('why' in p ? p.why : `${p.times} x ${p.offer.n} ${p.offer.item}`);

// No cane slot: a start's 14 kept and bought (4 emeralds of the 5), before leather
setStore({ sugar_cane: 0, leather: 3, emerald: 5 });
for (const l of v.layouts ?? []) for (const q of l.slots ?? []) if (q.kind === 'sugar_cane') delete q.kind;
ok(w.tradeKeep(v, 'sugar_cane') === 14 && w.merchantUses(v).has('sugar_cane'), `no slot: cane keep ${w.tradeKeep(v, 'sugar_cane')}, the merchant used for cane`);
let pick = w.merchantPick(v, 'sells', store(), keepOf);
ok(!('why' in pick) && pick.offer.item === 'sugar_cane' && pick.times === 4, `no slot: the buy ${pickText(pick)}`);
ok(w.tradeKeep(v, 'leather') === 3, `no slot: leather waits (keep ${w.tradeKeep(v, 'leather')})`);

// A slot from 2 wild stalks (W4's 1.1): 12 more kept and bought, leather after them
const slot = v.layouts[0].slots[0];
Object.assign(slot, { kind: 'sugar_cane', planted: 2, cells: [[slot.x1 + 1, slot.z1], [slot.x1 + 1, slot.z1 + 1]] });
ok(w.caneStalks(v) === 2 && w.tradeKeep(v, 'sugar_cane') === 12, `2 stalks: keep ${w.tradeKeep(v, 'sugar_cane')}`);
pick = w.merchantPick(v, 'sells', store(), keepOf);
ok(!('why' in pick) && pick.offer.item === 'sugar_cane' && pick.times === 3, `2 stalks: the buy ${pickText(pick)}`);
ok(w.tradeKeep(v, 'leather') === 3, `2 stalks, no cane stored: leather waits (keep ${w.tradeKeep(v, 'leather')})`);
ok(w.caneTopUp(v, slot) === 0, 'nothing stored: no top-up');
setStore({ sugar_cane: 8, leather: 3, emerald: 3 });
ok(w.caneTopUp(v, slot) === 8, `8 stored: the visit plants ${w.caneTopUp(v, slot)}`);
ok(w.tradeKeep(v, 'leather') === 3, `8 of 12 stored: leather still waits (keep ${w.tradeKeep(v, 'leather')})`);
// (the book's make leaves the stalks' cane)
ok((w.makeSpare(v, '', 'book', store(), ['sugar_cane']).sugar_cane ?? 0) === 0, `a book leaves the 12 for the slot (${w.makeSpare(v, '', 'book', store(), ['sugar_cane']).sugar_cane ?? 0} spare)`);
setStore({ sugar_cane: 20, leather: 3, emerald: 3 });
ok(w.caneTopUp(v, slot) === 12 && w.tradeKeep(v, 'leather') === 3 + 16, `20 stored: top-up ${w.caneTopUp(v, slot)} (the slot's empty cells), leather bought again (keep ${w.tradeKeep(v, 'leather')})`);
pick = w.merchantPick(v, 'sells', store(), keepOf);
ok(!('why' in pick) && pick.offer.item === 'leather', `20 stored: the buy ${pickText(pick)}`);

// Full: no more cane kept or topped up
slot.cells = Array.from({ length: 14 }, (_, i) => [slot.x1 + (i % 2 ? 3 : 1), slot.z1 + (i >> 1)]);
slot.planted = 14;
ok(w.tradeKeep(v, 'sugar_cane') === 0 && !w.merchantUses(v).has('sugar_cane') && w.caneTopUp(v, slot) === 0, `14 stalks: keep ${w.tradeKeep(v, 'sugar_cane')}, no top-up, cane not bought`);
// A second slot with 6 while the first holds 14: 20 in all, nothing more
const slot2 = v.layouts[8].slots[0];
const was2 = { kind: slot2.kind, cells: slot2.cells, planted: slot2.planted };
Object.assign(slot2, { kind: 'sugar_cane', planted: 6, cells: slot2.cells.slice(0, 6) });
ok(w.caneTopUp(v, slot2) === 0, 'a second slot once 14 are planted: no top-up');
Object.assign(slot2, was2);
slot.cells = slot.cells.slice(0, 4);
slot.planted = 4;
// Letters not current: none of it
v.ladder.current = 'iron';
ok(w.caneTopUp(v, slot) === 0 && w.tradeKeep(v, 'sugar_cane') === undefined, 'letters not current: no top-up, the trade\'s own keep');
v.ladder.current = 'letters';

// The market stall posted at completion
const stalls = () => (v.initiatives ?? []).filter((i: Any) => i.kind === 'market_stall');
v.initiatives = (v.initiatives ?? []).filter((i: Any) => i.kind !== 'market_stall');
const merchant = v.merchant;
delete v.merchant;
ok(v.complete && !stalls().length, 'no stall and no merchant');
mute();
w.postStall(v);
unmute();
const posted = stalls();
ok(posted.length === 1 && posted[0].state === 'open' && posted[0].by === 'the village' && !posted[0].pending, `posted: ${posted.map((i: Any) => `${i.id} by ${i.by} at ${i.x},${i.z} (${i.design})`).join('; ') || lines.filter((l) => /initiative/.test(l)).join(' | ')}`);
w.stallAt.clear();
w.postStall(v);
ok(stalls().length === 1, 'posted once (one open)');
// its help on a member's menu, ranked with the harvests and starts
const step = w.initiativeStep(v, posted[0], w.makeSpare(v, ''), new Set());
ok(!!step, `its first step: ${step ? step.what + (step.material ? ` ${step.amount} ${step.material}` : '') : 'none'}`);
const src = fs.readFileSync('server/src/mineflayer/mcWorld.ts', 'utf8');
ok(/rank: \(posted \? 150 : 1050\) \+ r/.test(src), 'its help ranked 150 (harvests 100s, starts 200s; a member\'s own 1050)');
// lapsed: posted again; built or a merchant there: not
posted[0].state = 'lapsed';
w.stallAt.clear();
mute();
w.postStall(v);
unmute();
ok(stalls().filter((i: Any) => i.state === 'open').length === 1, 'lapsed: posted again');
for (const i of stalls()) i.state = 'built';
w.stallAt.clear();
w.postStall(v);
ok(stalls().every((i: Any) => i.state === 'built'), 'a stall built: none posted');
v.initiatives = v.initiatives.filter((i: Any) => i.kind !== 'market_stall');
v.merchant = merchant;
w.stallAt.clear();
w.postStall(v);
ok(!stalls().length, 'a merchant there: none posted');

say(fails ? `letters_pace: ${fails} of ${checks} failed` : `letters_pace: all ${checks} passed`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
