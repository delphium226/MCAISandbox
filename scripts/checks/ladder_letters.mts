// G8's letters rung (#21, MC_LETTERS; runs/2026-10-24/letters/spec.md section 9) on a synthetic village: the four
// counters parsed from the skills' exact messages (B3), the feeds on option ids and aliases, the stages ended in order,
// the progress line and the ballot's preview. ladder_unit.mts covers the ladder with MC_LETTERS off.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/ladder_letters.mts
process.env.MC_LADDER = 'on';
process.env.MC_LETTERS = 'on';
const L = await import('../../server/src/ladder');
const village = { name: 'T', complete: true } as unknown as import('../../server/src/village').Village;
let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const t0 = 1_000_000;
const st = L.ladderOf(village, t0)!;
st.reached.push({ rung: 'iron', t: t0, workers: [] });
st.current = undefined;
ok(/every skill exists/.test(L.rungPreview('letters')), `letters' preview: ${L.rungPreview('letters')}`);
L.chooseRung(village, 'letters', ['letters'], t0);
ok(L.lettersCurrent(village) && !L.lettersReached(village), 'letters current');

// B3: each counter from its skill's exact message
const cases: Array<[string, string, unknown]> = [
  ['harvest_slot', 'harvested 9 sugar_cane (3 replanted) at -1650..-1644,40..46 into the village storage', [['cane', 6]]],
  ['harvest_slot', 'harvested 9 sugar_cane (3 replanted) at -1650..-1644,40..46 (storage full)', []],
  ['harvest_slot', 'harvested 4 pumpkin at -1650..-1644,40..46 into the village storage', []],
  ['harvest_slot', 'harvested 3 sugar_cane (3 replanted) at -1650..-1644,40..46 into the village storage', []],
  ['trade', 'traded with the merchant: bought 4 leather for 2 emerald (stock left 2)', [['leather', 4]]],
  ['trade', 'traded with the merchant: bought 8 sugar_cane for 2 emerald (stock left 0)', []],
  ['trade', 'traded with the merchant: sold 16 birch_log for 1 emerald (stock left 7)', []],
  ['fish', 'caught 8 fish (3 cod, 4 salmon, 1 pufferfish, 0 tropical fish) and 1 other items (1 leather) at -1658,62,-6 in 9 casts (reached target of 8 fish)', [['leather', 1]]],
  ['fish', 'caught 8 fish (6 cod, 1 salmon, 0 pufferfish, 1 tropical fish) and 2 other items (1 leather_boots, 1 rotten_flesh) at -1658,62,-6 in 10 casts (reached target of 8 fish)', []],
  ['make', 'made 4 book (made from storage: crafted 12 paper, crafted 4 book); put into storage: 4 book', [['books', 4]]],
  ['make', 'made 1 bookshelf (made from storage: crafted 6 birch_planks, crafted 1 bookshelf); put into storage: 1 bookshelf, 2 book', []],
  ['make', 'made 4 bread (made from storage: crafted 4 bread); put into storage: 4 bread', []],
  ['shelve_library', 'shelved 2 of 5 pieces in the plains library (bookshelf at -1646,66,36, bookshelf at -1646,66,35); 3 to go', [['shelved', 2]]],
  ['shelve_library', 'shelved 0 of 5 pieces in the plains library (no bookshelf in hand)', []],
];
for (const [type, msg, want] of cases) {
  const got = L.lettersCounts(type, msg);
  ok(eq(got, want), `${type}: ${JSON.stringify(got)} from "${msg.slice(0, 70)}"`);
}

// feeds: ids and aliases, stage by stage
ok(L.feedsStage(village, 'start:sugar_cane') && L.feedsStage(village, 'slot:1:2', 'slot:sugar_cane') && !L.feedsStage(village, 'slot:1:1', 'slot:pumpkin'), 'stage 1 feeds the cane start and cane slots only');
ok(L.feedsStage(village, 'activity:lib:buy', 'activity:lib:buy:sugar_cane') && !L.feedsStage(village, 'activity:lib:buy', 'activity:lib:buy:leather'), 'stage 1: a buy of cane, not of leather');
ok(/stage 1 of 4: 0 of 48 sugar cane harvested for paper/.test(L.progressLine(village, t0, 600000)), `line: ${L.progressLine(village, t0, 600000)}`);
// leather bought during stage 1 waits for stage 2
L.noteLadder(village, 'leather', 'Ben', 6, t0 + 1);
ok(st.stage === 0, 'early leather does not jump stage 1');
let news = L.noteLadder(village, 'cane', 'Ada', 30, t0 + 2);
ok(!news.length, 'cane 30 of 48');
news = L.noteLadder(village, 'cane', 'Cara', 18, t0 + 3);
ok(news.length === 1 && st.stage === 1 && st.count === 6, `stage 1 ends at 48 cane: ${news[0]?.text}`);
ok(L.feedsStage(village, 'activity:lib:buy', 'activity:lib:buy:leather') && L.feedsStage(village, 'activity:lib:sell') && L.feedsStage(village, 'activity:lib:fish') && !L.feedsStage(village, 'make:book'), 'stage 2 feeds leather trades, sales and fishing');
news = L.noteLadder(village, 'leather', 'Ben', 10, t0 + 4);
ok(news.length === 1 && st.stage === 2, `stage 2 ends at 16 leather: ${news[0]?.text}`);
ok(L.feedsStage(village, 'make:book') && !L.feedsStage(village, 'make:bookshelf'), 'stage 3 feeds the book make');
ok(L.rungTotal(village, 'letters', 'books') === 0, 'books 0');
for (let i = 0; i < 4; i++) L.noteLadder(village, 'books', 'Dan', 4, t0 + 5 + i);
ok(st.stage === 3 && L.rungTotal(village, 'letters', 'books') === 16, 'stage 3 ends at 16 books');
ok(L.feedsStage(village, 'make:bookshelf') && L.feedsStage(village, 'make:lectern') && L.feedsStage(village, 'shelve:library'), 'stage 4 feeds shelves, the lectern and the shelving');
ok(/0 of 5 pieces placed in the library/.test(L.progressLine(village, t0 + 10, 600000)), `line: ${L.progressLine(village, t0 + 10, 600000)}`);
L.noteLadder(village, 'shelved', 'Eve', 4, t0 + 20);
news = L.noteLadder(village, 'shelved', 'Eve', 1, t0 + 21, 3);
ok(news[0]?.kind === 'rung' && L.lettersReached(village) && !L.lettersCurrent(village), `the rung reached: ${news[0]?.text}`);
ok(L.rungTotal(village, 'letters', 'books') === 0, 'totals cleared after the rung');
const line = L.progressLine(village, t0 + 30, 600000);
ok(/reached the age of letters/.test(line) && line.length <= 300, `line after: ${line}`);
console.log(fails ? `ladder_letters: ${fails} failed` : 'ladder_letters: all passed');
process.exit(fails ? 1 : 0);
