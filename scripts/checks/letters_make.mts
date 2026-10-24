/**
 * #21 (MC_LETTERS) offline on a checkpoint's villages.json (default mc/testcheckpoints/im2_mine: letters current, stage
 * 1, 5 emeralds, 3 leather, birch): the rung's goods in the workshop with their targets, plans and keeps (spec 9 S4: no
 * cherry, the lectern from a fifth shelf only, the table's book kept), the food keeps leaving the books' cane (S2), and
 * the merchant's side (L2, B1, S1): the trades' keeps, what the merchant is used for, the seed's cane bought before
 * leather, the emeralds kept for leather, the offers appended after the old ones. With the rung not current: none of it.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/letters_make.mts [villages.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const villagesFile = process.argv[2] ?? 'mc/testcheckpoints/im2_mine/villages.json';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-make-'));
process.env.MC_LADDER = 'on';
process.env.MC_LETTERS = 'on';
process.env.MC_CHOOSE = 'fixed';
process.env.MC_TIME_SCALE = '1';
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
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
const { OFFERS, SELLS } = await import('../../server/src/merchant');
const { setLibrary } = await import('../../server/src/mineflayer/mcLibrary');
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.ladder?.current === 'letters') ?? data.villages.find((x) => x.complete);
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
w.villages.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = w.villages.get(base.name);
unmute();
say(`letters_make: ${villagesFile}; village ${v.name}; wood ${v.wood ?? '-'}, catalogue wood ${v.catalogWood ?? '-'}`);
v.ladder.current = 'letters';
v.ladder.stage = 0;
v.ladder.totals = {};
const chest = v.storage.chests[0];
const setStore = (c: Record<string, number>) => {
  for (const ch of v.storage.chests) for (const n of Object.keys(c)) delete ch.items[n];
  for (const [n, q] of Object.entries(c)) if (q) chest.items[n] = q;
};
const store = () => storageContents(v);
const good = (item: string) => w.goodsFor(v).find((g: Any) => g.item === item);
const plan = (item: string) => w.makePlan(v, good(item), '', store());
const planText = (p: Any) => ('why' in p ? p.why : `${p.count}: ${Object.entries(p.inputs).map(([n, q]) => `${q} ${n}`).join(', ')}`);

// the merchant's offers: appended after the old ones (a saved merchant's uses keep their indices)
ok(OFFERS[OFFERS.length - 2]?.item === 'leather' && OFFERS[OFFERS.length - 1]?.item === 'sugar_cane' && SELLS.some((o) => o.item === 'leather'), `offers end with leather and sugar_cane (${OFFERS.length})`);

// the seed first (B1): no cane farmed, 5 emeralds, 3 leather
const caneFarmed = (v.layouts ?? []).some((l: Any) => (l.slots ?? []).some((q: Any) => q.kind === 'sugar_cane'));
ok(!caneFarmed, 'no slot farms cane');
ok(w.tradeKeep(v, 'sugar_cane') === 6 && w.tradeKeep(v, 'leather') === (store().leather ?? 0), `keeps while the seed is wanted: cane ${w.tradeKeep(v, 'sugar_cane')}, leather ${w.tradeKeep(v, 'leather')} (no buying)`);
ok(w.merchantUses(v).has('sugar_cane') && w.merchantUses(v).has('leather'), 'the merchant is used for cane and leather');
const keepOf = (item: string) => w.tradeKeep(v, item) ?? 8;
let pick = w.merchantPick(v, 'sells', store(), keepOf);
ok(!('why' in pick) && pick.offer.item === 'sugar_cane' && pick.times === 2, `the buy: ${'why' in pick ? pick.why : `${pick.times} x ${pick.offer.n} ${pick.offer.item}`}`);
// the seed bought: the book leaves the start's 6 (staged L5s: a book took 6 of the 8), leather next, until 16 counted
setStore({ ...store(), sugar_cane: 8, emerald: 3 });
ok((w.makeSpare(v, '', 'book', store(), ['sugar_cane']).sugar_cane ?? 0) === 2, `a book takes only the cane beyond the start's 6 (${w.makeSpare(v, '', 'book', store(), ['sugar_cane']).sugar_cane ?? 0})`);
ok(w.tradeKeep(v, 'leather') === (store().leather ?? 0) + 16, `leather keep, stage 1, nothing counted: ${w.tradeKeep(v, 'leather')}`);
pick = w.merchantPick(v, 'sells', store(), keepOf);
ok(!('why' in pick) && pick.offer.item === 'leather' && pick.times === 3, `then leather: ${'why' in pick ? pick.why : `${pick.times} x ${pick.offer.n} ${pick.offer.item}`}`);
// (the leather's share of the emeralds kept: the keep with leather's against the keep with leather at its stock)
const leatherShare = () => w.emeraldKeep(v, keepOf) - w.emeraldKeep(v, (i: string) => (i === 'leather' ? store().leather ?? 0 : keepOf(i)));
ok(leatherShare() === 8, `emeralds kept for the 16 leather still to buy: ${leatherShare()} (of ${w.emeraldKeep(v, keepOf)})`);
v.ladder.totals.leather = 10;
ok(leatherShare() === 3 && w.tradeKeep(v, 'leather') === (store().leather ?? 0) + 6, `after 10 counted: ${leatherShare()} kept for leather, leather keep ${w.tradeKeep(v, 'leather')}`);
v.ladder.totals.leather = 16;
v.ladder.stage = 2;
v.ladder.totals.books = 4;
ok(w.tradeKeep(v, 'leather') === 12, `after stage 2: leather kept for the 12 books to bind (${w.tradeKeep(v, 'leather')})`);

// the goods (S4)
v.ladder.stage = 0;
v.ladder.totals = {};
setStore({ ...store(), sugar_cane: 48, leather: 16, book: 0, bookshelf: 0, lectern: 0, emerald: 0 });
const goods = w.goodsFor(v);
ok(['book', 'bookshelf', 'lectern'].every((n) => goods.some((g: Any) => g.item === n)), 'the rung goods are in the workshop');
ok(good('lectern').wood === (v.catalogWood ?? v.wood) && good('bookshelf').wood === good('lectern').wood && !good('book').wood, `wood goods in the catalogue wood (${good('lectern').wood})`);
ok(w.makeTarget(v, good('book')) === 16 && w.makeTarget(v, good('bookshelf')) === 5 && w.makeTarget(v, good('lectern')) === 0, `targets from nothing: book ${w.makeTarget(v, good('book'))}, bookshelf ${w.makeTarget(v, good('bookshelf'))}, lectern ${w.makeTarget(v, good('lectern'))}`);
let p = plan('book');
ok(!('why' in p) && p.count === 4 && p.inputs.sugar_cane === 12 && p.inputs.leather === 4, `the book's plan: ${planText(p)}`);
ok(w.foodKeep(v, 'sugar_cane', store()) === 2 + 48, `the pie and cake leave the books' cane: keep ${w.foodKeep(v, 'sugar_cane', store())}`);
const spareNone = w.makeSpare(v, '', undefined, store());
ok(!spareNone.leather, `other makes leave the books' leather (spare ${spareNone.leather ?? 0})`);
// 16 books bound: shelves
v.ladder.totals.books = 16;
v.ladder.stage = 3;
setStore({ ...store(), sugar_cane: 0, leather: 0, book: 16 });
ok(w.makeTarget(v, good('book')) === 16 && 'why' in plan('book'), `books at target once 16 are bound (${planText(plan('book'))})`);
p = plan('bookshelf');
ok(!('why' in p) && p.count === 1 && p.inputs.book === 3 && !Object.keys(p.inputs).some((n) => /cherry|oak/.test(n)), `the shelf's plan: ${planText(p)}`);
const spare16 = w.makeSpare(v, '', 'bookshelf', store());
ok(spare16.book === 15, `the table's book kept: ${spare16.book} of 16 spare`);
setStore({ ...store(), book: 4, bookshelf: 4 });
ok(w.makeTarget(v, good('bookshelf')) === 5 && w.makeTarget(v, good('lectern')) === 0 && 'why' in plan('lectern'), `4 shelves stored: one more shelf, no lectern yet (${planText(plan('lectern'))})`);
setStore({ ...store(), book: 1, bookshelf: 5 });
p = plan('lectern');
ok(w.makeTarget(v, good('lectern')) === 1 && !('why' in p) && p.inputs.bookshelf === 1 && !Object.keys(p.inputs).some((n) => /cherry|oak/.test(n)), `5 shelves: the lectern from the fifth (${planText(p)})`);
ok('why' in plan('bookshelf'), `and no sixth shelf (${planText(plan('bookshelf'))})`);
setStore({ ...store(), bookshelf: 4, lectern: 1 });
ok(w.makeTarget(v, good('lectern')) === 1 && 'why' in plan('lectern') && 'why' in plan('bookshelf'), 'the lectern made: nothing more wanted');
// shelved: 2 shelves placed, the rest stored
setLibrary(v, { structure: 's', done: ['a', 'b'], shelves: 2, lectern: false });
setStore({ ...store(), bookshelf: 2, lectern: 1 });
ok('why' in plan('bookshelf') && 'why' in plan('lectern'), 'two shelves placed, two and the lectern stored: nothing to make');
setLibrary(v, { structure: 's', done: ['a', 'b', 'c', 'd', 'e'], shelves: 4, lectern: true });
setStore({ ...store(), bookshelf: 0, lectern: 0 });
ok(w.makeTarget(v, good('bookshelf')) === 0 && w.makeTarget(v, good('lectern')) === 0, 'all placed: targets 0');

// the rung reached: no goods, the book kept, merchant keeps back to the trade's
v.ladder.reached.push({ rung: 'letters', t: Date.now(), workers: [] });
v.ladder.current = undefined;
ok(!w.goodsFor(v).some((g: Any) => g.rung) && w.tradeKeep(v, 'leather') === undefined && !w.merchantUses(v).has('leather'), 'after the rung: no rung goods, the trades\' own keeps');
setStore({ ...store(), book: 3 });
ok(w.makeSpare(v, '', undefined, store()).book === 2, 'the table\'s book kept after the rung');
say(fails ? `letters_make: ${fails} of ${checks} failed` : `letters_make: all ${checks} passed`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
